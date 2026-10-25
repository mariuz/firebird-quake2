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

// the guest leaves: the host's end closes and says so; the host's game goes on with its second client standing
let hostClosed = false;
host.onClose = () => { hostClosed = true; };
guest.close();
check(hostClosed && !host.open && !guest.open, 'closing one end closes the other');
await session.tic(idle, host.takeCommand());
check(session.clients.length === 2, 'the host\'s game goes on with two clients');

console.log(failures ? `${failures} failure(s)` : 'all good');
process.exit(failures ? 1 : 0);
