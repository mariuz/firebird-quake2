// sql-smoke.mjs – run the game's SQL against the real Firebird WASM engine
// in Node: load the PAK and a map, play some tics, render frames, assert.
//
//   PAK=path/to/pak0.pak node scripts/sql-smoke.mjs [map]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak } from '../src/pak.js';
import { createSchema, loadResources, loadMap, SQL_FILES } from '../src/loader.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pakPath = process.env.PAK ?? path.join(root, 'public/pak/pak0.pak');
const mapName = process.argv[2] ?? 'demo1';
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); failed++; } else console.log(`ok   ${msg}`);
}
const t = () => performance.now();
const db = new FirebirdBrowser('memory://quake2', { transport: new DirectTransport() });

let t0 = t();
await createSchema(db, sql);
console.log(`schema        ${(t() - t0).toFixed(0)} ms`);

const pak = new Pak(fs.readFileSync(pakPath).buffer);
t0 = t();
const res = await loadResources(db, pak);
console.log(`resources     ${(t() - t0).toFixed(0)} ms (${res.models.size} models)`);

t0 = t();
const bsp = await loadMap(db, pak, res, mapName, { skill: 2 });
console.log(`map ${mapName}     ${(t() - t0).toFixed(0)} ms`);

const counts = (await db.query(
  `SELECT (SELECT COUNT(*) FROM faces) f, (SELECT COUNT(*) FROM face_verts) fv, (SELECT COUNT(*) FROM leaves) l, (SELECT COUNT(*) FROM brushes) b,
          (SELECT COUNT(*) FROM nodes) n, (SELECT COUNT(*) FROM ents) e, (SELECT COUNT(*) FROM ents WHERE mtype IS NOT NULL) m,
          (SELECT COUNT(*) FROM ents WHERE cluster IS NULL AND solid <> 0) nolink
     FROM rdb$database`)).rows[0];
console.log(counts);
assert(counts.F > 0 && counts.L > 0 && counts.B > 0, 'map geometry loaded');
assert(counts.M > 0, `monsters spawned (${counts.M})`);

const tic = (args) => db.query('SELECT * FROM q2_tic(?, ?, ?, ?, ?, ?, ?, ?, ?)', args).then((r) => r.rows[0]);
let s = await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
console.log('start', { x: s.PX, y: s.PY, z: s.PZ, yaw: s.YAW, leaf: s.LEAF, cluster: s.CLUSTER, health: s.HEALTH, msg: s.LEVEL_MSG });
assert(s.CLUSTER >= 0, 'player stands in a leaf with a cluster');
const start = { x: s.PX, y: s.PY, z: s.PZ };

t0 = t();
for (let i = 0; i < 20; i++) s = await tic([1, 1, 0, 0, 0, 0, 0, 1, 0]);
console.log(`20 tics walking ${(t() - t0).toFixed(0)} ms`, { x: s.PX, y: s.PY, z: s.PZ });
const moved = Math.hypot(s.PX - start.x, s.PY - start.y);
assert(moved > 50, `player walked forward (${moved.toFixed(1)} units)`);
assert(Math.abs(s.PZ - start.z) < 64, `player stayed on the floor (dz ${(s.PZ - start.z).toFixed(1)})`);

// turn around and walk into the wall behind: we must stop, not pass through
await tic([1, 0, 0, 180, 0, 0, 0, 1, 0]);
let last = s;
for (let i = 0; i < 60; i++) { last = s; s = await tic([1, 1, 0, 0, 0, 0, 0, 1, 0]); }
const c = (await db.query(`SELECT point_contents(${s.PX}, ${s.PY}, ${s.PZ}) c FROM rdb$database`)).rows[0].C;
assert((c & 1) === 0, `player is not inside a wall after walking into one (contents ${c})`);

