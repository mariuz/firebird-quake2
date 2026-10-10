-- weapons.sql – p_weapon.c, p_client.c and pmove.c: what the player does each tic.

SET TERM ^ ;

-- the eye and the view vectors
CREATE OR ALTER PROCEDURE view_vectors
RETURNS (ex DOUBLE PRECISION, ey DOUBLE PRECISION, ez DOUBLE PRECISION,
         fx DOUBLE PRECISION, fy DOUBLE PRECISION, fz DOUBLE PRECISION,
         rx DOUBLE PRECISION, ry DOUBLE PRECISION, rz DOUBLE PRECISION,
         ux DOUBLE PRECISION, uy DOUBLE PRECISION, uz DOUBLE PRECISION)
AS
DECLARE yaw DOUBLE PRECISION; DECLARE pitch DOUBLE PRECISION;
DECLARE sy DOUBLE PRECISION; DECLARE cy DOUBLE PRECISION; DECLARE sp DOUBLE PRECISION; DECLARE cp DOUBLE PRECISION;
BEGIN
  SELECT e.x, e.y, e.z + p.view_ofs, e.yaw, p.pitch FROM player p JOIN ents e ON e.id = p.ent_id WHERE p.id = 1 INTO ex, ey, ez, yaw, pitch;
  sy = SIN(yaw * 0.0174532925e0); cy = COS(yaw * 0.0174532925e0);
  sp = SIN(pitch * 0.0174532925e0); cp = COS(pitch * 0.0174532925e0);
  fx = cp * cy; fy = cp * sy; fz = -sp;
  rx = sy; ry = -cy; rz = 0;
  ux = sp * cy; uy = sp * sy; uz = cp;
  SUSPEND;
END^

-- fire_bullet / fire_shotgun: `count` traces 8192 units out, spread in units at that distance
CREATE OR ALTER PROCEDURE fire_bullets (shooter INTEGER, cnt INTEGER,
  ox DOUBLE PRECISION, oy DOUBLE PRECISION, oz DOUBLE PRECISION,
  dx DOUBLE PRECISION, dy DOUBLE PRECISION, dz DOUBLE PRECISION, hspread DOUBLE PRECISION, vspread DOUBLE PRECISION, dmg INTEGER, kick INTEGER)
AS
DECLARE rx DOUBLE PRECISION; DECLARE ry DOUBLE PRECISION; DECLARE rz DOUBLE PRECISION;
DECLARE ux DOUBLE PRECISION; DECLARE uy DOUBLE PRECISION; DECLARE uz DOUBLE PRECISION;
DECLARE ax DOUBLE PRECISION; DECLARE ay DOUBLE PRECISION; DECLARE az DOUBLE PRECISION; DECLARE al DOUBLE PRECISION;
DECLARE f DOUBLE PRECISION; DECLARE hx DOUBLE PRECISION; DECLARE hy DOUBLE PRECISION; DECLARE hz DOUBLE PRECISION;
DECLARE nx DOUBLE PRECISION; DECLARE ny DOUBLE PRECISION; DECLARE nz DOUBLE PRECISION;
DECLARE sf INTEGER; DECLARE ct INTEGER; DECLARE als SMALLINT; DECLARE sts SMALLINT; DECLARE hit INTEGER;
DECLARE i INTEGER = 0; DECLARE r1 DOUBLE PRECISION; DECLARE r2 DOUBLE PRECISION;
DECLARE td SMALLINT; DECLARE hp INTEGER;
DECLARE wet SMALLINT; DECLARE inwater SMALLINT; DECLARE mask INTEGER; DECLARE water SMALLINT;
DECLARE wsx DOUBLE PRECISION; DECLARE wsy DOUBLE PRECISION; DECLARE wsz DOUBLE PRECISION; DECLARE color SMALLINT;
DECLARE bx DOUBLE PRECISION; DECLARE by_ DOUBLE PRECISION; DECLARE bz DOUBLE PRECISION; DECLARE bl DOUBLE PRECISION;
DECLARE tf DOUBLE PRECISION; DECLARE tx DOUBLE PRECISION; DECLARE ty DOUBLE PRECISION; DECLARE tz DOUBLE PRECISION; DECLARE tct INTEGER;
DECLARE c INTEGER;
BEGIN
  -- (fire_lead: a shot looks for water only on a map that has some; a muzzle under water fires through it)
  SELECT g.has_water FROM game g WHERE g.id = 1 INTO wet;
  inwater = 0;
  IF (wet = 1) THEN BEGIN c = point_contents(ox, oy, oz); inwater = IIF(BIN_AND(c, 56) <> 0, 1, 0); END
  al = vlen(dx, dy, dz);
  IF (al = 0) THEN EXIT;
  dx = dx / al; dy = dy / al; dz = dz / al;
  rx = dy; ry = -dx; rz = 0;
  al = vlen(rx, ry, rz);
  IF (al < 1e-6) THEN BEGIN rx = 1; ry = 0; rz = 0; al = 1; END
  rx = rx / al; ry = ry / al; rz = rz / al;
  ux = ry * dz - rz * dy; uy = rz * dx - rx * dz; uz = rx * dy - ry * dx;
  WHILE (i < cnt) DO
  BEGIN
    r1 = crand() * hspread; r2 = crand() * vspread;
    ax = dx * 8192 + r1 * rx + r2 * ux; ay = dy * 8192 + r1 * ry + r2 * uy; az = dz * 8192 + r1 * rz + r2 * uz;
    water = inwater; wsx = ox; wsy = oy; wsz = oz;
    mask = IIF(wet = 1 AND inwater = 0, 100663299 + 56, 100663299);
    EXECUTE PROCEDURE trace_move(shooter, 0, 0, 0, 0, 0, 0, ox, oy, oz, ox + ax, oy + ay, oz + az, mask)
      RETURNING_VALUES f, hx, hy, hz, nx, ny, nz, sf, ct, als, sts, hit;
    IF (f < 1 AND BIN_AND(ct, 56) <> 0) THEN
    BEGIN
      -- the shot hit water: a splash in its colour (TE_SPLASH: 2 water, 4 slime, 5 lava), then on under the
      -- surface with twice the spread, the trace ignoring water this time
      water = 1; wsx = hx; wsy = hy; wsz = hz;
      color = IIF(BIN_AND(ct, 32) <> 0, 2, IIF(BIN_AND(ct, 16) <> 0, 4, 5));
      EXECUTE PROCEDURE fx(7, hx, hy, hz, nx, ny, nz, 8 * 16 + color);
      r1 = crand() * hspread * 2; r2 = crand() * vspread * 2;
      bl = vlen(ax, ay, az);
      ax = ax / bl * 8192 + r1 * rx + r2 * ux; ay = ay / bl * 8192 + r1 * ry + r2 * uy; az = az / bl * 8192 + r1 * rz + r2 * uz;
      EXECUTE PROCEDURE trace_move(shooter, 0, 0, 0, 0, 0, 0, wsx, wsy, wsz, wsx + ax, wsy + ay, wsz + az, 100663299)
        RETURNING_VALUES f, hx, hy, hz, nx, ny, nz, sf, ct, als, sts, hit;
    END
    IF (f < 1) THEN
    BEGIN
      td = 0;
      IF (hit > 0) THEN SELECT e.takedamage, e.health FROM ents e WHERE e.id = :hit INTO td, hp;
      IF (td > 0) THEN
      BEGIN
        EXECUTE PROCEDURE fx(3, hx, hy, hz, 0, 0, 0, dmg);
        EXECUTE PROCEDURE t_damage(hit, shooter, shooter, dmg, kick, 16);
      END
      ELSE IF (BIN_AND(sf, 4) = 0) THEN
        EXECUTE PROCEDURE fx(IIF(cnt > 1, 11, 1), hx, hy, hz, nx, ny, nz, 0);
    END
    IF (water = 1) THEN
    BEGIN
      -- the bubble trail (TE_BUBBLETRAIL) from where it went in to where it stopped, or to where it left the water
      bl = vlen(hx - wsx, hy - wsy, hz - wsz);
      IF (bl > 0) THEN
      BEGIN
        bx = hx - (hx - wsx) / bl * 2; by_ = hy - (hy - wsy) / bl * 2; bz = hz - (hz - wsz) / bl * 2;
        c = point_contents(bx, by_, bz);
        IF (BIN_AND(c, 56) <> 0) THEN BEGIN hx = bx; hy = by_; hz = bz; END
        ELSE
        BEGIN
          EXECUTE PROCEDURE trace_move(NULL, 0, 0, 0, 0, 0, 0, bx, by_, bz, wsx, wsy, wsz, 56)
            RETURNING_VALUES tf, tx, ty, tz, nx, ny, nz, sf, tct, als, sts, hit;
          hx = tx; hy = ty; hz = tz;
        END
        EXECUTE PROCEDURE fx(14, wsx, wsy, wsz, hx, hy, hz, 0);
      END
    END
    i = i + 1;
  END
END^

-- fire_rail: a slug through everything in its path
CREATE OR ALTER PROCEDURE fire_rail (shooter INTEGER, ox DOUBLE PRECISION, oy DOUBLE PRECISION, oz DOUBLE PRECISION,
  dx DOUBLE PRECISION, dy DOUBLE PRECISION, dz DOUBLE PRECISION, dmg INTEGER, kick INTEGER)
AS
DECLARE f DOUBLE PRECISION; DECLARE hx DOUBLE PRECISION; DECLARE hy DOUBLE PRECISION; DECLARE hz DOUBLE PRECISION;
DECLARE nx DOUBLE PRECISION; DECLARE ny DOUBLE PRECISION; DECLARE nz DOUBLE PRECISION;
DECLARE sf INTEGER; DECLARE ct INTEGER; DECLARE als SMALLINT; DECLARE sts SMALLINT; DECLARE hit INTEGER;
DECLARE sx DOUBLE PRECISION; DECLARE sy DOUBLE PRECISION; DECLARE sz DOUBLE PRECISION; DECLARE ignore INTEGER; DECLARE i INTEGER = 0;
DECLARE ex DOUBLE PRECISION; DECLARE ey DOUBLE PRECISION; DECLARE ez DOUBLE PRECISION;
BEGIN
  ex = ox + dx * 8192; ey = oy + dy * 8192; ez = oz + dz * 8192;
  sx = ox; sy = oy; sz = oz; ignore = shooter;
  WHILE (i < 8) DO
  BEGIN
    EXECUTE PROCEDURE trace_move(ignore, 0, 0, 0, 0, 0, 0, sx, sy, sz, ex, ey, ez, 100663299)
      RETURNING_VALUES f, hx, hy, hz, nx, ny, nz, sf, ct, als, sts, hit;
    IF (hit > 0 AND EXISTS (SELECT 1 FROM ents e WHERE e.id = :hit AND e.takedamage > 0)) THEN
    BEGIN
      EXECUTE PROCEDURE t_damage(hit, shooter, shooter, dmg, kick, 0);     -- (fire_rail: armour protects fully)
      -- continue from just past the hit, ignoring what we just shot
      ignore = hit;
      sx = hx + dx * 8; sy = hy + dy * 8; sz = hz + dz * 8;
      i = i + 1;
      CONTINUE;
    END
    LEAVE;
  END
  EXECUTE PROCEDURE fx(4, ox, oy, oz, hx, hy, hz, 0);
