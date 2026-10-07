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
  await cmd('god');
  await cmd('kill');
  const dead = await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
  assert(dead.HEALTH <= 0 && dead.DEAD === 1, 'kill kills, godmode or not');
  assert((await cmd('fly')).startsWith('unknown command'), 'an unknown command says so');
}

await db.close();
console.log(failed ? `${failed} FAILED` : 'all good');
process.exit(failed ? 1 : 0);
