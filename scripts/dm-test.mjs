// dm-test.mjs – a deathmatch headless, through a Session: two clients at the map's deathmatch spots, no
// monsters, the deathmatch-only items spawned; a taken item gone for its delay and back with its sound
// (SetRespawn, DoRespawn); weapons that stay (DF_WEAPONS_STAY); the frags (ClientObituary's score), a kill, a
// suicide, the weapon tossed at death; the respawn with fresh pers at a deathmatch spot, by button or forced; an
// exit that kills (MOD_EXIT) unless allowed; the frag and time limits ending the level at the intermission, the
// same level over with DF_SAME_LEVEL; the other dmflags; a save and a level change keeping the mode; single
// player as it was.
//   node scripts/dm-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak } from '../src/pak.js';
import { createSchema, loadResources, SQL_FILES } from '../src/loader.js';
import { Session, SLOT_KEY } from '../src/session.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));
const db = new FirebirdBrowser('memory://quake2', { transport: new DirectTransport() });
await createSchema(db, sql);
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
const res = await loadResources(db, pak);

let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const q = async (s, args = []) => (await db.query(s, args)).rows;
const one = async (s, args = []) => (await q(s, args))[0];
const store = new Map();
const session = new Session(db, { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) });
session.use(pak, res);

const cmd = ({ fwd = 0, fire = 0, jump = 0, imp = 0 } = {}) => [1, fwd, 0, 0, 0, fire, jump, 1, imp];
const idle = cmd();
const players = () => q('SELECT p.id, p.ent_id, p.score, p.weapons, p.weapon, p.rockets, p.shells, e.x, e.y, e.z, e.yaw, e.health, e.deadflag FROM player p LEFT JOIN ents e ON e.id = p.ent_id ORDER BY p.id');
const place = async (pe, x, y, z, yaw = 0) => {
  await db.exec(`UPDATE ents SET x = ${x}, y = ${y}, z = ${z}, yaw = ${yaw}, vx = 0, vy = 0, vz = 0 WHERE id = ${pe}; EXECUTE PROCEDURE link_ent(${pe})`);
};
const spots = async () => (await q("SELECT ox, oy, oz FROM map_ents WHERE classname = 'info_player_deathmatch'")).map((s) => [s.OX, s.OY, s.OZ]);
const atSpot = (p, list) => list.some(([x, y]) => Math.abs(p.X - x) < 1 && Math.abs(p.Y - y) < 1);
const game = () => one('SELECT deathmatch, coop, dmflags, fraglimit, timelimit, intermission_time, next_map, exit_kind, time_, map_name FROM game');
const msgs = async () => (await q('SELECT msg FROM player ORDER BY id')).map((r) => r.MSG);
const tics = async (n, c1 = idle, c2 = idle) => { for (let i = 0; i < n; i++) await session.tic(c1, c2); };
const spawnItem = async (cls, x, y, z) => (await one(`EXECUTE BLOCK RETURNS (id INTEGER) AS BEGIN
  EXECUTE PROCEDURE spawn_ent('${cls}', ${x}, ${y}, ${z}) RETURNING_VALUES id;
  EXECUTE PROCEDURE set_model(id, item_model('${cls}'));
  UPDATE ents e SET e.solid = 1, e.movetype = 6, e.minx = -15, e.miny = -15, e.minz = -15, e.maxx = 15, e.maxy = 15, e.maxz = 15 WHERE e.id = :id;
  EXECUTE PROCEDURE link_ent(id); SUSPEND; END`)).ID;
const item = (cls) => one(`SELECT id, solid, mkind, think, nextthink, x, y, z FROM ents WHERE classname = '${cls}' ORDER BY id`);

// ── the game: two clients at deathmatch spots, the map as deathmatch had it ──
await session.startMap('demo1', { newGame: true, skill: 2, seed: 1, deathmatch: true });
let ps = await players();
let g = await game();
const dmSpots = await spots();
check(ps.length === 2 && g.DEATHMATCH === 1 && g.COOP === 0 && session.deathmatch && !session.coop && session.twoPlayers, 'a deathmatch has two clients and the deathmatch flag, not coop');
check(atSpot(ps[0], dmSpots) && atSpot(ps[1], dmSpots) && !(Math.abs(ps[0].X - ps[1].X) < 1 && Math.abs(ps[0].Y - ps[1].Y) < 1),
  `both at info_player_deathmatch spots of the map's ${dmSpots.length}, not the same one (${ps.map((p) => `${p.X.toFixed(0)},${p.Y.toFixed(0)}`).join(' and ')})`);
