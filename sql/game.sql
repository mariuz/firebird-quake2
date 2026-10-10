-- game.sql – the game DLL (g_*.c), in PSQL. Part 1: utilities, movers
-- (g_func.c), triggers and targets (g_trigger.c, g_target.c), items
-- (g_items.c), damage (g_combat.c), projectiles (g_weapon.c), touching,
-- and spawning the map's entities (g_spawn.c). weapons.sql has the player
-- (p_client.c, p_weapon.c); monsters.sql the AI and the per-tic driver.

SET TERM ^ ;

-- forward declarations (signatures must not change)
CREATE OR ALTER PROCEDURE t_damage (targ INTEGER, inflictor INTEGER, attacker INTEGER, damage INTEGER, knockback INTEGER, dflags INTEGER) AS BEGIN END^
CREATE OR ALTER PROCEDURE use_targets (eid INTEGER, activator INTEGER) AS BEGIN END^
CREATE OR ALTER PROCEDURE monster_die (eid INTEGER, attacker INTEGER) AS BEGIN END^
CREATE OR ALTER PROCEDURE monster_pain (eid INTEGER, attacker INTEGER, damage INTEGER) AS BEGIN END^
CREATE OR ALTER PROCEDURE teleport_touch (trig INTEGER, other INTEGER) AS BEGIN END^
CREATE OR ALTER PROCEDURE door_use (eid INTEGER, activator INTEGER) AS BEGIN END^
CREATE OR ALTER PROCEDURE plat_go_down (eid INTEGER) AS BEGIN END^
CREATE OR ALTER PROCEDURE plat_go_up (eid INTEGER) AS BEGIN END^
CREATE OR ALTER PROCEDURE trigger_fire (eid INTEGER, activator INTEGER) AS BEGIN END^
CREATE OR ALTER PROCEDURE counter_use (eid INTEGER, activator INTEGER) AS BEGIN END^
CREATE OR ALTER PROCEDURE changelevel (eid INTEGER) AS BEGIN END^
CREATE OR ALTER PROCEDURE button_fire (eid INTEGER, activator INTEGER) AS BEGIN END^
CREATE OR ALTER PROCEDURE train_next (eid INTEGER) AS BEGIN END^
CREATE OR ALTER PROCEDURE t_radius_damage (inflictor INTEGER, attacker INTEGER, damage DOUBLE PRECISION, ignore INTEGER, radius DOUBLE PRECISION) AS BEGIN END^
CREATE OR ALTER PROCEDURE monster_think (eid INTEGER) AS BEGIN END^
CREATE OR ALTER PROCEDURE player_fire (btn SMALLINT) AS BEGIN END^
CREATE OR ALTER PROCEDURE become_explosion (eid INTEGER, kind SMALLINT) AS BEGIN END^
CREATE OR ALTER PROCEDURE monster_wake (eid INTEGER, activator INTEGER) AS BEGIN END^
CREATE OR ALTER PROCEDURE monster_dodge (eid INTEGER, attacker INTEGER, eta DOUBLE PRECISION) AS BEGIN END^
CREATE OR ALTER PROCEDURE launch_rocket (owner INTEGER, ox DOUBLE PRECISION, oy DOUBLE PRECISION, oz DOUBLE PRECISION,
  dx DOUBLE PRECISION, dy DOUBLE PRECISION, dz DOUBLE PRECISION, spd DOUBLE PRECISION, dmg INTEGER, radius_dmg INTEGER, radius DOUBLE PRECISION) AS BEGIN END^
CREATE OR ALTER PROCEDURE spawn_map_ents (skill SMALLINT, spawnpoint VARCHAR(40), only_id INTEGER) AS BEGIN END^
CREATE OR ALTER FUNCTION find_target (eid INTEGER) RETURNS SMALLINT AS BEGIN RETURN 0; END^

-- ── utilities ─────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE snd (eid INTEGER, chan SMALLINT, name VARCHAR(64), vol DOUBLE PRECISION, attn DOUBLE PRECISION)
AS
DECLARE x DOUBLE PRECISION; DECLARE y DOUBLE PRECISION; DECLARE z DOUBLE PRECISION; DECLARE tic INTEGER;
BEGIN
  IF (name IS NULL) THEN EXIT;
  name = TRIM(name);   -- IIF/CASE over literals of different lengths pads the shorter one
  SELECT e.x + (e.minx + e.maxx) / 2, e.y + (e.miny + e.maxy) / 2, e.z + (e.minz + e.maxz) / 2 FROM ents e WHERE e.id = :eid INTO x, y, z;
  SELECT g.tic FROM game g WHERE g.id = 1 INTO tic;
  INSERT INTO sound_events (id, tic, ent_id, chan, snd, vol, attn, x, y, z)
    VALUES (NEXT VALUE FOR sound_seq, :tic, :eid, :chan, :name, :vol, :attn, :x, :y, :z);
END^

CREATE OR ALTER PROCEDURE snd_at (x DOUBLE PRECISION, y DOUBLE PRECISION, z DOUBLE PRECISION, name VARCHAR(64), vol DOUBLE PRECISION, attn DOUBLE PRECISION)
AS
DECLARE tic INTEGER;
BEGIN
  IF (name IS NULL) THEN EXIT;
  SELECT g.tic FROM game g WHERE g.id = 1 INTO tic;
  INSERT INTO sound_events (id, tic, ent_id, chan, snd, vol, attn, x, y, z)
    VALUES (NEXT VALUE FOR sound_seq, :tic, NULL, 0, TRIM(:name), :vol, :attn, :x, :y, :z);
END^

CREATE OR ALTER PROCEDURE fx (kind SMALLINT, x DOUBLE PRECISION, y DOUBLE PRECISION, z DOUBLE PRECISION,
  x2 DOUBLE PRECISION, y2 DOUBLE PRECISION, z2 DOUBLE PRECISION, n INTEGER)
AS
DECLARE tic INTEGER;
BEGIN
  SELECT g.tic FROM game g WHERE g.id = 1 INTO tic;
  INSERT INTO fx_events (id, tic, kind, x, y, z, x2, y2, z2, n) VALUES (NEXT VALUE FOR fx_seq, :tic, :kind, :x, :y, :z, :x2, :y2, :z2, :n);
END^

CREATE OR ALTER PROCEDURE cprint (msg VARCHAR(400))
AS
BEGIN
  UPDATE player p SET p.cprint = :msg, p.cprint_time = (SELECT g.time_ FROM game g WHERE g.id = 1) + 3 WHERE p.id = 1;
END^

CREATE OR ALTER PROCEDURE sprint (msg VARCHAR(200))
AS
BEGIN
  UPDATE player p SET p.msg = :msg, p.msg_time = (SELECT g.time_ FROM game g WHERE g.id = 1) + 3 WHERE p.id = 1;
END^

CREATE OR ALTER FUNCTION now_ () RETURNS DOUBLE PRECISION
AS
DECLARE t DOUBLE PRECISION;
BEGIN
  SELECT g.time_ FROM game g WHERE g.id = 1 INTO t;
  RETURN t;
END^

CREATE OR ALTER FUNCTION player_ent () RETURNS INTEGER
AS
DECLARE e INTEGER;
BEGIN
  SELECT p.ent_id FROM player p WHERE p.id = 1 INTO e;
  RETURN e;
END^

CREATE OR ALTER FUNCTION model_by_name (name VARCHAR(64)) RETURNS INTEGER
AS
DECLARE id INTEGER;
BEGIN
  SELECT FIRST 1 m.id FROM models m WHERE m.name = :name ORDER BY m.id DESC INTO id;
  RETURN id;
END^

CREATE OR ALTER FUNCTION vlen (x DOUBLE PRECISION, y DOUBLE PRECISION, z DOUBLE PRECISION) RETURNS DOUBLE PRECISION
AS
BEGIN
  RETURN SQRT(x * x + y * y + z * z);
END^

CREATE OR ALTER FUNCTION vectoyaw (x DOUBLE PRECISION, y DOUBLE PRECISION) RETURNS DOUBLE PRECISION
AS
DECLARE a DOUBLE PRECISION;
BEGIN
  IF (x = 0 AND y = 0) THEN RETURN 0;
  a = ATAN2(y, x) * 57.29577951308232e0;
  IF (a < 0) THEN a = a + 360;
  RETURN a;
END^

CREATE OR ALTER FUNCTION anglemod (a DOUBLE PRECISION) RETURNS DOUBLE PRECISION
AS
BEGIN
  RETURN a - 360 * FLOOR(a / 360);
END^

-- crandom(): -1..1
CREATE OR ALTER FUNCTION crand () RETURNS DOUBLE PRECISION
AS
BEGIN
  RETURN RAND() * 2 - 1;
END^

-- the distance between two entities, classified as range(): 0 melee 1 near 2 mid 3 far
CREATE OR ALTER FUNCTION ent_range (a INTEGER, b INTEGER) RETURNS INTEGER
AS
DECLARE d DOUBLE PRECISION;
BEGIN
  SELECT vlen(e1.x - e2.x, e1.y - e2.y, e1.z - e2.z) FROM ents e1 CROSS JOIN ents e2 WHERE e1.id = :a AND e2.id = :b INTO d;
  IF (d IS NULL) THEN RETURN 3;
  RETURN CASE WHEN d < 80 THEN 0 WHEN d < 500 THEN 1 WHEN d < 1000 THEN 2 ELSE 3 END;
END^

-- visible(): a clear line between the eyes (MASK_OPAQUE)
CREATE OR ALTER FUNCTION visible (a INTEGER, b INTEGER) RETURNS SMALLINT
AS
DECLARE x1 DOUBLE PRECISION; DECLARE y1 DOUBLE PRECISION; DECLARE z1 DOUBLE PRECISION;
DECLARE x2 DOUBLE PRECISION; DECLARE y2 DOUBLE PRECISION; DECLARE z2 DOUBLE PRECISION;
DECLARE f DOUBLE PRECISION; DECLARE ex DOUBLE PRECISION; DECLARE ey DOUBLE PRECISION; DECLARE ez DOUBLE PRECISION;
DECLARE nx DOUBLE PRECISION; DECLARE ny DOUBLE PRECISION; DECLARE nz DOUBLE PRECISION;
DECLARE sf INTEGER; DECLARE ct INTEGER; DECLARE als SMALLINT; DECLARE sts SMALLINT; DECLARE hit INTEGER;
BEGIN
  SELECT e.x, e.y, e.z + e.viewheight FROM ents e WHERE e.id = :a INTO x1, y1, z1;
  SELECT e.x, e.y, e.z + e.viewheight FROM ents e WHERE e.id = :b INTO x2, y2, z2;
  IF (x1 IS NULL OR x2 IS NULL) THEN RETURN 0;
  EXECUTE PROCEDURE trace_move(NULL, 0, 0, 0, 0, 0, 0, x1, y1, z1, x2, y2, z2, 25)
    RETURNING_VALUES f, ex, ey, ez, nx, ny, nz, sf, ct, als, sts, hit;
  RETURN IIF(f = 1, 1, 0);
END^

-- visible() to a spot with no height of its own (a trail marker)
CREATE OR ALTER FUNCTION visible_point (a INTEGER, x2 DOUBLE PRECISION, y2 DOUBLE PRECISION, z2 DOUBLE PRECISION) RETURNS SMALLINT
AS
DECLARE x1 DOUBLE PRECISION; DECLARE y1 DOUBLE PRECISION; DECLARE z1 DOUBLE PRECISION;
DECLARE f DOUBLE PRECISION; DECLARE ex DOUBLE PRECISION; DECLARE ey DOUBLE PRECISION; DECLARE ez DOUBLE PRECISION;
DECLARE nx DOUBLE PRECISION; DECLARE ny DOUBLE PRECISION; DECLARE nz DOUBLE PRECISION;
DECLARE sf INTEGER; DECLARE ct INTEGER; DECLARE als SMALLINT; DECLARE sts SMALLINT; DECLARE hit INTEGER;
BEGIN
  SELECT e.x, e.y, e.z + e.viewheight FROM ents e WHERE e.id = :a INTO x1, y1, z1;
  IF (x1 IS NULL OR x2 IS NULL) THEN RETURN 0;
  EXECUTE PROCEDURE trace_move(NULL, 0, 0, 0, 0, 0, 0, x1, y1, z1, x2, y2, z2, 25)
    RETURNING_VALUES f, ex, ey, ez, nx, ny, nz, sf, ct, als, sts, hit;
  RETURN IIF(f = 1, 1, 0);
END^

CREATE OR ALTER FUNCTION infront (a INTEGER, b INTEGER) RETURNS SMALLINT
AS
DECLARE d DOUBLE PRECISION;
BEGIN
  SELECT (COS(e1.yaw * 0.0174532925e0) * (e2.x - e1.x) + SIN(e1.yaw * 0.0174532925e0) * (e2.y - e1.y))
         / MAXVALUE(1e-3, vlen(e2.x - e1.x, e2.y - e1.y, 0))
    FROM ents e1 CROSS JOIN ents e2 WHERE e1.id = :a AND e2.id = :b INTO d;
  RETURN IIF(d > 0.3e0, 1, 0);
END^

-- ── entities ─────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE spawn_ent (cls VARCHAR(40), x DOUBLE PRECISION, y DOUBLE PRECISION, z DOUBLE PRECISION)
RETURNS (id INTEGER)
AS
BEGIN
  id = NEXT VALUE FOR ent_seq;
  INSERT INTO ents (id, classname, x, y, z) VALUES (:id, :cls, :x, :y, :z);
  SUSPEND;
END^

CREATE OR ALTER PROCEDURE remove_ent (eid INTEGER)
AS
BEGIN
  DELETE FROM ents e WHERE e.id = :eid;
  UPDATE ents e SET e.enemy_id = NULL WHERE e.enemy_id = :eid;
END^

-- setmodel(): for brush models also setsize() from the model's bounds
CREATE OR ALTER PROCEDURE set_model (eid INTEGER, name VARCHAR(64))
AS
DECLARE mid INTEGER; DECLARE kind CHAR(1); DECLARE rad DOUBLE PRECISION;
DECLARE a DOUBLE PRECISION; DECLARE b DOUBLE PRECISION; DECLARE c DOUBLE PRECISION;
DECLARE d DOUBLE PRECISION; DECLARE e_ DOUBLE PRECISION; DECLARE f DOUBLE PRECISION;
BEGIN
  SELECT FIRST 1 m.id, m.kind, m.radius, m.minx, m.miny, m.minz, m.maxx, m.maxy, m.maxz FROM models m WHERE m.name = :name ORDER BY m.id DESC
    INTO mid, kind, rad, a, b, c, d, e_, f;
  IF (mid IS NULL) THEN
  BEGIN
    UPDATE ents e SET e.model_id = NULL, e.mkind = NULL WHERE e.id = :eid;
    EXIT;
  END
  -- (the kind and radius ride on the entity row so the frame never joins models)
  IF (kind = 'B') THEN
    UPDATE ents e SET e.model_id = :mid, e.mkind = :kind, e.mradius = :rad, e.minx = :a, e.miny = :b, e.minz = :c, e.maxx = :d, e.maxy = :e_, e.maxz = :f WHERE e.id = :eid;
  ELSE
    UPDATE ents e SET e.model_id = :mid, e.mkind = :kind, e.mradius = :rad WHERE e.id = :eid;
END^

CREATE OR ALTER PROCEDURE set_size (eid INTEGER, a DOUBLE PRECISION, b DOUBLE PRECISION, c DOUBLE PRECISION,
  d DOUBLE PRECISION, e_ DOUBLE PRECISION, f DOUBLE PRECISION)
AS
BEGIN
  UPDATE ents e SET e.minx = :a, e.miny = :b, e.minz = :c, e.maxx = :d, e.maxy = :e_, e.maxz = :f WHERE e.id = :eid;
END^

-- G_SetMovedir: angle -1 up, -2 down, else a yaw
CREATE OR ALTER PROCEDURE movedir (angle DOUBLE PRECISION) RETURNS (dx DOUBLE PRECISION, dy DOUBLE PRECISION, dz DOUBLE PRECISION)
AS
BEGIN
  dx = 0; dy = 0; dz = 0;
  IF (angle = -1) THEN dz = 1;
  ELSE IF (angle = -2) THEN dz = -1;
  ELSE
  BEGIN
    dx = COS(COALESCE(angle, 0) * 0.0174532925e0);
    dy = SIN(COALESCE(angle, 0) * 0.0174532925e0);
  END
  SUSPEND;
END^

-- droptofloor(): settle an item or monster onto the ground below
CREATE OR ALTER PROCEDURE drop_to_floor (eid INTEGER)
AS
DECLARE px DOUBLE PRECISION; DECLARE py DOUBLE PRECISION; DECLARE pz DOUBLE PRECISION;
DECLARE mnx DOUBLE PRECISION; DECLARE mny DOUBLE PRECISION; DECLARE mnz DOUBLE PRECISION;
DECLARE mxx DOUBLE PRECISION; DECLARE mxy DOUBLE PRECISION; DECLARE mxz DOUBLE PRECISION;
DECLARE f DOUBLE PRECISION; DECLARE ex DOUBLE PRECISION; DECLARE ey DOUBLE PRECISION; DECLARE ez DOUBLE PRECISION;
DECLARE nx DOUBLE PRECISION; DECLARE ny DOUBLE PRECISION; DECLARE nz DOUBLE PRECISION;
DECLARE sf INTEGER; DECLARE ct INTEGER; DECLARE als SMALLINT; DECLARE sts SMALLINT; DECLARE hit INTEGER;
BEGIN
  SELECT e.x, e.y, e.z, e.minx, e.miny, e.minz, e.maxx, e.maxy, e.maxz FROM ents e WHERE e.id = :eid
    INTO px, py, pz, mnx, mny, mnz, mxx, mxy, mxz;
  -- M_droptofloor starts a unit up: a thing placed exactly on the floor would otherwise start in solid
  EXECUTE PROCEDURE trace_move(eid, mnx, mny, mnz, mxx, mxy, mxz, px, py, pz + 1, px, py, pz - 256, 3)
    RETURNING_VALUES f, ex, ey, ez, nx, ny, nz, sf, ct, als, sts, hit;
  IF (f < 1 AND als = 0) THEN
    UPDATE ents e SET e.z = :ez, e.flags = BIN_OR(e.flags, 512) WHERE e.id = :eid;
  ELSE IF (als = 1) THEN
    UPDATE ents e SET e.flags = BIN_OR(e.flags, 512) WHERE e.id = :eid;   -- embedded in the floor: it stands, it does not fall
  EXECUTE PROCEDURE link_ent(eid);
END^

-- Move_Calc: start moving a pusher toward a destination at `spd` units per second
CREATE OR ALTER PROCEDURE calc_move (eid INTEGER, tx DOUBLE PRECISION, ty DOUBLE PRECISION, tz DOUBLE PRECISION,
  spd DOUBLE PRECISION, done VARCHAR(24))
AS
DECLARE px DOUBLE PRECISION; DECLARE py DOUBLE PRECISION; DECLARE pz DOUBLE PRECISION; DECLARE lt DOUBLE PRECISION;
DECLARE len DOUBLE PRECISION; DECLARE tt DOUBLE PRECISION;
BEGIN
  SELECT e.x, e.y, e.z, e.ltime FROM ents e WHERE e.id = :eid INTO px, py, pz, lt;
  len = vlen(tx - px, ty - py, tz - pz);
  IF (spd <= 0) THEN spd = 100;
  tt = len / spd;
  IF (tt < 0.05e0) THEN
  BEGIN
    UPDATE ents e SET e.vx = 0, e.vy = 0, e.vz = 0, e.dstx = :tx, e.dsty = :ty, e.dstz = :tz,
           e.mv_done = :done, e.mv_time = :lt + 0.05e0, e.nextthink = NULL, e.think = NULL WHERE e.id = :eid;
    EXIT;
  END
  UPDATE ents e SET e.vx = (:tx - :px) / :tt, e.vy = (:ty - :py) / :tt, e.vz = (:tz - :pz) / :tt,
         e.dstx = :tx, e.dsty = :ty, e.dstz = :tz, e.mv_done = :done, e.mv_time = :lt + :tt, e.nextthink = NULL, e.think = NULL
   WHERE e.id = :eid;
END^

-- AngleMove_Calc: turn a rotating pusher toward destination angles at `spd` degrees per second
CREATE OR ALTER PROCEDURE calc_angle_move (eid INTEGER, tp DOUBLE PRECISION, ty DOUBLE PRECISION, tr DOUBLE PRECISION,
  spd DOUBLE PRECISION, done VARCHAR(24))
AS
DECLARE cp DOUBLE PRECISION; DECLARE cy DOUBLE PRECISION; DECLARE cr DOUBLE PRECISION; DECLARE lt DOUBLE PRECISION;
DECLARE len DOUBLE PRECISION; DECLARE tt DOUBLE PRECISION;
BEGIN
  SELECT e.pitch, e.yaw, e.roll, e.ltime FROM ents e WHERE e.id = :eid INTO cp, cy, cr, lt;
  len = vlen(tp - cp, ty - cy, tr - cr);
  IF (spd <= 0) THEN spd = 100;
  tt = len / spd;
  IF (tt < 0.05e0) THEN
  BEGIN
    UPDATE ents e SET e.avel_pitch = 0, e.avel_yaw = 0, e.avel_roll = 0, e.dstx = :tp, e.dsty = :ty, e.dstz = :tr,
           e.mv_done = :done, e.mv_time = :lt + 0.05e0, e.nextthink = NULL, e.think = NULL, e.count_ = 1 WHERE e.id = :eid;
    EXIT;
  END
  UPDATE ents e SET e.avel_pitch = (:tp - :cp) / :tt, e.avel_yaw = (:ty - :cy) / :tt, e.avel_roll = (:tr - :cr) / :tt,
         e.dstx = :tp, e.dsty = :ty, e.dstz = :tr, e.mv_done = :done, e.mv_time = :lt + :tt, e.nextthink = NULL, e.think = NULL, e.count_ = 1
   WHERE e.id = :eid;
END^

-- ── doors (g_func.c) ──────────────────────────────────────────────────────
-- A door's "team" moves together: linked_id is the team master.
CREATE OR ALTER PROCEDURE door_go_down (eid INTEGER)
AS
DECLARE n1 VARCHAR(64); DECLARE spd DOUBLE PRECISION; DECLARE mh INTEGER; DECLARE cls VARCHAR(40);
BEGIN
  SELECT e.noise1, e.speed, e.max_health, e.classname FROM ents e WHERE e.id = :eid INTO n1, spd, mh, cls;
  EXECUTE PROCEDURE snd(eid, 0, n1, 1, 1);
  UPDATE ents e SET e.mv_state = 3, e.health = IIF(e.max_health > 0, e.max_health, e.health),
         e.takedamage = IIF(e.max_health > 0, 1, e.takedamage) WHERE e.id = :eid;
  IF (cls = 'func_door_rotating') THEN
    EXECUTE PROCEDURE calc_angle_move(eid, (SELECT e.p1x FROM ents e WHERE e.id = :eid), (SELECT e.p1y FROM ents e WHERE e.id = :eid),
      (SELECT e.p1z FROM ents e WHERE e.id = :eid), spd, 'door_hit_bottom');
  ELSE
    EXECUTE PROCEDURE calc_move(eid, (SELECT e.p1x FROM ents e WHERE e.id = :eid), (SELECT e.p1y FROM ents e WHERE e.id = :eid),
      (SELECT e.p1z FROM ents e WHERE e.id = :eid), spd, 'door_hit_bottom');
END^

-- FloodAreaConnections: areas reachable through open portals share a flood number. A change
-- forgets the marked view, since the eye may now see more, or less.
CREATE OR ALTER PROCEDURE flood_areas
AS
DECLARE a INTEGER; DECLARE n INTEGER = 0; DECLARE other INTEGER; DECLARE grew SMALLINT;
BEGIN
  DELETE FROM area_flood;
  FOR SELECT ar.id FROM areas ar ORDER BY ar.id INTO a
  DO
  BEGIN
    IF (EXISTS (SELECT 1 FROM area_flood f WHERE f.area = :a)) THEN CONTINUE;
    n = n + 1;
    INSERT INTO area_flood (area, flood) VALUES (:a, :n);
    grew = 1;
    WHILE (grew = 1) DO
    BEGIN
      grew = 0;
      FOR SELECT DISTINCT ap.other_area
            FROM area_flood f JOIN areas ar ON ar.id = f.area
            JOIN areaportals ap ON ap.id >= ar.first_ap AND ap.id < ar.first_ap + ar.num_ap
            JOIN portal_state ps ON ps.portal = ap.portal AND ps.open_ = 1
           WHERE f.flood = :n AND NOT EXISTS (SELECT 1 FROM area_flood f2 WHERE f2.area = ap.other_area)
            INTO other
      DO
      BEGIN
        INSERT INTO area_flood (area, flood) VALUES (:other, :n);
        grew = 1;
      END
    END
  END
  -- the kept face sets whose area's connections changed are stale; if the eye's own went, it is marked afresh
  DELETE FROM vis_sets s
   WHERE s.areas IS DISTINCT FROM (SELECT LIST(x.area, ',') FROM (SELECT f2.area FROM area_flood f2
                                     WHERE f2.flood = (SELECT f1.flood FROM area_flood f1 WHERE f1.area = s.area) ORDER BY f2.area) x);
  UPDATE viewcfg c SET c.vis_cluster = NULL, c.world_lst = NULL WHERE c.id = 1 AND NOT EXISTS (SELECT 1 FROM vis_sets s WHERE s.slot = c.vis_slot);
END^

-- gi.SetAreaPortalState
CREATE OR ALTER PROCEDURE set_portal_state (portal INTEGER, open_ SMALLINT)
AS
BEGIN
  IF (portal IS NULL) THEN EXIT;
  IF (EXISTS (SELECT 1 FROM portal_state p WHERE p.portal = :portal AND p.open_ = :open_)) THEN EXIT;
  UPDATE OR INSERT INTO portal_state (portal, open_) VALUES (:portal, :open_) MATCHING (portal);
  EXECUTE PROCEDURE flood_areas;
END^

-- door_use_areaportals: the func_areaportals a door targets follow it open and closed
CREATE OR ALTER PROCEDURE door_use_areaportals (eid INTEGER, open_ SMALLINT)
AS
DECLARE sty INTEGER; DECLARE tgt VARCHAR(40);
BEGIN
  SELECT e.target FROM ents e WHERE e.id = :eid INTO tgt;
  IF (tgt IS NULL OR tgt = '') THEN EXIT;
  FOR SELECT a.style FROM ents a WHERE a.targetname = :tgt AND a.classname = 'func_areaportal' INTO sty
  DO EXECUTE PROCEDURE set_portal_state(sty, open_);
END^

-- Use_Areaportal: anything but a door toggles the portal (doors set it as they move, above)
CREATE OR ALTER PROCEDURE areaportal_use (t INTEGER, user_ INTEGER)
AS
DECLARE ucls VARCHAR(40); DECLARE sty INTEGER; DECLARE st INTEGER;
BEGIN
  SELECT e.classname FROM ents e WHERE e.id = :user_ INTO ucls;
  IF (ucls IN ('func_door', 'func_door_rotating')) THEN EXIT;
  UPDATE ents e SET e.count_ = 1 - COALESCE(e.count_, 0) WHERE e.id = :t RETURNING e.style, e.count_ INTO sty, st;
  EXECUTE PROCEDURE set_portal_state(sty, st);
END^

CREATE OR ALTER PROCEDURE door_go_up (eid INTEGER, activator INTEGER)
AS
DECLARE n1 VARCHAR(64); DECLARE spd DOUBLE PRECISION; DECLARE st SMALLINT; DECLARE cls VARCHAR(40);
BEGIN
  SELECT e.noise1, e.speed, e.mv_state, e.classname FROM ents e WHERE e.id = :eid INTO n1, spd, st, cls;
  IF (st = 2) THEN EXIT;                         -- already going up
  IF (st = 0) THEN                               -- reset top wait time
  BEGIN
    UPDATE ents e SET e.nextthink = e.ltime + e.wait_, e.think = 'door_go_down' WHERE e.id = :eid AND e.wait_ >= 0;
    EXIT;
  END
  EXECUTE PROCEDURE snd(eid, 0, n1, 1, 1);
  UPDATE ents e SET e.mv_state = 2 WHERE e.id = :eid;
  EXECUTE PROCEDURE door_use_areaportals(eid, 1);
  IF (cls = 'func_door_rotating') THEN
    EXECUTE PROCEDURE calc_angle_move(eid, (SELECT e.p2x FROM ents e WHERE e.id = :eid), (SELECT e.p2y FROM ents e WHERE e.id = :eid),
      (SELECT e.p2z FROM ents e WHERE e.id = :eid), spd, 'door_hit_top');
  ELSE
    EXECUTE PROCEDURE calc_move(eid, (SELECT e.p2x FROM ents e WHERE e.id = :eid), (SELECT e.p2y FROM ents e WHERE e.id = :eid),
      (SELECT e.p2z FROM ents e WHERE e.id = :eid), spd, 'door_hit_top');
  EXECUTE PROCEDURE use_targets(eid, activator);
END^

CREATE OR ALTER PROCEDURE door_hit_top (eid INTEGER)
AS
DECLARE n3 VARCHAR(64);
BEGIN
  SELECT e.noise3 FROM ents e WHERE e.id = :eid INTO n3;
  EXECUTE PROCEDURE snd(eid, 0, n3, 1, 1);
  UPDATE ents e SET e.mv_state = 0 WHERE e.id = :eid;
  UPDATE ents e SET e.nextthink = e.ltime + e.wait_, e.think = 'door_go_down' WHERE e.id = :eid AND e.wait_ >= 0 AND BIN_AND(e.spawnflags, 32) = 0;
END^

CREATE OR ALTER PROCEDURE door_hit_bottom (eid INTEGER)
AS
DECLARE n3 VARCHAR(64);
BEGIN
  SELECT e.noise3 FROM ents e WHERE e.id = :eid INTO n3;
  EXECUTE PROCEDURE snd(eid, 0, n3, 1, 1);
  UPDATE ents e SET e.mv_state = 1 WHERE e.id = :eid;
  EXECUTE PROCEDURE door_use_areaportals(eid, 0);
END^