END^

-- the weapon's muzzle: 24 forward, 8 right, viewheight - 8 up (P_ProjectSource)
CREATE OR ALTER PROCEDURE muzzle (side DOUBLE PRECISION, up_ DOUBLE PRECISION)
RETURNS (mx DOUBLE PRECISION, my DOUBLE PRECISION, mz DOUBLE PRECISION, fx DOUBLE PRECISION, fy DOUBLE PRECISION, fz DOUBLE PRECISION,
         rx DOUBLE PRECISION, ry DOUBLE PRECISION, rz DOUBLE PRECISION)
AS
DECLARE ex DOUBLE PRECISION; DECLARE ey DOUBLE PRECISION; DECLARE ez DOUBLE PRECISION;
DECLARE ux DOUBLE PRECISION; DECLARE uy DOUBLE PRECISION; DECLARE uz DOUBLE PRECISION;
BEGIN
  EXECUTE PROCEDURE view_vectors RETURNING_VALUES ex, ey, ez, fx, fy, fz, rx, ry, rz, ux, uy, uz;
  mx = ex + fx * 24 + rx * side + ux * up_;
  my = ey + fy * 24 + ry * side + uy * up_;
  mz = ez + fz * 24 + rz * side + uz * up_;
  SUSPEND;
END^

-- Weapon_* think: fire if the button is held, the weapon is ready and there is ammo
CREATE OR ALTER PROCEDURE player_fire (btn SMALLINT)
AS
DECLARE pe INTEGER; DECLARE w INTEGER; DECLARE af DOUBLE PRECISION; DECLARE t DOUBLE PRECISION;
DECLARE mx DOUBLE PRECISION; DECLARE my DOUBLE PRECISION; DECLARE mz DOUBLE PRECISION;
DECLARE fx_ DOUBLE PRECISION; DECLARE fy DOUBLE PRECISION; DECLARE fz DOUBLE PRECISION;
DECLARE rx DOUBLE PRECISION; DECLARE ry DOUBLE PRECISION; DECLARE rz DOUBLE PRECISION;
DECLARE ammo INTEGER; DECLARE ak SMALLINT; DECLARE need INTEGER; DECLARE ws SMALLINT; DECLARE spin DOUBLE PRECISION; DECLARE shots INTEGER; DECLARE i INTEGER;
DECLARE quad DOUBLE PRECISION; DECLARE sil INTEGER; DECLARE vol DOUBLE PRECISION; DECLARE kick DOUBLE PRECISION;
DECLARE yaw DOUBLE PRECISION; DECLARE gt DOUBLE PRECISION; DECLARE spd DOUBLE PRECISION; DECLARE ux DOUBLE PRECISION; DECLARE uy DOUBLE PRECISION; DECLARE uz DOUBLE PRECISION;
DECLARE ex DOUBLE PRECISION; DECLARE ey DOUBLE PRECISION; DECLARE ez DOUBLE PRECISION;
DECLARE fl_x DOUBLE PRECISION; DECLARE fl_y DOUBLE PRECISION; DECLARE fl_z DOUBLE PRECISION; DECLARE fl_yaw DOUBLE PRECISION;
BEGIN
  SELECT p.ent_id, p.weapon, p.attack_finished, p.quad_finished, p.silencer_shots, p.chaingun_spin, p.grenade_time
    FROM player p WHERE p.id = 1 INTO pe, w, af, quad, sil, spin, gt;
  t = now_();
  vol = IIF(sil > 0, 0.2e0, 1);

  -- a lit hand grenade is thrown when the button is released (or after 3 seconds)
  IF (gt > 0 AND (btn = 0 OR t - gt >= 3)) THEN
  BEGIN
    EXECUTE PROCEDURE muzzle(8, -8) RETURNING_VALUES mx, my, mz, fx_, fy, fz, rx, ry, rz;
    spd = MINVALUE(800, 400 + (t - gt) * 300);
    EXECUTE PROCEDURE launch_grenade(pe, mx, my, mz, fx_ * spd, fy * spd, fz * spd + 200, 125, 165, MAXVALUE(0.1e0, 3 - (t - gt)), 1);
    EXECUTE PROCEDURE snd(pe, 1, 'weapons/hgrent1a.wav', vol, 1);
    UPDATE player p SET p.grenade_time = 0, p.grenades = p.grenades - 1, p.attack_finished = :t + 1, p.attack_start = :t WHERE p.id = 1;
    IF (ammo_count(3) <= 0) THEN UPDATE player p SET p.weapons = BIN_AND(p.weapons, BIN_NOT(32)), p.weapon = best_weapon() WHERE p.id = 1;
    EXIT;
  END

  IF (btn = 0) THEN
  BEGIN
    -- the chain gun winds down
    IF (w = 16 AND spin > 0) THEN
    BEGIN
      EXECUTE PROCEDURE snd(pe, 1, 'weapons/chngnd1a.wav', vol, 1);
      UPDATE player p SET p.chaingun_spin = 0 WHERE p.id = 1;
    END
    UPDATE player p SET p.weapon_sound = 0, p.machinegun_shots = 0 WHERE p.id = 1 AND (p.weapon_sound <> 0 OR p.machinegun_shots <> 0);
    EXIT;
  END
  IF (af > t OR w = 0) THEN EXIT;
  IF (gt > 0) THEN EXIT;   -- still holding the grenade

  -- ammo
  ak = weapon_ammo(w);
  need = CASE w WHEN 4 THEN 2 WHEN 1024 THEN 50 ELSE 1 END;
  IF (ak > 0 AND ammo_count(ak) < need) THEN
  BEGIN
    IF (EXISTS (SELECT 1 FROM player p WHERE p.id = 1 AND p.pain_finished < :t)) THEN
    BEGIN
      EXECUTE PROCEDURE snd(pe, 1, 'weapons/noammo.wav', 1, 1);
      UPDATE player p SET p.pain_finished = :t + 1 WHERE p.id = 1;
    END
    UPDATE player p SET p.weapon = best_weapon(), p.attack_finished = :t + 0.5e0 WHERE p.id = 1;
    EXIT;
  END
  UPDATE player p SET p.show_hostile = :t + 1, p.attack_start = :t, p.silencer_shots = MAXVALUE(0, p.silencer_shots - 1) WHERE p.id = 1;
  -- the muzzle flash (MZ_*): CL_ParseMuzzleFlash lit 200 + 0..31 units (100 + 0..31 silenced) for a frame, 18 ahead of
  -- the player and 16 to the right; pulling a hand grenade's pin makes none
  IF (w <> 32) THEN
  BEGIN
    SELECT e.x, e.y, e.z, e.yaw FROM ents e WHERE e.id = :pe INTO fl_x, fl_y, fl_z, fl_yaw;
    fl_yaw = fl_yaw * 0.0174532925e0;
    EXECUTE PROCEDURE fx(15, fl_x + COS(fl_yaw) * 18 + SIN(fl_yaw) * 16, fl_y + SIN(fl_yaw) * 18 - COS(fl_yaw) * 16, fl_z, 0, 0, 0,
      IIF(sil > 0, 100, 200) + CAST(FLOOR(rnd() * 32) AS INTEGER));
  END

  IF (w = 1) THEN                                                        -- blaster
  BEGIN
    EXECUTE PROCEDURE muzzle(8, -8) RETURNING_VALUES mx, my, mz, fx_, fy, fz, rx, ry, rz;
    EXECUTE PROCEDURE launch_bolt(pe, mx, my, mz, fx_, fy, fz, 1000, 15, 8);
    EXECUTE PROCEDURE check_dodge(pe, mx, my, mz, fx_, fy, fz, 1000);
    EXECUTE PROCEDURE snd(pe, 1, 'weapons/blastf1a.wav', vol, 1);
    UPDATE player p SET p.attack_finished = :t + 0.5e0, p.punchangle = -1 WHERE p.id = 1;
  END
  ELSE IF (w = 2) THEN                                                   -- shotgun
  BEGIN
    EXECUTE PROCEDURE muzzle(8, -8) RETURNING_VALUES mx, my, mz, fx_, fy, fz, rx, ry, rz;
    EXECUTE PROCEDURE fire_bullets(pe, 12, mx, my, mz, fx_, fy, fz, 500, 500, 4, 8);
    EXECUTE PROCEDURE snd(pe, 1, 'weapons/shotgf1b.wav', vol, 1);
    UPDATE player p SET p.attack_finished = :t + 1, p.shells = p.shells - 1, p.punchangle = -2 WHERE p.id = 1;
  END
  ELSE IF (w = 4) THEN                                                   -- super shotgun: two volleys, 5 degrees apart
  BEGIN
    EXECUTE PROCEDURE muzzle(8, -8) RETURNING_VALUES mx, my, mz, fx_, fy, fz, rx, ry, rz;
    SELECT e.yaw FROM ents e WHERE e.id = :pe INTO yaw;
    EXECUTE PROCEDURE fire_bullets(pe, 10, mx, my, mz, fx_ * COS(-5 * 0.0174532925e0) - fy * SIN(-5 * 0.0174532925e0), fx_ * SIN(-5 * 0.0174532925e0) + fy * COS(-5 * 0.0174532925e0), fz, 1000, 500, 6, 12);
    EXECUTE PROCEDURE fire_bullets(pe, 10, mx, my, mz, fx_ * COS(5 * 0.0174532925e0) - fy * SIN(5 * 0.0174532925e0), fx_ * SIN(5 * 0.0174532925e0) + fy * COS(5 * 0.0174532925e0), fz, 1000, 500, 6, 12);
    EXECUTE PROCEDURE snd(pe, 1, 'weapons/sshotf1b.wav', vol, 1);
    UPDATE player p SET p.attack_finished = :t + 1, p.shells = p.shells - 2, p.punchangle = -4 WHERE p.id = 1;
  END
  ELSE IF (w = 8) THEN                                                   -- machinegun: the kick climbs while the trigger is held
  BEGIN
    SELECT p.machinegun_shots FROM player p WHERE p.id = 1 INTO shots;
    EXECUTE PROCEDURE muzzle(8, -8) RETURNING_VALUES mx, my, mz, fx_, fy, fz, rx, ry, rz;
    EXECUTE PROCEDURE fire_bullets(pe, 1, mx, my, mz, fx_ + crand() * 0.01e0 * shots, fy + crand() * 0.01e0 * shots, fz + 0.005e0 * shots, 300, 500, 8, 2);
    EXECUTE PROCEDURE snd(pe, 1, 'weapons/machgf' || CAST(1 + FLOOR(rnd() * 5) AS INTEGER) || 'b.wav', vol, 1);
    UPDATE player p SET p.attack_finished = :t + 0.1e0, p.bullets = p.bullets - 1, p.punchangle = -0.5e0 - 0.5e0 * rnd(), p.machinegun_shots = MINVALUE(9, p.machinegun_shots + 1) WHERE p.id = 1;
  END
  ELSE IF (w = 16) THEN                                                  -- chaingun: spins up to three barrels a tic
  BEGIN
    IF (spin = 0) THEN BEGIN EXECUTE PROCEDURE snd(pe, 1, 'weapons/chngnu1a.wav', vol, 1); spin = t; END
    shots = IIF(t - spin < 0.6e0, 1, IIF(t - spin < 1.2e0, 2, 3));
    shots = MINVALUE(shots, ammo_count(2));
    EXECUTE PROCEDURE muzzle(8, -8) RETURNING_VALUES mx, my, mz, fx_, fy, fz, rx, ry, rz;
    i = 0;
    WHILE (i < shots) DO
    BEGIN
      EXECUTE PROCEDURE fire_bullets(pe, 1, mx + rx * (i - 1) * 4, my + ry * (i - 1) * 4, mz, fx_, fy, fz, 300, 500, 6, 2);
      i = i + 1;
    END
    IF (shots > 0) THEN EXECUTE PROCEDURE snd(pe, 1, 'weapons/machgf' || CAST(1 + FLOOR(rnd() * 5) AS INTEGER) || 'b.wav', vol, 1);
    UPDATE player p SET p.attack_finished = :t + 0.1e0, p.bullets = p.bullets - :shots, p.punchangle = -0.5e0 * :shots, p.chaingun_spin = :spin, p.weapon_sound = 2 WHERE p.id = 1;
  END
  ELSE IF (w = 32) THEN                                                  -- hand grenade: pull the pin; thrown on release
  BEGIN
    EXECUTE PROCEDURE snd(pe, 1, 'weapons/hgrena1b.wav', vol, 1);
    UPDATE player p SET p.grenade_time = :t WHERE p.id = 1;
  END
  ELSE IF (w = 64) THEN                                                  -- grenade launcher
  BEGIN
    EXECUTE PROCEDURE muzzle(8, -8) RETURNING_VALUES mx, my, mz, fx_, fy, fz, rx, ry, rz;
    EXECUTE PROCEDURE launch_grenade(pe, mx, my, mz, fx_ * 600, fy * 600, fz * 600 + 200, 120, 160, 2.5e0, 0);
    EXECUTE PROCEDURE snd(pe, 1, 'weapons/grenlf1a.wav', vol, 1);
    UPDATE player p SET p.attack_finished = :t + 1, p.grenades = p.grenades - 1, p.punchangle = -1 WHERE p.id = 1;
  END
  ELSE IF (w = 128) THEN                                                 -- rocket launcher
  BEGIN
    EXECUTE PROCEDURE muzzle(8, -8) RETURNING_VALUES mx, my, mz, fx_, fy, fz, rx, ry, rz;
    EXECUTE PROCEDURE launch_rocket(pe, mx, my, mz, fx_, fy, fz, 650, 100 + FLOOR(rnd() * 20), 120, 120);
    EXECUTE PROCEDURE check_dodge(pe, mx, my, mz, fx_, fy, fz, 650);
    EXECUTE PROCEDURE snd(pe, 1, 'weapons/rocklf1a.wav', vol, 1);
    UPDATE player p SET p.attack_finished = :t + 0.8e0, p.rockets = p.rockets - 1, p.punchangle = -2 WHERE p.id = 1;
  END
  ELSE IF (w = 256) THEN                                                 -- hyperblaster: bolts from a spinning muzzle
  BEGIN
    SELECT p.weapon_sound FROM player p WHERE p.id = 1 INTO ws;
    EXECUTE PROCEDURE muzzle(8 + 4 * COS(t * 25), -8 + 4 * SIN(t * 25)) RETURNING_VALUES mx, my, mz, fx_, fy, fz, rx, ry, rz;
    EXECUTE PROCEDURE launch_bolt(pe, mx, my, mz, fx_, fy, fz, 1000, 15, 64);
    EXECUTE PROCEDURE check_dodge(pe, mx, my, mz, fx_, fy, fz, 1000);
    IF (ws = 0) THEN EXECUTE PROCEDURE snd(pe, 1, 'weapons/hyprbf1a.wav', vol, 1);
    UPDATE player p SET p.attack_finished = :t + 0.1e0, p.cells = p.cells - 1, p.punchangle = -1, p.weapon_sound = 1 WHERE p.id = 1;
  END
  ELSE IF (w = 512) THEN                                                 -- railgun
  BEGIN
    EXECUTE PROCEDURE muzzle(8, -8) RETURNING_VALUES mx, my, mz, fx_, fy, fz, rx, ry, rz;
    EXECUTE PROCEDURE fire_rail(pe, mx, my, mz, fx_, fy, fz, 150, 250);
    EXECUTE PROCEDURE snd(pe, 1, 'weapons/railgf1a.wav', vol, 1);
    UPDATE player p SET p.attack_finished = :t + 1.5e0, p.slugs = p.slugs - 1, p.punchangle = -3 WHERE p.id = 1;
  END
  ELSE IF (w = 1024) THEN                                                -- BFG10K
  BEGIN
    EXECUTE PROCEDURE muzzle(8, -8) RETURNING_VALUES mx, my, mz, fx_, fy, fz, rx, ry, rz;
    EXECUTE PROCEDURE launch_bfg(pe, mx, my, mz, fx_, fy, fz, 400, 500, 1000);
    EXECUTE PROCEDURE check_dodge(pe, mx, my, mz, fx_, fy, fz, 400);
    EXECUTE PROCEDURE snd(pe, 1, 'weapons/bfg__f1y.wav', vol, 1);
    UPDATE player p SET p.attack_finished = :t + 1.5e0, p.cells = p.cells - 50, p.punchangle = -5 WHERE p.id = 1;
  END
  IF (quad > t) THEN EXECUTE PROCEDURE snd(pe, 3, 'items/damage3.wav', 1, 1);
  -- out of ammo for this weapon now: switch after this shot
  IF (ak > 0 AND ammo_count(ak) < need AND w NOT IN (32)) THEN
    UPDATE player p SET p.weapon = best_weapon() WHERE p.id = 1;
