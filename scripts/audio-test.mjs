// audio-test.mjs – the sound mix headless (src/audio.js, snd_dma.c): spatialisation as S_Spatialize had it, a
// one-shot per event cut by the next on its channel, the looped sounds summed per name as S_AddLoopSounds did,
// the looped speakers on and off, the page hidden and back, and the music: a track file, the drone, off.
//   node scripts/audio-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pak } from '../src/pak.js';
import { Q2Audio } from '../src/audio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const tick = () => new Promise((r) => setTimeout(r, 0));

// ── a Web Audio that records: every node made, started and stopped, and what it is connected to ──
const made = [];
class Param { constructor(v) { this.value = v; this.ramps = []; } linearRampToValueAtTime(v, t) { this.ramps.push(['lin', v, t]); } exponentialRampToValueAtTime(v, t) { this.ramps.push(['exp', v, t]); } setValueAtTime(v, t) { this.ramps.push(['set', v, t]); } cancelScheduledValues() {} }
class Node { constructor(kind) { this.kind = kind; this.to = null; this.started = false; this.stopped = false; made.push(this); } connect(n) { this.to = n; return n; } disconnect() { this.to = null; } start(when, offset) { this.started = true; this.offset = offset; } stop() { if (this.stopped) throw new Error('stopped twice'); this.stopped = true; } }
class FakeContext {
  constructor() { this.state = 'running'; this.currentTime = 10; this.sampleRate = 22050; this.destination = new Node('destination'); this.decoded = 0; this.resumed = 0; this.suspended = 0; }
  createGain() { const n = new Node('gain'); n.gain = new Param(1); return n; }
  createBufferSource() { const n = new Node('source'); n.buffer = null; n.loop = false; return n; }
  createStereoPanner() { const n = new Node('panner'); n.pan = new Param(0); return n; }
  createOscillator() { const n = new Node('osc'); n.type = 'sine'; n.frequency = new Param(440); n.detune = new Param(0); return n; }
  createBiquadFilter() { const n = new Node('filter'); n.type = 'lowpass'; n.frequency = new Param(350); n.Q = new Param(1); return n; }
  createBuffer(channels, length, rate) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; }
  async decodeAudioData(bytes) { this.decoded++; return { duration: 1.5, bytes: bytes.byteLength }; }
  async resume() { this.resumed++; this.state = 'running'; }
  async suspend() { this.suspended++; this.state = 'suspended'; }
}
globalThis.window = { AudioContext: FakeContext };
globalThis.location = { href: 'http://localhost/' };
globalThis.fetch = async () => ({ ok: false });   // no music/trackNN files are served

/** Walk a source's chain: [gain, panner|null, destination node]. */
const chain = (src) => { const g = src.to, p = g?.to?.kind === 'panner' ? g.to : null, out = (p ?? g)?.to; return { g, p, out }; };
const sources = () => made.filter((n) => n.kind === 'source');
const started = () => sources().filter((n) => n.started && !n.stopped);

const audio = new Q2Audio();
audio.setPak(pak);
const L = { x: 0, y: 0, z: 0, yaw: 0 };   // the listener: at the origin, facing +x (right is -y, as Quake's AngleVectors has it)