-- door_use: fire the whole team
CREATE OR ALTER PROCEDURE door_use (eid INTEGER, activator INTEGER)
AS
DECLARE master INTEGER; DECLARE d INTEGER; DECLARE st SMALLINT; DECLARE sf INTEGER;
BEGIN
  SELECT COALESCE(e.linked_id, e.id), e.spawnflags FROM ents e WHERE e.id = :eid INTO master, sf;
  SELECT e.mv_state FROM ents e WHERE e.id = :master INTO st;
  IF (BIN_AND(sf, 32) <> 0 AND st IN (0, 2)) THEN         -- DOOR_TOGGLE: close
  BEGIN
    FOR SELECT e.id FROM ents e WHERE COALESCE(e.linked_id, e.id) = :master AND e.classname IN ('func_door', 'func_door_rotating', 'func_water') INTO d DO
      EXECUTE PROCEDURE door_go_down(d);
    EXIT;
  END
  FOR SELECT e.id FROM ents e WHERE COALESCE(e.linked_id, e.id) = :master AND e.classname IN ('func_door', 'func_door_rotating', 'func_water') INTO d DO
    EXECUTE PROCEDURE door_go_up(d, activator);
END^

-- door_touch by the player: message doors
CREATE OR ALTER PROCEDURE door_touch (eid INTEGER, other INTEGER)
AS
DECLARE msg VARCHAR(400); DECLARE af DOUBLE PRECISION; DECLARE master INTEGER;
BEGIN
  IF (other <> player_ent()) THEN EXIT;
  SELECT COALESCE(e.linked_id, e.id) FROM ents e WHERE e.id = :eid INTO master;
  SELECT e.message, e.attack_finished FROM ents e WHERE e.id = :master INTO msg, af;
  IF (af > now_() OR msg IS NULL OR msg = '') THEN EXIT;
  UPDATE ents e SET e.attack_finished = now_() + 5 WHERE e.id = :master;
  EXECUTE PROCEDURE cprint(msg);
  EXECUTE PROCEDURE snd(other, 2, 'misc/talk1.wav', 1, 1);
END^

-- door_blocked / plat_blocked: hurt and reverse (crushers don't reverse)
-- A pusher that cannot move something out of its way (door_blocked, plat_blocked, train_blocked,
-- rotating_blocked in g_func.c). Doors, plats and trains first get rid of anything that is not a monster
-- or the player: a chance to go away on its own terms (gibs, barrels), else it explodes. A train hurts
-- a monster or the player at most every half second, and not at all with TRAIN_BLOCK_STOPS (dmg 0);
-- a door, plat or fan hurts every time, and a door or plat then turns back. Buttons hurt no one.
CREATE OR ALTER PROCEDURE mover_blocked (eid INTEGER, other INTEGER)
AS
DECLARE cls VARCHAR(40); DECLARE st SMALLINT; DECLARE dmg INTEGER; DECLARE wt DOUBLE PRECISION; DECLARE sf INTEGER; DECLARE d INTEGER; DECLARE master INTEGER;
DECLARE deb DOUBLE PRECISION; DECLARE ox DOUBLE PRECISION; DECLARE oy DOUBLE PRECISION; DECLARE oz DOUBLE PRECISION;
BEGIN
  SELECT e.classname, e.mv_state, e.dmg, e.wait_, e.spawnflags, COALESCE(e.linked_id, e.id), e.attack_finished FROM ents e WHERE e.id = :eid
    INTO cls, st, dmg, wt, sf, master, deb;
  -- turret_blocked: what can be hurt is, by the team's dmg, in the driver's name (the turn is already undone)
  IF (cls IN ('turret_breach', 'turret_base')) THEN
  BEGIN
    IF (EXISTS (SELECT 1 FROM ents o WHERE o.id = :other AND o.takedamage > 0)) THEN
      EXECUTE PROCEDURE t_damage(other, eid, (SELECT COALESCE(m.owner_id, m.id) FROM ents m WHERE m.id = :master), (SELECT m.dmg FROM ents m WHERE m.id = :master), 10, 0);
    EXIT;
  END
  IF (cls NOT IN ('func_door', 'func_door_rotating', 'func_water', 'func_plat', 'func_train', 'func_rotating', 'func_door_secret')) THEN EXIT;
  IF (cls <> 'func_rotating' AND NOT EXISTS (SELECT 1 FROM ents o WHERE o.id = :other AND (o.mtype IS NOT NULL OR o.classname = 'player'))) THEN
  BEGIN
    EXECUTE PROCEDURE t_damage(other, eid, eid, 100000, 1, 0);
    -- if it's still there, nuke it (BecomeExplosion1)
    SELECT o.x + (o.minx + o.maxx) / 2, o.y + (o.miny + o.maxy) / 2, o.z + (o.minz + o.maxz) / 2 FROM ents o WHERE o.id = :other INTO ox, oy, oz;
    IF (ox IS NOT NULL) THEN
    BEGIN
      EXECUTE PROCEDURE fx(2, ox, oy, oz, 0, 0, 0, 0);
      EXECUTE PROCEDURE snd_at(ox, oy, oz, 'weapons/rocklx1a.wav', 1, 1);
      DELETE FROM ents o WHERE o.id = :other;
    END
    EXIT;
  END
  -- door_secret_blocked: hurts every half second and goes on
  IF (cls = 'func_door_secret') THEN
  BEGIN
    IF (now_() < deb) THEN EXIT;
    UPDATE ents e SET e.attack_finished = now_() + 0.5e0 WHERE e.id = :eid;
    EXECUTE PROCEDURE t_damage(other, eid, eid, dmg, 1, 0);
    EXIT;
  END
  IF (cls = 'func_train') THEN
  BEGIN
    IF (COALESCE(dmg, 0) = 0 OR now_() < deb) THEN EXIT;
    UPDATE ents e SET e.attack_finished = now_() + 0.5e0 WHERE e.id = :eid;   -- the touch debounce
    EXECUTE PROCEDURE t_damage(other, eid, eid, dmg, 1, 0);
    EXIT;
  END
  EXECUTE PROCEDURE t_damage(other, eid, eid, dmg, 1, 0);
  IF (cls IN ('func_door', 'func_door_rotating', 'func_water')) THEN
  BEGIN
    IF (BIN_AND(sf, 4) <> 0) THEN EXIT;          -- DOOR_CRUSHER
    -- a door with a negative wait would never come back if blocked: it squashes
    IF (wt >= 0) THEN
    FOR SELECT e.id FROM ents e WHERE COALESCE(e.linked_id, e.id) = :master AND e.classname = :cls INTO d DO
    BEGIN
      IF (st = 3) THEN EXECUTE PROCEDURE door_go_up(d, other); ELSE EXECUTE PROCEDURE door_go_down(d);
    END
  END
  ELSE IF (cls = 'func_plat') THEN
  BEGIN
    IF (st = 2) THEN EXECUTE PROCEDURE plat_go_down(eid); ELSE IF (st = 3) THEN EXECUTE PROCEDURE plat_go_up(eid);
  END
END^

-- KillBox: everything that can be hurt inside the entity's box dies (func_killbox, func_object's arrival)
CREATE OR ALTER PROCEDURE killbox (eid INTEGER)
AS
DECLARE o INTEGER;
BEGIN
  FOR SELECT o.id FROM ents o JOIN ents k ON k.id = :eid
       WHERE o.id <> :eid AND o.takedamage > 0 AND o.solid IN (2, 3)
         AND o.x + o.minx <= k.x + k.maxx AND o.x + o.maxx >= k.x + k.minx
         AND o.y + o.miny <= k.y + k.maxy AND o.y + o.maxy >= k.y + k.miny
         AND o.z + o.minz <= k.z + k.maxz AND o.z + o.maxz >= k.z + k.minz
        INTO o
  DO EXECUTE PROCEDURE t_damage(o, eid, eid, 100000, 0, 32);
END^

-- SP_func_object: a brush that falls. The box a unit smaller each way; with no spawnflags it drops after two
-- frames, with any it waits, solid-less and unseen, until used (it then kills what is in its way and drops).
CREATE OR ALTER PROCEDURE spawn_func_object (eid INTEGER, sf INTEGER, dmg INTEGER)
AS
BEGIN
  UPDATE ents e SET e.minx = e.minx + 1, e.miny = e.miny + 1, e.minz = e.minz + 1, e.maxx = e.maxx - 1, e.maxy = e.maxy - 1, e.maxz = e.maxz - 1,
         e.dmg = IIF(COALESCE(:dmg, 0) = 0, 100, :dmg), e.movetype = 7, e.clipmask = 33685507, e.spawnflags = :sf, e.ltime = 0,
         e.solid = IIF(:sf = 0, 4, 0), e.mkind = IIF(:sf = 0, e.mkind, NULL),
         e.think = IIF(:sf = 0, 'object_release', NULL), e.nextthink = IIF(:sf = 0, 0.2e0, NULL) WHERE e.id = :eid;
  EXECUTE PROCEDURE link_ent(eid);
END^

-- func_object_release: it falls (MOVETYPE_TOSS)
CREATE OR ALTER PROCEDURE object_release (eid INTEGER)
AS
BEGIN
  UPDATE ents e SET e.movetype = 6, e.think = NULL, e.nextthink = NULL, e.flags = BIN_AND(e.flags, BIN_NOT(512)) WHERE e.id = :eid;
END^

-- func_object_use: once
CREATE OR ALTER PROCEDURE object_use (eid INTEGER)
AS
BEGIN
  IF (NOT EXISTS (SELECT 1 FROM ents e WHERE e.id = :eid AND e.solid = 0 AND e.movetype = 7)) THEN EXIT;
  UPDATE ents e SET e.solid = 4, e.mkind = 'B' WHERE e.id = :eid;
  EXECUTE PROCEDURE killbox(eid);
  EXECUTE PROCEDURE object_release(eid);
END^

-- ── plats ────────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE plat_go_down (eid INTEGER)
AS
BEGIN
  EXECUTE PROCEDURE snd(eid, 0, (SELECT e.noise1 FROM ents e WHERE e.id = :eid), 1, 1);
  UPDATE ents e SET e.mv_state = 3 WHERE e.id = :eid;
  EXECUTE PROCEDURE calc_move(eid, (SELECT e.p2x FROM ents e WHERE e.id = :eid), (SELECT e.p2y FROM ents e WHERE e.id = :eid),
    (SELECT e.p2z FROM ents e WHERE e.id = :eid), (SELECT e.speed FROM ents e WHERE e.id = :eid), 'plat_hit_bottom');
END^

CREATE OR ALTER PROCEDURE plat_go_up (eid INTEGER)
AS
BEGIN
  EXECUTE PROCEDURE snd(eid, 0, (SELECT e.noise1 FROM ents e WHERE e.id = :eid), 1, 1);
  UPDATE ents e SET e.mv_state = 2 WHERE e.id = :eid;
  EXECUTE PROCEDURE calc_move(eid, (SELECT e.p1x FROM ents e WHERE e.id = :eid), (SELECT e.p1y FROM ents e WHERE e.id = :eid),
    (SELECT e.p1z FROM ents e WHERE e.id = :eid), (SELECT e.speed FROM ents e WHERE e.id = :eid), 'plat_hit_top');
END^

CREATE OR ALTER PROCEDURE plat_hit_top (eid INTEGER)
AS
BEGIN
  EXECUTE PROCEDURE snd(eid, 0, (SELECT e.noise3 FROM ents e WHERE e.id = :eid), 1, 1);
  UPDATE ents e SET e.mv_state = 0, e.think = 'plat_go_down', e.nextthink = e.ltime + 3 WHERE e.id = :eid;
END^

CREATE OR ALTER PROCEDURE plat_hit_bottom (eid INTEGER)
AS
BEGIN
  EXECUTE PROCEDURE snd(eid, 0, (SELECT e.noise3 FROM ents e WHERE e.id = :eid), 1, 1);
  UPDATE ents e SET e.mv_state = 1 WHERE e.id = :eid;
END^

-- ── buttons ─────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE button_fire (eid INTEGER, activator INTEGER)
AS
DECLARE st SMALLINT;
BEGIN
  SELECT e.mv_state FROM ents e WHERE e.id = :eid INTO st;
  IF (st IN (2, 0)) THEN EXIT;
  EXECUTE PROCEDURE snd(eid, 0, (SELECT e.noise1 FROM ents e WHERE e.id = :eid), 1, 2);
  UPDATE ents e SET e.mv_state = 2, e.enemy_id = :activator WHERE e.id = :eid;
  EXECUTE PROCEDURE calc_move(eid, (SELECT e.p2x FROM ents e WHERE e.id = :eid), (SELECT e.p2y FROM ents e WHERE e.id = :eid),
    (SELECT e.p2z FROM ents e WHERE e.id = :eid), (SELECT e.speed FROM ents e WHERE e.id = :eid), 'button_wait');
END^

CREATE OR ALTER PROCEDURE button_wait (eid INTEGER)
AS
DECLARE act INTEGER;
BEGIN
  SELECT e.enemy_id FROM ents e WHERE e.id = :eid INTO act;
  -- pressed: the texture's frames 2 and 3 (EF_ANIM23) instead of 0 and 1
  UPDATE ents e SET e.mv_state = 0, e.frame = 1, e.effects = BIN_OR(BIN_AND(e.effects, BIN_NOT(1024)), 2048) WHERE e.id = :eid;
  EXECUTE PROCEDURE use_targets(eid, COALESCE(act, player_ent()));
  UPDATE ents e SET e.think = 'button_return', e.nextthink = e.ltime + e.wait_ WHERE e.id = :eid AND e.wait_ >= 0;
END^

CREATE OR ALTER PROCEDURE button_return (eid INTEGER)
AS
BEGIN
  UPDATE ents e SET e.mv_state = 3, e.frame = 0 WHERE e.id = :eid;
  EXECUTE PROCEDURE calc_move(eid, (SELECT e.p1x FROM ents e WHERE e.id = :eid), (SELECT e.p1y FROM ents e WHERE e.id = :eid),
    (SELECT e.p1z FROM ents e WHERE e.id = :eid), (SELECT e.speed FROM ents e WHERE e.id = :eid), 'button_done');
  UPDATE ents e SET e.health = e.max_health, e.takedamage = IIF(e.max_health > 0, 1, 0) WHERE e.id = :eid;
END^

CREATE OR ALTER PROCEDURE button_done (eid INTEGER)
AS
BEGIN
  UPDATE ents e SET e.mv_state = 1, e.frame = 0, e.effects = BIN_OR(BIN_AND(e.effects, BIN_NOT(2048)), 1024) WHERE e.id = :eid;
END^

-- ── secret doors (func_door_secret): back, wait a second, aside; wait; back in, a second, home ──
-- door_secret_use: only from where it rests (Quake compared the origin with vec3_origin, which a brush
-- model without an origin brush rests at: here, where it was spawned). Secret doors move silently.
CREATE OR ALTER PROCEDURE door_secret_use (eid INTEGER)
AS
BEGIN
  IF (NOT EXISTS (SELECT 1 FROM ents e WHERE e.id = :eid AND e.x = e.spawn_x AND e.y = e.spawn_y AND e.z = e.spawn_z AND e.mv_done IS NULL)) THEN EXIT;
  EXECUTE PROCEDURE calc_move(eid, (SELECT e.p1x FROM ents e WHERE e.id = :eid), (SELECT e.p1y FROM ents e WHERE e.id = :eid),
    (SELECT e.p1z FROM ents e WHERE e.id = :eid), 50, 'door_secret_move1');
  EXECUTE PROCEDURE door_use_areaportals(eid, 1);
END^

-- door_secret_move1..6, door_secret_done: the steps, each scheduling the next (its wait: -1 stays open)
CREATE OR ALTER PROCEDURE door_secret_step (eid INTEGER, step VARCHAR(24))
AS
BEGIN
  IF (step = 'door_secret_move1') THEN
    UPDATE ents e SET e.think = 'door_secret_move2', e.nextthink = e.ltime + 1 WHERE e.id = :eid;
  ELSE IF (step = 'door_secret_move2') THEN
    EXECUTE PROCEDURE calc_move(eid, (SELECT e.p2x FROM ents e WHERE e.id = :eid), (SELECT e.p2y FROM ents e WHERE e.id = :eid),
      (SELECT e.p2z FROM ents e WHERE e.id = :eid), 50, 'door_secret_move3');
  ELSE IF (step = 'door_secret_move3') THEN
    UPDATE ents e SET e.think = 'door_secret_move4', e.nextthink = e.ltime + e.wait_ WHERE e.id = :eid AND e.wait_ <> -1;
  ELSE IF (step = 'door_secret_move4') THEN
    EXECUTE PROCEDURE calc_move(eid, (SELECT e.p1x FROM ents e WHERE e.id = :eid), (SELECT e.p1y FROM ents e WHERE e.id = :eid),
      (SELECT e.p1z FROM ents e WHERE e.id = :eid), 50, 'door_secret_move5');
  ELSE IF (step = 'door_secret_move5') THEN
    UPDATE ents e SET e.think = 'door_secret_move6', e.nextthink = e.ltime + 1 WHERE e.id = :eid;
  ELSE IF (step = 'door_secret_move6') THEN
    EXECUTE PROCEDURE calc_move(eid, (SELECT e.spawn_x FROM ents e WHERE e.id = :eid), (SELECT e.spawn_y FROM ents e WHERE e.id = :eid),
      (SELECT e.spawn_z FROM ents e WHERE e.id = :eid), 50, 'door_secret_done');
  ELSE IF (step = 'door_secret_done') THEN
  BEGIN
    -- one with no targetname, or ALWAYS_SHOOT, can be shot open again
    UPDATE ents e SET e.health = 0, e.takedamage = 1 WHERE e.id = :eid AND (e.targetname IS NULL OR e.targetname = '' OR BIN_AND(e.spawnflags, 1) <> 0);
    EXECUTE PROCEDURE door_use_areaportals(eid, 0);
  END
END^

-- ── trigger_elevator: a button names a path corner (its pathtarget); the elevator sends its train there ──
-- trigger_elevator_init: the train it moves (movetarget), a func_train or nothing
CREATE OR ALTER PROCEDURE elevator_init (eid INTEGER)
AS
BEGIN
  UPDATE ents e SET e.goal_id = (SELECT FIRST 1 t.id FROM ents t WHERE t.targetname = e.target AND t.classname = 'func_train')
   WHERE e.id = :eid AND e.target IS NOT NULL AND e.target <> '';
END^

-- trigger_elevator_use: not while the train moves or waits to; train_resume toward the corner
CREATE OR ALTER PROCEDURE elevator_use (eid INTEGER, other INTEGER)
AS
DECLARE train INTEGER; DECLARE pt VARCHAR(40); DECLARE corner INTEGER;
DECLARE cx DOUBLE PRECISION; DECLARE cy DOUBLE PRECISION; DECLARE cz DOUBLE PRECISION;
BEGIN
  SELECT e.goal_id FROM ents e WHERE e.id = :eid INTO train;
  IF (train IS NULL) THEN EXIT;
  IF (EXISTS (SELECT 1 FROM ents t WHERE t.id = :train AND (t.nextthink IS NOT NULL OR t.mv_done IS NOT NULL))) THEN EXIT;   -- busy
  SELECT e.pathtarget FROM ents e WHERE e.id = :other INTO pt;
  IF (pt IS NULL OR pt = '') THEN EXIT;
  SELECT FIRST 1 c.id, c.x, c.y, c.z FROM ents c WHERE c.targetname = :pt INTO corner, cx, cy, cz;
  IF (corner IS NULL) THEN EXIT;
  UPDATE ents t SET t.goal_id = :corner, t.mv_state = 2 WHERE t.id = :train;
  EXECUTE PROCEDURE calc_move(train, cx - (SELECT t.minx FROM ents t WHERE t.id = :train), cy - (SELECT t.miny FROM ents t WHERE t.id = :train),
    cz - (SELECT t.minz FROM ents t WHERE t.id = :train), (SELECT t.speed FROM ents t WHERE t.id = :train), 'train_wait');
END^

-- target_earthquake_think: every 0.1 s a grounded player is thrown up (speed × 100 / mass) and about
-- (±150 a side); the rumble every half second, heard everywhere. attack_finished is when it stops,
-- pausetime when it rumbles next.
CREATE OR ALTER PROCEDURE earthquake_think (eid INTEGER)
AS
DECLARE t DOUBLE PRECISION; DECLARE pe INTEGER; DECLARE spd DOUBLE PRECISION; DECLARE until_ DOUBLE PRECISION; DECLARE lm DOUBLE PRECISION;
DECLARE x DOUBLE PRECISION; DECLARE y DOUBLE PRECISION; DECLARE z DOUBLE PRECISION;
BEGIN
  t = now_();
  SELECT e.speed, e.attack_finished, e.pausetime, e.x, e.y, e.z FROM ents e WHERE e.id = :eid INTO spd, until_, lm, x, y, z;
  IF (COALESCE(lm, 0) < t) THEN
  BEGIN
    EXECUTE PROCEDURE snd_at(x, y, z, 'world/quake.wav', 1, 0);
    UPDATE ents e SET e.pausetime = :t + 0.5e0 WHERE e.id = :eid;
  END
  pe = player_ent();
  UPDATE ents e SET e.flags = BIN_AND(e.flags, BIN_NOT(512)), e.vx = e.vx + crand() * 150, e.vy = e.vy + crand() * 150,
         e.vz = :spd * (100e0 / e.mass) WHERE e.id = :pe AND BIN_AND(e.flags, 512) <> 0 AND e.deadflag = 0;
  IF (t < until_) THEN UPDATE ents e SET e.think = 'earthquake_think', e.nextthink = :t + 0.1e0 WHERE e.id = :eid;
END^

-- misc_viper_bomb_use: it shows up, falls (MOVETYPE_TOSS) along the viper's way at the viper's speed, a
-- rocket's trail behind it, and goes off on touching anything
CREATE OR ALTER PROCEDURE viper_bomb_use (eid INTEGER, activator INTEGER)
AS
DECLARE vx DOUBLE PRECISION; DECLARE vy DOUBLE PRECISION; DECLARE vz DOUBLE PRECISION; DECLARE l DOUBLE PRECISION; DECLARE spd DOUBLE PRECISION;
BEGIN
  IF (EXISTS (SELECT 1 FROM ents e WHERE e.id = :eid AND e.movetype <> 0)) THEN EXIT;   -- used once (its use is cleared)
  -- the viper's moveinfo.dir: the way it is flying
  SELECT FIRST 1 v.vx, v.vy, v.vz, v.speed FROM ents v WHERE v.classname = 'misc_viper' ORDER BY v.id INTO vx, vy, vz, spd;
  l = vlen(COALESCE(vx, 0), COALESCE(vy, 0), COALESCE(vz, 0));
  IF (l > 0) THEN BEGIN vx = vx / l; vy = vy / l; vz = vz / l; END ELSE BEGIN vx = 0; vy = 0; vz = 0; spd = 0; END
  EXECUTE PROCEDURE set_model(eid, 'models/objects/bomb/tris.md2');
  UPDATE ents e SET e.solid = 2, e.movetype = 6, e.clipmask = 3, e.effects = BIN_OR(e.effects, 16), e.enemy_id = :activator,
         e.vx = :vx * :spd, e.vy = :vy * :spd, e.vz = :vz * :spd, e.dstx = :vx, e.dsty = :vy, e.dstz = :vz, e.attack_finished = now_(),
         e.think = 'viper_bomb_think', e.nextthink = now_() WHERE e.id = :eid;
  EXECUTE PROCEDURE link_ent(eid);
END^

-- misc_viper_bomb_prethink: it noses over as it falls (its way scaled by 1 + the time to go, which runs to
-- -1, with that as its height) and spins about its axis
CREATE OR ALTER PROCEDURE viper_bomb_think (eid INTEGER)
AS
DECLARE d DOUBLE PRECISION; DECLARE ax DOUBLE PRECISION; DECLARE ay DOUBLE PRECISION; DECLARE az DOUBLE PRECISION; DECLARE h DOUBLE PRECISION;
BEGIN
  SELECT MAXVALUE(e.attack_finished - now_(), -1e0), e.dstx, e.dsty FROM ents e WHERE e.id = :eid INTO d, ax, ay;
  IF (d IS NULL) THEN EXIT;
  ax = ax * (1 + d); ay = ay * (1 + d); az = d;
  h = SQRT(ax * ax + ay * ay);
  UPDATE ents e SET e.yaw = IIF(:h = 0, e.yaw, vectoyaw(:ax, :ay)), e.pitch = ATAN2(:az, :h) * 57.29577951e0, e.roll = MOD(e.roll + 5, 360),
         e.think = 'viper_bomb_think', e.nextthink = now_() + 0.05e0 WHERE e.id = :eid;
END^