END^

-- "use <weapon>" for a key 1..0, cycling, and the cheats
CREATE OR ALTER PROCEDURE player_impulse (imp SMALLINT)
AS
DECLARE have INTEGER; DECLARE w INTEGER; DECLARE i INTEGER; DECLARE ak SMALLINT; DECLARE cur INTEGER; DECLARE n INTEGER;
DECLARE wname VARCHAR(20); DECLARE aname VARCHAR(10);
BEGIN
  SELECT p.weapons, p.weapon FROM player p WHERE p.id = 1 INTO have, w;
  cur = w;
  IF (imp = 99) THEN                                                     -- give all
  BEGIN
    UPDATE player p SET p.weapons = 2047, p.bullets = p.max_bullets, p.shells = p.max_shells, p.rockets = p.max_rockets, p.grenades = p.max_grenades,
           p.cells = p.max_cells, p.slugs = p.max_slugs, p.armor = 200, p.armor_type = 3, p.keys = 511,
           p.inv_shield = p.inv_shield + 1, p.inv_sel = 6, p.inv_quad = 1, p.inv_invuln = 1, p.inv_silencer = 1, p.inv_breather = 1, p.inv_enviro = 1 WHERE p.id = 1;
    UPDATE ents e SET e.health = e.max_health WHERE e.id = player_ent();
    EXECUTE PROCEDURE sprint('Very impressive');
    EXIT;
  END
  -- the impulses are the weapons in item order (1 blaster … 6 hand grenades … 11 BFG10K); the page maps
  -- default.cfg's keys onto them: 1-5, 6 grenade launcher … 0 BFG10K, G "use grenades"
  IF (imp = 12) THEN
  BEGIN
    -- Cmd_WeapNext: the next weapon held, in item order, that Use_Weapon accepts (one with the ammo for a
    -- shot; hand grenades are their own ammo). (Quake 2 also printed the refusals it passed over.)
    i = 0;
    cur = w;
    WHILE (i < 11) DO
    BEGIN
      w = IIF(w >= 1024 OR w < 1, 1, w * 2);
      IF (w = cur) THEN EXIT;
      IF (BIN_AND(have, w) <> 0) THEN
      BEGIN
        ak = weapon_ammo(w);
        IF (w = 32 OR ak = 0 OR ammo_count(ak) >= IIF(w = 4, 2, IIF(w = 1024, 50, 1))) THEN LEAVE;
      END
      i = i + 1;
    END
    IF (i >= 11) THEN EXIT;
  END
  ELSE
  BEGIN
    -- Cmd_Use_f: a weapon not held is "out of item"; Use_Weapon: one already up does nothing, and one
    -- without the ammo for a shot is refused with the ammo's name
    w = CASE imp WHEN 1 THEN 1 WHEN 2 THEN 2 WHEN 3 THEN 4 WHEN 4 THEN 8 WHEN 5 THEN 16 WHEN 6 THEN 32 WHEN 7 THEN 64 WHEN 8 THEN 128 WHEN 9 THEN 256 WHEN 10 THEN 512 WHEN 11 THEN 1024 ELSE 0 END;
    IF (w = 0) THEN EXIT;
    wname = TRIM(CASE w WHEN 1 THEN 'Blaster' WHEN 2 THEN 'Shotgun' WHEN 4 THEN 'Super Shotgun' WHEN 8 THEN 'Machinegun' WHEN 16 THEN 'Chaingun' WHEN 32 THEN 'Grenades'
                 WHEN 64 THEN 'Grenade Launcher' WHEN 128 THEN 'Rocket Launcher' WHEN 256 THEN 'HyperBlaster' WHEN 512 THEN 'Railgun' ELSE 'BFG10K' END);
    IF (BIN_AND(have, w) = 0) THEN
    BEGIN
      EXECUTE PROCEDURE sprint('Out of item: ' || IIF(w = 32, 'grenades', wname));
      EXIT;
    END
    IF (w = cur) THEN EXIT;
    ak = weapon_ammo(w);
    IF (ak > 0 AND w <> 32) THEN
    BEGIN
      n = ammo_count(ak);
      aname = TRIM(CASE ak WHEN 1 THEN 'Shells' WHEN 2 THEN 'Bullets' WHEN 3 THEN 'Grenades' WHEN 4 THEN 'Rockets' WHEN 5 THEN 'Cells' ELSE 'Slugs' END);
      IF (n <= 0) THEN BEGIN EXECUTE PROCEDURE sprint('No ' || aname || ' for ' || wname || '.'); EXIT; END
      IF (n < IIF(w = 4, 2, IIF(w = 1024, 50, 1))) THEN BEGIN EXECUTE PROCEDURE sprint('Not enough ' || aname || ' for ' || wname || '.'); EXIT; END
    END
  END
  UPDATE player p SET p.weapon = :w, p.grenade_time = 0, p.chaingun_spin = 0, p.weapon_sound = 0, p.attack_finished = MAXVALUE(p.attack_finished, now_() + 0.3e0) WHERE p.id = 1;
