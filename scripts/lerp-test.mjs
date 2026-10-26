// lerp-test.mjs – the frames between tics (src/lerp.js): the eye and the entities moved between two tics' frames by the
// fraction, angles the short way round, a newcomer or a teleport snapping, the brush models' face rows and angles
// moved, the view's angles the current tic's plus the turn the input holds, the SQL-projecting mode exact; then the
// same on a real game: two tics of walking on demo1 and the frame halfway between them.
//   node scripts/lerp-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak } from '../src/pak.js';
import { createSchema, loadResources, SQL_FILES } from '../src/loader.js';
import { Session } from '../src/session.js';
import { FrameLerp } from '../src/lerp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ── synthetic frames ──
const row = (x, y, z, yaw, pitch, t) => ({ PX: x, PY: y, PZ: z, VIEW_Z: z + 22, YAW: yaw, PITCH: pitch, ROLL: 0, TIME_: t, HEALTH: 100 });
const ent = (id, mid, x, y, z, yaw) => [id, mid, 3, 0, x, y, z, 0, yaw, 0, 0, 0, 'M', 0];
const frame = (ents, faces, brushAngles = new Map()) => ({ ents, faces, styles: new Float32Array(64), brushFrames: new Map(), brushAngles, sounds: [], fx: [], loops: [] });
const L = new FrameLerp();
check(L.frame === null && L.at(0.5) === null, 'before any frame there is nothing to paint');
L.push(row(0, 0, 0, 350, 0, 1), frame([ent(5, 1, 100, 0, 0, 170), ent(6, 1, 0, 0, 0, 0)], [[1, 0, 0, 0, 0], [2, 9, 10, 20, 30], [3, 9, 10, 20, 30]], new Map([[9, [0, 10, 0]]])));
let s = L.at(0.5);
check(s.frac === 1 && s.row.PX === 0 && s.ents[0][4] === 100, 'with one frame only, it is painted as it is');
L.push(row(10, 20, 30, 10, 5, 1.05), frame([ent(5, 1, 110, 10, 0, 190), ent(7, 1, 500, 0, 0, 0), ent(6, 1, 900, 0, 0, 0)], [[1, 0, 0, 0, 0], [2, 9, 14, 20, 30], [3, 9, 14, 20, 30]], new Map([[9, [0, 350, 0]]])));
s = L.at(0.5);
check(near(s.row.PX, 5) && near(s.row.PY, 10) && near(s.row.PZ, 15) && near(s.row.VIEW_Z, 37) && s.frac === 0.5, `halfway: the eye halfway between the two origins (${s.row.PX}, ${s.row.PY}, ${s.row.PZ}; eye ${s.row.VIEW_Z})`);
check(s.row.YAW === 10 && s.row.PITCH === 5 && s.row.TIME_ === 1.05 && s.row.HEALTH === 100, 'the angles and the rest of the row are the current tic\'s');
const e5 = s.ents.find((e) => e[0] === 5), e6 = s.ents.find((e) => e[0] === 6), e7 = s.ents.find((e) => e[0] === 7);
check(near(e5[4], 105) && near(e5[5], 5) && near(e5[8], 180), `entity 5 is halfway between its two poses (${e5[4]}, ${e5[5]}, yaw ${e5[8]})`);
check(e6[4] === 900, 'entity 6, 900 units from where it was, snapped (a teleport)');
check(e7[4] === 500 && s.ents.length === 3, 'entity 7, just come, is where it is');
check(s.ents !== L.frame.ents && L.frame.ents[0][4] === 110, 'the current frame\'s rows are left as they were');
check(s.faces[1][2] === 12 && s.faces[2][2] === 12 && s.faces[0][2] === 0 && s.faces !== L.frame.faces, `the brush model's face rows carry its origin halfway (${s.faces[1][2]}), the world's stay`);
check(near(s.brushAngles.get(9)[1], 0), `its angles go the short way round (10 → 350: ${s.brushAngles.get(9)[1]})`);
s = L.at(0.25);
check(near(s.row.PX, 2.5) && near(s.ents.find((e) => e[0] === 5)[8], 175), 'a quarter: a quarter of the way');
check(L.at(-1).row.PX === 0 && L.at(2).row.PX === 10, 'the fraction is clamped to the two tics');
s = L.at(0.5, { yaw: 355, pitch: 100 });
check(s.row.YAW === 5 && s.row.PITCH === 89 && near(s.row.PX, 5), 'the turn the input holds is added to the current angles, the yaw round and the pitch clamped');
s = L.at(0.5, {}, true);
check(s.frac === 1 && s.row.PX === 10 && s.faces === L.frame.faces && s.ents === L.frame.ents, 'exact: the current tic as it is (the SQL-projecting mode)');
const pm = L.at(0.5);
L.push(row(10, 20, 30, 10, 5, 1.1), frame([ent(5, 2, 110, 10, 0, 190)], [[1, 0, 0, 0, 0]]));
s = L.at(0.5);
check(s.ents[0][4] === 110 && s.row.PX === 10 && s.faces === L.frame.faces, 'an entity with another model snaps; nothing moved, nothing copied');
// the eye teleported: no lerp of the view
L.push(row(2000, 20, 30, 10, 5, 1.15), frame([], [[1, 0, 0, 0, 0]]));
check(L.at(0.5).row.PX === 2000, 'the eye 2000 units on snaps too');
check(pm.row.PX === 5, '(a frame given before stays as given)');

// ── a real game: two tics walking, the frame between ──
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));
const db = new FirebirdBrowser('memory://quake2', { transport: new DirectTransport() });
await createSchema(db, sql);
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
const res = await loadResources(db, pak, { width: 320, height: 240 });
const session = new Session(db);
session.use(pak, res);
await session.startMap('demo1', { newGame: true, skill: 2, seed: 1 });
const G = new FrameLerp();
const walk = [1, 1, 0, 0, 0, 0, 0, 1, 0];
for (let i = 0; i < 10; i++) await session.tic(walk);
let r1 = await session.tic(walk); G.push(r1, await session.frame());
let r2 = await session.tic(walk); G.push(r2, await session.frame());
const mid = G.at(0.5);
check(Math.hypot(r2.PX - r1.PX, r2.PY - r1.PY) > 5 && near(mid.row.PX, (r1.PX + r2.PX) / 2) && near(mid.row.PY, (r1.PY + r2.PY) / 2) && near(mid.row.VIEW_Z, (r1.VIEW_Z + r2.VIEW_Z) / 2),
  `walking on demo1, the frame halfway between two tics has the eye halfway (${(r2.PX - r1.PX).toFixed(1)} units a tic)`);
check(mid.ents.length === G.frame.ents.length && mid.faces.length === G.frame.faces.length, `with every entity and face of the tic's frame (${mid.ents.length}, ${mid.faces.length})`);
const r3 = await session.tic([1, 0, 0, 30, 0, 0, 0, 1, 0]); G.push(r3, await session.frame());
check(near(G.at(0.5).row.YAW, r3.YAW) && !near(r3.YAW, r2.YAW), `a turn shows at once: the yaw is the current tic's (${r2.YAW.toFixed(0)} → ${r3.YAW.toFixed(0)})`);

await db.close();
console.log(failures ? `${failures} failure(s)` : 'all good');
process.exit(failures ? 1 : 0);
