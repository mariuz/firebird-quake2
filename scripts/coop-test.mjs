// coop-test.mjs – a coop game headless: two clients in the SQL, as p_client.c had them. The second starts at its
// info_player_coop, each sends its own usercmd and gets its own row from the tic and its own view; the monsters
// look for the clients in turn (AI_SetSightClient) and drop a dead one; a weapon or a key one client takes stays
// for the other (IT_STAY_COOP); a dead client comes back at its spot with what it entered the level with, its
// body left behind (respawn, PutClientInServer); a level change and a save carry both clients; and single player
// is as it was: one row.
//   node scripts/coop-test.mjs
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

// the usercmd as Input.read gives it: tics, forward, side, yaw, pitch, fire, jump, run, impulse
const cmd = ({ fwd = 0, fire = 0, jump = 0, imp = 0 } = {}) => [1, fwd, 0, 0, 0, fire, jump, 1, imp];
const idle = cmd();
const players = () => q('SELECT p.id, p.ent_id, e.x, e.y, e.z, e.yaw, e.health, e.deadflag, e.classname, p.weapons, p.keys FROM player p LEFT JOIN ents e ON e.id = p.ent_id ORDER BY p.id');
const place = async (pe, x, y, z, yaw = 0) => {
  await db.exec(`UPDATE ents SET x = ${x}, y = ${y}, z = ${z}, yaw = ${yaw}, vx = 0, vy = 0, vz = 0 WHERE id = ${pe}; EXECUTE PROCEDURE link_ent(${pe})`);
};
const spawnItem = async (cls, x, y, z) => (await one(`EXECUTE BLOCK RETURNS (id INTEGER) AS BEGIN
  EXECUTE PROCEDURE spawn_ent('${cls}', ${x}, ${y}, ${z}) RETURNING_VALUES id;
  EXECUTE PROCEDURE set_model(id, item_model('${cls}'));
  UPDATE ents e SET e.solid = 1, e.movetype = 6, e.minx = -15, e.miny = -15, e.minz = -15, e.maxx = 15, e.maxy = 15, e.maxz = 15 WHERE e.id = :id;
  EXECUTE PROCEDURE link_ent(id); SUSPEND; END`)).ID;

// ── the game starts with two clients ──
await session.startMap('demo1', { newGame: true, skill: 2, seed: 1, coop: true });
let ps = await players();
check(ps.length === 2 && ps.every((p) => p.CLASSNAME === 'player' && p.HEALTH === 100), `a coop game has two clients, both players (${ps.map((p) => p.ENT_ID).join(', ')})`);
const [p1, p2] = ps;
check(Math.abs(p1.X - 128) < 1 && Math.abs(p1.Y + 320) < 1, `the first at the map's start (${p1.X.toFixed(0)},${p1.Y.toFixed(0)})`);
check([32, 96, 168].some((x) => Math.abs(p2.X - x) < 1) && Math.abs(p2.Y + 224) < 1 && Math.abs(p2.YAW - 90) < 1,
  `the second at an info_player_coop without a name, facing its angle (${p2.X.toFixed(0)},${p2.Y.toFixed(0)} yaw ${p2.YAW})`);
check((await one('SELECT coop, spawnpoint FROM game')).COOP === 1, 'game.coop is set');
check((await q('SELECT id FROM coop_respawn')).length === 2, 'both clients have their respawn copy of the pers');

// ── each client's usercmd, each client's row ──
let rows = await session.tic(idle, cmd({ fwd: 1 }));
check(session.clients.length === 2 && session.clients[0].CLIENT === 1 && session.clients[1].CLIENT === 2 && rows === session.clients[0],
  'the tic returns a row per client, the first first, and `last` is the first\'s');
for (let i = 0; i < 10; i++) await session.tic(idle, cmd({ fwd: 1 }));
ps = await players();
check(Math.abs(ps[0].X - p1.X) < 0.01 && Math.abs(ps[0].Y - p1.Y) < 0.01, 'the first client, idle, stays put');
check(Math.hypot(ps[1].X - p2.X, ps[1].Y - p2.Y) > 50, `the second walks on its usercmd (${Math.hypot(ps[1].X - p2.X, ps[1].Y - p2.Y).toFixed(0)} units in 11 tics)`);
check(session.clients[1].PX === ps[1].X && session.clients[1].PY === ps[1].Y, 'its row carries its own position');
await session.tic(idle, cmd({ imp: 2 }));
check((await one('SELECT imp FROM usercmd WHERE client = 2')).IMP === 0, 'an impulse is spent by the tic it came in');
await session.tic(idle);
check(session.clients.length === 2, 'a tic without the second usercmd still runs both (the last command holds)');

