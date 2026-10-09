// audio.js – snd_dma.c, more or less: the SOUND_EVENTS rows become Web
// Audio buffers, attenuated and panned from where they happened (Quake 2's
// spatialisation: full volume within 80 units, then a linear fall-off scaled
// by the attenuation, ATTN_NONE heard everywhere). The looped sounds (a
// rocket's flight, a moving door, a looped target_speaker) are mixed per
// sound where their entities are each frame; the music is the CD track the
// worldspawn names (music/trackNN.ogg|mp3, or a folder the player picks),
// with a synthesised drone when no track file is available.

const SOUND_FULLVOLUME = 80;
const LOOP_ATTN = 3;   // SOUND_LOOPATTENUATE: ATTN_STATIC

export class Q2Audio {
  constructor() {
    this.ctx = null;
    this.pak = null;
    this.buffers = new Map();
    this.volume = 0.7;
    this.musicVolume = 0.5;
    this.channels = new Map();   // `${ent}:${chan}` → source, to cut
    this.speakers = [];          // looped target_speakers: { id, name, x, y, z, on }
    this.loops = new Map();      // looped entity sounds: name → { src, gain, pan }
    this.loopRows = [];
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.musicMode = 'tracks';   // 'off' | 'tracks' | 'synth'
    this.musicFiles = new Map(); // 'track06' → File, from a picked folder
    this.music = null;
    this.track = 0;
  }

  setPak(pak) { this.stopLoops(); this.pak = pak; this.buffers.clear(); }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  setMusicVolume(v) { this.musicVolume = v; if (this.musicGain) this.musicGain.gain.value = v; }

  unlock() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicVolume;
      this.musicGain.connect(this.ctx.destination);
      if (this.track) this.playMusic(this.track);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  suspend(hidden) {
    if (!this.ctx) return;
    if (hidden) this.silenceLoops();
    if (hidden) this.ctx.suspend(); else this.ctx.resume();
  }

  async buffer(name) {
    if (this.buffers.has(name)) return this.buffers.get(name);
    const p = (async () => {
      if (!this.pak || !this.pak.has('sound/' + name)) return null;
      try {
        return await this.ctx.decodeAudioData(this.pak.buffer('sound/' + name));
      } catch { return null; }
    })();
    this.buffers.set(name, p);
    return p;
  }

  /** Volume and pan of a sound at (x, y, z) for the listener (S_Spatialize). */
  spatialize(x, y, z, attn) {
    const l = this.listener;
    if (x == null || !attn) return { gain: 1, pan: 0 };
    const dx = x - l.x, dy = y - l.y, dz = z - l.z;
    const dist = Math.max(0, Math.hypot(dx, dy, dz) - SOUND_FULLVOLUME) * attn * 0.001;
    const gain = Math.max(0, 1 - dist);
    const yaw = (l.yaw * Math.PI) / 180;
    const rx = Math.sin(yaw), ry = -Math.cos(yaw);
    const d = Math.hypot(dx, dy) || 1;
    const pan = ((dx * rx + dy * ry) / d) * 0.8;
    return { gain, pan };
  }

  /** S_StartLocalSound: a sound at full volume from nowhere in the world (the menus' clicks). */
  playLocal(name) { this.playEvents([[0, 0, null, 0, name, 1, 0, null, null, null]], this.listener); }

