// screenshot.mjs – render frames headlessly: the SQL runs in Firebird WASM
// under Node, the painter runs against a stub canvas, and the frames are
// written as PNGs to docs/. Also a convenient end-to-end test.
//
//   node scripts/screenshot.mjs [map] [out-prefix] [--at=x,y,z,yaw] [--sql] [--compare] [--flash]
// (--flash: each frame lit by a muzzle flash's dynamic light, radius 216, where the player's gun is)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak, loadColormap } from '../src/pak.js';
import { createSchema, loadResources, loadMap, SQL_FILES } from '../src/loader.js';
import { Renderer, lightPoint } from '../src/renderer.js';
import { Hud, viewFrame } from '../src/hud.js';
import { WEAPONS } from '../src/gamedata.js';
import { png } from './png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const mapName = args[0] ?? 'demo1';
const prefix = args[1] ?? path.join(root, 'docs/screenshot');
const W = 320, H = 240;
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));

const stubCanvas = {
  width: W, height: H,
  getContext: () => ({
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData(img) { stubCanvas.image = img; },
  }),
};

const db = new FirebirdBrowser('memory://quake2', { transport: new DirectTransport() });
await createSchema(db, sql);
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
const res = await loadResources(db, pak, { width: W, height: H });
const bsp = await loadMap(db, pak, res, mapName, { skill: 2 });
const cm = loadColormap(pak);
const renderer = new Renderer(stubCanvas, { palette: cm.palette, colormap: cm.colormap, alphamap: cm.alphamap, pak });
renderer.setSize(W, H);
renderer.setResources(res);
renderer.setSky((await db.query('SELECT sky FROM game')).rows[0].SKY);
const hud = new Hud(pak);

const at = process.argv.find((a) => a.startsWith('--at='));
if (at) {
  const [x, y, z, yaw] = at.slice(5).split(',').map(Number);
  await db.exec(`UPDATE ents SET x = ${x}, y = ${y}, z = ${z}, yaw = ${yaw}, vx = 0, vy = 0, vz = 0 WHERE id = (SELECT ent_id FROM player)`);
  await db.exec('EXECUTE PROCEDURE link_ent((SELECT ent_id FROM player))');
}
const tic = (a) => db.query('SELECT * FROM q2_tic(?, ?, ?, ?, ?, ?, ?, ?, ?)', a, { rowMode: 'object' }).then((r) => r.rows[0]);
const arr = { rowMode: 'array' };
const useSql = process.argv.includes('--sql');
const compare = process.argv.includes('--compare');
const flash = process.argv.includes('--flash');

async function shot(name) {
  const last = await tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
  const t0 = performance.now();
  const faces = (await db.query(useSql ? 'SELECT * FROM frame_faces' : 'SELECT * FROM frame_faces_fast', [], arr)).rows;
  const facesFast = compare ? (await db.query('SELECT * FROM frame_faces_fast', [], arr)).rows : null;
  const ents = (await db.query('SELECT * FROM frame_ents', [], arr)).rows;
  const bents = (await db.query("SELECT e.id, e.frame, e.pitch, e.yaw, e.roll FROM ents e JOIN models m ON m.id = e.model_id WHERE m.kind = 'B'", [], arr)).rows;
  const styles = new Float32Array(64);
  for (const [s, v] of (await db.query('SELECT * FROM frame_lightstyles', [], arr)).rows) if (s < 64) styles[s] = v;
  const t1 = performance.now();
  const entFrames = new Map(), entAngles = new Map();
  for (const [id, f, p, y, r] of bents) { entFrames.set(id, f); if (p || y || r) entAngles.set(id, [p, y, r]); }
  const ya = last.YAW * Math.PI / 180;
  renderer.dlights = flash ? [{ x: last.PX + Math.cos(ya) * 18 + Math.sin(ya) * 16, y: last.PY + Math.sin(ya) * 18 - Math.cos(ya) * 16, z: last.PZ, r: 216 }] : [];
  renderer.beginFrame({ x: last.PX, y: last.PY, z: last.VIEW_Z, yaw: last.YAW, pitch: last.PITCH, roll: last.ROLL ?? 0, fov: 90 });
  if (useSql) renderer.drawFaces(faces, styles, last.TIME_, entFrames);
  else renderer.drawFaceList(faces, styles, last.TIME_, entFrames, entAngles);
  if (compare) {
    const sqlFb = renderer.fb.slice();
    renderer.beginFrame({ x: last.PX, y: last.PY, z: last.VIEW_Z, yaw: last.YAW, pitch: last.PITCH, roll: last.ROLL ?? 0, fov: 90 });
    renderer.drawFaceList(facesFast, styles, last.TIME_, entFrames, entAngles);
    let diff = 0;
    for (let i = 0; i < sqlFb.length; i++) if (sqlFb[i] !== renderer.fb[i]) diff++;
    console.log(`${name}: SQL-projected vs JS-projected frame differ in ${diff} of ${sqlFb.length} pixels (${facesFast.length} faces)`);
  }
  for (const e of ents) {
    const [, mid, frame, skin, x, y, z, pitch, yaw, roll, effects, alpha, kind] = e;
    const m = res.models.get(mid);
    if (!m) continue;
    if (String(kind).trim() === 'M') renderer.drawAlias(m.mdl, frame, skin, [x, y, z], [pitch, yaw + (effects & 1 ? (last.TIME_ * 100) % 360 : 0), roll], lightPoint(bsp, x, y, z), { time: last.TIME_, alpha: alpha === 1, glow: (e[13] & 4) !== 0 });
    else if (String(kind).trim() === 'S') renderer.drawSprite(m.spr, frame, [x, y, z]);
  }
  const wp = WEAPONS[last.WEAPON];
  const vm = wp && res.models.get(res.byName.get(wp.view));
  if (vm) { renderer.zb.fill(0); renderer.drawAlias(vm.mdl, viewFrame(vm.mdl, last, last.TIME_), 0, [last.PX, last.PY, last.VIEW_Z], [-last.PITCH, last.YAW, 0], lightPoint(bsp, last.PX, last.PY, last.VIEW_Z), { near: 1, minlight: true }); }
  if (last.WATERLEVEL >= 3) renderer.warpScreen(last.TIME_);   // RDF_UNDERWATER
  hud.draw(renderer, last, last.TIME_);
  if (last.CPRINT) hud.drawCenter(renderer, last.CPRINT, Math.floor(H * 0.3));
  renderer.present();
  const t2 = performance.now();
  console.log(`${name}: ${faces.length} face rows, ${ents.length} ents — queries ${(t1 - t0).toFixed(0)} ms, raster ${(t2 - t1).toFixed(0)} ms, at ${last.PX.toFixed(0)},${last.PY.toFixed(0)},${last.PZ.toFixed(0)} yaw ${last.YAW}`);
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  fs.writeFileSync(`${prefix}-${mapName}-${name}.png`, png(W, H, new Uint8Array(stubCanvas.image.data.buffer)));
}

await shot('0');
for (let i = 0; i < 2; i++) await tic([1, 0, 0, 90, 0, 0, 0, 1, 0]);
await shot('1');
for (let i = 0; i < 40; i++) await tic([1, 1, 0, 0, 0, 0, 0, 1, 0]);
await shot('2');
for (let i = 0; i < 2; i++) await tic([1, 0, 0, 90, 0, 0, 0, 1, 0]);
await shot('3');
await db.close();
process.exit(0);