await tic([1, 0, 0, 180, 0, 0, 0, 1, 0]);   // face the open hall again
t0 = t();
s = await tic([1, 0, 0, 0, 0, 1, 0, 1, 0]);
console.log(`fire            ${(t() - t0).toFixed(0)} ms`);
const bolts = (await db.query("SELECT COUNT(*) n FROM ents WHERE classname = 'bolt'")).rows[0].N;
assert(bolts === 1, 'the blaster launched a bolt');
const fired = (await db.query("SELECT COUNT(*) n FROM sound_events WHERE snd = 'weapons/blastf1a.wav'")).rows[0].N;
assert(fired > 0, 'firing queued the blaster sound');
for (let i = 0; i < 20; i++) s = await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
assert((await db.query("SELECT COUNT(*) n FROM ents WHERE classname = 'bolt'")).rows[0].N === 0, 'the bolt hit something and is gone');

for (let i = 0; i < 3; i++) {
  t0 = t();
  const faces = await db.query('SELECT * FROM frame_faces_fast', [], { rowMode: 'array' });
  const t1 = t();
  const ents = await db.query('SELECT * FROM frame_ents', [], { rowMode: 'array' });
  const t2 = t();
  const full = await db.query('SELECT * FROM frame_faces', [], { rowMode: 'array' });
  const t3 = t();
  console.log(`frame ${i}: ${faces.rows.length} faces in ${(t1 - t0).toFixed(0)} ms, ${ents.rows.length} ents in ${(t2 - t1).toFixed(0)} ms, ${full.rows.length} vertex rows in ${(t3 - t2).toFixed(0)} ms`);
  if (i === 0) assert(faces.rows.length > 20, `the frame has faces (${faces.rows.length})`);
  await tic([1, 0, 0, 45, 0, 0, 0, 1, 0]);
}

// a full turn: every heading has geometry
for (let a = 0; a < 4; a++) {
  await tic([1, 0, 0, 90, 0, 0, 0, 1, 0]);
  const r = (await db.query('SELECT COUNT(*) c FROM frame_faces_fast')).rows[0].C;
  assert(r > 10, `heading +${(a + 1) * 90}°: ${r} faces`);
}

// monsters think: run 40 tics and see that the state machine runs without error
t0 = t();
for (let i = 0; i < 20; i++) s = await tic([2, 0, 0, 0, 0, 0, 0, 1, 0]);
console.log(`40 tics idle    ${(t() - t0).toFixed(0)} ms`);
const mon = (await db.query("SELECT st, COUNT(*) n FROM ents WHERE mtype IS NOT NULL GROUP BY st")).rows;
console.log('monster states', mon);

// cheat, then rocket the floor: radius damage must hurt us
s = await tic([1, 0, 0, 0, 0, 0, 0, 1, 99]);
assert(s.ROCKETS === 50, 'impulse 99 gave ammo');
s = await tic([1, 0, 0, 0, 0, 0, 0, 1, 8]);
assert(s.WEAPON === 128, `switched to the rocket launcher (weapon ${s.WEAPON})`);
for (let i = 0; i < 7; i++) s = await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
s = await tic([1, 0, 0, 0, 85, 1, 0, 1, 0]);
for (let i = 0; i < 20; i++) s = await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
assert(s.HEALTH < 100, `rocket at our feet hurt us (health ${s.HEALTH})`);

// open the first door by using it
const door = (await db.query("SELECT FIRST 1 id, x, y, z, mv_state FROM ents WHERE classname = 'func_door'")).rows[0];
if (door) {
  await db.exec(`EXECUTE PROCEDURE door_use(${door.ID}, ${(await db.query('SELECT ent_id FROM player')).rows[0].ENT_ID})`);
  for (let i = 0; i < 30; i++) await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
  const d2 = (await db.query(`SELECT x, y, z, mv_state FROM ents WHERE id = ${door.ID}`)).rows[0];
  assert(d2 && (Math.abs(d2.Z - door.Z) > 1 || Math.abs(d2.X - door.X) > 1 || Math.abs(d2.Y - door.Y) > 1), `door moved (state ${d2?.MV_STATE})`);
}

