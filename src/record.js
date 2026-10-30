// record.js – a game recorded as a Quake 2 demo (.dm2): the frame's rows written as the server's messages
// (SV_WriteFrameToClient, SV_EmitPacketEntities, SV_WritePlayerstateToClient, MSG_WriteDeltaEntity), so a game
// played here plays back in src/demo.js and in Quake 2 itself.
//
// CL_Record_f wrote the header: svc_serverdata, the configstrings and the baselines in blocks, then
// "precache". The server's frames followed as they came, each block an int32 length and its bytes, -1 at the
// end. The recorder writes the same: the configstrings it has at the start (the map, the sky, the status bar,
// the item names), a model's, a sound's or an image's configstring the first time something uses it (as
// SV_FindIndex broadcast one for an index made after the load), a baseline the first time an entity shows, and
// a block a server frame (a tenth of a second: every other tic; the tic between folds its sounds and effects
// into the next) with the frame's sounds, temporary entities and prints, the player state as a delta from the
// last frame's and the entities as deltas from the last frame's or their baselines. Entity numbers are the
// game's ids made compact (the player is 1, as the first client's edict); a model, sound or image past the
// protocol's 255 is dropped. A block stays under MAX_MSGLEN (1400 bytes): the entities that do not fit a
// frame wait for the next. Nothing here touches the DOM or the database: the page feeds the Q2_TIC row and
// decodeFrame's rows of each tic.

import { ANORMS } from './md2.js';
import { SVC, CS } from './demo.js';
import { WEAPONS, ITEMS, AMMO_ICONS, ARMOR_ICONS, TIMER_ICONS } from './gamedata.js';
import { viewFrameLerp } from './hud.js';

export const PROTOCOL = 34;      // the released Quake 2's (3.20); the 3.14 demo's own are 31
export const MAX_MSGLEN = 1400;  // a block's most (qcommon.h): the client reads a demo block into a buffer that size

// the entity delta bits (U_*) and the player state's (PS_*), as src/demo.js reads them
const U = { ORIGIN1: 1 << 0, ORIGIN2: 1 << 1, ANGLE2: 1 << 2, ANGLE3: 1 << 3, FRAME8: 1 << 4, EVENT: 1 << 5, REMOVE: 1 << 6, MOREBITS1: 1 << 7,
  NUMBER16: 1 << 8, ORIGIN3: 1 << 9, ANGLE1: 1 << 10, MODEL: 1 << 11, RENDERFX8: 1 << 12, EFFECTS8: 1 << 14, MOREBITS2: 1 << 15,
  SKIN8: 1 << 16, FRAME16: 1 << 17, RENDERFX16: 1 << 18, EFFECTS16: 1 << 19, MODEL2: 1 << 20, MODEL3: 1 << 21, MODEL4: 1 << 22, MOREBITS3: 1 << 23,
  OLDORIGIN: 1 << 24, SKIN16: 1 << 25, SOUND: 1 << 26, SOLID: 1 << 27 };
const PS = { M_TYPE: 1, M_ORIGIN: 2, M_VELOCITY: 4, M_TIME: 8, M_FLAGS: 16, M_GRAVITY: 32, M_DELTA_ANGLES: 64, VIEWOFFSET: 128, VIEWANGLES: 256,
  KICKANGLES: 512, BLEND: 1024, FOV: 2048, WEAPONINDEX: 4096, WEAPONFRAME: 8192, RDFLAGS: 16384 };
const SND = { VOLUME: 1, ATTENUATION: 2, POS: 4, ENT: 8 };
const PM = { NORMAL: 0, DEAD: 2, FREEZE: 4 };
const RDF_UNDERWATER = 1;
const RF_TRANSLUCENT = 32;
/** The stats' slots (q_shared.h's STAT_*). */
const STAT = { HEALTH_ICON: 0, HEALTH: 1, AMMO_ICON: 2, AMMO: 3, ARMOR_ICON: 4, ARMOR: 5, SELECTED_ICON: 6, PICKUP_ICON: 7, PICKUP_STRING: 8,
  TIMER_ICON: 9, TIMER: 10, HELPICON: 11, SELECTED_ITEM: 12, LAYOUTS: 13, FRAGS: 14, FLASHES: 15 };
/** This port's effect kinds (src/effects.js) as the temporary entities the client read (temp_event_t), with how each is written. */
const TE = { GUNSHOT: 0, BLOOD: 1, BLASTER: 2, RAILTRAIL: 3, SHOTGUN: 4, ROCKET_EXPLOSION: 7, GRENADE_EXPLOSION: 8, SPARKS: 9, SPLASH: 10,
  BUBBLETRAIL: 11, LASER_SPARKS: 15, PARASITE_ATTACK: 16, BFG_EXPLOSION: 20, BFG_BIGEXPLOSION: 21, BOSSTPORT: 22, BFG_LASER: 23 };
