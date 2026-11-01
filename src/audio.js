// audio.js – snd_dma.c, more or less: the SOUND_EVENTS rows become Web
// Audio buffers, attenuated and panned from where they happened (Quake 2's
// spatialisation: full volume within 80 units, then a linear fall-off scaled
// by the attenuation, ATTN_NONE heard everywhere). The looped sounds (a
// rocket's flight, a moving door, a looped target_speaker) are mixed per
// sound where their entities are each frame; the music is the CD track the
// worldspawn names (music/trackNN.ogg|mp3, or a folder the player picks, whose
// tracks are kept across reloads as they play), with a synthesised drone when
// no track file is available.

const SOUND_FULLVOLUME = 80;
const LOOP_ATTN = 3;   // SOUND_LOOPATTENUATE: ATTN_STATIC

export class Q2Audio {
  constructor() {
    this.ctx = null;
    this.pak = null;
    this.buffers = new Map();
    this.decodedBytes = 0;       // z_stats: the decoded sounds' samples as bytes (frames × channels × 4)
    this.volume = 0.7;
    this.musicVolume = 0.5;
    this.channels = new Map();   // `${ent}:${chan}` → source, to cut
    this.playing = new Set();    // every one-shot source still playing (S_StopAllSounds cuts them all)
    this.footsteps = true;       // cl_footsteps: the player/step sounds played, or dropped
    this.speakers = [];          // looped target_speakers: { id, name, x, y, z, on }
    this.loops = new Map();      // looped entity sounds: name → { src, gain, pan }
    this.loopRows = [];
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.musicMode = 'tracks';   // 'off' | 'tracks' | 'synth'
    this.loopCount = 4;          // cd_loopcount: a map's track played this many times, then the loop track (CDAudio_Update)
    this.loopTrack = 11;         // cd_looptrack: the track played over and over after them
    this.nocd = false;           // cd_nocd: no music at all
    this.musicFiles = new Map(); // 'track06' → File, from a picked folder
    this.musicStore = null;      // src/demostore.js's FileStore: a picked folder's tracks kept as they play, played at the next start
    this.music = null;
    this.track = 0;
    this.khz = 44;               // s_khz: the mixer's rate at the next start or restart (11, 22, 44: the browser's own)
    this.mixahead = 0.05;        // s_mixahead: how far ahead of the clock the raw stream's samples (a cinematic's) are queued when they start or have fallen behind (S_Update's lead; Quake's 0.2 covered a DMA, a frame's worth here)
    this.testsound = false;      // s_testsound: S_TransferPaintBuffer's fixed sine in place of the mix (the sounds muted while it plays)
    this.testTone = null;        // ... the oscillator and its gain while it plays
    this.enabled = true;         // the cd word's on and off (CD_f): off, no music until on again
    this.pausedMusic = null;     // cd pause: { track, plays, how, offset } to resume from
    this.onStart = null;         // s_show: told each sound started as (name, left, right), the volumes 0 to 255 as S_Update printed the channels
  }

  setPak(pak) { this.stopLoops(); this.pak = pak; this.buffers.clear(); this.decodedBytes = 0; }
  setVolume(v) { this.volume = v; if (this.master && !this.testTone) this.master.gain.value = v; }   // (the tone playing, the mix stays muted: the volume is for after)
  setMusicVolume(v) { this.musicVolume = v; if (this.musicGain) this.musicGain.gain.value = v; }

