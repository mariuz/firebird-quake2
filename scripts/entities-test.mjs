// entities-test.mjs – the full game's entities that the demo maps lack, put into demo1's entity lump
// and spawned: func_door_secret (shot open, and used; its two moves, its waits, home again),
// target_earthquake (the player thrown about, the rumble, the end), trigger_elevator (a button's
// pathtarget sends the train), misc_viper with misc_viper_bomb (unseen until used, the bomb falls along
// the viper's way and goes off), the strogg ships' flybys (unseen until used, from their first
// corner on, the corners' targets kept), target_string with its target_characters and func_clock (the
// digits of a string on brush models' frames; a timer counting up to its pathtarget, the time of day),
// the decorations that cycle their frames (misc_blackhole, the Easter tank) or stand (light_mine), a turret
// (the breach aims at the player and turns at its speed, the base and the driver with it, the shots after the
// reaction time; the driver's death levels the gun), and target_spawner.
//
//   node scripts/entities-test.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak } from '../src/pak.js';
import { createSchema, loadResources, loadMap, SQL_FILES } from '../src/loader.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));
let failed = 0;
const assert = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); failed++; } else console.log(`ok   ${msg}`); };

const db = new FirebirdBrowser('memory://quake2', { transport: new DirectTransport() });
await createSchema(db, sql);
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
const res = await loadResources(db, pak);
await loadMap(db, pak, res, 'demo1', { skill: 2, seed: 1 });
const q1 = (s) => db.query(s).then((r) => r.rows[0]);
const qa = (s) => db.query(s).then((r) => r.rows);
const tic = () => db.query('SELECT * FROM q2_tic(1, 0, 0, 0, 0, 0, 0, 1, 0)');
const ent = (cls) => q1(`SELECT * FROM ents WHERE classname = '${cls}' ORDER BY id`);

// the additions: two of the map's func_walls become secret doors (*9 is shot open, *10 is used and moves
// down first), and new rows for the rest, near the player's start (128, -320, 24)
await db.exec(`UPDATE map_ents SET classname = 'func_door_secret' WHERE id = 116`);
await db.exec(`UPDATE map_ents SET classname = 'func_door_secret', targetname = 'sdoor', angle = 90, spawnflags = 4 WHERE id = 117`);
let nid = (await q1('SELECT MAX(id) m FROM map_ents')).M;
const add = async (cls, x, y, z, extra = {}) => {
  const cols = { id: ++nid, classname: cls, ox: x, oy: y, oz: z, spawnflags: 0, ...extra };
  await db.exec(`INSERT INTO map_ents (${Object.keys(cols).join(', ')}) VALUES (${Object.values(cols).map((v) => (typeof v === 'string' ? `'${v}'` : v)).join(', ')})`);
};
await add('target_earthquake', 128, -320, 40, { targetname: 'quake', count_: 1 });
await add('trigger_elevator', 0, 0, 0, { targetname: 'elev', target: 't91' });
await add('path_corner', 128, -320, 300, { targetname: 'vp1', target: 'vp2' });
await add('path_corner', 2128, -320, 300, { targetname: 'vp2', target: 'vp1' });
await add('misc_viper', 128, -320, 300, { targetname: 'vip', target: 'vp1', speed: 300 });
await add('misc_viper_bomb', 128, -320, 150, { targetname: 'bomb', dmg: 50 });
await add('misc_blackhole', 200, -400, 24, { targetname: 'hole' });
await add('misc_eastertank', 300, -400, 24);
await add('light_mine1', 100, -400, 36);
// a display of five characters (brush models the map has, shared) and a timer counting to 3 that then uses the hole
for (let i = 1; i <= 5; i++) await add('target_character', 0, 0, 0, { model: ['*9', '*10', '*12', '*9', '*10'][i - 1], team: 'disp', count_: i });
await add('target_string', 0, -500, 24, { targetname: 'disp', team: 'disp', message: '12:34' });
await add('func_clock', 0, -520, 24, { target: 'disp', pathtarget: 'hole', spawnflags: 1 + 4, count_: 3, style: 1 });
await add('target_string', 0, -540, 24, { targetname: 'tod' });
await add('func_clock', 0, -560, 24, { target: 'tod', style: 2 });
// a turret in the open by the start, facing +x: the breach and base share two of the map's brush models, the
// muzzle 32 ahead, the driver 40 units beside it
await add('turret_breach', 60, -320, 40, { model: '*9', team: 'tur', targetname: 'tb', target: 'muz', angle: 0, dmg: 10 });
await add('turret_base', 60, -320, 40, { model: '*10', team: 'tur' });
await add('info_notnull', 92, -320, 48, { targetname: 'muz' });
await add('turret_driver', 60, -280, 40, { target: 'tb' });
await add('target_spawner', 160, -220, 40, { targetname: 'spw', target: 'misc_explobox' });
await add('target_spawner', 160, -220, 60, { targetname: 'spw2', target: 'misc_gib_arm', angle: 90, speed: 100 });
const world = (await q1('SELECT world_model w FROM game')).W;
await db.exec('DELETE FROM sound_events; DELETE FROM fx_events; DELETE FROM ents');
await db.exec(`EXECUTE PROCEDURE init_map('demo1', ${world}, 2, 1, NULL)`);
const pe = (await q1('SELECT ent_id e FROM player')).E;
await db.exec(`UPDATE ents SET flags = BIN_OR(flags, 16 + 64) WHERE id = ${pe}`);   // god, notarget
await db.exec("DELETE FROM ents WHERE mtype IS NOT NULL AND classname <> 'turret_driver'");   // the map's monsters, not the turret's driver
// fire a targetname as if the player's own target, with a pathtarget for the elevator
const use = (name, pathtarget = null) => db.query(`EXECUTE BLOCK AS BEGIN
  UPDATE ents SET target = '${name}', pathtarget = ${pathtarget ? `'${pathtarget}'` : 'NULL'} WHERE id = ${pe};
  EXECUTE PROCEDURE use_targets(${pe}, ${pe});
  UPDATE ents SET target = NULL, pathtarget = NULL WHERE id = ${pe}; END`);
