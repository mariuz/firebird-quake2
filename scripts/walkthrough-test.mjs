// walkthrough-test.mjs – every trigger a player can walk into, on every demo map: the player is put in
// it, and it must fire (a trigger_once is gone, a trigger_multiple waits), and the doors, plats, trains
// and buttons it targets must start moving. A regression in use_targets, trigger_fire or the touch
// test shows as a trigger that no longer fires or a mover that no longer answers.
//
//   node scripts/walkthrough-test.mjs [map …]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak } from '../src/pak.js';
import { createSchema, loadResources, loadMap, SQL_FILES } from '../src/loader.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));
const maps = process.argv.slice(2).length ? process.argv.slice(2) : ['demo1', 'demo2', 'demo3'];
let failed = 0;
const assert = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); failed++; } else console.log(`ok   ${msg}`); };

const db = new FirebirdBrowser('memory://quake2', { transport: new DirectTransport() });
await createSchema(db, sql);
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
const res = await loadResources(db, pak);
const q1 = (s) => db.query(s).then((r) => r.rows[0]);
const qa = (s) => db.query(s).then((r) => r.rows);
const tic = () => db.query('SELECT * FROM q2_tic(1, 0, 0, 0, 0, 0, 0, 1, 0)');

for (const map of maps) {
  console.log(`── ${map}`);
  await loadMap(db, pak, res, map, { skill: 2, newGame: true });
  const pe = (await q1('SELECT ent_id e FROM player')).E;
  // god, notarget, and no monsters: this is about the triggers
  await db.exec(`UPDATE ents SET flags = BIN_OR(flags, 16 + 64) WHERE id = ${pe}`);
  await db.exec('DELETE FROM ents WHERE mtype IS NOT NULL');
  // the triggers a player can touch now: solid, not shootable, not NOT_PLAYER, with something to do
  const triggers = await qa(`SELECT id, classname, x + (minx + maxx) / 2 cx, y + (miny + maxy) / 2 cy, z + (minz + maxz) / 2 cz, target
    FROM ents WHERE classname IN ('trigger_once', 'trigger_multiple') AND solid = 1 AND max_health = 0 AND BIN_AND(spawnflags, 2) = 0
      AND (target IS NOT NULL OR killtarget IS NOT NULL OR message IS NOT NULL) ORDER BY id`);
  const notFired = [], stillMovers = [];
  let fired = 0, movers = 0;
  for (const tr of triggers) {
    if (!(await q1(`SELECT COUNT(*) n FROM ents WHERE id = ${tr.ID} AND solid = 1`)).N) continue;   // gone or switched off by an earlier one
    // the movers it targets, as they stand
    const before = tr.TARGET ? await qa(`SELECT id, mv_state, mv_done, classname FROM ents
      WHERE targetname = '${tr.TARGET.replace(/'/g, "''")}' AND classname IN ('func_door', 'func_door_rotating', 'func_plat', 'func_train', 'func_button')`) : [];
    await db.exec(`UPDATE ents SET x = ${tr.CX}, y = ${tr.CY}, z = ${tr.CZ}, vx = 0, vy = 0, vz = 0 WHERE id = ${pe}`);
    await db.exec(`EXECUTE PROCEDURE link_ent(${pe})`);
    for (let i = 0; i < 3; i++) await tic();
    const after = await q1(`SELECT COUNT(*) n, MAX(nextthink) nt FROM ents WHERE id = ${tr.ID}`);
    if (after.N === 0 || after.NT != null) fired++; else notFired.push(`${tr.ID} ${tr.CLASSNAME} → ${tr.TARGET ?? '-'}`);
    for (const m of before) {
      const m2 = await q1(`SELECT mv_state, mv_done FROM ents WHERE id = ${m.ID}`);
      // a locked or already-moving mover may not answer; a resting one must start (or toggle) its move
      if (!m2 || m2.MV_DONE != null || m2.MV_STATE !== m.MV_STATE || m.MV_DONE != null) movers++;
      else stillMovers.push(`${m.ID} ${m.CLASSNAME} (by ${tr.ID})`);
    }
    // a level exit or the unit's end is not what this is about: back to the level
    await db.exec('UPDATE game SET exit_kind = 0, next_map = NULL, intermission_time = NULL WHERE id = 1');
    await db.exec(`UPDATE ents SET health = 100, deadflag = 0 WHERE id = ${pe}`);
  }
  assert(triggers.length > 0, `${map} has triggers to walk into (${triggers.length})`);
  assert(notFired.length === 0, `every one fires when the player stands in it (${fired}${notFired.length ? `; not: ${notFired.join(', ')}` : ''})`);
  assert(stillMovers.length === 0, `the doors, plats, trains and buttons they target move (${movers}${stillMovers.length ? `; still: ${stillMovers.join(', ')}` : ''})`);
}

console.log(failed ? `${failed} FAILED` : 'all good');
process.exit(failed ? 1 : 0);