const KIND_TE = { 1: TE.GUNSHOT, 11: TE.SHOTGUN, 3: TE.BLOOD, 6: TE.BLASTER, 2: TE.ROCKET_EXPLOSION, 9: TE.GRENADE_EXPLOSION, 4: TE.RAILTRAIL,
  5: TE.BOSSTPORT, 7: TE.SPLASH, 8: TE.BFG_EXPLOSION, 18: TE.BFG_BIGEXPLOSION, 10: TE.LASER_SPARKS, 12: TE.BFG_LASER, 14: TE.BUBBLETRAIL, 16: TE.PARASITE_ATTACK };
const SPARKS_DEFAULT = (6 << 8) | 0xe0;   // kind 10 with n = 0: six sparks of 0xe0 (TE_SPARKS)

/** g_spawn.c's single_statusbar: the layout the client draws the status bar from (CS_STATUSBAR). */
export const STATUSBAR = 'yb -24 xv 0 hnum xv 50 pic 0 if 2 xv 100 anum xv 150 pic 2 endif if 4 xv 200 rnum xv 250 pic 4 endif '
  + 'if 6 xv 296 pic 6 endif yb -50 if 7 xv 0 pic 7 xv 26 yb -42 stat_string 8 yb -50 endif if 9 xv 262 num 2 10 xv 296 pic 9 endif if 11 xv 148 pic 11 endif';

// ── MD4 (RFC 1320), as qcommon/md4.c: CS_MAPCHECKSUM is the map file's digest folded to one word ──────────
const F = (x, y, z) => (x & y) | (~x & z), G = (x, y, z) => (x & y) | (x & z) | (y & z), H = (x, y, z) => x ^ y ^ z;
const rot = (x, s) => (x << s) | (x >>> (32 - s));
/** The MD4 digest of `bytes`: four little-endian words. */
export function md4(bytes) {
  const len = bytes.length;
  const padded = new Uint8Array(((len + 8) >> 6) + 1 << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, (len << 3) >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(len / 0x20000000), true);
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  const X = new Uint32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) X[i] = dv.getUint32(off + i * 4, true);
    const aa = a, bb = b, cc = c, dd = d;
    const r1 = (k, s) => { a = rot((a + F(b, c, d) + X[k]) | 0, s); [a, b, c, d] = [d, a, b, c]; };
    const r2 = (k, s) => { a = rot((a + G(b, c, d) + X[k] + 0x5a827999) | 0, s); [a, b, c, d] = [d, a, b, c]; };
    const r3 = (k, s) => { a = rot((a + H(b, c, d) + X[k] + 0x6ed9eba1) | 0, s); [a, b, c, d] = [d, a, b, c]; };
    for (let i = 0; i < 16; i++) r1(i, [3, 7, 11, 19][i & 3]);
    for (let i = 0; i < 16; i++) r2((i & 3) * 4 + (i >> 2), [3, 5, 9, 13][i & 3]);
    for (let i = 0; i < 16; i++) r3([0, 2, 1, 3][i >> 2] + [0, 8, 4, 12][i & 3], [3, 9, 11, 15][i & 3]);
    a = (a + aa) | 0; b = (b + bb) | 0; c = (c + cc) | 0; d = (d + dd) | 0;
  }
  return [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
}
/** The MD4 digest as its hex string (the RFC's test vectors read so). */
export const md4hex = (bytes) => md4(bytes).map((w) => [0, 8, 16, 24].map((s) => ((w >>> s) & 255).toString(16).padStart(2, '0')).join('')).join('');
/** Com_BlockChecksum: the digest's four words xored, as CM_LoadMap took the map's checksum (an int, as "%i" printed it). */
export const blockChecksum = (bytes) => { const [a, b, c, d] = md4(bytes); return (a ^ b ^ c ^ d) | 0; };

/** DirToByte: the normal of the table (anorms.h) nearest the direction, 0 for none. */
export function dirToByte(x, y, z) {
  if (!x && !y && !z) return 0;
  let best = 0, bestDot = -2;
  for (let i = 0; i < 162; i++) {
    const dot = x * ANORMS[i * 3] + y * ANORMS[i * 3 + 1] + z * ANORMS[i * 3 + 2];
    if (dot > bestDot) { bestDot = dot; best = i; }
  }
  return best;
}

/** MSG_Write*: a growing little-endian buffer with Quake's encodings. */
export class Writer {
  constructor(size = 4096) { this.b = new Uint8Array(size); this.dv = new DataView(this.b.buffer); this.n = 0; }
  grow(need) {
    if (this.n + need <= this.b.length) return;
    const b = new Uint8Array(Math.max(this.b.length * 2, this.n + need));
    b.set(this.b.subarray(0, this.n)); this.b = b; this.dv = new DataView(b.buffer);
  }
  byte(v) { this.grow(1); this.b[this.n++] = v & 255; return this; }
  char(v) { return this.byte(Math.max(-128, Math.min(127, Math.round(v))) & 255); }
  short(v) { this.grow(2); this.dv.setInt16(this.n, Math.max(-32768, Math.min(32767, Math.round(v))), true); this.n += 2; return this; }
  long(v) { this.grow(4); this.dv.setInt32(this.n, v | 0, true); this.n += 4; return this; }
  string(s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i) & 255); return this.byte(0); }
  coord(v) { return this.short(v * 8); }
  pos(p) { return this.coord(p[0]).coord(p[1]).coord(p[2]); }
  angle(v) { return this.byte(Math.round(v * 256 / 360)); }
  angle16(v) { return this.short(((Math.round(v * 65536 / 360) % 65536) + 65536) % 65536 << 16 >> 16); }
  dir(d) { return this.byte(dirToByte(d[0], d[1], d[2])); }
  append(w) { this.grow(w.n); this.b.set(w.b.subarray(0, w.n), this.n); this.n += w.n; return this; }
  get bytes() { return this.b.subarray(0, this.n); }
}