const near = (a, b) => Math.abs(a - b) < 0.5;

// ── strogg ships (demo1's own): unseen until their trigger_always, then from their first corner on
{
  const ship = await q1("SELECT id, mkind FROM ents WHERE classname = 'misc_strogg_ship' AND x = -1280");
  assert(ship && ship.MKIND === null, 'a strogg ship is unseen before it is used (SVF_NOCLIENT)');
  for (let i = 0; i < 6; i++) await tic();
  const s2 = await q1(`SELECT e.mkind, (SELECT c.targetname FROM ents c WHERE c.id = e.goal_id) g FROM ents e WHERE e.id = ${ship.ID}`);
  assert(s2.MKIND?.trim() === 'M' && s2.G !== 't143', `used, it shows up and flies on from its first corner (heading for ${s2.G})`);
  for (let i = 0; i < 30; i++) await tic();
  const c = await q1("SELECT target FROM ents WHERE classname = 'path_corner' AND targetname = 't144'");
  assert(c.TARGET === 't145', `a corner whose pathtarget fired keeps its own target (${c.TARGET})`);
}

// ── func_door_secret, shot: back (here aside: its first move is to the right of its angle), a second, along, five, back
{
  const d = await q1("SELECT id, x, y, z, p1x, p1y, p1z, p2x, p2y, p2z, takedamage, maxx - minx sx, maxy - miny sy FROM ents WHERE classname = 'func_door_secret' AND (targetname IS NULL OR targetname = '')");
  assert(d && d.TAKEDAMAGE === 1 && near(d.P1Y, d.Y - d.SY) && near(d.P1X, d.X) && near(d.P2X, d.X + d.SX) && near(d.P2Y, d.P1Y),
    `a secret door without a name can be shot; its moves: ${d.SY.toFixed(0)} to the right, then ${d.SX.toFixed(0)} along its angle`);
  await db.exec(`EXECUTE PROCEDURE t_damage(${d.ID}, ${pe}, ${pe}, 10, 0, 0)`);
  const seen = {}; let t = 0;
  for (let i = 0; i < 400; i++) {
    await tic(); t = (i + 1) * 0.05;
    const p = await q1(`SELECT x, y, z, takedamage, mv_done FROM ents WHERE id = ${d.ID}`);
    if (!seen.p1 && near(p.X, d.P1X) && near(p.Y, d.P1Y)) seen.p1 = t;
    if (!seen.p2 && near(p.X, d.P2X) && near(p.Y, d.P2Y)) seen.p2 = t;
    if (seen.p2 && !seen.leave && !near(p.X, d.P2X)) seen.leave = t;
    if (seen.p2 && !seen.home && near(p.X, d.X) && near(p.Y, d.Y) && p.MV_DONE === null) { seen.home = t; seen.td = p.TAKEDAMAGE; break; }
  }
  const exp1 = d.SY / 50, exp2 = exp1 + 1 + d.SX / 50;
  assert(seen.p1 && Math.abs(seen.p1 - exp1) < 0.2 && seen.p2 && Math.abs(seen.p2 - exp2) < 0.25,
    `shot, it slides aside at 50 a second (${seen.p1?.toFixed(2)} s, ${exp1.toFixed(2)} expected), waits a second, slides along (${seen.p2?.toFixed(2)} s, ${exp2.toFixed(2)})`);
  assert(seen.leave && Math.abs(seen.leave - seen.p2 - 5) < 0.2, `it holds open five seconds (${(seen.leave - seen.p2).toFixed(2)})`);
  assert(seen.home && seen.td === 1, `and comes home to be shot again (${seen.home?.toFixed(2)} s)`);
}

