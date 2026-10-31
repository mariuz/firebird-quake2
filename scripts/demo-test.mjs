// demo-test.mjs – a demo of the pak read and played headless (src/demo.js, cl_parse.c, cl_ents.c): every block of
// demos/q2demo1.dm2 consumed exactly, the server data, the configstrings, the frames a tenth of a second apart with
// their player state and entities; the player's view and the entities lerped between frames, the events of each
// frame given once, the sounds placed at their entities, the muzzle flashes with their sounds and lights; the
// session's demo frame: the map's own models hidden, the view set from the recording, the faces of the SQL for it,
// a brush model moved where the demo has it; and a frame painted from all of it.
//   node scripts/demo-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak, loadColormap } from '../src/pak.js';
import { createSchema, loadResources, SQL_FILES } from '../src/loader.js';
import { Session } from '../src/session.js';
import { parseDemo, DemoPlayer, mz2Sound, SVC, CS } from '../src/demo.js';
import { Renderer, lightPoint, entityFrame } from '../src/renderer.js';
import { Effects } from '../src/effects.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
const demoName = process.argv[2] ?? 'q2demo1';
const file = `demos/${demoName}.dm2`;
check(pak.has(file), `the pak has ${file}`);
if (!pak.has(file)) process.exit(1);

// ── the file read: every block consumed exactly (the parser throws otherwise) ──
const bytes = pak.get(file);
const demo = parseDemo(bytes);
check(demo.blocks > 0 && demo.frames.length > 0, `${demo.blocks} blocks read to the last byte, ${demo.frames.length} frames (${(bytes.length / 1024).toFixed(0)} KB)`);
check(demo.protocol === 31 && demo.attractloop === 1 && demo.playernum === 0, `svc_serverdata: protocol ${demo.protocol}, an attract loop, the recording client is player ${demo.playernum}`);
check(demo.levelname.length > 0 && demo.configstrings[CS.NAME] === demo.levelname, `the level is "${demo.levelname}" (CS_NAME agrees)`);
check(/^maps\/\w+\.bsp$/.test(demo.map) && pak.has(demo.map), `the map is ${demo.map}, in the pak`);
const models = demo.models.filter((m) => m && m[0] !== '*' && m !== demo.map);
check(models.length > 0 && models.every((m) => pak.has(m)), `the ${models.length} models the configstrings name are in the pak`);
const sounds = demo.sounds.filter(Boolean);
check(sounds.length > 0 && sounds.every((s) => pak.has(`sound/${s}`)) && sounds.some((s) => s.startsWith('player/male/')), `so are the ${sounds.length} sounds (the player's sexed ones as the male's)`);
check(demo.lights[0] === 'm' && demo.lights.some((l) => l.length > 1), `CS_LIGHTS: style 0 is "m", the animated styles have their patterns`);
check(demo.baselines.size > 0 && [...demo.baselines.values()].every((b) => b.number > 0), `${demo.baselines.size} spawn baselines`);
let ordered = true;
for (let i = 1; i < demo.frames.length; i++) if (demo.frames[i].serverframe <= demo.frames[i - 1].serverframe || !near(demo.frames[i].time - demo.frames[i - 1].time, 0.1 * (demo.frames[i].serverframe - demo.frames[i - 1].serverframe))) ordered = false;
check(ordered && demo.frames[0].time === 0, 'the frames come in order, the clock at zero on the first and a tenth of a second a server frame');
const f0 = demo.frames[0];
check(f0.ps.stats[1] === 100 && f0.ps.fov === 90 && f0.ents.size > 0, `the first frame's player state: health ${f0.ps.stats[1]}, fov ${f0.ps.fov}, ${f0.ents.size} entities`);
const self = demo.playernum + 1;
check(f0.ents.has(self), 'the recording player is among them');
const changes = demo.frames.filter((f, i) => i && f.ents.size !== demo.frames[i - 1].ents.size).length;
check(changes > 0, `entities come and go between frames (${changes} frames change the count)`);
const withSounds = demo.frames.filter((f) => f.sounds.length).length, withFx = demo.frames.filter((f) => f.fx.length).length, withFlashes = demo.frames.filter((f) => f.flashes.length).length;
check(withSounds > 0 && withFx > 0 && withFlashes > 0, `frames carry sounds (${withSounds}), temporary entities (${withFx}) and muzzle flashes (${withFlashes})`);
const brushNames = new Set();
for (const f of demo.frames) for (const s of f.ents.values()) { const n = demo.models[s.modelindex]; if (n && n[0] === '*') brushNames.add(n); }
check(brushNames.size > 0, `${brushNames.size} brush models appear (${[...brushNames].slice(0, 5).join(', ')}…)`);
check(SVC.frame === 20 && SVC.playerinfo === 17 && SVC.packetentities === 18 && CS.MODELS === 32 && CS.SOUNDS === 288, 'the message numbers and the configstring layout are protocol 31\'s');

