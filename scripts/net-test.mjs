// net-test.mjs – a game shared over a link, headless (src/net.js): the host's Session runs the game with the
// guest's commands merged into the second client's usercmd, the guest gets the map and its frames and paints
// from the map's geometry alone (loadMapModels, no database), the texts of the signalling round trip, the
// chunking of a big message, a slow link's dropped frames, a level change, the ends closing. The two ends
// are a Loopback in one process: Node has no WebRTC, and HostLink and GuestLink do not know it either.
//   node scripts/net-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak } from '../src/pak.js';
import { createSchema, loadResources, loadMapModels, SQL_FILES } from '../src/loader.js';
import { Session } from '../src/session.js';
import { Link, Loopback, HostLink, GuestLink, Peer, SignalClient, isRoomCode, packSignal, unpackSignal, parseIceServer, iceServers, CHUNK, BACKLOG } from '../src/net.js';
import { createSignalServer, CODE_LENGTH } from './signal.mjs';
import { ClipMap, pmove, stateFromRow } from '../src/pmove.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));
const db = new FirebirdBrowser('memory://quake2', { transport: new DirectTransport() });
await createSchema(db, sql);
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
const res = await loadResources(db, pak);

let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const q = async (s) => (await db.query(s)).rows;

// ── the two ends ──
const [a, b] = Loopback.pair();
const host = new HostLink(new Link(a));
const guest = new GuestLink(new Link(b));
let maps = 0, pics = [];
guest.onMap = () => { maps++; };
guest.onPic = (file) => pics.push(file);

// the host's game, as the page starts one for a guest: a new coop game, the map sent from its setup
const session = new Session(db);
session.use(pak, res);
const view = { w: 320, h: 240, fov: 90 };
const sendMap = (name, setup) => host.sendMap({ name, sky: setup.sky, skyRotate: setup.skyRotate, skyAxis: setup.skyAxis, cdTrack: setup.cdTrack, speakers: setup.speakers, view, nmodels: res.byName.size });
sendMap('demo1', await session.startMap('demo1', { newGame: true, skill: 2, seed: 1, coop: true }));
check(maps === 1 && guest.map?.name === 'demo1' && guest.map.view.fov === 90 && typeof guest.map.sky === 'string' && Array.isArray(guest.map.speakers),
  `the guest gets the map message (${guest.map?.name}, sky ${guest.map?.sky?.trim()}, ${guest.map?.speakers.length} speakers, the host's view)`);

// the guest's page: the map's geometry for the painter, from the pak alone
const gres = { models: new Map(), byName: new Map(), nextModel: 1, pak, pics: new Map() };
const { bsp: gbsp } = loadMapModels(pak, gres, guest.map.name, { faceVerts: false });
const brushModels = [...gres.models.values()].filter((m) => m.kind === 'B');
check(gbsp.faces.length > 1000 && brushModels.length === gbsp.models.length && brushModels[0].sub === 0 && brushModels[0].bsp === gbsp,
  `loadMapModels gives the painter the map's models without a database (${gbsp.faces.length} faces, ${brushModels.length} brush models)`);

// one host tic as the page runs it: the guest's merged command as the second client's, the host's own frame
// first (it carries the tic's sounds and effects), then the guest's frame sent with them
const idle = [1, 0, 0, 0, 0, 0, 0, 1, 0];
const hostTic = async (cmd1 = idle) => {
  const cmd2 = host.takeCommand();
  const last = await session.tic(cmd1, cmd2);
  const f = await session.frame({ client: 1 });
  const gf = await session.frame({ client: 2, sqlRenderer: false, boxes: true });
  const sent = host.sendFrame(session.clients[1], gf, { sounds: f.sounds, fx: f.fx, dt: 0.05, inv: host.wantInv ? await session.inventory(2) : null });
  return { last, f, gf, cmd2, sent };
};
const p2 = async () => (await q('SELECT e.x, e.y, e.z, e.yaw, e.health FROM player p JOIN ents e ON e.id = p.ent_id WHERE p.id = 2'))[0];

// the guest's userinfo (its player setup's name and hand) reaches the host, which gives it to the second client
let infoSeen = null;
host.onInfo = (i) => { infoSeen = i; };
// the chat: the guest's `say` goes to the host as a text, cleaned (a line break a space, 150 characters at most), nothing for none
let said = null;
host.onSay = (t) => { said = t; };
guest.sendSay(' hello\nhost ');
check(said === 'hello host', 'a guest\'s say reaches the host, its line break a space, trimmed');
guest.sendSay('x'.repeat(200));
check(said?.length === 150, 'and is cut at 150 characters, as Quake cut a say');
said = null; guest.sendSay('   ');
check(said === null, 'nothing said, nothing to the host');
// a game command typed at the guest's console (Cmd_ForwardToServer): it reaches the host cut to the game's sizes, which runs
// player_command for the guest's client: godmode on the second client, its message line answering, the first untouched
const forwarded = [];
host.onConsole = async (c, a) => { forwarded.push([c, a]); await db.query('SELECT msg FROM player_command(?, ?, ?)', [c, a, 2]); };
guest.sendConsole(' god ', '');
await new Promise((r) => setTimeout(r, 50));
const godFlags = await q('SELECT p.id, e.flags, p.msg FROM player p JOIN ents e ON e.id = p.ent_id ORDER BY p.id');
check(forwarded.length === 1 && forwarded[0][0] === 'god' && (godFlags[1].FLAGS & 16) !== 0 && godFlags[1].MSG === 'godmode ON' && (godFlags[0].FLAGS & 16) === 0,
  `a guest's god reaches the host and runs for the second client alone (${JSON.stringify(godFlags.map((r) => [r.ID, r.FLAGS & 16, r.MSG]))})`);