const nullState = () => ({ number: 0, origin: [0, 0, 0], angles: [0, 0, 0], oldOrigin: [0, 0, 0], modelindex: 0, modelindex2: 0, modelindex3: 0, modelindex4: 0,
  frame: 0, skin: 0, effects: 0, renderfx: 0, solid: 0, sound: 0, event: 0 });
const angleByte = (v) => Math.round(v * 256 / 360) & 255;
const coordShort = (v) => Math.round(v * 8);

/**
 * MSG_WriteDeltaEntity: `to` against `from`, the bits for what differs (at the precision the wire carries); a new
 * entity is written even with nothing changed and carries its old origin; `remove` writes U_REMOVE alone. One
 * with nothing changed is not written unless `force` (the client carries it over from the last frame as it was):
 * returns whether anything was.
 */
export function writeDeltaEntity(w, from, to, { newEntity = false, remove = false, force = false } = {}) {
  let bits = 0;
  const number = to.number;
  if (number >= 256) bits |= U.NUMBER16;
  if (remove) bits |= U.REMOVE;
  else {
    if (coordShort(to.origin[0]) !== coordShort(from.origin[0])) bits |= U.ORIGIN1;
    if (coordShort(to.origin[1]) !== coordShort(from.origin[1])) bits |= U.ORIGIN2;
    if (coordShort(to.origin[2]) !== coordShort(from.origin[2])) bits |= U.ORIGIN3;
    if (angleByte(to.angles[0]) !== angleByte(from.angles[0])) bits |= U.ANGLE1;
    if (angleByte(to.angles[1]) !== angleByte(from.angles[1])) bits |= U.ANGLE2;
    if (angleByte(to.angles[2]) !== angleByte(from.angles[2])) bits |= U.ANGLE3;
    if (to.skin !== from.skin) bits |= to.skin >= 65536 ? U.SKIN8 | U.SKIN16 : to.skin >= 256 ? U.SKIN16 : U.SKIN8;
    if (to.frame !== from.frame) bits |= to.frame >= 256 ? U.FRAME16 : U.FRAME8;
    if (to.effects !== from.effects) bits |= to.effects >= 32768 ? U.EFFECTS8 | U.EFFECTS16 : to.effects >= 256 ? U.EFFECTS16 : U.EFFECTS8;
    if (to.renderfx !== from.renderfx) bits |= to.renderfx >= 32768 ? U.RENDERFX8 | U.RENDERFX16 : to.renderfx >= 256 ? U.RENDERFX16 : U.RENDERFX8;
    if (to.solid !== from.solid) bits |= U.SOLID;
    if (to.event) bits |= U.EVENT;
    if (to.modelindex !== from.modelindex) bits |= U.MODEL;
    if (to.modelindex2 !== from.modelindex2) bits |= U.MODEL2;
    if (to.modelindex3 !== from.modelindex3) bits |= U.MODEL3;
    if (to.modelindex4 !== from.modelindex4) bits |= U.MODEL4;
    if (to.sound !== from.sound) bits |= U.SOUND;
    if (newEntity) bits |= U.OLDORIGIN;
  }
  if (!(bits & ~U.NUMBER16) && !newEntity && !remove && !force) return false;
  if (bits & 0xff000000) bits |= U.MOREBITS3 | U.MOREBITS2 | U.MOREBITS1;
  else if (bits & 0x00ff0000) bits |= U.MOREBITS2 | U.MOREBITS1;
  else if (bits & 0x0000ff00) bits |= U.MOREBITS1;
  w.byte(bits & 255);
  if (bits & 0xff000000) w.byte(bits >>> 8).byte(bits >>> 16).byte(bits >>> 24);
  else if (bits & 0x00ff0000) w.byte(bits >>> 8).byte(bits >>> 16);
  else if (bits & 0x0000ff00) w.byte(bits >>> 8);
  if (bits & U.NUMBER16) w.short(number); else w.byte(number);
  if (remove) return true;
  if (bits & U.MODEL) w.byte(to.modelindex);
  if (bits & U.MODEL2) w.byte(to.modelindex2);
  if (bits & U.MODEL3) w.byte(to.modelindex3);
  if (bits & U.MODEL4) w.byte(to.modelindex4);
  if (bits & U.FRAME8) w.byte(to.frame);
  if (bits & U.FRAME16) w.short(to.frame);
  if ((bits & (U.SKIN8 | U.SKIN16)) === (U.SKIN8 | U.SKIN16)) w.long(to.skin);
  else if (bits & U.SKIN8) w.byte(to.skin);
  else if (bits & U.SKIN16) w.short(to.skin);
  if ((bits & (U.EFFECTS8 | U.EFFECTS16)) === (U.EFFECTS8 | U.EFFECTS16)) w.long(to.effects);
  else if (bits & U.EFFECTS8) w.byte(to.effects);
  else if (bits & U.EFFECTS16) w.short(to.effects);
  if ((bits & (U.RENDERFX8 | U.RENDERFX16)) === (U.RENDERFX8 | U.RENDERFX16)) w.long(to.renderfx);
  else if (bits & U.RENDERFX8) w.byte(to.renderfx);
  else if (bits & U.RENDERFX16) w.short(to.renderfx);
  if (bits & U.ORIGIN1) w.coord(to.origin[0]);
  if (bits & U.ORIGIN2) w.coord(to.origin[1]);
  if (bits & U.ORIGIN3) w.coord(to.origin[2]);
  if (bits & U.ANGLE1) w.angle(to.angles[0]);
  if (bits & U.ANGLE2) w.angle(to.angles[1]);
  if (bits & U.ANGLE3) w.angle(to.angles[2]);
  if (bits & U.OLDORIGIN) w.pos(to.oldOrigin);
  if (bits & U.SOUND) w.byte(to.sound);
  if (bits & U.EVENT) w.byte(to.event);
  if (bits & U.SOLID) w.short(to.solid);
  return true;
}