// ── each client's view ──
const v1 = await one('SELECT * FROM view_setup(1)'), v2 = await one('SELECT * FROM view_setup(2)');
check(Math.abs(v1.EX - ps[0].X) < 0.01 && Math.abs(v2.EX - ps[1].X) < 0.01 && v1.LEAF !== v2.LEAF, `view_setup(client) is each client's eye (leaves ${v1.LEAF}, ${v2.LEAF})`);
const f1 = await session.frame({ client: 1 }), f2 = await session.frame({ client: 2 });
check(f1.faces.length > 50 && f2.faces.length > 50 && f1.faces.length !== f2.faces.length, `each client's frame is its own (${f1.faces.length} and ${f2.faces.length} faces)`);
check(!f1.ents.some((e) => e[0] === p1.ENT_ID) && !f2.ents.some((e) => e[0] === p2.ENT_ID), 'a client\'s own model is not in its frame');
const sqlF = await session.frame({ client: 2, sqlRenderer: true });
check(sqlF.faces.length > 0, 'the SQL-projecting mode takes the client too');
check((await q('SELECT idx FROM inventory_list(2)')).some((r) => r.IDX === 7), 'inventory_list(client) is the client\'s (the blaster)');

// ── the monsters look for the clients in turn, and for whoever is left ──
const sight = async () => (await one('SELECT sight_client FROM game')).SIGHT_CLIENT;
await session.tic(idle);
const s1 = await sight();
await session.tic(idle);
const s2 = await sight();
check(s1 !== s2 && [s1, s2].includes(p1.ENT_ID) && [s1, s2].includes(p2.ENT_ID), `the sight client alternates between the two (${s1}, ${s2})`);
await q("SELECT msg FROM player_command('notarget', '', 1)");
await session.tic(idle); await session.tic(idle);
check((await sight()) === p2.ENT_ID && (await sight()) === p2.ENT_ID, 'a notarget client is passed over');
// the second client where the first stands, a soldier in front of them: it hunts the second
await place(p2.ENT_ID, p1.X + 24, p1.Y, p1.Z, p1.YAW);
const mon = (await one("SELECT * FROM spawn_monster('soldier', 200)")).ID;
let enemy = null;
for (let i = 0; i < 40 && enemy !== p2.ENT_ID; i++) { await session.tic(idle, idle); enemy = (await one(`SELECT enemy_id FROM ents WHERE id = ${mon}`)).ENEMY_ID; }
check(enemy === p2.ENT_ID, `a monster that sees the clients goes for the sight client (soldier ${mon} → ${enemy})`);
await q("SELECT msg FROM player_command('god', '', 1)");
await q("SELECT msg FROM player_command('give', 'shotgun', 2)");
check((await players())[1].WEAPONS === 3 && (await players())[0].WEAPONS === 1, 'the console\'s commands take a client: give shotgun to the second');
await q("SELECT msg FROM player_command('kill', '', 2)");
ps = await players();
check(ps[1].DEADFLAG === 1 && ps[1].HEALTH <= 0 && ps[0].DEADFLAG === 0, 'the second client dies; the first lives on');
check(session.last.EXIT_KIND === 0, 'nobody\'s death ends the game (no load menu)');
await q("SELECT msg FROM player_command('notarget', '', 1)");   // off again
// centerview (IN_CenterView): the client's view level again, the other client's as it was
await db.exec('UPDATE player SET pitch = 30 WHERE id = 1; UPDATE player SET pitch = -20 WHERE id = 2');
await q("SELECT msg FROM player_command('centerview', '', 1)");
const pitches = (await q('SELECT pitch FROM player ORDER BY id')).map((r) => r.PITCH);
check(pitches[0] === 0 && pitches[1] === -20, `centerview levels the client's view and nobody else's (${pitches.join(', ')})`);
// wave (Cmd_Wave_f): the first client's taunt, its frames stepping where the second sees them (set_client_frame), the word on its line
await q("SELECT msg FROM player_command('wave', '2', 1)");
const wv = await one('SELECT p.anim_priority pr, p.anim_end fin, e.frame f, p.msg m FROM player p JOIN ents e ON e.id = p.ent_id WHERE p.id = 1');
await session.tic(idle, idle); await session.tic(idle, idle);
const wv2 = await one('SELECT e.frame f, p.anim_priority pr FROM player p JOIN ents e ON e.id = p.ent_id WHERE p.id = 1');
check(wv.PR === 1 && wv.FIN === 111 && wv.F === 94 && wv.M === 'taunt' && wv2.F === 96 && wv2.PR === 1,
  `wave 2 taunts: the frames from taunt01 step a tic (${wv.F} → ${wv2.F}, to ${wv.FIN}), the word said (${wv.M})`);