// ── func_door_secret, named, 1ST_DOWN: not shootable; used, it goes down first
{
  const d = await q1("SELECT id, z, p1x, p1z, p2y, y, takedamage, maxz - minz sz, maxy - miny sy FROM ents WHERE classname = 'func_door_secret' AND targetname = 'sdoor'");
  assert(d.TAKEDAMAGE === 0 && near(d.P1Z, d.Z - d.SZ) && near(d.P2Y, d.Y + d.SY), `a named secret door is not shot open; 1ST_DOWN goes ${d.SZ.toFixed(0)} down, then ${d.SY.toFixed(0)} along its angle (90)`);
  await use('sdoor');
  for (let i = 0; i < 10; i++) await tic();
  const p = await q1(`SELECT z FROM ents WHERE id = ${d.ID}`);
  assert(p.Z < d.Z - 5, `used, it moves down (z ${d.Z} → ${p.Z.toFixed(1)})`);
  await use('sdoor');
  const p2 = await q1(`SELECT mv_done FROM ents WHERE id = ${d.ID}`);
  assert(p2.MV_DONE === 'door_secret_move1', 'used again on its way, it goes on as it was (only a door at rest answers)');
}

// ── target_earthquake: a second of it
{
  await db.exec("DELETE FROM sound_events");
  await use('quake');
  let kicked = 0, rumbles = 0;
  for (let i = 0; i < 30; i++) {
    await tic();
    const p = await q1(`SELECT vz FROM ents WHERE id = ${pe}`);
    if (p.VZ > 50) kicked++;
  }
  rumbles = (await q1("SELECT COUNT(*) n FROM sound_events WHERE snd = 'world/quake.wav' AND attn = 0")).N;
  const eq = await ent('target_earthquake');
  assert(kicked >= 2, `the ground throws the player up (${kicked} tics rising fast in 1.5 s)`);
  assert(rumbles >= 2 && rumbles <= 3, `the rumble every half second, heard everywhere (${rumbles})`);
  assert(eq.NEXTTHINK === null, 'after its count of seconds it is still');
}

