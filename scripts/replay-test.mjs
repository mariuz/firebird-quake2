// replay-test.mjs – the same seed and the same inputs give the same game, twice; another seed does not.
//
// The game's chances all come from rnd() in game.sql, a seeded generator whose state lives in the
// session context: a map loaded with a seed and played with a given run of inputs is a function of
// the two. This test plays a fixed run on demo1 twice from one seed and compares everything that
// moves (every entity's place, health, frame and state, the game row, the sounds played), then once
// more from another seed and expects a difference. A save carries the state, so a game loaded from
// one goes on with the chances it would have had: that is checked too.
//
//   node scripts/replay-test.mjs [map]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak } from '../src/pak.js';
import { createSchema, loadResources, loadMap, SQL_FILES } from '../src/loader.js';
import { exportSave, importSave } from '../src/savegame.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mapName = process.argv[2] ?? 'demo1';
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));
const db = new FirebirdBrowser('memory://quake2', { transport: new DirectTransport() });
await createSchema(db, sql);
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
const res = await loadResources(db, pak);

let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
/** The first rows two states disagree on, for a failure to be read. */
function firstDiff(x, y) {
  const sections = ['ents', 'game', 'player', 'sounds'];
  const xs = x.split('\n'), ys = y.split('\n');
  let shown = 0;
  for (let i = 0; i < sections.length && shown < 4; i++) {
    const a = (xs[i] ?? '').split('|'), b = (ys[i] ?? '').split('|');
    for (let k = 0; k < Math.max(a.length, b.length) && shown < 4; k++) if (a[k] !== b[k]) { console.log(`       ${sections[i]} row ${k}:\n         ${a[k]}\n         ${b[k]}`); shown++; }
  }
}

// a run of inputs: forward, a turn, a jump, bursts of fire, a stop, more forward
const RUN = [];
for (let i = 0; i < 120; i++) RUN.push([i < 90 || i > 105 ? 1 : 0, i >= 20 && i < 60 ? 2 : 0, i % 4 === 0 && i > 30 ? 1 : 0, i === 10 ? 1 : 0]);
// q2_tic(tics, fwd, side, yaw_d, pitch_d, fire, jump, run, imp)
const tic = ([fwd, turn, fire, jump]) => db.query('SELECT * FROM q2_tic(1, ?, 0, ?, 0, ?, ?, 1, 0)', [fwd, turn, fire, jump]);

/** Everything that moves, as one string: rows in id order, without the ids, which the sequences hand out differently
 * across loads (they run on, and a load restarts them above the saved maximum). */
async function world(sinceTic = 0) {
  const rows = async (q) => (await db.query(q, [], { rowMode: 'array' })).rows.map((r) => r.map((v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)).join(':')).join('|');
  return [
    await rows('SELECT classname, CAST(x * 1000 AS BIGINT), CAST(y * 1000 AS BIGINT), CAST(z * 1000 AS BIGINT), CAST(yaw * 100 AS BIGINT), health, frame, anim_frame, st, think, CAST(COALESCE(nextthink, -1) * 1000 AS BIGINT) FROM ents ORDER BY id'),
    await rows('SELECT tic, CAST(time_ * 1000 AS BIGINT), killed, found_secrets, rng_seed FROM game WHERE id = 1'),
    await rows('SELECT bullets, shells, weapon, CAST(pitch * 100 AS BIGINT) FROM player WHERE id = 1'),
    await rows(`SELECT tic, chan, snd FROM sound_events WHERE tic >= ${sinceTic} ORDER BY id`),
  ].join('\n');
}

async function play(seed, { saveAt = -1 } = {}) {
  await loadMap(db, pak, res, mapName, { skill: 2, seed });
  const recorded = (await db.query('SELECT rng_seed s FROM game WHERE id = 1')).rows[0].S;
  let save = null;
  for (let i = 0; i < RUN.length; i++) {
    if (i === saveAt) save = await exportSave(db, mapName);
    await tic(RUN[i]);
  }
  // the sounds from the save on, for a run resumed from it (a save carries no sounds)
  return { state: await world(), fromSave: saveAt >= 0 ? await world(saveAt) : null, recorded: Number(recorded), save };
}

const a = await play(12345, { saveAt: 60 });
check(a.recorded === 12345, `a new game records its seed (${a.recorded})`);
const b = await play(12345);
check(a.state === b.state, `the same seed and inputs give the same game, twice (${a.state.length} characters of state compared)`);
if (a.state !== b.state) firstDiff(a.state, b.state);
const c = await play(54321);
check(c.recorded === 54321 && c.state !== b.state, 'another seed gives another game');

// the chances the game would have had go on from a save: the saved run's second half replayed from the save
await loadMap(db, pak, res, mapName, { skill: 2, seed: 999 });
await importSave(db, a.save);
for (let i = 60; i < RUN.length; i++) await tic(RUN[i]);
const resumed = await world(60);
check(resumed === a.fromSave, 'a game loaded from a save goes on exactly as the saved game did');
if (resumed !== a.fromSave) firstDiff(a.fromSave, resumed);

// unseeded, the generator starts anywhere, and the seed is still recorded
const u1 = await play(null);
const u2 = await play(null);
check(u1.recorded !== u2.recorded && u1.recorded > 0 && u1.state !== u2.state, `without a seed two games differ (seeds ${u1.recorded}, ${u2.recorded})`);

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('all good');