/** A stable negative id for a loop no entity carries (a frame row without one), from its sound's name. */
const loopId = (name) => { let h = 7; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0; return -1000000 - (h >>> 8); };

const nullPs = () => ({ pmType: 0, origin: [0, 0, 0], viewoffset: [0, 0, 0], viewangles: [0, 0, 0], gunindex: 0, gunframe: 0, gunAngles: [0, 0, 0],
  blend: [0, 0, 0, 0], fov: 90, rdflags: 0, stats: new Array(32).fill(0) });
const q4 = (v) => Math.max(-128, Math.min(127, Math.round(v * 4)));
const sameArr = (a, b, f = (v) => v) => a.length === b.length && a.every((v, i) => f(v) === f(b[i]));

/** SV_WritePlayerstateToClient: `ps` against `old` (the last frame's), the flags for what differs. */
export function writePlayerstate(w, old, ps) {
  old = old ?? nullPs();
  let flags = 0;
  if (ps.pmType !== old.pmType) flags |= PS.M_TYPE;
  if (!sameArr(ps.origin, old.origin, coordShort)) flags |= PS.M_ORIGIN;
  if (!sameArr(ps.viewoffset, old.viewoffset, q4)) flags |= PS.VIEWOFFSET;
  if (!sameArr(ps.viewangles, old.viewangles, (v) => Math.round(v * 65536 / 360) & 65535)) flags |= PS.VIEWANGLES;
  if (ps.gunindex !== old.gunindex) flags |= PS.WEAPONINDEX;
  if (ps.gunframe !== old.gunframe || !sameArr(ps.gunAngles, old.gunAngles, q4)) flags |= PS.WEAPONFRAME;
  if (!sameArr(ps.blend, old.blend, (v) => Math.round(v * 255))) flags |= PS.BLEND;
  if (ps.fov !== old.fov) flags |= PS.FOV;
  if (ps.rdflags !== old.rdflags) flags |= PS.RDFLAGS;
  w.short(flags);
  if (flags & PS.M_TYPE) w.byte(ps.pmType);
  if (flags & PS.M_ORIGIN) w.pos(ps.origin);
  if (flags & PS.VIEWOFFSET) for (const v of ps.viewoffset) w.char(v * 4);
  if (flags & PS.VIEWANGLES) for (const v of ps.viewangles) w.angle16(v);
  if (flags & PS.WEAPONINDEX) w.byte(ps.gunindex);
  if (flags & PS.WEAPONFRAME) { w.byte(ps.gunframe); w.char(0).char(0).char(0); for (const v of ps.gunAngles) w.char(v * 4); }
  if (flags & PS.BLEND) for (const v of ps.blend) w.byte(Math.round(v * 255));
  if (flags & PS.FOV) w.byte(ps.fov);
  if (flags & PS.RDFLAGS) w.byte(ps.rdflags);
  let statbits = 0;
  for (let i = 0; i < 32; i++) if (ps.stats[i] !== old.stats[i]) statbits |= 1 << i;
  w.long(statbits);
  for (let i = 0; i < 32; i++) if (statbits & (1 << i)) w.short(ps.stats[i]);
}

/**
 * A game's recorder. `res` is loadResources' (models by id with their names); `bsp` the map's (the inline
 * models, the areas), `mapBytes` the .bsp file (its checksum is CS_MAPCHECKSUM, which the client checks against
 * the map it loads); `setup` what startMap returned (the sky, the CD track); `playerEnt` the recording client's
 * entity id; `brushNames` the brush models' entity ids to their names (`*n`); `levelname` the map's message.
 * Then `frame(row, f, extra)` for each tic's Q2_TIC row and decoded frame, and `finish()` for the file.
 */