for (let i = 0; i < 6; i++) await session.tic(idle, idle);
enemy = (await one(`SELECT enemy_id FROM ents WHERE id = ${mon}`)).ENEMY_ID;
check(enemy !== p2.ENT_ID, `with its enemy dead the monster drops it (enemy ${enemy ?? 'none'})`);
for (let i = 0; i < 40 && enemy !== p1.ENT_ID; i++) { await session.tic(idle, idle); enemy = (await one(`SELECT enemy_id FROM ents WHERE id = ${mon}`)).ENEMY_ID; }
check(enemy === p1.ENT_ID, 'and finds the other client');
await db.exec(`DELETE FROM ents WHERE id = ${mon}`);

// ── a dead client comes back: any button a second after dying, at its spot, as it entered the level ──
for (let i = 0; i < 5; i++) await session.tic(idle, cmd({ fire: 1 }));
check((await players())[1].DEADFLAG === 1, 'fire within the first second after dying does nothing');
for (let i = 0; i < 20; i++) await session.tic(idle, idle);
await session.tic(idle, cmd({ jump: 1 }));
ps = await players();
check(ps[1].DEADFLAG === 0 && ps[1].HEALTH === 100 && ps[1].ENT_ID === p2.ENT_ID, 'a button a second later respawns it: alive, full health, the same entity');
check([32, 96, 168].some((x) => Math.abs(ps[1].X - x) < 1) && Math.abs(ps[1].Y + 224) < 1, `back at its coop spot (${ps[1].X.toFixed(0)},${ps[1].Y.toFixed(0)})`);
check(ps[1].WEAPONS === 1, 'with the pers it entered the level with (the shotgun given since is gone)');
const body = await one(`SELECT id, classname, deadflag, solid, takedamage, x, y FROM ents WHERE classname = 'bodyque'`);
check(body && body.DEADFLAG === 1 && body.SOLID === 2 && body.TAKEDAMAGE === 2 && Math.abs(body.X - (p1.X + 24)) < 40, `the body stays where it fell (${body?.X?.toFixed(0)},${body?.Y?.toFixed(0)})`);
const tele = (await session.frame({ client: 1 })).fx;
check(tele.some((e) => e[1] === 5), 'a teleport effect marks the respawn (EV_PLAYER_TELEPORT)');
check(session.clients[1].DEAD === 0 && session.clients[1].HEALTH === 100, 'its row says so');
await db.exec(`EXECUTE PROCEDURE t_damage(${body.ID}, ${p1.ENT_ID}, ${p1.ENT_ID}, 200, 0, 0)`);
check(!(await one(`SELECT id FROM ents WHERE id = ${body.ID}`)), 'the body gibs when hurt enough (body_die)');

