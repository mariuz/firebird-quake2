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

// a gunshot (TE_GUNSHOT) and a pellet (TE_SHOTGUN): the particles, then CL_SmokeAndFlash: the smoke model, translucent
// over four frames, lit where it hangs, and the flash model, fullbright for two; neither lights the frame
e = new Effects(lookup);
calls.length = 0;
e.add([fx(1, 0, 0, 0, 0, 0, 1), fx(11, 10, 0, 0, 0, 0, 1)], 3, rec);
check(of('particles').length === 2 && of('particles')[0][5] === 40 && of('particles')[1][5] === 20, 'a gunshot sparks 40 particles, a pellet 20');
check(e.explosions.length === 4 && e.explosions[0].type === 'smoke' && e.explosions[0].mdl === lookup.model('models/objects/smoke/tris.md2') && e.explosions[0].frames === 4
  && e.explosions[1].type === 'flash' && e.explosions[1].mdl === lookup.model('models/objects/flash/tris.md2') && e.explosions[1].frames === 2,
  'each keeps the smoke (4 frames) and the flash (2 frames) at the hit');
check(e.lights([], 3).length === 0, 'they give no light');
calls.length = 0;
e.draw(rec, bsp, 3.0);
const smoke = of('alias').find((a) => a[1] === lookup.model('models/objects/smoke/tris.md2')), flash = of('alias').find((a) => a[1] === lookup.model('models/objects/flash/tris.md2'));
check(smoke && !smoke[7].fullbright && smoke[6] !== 255 && flash && flash[7].fullbright && flash[7].alpha === 0, `the smoke is drawn lit where it hangs (${smoke?.[6]}), the flash fullbright and opaque`);
e.lights([], 3.11);
check(e.explosions.length === 2 && e.explosions.every((x) => x.type === 'smoke'), 'the flash is gone after a frame');
e.lights([], 3.31);
check(e.explosions.length === 0, 'the smoke after its fourth');

// the sparks' kinds (TE_SPARKS, TE_BULLET_SPARKS, the power screen's and shield's, TE_LASER_SPARKS) pack count and
// colour in n; nothing packed is the plain sparks' six of 0xe0
e = new Effects(lookup);
calls.length = 0;
e.add([fx(10, 0, 0, 0, 0, 0, 1, (4 << 8) | 0), fx(10, 0, 0, 0, 0, 0, 1, (40 << 8) | 0xd0), fx(10, 0, 0, 0, 0, 0, 1, 0)], 0, rec);
check(of('particles').length === 3 && of('particles')[0][5] === 4 && of('particles')[0][7] === 0 && of('particles')[1][5] === 40 && of('particles')[1][7] === 0xd0
  && of('particles')[2][5] === 6 && of('particles')[2][7] === 0xe0, 'four black laser sparks, forty green screen sparks, six plain ones');

// the BFG: where the ball struck (TE_BFG_BIGEXPLOSION) only its particles; each thing the blast reaches (TE_BFG_EXPLOSION)
// the s_bfg2 sprite alone, no particles
e = new Effects(lookup);
calls.length = 0;
e.add([fx(18, 0, 0, 0), fx(8, 50, 0, 0)], 0, rec);
check(of('particles').length === 1 && of('particles')[0][1] === 'bfg' && e.explosions.length === 1 && e.explosions[0].spr === lookup.sprite('sprites/s_bfg2.sp2') && e.explosions[0].x === 50,
  'the big explosion is particles alone, the blast\'s sprite has none');

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