// ── spatialisation (S_Spatialize) ──
audio.listener = L;
check(audio.spatialize(50, 0, 0, 1).gain === 1 && audio.spatialize(79, 0, 0, 1).gain === 1, 'full volume within 80 units');
check(near(audio.spatialize(580, 0, 0, 1).gain, 0.5), 'ATTN_NORM: half way to silence 500 units past that (dist_mult 0.001)');
check(audio.spatialize(1080, 0, 0, 1).gain === 0 && audio.spatialize(5000, 0, 0, 1).gain === 0, 'and silent from 1080 units');
check(near(audio.spatialize(580, 0, 0, 2).gain, 0) && near(audio.spatialize(330, 0, 0, 2).gain, 0.5), 'ATTN_IDLE (2) falls off twice as fast');
check(audio.spatialize(5000, 0, 0, 0).gain === 1 && audio.spatialize(5000, 0, 0, 0).pan === 0, 'ATTN_NONE is heard everywhere, in the middle');
check(audio.spatialize(null, null, null, 1).gain === 1, 'a sound from nowhere (a local sound) is full and centred');
check(near(audio.spatialize(0, -100, 0, 1).pan, 0.8) && near(audio.spatialize(0, 100, 0, 1).pan, -0.8), 'to the right pans right (0.8), to the left left');
check(near(audio.spatialize(100, 0, 0, 1).pan, 0) && near(audio.spatialize(-100, 0, 0, 1).pan, 0), 'ahead and behind are centred');
audio.listener = { x: 0, y: 0, z: 0, yaw: 90 };
check(near(audio.spatialize(100, 0, 0, 1).pan, 0.8), 'turned to +y, a sound at +x is on the right');
check(near(audio.spatialize(0, 0, 100, 1).pan, 0) && near(audio.spatialize(0, 0, 200, 1).gain, 1 - 120 * 0.001), 'straight up is centred and attenuated by its height');
audio.listener = L;

// ── one-shots (S_StartSound): nothing before the context exists, then a source per event ──
const BLAST = 'weapons/blastf1a.wav', MENU = 'misc/menu1.wav', FLY = 'weapons/rockfly.wav', HUM = 'weapons/rg_hum.wav';
check([BLAST, MENU, FLY, HUM].every((n) => pak.has('sound/' + n)), 'the sounds the test uses are in the pak');
const ev = (id, ent, chan, name, vol, attn, x, y, z) => [id, 0, ent, chan, name, vol, attn, x, y, z];
await audio.playEvents([ev(1, 5, 1, BLAST, 1, 1, 10, 0, 0)], L);
check(audio.ctx === null && made.length === 0, 'before a gesture unlocks the context, nothing plays and nothing is made');
audio.unlock();
check(audio.ctx instanceof FakeContext && audio.master.gain.value === 0.7 && audio.master.to === audio.ctx.destination, 'unlock makes the context, the master gain at the volume, into the destination');
audio.setVolume(0.4);
check(audio.master.gain.value === 0.4, 'the volume setting moves the master gain');
made.length = 0;
await audio.playEvents([ev(1, 5, 1, BLAST, 1, 1, 0, -200, 0)], L);
let s = started();
let c = chain(s[0]);
check(s.length === 1 && s[0].buffer === await audio.buffer(BLAST) && near(c.g.gain.value, 1 - 120 * 0.001) && near(c.p.pan.value, 0.8) && c.out === audio.master,
  `a blaster shot 200 to the right: one source, gain ${c.g.gain.value.toFixed(3)}, pan 0.8, through the master`);
await audio.playEvents([ev(2, 5, 1, BLAST, 0.5, 1, 0, 0, 0)], L);
check(s[0].stopped && started().length === 1 && near(chain(started()[0]).g.gain.value, 0.5), 'the next sound on the same entity and channel cuts it; the volume scales the gain');
const before = started().length;
await audio.playEvents([ev(3, 5, 0, MENU, 1, 0, null, null, null), ev(4, 5, 0, MENU, 1, 0, null, null, null)], L);
check(started().length === before + 2, 'channel 0 (CHAN_AUTO) never cuts: two more play beside each other');
await audio.playEvents([ev(5, 7, 1, BLAST, 1, 1, 3000, 0, 0)], L);
check(started().length === before + 2, 'a sound out of range makes no source');
await audio.playEvents([ev(6, 7, 1, 'nope/missing.wav', 1, 1, 0, 0, 0)], L);
check(started().length === before + 2 && (await audio.buffer('nope/missing.wav')) === null, 'a sound not in the pak is skipped');
check(!pak.has('sound/player/female/jump1.wav') && (await audio.buffer('player/female/jump1.wav')) !== null && (await audio.buffer('player/female/jump1.wav')).length === (await audio.buffer('player/male/jump1.wav')).length,
  'a female client\'s sexed sound the pak lacks plays the male\'s (S_RegisterSexedSound\'s fallback)');
