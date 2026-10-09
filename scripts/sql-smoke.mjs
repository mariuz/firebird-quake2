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

// the looped sounds (s.sound) a frame lists: [ent, name]
const loopSounds = async () => (await db.query('SELECT i1, s FROM frame_all(0, 2147483647, 2147483647, 0) WHERE kind = 9', [], { rowMode: 'array' })).rows;

// open the first door by using it
const door = (await db.query("SELECT FIRST 1 id, x, y, z, mv_state FROM ents WHERE classname = 'func_door'")).rows[0];
if (door) {
  await db.exec(`EXECUTE PROCEDURE door_use(${door.ID}, ${(await db.query('SELECT ent_id FROM player')).rows[0].ENT_ID})`);
  await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
  const master = (await db.query(`SELECT m.id, m.noise2, m.mv_done FROM ents d JOIN ents m ON m.id = COALESCE(d.linked_id, d.id) WHERE d.id = ${door.ID}`)).rows[0];
  if (master.NOISE2 && master.MV_DONE) {
    const loops = await loopSounds();
    assert(loops.some(([e, n]) => e === master.ID && n === master.NOISE2), `a moving door loops its middle sound (${loops.map(([e, n]) => `${e}:${n}`).join(' ') || 'none'})`);
  }
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

// area portals: a closed door cuts the areas behind it off; opening it joins them, closing parts them again
{
  const portals = (await db.query("SELECT COUNT(*) n FROM ents WHERE classname = 'func_areaportal'")).rows[0].N;
  const floods = async () => (await db.query('SELECT COUNT(DISTINCT flood) n FROM area_flood')).rows[0].N;
  const d = (await db.query("SELECT FIRST 1 d.id FROM ents d JOIN ents a ON a.targetname = d.target AND a.classname = 'func_areaportal' WHERE d.classname IN ('func_door', 'func_door_rotating')")).rows[0]?.ID;
  console.log(`     ${portals} area portals, ${(await db.query('SELECT COUNT(*) n FROM areas')).rows[0].N} areas`);
  if (portals > 0 && d) {
    await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE door_hit_bottom(${d}); END`);   // (an earlier check may have opened it)
    const closed = await floods();
    assert(closed > 1, `with the door closed, the map falls into ${closed} groups of areas`);
    await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE door_use(${d}, player_ent()); END`);
    const open = await floods();
    assert(open < closed, `the door opening joins the areas it separates (${closed} → ${open} groups)`);
    assert((await db.query('SELECT vis_cluster FROM viewcfg')).rows[0].VIS_CLUSTER === null, 'the marked view is forgotten when a portal changes');
    assert((await db.query('SELECT COUNT(*) n FROM frame_all(0, 0, 0, 0) WHERE kind = 1')).rows[0].N > 0, 'the frame marks and draws again');
    await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE door_hit_bottom(${d}); END`);
    assert((await floods()) === closed, 'the door closing parts them again');
  } else console.log('     (no door targets an area portal on this map: skipping the portal checks)');
}

// cross-level flags: a target waits for a flag, a trigger sets it, the flag survives a level change and not a new game
{
  const secrets0 = (await db.query('SELECT found_secrets s FROM game')).rows[0].S;
  await db.query(`EXECUTE BLOCK AS DECLARE a INTEGER; DECLARE b INTEGER; DECLARE c INTEGER; DECLARE r INTEGER; BEGIN
    EXECUTE PROCEDURE spawn_ent('target_secret', 0, 0, 0) RETURNING_VALUES c;
    UPDATE ents e SET e.solid = 0, e.targetname = 'xl_fire' WHERE e.id = :c;
    EXECUTE PROCEDURE spawn_ent('target_crosslevel_target', 0, 0, 0) RETURNING_VALUES b;
    UPDATE ents e SET e.solid = 0, e.spawnflags = 2, e.target = 'xl_fire', e.targetname = 'xl_target', e.think = 'crosslevel_think', e.nextthink = now_() + 0.2e0 WHERE e.id = :b;
    EXECUTE PROCEDURE spawn_ent('target_crosslevel_trigger', 0, 0, 0) RETURNING_VALUES a;   -- (demo3 has one of its own: this one is found by its name)
    UPDATE ents e SET e.solid = 0, e.spawnflags = 2, e.targetname = 'xl_set' WHERE e.id = :a;
    EXECUTE PROCEDURE spawn_ent('trigger_relay', 0, 0, 0) RETURNING_VALUES r;
    UPDATE ents e SET e.solid = 0, e.target = 'xl_set', e.targetname = 'xl_relay' WHERE e.id = :r;
  END`);
  for (let i = 0; i < 8; i++) await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
  assert((await db.query('SELECT found_secrets s FROM game')).rows[0].S === secrets0, 'a crosslevel target waits while its flag is unset');
  assert((await db.query("SELECT COUNT(*) n FROM ents WHERE targetname = 'xl_target'")).rows[0].N === 1, '... and stays');
  await db.query("EXECUTE BLOCK AS DECLARE r INTEGER; BEGIN SELECT e.id FROM ents e WHERE e.targetname = 'xl_relay' INTO r; EXECUTE PROCEDURE use_targets(r, player_ent()); END");
  assert((await db.query('SELECT serverflags f FROM game')).rows[0].F === 2, 'using a crosslevel trigger sets its flag in the unit');
  assert((await db.query("SELECT COUNT(*) n FROM ents WHERE targetname = 'xl_set'")).rows[0].N === 0, '... and the trigger is spent');
  await db.query("EXECUTE BLOCK AS DECLARE b INTEGER; BEGIN SELECT e.id FROM ents e WHERE e.targetname = 'xl_target' INTO b; UPDATE ents e SET e.think = 'crosslevel_think', e.nextthink = now_() + 0.1e0 WHERE e.id = :b; END");
  for (let i = 0; i < 4; i++) await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
  assert((await db.query('SELECT found_secrets s FROM game')).rows[0].S === secrets0 + 1, 'with the flag set, the target fires its targets');
  await loadMap(db, pak, res, mapName, { skill: 2, newGame: false });
  assert((await db.query('SELECT serverflags f FROM game')).rows[0].F === 2, 'the flag survives a level change');
  await loadMap(db, pak, res, mapName, { skill: 2, newGame: true });
  assert((await db.query('SELECT serverflags f FROM game')).rows[0].F === 0, 'a new game clears the unit');
  assert((await db.query('SELECT COUNT(*) n FROM portal_state WHERE open_ = 1')).rows[0].N === 0, 'every area portal starts a map closed');
}

// leaving a level: the help computer's messages, a plain exit taken at once, a unit's end stopping at the intermission
{
  const { parseChangeMap } = await import('../src/levels.js');
  const pc = parseChangeMap('*demo2$base1');
  assert(pc.unitEnd && pc.map === 'demo2' && pc.spawn === 'base1' && pc.kind === 'map', 'a unit end with a spawn point parses');
  assert(parseChangeMap('victory.pcx').kind === 'pic' && parseChangeMap('ntro.cin+base1').then === 'base1', 'pictures and cinematics with a follow-on parse');

  const spawn = async (cls, set) => (await db.query(`EXECUTE BLOCK RETURNS (id INTEGER) AS BEGIN EXECUTE PROCEDURE spawn_ent('${cls}', 0, 0, 0) RETURNING_VALUES id; UPDATE ents e SET e.solid = 0, ${set} WHERE e.id = :id; SUSPEND; END`)).rows[0].ID;
  const use = (id) => db.query(`EXECUTE BLOCK AS DECLARE r INTEGER; BEGIN EXECUTE PROCEDURE spawn_ent('trigger_relay', 0, 0, 0) RETURNING_VALUES r;
    UPDATE ents e SET e.solid = 0, e.target = (SELECT t.targetname FROM ents t WHERE t.id = ${id}) WHERE e.id = :r; EXECUTE PROCEDURE use_targets(r, player_ent()); END`);
  const game = async () => (await db.query('SELECT exit_kind, next_map, intermission_time, help_msg, help_msg2, help_changed FROM game')).rows[0];

  const h0 = (await game()).HELP_CHANGED;
  await use(await spawn('target_help', "e.targetname = 'xh1', e.spawnflags = 1, e.message = 'Primary objective'"));
  await use(await spawn('target_help', "e.targetname = 'xh2', e.spawnflags = 0, e.message = 'Second line'"));
  let g = await game();
  assert(g.HELP_MSG === 'Primary objective' && g.HELP_MSG2 === 'Second line' && g.HELP_CHANGED === h0 + 2, 'target_help fills the help computer\'s two messages and counts the news');

  await use(await spawn('target_changelevel', "e.targetname = 'xc1', e.map = 'demo2$base1'"));
  g = await game();
  assert(g.EXIT_KIND === 1 && g.NEXT_MAP === 'demo2$base1' && g.INTERMISSION_TIME === null, 'a plain exit is taken at once, the map string kept as written');

  await loadMap(db, pak, res, mapName, { skill: 2, newGame: false });
  g = await game();
  assert(g.EXIT_KIND === 0 && g.HELP_MSG === 'Primary objective', 'the next level starts playing, the help computer keeps its messages');
  const mons = async () => (await db.query('SELECT LIST(CAST(x AS INTEGER) || CAST(y AS INTEGER), \',\') l FROM ents WHERE mtype IS NOT NULL')).rows[0].L;
  await use(await spawn('target_changelevel', "e.targetname = 'xc2', e.map = '*demo2$base1'"));
  let r = await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
  assert(r.INTERMISSION === 1 && r.EXIT_KIND === 0, 'a unit end stops at the intermission');
  const atSpot = (await db.query("SELECT COUNT(*) n FROM map_ents m JOIN ents e ON e.id = player_ent() WHERE m.classname = 'info_player_intermission' AND m.ox = e.x AND m.oy = e.y AND m.oz = e.z AND COALESCE(m.ayaw, m.angle, 0) = e.yaw")).rows[0].N;
  const spots = (await db.query("SELECT COUNT(*) n FROM map_ents WHERE classname = 'info_player_intermission'")).rows[0].N;
  assert(spots === 0 || atSpot === 1, `the player watches from an info_player_intermission (${spots} on this map), at its angles`);
  assert(r.VIEW_Z === r.PZ, 'with the eye at the spot itself (no view height)');
  const m0 = await mons();
  for (let i = 0; i < 10; i++) r = await tic([1, 1, 0, 0, 0, 0, 1, 1, 0]);
  assert((await mons()) === m0, 'the world holds still');
  assert(r.EXIT_KIND === 0, 'a button before five seconds does not leave');
  await db.exec('UPDATE game SET time_ = intermission_time + 6');
  r = await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
  assert(r.EXIT_KIND === 0, 'nor does waiting without one');
  r = await tic([1, 0, 0, 0, 0, 1, 0, 1, 0]);
  assert(r.EXIT_KIND === 1 && r.NEXT_MAP === '*demo2$base1', 'fire after five seconds leaves for the next unit');
  await loadMap(db, pak, res, mapName, { skill: 2, newGame: false });
  assert((await game()).INTERMISSION_TIME === null, 'the next level starts without the intermission');
}

// monsters: a combattarget is a point_combat to run to first; a held point makes it stand; a jump trigger throws it
{
  const row = async (id) => (await db.query(`SELECT st, goal_id, aiflags, combattarget, vx, vy, vz, flags FROM ents WHERE id = ${id}`)).rows[0];
  const mk = async (cls, set, x, y, z) => (await db.query(`EXECUTE BLOCK RETURNS (id INTEGER) AS BEGIN EXECUTE PROCEDURE spawn_ent('${cls}', ${x}, ${y}, ${z}) RETURNING_VALUES id; UPDATE ents e SET ${set} WHERE e.id = :id; SUSPEND; END`)).rows[0].ID;
  const think = (id) => db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE monster_think(${id}); END`);
  for (let i = 0; i < 30; i++) await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);   // (the map was just reloaded: let them think)
  const idles = (await db.query("SELECT COUNT(*) n FROM ents WHERE mtype IS NOT NULL AND st IN ('stand', 'walk') AND idle_time > 0")).rows[0].N;
  assert(idles > 0, `standing and walking monsters keep a 15–30 s idle-sound timer (${idles} have one)`);
  const m = (await db.query("SELECT FIRST 1 id, x, y, z FROM ents WHERE mtype IS NOT NULL AND health > 0 AND st IN ('stand', 'walk') ORDER BY id")).rows[0];
  const box = 'e.solid = 1, e.minx = -8, e.miny = -8, e.minz = -16, e.maxx = 8, e.maxy = 8, e.maxz = 16';
  const secrets0 = (await db.query('SELECT found_secrets s FROM game')).rows[0].S;
  await mk('target_secret', "e.solid = 0, e.targetname = 'xs_path'", 0, 0, 0);
  const p2 = await mk('point_combat', `${box}, e.targetname = 'xp2', e.spawnflags = 1`, m.X + 2000, m.Y, m.Z);
  const p1 = await mk('point_combat', `${box}, e.targetname = 'xp1', e.target = 'xp2', e.pathtarget = 'xs_path'`, m.X, m.Y, m.Z);
  await db.exec(`UPDATE ents SET combattarget = 'xp1' WHERE id = ${m.ID}`);
  await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE found_target(${m.ID}); END`);
  let e = await row(m.ID);
  assert(e.GOAL_ID === p1 && (e.AIFLAGS & 2) && e.COMBATTARGET === null && e.ST === 'run', 'a monster with a combattarget runs for its point_combat first');
  assert((await db.query(`SELECT targetname t FROM ents WHERE id = ${p1}`)).rows[0].T === null, '... and the point is taken');
  await think(m.ID);
  e = await row(m.ID);
  assert(e.GOAL_ID === p2 && (e.AIFLAGS & 2), 'touching the point sends it on to the next');
  assert((await db.query('SELECT found_secrets s FROM game')).rows[0].S === secrets0 + 1, "... and fires the point's pathtarget");
  await db.exec(`UPDATE ents SET x = (SELECT x FROM ents WHERE id = ${m.ID}), y = (SELECT y FROM ents WHERE id = ${m.ID}), z = (SELECT z FROM ents WHERE id = ${m.ID}) WHERE id = ${p2}`);
  await think(m.ID);
  e = await row(m.ID);
  assert(e.GOAL_ID === null && (e.AIFLAGS & 2) === 0 && (e.AIFLAGS & 1), 'the last point, held, makes it stand its ground against the enemy');

  const j = (await db.query(`SELECT FIRST 1 id, x, y, z FROM ents WHERE mtype IS NOT NULL AND health > 0 AND id <> ${m.ID} AND BIN_AND(flags, 3) = 0 ORDER BY id`)).rows[0];
  await db.exec(`UPDATE ents SET st = 'run', flags = BIN_OR(flags, 512), vx = 0, vy = 0, vz = 0, nextthink = (SELECT time_ FROM game) + 100 WHERE id = ${j.ID}`);
  await mk('trigger_monsterjump', 'e.solid = 1, e.minx = -64, e.miny = -64, e.minz = -64, e.maxx = 64, e.maxy = 64, e.maxz = 64, e.speed = 200, e.height = 250, e.p1x = 0, e.p1y = 1', j.X, j.Y, j.Z);
  await db.query('EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE run_physics(0.05); END');
  e = await row(j.ID);
  assert(Math.abs(e.VX) < 1e-6 && e.VY === 200 && e.VZ === 250 && (e.FLAGS & 512) === 0, `a monster jump trigger throws a running monster the trigger's way (v ${e.VX.toFixed(1)} ${e.VY} ${e.VZ})`);
}