export class DemoRecorder {
  constructor({ map, res, bsp, mapBytes = null, setup = {}, playerEnt = 0, brushNames = new Map(), levelname = '', protocol = PROTOCOL, fov = 90, netname = 'player', blockMax = MAX_MSGLEN } = {}) {
    this.map = map;
    this.res = res;
    this.bsp = bsp;
    this.protocol = protocol;
    this.fov = fov;
    this.playerEnt = playerEnt;
    this.brushNames = brushNames;
    this.blockMax = blockMax;
    this.out = new Writer(1 << 16);
    this.pending = new Writer(2048);   // the messages before the next frame (configstrings, baselines, events)
    this.configstrings = new Map();     // index → string, as written
    this.modelIndex = new Map();        // model name → CS_MODELS offset
    this.soundIndex = new Map();        // sound name → CS_SOUNDS offset
    this.imageIndex = new Map();        // image name → CS_IMAGES offset
    this.numbers = new Map();           // the game's entity id → the demo's entity number
    this.nextNumber = 2;
    this.freeNumbers = [];              // numbers of entities gone, reused past 1023
    this.baselined = new Set();         // numbers with a baseline written
    this.baselines = new Map();         // number → the baseline's state (a delta's `from` for an entity just come)
    this.state = new Map();             // the last frame's entities: number → state
    this.ps = null;                     // the last frame's player state
    this.serverframe = -1;              // the last frame's number (a tenth of a second)
    this.lastMsg = null; this.lastCprint = null;
    this.prevAngles = null;             // the last frame's view angles (the gun's lag, SV_CalcGunOffset)
    this.frames = 0; this.blocks = 0; this.dropped = 0; this.oversize = 0;
    this.finished = false;
    // CL_Record_f: the server data, the configstrings, "precache"
    const h = new Writer(4096);
    h.byte(SVC.serverdata).long(protocol).long(1).byte(1).string('').short(0).string(levelname);
    this.flush(h);
    this.config(CS.NAME, levelname);
    this.config(CS.CDTRACK, String(setup.cdTrack ?? 0));
    this.config(CS.SKY, setup.sky ?? 'unit1_');
    this.config(CS.SKYAXIS, (setup.skyAxis ?? [0, 0, 0]).map((v) => String(+v.toFixed(3))).join(' '));
    this.config(CS.SKYROTATE, String(setup.skyRotate ?? 0));
    this.config(CS.STATUSBAR, STATUSBAR);
    this.config(CS.MAXCLIENTS, '1');
    if (mapBytes) this.config(CS.MAPCHECKSUM, String(blockChecksum(mapBytes)));
    // the models: the map first, then its inline models in order (SV_SpawnServer: *1 at 2), the rest as they come
    this.modelIndex.set(`maps/${map}.bsp`, 1); this.config(CS.MODELS + 1, `maps/${map}.bsp`);
    const inline = (bsp?.models?.length ?? 1) - 1;
    for (let i = 1; i <= inline && i + 1 <= 255; i++) { this.modelIndex.set(`*${i}`, i + 1); this.config(CS.MODELS + i + 1, `*${i}`); }
    // the items' names (STAT_PICKUP_STRING points at one) and the client's skin
    for (let i = 1; i < ITEMS.length; i++) if (ITEMS[i]) this.config(CS.ITEMS + i, ITEMS[i][0]);
    this.config(CS.PLAYERSKINS, `${netname}\\male/grunt`);
    this.pending.byte(SVC.stufftext).string('precache\n');
    this.flush(this.pending); this.pending = new Writer(2048);
  }

  /** A block: its length and its bytes. */
  flush(w) {
    if (!w.n) return;
    if (w.n > this.blockMax) this.oversize++;
    this.out.long(w.n).append(w);
    this.blocks++;
  }
  /** Room for `n` more bytes in the pending messages: they go out as a block of their own if not. */
  room(n) {
    if (this.pending.n && this.pending.n + n > this.blockMax) { this.flush(this.pending); this.pending = new Writer(2048); }
    return this.pending;
  }
  /** svc_configstring into the pending messages. */
  config(index, s) {
    if (this.configstrings.get(index) === s) return;
    this.configstrings.set(index, s);
    this.room(s.length + 4).byte(SVC.configstring).short(index).string(s);
  }
  /** A lazy index of a configstring range: 0 when the range is full (the protocol's byte). */
  index(table, base, name) {
    if (!name) return 0;
    let i = table.get(name);
    if (i === undefined) {
      if (table.size >= 255) return 0;
      i = (base === CS.MODELS ? Math.max(1, ...table.values()) : table.size) + 1;
      table.set(name, i);
      this.config(base + i, name);
    }
    return i;
  }
  model(name) { return this.index(this.modelIndex, CS.MODELS, name); }
  sound(name) { return this.index(this.soundIndex, CS.SOUNDS, name); }
  image(name) { return this.index(this.imageIndex, CS.IMAGES, name); }
  /** The demo's entity number of a game entity (the player's 1; the rest compact, reused only past the limit). */
  number(id) {
    if (id === this.playerEnt) return 1;
    let n = this.numbers.get(id);
    if (n !== undefined) return n;
    if (this.nextNumber < 1024) n = this.nextNumber++;
    else {
      while (this.freeNumbers.length && this.state.has(this.freeNumbers[0])) this.freeNumbers.shift();   // (back since it left: not free)
      if (!this.freeNumbers.length) return 0;
      n = this.freeNumbers.shift(); this.baselined.delete(n); this.baselines.delete(n);
      for (const [k, v] of this.numbers) if (v === n) this.numbers.delete(k);
    }
    this.numbers.set(id, n);
    return n;
  }