// play, stopsound and soundinfo (S_Play, S_StopAllSounds, S_SoundInfo_f): a sound at the ear, every one-shot and loop cut, the figures
{
  const n0 = started().length;
  audio.playLocal(BLAST); await tick(); await tick();
  const mine = started().at(-1);
  check(started().length === n0 + 1 && near(chain(mine).g.gain.value, 1) && near(chain(mine).p.pan.value, 0), 'playLocal plays a sound at the ear, full and centred');
  const info = audio.info();
  check(info.started && info.rate === 22050 && info.stereo === 1 && info.decoded >= 2 && info.playing === started().length, `info says the rate, stereo, the sounds decoded and the ones playing (${JSON.stringify(info)})`);
  audio.stopAll();
  check(started().length === 0 && audio.playing.size === 0 && audio.channels.size === 0 && audio.loops.size === 0, 'stopAll cuts every one-shot and clears the channels and the loops');
  check(new Q2Audio().info().started === false, 'before the context exists, not started');
}
// cl_footsteps: a player/step sound is dropped with the switch off, played with it on (CL_EntityEvent's cl_footsteps)
{
  const n0 = started().length;
  audio.footsteps = false;
  await audio.playEvents([ev(20, 5, 3, 'player/step1.wav', 1, 1, 10, 0, 0)], L);
  check(started().length === n0 && pak.has('sound/player/step1.wav'), 'footsteps off, a footstep makes no source');
  audio.footsteps = true;
  await audio.playEvents([ev(21, 5, 3, 'player/step2.wav', 1, 1, 10, 0, 0)], L);
  check(started().length === n0 + 1, 'on, it plays');
}
const decoded = audio.ctx.decoded;
await audio.playEvents([ev(7, 8, 2, BLAST, 1, 1, 0, 0, 0), ev(8, 9, 2, BLAST, 1, 1, 0, 0, 0)], L);
check(audio.ctx.decoded === decoded, 'a sound is decoded once and the buffer kept');
made.length = 0;
audio.playLocal(MENU);
await tick(); await tick();
c = chain(started()[0]);
check(started().length === 1 && c.g.gain.value === 1 && c.p.pan.value === 0, 'a local sound (the menus) is full and centred');

// ── looped sounds (S_AddLoopSounds): one channel per name, the entities summed ──
made.length = 0;
audio.setLoops([[FLY, 50, 0, 0]]);
audio.update(L);
await tick(); await tick();
let loop = audio.loops.get(FLY);
check(audio.loops.size === 1 && loop.src?.loop === true && loop.src.started && loop.src.offset >= 0 && loop.src.offset < 1.5, 'a rocket in flight: one looped source, started somewhere in the sound');
audio.update(L);
check(near(loop.gain.gain.value, 1) && near(loop.pan.pan.value, 0), 'within 80 units it is full and centred');
audio.setLoops([[FLY, 0, -200, 0]]);
audio.update(L);
const g1 = loop.gain.gain.value;
check(near(g1, 1 - 120 * 0.003) && near(loop.pan.pan.value, 0.8), `200 units to the right: ATTN_STATIC's fall-off (${g1.toFixed(3)}), panned right`);
audio.setLoops([[FLY, 0, -200, 0], [FLY, 0, 200, 0]]);
audio.update(L);
check(audio.loops.size === 1 && near(loop.gain.gain.value, 2 * g1) && near(loop.pan.pan.value, 0), 'two rockets with the same sound share the channel: their gains add, their pans cancel');
audio.setLoops(Array.from({ length: 6 }, () => [FLY, 10, 0, 0]));
audio.update(L);
check(near(loop.gain.gain.value, 2), 'six on top of the listener: each side clamped at full scale (gain 2, left plus right)');
audio.setLoops([[FLY, 50, 0, 0], [HUM, 50, 0, 0]]);
audio.update(L);
await tick(); await tick();
check(audio.loops.size === 2 && audio.loops.get(HUM).src?.loop, 'a second sound gets a channel of its own');
audio.setLoops([[HUM, 50, 0, 0]]);
audio.update(L);
check(loop.gain.gain.value === 0 && audio.loops.get(HUM).gain.gain.value > 0 && !loop.src.stopped, 'a loop no frame lists goes silent, its channel kept for the next time');
audio.setLoops([[FLY, 2000, 0, 0]]);
audio.update(L);
check(loop.gain.gain.value === 0, 'out of range, silent');