check(!(Math.abs(ps[0].X - 128) < 1 && Math.abs(ps[0].Y + 320) < 1), 'the first is not at the single-player start');
check((await one('SELECT COUNT(*) n FROM ents WHERE mtype IS NOT NULL')).N === 0, 'no monsters spawn in deathmatch');
const dmItems = await q("SELECT classname, COUNT(*) n FROM ents WHERE classname IN ('weapon_rocketlauncher', 'weapon_supershotgun', 'item_quad', 'weapon_machinegun') GROUP BY classname");
check(dmItems.length === 4, `the deathmatch-only items spawn (${dmItems.map((r) => r.CLASSNAME).join(', ')})`);
check(ps.every((p) => p.WEAPONS === 1 && p.WEAPON === 1 && p.HEALTH === 100 && p.SCORE === 0), 'each starts afresh: the blaster, a hundred, no frags');
await session.tic(idle, idle);
check(session.clients.length === 2 && session.clients[0].DEATHMATCH === 1 && session.clients[0].SCORE === 0 && session.clients[1].SCORE === 0, 'the tic\'s rows carry the mode and the frags');
const [p1, p2] = ps;

// ── an item taken comes back after its delay, with its sound; a new weapon is raised only over the blaster ──
let rl = await item('weapon_rocketlauncher');
await place(p1.ENT_ID, rl.X, rl.Y, rl.Z + 8);
await session.tic(idle, idle);
ps = await players();
rl = await item('weapon_rocketlauncher');
check((ps[0].WEAPONS & 128) === 128 && ps[0].WEAPON === 128 && ps[0].ROCKETS === 5, 'the rocket launcher is taken with its rockets and raised over the blaster');
check(rl && rl.SOLID === 0 && rl.MKIND === null && rl.THINK === 'item_respawn' && Math.abs(rl.NEXTTHINK - session.last.TIME_ - 30) < 0.1,
  `the item is gone, unseen and untouchable, to come back in 30 s (SetRespawn; think ${rl?.THINK}, in ${(rl?.NEXTTHINK - session.last.TIME_).toFixed(1)})`);
await db.exec(`UPDATE ents SET nextthink = ${session.last.TIME_ + 0.1} WHERE id = ${rl.ID}`);
await place(p1.ENT_ID, p1.X, p1.Y, p1.Z);
await tics(3);
rl = await item('weapon_rocketlauncher');
const f = await session.frame({ client: 1 });
check(rl.SOLID === 1 && rl.MKIND === 'M' && rl.THINK === null, 'back where it was, solid and seen (DoRespawn)');
check(f.sounds.some((s) => s[4] === 'items/respawn1.wav') && f.fx.some((e) => e[1] === 17), 'with its sound and its particles (EV_ITEM_RESPAWN)');
await db.exec(`UPDATE player SET weapon = 2, weapons = BIN_OR(weapons, 2) WHERE id = 1`);   // a shotgun in hand
const mg = await item('weapon_machinegun');
await place(p1.ENT_ID, mg.X, mg.Y, mg.Z + 8);
await session.tic(idle, idle);
ps = await players();
check((ps[0].WEAPONS & 8) === 8 && ps[0].WEAPON === 2, 'another weapon taken while a shotgun is in hand is not raised (only the blaster gives way)');

// ── DF_WEAPONS_STAY: a weapon stays, and one already held is left ──
await db.exec('UPDATE game SET dmflags = 4 WHERE id = 1');
const ssg = await item('weapon_supershotgun');
await place(p1.ENT_ID, ssg.X, ssg.Y, ssg.Z + 8);
await session.tic(idle, idle);
ps = await players();
const ssg2 = await item('weapon_supershotgun');
check((ps[0].WEAPONS & 4) === 4 && ssg2.SOLID === 1 && ssg2.THINK === null, 'with weapons stay the super shotgun is taken and stays');
const shells = ps[0].SHELLS;
await session.tic(idle, idle);
check((await players())[0].SHELLS === shells, 'and one already held is left, its ammo untaken');
await place(p1.ENT_ID, p1.X, p1.Y, p1.Z);
await db.exec('UPDATE game SET dmflags = 0 WHERE id = 1');