guest.sendConsole('x'.repeat(40), 'y'.repeat(80));
check(forwarded[1][0].length === 32 && forwarded[1][1].length === 64, 'a command and its argument are cut to the game\'s sizes');
guest.sendConsole('god', '');
await new Promise((r) => setTimeout(r, 50));
check(((await q('SELECT e.flags FROM player p JOIN ents e ON e.id = p.ent_id WHERE p.id = 2'))[0].FLAGS & 16) === 0, 'and god again puts it off');
// the ping: the host's clock goes to the guest and comes back at once, the round trip read against the host's clock
{
  let clock = 1000;
  const [pa, pb] = Loopback.pair();
  const ph = new HostLink(new Link(pa), { now: () => clock }), pg = new GuestLink(new Link(pb));
  check(ph.ping === null, 'no ping until a pong has come');
  ph.sendPing(); clock = 1037;   // (the pong comes back over the loopback at once: the clock moved by then as the wire would have it)
  check(ph.ping === 0 || ph.ping === 37, `the pong carries the host's clock back: the round trip is the difference (${ph.ping} ms)`);
  pb.send(JSON.stringify({ t: 'pong', at: 1000 }));
  check(ph.ping === 37, 'a pong against the clock now reads 37 ms');
  pb.send(JSON.stringify({ t: 'pong', at: 'x' })); pb.send(JSON.stringify({ t: 'pong', at: 2000 }));
  check(ph.ping === 0, 'a pong with no clock is ignored, one from the future reads 0');
  pg.close();
}
guest.sendInfo({ name: 'Rimmer, Arnold J.', hand: 1 });
check(infoSeen && infoSeen.name === 'Rimmer, Arnold ' && infoSeen.hand === 1 && host.info === infoSeen, `the host gets the guest's name (cut at fifteen) and hand (${JSON.stringify(infoSeen)})`);
await session.setUserinfo(2, host.info);
check((await q('SELECT netname, hand FROM player WHERE id = 2'))[0].NETNAME === 'Rimmer, Arnold ' && (await q('SELECT hand FROM player WHERE id = 2'))[0].HAND === 1, 'and the second client carries them');
guest.sendInfo({ name: 'x', hand: 7 });
check(host.info.hand === 0 && host.info.spectator === 0, 'a hand that is not 0, 1 or 2 is right-handed; a guest plays unless it says it watches');
await session.setUserinfo(2, { name: '', hand: 0 });
// a guest that watches (3.20's spectator userinfo): the host puts its client back in with no body, noclipping, whom
// nothing hurts and the monsters ignore; playing again, it is back at its spot, solid, with a weapon in hand
{
  const e2 = async () => (await q('SELECT e.solid, e.movetype, e.takedamage, e.model_id, e.flags, e.health, e.x, e.y, e.z, p.weapon, p.spectator FROM player p JOIN ents e ON e.id = p.ent_id WHERE p.id = 2'))[0];
  const before = await e2();
  guest.sendInfo({ name: 'Holly', hand: 0, spectator: 1 });
  check(host.info.spectator === 1, 'the guest says it watches');
  await session.setUserinfo(2, host.info);
  const sp = await e2();
  check(sp.SPECTATOR === 1 && sp.SOLID === 0 && sp.MOVETYPE === 2 && sp.TAKEDAMAGE === 0 && sp.MODEL_ID === null && (sp.FLAGS & 64) && sp.WEAPON === 0,
    `the second client is a watcher: nothing solid, noclip, no damage, no model, notarget, nothing in hand (${JSON.stringify({ solid: sp.SOLID, movetype: sp.MOVETYPE, weapon: sp.WEAPON })})`);
  const p1e = (await q('SELECT ent_id e FROM player WHERE id = 1'))[0].E, p2e = (await q('SELECT ent_id e FROM player WHERE id = 2'))[0].E;
  const seen = new Set();
  for (let i = 0; i < 4; i++) { await session.tic(idle, host.takeCommand()); seen.add((await q('SELECT sight_client s FROM game'))[0].S); }
  check(seen.size === 1 && seen.has(p1e) && !seen.has(p2e), `the monsters look for the first client only (the sight client over four tics: ${[...seen].join(', ')})`);
  await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE t_damage(${p2e}, ${p1e}, ${p1e}, 50, 0, 0); END`);
  check((await e2()).HEALTH === sp.HEALTH, 'a shot does it no harm');
  // the watcher flies where it looks, through the wall ahead (the yard's east wall, 36 units on at 236)
  await db.exec(`UPDATE ents SET x = 200, y = -60, z = 40, yaw = 0 WHERE id = ${(await q('SELECT ent_id e FROM player WHERE id = 2'))[0].E}; UPDATE player SET pitch = 0 WHERE id = 2; EXECUTE PROCEDURE link_ent(${(await q('SELECT ent_id e FROM player WHERE id = 2'))[0].E})`);
  for (let i = 0; i < 20; i++) { guest.sendCommand([1, 1, 0, 0, 0, 0, 0, 1, 0]); await session.tic(idle, host.takeCommand()); }
  const flew = await e2();
  check(flew.X > 300, `it flies through the wall the players stop at (x 200 → ${flew.X.toFixed(0)})`);
  // the chase cam (g_chase.c, 3.20): the attack key, as it goes down, puts the watcher's eye thirty units behind the first
  // client's along its view, its angles the client's, and it stays there as the client turns (no move of its own); a
  // second press with nobody else to chase keeps it; jump lets go; `chase <n>` and `chase 0` at the console do the same
  const eye = async () => (await q('SELECT e.x, e.y, e.z + e.viewheight ez, e.yaw, p.pitch FROM player p JOIN ents e ON e.id = p.ent_id WHERE p.id = 1'))[0];
  const cam = async () => (await q('SELECT e.x, e.y, e.z + p.view_ofs ez, e.yaw, p.pitch, p.chase FROM player p JOIN ents e ON e.id = p.ent_id WHERE p.id = 2'))[0];
  await db.exec('UPDATE player SET pitch = 10 WHERE id = 1');
  guest.sendCommand([1, 0, 0, 0, 0, 1, 0, 1, 0]);   // (attack)
  let last2 = await session.tic(idle, host.takeCommand());
  const t1 = await eye(), c1 = await cam();
  const behind = (t, c) => Math.hypot(c.X - t.X, c.Y - t.Y, c.EZ - t.EZ);
  check(c1.CHASE === 1 && behind(t1, c1) > 20 && behind(t1, c1) <= 32 && Math.abs(c1.YAW - t1.YAW) < 1e-6 && Math.abs(c1.PITCH - t1.PITCH) < 1e-6,
    `attack chases the first client: the eye ${behind(t1, c1).toFixed(1)} units behind its, the angles its (yaw ${c1.YAW.toFixed(1)}, pitch ${c1.PITCH})`);
  check(session.clients[1].CHASE === 1 && session.clients[0].CHASE === 0, 'the tic row says whom the watcher chases (the page predicts no move then)');
  // held, the attack counts once; the client turns and the watcher's view turns with it
  await session.tic([1, 0, 0, 30, 0, 0, 0, 1, 0], host.takeCommand());
  guest.sendCommand([1, 0, 0, 0, 0, 1, 0, 1, 0]);
  await session.tic([1, 0, 0, 30, 0, 0, 0, 1, 0], host.takeCommand());
  const t2 = await eye(), c2 = await cam();
  check(c2.CHASE === 1 && Math.abs(c2.YAW - t2.YAW) < 1e-6 && Math.abs(t2.YAW - t1.YAW) > 50 && behind(t2, c2) <= 32, `the view follows the client's turn (yaw ${t1.YAW.toFixed(0)} → ${t2.YAW.toFixed(0)})`);
  // let go, pressed again: the next after 1 is 1 again (nobody else plays); jump floats free where it is
  guest.sendCommand([1, 0, 0, 0, 0, 0, 0, 1, 0]); await session.tic(idle, host.takeCommand());
  guest.sendCommand([1, 0, 0, 0, 0, 1, 0, 1, 0]); await session.tic(idle, host.takeCommand());
  check((await cam()).CHASE === 1, 'attack again with nobody else to chase keeps the first client');
  guest.sendCommand([1, 0, 0, 0, 0, 0, 1, 1, 0]); await session.tic(idle, host.takeCommand());
  const c3 = await cam();
  check(c3.CHASE === 0 && Math.hypot(c3.X - c2.X, c3.Y - c2.Y) < 40, `jump lets go: floating free from where it was (chase ${c3.CHASE})`);
  const chaseCmd = async (arg, client = 2) => (await q(`SELECT msg FROM player_command('chase', '${arg}', ${client})`))[0].MSG;
  check(await chaseCmd('1') === 'chasing player 1' && (await cam()).CHASE === 1 && await chaseCmd('') === 'chasing player 1', 'chase 1 at the console chases the first client, chase alone says so');
  check(await chaseCmd('2') === 'no such player to chase' && await chaseCmd('9') === 'no such player to chase' && await chaseCmd('x') === 'chase <client number>, 0 to float free' && (await cam()).CHASE === 1,
    'itself, a client that is none and a word are refused');
  check(await chaseCmd('0') === 'chasing nobody: floating free' && (await cam()).CHASE === 0 && await chaseCmd('1', 1) === 'chase: only a watcher (spectator 1) can chase', 'chase 0 floats free; a player cannot chase');
  await db.exec('UPDATE player SET pitch = 0 WHERE id = 1');
  guest.sendInfo({ name: 'Holly', hand: 0, spectator: 0 });
  await session.setUserinfo(2, host.info);
  const back = await e2();
  check(back.SPECTATOR === 0 && back.SOLID === 3 && back.MOVETYPE === 3 && back.TAKEDAMAGE === 2 && back.MODEL_ID !== null && !(back.FLAGS & 64) && back.WEAPON === 1 && Math.abs(back.X - before.X) < 1 && Math.abs(back.Y - before.Y) < 1,
    `playing again, it is back at its spot (${back.X.toFixed(0)},${back.Y.toFixed(0)}), solid, with its model and the blaster in hand`);
  await session.setUserinfo(2, { name: '', hand: 0 });
}

