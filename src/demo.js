// demo.js – a Quake 2 demo (.dm2) read as the client read the server's messages (cl_parse.c, cl_ents.c):
// the server data, the configstrings, the baselines, then a frame a block with its player state and the
// entities that changed, the sounds, the temporary entities and the prints of each.
//
// A .dm2 is the server's message stream as it came, each block an int32 length and that many bytes, -1 at
// the end. `parseDemo` reads the whole file into frames up front (the demo's 640 blocks are 138 KB); a
// block's messages must consume it exactly, which is the check that the protocol is read right.
// `DemoPlayer` gives the view and the entities at a time between two frames, moved by the fraction as
// CL_AddPacketEntities and CL_CalcViewValues lerped them, and the events of the frames reached. Nothing here
// touches the DOM or the database: the page sets its view from the player's row, asks the frame's faces of
// the SQL as it does for its own game, and paints the entities from the rows this makes.

import { ANORMS } from './md2.js';

// the message types (qcommon.h's svc_ops_e; protocol 31, the 3.14 demo's)
export const SVC = { bad: 0, muzzleflash: 1, muzzleflash2: 2, temp_entity: 3, layout: 4, inventory: 5, nop: 6, disconnect: 7, reconnect: 8,
  sound: 9, print: 10, stufftext: 11, serverdata: 12, configstring: 13, spawnbaseline: 14, centerprint: 15, download: 16,
  playerinfo: 17, packetentities: 18, deltapacketentities: 19, frame: 20 };
// the configstrings' layout (q_shared.h): the models from 32, the sounds from 288, the images from 544, the lights from 800
export const CS = { NAME: 0, CDTRACK: 1, SKY: 2, SKYAXIS: 3, SKYROTATE: 4, STATUSBAR: 5, MAXCLIENTS: 30, MAPCHECKSUM: 31,
  MODELS: 32, SOUNDS: 288, IMAGES: 544, LIGHTS: 800, ITEMS: 1056, PLAYERSKINS: 1312, MAX: 2048 };
// the entity delta bits (U_*)
const U = { ORIGIN1: 1 << 0, ORIGIN2: 1 << 1, ANGLE2: 1 << 2, ANGLE3: 1 << 3, FRAME8: 1 << 4, EVENT: 1 << 5, REMOVE: 1 << 6, MOREBITS1: 1 << 7,
  NUMBER16: 1 << 8, ORIGIN3: 1 << 9, ANGLE1: 1 << 10, MODEL: 1 << 11, RENDERFX8: 1 << 12, EFFECTS8: 1 << 14, MOREBITS2: 1 << 15,
  SKIN8: 1 << 16, FRAME16: 1 << 17, RENDERFX16: 1 << 18, EFFECTS16: 1 << 19, MODEL2: 1 << 20, MODEL3: 1 << 21, MODEL4: 1 << 22, MOREBITS3: 1 << 23,
  OLDORIGIN: 1 << 24, SKIN16: 1 << 25, SOUND: 1 << 26, SOLID: 1 << 27 };
// the player state's (PS_*)
const PS = { M_TYPE: 1, M_ORIGIN: 2, M_VELOCITY: 4, M_TIME: 8, M_FLAGS: 16, M_GRAVITY: 32, M_DELTA_ANGLES: 64, VIEWOFFSET: 128, VIEWANGLES: 256,
  KICKANGLES: 512, BLEND: 1024, FOV: 2048, WEAPONINDEX: 4096, WEAPONFRAME: 8192, RDFLAGS: 16384 };
const SND = { VOLUME: 1, ATTENUATION: 2, POS: 4, ENT: 8, OFFSET: 16 };
// the temporary entities (temp_event_t, 3.14's) → this port's effect kinds (src/effects.js) and how each is read
const TE = { GUNSHOT: 0, BLOOD: 1, BLASTER: 2, RAILTRAIL: 3, SHOTGUN: 4, EXPLOSION1: 5, EXPLOSION2: 6, ROCKET_EXPLOSION: 7, GRENADE_EXPLOSION: 8,
  SPARKS: 9, SPLASH: 10, BUBBLETRAIL: 11, SCREEN_SPARKS: 12, SHIELD_SPARKS: 13, BULLET_SPARKS: 14, LASER_SPARKS: 15, PARASITE_ATTACK: 16,
  ROCKET_EXPLOSION_WATER: 17, GRENADE_EXPLOSION_WATER: 18, MEDIC_CABLE_ATTACK: 19, BFG_EXPLOSION: 20, BFG_BIGEXPLOSION: 21, BOSSTPORT: 22, BFG_LASER: 23 };