// ── looped speakers: mixed with the loops at ATTN_STATIC, on and off with the frame ──
audio.setLoops([]);
audio.setSpeakers([[41, 30, 0, 0, FLY, 1], [42, 0, 0, 0, HUM, 0]]);
audio.update(L);
check(near(loop.gain.gain.value, 1) && audio.loops.get(HUM).gain.gain.value === 0, 'a speaker that is on plays its loop; one that is off does not');
audio.setSpeakersOn([42]);
audio.update(L);
check(loop.gain.gain.value === 0 && near(audio.loops.get(HUM).gain.gain.value, 1), 'the frame turns speakers on and off');
audio.setSpeakers([]);

// ── the page hidden and back ──
audio.setLoops([[FLY, 10, 0, 0]]);
audio.update(L);
audio.suspend(true);
check(audio.ctx.suspended === 1 && audio.loopRows.length === 0 && loop.gain.gain.value === 0, 'hidden: the context suspends and the loops fall silent');
audio.suspend(false);
check(audio.ctx.resumed >= 1, 'shown again: the context resumes');
audio.stopLoops();
check(loop.src.stopped && audio.loops.size === 0, 'stopLoops ends every looped source');

// ── music ──
made.length = 0;
audio.setMusicMode('off');
await audio.playMusic(9);
check(audio.music === null && made.length === 0, 'music off: nothing');
audio.setMusicMode('synth');
await audio.playMusic(9);
let oscs = made.filter((n) => n.kind === 'osc');
check(audio.music?.kind === 'synth' && oscs.length >= 5 && oscs.every((o) => o.started), `the drone: ${oscs.length} oscillators playing`);
const token = audio.music;
await audio.playMusic(9);
check(audio.music === token, 'the same track again does not restart');
await audio.playMusic(10);
check(audio.music !== token && audio.music?.kind === 'synth', 'another track replaces it');
audio.stopMusic();
check(audio.music === null, 'stopMusic ends it');
audio.setMusicMode('tracks');
made.length = 0;
await audio.playMusic(9);
check(audio.music?.kind === 'synth', 'in tracks mode with no track file to be had, the drone stands in');
const wav = new File([new Uint8Array(64)], 'Track09.mp3');
audio.setMusicFiles([wav, new File([new Uint8Array(8)], 'readme.txt')]);
await tick(); await tick(); await tick();
check(audio.musicFiles.size === 1 && audio.musicFiles.has('track09'), 'a picked folder: trackNN files by number, case aside, the rest ignored');
const track = sources().find((n) => !n.loop && n.to === audio.musicGain && n.started && !n.stopped);
check(audio.music?.kind === 'track' && !!track && typeof track.onended === 'function', 'the track file plays into the music gain, its end the loop\'s (CDAudio_Update)');
// cd_loopcount and cd_looptrack: the track over again at its end until it has played that many times, then the loop track (no file for
// it here: the drone stands in, as track 11); cd_nocd stops the music and plays none until it is off again
const settle = async () => { for (let i = 0; i < 12; i++) await tick(); };
const ended = (n) => { n.stopped = true; n.onended(); };   // (a source at its end: done, as the browser has it)
audio.loopCount = 2;
ended(track); await settle();
const second = sources().filter((n) => n.to === audio.musicGain && n.started && !n.stopped);
check(audio.music?.kind === 'track' && audio.music.track === 9 && audio.music.plays === 1 && second.length === 1 && second[0] !== track, 'at its end the track plays again (the first of cd_loopcount 2)');
ended(second[0]); await settle();
check(audio.music?.kind === 'synth' && audio.music.track === 11 && audio.music.plays === 2, 'at the second end the loop track plays (11, the drone standing in)');
audio.setNocd(true);
check(audio.music === null && audio.nocd, 'cd_nocd 1 stops the music');
audio.setNocd(false); await settle();
check(audio.music?.track === 11, 'cd_nocd 0 plays the track again');
// the cd word's ways (CD_f): cd play once (nothing at the end), cd loop over and over, pause and resume from the offset, off and on
await audio.playMusic(9, 0, 'once'); await settle();
const once = sources().find((n) => n.to === audio.musicGain && n.started && !n.stopped);
check(audio.music?.how === 'once' && !!once, 'cd play: the track once');
ended(once); await settle();
check(audio.music === null, '... and nothing at its end');
await audio.playMusic(9, 0, 'loop'); await settle();
const looped = sources().find((n) => n.to === audio.musicGain && n.started && !n.stopped);
ended(looped); await settle();
check(audio.music?.track === 9 && audio.music.how === 'loop' && audio.music.plays === 1, 'cd loop: the track again at its end, whatever cd_loopcount says');
audio.ctx.currentTime = (audio.ctx.currentTime ?? 0) + 7;
check(audio.pauseMusic() && audio.music === null && audio.pausedMusic?.track === 9 && audio.pausedMusic.how === 'loop' && Math.abs(audio.pausedMusic.offset - 7) < 1e-6, `cd pause stops the music and keeps where it was (${audio.pausedMusic?.offset} s in)`);
check(!audio.pauseMusic(), 'pause again: nothing playing');
check(audio.resumeMusic(), 'cd resume');
await settle();
const resumed = sources().find((n) => n.to === audio.musicGain && n.started && !n.stopped);
check(audio.music?.track === 9 && audio.music.how === 'loop' && Math.abs(resumed?.offset - 7) < 1e-6 && !audio.resumeMusic(), `... plays the track from where it was (${resumed?.offset} s), looping still; resume again: nothing paused`);
check(audio.musicInfo().playing && audio.musicInfo().looping && audio.musicInfo().track === 9 && audio.musicInfo().tracks === 1, 'cd info says what plays, looping, and the folder\'s tracks');
audio.setEnabled(false);
check(audio.music === null && !audio.enabled && !audio.musicInfo().enabled, 'cd off stops the music');
await audio.playMusic(10); await settle();
check(audio.music === null, '... and plays none');
audio.setEnabled(true); await settle();
check(audio.music?.track === 10, 'cd on plays the track again');
// s_show: each sound started told with its volumes
{
  const shown = [];
  audio.onStart = (name, l, r) => shown.push(`${l} ${r} ${name}`);
  await audio.playEvents([[0, 0, 7, 1, 'weapons/blastf1a.wav', 1, 0, null, null, null]], audio.listener);
  audio.onStart = null;
  check(shown.length === 1 && /^255 255 weapons\/blastf1a\.wav$/.test(shown[0]), `s_show is told the sound with its volumes (${shown[0]})`);
}
audio.loopCount = 4;
await audio.playMusic(9); await settle();
const track2 = sources().find((n) => n.to === audio.musicGain && n.started && !n.stopped);
audio.setMusicVolume(0.25);
check(audio.musicGain.gain.value === 0.25, 'the music volume moves the music gain');
audio.setMusicMode('off');
check(track2?.stopped && audio.music === null, 'music off stops the track');
// a picked folder's track is kept as it plays (src/demostore.js's file store at the page; a map here), and plays from
// there at the next start, when no folder is picked; a track neither picked nor kept falls to the drone
const store = new Map();
audio.setMusicStore({ get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } });
audio.setMusicMode('tracks');   // (track 9 again, with the store this time)
await tick(); await tick(); await tick();
const kept9 = store.get('music/track09');
check(audio.music?.kind === 'track' && store.size === 1 && kept9?.name === 'Track09.mp3' && kept9.bytes instanceof Uint8Array && kept9.bytes.length === 64,
  'the picked track is kept as it plays, under its number, with its name and bytes');
audio.setMusicFiles([]);
audio.stopMusic();
await audio.playMusic(9);
check(audio.music?.kind === 'track' && audio.music.src?.buffer?.bytes === 64 && store.size === 1, 'with no folder picked, the kept track plays from the store');
await audio.playMusic(10);
check(audio.music?.kind === 'synth' && store.size === 1, 'a track neither picked nor kept: the drone, and nothing kept');
audio.setMusicMode('off');

console.log(failed ? `${failed} failure(s)` : 'all good');
process.exit(failed ? 1 : 0);
