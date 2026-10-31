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
await loadMap(db, pak, res, 'demo1', { skill: 1, seed: 1 });

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

const only = process.env.MONSTER ? new Set(process.env.MONSTER.split(',')) : null;   // MONSTER=boss2,jorg: these alone
for (const m of MONSTERS) {
  if (only && !only.has(m.name)) continue;
  // the full game's monsters have no model in the demo pak: their logic runs on a model row with the frame table's runs
  const logicOnly = !!m.anims && !pak.has(m.model);
  const harmless = !m.melee_anim && !m.missile_anim;   // the insane marines
  console.log(`── ${m.name}${logicOnly ? ' (no model in this pak: the logic alone)' : ''}`);
  await teleport(128, -320, 32, 135);
  await db.exec(`UPDATE ents SET health = 100 WHERE id = ${pe}`);
  heard.clear();
  // (a swimmer cannot move on land: it is put within its bite's reach)
  const spawned = await q1(`SELECT * FROM spawn_monster('${m.name}', ${m.flags & 2 ? 60 : 220})`);
  assert(spawned && spawned.ID, `${m.name} spawned`);
  const id = spawned.ID;
  const e0 = await q1(`SELECT model_id, health, st, cluster FROM ents WHERE id = ${id}`);
  assert(e0.MODEL_ID !== null && e0.HEALTH === m.health, `${m.name} has its model${logicOnly ? ' row' : ''} and ${m.health} health`);
  if (logicOnly) {
    const runs = await qa(`SELECT anim, first_frame, frame_count FROM anims WHERE model_id = ${e0.MODEL_ID} ORDER BY first_frame`);
    const total = m.anims.reduce((n, [, c]) => n + c, 0);
    assert(runs.length === m.anims.length && runs.every((r, i) => r.ANIM === m.anims[i][0] && r.FRAME_COUNT === m.anims[i][1]) && runs[runs.length - 1].FIRST_FRAME + runs[runs.length - 1].FRAME_COUNT === total,
      `its ${runs.length} frame runs are the table's, ${total} frames end to end`);
    const named = [m.stand_anim, m.walk_anim, m.run_anim, ...m.pain_anims.split(','), ...m.death_anims.split(','), m.melee_anim, m.missile_anim, m.alt_anim].filter(Boolean);
    assert(named.every((a) => m.anims.some(([n]) => n === a)), `every animation it names is in the table (${named.join(', ')})`);
    assert(!res.models.has(e0.MODEL_ID), 'and the painter has no mesh for it: it goes unseen');
  }
  // it notices us
  let s, e;
  for (let i = 0; i < 60; i++) {
    s = await tic();
    e = await q1(`SELECT st, enemy_id, anim FROM ents WHERE id = ${id}`);
    if (e.ENEMY_ID === pe) break;
  }
  assert(e.ENEMY_ID === pe, `${m.name} saw the player (state ${e.ST} after sighting)`);
  assert(!m.sight_snd || (await sounds(m.sight_snd)) > 0, `${m.name} called out (${m.sight_snd ?? 'it has no sight sound: the actor'})`);
  // a shot along the line to it: soldiers, infantry, gunners, the iron maiden and the medic duck a quarter of the time, the rest never
  const dodger = ['soldier_light', 'soldier', 'soldier_ss', 'infantry', 'gunner', 'chick', 'medic'].includes(m.name);
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
    else if (d.ST === 'attack3') await db.exec(`UPDATE ents SET st = 'run' WHERE id = ${id}`);   // crouched fire: tried below
  }
  if (dodger) {
    assert(ducked && ducked.MAXZ === box0.MAXZ - 32 && (ducked.AIFLAGS & 4), `${m.name} ducked under a shot (box ${box0.MAXZ} → ${ducked?.MAXZ})`);
    let up;
    for (let i = 0; i < 40; i++) { await tic(); up = await q1(`SELECT st, maxz, aiflags FROM ents WHERE id = ${id}`); if (up.ST !== 'duck') break; }
    assert(up.ST !== 'duck' && up.MAXZ === box0.MAXZ && (up.AIFLAGS & 4) === 0, `${m.name} stood up again (${up.ST})`);
  }
  if (m.name.startsWith('soldier')) {
    // soldier_dodge on medium: a third of the dodges are soldier_move_attack3, crouched fire
    let a3 = null;
    for (let i = 0; i < 300 && !a3; i++) {
      await db.exec(`UPDATE ents SET st = 'run', aiflags = BIN_AND(aiflags, BIN_NOT(12)), maxz = ${box0.MAXZ} WHERE id = ${id}`);
      await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE monster_dodge(${id}, ${pe}, 0.2); END`);
      const d = await q1(`SELECT st, anim FROM ents WHERE id = ${id}`);
      if (d.ST === 'attack3') a3 = d;
    }
    assert(a3 && a3.ANIM === 'attak3', `${m.name} crouches to fire (${a3?.ANIM})`);
    let low = false, shots = 0, r = null, fx0 = (await q1('SELECT COALESCE(MAX(id), 0) m FROM fx_events')).M;
    for (let i = 0; i < 80; i++) {
      await tic();
      for (const f of await qa(`SELECT id FROM fx_events WHERE id > ${fx0} AND kind = 15 ORDER BY id`)) { shots++; fx0 = f.ID; }
      r = await q1(`SELECT st, maxz, aiflags FROM ents WHERE id = ${id}`);
      if (r.MAXZ === box0.MAXZ - 32) low = true;
      if (r.ST !== 'attack3') break;
    }
    const want = m.name === 'soldier_ss' ? 'a burst of 4 to 11' : 'twice';
    assert(low && (m.name === 'soldier_ss' ? shots >= 4 && shots <= 11 : shots === 2), `... ducked and fired ${want} (${shots})`);
    assert(r.ST !== 'attack3' && r.MAXZ === box0.MAXZ && (r.AIFLAGS & 12) === 0, `... and stood up again (${r.ST})`);
  }
  if (!dodger) assert(!ducked, `${m.name} has no dodge`);
  if (m.name === 'gunner') {
    // gunner_attack's other half: attak1, GunnerGrenade at four of its frames
    const seen = new Set();   // grenades that hit the player go off at once: count every one ever seen
    const grenades = async () => { for (const g of await qa(`SELECT id FROM ents WHERE classname = 'grenade' AND owner_id = ${id}`)) seen.add(g.ID); return seen.size; };
    await db.exec(`DELETE FROM ents WHERE classname = 'grenade'`);
    await db.exec(`UPDATE ents SET st = 'missile', maxz = ${box0.MAXZ}, aiflags = 0 WHERE id = ${id}`);
    await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE set_anim(${id}, 'attak1'); END`);
    let thrown = 0, st = null;
    for (let i = 0; i < 50; i++) { await tic(); thrown = await grenades(); st = (await q1(`SELECT st FROM ents WHERE id = ${id}`)).ST; if (st !== 'missile') break; }
    assert(thrown === 4 && st !== 'missile', `gunner throws four grenades from attak1 (${thrown}) and runs on (${st})`);
    // gunner_duck_down on hard: half the ducks throw one
    await db.exec('UPDATE game SET skill = 2');
    let duckGrenade = 0;
    for (let i = 0; i < 200 && !duckGrenade; i++) {
      seen.clear();
      await db.exec(`DELETE FROM ents WHERE classname = 'grenade'`);
      await db.exec(`UPDATE ents SET st = 'run', aiflags = 0, maxz = ${box0.MAXZ} WHERE id = ${id}`);
      await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE monster_dodge(${id}, ${pe}, 0.2); END`);
      duckGrenade = await grenades();
    }
    await db.exec('UPDATE game SET skill = 1');
    await db.exec(`UPDATE ents SET st = 'run', aiflags = 0, maxz = ${box0.MAXZ} WHERE id = ${id}`);
    assert(duckGrenade === 1, 'on hard a ducking gunner throws a grenade as it goes down');
  }
  // it attacks: god mode off, with health enough that a boss's volley does not kill the player (a dead one neither
  // takes damage nor fires the railgun below), back at the spot the knockbacks so far may have thrown it from
  let attacked = 0, dmgSeen = 0;
  const HP = 100000;
  await teleport(128, -320, 32, 135);
  // (the maximum raised with it: health above the maximum rots a point a second, as the megahealth's did)
  await db.exec(`UPDATE ents SET flags = BIN_AND(flags, BIN_NOT(16)), health = ${HP}, max_health = ${HP} WHERE id = ${pe}`);
  for (let i = 0; i < (harmless ? 100 : 200) && !attacked; i++) {
    s = await tic();
    e = await q1(`SELECT st, anim, anim_frame FROM ents WHERE id = ${id}`);
    if (e.ST === 'melee' || e.ST === 'missile') attacked = 1;
    if (s.HEALTH < HP) dmgSeen = 1;
    if (process.env.MONSTER_DEBUG && i % 20 === 0) {
      const mo = await q1(`SELECT x, y, z, minx, miny, minz, maxx, maxy, maxz, st, anim, enemy_id, goal_id, aiflags, CAST(ideal_yaw AS INTEGER) iy FROM ents WHERE id = ${id}`);
      const tr = await q1(`SELECT fraction f, hit_ent hit, ex, ey, ez, startsolid ss, allsolid als FROM trace_move(${id}, ${mo.MINX}, ${mo.MINY}, ${mo.MINZ}, ${mo.MAXX}, ${mo.MAXY}, ${mo.MAXZ}, ${mo.X}, ${mo.Y}, ${mo.Z}, ${s.PX}, ${s.PY}, ${mo.Z}, 33620019)`).catch((e) => ({ err: e.message }));
      const near = await qa(`SELECT id, classname, solid, CAST(x AS INTEGER) x, CAST(y AS INTEGER) y, CAST(z AS INTEGER) z FROM ents WHERE solid >= 2 AND id <> ${id} AND ABS(x - ${mo.X}) < 160 AND ABS(y - ${mo.Y}) < 160`);
      console.log(`     ${i}: ${mo.X.toFixed(0)},${mo.Y.toFixed(0)},${mo.Z.toFixed(0)} ${mo.ST}/${mo.ANIM} iy ${mo.IY} → player ${s.PX.toFixed(0)},${s.PY.toFixed(0)}: trace ${JSON.stringify(tr)}; near: ${JSON.stringify(near)}`);
    }
  }
  if (harmless) assert(!attacked && !dmgSeen && s.HEALTH === HP, `${m.name} never attacks (state ${e.ST}, anim ${e.ANIM}, the player's health ${s.HEALTH})`);
  else {
    assert(attacked, `${m.name} attacked (state ${e.ST}, anim ${e.ANIM})`);
    for (let i = 0; i < 80 && !dmgSeen; i++) { s = await tic(); if (s.HEALTH < HP) dmgSeen = 1; }
    assert(dmgSeen, `${m.name} hurt the player (health ${s.HEALTH})`);
  }
  if (m.alt_anim && m.name !== 'makron') {   // (Makron's three are checked below)
    // a second ranged attack: over many missile starts both animations come up, and the second's kind fires
    const seen = new Set();
    for (let i = 0; i < 300 && seen.size < 2; i++) {
      await db.exec(`UPDATE ents SET st = 'run', attack_state = 4, attack_finished = 0, aiflags = 0 WHERE id = ${id}`);
      await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE monster_think(${id}); END`);
      const a = await q1(`SELECT st, anim FROM ents WHERE id = ${id}`);
      if (a.ST === 'missile') seen.add(a.ANIM);
    }
    assert(seen.has(m.missile_anim) && seen.has(m.alt_anim), `${m.name} chooses between ${m.missile_anim} and ${m.alt_anim} (${[...seen].join(', ')})`);
    await db.exec(`UPDATE ents SET st = 'missile', attack_state = 1, anim_frame = 0 WHERE id = ${id}`);
    await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE set_anim(${id}, '${m.alt_anim}'); END`);
    const fx0 = (await q1('SELECT COALESCE(MAX(id), 0) m FROM fx_events')).M;
    const before = await qa(`SELECT id FROM ents WHERE classname IN ('rocket', 'bfg_ball') AND owner_id = ${id}`);
    let fired = 0;
    for (let i = 0; i < 40; i++) { await tic(); if ((await q1(`SELECT st FROM ents WHERE id = ${id}`)).ST !== 'missile') break; }
    if (m.alt_kind === 'rocket' || m.alt_kind === 'bfg') fired = (await qa(`SELECT id FROM ents WHERE classname IN ('rocket', 'bfg_ball') AND owner_id = ${id}`)).length - before.length + (await q1(`SELECT COUNT(*) n FROM fx_events WHERE id > ${fx0} AND kind IN (2, 9)`)).N;
    else fired = (await q1(`SELECT COUNT(*) n FROM fx_events WHERE id > ${fx0} AND kind = 15`)).N;
    assert(fired > 0 || (await sounds(m.attack_snd)), `... and ${m.alt_anim} fires its ${m.alt_kind} (${fired} seen)`);
    await db.exec(`DELETE FROM ents WHERE classname IN ('rocket', 'bfg_ball', 'grenade')`);
  }
  if (m.name === 'makron') {
    const seen = new Set();
    for (let i = 0; i < 300 && seen.size < 3; i++) {
      await db.exec(`UPDATE ents SET st = 'run', attack_state = 4, attack_finished = 0, aiflags = 0 WHERE id = ${id}`);
      await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE monster_think(${id}); END`);
      const a = await q1(`SELECT st, anim FROM ents WHERE id = ${id}`);
      if (a.ST === 'missile') seen.add(a.ANIM);
    }
    assert(seen.size === 3, `Makron picks the BFG, the railgun or the hyperblaster (${[...seen].sort().join(', ')})`);
    await db.exec(`UPDATE ents SET st = 'missile', attack_state = 1, anim_frame = 0 WHERE id = ${id}`);
    await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE set_anim(${id}, 'attack5'); END`);
    let bolts = 0;
    for (let i = 0; i < 30; i++) { await tic(); bolts = Math.max(bolts, (await q1(`SELECT COUNT(*) n FROM ents WHERE classname = 'bolt' AND owner_id = ${id} AND BIN_AND(effects, 64) <> 0`)).N); if ((await q1(`SELECT st FROM ents WHERE id = ${id}`)).ST !== 'missile') break; }
    assert(bolts > 0, `its hyperblaster fires hyperblaster bolts (${bolts} in flight at once)`);
    await db.exec(`DELETE FROM ents WHERE classname IN ('bolt', 'bfg_ball')`);
  }
  if (m.name === 'floater') {
    // floater_zap: the melee is a splash of 32 sparks from its muzzle toward the player (fx 7, count 32, colour 1), heard
    let zaps = 0;
    for (let i = 0; i < 80 && !zaps; i++) { await tic(); zaps = (await q1(`SELECT COUNT(*) n FROM fx_events WHERE kind = 7 AND n = ${32 * 16 + 1}`)).N; }
    assert(zaps > 0 && (await sounds('floater/fltatck2.wav')), `the floater's zap sparks from its muzzle (${zaps} splashes) and is heard`);
  }
  if (m.name === 'mutant') {
    // mutant_check_jump, mutant_jump: beyond 100 units it leaps one time in ten (its jump frames): off the ground at
    // 425 forward and 160 up with its cry, then lands with a thud; a body it lands on at speed takes 40 to 49
    await teleport(128, -320, 32, 135);
    await db.exec(`UPDATE ents SET x = spawn_x, y = spawn_y, z = spawn_z, vx = 0, vy = 0, vz = 0, st = 'run', attack_state = 0, aiflags = 0 WHERE id = ${id}; EXECUTE PROCEDURE link_ent(${id})`);
    let leapt = null;
    for (let i = 0; i < 600 && !leapt; i++) {
      // (kept 220 away: the leap is chosen one think in ten past 100 units, then the next think turns to it and starts the frames)
      await db.exec(`UPDATE ents SET x = spawn_x, y = spawn_y, z = spawn_z, vx = 0, vy = 0, vz = 0, flags = BIN_OR(flags, 512), enemy_id = ${pe}, anim_frame = 0 WHERE id = ${id} AND st = 'run'`);
      await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE monster_think(${id}); END`);
      const a = await q1(`SELECT st, anim FROM ents WHERE id = ${id}`);
      if (a.ST === 'missile' && a.ANIM === 'jump') leapt = a;
      else if (a.ST !== 'run') await db.exec(`UPDATE ents SET st = 'run', attack_state = 0, aiflags = 0, maxz = ${box0.MAXZ} WHERE id = ${id}`);
    }
    assert(leapt, 'from 220 away the mutant chooses the leap (missile state, the jump frames)');
    heard.clear();
    let air = null, landed = null;
    for (let i = 0; i < 80 && !landed; i++) {
      await tic();
      const a = await q1(`SELECT st, anim, anim_frame, vx, vy, vz, flags, aiflags FROM ents WHERE id = ${id}`);
      if (!air && (a.AIFLAGS & 4096)) air = a;
      if (air && !(a.AIFLAGS & 4096) && (a.FLAGS & 512)) landed = a;
      if (a.ST !== 'missile') break;
    }
    for (let i = 0; i < 4; i++) await tic();   // (the thud comes with the landing check's next frame)
    assert(air && Math.abs(Math.hypot(air.VX, air.VY) - 425) < 30 && air.VZ > 0 && air.VZ <= 160 && !(air.FLAGS & 512) && (await sounds('mutant/mutsght1.wav')),
      `it takes off at 425 forward and 160 up with its cry (${air ? `${Math.hypot(air.VX, air.VY).toFixed(0)}, ${air.VZ.toFixed(0)} up` : 'never'})`);
    assert(landed && (await sounds('mutant/thud1.wav')), `and lands with a thud (${landed?.ST}/${landed?.ANIM})`);
    // the touch: a leaping mutant flying into the player, from where it spawned (open ground) with the player put 80 units
    // along its way back to the yard (the spot behind the player is monster clip)
    const sp = await q1(`SELECT spawn_x x, spawn_y y, spawn_z z FROM ents WHERE id = ${id}`);
    const ux = (128 - sp.X) / Math.hypot(128 - sp.X, -320 - sp.Y), uy = (-320 - sp.Y) / Math.hypot(128 - sp.X, -320 - sp.Y);
    await teleport(sp.X + ux * 80, sp.Y + uy * 80, sp.Z, 135);   // (on the diagonal, the boxes of 32 and 16 need 48 an axis: 80 leaves a tic's move)
    const hp0 = (await q1(`SELECT health h FROM ents WHERE id = ${pe}`)).H;
    await db.exec(`UPDATE ents SET x = ${sp.X}, y = ${sp.Y}, z = ${sp.Z + 2}, yaw = ${Math.atan2(uy, ux) * 180 / Math.PI}, vx = ${ux * 425}, vy = ${uy * 425}, vz = 100, flags = BIN_AND(flags, BIN_NOT(512)), aiflags = 4096, st = 'missile', anim_frame = 3 WHERE id = ${id}; EXECUTE PROCEDURE link_ent(${id})`);
    await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE set_anim(${id}, 'jump'); END`);
    await tic();
    const took = hp0 - (await q1(`SELECT health h FROM ents WHERE id = ${pe}`)).H;
    assert(took >= 40 && took <= 49 && !((await q1(`SELECT aiflags a FROM ents WHERE id = ${id}`)).A & 4096), `a body it lands on takes 40 to 49 (${took}), the leap over`);
    await teleport(128, -320, 32, 135);
    await db.exec(`UPDATE ents SET x = spawn_x, y = spawn_y, z = spawn_z, vx = 0, vy = 0, vz = 0, st = 'run', aiflags = 0 WHERE id = ${id}; EXECUTE PROCEDURE link_ent(${id})`);
  }
  if (m.name === 'parasite') {
    // parasite_drain_attack: the launch, the tongue's impact and the drain, each heard; the tongue drawn (fx 16)
    for (let i = 0; i < 40 && !(await sounds('parasite/paratck3.wav')); i++) await tic();
    const tongue = (await q1(`SELECT COUNT(*) n FROM fx_events WHERE kind = 16 AND n = ${id}`)).N;
    assert((await sounds('parasite/paratck1.wav')) && (await sounds('parasite/paratck2.wav')) && (await sounds('parasite/paratck3.wav')) && tongue > 0,
      `the parasite's tongue reaches out, strikes and drains (${tongue} tongue frames)`);
  }
  if (m.missile_kind) {
    // (one that closed in for melee instead counts too, and a gunner that threw grenades rather than firing its chain gun;
    // the hurt above may have come before the firing frame's sound: a few seconds more for it)
    const fired = async () => (m.attack_snd ? await sounds(m.attack_snd) : 1) || (m.melee_snd ? await sounds(m.melee_snd) : 0) ||
      (m.name === 'gunner' ? await sounds('gunner/gunatck3.wav') : 0);
    let atk = await fired();
    for (let i = 0; i < 60 && !atk; i++) { await tic(); atk = await fired(); }
    assert(atk > 0, `${m.name} fired or struck (${m.attack_snd}${m.name === 'gunner' ? ' or gunner/gunatck3.wav' : ''})`);
  }
  // the flinch: hurt, it plays its pain sound and (pain_chance of the time, three seconds between) flinches; in
  // nightmare (skill 3) every pain function returned before the animation, so it cries out and fights on
  const flinch = async (skill, tries) => {
    await db.exec(`UPDATE game SET skill = ${skill}`);
    let pained = 0, heardPain = 0;
    for (let i = 0; i < tries && !pained; i++) {
      await db.exec(`UPDATE ents SET st = 'run', pain_finished = 0, aiflags = 0, maxz = ${box0.MAXZ} WHERE id = ${id}`);
      const s0 = (await q1('SELECT COALESCE(MAX(id), 0) m FROM sound_events')).M;
      await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE monster_pain(${id}, ${pe}, 10); END`);
      if ((await q1(`SELECT st FROM ents WHERE id = ${id}`)).ST === 'pain') pained++;
      heardPain += (await q1(`SELECT COUNT(*) n FROM sound_events WHERE id > ${s0} AND ent_id = ${id} AND snd = '${m.pain_snd}'`)).N;
    }
    return { pained, heardPain };
  };
  const hard = await flinch(2, 40);
  assert(hard.pained === 1 && hard.heardPain >= 1, `${m.name} flinches when hurt on hard (${hard.pained} flinch, ${hard.heardPain} cries)`);
  const nightmare = await flinch(3, 40);
  assert(nightmare.pained === 0 && nightmare.heardPain >= 1, `... and in nightmare cries out but never flinches (${nightmare.pained} flinches, ${nightmare.heardPain} cries in 40)`);
  await db.exec(`UPDATE game SET skill = 1; UPDATE ents SET st = 'run' WHERE id = ${id}`);
  // kill it with the railgun: 150 a shot, both back at their places (a boss's blasts throw the player about)
  await teleport(128, -320, 32, 135);
  await db.exec(`UPDATE ents SET x = spawn_x, y = spawn_y, z = spawn_z, vx = 0, vy = 0, vz = 0 WHERE id = ${id}; EXECUTE PROCEDURE link_ent(${id})`);
  await db.exec(`UPDATE ents SET flags = BIN_OR(flags, 16), health = 100, max_health = 100 WHERE id = ${pe}; UPDATE player SET slugs = 50`);   // (the slugs: the bosses take twenty)
  await tic([1, 0, 0, 0, 0, 0, 0, 1, 10]);
  for (let i = 0; i < 8; i++) await tic();
  let hp = m.health, shots = 0;
  const maxShots = Math.ceil(m.health / 150) + 6;   // (a boss takes twenty)
  while (hp > 0 && shots < maxShots) {
    const mon = await q1(`SELECT x, y, z, health FROM ents WHERE id = ${id}`);
    if (!mon) break;
    // (a boss's rockets and BFG balls in flight would take the rail: the shot is at the monster)
    await db.exec(`DELETE FROM ents WHERE classname IN ('rocket', 'bfg_ball', 'grenade', 'bolt') AND owner_id = ${id}`);
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
  if (m.name === 'jorg') {
    // jorg_dead, MakronToss: Makron waits unseen where Jorg fell and comes to life four seconds on
    const mk = await q1("SELECT id, st, solid, x, y FROM ents WHERE mtype = 'makron'");
    const jx = await q1(`SELECT x, y FROM ents WHERE id = ${id}`);
    assert(mk && mk.ST === 'asleep' && mk.SOLID === 0 && (!jx || (Math.abs(mk.X - jx.X) < 1 && Math.abs(mk.Y - jx.Y) < 1)), `Makron waits unseen where Jorg fell (${mk?.ST})`);
    await run(85);
    const up = mk ? await q1(`SELECT st, solid FROM ents WHERE id = ${mk.ID}`) : null;
    assert(up && up.ST !== 'asleep' && up.SOLID === 3 && (await sounds('makron/popup.wav')), `... and rises four seconds on (${up?.ST})`);
  }
  await run(20);
  // (and whatever it left in flight: a boss's last BFG ball would hurt the player during the next monster's turn)
  await db.exec("DELETE FROM ents WHERE mtype IS NOT NULL OR classname IN ('gib', 'debris', 'rocket', 'bfg_ball', 'grenade', 'bolt')");
  await db.exec('UPDATE game SET killed = 0');
}

// the medic's cable: a dead monster in sight is raised (medic_FindDeadMonster, medic_cable_attack, ED_CallSpawn)
{
  console.log('── the medic\'s cable');
  await teleport(128, -320, 32, 135);
  await db.exec(`UPDATE ents SET flags = BIN_OR(flags, 16), health = 100 WHERE id = ${pe}`);
  // a soldier killed where it stands: its death plays out to a corpse
  const sid = (await q1("SELECT * FROM spawn_monster('soldier', 160)")).ID;
  const sx = await q1(`SELECT x, y, z, yaw FROM ents WHERE id = ${sid}`);
  await db.exec(`UPDATE ents SET health = 1 WHERE id = ${sid}`);
  await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE t_damage(${sid}, ${pe}, ${pe}, 10, 0, 0); END`);
  let corpse = null;
  let c = null;
  for (let i = 0; i < 120 && !corpse; i++) { await tic(); c = await q1(`SELECT st, health, anim, anim_frame FROM ents WHERE id = ${sid}`); if (c?.ST === 'dead') corpse = c; }   // (death1 is 36 frames at 10 Hz)
  assert(corpse && corpse.HEALTH <= 0, `a soldier shot dead lies as a corpse (${JSON.stringify(corpse ?? c)})`);
  // a medic 120 units beyond it, facing it: the corpse is what it goes for
  const mid = (await q1(`SELECT * FROM spawn_monster_at('medic', ${sx.X + 120 * Math.cos(135 * Math.PI / 180)}, ${sx.Y + 120 * Math.sin(135 * Math.PI / 180)}, ${sx.Z + 8}, ${sx.YAW})`)).ID;
  assert(mid, 'a medic spawns beyond it');
  const killed0 = (await q1('SELECT killed k, total_monsters t FROM game'));
  heard.clear();
  let took = null;
  for (let i = 0; i < 100 && !took; i++) { await tic(); const a = await q1(`SELECT enemy_id e, aiflags a, st FROM ents WHERE id = ${mid}`); if ((a.A & 8192) && a.E === sid) took = a; }
  assert(took && (await q1(`SELECT owner_id o FROM ents WHERE id = ${sid}`)).O === mid, `the medic takes the corpse for its enemy (AI_MEDIC) and its own (${took?.ST})`);
  let cabled = 0, revived = null;
  for (let i = 0; i < 400 && !revived; i++) {
    await tic();
    cabled = (await q1(`SELECT COUNT(*) n FROM fx_events WHERE kind = 16 AND n = ${mid}`)).N;
    const c = await q1(`SELECT st, health, solid, deadflag, maxz FROM ents WHERE id = ${sid}`);
    if (c && c.HEALTH > 0) revived = c;
  }
  assert(cabled > 0 && (await sounds('medic/medatck2.wav')) && (await sounds('medic/medatck3.wav')) && (await sounds('medic/medatck4.wav')),
    `the cable reaches from the medic's hand to the body (${cabled} frames of it), launched, hooked and healing, each heard`);
  assert(revived && revived.HEALTH === 30 && revived.SOLID === 3 && revived.DEADFLAG === 0 && revived.MAXZ === 32 && revived.ST !== 'dead',
    `the soldier stands again with its health and its box (${revived?.HEALTH}, ${revived?.ST})`);
  const after = await q1('SELECT killed k, total_monsters t FROM game');
  assert(after.T === killed0.T + 1 && after.K === killed0.K, `it counts among the level's monsters again (${killed0.T} → ${after.T}), the kill as it was`);
  let back = null;
  for (let i = 0; i < 40 && !back; i++) { await tic(); const a = await q1(`SELECT aiflags a, enemy_id e FROM ents WHERE id = ${mid}`); if (!(a.A & 8192)) back = a; }
  assert(back && back.E !== sid, `and the medic, its work done, is back on the player (enemy ${back?.E === pe ? 'the player' : back?.E})`);
  await db.exec("DELETE FROM ents WHERE mtype IS NOT NULL OR classname IN ('gib', 'bolt')");
  await db.exec(`UPDATE game SET killed = 0; UPDATE ents SET flags = BIN_OR(flags, 16) WHERE id = ${pe}`);
}

// the insane marines' forms (m_insane.c): the crawling one comes on its knees, the crucified one hangs on its cross,
// struggles when hurt and stays there dead; neither ever attacks
if (!only || only.has('insane_crawl') || only.has('insane_cross')) {
  console.log('── the insane marines\' forms');
  await teleport(128, -320, 32, 135);
  await db.exec(`UPDATE ents SET flags = BIN_OR(flags, 16), health = 100 WHERE id = ${pe}`);
  const crawler = (await q1("SELECT * FROM spawn_monster('insane_crawl', 300)")).ID;
  const c0 = await q1(`SELECT x, y, z, anim, st FROM ents WHERE id = ${crawler}`);
  let seen = null;
  for (let i = 0; i < 60 && !seen; i++) { await tic(); const e = await q1(`SELECT st, anim, enemy_id FROM ents WHERE id = ${crawler}`); if (e.ENEMY_ID === pe) seen = e; }
  await run(40);
  const c1 = await q1(`SELECT x, y, z, anim, st FROM ents WHERE id = ${crawler}`);
  const crawled = Math.hypot(c1.X - c0.X, c1.Y - c0.Y);
  assert(c0.ANIM === 'crawl' && seen && c1.ANIM === 'crawl' && c1.ST === 'run' && crawled > 30 && crawled < 250,
    `the crawling marine waits on its knees, sees the player and comes on in the crawl frames (${crawled.toFixed(0)} units in two seconds, ${c1.ST})`);
  await db.exec("DELETE FROM ents WHERE mtype IS NOT NULL");
  // the crucified one, put on a wall's height: it never moves, holds its ground; hurt, it struggles; killed, it stays
  const cross = (await q1("SELECT * FROM spawn_monster('insane_cross', 200)")).ID;
  await db.exec(`UPDATE ents SET z = z + 40 WHERE id = ${cross}; EXECUTE PROCEDURE link_ent(${cross})`);
  const x0 = await q1(`SELECT x, y, z, anim, flags, aiflags, movetype, miny, maxy FROM ents WHERE id = ${cross}`);
  await run(40);
  const x1 = await q1(`SELECT x, y, z, anim, st, enemy_id FROM ents WHERE id = ${cross}`);
  assert((x0.FLAGS & 1) && (x0.AIFLAGS & 1) && x0.MOVETYPE === 5 && x0.MINY === 0 && x0.MAXY === 8 && x1.X === x0.X && x1.Y === x0.Y && x1.Z === x0.Z && x1.ANIM === 'cross',
    `the crucified marine hangs where it was put (flying, a box 8 deep) and stays through two seconds in the cross frames (${x1.ST}, ${x1.ENEMY_ID === pe ? 'the player in sight' : 'no one in sight'}; ${JSON.stringify({ from: [x0.X, x0.Y, x0.Z], to: [x1.X, x1.Y, x1.Z], anim: x1.ANIM })})`);
  await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE t_damage(${cross}, ${pe}, ${pe}, 10, 0, 0); END`);
  await tic();
  const hurt = await q1(`SELECT st, anim, x, y, z FROM ents WHERE id = ${cross}`);
  assert(hurt.ST === 'pain' && hurt.ANIM === 'struggle' && hurt.Z === x0.Z, `hurt, it struggles on the cross (${hurt.ANIM}) and does not fall`);
  await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE t_damage(${cross}, ${pe}, ${pe}, 100, 0, 0); END`);   // (more than its 90 left, less than would gib it: insane_die gibs at -50)
  let dead = null;
  for (let i = 0; i < 60 && !dead; i++) { await tic(); const e = await q1(`SELECT st, anim, x, y, z, movetype, flags, minz, maxz FROM ents WHERE id = ${cross}`); if (e?.ST === 'dead') dead = e; }
  assert(dead && dead.ANIM === 'cross_death' && dead.Z === x0.Z && dead.MOVETYPE === 0 && (dead.FLAGS & 1) && dead.MINZ === 0 && dead.MAXZ === 32,
    `killed, it dies on the cross and stays there (${dead?.ANIM}, z ${dead?.Z?.toFixed(0)} as it was, its box as it was)`);
  await db.exec("DELETE FROM ents WHERE mtype IS NOT NULL OR classname IN ('gib', 'bolt')");
  await db.exec(`UPDATE game SET killed = 0; UPDATE ents SET flags = BIN_OR(flags, 16) WHERE id = ${pe}`);
}

// the player's trail and a monster's pursuit when it loses sight (p_trail.c, ai_run)
{
  console.log('── pursuit');
  await teleport(128, -320, 32, 135);
  const trail = () => qa('SELECT seq, x, y, z, ts FROM player_trail ORDER BY seq');
  await db.exec("DELETE FROM player_trail; UPDATE player SET trail_x = 1e30, trail_y = 1e30, trail_z = 1e30");
  await db.exec('EXECUTE PROCEDURE player_trail_check');
  assert((await trail()).length === 1, 'the first check drops a marker where the player stands');
  await teleport(128 + 40, -320, 32, 135);
  await db.exec('EXECUTE PROCEDURE player_trail_check');
  assert((await trail()).length === 1, '... and none while that marker is in sight');
  await db.exec('UPDATE player_trail SET z = z - 4000');                       // a marker the player cannot see
  await teleport(128 + 80, -320, 32, 135);
  await db.exec('EXECUTE PROCEDURE player_trail_check');
  const tr = await trail();
  assert(tr.length === 2 && tr[1].X === 128 + 40, `out of sight of the last marker, a new one where the player was (${tr.map((m) => m.X).join(', ')})`);
  for (let i = 0; i < 9; i++) { await db.exec('UPDATE player_trail SET z = z - 4000'); await teleport(128 + i * 8, -300, 32, 135); await db.exec('EXECUTE PROCEDURE player_trail_check'); }
  const n8 = (await trail()).length;
  assert(n8 === 8, `eight markers are kept (${n8})`);
  await db.exec('UPDATE player_trail SET z = z - 4000');                       // none in the soldier's sight either
  await teleport(128, -320, 32, 135);

  const id = (await q1("SELECT * FROM spawn_monster('soldier', 220)")).ID;
  const m0 = await q1(`SELECT x, y, z FROM ents WHERE id = ${id}`);
  await db.exec(`UPDATE ents SET enemy_id = ${pe}, st = 'run', aiflags = 0, search_time = ${(await q1('SELECT time_ t FROM game')).T} + 5, trail_time = 0,
                 ls_x = ${m0.X + 4}, ls_y = ${m0.Y}, ls_z = ${m0.Z}, nextthink = NULL WHERE id = ${id}`);
  const pursue = () => q1(`SELECT gx, gy, iy, dist FROM ai_pursue(${id}, 10)`);
  let p = await pursue();
  let m = await q1(`SELECT aiflags a, ls_x lx FROM ents WHERE id = ${id}`);
  assert((m.A & 112) === 112 && Math.abs(p.GX - m0.X - 4) < 1e-6 && Math.abs(p.DIST - 4) < 1e-6, `losing sight it runs to where it last saw the player, reaching it (flags ${m.A}, ${p.DIST})`);
  const first = (await trail())[0];
  p = await pursue();
  m = await q1(`SELECT aiflags a, ls_x lx, ls_y ly, sg_x sx, sg_y sy, trail_time tt FROM ents WHERE id = ${id}`);
  // (a marker the box cannot reach straight is detoured: then it waits in saved_goal behind a spot to one side)
  const tx = m.A & 128 ? m.SX : m.LX, ty = m.A & 128 ? m.SY : m.LY;
  assert(tx === first.X && ty === first.Y && m.TT === first.TS && (m.A & 32) === 0,
    `... then takes the trail's first marker after it (${tx}, ${ty}${m.A & 128 ? `, by way of ${m.LX.toFixed(0)}, ${m.LY.toFixed(0)}` : ''})`);
  if (m.A & 128) {
    // AI_PURSUE_TEMP: reaching the spot puts the marker back as the target
    await db.exec(`UPDATE ents SET x = ls_x, y = ls_y WHERE id = ${id}`);
    await pursue(); await pursue();
    const m2 = await q1(`SELECT aiflags a, ls_x lx, sg_x sx FROM ents WHERE id = ${id}`);
    assert((m2.A & 128 ? m2.SX : m2.LX) === first.X, '... and once at the detour, on to the marker');
  }
  await db.exec(`UPDATE ents SET search_time = 1 WHERE id = ${id}`);
  await db.exec('UPDATE game SET time_ = time_ + 30');
  p = await pursue();
  const pl = await q1(`SELECT x FROM ents WHERE id = ${pe}`);
  assert(p.GX === pl.X && (await q1(`SELECT search_time s FROM ents WHERE id = ${id}`)).S === 0, 'twenty seconds past the search, straight at the enemy');
  await db.exec('UPDATE game SET time_ = time_ - 30');
  await db.exec(`DELETE FROM ents WHERE id = ${id}`);
}

// AS_SLIDING: a flyer that did not fire may slide around its enemy (ai_run_slide), stepping square to it
{
  console.log('── sliding');
  await teleport(128, -320, 32, 135);
  const id = (await q1("SELECT * FROM spawn_monster('flyer', 220)")).ID;
  const t0 = (await q1('SELECT time_ t FROM game')).T;
  let moved = 0, along = 0;
  for (let i = 0; i < 10 && !moved; i++) {
    await db.exec(`UPDATE ents SET enemy_id = ${pe}, st = 'run', attack_state = 2, attack_finished = ${t0} + 100, nextthink = NULL WHERE id = ${id}`);
    const a = await q1(`SELECT e.x, e.y, p.x px, p.y py FROM ents e CROSS JOIN ents p WHERE e.id = ${id} AND p.id = ${pe}`);
    await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE monster_think(${id}); END`);
    const b = await q1(`SELECT x, y FROM ents WHERE id = ${id}`);
    const mx = b.X - a.X, my = b.Y - a.Y, tx = a.PX - a.X, ty = a.PY - a.Y, tl = Math.hypot(tx, ty);
    moved = Math.hypot(mx, my); along = Math.abs((mx * tx + my * ty) / tl);
  }
  assert(moved > 0 && along < moved * 0.5, `a sliding flyer steps sideways around the player (moved ${moved.toFixed(1)}, ${along.toFixed(1)} of it toward)`);
  await db.exec(`DELETE FROM ents WHERE id = ${id}`);
}

// blast damage: the radius reaches as far as Quake's findradius and no farther; the BFG's lasers and its final blast
{
  console.log('── blast damage');
  await teleport(128, -320, 32, 135);
  await db.exec(`UPDATE ents SET flags = BIN_OR(flags, 16), health = 100 WHERE id = ${pe}`);
  const id = (await q1("SELECT * FROM spawn_monster('soldier', 220)")).ID;
  await db.exec(`UPDATE ents SET health = 100000, max_health = 100000, nextthink = NULL, st = 'stand' WHERE id = ${id}`);
  const mon = await q1(`SELECT x + (minx + maxx) / 2 cx, y + (miny + maxy) / 2 cy, z + (minz + maxz) / 2 cz FROM ents WHERE id = ${id}`);
  const p = await q1(`SELECT x, y, z FROM ents WHERE id = ${pe}`);
  // a point d units from the monster's middle, on the way to the player
  const toward = (d) => { const dx = p.X - mon.CX, dy = p.Y - mon.CY, l = Math.hypot(dx, dy); return [mon.CX + dx / l * d, mon.CY + dy / l * d, mon.CZ]; };
  const hp = async () => (await q1(`SELECT health h FROM ents WHERE id = ${id}`)).H;
  const blast = async (d, dmg, radius) => {
    const [x, y, z] = toward(d);
    const before = await hp();
    await db.query(`EXECUTE BLOCK AS DECLARE g INTEGER; BEGIN EXECUTE PROCEDURE spawn_ent('blast', ${x}, ${y}, ${z}) RETURNING_VALUES g;
      UPDATE ents e SET e.solid = 0 WHERE e.id = :g; EXECUTE PROCEDURE t_radius_damage(g, ${pe}, ${dmg}, NULL, ${radius}); DELETE FROM ents e WHERE e.id = :g; END`);
    return before - (await hp());
  };
  assert((await blast(100, 120, 120)) === 70, 'a rocket\'s blast 100 units off takes 120 - 100/2 = 70');
  assert((await blast(150, 120, 120)) === 0, '... and 150 units off, beyond its 120 radius, nothing (it used to reach 160 along each axis)');
  // the BFG ball in flight, 200 units from the monster: a laser of 10
  const ball = async (d) => {
    const [x, y, z] = toward(d);
    return (await q1(`EXECUTE BLOCK RETURNS (id INTEGER) AS BEGIN EXECUTE PROCEDURE spawn_ent('bfg_ball', ${x}, ${y}, ${z}) RETURNING_VALUES id;
      UPDATE ents e SET e.owner_id = ${pe}, e.solid = 0, e.dmg = 500, e.dmg_radius = 1000, e.teleport_time = 1e9 WHERE e.id = :id; SUSPEND; END`)).ID;
  };
  let b = await ball(200);
  let before = await hp();
  await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE bfg_think(${b}); END`);
  assert(before - (await hp()) === 10, 'the flying BFG ball\'s laser takes 10 a frame');
  await db.exec(`DELETE FROM ents WHERE id = ${b}`);
  // its final blast, 150 units off (between the two): 500 * (1 - sqrt(150 / 1000))
  b = await ball(150);
  before = await hp();
  await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE bfg_explode(${b}); END`);
  const want = Math.trunc(500 * (1 - Math.sqrt(150 / 1000)));
  const got = before - (await hp());
  assert(Math.abs(got - want) <= 1, `the BFG's final blast 150 units off takes 500 × (1 − √0.15) = ${want} (took ${got})`);
  // (the explosion plays four frames more, hurting no one again, then goes)
  for (let i = 0; i < 4; i++) await db.query(`EXECUTE BLOCK AS BEGIN EXECUTE PROCEDURE bfg_explode(${b}); END`);
  assert(before - (await hp()) === got && (await q1(`SELECT COUNT(*) n FROM ents WHERE id = ${b}`)).N === 0, '... and the explosion is gone after its five frames, hurting once');
  // and the real thing: the player fires the BFG10K at it (flight, lasers, the strike, the blast a frame later)
  await db.exec(`UPDATE player SET cells = 200, weapon = 1024, attack_finished = 0 WHERE id = 1`);
  const m2 = await q1(`SELECT x, y, z FROM ents WHERE id = ${id}`);
  const p2 = await q1(`SELECT x, y, z FROM ents WHERE id = ${pe}`);
  const yaw = (Math.atan2(m2.Y - p2.Y, m2.X - p2.X) * 180) / Math.PI;
  await db.exec(`UPDATE ents SET yaw = ${yaw} WHERE id = ${pe}; UPDATE player SET pitch = 0 WHERE id = 1`);
  before = await hp();
  await tic([1, 0, 0, 0, 0, 1, 0, 1, 0]);
  for (let i = 0; i < 40; i++) await tic();
  const took = before - (await hp());
  let balls = (await q1("SELECT COUNT(*) n FROM ents WHERE classname = 'bfg_ball'")).N;   // (the strike's sprite plays half a second)
  for (let i = 0; i < 12 && balls > 0; i++) { await tic(); balls = (await q1("SELECT COUNT(*) n FROM ents WHERE classname = 'bfg_ball'")).N; }
  assert(took >= 200 + 150 && balls === 0, `a BFG10K shot hits it with the strike and the blast (took ${took}), and leaves nothing behind`);
  await db.exec("DELETE FROM ents WHERE mtype IS NOT NULL");
}

await db.close();
console.log(failed ? `${failed} FAILED` : 'all good');
process.exit(failed ? 1 : 0);