// ── the game's side (sql): which effect and which sound each thing sends ─────────────────────────────────────
{
  const one = async (q) => (await db.query(q)).rows[0];
  const all = async (q) => (await db.query(q)).rows;
  const pe = (await one('SELECT ent_id e FROM player')).E;
  const tic = () => db.query('SELECT * FROM q2_tic(1, 0, 0, 0, 0, 0, 0, 1, 0)');
  const since = async () => ({ fx: (await one('SELECT COALESCE(MAX(id), 0) m FROM fx_events')).M, snd: (await one('SELECT COALESCE(MAX(id), 0) m FROM sound_events')).M });
  const fxAfter = async (m, kinds) => all(`SELECT kind, x, y, z, n FROM fx_events WHERE id > ${m.fx}${kinds ? ` AND kind IN (${kinds})` : ''} ORDER BY id`);
  const sndAfter = async (m, like) => all(`SELECT snd FROM sound_events WHERE id > ${m.snd}${like ? ` AND snd LIKE '${like}'` : ''} ORDER BY id`);
  await db.exec("DELETE FROM ents WHERE mtype IS NOT NULL");   // (a quiet map: the effects below are the player's alone)
  await db.exec(`UPDATE ents SET flags = BIN_OR(flags, 16) WHERE id = ${pe}`);
  const put = async (x, y, z) => { await db.exec(`UPDATE ents SET x = ${x}, y = ${y}, z = ${z}, vx = 0, vy = 0, vz = 0 WHERE id = ${pe}`); await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE link_ent(${pe}); END`); };
  await put(128, -320, 32);

  // a rocket exploding under water: the same explosion (fx 2) with the water's sound (TE_ROCKET_EXPLOSION_WATER)
  const leaves = await all('SELECT FIRST 20 (minx + maxx) / 2 cx, (miny + maxy) / 2 cy, minz, maxz FROM leaves WHERE BIN_AND(contents, 32) <> 0 AND maxz - minz >= 64 ORDER BY (maxx - minx) * (maxy - miny) DESC');
  let spot = null;
  for (const l of leaves) {
    const z = l.MAXZ - 40;
    const c = await one(`SELECT point_contents(${l.CX}, ${l.CY}, ${z}) c, point_contents(${l.CX}, ${l.CY}, ${z - 30}) f FROM rdb$database`);
    if (c.C & 32 && c.F & 32) { spot = { x: l.CX, y: l.CY, z }; break; }
  }
  check(!!spot, `demo1 has water to fire into (${spot ? `${spot.x.toFixed(0)},${spot.y.toFixed(0)},${spot.z.toFixed(0)}` : 'none'})`);
  let m;
  if (spot) {
    m = await since();
    // (slowly, so it swims a tic before it strikes the bottom: the water level is read as it flies, as SV_Physics_Toss did)
    await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE launch_rocket(${pe}, ${spot.x}, ${spot.y}, ${spot.z}, 0, 0, -1, 200, 100, 120, 120); END`);
    const rk = (await one("SELECT id FROM ents WHERE classname = 'rocket'"))?.ID;
    for (let i = 0; i < 40 && (await one(`SELECT id FROM ents WHERE id = ${rk}`)); i++) await tic();
    const wet = await sndAfter(m, 'weapons/%');
    check(rk && !(await one(`SELECT id FROM ents WHERE id = ${rk}`)) && wet.some((s) => s.SND === 'weapons/xpld_wat.wav') && !wet.some((s) => s.SND === 'weapons/rocklx1a.wav') && (await fxAfter(m, '2')).length === 1,
      `a rocket fired down into the water explodes with the water's sound and the rocket's picture (${wet.map((s) => s.SND).join(', ')})`);
    // a grenade under water: the water's sound too; one going off in the air makes a rocket's explosion, on the ground a grenade's
    m = await since();
    await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE launch_grenade(${pe}, ${spot.x}, ${spot.y}, ${spot.z}, 0, 0, 0, 125, 165, 0.15, 0); END`);
    for (let i = 0; i < 10; i++) await tic();
    const wetg = await sndAfter(m, 'weapons/%');
    check(wetg.some((s) => s.SND === 'weapons/xpld_wat.wav') && !wetg.some((s) => s.SND === 'weapons/grenlx1a.wav'), `a grenade under water goes off with the water's sound (${wetg.map((s) => s.SND).join(', ')})`);
  }
  m = await since();
  await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE launch_grenade(${pe}, 128, -320, 200, 0, 0, 0, 1, 10, 0.1, 0); END`);
  for (let i = 0; i < 6; i++) await tic();
  // (the map's own scripted explosions go on elsewhere: the grenade's is the one at its spot)
  const atSpot = (rows, z) => rows.filter((r) => Math.abs(r.X - 128) < 8 && Math.abs(r.Y + 320) < 8 && Math.abs(r.Z - z) < 40);
  const air = atSpot(await fxAfter(m, '2, 9'), 200);
  check(air.length === 1 && air[0].KIND === 2 && (await sndAfter(m, 'weapons/grenlx1a.wav')).length === 1, `a grenade going off in the air makes a rocket's explosion with the grenade's sound (kind ${air[0]?.KIND})`);
  m = await since();
  await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE launch_grenade(${pe}, 128, -320, 2, 0, 0, 0, 1, 10, 1.0, 0); END`);   // (dropped on the floor, a second's fuse: it has settled; a harmless one, so nothing near it bursts too)
  for (let i = 0; i < 24; i++) await tic();
  const ground = atSpot(await fxAfter(m, '2, 9'), 0);
  check(ground.length === 1 && ground[0].KIND === 9, `one resting on the ground a grenade's (kind ${ground[0]?.KIND})`);

  // bullets into a wall: TE_GUNSHOT each, and the ricochet three of sixteen times (world/ric1-3.wav)
  m = await since();
  for (let i = 0; i < 64; i++) await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE fire_bullets(${pe}, 1, 128, -320, 54, ${Math.cos((135 * Math.PI) / 180)}, ${Math.sin((135 * Math.PI) / 180)}, 0, 0, 0, 1, 0); END`);
  const shots = await fxAfter(m, '1');
  const rics = await sndAfter(m, 'world/ric%');
  check(shots.length === 64 && rics.length >= 4 && rics.length <= 28 && rics.every((s) => /^world\/ric[123]\.wav$/.test(s.SND)),
    `64 bullets into the wall: 64 gunshots and ${rics.length} ricochets of the three (about twelve expected)`);

  // the BFG: its lasers (fx 12) end in sparks (fx 10, four, black) on what they hit; where it strikes, the big explosion
  // (fx 18), the ball becomes the s_bfg3 sprite, steps a frame a tic and goes after its fifth
  const sid = (await one("SELECT * FROM spawn_monster('soldier', 200)")).ID;
  await db.exec(`UPDATE ents SET health = 100000 WHERE id = ${sid}`);
  m = await since();
  const p = await one(`SELECT x, y, z, yaw FROM ents WHERE id = ${pe}`);
  const yaw = (p.YAW * Math.PI) / 180;
  await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE launch_bfg(${pe}, ${p.X + Math.cos(yaw) * 30}, ${p.Y + Math.sin(yaw) * 30}, ${p.Z + 22}, ${Math.cos(yaw)}, ${Math.sin(yaw)}, 0, 400, 500, 1000); END`);
  const ball = (await one("SELECT id FROM ents WHERE classname = 'bfg_ball'"))?.ID;
  let struck = null, frames = [];
  for (let i = 0; i < 80 && !(struck && frames.at(-1) === null); i++) {
    await tic();
    if (!struck && (await fxAfter(m, '18')).length) struck = await one(`SELECT e.frame f, m.name FROM ents e JOIN models m ON m.id = e.model_id WHERE e.id = ${ball}`);
    if (struck) frames.push((await one(`SELECT frame f FROM ents WHERE id = ${ball}`))?.F ?? null);
  }
  const lasers = await fxAfter(m, '12'), sparks = await fxAfter(m, '10');
  check(lasers.length > 0 && sparks.length === lasers.length && sparks.every((s) => s.N === 4 * 256), `the ball's lasers (${lasers.length}) each end in four black sparks`);
  check(struck && struck.NAME === 'sprites/s_bfg3.sp2' && struck.F === 0, `where it strikes the ball becomes the s_bfg3 sprite (${struck?.NAME}, frame ${struck?.F})`);
  const stepped = [...new Set(frames.filter((f) => f !== null))].join();
  check(stepped === '0,1,2,3,4' && frames.at(-1) === null && frames.length <= 12, `it steps a frame every tenth of a second (a think, FRAMETIME) and is gone after the fifth (${frames.join(',')})`);
  check((await fxAfter(m, '8')).length >= 1, 'and the blast marks what it reached with the s_bfg2 sprite');
  await db.exec(`DELETE FROM ents WHERE id = ${sid} OR classname IN ('bfg_ball', 'rocket', 'grenade')`);
}

await db.close();
console.log(failed ? `${failed} failure(s)` : 'all good');
process.exit(failed ? 1 : 0);
