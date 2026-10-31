// predict-test.mjs – the player's move in JS (src/pmove.js) against the SQL's (player_think in sql/weapons.sql, the
// traces in sql/physics.sql), tic by tic over a run on demo1: walking, turning, a jump, a crouch, strafing, a
// stop, a wall, stairs. Each tic the JS starts from the state the SQL's row carries and must land where the SQL
// landed, to the number: the origin, the eye (the step smoothing and the bob in), the angles, the velocity, the
// ground flag, the duck and the water level. Then the JS runs free over the whole run from the first row alone
// and the drift stays small; the traces are checked on their own (a point through the floor, a box on it, the
// contents of the water); the state's round trip through the row.
//   node scripts/predict-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak } from '../src/pak.js';
import { createSchema, loadResources, SQL_FILES } from '../src/loader.js';
import { Session } from '../src/session.js';
import { ClipMap, trace, traceBox, pmove, stateFromRow, checkWater, clipVelocity, MASK_PLAYERSOLID, VIEW_CVARS } from '../src/pmove.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const nearAngle = (a, b, eps = 1e-6) => Math.abs(((a - b) % 360 + 540) % 360 - 180) < eps;

const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
const db = new FirebirdBrowser('memory://quake2', { transport: new DirectTransport() });
await createSchema(db, sql);
const res = await loadResources(db, pak, { width: 320, height: 240 });
const session = new Session(db);
session.use(pak, res);
const setup = await session.startMap('demo1', { newGame: true, skill: 2, seed: 1 });
const cm = new ClipMap(setup.bsp);
const q = async (s) => (await db.query(s, [], { rowMode: 'array' })).rows;
const pe = (await q('SELECT ent_id FROM player WHERE id = 1'))[0][0];
check(cm.hasWater === ((await q('SELECT has_water FROM game'))[0][0] === 1), `the clip map sees water in the map as the game does (${cm.hasWater})`);

// ── the traces on their own ──
const start = (await q(`SELECT x, y, z FROM ents WHERE id = ${pe}`))[0];
const down = trace(cm, [-16, -16, -24], [16, 16, 32], start, [start[0], start[1], start[2] - 64], MASK_PLAYERSOLID);
check(down.fraction < 1 && down.fraction > 0 && down.normal[2] > 0.99 && start[2] - down.end[2] > 0 && start[2] - down.end[2] < 16, `the player's box traced down from the start hits the floor under it (${(start[2] - down.end[2]).toFixed(2)} down: the spawn stands a little up, the first tic drops it)`);
const sqlDown = (await q(`SELECT fraction, ex, ey, ez, nx, ny, nz FROM trace_move(${pe}, -16, -16, -24, 16, 16, 32, ${start[0]}, ${start[1]}, ${start[2]}, ${start[0]}, ${start[1]}, ${start[2] - 64}, ${MASK_PLAYERSOLID})`))[0];
check(near(down.fraction, sqlDown[0]) && near(down.end[2], sqlDown[3]) && near(down.normal[2], sqlDown[6]), 'the same trace in SQL gives the same fraction, end and normal');
const point = trace(cm, [0, 0, 0], [0, 0, 0], [start[0], start[1], start[2] + 10], [start[0], start[1], start[2] - 200], MASK_PLAYERSOLID);
const sqlPoint = (await q(`SELECT fraction, ez FROM trace_move(${pe}, 0, 0, 0, 0, 0, 0, ${start[0]}, ${start[1]}, ${start[2] + 10}, ${start[0]}, ${start[1]}, ${start[2] - 200}, ${MASK_PLAYERSOLID})`))[0];
check(point.fraction < 1 && near(point.fraction, sqlPoint[0]) && near(point.end[2], sqlPoint[1]), `a point trace too (the floor ${(start[2] + 10 - point.end[2]).toFixed(2)} under the eye)`);
const inside = trace(cm, [-16, -16, -24], [16, 16, 32], [start[0], start[1], start[2] - 40], [start[0], start[1], start[2] - 40], MASK_PLAYERSOLID);
check(inside.allsolid && inside.startsolid && inside.fraction === 0, 'a box in the floor is all solid');
const across = trace(cm, [-16, -16, -24], [16, 16, 32], start, [start[0] + 4000, start[1], start[2]], MASK_PLAYERSOLID);
const sqlAcross = (await q(`SELECT fraction, ex, ey, ez, nx, ny, nz, sflags FROM trace_move(${pe}, -16, -16, -24, 16, 16, 32, ${start[0]}, ${start[1]}, ${start[2]}, ${start[0] + 4000}, ${start[1]}, ${start[2]}, ${MASK_PLAYERSOLID})`))[0];
check(across.fraction < 1 && near(across.fraction, sqlAcross[0]) && near(across.end[0], sqlAcross[1]) && near(across.normal[0], sqlAcross[4]) && across.sflags === sqlAcross[7],
  `a long trace east stops at a wall where the SQL's does (${across.end[0].toFixed(2)}, the side's flags ${across.sflags})`);