// movers: what a blocked train or door does, func_water's defaults, a func_object that drops, a func_killbox
{
  const one = async (q) => (await db.query(q)).rows[0];
  const mk = async (cls, set, x, y, z) => (await db.query(`EXECUTE BLOCK RETURNS (id INTEGER) AS BEGIN EXECUTE PROCEDURE spawn_ent('${cls}', ${x}, ${y}, ${z}) RETURNING_VALUES id; UPDATE ents e SET ${set} WHERE e.id = :id; SUSPEND; END`)).rows[0].ID;
  const train = await one("SELECT FIRST 1 id, dmg, spawnflags sf FROM ents WHERE classname = 'func_train' ORDER BY id");
  if (train) {
    assert(train.DMG === ((train.SF & 4) ? 0 : 100), `a train deals 100 when blocked, none with TRAIN_BLOCK_STOPS (dmg ${train.DMG}, spawnflags ${train.SF})`);
    if (train.DMG > 0) {
      const item = await mk('item_health', 'e.solid = 1, e.minx = -16, e.miny = -16, e.minz = -16, e.maxx = 16, e.maxy = 16, e.maxz = 16', 0, 0, 0);
      const fx0 = (await one('SELECT COUNT(*) n FROM fx_events')).N;
      await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE mover_blocked(${train.ID}, ${item}); END`);
      assert((await one(`SELECT COUNT(*) n FROM ents WHERE id = ${item}`)).N === 0 && (await one('SELECT COUNT(*) n FROM fx_events')).N > fx0, 'a train blocked by an item blows it away');
      const mon = (await one("SELECT FIRST 1 id FROM ents WHERE mtype IS NOT NULL AND health > 0 ORDER BY id")).ID;
      await db.exec(`UPDATE ents SET health = 1000 WHERE id = ${mon}; UPDATE ents SET attack_finished = 0 WHERE id = ${train.ID};`);
      await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE mover_blocked(${train.ID}, ${mon}); EXECUTE PROCEDURE mover_blocked(${train.ID}, ${mon}); END`);
      assert((await one(`SELECT health h FROM ents WHERE id = ${mon}`)).H === 1000 - train.DMG, 'a train blocked by a monster hurts it once per half second');
    }
  }
  const water = await one("SELECT FIRST 1 id, dmg, wait_ w, spawnflags sf, noise1 FROM ents WHERE classname = 'func_water'");
  if (water) assert(water.DMG === 0 && (water.W !== -1 || (water.SF & 32)), `func_water: no damage, a toggle when its wait is -1 (wait ${water.W}, spawnflags ${water.SF}, sound ${water.NOISE1})`);
  // a func_object made of a func_wall's model, moved to open air beside the player: it drops after two frames and lands
  const wall = await one("SELECT FIRST 1 m.name, m.minx, m.miny, m.minz, m.maxx, m.maxy, m.maxz FROM ents e JOIN models m ON m.id = e.model_id WHERE e.classname = 'func_wall' ORDER BY e.id");
  if (wall) {
    const p = await one('SELECT x, y, z FROM ents WHERE id = (SELECT ent_id FROM player)');
    const cx = (wall.MINX + wall.MAXX) / 2, cy = (wall.MINY + wall.MAXY) / 2;
    let off = null;
    for (const [dx, dy] of [[160, 0], [-160, 0], [0, 160], [0, -160], [160, 160], [-160, -160], [160, -160], [-160, 160], [240, 0], [0, 240]]) {
      const ox = p.X + dx - cx, oy = p.Y + dy - cy, oz = p.Z + 96 - wall.MINZ;
      const t = await one(`SELECT fraction f, startsolid s FROM trace_move(NULL, ${wall.MINX}, ${wall.MINY}, ${wall.MINZ}, ${wall.MAXX}, ${wall.MAXY}, ${wall.MAXZ}, ${ox}, ${oy}, ${oz}, ${ox}, ${oy}, ${oz - 256}, 33685507)`);
      if (t.S === 0 && t.F > 0.1 && t.F < 1) { off = { ox, oy, oz }; break; }
    }
    if (off) {
      const obj = (await db.query(`EXECUTE BLOCK RETURNS (id INTEGER) AS BEGIN EXECUTE PROCEDURE spawn_ent('func_object', ${off.ox}, ${off.oy}, ${off.oz}) RETURNING_VALUES id;
        EXECUTE PROCEDURE set_model(id, '${wall.NAME}'); EXECUTE PROCEDURE spawn_func_object(id, 0, 0); SUSPEND; END`)).rows[0].ID;
      for (let i = 0; i < 40; i++) await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
      const o = await one(`SELECT z, flags, movetype FROM ents WHERE id = ${obj}`);
      await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
      const o2 = await one(`SELECT z FROM ents WHERE id = ${obj}`);
      assert(o.MOVETYPE === 6 && o.Z < off.oz - 8 && (o.FLAGS & 512) && o2.Z === o.Z, `a func_object drops and comes to rest (z ${off.oz.toFixed(0)} → ${o.Z.toFixed(1)})`);
    } else console.log('     (no open spot beside the player for the func_object check)');
  }
  const victim = await one("SELECT FIRST 1 id, x, y, z FROM ents WHERE mtype IS NOT NULL AND health > 0 ORDER BY id DESC");
  await mk('func_killbox', `e.solid = 0, e.targetname = 'xkill', e.minx = -40, e.miny = -40, e.minz = -40, e.maxx = 40, e.maxy = 40, e.maxz = 80`, victim.X, victim.Y, victim.Z);
  await db.query("EXECUTE BLOCK AS DECLARE r INTEGER; BEGIN EXECUTE PROCEDURE spawn_ent('trigger_relay', 0, 0, 0) RETURNING_VALUES r; UPDATE ents e SET e.solid = 0, e.target = 'xkill' WHERE e.id = :r; EXECUTE PROCEDURE use_targets(r, player_ent()); END");
  const v = await one(`SELECT health h FROM ents WHERE id = ${victim.ID}`);
  assert(!v || v.H <= 0, 'a func_killbox kills what is inside it when used');
}