const TE_KIND = { 0: 1, 1: 3, 2: 6, 3: 4, 4: 11, 5: 2, 6: 9, 7: 2, 8: 9, 9: 10, 10: 7, 11: 14, 12: 10, 13: 10, 14: 10, 15: 10, 16: 16, 17: 2, 18: 9, 19: 13, 20: 8, 21: 8, 22: 5, 23: 12 };
// the weapon muzzle flashes (MZ_*): the sound the client played for each, and its light
const MZ_SOUND = ['weapons/blastf1a.wav', 'weapons/machgf1b.wav', 'weapons/shotgf1b.wav', 'weapons/machgf1b.wav', 'weapons/machgf1b.wav', 'weapons/machgf1b.wav',
  'weapons/railgf1a.wav', 'weapons/rocklf1a.wav', 'weapons/grenlf1a.wav', 'weapons/grenlf1a.wav', 'weapons/grenlf1a.wav', null, 'weapons/bfg__f1y.wav',
  'weapons/sshotf1b.wav', 'weapons/hyprbf1a.wav', null];
/** The monsters' muzzle flashes (MZ2_*): the sound CL_ParseMuzzleFlash2 played, by flash number (the demo's monsters and the base unit's). */
export function mz2Sound(n, random = Math.random) {
  if (n >= 1 && n <= 3) return 'tank/tnkatck3.wav';
  if (n >= 4 && n <= 22) return `tank/tnkatk2${'abcde'[Math.floor(random() * 5)]}.wav`;
  if (n >= 23 && n <= 25) return 'tank/tnkatck1.wav';
  if (n >= 26 && n <= 38) return 'infantry/infatck1.wav';
  if ((n >= 39 && n <= 41) || (n >= 80 && n <= 100)) return ['soldier/solatck2.wav', 'soldier/solatck1.wav', 'soldier/solatck3.wav'][(n - 39) % 3 === 0 ? 0 : (n - 39) % 3 === 1 ? 1 : 2];
  if (n >= 42 && n <= 49) return 'gunner/gunatck2.wav';
  if (n >= 50 && n <= 53) return 'gunner/gunatck3.wav';
  if (n === 54) return 'chick/chkatck2.wav';
  if (n === 55 || n === 56) return 'flyer/flyatck3.wav';
  if (n === 57) return 'medic/medatck1.wav';
  if (n === 58) return 'gladiator/railgun.wav';
  if (n === 59) return 'hover/hovatck1.wav';
  if (n === 60 || (n >= 61 && n <= 66) || (n >= 70 && n <= 74)) return 'infantry/infatck1.wav';
  if ((n >= 67 && n <= 69) || (n >= 75 && n <= 78)) return 'tank/rocket.wav';
  if (n === 79) return 'floater/fltatck1.wav';
  return null;
}

/** MSG_Read*: the message's bytes, little-endian, as qcommon's reader gave them. */
class Reader {
  constructor(bytes, pos = 0, end = bytes.length) { this.b = bytes; this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.pos = pos; this.end = end; }
  byte() { if (this.pos >= this.end) throw new Error('read past the block'); return this.b[this.pos++]; }
  char() { const v = this.byte(); return v > 127 ? v - 256 : v; }
  short() { const v = this.dv.getInt16(this.pos, true); this.pos += 2; return v; }
  long() { const v = this.dv.getInt32(this.pos, true); this.pos += 4; return v; }
  string() { let s = ''; for (;;) { const c = this.byte(); if (c === 0) break; s += String.fromCharCode(c); } return s; }
  coord() { return this.short() * 0.125; }
  pos3() { return [this.coord(), this.coord(), this.coord()]; }
  angle() { return this.char() * (360 / 256); }
  angle16() { return this.short() * (360 / 65536); }
  dir() { const i = this.byte(); return i < 162 ? [ANORMS[i * 3], ANORMS[i * 3 + 1], ANORMS[i * 3 + 2]] : [0, 0, 1]; }
  bytes(n) { const v = this.b.subarray(this.pos, this.pos + n); this.pos += n; return v; }
}

