// tic-bench.mjs – the cost of a tic over a stretch of play: mean and median of N idle tics
//   node scripts/tic-bench.mjs [map] [--tics=N] [--walk]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak } from '../src/pak.js';
import { createSchema, loadResources, loadMap, SQL_FILES } from '../src/loader.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const N = Number(process.argv.find((a) => a.startsWith('--tics='))?.slice(7) ?? 200);
const walk = process.argv.includes('--walk') ? 1 : 0;
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));
const db = new FirebirdBrowser('memory://quake2', { transport: new DirectTransport() });
await createSchema(db, sql);
const pak = new Pak(fs.readFileSync(path.join(root, 'public/pak/pak0.pak')).buffer);
const res = await loadResources(db, pak);
await loadMap(db, pak, res, args[0] ?? 'demo1', { skill: 2, seed: 1 });
const q = `SELECT * FROM q2_tic(1, ${walk}, 0, ${walk ? 3 : 0}, 0, 0, 0, 1, 0)`;
for (let i = 0; i < 20; i++) await db.query(q);
const ts = [];
for (let i = 0; i < N; i++) { const t0 = performance.now(); await db.query(q); ts.push(performance.now() - t0); }
ts.sort((a, b) => a - b);
const mean = ts.reduce((a, b) => a + b, 0) / N;
console.log(`${N} tics: mean ${mean.toFixed(2)} ms, median ${ts[N >> 1].toFixed(2)} ms, p90 ${ts[Math.floor(N * 0.9)].toFixed(2)} ms, max ${ts[N - 1].toFixed(1)} ms`);
console.log('monsters:', (await db.query("SELECT st, COUNT(*) n FROM ents WHERE mtype IS NOT NULL GROUP BY st")).rows.map((r) => `${r.ST.trim()} ${r.N}`).join(', '));
await db.close();
process.exit(0);