// a shot into water: a splash at the surface in the water's colour, and a bubble trail under it
{
  const one = async (q) => (await db.query(q)).rows[0];
  const leaves = (await db.query('SELECT FIRST 40 id, contents c, (minx + maxx) / 2 cx, (miny + maxy) / 2 cy, maxz FROM leaves WHERE BIN_AND(contents, 56) <> 0 ORDER BY maxx - minx DESC')).rows;
  let done = false;
  for (const l of leaves) {
    const sx = l.CX, sy = l.CY, sz = l.MAXZ + 24;
    if ((await one(`SELECT point_contents(${sx}, ${sy}, ${sz}) c FROM rdb$database`)).C !== 0) continue;
    const t = await one(`SELECT fraction f, ez, contents c FROM trace_move(NULL, 0, 0, 0, 0, 0, 0, ${sx}, ${sy}, ${sz}, ${sx}, ${sy}, ${sz - 128}, 100663355)`);
    if (t.F >= 1 || (t.C & 56) === 0) continue;
    const id0 = (await one('SELECT COALESCE(MAX(id), 0) m FROM fx_events')).M;
    await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE fire_bullets(player_ent(), 1, ${sx}, ${sy}, ${sz}, 0, 0, -1, 0, 0, 4, 2); END`);
    const fxs = (await db.query(`SELECT kind, z, z2, n FROM fx_events WHERE id > ${id0} ORDER BY id`)).rows;
    const splash = fxs.find((r) => r.KIND === 7), bubbles = fxs.find((r) => r.KIND === 14);
    const want = (l.C & 32) ? 2 : (l.C & 16) ? 4 : 5;
    assert(splash && (splash.N & 7) === want && Math.abs(splash.Z - t.EZ) < 1, `a shot into ${want === 2 ? 'water' : want === 4 ? 'slime' : 'lava'} splashes at the surface (z ${splash?.Z?.toFixed(1)})`);
    assert(bubbles && bubbles.Z2 < bubbles.Z, '... and leaves a bubble trail down from it');
    done = true;
    break;
  }
  if (!done) console.log('     (no open water surface found for the splash check)');
}

// crouching and the view's bob
{
  const one = async (q) => (await db.query(q)).rows[0];
  const me = async () => one('SELECT e.id, e.x, e.y, e.z, e.maxz, e.flags, p.view_ofs, p.ducked, p.bobtime, p.bob_z FROM ents e JOIN player p ON p.ent_id = e.id WHERE p.id = 1');
  // face the longest clear run from where the player stands
  const face = async () => {
    const p = await me();
    let best = null;
    for (let yaw = 0; yaw < 360; yaw += 45) {
      const dx = Math.cos(yaw * Math.PI / 180), dy = Math.sin(yaw * Math.PI / 180);
      const t = await one(`SELECT fraction f FROM trace_move(${p.ID}, -16, -16, -24, 16, 16, 32, ${p.X}, ${p.Y}, ${p.Z}, ${p.X + dx * 400}, ${p.Y + dy * 400}, ${p.Z}, 33619971)`);
      if (!best || t.F > best.f) best = { yaw, f: t.F };
    }
    await db.exec(`UPDATE ents SET yaw = ${best.yaw}, vx = 0, vy = 0 WHERE id = ${p.ID}; UPDATE player SET pitch = 0 WHERE id = 1;`);
    return best;
  };
  for (let i = 0; i < 4; i++) await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
  const run = await face();
  let r = await tic([1, 0, 0, 0, 0, 0, -1, 1, 0]);
  let m = await me();
  assert(m.DUCKED === 1 && m.MAXZ === 4 && m.VIEW_OFS === -2 && Math.abs(r.VIEW_Z - (r.PZ - 2)) < 0.01, `crouching ducks: the box 4 high, the eye at -2 (view ${(r.VIEW_Z - r.PZ).toFixed(1)})`);
  const a = await me();
  for (let i = 0; i < 20; i++) r = await tic([1, 1, 0, 0, 0, 0, -1, 1, 0]);   // (a tic is 0.05 s)
  const b = await me();
  const ducked = Math.hypot(b.X - a.X, b.Y - a.Y);
  assert(b.DUCKED === 1 && ducked > (run.f > 0.5 ? 50 : 10) && ducked <= 101, `ducked, it moves at 100 units a second at most (${ducked.toFixed(0)} in a second)`);
  // a low ceiling: a door's or wall's model put 20 units over the player's origin keeps it ducked
  // (the first of them that a trace down through the copy's middle hits: some func_walls are not solid)
  const c = await me();
  let ceil = null;
  const models = (await db.query("SELECT FIRST 12 m.name, m.minx, m.miny, m.minz, m.maxx, m.maxy, m.maxz FROM ents e JOIN models m ON m.id = e.model_id WHERE e.classname IN ('func_door', 'func_wall') AND m.maxx - m.minx >= 40 AND m.maxy - m.miny >= 40 ORDER BY e.id")).rows;
  for (const w of models) {
    const id = (await db.query(`EXECUTE BLOCK RETURNS (id INTEGER) AS BEGIN EXECUTE PROCEDURE spawn_ent('func_wall', ${c.X - (w.MINX + w.MAXX) / 2}, ${c.Y - (w.MINY + w.MAXY) / 2}, ${c.Z + 20 - w.MINZ}) RETURNING_VALUES id;
      EXECUTE PROCEDURE set_model(id, '${w.NAME}'); UPDATE ents e SET e.solid = 4, e.movetype = 0, e.mkind = 'B' WHERE e.id = :id; EXECUTE PROCEDURE link_ent(id); SUSPEND; END`)).rows[0].ID;
    const t = await one(`SELECT hit_ent h FROM trace_move(${c.ID}, 0, 0, 0, 0, 0, 0, ${c.X}, ${c.Y}, ${c.Z + 20 + w.MAXZ - w.MINZ + 1}, ${c.X}, ${c.Y}, ${c.Z + 19}, 33619971)`);
    if (t.H === id) { ceil = id; break; }
    await db.exec(`DELETE FROM ents WHERE id = ${id}`);
  }
  if (ceil) {
    await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
    assert((await me()).DUCKED === 1, '... and stays ducked under a low ceiling when the key is let go');
    await db.exec(`DELETE FROM ents WHERE id = ${ceil}`);
  } else console.log('     (no solid brush model for the low-ceiling check)');
  r = await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
  m = await me();
  assert(m.DUCKED === 0 && m.MAXZ === 32 && m.VIEW_OFS === 22, '... and stands up once the box fits');
  // walking at full speed: the walk cycle runs and the eye bobs (at most 6 units); standing still it stops
  await face();
  let maxBob = 0;
  for (let i = 0; i < 12; i++) { r = await tic([1, 1, 0, 0, 0, 0, 0, 1, 0]); maxBob = Math.max(maxBob, r.VIEW_Z - r.PZ - 22); }
  m = await me();
  assert(m.BOBTIME > 0.5 && maxBob > 0.5 && maxBob <= 6.0001, `walking runs the bob cycle (bobtime ${m.BOBTIME.toFixed(2)}) and bobs the eye up to ${maxBob.toFixed(1)} units`);
  for (let i = 0; i < 12; i++) r = await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
  m = await me();
  assert(m.BOBTIME === 0 && m.BOB_Z === 0 && Math.abs(r.VIEW_Z - r.PZ - 22) < 0.01, `... and standing still stops it (bobtime ${m.BOBTIME}, xy speed ${r.XYSPEED?.toFixed(1)}, flags ${m.FLAGS}, water ${r.WATERLEVEL})`);
  // the ground holds from tic to tic while walking (PM_CatagorizePosition), so friction and acceleration act every tic
  await face();
  let grounded = 0, trail = '';
  for (let i = 0; i < 6; i++) { await tic([1, 1, 0, 0, 0, 0, 0, 1, 0]); const g = await me(); if (g.FLAGS & 512) grounded++; trail += ` ${g.Z.toFixed(1)}${g.FLAGS & 512 ? 'g' : 'a'}`; }
  assert(grounded === 6, `walking on a floor stays on the ground every tic (${grounded} of 6:${trail})`);
}

// choosing weapons (Cmd_Use_f, Use_Weapon, Cmd_WeapNext): the impulses are the weapons in item order
{
  const one = async (q) => (await db.query(q)).rows[0];
  const keep = await one('SELECT weapons, weapon, shells, bullets, cells FROM player WHERE id = 1');
  const use = async (imp) => { await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE player_impulse(${imp}); END`); return one('SELECT weapon, msg FROM player WHERE id = 1'); };
  await db.exec('UPDATE player SET weapons = 2047, weapon = 1, shells = 10, bullets = 50, cells = 100, grenades = 5, rockets = 5, slugs = 5, msg = NULL WHERE id = 1');
  let u = await use(7);
  assert(u.WEAPON === 64, 'impulse 7 (the page\'s 6) raises the grenade launcher');
  u = await use(6);
  assert(u.WEAPON === 32, 'impulse 6 (the page\'s G, "use grenades") raises the hand grenades');
  u = await use(11);
  assert(u.WEAPON === 1024, 'impulse 11 (the page\'s 0) raises the BFG10K');
  await db.exec('UPDATE player SET cells = 10, shells = 0 WHERE id = 1');
  u = await use(1); u = await use(11);
  assert(u.WEAPON === 1 && u.MSG === 'Not enough Cells for BFG10K.', `too few cells keep the BFG down (${u.MSG})`);
  u = await use(2);
  assert(u.WEAPON === 1 && u.MSG === 'No Shells for Shotgun.', `no shells, no shotgun (${u.MSG})`);
  await db.exec('UPDATE player SET weapons = 1 + 4 + 8 WHERE id = 1');
  u = await use(2);
  assert(u.WEAPON === 1 && u.MSG === 'Out of item: Shotgun', `a weapon not held is out of item (${u.MSG})`);
  u = await use(12);
  assert(u.WEAPON === 8, 'the next weapon passes over the super shotgun without shells to the machinegun');
  await db.exec('UPDATE player SET weapons = 1 WHERE id = 1');
  u = await use(12);
  assert(u.WEAPON === 1, '... and with nothing else held stays on the blaster');
  await db.exec(`UPDATE player SET weapons = ${keep.WEAPONS}, weapon = ${keep.WEAPON}, shells = ${keep.SHELLS}, bullets = ${keep.BULLETS}, cells = ${keep.CELLS}, msg = NULL WHERE id = 1`);
}