// ── the trail is each client's own (p_trail.c kept the one player's): a marker a client, and a monster pursuing the
// second client follows the second's markers, not the first's ──
{
  await db.exec("DELETE FROM player_trail; UPDATE player SET trail_x = 1e30, trail_y = 1e30, trail_z = 1e30");
  await place(p1.ENT_ID, 128, -320, 32, 135);
  await place(p2.ENT_ID, 32, -224, 32, 135);
  await db.exec('EXECUTE PROCEDURE player_trail_check');
  const trail = () => q('SELECT client, seq, x, y FROM player_trail ORDER BY client, seq');
  let tr = await trail();
  check(tr.length === 2 && tr[0].CLIENT === 1 && tr[1].CLIENT === 2 && tr[0].X === 128 && tr[1].X === 32,
    `the first check drops a marker for each client where it stands (${tr.map((m) => `client ${m.CLIENT} at ${m.X.toFixed(0)}`).join(', ')})`);
  await db.exec('UPDATE player_trail SET z = z - 4000 WHERE client = 2');   // (the second's marker sunk out of its sight)
  await place(p2.ENT_ID, 72, -224, 32, 135);
  await db.exec('EXECUTE PROCEDURE player_trail_check');
  tr = await trail();
  check(tr.filter((m) => m.CLIENT === 2).length === 2 && tr.filter((m) => m.CLIENT === 1).length === 1, 'the second client, out of sight of its marker, drops another of its own; the first\'s trail is untouched');
  const hunter = (await one("SELECT * FROM spawn_monster('soldier', 200)")).ID;
  await db.exec(`UPDATE ents SET enemy_id = ${p2.ENT_ID}, trail_time = 0 WHERE id = ${hunter}`);
  const pick2 = await one(`SELECT x, y FROM trail_pick(${hunter}, 0, 0)`);
  await db.exec(`UPDATE ents SET enemy_id = ${p1.ENT_ID} WHERE id = ${hunter}`);
  const pick1 = await one(`SELECT x, y FROM trail_pick(${hunter}, 0, 0)`);
  check(pick2 && Math.abs(pick2.X - 32) < 1e-6 && pick1 && Math.abs(pick1.X - 128) < 1e-6, `a monster pursuing the second client picks the second's markers (at ${pick2?.X}), pursuing the first the first's (at ${pick1?.X})`);
  await db.exec(`UPDATE ents SET enemy_id = NULL WHERE id = ${hunter}`);
  check(!(await one(`SELECT x FROM trail_pick(${hunter}, 0, 0)`)), 'with no client for an enemy, no trail to follow');
  await db.exec(`DELETE FROM ents WHERE id = ${hunter}; DELETE FROM player_trail`);
}

// ── the chat (Cmd_Say_f, client_say): a client's words on every client's message line, by its name ──
const msgs = async () => (await q('SELECT msg FROM player ORDER BY id')).map((r) => r.MSG);
await db.exec('UPDATE player SET msg = NULL');
await session.say(2, '  hello there  ');
check((await msgs()).join('|') === 'player 2: hello there|player 2: hello there', 'say puts the words on every message line as "name: text", trimmed');
await db.exec("UPDATE player SET netname = 'Ace' WHERE id = 1");
await session.say(1, 'Hi!');
check((await msgs())[1] === 'Ace: Hi!', 'a named client speaks by its name, the words as typed');
await db.exec("UPDATE player SET netname = '' WHERE id = 1; UPDATE player SET msg = NULL");
await session.say(1, '   ');
check((await msgs()).every((m) => m === null), 'nothing said prints nothing');