// ── CheatsOk: in a deathmatch god, notarget, noclip and give are refused unless the cheats cvar is on; kill is no cheat ──
{
  const flags = async () => (await one(`SELECT e.flags, e.movetype FROM ents e WHERE e.id = ${p2.ENT_ID}`));
  const before = await flags();
  const refused = [];
  for (const c of ['god', 'notarget', 'noclip', 'give']) refused.push((await one(`SELECT msg FROM player_command('${c}', '', 2)`)).MSG);
  const after = await flags();
  check(refused.every((m) => m === "You must run the server with '+set cheats 1' to enable this command.") && after.FLAGS === before.FLAGS && after.MOVETYPE === before.MOVETYPE && (await one('SELECT cheats FROM game')).CHEATS === 0,
    `with cheats 0 the cheats are refused as CheatsOk refused them, the client untouched (${refused[0]})`);
  check((await one('SELECT p.msg FROM player p WHERE p.id = 2')).MSG === "You must run the server with '+set cheats 1' to enable this command.", 'the refusal is on the client\'s message line');
  await db.exec('UPDATE game SET cheats = 1 WHERE id = 1');
  check((await one("SELECT msg FROM player_command('god', '', 2)")).MSG === 'godmode ON' && ((await flags()).FLAGS & 16) !== 0, 'with cheats 1 they run');
  await q("SELECT msg FROM player_command('god', '', 2)");
  await db.exec('UPDATE game SET cheats = 0 WHERE id = 1');
}

// ── the frags: a kill, a suicide, the weapon tossed at death ──
await db.exec('UPDATE game SET cheats = 1 WHERE id = 1');   // (the gifts below are cheats)
await q("SELECT msg FROM player_command('give', 'shotgun', 2)");
await q("SELECT msg FROM player_command('give', 'shells 10', 2)");
await db.exec('UPDATE player SET weapon = 2 WHERE id = 2');
const bolt = (await one(`EXECUTE BLOCK RETURNS (id INTEGER) AS BEGIN EXECUTE PROCEDURE spawn_ent('bolt', 0, 0, 0) RETURNING_VALUES id; UPDATE ents e SET e.owner_id = ${p1.ENT_ID}, e.effects = 8 WHERE e.id = :id; SUSPEND; END`)).ID;
await db.exec(`EXECUTE PROCEDURE t_damage(${p2.ENT_ID}, ${bolt}, ${p1.ENT_ID}, 1000, 0, 4)`);
ps = await players();
let m = await msgs();
check(ps[1].DEADFLAG === 1 && ps[0].SCORE === 1 && ps[1].SCORE === 0 && m[0] === 'player 2 was blasted by player 1.', `a kill is a frag for the killer (${m[0]})`);
const tossed = await one(`SELECT id, spawnflags FROM ents WHERE classname = 'weapon_shotgun' AND BIN_AND(spawnflags, 65536) <> 0`);
check(tossed && Math.hypot((await one(`SELECT x, y FROM ents WHERE id = ${tossed.ID}`)).X - ps[1].X, (await one(`SELECT x, y FROM ents WHERE id = ${tossed.ID}`)).Y - ps[1].Y) < 80, 'the shotgun in hand is tossed where the client died (TossClientWeapon)');
await tics(22);
await session.tic(idle, cmd({ jump: 1 }));
ps = await players();
check(ps[1].DEADFLAG === 0 && ps[1].HEALTH === 100 && ps[1].WEAPONS === 1 && ps[1].WEAPON === 1 && ps[1].SHELLS === 0 && atSpot(ps[1], dmSpots),
  `a button a second later respawns it afresh at a deathmatch spot (${ps[1].X.toFixed(0)},${ps[1].Y.toFixed(0)}; the blaster, no shells)`);
check(ps[0].SCORE === 1 && ps[1].SCORE === 0, 'the frags stay through a respawn');
await q("SELECT msg FROM player_command('kill', '', 2)");
ps = await players(); m = await msgs();
check(ps[1].SCORE === -1 && m[1] === 'player 2 suicides.', `a suicide costs a frag (${m[1]})`);
await tics(22);
await session.tic(idle, cmd({ fire: 1 }));
check((await players())[1].DEADFLAG === 0, 'fire respawns too');
await db.exec(`EXECUTE PROCEDURE t_damage(${p2.ENT_ID}, 0, 0, 1000, 0, 8)`);
ps = await players(); m = await msgs();
check(ps[1].SCORE === -2 && m[1] === 'player 2 cratered.', `the world's kill costs a frag (${m[1]})`);
// DF_FORCE_RESPAWN: back without a button
await db.exec('UPDATE game SET dmflags = 1024 WHERE id = 1');
await tics(22);
check((await players())[1].DEADFLAG === 0, 'with force respawn the client is back a second later with no button');
await db.exec('UPDATE game SET dmflags = 0 WHERE id = 1');