  /**
   * One tic: `row` its Q2_TIC row, `f` its decoded frame (ents, faces, sounds, fx, loops, brushFrames,
   * brushAngles), `extra.brushes` the brush models' positions ([id, x, y, z, pitch, yaw, roll, frame, effects])
   * when the frame's faces do not carry them. A tic in the same server frame as the last written only adds
   * its events to the next block.
   */
  /** Whether a tic at this row's time begins a new server frame (the one between folds into the next). */
  due(row) { return Math.floor(Math.round(row.TIME_ * 20) / 2) > this.serverframe; }

  frame(row, f, extra = {}) {
    if (this.finished) return false;
    this.events(row, f);
    if (!this.due(row)) return false;
    const sf = Math.floor(Math.round(row.TIME_ * 20) / 2);
    // the entities this frame: the player, the models and sprites, the brush models, the loops' carriers
    const ents = new Map();
    const player = nullState();
    player.number = 1; player.origin = [row.PX, row.PY, row.PZ]; player.angles = [0, row.YAW, 0];
    ents.set(1, { id: this.playerEnt, s: player });
    for (const e of f.ents) {
      const m = this.res.models.get(e[1]);
      const mi = this.model(m?.name);
      if (!mi) continue;
      const n = this.number(e[0]);
      if (!n) continue;
      const s = nullState();
      s.number = n; s.modelindex = mi; s.frame = e[2]; s.skin = e[3]; s.origin = [e[4], e[5], e[6]]; s.angles = [e[7], e[8], e[9]];
      s.effects = e[10] >>> 0; s.renderfx = (e[13] ?? 0) | (e[11] === 1 ? RF_TRANSLUCENT : 0);
      ents.set(n, { id: e[0], s });
    }
    const brushes = extra.brushes ?? [];
    if (!extra.brushes) {
      const seen = new Set();
      for (const face of f.faces) if (face.length === 5 && !seen.has(face[1])) { seen.add(face[1]); brushes.push([face[1], face[2], face[3], face[4]]); }
    }
    for (const b of brushes) {
      const name = this.brushNames.get(b[0]);
      if (!name) continue;
      const mi = this.model(name);
      const n = mi ? this.number(b[0]) : 0;
      if (!n) continue;
      const s = nullState();
      const fr = f.brushFrames.get(b[0]), an = f.brushAngles.get(b[0]);
      s.number = n; s.modelindex = mi; s.origin = [b[1], b[2], b[3]];
      s.angles = b.length > 6 ? [b[4], b[5], b[6]] : an ? an.slice() : [0, 0, 0];
      s.frame = b.length > 7 ? b[7] : fr ? fr[0] : 0; s.effects = (b.length > 8 ? b[8] : fr ? fr[1] : 0) >>> 0;
      ents.set(n, { id: b[0], s });
    }
    for (const l of f.loops) {
      const si = this.sound(l[0]);
      if (!si) continue;
      const id = l[4] ?? loopId(l[0]);
      const n = this.number(id);
      if (!n) continue;
      if (ents.has(n)) { ents.get(n).s.sound = si; continue; }
      // (a carrier not in view: an entity with no model, there for the sound alone)
      const s = nullState();
      s.number = n; s.origin = [l[1], l[2], l[3]]; s.sound = si;
      ents.set(n, { id, s });
    }
    // the player state
    const ps = this.playerState(row);
    // the frame: svc_frame, the player state, the entities as deltas (SV_WriteFrameToClient, SV_EmitPacketEntities)
    const fw = new Writer(2048);
    fw.byte(SVC.frame).long(sf).long(this.serverframe).byte(0);
    const alen = Math.min(32, Math.max(1, Math.ceil((this.bsp?.areas?.length ?? 1) / 8)));
    fw.byte(alen); for (let i = 0; i < alen; i++) fw.byte(255);
    fw.byte(SVC.playerinfo);
    writePlayerstate(fw, this.ps, ps);
    fw.byte(SVC.packetentities);
    const numbers = [...new Set([...this.state.keys(), ...ents.keys()])].sort((a, b) => a - b);
    const budget = this.blockMax - 3;
    const next = new Map();
    for (const n of numbers) {
      const e = ents.get(n), old = this.state.get(n);
      if (!e) { writeDeltaEntity(fw, old, { number: n }, { remove: true }); continue; }
      const isNew = !old;
      if (!this.baselined.has(n)) {
        // the first time an entity shows: its baseline, in the pending messages before the frame
        const bw = this.room(48);
        bw.byte(SVC.spawnbaseline);
        const base = { ...e.s, origin: e.s.origin.slice(), angles: e.s.angles.slice(), oldOrigin: e.s.origin.slice(), sound: 0, event: 0 };
        writeDeltaEntity(bw, nullState(), base, { newEntity: true });
        this.baselined.add(n);
        this.baselines.set(n, base);
      }
      const from = old ?? this.baselines.get(n) ?? nullState();
      e.s.oldOrigin = old ? old.origin.slice() : e.s.origin.slice();
      const mark = fw.n;
      // (the player is always written, as the server forced a client's own entity; one unchanged is carried over)
      writeDeltaEntity(fw, from, e.s, { newEntity: isNew, force: n === 1 });
      if (fw.n > budget && n !== 1) {
        // no room in this block: an entity already there stays as it was (the client carries it over), a new
        // one waits for the next frame
        fw.n = mark; this.dropped++;
        if (old) next.set(n, old);
        continue;
      }
      next.set(n, e.s);
    }
    fw.short(0);
    for (const n of this.state.keys()) if (!next.has(n) && n !== 1 && this.nextNumber >= 1024) this.freeNumbers.push(n);
    this.state = next;
    this.ps = ps;
    this.serverframe = sf;
    this.frames++;
    // the block: the pending messages (configstrings, baselines, the events since the last frame), then the frame;
    // the pending ones go first on their own when the two would pass the limit
    this.room(fw.n).append(fw);
    this.flush(this.pending); this.pending = new Writer(2048);
    return true;
  }

