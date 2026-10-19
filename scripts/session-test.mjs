// session-test.mjs – the game as the page plays it, without the page (src/session.js): a map started, tics run,
// the frame read and decoded in both renderer modes, a game saved to a slot and loaded from it, levels left and
// come back to, a unit's end, and the death screen's load request.
//   node scripts/session-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak } from '../src/pak.js';
import { createSchema, loadResources, SQL_FILES } from '../src/loader.js';
import { Session, SLOT_KEY, QUICK_KEY, decodeFrame } from '../src/session.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));
const db = new FirebirdBrowser('memory://quake2', { transport: new DirectTransport() });
await createSchema(db, sql);
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
const res = await loadResources(db, pak);

let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

// localStorage's two calls, in memory
const store = new Map();
const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
const session = new Session(db, storage);
session.use(pak, res);
check(session.firstMap() === 'demo1', 'a new game starts on the demo\'s first map');

// the usercmd as Input.read gives it: tics, forward, side, up, ..., fire, ..., impulse
const cmd = ({ fwd = 0, fire = 0, imp = 0 } = {}) => [1, fwd, 0, 2, 0, fire, 0, 1, imp];
const playerPos = async () => (await db.query('SELECT e.x, e.y, e.z, p.bullets, g.tic FROM player p JOIN ents e ON e.id = p.ent_id CROSS JOIN game g WHERE p.id = 1 AND g.id = 1')).rows[0];

// a map
const setup = await session.startMap('demo1', { newGame: true, skill: 2, seed: 1 });
check(session.map?.name === 'demo1' && setup.bsp && typeof setup.sky === 'string' && setup.sky.trim().length > 0,
  `startMap gives the map and its setup (sky ${setup.sky.trim()}, track ${setup.cdTrack}, ${setup.speakers.length} looped speakers)`);
check(session.styleBase.some((v) => v > 0), 'the light styles\' resting values are read');

// tics and frames
const startSound = session.lastSoundId;
let last = await session.tic(cmd({ fwd: 1 }));
check(last && typeof last.PX === 'number' && last.EXIT_KIND === 0, 'a tic returns the Q2_TIC row');
let f = await session.frame();
check(f.faces.length > 100 && f.ents.length > 0, `the frame decodes (${f.faces.length} faces, ${f.ents.length} entities)`);
check(f.styles.length === 64 && f.styles !== session.styleBase, 'the frame\'s styles are a copy of the resting values, animated');
let sounds = 0, speakersSeen = false;
for (let i = 0; i < 30; i++) {
  await session.tic(cmd({ fwd: 1, fire: i % 4 === 0 ? 1 : 0 }));
  f = await session.frame();
  sounds += f.sounds.length;
  if (f.speakers) speakersSeen = true;
  if (f.sounds.length) check(f.sounds.every((s) => s[0] <= session.lastSoundId), 'the sounds read are the newest');
}
check(sounds > 0 && session.lastSoundId > startSound, `firing plays sounds, each once (${sounds}, up to id ${session.lastSoundId})`);
check(speakersSeen, 'every tenth frame asks for the looped speakers');
const again = await session.frame();
check(again.sounds.length === 0, 'a frame with no new tic plays nothing again');

// both renderer modes pick the same world faces (the pixel comparison depends on it); FRAME_FACES' rows are a
// face's vertices, [face, seq, vf, vr, vu, sx, sy, s, t, ent], FRAME_FACES_FAST's a face, [face, ent, ox, oy, oz]
const fast = await session.frame();
const viaSql = await session.frame({ sqlRenderer: true });
check(res.world.faceVertsLoaded, 'the SQL renderer\'s face vertices load the first time it asks');
const facesOf = (faces, entAt, ent) => new Set(faces.filter((x) => (ent === 0 ? x[entAt] === 0 : x[entAt] !== 0)).map((x) => `${x[entAt]}:${x[0]}`));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const worldFast = facesOf(fast.faces, 1, 0), worldSql = facesOf(viaSql.faces, 9, 0);
check(worldFast.size > 20 && sameSet(worldFast, worldSql), `both renderer modes give the same world faces (${worldFast.size})`);
const brushFast = facesOf(fast.faces, 1, 1), brushSql = facesOf(viaSql.faces, 9, 1);
check([...brushFast].every((x) => brushSql.has(x)), `every brush model face the fast mode draws, the SQL mode draws (${brushFast.size} of ${brushSql.size})`);

// decodeFrame alone: a style row, a sound row, a brush model's frame and angles
const base = new Float32Array(64); base[3] = 0.5;
const d = decodeFrame([[3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, null, '3:z,70:a'], [6, 42, 2, 1, 0, 0, 0, 90, 0, 0, 0, 0, 0, 0, null, null]], base);
check(d.styles[3] === (122 - 97) / 12.5 && base[3] === 0.5, 'decodeFrame animates a style without touching the resting values');
check(JSON.stringify(d.brushFrames.get(42)) === '[2,1]' && JSON.stringify(d.brushAngles.get(42)) === '[0,90,0]', 'decodeFrame reads a brush model\'s frame and angles');