const nullState = () => ({ number: 0, origin: [0, 0, 0], angles: [0, 0, 0], oldOrigin: [0, 0, 0], modelindex: 0, modelindex2: 0, modelindex3: 0, modelindex4: 0,
  frame: 0, skin: 0, effects: 0, renderfx: 0, solid: 0, sound: 0, event: 0 });
const copyState = (s) => ({ ...s, origin: s.origin.slice(), angles: s.angles.slice(), oldOrigin: s.oldOrigin.slice() });

/** CL_ParseEntityBits: the bits and the entity number. */
function entityBits(r) {
  let total = r.byte();
  if (total & U.MOREBITS1) total |= r.byte() << 8;
  if (total & U.MOREBITS2) total |= r.byte() << 16;
  if (total & U.MOREBITS3) total |= r.byte() << 24;
  const number = total & U.NUMBER16 ? r.short() : r.byte();
  return { bits: total, number };
}

/** CL_ParseDelta: `from` with what the bits say changed. */
function parseDelta(r, from, number, bits) {
  const to = copyState(from);
  to.number = number;
  to.event = 0;
  if (bits & U.MODEL) to.modelindex = r.byte();
  if (bits & U.MODEL2) to.modelindex2 = r.byte();
  if (bits & U.MODEL3) to.modelindex3 = r.byte();
  if (bits & U.MODEL4) to.modelindex4 = r.byte();
  if (bits & U.FRAME8) to.frame = r.byte();
  if (bits & U.FRAME16) to.frame = r.short();
  if ((bits & (U.SKIN8 | U.SKIN16)) === (U.SKIN8 | U.SKIN16)) to.skin = r.long();
  else if (bits & U.SKIN8) to.skin = r.byte();
  else if (bits & U.SKIN16) to.skin = r.short();
  if ((bits & (U.EFFECTS8 | U.EFFECTS16)) === (U.EFFECTS8 | U.EFFECTS16)) to.effects = r.long();
  else if (bits & U.EFFECTS8) to.effects = r.byte();
  else if (bits & U.EFFECTS16) to.effects = r.short();
  if ((bits & (U.RENDERFX8 | U.RENDERFX16)) === (U.RENDERFX8 | U.RENDERFX16)) to.renderfx = r.long();
  else if (bits & U.RENDERFX8) to.renderfx = r.byte();
  else if (bits & U.RENDERFX16) to.renderfx = r.short();
  if (bits & U.ORIGIN1) to.origin[0] = r.coord();
  if (bits & U.ORIGIN2) to.origin[1] = r.coord();
  if (bits & U.ORIGIN3) to.origin[2] = r.coord();
  if (bits & U.ANGLE1) to.angles[0] = r.angle();
  if (bits & U.ANGLE2) to.angles[1] = r.angle();
  if (bits & U.ANGLE3) to.angles[2] = r.angle();
  if (bits & U.OLDORIGIN) to.oldOrigin = r.pos3();
  if (bits & U.SOUND) to.sound = r.byte();
  if (bits & U.EVENT) to.event = r.byte();
  if (bits & U.SOLID) to.solid = r.short();
  return to;
}

