-- monsters.sql – g_ai.c, g_monster.c and the m_*.c files, plus the per-tic
-- driver (sv_main.c's SV_RunGameFrame / g_phys.c) and level setup.

SET TERM ^ ;

CREATE OR ALTER PROCEDURE run_think (eid INTEGER, think VARCHAR(24)) AS BEGIN END^
CREATE OR ALTER PROCEDURE gunner_grenade (eid INTEGER) AS BEGIN END^
-- (mover_blocked is defined in game.sql, which loads first: a stub here used to replace it with an empty body)

-- the current frame of an entity's animation
CREATE OR ALTER PROCEDURE set_anim (eid INTEGER, anim VARCHAR(16))
AS
DECLARE mid INTEGER; DECLARE ff INTEGER;
BEGIN
  SELECT e.model_id FROM ents e WHERE e.id = :eid INTO mid;
  SELECT a.first_frame FROM anims a WHERE a.model_id = :mid AND a.anim = :anim INTO ff;
  IF (ff IS NULL) THEN SELECT FIRST 1 a.first_frame FROM anims a WHERE a.model_id = :mid ORDER BY a.first_frame INTO ff;
  UPDATE ents e SET e.anim = :anim, e.anim_frame = 0, e.frame = COALESCE(:ff, 0) WHERE e.id = :eid;
END^

-- M_ChangeYaw: turn toward ideal_yaw by at most yaw_speed
-- monster_duck_up: the box back to its height after a duck (also on pain and death)
CREATE OR ALTER PROCEDURE monster_duck_up (eid INTEGER)
AS
BEGIN
  UPDATE ents e SET e.maxz = e.maxz + 32, e.aiflags = BIN_AND(e.aiflags, BIN_NOT(4 + 8)) WHERE e.id = :eid AND BIN_AND(e.aiflags, 4) <> 0;
END^

-- soldier_dodge, infantry_dodge, gunner_dodge: a quarter of the time, duck under the shot (monster_duck_down:
-- the box 32 units lower until the duck frames end). The other monsters of the demo have no dodge.
-- A soldier on medium crouches and fires instead (soldier_move_attack3) a third of those times, on hard two
-- thirds; on easy it only ducks.
CREATE OR ALTER PROCEDURE monster_dodge (eid INTEGER, attacker INTEGER, eta DOUBLE PRECISION)
AS
DECLARE st VARCHAR(12); DECLARE mt VARCHAR(16); DECLARE aif INTEGER; DECLARE hp INTEGER; DECLARE sk SMALLINT; DECLARE r DOUBLE PRECISION;
BEGIN
  SELECT e.st, e.mtype, e.aiflags, e.health FROM ents e WHERE e.id = :eid INTO st, mt, aif, hp;
  IF (mt IS NULL OR mt NOT IN ('soldier_light', 'soldier', 'soldier_ss', 'infantry', 'gunner')) THEN EXIT;
  IF (hp <= 0 OR st NOT IN ('stand', 'walk', 'run', 'missile', 'melee') OR BIN_AND(aif, 4) <> 0) THEN EXIT;
  IF (RAND() > 0.25e0) THEN EXIT;
  IF (mt STARTING WITH 'soldier') THEN
  BEGIN
    SELECT g.skill FROM game g WHERE g.id = 1 INTO sk;
    r = RAND();
    IF ((sk = 1 AND r <= 0.33e0) OR (sk >= 2 AND r <= 0.66e0)) THEN
    BEGIN
      UPDATE ents e SET e.enemy_id = COALESCE(e.enemy_id, :attacker), e.st = 'attack3', e.pausetime = now_() + :eta + 0.3e0,
             e.nextthink = now_() + 0.1e0 WHERE e.id = :eid;
      EXECUTE PROCEDURE set_anim(eid, 'attak3');
      EXIT;
    END
  END
  UPDATE ents e SET e.enemy_id = COALESCE(e.enemy_id, :attacker), e.st = 'duck', e.aiflags = BIN_OR(e.aiflags, 4), e.maxz = e.maxz - 32,
         e.nextthink = now_() + 0.1e0 WHERE e.id = :eid;
  EXECUTE PROCEDURE set_anim(eid, 'duck');
  -- gunner_duck_down: on hard, half the time a grenade as it goes down
  IF (mt = 'gunner' AND (SELECT g.skill FROM game g WHERE g.id = 1) >= 2 AND RAND() > 0.5e0) THEN EXECUTE PROCEDURE gunner_grenade(eid);
END^

-- point_combat_touch: a monster reaching the point it ran to. A further point: run on to it. HOLD (spawnflags 1):
-- stand and fight from here. Either way the enemy is the goal again; the point's pathtarget fires.
CREATE OR ALTER PROCEDURE point_combat_touch (pt INTEGER, eid INTEGER)
AS
DECLARE tgt VARCHAR(40); DECLARE sf INTEGER; DECLARE ptgt VARCHAR(40); DECLARE nxt INTEGER; DECLARE fl INTEGER; DECLARE activator INTEGER;
BEGIN
  SELECT p.target, p.spawnflags, p.pathtarget FROM ents p WHERE p.id = :pt INTO tgt, sf, ptgt;
  SELECT e.flags, e.enemy_id FROM ents e WHERE e.id = :eid INTO fl, activator;
  IF (tgt IS NOT NULL AND tgt <> '') THEN
  BEGIN
    SELECT FIRST 1 n.id FROM ents n WHERE n.targetname = :tgt INTO nxt;
    UPDATE ents e SET e.goal_id = COALESCE(:nxt, :pt) WHERE e.id = :eid;
    UPDATE ents p SET p.target = NULL WHERE p.id = :pt;
  END
  ELSE IF (BIN_AND(sf, 1) <> 0 AND BIN_AND(fl, 3) = 0) THEN
    UPDATE ents e SET e.aiflags = BIN_OR(e.aiflags, 1) WHERE e.id = :eid;
  UPDATE ents e SET e.goal_id = NULL, e.aiflags = BIN_AND(e.aiflags, BIN_NOT(2)) WHERE e.id = :eid AND e.goal_id = :pt;
  IF (ptgt IS NOT NULL AND ptgt <> '') THEN
  BEGIN
    UPDATE ents p SET p.target = :ptgt WHERE p.id = :pt;
    EXECUTE PROCEDURE use_targets(pt, COALESCE(activator, eid));
    UPDATE ents p SET p.target = :tgt, p.pathtarget = NULL WHERE p.id = :pt;
  END
END^

CREATE OR ALTER PROCEDURE change_yaw (eid INTEGER)
AS
DECLARE cur DOUBLE PRECISION; DECLARE ideal DOUBLE PRECISION; DECLARE spd DOUBLE PRECISION; DECLARE mv DOUBLE PRECISION;
BEGIN
  SELECT anglemod(e.yaw), e.ideal_yaw, e.yaw_speed FROM ents e WHERE e.id = :eid INTO cur, ideal, spd;
  IF (cur = ideal) THEN EXIT;
  mv = ideal - cur;
  IF (ideal > cur) THEN BEGIN IF (mv >= 180) THEN mv = mv - 360; END
  ELSE BEGIN IF (mv <= -180) THEN mv = mv + 360; END
  IF (mv > 0) THEN BEGIN IF (mv > spd) THEN mv = spd; END
  ELSE BEGIN IF (mv < -spd) THEN mv = -spd; END
  UPDATE ents e SET e.yaw = anglemod(:cur + :mv) WHERE e.id = :eid;
END^

CREATE OR ALTER FUNCTION facing_ideal (eid INTEGER) RETURNS SMALLINT
AS
DECLARE d DOUBLE PRECISION;
BEGIN
  SELECT anglemod(e.yaw - e.ideal_yaw) FROM ents e WHERE e.id = :eid INTO d;
  RETURN IIF(d > 45 AND d < 315, 0, 1);
END^

-- SV_StepDirection: turn to yaw and try to step dist that way
CREATE OR ALTER FUNCTION step_direction (eid INTEGER, yaw DOUBLE PRECISION, dist DOUBLE PRECISION) RETURNS SMALLINT
AS
DECLARE ox DOUBLE PRECISION; DECLARE oy DOUBLE PRECISION; DECLARE oz DOUBLE PRECISION; DECLARE d DOUBLE PRECISION;
DECLARE cur DOUBLE PRECISION; DECLARE spd DOUBLE PRECISION; DECLARE mv DOUBLE PRECISION; DECLARE newyaw DOUBLE PRECISION;
BEGIN
  -- M_ChangeYaw toward the wished direction, written together with it (one write of the row, not two)
  SELECT e.x, e.y, e.z, anglemod(e.yaw), e.yaw_speed FROM ents e WHERE e.id = :eid INTO ox, oy, oz, cur, spd;
  newyaw = cur;
  IF (cur <> yaw) THEN
  BEGIN
    mv = yaw - cur;
    IF (yaw > cur) THEN BEGIN IF (mv >= 180) THEN mv = mv - 360; END
    ELSE BEGIN IF (mv <= -180) THEN mv = mv + 360; END
    IF (mv > 0) THEN BEGIN IF (mv > spd) THEN mv = spd; END
    ELSE BEGIN IF (mv < -spd) THEN mv = -spd; END
    newyaw = anglemod(cur + mv);
  END
  UPDATE ents e SET e.ideal_yaw = :yaw, e.yaw = :newyaw WHERE e.id = :eid;
  IF (move_step(eid, COS(yaw * 0.0174532925e0) * dist, SIN(yaw * 0.0174532925e0) * dist, 0) = 1) THEN
  BEGIN
    d = anglemod(newyaw - yaw);
    IF (d > 45 AND d < 315) THEN
    BEGIN
      -- not turned far enough, so don't take the step
      UPDATE ents e SET e.x = :ox, e.y = :oy, e.z = :oz WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    RETURN 1;
  END
  RETURN 0;
END^

-- SV_NewChaseDir: pick a direction toward the goal, trying the sides
CREATE OR ALTER PROCEDURE new_chase_dir (eid INTEGER, goal INTEGER, dist DOUBLE PRECISION, iy_in DOUBLE PRECISION DEFAULT NULL,
  gx DOUBLE PRECISION DEFAULT NULL, gy DOUBLE PRECISION DEFAULT NULL)
AS
DECLARE olddir DOUBLE PRECISION; DECLARE turnaround DOUBLE PRECISION;
DECLARE dx DOUBLE PRECISION; DECLARE dy DOUBLE PRECISION; DECLARE d1 DOUBLE PRECISION; DECLARE d2 DOUBLE PRECISION; DECLARE tdir DOUBLE PRECISION;
DECLARE nodir DOUBLE PRECISION = -1;
BEGIN
  IF (iy_in IS NOT NULL) THEN olddir = anglemod(FLOOR(iy_in / 45) * 45);
  ELSE SELECT anglemod(FLOOR(e.ideal_yaw / 45) * 45) FROM ents e WHERE e.id = :eid INTO olddir;
  turnaround = anglemod(olddir - 180);
  -- (gx, gy: a spot to head for instead of an entity, as ai_run's tempgoal was)
  IF (gx IS NOT NULL) THEN SELECT :gx - e.x, :gy - e.y FROM ents e WHERE e.id = :eid INTO dx, dy;
  ELSE SELECT g.x - e.x, g.y - e.y FROM ents e CROSS JOIN ents g WHERE e.id = :eid AND g.id = :goal INTO dx, dy;
  IF (dx IS NULL) THEN EXIT;
  d1 = IIF(dx > 10, 0, IIF(dx < -10, 180, nodir));
  d2 = IIF(dy < -10, 270, IIF(dy > 10, 90, nodir));
  IF (d1 <> nodir AND d2 <> nodir) THEN
  BEGIN
    tdir = IIF(d1 = 0, IIF(d2 = 90, 45, 315), IIF(d2 = 90, 135, 215));
    IF (tdir <> turnaround AND step_direction(eid, tdir, dist) = 1) THEN EXIT;
  END
  IF (RAND() < 0.5e0 OR ABS(dy) > ABS(dx)) THEN BEGIN tdir = d1; d1 = d2; d2 = tdir; END
  IF (d1 <> nodir AND d1 <> turnaround AND step_direction(eid, d1, dist) = 1) THEN EXIT;
  IF (d2 <> nodir AND d2 <> turnaround AND step_direction(eid, d2, dist) = 1) THEN EXIT;
  IF (olddir <> nodir AND step_direction(eid, olddir, dist) = 1) THEN EXIT;
  tdir = IIF(RAND() < 0.5e0, 0, 315);
  d1 = 0;
  WHILE (d1 < 8) DO
  BEGIN
    IF (step_direction(eid, anglemod(tdir + IIF(tdir = 0, 45, -45) * d1), dist) = 1) THEN EXIT;
    d1 = d1 + 1;
  END
  IF (turnaround <> nodir AND step_direction(eid, turnaround, dist) = 1) THEN EXIT;
  UPDATE ents e SET e.ideal_yaw = :olddir WHERE e.id = :eid;     -- can't move
END^

-- M_MoveToGoal
CREATE OR ALTER PROCEDURE move_to_goal (eid INTEGER, dist DOUBLE PRECISION, iy_in DOUBLE PRECISION DEFAULT NULL,
  gx DOUBLE PRECISION DEFAULT NULL, gy DOUBLE PRECISION DEFAULT NULL)
AS
DECLARE goal INTEGER; DECLARE flags INTEGER; DECLARE iy DOUBLE PRECISION; DECLARE close_ SMALLINT = 0;
BEGIN
  -- (iy_in: the wished yaw, when the caller has it; saves writing it to the row first)
  SELECT COALESCE(e.goal_id, e.enemy_id), e.flags, e.ideal_yaw FROM ents e WHERE e.id = :eid INTO goal, flags, iy;
  iy = COALESCE(iy_in, iy);
  IF (BIN_AND(flags, 512 + 1 + 2) = 0) THEN EXIT;              -- in the air
  IF (goal IS NULL) THEN EXIT;
  SELECT 1 FROM ents e CROSS JOIN ents g WHERE e.id = :eid AND g.id = :goal
     AND g.x + g.minx <= e.x + e.maxx + :dist AND g.x + g.maxx >= e.x + e.minx - :dist
     AND g.y + g.miny <= e.y + e.maxy + :dist AND g.y + g.maxy >= e.y + e.miny - :dist
     AND g.z + g.minz <= e.z + e.maxz + :dist AND g.z + g.maxz >= e.z + e.minz - :dist INTO close_;
  IF (close_ = 1 AND EXISTS (SELECT 1 FROM ents e WHERE e.id = :eid AND e.enemy_id = :goal)) THEN EXIT;
  IF (FLOOR(RAND() * 4) = 1 OR step_direction(eid, iy, dist) = 0) THEN
    EXECUTE PROCEDURE new_chase_dir(eid, goal, dist, iy, gx, gy);
END^

-- FindTarget: can this monster see the player?
CREATE OR ALTER FUNCTION find_target (eid INTEGER) RETURNS SMALLINT
AS
DECLARE pe INTEGER; DECLARE r INTEGER; DECLARE sh DOUBLE PRECISION; DECLARE php INTEGER; DECLARE pflags INTEGER;
BEGIN
  pe = player_ent();
  SELECT p.show_hostile FROM player p WHERE p.id = 1 INTO sh;
  SELECT e.health, e.flags FROM ents e WHERE e.id = :pe INTO php, pflags;
  IF (php <= 0 OR BIN_AND(pflags, 64) <> 0) THEN RETURN 0;    -- dead, or notarget
  r = ent_range(eid, pe);
  IF (r = 3) THEN RETURN 0;
  IF (visible(eid, pe) = 0) THEN RETURN 0;
  IF (r = 1) THEN BEGIN IF (sh < now_() AND infront(eid, pe) = 0) THEN RETURN 0; END
  ELSE IF (r = 2) THEN BEGIN IF (infront(eid, pe) = 0) THEN RETURN 0; END
  RETURN 1;
END^

-- FoundTarget / HuntTarget
CREATE OR ALTER PROCEDURE found_target (eid INTEGER)
AS
DECLARE s VARCHAR(64); DECLARE run_ VARCHAR(16); DECLARE ct VARCHAR(40); DECLARE cp INTEGER;
BEGIN
  SELECT t.sight_snd, t.run_anim, e.combattarget FROM ents e JOIN monster_types t ON t.name = e.mtype WHERE e.id = :eid INTO s, run_, ct;
  EXECUTE PROCEDURE snd(eid, 2, s, 1, 1);
  -- FoundTarget: the sighting is noted (last_sighting, trail_time), the pursuit flags start afresh
  UPDATE ents e SET e.enemy_id = player_ent(), e.goal_id = NULL, e.st = 'run', e.search_time = now_() + 5, e.attack_finished = now_() + 1,
         e.ls_x = (SELECT p.x FROM ents p WHERE p.id = e.enemy_id), e.ls_y = (SELECT p.y FROM ents p WHERE p.id = e.enemy_id),
         e.ls_z = (SELECT p.z FROM ents p WHERE p.id = e.enemy_id), e.trail_time = now_(), e.aiflags = BIN_AND(e.aiflags, BIN_NOT(16 + 32 + 64 + 128)) WHERE e.id = :eid;
  EXECUTE PROCEDURE set_anim(eid, run_);
  -- FoundTarget: with a combattarget, run to that point_combat first, ignoring the enemy (a one-shot deal:
  -- the combattarget is cleared, and the point's targetname too, since that point is ours)
  IF (ct IS NOT NULL AND ct <> '') THEN
  BEGIN
    SELECT FIRST 1 p.id FROM ents p WHERE p.targetname = :ct INTO cp;
    UPDATE ents e SET e.combattarget = NULL, e.goal_id = :cp, e.aiflags = IIF(:cp IS NULL, e.aiflags, BIN_OR(e.aiflags, 2)) WHERE e.id = :eid;
    UPDATE ents p SET p.targetname = NULL WHERE p.id = :cp;
  END
END^

-- monster_use / trigger_spawn: a sleeping or spawn-triggered monster wakes up
CREATE OR ALTER PROCEDURE monster_wake (eid INTEGER, activator INTEGER)
AS
DECLARE st VARCHAR(12); DECLARE mflags INTEGER;
BEGIN
  SELECT e.st, e.flags FROM ents e WHERE e.id = :eid INTO st, mflags;
  IF (st = 'asleep') THEN
  BEGIN
    -- appear: solid again, drop to the floor, and come looking
    UPDATE ents e SET e.solid = 3, e.alpha = 0, e.takedamage = 2, e.st = 'stand', e.think = 'monster_think', e.nextthink = now_() + 0.1e0 WHERE e.id = :eid;
    IF (BIN_AND(mflags, 3) = 0) THEN EXECUTE PROCEDURE drop_to_floor(eid); ELSE EXECUTE PROCEDURE link_ent(eid);
    EXECUTE PROCEDURE fx(5, (SELECT e.x FROM ents e WHERE e.id = :eid), (SELECT e.y FROM ents e WHERE e.id = :eid), (SELECT e.z FROM ents e WHERE e.id = :eid), 0, 0, 0, 0);
    st = 'stand';
  END
  IF (st IN ('stand', 'walk') AND EXISTS (SELECT 1 FROM ents e WHERE e.id = :eid AND e.health > 0)) THEN
  BEGIN
    UPDATE ents e SET e.enemy_id = player_ent(), e.st = 'run', e.anim = NULL WHERE e.id = :eid;
  END
END^

-- p_trail.c: PlayerTrail_PickFirst (first = 1) and PlayerTrail_PickNext: the oldest marker dropped after the
-- monster's trail_time (all older: round to the oldest, as the ring did); PickFirst takes the one before it
-- instead when only that one is in sight. Nothing while the trail is empty.
CREATE OR ALTER PROCEDURE trail_pick (eid INTEGER, first SMALLINT, tt DOUBLE PRECISION)
RETURNS (x DOUBLE PRECISION, y DOUBLE PRECISION, z DOUBLE PRECISION, yaw DOUBLE PRECISION, ts DOUBLE PRECISION)
AS
DECLARE sq INTEGER; DECLARE px DOUBLE PRECISION; DECLARE py DOUBLE PRECISION; DECLARE pz DOUBLE PRECISION;
DECLARE pyaw DOUBLE PRECISION; DECLARE pts DOUBLE PRECISION;
BEGIN
  SELECT FIRST 1 m.seq, m.x, m.y, m.z, m.yaw, m.ts FROM player_trail m WHERE m.ts > :tt ORDER BY m.seq INTO sq, x, y, z, yaw, ts;
  IF (sq IS NULL) THEN SELECT FIRST 1 m.seq, m.x, m.y, m.z, m.yaw, m.ts FROM player_trail m ORDER BY m.seq INTO sq, x, y, z, yaw, ts;
  IF (sq IS NULL) THEN EXIT;
  IF (first = 1 AND visible_point(eid, x, y, z) = 0) THEN
  BEGIN
    SELECT FIRST 1 m.x, m.y, m.z, m.yaw, m.ts FROM player_trail m WHERE m.seq < :sq ORDER BY m.seq DESC INTO px, py, pz, pyaw, pts;
    IF (px IS NULL) THEN SELECT FIRST 1 m.x, m.y, m.z, m.yaw, m.ts FROM player_trail m ORDER BY m.seq DESC INTO px, py, pz, pyaw, pts;
    IF (visible_point(eid, px, py, pz) = 1) THEN BEGIN x = px; y = py; z = pz; yaw = pyaw; ts = pts; END
  END
  SUSPEND;
END^

-- PlayerTrail_Add: a marker where the player was, turned from the last marker toward it; eight kept
CREATE OR ALTER PROCEDURE trail_add (x DOUBLE PRECISION, y DOUBLE PRECISION, z DOUBLE PRECISION)
AS
DECLARE sq INTEGER; DECLARE lx DOUBLE PRECISION; DECLARE ly DOUBLE PRECISION;
BEGIN
  SELECT FIRST 1 m.seq, m.x, m.y FROM player_trail m ORDER BY m.seq DESC INTO sq, lx, ly;
  sq = COALESCE(sq, 0) + 1;
  INSERT INTO player_trail (seq, x, y, z, yaw, ts) VALUES (:sq, :x, :y, :z, IIF(:lx IS NULL, 0, vectoyaw(:x - :lx, :y - :ly)), now_());
  DELETE FROM player_trail m WHERE m.seq <= :sq - 8;
END^

-- ClientBeginServerFrame's trail: a spot is dropped where the player was when the last marker is out of its
-- sight. (Asked at 10 Hz, the server's rate, and only when the player has moved since it was last asked.)
CREATE OR ALTER PROCEDURE player_trail_check
AS
DECLARE pe INTEGER; DECLARE x DOUBLE PRECISION; DECLARE y DOUBLE PRECISION; DECLARE z DOUBLE PRECISION;
DECLARE ox DOUBLE PRECISION; DECLARE oy DOUBLE PRECISION; DECLARE oz DOUBLE PRECISION;
DECLARE mx DOUBLE PRECISION; DECLARE my DOUBLE PRECISION; DECLARE mz DOUBLE PRECISION;
BEGIN
  SELECT p.ent_id, e.x, e.y, e.z, p.trail_x, p.trail_y, p.trail_z FROM player p JOIN ents e ON e.id = p.ent_id WHERE p.id = 1 INTO pe, x, y, z, ox, oy, oz;
  IF (pe IS NULL OR (x = ox AND y = oy AND z = oz)) THEN EXIT;
  SELECT FIRST 1 m.x, m.y, m.z FROM player_trail m ORDER BY m.seq DESC INTO mx, my, mz;
  IF (mx IS NULL OR visible_point(pe, mx, my, mz) = 0) THEN
    EXECUTE PROCEDURE trail_add(IIF(ox > 1e29, x, ox), IIF(ox > 1e29, y, oy), IIF(ox > 1e29, z, oz));
  UPDATE player p SET p.trail_x = :x, p.trail_y = :y, p.trail_z = :z WHERE p.id = 1;
END^

-- ai_run with the enemy out of sight: where to head (gx, gy), facing iy, this far. Run to where it was last seen,
-- then along the player's trail marker by marker (AI_LOST_SIGHT, AI_PURSUIT_LAST_SEEN, AI_PURSUE_NEXT), five
-- more seconds of search for each marker reached; twenty seconds past the search, straight at the enemy. A new
-- target that the monster's box cannot reach straight is detoured: a spot 16 units to one side, part of the way,
-- whichever side goes further (AI_PURSUE_TEMP), the real target kept in saved_goal until the spot is reached.
CREATE OR ALTER PROCEDURE ai_pursue (eid INTEGER, dist_in DOUBLE PRECISION)
RETURNS (gx DOUBLE PRECISION, gy DOUBLE PRECISION, iy DOUBLE PRECISION, dist DOUBLE PRECISION)
AS
DECLARE aif INTEGER; DECLARE st_ DOUBLE PRECISION; DECLARE lx DOUBLE PRECISION; DECLARE ly DOUBLE PRECISION; DECLARE lz DOUBLE PRECISION;
DECLARE tt DOUBLE PRECISION; DECLARE x DOUBLE PRECISION; DECLARE y DOUBLE PRECISION; DECLARE z DOUBLE PRECISION; DECLARE t DOUBLE PRECISION;
DECLARE ex DOUBLE PRECISION; DECLARE ey DOUBLE PRECISION; DECLARE ez DOUBLE PRECISION; DECLARE d1 DOUBLE PRECISION; DECLARE turned SMALLINT = 0;
DECLARE mx DOUBLE PRECISION; DECLARE my DOUBLE PRECISION; DECLARE mz DOUBLE PRECISION; DECLARE myaw DOUBLE PRECISION; DECLARE mts DOUBLE PRECISION;
DECLARE new_ SMALLINT = 0; DECLARE sgx DOUBLE PRECISION; DECLARE sgy DOUBLE PRECISION; DECLARE sgz DOUBLE PRECISION;
DECLARE mnx DOUBLE PRECISION; DECLARE mny DOUBLE PRECISION; DECLARE mnz DOUBLE PRECISION; DECLARE mxx DOUBLE PRECISION; DECLARE mxy DOUBLE PRECISION; DECLARE mxz DOUBLE PRECISION;
DECLARE f DOUBLE PRECISION; DECLARE fl DOUBLE PRECISION; DECLARE fr DOUBLE PRECISION; DECLARE center DOUBLE PRECISION; DECLARE d2 DOUBLE PRECISION;
DECLARE fx_ DOUBLE PRECISION; DECLARE fy DOUBLE PRECISION; DECLARE rx DOUBLE PRECISION; DECLARE ry DOUBLE PRECISION;
DECLARE hx DOUBLE PRECISION; DECLARE hy DOUBLE PRECISION; DECLARE hz DOUBLE PRECISION; DECLARE nx DOUBLE PRECISION; DECLARE ny DOUBLE PRECISION; DECLARE nz DOUBLE PRECISION;
DECLARE sf INTEGER; DECLARE ct INTEGER; DECLARE als SMALLINT; DECLARE sts SMALLINT; DECLARE hit INTEGER;
BEGIN
  t = now_(); dist = dist_in;
  SELECT e.aiflags, e.search_time, e.ls_x, e.ls_y, e.ls_z, e.trail_time, e.x, e.y, e.z, e.ideal_yaw, n.x, n.y, n.z,
         e.sg_x, e.sg_y, e.sg_z, e.minx, e.miny, e.minz, e.maxx, e.maxy, e.maxz
    FROM ents e JOIN ents n ON n.id = e.enemy_id WHERE e.id = :eid
    INTO aif, st_, lx, ly, lz, tt, x, y, z, iy, ex, ey, ez, sgx, sgy, sgz, mnx, mny, mnz, mxx, mxy, mxz;
  IF (x IS NULL) THEN EXIT;
  IF (lx IS NULL) THEN BEGIN lx = ex; ly = ey; lz = ez; END       -- never sighted (woken by a trigger): where the enemy is
  IF (st_ > 0 AND t > st_ + 20) THEN
  BEGIN
    UPDATE ents e SET e.search_time = 0 WHERE e.id = :eid;
    gx = ex; gy = ey; iy = vectoyaw(ex - x, ey - y);
    SUSPEND;
    EXIT;
  END
  IF (BIN_AND(aif, 16) = 0) THEN BEGIN aif = BIN_AND(BIN_OR(aif, 16 + 32), BIN_NOT(64 + 128)); new_ = 1; END   -- just lost sight
  IF (BIN_AND(aif, 64) <> 0) THEN
  BEGIN
    aif = BIN_AND(aif, BIN_NOT(64));
    st_ = t + 5;                                                    -- more time, since we got this far
    IF (BIN_AND(aif, 128) <> 0) THEN
    BEGIN
      -- the detour's spot reached: on to the target it stood in for
      aif = BIN_AND(aif, BIN_NOT(128));
      lx = sgx; ly = sgy; lz = sgz; new_ = 1;
    END
    ELSE
    BEGIN
      SELECT p.x, p.y, p.z, p.yaw, p.ts FROM trail_pick(:eid, IIF(BIN_AND(:aif, 32) <> 0, 1, 0), :tt) p INTO mx, my, mz, myaw, mts;
      aif = BIN_AND(aif, BIN_NOT(32));
      IF (mx IS NOT NULL) THEN BEGIN lx = mx; ly = my; lz = mz; tt = mts; iy = myaw; turned = 1; new_ = 1; END
    END
  END
  d1 = vlen(x - lx, y - ly, z - lz);
  IF (d1 <= dist) THEN BEGIN aif = BIN_OR(aif, 64); dist = d1; END
  IF (new_ = 1 AND d1 > 0) THEN
  BEGIN
    -- can the box go straight there (MASK_PLAYERSOLID)? if not, try a spot to each side
    EXECUTE PROCEDURE trace_move(eid, mnx, mny, mnz, mxx, mxy, mxz, x, y, z, lx, ly, lz, 33619971)
      RETURNING_VALUES f, hx, hy, hz, nx, ny, nz, sf, ct, als, sts, hit;
    IF (f < 1) THEN
    BEGIN
      center = f;
      d2 = d1 * ((center + 1) / 2);
      iy = vectoyaw(lx - x, ly - y); turned = 1;
      fx_ = COS(iy * 0.0174532925e0); fy = SIN(iy * 0.0174532925e0); rx = fy; ry = -fx_;
      EXECUTE PROCEDURE trace_move(eid, mnx, mny, mnz, mxx, mxy, mxz, x, y, z, x + fx_ * d2 - rx * 16, y + fy * d2 - ry * 16, z, 33619971)
        RETURNING_VALUES fl, hx, hy, hz, nx, ny, nz, sf, ct, als, sts, hit;
      EXECUTE PROCEDURE trace_move(eid, mnx, mny, mnz, mxx, mxy, mxz, x, y, z, x + fx_ * d2 + rx * 16, y + fy * d2 + ry * 16, z, 33619971)
        RETURNING_VALUES fr, hx, hy, hz, nx, ny, nz, sf, ct, als, sts, hit;
      center = (d1 * center) / d2;
      IF ((fl >= center AND fl > fr) OR (fr >= center AND fr > fl)) THEN
      BEGIN
        -- the side that goes further; short of a full step, half way along what it allows
        f = IIF(fl > fr, fl, fr);
        d2 = IIF(f < 1, d2 * f * 0.5e0, d2);
        sgx = lx; sgy = ly; sgz = lz;
        aif = BIN_OR(aif, 128);
        IF (fl > fr) THEN BEGIN lx = x + fx_ * d2 - rx * 16; ly = y + fy * d2 - ry * 16; END
        ELSE BEGIN lx = x + fx_ * d2 + rx * 16; ly = y + fy * d2 + ry * 16; END
        lz = z;
        iy = vectoyaw(lx - x, ly - y);
      END
    END
  END
  UPDATE ents e SET e.aiflags = :aif, e.search_time = :st_, e.ls_x = :lx, e.ls_y = :ly, e.ls_z = :lz, e.trail_time = :tt,
         e.sg_x = :sgx, e.sg_y = :sgy, e.sg_z = :sgz, e.ideal_yaw = :iy, e.yaw = IIF(:turned = 1, :iy, e.yaw) WHERE e.id = :eid;
  gx = lx; gy = ly;
  SUSPEND;
END^

-- ai_checkattack + CheckAttack (M_CheckAttack): is the enemy in sight (visible(): only walls hide it), and if
-- so, melee, missile or keep running. 1: attack; 0: in sight, no attack; 2: out of sight. In sight, the
-- sighting is noted as ai_checkattack and ai_run noted it (search_time five seconds on, last_sighting, trail_time,
-- AI_LOST_SIGHT cleared), in the one write with the attack state.
CREATE OR ALTER FUNCTION check_attack (eid INTEGER) RETURNS SMALLINT
AS
DECLARE enemy INTEGER; DECLARE r INTEGER; DECLARE has_melee SMALLINT; DECLARE has_missile SMALLINT; DECLARE af DOUBLE PRECISION;
DECLARE chance DOUBLE PRECISION; DECLARE mk VARCHAR(16); DECLARE ac DOUBLE PRECISION; DECLARE mrange DOUBLE PRECISION;
DECLARE x1 DOUBLE PRECISION; DECLARE y1 DOUBLE PRECISION; DECLARE z1 DOUBLE PRECISION; DECLARE x2 DOUBLE PRECISION; DECLARE y2 DOUBLE PRECISION; DECLARE z2 DOUBLE PRECISION;
DECLARE f DOUBLE PRECISION; DECLARE ex DOUBLE PRECISION; DECLARE ey DOUBLE PRECISION; DECLARE ez DOUBLE PRECISION;
DECLARE nx DOUBLE PRECISION; DECLARE ny DOUBLE PRECISION; DECLARE nz DOUBLE PRECISION;
DECLARE sf INTEGER; DECLARE ct INTEGER; DECLARE als SMALLINT; DECLARE sts SMALLINT; DECLARE hit INTEGER; DECLARE d DOUBLE PRECISION;
DECLARE vis SMALLINT; DECLARE res SMALLINT = 0; DECLARE nas SMALLINT; DECLARE naf DOUBLE PRECISION; DECLARE t DOUBLE PRECISION; DECLARE oz DOUBLE PRECISION;
DECLARE fl INTEGER;
BEGIN
  SELECT e.enemy_id, IIF(t.melee_anim IS NULL, 0, 1), IIF(t.missile_anim IS NULL, 0, 1), e.attack_finished, t.missile_kind, t.attack_chance, t.melee_range, e.flags
    FROM ents e JOIN monster_types t ON t.name = e.mtype WHERE e.id = :eid INTO enemy, has_melee, has_missile, af, mk, ac, mrange, fl;
  IF (enemy IS NULL) THEN RETURN 0;
  t = now_();
  -- see if any entities are in the way of the shot
  SELECT e.x, e.y, e.z + e.viewheight FROM ents e WHERE e.id = :eid INTO x1, y1, z1;
  SELECT e.x, e.y, e.z + e.viewheight, e.z FROM ents e WHERE e.id = :enemy INTO x2, y2, z2, oz;
  EXECUTE PROCEDURE trace_move(eid, 0, 0, 0, 0, 0, 0, x1, y1, z1, x2, y2, z2, 100663299)
    RETURNING_VALUES f, ex, ey, ez, nx, ny, nz, sf, ct, als, sts, hit;
  -- a wall in the way hides the enemy too; a monster or a window only spoils the shot (one more trace says)
  vis = 1;
  IF (f < 1 AND hit IS DISTINCT FROM enemy) THEN
  BEGIN
    IF (COALESCE(hit, 0) = 0 AND BIN_AND(ct, 1) <> 0) THEN vis = 0;
    ELSE vis = visible(eid, enemy);
  END
  IF (vis = 0) THEN RETURN 2;
  IF (f = 1 OR hit = enemy) THEN                                -- a clear shot
  BEGIN
    r = ent_range(eid, enemy);
    d = vlen(x2 - x1, y2 - y1, 0);
    IF (has_melee = 1 AND d <= mrange) THEN BEGIN nas = 3; res = 1; END
    ELSE IF (has_missile = 1 AND t >= af AND r <> 3) THEN
    BEGIN
      IF (r = 0) THEN chance = IIF(has_melee = 1, 0, 0.4e0);
      ELSE IF (r = 1) THEN chance = IIF(has_melee = 1, 0.2e0, 0.4e0);
      ELSE IF (r = 2) THEN chance = IIF(has_melee = 1, 0.05e0, 0.1e0);
      ELSE chance = 0;
      chance = chance * ac / 0.3e0;
      IF (RAND() < chance) THEN BEGIN nas = 4; naf = t + 2 * RAND(); res = 1; END
      -- no missile this time: a flyer slides around its enemy three times in ten (AS_SLIDING), else comes straight
      ELSE IF (BIN_AND(fl, 1) <> 0) THEN nas = IIF(RAND() < 0.3e0, 2, 1);
    END
  END
  UPDATE ents e SET e.search_time = :t + 5, e.ls_x = :x2, e.ls_y = :y2, e.ls_z = :oz, e.trail_time = :t, e.aiflags = BIN_AND(e.aiflags, BIN_NOT(16)),
         e.attack_state = COALESCE(:nas, e.attack_state), e.attack_finished = COALESCE(:naf, e.attack_finished) WHERE e.id = :eid;
  RETURN res;
END^

-- a monster's missile at the frame that fires (monster_fire_*)
CREATE OR ALTER PROCEDURE monster_missile (eid INTEGER)
AS
DECLARE mk VARCHAR(16); DECLARE enemy INTEGER; DECLARE asnd VARCHAR(64);
DECLARE x1 DOUBLE PRECISION; DECLARE y1 DOUBLE PRECISION; DECLARE z1 DOUBLE PRECISION; DECLARE yaw DOUBLE PRECISION; DECLARE vh DOUBLE PRECISION;
DECLARE x2 DOUBLE PRECISION; DECLARE y2 DOUBLE PRECISION; DECLARE z2 DOUBLE PRECISION;
DECLARE dx DOUBLE PRECISION; DECLARE dy DOUBLE PRECISION; DECLARE dz DOUBLE PRECISION; DECLARE dl DOUBLE PRECISION;
DECLARE sx DOUBLE PRECISION; DECLARE sy DOUBLE PRECISION; DECLARE sz DOUBLE PRECISION; DECLARE af INTEGER;
BEGIN
  SELECT t.missile_kind, e.enemy_id, t.attack_snd, e.x, e.y, e.z, e.yaw, e.viewheight, e.anim_frame FROM ents e JOIN monster_types t ON t.name = e.mtype WHERE e.id = :eid
    INTO mk, enemy, asnd, x1, y1, z1, yaw, vh, af;
  IF (enemy IS NULL) THEN EXIT;
  SELECT e.x, e.y, e.z + e.viewheight FROM ents e WHERE e.id = :enemy INTO x2, y2, z2;
  IF (x2 IS NULL) THEN EXIT;
  -- the muzzle: ahead and to the right of the eye
  sx = x1 + COS(yaw * 0.0174532925e0) * 20 + SIN(yaw * 0.0174532925e0) * 8; sy = y1 + SIN(yaw * 0.0174532925e0) * 20 - COS(yaw * 0.0174532925e0) * 8; sz = z1 + vh - 4;
  dx = x2 - sx; dy = y2 - sy; dz = z2 - sz; dl = vlen(dx, dy, dz);
  IF (dl = 0) THEN EXIT;
  -- the muzzle flash (MZ2_*): CL_ParseMuzzleFlash2 lit 200 + 0..31 units at the flash for a frame
  EXECUTE PROCEDURE fx(15, sx, sy, sz, 0, 0, 0, 200 + CAST(FLOOR(RAND() * 32) AS INTEGER));
  IF (mk = 'blaster') THEN
  BEGIN
    EXECUTE PROCEDURE snd(eid, 1, asnd, 1, 1);
    EXECUTE PROCEDURE launch_bolt(eid, sx, sy, sz, dx, dy, dz, 600, 5, 8);
  END
  ELSE IF (mk = 'blaster1') THEN
  BEGIN
    IF (af = 5) THEN EXECUTE PROCEDURE snd(eid, 1, asnd, 1, 1);
    EXECUTE PROCEDURE launch_bolt(eid, sx, sy, sz, dx, dy, dz, 1000, 1, 8);
  END
  ELSE IF (mk = 'shotgun') THEN
  BEGIN
    EXECUTE PROCEDURE snd(eid, 1, asnd, 1, 1);
    EXECUTE PROCEDURE fire_bullets(eid, 12, sx, sy, sz, dx, dy, dz, 500, 500, 2, 1);
  END
  ELSE IF (mk = 'machinegun') THEN
  BEGIN
    EXECUTE PROCEDURE snd(eid, 1, asnd, 1, 1);
    EXECUTE PROCEDURE fire_bullets(eid, 1, sx, sy, sz, dx, dy, dz, 300, 500, IIF((SELECT e.mtype FROM ents e WHERE e.id = :eid) = 'soldier_ss', 2, 3), 4);
  END
  ELSE IF (mk = 'grenade') THEN
  BEGIN
    EXECUTE PROCEDURE snd(eid, 1, 'gunner/gunatck3.wav', 1, 1);
    EXECUTE PROCEDURE launch_grenade(eid, sx, sy, sz, dx / dl * 600, dy / dl * 600, dz / dl * 600 + 200, 50, 90, 2.5e0, 0);
  END
  ELSE IF (mk = 'rocket') THEN
  BEGIN
    EXECUTE PROCEDURE snd(eid, 1, asnd, 1, 1);
    EXECUTE PROCEDURE launch_rocket(eid, sx, sy, sz + 20, dx, dy, dz - 20, 550, 50, 50, 70);
  END
END^

-- GunnerGrenade: a grenade along the gunner's facing (monster_fire_grenade: 50 damage over 90 units, 600 units a
-- second, 200 up and up to 10 aside, fire_grenade's 2.5 s fuse), from MZ2_GUNNER_GRENADE_1's muzzle
CREATE OR ALTER PROCEDURE gunner_grenade (eid INTEGER)
AS
DECLARE x DOUBLE PRECISION; DECLARE y DOUBLE PRECISION; DECLARE z DOUBLE PRECISION; DECLARE yaw DOUBLE PRECISION; DECLARE vh DOUBLE PRECISION;
DECLARE fx_ DOUBLE PRECISION; DECLARE fy DOUBLE PRECISION; DECLARE sx DOUBLE PRECISION; DECLARE sy DOUBLE PRECISION; DECLARE sz DOUBLE PRECISION;
DECLARE side DOUBLE PRECISION;
BEGIN
  SELECT e.x, e.y, e.z, e.yaw, e.viewheight FROM ents e WHERE e.id = :eid INTO x, y, z, yaw, vh;
  IF (x IS NULL) THEN EXIT;
  fx_ = COS(yaw * 0.0174532925e0); fy = SIN(yaw * 0.0174532925e0);
  sx = x + fx_ * 20 + fy * 8; sy = y + fy * 20 - fx_ * 8; sz = z + vh - 4;
  side = crand() * 10;
  EXECUTE PROCEDURE fx(15, sx, sy, sz, 0, 0, 0, 200 + CAST(FLOOR(RAND() * 32) AS INTEGER));
  EXECUTE PROCEDURE snd(eid, 1, 'gunner/gunatck3.wav', 1, 1);
  EXECUTE PROCEDURE launch_grenade(eid, sx, sy, sz, fx_ * 600 + fy * :side, fy * 600 - fx_ * :side, 200 + crand() * 10, 50, 90, 2.5e0, 0);
END^

-- parasite_drain_attack and its frames (m_parasite.c), af the drain frame: the launch sound at the first, the
-- tongue from 24 ahead and 6 up of the origin to the enemy at the third to the thirteenth (5 damage and the impact
-- sound at the third, 2 and the sucking sound at the fourth, 2 after), no knockback; parasite_drain_attack_ok: not
-- past 256 units nor steeper than 30 degrees, tried at the enemy's origin, top and bottom; then the trace must
-- reach the enemy. The tongue is TE_PARASITE_ATTACK (fx 16, n the parasite). The reel-in sound at the fourteenth.
CREATE OR ALTER PROCEDURE parasite_drain (eid INTEGER, af INTEGER)
AS
DECLARE enemy INTEGER; DECLARE x DOUBLE PRECISION; DECLARE y DOUBLE PRECISION; DECLARE z DOUBLE PRECISION; DECLARE yaw DOUBLE PRECISION;
DECLARE sx DOUBLE PRECISION; DECLARE sy DOUBLE PRECISION; DECLARE sz DOUBLE PRECISION;
DECLARE ex DOUBLE PRECISION; DECLARE ey DOUBLE PRECISION; DECLARE ez DOUBLE PRECISION; DECLARE emn DOUBLE PRECISION; DECLARE emx DOUBLE PRECISION;
DECLARE ok SMALLINT; DECLARE k SMALLINT; DECLARE tz DOUBLE PRECISION; DECLARE dl DOUBLE PRECISION;
DECLARE f DOUBLE PRECISION; DECLARE hx DOUBLE PRECISION; DECLARE hy DOUBLE PRECISION; DECLARE hz DOUBLE PRECISION;
DECLARE nx DOUBLE PRECISION; DECLARE ny DOUBLE PRECISION; DECLARE nz DOUBLE PRECISION;
DECLARE sf INTEGER; DECLARE ct INTEGER; DECLARE als SMALLINT; DECLARE sts SMALLINT; DECLARE hit INTEGER;
BEGIN
  IF (af = 0) THEN BEGIN EXECUTE PROCEDURE snd(eid, 1, 'parasite/paratck1.wav', 1, 1); EXIT; END     -- parasite_launch
  IF (af = 13) THEN BEGIN EXECUTE PROCEDURE snd(eid, 1, 'parasite/paratck4.wav', 1, 1); EXIT; END    -- parasite_reel_in
  IF (af < 2 OR af > 12) THEN EXIT;
  SELECT e.enemy_id, e.x, e.y, e.z, e.yaw FROM ents e WHERE e.id = :eid INTO enemy, x, y, z, yaw;
  IF (enemy IS NULL) THEN EXIT;
  SELECT n.x, n.y, n.z, n.minz, n.maxz FROM ents n WHERE n.id = :enemy INTO ex, ey, ez, emn, emx;
  IF (ex IS NULL) THEN EXIT;
  sx = x + COS(yaw * 0.0174532925e0) * 24; sy = y + SIN(yaw * 0.0174532925e0) * 24; sz = z + 6;
  ok = 0; k = 0;
  WHILE (k < 3 AND ok = 0) DO
  BEGIN
    tz = CASE k WHEN 0 THEN ez WHEN 1 THEN ez + emx - 8 ELSE ez + emn + 8 END;
    dl = vlen(sx - ex, sy - ey, sz - tz);
    IF (dl <= 256 AND ABS(ATAN2(sz - tz, vlen(sx - ex, sy - ey, 0))) * 57.29577951e0 <= 30) THEN ok = 1;
    k = k + 1;
  END
  IF (ok = 0) THEN EXIT;
  EXECUTE PROCEDURE trace_move(eid, 0, 0, 0, 0, 0, 0, sx, sy, sz, ex, ey, ez, 100663299)
    RETURNING_VALUES f, hx, hy, hz, nx, ny, nz, sf, ct, als, sts, hit;
  IF (f = 1 OR hit IS DISTINCT FROM enemy) THEN EXIT;
  IF (af = 2) THEN EXECUTE PROCEDURE snd(enemy, 0, 'parasite/paratck2.wav', 1, 1);
  ELSE IF (af = 3) THEN EXECUTE PROCEDURE snd(eid, 1, 'parasite/paratck3.wav', 1, 1);
  EXECUTE PROCEDURE fx(16, sx, sy, sz, ex, ey, ez, eid);
  EXECUTE PROCEDURE t_damage(enemy, eid, eid, IIF(af = 2, 5, 2), 0, 0);
END^

-- the melee hit at the frame that strikes (fire_hit)
CREATE OR ALTER PROCEDURE monster_melee (eid INTEGER)
AS
DECLARE enemy INTEGER; DECLARE d DOUBLE PRECISION; DECLARE dmg INTEGER; DECLARE ms VARCHAR(64); DECLARE mrange DOUBLE PRECISION; DECLARE mt VARCHAR(16);
BEGIN
  SELECT e.enemy_id, t.melee_dmg, t.melee_snd, t.melee_range, e.mtype FROM ents e JOIN monster_types t ON t.name = e.mtype WHERE e.id = :eid
    INTO enemy, dmg, ms, mrange, mt;
  IF (enemy IS NULL) THEN EXIT;
  SELECT vlen(a.x - b.x, a.y - b.y, a.z - b.z) FROM ents a CROSS JOIN ents b WHERE a.id = :eid AND b.id = :enemy INTO d;
  IF (d IS NULL OR d > mrange + 16) THEN EXIT;
  IF (ms IS NOT NULL) THEN EXECUTE PROCEDURE snd(eid, 1, ms, 1, 1);
  dmg = CAST(dmg * (0.7e0 + 0.6e0 * RAND()) AS INTEGER);
  EXECUTE PROCEDURE t_damage(enemy, eid, eid, dmg, IIF(mt = 'berserk', 400, 50), 0);
  EXECUTE PROCEDURE fx(3, (SELECT e.x FROM ents e WHERE e.id = :enemy), (SELECT e.y FROM ents e WHERE e.id = :enemy), (SELECT e.z + 10 FROM ents e WHERE e.id = :enemy), 0, 0, 0, dmg);
END^

-- pain
CREATE OR ALTER PROCEDURE monster_pain (eid INTEGER, attacker INTEGER, damage INTEGER)
AS
DECLARE st VARCHAR(12); DECLARE pf DOUBLE PRECISION; DECLARE pc DOUBLE PRECISION; DECLARE anims VARCHAR(80); DECLARE ps VARCHAR(64); DECLARE n INTEGER; DECLARE pick VARCHAR(16);
DECLARE p INTEGER; DECLARE q INTEGER; DECLARE i INTEGER; DECLARE mt VARCHAR(16); DECLARE hp INTEGER; DECLARE mhp INTEGER;
BEGIN
  EXECUTE PROCEDURE monster_duck_up(eid);
  SELECT e.st, e.pain_finished, t.pain_chance, t.pain_anims, t.pain_snd, e.mtype, e.health, e.max_health FROM ents e JOIN monster_types t ON t.name = e.mtype WHERE e.id = :eid
    INTO st, pf, pc, anims, ps, mt, hp, mhp;
  IF (st IN ('die', 'dead', 'asleep')) THEN EXIT;
  -- the pain skin below half health
  IF (hp < mhp / 2) THEN UPDATE ents e SET e.skin = BIN_OR(e.skin, 1) WHERE e.id = :eid;
  IF (pf > now_()) THEN EXIT;
  UPDATE ents e SET e.pain_finished = now_() + 3 WHERE e.id = :eid;
  IF (RAND() > pc) THEN EXIT;
  EXECUTE PROCEDURE snd(eid, 2, ps, 1, 1);
  n = 1; p = 1;
  WHILE (POSITION(',', anims, p) > 0) DO BEGIN n = n + 1; p = POSITION(',', anims, p) + 1; END
  i = FLOOR(RAND() * n); p = 1;
  WHILE (i > 0) DO BEGIN p = POSITION(',', anims, p) + 1; i = i - 1; END
  q = POSITION(',', anims, p);
  pick = IIF(q = 0, SUBSTRING(anims FROM p), SUBSTRING(anims FROM p FOR q - p));
  UPDATE ents e SET e.st = 'pain', e.vx = 0, e.vy = 0 WHERE e.id = :eid;
  EXECUTE PROCEDURE set_anim(eid, pick);
END^

-- die
CREATE OR ALTER PROCEDURE monster_die (eid INTEGER, attacker INTEGER)
AS
DECLARE hp INTEGER; DECLARE gh INTEGER; DECLARE ds VARCHAR(64); DECLARE anims VARCHAR(80); DECLARE drop_ VARCHAR(40);
DECLARE pick VARCHAR(16); DECLARE q INTEGER; DECLARE n INTEGER; DECLARE i INTEGER; DECLARE p INTEGER; DECLARE mt VARCHAR(16); DECLARE st VARCHAR(12); DECLARE bp INTEGER;
DECLARE x DOUBLE PRECISION; DECLARE y DOUBLE PRECISION; DECLARE z DOUBLE PRECISION; DECLARE dt VARCHAR(40); DECLARE mdl VARCHAR(64);
BEGIN
  EXECUTE PROCEDURE monster_duck_up(eid);
  SELECT e.health, e.gib_health, t.death_snd, t.death_anims, COALESCE(e.item, t.drop_item), e.mtype, e.st, e.x, e.y, e.z, e.deathtarget
    FROM ents e JOIN monster_types t ON t.name = e.mtype WHERE e.id = :eid INTO hp, gh, ds, anims, drop_, mt, st, x, y, z, dt;
  IF (st IN ('die', 'dead')) THEN
  BEGIN
    -- gibbing a corpse
    IF (hp < gh) THEN
    BEGIN
      EXECUTE PROCEDURE gib_ent(eid, -hp);
      DELETE FROM ents e WHERE e.id = :eid;
    END
    EXIT;
  END
  UPDATE game g SET g.killed = g.killed + 1 WHERE g.id = 1;
  IF (attacker = player_ent()) THEN UPDATE player p SET p.kills = p.kills + 1 WHERE p.id = 1;
  -- monster_death_use: the deathtarget and the drop
  IF (dt IS NOT NULL AND dt <> '') THEN
  BEGIN
    UPDATE ents e SET e.target = :dt WHERE e.id = :eid;
    EXECUTE PROCEDURE use_targets(eid, player_ent());
  END
  IF (drop_ IS NOT NULL AND item_model(drop_) IS NOT NULL) THEN
  BEGIN
    EXECUTE PROCEDURE spawn_ent(drop_, x, y, z) RETURNING_VALUES bp;
    EXECUTE PROCEDURE set_model(bp, item_model(drop_));
    UPDATE ents e SET e.solid = 1, e.movetype = 6, e.clipmask = 3, e.effects = 1, e.minx = -15, e.miny = -15, e.minz = -15, e.maxx = 15, e.maxy = 15, e.maxz = 15,
           e.vx = crand() * 100, e.vy = crand() * 100, e.vz = 300, e.think = 'remove', e.nextthink = now_() + 120 WHERE e.id = :bp;
    EXECUTE PROCEDURE link_ent(bp);
  END
  -- gib?
  IF (hp < gh) THEN
  BEGIN
    EXECUTE PROCEDURE gib_ent(eid, -hp);
    DELETE FROM ents e WHERE e.id = :eid;
    EXIT;
  END
  EXECUTE PROCEDURE snd(eid, 2, ds, 1, 1);
  -- one of the death animations
  n = 1; p = 1;
  WHILE (POSITION(',', anims, p) > 0) DO BEGIN n = n + 1; p = POSITION(',', anims, p) + 1; END
  i = FLOOR(RAND() * n); p = 1;
  WHILE (i > 0) DO BEGIN p = POSITION(',', anims, p) + 1; i = i - 1; END
  q = POSITION(',', anims, p);
  pick = IIF(q = 0, SUBSTRING(anims FROM p), SUBSTRING(anims FROM p FOR q - p));
  -- the corpse: a flat box, toss movetype, only shots clip against it
  UPDATE ents e SET e.st = 'die', e.movetype = 6, e.vx = 0, e.vy = 0, e.flags = BIN_AND(e.flags, BIN_NOT(1 + 2)), e.deadflag = 1,
         e.minz = -24, e.maxz = -8, e.takedamage = 1 WHERE e.id = :eid;
  EXECUTE PROCEDURE set_anim(eid, pick);
END^

-- the 10 Hz monster frame: the state machine of g_ai.c
CREATE OR ALTER PROCEDURE monster_think (eid INTEGER)
AS
DECLARE st VARCHAR(12); DECLARE anim VARCHAR(16); DECLARE af INTEGER; DECLARE mid INTEGER; DECLARE enemy INTEGER; DECLARE flags INTEGER;
DECLARE mt VARCHAR(16); DECLARE ehp INTEGER; DECLARE t DOUBLE PRECISION;
DECLARE ff INTEGER; DECLARE fc INTEGER; DECLARE atkst SMALLINT; DECLARE tgt VARCHAR(40); DECLARE goal INTEGER;
DECLARE run_spd DOUBLE PRECISION; DECLARE walk_spd DOUBLE PRECISION; DECLARE stand_a VARCHAR(16); DECLARE walk_a VARCHAR(16); DECLARE run_a VARCHAR(16);
DECLARE melee_a VARCHAR(16); DECLARE melee_f INTEGER; DECLARE missile_a VARCHAR(16); DECLARE missile_f VARCHAR(60); DECLARE idle_s VARCHAR(64); DECLARE search_s VARCHAR(64);
DECLARE x DOUBLE PRECISION; DECLARE y DOUBLE PRECISION; DECLARE z DOUBLE PRECISION; DECLARE gx DOUBLE PRECISION; DECLARE gy DOUBLE PRECISION; DECLARE gz DOUBLE PRECISION;
DECLARE d DOUBLE PRECISION; DECLARE gt VARCHAR(40); DECLARE gw DOUBLE PRECISION; DECLARE pvs VARCHAR(2048) CHARACTER SET ASCII; DECLARE cl INTEGER;
DECLARE nt DOUBLE PRECISION; DECLARE iy DOUBLE PRECISION; DECLARE pe INTEGER; DECLARE vis SMALLINT;
DECLARE aif INTEGER; DECLARE itime DOUBLE PRECISION; DECLARE sflags INTEGER; DECLARE ca SMALLINT; DECLARE lf SMALLINT;
BEGIN
  -- (an UPDATE of the wide ents row costs as much as a trace step: the next think time rides
  -- along with whatever else the think writes, and a path that writes nothing thinks again next tic)
  t = now_();
  nt = t + 0.1e0;
  SELECT e.st, e.anim, e.anim_frame, e.model_id, e.enemy_id, e.flags, e.mtype, e.attack_state, e.target, e.goal_id, e.x, e.y, e.z, e.cluster,
         e.aiflags, e.idle_time, e.spawnflags
    FROM ents e WHERE e.id = :eid INTO st, anim, af, mid, enemy, flags, mt, atkst, tgt, goal, x, y, z, cl, aif, itime, sflags;
  SELECT t.run_speed, t.walk_speed, t.stand_anim, t.walk_anim, t.run_anim, t.melee_anim, t.melee_frame, t.missile_anim, t.missile_frames, t.idle_snd, t.search_snd
    FROM monster_types t WHERE t.name = :mt INTO run_spd, walk_spd, stand_a, walk_a, run_a, melee_a, melee_f, missile_a, missile_f, idle_s, search_s;
  IF (st = 'dead' OR st = 'asleep') THEN
  BEGIN
    UPDATE ents e SET e.nextthink = NULL WHERE e.id = :eid;
    EXIT;
  END
  IF (anim IS NULL) THEN
  BEGIN
    EXECUTE PROCEDURE set_anim(eid, CASE st WHEN 'run' THEN run_a WHEN 'walk' THEN walk_a ELSE stand_a END);
    SELECT e.anim FROM ents e WHERE e.id = :eid INTO anim;
    af = 0;
  END
  SELECT a.first_frame, a.frame_count FROM anims a WHERE a.model_id = :mid AND a.anim = :anim INTO ff, fc;
  IF (ff IS NULL) THEN BEGIN ff = 0; fc = 12; END

  -- the enemy died?
  IF (enemy IS NOT NULL) THEN
  BEGIN
    SELECT e.health FROM ents e WHERE e.id = :enemy INTO ehp;
    IF (ehp IS NULL OR ehp <= 0) THEN
    BEGIN
      enemy = NULL;
      UPDATE ents e SET e.enemy_id = NULL, e.goal_id = IIF(BIN_AND(e.aiflags, 2) <> 0, NULL, e.goal_id), e.aiflags = BIN_AND(e.aiflags, BIN_NOT(3)) WHERE e.id = :eid;
      aif = BIN_AND(aif, BIN_NOT(3));
      IF (st IN ('run', 'melee', 'missile')) THEN
      BEGIN
        st = 'stand';
        UPDATE ents e SET e.st = 'stand', e.nextthink = :nt WHERE e.id = :eid;
        EXECUTE PROCEDURE set_anim(eid, stand_a);
        EXIT;
      END
    END
  END

  IF (st = 'stand' OR st = 'walk') THEN
  BEGIN
    -- ai_stand / ai_walk: look for the player (cheaply: only when in the player's PVS;
    -- out of it, nothing is seen either way, so think at 3 Hz)
    pe = player_ent();
    vis = 0;
    SELECT IIF(l.pvs = '' OR (:cl >= 0 AND BIN_AND(POSITION(SUBSTRING(l.pvs FROM BIN_SHR(:cl, 2) + 1 FOR 1), '0123456789abcdef') - 1, BIN_SHL(1, BIN_AND(:cl, 3))) <> 0), 1, 0)
      FROM leaves l JOIN ents p ON p.id = :pe WHERE l.id = p.leaf INTO vis;
    IF (vis = 0) THEN nt = t + IIF(st = 'walk', 0.4e0, 0.3e0);   -- a patrol out of sight strides four times as far at 2.5 Hz
    ELSE IF (MOD(af, 2) = 0 AND find_target(eid) = 1) THEN
    BEGIN
      EXECUTE PROCEDURE found_target(eid);
      EXIT;
    END
    IF (st = 'walk' AND tgt IS NOT NULL) THEN
    BEGIN
      -- follow the path_corner chain (out of the player's sight: at 3 Hz, striding thrice as far)
      IF (nt > t + 0.2e0) THEN walk_spd = walk_spd * 4;
      IF (goal IS NULL) THEN
      BEGIN
        SELECT FIRST 1 e.id FROM ents e WHERE e.targetname = :tgt AND e.classname = 'path_corner' INTO goal;
        UPDATE ents e SET e.goal_id = :goal WHERE e.id = :eid;
      END
      IF (goal IS NOT NULL) THEN
      BEGIN
        SELECT e.x, e.y, e.z, e.target, e.wait_ FROM ents e WHERE e.id = :goal INTO gx, gy, gz, gt, gw;
        IF (vlen(gx - x, gy - y, 0) < MAXVALUE(24, walk_spd)) THEN   -- SV_CloseEnough: within a stride of the corner
        BEGIN
          UPDATE ents e SET e.target = :gt, e.goal_id = NULL, e.ideal_yaw = vectoyaw(:gx - e.x, :gy - e.y) WHERE e.id = :eid;
          IF (gt IS NULL OR gw > 0) THEN
          BEGIN
            UPDATE ents e SET e.st = 'stand', e.search_time = :t + COALESCE(:gw, 0), e.nextthink = :nt WHERE e.id = :eid;
            EXECUTE PROCEDURE set_anim(eid, stand_a);
            EXIT;
          END
        END
        ELSE
        BEGIN
          EXECUTE PROCEDURE move_to_goal(eid, walk_spd, vectoyaw(gx - x, gy - y));
        END
      END
    END
    ELSE IF (st = 'stand' AND tgt IS NOT NULL AND (SELECT e.search_time FROM ents e WHERE e.id = :eid) < t AND EXISTS (SELECT 1 FROM ents c WHERE c.targetname = :tgt AND c.classname = 'path_corner')) THEN
    BEGIN
      UPDATE ents e SET e.st = 'walk', e.nextthink = :nt WHERE e.id = :eid;
      EXECUTE PROCEDURE set_anim(eid, walk_a);
      EXIT;
    END
    -- ai_stand's idle sound (not for an ambush monster) and ai_walk's search sound, every 15–30 seconds
    IF (t > itime) THEN
    BEGIN
      IF (itime > 0) THEN
      BEGIN
        IF (st = 'stand' AND BIN_AND(sflags, 1) = 0 AND idle_s IS NOT NULL) THEN EXECUTE PROCEDURE snd(eid, 2, idle_s, 1, 2);
        ELSE IF (st = 'walk' AND search_s IS NOT NULL) THEN EXECUTE PROCEDURE snd(eid, 2, search_s, 1, 1);
        UPDATE ents e SET e.idle_time = :t + 15 + RAND() * 15 WHERE e.id = :eid;
      END
      ELSE UPDATE ents e SET e.idle_time = :t + RAND() * 15 WHERE e.id = :eid;
    END
    af = af + 1;
    IF (af >= fc) THEN af = 0;
    UPDATE ents e SET e.anim_frame = :af, e.frame = :ff + :af, e.nextthink = :nt WHERE e.id = :eid;
    EXIT;
  END

  IF (st = 'run') THEN
  BEGIN
    IF (enemy IS NULL) THEN
    BEGIN
      UPDATE ents e SET e.st = 'stand', e.nextthink = :nt WHERE e.id = :eid;
      EXECUTE PROCEDURE set_anim(eid, stand_a);
      EXIT;
    END
    IF (BIN_AND(aif, 2) <> 0 AND goal IS NOT NULL) THEN
    BEGIN
      -- ai_run with AI_COMBAT_POINT: run for the point, ignoring the enemy; touch it on arrival (looked at
      -- before the step as well as after it: a fast runner's stride can carry it past the touch distance)
      IF (EXISTS (SELECT 1 FROM ents m JOIN ents c ON c.id = :goal WHERE m.id = :eid
                     AND c.x + c.minx <= m.x + m.maxx AND c.x + c.maxx >= m.x + m.minx
                     AND c.y + c.miny <= m.y + m.maxy AND c.y + c.maxy >= m.y + m.miny
                     AND c.z + c.minz <= m.z + m.maxz AND c.z + c.maxz >= m.z + m.minz)) THEN
        EXECUTE PROCEDURE point_combat_touch(goal, eid);
      ELSE
      BEGIN
        SELECT vectoyaw(c.x - :x, c.y - :y) FROM ents c WHERE c.id = :goal INTO iy;
        IF (run_spd > 0) THEN EXECUTE PROCEDURE move_to_goal(eid, run_spd, iy);
        IF (EXISTS (SELECT 1 FROM ents m JOIN ents c ON c.id = :goal WHERE m.id = :eid
                     AND c.x + c.minx <= m.x + m.maxx AND c.x + c.maxx >= m.x + m.minx
                     AND c.y + c.miny <= m.y + m.maxy AND c.y + c.maxy >= m.y + m.miny
                     AND c.z + c.minz <= m.z + m.maxz AND c.z + c.maxz >= m.z + m.minz)) THEN
          EXECUTE PROCEDURE point_combat_touch(goal, eid);
      END
      af = MOD(af + 1, fc);
      UPDATE ents e SET e.anim_frame = :af, e.frame = :ff + :af, e.nextthink = :nt WHERE e.id = :eid;
      EXIT;
    END
    IF (BIN_AND(aif, 1) <> 0) THEN
    BEGIN
      -- AI_STAND_GROUND (a point_combat held): face the enemy and fight from here
      UPDATE ents e SET e.ideal_yaw = (SELECT vectoyaw(n.x - :x, n.y - :y) FROM ents n WHERE n.id = :enemy) WHERE e.id = :eid;
      EXECUTE PROCEDURE change_yaw(eid);
      IF (check_attack(eid) = 1) THEN EXIT;
      IF (anim IS DISTINCT FROM stand_a) THEN
      BEGIN
        EXECUTE PROCEDURE set_anim(eid, stand_a);
        UPDATE ents e SET e.nextthink = :nt WHERE e.id = :eid;
        EXIT;
      END
      af = MOD(af + 1, fc);
      UPDATE ents e SET e.anim_frame = :af, e.frame = :ff + :af, e.nextthink = :nt WHERE e.id = :eid;
      EXIT;
    END
    SELECT vectoyaw(n.x - :x, n.y - :y) FROM ents n WHERE n.id = :enemy INTO iy;
    -- the attack states and turret-like monsters turn from the row; the chasers get the yaw as a parameter
    IF (atkst IN (3, 4) OR run_spd <= 0) THEN UPDATE ents e SET e.ideal_yaw = :iy WHERE e.id = :eid;
    IF (atkst = 3) THEN                                    -- ai_run_melee
    BEGIN
      EXECUTE PROCEDURE change_yaw(eid);
      IF (facing_ideal(eid) = 1) THEN
      BEGIN
        UPDATE ents e SET e.st = 'melee', e.attack_state = 1, e.nextthink = :nt WHERE e.id = :eid;
        EXECUTE PROCEDURE set_anim(eid, melee_a);
      END
      EXIT;
    END
    IF (atkst = 4) THEN                                    -- ai_run_missile
    BEGIN
      EXECUTE PROCEDURE change_yaw(eid);
      IF (facing_ideal(eid) = 1) THEN
      BEGIN
        UPDATE ents e SET e.st = 'missile', e.attack_state = 1, e.nextthink = :nt WHERE e.id = :eid;
        -- gunner_attack: out of melee range, half the time the grenades (attak1), else the chain gun (gunner_opengun)
        IF (mt = 'gunner' AND RAND() <= 0.5e0 AND (SELECT vlen(n.x - :x, n.y - :y, n.z - :z) FROM ents n WHERE n.id = :enemy) >= 80) THEN
          EXECUTE PROCEDURE set_anim(eid, 'attak1');
        ELSE
        BEGIN
          EXECUTE PROCEDURE set_anim(eid, missile_a);
          IF (mt = 'gunner') THEN EXECUTE PROCEDURE snd(eid, 1, 'gunner/gunatck1.wav', 1, 1);
        END
      END
      EXIT;
    END
    -- far from the player and out of its sight: think less often, stride further
    SELECT vlen(a.x - b.x, a.y - b.y, a.z - b.z) FROM ents a CROSS JOIN ents b WHERE a.id = :eid AND b.id = :enemy INTO d;
    IF (d > 1200 AND pvs_visible((SELECT l.pvs FROM leaves l WHERE l.id = (SELECT e.leaf FROM ents e WHERE e.id = :enemy)), cl) = 0) THEN
    BEGIN
      nt = t + 0.3e0;
      IF (run_spd > 0) THEN
      BEGIN
        SELECT p.gx, p.gy, p.iy, p.dist FROM ai_pursue(:eid, :run_spd * 3) p INTO gx, gy, iy, d;
        IF (d IS NOT NULL) THEN EXECUTE PROCEDURE move_to_goal(eid, d, iy, gx, gy);
      END
      af = MOD(af + 1, fc);
      UPDATE ents e SET e.anim_frame = :af, e.frame = :ff + :af, e.nextthink = :nt WHERE e.id = :eid;
      EXIT;
    END
    ca = check_attack(eid);
    IF (ca = 1) THEN EXIT;
    IF (run_spd <= 0) THEN EXECUTE PROCEDURE change_yaw(eid);
    ELSE IF (ca = 0 AND BIN_AND(flags, 1) <> 0 AND (SELECT e.attack_state FROM ents e WHERE e.id = :eid) = 2) THEN
    BEGIN
      -- ai_run_slide: face the enemy and step sideways, the other way when that side is blocked (lefty)
      UPDATE ents e SET e.ideal_yaw = :iy WHERE e.id = :eid;
      EXECUTE PROCEDURE change_yaw(eid);
      SELECT e.lefty FROM ents e WHERE e.id = :eid INTO lf;
      d = iy + IIF(lf = 1, 90, -90);
      IF (move_step(eid, COS(d * 0.0174532925e0) * run_spd, SIN(d * 0.0174532925e0) * run_spd, 0) = 0) THEN
      BEGIN
        UPDATE ents e SET e.lefty = 1 - e.lefty WHERE e.id = :eid;
        d = iy - IIF(lf = 1, 90, -90);
        lf = move_step(eid, COS(d * 0.0174532925e0) * run_spd, SIN(d * 0.0174532925e0) * run_spd, 0);
      END
    END
    ELSE IF (ca = 0) THEN EXECUTE PROCEDURE move_to_goal(eid, run_spd, iy);   -- in sight: after it
    ELSE
    BEGIN
      d = NULL;
      SELECT p.gx, p.gy, p.iy, p.dist FROM ai_pursue(:eid, :run_spd) p INTO gx, gy, iy, d;
      IF (d IS NOT NULL) THEN EXECUTE PROCEDURE move_to_goal(eid, d, iy, gx, gy);
    END
    af = MOD(af + 1, fc);
    UPDATE ents e SET e.anim_frame = :af, e.frame = :ff + :af, e.nextthink = :nt WHERE e.id = :eid;
    EXIT;
  END

  IF (st = 'attack3') THEN
  BEGIN
    -- soldier_move_attack3, crouched fire: ai_charge each frame; soldier_fire3 at the third (soldier_duck_down, which
    -- sets pausetime a second ahead, then a shot; the machinegun holds the frame for a burst, AI_HOLD_FRAME);
    -- soldier_attack3_refire at the sixth goes back to the third while pausetime is more than 0.4 s off;
    -- soldier_duck_up at the seventh
    IF (enemy IS NOT NULL) THEN
    BEGIN
      UPDATE ents e SET e.ideal_yaw = vectoyaw((SELECT x FROM ents n WHERE n.id = :enemy) - e.x, (SELECT y FROM ents n WHERE n.id = :enemy) - e.y) WHERE e.id = :eid;
      EXECUTE PROCEDURE change_yaw(eid);
    END
    IF (af = 2) THEN
    BEGIN
      IF (BIN_AND(aif, 4) = 0) THEN
      BEGIN
        UPDATE ents e SET e.maxz = e.maxz - 32, e.aiflags = BIN_OR(e.aiflags, 4), e.pausetime = :t + 1 WHERE e.id = :eid;
      END
      IF (mt = 'soldier_ss') THEN
      BEGIN
        IF (BIN_AND(aif, 8) = 0) THEN UPDATE ents e SET e.pausetime = :t + (3 + FLOOR(RAND() * 8)) * 0.1e0 WHERE e.id = :eid;
        EXECUTE PROCEDURE monster_missile(eid);
        IF (t + 0.05e0 < (SELECT e.pausetime FROM ents e WHERE e.id = :eid)) THEN
        BEGIN
          UPDATE ents e SET e.aiflags = BIN_OR(e.aiflags, 8), e.nextthink = :nt WHERE e.id = :eid;
          EXIT;
        END
        UPDATE ents e SET e.aiflags = BIN_AND(e.aiflags, BIN_NOT(8)) WHERE e.id = :eid;
      END
      ELSE EXECUTE PROCEDURE monster_missile(eid);
    END
    IF (NOT EXISTS (SELECT 1 FROM ents e WHERE e.id = :eid AND e.st = :st)) THEN EXIT;
    IF (af = 5 AND t + 0.4e0 < (SELECT e.pausetime FROM ents e WHERE e.id = :eid)) THEN af = 2;
    ELSE
    BEGIN
      IF (af = 6) THEN EXECUTE PROCEDURE monster_duck_up(eid);
      af = af + 1;
    END
    IF (af >= fc) THEN
    BEGIN
      EXECUTE PROCEDURE monster_duck_up(eid);
      UPDATE ents e SET e.st = TRIM(IIF(e.enemy_id IS NULL, 'stand', 'run')), e.nextthink = :nt WHERE e.id = :eid;
      EXECUTE PROCEDURE set_anim(eid, IIF(enemy IS NULL, stand_a, run_a));
      EXIT;
    END
    UPDATE ents e SET e.anim_frame = :af, e.frame = :ff + :af, e.nextthink = :nt WHERE e.id = :eid;
    EXIT;
  END

  IF (st = 'melee' OR st = 'missile') THEN
  BEGIN
    -- ai_charge each frame; act on the key frames
    IF (enemy IS NOT NULL) THEN
    BEGIN
      UPDATE ents e SET e.ideal_yaw = vectoyaw((SELECT x FROM ents n WHERE n.id = :enemy) - e.x, (SELECT y FROM ents n WHERE n.id = :enemy) - e.y) WHERE e.id = :eid;
      EXECUTE PROCEDURE change_yaw(eid);
    END
    IF (st = 'missile' AND mt = 'parasite') THEN EXECUTE PROCEDURE parasite_drain(eid, af);
    ELSE IF (st = 'melee' AND af = melee_f) THEN EXECUTE PROCEDURE monster_melee(eid);
    IF (st = 'missile' AND mt = 'gunner' AND anim = 'attak1') THEN
    BEGIN
      IF (af IN (4, 7, 10, 13)) THEN EXECUTE PROCEDURE gunner_grenade(eid);   -- gunner_frames_attack_grenade
    END
    ELSE IF (st = 'missile' AND POSITION(',' || af || ',', ',' || missile_f || ',') > 0) THEN EXECUTE PROCEDURE monster_missile(eid);
    IF (NOT EXISTS (SELECT 1 FROM ents e WHERE e.id = :eid AND e.st = :st)) THEN EXIT;
    af = af + 1;
    IF (af >= fc) THEN
    BEGIN
      UPDATE ents e SET e.st = 'run', e.nextthink = :nt WHERE e.id = :eid;
      EXECUTE PROCEDURE set_anim(eid, run_a);
      EXIT;
    END
    UPDATE ents e SET e.anim_frame = :af, e.frame = :ff + :af, e.nextthink = :nt WHERE e.id = :eid;
    EXIT;
  END

  IF (st = 'pain' OR st = 'duck') THEN
  BEGIN
    af = af + 1;
    IF (af >= fc) THEN
    BEGIN
      IF (st = 'duck') THEN EXECUTE PROCEDURE monster_duck_up(eid);
      UPDATE ents e SET e.st = TRIM(IIF(e.enemy_id IS NULL, 'stand', 'run')), e.nextthink = :nt WHERE e.id = :eid;   -- (IIF pads the shorter literal)
      EXECUTE PROCEDURE set_anim(eid, IIF(enemy IS NULL, stand_a, run_a));
      EXIT;
    END
    UPDATE ents e SET e.anim_frame = :af, e.frame = :ff + :af, e.nextthink = :nt WHERE e.id = :eid;
    EXIT;
  END

  IF (st = 'die') THEN
  BEGIN
    af = af + 1;
    IF (af >= fc) THEN
    BEGIN
      UPDATE ents e SET e.st = 'dead', e.anim_frame = :fc - 1, e.frame = :ff + :fc - 1, e.nextthink = NULL WHERE e.id = :eid;
      EXIT;
    END
    UPDATE ents e SET e.anim_frame = :af, e.frame = :ff + :af, e.nextthink = :nt WHERE e.id = :eid;
    EXIT;
  END
END^

-- a console helper: put a monster in front of the player
CREATE OR ALTER PROCEDURE spawn_monster (mname VARCHAR(16), dist DOUBLE PRECISION)
RETURNS (id INTEGER)
AS
DECLARE px DOUBLE PRECISION; DECLARE py DOUBLE PRECISION; DECLARE pz DOUBLE PRECISION; DECLARE yaw DOUBLE PRECISION;
DECLARE mmodel VARCHAR(64); DECLARE mskin INTEGER; DECLARE mhp INTEGER; DECLARE mgh INTEGER; DECLARE mmass INTEGER; DECLARE mflags INTEGER; DECLARE mys DOUBLE PRECISION; DECLARE stand VARCHAR(16);
DECLARE a DOUBLE PRECISION; DECLARE b DOUBLE PRECISION; DECLARE c DOUBLE PRECISION; DECLARE d DOUBLE PRECISION; DECLARE e_ DOUBLE PRECISION; DECLARE f DOUBLE PRECISION;
BEGIN
  SELECT e.x, e.y, e.z, e.yaw FROM ents e WHERE e.id = player_ent() INTO px, py, pz, yaw;
  SELECT t.model, t.skin, t.health, t.gib_health, t.mass, t.flags, t.yaw_speed, t.stand_anim, t.minx, t.miny, t.minz, t.maxx, t.maxy, t.maxz
    FROM monster_types t WHERE t.name = :mname INTO mmodel, mskin, mhp, mgh, mmass, mflags, mys, stand, a, b, c, d, e_, f;
  IF (mmodel IS NULL) THEN EXIT;
  EXECUTE PROCEDURE spawn_ent('monster_' || mname, px + COS(yaw * 0.0174532925e0) * dist, py + SIN(yaw * 0.0174532925e0) * dist, pz + 8) RETURNING_VALUES id;
  EXECUTE PROCEDURE set_model(id, mmodel);
  UPDATE ents e SET e.mtype = :mname, e.skin = :mskin, e.health = :mhp, e.max_health = :mhp, e.gib_health = :mgh, e.mass = :mmass, e.solid = 3, e.takedamage = 2,
         e.movetype = IIF(BIN_AND(:mflags, 3) <> 0, 5, 4), e.clipmask = 33685507, e.flags = BIN_OR(32, :mflags), e.yaw_speed = :mys, e.yaw = anglemod(:yaw + 180),
         e.minx = :a, e.miny = :b, e.minz = :c, e.maxx = :d, e.maxy = :e_, e.maxz = :f, e.viewheight = :f - 8,
         e.st = 'stand', e.anim = :stand, e.ideal_yaw = e.yaw, e.spawn_x = e.x, e.spawn_y = e.y, e.spawn_z = e.z,
         e.think = 'monster_think', e.nextthink = now_() + 0.1e0 WHERE e.id = :id;
  UPDATE game g SET g.total_monsters = g.total_monsters + 1 WHERE g.id = 1;
  IF (BIN_AND(mflags, 3) = 0) THEN EXECUTE PROCEDURE drop_to_floor(id); ELSE EXECUTE PROCEDURE link_ent(id);
  SUSPEND;
END^

-- ── the pushers (SV_Physics_Pusher) ─────────────────────────────────────
SET TERM ; ^
CREATE GLOBAL TEMPORARY TABLE pushed (
  ent INTEGER NOT NULL PRIMARY KEY,
  ox DOUBLE PRECISION NOT NULL, oy DOUBLE PRECISION NOT NULL, oz DOUBLE PRECISION NOT NULL
) ON COMMIT DELETE ROWS;
SET TERM ^ ;

CREATE OR ALTER PROCEDURE push_move (eid INTEGER, movetime DOUBLE PRECISION)
AS
DECLARE vx DOUBLE PRECISION; DECLARE vy DOUBLE PRECISION; DECLARE vz DOUBLE PRECISION;
DECLARE ap DOUBLE PRECISION; DECLARE ay DOUBLE PRECISION; DECLARE ar DOUBLE PRECISION;
DECLARE mx DOUBLE PRECISION; DECLARE my DOUBLE PRECISION; DECLARE mz DOUBLE PRECISION;
DECLARE px DOUBLE PRECISION; DECLARE py DOUBLE PRECISION; DECLARE pz DOUBLE PRECISION;
DECLARE mnx DOUBLE PRECISION; DECLARE mny DOUBLE PRECISION; DECLARE mnz DOUBLE PRECISION;
DECLARE mxx DOUBLE PRECISION; DECLARE mxy DOUBLE PRECISION; DECLARE mxz DOUBLE PRECISION;
DECLARE c INTEGER; DECLARE cmt SMALLINT; DECLARE cx DOUBLE PRECISION; DECLARE cy DOUBLE PRECISION; DECLARE cz DOUBLE PRECISION;
DECLARE csolid SMALLINT; DECLARE pe INTEGER; DECLARE r INTEGER; DECLARE grow DOUBLE PRECISION;
BEGIN
  SELECT e.vx, e.vy, e.vz, e.avel_pitch, e.avel_yaw, e.avel_roll, e.x, e.y, e.z, e.minx, e.miny, e.minz, e.maxx, e.maxy, e.maxz FROM ents e WHERE e.id = :eid
    INTO vx, vy, vz, ap, ay, ar, px, py, pz, mnx, mny, mnz, mxx, mxy, mxz;
  IF (vx = 0 AND vy = 0 AND vz = 0 AND ap = 0 AND ay = 0 AND ar = 0) THEN
  BEGIN
    UPDATE ents e SET e.ltime = e.ltime + :movetime WHERE e.id = :eid;
    EXIT;
  END
  pe = player_ent();

  -- rotation: turn, then make sure nobody is caught inside
  IF (ap <> 0 OR ay <> 0 OR ar <> 0) THEN
  BEGIN
    UPDATE ents e SET e.pitch = e.pitch + :ap * :movetime, e.yaw = e.yaw + :ay * :movetime, e.roll = e.roll + :ar * :movetime, e.ltime = e.ltime + :movetime WHERE e.id = :eid;
    grow = MAXVALUE(mxx - mnx, MAXVALUE(mxy - mny, mxz - mnz));
    FOR SELECT e.id, e.x, e.y, e.z FROM ents e
         WHERE e.id <> :eid AND e.solid IN (2, 3) AND e.health > 0 AND e.movetype IN (3, 4, 5)
           AND e.x + e.maxx >= :px + :mnx - :grow AND e.x + e.minx <= :px + :mxx + :grow
           AND e.y + e.maxy >= :py + :mny - :grow AND e.y + e.miny <= :py + :mxy + :grow
           AND e.z + e.maxz >= :pz + :mnz - :grow AND e.z + e.minz <= :pz + :mxz + :grow
          INTO c, cx, cy, cz
    DO
    BEGIN
      IF (test_position(c, cx, cy, cz) = 1) THEN
      BEGIN
        -- blocked: turn back
        UPDATE ents e SET e.pitch = e.pitch - :ap * :movetime, e.yaw = e.yaw - :ay * :movetime, e.roll = e.roll - :ar * :movetime, e.ltime = e.ltime - :movetime WHERE e.id = :eid;
        EXECUTE PROCEDURE mover_blocked(eid, c);
        EXIT;
      END
    END
    IF (vx = 0 AND vy = 0 AND vz = 0) THEN EXIT;
    UPDATE ents e SET e.ltime = e.ltime - :movetime WHERE e.id = :eid;   -- the translation below adds it back
  END

  mx = vx * movetime; my = vy * movetime; mz = vz * movetime;
  UPDATE ents e SET e.x = e.x + :mx, e.y = e.y + :my, e.z = e.z + :mz, e.ltime = e.ltime + :movetime WHERE e.id = :eid;
  EXECUTE PROCEDURE link_ent(eid);
  DELETE FROM pushed;

  FOR SELECT e.id, e.movetype, e.x, e.y, e.z, e.solid FROM ents e
       WHERE e.id <> :eid AND e.movetype NOT IN (0, 7, 8) AND e.solid <> 0 AND e.health > -1
         AND e.x + e.maxx >= :px + :mnx + MINVALUE(0, :mx) - 1 AND e.x + e.minx <= :px + :mxx + MAXVALUE(0, :mx) + 1
         AND e.y + e.maxy >= :py + :mny + MINVALUE(0, :my) - 1 AND e.y + e.miny <= :py + :mxy + MAXVALUE(0, :my) + 1
         AND e.z + e.maxz >= :pz + :mnz + MINVALUE(0, :mz) - 1 AND e.z + e.minz <= :pz + :mxz + MAXVALUE(0, :mz) + 1
        INTO c, cmt, cx, cy, cz, csolid
  DO
  BEGIN
    -- riding on top, or now inside the pusher?
    IF (test_position(c, cx, cy, cz) = 0 AND NOT (cz + 1 >= pz - mz + mxz - 0.5e0 AND cz - 1 <= pz - mz + mxz + 0.5e0 AND mz <> 0)) THEN
    BEGIN
      IF (cz + (SELECT e.minz FROM ents e WHERE e.id = :c) < pz - mz + mxz - 2 OR cz + (SELECT e.minz FROM ents e WHERE e.id = :c) > pz - mz + mxz + 2) THEN CONTINUE;
      IF (cx + (SELECT e.maxx FROM ents e WHERE e.id = :c) < px + mnx OR cx + (SELECT e.minx FROM ents e WHERE e.id = :c) > px + mxx) THEN CONTINUE;
      IF (cy + (SELECT e.maxy FROM ents e WHERE e.id = :c) < py + mny OR cy + (SELECT e.miny FROM ents e WHERE e.id = :c) > py + mxy) THEN CONTINUE;
      IF (mz < 0) THEN CONTINUE;         -- standing on a sinking plat: gravity brings us down
    END
    INSERT INTO pushed (ent, ox, oy, oz) VALUES (:c, :cx, :cy, :cz);
    UPDATE ents e SET e.x = e.x + :mx, e.y = e.y + :my, e.z = e.z + :mz WHERE e.id = :c;
    IF (test_position(c, cx + mx, cy + my, cz + mz) = 0) THEN
    BEGIN
      EXECUTE PROCEDURE link_ent(c);
      IF (c = pe) THEN UPDATE player p SET p.oldz = p.oldz + :mz WHERE p.id = 1;
      CONTINUE;
    END
    -- if it is ok to leave in the old position, do it
    IF (cmt <> 3) THEN
    BEGIN
      UPDATE ents e SET e.x = :cx, e.y = :cy, e.z = :cz WHERE e.id = :c;
      IF (test_position(c, cx, cy, cz) = 0) THEN
      BEGIN
        DELETE FROM pushed WHERE ent = :c;
        CONTINUE;
      END
    END
    -- corpses and items get crushed out of the way
    IF (csolid IN (0, 1) OR cmt IN (6, 10)) THEN
    BEGIN
      UPDATE ents e SET e.solid = 0, e.minx = 0, e.miny = 0, e.minz = 0, e.maxx = 0, e.maxy = 0, e.maxz = 0 WHERE e.id = :c;
      CONTINUE;
    END
    -- blocked: move everything back
    UPDATE ents e SET e.x = :cx, e.y = :cy, e.z = :cz WHERE e.id = :c;
    UPDATE ents e SET e.x = e.x - :mx, e.y = e.y - :my, e.z = e.z - :mz, e.ltime = e.ltime - :movetime WHERE e.id = :eid;
    EXECUTE PROCEDURE link_ent(eid);
    FOR SELECT p.ent, p.ox, p.oy, p.oz FROM pushed p WHERE p.ent <> :c INTO r, cx, cy, cz DO
    BEGIN
      UPDATE ents e SET e.x = :cx, e.y = :cy, e.z = :cz WHERE e.id = :r;
      EXECUTE PROCEDURE link_ent(r);
    END
    EXECUTE PROCEDURE mover_blocked(eid, c);
    EXIT;
  END
END^

CREATE OR ALTER PROCEDURE run_pushers (dt DOUBLE PRECISION)
AS
DECLARE eid INTEGER; DECLARE lt DOUBLE PRECISION; DECLARE mvt DOUBLE PRECISION; DECLARE done VARCHAR(24); DECLARE movetime DOUBLE PRECISION;
DECLARE tx DOUBLE PRECISION; DECLARE ty DOUBLE PRECISION; DECLARE tz DOUBLE PRECISION; DECLARE think VARCHAR(24); DECLARE nt DOUBLE PRECISION; DECLARE angular SMALLINT;
BEGIN
  FOR SELECT e.id FROM ents e WHERE e.movetype = 7 AND (e.mv_time IS NOT NULL OR e.think IS NOT NULL OR e.avel_pitch <> 0 OR e.avel_yaw <> 0 OR e.avel_roll <> 0) INTO eid DO
  BEGIN
    SELECT e.ltime, e.mv_time, e.mv_done, e.dstx, e.dsty, e.dstz, e.think, e.nextthink, e.count_ FROM ents e WHERE e.id = :eid INTO lt, mvt, done, tx, ty, tz, think, nt, angular;
    IF (mvt IS NOT NULL) THEN
    BEGIN
      movetime = MINVALUE(dt, MAXVALUE(0, mvt - lt));
      IF (movetime > 0) THEN EXECUTE PROCEDURE push_move(eid, movetime);
      ELSE UPDATE ents e SET e.ltime = e.ltime + :dt WHERE e.id = :eid;
      SELECT e.ltime, e.mv_time FROM ents e WHERE e.id = :eid INTO lt, mvt;
      IF (mvt IS NOT NULL AND lt >= mvt - 1e-6) THEN
      BEGIN
        -- Move_Done / AngleMove_Done: snap to the destination and run the think
        IF (angular = 1) THEN
          UPDATE ents e SET e.pitch = :tx, e.yaw = :ty, e.roll = :tz, e.avel_pitch = 0, e.avel_yaw = 0, e.avel_roll = 0, e.mv_time = NULL, e.mv_done = NULL, e.count_ = 0 WHERE e.id = :eid;
        ELSE
          UPDATE ents e SET e.x = :tx, e.y = :ty, e.z = :tz, e.vx = 0, e.vy = 0, e.vz = 0, e.mv_time = NULL, e.mv_done = NULL WHERE e.id = :eid;
        EXECUTE PROCEDURE link_ent(eid);
        EXECUTE PROCEDURE run_think(eid, done);
      END
    END
    ELSE
    BEGIN
      -- func_rotating spins; the rest just wait for their thinks
      IF (EXISTS (SELECT 1 FROM ents e WHERE e.id = :eid AND (e.avel_pitch <> 0 OR e.avel_yaw <> 0 OR e.avel_roll <> 0))) THEN EXECUTE PROCEDURE push_move(eid, dt);
      ELSE UPDATE ents e SET e.ltime = e.ltime + :dt WHERE e.id = :eid;
      IF (think IS NOT NULL AND nt IS NOT NULL AND nt <= lt + dt + 1e-6) THEN
      BEGIN
        UPDATE ents e SET e.think = NULL, e.nextthink = NULL WHERE e.id = :eid;
        EXECUTE PROCEDURE run_think(eid, think);
      END
    END
  END
END^

-- dispatch a think by name
CREATE OR ALTER PROCEDURE run_think (eid INTEGER, think VARCHAR(24))
AS
BEGIN
  IF (think IS NULL) THEN EXIT;
  IF (think = 'door_go_down') THEN EXECUTE PROCEDURE door_go_down(eid);
  ELSE IF (think = 'door_go_up') THEN EXECUTE PROCEDURE door_go_up(eid, player_ent());
  ELSE IF (think = 'door_hit_top') THEN EXECUTE PROCEDURE door_hit_top(eid);
  ELSE IF (think = 'door_hit_bottom') THEN EXECUTE PROCEDURE door_hit_bottom(eid);
  ELSE IF (think = 'plat_go_down') THEN EXECUTE PROCEDURE plat_go_down(eid);
  ELSE IF (think = 'plat_go_up') THEN EXECUTE PROCEDURE plat_go_up(eid);
  ELSE IF (think = 'plat_hit_top') THEN EXECUTE PROCEDURE plat_hit_top(eid);
  ELSE IF (think = 'plat_hit_bottom') THEN EXECUTE PROCEDURE plat_hit_bottom(eid);
  ELSE IF (think = 'button_wait') THEN EXECUTE PROCEDURE button_wait(eid);
  ELSE IF (think = 'button_return') THEN EXECUTE PROCEDURE button_return(eid);
  ELSE IF (think = 'button_done') THEN EXECUTE PROCEDURE button_done(eid);
  ELSE IF (think = 'train_next') THEN EXECUTE PROCEDURE train_next(eid);
  ELSE IF (think = 'train_wait') THEN EXECUTE PROCEDURE train_wait(eid);
  ELSE IF (think = 'train_find') THEN EXECUTE PROCEDURE train_find(eid);
  ELSE IF (think = 'timer_think') THEN EXECUTE PROCEDURE timer_think(eid);
  ELSE IF (think = 'always_fire') THEN EXECUTE PROCEDURE always_fire(eid);
  ELSE IF (think = 'multi_wait') THEN EXECUTE PROCEDURE multi_wait(eid);
  ELSE IF (think = 'delayed_use') THEN EXECUTE PROCEDURE delayed_use(eid);
  ELSE IF (think = 'object_release') THEN EXECUTE PROCEDURE object_release(eid);
  ELSE IF (think = 'bfg_explode') THEN EXECUTE PROCEDURE bfg_explode(eid);
  ELSE IF (think = 'crosslevel_think') THEN EXECUTE PROCEDURE crosslevel_think(eid);
  ELSE IF (think = 'grenade_explode') THEN EXECUTE PROCEDURE grenade_explode(eid);
  ELSE IF (think = 'bfg_think') THEN EXECUTE PROCEDURE bfg_think(eid);
  ELSE IF (think = 'laser_think') THEN EXECUTE PROCEDURE laser_think(eid);
  ELSE IF (think = 'dish_think') THEN EXECUTE PROCEDURE dish_think(eid);
  ELSE IF (think = 'remove') THEN DELETE FROM ents e WHERE e.id = :eid;
  ELSE IF (think = 'monster_think') THEN EXECUTE PROCEDURE monster_think(eid);
END^

-- SV_Physics for everything but the player and the pushers
CREATE OR ALTER PROCEDURE run_physics (dt DOUBLE PRECISION)
AS
DECLARE eid INTEGER; DECLARE mt SMALLINT; DECLARE think VARCHAR(24); DECLARE t DOUBLE PRECISION;
DECLARE flags INTEGER; DECLARE cls VARCHAR(40); DECLARE wl SMALLINT; DECLARE pe INTEGER; DECLARE tid INTEGER; DECLARE tcls VARCHAR(40);
BEGIN
  t = now_();
  pe = player_ent();
  -- thinks that are due (non-pushers)
  FOR SELECT e.id, e.think FROM ents e WHERE e.nextthink IS NOT NULL AND e.nextthink <= :t + 1e-6 AND e.movetype <> 7 AND e.think IS NOT NULL ORDER BY e.id INTO eid, think DO
  BEGIN
    UPDATE ents e SET e.nextthink = NULL WHERE e.id = :eid AND e.think = :think AND e.think NOT IN ('monster_think', 'laser_think', 'bfg_think');
    EXECUTE PROCEDURE run_think(eid, think);
  END
  -- toss, bounce, fly, flymissile, and monsters in the air
  FOR SELECT e.id, e.movetype, e.flags, e.classname FROM ents e WHERE e.movetype IN (6, 9, 10) OR (e.movetype IN (4, 5) AND BIN_AND(e.flags, 512 + 1 + 2) = 0 AND e.st <> 'dead')
        INTO eid, mt, flags, cls DO
  BEGIN
    IF (mt IN (4, 5)) THEN
    BEGIN
      -- SV_Physics_Step: a monster that is not on the ground falls
      UPDATE ents e SET e.vz = e.vz - (SELECT g.gravity FROM game g WHERE g.id = 1) * :dt WHERE e.id = :eid;
      EXECUTE PROCEDURE fly_move(eid, dt) RETURNING_VALUES wl, tid;
      IF (wl = 3) THEN UPDATE ents e SET e.flags = BIN_OR(e.flags, 512) WHERE e.id = :eid;   -- could not move at all: it is standing in the floor
      IF (EXISTS (SELECT 1 FROM ents e WHERE e.id = :eid AND BIN_AND(e.flags, 512) <> 0)) THEN
        UPDATE ents e SET e.vx = 0, e.vy = 0, e.vz = 0 WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
      CONTINUE;
    END
    IF (BIN_AND(flags, 512) <> 0 AND mt <> 9) THEN CONTINUE;      -- resting
    EXECUTE PROCEDURE toss_move(eid, dt);
  END
  -- monsters touching monster jumps / hurt triggers (on maps that have any)
  IF (NOT EXISTS (SELECT 1 FROM ents tr WHERE tr.classname IN ('trigger_monsterjump', 'trigger_hurt') AND tr.solid = 1)) THEN EXIT;
  FOR SELECT m.id, m.x, m.y, m.z FROM ents m WHERE BIN_AND(m.flags, 32) <> 0 AND m.health > 0 AND m.st IN ('run', 'walk') INTO eid, wl, wl, wl DO
  BEGIN
    FOR SELECT tr.id, tr.classname FROM ents tr JOIN ents m ON m.id = :eid
         WHERE tr.solid = 1 AND tr.classname IN ('trigger_monsterjump', 'trigger_hurt')
           AND tr.x + tr.maxx >= m.x + m.minx AND tr.x + tr.minx <= m.x + m.maxx
           AND tr.y + tr.maxy >= m.y + m.miny AND tr.y + tr.miny <= m.y + m.maxy
           AND tr.z + tr.maxz >= m.z + m.minz AND tr.z + tr.minz <= m.z + m.maxz
          INTO tid, tcls DO
    BEGIN
      IF (tcls = 'trigger_hurt') THEN
      BEGIN
        IF (EXISTS (SELECT 1 FROM ents e WHERE e.id = :tid AND (e.nextthink IS NULL OR e.nextthink < :t))) THEN
        BEGIN
          UPDATE ents e SET e.nextthink = :t + 0.1e0 WHERE e.id = :tid;
          EXECUTE PROCEDURE t_damage(eid, tid, tid, (SELECT e.dmg FROM ents e WHERE e.id = :tid), 0, 0);
        END
      END
      ELSE
        -- trigger_monsterjump_touch: XY from the trigger's direction always (so the jump clears lips), up only from the ground
        UPDATE ents e SET e.vx = (SELECT tr.p1x * tr.speed FROM ents tr WHERE tr.id = :tid),
               e.vy = (SELECT tr.p1y * tr.speed FROM ents tr WHERE tr.id = :tid),
               e.vz = IIF(BIN_AND(e.flags, 512) <> 0, (SELECT tr.height FROM ents tr WHERE tr.id = :tid), e.vz),
               e.flags = BIN_AND(e.flags, BIN_NOT(512)) WHERE e.id = :eid AND BIN_AND(e.flags, 3) = 0;
    END
  END
END^

-- ── the tic ─────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE q2_tic (
  tics INTEGER, fwd DOUBLE PRECISION, side DOUBLE PRECISION, yaw_d DOUBLE PRECISION, pitch_d DOUBLE PRECISION,
  fire SMALLINT, jump SMALLINT, run SMALLINT, imp SMALLINT)
RETURNS (
  tic INTEGER, time_ DOUBLE PRECISION, health INTEGER, max_health INTEGER, armor INTEGER, armor_type SMALLINT, power_armor SMALLINT,
  bullets INTEGER, shells INTEGER, rockets INTEGER, grenades INTEGER, cells INTEGER, slugs INTEGER,
  weapons INTEGER, keys INTEGER, weapon INTEGER, attack_start DOUBLE PRECISION, attack_finished DOUBLE PRECISION, grenade_time DOUBLE PRECISION,
  px DOUBLE PRECISION, py DOUBLE PRECISION, pz DOUBLE PRECISION, yaw DOUBLE PRECISION, pitch DOUBLE PRECISION,
  view_z DOUBLE PRECISION, punch DOUBLE PRECISION,
  msg VARCHAR(200), cprint VARCHAR(400), dmg_take INTEGER, dmg_save INTEGER, dmg_time DOUBLE PRECISION, bonus_time DOUBLE PRECISION,
  dead SMALLINT, exit_kind SMALLINT, next_map VARCHAR(64), killed INTEGER, total_monsters INTEGER,
  found_secrets INTEGER, total_secrets INTEGER, found_goals INTEGER, total_goals INTEGER, waterlevel SMALLINT, watertype INTEGER, map_name VARCHAR(32),
  level_msg VARCHAR(200), quad SMALLINT, invincible SMALLINT, breather SMALLINT, enviro SMALLINT, leaf INTEGER, cluster INTEGER, help_msg VARCHAR(400),
  help_msg2 VARCHAR(400), help_changed INTEGER, skill SMALLINT, intermission SMALLINT,
  roll DOUBLE PRECISION, bobtime DOUBLE PRECISION, xyspeed DOUBLE PRECISION, ducked SMALLINT,
  inv_sel SMALLINT, pickup_item SMALLINT, timer_icon SMALLINT, timer INTEGER)
AS
DECLARE i INTEGER = 0; DECLARE itime DOUBLE PRECISION;
BEGIN
  SELECT g.tic, g.intermission_time FROM game g WHERE g.id = 1 INTO tic, itime;
  DELETE FROM sound_events s WHERE s.tic < :tic - 40;
  DELETE FROM fx_events f WHERE f.tic < :tic - 40;
  IF (itime IS NOT NULL) THEN
  BEGIN
    -- the intermission: the world holds still (PM_FREEZE); after five seconds a button leaves
    UPDATE game g SET g.tic = g.tic + :tics, g.time_ = g.time_ + 0.05e0 * :tics WHERE g.id = 1;
    UPDATE game g SET g.exit_kind = 1 WHERE g.id = 1 AND g.exit_kind = 0 AND g.time_ > g.intermission_time + 5 AND (:fire = 1 OR :jump = 1);
    i = tics;
  END
  WHILE (i < tics) DO
  BEGIN
    UPDATE game g SET g.tic = g.tic + 1, g.time_ = g.time_ + 0.05e0 WHERE g.id = 1;
    IF (MOD(tic + i, 2) = 0) THEN EXECUTE PROCEDURE player_trail_check;
    EXECUTE PROCEDURE player_think(0.05e0, fwd, side, yaw_d / tics, pitch_d / tics, fire, jump, run, IIF(i = 0, imp, 0));
    EXECUTE PROCEDURE run_pushers(0.05e0);
    EXECUTE PROCEDURE run_physics(0.05e0);
    i = i + 1;
  END
  -- G_SetStats: power armour with no cells left switches itself off
  UPDATE player p SET p.power_armor = 0 WHERE p.id = 1 AND p.power_armor = 1 AND p.cells <= 0 AND (p.inv_screen > 0 OR p.inv_shield > 0);
  IF (ROW_COUNT > 0) THEN EXECUTE PROCEDURE snd(player_ent(), 3, 'misc/power2.wav', 1, 1);
  SELECT g.tic, g.time_, e.health, e.max_health, p.armor, p.armor_type, IIF(p.power_armor = 1, IIF(p.inv_shield > 0, 2, IIF(p.inv_screen > 0, 1, 0)), 0), p.bullets, p.shells, p.rockets, p.grenades, p.cells, p.slugs,
         p.weapons, p.keys, p.weapon, p.attack_start, p.attack_finished, p.grenade_time,
         e.x, e.y, e.z, e.yaw, p.pitch + p.punchangle + p.bob_pitch, e.z + p.view_ofs - p.stepz + p.bob_z, p.punchangle,
         IIF(p.msg_time > g.time_, p.msg, NULL), IIF(p.cprint_time > g.time_, p.cprint, NULL),
         p.dmg_take, p.dmg_save, p.dmg_time, p.bonus_time, e.deadflag, g.exit_kind, g.next_map, g.killed, g.total_monsters,
         g.found_secrets, g.total_secrets, g.found_goals, g.total_goals, e.waterlevel, e.watertype, g.map_name, g.level_msg,
         IIF(p.quad_finished > g.time_, 1, 0), IIF(p.invincible_finished > g.time_, 1, 0), IIF(p.breather_finished > g.time_, 1, 0), IIF(p.enviro_finished > g.time_, 1, 0),
         e.leaf, e.cluster, g.help_msg, g.help_msg2, g.help_changed, g.skill, IIF(g.intermission_time IS NULL, 0, 1),
         IIF(e.deadflag = 1, 40, p.bob_roll), p.bobtime, SQRT(e.vx * e.vx + e.vy * e.vy), p.ducked,
         p.inv_sel, IIF(p.pickup_time > g.time_, p.pickup_item, 0),
         -- the timer: quad, else invulnerability, else the suit, else the rebreather, in whole seconds left
         CASE WHEN p.quad_finished > g.time_ THEN 1 WHEN p.invincible_finished > g.time_ THEN 2 WHEN p.enviro_finished > g.time_ THEN 3
              WHEN p.breather_finished > g.time_ THEN 4 ELSE 0 END,
         CAST(FLOOR(CASE WHEN p.quad_finished > g.time_ THEN p.quad_finished WHEN p.invincible_finished > g.time_ THEN p.invincible_finished
              WHEN p.enviro_finished > g.time_ THEN p.enviro_finished WHEN p.breather_finished > g.time_ THEN p.breather_finished ELSE g.time_ END - g.time_ + 1e-9) AS INTEGER)
    FROM game g CROSS JOIN player p JOIN ents e ON e.id = p.ent_id
   WHERE g.id = 1 AND p.id = 1
    INTO tic, time_, health, max_health, armor, armor_type, power_armor, bullets, shells, rockets, grenades, cells, slugs, weapons, keys, weapon, attack_start, attack_finished, grenade_time,
         px, py, pz, yaw, pitch, view_z, punch, msg, cprint, dmg_take, dmg_save, dmg_time, bonus_time, dead, exit_kind, next_map,
         killed, total_monsters, found_secrets, total_secrets, found_goals, total_goals, waterlevel, watertype, map_name, level_msg, quad, invincible, breather, enviro, leaf, cluster, help_msg,
         help_msg2, help_changed, skill, intermission, roll, bobtime, xyspeed, ducked, inv_sel, pickup_item, timer_icon, timer;
  UPDATE player p SET p.dmg_take = 0, p.dmg_save = 0 WHERE p.id = 1 AND p.dmg_time < :time_ - 0.05e0;
  SUSPEND;
END^

-- SpawnEntities + the client's spawn
CREATE OR ALTER PROCEDURE init_map (map_name VARCHAR(32), world_model INTEGER, skill SMALLINT, new_game SMALLINT, spawnpoint VARCHAR(40))
AS
DECLARE i INTEGER;
BEGIN
  UPDATE game g SET g.tic = 0, g.time_ = 0, g.map_name = :map_name, g.next_map = NULL, g.exit_kind = 0, g.skill = :skill, g.world_model = :world_model,
         g.total_monsters = 0, g.killed = 0, g.total_secrets = 0, g.found_secrets = 0, g.total_goals = 0, g.found_goals = 0, g.level_msg = NULL,
         g.intermission_time = NULL, g.gravity = 800 WHERE g.id = 1;
  -- switchable lights back to their patterns
  DELETE FROM lightstyles l WHERE l.style >= 32;
  i = 32;
  WHILE (i < 63) DO BEGIN INSERT INTO lightstyles (style, pattern) VALUES (:i, 'm'); i = i + 1; END
  INSERT INTO lightstyles (style, pattern) VALUES (63, 'a');
  IF (new_game = 1) THEN
  BEGIN
    UPDATE game g SET g.serverflags = 0, g.help_msg = NULL, g.help_msg2 = NULL, g.help_changed = 0 WHERE g.id = 1;     -- the unit starts over (the help computer's messages last a game)
    UPDATE player p SET p.armor = 0, p.armor_type = 0, p.power_armor = 0, p.bullets = 0, p.shells = 0, p.rockets = 0, p.grenades = 0, p.cells = 0, p.slugs = 0,
           p.max_bullets = 200, p.max_shells = 100, p.max_rockets = 50, p.max_grenades = 50, p.max_cells = 200, p.max_slugs = 50,
           p.weapons = 1, p.weapon = 1, p.keys = 0, p.power_cubes = 0, p.quad_finished = 0, p.invincible_finished = 0, p.breather_finished = 0, p.enviro_finished = 0,
           p.silencer_shots = 0, p.kills = 0, p.inv_quad = 0, p.inv_invuln = 0, p.inv_silencer = 0, p.inv_breather = 0, p.inv_enviro = 0,
           p.inv_screen = 0, p.inv_shield = 0, p.inv_sel = 7 WHERE p.id = 1;
  END
  UPDATE player p SET p.weaponframe = 0, p.attack_finished = 0, p.attack_start = 0, p.pain_finished = 0, p.punchangle = 0, p.view_ofs = 22, p.dmg_take = 0, p.dmg_save = 0,
         p.dmg_time = -10, p.bonus_time = -10, p.pickup_item = 0, p.pickup_time = 0, p.msg = NULL, p.msg_time = 0, p.cprint = NULL, p.cprint_time = 0, p.dead_time = 0, p.pitch = 0, p.stepz = 0,
         p.jump_released = 1, p.air_finished = 12, p.dmg_lava_time = 0, p.next_drown_time = 0, p.drown_dmg = 2, p.weapon_sound = 0, p.machinegun_shots = 0,
         p.chaingun_spin = 0, p.grenade_time = 0, p.mega_time = 0, p.keys = 0 WHERE p.id = 1;
  -- keys don't carry over; neither do dead weapons
  UPDATE player p SET p.weapon = best_weapon() WHERE p.id = 1 AND (BIN_AND(p.weapons, p.weapon) = 0 OR p.weapon = 0);
  UPDATE game g SET g.has_water = IIF(EXISTS (SELECT 1 FROM leaves l WHERE BIN_AND(l.contents, 56) <> 0), 1, 0) WHERE g.id = 1;
  UPDATE viewcfg c SET c.vis_cluster = NULL, c.vis_area = NULL, c.lv_ex = NULL, c.lv_leaf = NULL, c.world_lst = NULL WHERE c.id = 1;
  -- PlayerTrail_Init: no trail yet
  DELETE FROM player_trail;
  UPDATE player p SET p.trail_x = 1e30, p.trail_y = 1e30, p.trail_z = 1e30 WHERE p.id = 1;
  -- every area portal starts closed (CM_LoadMap); the doors open them
  DELETE FROM portal_state;
  INSERT INTO portal_state (portal, open_) SELECT DISTINCT ap.portal, 0 FROM areaportals ap;
  EXECUTE PROCEDURE flood_areas;
  EXECUTE PROCEDURE spawn_map_ents(skill, spawnpoint);
  UPDATE lightstyles l SET l.base_pattern = l.pattern;
  -- the level name
  UPDATE player p SET p.cprint = (SELECT g.level_msg FROM game g WHERE g.id = 1), p.cprint_time = 3 WHERE p.id = 1;
END^

SET TERM ; ^