// the inventory: powerups wait there for their key (Pickup_Powerup, Use_Quad), power armour is switched on
// (Use_PowerArmor) and spends cells as CheckPowerArmor did, the pickup shows on the status bar, the selection moves
{
  const one = async (q) => (await db.query(q)).rows[0];
  const pe = (await one('SELECT ent_id e FROM player')).E;
  const keep = await one('SELECT weapons, weapon, shells, bullets, cells, grenades, armor, armor_type FROM player WHERE id = 1');
  const hp0 = (await one(`SELECT health h FROM ents WHERE id = ${pe}`)).H;
  const me = () => one('SELECT p.inv_quad, p.inv_shield, p.inv_screen, p.inv_sel, p.power_armor, p.quad_finished, p.cells, p.weapon, p.msg, g.time_ FROM player p CROSS JOIN game g WHERE p.id = 1');
  const spawn = async (cls, x = 0, y = 0, z = -4000) => (await db.query(`EXECUTE BLOCK RETURNS (id INTEGER) AS BEGIN EXECUTE PROCEDURE spawn_ent('${cls}', ${x}, ${y}, ${z}) RETURNING_VALUES id; UPDATE ents e SET e.solid = 0 WHERE e.id = :id; SUSPEND; END`)).rows[0].ID;
  const touch = (id) => db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE item_touch(${id}, ${pe}); END`);
  const exists = async (id) => (await one(`SELECT COUNT(*) n FROM ents WHERE id = ${id}`)).N === 1;
  const cmd = async (c, a = '') => { await db.query('SELECT msg FROM player_command(?, ?)', [c, a]); return (await me()).MSG; };
  await db.exec('UPDATE player SET inv_quad = 0, inv_invuln = 0, inv_silencer = 0, inv_breather = 0, inv_enviro = 0, inv_screen = 0, inv_shield = 0, quad_finished = 0, invincible_finished = 0, power_armor = 0, inv_sel = 7, weapons = 1, weapon = 1 WHERE id = 1');
  const q1 = await spawn('item_quad');
  await touch(q1);
  let r = await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
  let m = await me();
  assert(!(await exists(q1)) && m.INV_QUAD === 1 && r.QUAD === 0 && m.INV_SEL === 23 && r.PICKUP_ITEM === 23 && r.INV_SEL === 23,
    `a quad goes into the inventory unused, selected, and shows on the status bar (pickup ${r.PICKUP_ITEM}, selected ${r.INV_SEL})`);
  const q2 = await spawn('item_quad');
  await touch(q2);
  assert(await exists(q2) && (await me()).INV_QUAD === 1, '... and on hard a second one stays where it lies');
  await db.exec(`DELETE FROM ents WHERE id = ${q2}`);
  r = await tic([1, 0, 0, 0, 0, 0, 0, 1, 16]);
  m = await me();
  assert(r.QUAD === 1 && r.TIMER_ICON === 1 && r.TIMER >= 29 && r.TIMER <= 30 && m.INV_QUAD === 0 && m.INV_SEL === 7,
    `Q uses it: thirty seconds of quad on the timer (${r.TIMER}), the selection back on the blaster (${m.INV_SEL})`);
  r = await tic([1, 0, 0, 0, 0, 0, 0, 1, 16]);
  assert((await me()).MSG === 'Out of item: quad damage', `... and again: out of item (${(await me()).MSG})`);
  await db.exec('UPDATE player SET quad_finished = 0 WHERE id = 1');
  assert(await cmd('use', 'shells') === 'Item is not usable.' && await cmd('use', 'nothing') === 'unknown item: nothing', 'use answers for ammo and for what is no item');
  // power armour
  const ps = await spawn('item_power_shield');
  await touch(ps);
  await db.exec('UPDATE player SET cells = 0 WHERE id = 1');
  r = await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
  m = await me();
  assert(m.INV_SHIELD === 1 && r.POWER_ARMOR === 0 && r.INV_SEL === 6, 'a power shield is held, selected, and off until used');
  assert(await cmd('use', 'power shield') === 'No cells for power armor.' && (await me()).POWER_ARMOR === 0, '... no cells, no power');
  await db.exec('UPDATE player SET cells = 50 WHERE id = 1');
  r = await tic([1, 0, 0, 0, 0, 0, 0, 1, 13]);
  assert(r.POWER_ARMOR === 2, '... ENTER (invuse) switches the selected shield on');
  const at = async (ang, dmg) => {
    const p = await one(`SELECT x, y, z, yaw FROM ents WHERE id = ${pe}`);
    const a = (p.YAW + ang) * Math.PI / 180;
    const src = await spawn('info_null', p.X + Math.cos(a) * 100, p.Y + Math.sin(a) * 100, p.Z);
    await db.exec(`UPDATE ents SET health = 100 WHERE id = ${pe}; UPDATE player SET cells = 50 WHERE id = 1`);
    await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE t_damage(${pe}, ${src}, ${src}, ${dmg}, 0, 0); END`);
    await db.exec(`DELETE FROM ents WHERE id = ${src}`);
    const q = await one(`SELECT e.health h, p.cells c, p.armor a FROM ents e JOIN player p ON p.ent_id = e.id`);
    return { hurt: 100 - q.H, cells: 50 - q.C };
  };
  await db.exec('UPDATE player SET armor = 0, armor_type = 0 WHERE id = 1');
  let d = await at(180, 30);
  assert(d.hurt === 10 && d.cells === 10, `the shield takes two thirds of a blow from behind, a cell for two points (hurt ${d.hurt}, cells ${d.cells})`);
  await db.exec('UPDATE player SET inv_shield = 0, inv_screen = 1 WHERE id = 1');
  d = await at(180, 30);
  const back = d;
  d = await at(0, 30);
  assert(back.hurt === 30 && back.cells === 0 && d.hurt === 20 && d.cells === 10, `a screen stops nothing from behind (${back.hurt}) and a third from in front, a cell a point (${d.hurt}, ${d.cells})`);
  await db.exec(`UPDATE player SET cells = 0 WHERE id = 1; UPDATE ents SET health = ${hp0} WHERE id = ${pe}`);
  r = await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
  assert(r.POWER_ARMOR === 0 && (await me()).POWER_ARMOR === 0, '... and with the cells gone it switches itself off');
  // the selection, and weapons picked up
  await db.exec('UPDATE player SET inv_quad = 1, inv_breather = 1, inv_screen = 0, inv_sel = 7, weapons = 1 + 8, weapon = 1, bullets = 50, grenades = 0 WHERE id = 1');
  await tic([1, 0, 0, 0, 0, 0, 0, 1, 14]);
  const n1 = (await me()).INV_SEL;
  await tic([1, 0, 0, 0, 0, 0, 0, 1, 14]);
  const n2 = (await me()).INV_SEL;
  await tic([1, 0, 0, 0, 0, 0, 0, 1, 14]);
  const n3 = (await me()).INV_SEL;
  await tic([1, 0, 0, 0, 0, 0, 0, 1, 15]);
  const p1 = (await me()).INV_SEL;
  assert(n1 === 10 && n2 === 23 && n3 === 26 && p1 === 23, `] steps through the usable items held (${n1} ${n2} ${n3}), [ steps back (${p1})`);
  const list = (await db.query('SELECT idx, cnt FROM inventory_list', [], { rowMode: 'array' })).rows.map(([i, c]) => `${i}:${c}`).join(' ');
  assert(list.includes('7:1') && list.includes('10:1') && list.includes('19:50') && list.includes('23:1') && list.includes('26:1'), `the inventory screen lists what is held (${list})`);
  await db.exec('UPDATE player SET shells = 100 WHERE id = 1');
  const sg = await spawn('weapon_shotgun');
  await touch(sg);
  m = await me();
  const sg2 = await spawn('weapon_shotgun');
  await touch(sg2);
  assert(m.WEAPON === 2 && m.INV_SEL === 8 && !(await exists(sg2)), 'a new weapon is raised at once and selected; one already held is taken for its ammo even when full');
  await db.exec('UPDATE ents SET health = max_health WHERE id = ' + pe);
  const hl = await spawn('item_health');
  await touch(hl);
  const hsf = (await one(`SELECT spawnflags sf FROM ents WHERE id = ${hl}`)).SF;
  assert((await exists(hl)) && (hsf & 262144), 'health at full health stays, but its targets have fired (ITEM_TARGETS_USED)');
  await db.exec(`DELETE FROM ents WHERE id = ${hl}`);
  await db.exec(`UPDATE player SET weapons = ${keep.WEAPONS}, weapon = ${keep.WEAPON}, shells = ${keep.SHELLS}, bullets = ${keep.BULLETS}, cells = ${keep.CELLS},
    grenades = ${keep.GRENADES}, armor = ${keep.ARMOR}, armor_type = ${keep.ARMOR_TYPE}, inv_quad = 0, inv_breather = 0, power_armor = 0, inv_sel = 7, msg = NULL WHERE id = 1;
    UPDATE ents SET health = ${hp0} WHERE id = ${pe}`);
}