const bx = traceBox([10, -5, -5], [20, 5, 5], [0, 0, 0], [30, 0, 0]);
check(near(bx.fraction, 10 / 30 - 0.03125 / 30) && bx.normal[0] === -1 && traceBox([10, -5, -5], [20, 5, 5], [15, 0, 0], [30, 0, 0]).startsolid && traceBox([10, -5, -5], [20, 5, 5], [0, 10, 0], [30, 10, 0]).fraction === 1,
  'a box: entered on its west face a hair early, a start inside is solid, a miss passes');
const bt = trace(cm, [-16, -16, -24], [16, 16, 32], start, [start[0] + 200, start[1], start[2]], MASK_PLAYERSOLID, { boxes: [{ mins: [start[0] + 18, start[1] - 20, start[2] - 30], maxs: [start[0] + 20, start[1] + 20, start[2] + 40], contents: 33554432 }] });
check(bt.fraction < 1 && bt.hit && bt.hit.contents === 33554432 && near(bt.end[0], start[0] + 2, 0.1), `a monster's box in the way stops the move at it, before the wall 21 on (${(bt.end[0] - start[0]).toFixed(1)} on)`);
const cv = clipVelocity([100, 0, -50], [0, 0, 1], 1);
check(cv.v[0] === 100 && cv.v[2] === 0 && cv.blocked === 1 && clipVelocity([100, 0, 0], [-1, 0, 0], 1).blocked === 2, 'ClipVelocity slides along the floor and says what blocked');
// the water: a point in demo1's pool is water to the SQL and to the clip map
const pool = (await q("SELECT l.minx, l.miny, l.minz, l.maxx, l.maxy, l.maxz FROM leaves l WHERE BIN_AND(l.contents, 32) <> 0 AND l.maxx - l.minx > 32 ORDER BY (l.maxx - l.minx) * (l.maxy - l.miny) DESC ROWS 1"))[0];
if (pool) {
  const px = (pool[0] + pool[3]) / 2, py = (pool[1] + pool[4]) / 2, pz = (pool[2] + pool[5]) / 2;
  const sqlC = (await q(`SELECT point_contents(${px}, ${py}, ${pz}) FROM rdb$database`))[0][0];
  check((cm.pointContents(px, py, pz) & 56) !== 0 && cm.pointContents(px, py, pz) === sqlC, `a point in the pool is water to both (contents ${sqlC})`);
  const wet = checkWater(cm, { x: px, y: py, z: pz, ducked: false });
  check(wet.waterlevel >= 1 && wet.watertype === 32, `the water level there is ${wet.waterlevel}, the type water`);
}

// ── the move, tic by tic against the SQL ──
// the usercmd as Input.read gives it: [tics, fwd, side, yaw_d, pitch_d, fire, jump, run, imp]
const RUN = [];
for (let i = 0; i < 200; i++) {
  let c = { fwd: 1, side: 0, yawd: 0, pitchd: 0, jump: 0, run: 1 };
  if (i >= 20 && i < 60) c.yawd = 2;
  if (i === 10) c.jump = 1;
  if (i >= 70 && i < 80) c.jump = -1;                 // a crouch
  if (i >= 80 && i < 95) c = { ...c, fwd: 0, side: 1 };
  if (i >= 95 && i < 105) c = { ...c, fwd: 0 };       // a stop
  if (i >= 105 && i < 120) c = { ...c, run: 0, pitchd: i % 2 ? 3 : -3 };
  if (i >= 120 && i < 160) c = { ...c, yawd: -3 };
  if (i >= 160) c = { ...c, fwd: -1, yawd: i % 7 === 0 ? 20 : 0 };
  if (i >= 150 && i % 25 === 0) c.jump = 1;
  RUN.push(c);
}
const solidsNow = async () => (await q("SELECT m.name, e.x, e.y, e.z, e.pitch, e.yaw, e.roll FROM ents e JOIN models m ON m.id = e.model_id WHERE e.solid = 4 AND m.name STARTING WITH '*'"))
  .map(([name, x, y, z, p, yw, r]) => ({ model: Number(name.slice(1)), origin: [x, y, z], angles: [p, yw, r] }));
