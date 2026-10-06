// probe.mjs – poke at the collision around a spot: traces down and sideways,
// then walk and report contents each tic. Debugging aid.
//
//   node scripts/probe.mjs [map] [x,y,z] [yaw]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak } from '../src/pak.js';
import { createSchema, loadResources, loadMap, SQL_FILES } from '../src/loader.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));
const db = new FirebirdBrowser('memory://q', { transport: new DirectTransport() });
await createSchema(db, sql);
const pak = new Pak(fs.readFileSync(path.join(root, 'public/pak/pak0.pak')).buffer);
const res = await loadResources(db, pak);
const mapName = process.argv[2] ?? 'demo1';
const bsp = await loadMap(db, pak, res, mapName, { skill: 2 });
const q = async (s) => (await db.query(s)).rows;
const start = bsp.entities.find((e) => e.classname === 'info_player_start');
const [sx, sy, sz] = (process.argv[3] ?? start.origin.split(' ').join(',')).split(',').map(Number);
const yaw = Number(process.argv[4] ?? start.angle ?? 0);
console.log('starts', bsp.entities.filter((e) => e.classname === 'info_player_start'));
const tr = async (x1, y1, z1, x2, y2, z2) => (await q(`SELECT fraction, ex, ey, ez, nx, ny, nz, contents, allsolid, startsolid, hit_ent FROM trace_move(NULL, -16,-16,-24,16,16,32, ${x1},${y1},${z1},${x2},${y2},${z2}, 33619971)`))[0];
console.log('down from spot', await tr(sx, sy, sz + 1, sx, sy, sz - 400));
for (const [dx, dy] of [[100, 0], [-100, 0], [0, 100], [0, -100]]) console.log(`sideways ${dx},${dy}`, await tr(sx, sy, sz + 1, sx + dx, sy + dy, sz + 1));
await db.exec(`UPDATE ents SET x = ${sx}, y = ${sy}, z = ${sz + 1}, yaw = ${yaw} WHERE id = (SELECT ent_id FROM player)`);
await db.exec('EXECUTE PROCEDURE link_ent((SELECT ent_id FROM player))');
const tic = (a) => db.query('SELECT * FROM q2_tic(?, ?, ?, ?, ?, ?, ?, ?, ?)', a).then((r) => r.rows[0]);
for (let i = 0; i < 16; i++) {
  const s = await tic([1, 1, 0, 0, 0, 0, 0, 1, 0]);
  const c = (await q(`SELECT point_contents(${s.PX}, ${s.PY}, ${s.PZ}) c, point_contents(${s.PX}, ${s.PY}, ${s.PZ} - 24.5) f FROM rdb$database`))[0];
  const lf = bsp.pointLeaf(s.PX, s.PY, s.PZ);
  console.log(i, s.PX.toFixed(1), s.PY.toFixed(1), s.PZ.toFixed(2), 'contents', c.C, 'under feet', c.F, 'cluster', s.CLUSTER, 'js leaf contents', bsp.leaves[lf].contents);
}
await db.close();
process.exit(0);
