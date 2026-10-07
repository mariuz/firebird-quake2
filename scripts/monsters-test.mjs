// monsters-test.mjs – every monster of the demo, inside Firebird: each is
// spawned in front of the player on an open floor, sees it, closes in or
// shoots, hurts it, and dies to the player's fire (gibbing when overkilled).
//
//   node scripts/monsters-test.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak } from '../src/pak.js';
import { createSchema, loadResources, loadMap, SQL_FILES } from '../src/loader.js';
import { MONSTERS } from '../src/gamedata.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));
let failed = 0;
const assert = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); failed++; } else console.log(`ok   ${msg}`); };

const db = new FirebirdBrowser('memory://quake2', { transport: new DirectTransport() });
await createSchema(db, sql);
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
const res = await loadResources(db, pak);
await loadMap(db, pak, res, 'demo1', { skill: 1 });

const q1 = (s, p = []) => db.query(s, p).then((r) => r.rows[0]);
const qa = (s, p = []) => db.query(s, p).then((r) => r.rows);
// the tic purges sound rows after two seconds, so every sound is noted as it happens
const heard = new Set();
let lastSound = 0;
const tic = async (a = [1, 0, 0, 0, 0, 0, 0, 1, 0]) => {
  const s = await q1('SELECT * FROM q2_tic(?,?,?,?,?,?,?,?,?)', a);
  for (const r of await qa(`SELECT id, snd FROM sound_events WHERE id > ${lastSound} ORDER BY id`)) { heard.add(r.SND); lastSound = r.ID; }
  return s;
};
const run = async (tics, a) => { let s; for (let i = 0; i < tics; i++) s = await tic(a); return s; };
const pe = (await q1('SELECT ent_id e FROM player')).E;
// a quiet, open spot: the yard by the start (no other monsters awake there on medium)
const teleport = async (x, y, z, yaw) => {
  await db.exec(`UPDATE ents SET x = ${x}, y = ${y}, z = ${z}, yaw = ${yaw}, vx = 0, vy = 0, vz = 0 WHERE id = ${pe}`);
  await db.exec(`EXECUTE PROCEDURE link_ent(${pe})`);
};
const sounds = async (name) => (heard.has(name) ? 1 : 0);
// no other monsters: this is about one at a time
await db.exec("DELETE FROM ents WHERE mtype IS NOT NULL");
await db.exec(`UPDATE ents SET flags = BIN_OR(flags, 16) WHERE id = ${pe}`);   // god mode while we watch them attack
await tic([1, 0, 0, 0, 0, 0, 0, 1, 99]);                                       // all weapons
await db.exec('UPDATE player SET armor = 0, armor_type = 0');                  // but no armour: weak shots must register