/** CL_ParsePlayerstate: the old frame's state with what the flags say changed. */
function parsePlayerstate(r, old) {
  const ps = old ? { ...old, origin: old.origin.slice(), velocity: old.velocity.slice(), viewoffset: old.viewoffset.slice(), viewangles: old.viewangles.slice(),
    kickAngles: old.kickAngles.slice(), gunOffset: old.gunOffset.slice(), gunAngles: old.gunAngles.slice(), blend: old.blend.slice(), stats: old.stats.slice() }
    : { pmType: 0, origin: [0, 0, 0], velocity: [0, 0, 0], pmTime: 0, pmFlags: 0, gravity: 0, deltaAngles: [0, 0, 0], viewoffset: [0, 0, 0], viewangles: [0, 0, 0],
      kickAngles: [0, 0, 0], gunindex: 0, gunframe: 0, gunOffset: [0, 0, 0], gunAngles: [0, 0, 0], blend: [0, 0, 0, 0], fov: 90, rdflags: 0, stats: new Array(32).fill(0) };
  const flags = r.short();
  if (flags & PS.M_TYPE) ps.pmType = r.byte();
  if (flags & PS.M_ORIGIN) ps.origin = [r.short() * 0.125, r.short() * 0.125, r.short() * 0.125];
  if (flags & PS.M_VELOCITY) ps.velocity = [r.short() * 0.125, r.short() * 0.125, r.short() * 0.125];
  if (flags & PS.M_TIME) ps.pmTime = r.byte();
  if (flags & PS.M_FLAGS) ps.pmFlags = r.byte();
  if (flags & PS.M_GRAVITY) ps.gravity = r.short();
  if (flags & PS.M_DELTA_ANGLES) ps.deltaAngles = [r.short(), r.short(), r.short()];
  if (flags & PS.VIEWOFFSET) ps.viewoffset = [r.char() * 0.25, r.char() * 0.25, r.char() * 0.25];
  if (flags & PS.VIEWANGLES) ps.viewangles = [r.angle16(), r.angle16(), r.angle16()];
  if (flags & PS.KICKANGLES) ps.kickAngles = [r.char() * 0.25, r.char() * 0.25, r.char() * 0.25];
  if (flags & PS.WEAPONINDEX) ps.gunindex = r.byte();
  if (flags & PS.WEAPONFRAME) { ps.gunframe = r.byte(); ps.gunOffset = [r.char() * 0.25, r.char() * 0.25, r.char() * 0.25]; ps.gunAngles = [r.char() * 0.25, r.char() * 0.25, r.char() * 0.25]; }
  if (flags & PS.BLEND) ps.blend = [r.byte() / 255, r.byte() / 255, r.byte() / 255, r.byte() / 255];
  if (flags & PS.FOV) ps.fov = r.byte();
  if (flags & PS.RDFLAGS) ps.rdflags = r.byte();
  const statbits = r.long();
  for (let i = 0; i < 32; i++) if (statbits & (1 << i)) ps.stats[i] = r.short();
  return ps;
}

/** CL_ParseTEnt: the temporary entity as this port's effect row [id, kind, x, y, z, x2, y2, z2, n]. */
function parseTempEntity(r, id) {
  const type = r.byte();
  const kind = TE_KIND[type] ?? 0;
  let pos, dir, pos2, n = 0, cnt, color, ent;
  switch (type) {
    case TE.BLOOD: case TE.GUNSHOT: case TE.SPARKS: case TE.BULLET_SPARKS: case TE.SCREEN_SPARKS: case TE.SHIELD_SPARKS: case TE.SHOTGUN: case TE.BLASTER:
      pos = r.pos3(); dir = r.dir(); n = type === TE.BLOOD ? 30 : 0; return [id, kind, ...pos, ...dir, n];
    case TE.SPLASH: case TE.LASER_SPARKS:
      cnt = r.byte(); pos = r.pos3(); dir = r.dir(); color = r.byte(); return [id, kind, ...pos, ...dir, type === TE.SPLASH ? (cnt << 4) | (color & 7) : cnt];
    case TE.RAILTRAIL: case TE.BUBBLETRAIL: case TE.BFG_LASER:
      pos = r.pos3(); pos2 = r.pos3(); return [id, kind, ...pos, ...pos2, 0];
    case TE.EXPLOSION2: case TE.GRENADE_EXPLOSION: case TE.GRENADE_EXPLOSION_WATER: case TE.ROCKET_EXPLOSION: case TE.ROCKET_EXPLOSION_WATER:
    case TE.EXPLOSION1: case TE.BFG_EXPLOSION: case TE.BFG_BIGEXPLOSION: case TE.BOSSTPORT:
      pos = r.pos3(); return [id, kind, ...pos, 0, 0, 0, 0];
    case TE.PARASITE_ATTACK: case TE.MEDIC_CABLE_ATTACK:
      ent = r.short(); pos = r.pos3(); pos2 = r.pos3(); return [id, kind, ...pos, ...pos2, ent];
    default: throw new Error(`temp entity ${type} unknown`);
  }
}