  /** The tic's sounds, temporary entities and prints as messages before the frame (SV_StartSound, gi.multicast, gi.cprintf). */
  events(row, f) {
    for (const s of f.sounds) {
      const si = this.sound(s[4]);
      if (!si) continue;
      const n = s[2] != null ? this.number(s[2]) : 0;
      const w = this.room(16);
      w.byte(SVC.sound).byte(SND.VOLUME | SND.ATTENUATION | SND.POS | SND.ENT).byte(si).byte(Math.round(Math.max(0, Math.min(1, s[5] ?? 1)) * 255)).byte(Math.round(Math.max(0, Math.min(3.98, s[6] ?? 1)) * 64));
      w.short((n << 3) | ((s[3] ?? 0) & 7)).pos([s[7], s[8], s[9]]);
    }
    for (const e of f.fx) {
      const [, kind, x, y, z, x2, y2, z2, n] = e;
      let te = KIND_TE[kind];
      if (te === undefined) continue;   // (the laser beam, the muzzle light and the item respawn are no temp entity of Quake's)
      if (kind === 10 && (n === 0 || n === SPARKS_DEFAULT)) te = TE.SPARKS;
      const w = this.room(18);
      w.byte(SVC.temp_entity).byte(te);
      switch (te) {
        case TE.GUNSHOT: case TE.SHOTGUN: case TE.BLOOD: case TE.BLASTER: case TE.SPARKS: w.pos([x, y, z]).dir([x2, y2, z2]); break;
        case TE.SPLASH: w.byte(n >> 4).pos([x, y, z]).dir([x2, y2, z2]).byte(n & 7); break;
        case TE.LASER_SPARKS: w.byte(n >> 8).pos([x, y, z]).dir([x2, y2, z2]).byte(n & 255); break;
        case TE.RAILTRAIL: case TE.BUBBLETRAIL: case TE.BFG_LASER: w.pos([x, y, z]).pos([x2, y2, z2]); break;
        case TE.PARASITE_ATTACK: w.short(this.number(n)).pos([x, y, z]).pos([x2, y2, z2]); break;
        default: w.pos([x, y, z]); break;   // the explosions, the BFG's, the teleport
      }
    }
    if (row.MSG && row.MSG !== this.lastMsg) this.room(row.MSG.length + 4).byte(SVC.print).byte(2).string(row.MSG + '\n');
    this.lastMsg = row.MSG ?? null;
    if (row.CPRINT && row.CPRINT !== this.lastCprint) this.room(row.CPRINT.length + 3).byte(SVC.centerprint).string(row.CPRINT);
    this.lastCprint = row.CPRINT ?? null;
  }