// saves: a slot written, its header read for the menus, the game played on, then loaded back
const saved = await playerPos();
const size = await session.writeSave(SLOT_KEY(3), ' 9:05 10/19  Outer Base');
check(size > 0 && store.has(SLOT_KEY(3)), `the game saves to a slot (${(size / 1024).toFixed(0)} KB stored)`);
const slots = session.slots();
check(slots.length === 15 && slots[3].valid && slots[3].name === ' 9:05 10/19  Outer Base' && !slots[4].valid, 'the slots list names the saved one and no other');
for (let i = 0; i < 20; i++) await session.tic(cmd({ fwd: 1, fire: 1 }));
const drifted = await playerPos();
check(drifted.TIC !== saved.TIC, 'the game moved on');
const save = await session.readSave(SLOT_KEY(3));
check(save?.map === 'demo1', 'the slot reads back');
check(await session.readSave(QUICK_KEY) === null, 'an empty slot reads as none');
await session.loadSave(save, { skill: 2 });
const loaded = await playerPos();
check(loaded.TIC === saved.TIC && loaded.X === saved.X && loaded.Y === saved.Y && loaded.BULLETS === saved.BULLETS,
  `loading brings the game back as saved (tic ${loaded.TIC}, at ${loaded.X.toFixed(0)},${loaded.Y.toFixed(0)})`);
check(session.lastFxId === 0 && session.lastSoundId >= 0, 'a load plays nothing that was queued before it');
await session.tic(cmd({ fwd: 1 }));
check((await playerPos()).TIC === saved.TIC + 1, 'and the loaded game runs on');

// levels left and come back to: demo1 marked, left for demo2, then demo2 left back for demo1
const marked = (await db.query('SELECT MIN(id) id FROM ents WHERE mtype IS NOT NULL')).rows[0].ID;
await db.exec(`UPDATE ents SET health = 1234 WHERE id = ${marked}`);
const toDemo2 = await session.leave('demo2');
check(toDemo2.kind === 'map' && toDemo2.map === 'demo2' && session.unitLevels.has('demo1'), 'an ordinary exit keeps the level being left');
await session.startMap('demo2', { skill: 2, spawnpoint: toDemo2.spawn });
check(session.map.name === 'demo2', 'the next level loads');
await session.tic(cmd());
const back = await session.leave('demo1');
await session.startMap('demo1', { skill: 2, spawnpoint: back.spawn });
const health = (await db.query(`SELECT health FROM ents WHERE id = ${marked}`)).rows[0]?.HEALTH;
check(health === 1234, 'a level of the unit comes back as it was left');
check(session.unitLevels.has('demo2'), 'and the one just left is kept in its turn');

// a save carries the unit's other levels
await session.writeSave(SLOT_KEY(5), 'with levels');
session.unitLevels.clear();
await session.loadSave(await session.readSave(SLOT_KEY(5)), { skill: 2 });
check(session.unitLevels.has('demo2'), 'a loaded save brings back the unit\'s other levels');

// a unit's end forgets the unit: its levels and its cross-level flags
await db.exec('UPDATE game SET serverflags = 5 WHERE id = 1');
const end = await session.leave('*demo1');
const flags = (await db.query('SELECT serverflags FROM game WHERE id = 1')).rows[0].SERVERFLAGS;
check(end.unitEnd && session.unitLevels.size === 0 && flags === 0, 'a unit\'s end forgets its levels and its flags');

// a new game forgets the unit too
session.unitLevels.set('demo2', {});
await session.startMap('demo1', { newGame: true, skill: 2 });
check(session.unitLevels.size === 0, 'a new game forgets the unit\'s levels');

// the death screen's fire asks for the load menu once
await db.exec('UPDATE game SET exit_kind = 3 WHERE id = 1');
session.last = { EXIT_KIND: 3 };
check(await session.takeLoadRequest(), 'the load request is taken');
check((await db.query('SELECT exit_kind FROM game WHERE id = 1')).rows[0].EXIT_KIND === 0, 'and cleared, so it is taken once');
session.last = await session.tic(cmd());
check(!(await session.takeLoadRequest()), 'no request, nothing taken');

// no storage, no saves
const bare = new Session(db);
bare.use(pak, res);
bare.map = session.map;
let refused = false;
try { await bare.writeSave(QUICK_KEY, 'x'); } catch { refused = true; }
check(refused && bare.slots().every((s) => !s.valid), 'without storage a save is refused and every slot is empty');

await db.close();
console.log(failures ? `${failures} failure(s)` : 'all good');
process.exit(failures ? 1 : 0);