// ── trigger_elevator: the train goes to the corner the user's pathtarget names
{
  const tr = await q1("SELECT id, x, y, z, minx, miny, minz, mv_done FROM ents WHERE classname = 'func_train' AND targetname = 't91'");
  const corner = await q1("SELECT id, targetname, x, y, z FROM ents WHERE classname = 'path_corner' AND targetname = 't89'");
  assert(tr.MV_DONE === null, 'the train waits on its first corner');
  await use('elev', 't89');
  const t2 = await q1(`SELECT goal_id, mv_done FROM ents WHERE id = ${tr.ID}`);
  assert(t2.GOAL_ID === corner.ID && t2.MV_DONE === 'train_wait', `used with pathtarget t89, it sends the train there (${t2.MV_DONE})`);
  await use('elev', 't88');
  assert((await q1(`SELECT goal_id g FROM ents WHERE id = ${tr.ID}`)).G === corner.ID, 'not while the train moves');
  let arrived = false;
  for (let i = 0; i < 200 && !arrived; i++) {
    await tic();
    const p = await q1(`SELECT x, y, z, mv_done FROM ents WHERE id = ${tr.ID}`);
    arrived = p.MV_DONE === null && near(p.X, corner.X - tr.MINX) && near(p.Y, corner.Y - tr.MINY) && near(p.Z, corner.Z - tr.MINZ);
  }
  assert(arrived, 'it arrives at the corner');
}

// ── misc_viper and misc_viper_bomb
{
  const v = await ent('misc_viper'), b = await ent('misc_viper_bomb');
  assert(v.MKIND === null && b.MKIND === null && near(v.X, 128 + 16), 'the viper and its bomb are unseen until used; the viper waits on its first corner');
  await use('vip');
  for (let i = 0; i < 4; i++) await tic();
  const v2 = await q1(`SELECT x, vx, mkind FROM ents WHERE id = ${v.ID}`);
  assert(v2.MKIND?.trim() === 'M' && v2.X > v.X + 30 && near(v2.VX, 300), `used, the viper shows up and flies its path at its speed (vx ${v2.VX.toFixed(0)})`);
  await db.exec('DELETE FROM fx_events');
  await use('bomb');
  const b2 = await q1(`SELECT vx, vz, movetype, mkind, effects FROM ents WHERE id = ${b.ID}`);
  assert(b2.MKIND?.trim() === 'M' && b2.MOVETYPE === 6 && near(b2.VX, 300) && (b2.EFFECTS & 16), 'the bomb shows up and falls along the viper\'s way, a rocket\'s trail behind it');
  let gone = false;
  for (let i = 0; i < 100 && !gone; i++) { await tic(); gone = !(await q1(`SELECT COUNT(*) n FROM ents WHERE id = ${b.ID}`)).N; }
  const boom = (await q1('SELECT COUNT(*) n FROM fx_events WHERE kind = 9')).N;
  assert(gone && boom === 1, 'it goes off where it lands (TE_EXPLOSION2)');
}

