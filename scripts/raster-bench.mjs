// raster-bench.mjs – where does the painter spend its time? Renders the same
// frames the screenshots use, many times, and reports the cost per stage.
//
//   node scripts/raster-bench.mjs [map] [--frames=N] [--size=640x480]
//   node --cpu-prof --cpu-prof-dir=/tmp/prof scripts/raster-bench.mjs   (then scripts/prof-summary.mjs)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak, loadColormap } from '../src/pak.js';
import { createSchema, loadResources, loadMap, SQL_FILES } from '../src/loader.js';
import { Renderer, lightPoint } from '../src/renderer.js';
import { Hud, viewFrame } from '../src/hud.js';
import { WEAPONS } from '../src/gamedata.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const mapName = args[0] ?? 'demo1';
const frames = Number(process.argv.find((a) => a.startsWith('--frames='))?.slice(9) ?? 40);
const size = process.argv.find((a) => a.startsWith('--size='))?.slice(7).split('x').map(Number);
const W = size?.[0] || 320, H = size?.[1] || 240;
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));
const stubCanvas = { width: W, height: H, getContext: () => ({ createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) };

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
const arr = { rowMode: 'array' };

// the viewpoints: the spawn looking around, like the screenshots, plus a spot by the doors
const spots = mapName === 'demo1'
  ? [[140, -338, 24, 135], [140, -338, 24, 225], [140, -338, 24, 315], [300, 480, -80, 90], [-1500, 1536, 100, 180]]
  : [null, null, null];
const scenes = [];
for (const sp of spots) {
  if (sp) await db.exec(`UPDATE ents SET x = ${sp[0]}, y = ${sp[1]}, z = ${sp[2]}, yaw = ${sp[3]}, vx = 0, vy = 0, vz = 0 WHERE id = (SELECT ent_id FROM player); EXECUTE PROCEDURE link_ent((SELECT ent_id FROM player));`);
  const last = (await db.query('SELECT * FROM q2_tic(1, 0, 0, 0, 0, 0, 0, 1, 0)', [], { rowMode: 'object' })).rows[0];
  const faces = (await db.query('SELECT * FROM frame_faces_fast', [], arr)).rows;
  const ents = (await db.query('SELECT * FROM frame_ents', [], arr)).rows;
  const styles = new Float32Array(64);
  for (const [s, v] of (await db.query('SELECT * FROM frame_lightstyles', [], arr)).rows) if (s < 64) styles[s] = v;
  scenes.push({ last, faces, ents, styles });
}
await db.close();

const t = { world: 0, ents: 0, weapon: 0, particles: 0, hud: 0, present: 0, total: 0 };
const now = () => performance.now();
let faceRows = 0, triCount = 0;
const cold = process.argv.includes('--cold');
function render(sc, time) {
  if (cold) renderer.surfCache.clear();
  const { last, faces, ents, styles } = sc;
  const r = renderer;
  const t0 = now();
  r.beginFrame({ x: last.PX, y: last.PY, z: last.VIEW_Z, yaw: last.YAW, pitch: last.PITCH, roll: 0, fov: 90 });
  r.drawFaceList(faces, styles, time, new Map(), new Map());
  const t1 = now();
  for (const e of ents) {
    const [, mid, frame, skin, x, y, z, pitch, yaw, roll, effects, alpha, kindRaw] = e;
    const m = res.models.get(mid);
    if (!m) continue;
    if (String(kindRaw).trim() === 'M') { r.drawAlias(m.mdl, frame, skin, [x, y, z], [pitch, yaw, roll], lightPoint(bsp, x, y, z + 8), { time, alpha: alpha === 1 }); triCount += m.mdl.numTris; }
    else r.drawSprite(m.spr, 0, [x, y, z], 255, false);
  }
  const t2 = now();
  if (r.particles.length < 200) r.spawnParticles('explosion', last.PX + 100, last.PY, last.PZ, 0);
  r.runParticles(0.05, time);
  r.drawParticles();
  const t3 = now();
  const wp = WEAPONS[last.WEAPON];
  const vm = wp && res.models.get(res.byName.get(wp.view));
  if (vm) {
    r.zb.fill(0, 0, r.w * r.h);
    r.drawAlias(vm.mdl, viewFrame(vm.mdl, last, time), 0, [last.PX, last.PY, last.VIEW_Z], [-last.PITCH, last.YAW, 0], 128, { near: 1, time });
    triCount += vm.mdl.numTris;
  }
  const t4 = now();
  hud.draw(r, last, time);
  const t5 = now();
  r.present(null);
  const t6 = now();
  t.world += t1 - t0; t.ents += t2 - t1; t.particles += t3 - t2; t.weapon += t4 - t3; t.hud += t5 - t4; t.present += t6 - t5; t.total += t6 - t0;
  faceRows += faces.length;
}
// warm up (surface cache, JIT)
for (let i = 0; i < 3; i++) for (const sc of scenes) render(sc, i * 0.05);
for (const k in t) t[k] = 0; faceRows = 0; triCount = 0;
let time = 1;
for (let i = 0; i < frames; i++) for (const sc of scenes) { render(sc, time); time += 0.05; }
const n = frames * scenes.length;
console.log(`${n} frames at ${W}x${H}, ${(faceRows / n).toFixed(0)} faces and ${(triCount / n).toFixed(0)} triangles a frame, surface cache ${renderer.surfCache.size}`);
for (const k in t) console.log(`${k.padEnd(10)} ${(t[k] / n).toFixed(2)} ms`);
process.exit(0);
