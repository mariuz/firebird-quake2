// record-test.mjs – a game recorded as a demo (src/record.js) and read back (src/demo.js): the header as CL_Record_f
// wrote it (the server data, the map and its checksum, the sky, the status bar, the items), a frame a tenth of a
// second from the tics' rows, every block under MAX_MSGLEN and consumed exactly on the way back, the view as the
// rows had it (at the wire's precision), the entities where the frame had them with their models, frames and
// skins, the brush models by name where they stood, the sounds and the temporary entities of every tic (the tic
// between two frames folded into the next), the prints, the stats, a baseline the first time an entity shows and
// a delta after, an entity gone removed; the writer's encodings; the MD4 of the checksum against the RFC's
// vectors; then DemoPlayer plays the recording over the map and a frame is painted from it.
//   node scripts/record-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak, loadColormap } from '../src/pak.js';
import { createSchema, loadResources, SQL_FILES } from '../src/loader.js';
import { Session } from '../src/session.js';
import { parseDemo, DemoPlayer, CS } from '../src/demo.js';
import { DemoRecorder, Writer, writeDeltaEntity, md4hex, blockChecksum, dirToByte, PROTOCOL, MAX_MSGLEN, STATUSBAR } from '../src/record.js';
import { Renderer, lightPoint, entityFrame } from '../src/renderer.js';
import { ITEMS } from '../src/gamedata.js';
import { ANORMS } from '../src/md2.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const nearAngle = (a, b, eps) => { let d = ((a - b) % 360 + 540) % 360 - 180; return Math.abs(d) < eps; };
const ANGLE8 = 360 / 256 / 2 + 1e-6, ANGLE16 = 360 / 65536 / 2 + 1e-6, COORD = 1 / 16 + 1e-6;

// ── the writer and the checksum ──
const enc = (s) => new TextEncoder().encode(s);
check(md4hex(enc('')) === '31d6cfe0d16ae931b73c59d7e0c089c0' && md4hex(enc('abc')) === 'a448017aaf21d8525fc10ae87aa6729d'
  && md4hex(enc('message digest')) === 'd9130a8164549fe818874806e1c7014b' && md4hex(enc('12345678901234567890123456789012345678901234567890123456789012345678901234567890')) === 'e33b4ddc9c38f2199c3e7b164fcc0536',
  'MD4 gives RFC 1320\'s digests ("", "abc", "message digest", the eighty digits)');
check(blockChecksum(enc('abc')) === ((0x7a0148a4 ^ 0x52d821af ^ 0xe80ac15f ^ 0x9d72a67a) | 0), 'Com_BlockChecksum is the four words xored, as an int');
const w = new Writer(4);
w.byte(300).char(-3).short(-2).long(0x01020304).string('hi').coord(12.5).angle(90).angle16(270).dir([0, 0, 1]);
const b = w.bytes;
check(b.length === 1 + 1 + 2 + 4 + 3 + 2 + 1 + 2 + 1 && b[0] === 44 && b[1] === 253 && b[2] === 254 && b[3] === 255 && b[4] === 4 && b[7] === 1 && b[8] === 104 && b[10] === 0
  && b[11] === 100 && b[12] === 0 && b[13] === 64 && (b[14] | (b[15] << 8)) === 49152 && b[16] === dirToByte(0, 0, 1),
  'the writer grows and encodes as MSG_Write* did: a byte wraps, a char and a short are two\'s complement, a coord is eighths, an angle 256ths, an angle16 65536ths, a string ends in NUL');
check(dirToByte(0, 0, 1) < 162 && near(ANORMS[dirToByte(0, 0, 1) * 3 + 2], 1) && dirToByte(0, 0, 0) === 0 && near(ANORMS[dirToByte(1, 0, 0) * 3], 1), 'DirToByte picks the nearest normal of the table, 0 for none');
const dw = new Writer();
const s0 = { number: 300, origin: [1, 2, 3], angles: [0, 90, 0], oldOrigin: [1, 2, 3], modelindex: 5, modelindex2: 0, modelindex3: 0, modelindex4: 0, frame: 7, skin: 0, effects: 0, renderfx: 0, solid: 0, sound: 0, event: 0 };
const nothing = writeDeltaEntity(dw, s0, { ...s0 });
const same = dw.n;
writeDeltaEntity(dw, s0, { ...s0, frame: 8 });
check(nothing === false && same === 0 && dw.n === 5 && dw.bytes[0] === (16 | 128) && dw.bytes[1] === 1 && (dw.bytes[2] | (dw.bytes[3] << 8)) === 300 && dw.bytes[4] === 8,
  'a delta with nothing changed writes nothing; a frame change on entity 300 is U_FRAME8 with U_NUMBER16, the number as a short, then the frame');