// every sound we queued exists in the pak
const snds = (await db.query('SELECT DISTINCT snd FROM sound_events')).rows.map((r) => r.SND);
const missing = snds.filter((n) => !pak.has('sound/' + n));
assert(missing.length === 0, `all queued sounds exist in the pak (${missing.join(', ') || 'none missing'})`);
// and every sound name in the SQL exists
const refs = [...new Set([...Object.values(sql).join('\n').matchAll(/'([a-z0-9_\/]+\.wav)'/g)].map((m) => m[1]))].filter((n) => n.includes('/'));
const missing2 = refs.filter((n) => !pak.has('sound/' + n));
assert(missing2.length === 0, `all referenced sounds exist in the pak (${missing2.join(', ') || 'none missing'})`);

// cross-level flags: a target waits for a flag, a trigger sets it, the flag survives a level change and not a new game
{
  const secrets0 = (await db.query('SELECT found_secrets s FROM game')).rows[0].S;
  await db.query(`EXECUTE BLOCK AS DECLARE a INTEGER; DECLARE b INTEGER; DECLARE c INTEGER; DECLARE r INTEGER; BEGIN
    EXECUTE PROCEDURE spawn_ent('target_secret', 0, 0, 0) RETURNING_VALUES c;
    UPDATE ents e SET e.solid = 0, e.targetname = 'xl_fire' WHERE e.id = :c;
    EXECUTE PROCEDURE spawn_ent('target_crosslevel_target', 0, 0, 0) RETURNING_VALUES b;
    UPDATE ents e SET e.solid = 0, e.spawnflags = 2, e.target = 'xl_fire', e.targetname = 'xl_target', e.think = 'crosslevel_think', e.nextthink = now_() + 0.2e0 WHERE e.id = :b;
    EXECUTE PROCEDURE spawn_ent('target_crosslevel_trigger', 0, 0, 0) RETURNING_VALUES a;
    UPDATE ents e SET e.solid = 0, e.spawnflags = 2, e.targetname = 'xl_set' WHERE e.id = :a;
    EXECUTE PROCEDURE spawn_ent('trigger_relay', 0, 0, 0) RETURNING_VALUES r;
    UPDATE ents e SET e.solid = 0, e.target = 'xl_set', e.targetname = 'xl_relay' WHERE e.id = :r;
  END`);
  for (let i = 0; i < 8; i++) await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
  assert((await db.query('SELECT found_secrets s FROM game')).rows[0].S === secrets0, 'a crosslevel target waits while its flag is unset');
  assert((await db.query("SELECT COUNT(*) n FROM ents WHERE targetname = 'xl_target'")).rows[0].N === 1, '... and stays');
  await db.query("EXECUTE BLOCK AS DECLARE r INTEGER; BEGIN SELECT e.id FROM ents e WHERE e.targetname = 'xl_relay' INTO r; EXECUTE PROCEDURE use_targets(r, player_ent()); END");
  assert((await db.query('SELECT serverflags f FROM game')).rows[0].F === 2, 'using a crosslevel trigger sets its flag in the unit');
  assert((await db.query("SELECT COUNT(*) n FROM ents WHERE classname = 'target_crosslevel_trigger'")).rows[0].N === 0, '... and the trigger is spent');
  await db.query("EXECUTE BLOCK AS DECLARE b INTEGER; BEGIN SELECT e.id FROM ents e WHERE e.targetname = 'xl_target' INTO b; UPDATE ents e SET e.think = 'crosslevel_think', e.nextthink = now_() + 0.1e0 WHERE e.id = :b; END");
  for (let i = 0; i < 4; i++) await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
  assert((await db.query('SELECT found_secrets s FROM game')).rows[0].S === secrets0 + 1, 'with the flag set, the target fires its targets');
  await loadMap(db, pak, res, mapName, { skill: 2, newGame: false });
  assert((await db.query('SELECT serverflags f FROM game')).rows[0].F === 2, 'the flag survives a level change');
  await loadMap(db, pak, res, mapName, { skill: 2, newGame: true });
  assert((await db.query('SELECT serverflags f FROM game')).rows[0].F === 0, 'a new game clears the unit');
}

await db.close();
console.log(failed ? `${failed} FAILED` : 'all good');
process.exit(failed ? 1 : 0);