// a block with the first byte wrong is refused, not read past
const bad = bytes.slice();
bad[4] = 200;
let refused = false;
try { parseDemo(bad); } catch (err) { refused = /unknown|consumed/.test(err.message); }
check(refused, 'an unknown message is refused with its block named');

// ── the player: the view and the entities between frames ──
const modelIds = new Map(models.map((m, i) => [m, i + 1]));
const player = new DemoPlayer(demo, { modelId: (n) => modelIds.get(n) });
check(near(player.duration, demo.frames[demo.frames.length - 1].time), `the demo lasts ${player.duration.toFixed(1)} s`);
let st = player.at(0);
check(st.i === 0 && st.frac === 0 && near(st.view.x, f0.ps.origin[0]) && near(st.view.yaw, f0.ps.viewangles[1]) && near(st.view.viewZ, f0.ps.origin[2] + f0.ps.viewoffset[2]),
  `at 0: the first frame's origin (${st.view.x.toFixed(2)}, ${st.view.y.toFixed(2)}, ${st.view.z.toFixed(2)}), yaw ${st.view.yaw.toFixed(1)}, the eye at the view offset`);
check(st.events.sounds.length === f0.sounds.length && st.events.fx.length === f0.fx.length, 'and the first frame\'s events');
check(player.at(0.02).events.sounds.length === 0 && player.at(0.02).events.fx.length === 0, 'asked again before the next frame, the events are not given twice');
// the entities' events (entity_event_t on the states, CL_EntityEvent's sounds): the demo's frames carry footsteps (2) and more; a player
// of its own gives them with the frames reached, and soundRows plays them as the client did, the footsteps on the body channel and none
// with cl_footsteps off
{
  const evFrames = demo.frames.filter((f) => [...f.ents.values()].some((es) => es.event)).length;
  const p2 = new DemoPlayer(demo, { modelId: (n) => modelIds.get(n) });
  const v0 = p2.at(0).view;
  const ev = p2.at(p2.duration).events.entityEvents;
  const kinds = new Set(ev.map((e) => e.event));
  const empty = { sounds: [], fx: [], prints: [], centerprints: [], flashes: [], configs: [] };
  const on = p2.soundRows({ ...empty, entityEvents: ev }, demo.frames[0], v0).rows;
  const off = p2.soundRows({ ...empty, entityEvents: ev }, demo.frames[0], v0, Math.random, false).rows;
  const stepRows = on.filter((r) => /^player\/step[1-4]\.wav$/.test(r[4]) && r[3] === 3);
  check(evFrames > 0 && ev.length > 0 && kinds.has(2) && stepRows.length === ev.filter((e) => e.event === 2).length && stepRows.every((r) => pak.has(`sound/${r[4]}`)),
    `${evFrames} frames carry entity events (${ev.length}, kinds ${[...kinds].sort().join(',')}): the footsteps play as player/step1-4.wav on the body channel (${stepRows.length})`);
  check(off.every((r) => !r[4].startsWith('player/step')) && off.length === on.length - stepRows.length, 'with cl_footsteps off the footsteps are left out, the other events kept');
}
// a frame where the player moves: the midpoint between it and the next
const mi = demo.frames.findIndex((f, i) => i + 1 < demo.frames.length && Math.hypot(...[0, 1, 2].map((k) => demo.frames[i + 1].ps.origin[k] - f.ps.origin[k])) > 1);
const fa = demo.frames[mi], fb = demo.frames[mi + 1];
st = player.at(fa.time + 0.05);
check(mi >= 0 && st.i === mi && near(st.frac, 0.5, 1e-9) && [0, 1, 2].every((k) => near(st.view[['x', 'y', 'z'][k]], (fa.ps.origin[k] + fb.ps.origin[k]) / 2)),
  `halfway between frames ${mi} and ${mi + 1} the view is halfway between their origins`);
