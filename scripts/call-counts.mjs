// call-counts.mjs – how many times a tic calls each hot procedure. Loads the SQL with a
// call counter (a session context variable) at the top of each routine and runs 40 idle
// tics, then counts a few single operations.
//   node scripts/call-counts.mjs [map]
import fs from 'node:fs';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak } from '../src/pak.js';
import { createSchema, loadResources, loadMap, SQL_FILES } from '../src/loader.js';
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(`sql/${n}.sql`, 'utf8')]));
const bump = (name) => `RDB$SET_CONTEXT('USER_SESSION', '${name}', COALESCE(CAST(RDB$GET_CONTEXT('USER_SESSION', '${name}') AS INTEGER), 0) + 1);`;
function instrument(text, procs) {
  for (const p of procs) {
    // the real body: the last definition of the routine (the first may be a forward declaration)
    const re = new RegExp(`CREATE OR ALTER (?:PROCEDURE|FUNCTION) ${p} ?\\(`, 'g');
    let m, i = -1;
    while ((m = re.exec(text))) i = m.index;
    if (i < 0) throw new Error('no ' + p);
    const j = text.indexOf('\nBEGIN\n', i);
    text = text.slice(0, j + 7) + '  ' + bump(p) + '\n' + text.slice(j + 7);
  }
  return text;
}
sql.physics = instrument(sql.physics, ['rhc', 'clip_leaf', 'trace_hull', 'trace_move', 'trace_box', 'model_point_leaf', 'link_ent', 'move_step', 'fly_move', 'point_contents', 'test_position', 'check_water']);
sql.monsters = instrument(sql.monsters, ['monster_think', 'find_target', 'move_to_goal', 'push_move']);
sql.game = instrument(sql.game, ['visible']);
const db = new FirebirdBrowser('memory://s', { transport: new DirectTransport() });
await createSchema(db, sql);
const pak = new Pak(fs.readFileSync('public/pak/pak0.pak').buffer);
const res = await loadResources(db, pak);
await loadMap(db, pak, res, process.argv[2] ?? 'demo1', { skill: 2 });
const names = ['monster_think', 'find_target', 'visible', 'move_to_goal', 'move_step', 'fly_move', 'push_move', 'trace_move', 'trace_hull', 'trace_box', 'rhc', 'clip_leaf', 'model_point_leaf', 'point_contents', 'link_ent', 'test_position', 'check_water'];
const read = async () => (await db.query(`SELECT ${names.map((n) => `COALESCE(CAST(RDB$GET_CONTEXT('USER_SESSION', '${n}') AS INTEGER), 0) AS "${n.toUpperCase()}"`).join(', ')} FROM rdb$database`)).rows[0];
for (let i = 0; i < 20; i++) await db.query('SELECT * FROM q2_tic(1, 0, 0, 0, 0, 0, 0, 1, 0)');
const a = await read();
const N = 40;
const t0 = performance.now();
for (let i = 0; i < N; i++) await db.query('SELECT * FROM q2_tic(1, 0, 0, 0, 0, 0, 0, 1, 0)');
const ms = (performance.now() - t0) / N;
const b = await read();
console.log(`idle tic ${ms.toFixed(1)} ms (instrumented); calls per tic:`);
for (const n of names) console.log(`  ${n.padEnd(18)} ${((b[n.toUpperCase()] - a[n.toUpperCase()]) / N).toFixed(1)}`);
const w = (await db.query("SELECT FIRST 1 id, x, y, z FROM ents WHERE mtype IS NOT NULL AND st = 'walk'")).rows[0];
const diff = (p, q) => Object.fromEntries(names.filter((n) => q[n.toUpperCase()] - p[n.toUpperCase()]).map((n) => [n, q[n.toUpperCase()] - p[n.toUpperCase()]]));
let c = await read();
await db.query(`SELECT * FROM trace_move(${w.ID}, -16, -16, -24, 16, 16, 32, ${w.X}, ${w.Y}, ${w.Z + 18}, ${w.X}, ${w.Y}, ${w.Z - 18}, 33685507)`);
let d = await read();
console.log('one monster step-down trace:', diff(c, d));
await db.query(`SELECT * FROM trace_move(${w.ID}, 0, 0, 0, 0, 0, 0, ${w.X}, ${w.Y}, ${w.Z}, ${w.X + 2048}, ${w.Y}, ${w.Z}, 100663299)`);
c = await read();
console.log('one 2048 point trace:', diff(d, c));
await db.query(`SELECT move_step(${w.ID}, 3, 0, 0) FROM rdb$database`);
d = await read();
console.log('one move_step:', diff(c, d));
const pe = (await db.query('SELECT ent_id e FROM player')).rows[0].E;
await db.query('EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE player_think(0.05, 1, 0, 0, 0, 0, 0, 1, 0); END');
c = await read();
console.log('one player_think (walking):', diff(d, c));
c = await read();
await db.query(`SELECT l.cluster FROM leaves l WHERE l.id = point_leaf(${w.X}, ${w.Y}, ${w.Z})`);
d = await read();
console.log('SELECT ... WHERE l.id = point_leaf(...):', diff(c, d));
await db.query(`EXECUTE BLOCK RETURNS (c INTEGER) AS DECLARE lf INTEGER; BEGIN lf = point_leaf(${w.X}, ${w.Y}, ${w.Z}); SELECT l.cluster FROM leaves l WHERE l.id = :lf INTO c; SUSPEND; END`);
c = await read();
console.log('variable first:', diff(d, c));
await db.query(`SELECT point_contents(${w.X}, ${w.Y}, ${w.Z}) FROM rdb$database`);
d = await read();
console.log('point_contents:', diff(c, d));
process.exit(0);