const boxesNow = async () => (await q(`SELECT e.x + e.minx, e.y + e.miny, e.z + e.minz, e.x + e.maxx, e.y + e.maxy, e.z + e.maxz, IIF(e.st IN ('die', 'dead') OR e.health <= 0, 67108864, 33554432) FROM ents e WHERE e.solid IN (2, 3) AND e.id <> ${pe}`))
  .map(([x1, y1, z1, x2, y2, z2, c]) => ({ mins: [x1, y1, z1], maxs: [x2, y2, z2], contents: c }));
let last = await session.tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
check(typeof last.VX === 'number' && typeof last.ONGROUND === 'number' && typeof last.STEPZ === 'number' && typeof last.JUMP_RELEASED === 'number' && typeof last.NOCLIP === 'number' && typeof last.BOB_PITCH === 'number',
  'the tic row carries the move\'s state: the velocity, the ground flag, the step, the jump key, noclip, the bob\'s pitch');
const fields = ['x', 'y', 'z', 'viewZ', 'yaw', 'pitch', 'roll', 'vx', 'vy', 'vz', 'onground', 'ducked', 'stepz', 'waterlevel'];
const worst = Object.fromEntries(fields.map((f) => [f, 0]));
let worstTic = -1, jumped = false, ducked = false, stepped = false, wallHit = false, turned = 0;
const rows = [last];
const free = stateFromRow(last);
let freeDrift = 0;
for (let i = 0; i < RUN.length; i++) {
  const c = RUN[i];
  const world = { solids: await solidsNow(), boxes: await boxesNow(), gravity: 800 };
  const st = pmove(cm, stateFromRow(last), c, 0.05, world);
  pmove(cm, free, c, 0.05, world);
  const row = await session.tic([1, c.fwd, c.side, c.yawd, c.pitchd, 0, c.jump, c.run, 0]);
  rows.push(row);
  const got = { x: row.PX, y: row.PY, z: row.PZ, viewZ: row.VIEW_Z, yaw: row.YAW, pitch: row.PITCH - row.PUNCH, roll: row.ROLL, vx: row.VX, vy: row.VY, vz: row.VZ,
    onground: row.ONGROUND, ducked: row.DUCKED, stepz: row.STEPZ, waterlevel: row.WATERLEVEL };
  const mine = { x: st.view.x, y: st.view.y, z: st.view.z, viewZ: st.view.viewZ, yaw: st.view.yaw, pitch: st.view.pitch, roll: st.view.roll, vx: st.vx, vy: st.vy, vz: st.vz,
    onground: st.onground ? 1 : 0, ducked: st.ducked ? 1 : 0, stepz: st.stepz, waterlevel: st.waterlevel };
  for (const f of fields) {
    const d = f === 'yaw' ? Math.abs(((mine[f] - got[f]) % 360 + 540) % 360 - 180) : Math.abs(mine[f] - got[f]);
    if (d > worst[f]) { worst[f] = d; if (d > 1e-6) worstTic = i; }
  }
  if (!row.ONGROUND && last.ONGROUND) jumped = true;
  if (row.DUCKED) ducked = true;
  if (row.STEPZ > 0) stepped = true;
  if (c.fwd && Math.hypot(row.PX - last.PX, row.PY - last.PY) < 1 && last.ONGROUND) wallHit = true;
  if (!nearAngle(row.YAW, last.YAW, 0.5)) turned++;
  freeDrift = Math.max(freeDrift, Math.hypot(free.x - row.PX, free.y - row.PY, free.z - row.PZ));
  last = row;
}
const maxErr = Math.max(...fields.map((f) => worst[f]));
check(maxErr < 1e-6, `over ${RUN.length} tics the JS lands where the SQL lands, every tic, to the number (the largest difference ${maxErr.toExponential(1)}${worstTic >= 0 ? `, at tic ${worstTic}` : ''}: ${fields.map((f) => `${f} ${worst[f].toExponential(1)}`).join(', ')})`);
check(jumped && ducked && stepped && turned > 50, `the run jumped (${jumped}), ducked (${ducked}), climbed a step (${stepped}) and turned (${turned} tics)`);
const travelled = Math.hypot(last.PX - rows[0].PX, last.PY - rows[0].PY);
check(travelled > 100, `and went somewhere (${travelled.toFixed(0)} units from the start)`);
check(freeDrift < 1, `run free from the first row alone, the JS drifts from the SQL by at most ${freeDrift.toFixed(3)} units over the run`);