check(st.events.sounds.length === demo.frames.slice(1, mi + 1).reduce((n, f) => n + f.sounds.length, 0), 'the events of every frame passed since the last call came with it, once');
check(player.at(fa.time + 0.07).events.sounds.length === 0, 'and not again');
// an entity in both frames is lerped; the entity rows are decodeFrame's layout with the page's model ids
const both = [...fa.ents.keys()].find((n) => n !== self && fb.ents.has(n) && demo.models[fa.ents.get(n).modelindex] && demo.models[fa.ents.get(n).modelindex][0] !== '*');
const row = st.ents.find((e) => e[0] === both);
const sa = fa.ents.get(both), sb = fb.ents.get(both);
check(row && row.length === 16 && row[1] === modelIds.get(demo.models[sa.modelindex]) && near(row[4], (sa.origin[0] + sb.origin[0]) / 2) && near(row[5], (sa.origin[1] + sb.origin[1]) / 2)
  && row[2] === sb.frame && row[14] === sa.frame && near(row[15], sa.frame === sb.frame ? 0 : 0.5) && row[12] === 'M',
  `entity ${both} is a row [id, model, frame, skin, x, y, z, …, oldframe, backlerp] with the page's model id, halfway between its two origins, the newer frame's pose blended by half from the older's (${sa.frame} → ${sb.frame})`);
const stepped = demo.frames.findIndex((f, i) => i && [...f.ents].some(([n, s]) => n !== self && demo.frames[i - 1].ents.get(n)?.frame !== undefined && demo.frames[i - 1].ents.get(n).frame !== s.frame && demo.models[s.modelindex]?.[0] !== '*'));
if (stepped > 0) {
  const q = player.at(demo.frames[stepped - 1].time + 0.025);
  const e = q.ents.find((r) => r[15] > 0);
  check(e && near(e[15], 0.75) && e[14] !== e[2], `a quarter of the way to a frame where a model steps, its blend is 0.75 from frame ${e?.[14]} to ${e?.[2]}`);
}
check(near(st.view.gunBacklerp, fa.ps.gunframe === fb.ps.gunframe ? 0 : 0.5) && st.view.gunframe === fb.ps.gunframe && st.view.gunOldframe === fa.ps.gunframe, 'the gun\'s frame comes the same way, with the older frame and the blend');
check(!st.ents.some((e) => e[0] === self), 'the recording player\'s own entity is left out (the view is its)');
check(st.brushes.length > 0 && st.brushes.every((b) => b.name[0] === '*' && b.origin.length === 3 && b.angles.length === 3 && brushNames.has(b.name)), `the brush models come apart, by name (${st.brushes.map((b) => b.name).join(', ')})`);
check(st.lights.length === 64 && st.lights[0] > 0.9 && st.lights[0] < 1, 'the light styles are the demo\'s configstrings at the time (style 0 at "m")');
// the angles lerp the short way round
const lerpAngle = (a, b, f) => { let d = b - a; if (d > 180) d -= 360; if (d < -180) d += 360; return a + d * f; };
check(near(lerpAngle(350, 10, 0.5), 360) && near(lerpAngle(10, 350, 0.5), 0), 'an angle lerps the short way round');
// the end
st = player.at(player.duration + 5);
check(st.i === demo.frames.length - 1 && player.finished, 'past the end the last frame stands and the player says it is finished');