// muzzle flashes: a light for the frame (fx 15, its radius in n) from the player's gun and a monster's
{
  const one = async (q) => (await db.query(q)).rows[0];
  const keep = await one('SELECT weapon, weapons, bullets, silencer_shots FROM player WHERE id = 1');
  const flashes = async (id0) => (await db.query(`SELECT x, y, z, n FROM fx_events WHERE id > ${id0} AND kind = 15`)).rows;
  const top = async () => (await one('SELECT COALESCE(MAX(id), 0) m FROM fx_events')).M;
  const p = await one('SELECT e.x, e.y, e.z, e.yaw FROM ents e WHERE e.id = (SELECT ent_id FROM player)');
  let id0 = await top();
  await db.exec('UPDATE player SET weapon = 8, weapons = BIN_OR(weapons, 8), bullets = 50, attack_finished = 0, silencer_shots = 0, grenade_time = 0 WHERE id = 1');
  await db.query('EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE player_fire(1); END');
  let fl = await flashes(id0);
  const a = p.YAW * Math.PI / 180;
  const ex = p.X + Math.cos(a) * 18 + Math.sin(a) * 16, ey = p.Y + Math.sin(a) * 18 - Math.cos(a) * 16;
  assert(fl.length === 1 && fl[0].N >= 200 && fl[0].N < 232 && Math.hypot(fl[0].X - ex, fl[0].Y - ey) < 0.01,
    `a shot flashes a light of 200-231 (${fl[0]?.N}) 18 ahead of the player and 16 to the right`);
  id0 = await top();
  await db.exec('UPDATE player SET attack_finished = 0, silencer_shots = 5 WHERE id = 1');
  await db.query('EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE player_fire(1); END');
  fl = await flashes(id0);
  assert(fl.length === 1 && fl[0].N >= 100 && fl[0].N < 132, `... a silenced one 100-131 (${fl[0]?.N})`);
  const mon = await one("SELECT FIRST 1 e.id FROM ents e JOIN monster_types t ON t.name = e.mtype WHERE t.missile_kind IS NOT NULL AND e.health > 0 ORDER BY e.id");
  if (mon) {
    id0 = await top();
    await db.exec(`UPDATE ents SET enemy_id = (SELECT ent_id FROM player) WHERE id = ${mon.ID}`);
    await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE monster_missile(${mon.ID}); END`);
    fl = await flashes(id0);
    assert(fl.length === 1 && fl[0].N >= 200 && fl[0].N < 232, `a monster's shot flashes too (${fl[0]?.N})`);
    await db.exec(`UPDATE ents SET enemy_id = NULL WHERE id = ${mon.ID}`);
  }
  await db.exec(`UPDATE player SET weapon = ${keep.WEAPON}, weapons = ${keep.WEAPONS}, bullets = ${keep.BULLETS}, silencer_shots = ${keep.SILENCER_SHOTS}, attack_finished = 0 WHERE id = 1`);
}