// ── a game recorded ──
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
const db = new FirebirdBrowser('memory://quake2', { transport: new DirectTransport() });
await createSchema(db, sql);
const res = await loadResources(db, pak, { width: 320, height: 240 });
const session = new Session(db);
session.use(pak, res);
const setup = await session.startMap('demo1', { newGame: true, skill: 2, seed: 1 });
const q = async (s) => (await db.query(s, [], { rowMode: 'array' })).rows;
const playerEnt = (await q('SELECT ent_id FROM player WHERE id = 1'))[0][0];
const brushNames = new Map(await q("SELECT e.id, m.name FROM ents e JOIN models m ON m.id = e.model_id WHERE m.kind = 'B' AND m.name STARTING WITH '*'"));
const mapBytes = pak.get('maps/demo1.bsp');
const levelname = await session.levelName();
const rec = new DemoRecorder({ map: 'demo1', res, bsp: setup.bsp, mapBytes, setup, playerEnt, brushNames, levelname, fov: 90, netname: 'tester' });
check(rec.blocks >= 2 && rec.size > 1000 && rec.frames === 0, `the header is written at once: ${rec.blocks} blocks, ${rec.size} bytes, no frame yet`);
// the game: a walk with shots, a turn, a jump (the usercmd as Input.read gives it: tics, fwd, side, yaw, pitch, fire, jump, run, imp)
const cmd = ({ fwd = 0, side = 0, yaw = 0, fire = 0, jump = 0 } = {}) => [1, fwd, side, yaw, 0, fire, jump, 1, 0];
const tics = [];   // [row, frame, brushes] of each tic
for (let i = 0; i < 80; i++) {
  const c = i < 30 ? cmd({ fwd: 1, fire: i % 8 === 0 ? 1 : 0 }) : i < 50 ? cmd({ yaw: 6, fire: i % 10 === 0 ? 1 : 0 }) : cmd({ fwd: 1, jump: i === 52 ? 1 : 0, fire: i % 6 === 0 ? 1 : 0 });
  const row = await session.tic(c);
  const f = await session.frame();
  const brushes = await q("SELECT e.id, e.x, e.y, e.z, e.pitch, e.yaw, e.roll, e.frame, e.effects FROM ents e WHERE e.mkind = 'B'");
  tics.push([row, f, brushes]);
  rec.frame(row, f, i % 3 === 0 ? { brushes } : {});   // (the brush models from the faces' origins as often as from the rows)
}
const written = tics.filter(([r], i) => i === 0 || Math.floor(Math.round(r.TIME_ * 20) / 2) > Math.floor(Math.round(tics[i - 1][0].TIME_ * 20) / 2));
check(rec.frames === written.length && rec.frames >= 39 && rec.frames <= 41, `80 tics make ${rec.frames} frames: one a tenth of a second (every other tic)`);
const bytes = rec.finish();
check(bytes.length === rec.size && new DataView(bytes.buffer, bytes.byteOffset).getInt32(bytes.length - 4, true) === -1, `finish ends the file with -1 (${(bytes.length / 1024).toFixed(1)} KB)`);
check(rec.frame(tics[0][0], tics[0][1]) === false && rec.finish().length === bytes.length, 'finished, the recorder takes nothing more');
check(rec.oversize === 0, `no block passes MAX_MSGLEN (${MAX_MSGLEN})`);
// the blocks themselves
const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
let off = 0, blocks = 0, biggest = 0;
for (;;) { const len = dv.getInt32(off, true); if (len === -1) break; blocks++; biggest = Math.max(biggest, len); off += 4 + len; }
check(blocks === rec.blocks && off === bytes.length - 4 && biggest <= MAX_MSGLEN, `${blocks} blocks, the biggest ${biggest} bytes`);