// ── the obituaries (ClientObituary, coop only): every client's message line says who died of what ──
const respawn = async () => { for (let i = 0; i < 22; i++) await session.tic(idle, idle); await session.tic(idle, cmd({ jump: 1 })); };
const dieOf = async (sql, want) => {
  await db.exec(sql);
  const m = await msgs();
  check(m[0] === want && m[1] === want, `${JSON.stringify(m[0])}`);
  await respawn();
};
await dieOf(`EXECUTE PROCEDURE t_damage(${p2.ENT_ID}, ${p2.ENT_ID}, ${p2.ENT_ID}, 100000, 0, 34)`, 'player 2 suicides.');
await dieOf(`EXECUTE PROCEDURE t_damage(${p2.ENT_ID}, 0, 0, 1000, 0, 8)`, 'player 2 cratered.');
await db.exec(`UPDATE ents SET watertype = 8, waterlevel = 1 WHERE id = ${p2.ENT_ID}`);
await dieOf(`EXECUTE PROCEDURE t_damage(${p2.ENT_ID}, 0, 0, 1000, 0, 34)`, 'player 2 does a back flip into the lava.');
await db.exec(`UPDATE ents SET watertype = 32, waterlevel = 3 WHERE id = ${p2.ENT_ID}`);
await dieOf(`EXECUTE PROCEDURE t_damage(${p2.ENT_ID}, 0, 0, 1000, 0, 34)`, 'player 2 sank like a rock.');
const mon2 = (await one("SELECT * FROM spawn_monster('soldier', 200)")).ID;
await dieOf(`EXECUTE PROCEDURE t_damage(${p2.ENT_ID}, ${mon2}, ${mon2}, 1000, 0, 0)`, 'player 2 died.');
await db.exec(`DELETE FROM ents WHERE id = ${mon2}`);
const bolt = (await one(`EXECUTE BLOCK RETURNS (id INTEGER) AS BEGIN EXECUTE PROCEDURE spawn_ent('bolt', 0, 0, 0) RETURNING_VALUES id; UPDATE ents e SET e.owner_id = ${p1.ENT_ID}, e.effects = 8 WHERE e.id = :id; SUSPEND; END`)).ID;
await dieOf(`EXECUTE PROCEDURE t_damage(${p2.ENT_ID}, ${bolt}, ${p1.ENT_ID}, 1000, 0, 4)`, 'player 2 was blasted by player 1.');
await db.exec(`UPDATE ents SET effects = 64 WHERE id = ${bolt}`);
await dieOf(`EXECUTE PROCEDURE t_damage(${p2.ENT_ID}, ${bolt}, ${p1.ENT_ID}, 1000, 0, 4)`, "player 2 was melted by player 1's hyperblaster.");
await db.exec(`DELETE FROM ents WHERE id = ${bolt}; UPDATE player SET weapon = 4 WHERE id = 1`);
await dieOf(`EXECUTE PROCEDURE t_damage(${p2.ENT_ID}, ${p1.ENT_ID}, ${p1.ENT_ID}, 1000, 0, 16)`, "player 2 was blown away by player 1's super shotgun.");
await db.exec('UPDATE player SET weapon = 512 WHERE id = 1');
await dieOf(`EXECUTE PROCEDURE t_damage(${p2.ENT_ID}, ${p1.ENT_ID}, ${p1.ENT_ID}, 1000, 0, 0)`, 'player 2 was railed by player 1.');
const rk = (await one(`EXECUTE BLOCK RETURNS (id INTEGER) AS BEGIN EXECUTE PROCEDURE spawn_ent('rocket', 0, 0, 0) RETURNING_VALUES id; UPDATE ents e SET e.owner_id = ${p1.ENT_ID} WHERE e.id = :id; SUSPEND; END`)).ID;
await dieOf(`EXECUTE PROCEDURE t_damage(${p2.ENT_ID}, ${rk}, ${p1.ENT_ID}, 1000, 0, 1)`, "player 2 almost dodged player 1's rocket.");
await dieOf(`EXECUTE PROCEDURE t_damage(${p2.ENT_ID}, ${rk}, ${p2.ENT_ID}, 1000, 0, 1)`, 'player 2 blew himself up.');
// the player setup's names (pers.netname, Session.setUserinfo: ClientUserinfoChanged) are the obituaries' and the rows'
await session.setUserinfo(1, { name: 'Ace', hand: 0 });
await session.setUserinfo(2, { name: 'Grunt with a long name', hand: 1 });
await dieOf(`EXECUTE PROCEDURE t_damage(${p2.ENT_ID}, ${rk}, ${p1.ENT_ID}, 1000, 0, 1)`, "Grunt with a lo almost dodged Ace's rocket.");
check(session.clients[0].NETNAME === 'Ace' && session.clients[1].NETNAME === 'Grunt with a lo' && session.clients[1].HAND === 1 && session.clients[0].HAND === 0,
  'the rows carry the names (cut at fifteen characters) and the hands');
await session.setUserinfo(2, { name: '', hand: 0 });
await dieOf(`EXECUTE PROCEDURE t_damage(${p2.ENT_ID}, ${rk}, ${p1.ENT_ID}, 1000, 0, 1)`, "player 2 almost dodged Ace's rocket.");
await db.exec(`DELETE FROM ents WHERE id = ${rk}; UPDATE player SET weapon = 1 WHERE id = 1`);
check((await players())[1].DEADFLAG === 0, 'and the client is back in the game after each');
// the hand turns the shots' origin (P_ProjectSource): 8 to the right of the eye, 8 to the left, or none
const muzzleAt = async (hand) => { await session.setUserinfo(1, { name: 'Ace', hand }); return one(`SELECT mx, my, mz, rx, ry FROM muzzle(${p1.ENT_ID}, 8, -8)`); };
const [mr, ml, mc] = [await muzzleAt(0), await muzzleAt(1), await muzzleAt(2)];
const sideOf = (m) => (m.MX - mc.MX) * mc.RX + (m.MY - mc.MY) * mc.RY;
check(Math.abs(sideOf(mr) - 8) < 1e-6 && Math.abs(sideOf(ml) + 8) < 1e-6 && Math.abs(mr.MZ - ml.MZ) < 1e-9 && Math.abs(mr.MZ - mc.MZ) < 1e-9,
  `a right-hander's muzzle is 8 to the right of a centre-hander's, a left-hander's 8 to the left (${sideOf(mr).toFixed(1)}, ${sideOf(ml).toFixed(1)}), at the same height`);