// the player in water: the level is worked out wherever the player is put (a regression once left it
// at 0 for good: the check was skipped when the link position matched, and every move relinks)
{
  const one = async (q) => (await db.query(q)).rows[0];
  const pe = (await one('SELECT ent_id e FROM player')).E;
  const k0 = await one(`SELECT x, y, z FROM ents WHERE id = ${pe}`);
  const keep = { x: k0.X, y: k0.Y, z: k0.Z };
  const leaves = (await db.query('SELECT FIRST 20 (minx + maxx) / 2 cx, (miny + maxy) / 2 cy, maxz FROM leaves WHERE BIN_AND(contents, 32) <> 0 AND maxz - minz >= 64 ORDER BY (maxx - minx) * (maxy - miny) DESC')).rows;
  let spot = null;
  for (const l of leaves) {
    const z = l.MAXZ - 40;
    const c = await one(`SELECT point_contents(${l.CX}, ${l.CY}, ${z + 22}) c, point_contents(${l.CX}, ${l.CY}, ${z - 23}) f FROM rdb$database`);
    if (c.C & 32 && c.F & 32) { spot = { x: l.CX, y: l.CY, z }; break; }   // water from the feet to the eyes
  }
  if (spot) {
    const put = async (p) => { await db.exec(`UPDATE ents SET x = ${p.x}, y = ${p.y}, z = ${p.z}, vx = 0, vy = 0, vz = 0 WHERE id = ${pe}`); await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE link_ent(${pe}); END`); };
    await put(spot);
    let r = await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
    const st = await one(`SELECT e.flags f, e.health h, e.movetype mt, e.deadflag d, CAST(e.z AS INTEGER) z FROM ents e WHERE e.id = ${pe}`), fl = st.F;
    assert(r.WATERLEVEL === 3 && (fl & 8), `put under water, the player is in it to the eyes at once (level ${r.WATERLEVEL}, FL_INWATER; ${JSON.stringify(st)})`);
    for (let i = 0; i < 4; i++) r = await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
    assert(r.WATERLEVEL === 3, '... and stays so while it sinks and rests on the bottom');
    await put(keep);
    r = await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
    assert(r.WATERLEVEL === 0, '... and out of it once put back on dry land');
  } else console.log('     (no deep water on this map for the water level check)');
}

// a blaster bolt hitting a wall: the hit (fx 6) carries the bolt's way back as its direction, for the
// explode model and the sparks (TE_BLASTER)
{
  const one = async (q) => (await db.query(q)).rows[0];
  const p = await one('SELECT e.id, e.x, e.y, e.z FROM ents e WHERE e.id = (SELECT ent_id FROM player)');
  let dir = null;
  for (let yaw = 0; yaw < 360 && !dir; yaw += 30) {
    const dx = Math.cos(yaw * Math.PI / 180), dy = Math.sin(yaw * Math.PI / 180);
    const t = await one(`SELECT fraction f, hit_ent h FROM trace_move(${p.ID}, 0, 0, 0, 0, 0, 0, ${p.X}, ${p.Y}, ${p.Z + 16}, ${p.X + dx * 300}, ${p.Y + dy * 300}, ${p.Z + 16}, 100663299)`);
    if (t.F < 1 && t.F > 0.1 && t.H === 0) dir = [dx, dy];
  }
  if (dir) {
    const id0 = (await one('SELECT COALESCE(MAX(id), 0) m FROM fx_events')).M;
    await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE launch_bolt(${p.ID}, ${p.X}, ${p.Y}, ${p.Z + 16}, ${dir[0]}, ${dir[1]}, 0, 1000, 10, 8); END`);
    assert((await loopSounds()).some(([, n]) => n === 'misc/lasfly.wav'), 'a flying bolt loops misc/lasfly.wav');
    let hit = null;
    for (let i = 0; i < 10 && !hit; i++) { await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]); hit = await one(`SELECT FIRST 1 x2, y2, z2 FROM fx_events WHERE id > ${id0} AND kind = 6`); }
    assert(hit && Math.abs(hit.X2 + dir[0]) < 0.01 && Math.abs(hit.Y2 + dir[1]) < 0.01 && Math.abs(hit.Z2) < 0.01,
      `a bolt's hit on a wall points back along the bolt (${hit ? [hit.X2, hit.Y2, hit.Z2].map((v) => v.toFixed(2)).join(' ') : 'no hit'})`);
  } else console.log('     (no wall near for the bolt check)');
}