  async playEvents(rows, listener) {
    this.listener = listener;
    if (!this.ctx) return;
    for (const [, , ent, chan, name, vol, attn, x, y, z] of rows) {
      const buf = await this.buffer(name);
      if (!buf) continue;
      const { gain, pan } = this.spatialize(x, y, z, attn);
      if (gain <= 0) continue;
      const key = `${ent}:${chan}`;
      if (ent != null && chan !== 0) {
        const old = this.channels.get(key);
        if (old) { try { old.stop(); } catch { /* ended */ } }
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = gain * vol;
      const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (p) { p.pan.value = pan; src.connect(g).connect(p).connect(this.master); } else src.connect(g).connect(this.master);
      src.start();
      if (ent != null && chan !== 0) this.channels.set(key, src);
    }
  }

  // ── looped speakers ───────────────────────────────────────────────────
  /** rows: [id, x, y, z, noise, on] for every looped target_speaker of the map. In 3.14 a looped speaker is
   *  its s.sound (SP_target_speaker, Use_Target_Speaker), so it is mixed with the entities' loops below, at full
   *  volume and ATTN_STATIC whatever its volume and attenuation keys say (those are for its one-shots). */
  setSpeakers(rows) {
    this.speakers = rows.map(([id, x, y, z, name, on]) => ({ id, x, y, z, name, on: on === 1 }));
  }

  /** The speakers that are on this frame (ids). */
  setSpeakersOn(ids) {
    const on = new Set(ids);
    for (const s of this.speakers) s.on = on.has(s.id);
  }

  loop(buf, dest) {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (p) src.connect(g).connect(p).connect(dest); else src.connect(g).connect(dest);
    src.start(0, Math.random() * buf.duration);
    return { src, gain: g, pan: p };
  }

  // ── looped entity sounds (s.sound) ────────────────────────────────────
  /** This frame's [name, x, y, z] rows: a rocket's flight, a moving door, the railgun's hum. */
  setLoops(rows) { this.loopRows = rows; }

  /** The game stopped (paused, a menu, a level change): the loops fall silent until the next frame lists them. */
  silenceLoops() {
    this.loopRows = [];
    for (const c of this.loops.values()) if (c.gain) c.gain.gain.value = 0;
  }

  stopLoops() {
    for (const c of this.loops.values()) { try { c.src?.stop(); } catch { /* ended */ } }
    this.loops.clear();
    this.loopRows = [];
  }

  /** S_AddLoopSounds: every entity with the same sound feeds one looped channel, spatialised at full volume
   *  with ATTN_STATIC, the left and right sums each clamped at full scale. */
  mixLoops() {
    const sums = new Map();
    const rows = this.loopRows.concat(this.speakers.filter((sp) => sp.on).map((sp) => [sp.name, sp.x, sp.y, sp.z]));
    for (const [name, x, y, z] of rows) {
      const { gain, pan } = this.spatialize(x, y, z, LOOP_ATTN);
      if (gain <= 0) continue;
      const s = sums.get(name) ?? { l: 0, r: 0 };
      s.l += gain * (1 - pan) / 2; s.r += gain * (1 + pan) / 2;
      sums.set(name, s);
    }
    for (const name of sums.keys()) {
      if (this.loops.has(name)) continue;
      const c = {};
      this.loops.set(name, c);
      this.buffer(name).then((buf) => { if (buf && this.loops.get(name) === c) Object.assign(c, this.loop(buf, this.master)); });
    }
    for (const [name, c] of this.loops) {
      if (!c.gain) continue;
      const s = sums.get(name);
      const l = s ? Math.min(1, s.l) : 0, r = s ? Math.min(1, s.r) : 0;
      c.gain.gain.value = l + r;
      if (c.pan) c.pan.pan.value = l + r > 0 ? (r - l) / (l + r) : 0;
    }
  }

  /** Called every frame with the listener: the looped speakers and entity sounds follow the player. */
  update(listener) {
    this.listener = listener;
    if (this.ctx) this.mixLoops();
  }

  // ── music ──────────────────────────────────────────────────────────────
  setMusicMode(mode) {
    this.musicMode = mode;
    this.stopMusic();
    if (this.track && this.ctx) this.playMusic(this.track);
  }

  setMusicFiles(files) {
    this.musicFiles.clear();
    for (const f of files) {
      const m = /track(\d+)\.(ogg|mp3|wav|m4a|flac)$/i.exec(f.name);
      if (m) this.musicFiles.set(`track${m[1].padStart(2, '0')}`, f);
    }
    if (this.track && this.ctx) { this.stopMusic(); this.playMusic(this.track); }
  }

  /** Start the CD track of the map (worldspawn "sounds"). */
  async playMusic(track) {
    this.track = track;
    if (!this.ctx || this.musicMode === 'off' || !track) { this.stopMusic(); return; }
    if (this.music && this.music.track === track) return;
    this.stopMusic();
    const name = `track${String(track).padStart(2, '0')}`;
    const token = { track };
    this.music = token;
    let buf = null;
    if (this.musicMode === 'tracks') {
      const file = this.musicFiles.get(name);
      const sources = file ? [file] : ['ogg', 'mp3'].map((ext) => new URL(`./music/${name}.${ext}`, location.href));
      for (const srcUrl of sources) {
        try {
          const data = srcUrl instanceof File ? await srcUrl.arrayBuffer() : await fetch(srcUrl).then((r) => (r.ok ? r.arrayBuffer() : null));
          if (!data) continue;
          buf = await this.ctx.decodeAudioData(data);
          break;
        } catch { /* try the next */ }
      }
    }
    if (this.music !== token) return;
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.musicGain);
      src.start();
      token.src = src;
      token.kind = 'track';
    } else if (this.musicMode !== 'off') {
      token.kind = 'synth';
      token.stop = this.startDrone(track);
    }
  }

  stopMusic() {
    if (!this.music) return;
    try { this.music.src?.stop(); } catch { /* ended */ }
    this.music.stop?.();
    this.music = null;
  }

  /** An industrial drone when no track file is available: a low pulse, a filtered saw pad and machine noise. */
  startDrone(track) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.musicGain);
    out.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 4);
    const root = 33 + ((track * 7) % 5);
    const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    filter.Q.value = 3;
    filter.connect(out);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 200;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    const nodes = [lfo];
    for (const [n, type, detune, g] of [[root, 'sawtooth', -5, 0.5], [root, 'square', 6, 0.25], [root + 7, 'sawtooth', 0, 0.2], [root - 12, 'sine', 0, 0.8]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz(n);
      o.detune.value = detune;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(filter);
      o.start();
      nodes.push(o);
    }
    // a slow machine pulse
    const pulse = ctx.createOscillator();
    pulse.type = 'triangle';
    pulse.frequency.value = hz(root - 24);
    const pg = ctx.createGain();
    pg.gain.value = 0;
    pulse.connect(pg).connect(out);
    pulse.start();
    nodes.push(pulse);
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.3;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 250;
    nf.Q.value = 1;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    noise.connect(nf).connect(ng).connect(out);
    noise.start();
    nodes.push(noise);
    let alive = true;
    const beat = () => {
      if (!alive) return;
      const t = ctx.currentTime;
      pg.gain.cancelScheduledValues(t);
      pg.gain.setValueAtTime(0.5, t);
      pg.gain.exponentialRampToValueAtTime(0.01, t + 0.6);
      setTimeout(beat, 1500);
    };
    beat();
    return () => {
      alive = false;
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
      out.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
      setTimeout(() => { for (const n of nodes) { try { n.stop(); } catch { /* ended */ } } out.disconnect(); }, 1600);
    };
  }
}