/**
 * The whole demo: { protocol, levelname, playernum, configstrings, models, sounds, images, lights, baselines,
 * frames: [{ serverframe, time, ps, ents: Map(number → state), sounds, fx, prints, centerprints, flashes }] }.
 * Every block must be consumed to its last byte, or the protocol was misread.
 */
export function parseDemo(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const demo = { protocol: 0, servercount: 0, attractloop: 0, gamedir: '', playernum: 0, levelname: '', configstrings: new Array(CS.MAX).fill(''), baselines: new Map(), frames: [], blocks: 0 };
  let cur = null;      // the frame being read (its entities, events)
  let eventId = 0;
  const events = () => ({ sounds: [], fx: [], prints: [], centerprints: [], flashes: [], stuffs: [], configs: [] });
  let pending = events();   // the events read before the next frame message (they belong with it)
  let off = 0;
  while (off + 4 <= bytes.length) {
    const len = dv.getInt32(off, true);
    if (len === -1) break;
    const r = new Reader(bytes, off + 4, off + 4 + len);
    demo.blocks++;
    while (r.pos < r.end) {
      const cmd = r.byte();
      switch (cmd) {
        case SVC.nop: break;
        case SVC.disconnect: case SVC.reconnect: break;
        case SVC.serverdata:
          demo.protocol = r.long(); demo.servercount = r.long(); demo.attractloop = r.byte(); demo.gamedir = r.string(); demo.playernum = r.short(); demo.levelname = r.string();
          break;
        case SVC.configstring: { const i = r.short(); const s = r.string(); if (i >= 0 && i < CS.MAX) demo.configstrings[i] = s; pending.configs.push([i, s]); break; }
        case SVC.spawnbaseline: { const { bits, number } = entityBits(r); demo.baselines.set(number, parseDelta(r, nullState(), number, bits)); break; }
        case SVC.stufftext: pending.stuffs.push(r.string()); break;
        case SVC.print: { const level = r.byte(); pending.prints.push([level, r.string()]); break; }
        case SVC.centerprint: pending.centerprints.push(r.string()); break;
        case SVC.layout: r.string(); break;
        case SVC.inventory: for (let i = 0; i < 256; i++) r.short(); break;
        case SVC.muzzleflash: { const ent = r.short(); const weapon = r.byte(); pending.flashes.push({ ent, weapon, monster: false }); break; }
        case SVC.muzzleflash2: { const ent = r.short(); const flash = r.byte(); pending.flashes.push({ ent, flash, monster: true }); break; }
        case SVC.temp_entity: pending.fx.push(parseTempEntity(r, ++eventId)); break;
        case SVC.sound: {
          const flags = r.byte(); const num = r.byte();
          const vol = flags & SND.VOLUME ? r.byte() / 255 : 1, attn = flags & SND.ATTENUATION ? r.byte() / 64 : 1;
          const ofs = flags & SND.OFFSET ? r.byte() / 1000 : 0;
          let ent = null, chan = 0;
          if (flags & SND.ENT) { const c = r.short(); ent = c >> 3; chan = c & 7; }
          const pos = flags & SND.POS ? r.pos3() : null;
          pending.sounds.push({ id: ++eventId, num, vol, attn, ofs, ent, chan, pos });
          break;
        }
        case SVC.download: { const size = r.short(); r.byte(); if (size > 0) r.bytes(size); break; }
        case SVC.frame: {
          const serverframe = r.long(); const deltaframe = r.long();
          if (demo.protocol !== 26) r.byte();   // surpressCount (the 3.00 demos had none)
          const alen = r.byte(); const areabits = r.bytes(alen).slice();
          if (r.byte() !== SVC.playerinfo) throw new Error(`frame ${serverframe}: no playerinfo`);
          const old = deltaframe !== -1 ? demo.frames.find((f) => f.serverframe === deltaframe) : null;
          const ps = parsePlayerstate(r, old?.ps);
          if (r.byte() !== SVC.packetentities) throw new Error(`frame ${serverframe}: no packetentities`);
          const ents = new Map(old ? [...old.ents].map(([k, v]) => [k, v]) : []);
          for (;;) {
            const { bits, number } = entityBits(r);
            if (number === 0) break;
            if (bits & U.REMOVE) { ents.delete(number); continue; }
            const from = ents.get(number) ?? demo.baselines.get(number) ?? nullState();
            ents.set(number, parseDelta(r, from, number, bits));
          }
          cur = { serverframe, deltaframe, time: 0, areabits, ps, ents, ...pending };
          pending = events();
          demo.frames.push(cur);
          break;
        }
        default: throw new Error(`message ${cmd} unknown at block ${demo.blocks}, byte ${r.pos - 1 - (off + 4)}`);
      }
    }
    if (r.pos !== r.end) throw new Error(`block ${demo.blocks} not consumed exactly (${r.pos - (off + 4)} of ${len})`);
    off += 4 + len;
  }
  // the clock: the first frame at zero, a server frame a tenth of a second (cl.frame.servertime = serverframe * 100)
  const t0 = demo.frames[0]?.serverframe ?? 0;
  for (const f of demo.frames) f.time = (f.serverframe - t0) * 0.1;
  demo.models = demo.configstrings.slice(CS.MODELS, CS.MODELS + 256);
  // the player's sexed sounds (*death1.wav: S_RegisterSexedSound) are the male's, as the game here plays them
  demo.sounds = demo.configstrings.slice(CS.SOUNDS, CS.SOUNDS + 256).map((s) => (s[0] === '*' ? `player/male/${s.slice(1)}` : s));
  demo.images = demo.configstrings.slice(CS.IMAGES, CS.IMAGES + 256);
  demo.lights = demo.configstrings.slice(CS.LIGHTS, CS.LIGHTS + 256);
  demo.map = demo.models[1] ?? '';
  return demo;
}

