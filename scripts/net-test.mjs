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
import { Link, Loopback, HostLink, GuestLink, packSignal, unpackSignal, CHUNK, BACKLOG } from '../src/net.js';
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
  const gf = await session.frame({ client: 2, sqlRenderer: false });
  const sent = host.sendFrame(session.clients[1], gf, { sounds: f.sounds, fx: f.fx, dt: 0.05, inv: host.wantInv ? await session.inventory(2) : null });
  return { last, f, gf, cmd2, sent };
};
const p2 = async () => (await q('SELECT e.x, e.y, e.z, e.yaw, e.health FROM player p JOIN ents e ON e.id = p.ent_id WHERE p.id = 2'))[0];

// the guest's userinfo (its player setup's name and hand) reaches the host, which gives it to the second client
let infoSeen = null;
host.onInfo = (i) => { infoSeen = i; };
guest.sendInfo({ name: 'Rimmer, Arnold J.', hand: 1 });
check(infoSeen && infoSeen.name === 'Rimmer, Arnold ' && infoSeen.hand === 1 && host.info === infoSeen, `the host gets the guest's name (cut at fifteen) and hand (${JSON.stringify(infoSeen)})`);
await session.setUserinfo(2, host.info);
check((await q('SELECT netname, hand FROM player WHERE id = 2'))[0].NETNAME === 'Rimmer, Arnold ' && (await q('SELECT hand FROM player WHERE id = 2'))[0].HAND === 1, 'and the second client carries them');
guest.sendInfo({ name: 'x', hand: 7 });
check(host.info.hand === 0, 'a hand that is not 0, 1 or 2 is right-handed');
await session.setUserinfo(2, { name: '', hand: 0 });

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
// (the other player's box, which the page does not know: here from the host's tables, so the match can be exact)
const boxes = async () => (await db.query("SELECT e.x + e.minx, e.y + e.miny, e.z + e.minz, e.x + e.maxx, e.y + e.maxy, e.z + e.maxz FROM ents e WHERE e.solid IN (2, 3) AND e.id <> (SELECT p.ent_id FROM player p WHERE p.id = 2)", [], { rowMode: 'array' })).rows
  .map(([x1, y1, z1, x2, y2, z2]) => ({ mins: [x1, y1, z1], maxs: [x2, y2, z2], contents: 33554432 }));
const cmdOf = (c) => ({ fwd: c[1], side: c[2], yawd: c[3], pitchd: c[4], jump: c[6], run: c[7] });
let predErr = 0, acks = 0, walked = 0;
for (let i = 0; i < 40; i++) {
  const c = [1, 1, 0, i < 15 ? 3 : i < 30 ? -4 : 0, 0, 0, i === 5 || i === 25 ? 1 : 0, 1, 0];
  const st = pmove(cm, stateFromRow(got.row), cmdOf(c), 0.05, { solids: solidsOf(got.frame), boxes: await boxes(), gravity: 800 });
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
check(maps === 2 && guest.map.name === 'demo2', 'a level change sends the next map');
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

console.log(failures ? `${failures} failure(s)` : 'all good');
process.exit(failures ? 1 : 0);