  unlock() {
    if (!this.ctx) {
      // s_khz: the context asked at 11025 or 22050 (11, 22); 44 leaves the browser's own rate, the default here
      const rate = this.khz === 11 ? 11025 : this.khz === 22 ? 22050 : 0;
      this.ctx = new (window.AudioContext || window.webkitAudioContext)(rate ? { sampleRate: rate } : undefined);
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicVolume;
      this.musicGain.connect(this.ctx.destination);
      if (this.testsound) this.startTestTone();
      if (this.track) this.playMusic(this.track);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  /**
   * CL_Snd_Restart_f (S_Shutdown, S_Init, the sounds registered again): the context closed and made anew, the decoded sounds
   * forgotten (decoded again as they play), the music played again. True once a context is up again (none before the first
   * click or key: the restart waits for it like the first start).
   */
  restart() {
    this.stopAll();
    const old = this.ctx;
    this.ctx = null; this.master = null; this.musicGain = null; this.testTone = null;
    this.buffers.clear(); this.decodedBytes = 0;
    this.music = null; this.pausedMusic = null;
    try { old?.close?.()?.catch?.(() => {}); } catch { /* closed already */ }
    this.unlock();
    return !!this.ctx;
  }

  suspend(hidden) {
    if (!this.ctx) return;
    if (hidden) this.silenceLoops();
    if (hidden) this.ctx.suspend(); else this.ctx.resume();
  }

  async buffer(name) {
    if (this.buffers.has(name)) return this.buffers.get(name);
    const p = (async () => {
      if (!this.pak) return null;
      let file = 'sound/' + name;
      // (S_RegisterSexedSound: a female client's sound a pak lacks, the demo's has none, plays the male's)
      if (!this.pak.has(file) && name.startsWith('player/female/')) file = 'sound/player/male/' + name.slice('player/female/'.length);
      if (!this.pak.has(file)) return null;
      try {
        const b = await this.ctx.decodeAudioData(this.pak.buffer(file));
        if (b) this.decodedBytes += (b.length ?? 0) * (b.numberOfChannels ?? 1) * 4;
        return b;
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

  /**
   * S_RawSamples: a cinematic's sound, raw PCM (`width` 1 unsigned bytes or 2 signed little-endian shorts,
   * `channels` interleaved) at `rate`, queued end to end from a little after now so the chunks play without a gap.
   */
  playRaw(samples, rate, width = 1, channels = 1) {
    if (!this.ctx || !samples?.length) return;
    const frames = Math.floor(samples.length / (width * channels));
    if (frames <= 0) return;
    const buf = this.ctx.createBuffer(channels, frames, rate);
    const dv = width === 2 ? new DataView(samples.buffer, samples.byteOffset, samples.byteLength) : null;
    for (let c = 0; c < channels; c++) {
      const out = buf.getChannelData(c);
      for (let i = 0; i < frames; i++) {
        const k = (i * channels + c) * width;
        out[i] = width === 2 ? dv.getInt16(k, true) / 32768 : (samples[k] - 128) / 128;
      }
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.master);
    const now = this.ctx.currentTime;
    if (!this.rawTime || this.rawTime < now) this.rawTime = now + this.mixahead;   // (s_mixahead: the stream starts, or catches up, that far ahead of the clock)
    src.start(this.rawTime);
    this.rawTime += buf.duration;
    (this.rawSources ??= []).push(src);
    src.onended = () => { const i = this.rawSources.indexOf(src); if (i >= 0) this.rawSources.splice(i, 1); };
  }
  /** The raw queue cut (SCR_FinishCinematic). */
  stopRaw() {
    for (const s of this.rawSources ?? []) { try { s.stop(); } catch { /* ended */ } }
    this.rawSources = [];
    this.rawTime = 0;
  }
  /**
   * s_testsound: S_TransferPaintBuffer's fixed sine in place of the mix (sin(paintedtime × 0.1) × 20000: 0.1 radians a sample at the
   * mixer's rate, 20000 of 32768). On, the tone plays into the output and the sounds are muted; off, the mix is back at the volume.
   * Before the context exists it is remembered for the first start.
   */
  setTestsound(on) {
    this.testsound = !!on;
    if (!this.ctx) return;
    if (this.testsound) this.startTestTone(); else this.stopTestTone();
  }
  startTestTone() {
    if (this.testTone || !this.ctx) return;
    const osc = this.ctx.createOscillator(), g = this.ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = 0.1 * this.ctx.sampleRate / (2 * Math.PI);
    g.gain.value = 20000 / 32768;
    osc.connect(g).connect(this.ctx.destination);
    osc.start();
    this.testTone = { osc, g };
    this.master.gain.value = 0;
  }
  stopTestTone() {
    if (!this.testTone) return;
    try { this.testTone.osc.stop(); } catch { /* stopped */ }
    this.testTone.osc.disconnect?.(); this.testTone.g.disconnect?.();
    this.testTone = null;
    if (this.master) this.master.gain.value = this.volume;
  }

  async playEvents(rows, listener) {
    this.listener = listener;
    if (!this.ctx) return;
    for (const [, , ent, chan, name, vol, attn, x, y, z] of rows) {
      if (!this.footsteps && name.startsWith('player/step')) continue;   // (cl_footsteps 0: CL_EntityEvent played no footstep)
      const buf = await this.buffer(name);
      if (!buf) continue;
      const { gain, pan } = this.spatialize(x, y, z, attn);
      if (gain <= 0) continue;
      if (this.onStart) { const v = Math.min(255, Math.round(gain * vol * 255)); this.onStart(name, Math.round(v * (1 - Math.max(0, pan))), Math.round(v * (1 + Math.min(0, pan)))); }
      const key = `${ent}:${chan}`;
      if (ent != null && chan !== 0) {
        const old = this.channels.get(key);
        if (old) { try { old.stop(); } catch { /* ended */ } this.playing.delete(old); }
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = gain * vol;
      const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (p) { p.pan.value = pan; src.connect(g).connect(p).connect(this.master); } else src.connect(g).connect(this.master);
      src.start();
      this.playing.add(src);
      src.onended = () => this.playing.delete(src);
      if (ent != null && chan !== 0) this.channels.set(key, src);
    }
  }

  /** S_StopAllSounds: every one-shot cut, the loops with them (the next frame's rows start them again), a cinematic's samples too. */
  stopAll() {
    for (const s of this.playing) { try { s.stop(); } catch { /* ended */ } }
    this.playing.clear();
    this.channels.clear();
    this.stopLoops();
    this.stopRaw();
  }

  /** S_SoundInfo_f: the mix's figures, or { started: false } before the context exists (the first click or key makes it). */
  info() {
    if (!this.ctx) return { started: false };
    return { started: true, rate: this.ctx.sampleRate, stereo: (this.ctx.destination?.channelCount ?? 2) >= 2 ? 1 : 0, decoded: this.buffers.size, playing: this.playing.size, loops: this.loops.size };
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

  /** Where a picked folder's tracks are kept across reloads (get(key) → { name, bytes } | null, put(key, value)); null keeps none. */
  setMusicStore(store) { this.musicStore = store; }

  setMusicFiles(files) {
    this.musicFiles.clear();
    for (const f of files) {
      const m = /track(\d+)\.(ogg|mp3|wav|m4a|flac)$/i.exec(f.name);
      if (m) this.musicFiles.set(`track${m[1].padStart(2, '0')}`, f);
    }
    if (this.track && this.ctx) { this.stopMusic(); this.playMusic(this.track); }
  }

  /**
   * Start the CD track of the map (worldspawn "sounds"); `plays` how many times it has played already (the loop's count).
   * `how` is the cd word's: 'once' (cd play: the track once, then nothing), 'loop' (cd loop: over and over), else the map's
   * rule (cd_loopcount times, then the loop track); `offset` seconds into the track (cd resume).
   */
  async playMusic(track, plays = 0, how = null, offset = 0) {
    this.track = track;
    this.pausedMusic = null;
    if (!this.ctx || this.musicMode === 'off' || this.nocd || !this.enabled || !track) { this.stopMusic(); return; }
    if (this.music && this.music.track === track) { this.music.how = how; return; }
    this.stopMusic();
    const name = `track${String(track).padStart(2, '0')}`;
    const token = { track, plays, how };
    this.music = token;
    let buf = null;
    if (this.musicMode === 'tracks') {
      // the track: a picked folder's file, else the one kept from a folder picked before (src/demostore.js), else the
      // site's music/ (which the service worker keeps in the data cache as it is fetched)
      const file = this.musicFiles.get(name);
      const kept = !file && this.musicStore ? await this.musicStore.get(`music/${name}`).catch(() => null) : null;
      if (this.music !== token) return;
      const sources = file ? [file] : kept ? [kept] : ['ogg', 'mp3'].map((ext) => new URL(`./music/${name}.${ext}`, location.href));
      for (const src of sources) {
        try {
          const data = src === file ? await src.arrayBuffer() : src === kept ? kept.bytes.buffer.slice(kept.bytes.byteOffset, kept.bytes.byteOffset + kept.bytes.byteLength) : await fetch(src).then((r) => (r.ok ? r.arrayBuffer() : null));
          if (!data) continue;
          const keep = src === file && this.musicStore ? new Uint8Array(data.slice(0)) : null;   // (decoding detaches the buffer)
          buf = await this.ctx.decodeAudioData(data);
          if (keep) this.musicStore.put(`music/${name}`, { name: file.name, bytes: keep }).catch((err) => console.warn('the track is not kept:', err?.message ?? err));
          break;
        } catch { /* try the next */ }
      }
    }
    if (this.music !== token) return;
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      // CDAudio_Update's loop: the track over again until it has played cd_loopcount times, then cd_looptrack over and over
      src.onended = () => {
        if (this.music !== token) return;
        const n = token.plays + 1;
        this.music = null;
        if (token.how === 'once') return;   // (cd play: once, then nothing)
        if (token.how === 'loop') { this.playMusic(track, n, 'loop'); return; }   // (cd loop: over and over)
        this.playMusic(n >= this.loopCount ? this.loopTrack : track, n);
      };
      src.connect(this.musicGain);
      src.start(0, offset);
      token.src = src;
      token.startedAt = this.ctx.currentTime - offset;
      token.kind = 'track';
    } else if (this.musicMode !== 'off') {
      token.kind = 'synth';
      token.stop = this.startDrone(track);
    }
  }

  /** cd_nocd: on, the music stops and none plays; off again, the map's track. */
  setNocd(on) {
    this.nocd = !!on;
    if (this.nocd) this.stopMusic();
    else if (this.track && this.ctx) this.playMusic(this.track);
  }

  stopMusic() {
    if (!this.music) return;
    try { this.music.src?.stop(); } catch { /* ended */ }
    this.music.stop?.();
    this.music = null;
  }

  /** cd pause: the music stopped where it is, to resume from there; false with none playing. */
  pauseMusic() {
    const m = this.music;
    if (!m) return false;
    this.pausedMusic = { track: m.track, plays: m.plays, how: m.how, offset: m.kind === 'track' && this.ctx ? Math.max(0, this.ctx.currentTime - m.startedAt) : 0 };
    this.stopMusic();
    return true;
  }

  /** cd resume: the paused music from where it was; false with none paused. */
  resumeMusic() {
    const p = this.pausedMusic;
    if (!p) return false;
    this.pausedMusic = null;
    this.playMusic(p.track, p.plays, p.how, p.offset);
    return true;
  }

  /** cd on and cd off (CD_f's enabled): off stops the music and plays none; on plays the track again. */
  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) { this.stopMusic(); this.pausedMusic = null; }
    else if (this.track && this.ctx) this.playMusic(this.track);
  }

  /** cd info: the tracks the page can play (a picked folder's, else the CD's eleven), what plays or is paused, and how. */
  musicInfo() {
    const m = this.music, p = this.pausedMusic;
    return { tracks: this.musicFiles.size || 11, track: m?.track ?? p?.track ?? 0, playing: !!m, paused: !m && !!p, looping: (m ?? p)?.how === 'loop', enabled: this.enabled };
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