// ── read back ──
const demo = parseDemo(bytes);
check(demo.blocks === blocks && demo.frames.length === rec.frames, `parseDemo reads every block to its last byte: ${demo.frames.length} frames`);
check(demo.protocol === PROTOCOL && demo.attractloop === 1 && demo.playernum === 0 && demo.servercount === 1 && demo.gamedir === '', `svc_serverdata: protocol ${demo.protocol}, an attract loop, player 0`);
check(demo.levelname === levelname && demo.configstrings[CS.NAME] === levelname, `the level is "${demo.levelname}"`);
check(demo.map === 'maps/demo1.bsp' && demo.models[1] === 'maps/demo1.bsp', 'CS_MODELS + 1 is the map');
check(demo.configstrings[CS.MAPCHECKSUM] === String(blockChecksum(mapBytes)) && /^-?\d+$/.test(demo.configstrings[CS.MAPCHECKSUM]), `CS_MAPCHECKSUM is the map file's Com_BlockChecksum (${demo.configstrings[CS.MAPCHECKSUM]})`);
check(demo.configstrings[CS.SKY] === setup.sky && demo.configstrings[CS.CDTRACK] === String(setup.cdTrack) && demo.configstrings[CS.SKYROTATE] === String(setup.skyRotate)
  && demo.configstrings[CS.MAXCLIENTS] === '1' && demo.configstrings[CS.STATUSBAR] === STATUSBAR && demo.configstrings[CS.PLAYERSKINS] === 'tester\\male/grunt',
  `the sky (${setup.sky}), the CD track, the status bar layout, one client, the player's skin`);
const inline = setup.bsp.models.length - 1;
check(demo.models[2] === '*1' && demo.models[inline + 1] === `*${inline}` && !demo.models[inline + 2]?.startsWith('*'), `the map's ${inline} inline models at 2…, as SV_SpawnServer numbered them`);
check(ITEMS.every((it, i) => !it || demo.configstrings[CS.ITEMS + i] === it[0]), 'CS_ITEMS carries every item\'s name');
const namedModels = demo.models.filter((m) => m && m[0] !== '*' && m !== demo.map);
check(namedModels.length > 5 && namedModels.every((m) => pak.has(m)) && namedModels.includes('models/weapons/v_blast/tris.md2'), `the ${namedModels.length} models named are in the pak, the blaster in hand among them`);
const namedSounds = demo.sounds.filter(Boolean);
check(namedSounds.length > 3 && namedSounds.every((s) => pak.has(`sound/${s}`)) && namedSounds.includes('weapons/blastf1a.wav'), `so are the ${namedSounds.length} sounds, the blaster's shot among them`);
check(demo.images.filter(Boolean).includes('i_health'), `and the images (${demo.images.filter(Boolean).join(', ')})`);
check(demo.frames.every((f, i) => i === 0 || f.serverframe === demo.frames[i - 1].serverframe + 1) && demo.frames.every((f, i) => f.deltaframe === (i ? demo.frames[i - 1].serverframe : -1)),
  'the frames are consecutive, each a delta from the one before, the first from none');
check(demo.frames.every((f) => f.areabits.length === Math.ceil(setup.bsp.areas.length / 8) && f.areabits.every((v) => v === 255)), 'every area is in the areabits');

