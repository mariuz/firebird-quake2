// ab-bench.mjs – A/B two SQL trees on the same machine at the same time: tics alternate between
// two databases, one loaded from each, so load noise hits both alike.
//   node scripts/ab-bench.mjs <other-sql-dir> [map] [--tics=N] [--walk]
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
const pak = new Pak(fs.readFileSync(path.join(root, 'public/pak/pak0.pak')).buffer);
async function open(dir, name) {
  const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(dir, `${n}.sql`), 'utf8')]));
  const db = new FirebirdBrowser(`memory://${name}`, { transport: new DirectTransport() });
  await createSchema(db, sql);
  const res = await loadResources(db, pak);
  await loadMap(db, pak, res, map, { skill: 2 });
  return db;
}
const A = await open(other, 'a'), B = await open(path.join(root, 'sql'), 'b');
const q = `SELECT * FROM q2_tic(1, ${walk}, 0, ${walk ? 3 : 0}, 0, 0, 0, 1, 0)`;
for (let i = 0; i < 20; i++) { await A.query(q); await B.query(q); }
const ta = [], tb = [];
for (let i = 0; i < N; i++) {
  let t0 = performance.now(); await A.query(q); ta.push(performance.now() - t0);
  t0 = performance.now(); await B.query(q); tb.push(performance.now() - t0);
}
const stat = (ts) => { ts.sort((a, b) => a - b); const mean = ts.reduce((a, b) => a + b, 0) / ts.length; return `mean ${mean.toFixed(2)} median ${ts[ts.length >> 1].toFixed(2)} p90 ${ts[Math.floor(ts.length * 0.9)].toFixed(2)} ms`; };
console.log(`A (${other}): ${stat(ta)}`);
console.log(`B (sql/):     ${stat(tb)}`);
process.exit(0);