const lerp = (a, b, f) => a + (b - a) * f;
const lerpAngle = (a, b, f) => { let d = b - a; if (d > 180) d -= 360; if (d < -180) d += 360; return a + d * f; };

/**
 * The demo as it plays: `at(t)` is the view and the entities at `t` seconds from the start, lerped between the
 * frame then and the next (an entity in both; one just come snaps), with the events of the frames reached
 * since the last call, each once. `modelId(name)` maps the demo's model names to the page's (res.byName).
 */
export class DemoPlayer {
  constructor(demo, { modelId = () => null } = {}) {
    this.demo = demo;
    this.modelId = modelId;
    this.frames = demo.frames;
    this.duration = this.frames.length ? this.frames[this.frames.length - 1].time : 0;
    this.played = -1;      // the last frame whose events were given
    this.lightsAt = demo.lights.slice();
  }

  /** The frame index at `t` and the fraction toward the next. */
  index(t) {
    const n = this.frames.length;
    if (!n) return { i: 0, frac: 0 };
    let i = Math.max(0, Math.min(n - 1, Math.floor(t / 0.1)));
    while (i + 1 < n && this.frames[i + 1].time <= t) i++;
    while (i > 0 && this.frames[i].time > t) i--;
    const next = this.frames[i + 1];
    const frac = next ? Math.max(0, Math.min(1, (t - this.frames[i].time) / (next.time - this.frames[i].time))) : 0;
    return { i, frac };
  }

  get finished() { return this.played >= this.frames.length - 1; }