// ── the exit kills, unless exits are allowed; then the level ends at the intermission ──
const exit = await one("SELECT id, map FROM ents WHERE classname = 'target_changelevel' ORDER BY id");
await db.exec(`EXECUTE PROCEDURE changelevel(${exit.ID}, ${p1.ENT_ID})`);
ps = await players(); m = await msgs(); g = await game();
check(ps[0].DEADFLAG === 1 && m[0] === 'player 1 found a way out.' && ps[0].SCORE === 0 && g.INTERMISSION_TIME === null && g.EXIT_KIND === 0,
  `an exit kills the client that touches it and the level goes on (${m[0]})`);
await tics(22, cmd({ jump: 1 }));
check((await players())[0].DEADFLAG === 0, 'the first client respawns');
await db.exec('UPDATE game SET dmflags = 4096 WHERE id = 1');
await db.exec(`EXECUTE PROCEDURE changelevel(${exit.ID}, ${p1.ENT_ID})`);
g = await game();
check(g.INTERMISSION_TIME !== null && g.NEXT_MAP === exit.MAP, `with exits allowed the exit ends the level at the intermission, bound for ${g.NEXT_MAP}`);
await session.tic(idle, idle);
check(session.clients[0].INTERMISSION === 1 && session.clients[0].DEATHMATCH === 1, 'the rows say intermission (the page shows the score board)');
await db.exec('UPDATE game SET intermission_time = NULL, next_map = NULL, dmflags = 0 WHERE id = 1');

// ── the frag limit and the time limit (CheckDMRules), the same level with DF_SAME_LEVEL ──
await db.exec('UPDATE game SET fraglimit = 3 WHERE id = 1; UPDATE player SET score = 3 WHERE id = 1');
await session.tic(idle, idle);
g = await game(); m = await msgs();
check(g.INTERMISSION_TIME !== null && m[0] === 'Fraglimit hit.' && g.NEXT_MAP === exit.MAP, `the frag limit ends the level, bound where the map's exit leads (${g.NEXT_MAP})`);
await db.exec('UPDATE game SET intermission_time = NULL, next_map = NULL, fraglimit = 0, dmflags = 32, timelimit = 1, time_ = 59.9 WHERE g.id = 1'.replace('g.id', 'id'));
await tics(3);
g = await game(); m = await msgs();
check(g.INTERMISSION_TIME !== null && m[0] === 'Timelimit hit.' && g.NEXT_MAP === 'demo1', `the time limit ends it; with the same level flag it is the same map again (${g.NEXT_MAP})`);
// the intermission ends on a button after five seconds, as the unit's end did
await db.exec('UPDATE game SET time_ = time_ + 6 WHERE id = 1');
await session.tic(cmd({ fire: 1 }), idle);
check(session.last.EXIT_KIND === 1 && session.last.NEXT_MAP === 'demo1', 'a button after five seconds leaves the intermission for the next map');

// ── a level change keeps the mode and starts the frags over; a save keeps the mode ──
const to = await session.leave('demo2$base1');
await session.startMap('demo2', { skill: 2, spawnpoint: to.spawn });
ps = await players(); g = await game();
check(ps.length === 2 && g.DEATHMATCH === 1 && session.deathmatch && atSpot(ps[0], await spots()) && atSpot(ps[1], await spots()) && ps.every((p) => p.SCORE === 0 && p.WEAPONS === 1),
  'the next level is a deathmatch too, both at its spots, the frags and the pers fresh (InitClientResp, InitClientPersistant)');
check((await one('SELECT COUNT(*) n FROM ents WHERE mtype IS NOT NULL')).N === 0 && (await one("SELECT COUNT(*) n FROM ents WHERE classname = 'weapon_chaingun'")).N === 1, 'no monsters, the deathmatch chain gun');
await db.exec('UPDATE player SET score = 4 WHERE id = 2');
await session.writeSave(SLOT_KEY(2), 'dm');
await session.startMap('demo1', { newGame: true, skill: 2, deathmatch: false, coop: false });
check(!session.deathmatch && (await players()).length === 1, 'a single-player game after it has one client and no deathmatch');
await session.loadSave(await session.readSave(SLOT_KEY(2)), { skill: 2 });
ps = await players();
check(session.deathmatch && !session.coop && ps.length === 2 && ps[1].SCORE === 4 && (await game()).DEATHMATCH === 1, 'a loaded save brings the deathmatch back with its frags');