await session.setUserinfo(1, { name: '', hand: 0 });

// ── a weapon or a key one client takes stays for the other ──
ps = await players();
const sg = await spawnItem('weapon_shotgun', ps[0].X, ps[0].Y, ps[0].Z);
await session.tic(idle, idle);
check((await players())[0].WEAPONS === 3 && (await one(`SELECT id FROM ents WHERE id = ${sg}`)), 'the first client takes a shotgun, and the shotgun stays (IT_STAY_COOP)');
await session.tic(idle, idle);
check((await one(`SELECT id FROM ents WHERE id = ${sg}`)), 'a client that has it leaves it');
await place(p2.ENT_ID, ps[0].X, ps[0].Y, ps[0].Z);
await session.tic(idle, idle);
check((await players())[1].WEAPONS === 3, 'the second client takes it too');
await place(p2.ENT_ID, p2.X, p2.Y, p2.Z, 90);
const key = await spawnItem('key_blue_key', ps[0].X, ps[0].Y, ps[0].Z);
await session.tic(idle, idle);
check((await players())[0].KEYS === 1 && (await one(`SELECT id FROM ents WHERE id = ${key}`)), 'the first client takes a key, and the key stays');
await place(p2.ENT_ID, ps[0].X, ps[0].Y, ps[0].Z);
await session.tic(idle, idle);
check((await players())[1].KEYS === 1, 'the second takes it too');
await place(p2.ENT_ID, p2.X, p2.Y, p2.Z, 90);

// ── power cubes: each has a bit of its own, a client takes each once, a door spends the same cube from every client ──
const cubes = () => q('SELECT p.id, p.keys, p.power_cubes, p.cube_mask FROM player p ORDER BY p.id');
const c1 = await spawnItem('key_power_cube', ps[0].X, ps[0].Y, ps[0].Z);
await db.exec(`UPDATE ents SET spawnflags = 256 WHERE id = ${c1}`);
await session.tic(idle, idle);
let cs = await cubes();
check(cs[0].POWER_CUBES === 1 && cs[0].CUBE_MASK === 256 && (cs[0].KEYS & 8) === 8 && (await one(`SELECT id FROM ents WHERE id = ${c1}`)), 'the first client takes a cube, and the cube stays');
await session.tic(idle, idle);
check((await cubes())[0].POWER_CUBES === 1, 'that cube is not taken twice');
const c2 = await spawnItem('key_power_cube', ps[0].X, ps[0].Y, ps[0].Z);
await db.exec(`UPDATE ents SET spawnflags = 512 WHERE id = ${c2}`);
await session.tic(idle, idle);
cs = await cubes();
check(cs[0].POWER_CUBES === 2 && cs[0].CUBE_MASK === 768, `another cube is (mask ${cs[0].CUBE_MASK})`);
await place(p2.ENT_ID, ps[0].X, ps[0].Y, ps[0].Z);
await session.tic(idle, idle);
cs = await cubes();
check(cs[1].POWER_CUBES === 2 && cs[1].CUBE_MASK === 768 && (await one(`SELECT COUNT(*) n FROM ents WHERE classname = 'key_power_cube'`)).N === 2, 'the second client takes both cubes, and they stay');
await place(p2.ENT_ID, p2.X, p2.Y, p2.Z, 90);
const door = async (item) => (await one(`EXECUTE BLOCK RETURNS (id INTEGER) AS BEGIN
  EXECUTE PROCEDURE spawn_ent('trigger_key', 0, 0, 0) RETURNING_VALUES id;
  UPDATE ents e SET e.item = '${item}', e.solid = 0 WHERE e.id = :id; SUSPEND; END`)).ID;