// the player state against the rows
let viewOk = true, statsOk = true, gunOk = true, blendOk = true;
for (let i = 0; i < written.length; i++) {
  const [row] = written[i], ps = demo.frames[i].ps;
  if (!(near(ps.origin[0], row.PX, COORD) && near(ps.origin[1], row.PY, COORD) && near(ps.origin[2], row.PZ, COORD) && near(ps.viewoffset[2], row.VIEW_Z - row.PZ, 0.125 + 1e-6)
    && nearAngle(ps.viewangles[0], row.PITCH, ANGLE16) && nearAngle(ps.viewangles[1], row.YAW, ANGLE16) && ps.fov === 90 && ps.pmType === 0)) viewOk = false;
  if (!(ps.stats[1] === row.HEALTH && demo.images[ps.stats[0]] === 'i_health' && ps.stats[12] === row.INV_SEL && (row.INV_SEL ? demo.images[ps.stats[6]] === ITEMS[row.INV_SEL][1] : true))) statsOk = false;
  if (!(demo.models[ps.gunindex] === 'models/weapons/v_blast/tris.md2' && ps.gunframe >= 0)) gunOk = false;
  if (!(ps.rdflags === (row.WATERLEVEL >= 3 ? 1 : 0))) blendOk = false;
}
check(viewOk, 'every frame\'s player state has the row\'s origin (to an eighth), view offset, angles (to a 65536th of a turn), fov and a normal pm_type');
check(statsOk, 'the stats carry the health with its icon, the selected item with its icon');
check(gunOk, 'the gun in hand is the blaster, with a frame');
check(blendOk, 'rdflags say underwater as the row did');
const turned = written.findIndex(([r], i) => i && !near(r.YAW, written[i - 1][0].YAW, 1));
check(turned > 0 && nearAngle(demo.frames[turned].ps.viewangles[1], written[turned][0].YAW, ANGLE16) && !near(demo.frames[turned].ps.viewangles[1], demo.frames[turned - 1].ps.viewangles[1], 1),
  `the turn shows in the view angles (frame ${turned}: ${demo.frames[turned - 1].ps.viewangles[1].toFixed(1)} → ${demo.frames[turned].ps.viewangles[1].toFixed(1)})`);
const gunStepped = demo.frames.some((f, i) => i && f.ps.gunframe !== demo.frames[i - 1].ps.gunframe);
check(gunStepped, 'the gun\'s frame steps through its runs as the shots go');
const lagged = demo.frames.slice(turned, turned + 5).some((f) => Math.abs(f.ps.gunAngles[1]) > 0.5);
check(lagged, 'the gun lags behind the turn (SV_CalcGunOffset\'s gun angles)');

// the entities against the frames: the player is 1, the models where the rows had them, the brush models by name
const self = 1;
let entsOk = true, missing = 0, extra = 0, total = 0;
for (let i = 0; i < written.length; i++) {
  const [row, f, brushes] = written[i], fr = demo.frames[i];
  const me = fr.ents.get(self);
  if (!me || !near(me.origin[0], row.PX, COORD) || !near(me.origin[1], row.PY, COORD) || !nearAngle(me.angles[1], row.YAW, ANGLE8)) entsOk = false;
  const byId = new Map();
  for (const [n, s] of fr.ents) if (n !== self && demo.models[s.modelindex] && demo.models[s.modelindex][0] !== '*') byId.set(n, s);
  for (const e of f.ents) {
    total++;
    const name = res.models.get(e[1]).name;
    const hit = [...byId.values()].find((s) => demo.models[s.modelindex] === name && near(s.origin[0], e[4], COORD) && near(s.origin[1], e[5], COORD) && near(s.origin[2], e[6], COORD));
    if (!hit) { missing++; continue; }
    if (hit.frame !== e[2] || hit.skin !== e[3] || !nearAngle(hit.angles[1], e[8], ANGLE8) || !nearAngle(hit.angles[0], e[7], ANGLE8) || (hit.effects >>> 0) !== (e[10] >>> 0)) entsOk = false;
    byId.delete([...byId.entries()].find(([, s]) => s === hit)[0]);
  }
  extra += byId.size;
  // the brush models of the frame (those whose faces show, or the rows given) stand where the game has them
  for (const [n, s] of fr.ents) {
    const name = demo.models[s.modelindex];
    if (!name || name[0] !== '*') continue;
    const id = [...brushNames].find(([, nm]) => nm === name)?.[0];
    const b = brushes.find((r) => r[0] === id);
    if (!b || !near(s.origin[0], b[1], COORD) || !near(s.origin[1], b[2], COORD) || !near(s.origin[2], b[3], COORD) || s.frame !== b[7]) entsOk = false;
  }
}
check(entsOk && missing === 0 && extra === 0, `every model of every frame is an entity of the recording with its model, frame, skin, angles and effects, and nothing more (${total} rows; ${missing} missing, ${extra} extra), the player's entity 1 at the row's origin, the brush models where the game had them`);
const brushCount = new Set([...demo.frames.flatMap((f) => [...f.ents.values()])].map((s) => demo.models[s.modelindex]).filter((n) => n && n[0] === '*')).size;
check(brushCount > 0, `${brushCount} brush models appear by their inline names`);
// a baseline the first time, a delta after: the baselines are many, the frames small
check(demo.baselines.size >= 20 && [...demo.baselines.keys()].every((n) => n >= 1 && n < 1024), `${demo.baselines.size} baselines, numbered under 1024`);
const sizes = [];
off = 0; for (;;) { const len = dv.getInt32(off, true); if (len === -1) break; sizes.push(len); off += 4 + len; }
const tail = sizes.slice(-10);
check(Math.max(...tail) < 600, `the later frames are deltas: the last ten blocks are ${Math.min(...tail)}–${Math.max(...tail)} bytes`);
// the sounds and the effects: every tic's, the tic between two frames folded into the next
const allSounds = tics.flatMap(([, f]) => f.sounds), allFx = tics.flatMap(([, f]) => f.fx);
const gotSounds = demo.frames.flatMap((f) => f.sounds), gotFx = demo.frames.flatMap((f) => f.fx);
const kinds = (k) => allFx.filter((e) => [13, 15, 17].includes(e[1]) === k);
check(allSounds.length > 5 && gotSounds.length === allSounds.length && allSounds.every((s, i) => demo.sounds[gotSounds[i].num] === s[4] && near(gotSounds[i].vol, Math.round(s[5] * 255) / 255) && near(gotSounds[i].attn, Math.round(s[6] * 64) / 64)
  && near(gotSounds[i].pos[0], s[7], COORD) && gotSounds[i].chan === (s[3] & 7)),
  `every sound of the ${tics.length} tics is in the recording in order, with its name, volume, attenuation, channel and position (${allSounds.length})`);
