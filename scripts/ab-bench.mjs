// ab-bench.mjs – A/B two SQL trees on the same machine at the same time: tics alternate between
// two databases, one loaded from each, so load noise hits both alike.
//   node scripts/ab-bench.mjs <other-sql-dir> [map] [--tics=N] [--walk] [--frame [--turn]]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak } from '../src/pak.js';
import { createSchema, loadResources, loadMap, SQL_FILES } from '../src/loader.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const other = args[0];
const map = args[1] ?? 'demo1';
const N = Number(process.argv.find((a) => a.startsWith('--tics='))?.slice(7) ?? 200);
const walk = process.argv.includes('--walk') ? 1 : 0;
const frame = process.argv.includes('--frame');   // time frame_all instead of the tic
const turn = process.argv.includes('--turn');     // ... with the view turning a little each frame
const pak = new Pak(fs.readFileSync(path.join(root, 'public/pak/pak0.pak')).buffer);
async function open(dir, name) {
  const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(dir, `${n}.sql`), 'utf8')]));
  const db = new FirebirdBrowser(`memory://${name}`, { transport: new DirectTransport() });
  await createSchema(db, sql);
  const res = await loadResources(db, pak);
  await loadMap(db, pak, res, map, { skill: 2, seed: 1 });
  return db;
}
const A = await open(other, 'a'), B = await open(path.join(root, 'sql'), 'b');
const q = frame ? 'SELECT * FROM frame_all(0, 0, 0, 0)' : `SELECT * FROM q2_tic(1, ${walk}, 0, ${walk ? 3 : 0}, 0, 0, 0, 1, 0)`;
const pre = turn ? 'UPDATE ents SET yaw = yaw + 0.7 WHERE id = (SELECT ent_id FROM player)' : null;
for (let i = 0; i < 20; i++) { await A.query(q); await B.query(q); }
const ta = [], tb = [];
for (let i = 0; i < N; i++) {
  if (pre) { await A.query(pre); await B.query(pre); }
  let t0 = performance.now(); await A.query(q); ta.push(performance.now() - t0);
  t0 = performance.now(); await B.query(q); tb.push(performance.now() - t0);
}
const stat = (ts) => { ts.sort((a, b) => a - b); const mean = ts.reduce((a, b) => a + b, 0) / ts.length; return `mean ${mean.toFixed(2)} median ${ts[ts.length >> 1].toFixed(2)} p90 ${ts[Math.floor(ts.length * 0.9)].toFixed(2)} ms`; };
console.log(`A (${other}): ${stat(ta)}`);
console.log(`B (sql/):     ${stat(tb)}`);
process.exit(0);