// ── the other dmflags: no health or armour spawned, infinite ammo, no falling damage, instant items, spawn farthest ──
await session.startMap('demo1', { newGame: true, skill: 2, seed: 1, deathmatch: true, cvars: { dmflags: 1 + 2048 + 8192, fraglimit: 0, timelimit: 0, cheats: 1 } });   // (cheats: the gifts below)
check((await one('SELECT cheats FROM game')).CHEATS === 1, 'the cheats cvar given to the map load is on the game row');
check((await game()).DMFLAGS === 1 + 2048 + 8192 && session.cvars.dmflags === 1 + 2048 + 8192, 'the cvars reach the game row through the session');
const left = await q("SELECT classname, COUNT(*) n FROM ents WHERE classname LIKE 'item_health%' OR classname LIKE 'item_armor%' OR classname LIKE 'ammo_%' GROUP BY classname");
check(left.length === 0, 'no health, no armour and no ammo spawn with DF_NO_HEALTH, DF_NO_ARMOR and DF_INFINITE_AMMO');
check((await one("SELECT COUNT(*) n FROM ents WHERE classname = 'item_quad'")).N === 1, 'the quad still does');
ps = await players();
await q("SELECT msg FROM player_command('give', 'rocket launcher', 1)");
await db.exec('UPDATE player SET weapon = 128, rockets = 5, attack_finished = 0 WHERE id = 1');
await session.tic(cmd({ fire: 1 }), idle);
check((await players())[0].ROCKETS === 5 && (await session.frame({ client: 1 })).sounds.some((s) => s[4] === 'weapons/rocklf1a.wav'), 'a rocket fired with infinite ammo spends none');
// a fall of 400 units lands at about 800 a second: 20 of damage, or none with DF_NO_FALLING
const drop = async () => { await db.exec(`UPDATE ents SET z = z + 400, vz = 0 WHERE id = ${ps[0].ENT_ID}; EXECUTE PROCEDURE link_ent(${ps[0].ENT_ID})`); await tics(30); };
await db.exec('UPDATE game SET dmflags = 8 WHERE id = 1');
await drop();
check((await players())[0].HEALTH === 100, 'a hard landing with DF_NO_FALLING does no damage');
await db.exec('UPDATE game SET dmflags = 0 WHERE id = 1');
await drop();
check((await players())[0].HEALTH < 100 && (await players())[0].HEALTH > 60, `without it it does (${(await players())[0].HEALTH})`);
await db.exec('UPDATE game SET dmflags = 16 WHERE id = 1');
const quad = await item('item_quad');
await place(ps[0].ENT_ID, quad.X, quad.Y, quad.Z + 8);
await session.tic(idle, idle);
const qf = await one('SELECT quad_finished, inv_quad FROM player WHERE id = 1');
check(qf.QUAD_FINISHED > session.last.TIME_ && qf.INV_QUAD === 0 && (await item('item_quad')).THINK === 'item_respawn', 'with instant items the quad is used as it is taken, and comes back in a minute');
await db.exec('UPDATE game SET dmflags = 512 WHERE id = 1');
await q("SELECT msg FROM player_command('kill', '', 2)");
await tics(22);
await session.tic(idle, cmd({ jump: 1 }));
ps = await players();
const far = dmSpots.map(([x, y, z]) => [Math.hypot(x - ps[0].X, y - ps[0].Y, z - ps[0].Z), x, y]).sort((a, b) => b[0] - a[0])[0];
check(Math.abs(ps[1].X - far[1]) < 1 && Math.abs(ps[1].Y - far[2]) < 1, `with spawn farthest the respawn is at the spot farthest from the other client (${far[0].toFixed(0)} units)`);