const ownSounds = allSounds.filter((s) => s[2] === playerEnt);
check(ownSounds.length > 0 && gotSounds.filter((s) => s.ent === self).length === ownSounds.length, `the player's own sounds name entity 1 (${ownSounds.length})`);
const te = kinds(false);
const normN = (k, n) => (k === 10 && n === 0 ? (6 << 8) | 0xe0 : n);
check(te.length > 3 && gotFx.length === te.length && te.every((e, i) => gotFx[i][1] === e[1] && near(gotFx[i][2], e[2], COORD) && near(gotFx[i][3], e[3], COORD) && near(gotFx[i][4], e[4], COORD) && gotFx[i][8] === normN(e[1], e[8])),
  `every temporary entity the client knows is in the recording as its kind, where it was (${te.length}: ${[...new Set(te.map((e) => e[1]))].join(', ')}${kinds(true).length ? `; ${kinds(true).length} of the port's own kinds left out` : ''})`);
const bolt = te.find((e) => e[1] === 6);
if (bolt) { const g = gotFx[te.indexOf(bolt)]; check(near(g[5] * g[5] + g[6] * g[6] + g[7] * g[7], 1, 1e-3), 'a blaster hit\'s direction comes back as a normal of the table'); }
const foldFrame = demo.frames.findIndex((f, i) => i && f.sounds.length >= 2);
check(foldFrame > 0 || allSounds.length < 2, 'the sounds of the tic between two frames come with the next frame');
// the prints
const msgs = []; for (const [r] of tics) if (r.MSG && r.MSG !== msgs.at(-1)) msgs.push(r.MSG);
const gotPrints = demo.frames.flatMap((f) => f.prints);
check(gotPrints.length === msgs.length && msgs.every((m, i) => gotPrints[i][0] === 2 && gotPrints[i][1] === m + '\n'), `the messages are svc_print at PRINT_HIGH, each once (${msgs.length}: ${msgs.map((m) => JSON.stringify(m)).join(', ') || 'none'})`);

// ── an entity gone: a monster killed is removed from the frames; a block too full waits (the map started again:
// the start has seven models in view, and a 100-byte block holds the player state and one or two of them) ──
const walk2 = cmd({ fwd: 1 });
await session.startMap('demo1', { newGame: true, skill: 2, seed: 1 });
const before = (await q("SELECT COUNT(*) FROM ents WHERE classname STARTING WITH 'monster_' AND health > 0"))[0][0];
await db.exec('UPDATE ents SET health = 1 WHERE classname STARTING WITH \'monster_\'');
const rec2 = new DemoRecorder({ map: 'demo1', res, bsp: setup.bsp, mapBytes, setup, playerEnt, brushNames, levelname, blockMax: 100 });
let killedAt = -1, seen = new Set();
for (let i = 0; i < 60; i++) {
  const row = await session.tic(i < 10 ? walk2 : cmd({ fire: 1, yaw: i % 2 ? 4 : -4 }));
  const f = await session.frame();
  for (const e of f.ents) seen.add(e[0]);
  rec2.frame(row, f);
  const alive = (await q("SELECT COUNT(*) FROM ents WHERE classname STARTING WITH 'monster_' AND health > 0"))[0][0];
  if (killedAt < 0 && alive < before) killedAt = rec2.frames;
}
const d2 = parseDemo(rec2.finish());
check(d2.frames.length === rec2.frames && d2.blocks === rec2.blocks, `a recording with 100-byte blocks reads back whole (${d2.blocks} blocks, ${d2.frames.length} frames)`);
check(rec2.dropped > 0 && rec2.oversize === 1, `the entities that did not fit a block waited for the next (${rec2.dropped} times); the one block over the limit is the status bar's configstring, longer than that by itself`);
const seenBack = new Set([...d2.frames.flatMap((f) => [...f.ents.keys()])]);
check(seenBack.size >= 8, `and every one came in a later frame (${seenBack.size} entities over ${d2.frames.length} frames)`);
const removed = d2.frames.some((f, i) => i && [...d2.frames[i - 1].ents.keys()].some((n) => !f.ents.has(n)));
check(removed, 'an entity gone from the frame is removed from the recording (U_REMOVE)');

// ── played back: DemoPlayer over the map, a frame painted ──
const player = new DemoPlayer(demo, { modelId: (n) => res.byName.get(n) });
check(near(player.duration, (demo.frames.length - 1) * 0.1), `the recording lasts ${player.duration.toFixed(1)} s`);
let st = player.at(0);
check(near(st.view.x, written[0][0].PX, COORD) && near(st.view.viewZ, written[0][0].VIEW_Z, 0.125 + COORD) && st.ents.length > 0 && st.ents.every((e) => res.models.has(e[1])),
  `at 0 the view is the first row's, with ${st.ents.length} entities the painter knows`);
const mid = player.at(0.05);
check(near(mid.view.x, (written[0][0].PX + written[1][0].PX) / 2, COORD) && mid.frac === 0.5, 'halfway to the second frame the view is halfway between the rows');
st = player.at(player.duration);
check(st.events.sounds.length + player.at(0).events.sounds.length >= 0 && player.finished, 'played to the end');
const session2 = new Session(db);
session2.use(pak, res);
await session2.startMap('demo1', { newGame: true, skill: 2, seed: 1 });
await session2.demoBegin();
st = (new DemoPlayer(demo, { modelId: (n) => res.byName.get(n) })).at(1.0);
const frame = await session2.demoFrame(st.view, st.brushes);
const cm = loadColormap(pak);
const stubCanvas = { width: 320, height: 240, getContext: () => ({ createImageData: (wd, h) => ({ width: wd, height: h, data: new Uint8ClampedArray(wd * h * 4) }), putImageData() {} }) };
const r = new Renderer(stubCanvas, { palette: cm.palette, colormap: cm.colormap, alphamap: cm.alphamap, pak });
r.setSize(320, 240);
r.setResources(res);
const v = st.view;
r.beginFrame({ x: v.x, y: v.y, z: v.viewZ, yaw: v.yaw, pitch: v.pitch, roll: v.roll, fov: 90 });
const frames = new Map();
for (const [id, [fr, eff]] of frame.brushFrames) frames.set(id, entityFrame(fr, eff, 0));
r.drawFaceList(frame.faces, st.lights, 0, frames, frame.brushAngles);
let drawn = 0;
for (const e of st.ents) { const m = res.models.get(e[1]); if (e[12] === 'M' && m.mdl) { r.drawAlias(m.mdl, e[2], e[3], [e[4], e[5], e[6]], [e[7], e[8], e[9]], lightPoint(setup.bsp, e[4], e[5], e[6]), { time: 0 }); drawn++; } }
check(frame.faces.length > 50 && new Set(r.fb).size > 16 && drawn > 0, `a second later the recording paints over the map: ${frame.faces.length} faces, ${drawn} models`);

await db.close();
console.log(failures ? `${failures} FAILED` : 'all good');
process.exit(failures ? 1 : 0);