// ── the sounds: at their entities, the flashes with their weapon's sound and a light ──
const p2 = new DemoPlayer(demo, { modelId: (n) => modelIds.get(n) });
const sf = demo.frames.findIndex((f) => f.sounds.some((s) => s.ent && s.ent !== self && !s.pos && f.ents.has(s.ent)));
if (sf >= 0) {
  const fr = demo.frames[sf];
  const s = p2.at(fr.time);
  const { rows } = p2.soundRows(s.events, s.frame, s.view);
  const snd = fr.sounds.find((x) => x.ent && x.ent !== self && !x.pos && fr.ents.has(x.ent));
  const r = rows.find((x) => x[0] === snd.id);
  const at = fr.ents.get(snd.ent).origin;
  check(r && r[4] === demo.sounds[snd.num] && r[2] === snd.ent && near(r[7], at[0]) && near(r[8], at[1]) && near(r[9], at[2]),
    `frame ${sf}: ${demo.sounds[snd.num]} plays where entity ${snd.ent} is (${at.map((v) => v.toFixed(0)).join(', ')})`);
} else check(false, 'a sound with an entity and no position');
const ff = demo.frames.findIndex((f) => f.flashes.some((m) => !m.monster));
if (ff >= 0) {
  const fr = demo.frames[ff];
  const s = p2.at(fr.time);
  const { rows, fx } = p2.soundRows(s.events, s.frame, s.view, () => 0.5);
  const m = fr.flashes.find((x) => !x.monster);
  const light = fx.find((x) => x[1] === 15);
  check(rows.some((r) => r[2] === m.ent && /^weapons\//.test(r[4])) && light && light[8] === 216, `frame ${ff}: a player's muzzle flash (MZ ${m.weapon}) is its weapon's sound and a 200 + 16 light`);
} else check(false, 'a player muzzle flash');
check(mz2Sound(1) === 'tank/tnkatck3.wav' && mz2Sound(26) === 'infantry/infatck1.wav' && mz2Sound(39) === 'soldier/solatck2.wav' && mz2Sound(42) === 'gunner/gunatck2.wav' && mz2Sound(200) === null,
  'the monsters\' flashes name their sounds (tank, infantry, soldier, gunner), an unknown one none');

// ── the session: the demo's map as its stage ──
const db = new FirebirdBrowser('memory://quake2', { transport: new DirectTransport() });
await createSchema(db, sql);
const res = await loadResources(db, pak, { width: 320, height: 240 });
const session = new Session(db);
session.use(pak, res);
const mapName = demo.map.replace(/^maps\//, '').replace(/\.bsp$/, '');
const setup = await session.startMap(mapName, { newGame: true, skill: 2, seed: 1 });
const q = async (s) => (await db.query(s)).rows;
const before = (await q("SELECT COUNT(*) n FROM ents WHERE mkind IN ('M', 'S') AND classname <> 'player'"))[0].N;
await session.demoBegin();
const after = (await q("SELECT COUNT(*) n FROM ents WHERE mkind IN ('M', 'S') AND classname <> 'player'"))[0].N;
check(before > 10 && after === 0, `demoBegin hides the game's own alias models and sprites (${before} → ${after}; the player's row stays)`);
check(session.demoBrushes.size > 0 && [...brushNames].every((n) => session.demoBrushes.has(n)), `and knows the map's ${session.demoBrushes.size} brush models by name, every one the demo moves among them`);
const pl = new DemoPlayer(demo, { modelId: (n) => res.byName.get(n) });
st = pl.at(0);
check(st.ents.length > 0 && st.ents.every((e) => res.models.has(e[1])), `with the page's resources every entity row has a model the painter knows (${st.ents.length} at the start)`);
let frame = await session.demoFrame(st.view, st.brushes);
check(frame.faces.length > 50, `demoFrame at the first view: ${frame.faces.length} faces from the SQL`);
const pe = (await q('SELECT ent_id FROM player WHERE id = 1'))[0].ENT_ID;
const pos = (await q(`SELECT e.x, e.y, e.z, e.yaw, p.pitch, p.view_ofs FROM ents e JOIN player p ON p.ent_id = e.id WHERE e.id = ${pe}`))[0];
check(near(pos.X, st.view.x) && near(pos.Y, st.view.y) && near(pos.Z, st.view.z) && near(pos.YAW, st.view.yaw) && near(pos.PITCH, st.view.pitch) && near(pos.VIEW_OFS, st.view.viewZ - st.view.z),
  'the player\'s entity and row are at the demo\'s view');
const vs = (await q('SELECT ex, ey, ez FROM view_setup'))[0];
check(vs && near(vs.EX, st.view.x, 0.01) && near(vs.EY, st.view.y, 0.01) && near(vs.EZ, st.view.viewZ, 0.01), 'view_setup reads the eye there');
// a brush model that moves in the demo: moved in the table when its frame comes, left alone while it stands
let moved = null;
for (const f of demo.frames) for (const s of f.ents.values()) { const n = demo.models[s.modelindex]; if (n && n[0] === '*' && (s.origin[0] || s.origin[1] || s.origin[2])) { const b = demo.baselines.get(s.number); if (!b || Math.hypot(...[0, 1, 2].map((k) => s.origin[k] - b.origin[k])) > 8) { moved = { f, s, n }; break; } } if (moved) break; }
if (moved) {
  const st2 = pl.at(moved.f.time);
  const eid = session.demoBrushes.get(moved.n);
  frame = await session.demoFrame(st2.view, st2.brushes);
  const e = (await q(`SELECT x, y, z FROM ents WHERE id = ${eid}`))[0];
  const b = st2.brushes.find((x) => x.name === moved.n);
  check(near(e.X, b.origin[0]) && near(e.Y, b.origin[1]) && near(e.Z, b.origin[2]), `brush model ${moved.n} is moved to where frame ${demo.frames.indexOf(moved.f)} has it (${b.origin.map((v) => v.toFixed(0)).join(', ')})`);
  const key = session.demoBrushState.get(eid);
  await session.demoFrame(st2.view, st2.brushes);
  check(session.demoBrushState.get(eid) === key, 'and not written again while it stands');
} else check(false, 'a brush model that moves');
// a brush model's sounds come from the middle of its box, not its origin (CL_GetEntitySoundOrigin: solid 31 marks a
// brush model, whose origin is wherever the mapper left it): its loop (a door's middle sound while it moves) given the
// map's bounds, and a one-shot sound at it with no position of its own; without the bounds, from the origin as before
{
  let bl = null;
  for (const f of demo.frames) { for (const s of f.ents.values()) { const n = demo.models[s.modelindex]; if (s.sound && s.solid === 31 && n && n[0] === '*') { bl = { f, s, n }; break; } } if (bl) break; }
  if (bl) {
    const bounds = (n) => setup.bsp.models[Number(n.slice(1))] ?? null;
    const b = bounds(bl.n), mid = [0, 1, 2].map((k) => (b.mins[k] + b.maxs[k]) / 2);
    const withB = new DemoPlayer(demo, { modelId: (n) => res.byName.get(n), brushBounds: bounds }).at(bl.f.time);
    const without = new DemoPlayer(demo, { modelId: (n) => res.byName.get(n) }).at(bl.f.time);
    const snd = demo.sounds[bl.s.sound];
    const lw = withB.loops.find((l) => l[0] === snd), lo = without.loops.find((l) => l[0] === snd);
    check(lw && lo && Math.hypot(...mid) > 8 && [0, 1, 2].every((k) => near(lw[k + 1], lo[k + 1] + mid[k])),
      `frame ${demo.frames.indexOf(bl.f)}: ${bl.n}'s loop ${snd} comes from the middle of its box (${lw?.slice(1).map((v) => v.toFixed(0)).join(', ')}), ${Math.hypot(...mid).toFixed(0)} from the origin it came from without the map's bounds`);
    const one = demo.frames.flatMap((f) => f.sounds.filter((x) => x.ent && !x.pos && f.ents.get(x.ent)?.solid === 31).map((x) => ({ x, f }))).find(Boolean);
    if (one) {
      const p3 = new DemoPlayer(demo, { modelId: (n) => res.byName.get(n), brushBounds: bounds });
      const s3 = p3.at(one.f.time);
      const row = p3.soundRows(s3.events, one.f, s3.view).rows.find((r) => r[0] === one.x.id);
      const e = one.f.ents.get(one.x.ent), bb = bounds(demo.models[e.modelindex]);
      check(row && bb && [0, 1, 2].every((k) => near(row[7 + k], e.origin[k] + (bb.mins[k] + bb.maxs[k]) / 2)),
        `frame ${demo.frames.indexOf(one.f)}: ${demo.sounds[one.x.num]} at brush model ${demo.models[e.modelindex]}, with no position of its own, comes from its box's middle too`);
    } else check(true, '(this demo has no one-shot sound at a brush model without a position)');
  } else check(false, 'a brush model with a looped sound');
}
check(frame.faces.length > 50 && frame.sounds.length === 0, `the frame after it has ${frame.faces.length} faces and no sounds of the game's own (the game is not ticking)`);

// ── painted: the faces, the entities and the gun make a picture ──
const cm = loadColormap(pak);
const stubCanvas = { width: 320, height: 240, getContext: () => ({ createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) };
const r = new Renderer(stubCanvas, { palette: cm.palette, colormap: cm.colormap, alphamap: cm.alphamap, pak });
r.setSize(320, 240);
r.setResources(res);
const fx = new Effects({ model: (n) => res.models.get(res.byName.get(n))?.mdl, sprite: (n) => res.models.get(res.byName.get(n))?.spr }, () => 0.5);
st = pl.at(0);
frame = await session.demoFrame(st.view, st.brushes);
const v = st.view;
r.dlights = fx.lights(st.ents, 0);
r.beginFrame({ x: v.x, y: v.y, z: v.viewZ, yaw: v.yaw, pitch: v.pitch, roll: v.roll, fov: 90 });
const frames = new Map();
for (const [id, [fr, eff]] of frame.brushFrames) frames.set(id, entityFrame(fr, eff, 0));
r.drawFaceList(frame.faces, st.lights, 0, frames, frame.brushAngles);
const walls = r.fb.slice();
const colours = new Set(walls).size;
let drawn = 0;
for (const e of st.ents) {
  const [, mid, fr, skin, x, y, z, pitch, yaw, roll, effects, alpha, kind] = e;
  const m = res.models.get(mid);
  if (kind === 'M') { r.drawAlias(m.mdl, fr, skin, [x, y, z], [pitch, yaw, roll], lightPoint(setup.bsp, x, y, z), { time: 0, alpha: alpha === 1 }); drawn++; }
  else if (m.spr) r.drawSprite(m.spr, 0, [x, y, z], 255, (effects & 128) !== 0);
}
const gun = res.models.get(res.byName.get(demo.models[f0.ps.gunindex]));
check(f0.ps.gunindex > 0 && !!gun?.mdl, `the gun in hand is ${demo.models[f0.ps.gunindex]}, frame ${f0.ps.gunframe}`);
if (gun?.mdl) { r.zb.fill(0); r.drawAlias(gun.mdl, f0.ps.gunframe, 0, [v.x, v.y, v.viewZ], [-v.pitch, v.yaw, 0], lightPoint(setup.bsp, v.x, v.y, v.viewZ), { near: 1, minlight: true }); }
let changed = 0;
for (let i = 0; i < walls.length; i++) if (walls[i] !== r.fb[i]) changed++;
check(colours > 16 && drawn > 0 && changed > 500, `the first frame paints: the walls in ${colours} colours, ${drawn} models and the gun over them (${changed} pixels)`);

console.log(failures ? `${failures} FAILED` : 'all good');
process.exit(failures ? 1 : 0);
