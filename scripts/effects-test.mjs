// effects-test.mjs – the client's temporary entities headless (src/effects.js, cl_tent.c): what each effect row
// makes, how long it lasts, the lights it gives and how they fade, how it is drawn, and that it paints.
//   node scripts/effects-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak, loadColormap } from '../src/pak.js';
import { createSchema, loadResources, loadMap, SQL_FILES } from '../src/loader.js';
import { Renderer } from '../src/renderer.js';
import { Effects } from '../src/effects.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const db = new FirebirdBrowser('memory://quake2', { transport: new DirectTransport() });
await createSchema(db, sql);
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
const res = await loadResources(db, pak, { width: 320, height: 240 });
const bsp = await loadMap(db, pak, res, 'demo1', { skill: 2, seed: 1 });
const lookup = {
  model: (n) => res.models.get(res.byName.get(n))?.mdl,
  sprite: (n) => res.models.get(res.byName.get(n))?.spr,
};
check(!!lookup.model('models/objects/r_explode/tris.md2') && !!lookup.sprite('sprites/s_bfg2.sp2') && !!lookup.model('models/monsters/parasite/segment/tris.md2'),
  'the explosion, BFG and tongue models are in the pak');

// a renderer that records what it is asked to draw; the chances from a fixed sequence
const calls = [];
const rec = {
  dlights: [],
  spawnParticles: (...a) => calls.push(['particles', ...a]),
  drawBeam: (a, b, color) => calls.push(['beam', a, b, color]),
  drawAlias: (mdl, frame, skin, origin, angles, light, opts) => calls.push(['alias', mdl, frame, skin, origin, angles, light, opts]),
  drawSprite: (spr, frame, origin, light, alpha) => calls.push(['sprite', spr, frame, origin, light, alpha]),
};
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
const fx = (kind, x, y, z, x2 = 0, y2 = 0, z2 = 0, n = 0) => [0, kind, x, y, z, x2, y2, z2, n];
const of = (kind) => calls.filter((c) => c[0] === kind);

// a rocket's explosion (TE_ROCKET_EXPLOSION): particles now, the r_explode model from frame 15 or 0, a random yaw
let e = new Effects(lookup, seq(0.25, 0.5));
e.add([fx(2, 100, 200, 30)], 10, rec);
check(of('particles').length === 1 && of('particles')[0][1] === 'explosion', 'an explosion spawns its particles at once');
let ex = e.explosions[0];
check(ex && ex.type === 'poly' && ex.base === 15 && ex.yaw === 180 && ex.frames === 15 && ex.mdl === lookup.model('models/objects/r_explode/tris.md2'),
  'and keeps the r_explode model, from frame 15 when the chance is under a half, at the yaw the next chance gives');
// its light: (16 - frame) / 16 of 350, the frame stepping at 10 a second from 1, gone when the frames run out
let L = e.lights([], 10);
check(L.length === 1 && near(L[0].r, 350 * 15 / 16), `its light starts at 15/16 of 350 (${L[0]?.r})`);
L = e.lights([], 10.5);
check(near(L[0].r, 350 * 10 / 16), `and fades with the frames (${L[0].r} half a second on)`);
L = e.lights([], 11.29);
check(e.explosions.length === 1 && L.length === 1, 'it lasts until its last frame…');
L = e.lights([], 11.31);
check(e.explosions.length === 0 && L.length === 0, '…and is gone after it');

// how it is drawn: fullbright, frame base + f + 1, the skin climbing, opaque then translucent at frame 10
e = new Effects(lookup, seq(0.9, 0));
e.add([fx(2, 0, 0, 0)], 0, rec);
calls.length = 0;
e.lights([], 0.25); e.draw(rec, bsp, 0.25);
let a = of('alias')[0];
check(a && a[2] === 0 + 3 + 1 && a[3] === 1 && a[7].fullbright && a[7].alpha === 0, `drawn fullbright at frame 4, skin 1, opaque (${a?.[2]}, ${a?.[3]}, ${a?.[7].alpha})`);
calls.length = 0;
e.lights([], 1.05); e.draw(rec, bsp, 1.05);
a = of('alias')[0];
check(a && a[3] === 5 && a[7].alpha === 1, `from frame 10 translucent, skin 5 (${a?.[3]}, blend ${a?.[7].alpha})`);

// a grenade's (TE_GRENADE_EXPLOSION): from frame 30, 19 frames
e = new Effects(lookup, seq(0));
e.add([fx(9, 0, 0, 0)], 0, rec);
check(e.explosions[0].base === 30 && e.explosions[0].frames === 19, 'a grenade\'s explosion plays frames 30 on, 19 of them');

// the blaster's hit (TE_BLASTER): sparks, the small explode model turned to the direction, fading over 4 frames
e = new Effects(lookup);
calls.length = 0;
e.add([fx(6, 0, 0, 0, 0, 1, 0)], 0, rec);
ex = e.explosions[0];
check(of('particles')[0][1] === 'gunshot' && ex.type === 'misc' && ex.pitch === 90 && ex.yaw === 90 && ex.light === 150,
  'a blaster hit sparks and turns the small explode model to its direction');