// ── the turret: linked, aimed at the player once seen, turning at 50 a second, firing after the reaction time
{
  const b = await ent('turret_breach'), base = await ent('turret_base'), d = await ent('turret_driver');
  assert(b.OWNER_ID === d.ID && d.GOAL_ID === b.ID && near(d.DSTX, 40) && near(d.DSTY, 90) && near(b.DSTX, 32) && near(b.DSTZ, 8),
    `the driver drives the breach (40 units off it at 90°), the muzzle is 32 ahead and 8 up (${b.DSTX}, ${b.DSTZ})`);
  const master = await q1(`SELECT dmg, owner_id FROM ents WHERE id = ${b.LINKED_ID ?? b.ID}`);
  assert(b.P1X === 30 && b.P2X === -30 && b.P1Y === 0 && b.P2Y === 360 && b.SPEED === 50 && master.DMG === 10 && master.OWNER_ID === d.ID,
    'its limits and speed by default; the team master carries the dmg and the driver');
  assert(d.MTYPE?.trim() === 'infantry' && d.ENEMY_ID === null, 'the driver is an infantry with no enemy while the player is notarget');
  // the player in front of the turret (FindTarget wants that at close range), 33.7° off its aim
  await db.exec(`UPDATE ents SET x = 180, y = -240, z = 24, vx = 0, vy = 0, vz = 0, flags = BIN_AND(flags, BIN_NOT(64)) WHERE id = ${pe}`);
  await db.exec(`EXECUTE PROCEDURE link_ent(${pe})`);
  await db.exec("DELETE FROM sound_events");
  for (let i = 0; i < 20; i++) await tic();
  const b2 = await ent('turret_breach'), base2 = await ent('turret_base'), d2 = await ent('turret_driver');
  assert(d2.ENEMY_ID === pe && Math.abs(b2.SG_Y - 33.69) < 0.5, `seen, the player is the driver's enemy and the breach aims at it (yaw ${b2.SG_Y.toFixed(1)}, pitch ${b2.SG_X.toFixed(1)})`);
  assert(b2.YAW > 25 && b2.YAW <= 33.8 && Math.abs(base2.YAW - b2.YAW) < 6 && Math.abs(d2.YAW - b2.YAW) < 6,
    `a second on, the breach has turned ${b2.YAW.toFixed(1)}° toward it at 50°/s, the base (${base2.YAW.toFixed(1)}) and the driver (${d2.YAW.toFixed(1)}) with it`);
  const a = (b2.YAW + 90) * Math.PI / 180;
  assert(Math.abs(d2.X - (60 + 40 * Math.cos(a))) < 0.2 && Math.abs(d2.Y - (-320 + 40 * Math.sin(a))) < 0.2, `the driver is carried round the breach (${d2.X.toFixed(1)}, ${d2.Y.toFixed(1)})`);
  for (let i = 0; i < 30; i++) await tic();
  const shots = (await q1(`SELECT COUNT(*) n FROM sound_events WHERE snd = 'weapons/rocklf1a.wav'`)).N;
  const rockets = (await q1(`SELECT COUNT(*) n FROM ents WHERE classname = 'rocket' AND owner_id = ${d.ID}`)).N;
  assert(shots >= 1 && shots <= 2, `after the reaction time (a second on hard) it fires a rocket in the driver's name (${shots} shots, ${rockets} in flight)`);
  await db.exec(`UPDATE ents SET sg_x = -20 WHERE id = ${b.ID}`);
  const k0 = (await q1('SELECT killed k FROM game')).K;
  await db.exec(`EXECUTE PROCEDURE t_damage(${d.ID}, ${pe}, ${pe}, 150, 0, 32)`);
  const b3 = await ent('turret_breach'), d3 = await ent('turret_driver');
  // (gib_health 0: any death gibs it, as infantry_die would)
  assert(!d3 && (await q1('SELECT killed k FROM game')).K === k0 + 1 && b3.OWNER_ID === null && b3.SG_X === 0, 'the driver killed dies as an infantry (gibbed, counted); the gun is nobody\'s and levels');
  await db.exec(`UPDATE ents SET x = 128, y = -320, z = 24, flags = BIN_OR(flags, 64) WHERE id = ${pe}`);
  await db.exec(`EXECUTE PROCEDURE link_ent(${pe})`);
}

// ── target_spawner: its target's classname spawned at its place, moving at its speed along its angle
{
  const n0 = (await q1("SELECT COUNT(*) n FROM ents WHERE classname = 'misc_explobox'")).N;
  await use('spw');
  const box = await q1("SELECT x, y, z, health, solid FROM ents WHERE classname = 'misc_explobox' ORDER BY id DESC ROWS 1");
  assert((await q1("SELECT COUNT(*) n FROM ents WHERE classname = 'misc_explobox'")).N === n0 + 1 && near(box.X, 160) && near(box.Y, -220) && box.HEALTH === 10 && box.SOLID === 2,
    'used, it spawns a barrel where it stands, spawned as the map would have');
  await use('spw2');
  const gib = await q1("SELECT vx, vy, nextthink nt FROM ents WHERE classname = 'misc_gib_arm' ORDER BY id DESC ROWS 1");
  const t = (await q1('SELECT time_ t FROM game')).T;
  assert(gib && near(gib.VX, 0) && near(gib.VY, 100) && gib.NT > t + 20, `a gib with an angle and a speed sets off that way (vy ${gib.VY}); its removal is scheduled from now`);
}