END^

-- Cmd_Use_f for one item (idx, the itemlist index; typed, the name as asked for), then the item's use function
CREATE OR ALTER PROCEDURE use_item (idx SMALLINT, typed VARCHAR(40))
AS
DECLARE n INTEGER; DECLARE pa SMALLINT; DECLARE ce INTEGER; DECLARE pe INTEGER; DECLARE t DOUBLE PRECISION; DECLARE u SMALLINT;
BEGIN
  IF (idx IS NULL OR idx <= 0) THEN BEGIN EXECUTE PROCEDURE sprint('unknown item: ' || typed); EXIT; END
  u = item_usable(idx);
  IF (u = 0) THEN BEGIN EXECUTE PROCEDURE sprint('Item is not usable.'); EXIT; END
  n = inv_count(idx);
  IF (n <= 0) THEN BEGIN EXECUTE PROCEDURE sprint('Out of item: ' || typed); EXIT; END
  t = now_(); pe = player_ent();
  IF (idx BETWEEN 7 AND 17) THEN EXECUTE PROCEDURE player_impulse(idx - 6);       -- Use_Weapon
  ELSE IF (idx IN (5, 6)) THEN
  BEGIN
    -- Use_PowerArmor: on and off; on only with cells
    SELECT p.power_armor, p.cells FROM player p WHERE p.id = 1 INTO pa, ce;
    IF (pa = 1) THEN
    BEGIN
      UPDATE player p SET p.power_armor = 0 WHERE p.id = 1;
      EXECUTE PROCEDURE snd(pe, 0, 'misc/power2.wav', 1, 1);
    END
    ELSE IF (ce <= 0) THEN EXECUTE PROCEDURE sprint('No cells for power armor.');
    ELSE
    BEGIN
      UPDATE player p SET p.power_armor = 1 WHERE p.id = 1;
      EXECUTE PROCEDURE snd(pe, 0, 'misc/power1.wav', 1, 1);
    END
  END
  ELSE
  BEGIN
    -- Use_Quad, Use_Invulnerability, Use_Silencer, Use_Breather, Use_Envirosuit: one less in the inventory, thirty
    -- seconds more (or thirty silenced shots)
    UPDATE player p SET
      p.inv_quad = p.inv_quad - IIF(:idx = 23, 1, 0), p.inv_invuln = p.inv_invuln - IIF(:idx = 24, 1, 0),
      p.inv_silencer = p.inv_silencer - IIF(:idx = 25, 1, 0), p.inv_breather = p.inv_breather - IIF(:idx = 26, 1, 0),
      p.inv_enviro = p.inv_enviro - IIF(:idx = 27, 1, 0),
      p.quad_finished = IIF(:idx = 23, IIF(p.quad_finished > :t, p.quad_finished, :t) + 30, p.quad_finished),
      p.invincible_finished = IIF(:idx = 24, IIF(p.invincible_finished > :t, p.invincible_finished, :t) + 30, p.invincible_finished),
      p.silencer_shots = p.silencer_shots + IIF(:idx = 25, 30, 0),
      p.breather_finished = IIF(:idx = 26, IIF(p.breather_finished > :t, p.breather_finished, :t) + 30, p.breather_finished),
      p.enviro_finished = IIF(:idx = 27, IIF(p.enviro_finished > :t, p.enviro_finished, :t) + 30, p.enviro_finished)
     WHERE p.id = 1;
    EXECUTE PROCEDURE inv_validate;
    IF (idx = 23) THEN EXECUTE PROCEDURE snd(pe, 3, 'items/damage.wav', 1, 1);
    IF (idx = 24) THEN EXECUTE PROCEDURE snd(pe, 3, 'items/protect.wav', 1, 1);
  END
END^

-- the inventory's impulses: 13 invuse, 14 invnext, 15 invprev, and default.cfg's item keys: 16 "use quad damage",
-- 17 "use invulnerability", 18 "use silencer", 19 "use rebreather", 20 "use environment suit", 21 "use power shield"
CREATE OR ALTER PROCEDURE inv_impulse (imp SMALLINT)
AS
DECLARE sel SMALLINT;
BEGIN
  IF (imp = 13) THEN
  BEGIN
    -- Cmd_InvUse_f
    EXECUTE PROCEDURE inv_validate;
    SELECT p.inv_sel FROM player p WHERE p.id = 1 INTO sel;
    IF (sel < 0) THEN EXECUTE PROCEDURE sprint('No item to use.');
    ELSE EXECUTE PROCEDURE use_item(sel, item_name(sel));
  END
  ELSE IF (imp = 14) THEN EXECUTE PROCEDURE inv_select(1);
  ELSE IF (imp = 15) THEN EXECUTE PROCEDURE inv_select(-1);
  ELSE IF (imp BETWEEN 16 AND 21) THEN
    EXECUTE PROCEDURE use_item(CASE imp WHEN 16 THEN 23 WHEN 17 THEN 24 WHEN 18 THEN 25 WHEN 19 THEN 26 WHEN 20 THEN 27 ELSE 6 END,
      TRIM(CASE imp WHEN 16 THEN 'quad damage' WHEN 17 THEN 'invulnerability' WHEN 18 THEN 'silencer' WHEN 19 THEN 'rebreather'
                    WHEN 20 THEN 'environment suit' ELSE 'power shield' END));
END^