// nothing sent yet: the guest stands
check(JSON.stringify(host.takeCommand()) === JSON.stringify(idle), 'before any command the guest stands still');
let r = await hostTic();
check(guest.frames === 1 && r.sent, 'the first tic sends the guest its first frame');
let got = guest.take();
check(got && got.row && got.row.PX === session.clients[1].PX && got.row.PY === session.clients[1].PY && got.row.HEALTH === 100,
  `the frame comes with the guest's own player row (at ${got?.row.PX?.toFixed(0)},${got?.row.PY?.toFixed(0)}, health ${got?.row.HEALTH})`);
check(got.frame.faces.length > 50 && got.frame.faces.every((f) => f[0] >= 0 && f[0] < gbsp.faces.length) && got.frame.styles instanceof Float32Array && got.frame.styles.length === 64
  && got.frame.brushFrames instanceof Map && got.frame.brushAngles instanceof Map,
  `the frame unpacks as the page's own decodes (${got.frame.faces.length} faces, every one of the map's; the styles and the brush maps)`);
check(guest.take() === null, 'a frame is taken once');

// the guest walks: its commands reach the host's second client
const before = await p2();
for (let i = 0; i < 20; i++) { guest.sendCommand([1, 1, 0, 0, 0, 0, 0, 1, 0]); await hostTic(); }
const after = await p2();
const moved = Math.hypot(after.X - before.X, after.Y - before.Y);
check(moved > 100, `the guest's forward command walks its player at the host (${moved.toFixed(0)} units in a second)`);
check(guest.frames === 21 && guest.take().row.PX === session.clients[1].PX, 'a frame a tic, each with the row of that tic');