await db.exec(`EXECUTE PROCEDURE trigger_fire(${await door('key_power_cube')}, ${p1.ENT_ID})`);
cs = await cubes();
check(cs.every((c) => c.POWER_CUBES === 1 && c.CUBE_MASK === 512 && (c.KEYS & 8) === 8), `a door the first client opens spends the first cube from both (masks ${cs.map((c) => c.CUBE_MASK).join(', ')})`);
await db.exec(`EXECUTE PROCEDURE trigger_fire(${await door('key_blue_key')}, ${p2.ENT_ID})`);
cs = await cubes();
check(cs.every((c) => (c.KEYS & 1) === 0 && (c.KEYS & 8) === 8), `a door the second opens with the blue key takes it from both (keys ${cs.map((c) => c.KEYS).join(', ')})`);
const hp = await spawnItem('item_health', ps[0].X, ps[0].Y, ps[0].Z);
await db.exec(`UPDATE ents SET health = 50 WHERE id = ${p1.ENT_ID}`);
await session.tic(idle, idle);
check(!(await one(`SELECT id FROM ents WHERE id = ${hp}`)), 'anything else goes when taken, as in single player');
await db.exec("EXECUTE PROCEDURE cprint((SELECT ent_id FROM player WHERE id = 2), 'for two')");
check((await one('SELECT cprint FROM player WHERE id = 2')).CPRINT === 'for two' && (await one('SELECT cprint FROM player WHERE id = 1')).CPRINT !== 'for two', 'a centerprint reaches one client');

// ── a save carries both clients ──
await session.writeSave(SLOT_KEY(1), 'coop');
const before = await players();
for (let i = 0; i < 10; i++) await session.tic(idle, cmd({ fwd: 1 }));
await session.loadSave(await session.readSave(SLOT_KEY(1)), { skill: 2 });
ps = await players();
check(session.coop && ps.length === 2 && ps[1].X === before[1].X && ps[1].Y === before[1].Y && ps[1].KEYS === before[1].KEYS && (ps[1].KEYS & 8) === 8,
  'a loaded save brings both clients back where they were, with what they had');
check((await q('SELECT id FROM coop_respawn')).length === 2 && (await one('SELECT coop FROM game')).COOP === 1, 'and the respawn copies and the coop flag');

// ── a level change carries both, each with the health it left with ──
await db.exec(`UPDATE ents SET health = 55 WHERE id = ${p2.ENT_ID}`);
const h1 = (await players())[0].HEALTH;
const to = await session.leave('demo2$base1');
await session.startMap('demo2', { skill: 2, spawnpoint: to.spawn });
ps = await players();
check(ps.length === 2 && ps.every((p) => p.CLASSNAME === 'player'), 'the next level has both clients');
check(ps[1].HEALTH === 55 && ps[0].HEALTH === h1 && h1 < 100, `each with the health it left with (${ps[0].HEALTH}, ${ps[1].HEALTH})`);
check(Math.abs(ps[1].Y - 2232) < 1 && [828, 876].some((x) => Math.abs(ps[1].X - x) < 1), `the second at the coop spot named by the exit (base1: ${ps[1].X.toFixed(0)},${ps[1].Y.toFixed(0)})`);
check(ps[1].KEYS === 0 && ps[1].WEAPONS === 3, 'its pers come along (the shotgun; keys do not carry over)');
await session.tic(idle, idle);
const back = await session.leave('demo1');
await session.startMap('demo1', { skill: 2, spawnpoint: back.spawn });
ps = await players();
check(ps.length === 2 && ps[0].ENT_ID !== ps[1].ENT_ID && (await q("SELECT id FROM ents WHERE classname = 'player'")).length === 2, 'a level come back to puts both clients in afresh');
await session.tic(idle, idle);
check(session.clients.length === 2, 'and the game runs on with two');

// ── three and four players: a client each at the next info_player_coop, a usercmd each, a row and a view each ──
await session.startMap('demo1', { newGame: true, skill: 2, seed: 1, coop: true, players: 4 });
ps = await players();
check(session.nclients === 4 && ps.length === 4 && ps.every((p) => p.CLASSNAME === 'player' && p.HEALTH === 100), `four players: four clients, all players (${ps.map((p) => p.ENT_ID).join(', ')})`);
check(new Set(ps.slice(1).map((p) => Math.round(p.X))).size === 3 && ps.slice(1).every((p) => [32, 96, 168].some((x) => Math.abs(p.X - x) < 1) && Math.abs(p.Y + 224) < 1),
  `the second to fourth at the three info_player_coop, one each (${ps.slice(1).map((p) => p.X.toFixed(0)).join(', ')})`);