-- ── target_string and target_character: a message shown by brush models (digits, '-' and ':' as their
-- texture's frames 0..11, a blank 12), each character the `count`th of the string, all on one team ──
-- target_string_use
CREATE OR ALTER PROCEDURE target_string_use (eid INTEGER)
AS
DECLARE msg VARCHAR(400); DECLARE team VARCHAR(40); DECLARE l INTEGER; DECLARE n INTEGER; DECLARE ch VARCHAR(1); DECLARE c INTEGER; DECLARE fr INTEGER;
BEGIN
  SELECT COALESCE(e.message, ''), e.team FROM ents e WHERE e.id = :eid INTO msg, team;
  l = CHAR_LENGTH(msg);
  FOR SELECT e.id, e.count_ FROM ents e WHERE e.team = :team AND e.classname = 'target_character' AND e.count_ > 0 INTO c, n DO
  BEGIN
    n = n - 1;
    ch = IIF(n < l, SUBSTRING(msg FROM n + 1 FOR 1), '');
    fr = CASE WHEN ch BETWEEN '0' AND '9' THEN ASCII_VAL(ch) - 48 WHEN ch = '-' THEN 10 WHEN ch = ':' THEN 11 ELSE 12 END;
    UPDATE ents e SET e.frame = :fr WHERE e.id = :c AND e.frame <> :fr;
  END
END^

-- func_clock_format_countdown: "%2i", "%2i:%2i" or "%2i:%2i:%2i" with the minutes' and seconds' blanks made zeros
CREATE OR ALTER FUNCTION clock_format (style INTEGER, secs INTEGER) RETURNS VARCHAR(16)
AS
BEGIN
  IF (style = 0) THEN RETURN LPAD(secs, 2, ' ');
  IF (style = 1) THEN RETURN LPAD(secs / 60, 2, ' ') || ':' || LPAD(MOD(secs, 60), 2, '0');
  RETURN LPAD(secs / 3600, 2, ' ') || ':' || LPAD(MOD(secs / 60, 60), 2, '0') || ':' || LPAD(MOD(secs, 60), 2, '0');
END^

-- func_clock_reset: TIMER_UP counts from 0 to count, TIMER_DOWN from count to 0 (health the time, wait_ the end)
CREATE OR ALTER PROCEDURE clock_reset (eid INTEGER)
AS
BEGIN
  UPDATE ents e SET e.enemy_id = NULL,
         e.health = IIF(BIN_AND(e.spawnflags, 2) <> 0, e.count_, 0), e.wait_ = IIF(BIN_AND(e.spawnflags, 1) <> 0, e.count_, 0) WHERE e.id = :eid;
END^

-- func_clock_think: once a second the time (counted up, down, or the time of day) goes to its target_string;
-- a timer past its end fires its pathtarget (without its message), and only MULTI_USE starts over
-- (START_OFF then waits to be used again)
CREATE OR ALTER PROCEDURE clock_think (eid INTEGER)
AS
DECLARE sf INTEGER; DECLARE hp INTEGER; DECLARE wt DOUBLE PRECISION; DECLARE sty INTEGER; DECLARE tgt VARCHAR(40); DECLARE pt VARCHAR(40); DECLARE ts INTEGER;
DECLARE msg VARCHAR(16); DECLARE act INTEGER; DECLARE t DOUBLE PRECISION;
BEGIN
  SELECT e.spawnflags, e.health, e.wait_, e.style, e.target, e.pathtarget, e.enemy_id FROM ents e WHERE e.id = :eid INTO sf, hp, wt, sty, tgt, pt, act;
  SELECT FIRST 1 s.id FROM ents s WHERE s.targetname = :tgt AND s.classname = 'target_string' INTO ts;
  IF (ts IS NULL) THEN EXIT;
  t = now_();
  IF (BIN_AND(sf, 1) <> 0) THEN BEGIN msg = clock_format(sty, hp); hp = hp + 1; END
  ELSE IF (BIN_AND(sf, 2) <> 0) THEN BEGIN msg = clock_format(sty, hp); hp = hp - 1; END
  ELSE msg = clock_format(2, EXTRACT(HOUR FROM CURRENT_TIME) * 3600 + EXTRACT(MINUTE FROM CURRENT_TIME) * 60 + CAST(FLOOR(EXTRACT(SECOND FROM CURRENT_TIME)) AS INTEGER));
  UPDATE ents e SET e.health = :hp, e.message = :msg WHERE e.id = :eid;
  UPDATE ents s SET s.message = :msg WHERE s.id = :ts;
  EXECUTE PROCEDURE target_string_use(ts);
  IF ((BIN_AND(sf, 1) <> 0 AND hp > wt) OR (BIN_AND(sf, 2) <> 0 AND hp < wt)) THEN
  BEGIN
    IF (pt IS NOT NULL AND pt <> '') THEN
    BEGIN
      UPDATE ents e SET e.target = :pt, e.message = NULL WHERE e.id = :eid;
      EXECUTE PROCEDURE use_targets(eid, COALESCE(act, player_ent()));
      UPDATE ents e SET e.target = :tgt, e.message = :msg WHERE e.id = :eid;
    END
    IF (BIN_AND(sf, 8) = 0) THEN EXIT;
    EXECUTE PROCEDURE clock_reset(eid);
    IF (BIN_AND(sf, 4) <> 0) THEN EXIT;
  END
  UPDATE ents e SET e.think = 'clock_think', e.nextthink = :t + 1 WHERE e.id = :eid;
END^

-- func_clock_use: a START_OFF clock starts on its first use (and, MULTI_USE, on each use after it ended)
CREATE OR ALTER PROCEDURE clock_use (eid INTEGER, activator INTEGER)
AS
BEGIN
  IF (EXISTS (SELECT 1 FROM ents e WHERE e.id = :eid AND e.enemy_id IS NOT NULL)) THEN EXIT;
  UPDATE ents e SET e.enemy_id = :activator WHERE e.id = :eid;
  EXECUTE PROCEDURE clock_think(eid);
END^

-- ── turrets (g_turret.c): a breach that aims, a base that turns with it, an infantry driving ──
-- SnapToEights
CREATE OR ALTER FUNCTION snap8 (x DOUBLE PRECISION) RETURNS DOUBLE PRECISION
AS
BEGIN
  RETURN TRUNC(x * 8 + IIF(x * 8 > 0, 0.5e0, -0.5e0)) / 8e0;
END^

-- turret_breach_fire: a rocket of 100..150 from the muzzle along the breach's forward, at 550 + 50 × skill,
-- in the driver's name
CREATE OR ALTER PROCEDURE turret_breach_fire (eid INTEGER)
AS
DECLARE p DOUBLE PRECISION; DECLARE y DOUBLE PRECISION; DECLARE fx DOUBLE PRECISION; DECLARE fy DOUBLE PRECISION; DECLARE fz DOUBLE PRECISION;
DECLARE rx DOUBLE PRECISION; DECLARE ry DOUBLE PRECISION; DECLARE rz DOUBLE PRECISION; DECLARE ux DOUBLE PRECISION; DECLARE uy DOUBLE PRECISION; DECLARE uz DOUBLE PRECISION;
DECLARE sx DOUBLE PRECISION; DECLARE sy DOUBLE PRECISION; DECLARE sz DOUBLE PRECISION; DECLARE dmg INTEGER; DECLARE spd DOUBLE PRECISION; DECLARE own INTEGER;
BEGIN
  SELECT e.pitch * PI() / 180, e.yaw * PI() / 180, e.x + e.dstx * 0, e.y, e.z, COALESCE(m.owner_id, e.id)
    FROM ents e JOIN ents m ON m.id = COALESCE(e.linked_id, e.id) WHERE e.id = :eid INTO p, y, sx, sy, sz, own;
  -- AngleVectors (pitch positive downward)
  fx = COS(p) * COS(y); fy = COS(p) * SIN(y); fz = -SIN(p);
  rx = SIN(y); ry = -COS(y); rz = 0;
  ux = SIN(p) * COS(y); uy = SIN(p) * SIN(y); uz = COS(p);
  SELECT e.x + :fx * e.dstx + :rx * e.dsty + :ux * e.dstz, e.y + :fy * e.dstx + :ry * e.dsty + :uy * e.dstz, e.z + :fz * e.dstx + :rz * e.dsty + :uz * e.dstz
    FROM ents e WHERE e.id = :eid INTO sx, sy, sz;
  dmg = 100 + FLOOR(RAND() * 50);
  SELECT 550 + 50 * g.skill FROM game g WHERE g.id = 1 INTO spd;
  EXECUTE PROCEDURE launch_rocket(own, sx, sy, sz, fx, fy, fz, spd, dmg, dmg, 150);
  EXECUTE PROCEDURE snd_at(sx, sy, sz, 'weapons/rocklf1a.wav', 1, 1);
END^

-- turret_breach_think, every 0.1 s: the aim clamped to its limits, the turn toward it at most `speed` degrees a
-- second (the angular speed the pusher move applies), the base turning with it, the driver carried round
-- (SnapToEights of its place on the breach: at move_origin's distance and angle, and its height) with the
-- breach's angles, and a shot when the driver asked for one (spawnflag 65536)
CREATE OR ALTER PROCEDURE turret_breach_think (eid INTEGER)
AS
DECLARE cp DOUBLE PRECISION; DECLARE cy DOUBLE PRECISION; DECLARE mp DOUBLE PRECISION; DECLARE my DOUBLE PRECISION;
DECLARE p1p DOUBLE PRECISION; DECLARE p1y DOUBLE PRECISION; DECLARE p2p DOUBLE PRECISION; DECLARE p2y DOUBLE PRECISION; DECLARE spd DOUBLE PRECISION;
DECLARE dmin DOUBLE PRECISION; DECLARE dmax DOUBLE PRECISION; DECLARE dp DOUBLE PRECISION; DECLARE dy DOUBLE PRECISION; DECLARE master INTEGER; DECLARE drv INTEGER; DECLARE sf INTEGER;
DECLARE bx DOUBLE PRECISION; DECLARE by_ DOUBLE PRECISION; DECLARE bz DOUBLE PRECISION; DECLARE a DOUBLE PRECISION; DECLARE dd DOUBLE PRECISION; DECLARE da DOUBLE PRECISION; DECLARE dz DOUBLE PRECISION;
BEGIN
  SELECT anglemod(e.pitch), anglemod(e.yaw), anglemod(e.sg_x), anglemod(e.sg_y), e.p1x, e.p1y, e.p2x, e.p2y, e.speed, COALESCE(e.linked_id, e.id), e.owner_id, e.spawnflags, e.x, e.y, e.z
    FROM ents e WHERE e.id = :eid INTO cp, cy, mp, my, p1p, p1y, p2p, p2y, spd, master, drv, sf, bx, by_, bz;
  IF (mp > 180) THEN mp = mp - 360;
  IF (mp > p1p) THEN mp = p1p; ELSE IF (mp < p2p) THEN mp = p2p;
  IF (my < p1y OR my > p2y) THEN
  BEGIN
    dmin = ABS(p1y - my); IF (dmin < -180) THEN dmin = dmin + 360; ELSE IF (dmin > 180) THEN dmin = dmin - 360;
    dmax = ABS(p2y - my); IF (dmax < -180) THEN dmax = dmax + 360; ELSE IF (dmax > 180) THEN dmax = dmax - 360;
    my = IIF(ABS(dmin) < ABS(dmax), p1y, p2y);
  END
  dp = mp - cp; IF (dp < -180) THEN dp = dp + 360; ELSE IF (dp > 180) THEN dp = dp - 360;
  dy = my - cy; IF (dy < -180) THEN dy = dy + 360; ELSE IF (dy > 180) THEN dy = dy - 360;
  dp = MAXVALUE(-spd * 0.1e0, MINVALUE(spd * 0.1e0, dp)); dy = MAXVALUE(-spd * 0.1e0, MINVALUE(spd * 0.1e0, dy));
  UPDATE ents e SET e.sg_x = :mp, e.sg_y = :my, e.avel_pitch = :dp / 0.1e0, e.avel_yaw = :dy / 0.1e0, e.think = 'turret_breach_think', e.nextthink = e.ltime + 0.1e0 WHERE e.id = :eid;
  UPDATE ents e SET e.avel_yaw = :dy / 0.1e0 WHERE COALESCE(e.linked_id, e.id) = :master AND e.id <> :eid AND e.movetype = 7;
  IF (drv IS NOT NULL) THEN
  BEGIN
    SELECT d.dstx, d.dsty, d.dstz FROM ents d WHERE d.id = :drv INTO dd, da, dz;
    IF (dd IS NULL) THEN EXIT;
    a = (cy + da) * PI() / 180;
    UPDATE ents d SET d.x = snap8(:bx + COS(:a) * :dd), d.y = snap8(:by_ + SIN(:a) * :dd), d.z = snap8(:bz + :dd * TAN(:cp * PI() / 180) + :dz),
           d.pitch = :cp, d.yaw = :cy, d.ideal_yaw = :cy WHERE d.id = :drv;
    EXECUTE PROCEDURE link_ent(drv);
    IF (BIN_AND(sf, 65536) <> 0) THEN
    BEGIN
      UPDATE ents e SET e.spawnflags = BIN_AND(e.spawnflags, BIN_NOT(65536)) WHERE e.id = :eid;
      EXECUTE PROCEDURE turret_breach_fire(eid);
    END
  END
END^

-- turret_breach_finish_init: the muzzle is where its target (an info_notnull, kept in the lump) stands, as an
-- offset from the breach; the team's dmg is the breach's
CREATE OR ALTER PROCEDURE turret_breach_init (eid INTEGER)
AS
DECLARE tgt VARCHAR(40); DECLARE mx DOUBLE PRECISION; DECLARE my DOUBLE PRECISION; DECLARE mz DOUBLE PRECISION;
BEGIN
  SELECT e.target FROM ents e WHERE e.id = :eid INTO tgt;
  SELECT FIRST 1 m.ox, m.oy, m.oz FROM map_ents m WHERE m.targetname = :tgt ORDER BY m.id INTO mx, my, mz;
  IF (mx IS NOT NULL) THEN UPDATE ents e SET e.dstx = :mx - e.x, e.dsty = :my - e.y, e.dstz = :mz - e.z WHERE e.id = :eid;
  DELETE FROM ents t WHERE t.targetname = :tgt AND t.classname = 'info_notnull';
  UPDATE ents m SET m.dmg = (SELECT e.dmg FROM ents e WHERE e.id = :eid) WHERE m.id = (SELECT COALESCE(e.linked_id, e.id) FROM ents e WHERE e.id = :eid);
  EXECUTE PROCEDURE turret_breach_think(eid);
END^

-- turret_driver_link: the breach it drives (its target) and the team's master get it as owner; it takes the
-- breach's angles and remembers its place on it: the distance (dstx), the angle from the breach (dsty), the height (dstz)
CREATE OR ALTER PROCEDURE turret_driver_link (eid INTEGER)
AS
DECLARE b INTEGER; DECLARE vx DOUBLE PRECISION; DECLARE vy DOUBLE PRECISION; DECLARE vz DOUBLE PRECISION;
BEGIN
  SELECT FIRST 1 b.id FROM ents d JOIN ents b ON b.targetname = d.target AND b.classname = 'turret_breach' WHERE d.id = :eid INTO b;
  IF (b IS NULL) THEN EXIT;
  UPDATE ents e SET e.owner_id = :eid WHERE e.id = :b OR e.id = (SELECT COALESCE(x.linked_id, x.id) FROM ents x WHERE x.id = :b);
  SELECT d.x - b.x, d.y - b.y, d.z - b.z FROM ents d JOIN ents b ON b.id = :b WHERE d.id = :eid INTO vx, vy, vz;
  UPDATE ents d SET d.goal_id = :b, d.pitch = (SELECT b.pitch FROM ents b WHERE b.id = :b), d.yaw = (SELECT b.yaw FROM ents b WHERE b.id = :b),
         d.dstx = vlen(:vx, :vy, 0), d.dsty = anglemod(vectoyaw(:vx, :vy)), d.dstz = :vz, d.think = 'turret_driver_think', d.nextthink = now_() + 0.1e0 WHERE d.id = :eid;
END^

-- turret_driver_think, every 0.1 s: an enemy found as a monster finds one and kept while seen (AI_LOST_SIGHT
-- when not), the breach aimed at its eyes, and a shot asked for once the enemy has been seen for the
-- reaction time (3 − skill seconds), then every reaction time + 1
CREATE OR ALTER PROCEDURE turret_driver_think (eid INTEGER)
AS
DECLARE en INTEGER; DECLARE b INTEGER; DECLARE af DOUBLE PRECISION; DECLARE tt DOUBLE PRECISION; DECLARE aif INTEGER; DECLARE t DOUBLE PRECISION;
DECLARE dx DOUBLE PRECISION; DECLARE dy DOUBLE PRECISION; DECLARE dz DOUBLE PRECISION; DECLARE react DOUBLE PRECISION;
BEGIN
  t = now_();
  UPDATE ents d SET d.think = 'turret_driver_think', d.nextthink = :t + 0.1e0 WHERE d.id = :eid;
  SELECT d.enemy_id, d.goal_id, d.attack_finished, d.trail_time, d.aiflags FROM ents d WHERE d.id = :eid INTO en, b, af, tt, aif;
  IF (b IS NULL) THEN EXIT;
  IF (en IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ents e WHERE e.id = :en AND e.health > 0)) THEN en = NULL;
  IF (en IS NULL) THEN
  BEGIN
    IF (find_target(eid) = 0) THEN BEGIN UPDATE ents d SET d.enemy_id = NULL WHERE d.id = :eid; EXIT; END
    en = player_ent(); tt = t; aif = BIN_AND(aif, BIN_NOT(16));
    UPDATE ents d SET d.enemy_id = :en, d.trail_time = :tt, d.aiflags = :aif WHERE d.id = :eid;
  END
  ELSE IF (visible(eid, en) = 1) THEN
  BEGIN
    IF (BIN_AND(aif, 16) <> 0) THEN BEGIN tt = t; UPDATE ents d SET d.trail_time = :tt, d.aiflags = BIN_AND(d.aiflags, BIN_NOT(16)) WHERE d.id = :eid; END
  END
  ELSE
  BEGIN
    UPDATE ents d SET d.aiflags = BIN_OR(d.aiflags, 16) WHERE d.id = :eid;
    EXIT;
  END
  -- let the turret know where we want it to aim (vectoangles: the pitch positive downward)
  SELECT e.x - b.x, e.y - b.y, e.z + e.viewheight - b.z FROM ents e JOIN ents b ON b.id = :b WHERE e.id = :en INTO dx, dy, dz;
  UPDATE ents b SET b.sg_x = -ATAN2(:dz, vlen(:dx, :dy, 0)) * 57.29577951e0, b.sg_y = vectoyaw(:dx, :dy) WHERE b.id = :b;
  IF (t < af) THEN EXIT;
  SELECT 3 - g.skill FROM game g WHERE g.id = 1 INTO react;
  IF (t - tt < react) THEN EXIT;
  UPDATE ents d SET d.attack_finished = :t + :react + 1 WHERE d.id = :eid;
  UPDATE ents b SET b.spawnflags = BIN_OR(b.spawnflags, 65536) WHERE b.id = :b;
END^

-- use_target_spawner: a fresh entity of its target's classname at its place and angle (ED_CallSpawn on a
-- row added to the lump), anything in its box killed, off at its speed. The spawn functions schedule their
-- first thinks from the level clock (a pusher's from its own ltime, zero at spawn), so nothing is shifted.
CREATE OR ALTER PROCEDURE target_spawner_use (eid INTEGER)
AS
DECLARE cls VARCHAR(40); DECLARE x DOUBLE PRECISION; DECLARE y DOUBLE PRECISION; DECLARE z DOUBLE PRECISION; DECLARE yaw DOUBLE PRECISION;
DECLARE vx DOUBLE PRECISION; DECLARE vy DOUBLE PRECISION; DECLARE vz DOUBLE PRECISION; DECLARE mid INTEGER; DECLARE skill SMALLINT; DECLARE n INTEGER;
BEGIN
  SELECT e.target, e.x, e.y, e.z, e.yaw, e.p1x, e.p1y, e.p1z FROM ents e WHERE e.id = :eid INTO cls, x, y, z, yaw, vx, vy, vz;
  IF (cls IS NULL OR cls = '') THEN EXIT;
  SELECT COALESCE(MAX(m.id), 0) + 1 FROM map_ents m INTO mid;
  INSERT INTO map_ents (id, classname, ox, oy, oz, angle, spawnflags) VALUES (:mid, :cls, :x, :y, :z, :yaw, 0);
  SELECT g.skill FROM game g WHERE g.id = 1 INTO skill;
  EXECUTE PROCEDURE spawn_map_ents(skill, NULL, mid);
  SELECT MAX(e.id) FROM ents e WHERE e.classname = :cls INTO n;
  IF (n IS NULL) THEN EXIT;
  EXECUTE PROCEDURE killbox(n);
  IF (vx <> 0 OR vy <> 0 OR vz <> 0) THEN UPDATE ents e SET e.vx = :vx, e.vy = :vy, e.vz = :vz WHERE e.id = :n;
END^

-- ── trains ──────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE train_next (eid INTEGER)
AS
DECLARE tgt VARCHAR(40); DECLARE cx DOUBLE PRECISION; DECLARE cy DOUBLE PRECISION; DECLARE cz DOUBLE PRECISION;
DECLARE ctarget VARCHAR(40); DECLARE cwait DOUBLE PRECISION; DECLARE cpath VARCHAR(40); DECLARE cid INTEGER; DECLARE csf INTEGER;
DECLARE mnx DOUBLE PRECISION; DECLARE mny DOUBLE PRECISION; DECLARE mnz DOUBLE PRECISION;
BEGIN
  SELECT e.target, e.minx, e.miny, e.minz FROM ents e WHERE e.id = :eid INTO tgt, mnx, mny, mnz;
  SELECT FIRST 1 e.id, e.x, e.y, e.z, e.target, e.wait_, e.pathtarget, e.spawnflags FROM ents e WHERE e.targetname = :tgt AND e.classname = 'path_corner'
    INTO cid, cx, cy, cz, ctarget, cwait, cpath, csf;
  IF (cx IS NULL) THEN EXIT;
  -- the corner's own targets fire when the train arrives (handled in train_wait); TELEPORT corners jump
  UPDATE ents e SET e.target = :ctarget, e.wait_ = COALESCE(:cwait, 0), e.goal_id = :cid WHERE e.id = :eid;
  IF (BIN_AND(csf, 1) <> 0) THEN
  BEGIN
    UPDATE ents e SET e.x = :cx - :mnx, e.y = :cy - :mny, e.z = :cz - :mnz WHERE e.id = :eid;
    EXECUTE PROCEDURE link_ent(eid);
    EXECUTE PROCEDURE train_next(eid);
    EXIT;
  END
  -- the train's noise is its middle sound (moveinfo.sound_middle), looped while it moves (FRAME_ALL)
  EXECUTE PROCEDURE calc_move(eid, cx - mnx, cy - mny, cz - mnz, (SELECT e.speed FROM ents e WHERE e.id = :eid), 'train_wait');
END^

CREATE OR ALTER PROCEDURE train_wait (eid INTEGER)
AS
DECLARE wt DOUBLE PRECISION; DECLARE corner INTEGER; DECLARE pt VARCHAR(40); DECLARE savetarget VARCHAR(40);
BEGIN
  SELECT e.wait_, e.goal_id FROM ents e WHERE e.id = :eid INTO wt, corner;
  -- the path corner's pathtarget fires on arrival (its target stands in for a moment, then is put back:
  -- a train that comes round again follows it)
  IF (corner IS NOT NULL) THEN
  BEGIN
    SELECT e.pathtarget, e.target FROM ents e WHERE e.id = :corner INTO pt, savetarget;
    IF (pt IS NOT NULL) THEN
    BEGIN
      UPDATE ents e SET e.target = :pt WHERE e.id = :corner;
      EXECUTE PROCEDURE use_targets(corner, player_ent());
      UPDATE ents e SET e.target = :savetarget WHERE e.id = :corner;
    END
  END
  IF (NOT EXISTS (SELECT 1 FROM ents e WHERE e.id = :eid)) THEN EXIT;   -- killed by a killtarget
  EXECUTE PROCEDURE snd(eid, 0, (SELECT e.noise3 FROM ents e WHERE e.id = :eid), 1, 1);
  IF (wt < 0) THEN EXIT;                                        -- wait for a trigger
  UPDATE ents e SET e.think = 'train_next', e.nextthink = e.ltime + IIF(:wt > 0, :wt, 0.1e0) WHERE e.id = :eid;
END^

-- func_timer: fire the target every wait (± random) seconds
CREATE OR ALTER PROCEDURE timer_think (eid INTEGER)
AS
DECLARE wt DOUBLE PRECISION; DECLARE rnd DOUBLE PRECISION;
BEGIN
  SELECT e.wait_, e.random_ FROM ents e WHERE e.id = :eid INTO wt, rnd;
  EXECUTE PROCEDURE use_targets(eid, player_ent());
  UPDATE ents e SET e.think = 'timer_think', e.nextthink = now_() + :wt + crand() * :rnd WHERE e.id = :eid;
END^

-- ── triggers and targets ───────────────────────────────────────────────
-- G_UseTargets: fire everything named by `target`, kill `killtarget`
CREATE OR ALTER PROCEDURE use_targets (eid INTEGER, activator INTEGER)
AS
DECLARE tgt VARCHAR(40); DECLARE kt VARCHAR(40); DECLARE msg VARCHAR(400); DECLARE dl DOUBLE PRECISION; DECLARE cls VARCHAR(40);
DECLARE t INTEGER; DECLARE tcls VARCHAR(40); DECLARE tid INTEGER; DECLARE st SMALLINT; DECLARE sf INTEGER; DECLARE n VARCHAR(64);
DECLARE x DOUBLE PRECISION; DECLARE y DOUBLE PRECISION; DECLARE z DOUBLE PRECISION; DECLARE d INTEGER; DECLARE vol DOUBLE PRECISION; DECLARE attn DOUBLE PRECISION;
BEGIN
  SELECT e.target, e.killtarget, e.message, e.delay, e.classname FROM ents e WHERE e.id = :eid INTO tgt, kt, msg, dl, cls;
  IF (dl > 0) THEN
  BEGIN
    -- create a temporary object to fire at a later time
    EXECUTE PROCEDURE spawn_ent('DelayedUse', 0, 0, 0) RETURNING_VALUES tid;
    UPDATE ents e SET e.target = :tgt, e.killtarget = :kt, e.message = :msg, e.think = 'delayed_use', e.nextthink = now_() + :dl,
           e.enemy_id = :activator WHERE e.id = :tid;
    EXIT;
  END
  IF (msg IS NOT NULL AND msg <> '' AND activator = player_ent() AND cls NOT IN ('func_door', 'func_door_rotating', 'target_secret', 'target_goal', 'target_help')) THEN
  BEGIN
    EXECUTE PROCEDURE cprint(msg);
    EXECUTE PROCEDURE snd(activator, 2, 'misc/talk1.wav', 1, 1);
  END
  IF (kt IS NOT NULL AND kt <> '') THEN
    DELETE FROM ents e WHERE e.targetname = :kt;
  IF (tgt IS NULL OR tgt = '') THEN EXIT;
  FOR SELECT e.id, e.classname FROM ents e WHERE e.targetname = :tgt AND e.id <> :eid INTO t, tcls DO
  BEGIN
    IF (NOT EXISTS (SELECT 1 FROM ents e WHERE e.id = :t)) THEN CONTINUE;
    IF (tcls IN ('func_door', 'func_door_rotating', 'func_water')) THEN EXECUTE PROCEDURE door_use(t, activator);
    ELSE IF (tcls = 'func_door_secret') THEN EXECUTE PROCEDURE door_secret_use(t);
    ELSE IF (tcls = 'func_plat') THEN
    BEGIN
      SELECT e.mv_state FROM ents e WHERE e.id = :t INTO st;
      IF (st = 0) THEN EXECUTE PROCEDURE plat_go_down(t); ELSE IF (st = 1) THEN EXECUTE PROCEDURE plat_go_up(t);
    END
    ELSE IF (tcls = 'func_button') THEN EXECUTE PROCEDURE button_fire(t, activator);
    ELSE IF (tcls = 'func_train') THEN
    BEGIN
      SELECT e.mv_state FROM ents e WHERE e.id = :t INTO st;
      IF (st = 1) THEN BEGIN UPDATE ents e SET e.mv_state = 2 WHERE e.id = :t; EXECUTE PROCEDURE train_next(t); END
    END
    ELSE IF (tcls = 'func_timer') THEN
    BEGIN
      IF (EXISTS (SELECT 1 FROM ents e WHERE e.id = :t AND e.nextthink IS NOT NULL)) THEN
        UPDATE ents e SET e.nextthink = NULL, e.think = NULL WHERE e.id = :t;     -- turn it off
      ELSE
        UPDATE ents e SET e.think = 'timer_think', e.nextthink = now_() + e.delay WHERE e.id = :t;
    END
    ELSE IF (tcls = 'func_rotating') THEN
      UPDATE ents e SET e.avel_pitch = IIF(e.avel_pitch = 0 AND e.avel_yaw = 0 AND e.avel_roll = 0, e.p1x, 0),
             e.avel_yaw = IIF(e.avel_pitch = 0 AND e.avel_yaw = 0 AND e.avel_roll = 0, e.p1y, 0),
             e.avel_roll = IIF(e.avel_pitch = 0 AND e.avel_yaw = 0 AND e.avel_roll = 0, e.p1z, 0) WHERE e.id = :t;
    ELSE IF (tcls = 'func_wall') THEN
    BEGIN
      SELECT e.spawnflags, e.solid FROM ents e WHERE e.id = :t INTO sf, st;
      -- TRIGGER_SPAWN walls appear; TOGGLE walls switch
      IF (st = 0) THEN UPDATE ents e SET e.solid = 4, e.alpha = 0 WHERE e.id = :t;
      ELSE IF (BIN_AND(sf, 2) <> 0) THEN UPDATE ents e SET e.solid = 0, e.alpha = 1 WHERE e.id = :t;
    END
    ELSE IF (tcls = 'func_explosive') THEN
    BEGIN
      SELECT e.solid FROM ents e WHERE e.id = :t INTO st;
      IF (st = 0) THEN UPDATE ents e SET e.solid = 4, e.alpha = 0 WHERE e.id = :t;   -- TRIGGER_SPAWN
      ELSE EXECUTE PROCEDURE become_explosion(t, 2);
    END
    ELSE IF (tcls IN ('trigger_relay', 'trigger_once', 'trigger_multiple', 'trigger_always')) THEN
      EXECUTE PROCEDURE trigger_fire(t, activator);
    ELSE IF (tcls = 'trigger_counter') THEN EXECUTE PROCEDURE counter_use(t, activator);
    ELSE IF (tcls = 'trigger_key') THEN EXECUTE PROCEDURE trigger_fire(t, activator);
    ELSE IF (tcls = 'trigger_hurt') THEN UPDATE ents e SET e.solid = IIF(e.solid = 1, 0, 1) WHERE e.id = :t;   -- toggle
    ELSE IF (tcls = 'misc_teleporter') THEN
      UPDATE ents e SET e.nextthink = now_() + 0.2e0 WHERE e.id = :t;
    ELSE IF (tcls = 'light') THEN
      UPDATE lightstyles l SET l.pattern = IIF(l.pattern = 'a', 'm', 'a') WHERE l.style = (SELECT e.style FROM ents e WHERE e.id = :t);
    ELSE IF (tcls = 'target_lightramp') THEN
      UPDATE lightstyles l SET l.pattern = SUBSTRING((SELECT e.message FROM ents e WHERE e.id = :t) FROM 2 FOR 1)
       WHERE l.style = (SELECT e.style FROM ents e WHERE e.id = :t);
    ELSE IF (tcls = 'target_speaker') THEN
    BEGIN
      SELECT e.noise1, e.x, e.y, e.z, e.speed, e.height, e.spawnflags FROM ents e WHERE e.id = :t INTO n, x, y, z, vol, attn, sf;
      IF (BIN_AND(sf, 3) <> 0) THEN
        -- a looped speaker toggles: the browser follows ents.sounds (1 = on)
        UPDATE ents e SET e.sounds = 1 - e.sounds WHERE e.id = :t;
      ELSE IF (attn = -1) THEN EXECUTE PROCEDURE snd(player_ent(), 0, n, vol, 0);   -- heard everywhere
      ELSE EXECUTE PROCEDURE snd_at(x, y, z, n, vol, attn);
    END
    ELSE IF (tcls = 'target_explosion') THEN
    BEGIN
      SELECT e.x, e.y, e.z, e.dmg FROM ents e WHERE e.id = :t INTO x, y, z, d;
      EXECUTE PROCEDURE fx(2, x, y, z, 0, 0, 0, 0);
      EXECUTE PROCEDURE snd_at(x, y, z, 'weapons/rocklx1a.wav', 1, 1);
      IF (d > 0) THEN EXECUTE PROCEDURE t_radius_damage(t, activator, d, NULL, d + 40);
      -- its own targets fire too (with its delay already spent)
      UPDATE ents e SET e.delay = 0 WHERE e.id = :t;
      EXECUTE PROCEDURE use_targets(t, activator);
    END
    ELSE IF (tcls = 'target_splash') THEN
    BEGIN
      SELECT e.x, e.y, e.z, e.count_, e.sounds FROM ents e WHERE e.id = :t INTO x, y, z, d, sf;
      EXECUTE PROCEDURE fx(7, x, y, z, 0, 0, 0, d * 16 + sf);
      IF (EXISTS (SELECT 1 FROM ents e WHERE e.id = :t AND e.dmg > 0)) THEN
        EXECUTE PROCEDURE t_radius_damage(t, activator, (SELECT e.dmg FROM ents e WHERE e.id = :t), NULL, (SELECT e.dmg FROM ents e WHERE e.id = :t) + 40);
    END
    ELSE IF (tcls = 'target_secret') THEN
    BEGIN
      UPDATE game g SET g.found_secrets = g.found_secrets + 1 WHERE g.id = 1;
      EXECUTE PROCEDURE cprint(COALESCE((SELECT e.message FROM ents e WHERE e.id = :t), 'You have found a secret.'));
      EXECUTE PROCEDURE snd(player_ent(), 2, 'misc/secret.wav', 1, 1);
      UPDATE ents e SET e.message = NULL WHERE e.id = :t;
      EXECUTE PROCEDURE use_targets(t, activator);
      DELETE FROM ents e WHERE e.id = :t;
    END
    ELSE IF (tcls = 'target_goal') THEN
    BEGIN
      UPDATE game g SET g.found_goals = g.found_goals + 1 WHERE g.id = 1;
      EXECUTE PROCEDURE cprint(COALESCE((SELECT e.message FROM ents e WHERE e.id = :t), 'Objective completed.'));
      EXECUTE PROCEDURE snd(player_ent(), 2, 'misc/secret.wav', 1, 1);
      UPDATE ents e SET e.message = NULL WHERE e.id = :t;
      EXECUTE PROCEDURE use_targets(t, activator);
      DELETE FROM ents e WHERE e.id = :t;
    END
    ELSE IF (tcls = 'target_help') THEN
    BEGIN
      -- Use_Target_Help: spawnflags 1 writes the first message, otherwise the second
      UPDATE game g SET g.help_msg = IIF(BIN_AND((SELECT e.spawnflags FROM ents e WHERE e.id = :t), 1) <> 0, (SELECT e.message FROM ents e WHERE e.id = :t), g.help_msg),
             g.help_msg2 = IIF(BIN_AND((SELECT e.spawnflags FROM ents e WHERE e.id = :t), 1) = 0, (SELECT e.message FROM ents e WHERE e.id = :t), g.help_msg2),
             g.help_changed = g.help_changed + 1 WHERE g.id = 1;
      EXECUTE PROCEDURE cprint((SELECT e.message FROM ents e WHERE e.id = :t));
      EXECUTE PROCEDURE snd(player_ent(), 2, 'misc/pc_up.wav', 1, 0);
    END
    ELSE IF (tcls = 'target_changelevel') THEN EXECUTE PROCEDURE changelevel(t);
    ELSE IF (tcls = 'target_laser') THEN
      UPDATE ents e SET e.sounds = 1 - e.sounds WHERE e.id = :t;   -- on/off
    ELSE IF (tcls = 'misc_satellite_dish') THEN
      UPDATE ents e SET e.think = 'dish_think', e.nextthink = now_() + 0.1e0 WHERE e.id = :t;
    ELSE IF (tcls IN ('misc_strogg_ship', 'misc_viper')) THEN
    BEGIN
      -- misc_strogg_ship_use, misc_viper_use: it shows up (no longer SVF_NOCLIENT), and train_use starts it
      EXECUTE PROCEDURE set_model(t, IIF(tcls = 'misc_viper', 'models/ships/viper/tris.md2', 'models/ships/strogg1/tris.md2'));
      SELECT e.mv_state FROM ents e WHERE e.id = :t INTO st;
      IF (st = 1) THEN BEGIN UPDATE ents e SET e.mv_state = 2 WHERE e.id = :t; EXECUTE PROCEDURE train_next(t); END
    END
    ELSE IF (tcls = 'misc_viper_bomb') THEN EXECUTE PROCEDURE viper_bomb_use(t, activator);
    ELSE IF (tcls = 'misc_blackhole') THEN DELETE FROM ents e WHERE e.id = :t;     -- misc_blackhole_use
    ELSE IF (tcls = 'target_spawner') THEN EXECUTE PROCEDURE target_spawner_use(t);
    ELSE IF (tcls = 'target_string') THEN EXECUTE PROCEDURE target_string_use(t);
    ELSE IF (tcls = 'func_clock') THEN EXECUTE PROCEDURE clock_use(t, activator);
    ELSE IF (tcls = 'trigger_elevator') THEN EXECUTE PROCEDURE elevator_use(t, eid);
    ELSE IF (tcls = 'target_earthquake') THEN
      -- target_earthquake_use: count seconds from now, the sound at once
      UPDATE ents e SET e.attack_finished = now_() + e.count_, e.pausetime = 0, e.think = 'earthquake_think', e.nextthink = now_() + 0.1e0, e.enemy_id = :activator
       WHERE e.id = :t;
    ELSE IF (tcls LIKE 'monster_%') THEN EXECUTE PROCEDURE monster_wake(t, activator);
    ELSE IF (tcls = 'target_crosslevel_trigger') THEN
    BEGIN
      -- trigger_crosslevel_trigger_use: the flag is set for the rest of the unit; the trigger is spent
      UPDATE game g SET g.serverflags = BIN_OR(g.serverflags, BIN_AND((SELECT e.spawnflags FROM ents e WHERE e.id = :t), 255)) WHERE g.id = 1;
      DELETE FROM ents e WHERE e.id = :t;
    END
    ELSE IF (tcls = 'func_areaportal') THEN EXECUTE PROCEDURE areaportal_use(t, eid);
    ELSE IF (tcls = 'func_killbox') THEN EXECUTE PROCEDURE killbox(t);
    ELSE IF (tcls = 'func_object') THEN EXECUTE PROCEDURE object_use(t);
    ELSE IF (tcls = 'func_conveyor') THEN
      -- func_conveyor_use: on and off (TOGGLE keeps it usable); the speed only scrolls the belt's texture
      -- (without TOGGLE it is used once: mv_state 9 marks it spent; conveyors do not move)
      UPDATE ents e SET e.speed = IIF(BIN_AND(e.spawnflags, 1) <> 0, 0, e.count_), e.spawnflags = BIN_XOR(e.spawnflags, 1),
             e.mv_state = IIF(BIN_AND(e.spawnflags, 2) <> 0, e.mv_state, 9)
       WHERE e.id = :t AND (BIN_AND(e.spawnflags, 2) <> 0 OR e.mv_state <> 9);
    ELSE IF (tcls IN ('info_null', 'info_notnull', 'path_corner', 'point_combat', 'target_crosslevel_target')) THEN BEGIN END
    ELSE EXECUTE PROCEDURE use_targets(t, activator);               -- anything with a target of its own
  END