for (const m of MONSTERS) {
  console.log(`── ${m.name}`);
  await teleport(128, -320, 32, 135);
  await db.exec(`UPDATE ents SET health = 100 WHERE id = ${pe}`);
  heard.clear();
  const spawned = await q1(`SELECT * FROM spawn_monster('${m.name}', 220)`);
  assert(spawned && spawned.ID, `${m.name} spawned`);
  const id = spawned.ID;
  const e0 = await q1(`SELECT model_id, health, st, cluster FROM ents WHERE id = ${id}`);
  assert(e0.MODEL_ID !== null && e0.HEALTH === m.health, `${m.name} has its model and ${m.health} health`);
  // it notices us
  let s, e;
  for (let i = 0; i < 60; i++) {
    s = await tic();
    e = await q1(`SELECT st, enemy_id, anim FROM ents WHERE id = ${id}`);
    if (e.ENEMY_ID === pe) break;
  }
  assert(e.ENEMY_ID === pe, `${m.name} saw the player (state ${e.ST} after sighting)`);
  assert((await sounds(m.sight_snd)) > 0, `${m.name} called out (${m.sight_snd})`);
  // a shot along the line to it: soldiers, infantry and gunners duck a quarter of the time, the rest never
  const dodger = ['soldier_light', 'soldier', 'soldier_ss', 'infantry', 'gunner'].includes(m.name);
  const box0 = await q1(`SELECT minz, maxz FROM ents WHERE id = ${id}`);
  let ducked = null;
  for (let i = 0; i < (dodger ? 60 : 40) && !ducked; i++) {
    const p = await q1(`SELECT x, y, z FROM ents WHERE id = ${pe}`);
    const mon = await q1(`SELECT x, y, z, st FROM ents WHERE id = ${id}`);
    const ez = p.Z + 22, mz = mon.Z + (box0.MINZ + box0.MAXZ) / 2;
    const len = Math.hypot(mon.X - p.X, mon.Y - p.Y, mz - ez);
    await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE check_dodge(${pe}, ${p.X}, ${p.Y}, ${ez}, ${(mon.X - p.X) / len}, ${(mon.Y - p.Y) / len}, ${(mz - ez) / len}, 1000); END`);
    const d = await q1(`SELECT st, maxz, aiflags FROM ents WHERE id = ${id}`);
    if (d.ST === 'duck') ducked = d;
  }
  if (dodger) {
    assert(ducked && ducked.MAXZ === box0.MAXZ - 32 && (ducked.AIFLAGS & 4), `${m.name} ducked under a shot (box ${box0.MAXZ} → ${ducked?.MAXZ})`);
    let up;
    for (let i = 0; i < 40; i++) { await tic(); up = await q1(`SELECT st, maxz, aiflags FROM ents WHERE id = ${id}`); if (up.ST !== 'duck') break; }
    assert(up.ST !== 'duck' && up.MAXZ === box0.MAXZ && (up.AIFLAGS & 4) === 0, `${m.name} stood up again (${up.ST})`);
  } else assert(!ducked, `${m.name} has no dodge`);
  // it attacks: with god mode on, damage shows as dmg_take / attack events
  let attacked = 0, dmgSeen = 0;
  await db.exec(`UPDATE ents SET flags = BIN_AND(flags, BIN_NOT(16)) WHERE id = ${pe}`);
  for (let i = 0; i < 200 && !attacked; i++) {
    s = await tic();
    e = await q1(`SELECT st, anim, anim_frame FROM ents WHERE id = ${id}`);
    if (e.ST === 'melee' || e.ST === 'missile') attacked = 1;
    if (s.HEALTH < 100) dmgSeen = 1;
  }
  assert(attacked, `${m.name} attacked (state ${e.ST}, anim ${e.ANIM})`);
  for (let i = 0; i < 80 && !dmgSeen; i++) { s = await tic(); if (s.HEALTH < 100) dmgSeen = 1; }
  assert(dmgSeen, `${m.name} hurt the player (health ${s.HEALTH})`);
  if (m.missile_kind) {
    // (one that closed in for melee instead counts too)
    const atk = (m.attack_snd ? await sounds(m.attack_snd) : 1) || (m.melee_snd ? await sounds(m.melee_snd) : 0);
    assert(atk > 0, `${m.name} fired or struck (${m.attack_snd})`);
  }
  // kill it with the railgun: 150 a shot
  await db.exec(`UPDATE ents SET flags = BIN_OR(flags, 16), health = 100 WHERE id = ${pe}`);
  await tic([1, 0, 0, 0, 0, 0, 0, 1, 10]);
  for (let i = 0; i < 8; i++) await tic();
  let hp = m.health, shots = 0;
  while (hp > 0 && shots < 12) {
    const mon = await q1(`SELECT x, y, z, health FROM ents WHERE id = ${id}`);
    if (!mon) break;
    // face it
    const p = await q1(`SELECT x, y, z FROM ents WHERE id = ${pe}`);
    const yaw = (Math.atan2(mon.Y - p.Y, mon.X - p.X) * 180) / Math.PI;
    const dist = Math.hypot(mon.X - p.X, mon.Y - p.Y);
    const pitch = -(Math.atan2(mon.Z + 8 - (p.Z + 22), dist) * 180) / Math.PI;
    await db.exec(`UPDATE ents SET yaw = ${yaw} WHERE id = ${pe}; UPDATE player SET pitch = ${pitch}, attack_finished = 0`);
    s = await tic([1, 0, 0, 0, 0, 1, 0, 1, 0]);
    shots++;
    for (let i = 0; i < 4; i++) await tic();
    const after = await q1(`SELECT health FROM ents WHERE id = ${id}`);
    hp = after ? after.HEALTH : 0;
  }
  const corpse = await q1(`SELECT st, health, solid, model_id FROM ents WHERE id = ${id}`);
  assert(hp <= 0, `${m.name} died to the railgun in ${shots} shots (${corpse ? corpse.ST : 'gibbed'})`);
  assert((await sounds(m.death_snd)) > 0 || !corpse, `${m.name} died loudly (${m.death_snd}) or was gibbed`);
  const killed = (await q1('SELECT killed k FROM game')).K;
  assert(killed >= 1, `the kill was counted (${killed})`);
  await run(20);
  await db.exec("DELETE FROM ents WHERE mtype IS NOT NULL OR classname IN ('gib', 'debris')");
  await db.exec('UPDATE game SET killed = 0');
}

await db.close();
console.log(failed ? `${failed} FAILED` : 'all good');
process.exit(failed ? 1 : 0);