check((await q('SELECT id FROM coop_respawn')).length === 4, 'four respawn copies');
rows = await session.tic(idle, idle, cmd({ fwd: 1 }), idle);
check(session.clients.length === 4 && session.clients.map((c) => c.CLIENT).join() === '1,2,3,4' && rows === session.clients[0], 'the tic returns four rows, in client order');
for (let i = 0; i < 10; i++) await session.tic(idle, idle, cmd({ fwd: 1 }), idle);
const four = await players();
check(Math.abs(four[2].Y - ps[2].Y) > 40 && Math.abs(four[1].Y - ps[1].Y) < 1 && Math.abs(four[3].Y - ps[3].Y) < 1, `the third's command moves the third alone (${(four[2].Y - ps[2].Y).toFixed(0)} units)`);
await session.tic(idle, null, null, cmd({ fwd: 1 }));
check(Math.abs((await players())[3].Y - four[3].Y) > 3, 'a null stands for a client that sends nothing; the fourth\'s command moves the fourth');
const f4 = await session.frame({ client: 4 });
check(f4.faces.length > 0 && !f4.ents.some((e) => e[0] === four[3].ENT_ID), 'the fourth client\'s frame has its view (its own entity not in it)');
await session.writeSave(SLOT_KEY(2), 'four');
await session.startMap('demo1', { newGame: true, skill: 2, seed: 1, coop: true, players: 2 });
check((await players()).length === 2 && session.nclients === 2, 'a new game with two has two again');
await session.loadSave(await session.readSave(SLOT_KEY(2)), { skill: 2 });
check((await players()).length === 4 && session.players === 4 && session.nclients === 4, 'a save of four loads four, and the session knows it');
await session.startMap('demo1', { newGame: true, skill: 2, seed: 1, coop: true, players: 3 });
ps = await players();
check(ps.length === 3 && (await q('SELECT id FROM coop_respawn')).length === 3, 'three players: three clients');
const to3 = await session.leave('demo2$base1');
await session.startMap('demo2', { skill: 2, spawnpoint: to3.spawn });
check((await players()).length === 3, 'a level change keeps the three');
await session.startMap('demo1', { newGame: true, skill: 2, seed: 1, coop: true, deathmatch: true, players: 4 });
ps = await players();
check(session.deathmatch && ps.length === 4 && new Set(ps.map((p) => `${p.X.toFixed(0)},${p.Y.toFixed(0)}`)).size === 4, 'a deathmatch of four: four clients at four spots');
check((await one('SELECT COUNT(*) n FROM ents WHERE mtype IS NOT NULL')).N === 0, 'and no monsters');
await session.startMap('demo1', { newGame: true, skill: 2, seed: 1, coop: true, deathmatch: false, players: 9 });
check((await players()).length === 4 && session.coop, 'more than four is four');

// ── DF_NO_FRIENDLY_FIRE: in coop every client is on the one team; with the flag a client's hit on another does nothing,
// without it it hurts, and the world hurts either way (CheckTeamDamage) ──
await session.startMap('demo1', { newGame: true, skill: 2, seed: 1, coop: true, cvars: { dmflags: 256 } });
const ff = await players();
await db.exec(`UPDATE ents SET health = 100 WHERE id = ${ff[1].ENT_ID}; UPDATE player SET armor = 0, armor_type = 0, power_armor = 0 WHERE id = 2`);
await db.exec(`EXECUTE PROCEDURE t_damage(${ff[1].ENT_ID}, ${ff[0].ENT_ID}, ${ff[0].ENT_ID}, 30, 0, 0)`);
check((await players())[1].HEALTH === 100, 'with DF_NO_FRIENDLY_FIRE a client\'s hit on the other does no damage');
await db.exec(`EXECUTE PROCEDURE t_damage(${ff[1].ENT_ID}, 0, 0, 30, 0, 8)`);
check((await players())[1].HEALTH === 70, 'the world\'s hurt still does');
await db.exec('UPDATE game SET dmflags = 0 WHERE id = 1');
await db.exec(`EXECUTE PROCEDURE t_damage(${ff[1].ENT_ID}, ${ff[0].ENT_ID}, ${ff[0].ENT_ID}, 30, 0, 0)`);
check((await players())[1].HEALTH === 40, 'without the flag a client hurts the other');

// ── single player is as it was ──
await session.startMap('demo1', { newGame: true, skill: 2, seed: 1, coop: false });
ps = await players();
check(ps.length === 1 && (await q("SELECT id FROM ents WHERE classname = 'player'")).length === 1, 'a single-player game has one client');
await session.tic(idle);
check(session.clients.length === 1 && session.last.CLIENT === 1, 'and the tic returns one row');
check((await one('SELECT coop FROM game')).COOP === 0 && !session.coop, 'coop is off');

console.log(failures ? `${failures} failure(s)` : 'all good');
process.exit(failures ? 1 : 0);