  /**
   * At `t`: { i, frac, ps, view: { x, y, z, viewZ, yaw, pitch, roll, fov, blend, rdflags, gunindex, gunframe, stats },
   * ents: decodeFrame's entity rows for the alias models and sprites in view, brushes: [{ name, origin, angles, frame }],
   * loops: [name, x, y, z], lights: Float32Array(64), events: { sounds, fx, prints, centerprints, flashes } of the frames reached }.
   */
  at(t) {
    const { i, frac } = this.index(t);
    const f = this.frames[i], g = this.frames[i + 1] ?? f;
    const ps = f.ps, qs = g.ps;
    // the events of every frame reached since the last call: played once
    const events = { sounds: [], fx: [], prints: [], centerprints: [], flashes: [], configs: [] };
    for (let k = this.played + 1; k <= i; k++) {
      const fr = this.frames[k];
      for (const key of Object.keys(events)) events[key].push(...fr[key]);
      for (const [idx, s] of fr.configs) if (idx >= CS.LIGHTS && idx < CS.LIGHTS + 256) this.lightsAt[idx - CS.LIGHTS] = s;
    }
    this.played = Math.max(this.played, i);
    const origin = [0, 1, 2].map((k) => lerp(ps.origin[k], qs.origin[k], frac));
    const vofs = [0, 1, 2].map((k) => lerp(ps.viewoffset[k], qs.viewoffset[k], frac));
    const ang = [0, 1, 2].map((k) => lerpAngle(ps.viewangles[k], qs.viewangles[k], frac) + lerp(ps.kickAngles[k], qs.kickAngles[k], frac));
    const view = { x: origin[0], y: origin[1], z: origin[2], viewZ: origin[2] + vofs[2], pitch: ang[0], yaw: ang[1], roll: ang[2], fov: ps.fov || 90,
      blend: ps.blend, rdflags: ps.rdflags, gunindex: ps.gunindex, gunframe: ps.gunframe, stats: ps.stats, time: t };
    // the entities: lerped between the frames they are in both of (CL_AddPacketEntities), the player's own left out
    const self = this.demo.playernum + 1;
    const ents = [], brushes = [], loops = [];
    for (const [num, s] of f.ents) {
      if (num === self) continue;
      const n = g.ents.get(num);
      const o = n && Math.hypot(n.origin[0] - s.origin[0], n.origin[1] - s.origin[1], n.origin[2] - s.origin[2]) < 512
        ? [0, 1, 2].map((k) => lerp(s.origin[k], n.origin[k], frac)) : s.origin.slice();
      const a = n ? [0, 1, 2].map((k) => lerpAngle(s.angles[k], n.angles[k], frac)) : s.angles.slice();
      const name = this.demo.models[s.modelindex] ?? '';
      if (s.sound) { const snd = this.demo.sounds[s.sound]; if (snd) loops.push([snd, o[0], o[1], o[2]]); }
      if (!name) continue;
      if (name[0] === '*') { brushes.push({ name, origin: o, angles: a, frame: s.frame, effects: s.effects, number: num }); continue; }
      const mid = this.modelId(name);
      if (!mid) continue;
      const kind = name.endsWith('.sp2') ? 'S' : 'M';
      // [id, model, frame, skin, x, y, z, pitch, yaw, roll, effects, alpha, kind, renderfx] as decodeFrame lays a row out
      ents.push([num, mid, s.frame, s.skin, o[0], o[1], o[2], a[0], a[1], a[2], s.effects, s.renderfx & 32 ? 1 : 0, kind, s.renderfx]);
    }
    const lights = new Float32Array(64);
    for (let k = 0; k < 64; k++) { const p = this.lightsAt[k]; if (p) lights[k] = (p.charCodeAt(Math.floor(t * 10) % p.length) - 97) / 12.5; }
    return { i, frac, ps, view, ents, brushes, loops, lights, events, frame: f };
  }

  /**
   * The sounds of the events as audio.playEvents' rows ([id, 0, ent, chan, name, vol, attn, x, y, z]): a sound with no
   * position plays where its entity is (the frame's state, or the view for the player); a muzzle flash is its weapon's
   * sound at the entity, and a light for the frame (fx 15).
   */
  soundRows(events, frame, view, random = Math.random) {
    const rows = [], fx = [];
    const where = (ent) => {
      if (ent === this.demo.playernum + 1) return [view.x, view.y, view.z];
      const s = frame.ents.get(ent); return s ? s.origin : [view.x, view.y, view.z];
    };
    for (const s of events.sounds) {
      const name = this.demo.sounds[s.num];
      if (!name) continue;
      const p = s.pos ?? where(s.ent ?? this.demo.playernum + 1);
      rows.push([s.id, 0, s.ent, s.chan, name, s.vol, s.attn, p[0], p[1], p[2]]);
    }
    for (const m of events.flashes) {
      const p = where(m.ent);
      const silenced = !m.monster && (m.weapon & 128) !== 0;
      const name = m.monster ? mz2Sound(m.flash, random) : MZ_SOUND[m.weapon & 127] ?? null;
      if (name) rows.push([0, 0, m.ent, 1, name, silenced ? 0.2 : 1, 1, p[0], p[1], p[2]]);
      fx.push([0, 15, p[0], p[1], p[2] + 16, 0, 0, 0, (silenced ? 100 : 200) + Math.floor(random() * 32)]);
    }
    return { rows, fx };
  }
}