END^

-- target_crosslevel_target_think: when every flag it asks for is set in the unit, fire its targets and go
CREATE OR ALTER PROCEDURE crosslevel_think (eid INTEGER)
AS
DECLARE sf INTEGER; DECLARE flags INTEGER;
BEGIN
  SELECT BIN_AND(e.spawnflags, 255) FROM ents e WHERE e.id = :eid INTO sf;
  IF (sf IS NULL) THEN EXIT;
  SELECT g.serverflags FROM game g WHERE g.id = 1 INTO flags;
  IF (BIN_AND(flags, sf) = sf) THEN
  BEGIN
    EXECUTE PROCEDURE use_targets(eid, eid);
    DELETE FROM ents e WHERE e.id = :eid;
  END
END^

CREATE OR ALTER PROCEDURE delayed_use (eid INTEGER)
AS
DECLARE act INTEGER;
BEGIN
  SELECT e.enemy_id FROM ents e WHERE e.id = :eid INTO act;
  UPDATE ents e SET e.delay = 0 WHERE e.id = :eid;
  EXECUTE PROCEDURE use_targets(eid, COALESCE(act, player_ent()));
  DELETE FROM ents e WHERE e.id = :eid;
END^

-- multi_trigger: message, sound, targets, then wait or die
CREATE OR ALTER PROCEDURE trigger_fire (eid INTEGER, activator INTEGER)
AS
DECLARE wt DOUBLE PRECISION; DECLARE nt DOUBLE PRECISION; DECLARE cls VARCHAR(40); DECLARE n1 VARCHAR(64); DECLARE item VARCHAR(40); DECLARE kbit INTEGER;
BEGIN
  SELECT e.wait_, e.nextthink, e.classname, e.noise1, e.item FROM ents e WHERE e.id = :eid INTO wt, nt, cls, n1, item;
  IF (nt IS NOT NULL AND nt > now_() AND cls <> 'trigger_relay') THEN EXIT;    -- already been triggered
  IF (cls = 'trigger_key') THEN
  BEGIN
    kbit = CASE item WHEN 'key_blue_key' THEN 1 WHEN 'key_red_key' THEN 2 WHEN 'key_data_cd' THEN 4 WHEN 'key_power_cube' THEN 8 WHEN 'key_pyramid' THEN 16
                     WHEN 'key_data_spinner' THEN 32 WHEN 'key_pass' THEN 64 WHEN 'key_commander_head' THEN 128 WHEN 'key_airstrike_target' THEN 256 ELSE 0 END;
    IF (NOT EXISTS (SELECT 1 FROM player p WHERE p.id = 1 AND BIN_AND(p.keys, :kbit) <> 0)) THEN
    BEGIN
      IF (nt IS NULL OR nt < now_()) THEN
      BEGIN
        EXECUTE PROCEDURE cprint('You need the ' || REPLACE(SUBSTRING(item FROM 5), '_', ' '));
        EXECUTE PROCEDURE snd(activator, 2, 'misc/keytry.wav', 1, 1);
        UPDATE ents e SET e.nextthink = now_() + 5 WHERE e.id = :eid;
      END
      EXIT;
    END
    EXECUTE PROCEDURE snd(activator, 2, 'misc/keyuse.wav', 1, 1);
    UPDATE player p SET p.keys = BIN_AND(p.keys, BIN_NOT(:kbit)) WHERE p.id = 1;     -- the key is used up
    EXECUTE PROCEDURE use_targets(eid, activator);
    DELETE FROM ents e WHERE e.id = :eid;
    EXIT;
  END
  IF (n1 IS NOT NULL) THEN EXECUTE PROCEDURE snd(activator, 2, n1, 1, 1);
  UPDATE ents e SET e.takedamage = 0 WHERE e.id = :eid;
  EXECUTE PROCEDURE use_targets(eid, activator);
  IF (cls = 'trigger_relay') THEN EXIT;
  IF (wt > 0) THEN
    UPDATE ents e SET e.nextthink = now_() + :wt, e.think = 'multi_wait' WHERE e.id = :eid;
  ELSE
    DELETE FROM ents e WHERE e.id = :eid;
END^

CREATE OR ALTER PROCEDURE multi_wait (eid INTEGER)
AS
BEGIN
  UPDATE ents e SET e.nextthink = NULL, e.think = NULL, e.takedamage = IIF(e.max_health > 0, 1, 0), e.health = e.max_health WHERE e.id = :eid;
END^

CREATE OR ALTER PROCEDURE counter_use (eid INTEGER, activator INTEGER)
AS
DECLARE c INTEGER; DECLARE sf INTEGER;
BEGIN
  UPDATE ents e SET e.count_ = e.count_ - 1 WHERE e.id = :eid RETURNING e.count_, e.spawnflags INTO c, sf;
  IF (c < 0) THEN EXIT;
  IF (c <> 0) THEN
  BEGIN
    IF (BIN_AND(sf, 1) = 0) THEN
    BEGIN
      EXECUTE PROCEDURE cprint(c || ' more to go...');
      EXECUTE PROCEDURE snd(activator, 2, 'misc/talk1.wav', 1, 1);
    END
    EXIT;
  END
  IF (BIN_AND(sf, 1) = 0) THEN
  BEGIN
    EXECUTE PROCEDURE cprint('Sequence completed!');
    EXECUTE PROCEDURE snd(activator, 2, 'misc/talk1.wav', 1, 1);
  END
  UPDATE ents e SET e.enemy_id = :activator WHERE e.id = :eid;
  EXECUTE PROCEDURE use_targets(eid, activator);
  DELETE FROM ents e WHERE e.id = :eid;
END^

-- BeginIntermission + MoveClientToIntermission: the player watches the level from an
-- info_player_intermission (one of the first four at random, else the start) with the view's angles,
-- frozen, no weapon, no powerups; the tic holds the world still until a button after five seconds.
CREATE OR ALTER PROCEDURE begin_intermission
AS
DECLARE pe INTEGER; DECLARE n INTEGER; DECLARE k INTEGER;
DECLARE x DOUBLE PRECISION; DECLARE y DOUBLE PRECISION; DECLARE z DOUBLE PRECISION;
DECLARE pitch DOUBLE PRECISION; DECLARE yaw DOUBLE PRECISION;
BEGIN
  pe = player_ent();
  SELECT COUNT(*) FROM map_ents m WHERE m.classname = 'info_player_intermission' INTO n;
  IF (n > 0) THEN
  BEGIN
    k = MOD(CAST(FLOOR(RAND() * 4) AS INTEGER), n);
    SELECT FIRST 1 SKIP (:k) m.ox, m.oy, m.oz, COALESCE(m.apitch, 0), COALESCE(m.ayaw, m.angle, 0)
      FROM map_ents m WHERE m.classname = 'info_player_intermission' ORDER BY m.id INTO x, y, z, pitch, yaw;
  END
  ELSE
    SELECT FIRST 1 m.ox, m.oy, m.oz, 0, COALESCE(m.ayaw, m.angle, 0)
      FROM map_ents m WHERE m.classname = 'info_player_start' ORDER BY m.id INTO x, y, z, pitch, yaw;
  UPDATE game g SET g.intermission_time = g.time_ WHERE g.id = 1;
  IF (x IS NOT NULL) THEN
    UPDATE ents e SET e.x = :x, e.y = :y, e.z = :z, e.yaw = :yaw, e.vx = 0, e.vy = 0, e.vz = 0, e.solid = 0, e.effects = 0 WHERE e.id = :pe;
  UPDATE player p SET p.pitch = COALESCE(:pitch, p.pitch), p.view_ofs = 0, p.stepz = 0, p.punchangle = 0, p.grenade_time = 0,
         p.quad_finished = 0, p.invincible_finished = 0, p.breather_finished = 0, p.enviro_finished = 0,
         p.dmg_take = 0, p.dmg_save = 0, p.cprint = NULL, p.msg = NULL WHERE p.id = 1;
  EXECUTE PROCEDURE link_ent(pe);
END^

-- target_changelevel_use: the level's exit. In single player only the end of a unit ("*" in the map)
-- stops at the intermission (BeginIntermission); any other exit is taken at once. The map string is kept
-- as written, and the page reads it the way the server did (src/levels.js).
CREATE OR ALTER PROCEDURE changelevel (eid INTEGER)
AS
DECLARE m VARCHAR(64); DECLARE ek SMALLINT; DECLARE it DOUBLE PRECISION; DECLARE hp INTEGER;
BEGIN
  SELECT e.map FROM ents e WHERE e.id = :eid INTO m;
  SELECT g.exit_kind, g.intermission_time FROM game g WHERE g.id = 1 INTO ek, it;
  IF (ek <> 0 OR it IS NOT NULL OR m IS NULL OR m = '') THEN EXIT;      -- already leaving
  SELECT e.health FROM ents e WHERE e.id = player_ent() INTO hp;
  IF (hp <= 0) THEN EXIT;                                               -- the dead don't leave
  UPDATE game g SET g.next_map = :m WHERE g.id = 1;
  IF (POSITION('*', m) > 0) THEN EXECUTE PROCEDURE begin_intermission;
  ELSE UPDATE game g SET g.exit_kind = 1 WHERE g.id = 1;
END^

-- teleport_touch (misc_teleporter): send `other` to the destination
CREATE OR ALTER PROCEDURE teleport_touch (trig INTEGER, other INTEGER)
AS
DECLARE tgt VARCHAR(40);
DECLARE dx DOUBLE PRECISION; DECLARE dy DOUBLE PRECISION; DECLARE dz DOUBLE PRECISION; DECLARE dyaw DOUBLE PRECISION;
DECLARE ocls VARCHAR(40); DECLARE v INTEGER;
BEGIN
  SELECT e.target FROM ents e WHERE e.id = :trig INTO tgt;
  SELECT e.classname FROM ents e WHERE e.id = :other INTO ocls;
  IF (ocls <> 'player') THEN EXIT;
  SELECT FIRST 1 e.x, e.y, e.z, e.yaw FROM ents e WHERE e.targetname = :tgt AND e.classname = 'misc_teleporter_dest' INTO dx, dy, dz, dyaw;
  IF (dx IS NULL) THEN EXIT;
  EXECUTE PROCEDURE snd(other, 0, 'misc/tele1.wav', 1, 1);
  EXECUTE PROCEDURE fx(5, (SELECT e.x FROM ents e WHERE e.id = :other), (SELECT e.y FROM ents e WHERE e.id = :other),
    (SELECT e.z FROM ents e WHERE e.id = :other), 0, 0, 0, 0);
  -- telefrag anything at the destination
  FOR SELECT e.id FROM ents e JOIN ents o ON o.id = :other
       WHERE e.id <> :other AND e.takedamage > 0 AND e.health > 0
         AND e.x + e.maxx >= :dx + o.minx AND e.x + e.minx <= :dx + o.maxx
         AND e.y + e.maxy >= :dy + o.miny AND e.y + e.miny <= :dy + o.maxy
         AND e.z + e.maxz >= :dz + 10 + o.minz AND e.z + e.minz <= :dz + 10 + o.maxz INTO v DO
    EXECUTE PROCEDURE t_damage(v, other, other, 100000, 0, 32);
  UPDATE ents e SET e.x = :dx, e.y = :dy, e.z = :dz + 10, e.yaw = :dyaw, e.pitch = 0, e.vx = 0, e.vy = 0, e.vz = 0,
         e.flags = BIN_AND(e.flags, BIN_NOT(512)), e.teleport_time = now_() + 0.7e0 WHERE e.id = :other;
  UPDATE player p SET p.pitch = 0 WHERE p.id = 1;
  EXECUTE PROCEDURE link_ent(other);
  EXECUTE PROCEDURE snd_at(dx, dy, dz, 'misc/tele1.wav', 1, 1);
  EXECUTE PROCEDURE fx(5, dx, dy, dz + 10, 0, 0, 0, 0);
END^

-- ── items (g_items.c) ────────────────────────────────────────────────────
-- the ammo a weapon uses: 1 shells 2 bullets 3 grenades 4 rockets 5 cells 6 slugs
CREATE OR ALTER FUNCTION weapon_ammo (w INTEGER) RETURNS SMALLINT
AS
BEGIN
  RETURN CASE w WHEN 2 THEN 1 WHEN 4 THEN 1 WHEN 8 THEN 2 WHEN 16 THEN 2 WHEN 32 THEN 3 WHEN 64 THEN 3 WHEN 128 THEN 4 WHEN 256 THEN 5 WHEN 512 THEN 6 WHEN 1024 THEN 5 ELSE 0 END;
END^

CREATE OR ALTER FUNCTION ammo_count (kind SMALLINT) RETURNS INTEGER
AS
DECLARE n INTEGER;
BEGIN
  SELECT CASE :kind WHEN 1 THEN p.shells WHEN 2 THEN p.bullets WHEN 3 THEN p.grenades WHEN 4 THEN p.rockets WHEN 5 THEN p.cells WHEN 6 THEN p.slugs ELSE 0 END
    FROM player p WHERE p.id = 1 INTO n;
  RETURN COALESCE(n, 0);
END^

-- Add_Ammo: returns 1 if any was taken
CREATE OR ALTER FUNCTION add_ammo (kind SMALLINT, n INTEGER) RETURNS SMALLINT
AS
DECLARE cur INTEGER; DECLARE mx INTEGER;
BEGIN
  SELECT CASE :kind WHEN 1 THEN p.shells WHEN 2 THEN p.bullets WHEN 3 THEN p.grenades WHEN 4 THEN p.rockets WHEN 5 THEN p.cells WHEN 6 THEN p.slugs END,
         CASE :kind WHEN 1 THEN p.max_shells WHEN 2 THEN p.max_bullets WHEN 3 THEN p.max_grenades WHEN 4 THEN p.max_rockets WHEN 5 THEN p.max_cells WHEN 6 THEN p.max_slugs END
    FROM player p WHERE p.id = 1 INTO cur, mx;
  IF (cur IS NULL OR cur >= mx) THEN RETURN 0;
  cur = MINVALUE(mx, cur + n);
  UPDATE player p SET p.shells = IIF(:kind = 1, :cur, p.shells), p.bullets = IIF(:kind = 2, :cur, p.bullets), p.grenades = IIF(:kind = 3, :cur, p.grenades),
         p.rockets = IIF(:kind = 4, :cur, p.rockets), p.cells = IIF(:kind = 5, :cur, p.cells), p.slugs = IIF(:kind = 6, :cur, p.slugs) WHERE p.id = 1;
  RETURN 1;
END^