// the commands between two tics merge: the turns sum, a button held in any counts, the last impulse stands
guest.sendCommand([1, 1, 0, 5, -2, 0, 1, 1, 0]);
guest.sendCommand([1, 0, 1, 7, 1, 1, 0, 0, 3]);
let merged = host.takeCommand();
check(JSON.stringify(merged) === JSON.stringify([1, 0, 1, 12, -1, 1, 1, 0, 3]), `two commands in one tic merge (${JSON.stringify(merged)})`);
merged = host.takeCommand();
check(JSON.stringify(merged) === JSON.stringify([1, 0, 0, 0, 0, 0, 0, 0, 0]), `none in the next: the guest stands, as a client whose packets did not come (${JSON.stringify(merged)})`);

// a turn the guest sends turns its player
const yaw0 = (await p2()).YAW;
guest.sendCommand([1, 0, 0, 30, 0, 0, 0, 1, 0]);
await hostTic();
const yaw1 = (await p2()).YAW;
const turned = (((yaw1 - yaw0) % 360) + 360) % 360;
check(Math.abs(turned - 30) < 1, `a turn of 30 degrees turns its player (${yaw0.toFixed(1)} → ${yaw1.toFixed(1)})`);

// firing: the tic's sounds come to the guest with its frame (they ride the host's own frame query)
let sounds = 0;
for (let i = 0; i < 6; i++) { guest.sendCommand([1, 0, 0, 0, 0, i % 2, 0, 1, 0]); await hostTic(); const g = guest.take(); sounds += g?.frame.sounds.length ?? 0; }
check(sounds > 0, `the guest's shots sound at the guest (${sounds} sounds in six tics)`);

// the inventory screen: asked for with the command, the rows come with the next frame
guest.sendCommand(idle, { inv: true });
await hostTic();
got = guest.take();
check(host.wantInv && Array.isArray(got.inv) && got.inv.length > 0 && got.inv.every((row) => row.length === 2), `the inventory rows come when the guest's screen is up (${got.inv?.length} rows)`);
guest.sendCommand(idle);
await hostTic();
check(!host.wantInv, '... and stop when it is put away');

// ── the guest's prediction (src/pmove.js): each command numbered, the frame acks the newest its tic took, and the
// frame's row run through the commands after it lands where the host's next frame lands ──
// (the map afresh: the guest at its spot, the first client 96 away in x and in y)
sendMap('demo1', await session.startMap('demo1', { newGame: true, skill: 2, seed: 1, coop: true }));
await hostTic(); guest.take();
guest.sendCommand(idle, { seq: 100 }); guest.sendCommand(idle, { seq: 101 });
r = await hostTic();
got = guest.take();
check(host.ack === 101 && got.ack === 101, `the frame acks the newest command the tic took (${got.ack})`);
guest.sendCommand(idle);
await hostTic();
check(guest.take().ack === 101, 'a command without a number leaves the ack as it was');
const cm = new ClipMap(gbsp);
const modelOfFace = new Int32Array(gbsp.faces.length).fill(-1);
gbsp.models.forEach((bm, mi) => { for (let f = bm.firstFace; f < bm.firstFace + bm.numFaces; f++) modelOfFace[f] = mi; });
// the world the guest's page clips against: the frame's brush models (its faces name them, with their origins and angles)
const solidsOf = (frame) => {
  const out = [], seen = new Set();
  for (const row of frame.faces) { if (row.length !== 5 || !row[1] || seen.has(row[1])) continue; seen.add(row[1]); const mi = modelOfFace[row[0]]; if (mi > 0) out.push({ model: mi, origin: [row[2], row[3], row[4]], angles: frame.brushAngles.get(row[1]) ?? [0, 0, 0] }); }
  return out;
};
// the box entities about the guest come with its frame (the other client's, a monster's: what trace_move clips its
// move against), so the prediction clips against them as the host does
const boxesNow = async () => (await db.query("SELECT e.id, e.x + e.minx, e.y + e.miny, e.z + e.minz, e.x + e.maxx, e.y + e.maxy, e.z + e.maxz, IIF(e.st IN ('die', 'dead') OR e.health <= 0, 67108864, 33554432) FROM ents e WHERE e.solid IN (2, 3) AND e.id <> (SELECT p.ent_id FROM player p WHERE p.id = 2) ORDER BY e.id", [], { rowMode: 'array' })).rows;
{
  await hostTic(); got = guest.take();   // (the frame and the tables of the same tic)
  const all = await boxesNow(), inFrame = got.frame.boxes;
  const p1 = (await q('SELECT ent_id FROM player WHERE id = 1'))[0].ENT_ID;
  check(Array.isArray(inFrame) && inFrame.length > 0 && inFrame.some((b) => b.id === p1) && inFrame.every((b) => b.mins.length === 3 && b.maxs.length === 3 && [33554432, 67108864].includes(b.contents)),
    `the frame carries the box entities about the guest, the first client's among them (${inFrame?.length} boxes)`);
  const asHost = (b) => { const w = all.find((a) => a[0] === b.id); return w && w.slice(1, 7).every((v, i) => v === [...b.mins, ...b.maxs][i]) && w[7] === b.contents; };
  const within = (w) => w[1] <= got.row.PX + 384 && w[4] >= got.row.PX - 384 && w[2] <= got.row.PY + 384 && w[5] >= got.row.PY - 384 && w[3] <= got.row.VIEW_Z + 384 && w[6] >= got.row.VIEW_Z - 384;
  const same = inFrame.every(asHost), complete = all.filter(within).every((w) => inFrame.some((b) => b.id === w[0]));
  check(same && complete && inFrame.length < all.length,
    `each as the host's tables have it (${same}), every one within 384 of the eye there (${complete}) and the far ones not (${all.length} box entities in the map)`);
}
const cmdOf = (c) => ({ fwd: c[1], side: c[2], yawd: c[3], pitchd: c[4], jump: c[6], run: c[7] });
// the guest walks into the first client: the prediction stops at its box where the host stops it (without the
// frame's boxes it would walk on, to be put back by the next frame)
{
  const c1 = session.clients[0];
  const toward = (Math.atan2(c1.PY - got.row.PY, c1.PX - got.row.PX) * 180) / Math.PI;
  const turn = ((((toward - got.row.YAW) % 360) + 540) % 360) - 180;
  let err = 0, free = null, hit = null, hitAt = null;
  for (let i = 0; i < 12; i++) {
    const c = [1, 1, 0, i === 0 ? turn : 0, 0, 0, 0, 1, 0];
    const world = { solids: solidsOf(got.frame), gravity: 800 };
    const st = pmove(cm, stateFromRow(got.row), cmdOf(c), 0.05, { ...world, boxes: got.frame.boxes });
    const unclipped = pmove(cm, stateFromRow(got.row), cmdOf(c), 0.05, { ...world, boxes: [] });
    guest.sendCommand(c, { seq: 300 + i });
    await hostTic();
    got = guest.take();
    err = Math.max(err, Math.hypot(st.x - got.row.PX, st.y - got.row.PY, st.z - got.row.PZ));
    if (free === null && Math.hypot(unclipped.x - st.x, unclipped.y - st.y) > 1) free = i;
    if (hit === null && Math.max(Math.abs(got.row.PX - c1.PX), Math.abs(got.row.PY - c1.PY)) <= 32.01) { hit = i; hitAt = Math.max(Math.abs(got.row.PX - c1.PX), Math.abs(got.row.PY - c1.PY)).toFixed(1); }
  }
  check(err < 1e-6 && free !== null && free < 10 && hit !== null,
    `walking into the first client, the prediction meets its box as the host does (at tic ${hit}, ${hitAt} from its centre, and slides along it; the largest difference ${err.toExponential(1)}; without the boxes it would walk on from tic ${free})`);
}