// ── the decorations: frames running at 10 Hz, the black hole translucent and gone when used
{
  const h = await ent('misc_blackhole'), tk = await ent('misc_eastertank'), lm = await ent('light_mine1');
  // (the earlier checks ticked: the runs are under way)
  assert(h.DSTX === 0 && h.FRAME < 19 && (h.RENDERFX & 2) && tk.DSTX === 254 && tk.FRAME >= 254 && tk.FRAME < 293 && tk.SOLID === 2 && lm.MKIND?.trim() === 'M' && lm.SOLID === 2,
    'a black hole runs its 19 frames translucent, the Easter tank its frames 254..292, a mine light stands');
  for (let i = 0; i < 45; i++) await tic();
  const h2 = await ent('misc_blackhole'), tk2 = await ent('misc_eastertank');
  assert(h2.FRAME > 0 && h2.FRAME < 19 && tk2.FRAME > 254 && tk2.FRAME < 293, `2.25 s on, the hole is at frame ${h2.FRAME} (of 19, wrapped) and the tank at ${tk2.FRAME} (254..292)`);
}

// ── target_string, target_character, func_clock
{
  const chars = async () => (await qa("SELECT count_, frame FROM ents WHERE classname = 'target_character' ORDER BY count_")).map((c) => c.FRAME);
  assert((await chars()).join() === '12,12,12,12,12', 'the characters start blank (frame 12)');
  await use('disp');
  assert((await chars()).join() === '1,2,11,3,4', `used, the string shows 12:34 (frames ${(await chars()).join(' ')})`);
  // the timer: START_OFF, so used; then " 0:00", " 0:01", " 0:02", " 0:03" a second apart, and past its count the hole
  const clk = await q1("SELECT id FROM ents WHERE classname = 'func_clock' AND pathtarget = 'hole'");
  const hole = await q1("SELECT COUNT(*) n FROM ents WHERE classname = 'misc_blackhole'");
  assert(clk && hole.N === 1 && (await q1(`SELECT nextthink nt FROM ents WHERE id = ${clk.ID}`)).NT === null, 'a START_OFF timer waits to be used');
  await db.exec(`UPDATE ents SET targetname = 'clk' WHERE id = ${clk.ID}`);
  await use('clk');
  assert((await chars()).join() === '12,0,11,0,0', `used, it shows " 0:00" at once (frames ${(await chars()).join(' ')})`);
  for (let i = 0; i < 42; i++) await tic();
  assert((await chars()).join() === '12,0,11,0,2' && (await q1("SELECT COUNT(*) n FROM ents WHERE classname = 'misc_blackhole'")).N === 1,
    `2.1 s on it shows " 0:02" (frames ${(await chars()).join(' ')}), the hole still there`);
  for (let i = 0; i < 40; i++) await tic();
  assert((await chars()).join() === '12,0,11,0,3' && (await q1("SELECT COUNT(*) n FROM ents WHERE classname = 'misc_blackhole'")).N === 0,
    `past its count of 3 it fires its pathtarget: the hole is gone; it shows " 0:03" and stops (frames ${(await chars()).join(' ')})`);
  assert((await q1(`SELECT nextthink nt, enemy_id a FROM ents WHERE id = ${clk.ID}`)).NT === null, 'a timer without MULTI_USE runs once');
  const tod = await q1("SELECT message FROM ents WHERE classname = 'target_string' AND targetname = 'tod'");
  assert(/^[ 0-9][0-9]:[0-9]{2}:[0-9]{2}$/.test(tod.MESSAGE ?? ''), `a clock with no timer flag shows the time of day (${JSON.stringify(tod.MESSAGE)})`);
}

console.log(failed ? `${failed} FAILED` : 'all good');
process.exit(failed ? 1 : 0);