  /** The row's view and stats as the player state (ClientEndServerFrame, G_SetStats, SV_CalcGunOffset, SV_CalcBlend). */
  playerState(row) {
    const ps = nullPs();
    const time = row.TIME_;
    ps.pmType = row.INTERMISSION ? PM.FREEZE : row.DEAD ? PM.DEAD : PM.NORMAL;
    ps.origin = [row.PX, row.PY, row.PZ];
    ps.viewoffset = [0, 0, row.VIEW_Z - row.PZ];
    ps.viewangles = [row.PITCH, row.YAW, row.ROLL ?? (row.DEAD ? 40 : 0)];
    ps.fov = Math.max(1, Math.min(160, Math.round(this.fov)));
    ps.rdflags = row.WATERLEVEL >= 3 && !row.INTERMISSION ? RDF_UNDERWATER : 0;
    // the gun: its model and frame as the page draws them, its angles the bob and the lag behind the view's turn
    const wp = WEAPONS[row.WEAPON];
    if (wp && !row.DEAD && !row.INTERMISSION) {
      ps.gunindex = this.model(wp.view);
      const vm = this.res.models.get(this.res.byName.get(wp.view));
      if (vm?.mdl) ps.gunframe = viewFrameLerp(vm.mdl, row, time)[0];
      const bt = (row.BOBTIME ?? 0) * (row.DUCKED ? 4 : 1), bfs = Math.abs(Math.sin(bt * Math.PI)), xys = row.XYSPEED ?? 0;
      let gr = xys * bfs * 0.005, gy = xys * bfs * 0.01, gp = xys * bfs * 0.005;
      if (Math.floor(bt) & 1) { gr = -gr; gy = -gy; }
      if (this.prevAngles) {
        const lag = (a, b) => { let d = a - b; if (d > 180) d -= 360; if (d < -180) d += 360; return Math.max(-45, Math.min(45, d)); };
        const dy = lag(this.prevAngles[1], row.YAW);
        gr += 0.1 * dy; gy += 0.2 * dy; gp += 0.2 * lag(this.prevAngles[0], row.PITCH);
      }
      ps.gunAngles = [gp, gy, gr];
    }
    this.prevAngles = [row.PITCH, row.YAW];
    // SV_CalcBlend as the page tints: damage, bonus, the powerups, water
    const since = time - (row.DMG_TIME ?? -10);
    if (since >= 0 && since < 0.5 && (row.DMG_TAKE || row.DMG_SAVE)) ps.blend = [1, 0, 0, Math.min(0.6, ((row.DMG_TAKE ?? 0) * 0.03 + (row.DMG_SAVE ?? 0) * 0.01) * (1 - since / 0.5) + 0.1)];
    else if (time - (row.BONUS_TIME ?? -10) >= 0 && time - row.BONUS_TIME < 0.4) ps.blend = [215 / 255, 186 / 255, 69 / 255, 0.25 * (1 - (time - row.BONUS_TIME) / 0.4)];
    else if (row.QUAD) ps.blend = [0, 0, 1, 0.2];
    else if (row.INVINCIBLE) ps.blend = [1, 1, 0, 0.3];
    else if (row.ENVIRO) ps.blend = [0, 1, 0, 0.2];
    else if (row.WATERLEVEL >= 3) ps.blend = row.WATERTYPE & 8 ? [1, 80 / 255, 0, 0.6] : row.WATERTYPE & 16 ? [0, 25 / 255, 5 / 255, 0.6] : [0, 40 / 255, 100 / 255, 0.4];
    // G_SetStats
    const st = ps.stats;
    st[STAT.HEALTH_ICON] = this.image('i_health');
    st[STAT.HEALTH] = row.HEALTH ?? 0;
    if (wp?.ammo) { st[STAT.AMMO_ICON] = this.image(AMMO_ICONS[wp.ammo]); st[STAT.AMMO] = row[wp.ammo.toUpperCase()] ?? 0; }
    if (row.POWER_ARMOR) { st[STAT.ARMOR_ICON] = this.image('i_powershield'); st[STAT.ARMOR] = row.CELLS ?? 0; }
    else if (row.ARMOR > 0 && ARMOR_ICONS[row.ARMOR_TYPE]) { st[STAT.ARMOR_ICON] = this.image(ARMOR_ICONS[row.ARMOR_TYPE]); st[STAT.ARMOR] = row.ARMOR; }
    if (row.INV_SEL > 0 && ITEMS[row.INV_SEL]) { st[STAT.SELECTED_ICON] = this.image(ITEMS[row.INV_SEL][1]); st[STAT.SELECTED_ITEM] = row.INV_SEL; }
    if (row.PICKUP_ITEM > 0 && ITEMS[row.PICKUP_ITEM]) { st[STAT.PICKUP_ICON] = this.image(ITEMS[row.PICKUP_ITEM][1]); st[STAT.PICKUP_STRING] = CS.ITEMS + row.PICKUP_ITEM; }
    if (row.TIMER_ICON > 0 && TIMER_ICONS[row.TIMER_ICON]) { st[STAT.TIMER_ICON] = this.image(TIMER_ICONS[row.TIMER_ICON]); st[STAT.TIMER] = row.TIMER ?? 0; }
    if (row.HELP_CHANGED) st[STAT.HELPICON] = this.image('i_help');
    st[STAT.FRAGS] = row.SCORE ?? 0;
    st[STAT.FLASHES] = (since >= 0 && since < 0.5 && (row.DMG_TAKE || row.DMG_SAVE) ? 1 : 0) | (time - (row.BONUS_TIME ?? -10) >= 0 && time - row.BONUS_TIME < 0.4 ? 2 : 0);
    return ps;
  }

  /** The file: the blocks so far and the end mark. */
  finish() {
    if (!this.finished) { this.flush(this.pending); this.pending = new Writer(16); this.out.long(-1); this.finished = true; }
    return this.out.bytes;
  }
  get size() { return this.out.n; }
}