-- Cmd_Drop_f and the itemlist's drop functions. Ammo drops a pickup's worth or what is left (Drop_Ammo; not the
-- last grenades while they are in hand); a weapon but not the one in hand (Drop_Weapon; the blaster has no drop);
-- powerups as they are (Drop_General); power armour switches off when the last one goes (Drop_PowerArmor).
-- Drop_Item: the item 24 ahead of and 16 below the origin along the view (as far as a trace lets it), tossed at
-- 100 forward and 300 up, glowing, DROPPED_ITEM; its dropper cannot take it back for a second (drop_temp_touch).
CREATE OR ALTER PROCEDURE drop_cmd (typed VARCHAR(64))
AS
DECLARE idx SMALLINT; DECLARE n INTEGER; DECLARE cnt INTEGER; DECLARE w INTEGER; DECLARE cur INTEGER; DECLARE pa SMALLINT;
DECLARE pe INTEGER; DECLARE cls VARCHAR(40); DECLARE it INTEGER;
DECLARE ox DOUBLE PRECISION; DECLARE oy DOUBLE PRECISION; DECLARE oz DOUBLE PRECISION;
DECLARE ex DOUBLE PRECISION; DECLARE ey DOUBLE PRECISION; DECLARE ez DOUBLE PRECISION; DECLARE fx_ DOUBLE PRECISION; DECLARE fy DOUBLE PRECISION; DECLARE fz DOUBLE PRECISION;
DECLARE rx DOUBLE PRECISION; DECLARE ry DOUBLE PRECISION; DECLARE rz DOUBLE PRECISION; DECLARE ux DOUBLE PRECISION; DECLARE uy DOUBLE PRECISION; DECLARE uz DOUBLE PRECISION;
DECLARE f DOUBLE PRECISION; DECLARE hx DOUBLE PRECISION; DECLARE hy DOUBLE PRECISION; DECLARE hz DOUBLE PRECISION; DECLARE nx DOUBLE PRECISION; DECLARE ny DOUBLE PRECISION; DECLARE nz DOUBLE PRECISION;
DECLARE sf INTEGER; DECLARE ct INTEGER; DECLARE als SMALLINT; DECLARE sts SMALLINT; DECLARE hit INTEGER;
BEGIN
  idx = item_index(typed);
  IF (idx = 0) THEN BEGIN EXECUTE PROCEDURE sprint('unknown item: ' || typed); EXIT; END
  IF (NOT (idx IN (5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27))) THEN
  BEGIN EXECUTE PROCEDURE sprint('Item is not dropable.'); EXIT; END
  n = inv_count(idx);
  IF (n <= 0) THEN BEGIN EXECUTE PROCEDURE sprint('Out of item: ' || typed); EXIT; END
  SELECT p.weapon, p.power_armor FROM player p WHERE p.id = 1 INTO cur, pa;
  cnt = 0;
  IF (idx IN (12, 18, 19, 20, 21, 22)) THEN
  BEGIN
    cnt = MINVALUE(n, CASE idx WHEN 12 THEN 5 WHEN 18 THEN 10 WHEN 19 THEN 50 WHEN 20 THEN 50 WHEN 21 THEN 5 ELSE 10 END);
    IF (idx = 12 AND cur = 32 AND n - cnt <= 0) THEN BEGIN EXECUTE PROCEDURE sprint('Can''t drop current weapon'); EXIT; END
    UPDATE player p SET p.grenades = p.grenades - IIF(:idx = 12, :cnt, 0), p.shells = p.shells - IIF(:idx = 18, :cnt, 0),
           p.bullets = p.bullets - IIF(:idx = 19, :cnt, 0), p.cells = p.cells - IIF(:idx = 20, :cnt, 0),
           p.rockets = p.rockets - IIF(:idx = 21, :cnt, 0), p.slugs = p.slugs - IIF(:idx = 22, :cnt, 0) WHERE p.id = 1;
  END
  ELSE IF (idx BETWEEN 8 AND 17) THEN
  BEGIN
    w = CASE idx WHEN 8 THEN 2 WHEN 9 THEN 4 WHEN 10 THEN 8 WHEN 11 THEN 16 WHEN 13 THEN 64 WHEN 14 THEN 128 WHEN 15 THEN 256 WHEN 16 THEN 512 ELSE 1024 END;
    IF (cur = w) THEN BEGIN EXECUTE PROCEDURE sprint('Can''t drop current weapon'); EXIT; END
    UPDATE player p SET p.weapons = BIN_AND(p.weapons, BIN_NOT(:w)) WHERE p.id = 1;
  END
  ELSE
  BEGIN
    IF (idx IN (5, 6) AND pa = 1 AND n = 1) THEN
    BEGIN
      UPDATE player p SET p.power_armor = 0 WHERE p.id = 1;
      EXECUTE PROCEDURE snd(player_ent(), 0, 'misc/power2.wav', 1, 1);
    END
    UPDATE player p SET p.inv_screen = p.inv_screen - IIF(:idx = 5, 1, 0), p.inv_shield = p.inv_shield - IIF(:idx = 6, 1, 0),
           p.inv_quad = p.inv_quad - IIF(:idx = 23, 1, 0), p.inv_invuln = p.inv_invuln - IIF(:idx = 24, 1, 0),
           p.inv_silencer = p.inv_silencer - IIF(:idx = 25, 1, 0), p.inv_breather = p.inv_breather - IIF(:idx = 26, 1, 0),
           p.inv_enviro = p.inv_enviro - IIF(:idx = 27, 1, 0) WHERE p.id = 1;
    EXECUTE PROCEDURE inv_validate;
  END
  -- Drop_Item
  pe = player_ent();
  cls = item_classname(idx);
  SELECT e.x, e.y, e.z FROM ents e WHERE e.id = :pe INTO ox, oy, oz;
  EXECUTE PROCEDURE view_vectors RETURNING_VALUES ex, ey, ez, fx_, fy, fz, rx, ry, rz, ux, uy, uz;
  EXECUTE PROCEDURE trace_move(pe, -15, -15, -15, 15, 15, 15, ox, oy, oz, ox + fx_ * 24, oy + fy * 24, oz + fz * 24 - 16, 1)
    RETURNING_VALUES f, hx, hy, hz, nx, ny, nz, sf, ct, als, sts, hit;
  EXECUTE PROCEDURE spawn_ent(cls, hx, hy, hz) RETURNING_VALUES it;
  EXECUTE PROCEDURE set_model(it, item_model(cls));
  UPDATE ents e SET e.solid = 1, e.movetype = 6, e.clipmask = 3, e.effects = 1, e.renderfx = 4, e.spawnflags = 65536, e.owner_id = :pe,
         e.count_ = :cnt, e.minx = -15, e.miny = -15, e.minz = -15, e.maxx = 15, e.maxy = 15, e.maxz = 15,
         e.vx = :fx_ * 100, e.vy = :fy * 100, e.vz = 300, e.think = 'drop_touchable', e.nextthink = now_() + 1 WHERE e.id = :it;
  EXECUTE PROCEDURE link_ent(it);
END^

-- ClientThink + Pmove + ClientEndServerFrame for one tic
-- The console's commands and cheats (g_cmds.c: Cmd_God_f, Cmd_Notarget_f, Cmd_Noclip_f, Cmd_Give_f,
-- Cmd_Kill_f). The answer goes to the top-left message line, as gi.cprintf did, and out.
CREATE OR ALTER PROCEDURE player_command (cmd VARCHAR(32), arg VARCHAR(64))
RETURNS (msg VARCHAR(80))
AS
DECLARE pe INTEGER; DECLARE fl INTEGER; DECLARE mt SMALLINT; DECLARE hp INTEGER;
DECLARE sp INTEGER; DECLARE a1 VARCHAR(64); DECLARE a2 VARCHAR(64); DECLARE num INTEGER; DECLARE idx SMALLINT; DECLARE it INTEGER;
DECLARE px DOUBLE PRECISION; DECLARE py DOUBLE PRECISION; DECLARE pz DOUBLE PRECISION;
BEGIN
  cmd = LOWER(TRIM(COALESCE(cmd, ''))); arg = LOWER(TRIM(COALESCE(arg, '')));
  pe = player_ent();
  SELECT e.flags, e.movetype, e.health FROM ents e WHERE e.id = :pe INTO fl, mt, hp;
  IF (hp IS NULL) THEN BEGIN msg = 'no player'; SUSPEND; EXIT; END
  msg = '';
  IF (cmd = 'god') THEN
  BEGIN
    UPDATE ents e SET e.flags = BIN_XOR(e.flags, 16) WHERE e.id = :pe;
    msg = TRIM(IIF(BIN_AND(fl, 16) = 0, 'godmode ON', 'godmode OFF'));   -- (IIF pads the shorter literal)
  END
  ELSE IF (cmd = 'notarget') THEN
  BEGIN
    UPDATE ents e SET e.flags = BIN_XOR(e.flags, 64) WHERE e.id = :pe;
    msg = TRIM(IIF(BIN_AND(fl, 64) = 0, 'notarget ON', 'notarget OFF'));
  END
  ELSE IF (cmd = 'noclip') THEN
  BEGIN
    UPDATE ents e SET e.movetype = IIF(:mt = 2, 3, 2), e.vx = 0, e.vy = 0, e.vz = 0 WHERE e.id = :pe;
    msg = TRIM(IIF(mt = 2, 'noclip OFF', 'noclip ON'));
  END
  ELSE IF (cmd = 'kill') THEN
  BEGIN
    -- suicide: godmode does not save you from it
    IF (hp > 0) THEN
    BEGIN
      UPDATE ents e SET e.flags = BIN_AND(e.flags, BIN_NOT(16)) WHERE e.id = :pe;
      EXECUTE PROCEDURE t_damage(pe, pe, pe, 100000, 0, 34);
    END
  END
  ELSE IF (cmd = 'give') THEN
  BEGIN
    -- Cmd_Give_f: all, or a kind of thing, or one item by its pickup name; a count after health or an ammo sets it
    IF (arg = '') THEN arg = 'all';
    sp = POSITION(' ' IN arg);
    a1 = IIF(sp > 0, SUBSTRING(arg FROM 1 FOR sp - 1), arg);
    a2 = IIF(sp > 0, TRIM(SUBSTRING(arg FROM sp + 1)), '');
    num = IIF(a2 SIMILAR TO '[0-9]{1,6}', CAST(a2 AS INTEGER), NULL);
    IF (a1 = 'health' AND num IS NOT NULL) THEN UPDATE ents e SET e.health = :num WHERE e.id = :pe;
    ELSE IF (arg NOT IN ('all', 'health', 'weapons', 'ammo', 'armor', 'keys')) THEN
    BEGIN
      -- FindItem on the whole line, else on its first word
      idx = item_index(arg);
      IF (idx = 0) THEN idx = item_index(a1);
      IF (idx = 0) THEN msg = 'unknown item';
      ELSE IF (idx IN (12, 18, 19, 20, 21, 22)) THEN
      BEGIN
        -- IT_AMMO: the count given, else one pickup's quantity on top, unclamped as Cmd_Give_f left it
        IF (idx = 12) THEN UPDATE player p SET p.grenades = COALESCE(:num, p.grenades + 5) WHERE p.id = 1;
        ELSE IF (idx = 18) THEN UPDATE player p SET p.shells = COALESCE(:num, p.shells + 10) WHERE p.id = 1;
        ELSE IF (idx = 19) THEN UPDATE player p SET p.bullets = COALESCE(:num, p.bullets + 50) WHERE p.id = 1;
        ELSE IF (idx = 20) THEN UPDATE player p SET p.cells = COALESCE(:num, p.cells + 50) WHERE p.id = 1;
        ELSE IF (idx = 21) THEN UPDATE player p SET p.rockets = COALESCE(:num, p.rockets + 5) WHERE p.id = 1;
        ELSE UPDATE player p SET p.slugs = COALESCE(:num, p.slugs + 10) WHERE p.id = 1;
      END
      ELSE
      BEGIN
        -- anything else is spawned on the player and touched (SpawnItem, Touch_Item); left over if not taken, then freed
        SELECT e.x, e.y, e.z FROM ents e WHERE e.id = :pe INTO px, py, pz;
        EXECUTE PROCEDURE spawn_ent(item_classname(idx), px, py, pz) RETURNING_VALUES it;
        EXECUTE PROCEDURE item_touch(it, pe);
        DELETE FROM ents e WHERE e.id = :it;
      END
    END
    ELSE
    BEGIN
      IF (arg IN ('all', 'health')) THEN UPDATE ents e SET e.health = e.max_health WHERE e.id = :pe AND e.health < e.max_health;
      IF (arg IN ('all', 'weapons')) THEN UPDATE player p SET p.weapons = 2047 WHERE p.id = 1;
      IF (arg IN ('all', 'ammo')) THEN UPDATE player p SET p.bullets = p.max_bullets, p.shells = p.max_shells, p.rockets = p.max_rockets,
             p.grenades = p.max_grenades, p.cells = p.max_cells, p.slugs = p.max_slugs WHERE p.id = 1;
      IF (arg IN ('all', 'armor')) THEN UPDATE player p SET p.armor = 200, p.armor_type = 3 WHERE p.id = 1;     -- body armor, full
      IF (arg IN ('all', 'keys')) THEN UPDATE player p SET p.keys = 511 WHERE p.id = 1;
      IF (arg = 'all') THEN
        UPDATE player p SET p.inv_shield = p.inv_shield + 1, p.inv_sel = 6, p.inv_quad = 1, p.inv_invuln = 1, p.inv_silencer = 1,
               p.inv_breather = 1, p.inv_enviro = 1 WHERE p.id = 1;
    END
  END
  ELSE IF (cmd = 'use') THEN EXECUTE PROCEDURE use_item(item_index(arg), arg);
  ELSE IF (cmd = 'drop') THEN EXECUTE PROCEDURE drop_cmd(arg);
  ELSE IF (cmd = 'invuse') THEN EXECUTE PROCEDURE inv_impulse(13);
  ELSE IF (cmd = 'invnext') THEN EXECUTE PROCEDURE inv_impulse(14);
  ELSE IF (cmd = 'invprev') THEN EXECUTE PROCEDURE inv_impulse(15);
  ELSE msg = 'unknown command "' || cmd || '"';
  IF (msg <> '') THEN EXECUTE PROCEDURE sprint(msg);
  SUSPEND;
