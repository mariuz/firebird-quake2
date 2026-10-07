// dlight-test.mjs – dynamic lights in the painter (R_MarkLights, R_AddDynamicLights, R_LightPoint):
// a light near a face brightens its surface by what is left of its radius, from either side of the
// plane, a face out of reach keeps its cached surface, and lit surfaces are never cached.
//   node scripts/dlight-test.mjs [map]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak, loadColormap } from '../src/pak.js';
import { createSchema, loadResources, loadMap, SQL_FILES } from '../src/loader.js';
import { Renderer, dlightAt } from '../src/renderer.js';

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
console.log(failed ? `${failed} FAILED` : 'all good');
process.exit(failed ? 1 : 0);
