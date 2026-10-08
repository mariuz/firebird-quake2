// painter-test.mjs – the painter's surfaces, headless. Dynamic lights (R_MarkLights, R_AddDynamicLights,
// R_LightPoint): a light near a face brightens its surface by what is left of its radius, from either side
// of the plane, a face out of reach keeps its cached surface, lit surfaces are never cached. Mip levels
// (D_MipLevelForScale, R_DrawSurface's surfmip): the thresholds, a surface at a level, and a frame that
// draws its far walls from smaller images. The underwater warp (D_WarpScreen): pixels move by at most the
// table's amplitude, a flat picture stays flat, the wobble moves with time. Model lighting
// (R_AliasSetupLighting): ambient at most 128 and 192 with the shade, LIGHT_MIN, RF_MINLIGHT, RF_GLOW.
//   node scripts/painter-test.mjs [map]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak, loadColormap } from '../src/pak.js';
import { createSchema, loadResources, loadMap, SQL_FILES } from '../src/loader.js';
import { Renderer, dlightAt, mipLevel, skyTurn } from '../src/renderer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mapName = process.argv[2] ?? 'demo1';
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));
let failed = 0;
const assert = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

const stubCanvas = { width: 320, height: 240, getContext: () => ({ createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) };
const db = new FirebirdBrowser('memory://quake2', { transport: new DirectTransport() });
await createSchema(db, sql);
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
const res = await loadResources(db, pak, { width: 320, height: 240 });
const bsp = await loadMap(db, pak, res, mapName, { skill: 2 });
const cm = loadColormap(pak);
const r = new Renderer(stubCanvas, { palette: cm.palette, colormap: cm.colormap, alphamap: cm.alphamap, pak });
r.setSize(320, 240);
r.setResources(res);
const styles = new Float32Array(64).fill(1);
const lum = (s) => { let n = 0; for (const p of s.data) n += cm.palette24[p * 3] + cm.palette24[p * 3 + 1] + cm.palette24[p * 3 + 2]; return n / s.data.length; };

// a big lit wall of the world: its centre, its plane, a point 48 units off it
let pick = null;
for (const [id, info] of r.faceInfo) {
  const f = info.f;
  if (info.bsp !== bsp || f.lightofs < 0 || f.flags & 0x3c || f.extents[0] < 128 || f.extents[1] < 128) continue;
  if (!pick || f.extents[0] * f.extents[1] > pick.f.extents[0] * pick.f.extents[1]) pick = { id, ...info };
}
const { id, f, ti } = pick;
const pl = bsp.planes[f.plane];
// the face's middle in world space: average its vertices (the bsp's edges)
let cx = 0, cy = 0, cz = 0, nv = 0;
for (const vi of bsp.faceVertexIndices(f)) { const v = bsp.vertex(vi); cx += v[0]; cy += v[1]; cz += v[2]; nv++; }
cx /= nv; cy /= nv; cz /= nv;
const side = f.side ? -1 : 1;
const at = (d) => ({ x: cx + pl.nx * d * side, y: cy + pl.ny * d * side, z: cz + pl.nz * d * side });

r.dlights = [];
const plain = r.surface(id, styles, 0, 0);
const cached = r.surfCache.size;
r.dlights = [{ ...at(48), r: 300 }];
const lit = r.surface(id, styles, 0, 0);
assert(lit !== plain && lum(lit) > lum(plain) + 1 && r.surfCache.size === cached,
  `a light 48 units off a wall brightens its surface (${lum(plain).toFixed(0)} → ${lum(lit).toFixed(0)}), built afresh and not cached`);
r.dlights = [{ ...at(-48), r: 300 }];
const behind = r.surface(id, styles, 0, 0);
assert(lum(behind) > lum(plain) + 1, '... and from behind the wall too, as Quake 2\'s lights shone through');
r.dlights = [{ ...at(250), r: 260 }];
assert(r.surface(id, styles, 0, 0) === plain, 'a light whose radius leaves less than the minimum 32 at the plane does nothing: the cached surface');
r.dlights = [{ x: cx + 5000, y: cy + 5000, z: cz, r: 300 }];
assert(r.surface(id, styles, 0, 0) === plain, 'nor does one far across the plane');
r.dlights = [{ ...at(48), r: 120 }];
const small = r.surface(id, styles, 0, 0);
assert(lum(small) > lum(plain) && lum(small) < lum(lit), `a smaller light brightens less (${lum(small).toFixed(0)})`);
assert(Math.abs(dlightAt([{ x: 0, y: 0, z: 0, r: 200, c: 1 }], 50, 0, 0) - 150) < 1e-9 && dlightAt([{ x: 0, y: 0, z: 0, r: 200 }], 300, 0, 0) === 0,
  'R_LightPoint adds intensity less distance to models, nothing out of reach');
// mip levels
assert(mipLevel(1) === 0 && mipLevel(0.99) === 1 && mipLevel(0.4) === 1 && mipLevel(0.39) === 2 && mipLevel(0.2) === 2 && mipLevel(0.19) === 3,
  'D_MipLevelForScale: 1, 0.4 and 0.2 are where the levels change');
r.dlights = [];
const before = r.surfCache.size;
const m2 = r.surface(id, styles, 0, 0, 2);
assert(m2 !== plain && m2.w === f.extents[0] >> 2 && m2.h === f.extents[1] >> 2 && m2.ms === 0.25 && r.surfCache.size === before + 1,
  `a surface at mip 2 is a quarter the size (${m2.w}×${m2.h} of ${plain.w}×${plain.h}), its texels a quarter, cached apart`);
assert(Math.abs(lum(m2) - lum(plain)) < 12, `... and about as bright (${lum(m2).toFixed(0)} against ${lum(plain).toFixed(0)})`);
// a frame from the start: the near walls at mip 0, the far ones at higher levels
const last = (await db.query('SELECT * FROM q2_tic(1, 0, 0, 0, 0, 0, 0, 1, 0)', [], { rowMode: 'object' })).rows[0];
const rows = (await db.query('SELECT * FROM frame_faces_fast', [], { rowMode: 'array' })).rows;
r.surfCache.clear();
r.beginFrame({ x: last.PX, y: last.PY, z: last.VIEW_Z, yaw: last.YAW, pitch: last.PITCH, roll: 0, fov: 90 });
r.drawFaceList(rows, styles, last.TIME_, new Map(), new Map());
const levels = [0, 0, 0, 0];
for (const k of r.surfCache.keys()) levels[k % 4]++;
assert(levels[0] > 0 && levels[1] + levels[2] + levels[3] > 0, `a frame draws near surfaces at mip 0 and far ones smaller (by level: ${levels.join(' ')})`);
// the underwater warp
{
  const { w, h } = r;
  r.fb.fill(77); r.warpScreen(0.3);
  assert(r.fb.every((p) => p === 77), 'warping a flat picture leaves it flat');
  let maxdu = 0, maxdv = 0, moved = 0;
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) r.fb[v * w + u] = u & 255;
  r.warpScreen(0.3);
  for (let v = 0; v < h; v++) for (let u = 0; u < 240; u++) { const d = Math.abs(r.fb[v * w + u] - u); maxdu = Math.max(maxdu, d); if (d) moved++; }
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) r.fb[v * w + u] = v;
  r.warpScreen(0.3);
  const a = r.fb.slice();
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) maxdv = Math.max(maxdv, Math.abs(r.fb[v * w + u] - v));
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) r.fb[v * w + u] = v;
  r.warpScreen(0.6);
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== r.fb[i]) changed++;
  assert(moved > w * h / 4 && maxdu <= 7 && maxdv <= 7, `the view wobbles by a few pixels at most (columns ${maxdu}, rows ${maxdv})`);
  assert(changed > 0, `... and the wobble moves on with time (${changed} pixels differ a third of a second later)`);
}
// model lighting
{
  const mdl = [...res.models.values()].find((m) => m.mdl && m.mdl.numVerts > 20)?.mdl;
  r.beginFrame({ x: -200, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 90 });
  const lit = (light, opts = {}) => { r.drawAlias(mdl, 0, 0, [0, 0, 0], [0, 0, 0], light, opts); return Array.from({ length: mdl.numVerts }, (_, i) => r.av[i * 7 + 6]); };
  const span = (a) => [Math.min(...a), Math.max(...a)];
  const [bmin, bmax] = span(lit(255));
  assert(bmin === 128 && bmax <= 192 && bmax > 180, `a brightly lit model: ambient 128, at most 192 with the shade (${bmin}..${bmax.toFixed(0)})`);
  const [dmin, dmax] = span(lit(0));
  assert(dmin === 5 && dmax === 5, 'in the dark, LIGHT_MIN 5');
  const [mmin] = span(lit(0, { minlight: true }));
  assert(mmin === 25, `RF_MINLIGHT lifts it to 0.1 (${mmin})`);
  const g0 = span(lit(80, { glow: true, time: 0 }))[0], g1 = span(lit(80, { glow: true, time: Math.PI / 14 }))[0], g2 = span(lit(80, { glow: true, time: 3 * Math.PI / 14 }))[0];
  assert(g1 > g0 && g2 < g0 && g2 >= Math.trunc(80 * 1.4 * 0.8 * 0.9999), `RF_GLOW pulses (${g2} < ${g0} < ${g1}), never below 0.8 of the light`);
  const verts = lit(120);
  let plus = 0, minus = 0;
  for (let i = 0; i < mdl.numVerts; i++) { if (verts[i] > Math.min(...verts)) plus++; else minus++; }
  assert(plus > 0 && minus > 0, `the shade falls on the side facing +x, as from lightvec (-1, 0, 0) (${plus} lit, ${minus} ambient only)`);
}
// the explosion model as CL_AddExplosions drew it: fullbright, and translucent at 66% or 33%
{
  const ex = res.models.get(res.byName.get('models/objects/r_explode/tris.md2'))?.mdl;
  const shot = (light, opts) => { r.beginFrame({ x: -120, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 90 }); r.fb.fill(40); r.drawAlias(ex, 6, 3, [0, 0, 0], [0, 30, 0], light, opts); return r.fb.slice(); };
  const full = shot(0, { fullbright: true }), dark = shot(0, {});
  const drawn = full.filter((p) => p !== 40).length;
  assert(ex && ex.frames.length === 49 && ex.skins.length === 7 && drawn > 1000 && lum({ data: full.filter((p) => p !== 40) }) > lum({ data: dark.filter((p) => p !== 40) }),
    `the r_explode model (49 frames, 7 skins) draws fullbright in the dark (${drawn} pixels)`);
  const b66 = shot(0, { fullbright: true, alpha: 2 }), b33 = shot(0, { fullbright: true, alpha: 1 });
  let d = 0;
  for (let i = 0; i < b66.length; i++) if (b66[i] !== b33[i]) d++;
  assert(d > drawn / 2, `66% and 33% translucency differ (${d} pixels)`);
}
// the sky's turn (ref_gl's R_DrawSkyBox: time × skyrotate degrees about skyaxis)
{
  r.setSky('unit1_');
  const sky = (yaw, rot, axis, time) => {
    r.skyRotate = rot; r.skyAxis = axis;
    r.beginFrame({ x: 0, y: 0, z: 0, yaw, pitch: 10, roll: 0, fov: 90 });
    r.zb.fill(0); r.fb.fill(0);
    r.fillPolygon(new Float64Array([0, 0, 1, 0, 0, 320, 0, 1, 0, 0, 320, 240, 1, 0, 0, 0, 240, 1, 0, 0]), 4, null, 2, time, 0, 0);
    return r.fb.slice();
  };
  const same = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };
  const plain = sky(0, 0, [0, 0, 0], 1);
  assert(same(sky(0, 30, [0, 0, 0], 1), plain) === 0 && same(sky(0, 0, [0, 0, 1], 1), plain) === 0, 'no skyrotate, or no skyaxis: the sky stands still');
  const turned = sky(0, 30, [0, 0, 1], 1), back = sky(-30, 0, [0, 0, 0], 1);
  const d = same(turned, back);
  assert(same(turned, plain) > 10000 && d < 200, `a second at 30 degrees a second about z: the view at yaw 0 sees what yaw -30 saw (${d} pixels differ)`);
  const v = skyTurn([0, 0, 2], 90)([1, 0, 0]);
  assert(Math.abs(v[0]) < 1e-12 && Math.abs(v[1] - 1) < 1e-12 && Math.abs(v[2]) < 1e-12, 'the axis is normalised and the turn goes the way glRotatef turned');
  r.skyRotate = 0; r.skyAxis = [0, 0, 0];
}
// particles keep their size on screen at every resolution (D_DrawParticle's d_pix_shift, d_pix_min, d_pix_max)
{
  const dots = (w, h, dist) => {
    r.setSize(w, h);
    r.beginFrame({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 90 });
    r.zb.fill(0); r.fb.fill(0);
    r.particles = [{ x: dist, y: 0, z: 0, color: 7 }];
    r.drawParticles();
    return r.fb.filter((p) => p === 7).length;
  };
  const s320 = [dots(320, 240, 100), dots(320, 240, 30), dots(320, 240, 2000)], s640 = [dots(640, 480, 100), dots(640, 480, 30), dots(640, 480, 2000)];
  assert(s320.join() === '4,16,1' && s640.join() === '25,64,4', `a particle at 100, 30 and 2000 units: ${s320.join(', ')} pixels at 320×240, ${s640.join(', ')} at 640×480`);
  r.setSize(320, 240); r.particles = [];
}
console.log(failed ? `${failed} FAILED` : 'all good');
process.exit(failed ? 1 : 0);