L = e.lights([], 0);
check(near(L[0].r, 150 * (1 - 1 / 3)), `its light is 1 - frac / 3 of 150 (${L[0].r})`);
calls.length = 0;
e.draw(rec, bsp, 0);
check(of('alias')[0][7].alpha === 0, 'its first frame, at 2/3 alpha, is over ref_soft\'s 0.66 and drawn opaque');
calls.length = 0;
e.lights([], 0.1); e.draw(rec, bsp, 0.1);
check(of('alias')[0][7].alpha === 2, 'its next, at 1/3, at 66 % translucency');

// the BFG's (TE_BFG_EXPLOSION): the s_bfg2 sprite, a third green light
e = new Effects(lookup);
e.add([fx(8, 0, 0, 0)], 0, rec);
L = e.lights([], 0);
calls.length = 0;
e.draw(rec, bsp, 0);
check(e.explosions[0].spr === lookup.sprite('sprites/s_bfg2.sp2') && L[0].c === 1 / 3 && of('sprite').length === 1, 'a BFG explosion is the s_bfg2 sprite with its own light colour');

// muzzle flashes: a light for the frame they come in
e = new Effects(lookup);
e.add([fx(15, 1, 2, 3, 0, 0, 0, 225)], 5, rec);
check(e.lights([], 5).some((l) => l.r === 225 && l.x === 1), 'a muzzle flash lights its frame');
check(e.lights([], 5.05).length === 0, 'and no other');

// the EF_ flags' lights: rockets, blaster and hyperblaster bolts at 200, the BFG ball's a third green
const ent = (effects) => [1, 2, 0, 0, 10, 20, 30, 0, 0, 0, effects, 0, 'M', 0];
L = new Effects(lookup).lights([ent(16), ent(8), ent(64), ent(128), ent(1)], 0);
check(L.length === 4 && L.every((l) => l.r === 200) && L[3].c === 1 / 3 && L[0].c === 2 / 3, 'rockets, bolts and the BFG ball light at 200; a rotating item does not');

// beams: the laser's for 0.1 s, the heat beam's and the others' for 0.12 s, in their colours
e = new Effects(lookup);
e.add([fx(12, 0, 0, 0, 64, 0, 0), fx(13, 0, 0, 0, 0, 64, 0, 2)], 1, rec);
calls.length = 0;
e.draw(rec, bsp, 1.05);
check(of('beam').length === 2 && of('beam')[0][3] === 0xd0 && of('beam')[1][3] === 0xf2, 'two beams are drawn, in their colours');
calls.length = 0;
e.draw(rec, bsp, 1.11);
check(of('beam').length === 1 && of('beam')[0][3] === 0xf2, 'the laser\'s goes after 0.1 s, the other stays to 0.12');
e.draw(rec, bsp, 1.13);
check(e.beams.length === 0, 'and then that one too');

// the parasite's tongue: one per parasite, a segment every 30 units, lit where it hangs, 0.2 s
e = new Effects(lookup, seq(0.5));
e.add([fx(16, 0, 0, 40, 100, 0, 40, 7)], 2, rec);
e.add([fx(16, 0, 0, 40, 95, 0, 40, 7)], 2.05, rec);
check(e.tongues.size === 1 && e.tongues.get(7).b[0] === 95, 'a parasite\'s new tongue replaces its last');
calls.length = 0;
rec.dlights = [];
e.draw(rec, bsp, 2.1);
const segs = of('alias');
check(segs.length === 4 && segs.every((s) => s[1] === lookup.model('models/monsters/parasite/segment/tris.md2') && s[5][2] === 180),
  `it is drawn as a segment every 30 units (${segs.length} for 95 units), each at the chance's roll`);
check(near(segs[0][4][0], 0) && near(segs[3][4][0], 65), 'from the mouth to 30 short of the end, evenly');
calls.length = 0;
e.draw(rec, bsp, 2.26);
check(of('alias').length === 0 && e.tongues.size === 0, 'and gone 0.2 s after it came');

// a new map: nothing carries over
e = new Effects(lookup);
e.add([fx(2, 0, 0, 0), fx(12, 0, 0, 0, 1, 1, 1), fx(15, 0, 0, 0, 0, 0, 0, 100), fx(16, 0, 0, 0, 30, 0, 0, 3)], 0, rec);
e.clear();
check(e.explosions.length + e.beams.length + e.flashes.length + e.tongues.size === 0, 'clear() leaves nothing');

// and it paints: an explosion in front of the eye changes the frame, lit by its own light
const stubCanvas = { width: 320, height: 240, getContext: () => ({ createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) };
const cm = loadColormap(pak);
const r = new Renderer(stubCanvas, { palette: cm.palette, colormap: cm.colormap, alphamap: cm.alphamap, pak });
r.setSize(320, 240);
r.setResources(res);
const view = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 90 };
r.beginFrame({ ...view });
const blank = r.fb.slice();
e = new Effects(lookup, seq(0));
e.add([fx(2, 80, 0, 0)], 0, r);
r.dlights = e.lights([], 0.05);
e.draw(r, bsp, 0.05);
let changed = 0;
for (let i = 0; i < r.fb.length; i++) if (r.fb[i] !== blank[i]) changed++;
check(changed > 500 && r.dlights.length === 1, `an explosion 80 units ahead paints the frame (${changed} pixels) and lights it`);

await db.close();
console.log(failed ? `${failed} failure(s)` : 'all good');
process.exit(failed ? 1 : 0);