// ── DF_QUAD_DROP: a death tosses a quad with more than a second left beside the weapon, each 22.5 degrees to a side,
// the quad to go when it would have run out; without the flag the quad dies with its owner ──
await db.exec('UPDATE game SET dmflags = 16384 WHERE id = 1');
await q("SELECT msg FROM player_command('give', 'shotgun', 2)");
await q("SELECT msg FROM player_command('give', 'shells 10', 2)");
const tq = (await game()).TIME_;
await db.exec(`UPDATE player SET weapon = 2, quad_finished = ${tq + 30} WHERE id = 2`);
await db.exec("DELETE FROM ents WHERE classname IN ('weapon_shotgun', 'item_quad') AND BIN_AND(spawnflags, 65536) <> 0");
await db.exec(`EXECUTE PROCEDURE t_damage(${ps[1].ENT_ID}, 0, 0, 1000, 0, 8)`);
const dq = await one("SELECT id, think, nextthink, vx, vy FROM ents WHERE classname = 'item_quad' AND BIN_AND(spawnflags, 65536) <> 0");
const dw = await one("SELECT id, vx, vy FROM ents WHERE classname = 'weapon_shotgun' AND BIN_AND(spawnflags, 65536) <> 0");
check(dq && dq.THINK === 'remove' && Math.abs(dq.NEXTTHINK - (tq + 30)) < 1e-6 && dw && (await players())[1].DEADFLAG === 1,
  `with DF_QUAD_DROP a death tosses the quad with the weapon, to go when it would have run out (${dq ? (dq.NEXTTHINK - tq).toFixed(1) : '?'} s on)`);
const apart = dq && dw ? Math.abs(((Math.atan2(dq.VY, dq.VX) - Math.atan2(dw.VY, dw.VX)) * 180 / Math.PI + 540) % 360 - 180) : 0;
check(Math.abs(apart - 45) < 0.5, `the two tossed 22.5 degrees to either side of the view (${apart.toFixed(1)} apart)`);
await tics(22);
await session.tic(idle, cmd({ jump: 1 }));
await db.exec('UPDATE game SET dmflags = 0 WHERE id = 1');
await db.exec("DELETE FROM ents WHERE classname IN ('weapon_shotgun', 'item_quad') AND BIN_AND(spawnflags, 65536) <> 0");
await db.exec(`UPDATE player SET quad_finished = ${(await game()).TIME_ + 30} WHERE id = 2`);
await db.exec(`EXECUTE PROCEDURE t_damage(${ps[1].ENT_ID}, 0, 0, 1000, 0, 8)`);
check(!(await one("SELECT id FROM ents WHERE classname = 'item_quad' AND BIN_AND(spawnflags, 65536) <> 0")), 'without the flag the quad dies with its owner');
await tics(22);
await session.tic(idle, cmd({ jump: 1 }));
ps = await players();

// ── the mega health waits while its owner is above the maximum, then comes back ──
await db.exec('UPDATE game SET dmflags = 0 WHERE id = 1');
const mega = await spawnItem('item_health_mega', ps[0].X, ps[0].Y, ps[0].Z);
await session.tic(idle, idle);
let mh = await one(`SELECT solid, think, owner_id FROM ents WHERE id = ${mega}`);
check((await players())[0].HEALTH > 100 && mh.SOLID === 0 && mh.THINK === 'mega_think' && mh.OWNER_ID === ps[0].ENT_ID, 'a mega health taken waits unseen with its owner (MegaHealth_think)');
await db.exec(`UPDATE ents SET health = 100 WHERE id = ${ps[0].ENT_ID}; UPDATE ents SET nextthink = ${session.last.TIME_ + 0.1} WHERE id = ${mega}`);
await tics(3);
mh = await one(`SELECT solid, think, nextthink FROM ents WHERE id = ${mega}`);
check(mh.THINK === 'item_respawn' && Math.abs(mh.NEXTTHINK - session.last.TIME_ - 20) < 0.3, 'its owner back at the maximum, it comes back in twenty seconds');

// ── a coop game and single player are as they were ──
await session.startMap('demo1', { newGame: true, skill: 2, seed: 1, coop: true, deathmatch: false });
ps = await players();
check(session.coop && !session.deathmatch && ps.length === 2 && Math.abs(ps[0].X - 128) < 1 && (await one('SELECT COUNT(*) n FROM ents WHERE mtype IS NOT NULL')).N > 0, 'a coop game starts at the start, with the monsters');
await session.startMap('demo1', { newGame: true, skill: 2, seed: 1, coop: false, deathmatch: false });
check(!session.twoPlayers && (await players()).length === 1 && (await game()).DEATHMATCH === 0, 'single player has one client');

console.log(failures ? `${failures} failure(s)` : 'all good');
process.exit(failures ? 1 : 0);