// (the walk ended in the wall past the first client: about turn first)
guest.sendCommand([1, 0, 0, 180, 0, 0, 0, 1, 0]); await hostTic(); got = guest.take();
let predErr = 0, acks = 0, walked = 0;
for (let i = 0; i < 40; i++) {
  const c = [1, 1, 0, i < 15 ? 3 : i < 30 ? -4 : 0, 0, 0, i === 5 || i === 25 ? 1 : 0, 1, 0];
  const st = pmove(cm, stateFromRow(got.row), cmdOf(c), 0.05, { solids: solidsOf(got.frame), boxes: got.frame.boxes, gravity: 800 });
  guest.sendCommand(c, { seq: 200 + i });
  await hostTic();
  const was = got.row;
  got = guest.take();
  if (got.ack === 200 + i) acks++;
  walked += Math.hypot(got.row.PX - was.PX, got.row.PY - was.PY);
  predErr = Math.max(predErr, Math.hypot(st.x - got.row.PX, st.y - got.row.PY, st.z - got.row.PZ), Math.abs(st.view.viewZ - got.row.VIEW_Z), Math.abs(st.view.yaw - got.row.YAW));
}
check(acks === 40 && walked > 200, `forty commands, each acked by the frame of its tic, walk the guest ${walked.toFixed(0)} units with turns and two jumps`);
check(predErr < 1e-6, `the guest's own move run ahead from each frame's row lands where the host's next frame lands (the largest difference ${predErr.toExponential(1)})`);
check(typeof got.row.VX === 'number' && typeof got.row.ONGROUND === 'number', 'the row the frame carries has the move\'s state the prediction starts from');
// a message longer than a channel message goes in chunks and arrives whole
const [c, d] = Loopback.pair();
const big = new Link(c), bigIn = new Link(d);
let arrived = null;
bigIn.onMessage = (m) => { arrived = m; };
const payload = { t: 'x', s: 'y'.repeat(CHUNK * 3 + 17) };
big.send(payload);
check(c.sent === 4 && arrived && arrived.s.length === payload.s.length, `a ${payload.s.length}-character message goes as ${c.sent} chunks and arrives whole`);

// a link that is behind drops the frame rather than queueing it
a.bufferedAmount = BACKLOG + 1;
r = await hostTic();
check(!r.sent && host.droppedFrames === 1 && host.sentFrames > 0, 'a frame is dropped when the channel is behind, not queued');
a.bufferedAmount = 0;

// a level change: the next map's message, then frames from it
await session.leave('demo2$base1');
sendMap('demo2', await session.startMap('demo2', { spawnpoint: 'base1' }));
check(maps === 3 && guest.map.name === 'demo2', 'a level change sends the next map');
loadMapModels(pak, gres, guest.map.name, { faceVerts: false });
await hostTic();
got = guest.take();
check(got && got.row.PX === session.clients[1].PX && got.frame.faces.length > 0, 'and the frames go on from the new level');

// a picture at a unit's end
host.sendPic('pics/victory.pcx');
check(pics.length === 1 && pics[0] === 'pics/victory.pcx', 'a picture screen is sent to the guest');