-- the best weapon the player holds with ammo (NoAmmoWeaponChange's order)
CREATE OR ALTER FUNCTION best_weapon () RETURNS INTEGER
AS
DECLARE w INTEGER;
BEGIN
  SELECT p.weapons FROM player p WHERE p.id = 1 INTO w;
  IF (BIN_AND(w, 512) <> 0 AND ammo_count(6) > 0) THEN RETURN 512;
  IF (BIN_AND(w, 256) <> 0 AND ammo_count(5) > 0) THEN RETURN 256;
  IF (BIN_AND(w, 16) <> 0 AND ammo_count(2) > 0) THEN RETURN 16;
  IF (BIN_AND(w, 8) <> 0 AND ammo_count(2) > 0) THEN RETURN 8;
  IF (BIN_AND(w, 4) <> 0 AND ammo_count(1) > 1) THEN RETURN 4;
  IF (BIN_AND(w, 2) <> 0 AND ammo_count(1) > 0) THEN RETURN 2;
  RETURN 1;
END^

-- ── the inventory (g_items.c's itemlist, g_cmds.c) ──────────────────────
-- Items by their itemlist index: 1 body, 2 combat, 3 jacket armour, 4 shard, 5 power screen, 6 power shield,
-- 7-17 the weapons (12 the hand grenades, which are the Grenades ammo), 18 shells, 19 bullets, 20 cells,
-- 21 rockets, 22 slugs, 23 quad damage, 24 invulnerability, 25 silencer, 26 rebreather, 27 environment suit,
-- 28-31 the instant ones (ancient head, adrenaline, bandolier, ammo pack), 32-40 the keys, 41 health.
-- The counts live where the game keeps them (the weapon bits, the ammo, the armour, the key bits) and in inv_*.
CREATE OR ALTER FUNCTION inv_count (idx SMALLINT) RETURNS INTEGER
AS
DECLARE n INTEGER;
BEGIN
  SELECT CASE
    WHEN :idx BETWEEN 1 AND 3 THEN IIF(p.armor_type = 4 - :idx, p.armor, 0)
    WHEN :idx = 5 THEN p.inv_screen WHEN :idx = 6 THEN p.inv_shield
    WHEN :idx = 12 THEN p.grenades
    WHEN :idx BETWEEN 7 AND 17 THEN IIF(BIN_AND(p.weapons, BIN_SHL(1, :idx - 7)) <> 0, 1, 0)
    WHEN :idx = 18 THEN p.shells WHEN :idx = 19 THEN p.bullets WHEN :idx = 20 THEN p.cells WHEN :idx = 21 THEN p.rockets WHEN :idx = 22 THEN p.slugs
    WHEN :idx = 23 THEN p.inv_quad WHEN :idx = 24 THEN p.inv_invuln WHEN :idx = 25 THEN p.inv_silencer
    WHEN :idx = 26 THEN p.inv_breather WHEN :idx = 27 THEN p.inv_enviro
    WHEN :idx = 33 THEN IIF(BIN_AND(p.keys, 8) <> 0, MAXVALUE(p.power_cubes, 1), 0)
    WHEN :idx BETWEEN 32 AND 40 THEN IIF(BIN_AND(p.keys, CASE :idx WHEN 32 THEN 4 WHEN 34 THEN 16 WHEN 35 THEN 32 WHEN 36 THEN 64
                                                         WHEN 37 THEN 1 WHEN 38 THEN 2 WHEN 39 THEN 128 ELSE 256 END) <> 0, 1, 0)
    ELSE 0 END
    FROM player p WHERE p.id = 1 INTO n;
  RETURN COALESCE(n, 0);
END^

-- the items with a use function: the power armour, the weapons and the powerups
CREATE OR ALTER FUNCTION item_usable (idx SMALLINT) RETURNS SMALLINT
AS
BEGIN
  RETURN IIF(idx IN (5, 6) OR idx BETWEEN 7 AND 17 OR idx BETWEEN 23 AND 27, 1, 0);
END^

CREATE OR ALTER FUNCTION item_name (idx SMALLINT) RETURNS VARCHAR(20)
AS
BEGIN
  RETURN TRIM(CASE idx WHEN 1 THEN 'Body Armor' WHEN 2 THEN 'Combat Armor' WHEN 3 THEN 'Jacket Armor' WHEN 4 THEN 'Armor Shard'
    WHEN 5 THEN 'Power Screen' WHEN 6 THEN 'Power Shield' WHEN 7 THEN 'Blaster' WHEN 8 THEN 'Shotgun' WHEN 9 THEN 'Super Shotgun'
    WHEN 10 THEN 'Machinegun' WHEN 11 THEN 'Chaingun' WHEN 12 THEN 'Grenades' WHEN 13 THEN 'Grenade Launcher' WHEN 14 THEN 'Rocket Launcher'
    WHEN 15 THEN 'HyperBlaster' WHEN 16 THEN 'Railgun' WHEN 17 THEN 'BFG10K' WHEN 18 THEN 'Shells' WHEN 19 THEN 'Bullets' WHEN 20 THEN 'Cells'
    WHEN 21 THEN 'Rockets' WHEN 22 THEN 'Slugs' WHEN 23 THEN 'Quad Damage' WHEN 24 THEN 'Invulnerability' WHEN 25 THEN 'Silencer'
    WHEN 26 THEN 'Rebreather' WHEN 27 THEN 'Environment Suit' WHEN 28 THEN 'Ancient Head' WHEN 29 THEN 'Adrenaline' WHEN 30 THEN 'Bandolier'
    WHEN 31 THEN 'Ammo Pack' WHEN 32 THEN 'Data CD' WHEN 33 THEN 'Power Cube' WHEN 34 THEN 'Pyramid Key' WHEN 35 THEN 'Data Spinner'
    WHEN 36 THEN 'Security Pass' WHEN 37 THEN 'Blue Key' WHEN 38 THEN 'Red Key' WHEN 39 THEN 'Commander''s Head' WHEN 40 THEN 'Airstrike Marker'
    WHEN 41 THEN 'Health' ELSE '' END);
END^

-- FindItem: an item by its pickup name, any case (0 when there is none)
CREATE OR ALTER FUNCTION item_index (name VARCHAR(40)) RETURNS SMALLINT
AS
DECLARE i SMALLINT = 1;
BEGIN
  name = LOWER(TRIM(name));
  WHILE (i <= 41) DO
  BEGIN
    IF (LOWER(item_name(i)) = name) THEN RETURN i;
    i = i + 1;
  END
  RETURN 0;
END^

-- an item's index by the classname it spawns from (the healths are all "Health")
CREATE OR ALTER FUNCTION item_class_index (cls VARCHAR(40)) RETURNS SMALLINT
AS
BEGIN
  RETURN CASE cls WHEN 'item_armor_body' THEN 1 WHEN 'item_armor_combat' THEN 2 WHEN 'item_armor_jacket' THEN 3 WHEN 'item_armor_shard' THEN 4
    WHEN 'item_power_screen' THEN 5 WHEN 'item_power_shield' THEN 6 WHEN 'weapon_blaster' THEN 7 WHEN 'weapon_shotgun' THEN 8
    WHEN 'weapon_supershotgun' THEN 9 WHEN 'weapon_machinegun' THEN 10 WHEN 'weapon_chaingun' THEN 11 WHEN 'ammo_grenades' THEN 12
    WHEN 'weapon_grenadelauncher' THEN 13 WHEN 'weapon_rocketlauncher' THEN 14 WHEN 'weapon_hyperblaster' THEN 15 WHEN 'weapon_railgun' THEN 16
    WHEN 'weapon_bfg' THEN 17 WHEN 'ammo_shells' THEN 18 WHEN 'ammo_bullets' THEN 19 WHEN 'ammo_cells' THEN 20 WHEN 'ammo_rockets' THEN 21
    WHEN 'ammo_slugs' THEN 22 WHEN 'item_quad' THEN 23 WHEN 'item_invulnerability' THEN 24 WHEN 'item_silencer' THEN 25
    WHEN 'item_breather' THEN 26 WHEN 'item_enviro' THEN 27 WHEN 'item_ancient_head' THEN 28 WHEN 'item_adrenaline' THEN 29
    WHEN 'item_bandolier' THEN 30 WHEN 'item_pack' THEN 31 WHEN 'key_data_cd' THEN 32 WHEN 'key_power_cube' THEN 33 WHEN 'key_pyramid' THEN 34
    WHEN 'key_data_spinner' THEN 35 WHEN 'key_pass' THEN 36 WHEN 'key_blue_key' THEN 37 WHEN 'key_red_key' THEN 38
    WHEN 'key_commander_head' THEN 39 WHEN 'key_airstrike_target' THEN 40 ELSE 41 END;
END^

-- an item's classname by its itemlist index (the inverse of item_class_index; health: the plain +10 one)
CREATE OR ALTER FUNCTION item_classname (idx SMALLINT) RETURNS VARCHAR(40)
AS
BEGIN
  RETURN TRIM(CASE idx WHEN 1 THEN 'item_armor_body' WHEN 2 THEN 'item_armor_combat' WHEN 3 THEN 'item_armor_jacket' WHEN 4 THEN 'item_armor_shard'
    WHEN 5 THEN 'item_power_screen' WHEN 6 THEN 'item_power_shield' WHEN 7 THEN 'weapon_blaster' WHEN 8 THEN 'weapon_shotgun'
    WHEN 9 THEN 'weapon_supershotgun' WHEN 10 THEN 'weapon_machinegun' WHEN 11 THEN 'weapon_chaingun' WHEN 12 THEN 'ammo_grenades'
    WHEN 13 THEN 'weapon_grenadelauncher' WHEN 14 THEN 'weapon_rocketlauncher' WHEN 15 THEN 'weapon_hyperblaster' WHEN 16 THEN 'weapon_railgun'
    WHEN 17 THEN 'weapon_bfg' WHEN 18 THEN 'ammo_shells' WHEN 19 THEN 'ammo_bullets' WHEN 20 THEN 'ammo_cells' WHEN 21 THEN 'ammo_rockets'
    WHEN 22 THEN 'ammo_slugs' WHEN 23 THEN 'item_quad' WHEN 24 THEN 'item_invulnerability' WHEN 25 THEN 'item_silencer'
    WHEN 26 THEN 'item_breather' WHEN 27 THEN 'item_enviro' WHEN 28 THEN 'item_ancient_head' WHEN 29 THEN 'item_adrenaline'
    WHEN 30 THEN 'item_bandolier' WHEN 31 THEN 'item_pack' WHEN 32 THEN 'key_data_cd' WHEN 33 THEN 'key_power_cube' WHEN 34 THEN 'key_pyramid'
    WHEN 35 THEN 'key_data_spinner' WHEN 36 THEN 'key_pass' WHEN 37 THEN 'key_blue_key' WHEN 38 THEN 'key_red_key'
    WHEN 39 THEN 'key_commander_head' WHEN 40 THEN 'key_airstrike_target' WHEN 41 THEN 'item_health' ELSE '' END);
END^

-- SelectNextItem / SelectPrevItem (dir 1 / -1): the next usable item held, round the itemlist; -1 when none
CREATE OR ALTER PROCEDURE inv_select (dir SMALLINT)
AS
DECLARE cur SMALLINT; DECLARE i SMALLINT = 1; DECLARE idx SMALLINT; DECLARE u SMALLINT; DECLARE n INTEGER;
BEGIN
  SELECT p.inv_sel FROM player p WHERE p.id = 1 INTO cur;
  WHILE (i <= 41) DO
  BEGIN
    idx = MOD(cur + dir * i + 82, 41);
    u = item_usable(idx);
    IF (u = 1) THEN
    BEGIN
      n = inv_count(idx);
      IF (n > 0) THEN
      BEGIN
        UPDATE player p SET p.inv_sel = :idx WHERE p.id = 1;
        EXIT;
      END
    END
    i = i + 1;
  END
  UPDATE player p SET p.inv_sel = -1 WHERE p.id = 1;
END^

-- the inventory screen's rows (svc_inventory): every item held, with its count, in itemlist order
CREATE OR ALTER PROCEDURE inventory_list
RETURNS (idx SMALLINT, cnt INTEGER)
AS
BEGIN
  idx = 1;
  WHILE (idx <= 40) DO
  BEGIN
    cnt = inv_count(idx);
    IF (cnt > 0) THEN SUSPEND;
    idx = idx + 1;
  END
END^

-- ValidateSelectedItem: an item used up moves the selection on
CREATE OR ALTER PROCEDURE inv_validate
AS
DECLARE cur SMALLINT; DECLARE n INTEGER;
BEGIN
  SELECT p.inv_sel FROM player p WHERE p.id = 1 INTO cur;
  n = IIF(cur > 0, inv_count(cur), 0);
  IF (n <= 0) THEN EXECUTE PROCEDURE inv_select(1);
END^

-- the pickup functions of g_items.c: taken says whether the item was taken, idx is its itemlist index
CREATE OR ALTER PROCEDURE item_pickup (item INTEGER, other INTEGER)
RETURNS (taken SMALLINT, snd_ VARCHAR(64), idx SMALLINT)
AS
DECLARE cls VARCHAR(40); DECLARE hp INTEGER; DECLARE mhp INTEGER;
DECLARE t DOUBLE PRECISION; DECLARE w INTEGER; DECLARE have INTEGER; DECLARE n INTEGER; DECLARE sk SMALLINT;
DECLARE av INTEGER; DECLARE atype SMALLINT; DECLARE newtype SMALLINT; DECLARE base INTEGER; DECLARE mx INTEGER; DECLARE kbit INTEGER;
DECLARE cnt INTEGER; DECLARE ak SMALLINT; DECLARE oldcount INTEGER; DECLARE isf INTEGER;
BEGIN
  taken = 0;
  SELECT e.classname, e.count_, e.spawnflags FROM ents e WHERE e.id = :item INTO cls, cnt, isf;
  SELECT e.health, e.max_health FROM ents e WHERE e.id = :other INTO hp, mhp;
  SELECT p.weapons, p.armor, p.armor_type FROM player p WHERE p.id = 1 INTO have, av, atype;
  idx = item_class_index(cls);
  t = now_();
  snd_ = 'items/pkup.wav';

  -- health
  IF (cls = 'item_health_small') THEN
  BEGIN
    UPDATE ents e SET e.health = e.health + 2 WHERE e.id = :other;   -- stimpacks ignore the maximum
    snd_ = 'items/s_health.wav';
  END
  ELSE IF (cls IN ('item_health', 'item_health_large')) THEN
  BEGIN
    IF (hp >= mhp) THEN EXIT;
    UPDATE ents e SET e.health = MINVALUE(e.health + IIF(:cls = 'item_health', 10, 25), e.max_health) WHERE e.id = :other;
    snd_ = IIF(cls = 'item_health', 'items/n_health.wav', 'items/l_health.wav');
  END
  ELSE IF (cls = 'item_health_mega') THEN
  BEGIN
    UPDATE ents e SET e.health = e.health + 100 WHERE e.id = :other;
    UPDATE player p SET p.mega_time = :t + 5 WHERE p.id = 1;
    snd_ = 'items/m_health.wav';
  END
  -- armour (Pickup_Armor)
  ELSE IF (cls = 'item_armor_shard') THEN
  BEGIN
    UPDATE player p SET p.armor = p.armor + 2, p.armor_type = IIF(p.armor_type = 0, 1, p.armor_type) WHERE p.id = 1;
    snd_ = 'misc/ar2_pkup.wav';
  END
  ELSE IF (cls IN ('item_armor_jacket', 'item_armor_combat', 'item_armor_body')) THEN
  BEGIN
    newtype = CASE cls WHEN 'item_armor_jacket' THEN 1 WHEN 'item_armor_combat' THEN 2 ELSE 3 END;
    base = CASE newtype WHEN 1 THEN 25 WHEN 2 THEN 50 ELSE 100 END;
    mx = CASE newtype WHEN 1 THEN 50 WHEN 2 THEN 100 ELSE 200 END;
    IF (atype = 0 OR av = 0) THEN
      UPDATE player p SET p.armor = :base, p.armor_type = :newtype WHERE p.id = 1;
    ELSE IF (newtype > atype) THEN
    BEGIN
      -- the better armour: keep part of the old count, converted
      n = CAST(av * (CASE atype WHEN 1 THEN 0.3e0 WHEN 2 THEN 0.6e0 ELSE 0.8e0 END) / (CASE newtype WHEN 1 THEN 0.3e0 WHEN 2 THEN 0.6e0 ELSE 0.8e0 END) AS INTEGER);
      UPDATE player p SET p.armor = MINVALUE(:mx, :base + :n), p.armor_type = :newtype WHERE p.id = 1;
    END
    ELSE
    BEGIN
      -- same or worse: add converted points to the current armour
      n = CAST(base * (CASE newtype WHEN 1 THEN 0.3e0 WHEN 2 THEN 0.6e0 ELSE 0.8e0 END) / (CASE atype WHEN 1 THEN 0.3e0 WHEN 2 THEN 0.6e0 ELSE 0.8e0 END) AS INTEGER);
      mx = CASE atype WHEN 1 THEN 50 WHEN 2 THEN 100 ELSE 200 END;
      IF (av >= mx) THEN EXIT;
      UPDATE player p SET p.armor = MINVALUE(:mx, p.armor + :n) WHERE p.id = 1;
    END
    snd_ = 'misc/ar1_pkup.wav';
  END
  ELSE IF (cls IN ('item_power_shield', 'item_power_screen')) THEN
  BEGIN
    -- Pickup_PowerArmor: into the inventory; single player switches it on only when it is used
    UPDATE player p SET p.inv_shield = p.inv_shield + IIF(:idx = 6, 1, 0), p.inv_screen = p.inv_screen + IIF(:idx = 5, 1, 0) WHERE p.id = 1;
    snd_ = 'misc/ar3_pkup.wav';
  END
  -- ammo (Pickup_Ammo)
  ELSE IF (cls LIKE 'ammo_%') THEN
  BEGIN
    ak = CASE cls WHEN 'ammo_shells' THEN 1 WHEN 'ammo_bullets' THEN 2 WHEN 'ammo_grenades' THEN 3 WHEN 'ammo_rockets' THEN 4 WHEN 'ammo_cells' THEN 5 WHEN 'ammo_slugs' THEN 6 ELSE 0 END;
    n = IIF(cnt > 0, cnt, CASE ak WHEN 1 THEN 10 WHEN 2 THEN 50 WHEN 3 THEN 5 WHEN 4 THEN 5 WHEN 5 THEN 50 WHEN 6 THEN 10 ELSE 0 END);
    oldcount = ammo_count(ak);
    IF (add_ammo(ak, n) = 0) THEN EXIT;
    -- a box of grenades is the hand grenade weapon too; the first one raises it (Pickup_Ammo, single player)
    IF (ak = 3 AND BIN_AND(have, 32) = 0) THEN UPDATE player p SET p.weapons = BIN_OR(p.weapons, 32) WHERE p.id = 1;
    IF (ak = 3 AND oldcount = 0) THEN
      UPDATE player p SET p.weapon = 32, p.grenade_time = 0, p.chaingun_spin = 0, p.weapon_sound = 0,
             p.attack_finished = MAXVALUE(p.attack_finished, :t + 0.3e0) WHERE p.id = 1 AND p.weapon <> 32;
    snd_ = 'misc/am_pkup.wav';
  END
  -- weapons (Pickup_Weapon)
  ELSE IF (cls LIKE 'weapon_%') THEN
  BEGIN
    w = CASE cls WHEN 'weapon_shotgun' THEN 2 WHEN 'weapon_supershotgun' THEN 4 WHEN 'weapon_machinegun' THEN 8 WHEN 'weapon_chaingun' THEN 16
                 WHEN 'weapon_grenadelauncher' THEN 64 WHEN 'weapon_rocketlauncher' THEN 128 WHEN 'weapon_hyperblaster' THEN 256 WHEN 'weapon_railgun' THEN 512
                 WHEN 'weapon_bfg' THEN 1024 ELSE 0 END;
    IF (w = 0) THEN EXIT;
    -- Pickup_Weapon in single player: always taken, with its ammo (as much as fits) unless it was dropped
    -- (DROPPED_ITEM); the first one of its kind is raised at once, whatever is in hand
    ak = weapon_ammo(w);
    n = CASE ak WHEN 1 THEN 10 WHEN 2 THEN 50 WHEN 3 THEN 5 WHEN 4 THEN 5 WHEN 5 THEN 50 WHEN 6 THEN 10 ELSE 0 END;
    IF (BIN_AND(COALESCE(isf, 0), 65536) = 0) THEN n = add_ammo(ak, n);
    IF (BIN_AND(have, w) = 0) THEN
      UPDATE player p SET p.weapons = BIN_OR(p.weapons, :w), p.weapon = :w, p.grenade_time = 0, p.chaingun_spin = 0, p.weapon_sound = 0,
             p.attack_finished = MAXVALUE(p.attack_finished, :t + 0.3e0) WHERE p.id = 1;
    snd_ = 'misc/w_pkup.wav';
  END
  -- keys
  ELSE IF (cls LIKE 'key_%') THEN
  BEGIN
    kbit = CASE cls WHEN 'key_blue_key' THEN 1 WHEN 'key_red_key' THEN 2 WHEN 'key_data_cd' THEN 4 WHEN 'key_power_cube' THEN 8 WHEN 'key_pyramid' THEN 16
                    WHEN 'key_data_spinner' THEN 32 WHEN 'key_pass' THEN 64 WHEN 'key_commander_head' THEN 128 WHEN 'key_airstrike_target' THEN 256 ELSE 0 END;
    UPDATE player p SET p.keys = BIN_OR(p.keys, :kbit), p.power_cubes = p.power_cubes + IIF(:kbit = 8, 1, 0) WHERE p.id = 1;
    snd_ = 'items/pkup.wav';
  END
  -- powerups (Pickup_Powerup): into the inventory, to be used with their key or invuse; hard holds one of each,
  -- medium two, easy any number
  ELSE IF (idx BETWEEN 23 AND 27) THEN
  BEGIN
    SELECT g.skill FROM game g WHERE g.id = 1 INTO sk;
    n = inv_count(idx);
    IF ((sk = 1 AND n >= 2) OR (sk >= 2 AND n >= 1)) THEN EXIT;
    UPDATE player p SET p.inv_quad = p.inv_quad + IIF(:idx = 23, 1, 0), p.inv_invuln = p.inv_invuln + IIF(:idx = 24, 1, 0),
           p.inv_silencer = p.inv_silencer + IIF(:idx = 25, 1, 0), p.inv_breather = p.inv_breather + IIF(:idx = 26, 1, 0),
           p.inv_enviro = p.inv_enviro + IIF(:idx = 27, 1, 0) WHERE p.id = 1;
  END
  ELSE IF (cls = 'item_adrenaline') THEN
  BEGIN
    UPDATE ents e SET e.max_health = e.max_health + 1, e.health = MAXVALUE(e.health, e.max_health + 1) WHERE e.id = :other;
  END
  ELSE IF (cls = 'item_bandolier') THEN
  BEGIN
    UPDATE player p SET p.max_bullets = MAXVALUE(p.max_bullets, 250), p.max_shells = MAXVALUE(p.max_shells, 150), p.max_cells = MAXVALUE(p.max_cells, 250), p.max_slugs = MAXVALUE(p.max_slugs, 75) WHERE p.id = 1;
    n = add_ammo(2, 50); n = add_ammo(1, 10);
  END
  ELSE IF (cls = 'item_pack') THEN
  BEGIN
    UPDATE player p SET p.max_bullets = MAXVALUE(p.max_bullets, 300), p.max_shells = MAXVALUE(p.max_shells, 200), p.max_rockets = MAXVALUE(p.max_rockets, 100),
           p.max_grenades = MAXVALUE(p.max_grenades, 100), p.max_cells = MAXVALUE(p.max_cells, 300), p.max_slugs = MAXVALUE(p.max_slugs, 100) WHERE p.id = 1;
    n = add_ammo(2, 50); n = add_ammo(1, 10); n = add_ammo(5, 50); n = add_ammo(3, 5); n = add_ammo(4, 5); n = add_ammo(6, 10);
  END
  ELSE EXIT;
  taken = 1;
END^

-- Touch_Item: what was taken flashes the screen, shows its icon and name on the status bar for three seconds,
-- becomes the selected item if it can be used, and goes; the item's targets fire the first time it is touched,
-- taken or not (ITEM_TARGETS_USED, spawnflags 0x40000)
CREATE OR ALTER PROCEDURE item_touch (item INTEGER, other INTEGER)
AS
DECLARE taken SMALLINT; DECLARE snd_ VARCHAR(64); DECLARE idx SMALLINT; DECLARE hp INTEGER; DECLARE sf INTEGER;
DECLARE t DOUBLE PRECISION; DECLARE u SMALLINT;
BEGIN
  IF (other <> player_ent()) THEN EXIT;
  SELECT e.health FROM ents e WHERE e.id = :other INTO hp;
  IF (hp <= 0) THEN EXIT;                                 -- dead people can't pick up
  EXECUTE PROCEDURE item_pickup(item, other) RETURNING_VALUES taken, snd_, idx;
  IF (taken = 1) THEN
  BEGIN
    t = now_();
    u = item_usable(idx);
    UPDATE player p SET p.bonus_time = :t, p.pickup_item = :idx, p.pickup_time = :t + 3,
           p.inv_sel = IIF(:u = 1, :idx, p.inv_sel) WHERE p.id = 1;
    EXECUTE PROCEDURE snd(other, 3, snd_, 1, 1);
  END
  SELECT e.spawnflags FROM ents e WHERE e.id = :item INTO sf;
  IF (sf IS NOT NULL AND BIN_AND(sf, 262144) = 0) THEN
  BEGIN
    UPDATE ents e SET e.spawnflags = BIN_OR(e.spawnflags, 262144) WHERE e.id = :item;
    EXECUTE PROCEDURE use_targets(item, other);
  END
  IF (taken = 1) THEN DELETE FROM ents e WHERE e.id = :item;
END^

-- ── damage (g_combat.c) ──────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE throw_gib (eid INTEGER, model VARCHAR(64), dmg INTEGER, kind SMALLINT)
AS
DECLARE g INTEGER; DECLARE spd DOUBLE PRECISION;
DECLARE x DOUBLE PRECISION; DECLARE y DOUBLE PRECISION; DECLARE z DOUBLE PRECISION;
DECLARE sx DOUBLE PRECISION; DECLARE sy DOUBLE PRECISION; DECLARE sz DOUBLE PRECISION;
BEGIN
  SELECT e.x + (e.minx + e.maxx) / 2 + crand() * (e.maxx - e.minx) * 0.5e0, e.y + (e.miny + e.maxy) / 2 + crand() * (e.maxy - e.miny) * 0.5e0,
         e.z + (e.minz + e.maxz) / 2 + crand() * (e.maxz - e.minz) * 0.5e0 FROM ents e WHERE e.id = :eid INTO x, y, z;
  EXECUTE PROCEDURE spawn_ent('gib', x, y, z) RETURNING_VALUES g;
  EXECUTE PROCEDURE set_model(g, model);
  -- VelocityForDamage
  spd = IIF(dmg < 50, 0.7e0, 1.2e0);
  UPDATE ents e SET e.movetype = IIF(:kind = 1, 6, 10), e.solid = 0, e.clipmask = 3, e.effects = 2,
         e.vx = 100 * crand() * :spd * 2, e.vy = 100 * crand() * :spd * 2, e.vz = (RAND() * 200 + 200) * :spd,
         e.avel_yaw = RAND() * 600, e.avel_pitch = RAND() * 600, e.think = 'remove', e.nextthink = now_() + 10 + RAND() * 10, e.frame = 0 WHERE e.id = :g;
END^

CREATE OR ALTER PROCEDURE throw_head (eid INTEGER, model VARCHAR(64), dmg INTEGER)
AS
BEGIN
  EXECUTE PROCEDURE set_model(eid, model);
  UPDATE ents e SET e.movetype = 10, e.solid = 0, e.takedamage = 0, e.frame = 0, e.anim = NULL, e.st = 'dead', e.skin = 0, e.effects = 2,
         e.minx = -16, e.miny = -16, e.minz = 0, e.maxx = 16, e.maxy = 16, e.maxz = 16, e.z = e.z + 32,
         e.vx = 100 * crand(), e.vy = 100 * crand(), e.vz = RAND() * 200 + 200,
         e.avel_yaw = RAND() * 600, e.think = 'remove', e.nextthink = now_() + 20, e.flags = BIN_AND(e.flags, BIN_NOT(512)) WHERE e.id = :eid;
END^

-- gibs: ThrowGib × n and the head
CREATE OR ALTER PROCEDURE gib_ent (eid INTEGER, dmg INTEGER)
AS
DECLARE i INTEGER = 0;
BEGIN
  EXECUTE PROCEDURE snd(eid, 2, 'misc/udeath.wav', 1, 1);
  WHILE (i < 2) DO BEGIN EXECUTE PROCEDURE throw_gib(eid, 'models/objects/gibs/bone/tris.md2', dmg, 1); i = i + 1; END
  i = 0;
  WHILE (i < 4) DO BEGIN EXECUTE PROCEDURE throw_gib(eid, 'models/objects/gibs/sm_meat/tris.md2', dmg, 1); i = i + 1; END
  EXECUTE PROCEDURE throw_head(eid, 'models/objects/gibs/head2/tris.md2', dmg);
END^

-- BecomeExplosion1/2: the entity bursts (kind 2 = explosion with debris, used by func_explosive and barrels)
CREATE OR ALTER PROCEDURE become_explosion (eid INTEGER, kind SMALLINT)
AS
DECLARE x DOUBLE PRECISION; DECLARE y DOUBLE PRECISION; DECLARE z DOUBLE PRECISION; DECLARE dmg INTEGER; DECLARE mass INTEGER; DECLARE i INTEGER = 0; DECLARE g INTEGER;
DECLARE sx DOUBLE PRECISION; DECLARE sy DOUBLE PRECISION; DECLARE sz DOUBLE PRECISION; DECLARE n INTEGER;
BEGIN
  SELECT e.x + (e.minx + e.maxx) / 2, e.y + (e.miny + e.maxy) / 2, e.z + (e.minz + e.maxz) / 2, e.dmg, e.mass, e.maxx - e.minx, e.maxy - e.miny, e.maxz - e.minz
    FROM ents e WHERE e.id = :eid INTO x, y, z, dmg, mass, sx, sy, sz;
  IF (x IS NULL) THEN EXIT;
  IF (dmg > 0) THEN EXECUTE PROCEDURE t_radius_damage(eid, eid, dmg, eid, dmg + 40);
  -- debris: bigger things throw more
  n = IIF(mass >= 400, 8, IIF(mass >= 100, 4, 2));
  WHILE (i < n) DO
  BEGIN
    EXECUTE PROCEDURE spawn_ent('debris', x + crand() * sx / 2, y + crand() * sy / 2, z + crand() * sz / 2) RETURNING_VALUES g;
    EXECUTE PROCEDURE set_model(g, 'models/objects/debris' || (1 + MOD(:i, 3)) || '/tris.md2');
    UPDATE ents e SET e.movetype = 10, e.solid = 0, e.clipmask = 3, e.vx = crand() * 200, e.vy = crand() * 200, e.vz = 100 + RAND() * 200,
           e.avel_yaw = crand() * 600, e.avel_pitch = crand() * 600, e.think = 'remove', e.nextthink = now_() + 5 + RAND() * 5 WHERE e.id = :g;
    i = i + 1;
  END
  EXECUTE PROCEDURE fx(2, x, y, z, 0, 0, 0, 0);
  EXECUTE PROCEDURE snd_at(x, y, z, 'weapons/rocklx1a.wav', 1, 1);
  EXECUTE PROCEDURE use_targets(eid, player_ent());
  DELETE FROM ents e WHERE e.id = :eid;
END^

-- Killed(): the target's health fell to zero
CREATE OR ALTER PROCEDURE killed (targ INTEGER, attacker INTEGER)
AS
DECLARE cls VARCHAR(40); DECLARE flags INTEGER; DECLARE hp INTEGER; DECLARE gh INTEGER;
BEGIN
  SELECT e.classname, e.flags, e.health, e.gib_health FROM ents e WHERE e.id = :targ INTO cls, flags, hp, gh;
  IF (hp < -999) THEN UPDATE ents e SET e.health = -999 WHERE e.id = :targ;
  IF (cls = 'player') THEN
  BEGIN
    UPDATE ents e SET e.deadflag = 1, e.solid = 0, e.movetype = 6, e.minz = -24, e.maxz = -8, e.takedamage = 0, e.viewheight = -8 WHERE e.id = :targ;
    UPDATE player p SET p.dead_time = now_(), p.view_ofs = -8, p.weapon = 0, p.quad_finished = 0, p.invincible_finished = 0, p.breather_finished = 0, p.enviro_finished = 0 WHERE p.id = 1;
    IF (hp < -40) THEN
    BEGIN
      EXECUTE PROCEDURE snd(targ, 2, 'misc/udeath.wav', 1, 1);
      EXECUTE PROCEDURE fx(3, (SELECT e.x FROM ents e WHERE e.id = :targ), (SELECT e.y FROM ents e WHERE e.id = :targ), (SELECT e.z FROM ents e WHERE e.id = :targ), 0, 0, 0, 60);
    END
    ELSE EXECUTE PROCEDURE snd(targ, 2, 'player/male/death' || CAST(1 + FLOOR(RAND() * 4) AS INTEGER) || '.wav', 1, 1);
    EXIT;
  END
  IF (BIN_AND(flags, 32) <> 0) THEN
  BEGIN
    -- turret_driver_die: the gun levels and is nobody's; then the infantry's death
    IF (cls = 'turret_driver') THEN
    BEGIN
      UPDATE ents b SET b.sg_x = 0, b.owner_id = NULL WHERE b.id = (SELECT d.goal_id FROM ents d WHERE d.id = :targ);
      UPDATE ents m SET m.owner_id = NULL WHERE m.id = (SELECT COALESCE(b.linked_id, b.id) FROM ents d JOIN ents b ON b.id = d.goal_id WHERE d.id = :targ);
    END
    EXECUTE PROCEDURE monster_die(targ, attacker);
    EXIT;
  END
  IF (cls IN ('misc_explobox', 'func_explosive')) THEN
  BEGIN
    EXECUTE PROCEDURE become_explosion(targ, 2);
    EXIT;
  END
  IF (cls IN ('misc_deadsoldier', 'misc_gib_head', 'misc_gib_arm', 'misc_gib_leg')) THEN
  BEGIN
    EXECUTE PROCEDURE gib_ent(targ, -hp);
    DELETE FROM ents e WHERE e.id = :targ;
    EXIT;
  END
  -- shootable doors, buttons and triggers
  IF (cls IN ('func_door', 'func_door_rotating')) THEN
  BEGIN
    UPDATE ents e SET e.takedamage = 0, e.health = e.max_health WHERE e.id = :targ;
    EXECUTE PROCEDURE door_use(targ, attacker);
  END
  ELSE IF (cls = 'func_door_secret') THEN
  BEGIN
    -- door_secret_die (one given a health opens the same way: Quake's door_killed would have used its
    -- missing team master)
    UPDATE ents e SET e.takedamage = 0, e.health = e.max_health WHERE e.id = :targ;
    EXECUTE PROCEDURE door_secret_use(targ);
  END
  ELSE IF (cls = 'func_button') THEN
  BEGIN
    UPDATE ents e SET e.takedamage = 0 WHERE e.id = :targ;
    EXECUTE PROCEDURE button_fire(targ, attacker);
  END
  ELSE IF (cls IN ('trigger_multiple', 'trigger_once')) THEN
  BEGIN
    UPDATE ents e SET e.takedamage = 0 WHERE e.id = :targ;
    EXECUTE PROCEDURE trigger_fire(targ, attacker);
  END
END^

-- T_Damage. dflags: 1 radius 2 no armour 4 energy 8 no knockback 16 bullet 32 no protection
CREATE OR ALTER PROCEDURE t_damage (targ INTEGER, inflictor INTEGER, attacker INTEGER, damage INTEGER, knockback INTEGER, dflags INTEGER)
AS
DECLARE td SMALLINT; DECLARE cls VARCHAR(40); DECLARE flags INTEGER; DECLARE hp INTEGER; DECLARE mass INTEGER; DECLARE mt SMALLINT;
DECLARE save INTEGER; DECLARE take INTEGER; DECLARE av INTEGER; DECLARE atype SMALLINT; DECLARE inv DOUBLE PRECISION; DECLARE prot DOUBLE PRECISION;
DECLARE dx DOUBLE PRECISION; DECLARE dy DOUBLE PRECISION; DECLARE dz DOUBLE PRECISION; DECLARE dl DOUBLE PRECISION; DECLARE kv DOUBLE PRECISION;
DECLARE pe INTEGER; DECLARE qf DOUBLE PRECISION; DECLARE pf DOUBLE PRECISION; DECLARE pa SMALLINT; DECLARE ce INTEGER;
DECLARE isc SMALLINT; DECLARE ish SMALLINT; DECLARE pdmg INTEGER; DECLARE dpc SMALLINT; DECLARE front SMALLINT;
DECLARE fx_ DOUBLE PRECISION; DECLARE fy_ DOUBLE PRECISION; DECLARE ix DOUBLE PRECISION; DECLARE iy DOUBLE PRECISION; DECLARE iz DOUBLE PRECISION;
DECLARE tx DOUBLE PRECISION; DECLARE ty DOUBLE PRECISION; DECLARE tz DOUBLE PRECISION; DECLARE tyaw DOUBLE PRECISION;
BEGIN
  SELECT e.takedamage, e.classname, e.flags, e.health, e.movetype, e.mass FROM ents e WHERE e.id = :targ INTO td, cls, flags, hp, mt, mass;
  IF (td IS NULL OR td = 0) THEN EXIT;
  -- (what is already dead is not killed again; a secret door takes damage at health 0 and dies of any)
  IF (hp <= 0 AND cls <> 'player' AND BIN_AND(flags, 32) = 0 AND cls <> 'func_door_secret') THEN EXIT;
  pe = player_ent();
  IF (attacker = pe) THEN
  BEGIN
    SELECT p.quad_finished FROM player p WHERE p.id = 1 INTO qf;
    IF (qf > now_()) THEN BEGIN damage = damage * 4; knockback = knockback * 4; END
  END
  IF (BIN_AND(flags, 64) <> 0 AND attacker = pe) THEN EXIT;    -- FL_NOTARGET-style: monsters don't hurt each other here anyway

  -- knockback
  IF (BIN_AND(dflags, 8) = 0 AND knockback > 0 AND mt NOT IN (0, 7, 8, 10) AND inflictor IS NOT NULL AND inflictor > 0) THEN
  BEGIN
    SELECT e1.x - (e2.x + (e2.minx + e2.maxx) / 2), e1.y - (e2.y + (e2.miny + e2.maxy) / 2), e1.z - (e2.z + (e2.minz + e2.maxz) / 2)
      FROM ents e1 CROSS JOIN ents e2 WHERE e1.id = :targ AND e2.id = :inflictor INTO dx, dy, dz;
    IF (inflictor = targ) THEN BEGIN dx = 0; dy = 0; dz = 1; END
    dl = vlen(dx, dy, dz);
    IF (dl > 0) THEN
    BEGIN
      kv = IIF(attacker = targ, 1600e0, 500e0) * knockback / MAXVALUE(50, mass);
      UPDATE ents e SET e.vx = e.vx + :dx / :dl * :kv, e.vy = e.vy + :dy / :dl * :kv, e.vz = e.vz + :dz / :dl * :kv,
             e.flags = IIF(:kv > 100, BIN_AND(e.flags, BIN_NOT(512)), e.flags) WHERE e.id = :targ;
    END
  END

  save = 0;
  IF (cls = 'player') THEN
  BEGIN
    IF (BIN_AND(flags, 16) <> 0) THEN EXIT;                               -- god mode
    SELECT p.armor, p.armor_type, p.invincible_finished, p.pain_finished, p.power_armor, p.cells, p.inv_screen, p.inv_shield FROM player p WHERE p.id = 1
      INTO av, atype, inv, pf, pa, ce, isc, ish;
    pa = IIF(pa = 1, IIF(ish > 0, 2, IIF(isc > 0, 1, 0)), 0);           -- PowerArmorType
    IF (inv > now_() AND BIN_AND(dflags, 32) = 0) THEN
    BEGIN
      IF (pf < now_()) THEN
      BEGIN
        EXECUTE PROCEDURE snd(targ, 3, 'items/protect4.wav', 1, 1);
        UPDATE player p SET p.pain_finished = now_() + 2 WHERE p.id = 1;
      END
      EXIT;
    END
    -- CheckPowerArmor: the screen stops a third of a blow from in front of it (within about 73 degrees of the
    -- view), a cell a point; the shield two thirds from anywhere, a cell for two points. Its sparks are
    -- TE_SCREEN_SPARKS (green) or TE_SHIELD_SPARKS (blue), with weapons/lashit.wav.
    IF (pa > 0 AND ce > 0 AND BIN_AND(dflags, 2) = 0) THEN
    BEGIN
      SELECT e.x, e.y, e.z + (e.minz + e.maxz) / 2, e.yaw FROM ents e WHERE e.id = :targ INTO tx, ty, tz, tyaw;
      ix = NULL;
      SELECT e.x + (e.minx + e.maxx) / 2, e.y + (e.miny + e.maxy) / 2, e.z + (e.minz + e.maxz) / 2 FROM ents e
       WHERE e.id = IIF(:inflictor IS NOT NULL AND :inflictor > 0 AND :inflictor <> :targ, :inflictor, :attacker) INTO ix, iy, iz;
      front = 1;
      IF (pa = 1) THEN
      BEGIN
        fx_ = COS(tyaw * PI() / 180); fy_ = SIN(tyaw * PI() / 180);
        dl = vlen(COALESCE(ix, tx) - tx, COALESCE(iy, ty) - ty, COALESCE(iz, tz) - tz);
        IF (dl <= 0 OR ((ix - tx) * fx_ + (iy - ty) * fy_) / dl <= 0.3e0) THEN front = 0;
      END
      IF (front = 1) THEN
      BEGIN
        dpc = IIF(pa = 2, 2, 1);
        pdmg = IIF(pa = 2, TRUNC(2 * damage / 3e0), TRUNC(damage / 3e0));
        save = ce * dpc;
        IF (save > pdmg) THEN save = pdmg;
        IF (save > 0) THEN
        BEGIN
          UPDATE player p SET p.cells = MAXVALUE(0, p.cells - TRUNC(:save / :dpc)), p.dmg_save = p.dmg_save + :save WHERE p.id = 1;
          damage = damage - save;
          dl = vlen(COALESCE(ix, tx) - tx, COALESCE(iy, ty) - ty, COALESCE(iz, tz) - tz);
          IF (dl > 0) THEN BEGIN ix = (ix - tx) / dl; iy = (iy - ty) / dl; iz = (iz - tz) / dl; END ELSE BEGIN ix = 0; iy = 0; iz = 1; END
          EXECUTE PROCEDURE fx(7, tx + ix * 16, ty + iy * 16, tz + iz * 16, ix, iy, iz, 40 * 16 + IIF(pa = 2, 2, 4));
          EXECUTE PROCEDURE snd_at(tx + ix * 16, ty + iy * 16, tz + iz * 16, 'weapons/lashit.wav', 1, 1);
        END
        save = 0;
      END
    END
    -- CheckArmor
    IF (av > 0 AND atype > 0 AND BIN_AND(dflags, 2) = 0) THEN
    BEGIN
      prot = IIF(BIN_AND(dflags, 4) <> 0, CASE atype WHEN 1 THEN 0e0 WHEN 2 THEN 0.3e0 ELSE 0.6e0 END, CASE atype WHEN 1 THEN 0.3e0 WHEN 2 THEN 0.6e0 ELSE 0.8e0 END);
      save = CEILING(prot * damage);
      IF (save >= av) THEN save = av;
      UPDATE player p SET p.armor = p.armor - :save, p.armor_type = IIF(p.armor - :save <= 0, 0, p.armor_type) WHERE p.id = 1;
    END
    UPDATE player p SET p.dmg_take = p.dmg_take + (:damage - :save), p.dmg_save = p.dmg_save + :save, p.dmg_time = now_() WHERE p.id = 1;
  END
  take = damage - save;
  IF (take <= 0 AND cls = 'player') THEN EXIT;

  UPDATE ents e SET e.health = e.health - :take WHERE e.id = :targ RETURNING e.health INTO hp;
  IF (hp <= 0) THEN
  BEGIN
    IF (cls = 'player' OR BIN_AND(flags, 32) <> 0) THEN UPDATE ents e SET e.flags = BIN_OR(e.flags, 4096) WHERE e.id = :targ;   -- no more knockback
    IF (cls = 'player' AND EXISTS (SELECT 1 FROM ents e WHERE e.id = :targ AND e.deadflag = 1)) THEN
    BEGIN
      -- already dead: gib the corpse
      IF (hp < -40) THEN BEGIN EXECUTE PROCEDURE gib_ent(targ, take); UPDATE ents e SET e.model_id = NULL WHERE e.id = :targ; END
      EXIT;
    END
    EXECUTE PROCEDURE killed(targ, attacker);
    EXIT;
  END
  IF (cls = 'player') THEN
  BEGIN
    SELECT p.pain_finished FROM player p WHERE p.id = 1 INTO pf;
    IF (pf < now_() AND take > 0) THEN
    BEGIN
      EXECUTE PROCEDURE snd(targ, 2, 'player/male/pain' || CASE WHEN hp < 25 THEN '25' WHEN hp < 50 THEN '50' WHEN hp < 75 THEN '75' ELSE '100' END || '_' || CAST(1 + FLOOR(RAND() * 2) AS INTEGER) || '.wav', 1, 1);
      UPDATE player p SET p.pain_finished = now_() + 0.7e0, p.punchangle = -2 WHERE p.id = 1;
    END
    EXIT;
  END
  IF (BIN_AND(flags, 32) <> 0) THEN
  BEGIN
    -- monsters get mad at whoever hurt them
    IF (attacker = pe) THEN
      UPDATE ents e SET e.enemy_id = :attacker, e.st = IIF(e.st = 'stand' OR e.st = 'walk', 'run', e.st), e.anim = IIF(e.st = 'stand' OR e.st = 'walk', NULL, e.anim) WHERE e.id = :targ;
    EXECUTE PROCEDURE monster_pain(targ, attacker, take);
  END
END^

-- T_RadiusDamage
-- CanDamage (g_combat.c): a clear line (MASK_SOLID: monsters don't block) from the inflictor to the
-- target's origin, or to four points 15 units off it; a brush model is aimed at the middle of its box.
CREATE OR ALTER FUNCTION can_damage (targ INTEGER, inflictor INTEGER) RETURNS SMALLINT
AS
DECLARE ix DOUBLE PRECISION; DECLARE iy DOUBLE PRECISION; DECLARE iz DOUBLE PRECISION;
DECLARE tx DOUBLE PRECISION; DECLARE ty DOUBLE PRECISION; DECLARE tz DOUBLE PRECISION; DECLARE mt SMALLINT;
DECLARE cx DOUBLE PRECISION; DECLARE cy DOUBLE PRECISION; DECLARE cz DOUBLE PRECISION; DECLARE k INTEGER = 0;
DECLARE f DOUBLE PRECISION; DECLARE ex DOUBLE PRECISION; DECLARE ey DOUBLE PRECISION; DECLARE ez DOUBLE PRECISION;
DECLARE nx DOUBLE PRECISION; DECLARE ny DOUBLE PRECISION; DECLARE nz DOUBLE PRECISION;
DECLARE sf INTEGER; DECLARE ct INTEGER; DECLARE als SMALLINT; DECLARE sts SMALLINT; DECLARE hit INTEGER;
BEGIN
  SELECT e.x, e.y, e.z FROM ents e WHERE e.id = :inflictor INTO ix, iy, iz;
  SELECT e.x, e.y, e.z, e.movetype, e.x + (e.minx + e.maxx) / 2, e.y + (e.miny + e.maxy) / 2, e.z + (e.minz + e.maxz) / 2
    FROM ents e WHERE e.id = :targ INTO tx, ty, tz, mt, cx, cy, cz;
  IF (ix IS NULL OR tx IS NULL) THEN RETURN 0;
  IF (mt = 7) THEN
  BEGIN
    EXECUTE PROCEDURE trace_move(inflictor, 0, 0, 0, 0, 0, 0, ix, iy, iz, cx, cy, cz, 3) RETURNING_VALUES f, ex, ey, ez, nx, ny, nz, sf, ct, als, sts, hit;
    RETURN IIF(f = 1 OR hit = targ, 1, 0);
  END
  WHILE (k < 5) DO
  BEGIN
    EXECUTE PROCEDURE trace_move(inflictor, 0, 0, 0, 0, 0, 0, ix, iy, iz,
        tx + CASE k WHEN 0 THEN 0 WHEN 1 THEN 15 WHEN 2 THEN 15 WHEN 3 THEN -15 ELSE -15 END,
        ty + CASE k WHEN 0 THEN 0 WHEN 1 THEN 15 WHEN 2 THEN -15 WHEN 3 THEN 15 ELSE -15 END, tz, 3)
      RETURNING_VALUES f, ex, ey, ez, nx, ny, nz, sf, ct, als, sts, hit;
    IF (f = 1) THEN RETURN 1;
    k = k + 1;
  END
  RETURN 0;
END^

-- T_RadiusDamage: everything that can be hurt within the radius of the inflictor (findradius measures to the
-- middle of the target's box) takes damage - half the distance, half of it again if it is the attacker,
-- if CanDamage says the blast reaches it
CREATE OR ALTER PROCEDURE t_radius_damage (inflictor INTEGER, attacker INTEGER, damage DOUBLE PRECISION, ignore INTEGER, radius DOUBLE PRECISION)
AS
DECLARE ix DOUBLE PRECISION; DECLARE iy DOUBLE PRECISION; DECLARE iz DOUBLE PRECISION;
DECLARE eid INTEGER; DECLARE d DOUBLE PRECISION; DECLARE pts DOUBLE PRECISION; DECLARE ok SMALLINT;
DECLARE cx DOUBLE PRECISION; DECLARE cy DOUBLE PRECISION; DECLARE cz DOUBLE PRECISION;
BEGIN
  SELECT e.x, e.y, e.z FROM ents e WHERE e.id = :inflictor INTO ix, iy, iz;
  IF (ix IS NULL) THEN EXIT;
  FOR SELECT e.id, e.x + (e.minx + e.maxx) / 2, e.y + (e.miny + e.maxy) / 2, e.z + (e.minz + e.maxz) / 2
        FROM ents e
       WHERE e.takedamage > 0 AND (:ignore IS NULL OR e.id <> :ignore) AND e.id <> :inflictor
         AND ABS(e.x + (e.minx + e.maxx) / 2 - :ix) <= :radius AND ABS(e.y + (e.miny + e.maxy) / 2 - :iy) <= :radius AND ABS(e.z + (e.minz + e.maxz) / 2 - :iz) <= :radius
        INTO eid, cx, cy, cz
  DO
  BEGIN
    d = vlen(cx - ix, cy - iy, cz - iz);
    IF (d > radius) THEN CONTINUE;
    pts = damage - 0.5e0 * d;
    IF (eid = attacker) THEN pts = pts * 0.5e0;
    IF (pts <= 0) THEN CONTINUE;
    ok = can_damage(eid, inflictor);
    IF (ok = 1) THEN EXECUTE PROCEDURE t_damage(eid, inflictor, attacker, CAST(pts AS INTEGER), CAST(pts AS INTEGER), 1);
  END
END^

-- ── projectiles (g_weapon.c) ────────────────────────────────────────────
-- fire_blaster: a bolt (hyperblaster bolts are the same with another effect)
-- check_dodge (g_weapon.c): the monster in a player projectile's flight line may duck. On easy only a
-- quarter of the shots are looked at; the monster must face the shooter.
CREATE OR ALTER PROCEDURE check_dodge (shooter INTEGER, ox DOUBLE PRECISION, oy DOUBLE PRECISION, oz DOUBLE PRECISION,
  dx DOUBLE PRECISION, dy DOUBLE PRECISION, dz DOUBLE PRECISION, spd DOUBLE PRECISION)
AS
DECLARE sk SMALLINT; DECLARE f DOUBLE PRECISION; DECLARE ex DOUBLE PRECISION; DECLARE ey DOUBLE PRECISION; DECLARE ez DOUBLE PRECISION;
DECLARE nx DOUBLE PRECISION; DECLARE ny DOUBLE PRECISION; DECLARE nz DOUBLE PRECISION; DECLARE sfl INTEGER; DECLARE cts INTEGER;
DECLARE als SMALLINT; DECLARE sts SMALLINT; DECLARE hit INTEGER; DECLARE mx DOUBLE PRECISION; DECLARE fr SMALLINT;
BEGIN
  SELECT g.skill FROM game g WHERE g.id = 1 INTO sk;
  IF (sk = 0 AND RAND() > 0.25e0) THEN EXIT;
  EXECUTE PROCEDURE trace_move(shooter, 0, 0, 0, 0, 0, 0, ox, oy, oz, ox + dx * 8192, oy + dy * 8192, oz + dz * 8192, 100663299)
    RETURNING_VALUES f, ex, ey, ez, nx, ny, nz, sfl, cts, als, sts, hit;
  IF (hit IS NULL OR hit = 0) THEN EXIT;
  SELECT e.maxx FROM ents e WHERE e.id = :hit AND e.mtype IS NOT NULL AND e.health > 0 INTO mx;
  IF (mx IS NULL) THEN EXIT;
  fr = infront(hit, shooter);
  IF (fr = 0) THEN EXIT;
  EXECUTE PROCEDURE monster_dodge(hit, shooter, (vlen(ex - ox, ey - oy, ez - oz) - mx) / spd);
END^

CREATE OR ALTER PROCEDURE launch_bolt (owner INTEGER, ox DOUBLE PRECISION, oy DOUBLE PRECISION, oz DOUBLE PRECISION,
  dx DOUBLE PRECISION, dy DOUBLE PRECISION, dz DOUBLE PRECISION, spd DOUBLE PRECISION, dmg INTEGER, effect INTEGER)
AS
DECLARE s INTEGER; DECLARE dl DOUBLE PRECISION;
BEGIN
  dl = vlen(dx, dy, dz);
  IF (dl = 0) THEN EXIT;
  EXECUTE PROCEDURE spawn_ent('bolt', ox, oy, oz) RETURNING_VALUES s;
  EXECUTE PROCEDURE set_model(s, 'models/objects/laser/tris.md2');
  UPDATE ents e SET e.owner_id = :owner, e.movetype = 9, e.solid = 2, e.clipmask = 100663299, e.effects = :effect, e.renderfx = 0,
         e.vx = :dx / :dl * :spd, e.vy = :dy / :dl * :spd, e.vz = :dz / :dl * :spd,
         e.yaw = vectoyaw(:dx, :dy), e.pitch = ATAN2(:dz, vlen(:dx, :dy, 0)) * 57.29577951e0, e.dmg = :dmg,
         e.think = 'remove', e.nextthink = now_() + 2 WHERE e.id = :s;
  EXECUTE PROCEDURE link_ent(s);
END^

CREATE OR ALTER PROCEDURE launch_grenade (owner INTEGER, ox DOUBLE PRECISION, oy DOUBLE PRECISION, oz DOUBLE PRECISION,
  vx DOUBLE PRECISION, vy DOUBLE PRECISION, vz DOUBLE PRECISION, dmg INTEGER, radius DOUBLE PRECISION, fuse DOUBLE PRECISION, hand SMALLINT)
AS
DECLARE s INTEGER;
BEGIN
  EXECUTE PROCEDURE spawn_ent(IIF(hand = 1, 'hgrenade', 'grenade'), ox, oy, oz) RETURNING_VALUES s;
  EXECUTE PROCEDURE set_model(s, IIF(hand = 1, 'models/objects/grenade2/tris.md2', 'models/objects/grenade/tris.md2'));
  UPDATE ents e SET e.owner_id = :owner, e.movetype = 10, e.solid = 2, e.clipmask = 100663299, e.vx = :vx, e.vy = :vy, e.vz = :vz, e.effects = 32,
         e.yaw = vectoyaw(:vx, :vy), e.avel_yaw = 300, e.avel_pitch = 300, e.dmg = :dmg, e.dmg_radius = :radius,
         e.think = 'grenade_explode', e.nextthink = now_() + :fuse WHERE e.id = :s;
  EXECUTE PROCEDURE link_ent(s);
END^

CREATE OR ALTER PROCEDURE launch_rocket (owner INTEGER, ox DOUBLE PRECISION, oy DOUBLE PRECISION, oz DOUBLE PRECISION,
  dx DOUBLE PRECISION, dy DOUBLE PRECISION, dz DOUBLE PRECISION, spd DOUBLE PRECISION, dmg INTEGER, radius_dmg INTEGER, radius DOUBLE PRECISION)
AS
DECLARE s INTEGER; DECLARE dl DOUBLE PRECISION;
BEGIN
  dl = vlen(dx, dy, dz);
  IF (dl = 0) THEN EXIT;
  EXECUTE PROCEDURE spawn_ent('rocket', ox, oy, oz) RETURNING_VALUES s;
  EXECUTE PROCEDURE set_model(s, 'models/objects/rocket/tris.md2');
  UPDATE ents e SET e.owner_id = :owner, e.movetype = 9, e.solid = 2, e.clipmask = 100663299, e.effects = 16,
         e.vx = :dx / :dl * :spd, e.vy = :dy / :dl * :spd, e.vz = :dz / :dl * :spd,
         e.yaw = vectoyaw(:dx, :dy), e.pitch = ATAN2(:dz, vlen(:dx, :dy, 0)) * 57.29577951e0, e.dmg = :dmg, e.count_ = :radius_dmg, e.dmg_radius = :radius,
         e.think = 'remove', e.nextthink = now_() + 8000 / :spd WHERE e.id = :s;
  EXECUTE PROCEDURE link_ent(s);
END^

-- fire_bfg: the ball
CREATE OR ALTER PROCEDURE launch_bfg (owner INTEGER, ox DOUBLE PRECISION, oy DOUBLE PRECISION, oz DOUBLE PRECISION,
  dx DOUBLE PRECISION, dy DOUBLE PRECISION, dz DOUBLE PRECISION, spd DOUBLE PRECISION, dmg INTEGER, radius DOUBLE PRECISION)
AS
DECLARE s INTEGER; DECLARE dl DOUBLE PRECISION;
BEGIN
  dl = vlen(dx, dy, dz);
  IF (dl = 0) THEN EXIT;
  EXECUTE PROCEDURE spawn_ent('bfg_ball', ox, oy, oz) RETURNING_VALUES s;
  EXECUTE PROCEDURE set_model(s, 'sprites/s_bfg1.sp2');
  UPDATE ents e SET e.owner_id = :owner, e.movetype = 9, e.solid = 2, e.clipmask = 100663299, e.effects = 128,
         e.vx = :dx / :dl * :spd, e.vy = :dy / :dl * :spd, e.vz = :dz / :dl * :spd, e.dmg = :dmg, e.dmg_radius = :radius,
         e.think = 'bfg_think', e.nextthink = now_() + 0.1e0, e.teleport_time = now_() + 8000 / :spd WHERE e.id = :s;
  EXECUTE PROCEDURE link_ent(s);
END^

-- bfg_think: lasers to everything in sight while the ball flies
-- bfg_think (g_weapon.c): every frame of the ball's flight, a laser to each monster, player or barrel within
-- 256 units, carried on through monsters (each takes 10, energy) until it reaches something else
CREATE OR ALTER PROCEDURE bfg_think (eid INTEGER)
AS
DECLARE x DOUBLE PRECISION; DECLARE y DOUBLE PRECISION; DECLARE z DOUBLE PRECISION; DECLARE own INTEGER; DECLARE tt DOUBLE PRECISION;
DECLARE t INTEGER; DECLARE cx DOUBLE PRECISION; DECLARE cy DOUBLE PRECISION; DECLARE cz DOUBLE PRECISION;
DECLARE f DOUBLE PRECISION; DECLARE ex DOUBLE PRECISION; DECLARE ey DOUBLE PRECISION; DECLARE ez DOUBLE PRECISION;
DECLARE nx DOUBLE PRECISION; DECLARE ny DOUBLE PRECISION; DECLARE nz DOUBLE PRECISION;
DECLARE sf INTEGER; DECLARE ct INTEGER; DECLARE als SMALLINT; DECLARE sts SMALLINT; DECLARE hit INTEGER;
DECLARE dx DOUBLE PRECISION; DECLARE dy DOUBLE PRECISION; DECLARE dz DOUBLE PRECISION; DECLARE dl DOUBLE PRECISION;
DECLARE sx DOUBLE PRECISION; DECLARE sy DOUBLE PRECISION; DECLARE sz DOUBLE PRECISION; DECLARE ign INTEGER; DECLARE n INTEGER;
DECLARE hmon SMALLINT;
BEGIN
  SELECT e.x, e.y, e.z, e.owner_id, e.teleport_time FROM ents e WHERE e.id = :eid INTO x, y, z, own, tt;
  IF (x IS NULL) THEN EXIT;
  IF (tt < now_()) THEN BEGIN DELETE FROM ents e WHERE e.id = :eid; EXIT; END
  FOR SELECT e.id, e.x + (e.minx + e.maxx) / 2, e.y + (e.miny + e.maxy) / 2, e.z + (e.minz + e.maxz) / 2 FROM ents e
       WHERE e.takedamage > 0 AND e.id <> :own AND e.id <> :eid
         AND (e.mtype IS NOT NULL OR e.classname IN ('player', 'misc_explobox'))
         AND ABS(e.x - :x) < 256 + 64 AND ABS(e.y - :y) < 256 + 64 AND ABS(e.z - :z) < 256 + 64 INTO t, cx, cy, cz
  DO
  BEGIN
    dl = vlen(cx - x, cy - y, cz - z);
    IF (dl > 256 OR dl = 0) THEN CONTINUE;
    dx = (cx - x) / dl; dy = (cy - y) / dl; dz = (cz - z) / dl;
    sx = x; sy = y; sz = z; ign = eid; n = 0;
    WHILE (n < 8) DO
    BEGIN
      EXECUTE PROCEDURE trace_move(ign, 0, 0, 0, 0, 0, 0, sx, sy, sz, x + dx * 2048, y + dy * 2048, z + dz * 2048, 100663297)
        RETURNING_VALUES f, ex, ey, ez, nx, ny, nz, sf, ct, als, sts, hit;
      IF (hit IS NULL OR hit = 0 OR f = 1) THEN LEAVE;
      IF (hit <> own) THEN EXECUTE PROCEDURE t_damage(hit, eid, own, 10, 1, 4);
      SELECT IIF(e.mtype IS NOT NULL OR e.classname = 'player', 1, 0) FROM ents e WHERE e.id = :hit INTO hmon;
      IF (COALESCE(hmon, 0) = 0) THEN LEAVE;
      ign = hit; sx = ex; sy = ey; sz = ez; n = n + 1;
      hmon = NULL;
    END
    EXECUTE PROCEDURE fx(12, x, y, z, ex, ey, ez, 0);
  END
  UPDATE ents e SET e.nextthink = now_() + 0.1e0 WHERE e.id = :eid;
END^

-- bfg_explode: the frame after the ball strikes, everything within its radius that both the ball and the
-- shooter can see takes up to the ball's full damage, falling off as 1 - sqrt(distance / radius) (energy)
CREATE OR ALTER PROCEDURE bfg_explode (eid INTEGER)
AS
DECLARE x DOUBLE PRECISION; DECLARE y DOUBLE PRECISION; DECLARE z DOUBLE PRECISION; DECLARE own INTEGER;
DECLARE rdmg DOUBLE PRECISION; DECLARE rad DOUBLE PRECISION; DECLARE t INTEGER; DECLARE d DOUBLE PRECISION; DECLARE pts DOUBLE PRECISION;
DECLARE cx DOUBLE PRECISION; DECLARE cy DOUBLE PRECISION; DECLARE cz DOUBLE PRECISION; DECLARE ok SMALLINT;
BEGIN
  SELECT e.x, e.y, e.z, e.owner_id, e.dmg, e.dmg_radius FROM ents e WHERE e.id = :eid INTO x, y, z, own, rdmg, rad;
  IF (x IS NULL) THEN EXIT;
  FOR SELECT e.id, e.x + (e.minx + e.maxx) / 2, e.y + (e.miny + e.maxy) / 2, e.z + (e.minz + e.maxz) / 2 FROM ents e
       WHERE e.takedamage > 0 AND e.id <> :eid AND (:own IS NULL OR e.id <> :own)
         AND ABS(e.x - :x) < :rad + 64 AND ABS(e.y - :y) < :rad + 64 AND ABS(e.z - :z) < :rad + 64 INTO t, cx, cy, cz
  DO
  BEGIN
    d = vlen(cx - x, cy - y, cz - z);
    IF (d > rad) THEN CONTINUE;
    ok = can_damage(t, eid);
    IF (ok = 0) THEN CONTINUE;
    IF (own IS NOT NULL) THEN BEGIN ok = can_damage(t, own); IF (ok = 0) THEN CONTINUE; END
    pts = rdmg * (1 - SQRT(d / rad));
    EXECUTE PROCEDURE fx(8, cx, cy, cz, 0, 0, 0, 0);
    EXECUTE PROCEDURE t_damage(t, eid, own, CAST(pts AS INTEGER), 0, 4);
  END
  DELETE FROM ents e WHERE e.id = :eid;
END^

CREATE OR ALTER PROCEDURE grenade_explode (eid INTEGER)
AS
DECLARE own INTEGER; DECLARE dmg INTEGER; DECLARE rad DOUBLE PRECISION;
DECLARE x DOUBLE PRECISION; DECLARE y DOUBLE PRECISION; DECLARE z DOUBLE PRECISION;
BEGIN
  SELECT e.owner_id, e.dmg, e.dmg_radius, e.x, e.y, e.z FROM ents e WHERE e.id = :eid INTO own, dmg, rad, x, y, z;
  IF (x IS NULL) THEN EXIT;
  EXECUTE PROCEDURE t_radius_damage(eid, own, dmg, NULL, rad);
  EXECUTE PROCEDURE snd_at(x, y, z, 'weapons/grenlx1a.wav', 1, 1);
  EXECUTE PROCEDURE fx(9, x, y, z, 0, 0, 0, 0);
  DELETE FROM ents e WHERE e.id = :eid;
END^

-- ── touching ────────────────────────────────────────────────────────────
-- SV_Impact: e1 moved into e2 (e2 = 0 is the world); sflags are the surface flags hit
CREATE OR ALTER PROCEDURE impact (e1 INTEGER, e2 INTEGER, sflags INTEGER)
AS
DECLARE c1 VARCHAR(40); DECLARE c2 VARCHAR(40); DECLARE own INTEGER; DECLARE dmg INTEGER; DECLARE td2 SMALLINT;
DECLARE x DOUBLE PRECISION; DECLARE y DOUBLE PRECISION; DECLARE z DOUBLE PRECISION; DECLARE vz DOUBLE PRECISION; DECLARE hp2 INTEGER; DECLARE rad DOUBLE PRECISION; DECLARE rdmg INTEGER;
DECLARE vx DOUBLE PRECISION; DECLARE vy DOUBLE PRECISION; DECLARE spd DOUBLE PRECISION;
DECLARE bdx DOUBLE PRECISION; DECLARE bdy DOUBLE PRECISION; DECLARE bdz DOUBLE PRECISION; DECLARE bdl DOUBLE PRECISION;
BEGIN
  SELECT e.classname, e.owner_id, e.dmg, e.x, e.y, e.z, e.vx, e.vy, e.vz, e.dmg_radius, e.count_ FROM ents e WHERE e.id = :e1 INTO c1, own, dmg, x, y, z, vx, vy, vz, rad, rdmg;
  IF (c1 = 'func_object') THEN
  BEGIN
    -- func_object_touch: only what it falls on top of, if it can be hurt
    IF (vz < 0 AND EXISTS (SELECT 1 FROM ents o JOIN ents f ON f.id = :e1 WHERE o.id = :e2 AND o.takedamage > 0 AND o.z + o.maxz <= f.z + f.minz + 2)) THEN
      EXECUTE PROCEDURE t_damage(e2, e1, e1, dmg, 1, 0);
    EXIT;
  END
  IF (c1 IS NULL) THEN EXIT;
  IF (c1 = 'misc_viper_bomb') THEN
  BEGIN
    -- misc_viper_bomb_touch: its targets fire, and it goes off at the bottom of its box (BecomeExplosion2)
    EXECUTE PROCEDURE use_targets(e1, COALESCE((SELECT e.enemy_id FROM ents e WHERE e.id = :e1), player_ent()));
    UPDATE ents e SET e.z = e.z + e.minz + 1 WHERE e.id = :e1;
    EXECUTE PROCEDURE t_radius_damage(e1, e1, dmg, NULL, dmg + 40);
    EXECUTE PROCEDURE snd_at(x, y, z + (SELECT e.minz FROM ents e WHERE e.id = :e1) + 1, 'weapons/grenlx1a.wav', 1, 1);
    EXECUTE PROCEDURE fx(9, x, y, z + (SELECT e.minz FROM ents e WHERE e.id = :e1) + 1, 0, 0, 0, 0);
    DELETE FROM ents e WHERE e.id = :e1;
    EXIT;
  END
  IF (e2 > 0) THEN SELECT e.classname, e.takedamage, e.health FROM ents e WHERE e.id = :e2 INTO c2, td2, hp2;
  ELSE BEGIN c2 = 'worldspawn'; td2 = 0; END
  IF (e2 = own) THEN EXIT;

  IF (c1 = 'bolt') THEN
  BEGIN
    IF (BIN_AND(sflags, 4) <> 0) THEN BEGIN DELETE FROM ents e WHERE e.id = :e1; EXIT; END   -- sky
    IF (td2 > 0 AND hp2 > 0) THEN
    BEGIN
      EXECUTE PROCEDURE fx(3, x, y, z, 0, 0, 0, dmg);
      EXECUTE PROCEDURE t_damage(e2, e1, own, dmg, 1, 4);
    END
    ELSE
    BEGIN
      -- TE_BLASTER with a direction: the bolt's way back, for the hit's model and sparks
      SELECT -e.vx, -e.vy, -e.vz FROM ents e WHERE e.id = :e1 INTO bdx, bdy, bdz;
      bdl = vlen(bdx, bdy, bdz);
      IF (bdl > 0) THEN BEGIN bdx = bdx / bdl; bdy = bdy / bdl; bdz = bdz / bdl; END ELSE BEGIN bdx = 0; bdy = 0; bdz = 1; END
      EXECUTE PROCEDURE fx(6, x, y, z, bdx, bdy, bdz, 0);
      EXECUTE PROCEDURE snd_at(x, y, z, 'weapons/lashit.wav', 1, 1);
    END
    DELETE FROM ents e WHERE e.id = :e1;
  END
  ELSE IF (c1 = 'rocket') THEN
  BEGIN
    IF (BIN_AND(sflags, 4) <> 0) THEN BEGIN DELETE FROM ents e WHERE e.id = :e1; EXIT; END
    IF (td2 > 0 AND hp2 > 0) THEN EXECUTE PROCEDURE t_damage(e2, e1, own, dmg, dmg, 0);
    EXECUTE PROCEDURE t_radius_damage(e1, own, rdmg, e2, rad);
    EXECUTE PROCEDURE snd_at(x, y, z, 'weapons/rocklx1a.wav', 1, 1);
    EXECUTE PROCEDURE fx(2, x, y, z, 0, 0, 0, 0);
    DELETE FROM ents e WHERE e.id = :e1;
  END
  ELSE IF (c1 = 'bfg_ball') THEN
  BEGIN
    IF (BIN_AND(sflags, 4) <> 0) THEN BEGIN DELETE FROM ents e WHERE e.id = :e1; EXIT; END
    -- bfg_touch: the core explosion (so firing it into a wall still hurts), then the ball stops a frame back
    -- along its flight and becomes the explosion that bfg_explode finishes the next frame
    IF (e2 = own) THEN EXIT;
    IF (td2 > 0 AND hp2 > 0) THEN EXECUTE PROCEDURE t_damage(e2, e1, own, 200, 0, 0);
    EXECUTE PROCEDURE t_radius_damage(e1, own, 200, e2, 100);
    EXECUTE PROCEDURE snd_at(x, y, z, 'weapons/bfg__x1b.wav', 1, 1);
    EXECUTE PROCEDURE fx(8, x, y, z, 0, 0, 0, 0);
    UPDATE ents e SET e.solid = 0, e.movetype = 0, e.x = e.x - e.vx * 0.1e0, e.y = e.y - e.vy * 0.1e0, e.z = e.z - e.vz * 0.1e0,
           e.vx = 0, e.vy = 0, e.vz = 0, e.model_id = NULL, e.mkind = NULL, e.think = 'bfg_explode', e.nextthink = now_() + 0.1e0 WHERE e.id = :e1;
  END
  ELSE IF (c1 IN ('grenade', 'hgrenade')) THEN
  BEGIN
    IF (BIN_AND(sflags, 4) <> 0) THEN BEGIN DELETE FROM ents e WHERE e.id = :e1; EXIT; END
    IF (td2 > 0 AND hp2 > 0) THEN EXECUTE PROCEDURE grenade_explode(e1);
    ELSE
    BEGIN
      spd = vlen(vx, vy, vz);
      IF (spd > 60) THEN EXECUTE PROCEDURE snd_at(x, y, z, IIF(c1 = 'hgrenade', 'weapons/hgrenb1a.wav', 'weapons/grenlb1b.wav'), 1, 1);
    END
  END
  ELSE IF (c1 = 'player' AND c2 IN ('func_door', 'func_door_rotating', 'func_water')) THEN EXECUTE PROCEDURE door_touch(e2, e1);
  ELSE IF (c1 = 'player' AND c2 = 'func_door_secret') THEN
  BEGIN
    IF (EXISTS (SELECT 1 FROM ents e WHERE e.id = :e2 AND e.targetname IS NOT NULL AND e.targetname <> '')) THEN EXECUTE PROCEDURE door_touch(e2, e1);
  END
  ELSE IF (c1 = 'player' AND c2 = 'func_button') THEN
  BEGIN
    IF (EXISTS (SELECT 1 FROM ents e WHERE e.id = :e2 AND e.max_health = 0)) THEN EXECUTE PROCEDURE button_fire(e2, e1);
  END
  ELSE IF (c1 = 'player' AND c2 = 'func_rotating') THEN
  BEGIN
    IF (EXISTS (SELECT 1 FROM ents e WHERE e.id = :e2 AND BIN_AND(e.spawnflags, 16) <> 0 AND (e.avel_yaw <> 0 OR e.avel_pitch <> 0 OR e.avel_roll <> 0) AND e.pain_finished < now_())) THEN
    BEGIN
      UPDATE ents e SET e.pain_finished = now_() + 0.5e0 WHERE e.id = :e2;
      EXECUTE PROCEDURE t_damage(e1, e2, e2, (SELECT e.dmg FROM ents e WHERE e.id = :e2), 1, 0);
    END
  END
  ELSE IF (c1 = 'player' AND e2 = 0 AND vz < -300) THEN
  BEGIN
    -- P_FallingDamage, in SV_Physics_Client terms: lands hard
    IF (vz < -650) THEN
    BEGIN
      EXECUTE PROCEDURE t_damage(e1, 0, 0, CAST(MINVALUE(50, (-vz - 650) / 10 + 5) AS INTEGER), 0, 8);
      EXECUTE PROCEDURE snd(e1, 2, 'player/fall2.wav', 1, 1);
    END
    ELSE EXECUTE PROCEDURE snd(e1, 2, 'player/fall1.wav', 1, 1);
  END
END^

-- ── map setup ───────────────────────────────────────────────────────────
-- the model of an item classname, as g_items.c's itemlist has it
CREATE OR ALTER FUNCTION item_model (cls VARCHAR(40)) RETURNS VARCHAR(64)
AS
BEGIN
  RETURN CASE cls
    WHEN 'item_health_small' THEN 'models/items/healing/stimpack/tris.md2' WHEN 'item_health' THEN 'models/items/healing/medium/tris.md2'
    WHEN 'item_health_large' THEN 'models/items/healing/large/tris.md2' WHEN 'item_health_mega' THEN 'models/items/mega_h/tris.md2'
    WHEN 'item_armor_shard' THEN 'models/items/armor/shard/tris.md2' WHEN 'item_armor_jacket' THEN 'models/items/armor/jacket/tris.md2'
    WHEN 'item_armor_combat' THEN 'models/items/armor/combat/tris.md2' WHEN 'item_armor_body' THEN 'models/items/armor/body/tris.md2'
    WHEN 'item_power_shield' THEN 'models/items/armor/shield/tris.md2' WHEN 'item_power_screen' THEN 'models/items/armor/screen/tris.md2'
    WHEN 'ammo_shells' THEN 'models/items/ammo/shells/medium/tris.md2' WHEN 'ammo_bullets' THEN 'models/items/ammo/bullets/medium/tris.md2'
    WHEN 'ammo_grenades' THEN 'models/items/ammo/grenades/medium/tris.md2' WHEN 'ammo_rockets' THEN 'models/items/ammo/rockets/medium/tris.md2'
    WHEN 'ammo_cells' THEN 'models/items/ammo/cells/medium/tris.md2' WHEN 'ammo_slugs' THEN 'models/items/ammo/slugs/medium/tris.md2'
    WHEN 'weapon_shotgun' THEN 'models/weapons/g_shotg/tris.md2' WHEN 'weapon_supershotgun' THEN 'models/weapons/g_shotg2/tris.md2'
    WHEN 'weapon_machinegun' THEN 'models/weapons/g_machn/tris.md2' WHEN 'weapon_chaingun' THEN 'models/weapons/g_chain/tris.md2'
    WHEN 'weapon_grenadelauncher' THEN 'models/weapons/g_launch/tris.md2' WHEN 'weapon_rocketlauncher' THEN 'models/weapons/g_rocket/tris.md2'
    WHEN 'weapon_hyperblaster' THEN 'models/weapons/g_hyperb/tris.md2' WHEN 'weapon_railgun' THEN 'models/weapons/g_rail/tris.md2' WHEN 'weapon_bfg' THEN 'models/weapons/g_bfg/tris.md2'
    WHEN 'key_blue_key' THEN 'models/items/keys/key/tris.md2' WHEN 'key_red_key' THEN 'models/items/keys/red_key/tris.md2' WHEN 'key_data_cd' THEN 'models/items/keys/data_cd/tris.md2'
    WHEN 'key_power_cube' THEN 'models/items/keys/power/tris.md2' WHEN 'key_pyramid' THEN 'models/items/keys/pyramid/tris.md2' WHEN 'key_data_spinner' THEN 'models/items/keys/spinner/tris.md2'
    WHEN 'key_pass' THEN 'models/items/keys/pass/tris.md2' WHEN 'key_commander_head' THEN 'models/monsters/commandr/head/tris.md2' WHEN 'key_airstrike_target' THEN 'models/items/keys/target/tris.md2'
    WHEN 'item_quad' THEN 'models/items/quaddama/tris.md2' WHEN 'item_invulnerability' THEN 'models/items/invulner/tris.md2' WHEN 'item_silencer' THEN 'models/items/silencer/tris.md2'
    WHEN 'item_breather' THEN 'models/items/breather/tris.md2' WHEN 'item_enviro' THEN 'models/items/enviro/tris.md2' WHEN 'item_adrenaline' THEN 'models/items/adrenal/tris.md2'
    WHEN 'item_bandolier' THEN 'models/items/band/tris.md2' WHEN 'item_pack' THEN 'models/items/pack/tris.md2' WHEN 'item_ancient_head' THEN 'models/items/c_head/tris.md2'
    ELSE NULL END;
END^

-- spawn_map_ents: the spawn functions for every classname we know (SpawnEntities), or, with only_id,
-- ED_CallSpawn for that one row of map_ents (target_spawner)
CREATE OR ALTER PROCEDURE spawn_map_ents (skill SMALLINT, spawnpoint VARCHAR(40), only_id INTEGER)
AS
DECLARE t0 DOUBLE PRECISION;   -- the level clock: zero at a level start, later for target_spawner
DECLARE mid INTEGER; DECLARE cls VARCHAR(40); DECLARE tn VARCHAR(40); DECLARE tg VARCHAR(40); DECLARE kt VARCHAR(40); DECLARE mdl VARCHAR(64);
DECLARE pt VARCHAR(40); DECLARE dt VARCHAR(40); DECLARE ct VARCHAR(40); DECLARE team VARCHAR(40);
DECLARE ox DOUBLE PRECISION; DECLARE oy DOUBLE PRECISION; DECLARE oz DOUBLE PRECISION; DECLARE ang DOUBLE PRECISION;
DECLARE ap DOUBLE PRECISION; DECLARE ay DOUBLE PRECISION; DECLARE ar DOUBLE PRECISION;
DECLARE sf INTEGER; DECLARE msg VARCHAR(400); DECLARE wt DOUBLE PRECISION; DECLARE dl DOUBLE PRECISION; DECLARE rnd DOUBLE PRECISION; DECLARE spd DOUBLE PRECISION;
DECLARE accel_ DOUBLE PRECISION; DECLARE decel_ DOUBLE PRECISION; DECLARE lip DOUBLE PRECISION; DECLARE hgt DOUBLE PRECISION; DECLARE hp INTEGER; DECLARE lt INTEGER; DECLARE sty INTEGER;
DECLARE snds INTEGER; DECLARE dmg INTEGER; DECLARE cnt INTEGER; DECLARE map_ VARCHAR(64); DECLARE noise VARCHAR(64); DECLARE item VARCHAR(40); DECLARE mass INTEGER;
DECLARE vol DOUBLE PRECISION; DECLARE attn DOUBLE PRECISION; DECLARE dist DOUBLE PRECISION; DECLARE grav DOUBLE PRECISION; DECLARE sky VARCHAR(32);
DECLARE eid INTEGER; DECLARE dx DOUBLE PRECISION; DECLARE dy DOUBLE PRECISION; DECLARE dz DOUBLE PRECISION;
DECLARE sx DOUBLE PRECISION; DECLARE sy DOUBLE PRECISION; DECLARE sz DOUBLE PRECISION; DECLARE d DOUBLE PRECISION;
DECLARE mname VARCHAR(16); DECLARE mmodel VARCHAR(64); DECLARE mskin INTEGER; DECLARE mhp INTEGER; DECLARE mgh INTEGER; DECLARE mmass INTEGER; DECLARE mflags INTEGER;
DECLARE mys DOUBLE PRECISION; DECLARE stand VARCHAR(16);
DECLARE a DOUBLE PRECISION; DECLARE b DOUBLE PRECISION; DECLARE c DOUBLE PRECISION; DECLARE e2 DOUBLE PRECISION; DECLARE f2 DOUBLE PRECISION; DECLARE g2 DOUBLE PRECISION;
DECLARE skillbit INTEGER; DECLARE wmodel INTEGER; DECLARE startid INTEGER;
DECLARE n1 VARCHAR(64); DECLARE n2 VARCHAR(64); DECLARE n3 VARCHAR(64);
DECLARE minp DOUBLE PRECISION; DECLARE maxp DOUBLE PRECISION; DECLARE miny_ DOUBLE PRECISION; DECLARE maxy_ DOUBLE PRECISION;
BEGIN
  t0 = now_();
  skillbit = CASE skill WHEN 0 THEN 256 WHEN 1 THEN 512 ELSE 1024 END;
  SELECT g.world_model FROM game g WHERE g.id = 1 INTO wmodel;
  -- SelectSpawnPoint: the start named by the previous level's changelevel, else the one without a name
  SELECT FIRST 1 m.id FROM map_ents m WHERE m.classname = 'info_player_start' AND COALESCE(m.targetname, '') = COALESCE(:spawnpoint, '') ORDER BY m.id INTO startid;
  IF (startid IS NULL) THEN SELECT FIRST 1 m.id FROM map_ents m WHERE m.classname = 'info_player_start' ORDER BY m.id INTO startid;
  FOR SELECT m.id, m.classname, m.targetname, m.target, m.killtarget, m.pathtarget, m.deathtarget, m.combattarget, m.team, m.model, m.ox, m.oy, m.oz, m.angle, m.apitch, m.ayaw, m.aroll,
             m.spawnflags, m.message, m.wait_, m.delay, m.random_, m.speed, m.accel, m.decel, m.lip, m.height, m.health, m.light, m.style, m.sounds, m.dmg, m.count_, m.map, m.noise, m.item,
             m.mass, m.volume, m.attenuation, m.distance, m.gravity, m.sky, m.minpitch, m.maxpitch, m.minyaw, m.maxyaw
        FROM map_ents m WHERE :only_id IS NULL OR m.id = :only_id ORDER BY m.id
        INTO mid, cls, tn, tg, kt, pt, dt, ct, team, mdl, ox, oy, oz, ang, ap, ay, ar, sf, msg, wt, dl, rnd, spd, accel_, decel_, lip, hgt, hp, lt, sty, snds, dmg, cnt, map_, noise, item,
             mass, vol, attn, dist, grav, sky, minp, maxp, miny_, maxy_
  DO
  BEGIN
    IF (cls = 'worldspawn') THEN
    BEGIN
      UPDATE game g SET g.level_msg = :msg, g.sky = COALESCE(:sky, 'unit1_'), g.cd_track = COALESCE(:snds, 0), g.gravity = COALESCE(NULLIF(:grav, 0), 800) WHERE g.id = 1;
      CONTINUE;
    END
    -- SpawnEntities: 256/512/1024 keep an entity out of easy/medium/hard (all three: deathmatch only);
    -- 4096 (NOT_COOP) is ignored in single player, and the five filter bits are cleared once read
    IF (BIN_AND(sf, skillbit) <> 0) THEN CONTINUE;                 -- not on this skill
    sf = BIN_AND(sf, BIN_NOT(7936));
    -- "angles" overrides "angle"
    IF (ay IS NOT NULL AND ang IS NULL) THEN ang = ay;
    IF (cls IN ('info_player_deathmatch', 'info_player_coop', 'info_player_intermission', 'func_group')) THEN CONTINUE;
    IF (cls = 'light') THEN
    BEGIN
      IF (tn IS NOT NULL AND tn <> '' AND sty IS NOT NULL AND sty >= 32) THEN
      BEGIN
        EXECUTE PROCEDURE spawn_ent(cls, ox, oy, oz) RETURNING_VALUES eid;
        UPDATE ents e SET e.targetname = :tn, e.style = :sty WHERE e.id = :eid;
        UPDATE OR INSERT INTO lightstyles (style, pattern) VALUES (:sty, IIF(BIN_AND(:sf, 1) <> 0, 'a', 'm')) MATCHING (style);
      END
      CONTINUE;
    END

    EXECUTE PROCEDURE spawn_ent(cls, ox, oy, oz) RETURNING_VALUES eid;
    UPDATE ents e SET e.targetname = :tn, e.target = :tg, e.killtarget = :kt, e.pathtarget = :pt, e.deathtarget = :dt, e.combattarget = :ct, e.team = :team,
           e.spawnflags = :sf, e.message = :msg, e.wait_ = COALESCE(:wt, 0), e.delay = COALESCE(:dl, 0), e.random_ = COALESCE(:rnd, 0), e.speed = COALESCE(:spd, 0),
           e.accel = COALESCE(:accel_, 0), e.decel = COALESCE(:decel_, 0), e.lip = COALESCE(:lip, 0), e.height = COALESCE(:hgt, 0),
           e.health = COALESCE(:hp, 0), e.max_health = COALESCE(:hp, 0), e.style = COALESCE(:sty, 0), e.sounds = COALESCE(:snds, 0),
           e.dmg = COALESCE(:dmg, 0), e.count_ = COALESCE(:cnt, 0), e.map = :map_, e.item = :item, e.mass = COALESCE(NULLIF(:mass, 0), 200),
           e.yaw = COALESCE(:ang, 0), e.spawn_x = :ox, e.spawn_y = :oy, e.spawn_z = :oz, e.noise1 = :noise
     WHERE e.id = :eid;
    IF (mdl IS NOT NULL AND mdl STARTING WITH '*') THEN EXECUTE PROCEDURE set_model(eid, mdl);
    SELECT e.maxx - e.minx, e.maxy - e.miny, e.maxz - e.minz FROM ents e WHERE e.id = :eid INTO sx, sy, sz;

    -- ── player ──
    IF (cls = 'info_player_start') THEN
    BEGIN
      IF (mid <> startid) THEN BEGIN DELETE FROM ents e WHERE e.id = :eid; CONTINUE; END
      UPDATE ents e SET e.classname = 'player', e.minx = -16, e.miny = -16, e.minz = -24, e.maxx = 16, e.maxy = 16, e.maxz = 32, e.viewheight = 22,
             e.solid = 3, e.movetype = 3, e.clipmask = 33619971, e.health = 100, e.max_health = 100, e.takedamage = 2, e.mass = 200, e.flags = 0, e.anim = 'stand',
             e.z = e.z + 1 WHERE e.id = :eid;
      EXECUTE PROCEDURE set_model(eid, 'players/male/tris.md2');
      UPDATE player p SET p.ent_id = :eid WHERE p.id = 1;
      EXECUTE PROCEDURE link_ent(eid);
    END
    -- ── doors ──
    ELSE IF (cls IN ('func_door', 'func_water')) THEN
    BEGIN
      IF (cls = 'func_water') THEN
      BEGIN
        -- SP_func_water: sounds 1 (water) and 2 (lava) both use the water's start and stop, others none;
        -- speed 25, wait -1 (a toggle) by default, no damage
        IF (snds IN (1, 2)) THEN BEGIN n1 = 'world/mov_watr.wav'; n2 = NULL; n3 = 'world/stp_watr.wav'; END
        ELSE BEGIN n1 = NULL; n2 = NULL; n3 = NULL; END
        IF (spd IS NULL OR spd = 0) THEN spd = 25;
        IF (wt IS NULL OR wt = 0) THEN wt = -1;
        IF (wt = -1) THEN sf = BIN_OR(sf, 32);                          -- DOOR_TOGGLE
      END
      ELSE
      BEGIN
        IF (snds = 1) THEN BEGIN n1 = NULL; n2 = NULL; n3 = NULL; END
        ELSE BEGIN n1 = 'doors/dr1_strt.wav'; n2 = 'doors/dr1_mid.wav'; n3 = 'doors/dr1_end.wav'; END
        IF (spd IS NULL OR spd = 0) THEN spd = 100;
        IF (wt IS NULL OR wt = 0) THEN wt = 3;
        IF (dmg IS NULL OR dmg = 0) THEN dmg = 2;
      END
      EXECUTE PROCEDURE movedir(COALESCE(ang, 0)) RETURNING_VALUES dx, dy, dz;
      IF (lip IS NULL OR lip = 0) THEN lip = 8;
      dmg = COALESCE(dmg, 0);
      dist = ABS(dx * sx + dy * sy + dz * sz) - lip;
      UPDATE ents e SET e.solid = 4, e.movetype = 7, e.yaw = 0, e.speed = :spd, e.wait_ = :wt, e.lip = :lip, e.dmg = :dmg, e.spawnflags = :sf,
             e.noise1 = :n1, e.noise2 = :n2, e.noise3 = :n3, e.takedamage = IIF(:hp > 0, 1, 0),
             e.p1x = e.x, e.p1y = e.y, e.p1z = e.z, e.p2x = e.x + :dx * :dist, e.p2y = e.y + :dy * :dist, e.p2z = e.z + :dz * :dist, e.mv_state = 1 WHERE e.id = :eid;
      IF (BIN_AND(sf, 1) <> 0) THEN     -- DOOR_START_OPEN
        UPDATE ents e SET e.x = e.p2x, e.y = e.p2y, e.z = e.p2z, e.p2x = e.p1x, e.p2y = e.p1y, e.p2z = e.p1z,
               e.p1x = e.x, e.p1y = e.y, e.p1z = e.z WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    ELSE IF (cls = 'func_door_secret') THEN
    BEGIN
      -- SP_func_door_secret: the first move is `width` aside (right, or left with 1ST_LEFT, or down with
      -- 1ST_DOWN), the second `length` along its angle's forward; speed 50, dmg 2, wait 5 by default
      a = COALESCE(ap, 0) * PI() / 180; b = COALESCE(ang, 0) * PI() / 180; c = COALESCE(ar, 0) * PI() / 180;
      -- AngleVectors: forward (dx dy dz), right (e2 f2 g2), up computed where needed
      dx = COS(a) * COS(b); dy = COS(a) * SIN(b); dz = -SIN(a);
      e2 = -SIN(c) * SIN(a) * COS(b) + COS(c) * SIN(b); f2 = -SIN(c) * SIN(a) * SIN(b) - COS(c) * COS(b); g2 = -SIN(c) * COS(a);
      IF (BIN_AND(sf, 4) <> 0) THEN
      BEGIN
        -- up = (cr·sp·cy + sr·sy, cr·sp·sy − sr·cy, cr·cp), and the first move is down it
        e2 = -(COS(c) * SIN(a) * COS(b) + SIN(c) * SIN(b)); f2 = -(COS(c) * SIN(a) * SIN(b) - SIN(c) * COS(b)); g2 = -(COS(c) * COS(a));
        d = ABS(e2 * sx + f2 * sy + g2 * sz);
      END
      ELSE
      BEGIN
        d = ABS(e2 * sx + f2 * sy + g2 * sz);
        IF (BIN_AND(sf, 2) <> 0) THEN BEGIN e2 = -e2; f2 = -f2; g2 = -g2; END     -- 1ST_LEFT: side = -1
      END
      dist = ABS(dx * sx + dy * sy + dz * sz);
      UPDATE ents e SET e.solid = 4, e.movetype = 7, e.yaw = 0, e.speed = 50, e.dmg = IIF(COALESCE(:dmg, 0) = 0, 2, :dmg),
             e.wait_ = IIF(COALESCE(:wt, 0) = 0, 5, :wt), e.mv_state = 1,
             e.p1x = e.x + :e2 * :d, e.p1y = e.y + :f2 * :d, e.p1z = e.z + :g2 * :d,
             e.p2x = e.x + :e2 * :d + :dx * :dist, e.p2y = e.y + :f2 * :d + :dy * :dist, e.p2z = e.z + :g2 * :d + :dz * :dist,
             e.takedamage = IIF(COALESCE(:hp, 0) > 0 OR :tn IS NULL OR :tn = '' OR BIN_AND(:sf, 1) <> 0, 1, 0)
       WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    ELSE IF (cls = 'func_door_rotating') THEN
    BEGIN
      -- rotates around its origin: X_AXIS 64 → roll, Y_AXIS 128 → pitch, else yaw; by `distance` degrees
      IF (snds = 1) THEN BEGIN n1 = NULL; n2 = NULL; n3 = NULL; END
      ELSE BEGIN n1 = 'doors/dr1_strt.wav'; n2 = 'doors/dr1_mid.wav'; n3 = 'doors/dr1_end.wav'; END
      IF (spd IS NULL OR spd = 0) THEN spd = 100;
      IF (wt IS NULL) THEN wt = 3;
      IF (dmg IS NULL OR dmg = 0) THEN dmg = 2;
      d = COALESCE(dist, 90);
      IF (d = 0) THEN d = 90;
      IF (BIN_AND(sf, 2) <> 0) THEN d = -d;    -- DOOR_REVERSE
      UPDATE ents e SET e.solid = 4, e.movetype = 7, e.pitch = 0, e.yaw = 0, e.roll = 0, e.speed = :spd, e.wait_ = :wt, e.dmg = :dmg,
             e.noise1 = :n1, e.noise2 = :n2, e.noise3 = :n3, e.takedamage = IIF(:hp > 0, 1, 0),
             e.p1x = 0, e.p1y = 0, e.p1z = 0,
             e.p2x = IIF(BIN_AND(:sf, 128) <> 0, :d, 0), e.p2y = IIF(BIN_AND(:sf, 192) = 0, :d, 0), e.p2z = IIF(BIN_AND(:sf, 64) <> 0, :d, 0),
             e.mv_state = 1 WHERE e.id = :eid;
      IF (BIN_AND(sf, 1) <> 0) THEN     -- START_OPEN
        UPDATE ents e SET e.pitch = e.p2x, e.yaw = e.p2y, e.roll = e.p2z, e.p2x = e.p1x, e.p2y = e.p1y, e.p2z = e.p1z,
               e.p1x = e.pitch, e.p1y = e.yaw, e.p1z = e.roll WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    -- ── plats ──
    ELSE IF (cls = 'func_plat') THEN
    BEGIN
      IF (spd IS NULL OR spd = 0) THEN spd = 20;
      IF (lip IS NULL OR lip = 0) THEN lip = 8;
      IF (hgt IS NULL OR hgt = 0) THEN hgt = sz - lip;
      IF (dmg IS NULL OR dmg = 0) THEN dmg = 2;
      UPDATE ents e SET e.solid = 4, e.movetype = 7, e.yaw = 0, e.speed = :spd, e.noise1 = 'plats/pt1_strt.wav', e.noise2 = 'plats/pt1_mid.wav', e.noise3 = 'plats/pt1_end.wav', e.height = :hgt,
             e.p1x = e.x, e.p1y = e.y, e.p1z = e.z, e.p2x = e.x, e.p2y = e.y, e.p2z = e.z - :hgt, e.dmg = :dmg WHERE e.id = :eid;
      -- starts at the bottom unless it is triggered
      IF (tn IS NULL OR tn = '') THEN
        UPDATE ents e SET e.z = e.p2z, e.mv_state = 1 WHERE e.id = :eid;
      ELSE
        UPDATE ents e SET e.mv_state = 0 WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    -- ── buttons ──
    ELSE IF (cls = 'func_button') THEN
    BEGIN
      EXECUTE PROCEDURE movedir(COALESCE(ang, 0)) RETURNING_VALUES dx, dy, dz;
      IF (spd IS NULL OR spd = 0) THEN spd = 40;
      IF (wt IS NULL OR wt = 0) THEN wt = 3;
      IF (lip IS NULL OR lip = 0) THEN lip = 4;
      dist = ABS(dx * sx + dy * sy + dz * sz) - lip;
      UPDATE ents e SET e.solid = 4, e.movetype = 7, e.yaw = 0, e.speed = :spd, e.wait_ = :wt, e.noise1 = IIF(COALESCE(:snds, 0) <> 1, 'switches/butn2.wav', NULL), e.takedamage = IIF(:hp > 0, 1, 0),
             e.p1x = e.x, e.p1y = e.y, e.p1z = e.z, e.p2x = e.x + :dx * :dist, e.p2y = e.y + :dy * :dist, e.p2z = e.z + :dz * :dist, e.mv_state = 1 WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    -- ── trains ──
    ELSE IF (cls = 'func_train') THEN
    BEGIN
      IF (spd IS NULL OR spd = 0) THEN spd = 100;
      -- SP_func_train: 100 damage when blocked, none with TRAIN_BLOCK_STOPS (spawnflags 4)
      UPDATE ents e SET e.solid = 4, e.movetype = 7, e.yaw = 0, e.speed = :spd, e.noise1 = NULL, e.noise2 = :noise, e.noise3 = NULL, e.dmg = IIF(BIN_AND(:sf, 4) <> 0, 0, IIF(COALESCE(:dmg, 0) = 0, 100, :dmg)),
             e.mv_state = IIF(:tn IS NULL OR :tn = '' OR BIN_AND(:sf, 1) <> 0, 2, 1), e.think = 'train_find', e.nextthink = 0.1e0 WHERE e.id = :eid;
    END
    ELSE IF (cls IN ('misc_strogg_ship', 'misc_viper')) THEN
    BEGIN
      -- SP_misc_strogg_ship, SP_misc_viper: a train of one model, unseen (no model yet) until something uses it;
      -- func_train_find puts it on its first corner, and it starts at once if nothing names it or START_ON
      IF (tg IS NULL OR tg = '') THEN BEGIN DELETE FROM ents e WHERE e.id = :eid; CONTINUE; END
      UPDATE ents e SET e.solid = 0, e.movetype = 7, e.speed = IIF(COALESCE(:spd, 0) = 0, 300, :spd),
             e.mv_state = IIF(:tn IS NULL OR :tn = '' OR BIN_AND(:sf, 1) <> 0, 2, 1),
             e.minx = -16, e.miny = -16, e.minz = 0, e.maxx = 16, e.maxy = 16, e.maxz = 32, e.think = 'train_find', e.nextthink = 0.1e0 WHERE e.id = :eid;
    END
    ELSE IF (cls = 'misc_viper_bomb') THEN
      -- SP_misc_viper_bomb: unseen and still until used; dmg 1000 by default
      UPDATE ents e SET e.solid = 0, e.movetype = 0, e.minx = -8, e.miny = -8, e.minz = -8, e.maxx = 8, e.maxy = 8, e.maxz = 8,
             e.dmg = IIF(COALESCE(:dmg, 0) = 0, 1000, :dmg) WHERE e.id = :eid;
    ELSE IF (cls = 'trigger_elevator') THEN
      UPDATE ents e SET e.solid = 0, e.think = 'elevator_init', e.nextthink = :t0 + 0.1e0 WHERE e.id = :eid;
    ELSE IF (cls = 'turret_breach') THEN
    BEGIN
      -- SP_turret_breach: the part that pitches and yaws, at `speed` degrees a second (50), hurting what blocks it
      -- by `dmg` (10); its pitch between minpitch and maxpitch (-30..30; p1x/p2x hold them negated, as Quake's
      -- pos1/pos2 did, since its pitch is positive downward), its yaw between minyaw and maxyaw (0..360, p1y/p2y).
      -- The aim (move_angles) rides in sg_x/sg_y, starting at its angle; the muzzle's offset in dstx..z once found.
      UPDATE ents e SET e.solid = 4, e.movetype = 7, e.speed = IIF(COALESCE(:spd, 0) = 0, 50, :spd), e.dmg = IIF(COALESCE(:dmg, 0) = 0, 10, :dmg),
             e.p1x = -IIF(COALESCE(:minp, 0) = 0, -30, :minp), e.p2x = -IIF(COALESCE(:maxp, 0) = 0, 30, :maxp),
             e.p1y = COALESCE(:miny_, 0), e.p2y = IIF(COALESCE(:maxy_, 0) = 0, 360, :maxy_),
             e.sg_x = 0, e.sg_y = e.yaw, e.ideal_yaw = e.yaw, e.think = 'turret_breach_init', e.nextthink = 0.1e0 WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    ELSE IF (cls = 'turret_base') THEN
    BEGIN
      -- SP_turret_base: the part that only yaws, on the breach's team
      UPDATE ents e SET e.solid = 4, e.movetype = 7 WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    ELSE IF (cls = 'turret_driver') THEN
    BEGIN
      -- SP_turret_driver: an infantry sitting in the turret (not on its team here: the breach moves it), 100
      -- health, no gibbing, no knockback, counted as a monster; turret_driver_link joins it to its breach
      SELECT t.model, t.skin, t.stand_anim FROM monster_types t WHERE t.name = 'infantry' INTO mmodel, mskin, stand;
      EXECUTE PROCEDURE set_model(eid, mmodel);
      UPDATE ents e SET e.mtype = 'infantry', e.skin = :mskin, e.health = 100, e.max_health = 100, e.gib_health = 0, e.mass = 200, e.viewheight = 24,
             e.solid = 3, e.takedamage = 2, e.movetype = 0, e.clipmask = 33685507, e.flags = 32 + 4096, e.aiflags = 4,
             e.minx = -16, e.miny = -16, e.minz = -24, e.maxx = 16, e.maxy = 16, e.maxz = 32, e.st = 'stand', e.anim = :stand, e.ideal_yaw = e.yaw,
             e.think = 'turret_driver_link', e.nextthink = :t0 + 0.1e0 WHERE e.id = :eid;
      UPDATE game g SET g.total_monsters = g.total_monsters + 1 WHERE g.id = 1;
      EXECUTE PROCEDURE link_ent(eid);
    END
    ELSE IF (cls = 'target_spawner') THEN
    BEGIN
      -- SP_target_spawner: what it spawns (its target's classname) sets off along its angle at `speed`
      EXECUTE PROCEDURE movedir(COALESCE(ang, 0)) RETURNING_VALUES dx, dy, dz;
      UPDATE ents e SET e.solid = 0, e.p1x = :dx * COALESCE(:spd, 0), e.p1y = :dy * COALESCE(:spd, 0), e.p1z = :dz * COALESCE(:spd, 0) WHERE e.id = :eid;
    END
    ELSE IF (cls = 'target_character') THEN
    BEGIN
      -- SP_target_character: a brush model showing its texture's blank frame (12) until its string is set
      UPDATE ents e SET e.solid = 4, e.movetype = 7, e.yaw = 0, e.frame = 12 WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    ELSE IF (cls = 'target_string') THEN
      UPDATE ents e SET e.solid = 0, e.message = COALESCE(e.message, '') WHERE e.id = :eid;
    ELSE IF (cls = 'func_clock') THEN
    BEGIN
      -- SP_func_clock: it needs a target (a target_string), and a count to count down from; counting up
      -- with none runs an hour. START_OFF waits to be used, else it starts in a second.
      IF (tg IS NULL OR tg = '' OR (BIN_AND(sf, 2) <> 0 AND COALESCE(cnt, 0) = 0)) THEN BEGIN DELETE FROM ents e WHERE e.id = :eid; CONTINUE; END
      UPDATE ents e SET e.solid = 0, e.count_ = IIF(BIN_AND(:sf, 1) <> 0 AND COALESCE(:cnt, 0) = 0, 3600, COALESCE(:cnt, 0)) WHERE e.id = :eid;
      EXECUTE PROCEDURE clock_reset(eid);
      IF (BIN_AND(sf, 4) = 0) THEN UPDATE ents e SET e.think = 'clock_think', e.nextthink = :t0 + 1 WHERE e.id = :eid;
    END
    ELSE IF (cls IN ('misc_blackhole', 'misc_eastertank', 'misc_easterchick', 'misc_easterchick2')) THEN
    BEGIN
      -- the decorations that run through a stretch of frames at 10 Hz (misc_*_think): the black hole its
      -- 19 (translucent, and gone when used), the Easter tank 254..292 and the chicks 208..246 and 248..286
      -- of their monsters' models (dstx the first frame, dsty the one after the last)
      EXECUTE PROCEDURE set_model(eid, CASE cls WHEN 'misc_blackhole' THEN 'models/objects/black/tris.md2'
                                                WHEN 'misc_eastertank' THEN 'models/monsters/tank/tris.md2' ELSE 'models/monsters/bitch/tris.md2' END);
      UPDATE ents e SET e.solid = IIF(:cls = 'misc_blackhole', 0, 2), e.renderfx = IIF(:cls = 'misc_blackhole', 2, 0),
             e.minx = IIF(:cls = 'misc_blackhole', -64, -32), e.miny = IIF(:cls = 'misc_blackhole', -64, -32), e.minz = IIF(:cls = 'misc_eastertank', -16, 0),
             e.maxx = IIF(:cls = 'misc_blackhole', 64, 32), e.maxy = IIF(:cls = 'misc_blackhole', 64, 32), e.maxz = IIF(:cls = 'misc_blackhole', 8, 32),
             e.dstx = CASE :cls WHEN 'misc_blackhole' THEN 0 WHEN 'misc_eastertank' THEN 254 WHEN 'misc_easterchick' THEN 208 ELSE 248 END,
             e.dsty = CASE :cls WHEN 'misc_blackhole' THEN 19 WHEN 'misc_eastertank' THEN 293 WHEN 'misc_easterchick' THEN 247 ELSE 287 END,
             e.think = 'frame_cycle', e.nextthink = :t0 + 0.2e0 WHERE e.id = :eid;
      UPDATE ents e SET e.frame = e.dstx WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    ELSE IF (cls IN ('light_mine1', 'light_mine2')) THEN
    BEGIN
      -- SP_light_mine1/2: a lamp on a stalk, standing
      EXECUTE PROCEDURE set_model(eid, IIF(cls = 'light_mine1', 'models/objects/minelite/light1/tris.md2', 'models/objects/minelite/light2/tris.md2'));
      UPDATE ents e SET e.solid = 2, e.minx = -2, e.miny = -2, e.minz = -12, e.maxx = 2, e.maxy = 2, e.maxz = 12 WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    ELSE IF (cls = 'target_earthquake') THEN
      -- SP_target_earthquake: count 5 seconds, speed (the severity) 200 by default
      UPDATE ents e SET e.solid = 0, e.count_ = IIF(COALESCE(:cnt, 0) = 0, 5, :cnt), e.speed = IIF(COALESCE(:spd, 0) = 0, 200, :spd) WHERE e.id = :eid;
    ELSE IF (cls = 'path_corner') THEN BEGIN END
    ELSE IF (cls = 'func_timer') THEN
    BEGIN
      IF (wt IS NULL OR wt = 0) THEN wt = 1;
      UPDATE ents e SET e.solid = 0, e.wait_ = :wt WHERE e.id = :eid;
      IF (BIN_AND(sf, 1) <> 0) THEN UPDATE ents e SET e.think = 'timer_think', e.nextthink = :t0 + 1 + RAND() * :wt WHERE e.id = :eid;   -- START_ON
    END
    ELSE IF (cls = 'func_rotating') THEN
    BEGIN
      -- spawnflags: 1 START_ON 2 REVERSE 4 X_AXIS 8 Y_AXIS 16 TOUCH_PAIN 32 STOP 64 ANIMATED
      IF (spd IS NULL OR spd = 0) THEN spd = 100;
      IF (BIN_AND(sf, 2) <> 0) THEN spd = -spd;
      UPDATE ents e SET e.solid = 4, e.movetype = 7, e.yaw = 0, e.dmg = IIF(COALESCE(:dmg, 0) = 0, 2, :dmg),
             e.p1x = IIF(BIN_AND(:sf, 8) <> 0, :spd, 0), e.p1y = IIF(BIN_AND(:sf, 12) = 0, :spd, 0), e.p1z = IIF(BIN_AND(:sf, 4) <> 0, :spd, 0) WHERE e.id = :eid;
      IF (BIN_AND(sf, 1) <> 0) THEN UPDATE ents e SET e.avel_pitch = e.p1x, e.avel_yaw = e.p1y, e.avel_roll = e.p1z WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    ELSE IF (cls = 'func_wall') THEN
    BEGIN
      -- 1 TRIGGER_SPAWN 2 TOGGLE 4 START_ON
      UPDATE ents e SET e.solid = IIF(BIN_AND(:sf, 1) <> 0 AND BIN_AND(:sf, 4) = 0, 0, 4), e.alpha = IIF(BIN_AND(:sf, 1) <> 0 AND BIN_AND(:sf, 4) = 0, 1, 0), e.movetype = 7, e.yaw = 0 WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    ELSE IF (cls = 'func_explosive') THEN
    BEGIN
      UPDATE ents e SET e.solid = IIF(BIN_AND(:sf, 1) <> 0, 0, 4), e.alpha = IIF(BIN_AND(:sf, 1) <> 0, 1, 0), e.movetype = 7, e.yaw = 0,
             e.health = IIF(COALESCE(:hp, 0) = 0, 100, :hp), e.max_health = IIF(COALESCE(:hp, 0) = 0, 100, :hp), e.takedamage = IIF(BIN_AND(:sf, 1) <> 0, 0, 1),
             e.mass = IIF(COALESCE(:mass, 0) = 0, 75, :mass) WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    -- ── triggers ──
    ELSE IF (cls IN ('trigger_multiple', 'trigger_once', 'trigger_counter', 'trigger_push', 'trigger_hurt', 'trigger_monsterjump', 'trigger_key', 'trigger_gravity')) THEN
    BEGIN
      UPDATE ents e SET e.model_id = NULL, e.solid = IIF(:mdl IS NULL, 0, 1), e.movetype = 0, e.yaw = 0 WHERE e.id = :eid;
      IF (cls IN ('trigger_multiple', 'trigger_once')) THEN
      BEGIN
        n1 = CASE COALESCE(snds, 0) WHEN 1 THEN 'misc/secret.wav' WHEN 2 THEN 'misc/talk.wav' WHEN 3 THEN 'misc/talk1.wav' ELSE NULL END;
        UPDATE ents e SET e.wait_ = IIF(:cls = 'trigger_once', -1, IIF(COALESCE(:wt, 0) = 0, 0.2e0, :wt)), e.noise1 = TRIM(:n1), e.takedamage = IIF(:hp > 0, 1, 0),
               e.solid = IIF(:hp > 0, 2, IIF(BIN_AND(:sf, 4) <> 0, 0, e.solid)) WHERE e.id = :eid;    -- TRIGGERED: off until used
      END
      ELSE IF (cls = 'trigger_counter') THEN
        UPDATE ents e SET e.wait_ = -1, e.count_ = IIF(COALESCE(:cnt, 0) = 0, 2, :cnt) WHERE e.id = :eid;
      ELSE IF (cls = 'trigger_push') THEN
      BEGIN
        EXECUTE PROCEDURE movedir(COALESCE(ang, 0)) RETURNING_VALUES dx, dy, dz;
        UPDATE ents e SET e.speed = IIF(COALESCE(:spd, 0) = 0, 1000, :spd), e.p1x = :dx, e.p1y = :dy, e.p1z = :dz WHERE e.id = :eid;
      END
      ELSE IF (cls = 'trigger_hurt') THEN
        UPDATE ents e SET e.dmg = IIF(COALESCE(:dmg, 0) = 0, 5, :dmg), e.solid = IIF(BIN_AND(:sf, 1) <> 0, 0, e.solid) WHERE e.id = :eid;   -- START_OFF
      ELSE IF (cls = 'trigger_monsterjump') THEN
        -- SP_trigger_monsterjump: movedir from the angle (0 means 360, so east), speed and height 200 by default
        UPDATE ents e SET e.speed = IIF(COALESCE(:spd, 0) = 0, 200, :spd), e.height = IIF(COALESCE(:hgt, 0) = 0, 200, :hgt),
               e.p1x = IIF(COALESCE(:ang, 0) < 0, 0, COS(COALESCE(:ang, 0) * 0.0174532925e0)), e.p1y = IIF(COALESCE(:ang, 0) < 0, 0, SIN(COALESCE(:ang, 0) * 0.0174532925e0)) WHERE e.id = :eid;
      ELSE IF (cls = 'trigger_key') THEN
        UPDATE ents e SET e.solid = 0 WHERE e.id = :eid;      -- used by its targetname, not touched
    END
    ELSE IF (cls IN ('trigger_relay', 'trigger_always')) THEN
    BEGIN
      UPDATE ents e SET e.solid = 0, e.model_id = NULL WHERE e.id = :eid;
      IF (cls = 'trigger_always') THEN
        UPDATE ents e SET e.think = 'always_fire', e.nextthink = :t0 + 0.2e0 + MAXVALUE(e.delay, 0), e.delay = 0 WHERE e.id = :eid;
    END
    ELSE IF (cls = 'target_changelevel') THEN
    BEGIN
      UPDATE ents e SET e.model_id = NULL, e.solid = IIF(:mdl IS NULL, 0, 1), e.movetype = 0 WHERE e.id = :eid;
    END
    ELSE IF (cls = 'target_speaker') THEN
    BEGIN
      -- noise1 holds the sound; speed = volume, height = attenuation; sounds = 1 while a looped speaker plays
      UPDATE ents e SET e.solid = 0, e.model_id = NULL, e.mkind = NULL, e.speed = IIF(COALESCE(:vol, 0) = 0, 1, :vol), e.height = COALESCE(:attn, 1),
             e.sounds = IIF(BIN_AND(:sf, 1) <> 0, 1, 0), e.noise1 = IIF(POSITION('.', :noise) = 0, :noise || '.wav', :noise) WHERE e.id = :eid;
    END
    ELSE IF (cls = 'func_object') THEN EXECUTE PROCEDURE spawn_func_object(eid, sf, dmg);
    ELSE IF (cls = 'func_killbox') THEN
      UPDATE ents e SET e.solid = 0, e.model_id = NULL, e.mkind = NULL WHERE e.id = :eid;    -- unseen; the box is the model's
    ELSE IF (cls = 'func_conveyor') THEN
    BEGIN
      -- SP_func_conveyor: a solid brush; count keeps the speed while it is off (START_ON is spawnflags 1)
      UPDATE ents e SET e.solid = 4, e.movetype = 0, e.count_ = IIF(COALESCE(:spd, 0) = 0, 100, :spd),
             e.speed = IIF(BIN_AND(:sf, 1) <> 0, IIF(COALESCE(:spd, 0) = 0, 100, :spd), 0) WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    ELSE IF (cls = 'point_combat') THEN
      -- SP_point_combat: a 16×16×32 trigger the monster that runs to it touches
      UPDATE ents e SET e.solid = 1, e.model_id = NULL, e.mkind = NULL, e.minx = -8, e.miny = -8, e.minz = -16, e.maxx = 8, e.maxy = 8, e.maxz = 16 WHERE e.id = :eid;
    ELSE IF (cls = 'func_areaportal') THEN
      -- a portal between two areas, closed until a door (its targeter) or a use opens it
      UPDATE ents e SET e.solid = 0, e.model_id = NULL, e.mkind = NULL, e.style = :sty, e.count_ = 0 WHERE e.id = :eid;
    ELSE IF (cls = 'target_crosslevel_trigger') THEN
      -- used, it sets its spawnflags (SFL_CROSS_TRIGGER_1..8) in the unit's flags
      UPDATE ents e SET e.solid = 0, e.model_id = NULL WHERE e.id = :eid;
    ELSE IF (cls = 'target_crosslevel_target') THEN
      -- looks at the unit's flags once, after its delay (a second by default)
      UPDATE ents e SET e.solid = 0, e.model_id = NULL, e.think = 'crosslevel_think', e.nextthink = :t0 + IIF(COALESCE(:dl, 0) = 0, 1, :dl) WHERE e.id = :eid;
    ELSE IF (cls IN ('target_explosion', 'target_splash', 'target_secret', 'target_goal', 'target_help', 'target_lightramp', 'target_temp_entity', 'target_blaster', 'target_spawner')) THEN
    BEGIN
      UPDATE ents e SET e.solid = 0, e.model_id = NULL WHERE e.id = :eid;
      IF (cls = 'target_secret') THEN UPDATE game g SET g.total_secrets = g.total_secrets + 1 WHERE g.id = 1;
      IF (cls = 'target_goal') THEN UPDATE game g SET g.total_goals = g.total_goals + 1 WHERE g.id = 1;
      IF (cls = 'target_lightramp') THEN UPDATE ents e SET e.message = COALESCE(:msg, 'am') WHERE e.id = :eid;
    END
    ELSE IF (cls = 'target_laser') THEN
    BEGIN
      -- a beam from its origin along its angles; sounds = 1 while on; dmg per touch
      EXECUTE PROCEDURE movedir(COALESCE(ang, 0)) RETURNING_VALUES dx, dy, dz;
      UPDATE ents e SET e.solid = 0, e.model_id = NULL, e.mkind = NULL, e.p1x = :dx, e.p1y = :dy, e.p1z = :dz, e.sounds = IIF(BIN_AND(:sf, 1) <> 0, 1, 0),
             e.dmg = IIF(COALESCE(:dmg, 0) = 0, 1, :dmg), e.think = 'laser_think', e.nextthink = :t0 + 0.1e0 WHERE e.id = :eid;
    END
    ELSE IF (cls IN ('misc_teleporter_dest', 'info_null', 'info_notnull')) THEN
    BEGIN
      UPDATE ents e SET e.solid = 0, e.yaw = COALESCE(:ang, 0) WHERE e.id = :eid;
      IF (cls = 'misc_teleporter_dest') THEN EXECUTE PROCEDURE set_model(eid, 'models/objects/dmspot/tris.md2');
    END
    ELSE IF (cls = 'misc_teleporter') THEN
    BEGIN
      EXECUTE PROCEDURE set_model(eid, 'models/objects/dmspot/tris.md2');
      UPDATE ents e SET e.solid = 1, e.skin = 1, e.minx = -8, e.miny = -8, e.minz = 8, e.maxx = 8, e.maxy = 8, e.maxz = 24 WHERE e.id = :eid;
    END
    -- ── items ──
    ELSE IF (cls LIKE 'item_%' OR cls LIKE 'weapon_%' OR cls LIKE 'ammo_%' OR cls LIKE 'key_%') THEN
    BEGIN
      mdl = item_model(cls);
      IF (mdl IS NULL) THEN BEGIN DELETE FROM ents e WHERE e.id = :eid; CONTINUE; END
      EXECUTE PROCEDURE set_model(eid, mdl);
      -- (SpawnItem: items pulse, RF_GLOW, unless they cannot be touched)
      UPDATE ents e SET e.solid = 1, e.movetype = 6, e.clipmask = 3, e.effects = 1, e.yaw = 0, e.renderfx = IIF(BIN_AND(:sf, 2) <> 0, 0, 4),
             e.minx = -15, e.miny = -15, e.minz = -15, e.maxx = 15, e.maxy = 15, e.maxz = 15 WHERE e.id = :eid;
      -- items start a little above the floor and drop
      UPDATE ents e SET e.z = e.z + 1 WHERE e.id = :eid;
      EXECUTE PROCEDURE drop_to_floor(eid);
      IF (BIN_AND(sf, 1) <> 0 AND (tn IS NOT NULL AND tn <> '')) THEN UPDATE ents e SET e.solid = 0, e.alpha = 1 WHERE e.id = :eid;   -- TRIGGER_SPAWN
    END
    -- ── monsters ──
    ELSE IF (cls LIKE 'monster_%') THEN
    BEGIN
      mname = SUBSTRING(cls FROM 9);
      SELECT t.model, t.skin, t.health, t.gib_health, t.mass, t.flags, t.yaw_speed, t.stand_anim, t.minx, t.miny, t.minz, t.maxx, t.maxy, t.maxz
        FROM monster_types t WHERE t.name = :mname INTO mmodel, mskin, mhp, mgh, mmass, mflags, mys, stand, a, b, c, e2, f2, g2;
      IF (mmodel IS NULL) THEN BEGIN DELETE FROM ents e WHERE e.id = :eid; CONTINUE; END
      EXECUTE PROCEDURE set_model(eid, mmodel);
      UPDATE ents e SET e.mtype = :mname, e.skin = :mskin, e.health = :mhp, e.max_health = :mhp, e.gib_health = :mgh, e.mass = :mmass, e.solid = 3, e.takedamage = 2,
             e.movetype = IIF(BIN_AND(:mflags, 3) <> 0, 5, 4), e.clipmask = 33685507, e.flags = BIN_OR(32, :mflags), e.yaw_speed = :mys,
             e.minx = :a, e.miny = :b, e.minz = :c, e.maxx = :e2, e.maxy = :f2, e.maxz = :g2, e.viewheight = :g2 - 8,
             e.st = 'stand', e.anim = :stand, e.anim_frame = FLOOR(RAND() * 4), e.ideal_yaw = e.yaw,
             e.think = 'monster_think', e.nextthink = :t0 + 0.1e0 + RAND() * 0.5e0 WHERE e.id = :eid;
      UPDATE game g SET g.total_monsters = g.total_monsters + 1 WHERE g.id = 1;
      IF (BIN_AND(sf, 2) <> 0) THEN
        -- TRIGGER_SPAWN: nowhere until used
        UPDATE ents e SET e.solid = 0, e.alpha = 1, e.st = 'asleep', e.nextthink = NULL, e.takedamage = 0 WHERE e.id = :eid;
      ELSE IF (BIN_AND(mflags, 3) = 0) THEN EXECUTE PROCEDURE drop_to_floor(eid);
      ELSE EXECUTE PROCEDURE link_ent(eid);
      IF (tg IS NOT NULL AND tg <> '' AND BIN_AND(sf, 2) = 0) THEN
        UPDATE ents e SET e.st = 'walk', e.anim = NULL WHERE e.id = :eid;
    END
    -- ── decorations ──
    ELSE IF (cls = 'misc_deadsoldier') THEN
    BEGIN
      EXECUTE PROCEDURE set_model(eid, 'models/deadbods/dude/tris.md2');
      UPDATE ents e SET e.solid = 2, e.movetype = 0, e.health = 20, e.max_health = 20, e.takedamage = 1, e.gib_health = -30,
             e.frame = CASE WHEN BIN_AND(:sf, 2) <> 0 THEN 1 WHEN BIN_AND(:sf, 4) <> 0 THEN 2 WHEN BIN_AND(:sf, 8) <> 0 THEN 3 WHEN BIN_AND(:sf, 16) <> 0 THEN 4 WHEN BIN_AND(:sf, 32) <> 0 THEN 5 ELSE 0 END,
             e.minx = -16, e.miny = -16, e.minz = 0, e.maxx = 16, e.maxy = 16, e.maxz = 16, e.st = 'dead' WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    ELSE IF (cls = 'misc_explobox') THEN
    BEGIN
      EXECUTE PROCEDURE set_model(eid, 'models/objects/barrels/tris.md2');
      UPDATE ents e SET e.solid = 2, e.movetype = 4, e.health = IIF(COALESCE(:hp, 0) = 0, 10, :hp), e.max_health = IIF(COALESCE(:hp, 0) = 0, 10, :hp), e.takedamage = 1,
             e.mass = IIF(COALESCE(:mass, 0) = 0, 400, :mass), e.dmg = IIF(COALESCE(:dmg, 0) = 0, 150, :dmg), e.yaw = 0, e.clipmask = 33685507,
             e.minx = -16, e.miny = -16, e.minz = 0, e.maxx = 16, e.maxy = 16, e.maxz = 40 WHERE e.id = :eid;
      EXECUTE PROCEDURE drop_to_floor(eid);
    END
    ELSE IF (cls = 'misc_banner') THEN
    BEGIN
      EXECUTE PROCEDURE set_model(eid, 'models/objects/banner/tris.md2');
      -- SP_misc_banner: a random frame to start, and misc_banner_think moves it on every 0.1 s
      UPDATE ents e SET e.solid = 0, e.frame = FLOOR(RAND() * 16), e.think = 'banner_think', e.nextthink = :t0 + 0.1 WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    ELSE IF (cls = 'misc_satellite_dish') THEN
    BEGIN
      EXECUTE PROCEDURE set_model(eid, 'models/objects/satellite/tris.md2');
      UPDATE ents e SET e.solid = 2, e.movetype = 0, e.minx = -64, e.miny = -64, e.minz = 0, e.maxx = 64, e.maxy = 64, e.maxz = 128 WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    ELSE IF (cls IN ('misc_gib_head', 'misc_gib_arm', 'misc_gib_leg')) THEN
    BEGIN
      EXECUTE PROCEDURE set_model(eid, CASE cls WHEN 'misc_gib_head' THEN 'models/objects/gibs/head/tris.md2' WHEN 'misc_gib_arm' THEN 'models/objects/gibs/arm/tris.md2' ELSE 'models/objects/gibs/leg/tris.md2' END);
      UPDATE ents e SET e.solid = 0, e.movetype = 6, e.clipmask = 3, e.minx = -8, e.miny = -8, e.minz = -8, e.maxx = 8, e.maxy = 8, e.maxz = 8, e.avel_yaw = crand() * 200, e.effects = 2, e.think = 'remove', e.nextthink = :t0 + 30 WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    ELSE IF (cls = 'misc_bigviper') THEN
    BEGIN
      -- SP_misc_bigviper: the intro's large viper, standing still
      EXECUTE PROCEDURE set_model(eid, 'models/ships/bigviper/tris.md2');
      UPDATE ents e SET e.solid = 0 WHERE e.id = :eid;
      EXECUTE PROCEDURE link_ent(eid);
    END
    ELSE
      UPDATE ents e SET e.solid = 0 WHERE e.id = :eid;
  END

  -- the texture animations the spawn functions asked of the client: a button cycles its first two
  -- frames (SP_func_button's EF_ANIM01), and a door, rotating door, rotator, wall, object or explosive
  -- with its ANIMATED or ANIMATED_FAST spawnflag all of them, at 2 or 10 Hz (EF_ANIM_ALL, EF_ANIM_ALLFAST)
  UPDATE ents e SET e.effects = BIN_OR(e.effects, CASE e.classname
      WHEN 'func_button' THEN 1024
      WHEN 'func_door' THEN IIF(BIN_AND(e.spawnflags, 16) <> 0, 4096, 0) + IIF(BIN_AND(e.spawnflags, 64) <> 0, 8192, 0)
      WHEN 'func_door_rotating' THEN IIF(BIN_AND(e.spawnflags, 16) <> 0, 4096, 0)
      WHEN 'func_rotating' THEN IIF(BIN_AND(e.spawnflags, 64) <> 0, 4096, 0) + IIF(BIN_AND(e.spawnflags, 128) <> 0, 8192, 0)
      WHEN 'func_wall' THEN IIF(BIN_AND(e.spawnflags, 8) <> 0, 4096, 0) + IIF(BIN_AND(e.spawnflags, 16) <> 0, 8192, 0)
      ELSE IIF(BIN_AND(e.spawnflags, 2) <> 0, 4096, 0) + IIF(BIN_AND(e.spawnflags, 4) <> 0, 8192, 0) END)
   WHERE e.classname IN ('func_button', 'func_door', 'func_door_rotating', 'func_rotating', 'func_wall', 'func_object', 'func_explosive');

  IF (only_id IS NOT NULL) THEN EXIT;
  -- G_FindTeams: movers with the same team move together; the first spawned is the master
  FOR SELECT e.id FROM ents e WHERE e.team IS NOT NULL AND e.team <> '' AND e.movetype = 7 ORDER BY e.id INTO eid DO
  BEGIN
    SELECT MIN(o.id) FROM ents o WHERE o.team = (SELECT e.team FROM ents e WHERE e.id = :eid) AND o.movetype = 7 AND o.id < :eid INTO mid;
    IF (mid IS NOT NULL) THEN
    BEGIN
      UPDATE ents e SET e.linked_id = :mid, e.flags = BIN_OR(e.flags, 2048) WHERE e.id = :eid;
      UPDATE ents m SET m.message = COALESCE(m.message, (SELECT e.message FROM ents e WHERE e.id = :eid)),
             m.targetname = COALESCE(m.targetname, (SELECT e.targetname FROM ents e WHERE e.id = :eid)),
             m.max_health = MAXVALUE(m.max_health, (SELECT e.max_health FROM ents e WHERE e.id = :eid))
       WHERE m.id = :mid;
    END
  END
END^

CREATE OR ALTER PROCEDURE always_fire (eid INTEGER)
AS
BEGIN
  EXECUTE PROCEDURE use_targets(eid, player_ent());
  DELETE FROM ents e WHERE e.id = :eid;
END^

CREATE OR ALTER PROCEDURE train_find (eid INTEGER)
AS
DECLARE tgt VARCHAR(40); DECLARE cx DOUBLE PRECISION; DECLARE cy DOUBLE PRECISION; DECLARE cz DOUBLE PRECISION; DECLARE st SMALLINT;
BEGIN
  SELECT e.target, e.mv_state FROM ents e WHERE e.id = :eid INTO tgt, st;
  SELECT FIRST 1 e.x, e.y, e.z FROM ents e WHERE e.targetname = :tgt AND e.classname = 'path_corner' INTO cx, cy, cz;
  -- func_train_find: to the first corner, and on from it: the next move is to the corner after it (its
  -- wait and pathtarget do not apply to the start)
  IF (cx IS NOT NULL) THEN
    UPDATE ents e SET e.x = :cx - e.minx, e.y = :cy - e.miny, e.z = :cz - e.minz, e.think = NULL, e.nextthink = NULL,
           e.target = (SELECT FIRST 1 c.target FROM ents c WHERE c.targetname = :tgt AND c.classname = 'path_corner') WHERE e.id = :eid;
  EXECUTE PROCEDURE link_ent(eid);
  IF (st = 2) THEN EXECUTE PROCEDURE train_next(eid);
END^

-- target_laser: trace the beam, hurt what it touches, and report it to the browser
CREATE OR ALTER PROCEDURE laser_think (eid INTEGER)
AS
DECLARE x DOUBLE PRECISION; DECLARE y DOUBLE PRECISION; DECLARE z DOUBLE PRECISION; DECLARE dx DOUBLE PRECISION; DECLARE dy DOUBLE PRECISION; DECLARE dz DOUBLE PRECISION;
DECLARE on_ INTEGER; DECLARE dmg INTEGER; DECLARE sf INTEGER;
DECLARE f DOUBLE PRECISION; DECLARE ex DOUBLE PRECISION; DECLARE ey DOUBLE PRECISION; DECLARE ez DOUBLE PRECISION;
DECLARE nx DOUBLE PRECISION; DECLARE ny DOUBLE PRECISION; DECLARE nz DOUBLE PRECISION;
DECLARE sfl INTEGER; DECLARE ct INTEGER; DECLARE als SMALLINT; DECLARE sts SMALLINT; DECLARE hit INTEGER;
BEGIN
  SELECT e.x, e.y, e.z, e.p1x, e.p1y, e.p1z, e.sounds, e.dmg, e.spawnflags FROM ents e WHERE e.id = :eid INTO x, y, z, dx, dy, dz, on_, dmg, sf;
  UPDATE ents e SET e.nextthink = now_() + 0.1e0 WHERE e.id = :eid;
  IF (on_ = 0) THEN EXIT;
  EXECUTE PROCEDURE trace_move(eid, 0, 0, 0, 0, 0, 0, x, y, z, x + dx * 8192, y + dy * 8192, z + dz * 8192, 100663299)
    RETURNING_VALUES f, ex, ey, ez, nx, ny, nz, sfl, ct, als, sts, hit;
  -- the colour: spawnflags 2 red 4 green 8 blue 16 yellow 32 orange
  EXECUTE PROCEDURE fx(13, x, y, z, ex, ey, ez, BIN_AND(sf, 62));
  IF (hit > 0 AND EXISTS (SELECT 1 FROM ents e WHERE e.id = :hit AND e.takedamage > 0)) THEN
    EXECUTE PROCEDURE t_damage(hit, eid, eid, dmg, 1, 4);
END^

CREATE OR ALTER PROCEDURE dish_think (eid INTEGER)
AS
DECLARE fr INTEGER;
BEGIN
  UPDATE ents e SET e.frame = e.frame + 1 WHERE e.id = :eid RETURNING e.frame INTO fr;
  IF (fr < 38) THEN UPDATE ents e SET e.nextthink = now_() + 0.1e0 WHERE e.id = :eid;
  ELSE UPDATE ents e SET e.nextthink = NULL, e.think = NULL WHERE e.id = :eid;
END^

SET TERM ; ^