// the console's commands: god, notarget, noclip through a wall, give, kill
{
  const cmd = async (c, a = '') => (await db.query('SELECT msg FROM player_command(?, ?)', [c, a])).rows[0].MSG;
  const flags = async () => (await db.query('SELECT flags f FROM ents WHERE id = (SELECT ent_id FROM player)')).rows[0].F;
  assert((await cmd('god')) === 'godmode ON' && ((await flags()) & 16) !== 0, 'god turns godmode on');
  assert((await cmd('god')) === 'godmode OFF' && ((await flags()) & 16) === 0, '... and off');
  assert((await cmd('notarget')) === 'notarget ON' && ((await flags()) & 64) !== 0, 'notarget sets FL_NOTARGET');
  await cmd('notarget');
  // the nearest wall in one of eight directions, then noclip through it
  const p = (await db.query('SELECT e.x, e.y, e.z + 22 ez FROM ents e WHERE e.id = (SELECT ent_id FROM player)')).rows[0];
  let best = null;
  for (let yaw = 0; yaw < 360; yaw += 45) {
    const dx = Math.cos(yaw * Math.PI / 180), dy = Math.sin(yaw * Math.PI / 180);
    const t = (await db.query(`SELECT fraction f FROM trace_move(NULL, 0, 0, 0, 0, 0, 0, ${p.X}, ${p.Y}, ${p.EZ}, ${p.X + dx * 1024}, ${p.Y + dy * 1024}, ${p.EZ}, 1)`)).rows[0].F;
    if (!best || t < best.t) best = { yaw, t, dist: t * 1024 };
  }
  await db.exec(`UPDATE ents SET yaw = ${best.yaw} WHERE id = (SELECT ent_id FROM player); UPDATE player SET pitch = 0 WHERE id = 1;`);
  assert((await cmd('noclip')) === 'noclip ON', `noclip on, facing a wall ${best.dist.toFixed(0)} units away`);
  const tics = Math.ceil((best.dist + 80) / 15);
  for (let i = 0; i < tics; i++) await tic([1, 1, 0, 0, 0, 0, 0, 1, 0]);
  const q = (await db.query('SELECT e.x, e.y FROM ents e WHERE e.id = (SELECT ent_id FROM player)')).rows[0];
  const moved = Math.hypot(q.X - p.X, q.Y - p.Y);
  assert(moved > best.dist + 40, `noclip flies through the wall (${moved.toFixed(0)} units in ${tics} tics)`);
  assert((await cmd('noclip')) === 'noclip OFF', '... and noclip off');
  await db.exec('UPDATE player SET weapons = 1, bullets = 0, armor = 0 WHERE id = 1');
  await cmd('give', 'weapons');
  await cmd('give', 'ammo');
  await cmd('give', 'armor');
  const inv = (await db.query('SELECT weapons w, bullets b, max_bullets mb, armor a FROM player')).rows[0];
  assert(inv.W === 2047 && inv.B === inv.MB && inv.A === 200, 'give weapons, ammo and armor fill them');
  assert((await cmd('give', 'banana')).startsWith('unknown item'), 'give refuses what it does not know');
  await cmd('give', 'shells 7');
  await cmd('give', 'health 42');
  const g1 = (await db.query('SELECT p.shells s, e.health h FROM player p JOIN ents e ON e.id = p.ent_id')).rows[0];
  assert(g1.S === 7 && g1.H === 42, `give with a count sets it (shells ${g1.S}, health ${g1.H})`);
  await cmd('give', 'rockets');
  const r0 = (await db.query('SELECT rockets r FROM player')).rows[0].R;
  await cmd('give', 'rockets');
  assert((await db.query('SELECT rockets r FROM player')).rows[0].R === r0 + 5, 'give an ammo adds one pickup of it');
  await db.exec('UPDATE player SET inv_quad = 0');
  await cmd('give', 'quad damage');
  const g2 = (await db.query("SELECT p.inv_quad q, (SELECT COUNT(*) FROM ents WHERE classname = 'item_quad' AND x = e.x AND y = e.y) n FROM player p JOIN ents e ON e.id = p.ent_id")).rows[0];
  assert(g2.Q === 1 && g2.N === 0, `give by pickup name picks it up and leaves nothing behind (quad ${g2.Q})`);
  await cmd('god');
  await cmd('kill');
  const dead = await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
  assert(dead.HEALTH <= 0 && dead.DEAD === 1, 'kill kills, godmode or not');
  assert((await cmd('fly')).startsWith('unknown command'), 'an unknown command says so');
}

await db.close();
console.log(failed ? `${failed} FAILED` : 'all good');
process.exit(failed ? 1 : 0);