END^

CREATE OR ALTER PROCEDURE player_think (dt DOUBLE PRECISION, fwd DOUBLE PRECISION, side DOUBLE PRECISION,
  yaw_d DOUBLE PRECISION, pitch_d DOUBLE PRECISION, fire SMALLINT, jump SMALLINT, run SMALLINT, imp SMALLINT)
AS
DECLARE pe INTEGER; DECLARE t DOUBLE PRECISION; DECLARE dead SMALLINT; DECLARE flags INTEGER; DECLARE wl SMALLINT; DECLARE wt INTEGER; DECLARE owl SMALLINT;
DECLARE yaw DOUBLE PRECISION; DECLARE pitch DOUBLE PRECISION;
DECLARE vx DOUBLE PRECISION; DECLARE vy DOUBLE PRECISION; DECLARE vz DOUBLE PRECISION;
DECLARE spd DOUBLE PRECISION; DECLARE ns DOUBLE PRECISION; DECLARE control DOUBLE PRECISION; DECLARE drop_ DOUBLE PRECISION;
DECLARE fx_ DOUBLE PRECISION; DECLARE fy DOUBLE PRECISION; DECLARE fz DOUBLE PRECISION;
DECLARE rx DOUBLE PRECISION; DECLARE ry DOUBLE PRECISION;
DECLARE wx DOUBLE PRECISION; DECLARE wy DOUBLE PRECISION; DECLARE wz DOUBLE PRECISION; DECLARE wspd DOUBLE PRECISION; DECLARE maxspd DOUBLE PRECISION;
DECLARE cur DOUBLE PRECISION; DECLARE add_ DOUBLE PRECISION; DECLARE acc DOUBLE PRECISION;
DECLARE jr SMALLINT; DECLARE onground SMALLINT;
DECLARE px DOUBLE PRECISION; DECLARE py DOUBLE PRECISION; DECLARE pz DOUBLE PRECISION;
DECLARE mnx DOUBLE PRECISION; DECLARE mny DOUBLE PRECISION; DECLARE mnz DOUBLE PRECISION;
DECLARE mxx DOUBLE PRECISION; DECLARE mxy DOUBLE PRECISION; DECLARE mxz DOUBLE PRECISION;
DECLARE tid INTEGER; DECLARE tcls VARCHAR(40); DECLARE tst SMALLINT; DECLARE tn VARCHAR(40); DECLARE thp INTEGER; DECLARE tsf INTEGER;
DECLARE tdm INTEGER; DECLARE tlt DOUBLE PRECISION;
DECLARE afin DOUBLE PRECISION; DECLARE hp INTEGER; DECLARE deadt DOUBLE PRECISION; DECLARE oldz DOUBLE PRECISION; DECLARE w INTEGER;
DECLARE enviro DOUBLE PRECISION; DECLARE breather DOUBLE PRECISION; DECLARE ndt DOUBLE PRECISION; DECLARE ddmg INTEGER; DECLARE mhp INTEGER;
DECLARE grav DOUBLE PRECISION;
DECLARE pducked SMALLINT; DECLARE ducked2 SMALLINT; DECLARE pbobtime DOUBLE PRECISION;
DECLARE dtf DOUBLE PRECISION; DECLARE dex DOUBLE PRECISION; DECLARE dey DOUBLE PRECISION; DECLARE dez DOUBLE PRECISION;
DECLARE dnx DOUBLE PRECISION; DECLARE dny DOUBLE PRECISION; DECLARE dnz DOUBLE PRECISION; DECLARE dsf INTEGER; DECLARE dct INTEGER;
DECLARE dals SMALLINT; DECLARE dsts SMALLINT; DECLARE dhit INTEGER;
DECLARE gvz DOUBLE PRECISION; DECLARE gflags INTEGER; DECLARE gsolid SMALLINT; DECLARE ghead INTEGER;
DECLARE wcx DOUBLE PRECISION; DECLARE wcy DOUBLE PRECISION; DECLARE wcz DOUBLE PRECISION; DECLARE oldx DOUBLE PRECISION; DECLARE oldy DOUBLE PRECISION;
DECLARE bvx DOUBLE PRECISION; DECLARE bvy DOUBLE PRECISION; DECLARE xys DOUBLE PRECISION; DECLARE bt DOUBLE PRECISION; DECLARE bts DOUBLE PRECISION;
DECLARE bfs DOUBLE PRECISION; DECLARE bobz DOUBLE PRECISION; DECLARE bobp DOUBLE PRECISION; DECLARE bobr DOUBLE PRECISION;
DECLARE noclip SMALLINT; DECLARE ppitch DOUBLE PRECISION; DECLARE pstepz DOUBLE PRECISION; DECLARE gtic INTEGER; DECLARE stepz2 DOUBLE PRECISION; DECLARE jr2 SMALLINT; DECLARE afin2 DOUBLE PRECISION; DECLARE ddmg2 INTEGER;
BEGIN
  -- (the player and ents rows are wide: what the think decides is written back once, at the end)
  SELECT p.ent_id, p.jump_released, p.air_finished, p.dead_time, p.weapon, p.enviro_finished, p.breather_finished, p.next_drown_time, p.drown_dmg, p.pitch, p.stepz,
         p.ducked, p.bobtime, p.water_x, p.water_y, p.water_z
    FROM player p WHERE p.id = 1 INTO pe, jr, afin, deadt, w, enviro, breather, ndt, ddmg, ppitch, pstepz, pducked, pbobtime, wcx, wcy, wcz;
  IF (pe IS NULL) THEN EXIT;
  SELECT e.deadflag, e.flags, e.waterlevel, e.watertype, e.yaw, e.health, e.z, e.max_health, e.x, e.y FROM ents e WHERE e.id = :pe
    INTO dead, flags, owl, wt, yaw, hp, oldz, mhp, oldx, oldy;
  t = now_();
  SELECT g.gravity, g.tic FROM game g WHERE g.id = 1 INTO grav, gtic;

  IF (dead = 1) THEN
  BEGIN
    -- the body falls; fire a second after dying is respawn(), which in single player brings up the load menu
    EXECUTE PROCEDURE toss_move(pe, dt);
    IF (t > deadt + 1 AND fire = 1) THEN
      UPDATE game g SET g.exit_kind = 3 WHERE g.id = 1;
    UPDATE player p SET p.bobtime = 0, p.bob_z = 0, p.bob_pitch = 0, p.bob_roll = 0, p.ducked = 0 WHERE p.id = 1 AND (p.bob_z <> 0 OR p.bob_pitch <> 0 OR p.bob_roll <> 0 OR p.ducked <> 0);
    EXIT;
  END

  -- view angles
  yaw = anglemod(yaw + yaw_d);
  pitch = MAXVALUE(-89, MINVALUE(89, ppitch + pitch_d));
  IF (imp BETWEEN 13 AND 21) THEN EXECUTE PROCEDURE inv_impulse(imp);
  ELSE IF (imp > 0) THEN EXECUTE PROCEDURE player_impulse(imp);

  -- P_WorldEffects: water, slime, lava, drowning
  -- (PM_CatagorizePosition's water level, worked out again wherever the player now is: moved by pmove, a
  -- plat or a teleporter. The link position can't say so: every move relinks.)
  IF (wcx = oldx AND wcy = oldy AND wcz = oldz) THEN wl = owl;
  ELSE BEGIN EXECUTE PROCEDURE check_water(pe) RETURNING_VALUES wl, wt; wcx = oldx; wcy = oldy; wcz = oldz; END
  IF (owl = 0 AND wl > 0) THEN
  BEGIN
    IF (BIN_AND(wt, 8) <> 0) THEN EXECUTE PROCEDURE snd(pe, 0, 'player/lava_in.wav', 1, 1);
    ELSE EXECUTE PROCEDURE snd(pe, 0, 'player/watr_in.wav', 1, 1);
    UPDATE ents e SET e.flags = BIN_OR(e.flags, 8) WHERE e.id = :pe;
  END
  ELSE IF (owl > 0 AND wl = 0) THEN
  BEGIN
    EXECUTE PROCEDURE snd(pe, 0, 'player/watr_out.wav', 1, 1);
    UPDATE ents e SET e.flags = BIN_AND(e.flags, BIN_NOT(8)) WHERE e.id = :pe;
  END
  IF (owl <> 3 AND wl = 3) THEN EXECUTE PROCEDURE snd(pe, 0, 'player/watr_un.wav', 1, 1);
  IF (owl = 3 AND wl <> 3) THEN
  BEGIN
    IF (afin < t) THEN EXECUTE PROCEDURE snd(pe, 2, 'player/gasp1.wav', 1, 1);     -- gasp for air
    ELSE IF (afin < t + 11) THEN EXECUTE PROCEDURE snd(pe, 2, 'player/gasp2.wav', 1, 1);
  END
  IF (wl = 3) THEN
  BEGIN
    IF (breather > t) THEN
      UPDATE player p SET p.air_finished = :t + 10 WHERE p.id = 1;
    ELSE IF (afin < t)
    THEN BEGIN
      -- drown: the damage climbs 2 points a second, up to 15
      IF (ndt < t) THEN
      BEGIN
        ddmg = MINVALUE(15, ddmg + 2);
        UPDATE player p SET p.next_drown_time = :t + 1, p.drown_dmg = :ddmg WHERE p.id = 1;
        EXECUTE PROCEDURE snd(pe, 2, IIF(hp <= ddmg, 'player/drown1.wav', 'player/male/gurp' || CAST(1 + FLOOR(rnd() * 2) AS INTEGER) || '.wav'), 1, 1);
        EXECUTE PROCEDURE t_damage(pe, 0, 0, ddmg, 0, 2 + 32);
      END
    END
  END
  ELSE BEGIN afin2 = t + 12; ddmg2 = 2; END
  IF (wl > 0 AND BIN_AND(wt, 24) <> 0 AND enviro < t) THEN
  BEGIN
    SELECT p.dmg_lava_time FROM player p WHERE p.id = 1 INTO tlt;
    IF (tlt < t) THEN
    BEGIN
      UPDATE player p SET p.dmg_lava_time = :t + 0.1e0 WHERE p.id = 1;
      IF (BIN_AND(wt, 8) <> 0) THEN
      BEGIN
        IF (rnd() < 0.1e0) THEN EXECUTE PROCEDURE snd(pe, 2, 'player/burn' || CAST(1 + FLOOR(rnd() * 2) AS INTEGER) || '.wav', 1, 1);
        EXECUTE PROCEDURE t_damage(pe, 0, 0, 3 * wl, 0, 2 + 32);
      END
      ELSE EXECUTE PROCEDURE t_damage(pe, 0, 0, 1 * wl, 0, 2 + 32);
    END
  END

  SELECT e.vx, e.vy, e.vz, e.flags, IIF(e.movetype = 2, 1, 0) FROM ents e WHERE e.id = :pe INTO vx, vy, vz, flags, noclip;
  onground = IIF(BIN_AND(flags, 512) <> 0, 1, 0);
  -- (PM_CatagorizePosition: going up faster than 180, a blast's knockback, leaves the ground)
  IF (onground = 1 AND vz > 180) THEN BEGIN onground = 0; flags = BIN_AND(flags, BIN_NOT(512)); END
  maxspd = IIF(run = 1, 300, 200);

  -- PM_CheckDuck: crouching (jump < 0, Quake's negative upmove) on the ground ducks; a ducked player stands
  -- up again only where the full box fits. Ducked, the box is 4 high, the eye at -2, the speed 100.
  IF (jump < 0 AND onground = 1 AND noclip = 0) THEN ducked2 = 1;
  ELSE IF (pducked = 1) THEN
  BEGIN
    SELECT e.x, e.y, e.z FROM ents e WHERE e.id = :pe INTO px, py, pz;
    EXECUTE PROCEDURE trace_move(pe, -16, -16, -24, 16, 16, 32, px, py, pz, px, py, pz, 33619971)
      RETURNING_VALUES dtf, dex, dey, dez, dnx, dny, dnz, dsf, dct, dals, dsts, dhit;
    ducked2 = IIF(dals = 1, 1, 0);
  END
  ELSE ducked2 = 0;
  IF (ducked2 <> pducked) THEN
    UPDATE ents e SET e.maxz = IIF(:ducked2 = 1, 4, 32), e.viewheight = IIF(:ducked2 = 1, -2, 22) WHERE e.id = :pe;
  IF (ducked2 = 1) THEN maxspd = 100;

  -- PM_CheckJump
  -- PMF_JUMP_HELD: a jump held in the air or in water keeps the flag as it is (it used to be left NULL,
  -- which the column refused: a second tap on the touch screen's move half while still airborne crashed the tic)
  jr2 = jr;
  IF (jump = 1) THEN
  BEGIN
    IF (wl >= 2) THEN
    BEGIN
      IF (vz > -300) THEN vz = IIF(BIN_AND(wt, 32) <> 0, 100, IIF(BIN_AND(wt, 16) <> 0, 80, 50));
      onground = 0; flags = BIN_AND(flags, BIN_NOT(512));
    END
    ELSE IF (onground = 1 AND jr = 1) THEN
    BEGIN
      vz = vz + 270;
      flags = BIN_AND(flags, BIN_NOT(512));
      onground = 0;
      jr2 = 0;
      EXECUTE PROCEDURE snd(pe, 2, 'player/male/jump1.wav', 1, 1);
    END
  END
  ELSE jr2 = 1;

  -- PM_Friction
  IF (onground = 1 OR wl >= 2) THEN
  BEGIN
    spd = vlen(vx, vy, vz);
    IF (spd > 1) THEN
    BEGIN
      drop_ = 0;
      IF (onground = 1) THEN
      BEGIN
        control = IIF(spd < 100, 100, spd);
        drop_ = drop_ + control * 6 * dt;
      END
      IF (wl >= 2) THEN drop_ = drop_ + spd * 1 * wl * dt;
      ns = MAXVALUE(0, spd - drop_) / spd;
      vx = vx * ns; vy = vy * ns; vz = vz * ns;
    END
  END

  -- the wish direction
  fx_ = COS(yaw * 0.0174532925e0); fy = SIN(yaw * 0.0174532925e0);
  rx = fy; ry = -fx_;
  IF (wl >= 2) THEN
  BEGIN
    -- PM_WaterMove: the forward vector follows the pitch; sink slowly when idle
    fz = -SIN(pitch * 0.0174532925e0);
    fx_ = fx_ * COS(pitch * 0.0174532925e0); fy = fy * COS(pitch * 0.0174532925e0);
    wx = fx_ * fwd * maxspd + rx * side * maxspd; wy = fy * fwd * maxspd + ry * side * maxspd; wz = fz * fwd * maxspd;
    IF (fwd = 0 AND side = 0 AND jump = 0) THEN wz = wz - 60;
    ELSE IF (jump = 1) THEN wz = wz + 200;
    ELSE IF (jump < 0) THEN wz = wz - 200;                               -- crouch swims down
    wspd = vlen(wx, wy, wz);
    IF (wspd > maxspd) THEN BEGIN wx = wx * maxspd / wspd; wy = wy * maxspd / wspd; wz = wz * maxspd / wspd; wspd = maxspd; END
    wspd = wspd * 0.5e0;
    IF (wspd > 0) THEN
    BEGIN
      cur = (vx * wx + vy * wy + vz * wz) / vlen(wx, wy, wz);
      add_ = wspd - cur;
      IF (add_ > 0) THEN
      BEGIN
        acc = MINVALUE(add_, 10 * wspd * dt);
        vx = vx + acc * wx / vlen(wx, wy, wz); vy = vy + acc * wy / vlen(wx, wy, wz); vz = vz + acc * wz / vlen(wx, wy, wz);
      END
    END
  END
  ELSE
  BEGIN
    wx = fx_ * fwd * maxspd + rx * side * maxspd; wy = fy * fwd * maxspd + ry * side * maxspd;
    wspd = vlen(wx, wy, 0);
    IF (wspd > maxspd) THEN BEGIN wx = wx * maxspd / wspd; wy = wy * maxspd / wspd; wspd = maxspd; END
    -- PM_AirMove: no air control in single player (pm_airaccelerate 0)
    IF (wspd > 0 AND onground = 1) THEN
    BEGIN
      cur = (vx * wx + vy * wy) / wspd;
      add_ = wspd - cur;
      IF (add_ > 0) THEN
      BEGIN
        acc = MINVALUE(add_, 10 * wspd * dt);
        vx = vx + acc * wx / wspd; vy = vy + acc * wy / wspd;
      END
    END
    ELSE IF (wspd > 0 AND wl = 1) THEN
    BEGIN
      -- wading: some control while the feet are wet
      cur = (vx * wx + vy * wy) / wspd;
      add_ = wspd - cur;
      IF (add_ > 0) THEN
      BEGIN
        acc = MINVALUE(add_, 10 * wspd * dt);
        vx = vx + acc * wx / wspd; vy = vy + acc * wy / wspd;
      END
    END
  END
  -- gravity; on the ground no vertical speed at all (PM_AirMove's ground case): a small knockback down
  -- would otherwise sink the box a little into the floor each time, until every trace started in solid
  IF (onground = 0 AND wl < 2) THEN vz = vz - grav * dt;
  ELSE IF (onground = 1 AND wl < 2 AND noclip = 0) THEN vz = 0;
  IF (noclip = 1) THEN
  BEGIN
    -- noclip (PM_SPECTATOR): fly where the view points, jump to rise, through everything
    vx = (fwd * COS(yaw * 0.0174532925e0) * COS(pitch * 0.0174532925e0) + side * SIN(yaw * 0.0174532925e0)) * maxspd;
    vy = (fwd * SIN(yaw * 0.0174532925e0) * COS(pitch * 0.0174532925e0) - side * COS(yaw * 0.0174532925e0)) * maxspd;
    vz = (-fwd * SIN(pitch * 0.0174532925e0) + jump) * maxspd;
    UPDATE ents e SET e.x = e.x + :vx * :dt, e.y = e.y + :vy * :dt, e.z = e.z + :vz * :dt, e.vx = :vx, e.vy = :vy, e.vz = :vz,
           e.flags = BIN_AND(:flags, BIN_NOT(512)), e.yaw = :yaw WHERE e.id = :pe;
    EXECUTE PROCEDURE link_ent(pe);
  END
  ELSE IF (onground = 1 AND vx = 0 AND vy = 0 AND vz = 0 AND wl < 2 AND MOD(gtic, 10) <> 0) THEN
  BEGIN
    -- standing still on the ground: nothing to move. The ground under us is re-checked twice a
    -- second (pmove traces for it every frame; a tenth of that keeps a vanished floor honest)
    -- (friction may just have stopped it: the row keeps no stale speed)
    UPDATE ents e SET e.yaw = :yaw, e.vx = 0, e.vy = 0, e.vz = 0 WHERE e.id = :pe AND (e.yaw <> :yaw OR e.vx <> 0 OR e.vy <> 0 OR e.vz <> 0);
  END
  ELSE
  BEGIN
    UPDATE ents e SET e.vx = :vx, e.vy = :vy, e.vz = :vz, e.flags = BIN_AND(:flags, BIN_NOT(512)), e.yaw = :yaw WHERE e.id = :pe;
    -- move (the ground flag is cleared above; the move sets it again when it lands)
    IF (wl >= 2) THEN EXECUTE PROCEDURE fly_move(pe, dt) RETURNING_VALUES tst, tid;
    ELSE EXECUTE PROCEDURE walk_move(pe, dt, onground);
    IF (NOT EXISTS (SELECT 1 FROM ents e WHERE e.id = :pe)) THEN EXIT;
    IF (wl < 2) THEN
    BEGIN
      -- PM_CatagorizePosition: on the ground means a floor within a quarter unit under the box, unless going up
      -- faster than 180. The move finds the floor only when it falls onto it, and it falls only off the ground:
      -- without this the flag came and went every other tic, and friction, acceleration, jumps and the duck with it.
      SELECT e.x, e.y, e.z, e.vz, e.flags, e.minx, e.miny, e.minz, e.maxx, e.maxy, e.maxz FROM ents e WHERE e.id = :pe
        INTO px, py, pz, gvz, gflags, mnx, mny, mnz, mxx, mxy, mxz;
      IF (BIN_AND(gflags, 512) = 0 AND gvz <= 180) THEN
      BEGIN
        -- (the world's floor first, which is where the player nearly always stands; the entities only without one)
        SELECT m.headnode FROM game g JOIN models m ON m.id = g.world_model WHERE g.id = 1 INTO ghead;
        EXECUTE PROCEDURE trace_hull(ghead, 0, 0, 0, mnx, mny, mnz, mxx, mxy, mxz, px, py, pz, px, py, pz - 0.25e0, 33619971)
          RETURNING_VALUES dtf, dex, dey, dez, dnx, dny, dnz, dsf, dct, dals, dsts;
        dhit = 0;
        IF (dtf = 1 OR dnz < 0.7e0) THEN
          EXECUTE PROCEDURE trace_move(pe, mnx, mny, mnz, mxx, mxy, mxz, px, py, pz, px, py, pz - 0.25e0, 33619971)
            RETURNING_VALUES dtf, dex, dey, dez, dnx, dny, dnz, dsf, dct, dals, dsts, dhit;
        IF (dtf < 1 AND dnz >= 0.7e0) THEN
        BEGIN
          gsolid = 4;
          IF (dhit > 0) THEN SELECT e.solid FROM ents e WHERE e.id = :dhit INTO gsolid;
          IF (gsolid = 4) THEN
            UPDATE ents e SET e.flags = BIN_OR(e.flags, 512), e.vz = MAXVALUE(e.vz, 0) WHERE e.id = :pe;
        END
      END
    END
    EXECUTE PROCEDURE link_ent(pe);
  END
  SELECT e.x, e.y, e.z, e.flags, e.minx, e.miny, e.minz, e.maxx, e.maxy, e.maxz, e.vx, e.vy FROM ents e WHERE e.id = :pe INTO px, py, pz, flags, mnx, mny, mnz, mxx, mxy, mxz, bvx, bvy;
  -- the view's bob (ClientEndServerFrame, SV_CalcViewOffset): the walk cycle advances with the speed while on the
  -- ground, four times as fast ducked; the height bob is at most 6, the pitch and roll six times as strong ducked
  xys = SQRT(bvx * bvx + bvy * bvy);
  IF (xys < 5) THEN bt = 0;
  ELSE IF (BIN_AND(flags, 512) <> 0) THEN bt = pbobtime + IIF(xys > 210, 0.25e0, IIF(xys > 100, 0.125e0, 0.0625e0)) * dt / 0.1e0;
  ELSE bt = pbobtime;
  bts = IIF(ducked2 = 1, bt * 4, bt);
  bfs = ABS(SIN(bts * PI()));
  bobz = MINVALUE(6, bfs * xys * 0.005e0);
  bobp = bfs * 0.002e0 * xys * IIF(ducked2 = 1, 6, 1);
  bobr = bobp * IIF(MOD(CAST(FLOOR(bts) AS INTEGER), 2) = 1, -1, 1);
  -- smooth the view over steps
  stepz2 = IIF(BIN_AND(flags, 512) <> 0 AND pz - oldz > 0 AND pz - oldz <= 18, MINVALUE(pstepz + (pz - oldz), 18), MAXVALUE(0, pstepz - 160 * dt));

  -- G_TouchTriggers: triggers and items whose box we are in (not in noclip, as in ClientThink)
  IF (noclip = 0) THEN
  BEGIN
  FOR SELECT e.id, e.classname FROM ents e
       WHERE e.solid = 1 AND e.id <> :pe
         AND e.x + e.maxx >= :px + :mnx AND e.x + e.minx <= :px + :mxx
         AND e.y + e.maxy >= :py + :mny AND e.y + e.miny <= :py + :mxy
         AND e.z + e.maxz >= :pz + :mnz AND e.z + e.minz <= :pz + :mxz
       ORDER BY e.id INTO tid, tcls
  DO
  BEGIN
    IF (NOT EXISTS (SELECT 1 FROM ents e WHERE e.id = :tid)) THEN CONTINUE;
    IF (tcls IN ('trigger_multiple', 'trigger_once')) THEN
    BEGIN
      IF (EXISTS (SELECT 1 FROM ents e WHERE e.id = :tid AND e.max_health = 0 AND BIN_AND(e.spawnflags, 2) = 0)) THEN
        EXECUTE PROCEDURE trigger_fire(tid, pe);
    END
    ELSE IF (tcls = 'misc_teleporter') THEN EXECUTE PROCEDURE teleport_touch(tid, pe);
    ELSE IF (tcls = 'target_changelevel') THEN EXECUTE PROCEDURE changelevel(tid);
    ELSE IF (tcls = 'trigger_push') THEN
    BEGIN
      UPDATE ents e SET e.vx = (SELECT tr.p1x * tr.speed * 10 FROM ents tr WHERE tr.id = :tid), e.vy = (SELECT tr.p1y * tr.speed * 10 FROM ents tr WHERE tr.id = :tid),
             e.vz = (SELECT tr.p1z * tr.speed * 10 FROM ents tr WHERE tr.id = :tid), e.flags = BIN_AND(e.flags, BIN_NOT(512)) WHERE e.id = :pe;
      IF ((SELECT p.fly_sound_time FROM player p WHERE p.id = 1) < t) THEN
      BEGIN
        UPDATE player p SET p.fly_sound_time = :t + 1.5e0 WHERE p.id = 1;
        EXECUTE PROCEDURE snd(pe, 0, 'misc/windfly.wav', 1, 1);
      END
    END
    ELSE IF (tcls = 'trigger_hurt') THEN
    BEGIN
      SELECT e.nextthink, e.dmg, e.spawnflags FROM ents e WHERE e.id = :tid INTO tlt, tdm, tsf;
      IF (tlt IS NULL OR tlt < t) THEN
      BEGIN
        UPDATE ents e SET e.nextthink = :t + IIF(BIN_AND(:tsf, 16) <> 0, 1, 0.1e0) WHERE e.id = :tid;
        IF (BIN_AND(tsf, 4) = 0) THEN EXECUTE PROCEDURE snd(pe, 2, 'world/electro.wav', 1, 1);
        EXECUTE PROCEDURE t_damage(pe, tid, tid, tdm, 0, IIF(BIN_AND(:tsf, 8) <> 0, 32, 0));
      END
    END
    ELSE IF (tcls LIKE 'item_%' OR tcls LIKE 'weapon_%' OR tcls LIKE 'ammo_%' OR tcls LIKE 'key_%') THEN
    BEGIN
      -- (drop_temp_touch: not by its dropper for the first second)
      IF (NOT EXISTS (SELECT 1 FROM ents e WHERE e.id = :tid AND e.owner_id = :pe)) THEN EXECUTE PROCEDURE item_touch(tid, pe);
    END
  END

  -- door trigger fields: 60 units around a team of untargeted doors (Think_SpawnDoorTrigger)
  FOR SELECT DISTINCT COALESCE(d.linked_id, d.id) FROM ents d
       WHERE d.classname IN ('func_door', 'func_door_rotating')
         AND d.x + d.maxx + 60 >= :px + :mnx AND d.x + d.minx - 60 <= :px + :mxx
         AND d.y + d.maxy + 60 >= :py + :mny AND d.y + d.miny - 60 <= :py + :mxy
         AND d.z + d.maxz >= :pz + :mnz AND d.z + d.minz <= :pz + :mxz
       INTO tid
  DO
  BEGIN
    SELECT e.mv_state, e.targetname, e.max_health, e.attack_finished FROM ents e WHERE e.id = :tid INTO tst, tn, thp, tlt;
    IF ((tn IS NULL OR tn = '') AND thp = 0 AND tst IN (1, 3)) THEN EXECUTE PROCEDURE door_use(tid, pe);
    ELSE IF ((tn IS NULL OR tn = '') AND thp = 0 AND tst = 0) THEN
      UPDATE ents e SET e.nextthink = e.ltime + e.wait_ WHERE COALESCE(e.linked_id, e.id) = :tid AND e.think = 'door_go_down';
  END
  -- plat trigger fields: inside the plat's footprint, up to 8 above its top
  FOR SELECT e.id, e.mv_state FROM ents e
       WHERE e.classname = 'func_plat'
         AND e.p1x + e.maxx - 25 >= :px + :mnx AND e.p1x + e.minx + 25 <= :px + :mxx
         AND e.p1y + e.maxy - 25 >= :py + :mny AND e.p1y + e.miny + 25 <= :py + :mxy
         AND e.p1z + e.maxz + 8 >= :pz + :mnz AND e.p2z + e.maxz - 8 <= :pz + :mxz
       INTO tid, tst
  DO
  BEGIN
    IF (tst = 1) THEN EXECUTE PROCEDURE plat_go_up(tid);
    ELSE IF (tst = 0) THEN UPDATE ents e SET e.nextthink = e.ltime + 1 WHERE e.id = :tid AND e.think = 'plat_go_down';
  END

  END
  UPDATE player p SET p.pitch = :pitch, p.punchangle = MINVALUE(0, p.punchangle + 10 * :dt), p.jump_released = :jr2, p.stepz = :stepz2,
         p.ducked = :ducked2, p.view_ofs = IIF(:ducked2 = 1, -2, 22), p.bobtime = :bt, p.bob_z = :bobz, p.bob_pitch = :bobp, p.bob_roll = :bobr,
         p.air_finished = COALESCE(:afin2, p.air_finished), p.drown_dmg = COALESCE(:ddmg2, p.drown_dmg),
         p.water_x = :wcx, p.water_y = :wcy, p.water_z = :wcz WHERE p.id = 1;

  -- megahealth rots away above the maximum
  UPDATE player p SET p.mega_time = :t + 1 WHERE p.id = 1 AND p.mega_time < :t AND (SELECT e.health FROM ents e WHERE e.id = :pe) > :mhp;
  UPDATE ents e SET e.health = e.health - 1 WHERE e.id = :pe AND e.health > e.max_health AND (SELECT p.mega_time FROM player p WHERE p.id = 1) = :t + 1
     AND MOD((SELECT g.tic FROM game g WHERE g.id = 1), 20) = 0;

  -- weapon
  EXECUTE PROCEDURE player_fire(fire);
END^

SET TERM ; ^
