// save-test.mjs – save, play on, load: the game comes back exactly and keeps running.
//   node scripts/save-test.mjs [map]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak } from '../src/pak.js';
import { createSchema, loadResources, loadMap, SQL_FILES } from '../src/loader.js';
import { exportSave, importSave } from '../src/savegame.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mapName = process.argv[2] ?? 'demo1';
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));
const db = new FirebirdBrowser('memory://quake2', { transport: new DirectTransport() });
await createSchema(db, sql);
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
const res = await loadResources(db, pak);
await loadMap(db, pak, res, mapName, { skill: 2 });

let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const tic = (fwd = 0, fire = 0, imp = 0) => db.query('SELECT * FROM q2_tic(1, ?, 0, 2, 0, ?, 0, 1, ?)', [fwd, fire, imp], { rowMode: 'object' }).then((r) => r.rows[0]);
const state = async () => {
  const p = (await db.query('SELECT e.x, e.y, e.z, e.yaw, e.health, p.bullets, p.shells, p.weapon, g.tic, g.time_, g.killed FROM player p JOIN ents e ON e.id = p.ent_id CROSS JOIN game g WHERE p.id = 1 AND g.id = 1')).rows[0];
  const n = (await db.query('SELECT COUNT(*) n, MAX(id) m FROM ents')).rows[0];
  const sorted = async (q) => (await db.query(q, [], { rowMode: 'array' })).rows.map((r) => r.join(':')).sort().join(' ');
  const m = await sorted('SELECT id, st, CAST(x AS INTEGER), CAST(y AS INTEGER), health FROM ents WHERE mtype IS NOT NULL');
  const d = await sorted("SELECT id, mv_state, CAST(z AS INTEGER) FROM ents WHERE classname LIKE 'func_%'");
  const ls = await sorted('SELECT style, pattern FROM lightstyles');
  return { ...p, N: n.N, M: n.M, monsters: m, movers: d, styles: ls };
};

// play: walk forward firing, give everything, switch to the machinegun, fire more
for (let i = 0; i < 20; i++) await tic(1, i % 3 === 0 ? 1 : 0, i === 5 ? 99 : i === 6 ? 4 : 0);
const before = await state();
const save = await exportSave(db, mapName);
const json = JSON.stringify(save);
check(save.tables.ents.rows.length === before.N, `save holds every entity (${before.N} rows, ${(json.length / 1024).toFixed(0)} KB of JSON)`);
check(!save.tables.ents.cols.includes('FACES_LST'), 'the frame caches are not in the save');

// play on, so the state drifts
for (let i = 0; i < 25; i++) await tic(1, 1, 0);
const drifted = await state();
check(drifted.TIC !== before.TIC && (drifted.X !== before.X || drifted.BULLETS !== before.BULLETS), 'the game moved on after the save');

// load: the map afresh, then the saved rows (as the page does: startMap, then importSave)
await loadMap(db, pak, res, mapName, { skill: 2 });
const t0 = performance.now();
await importSave(db, JSON.parse(json));
console.log(`     loaded in ${(performance.now() - t0).toFixed(0)} ms`);
const after = await state();
for (const k of ['X', 'Y', 'Z', 'YAW', 'HEALTH', 'BULLETS', 'SHELLS', 'WEAPON', 'TIC', 'TIME_', 'KILLED', 'N', 'M']) check(after[k] === before[k], `${k} restored (${after[k]})`);
check(after.monsters === before.monsters, 'every monster where and how it was');
check(after.movers === before.movers, 'every mover in its state');
check(after.styles === before.styles, 'the light styles');

// and the game goes on: new entities get fresh ids, a frame renders, nothing errors
for (let i = 0; i < 10; i++) await tic(1, 1, 0);
const later = await state();
check(later.TIC === before.TIC + 10, `ten more tics ran (tic ${later.TIC})`);
check(later.M > before.M || later.N >= before.N, `new entities got ids above the saved ones (max id ${later.M})`);
const faces = await db.query('SELECT * FROM frame_all(0, 0, 0, 1)', [], { rowMode: 'array' });
check(faces.rows.some((r) => r[0] === 1), `a frame renders after the load (${faces.rows.length} rows)`);
check((await db.query('SELECT COUNT(*) n FROM ents WHERE id IN (SELECT id FROM ents GROUP BY id HAVING COUNT(*) > 1)')).rows[0].N === 0, 'entity ids are unique');

console.log(failures ? `${failures} FAILED` : 'all good');
await db.close();
process.exit(failures ? 1 : 0);