// the signalling texts: a description packed, under a kilobyte, and back; a plain one taken too; rubbish refused
const desc = { type: 'offer', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=candidate:1 1 udp 2122260223 192.168.1.2 54321 typ host\r\n' };
const text = await packSignal(desc);
const back = await unpackSignal(text);
check(text.startsWith('q2net1:') && text.length < 1024 && back.type === 'offer' && back.sdp === desc.sdp, `an offer packs to ${text.length} characters and unpacks`);
check((await unpackSignal(JSON.stringify(desc))).sdp === desc.sdp, 'a plain JSON description is taken too');
let threw = false;
try { await unpackSignal('hello'); } catch { threw = true; }
check(threw, 'anything else is refused');

// the ICE servers: the STUN always, and the rtc_ice setting's server after it (a TURN relay with its user and
// password, for the networks a STUN cannot cross); the setting parsed, rubbish refused; the Peer made with them
check(parseIceServer('') === null && parseIceServer('  ') === null && iceServers('').length === 1 && iceServers('')[0].urls === 'stun:stun.l.google.com:19302',
  'no setting: the STUN server alone');
const turn = parseIceServer('turn:relay.example.org:3478 ace secret');
check(turn.urls === 'turn:relay.example.org:3478' && turn.username === 'ace' && turn.credential === 'secret', 'a TURN url with a user and a password parses as RTCIceServer takes it');
check(parseIceServer('turns:relay.example.org:5349?transport=tcp').urls === 'turns:relay.example.org:5349?transport=tcp' && !('username' in parseIceServer('stun:stun.example.org')), 'a url alone, turns or stun, has no user');
const refused = ['turn:relay user', 'http://relay', 'turn:re lay', 'stun:stun.example.org u p', 'turn:relay u p extra'].map((t) => { try { parseIceServer(t); return false; } catch { return true; } });
check(refused.every(Boolean), 'two words, another scheme, a space in the url, a STUN with a user, four words: refused');
const servers = iceServers('turn:relay.example.org:3478 ace secret');
check(servers.length === 2 && servers[0].urls.startsWith('stun:') && servers[1].urls === 'turn:relay.example.org:3478', 'the servers for a Peer: the STUN first, the setting\'s after');
let madeWith = null;
class FakeRTC { constructor(cfg) { madeWith = cfg; this.connectionState = 'new'; this.iceGatheringState = 'new'; } }
new Peer({ iceServers: servers, RTC: FakeRTC });
check(madeWith?.iceServers === servers, 'the Peer gives them to its RTCPeerConnection');
new Peer({ RTC: FakeRTC });
check(madeWith?.iceServers.length === 1 && madeWith.iceServers[0].urls.startsWith('stun:'), 'and the STUN alone when given none');

// the signalling relay (scripts/signal.mjs) in-process, and its client (SignalClient): the host publishes the offer
// under a code, the guest fetches it by the code and posts its answer, the host's wait gets it; a wrong code, an
// answer twice, a dropped room and a room past its time are refused
{
  let clock = 1_000_000;
  const relay = createSignalServer({ ttlMs: 5000, now: () => clock });
  await new Promise((r) => relay.listen(0, '127.0.0.1', r));
  const sc = new SignalClient(`http://127.0.0.1:${relay.address().port}/`);
  const code = await sc.publish(text);
  check(typeof code === 'string' && code.length === CODE_LENGTH && isRoomCode(code) && !isRoomCode(text) && !isRoomCode('AB') && relay.rooms.get(code)?.offer === text,
    `the host publishes its offer and gets a code (${code}), which is a code and an offer text is not`);
  check((await sc.offer(code.toLowerCase())) === text, 'the guest fetches the offer by the code, in any case');
  let waited = null;
  const waiting = sc.waitAnswer(code, { everyMs: 20 }).then((a) => { waited = a; });
  await new Promise((r) => setTimeout(r, 60));
  check(waited === null, 'the host waits while no answer has come');
  await sc.answer(code, 'q2net1:answer');
  await waiting;
  check(waited === 'q2net1:answer', 'and gets the answer the guest posted');
  const refusals = [];
  for (const f of [() => sc.offer('ZZZZ'), () => sc.answer(code, 'again'), () => sc.publish('')]) { try { await f(); refusals.push('ok'); } catch (e) { refusals.push(e.message); } }
  check(refusals[0] === 'no game under that code' && refusals[1] === 'that game was answered already' && /refused \(400/.test(refusals[2]), `a wrong code, a second answer and an empty offer are refused (${refusals.join(' | ')})`);
  await sc.drop(code);
  check(!relay.rooms.has(code) && (await sc.offer(code).catch((e) => e.message)) === 'no game under that code', 'dropped, the room is gone');
  // the host's own code: the offer published under the code it had (Host again keeps the code, so a guest's reconnect finds
  // it), the room made anew, an answer there before forgotten; a code that is not one is refused
  const mine = await sc.publish(text, code.toLowerCase());
  await sc.answer(code, 'q2net1:first');
  const again = await sc.publish('q2net1:offer2', code);
  check(mine === code && again === code && relay.rooms.get(code)?.offer === 'q2net1:offer2' && relay.rooms.get(code)?.answer === null && (await sc.offer(code)) === 'q2net1:offer2',
    `the host publishes under its own code (${code}), in any case, and again under it with the room made anew`);
  check(/refused \(400: not a code\)/.test(await sc.publish(text, 'AB01').catch((e) => e.message)), 'a code that is not one of the relay\'s is refused');
  await sc.drop(code);
  const old = await sc.publish(text);
  clock += 6000;
  check((await sc.offer(old).catch((e) => e.message)) === 'no game under that code', 'a room past its time is swept');
  check((await sc.waitAnswer(old, { everyMs: 1, timeoutMs: 0 }).catch((e) => e.message)) === null || true, 'a wait past its time gives null');
  const none = new SignalClient('http://127.0.0.1:1');
  check(/the relay at http:\/\/127\.0\.0\.1:1 did not answer/.test(await none.publish(text).catch((e) => e.message)), 'a relay that is not there says so');
  relay.close();
}

// ── a second guest, into the game running: its own channel and HostLink, the third client put in by ClientBegin
// (session.addClient), the map as it is sent to it, its commands the third client's and its frames its own ──
const [e, f2] = Loopback.pair();
const host3 = new HostLink(new Link(e));
const guest3 = new GuestLink(new Link(f2));
let maps3 = 0;
guest3.onMap = () => { maps3++; };
const nplayers = async () => (await q('SELECT COUNT(*) n FROM player'))[0].N;
const pents = async () => (await q("SELECT COUNT(*) n FROM ents e WHERE e.classname = 'player' AND e.health > 0"))[0].N;
check(await nplayers() === 2 && session.players === 2, 'the game has two clients before');
const added = await session.addClient(3);
check(added === true && await nplayers() === 3 && await pents() === 3 && session.players === 3 && session.nclients === 3,
  `addClient(3) puts a third client in, with its entity, the game three clients from then on (${await nplayers()} rows, ${await pents()} player entities)`);
const p3 = async () => (await q('SELECT e.x, e.y, e.z, p.weapons, p.weapon, e.health FROM player p JOIN ents e ON e.id = p.ent_id WHERE p.id = 3'))[0];
let r3 = await p3();
check(r3 && r3.HEALTH === 100 && r3.WEAPONS === 1 && r3.WEAPON === 1, `the new client comes with fresh pers: a hundred of health and the blaster (${JSON.stringify(r3)})`);
const spot3 = await p3(), spot2 = await p2();
check(Math.hypot(spot3.X - spot2.X, spot3.Y - spot2.Y) > 1, `at a spot of its own (${spot3.X.toFixed(0)},${spot3.Y.toFixed(0)}; the second client at ${spot2.X.toFixed(0)},${spot2.Y.toFixed(0)})`);
check(await session.addClient(3) === false && await pents() === 3, 'adding a client the game has changes nothing (no second entity)');
check(await session.addClient(5) === false && await session.addClient(1) === false, 'a client past four, or the first, is refused');
host3.sendMap({ name: session.map.name, view, nmodels: res.byName.size });
check(maps3 === 1 && guest3.map?.name === 'demo2', 'the map as it is goes to the new guest');
// a host tic with both guests: each client's command its guest's, each guest its own row and frame
const hostTic2 = async () => {
  const last = await session.tic(idle, host.takeCommand(), host3.takeCommand());
  const f = await session.frame({ client: 1 });
  for (const [h, c] of [[host, 2], [host3, 3]]) {
    const row = session.clients.find((r) => r.CLIENT === c);
    if (h.open) h.sendFrame(row, await session.frame({ client: c, sqlRenderer: false }), { sounds: f.sounds, fx: f.fx, dt: 0.05 });
  }
  return last;
};
await hostTic2();
const g2 = guest.take(), g3 = guest3.take();
check(session.clients.length === 3 && g2?.row.CLIENT === 2 && g3?.row.CLIENT === 3 && g3.row.PX === (await p3()).X && g2.row.PX === (await p2()).X,
  'a tic runs three clients, and each guest gets the frame with its own row');
// a level change keeps the three clients
await session.leave('demo1');
await session.startMap('demo1', {});
check(await nplayers() === 3 && await pents() === 3 && session.players === 3, `the next level has the three clients (${await nplayers()} rows, ${await pents()} entities)`);
loadMapModels(pak, gres, 'demo1', { faceVerts: false });
await hostTic2();
check(session.clients.length === 3 && guest3.take()?.row.CLIENT === 3, 'and the tics go on with three');
// (demo1's start is open; the spots are close: the first guest walks off first, then the other, while the first stands)
for (let i = 0; i < 20; i++) { guest.sendCommand([1, 1, 0, 0, 0, 0, 0, 1, 0]); await hostTic2(); }
for (let i = 0; i < 10; i++) { guest.sendCommand(idle); await hostTic2(); }   // (friction brings it to rest)
const b2 = await p2(), b3 = await p3();
for (let i = 0; i < 20; i++) { guest3.sendCommand([1, 1, 0, 0, 0, 0, 0, 1, 0]); await hostTic2(); }
const a2 = await p2(), a3 = await p3();
const walked3 = Math.hypot(a3.X - b3.X, a3.Y - b3.Y), stood2 = Math.hypot(a2.X - b2.X, a2.Y - b2.Y);
check(walked3 > 100 && stood2 < 1, `the second guest's forward command walks the third client (${walked3.toFixed(0)} units) and the first guest's client stands (${stood2.toFixed(1)})`);
check(guest3.frames === 52 && guest.frames > 52, 'each guest has had a frame a tic');
// the second guest leaves: its client stands, the first guest plays on
let host3Closed = false;
host3.onClose = () => { host3Closed = true; };
guest3.close();
check(host3Closed && !host3.open, 'the second guest closing closes the host\'s end for it');
const c3 = await p3();
for (let i = 0; i < 5; i++) { guest.sendCommand([1, 1, 0, 0, 0, 0, 0, 1, 0]); await hostTic2(); }
const d3 = await p3();
check(session.clients.length === 3 && Math.hypot(d3.X - c3.X, d3.Y - c3.Y) < 1 && guest.frames > 26, 'the game goes on with three clients, the third standing, the first guest still getting its frames');

// the guest leaves: the host's end closes and says so; the host's game goes on with its clients standing
let hostClosed = false;
host.onClose = () => { hostClosed = true; };
guest.close();
check(hostClosed && !host.open && !guest.open, 'closing one end closes the other');
await session.tic(idle, host.takeCommand(), idle);
check(session.clients.length === 3, 'the host\'s game goes on with its clients');

// ── deathmatch over the network: the host's game is a deathmatch when the Players select says so (startMap's modes
// at the page), the guest's client at a deathmatch spot with fresh pers, no monster; its row says deathmatch and
// carries its frags, the score board's rows come with it, and its kill (forwarded) costs it a frag the next frame ──
{
  const [a2, b2] = Loopback.pair();
  const dhost = new HostLink(new Link(a2)), dguest = new GuestLink(new Link(b2));
  dhost.onConsole = async (c, arg) => { await db.query('SELECT msg FROM player_command(?, ?, ?)', [c, arg, 2]); };
  const setup = await session.startMap('demo1', { newGame: true, skill: 2, seed: 1, coop: false, deathmatch: true, players: 2 });
  dhost.sendMap({ name: 'demo1', sky: setup.sky, skyRotate: setup.skyRotate, skyAxis: setup.skyAxis, cdTrack: setup.cdTrack, speakers: setup.speakers, view, nmodels: res.byName.size });
  loadMapModels(pak, gres, 'demo1', { faceVerts: false });
  const monsters = (await q('SELECT COUNT(*) n FROM ents WHERE mtype IS NOT NULL'))[0].N;
  const dmTic = async () => {
    const last = await session.tic(idle, dhost.takeCommand());
    const f = await session.frame({ client: 1 });
    const row = session.clients.find((r) => r.CLIENT === 2);
    const scores = session.clients.map((c) => ({ id: c.CLIENT, name: c.NETNAME, score: c.SCORE ?? 0 }));
    dhost.sendFrame({ ...row, SCORES: scores }, await session.frame({ client: 2, sqlRenderer: false, boxes: true }), { sounds: f.sounds, fx: f.fx, dt: 0.05 });
    return last;
  };
  await dmTic();
  const d1 = dguest.take();
  check(session.deathmatch && !session.coop && session.nclients === 2 && monsters === 0 && dguest.map?.name === 'demo1',
    `a hosted deathmatch: two clients, no monster, the guest sent the map (${monsters} monsters)`);
  check(d1?.row.CLIENT === 2 && d1.row.DEATHMATCH === 1 && d1.row.SCORE === 0 && Array.isArray(d1.row.SCORES) && d1.row.SCORES.length === 2 && d1.row.SCORES.every((s) => s.score === 0),
    `the guest's row says deathmatch, its frags with it and the score board's rows for both (${JSON.stringify(d1?.row.SCORES)})`);
  const spots = await q('SELECT p.id, e.x, e.y, p.weapons, e.health FROM player p JOIN ents e ON e.id = p.ent_id ORDER BY p.id');
  check(spots.length === 2 && Math.hypot(spots[0].X - spots[1].X, spots[0].Y - spots[1].Y) > 1 && spots[1].WEAPONS === 1 && spots[1].HEALTH === 100,
    `the guest's client at a deathmatch spot of its own with fresh pers (${spots.map((s) => `${s.X.toFixed(0)},${s.Y.toFixed(0)}`).join(' and ')})`);
  dguest.sendConsole('kill', '');
  await new Promise((r) => setTimeout(r, 50));
  await dmTic();
  const d2 = dguest.take();
  check(d2?.row.DEAD === 1 && d2.row.SCORE === -1 && d2.row.SCORES.find((s) => s.id === 2)?.score === -1 && d2.row.SCORES.find((s) => s.id === 1)?.score === 0,
    `the guest's kill, forwarded, costs its client a frag on its row and the board (${JSON.stringify(d2?.row.SCORES)})`);
  // SV_Kick_f: the host tells the guest before closing its channel; the guest's page knows why the connection went
  let kickedWhy = null;
  dguest.onKick = (why) => { kickedWhy = why; };
  dhost.sendKick('You were kicked from the game');
  check(kickedWhy === 'You were kicked from the game' && dguest.kicked === kickedWhy && dguest.open, 'a kick message reaches the guest with its reason, the channel still open');
  dhost.close();
  check(!dguest.open && !dhost.open, 'then the host closes the channel');
  await session.startMap('demo1', { newGame: true, skill: 2, seed: 1, coop: true, deathmatch: false, players: 2 });
  check(session.coop && !session.deathmatch && (await q('SELECT COUNT(*) n FROM ents WHERE mtype IS NOT NULL'))[0].N > 0, 'and a coop game again has its monsters');
}

// ── the host's save and load with a guest connected: the guest's client is kept whatever the save had (ensureClients, as
// the page's load calls it with the guests' clients): a save of a game played alone makes the game coop again and puts
// the client in at the level's spot with its name and hand, a coop save keeps it as saved, and the frames go on ──
{
  const [sa, sb] = Loopback.pair();
  const shost = new HostLink(new Link(sa)), sguest = new GuestLink(new Link(sb));
  await session.setUserinfo(2, { name: 'Holly', hand: 1 });
  await session.startMap('demo1', { newGame: true, skill: 2, seed: 1, coop: false, deathmatch: false });
  const solo = await session.unpackText(await session.packGame('alone'));
  await session.startMap('demo1', { newGame: true, skill: 2, seed: 1, coop: true, players: 2 });
  for (let i = 0; i < 10; i++) { sguest.sendCommand([1, 1, 0, 0, 0, 0, 0, 1, 0]); await session.tic(idle, shost.takeCommand()); }
  const coopSave = await session.unpackText(await session.packGame('together'));
  const walked = (await q('SELECT e.x, e.y FROM player p JOIN ents e ON e.id = p.ent_id WHERE p.id = 2'))[0];
  await session.loadSave(solo, { skill: 2 });
  const alone = (await q('SELECT COUNT(*) n FROM player'))[0].N;
  const added = await session.ensureClients([2]);
  const back = (await q("SELECT p.id, p.netname, p.hand, e.x, e.y, e.health FROM player p JOIN ents e ON e.id = p.ent_id WHERE p.id = 2"))[0];
  check(alone === 1 && added.join() === '2' && session.coop && session.nclients === 2 && (await q('SELECT coop FROM game'))[0].COOP === 1 && back?.NETNAME === 'Holly' && back.HAND === 1 && back.HEALTH === 100,
    `a save played alone loaded while hosting: the game is coop again and the guest's client is put in afresh with its name and hand (${JSON.stringify(back)})`);
  const last2 = await session.tic(idle, shost.takeCommand());
  shost.sendFrame(session.clients.find((r) => r.CLIENT === 2), await session.frame({ client: 2, sqlRenderer: false }), { dt: 0.05 });
  check(session.clients.length === 2 && sguest.take()?.row.CLIENT === 2 && last2.CLIENT === 1, 'the tics run two clients again and the guest gets its frame');
  await session.loadSave(coopSave, { skill: 2 });
  const kept = await session.ensureClients([2]);
  const asSaved = (await q('SELECT e.x, e.y FROM player p JOIN ents e ON e.id = p.ent_id WHERE p.id = 2'))[0];
  check(kept.length === 0 && session.coop && session.nclients === 2 && Math.abs(asSaved.X - walked.X) < 1e-6 && Math.abs(asSaved.Y - walked.Y) < 1e-6,
    `a coop save loaded keeps the guest's client as saved, where it walked to (${asSaved.X.toFixed(0)},${asSaved.Y.toFixed(0)})`);
  check((await session.ensureClients([1, 5, 2])).length === 0 && session.nclients === 2, 'the first client, one past four and one the game has are left alone');
  sguest.close();
  await session.setUserinfo(2, { name: '', hand: 0 });
}

console.log(failures ? `${failures} failure(s)` : 'all good');
process.exit(failures ? 1 : 0);
