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
  if (m.name === 'parasite') {
    // parasite_drain_attack: the launch, the tongue's impact and the drain, each heard; the tongue drawn (fx 16)
    for (let i = 0; i < 40 && !(await sounds('parasite/paratck3.wav')); i++) await tic();
    const tongue = (await q1(`SELECT COUNT(*) n FROM fx_events WHERE kind = 16 AND n = ${id}`)).N;
    assert((await sounds('parasite/paratck1.wav')) && (await sounds('parasite/paratck2.wav')) && (await sounds('parasite/paratck3.wav')) && tongue > 0,
      `the parasite's tongue reaches out, strikes and drains (${tongue} tongue frames)`);
  }
  if (m.missile_kind) {
    // (one that closed in for melee instead counts too, and a gunner that threw grenades rather than firing its chain gun)
    const atk = (m.attack_snd ? await sounds(m.attack_snd) : 1) || (m.melee_snd ? await sounds(m.melee_snd) : 0) ||
      (m.name === 'gunner' ? await sounds('gunner/gunatck3.wav') : 0);
    assert(atk > 0, `${m.name} fired or struck (${m.attack_snd}${m.name === 'gunner' ? ' or gunner/gunatck3.wav' : ''})`);
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
  m = await q1(`SELECT aiflags a, ls_x lx, ls_y ly, trail_time tt FROM ents WHERE id = ${id}`);
  assert(m.LX === first.X && m.LY === first.Y && m.TT === first.TS && (m.A & 32) === 0, `... then takes the trail's first marker after it (${m.LX}, ${m.LY})`);
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
  assert((await q1(`SELECT COUNT(*) n FROM ents WHERE id = ${b}`)).N === 0, '... and the explosion is gone after it');
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
  const balls = (await q1("SELECT COUNT(*) n FROM ents WHERE classname = 'bfg_ball'")).N;
  assert(took >= 200 + 150 && balls === 0, `a BFG10K shot hits it with the strike and the blast (took ${took}), and leaves nothing behind`);
  await db.exec("DELETE FROM ents WHERE mtype IS NOT NULL");
}

await db.close();
console.log(failed ? `${failed} FAILED` : 'all good');
process.exit(failed ? 1 : 0);