// ── the state's round trip: what the row carries is what the prediction starts from ──
const st0 = stateFromRow(last);
check(st0.x === last.PX && st0.vx === last.VX && st0.onground === !!last.ONGROUND && st0.ducked === !!last.DUCKED && st0.jumpReleased === !!last.JUMP_RELEASED && near(st0.pitch, last.PITCH - last.BOB_PITCH - last.PUNCH) && st0.stepz === last.STEPZ && st0.bobtime === last.BOBTIME,
  'stateFromRow takes the origin, velocity, flags, the raw pitch (the bob and the punch taken off), the step and the bob clock from the row');
const noclip = pmove(cm, { ...st0, noclip: true, onground: true, pitch: 0 }, { fwd: 1, side: 0, yawd: 0, pitchd: 0, jump: 1, run: 1 }, 0.05);
check(!noclip.onground && near(noclip.vz, 300) && near(noclip.z, st0.z + 15) && near(Math.hypot(noclip.vx, noclip.vy), 300), 'in noclip the move flies where the view points and rises on jump, through everything');

// ── p_view.c's cvars on the game row (bob_up, bob_pitch, bob_roll, run_pitch, run_roll): the JS bobs by the ones it is given, and
// lands on the SQL's view with the same ones; the defaults are Quake's
{
  const view = { bobUp: 0.01, bobPitch: 0.004, bobRoll: 0.001, runPitch: 0.01, runRoll: 0.02 };
  await db.exec(`UPDATE game SET bob_up = ${view.bobUp}, bob_pitch = ${view.bobPitch}, bob_roll = ${view.bobRoll}, run_pitch = ${view.runPitch}, run_roll = ${view.runRoll}`);
  let worstV = 0, moved = 0;
  for (let i = 0; i < 16; i++) {
    const c = { fwd: 1, side: i % 2 ? 1 : -1, yawd: 3, pitchd: 0, jump: 0, run: 1 };
    const world = { solids: await solidsNow(), boxes: await boxesNow(), gravity: 800, view };
    const st = pmove(cm, stateFromRow(last), c, 0.05, world);
    const row = await session.tic([1, c.fwd, c.side, c.yawd, c.pitchd, 0, c.jump, c.run, 0]);
    worstV = Math.max(worstV, Math.abs(st.view.viewZ - row.VIEW_Z), Math.abs(st.view.pitch - (row.PITCH - row.PUNCH)), Math.abs(st.view.roll - row.ROLL));
    moved = Math.max(moved, Math.abs(row.ROLL));
    last = row;
  }
  check(worstV < 1e-6 && moved > 1, `with the game row's view cvars changed and given to the JS, the eye, the pitch and the roll agree to the number over 16 tics (the largest difference ${worstV.toExponential(1)}, a roll of ${moved.toFixed(2)})`);
  check(VIEW_CVARS.bobUp === 0.005 && VIEW_CVARS.bobPitch === 0.002 && VIEW_CVARS.bobRoll === 0.002 && VIEW_CVARS.runPitch === 0.002 && VIEW_CVARS.runRoll === 0.005, 'the defaults are p_view.c\'s');
  await db.exec('UPDATE game SET bob_up = 0.005, bob_pitch = 0.002, bob_roll = 0.002, run_pitch = 0.002, run_roll = 0.005');
}

await db.close();
console.log(failures ? `${failures} FAILED` : 'all good');
process.exit(failures ? 1 : 0);
