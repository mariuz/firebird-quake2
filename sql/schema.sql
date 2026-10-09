-- schema.sql – the whole of Quake 2's world, as Firebird tables.
--
-- A Quake 2 BSP (IBSP 38) is a relational database already: FACES reference
-- PLANES and TEXINFO and own an ordered list of VERTICES through EDGES and
-- SURFEDGES; LEAVES list the faces they contain through LEAFFACES, the
-- BRUSHES that fill them through LEAFBRUSHES, and belong to a CLUSTER whose
-- potentially visible set the VISIBILITY lump holds; NODES form the tree
-- that rendering and collision walk. loader.js copies those lumps in
-- (slightly denormalised so the hot loops never need a second lookup);
-- game.sql simulates the entities and render.sql draws the frame.

-- ── session / configuration ─────────────────────────────────────────────
CREATE TABLE game (
  has_water  SMALLINT DEFAULT 1 NOT NULL,   -- any lava, slime or water leaf in the map (else the water checks are skipped)
  serverflags INTEGER DEFAULT 0 NOT NULL,   -- SFL_CROSS_TRIGGER_1..8: the unit's cross-level flags, kept across maps
  id             SMALLINT NOT NULL PRIMARY KEY,
  tic            INTEGER DEFAULT 0 NOT NULL,
  time_          DOUBLE PRECISION DEFAULT 0 NOT NULL,   -- seconds, tic / 20
  map_name       VARCHAR(32),
  next_map       VARCHAR(64),                           -- set by target_changelevel, as written: "demo2$base1", "*base1", "victory.pcx" (src/levels.js reads it)
  exit_kind      SMALLINT DEFAULT 0 NOT NULL,           -- 0 playing, 1 change level, 3 restart (player died)
  skill          SMALLINT DEFAULT 1 NOT NULL,
  world_model    INTEGER DEFAULT 0 NOT NULL,            -- models.id of the world
  total_monsters INTEGER DEFAULT 0 NOT NULL,
  killed         INTEGER DEFAULT 0 NOT NULL,
  total_secrets  INTEGER DEFAULT 0 NOT NULL,
  found_secrets  INTEGER DEFAULT 0 NOT NULL,
  total_goals    INTEGER DEFAULT 0 NOT NULL,
  found_goals    INTEGER DEFAULT 0 NOT NULL,
  level_msg      VARCHAR(200),
  help_msg       VARCHAR(400),                          -- target_help with spawnflags 1: the help computer's first message (kept across levels)
  gravity        DOUBLE PRECISION DEFAULT 800 NOT NULL,
  sky            VARCHAR(32),                           -- worldspawn "sky": env/<sky>rt.pcx …
  cd_track       INTEGER DEFAULT 0 NOT NULL,
  intermission_time DOUBLE PRECISION,                   -- set at a unit's end: the player watches from an info_player_intermission
  help_msg2      VARCHAR(400),                          -- target_help without spawnflags 1: the second message
  help_changed   INTEGER DEFAULT 0 NOT NULL             -- counts target_help uses (the page blinks the help icon until F1)
);

CREATE TABLE viewcfg (
  id     SMALLINT NOT NULL PRIMARY KEY,
  w      INTEGER NOT NULL,
  h      INTEGER NOT NULL,
  fov    DOUBLE PRECISION NOT NULL,     -- horizontal, degrees
  near_z DOUBLE PRECISION NOT NULL,
  vis_cluster INTEGER,                 -- the cluster VIS_FACES was marked for
  vis_area    INTEGER,                 -- ... and the area the eye was in
  vis_slot    SMALLINT,                -- ... and the VIS_FACES slot that holds its faces
  -- the view the world's face list was last made for, and that list (reused while the view holds still)
  lv_ex DOUBLE PRECISION, lv_ey DOUBLE PRECISION, lv_ez DOUBLE PRECISION,
  lv_fx DOUBLE PRECISION, lv_fy DOUBLE PRECISION, lv_fz DOUBLE PRECISION,
  lv_ux DOUBLE PRECISION, lv_uy DOUBLE PRECISION, lv_uz DOUBLE PRECISION,
  lv_leaf INTEGER,                     -- the eye's leaf at lv_ex/ey/ez (no tree walk while the eye stands)
  view_stamp INTEGER DEFAULT 0 NOT NULL, -- counts the frames on which the view changed
  world_lst BLOB SUB_TYPE TEXT CHARACTER SET ASCII
);

-- ── resources ───────────────────────────────────────────────────────────
-- Every model the renderer and the simulation know: the world and its
-- submodels (*1, *2, …), alias models (models/**/tris.md2) and sprites (.sp2).
CREATE TABLE models (
  id        INTEGER NOT NULL PRIMARY KEY,
  name      VARCHAR(64) NOT NULL,
  kind      CHAR(1) NOT NULL,            -- B bsp, M md2, S sp2
  minx DOUBLE PRECISION, miny DOUBLE PRECISION, minz DOUBLE PRECISION,
  maxx DOUBLE PRECISION, maxy DOUBLE PRECISION, maxz DOUBLE PRECISION,
  headnode  INTEGER,                     -- BSP models: the root node (nodes.id)
  first_face INTEGER, num_faces INTEGER,
  nframes   INTEGER DEFAULT 1 NOT NULL,
  flags     INTEGER DEFAULT 0 NOT NULL,
  radius    DOUBLE PRECISION DEFAULT 0 NOT NULL
);
CREATE INDEX models_name ON models (name);

-- Frame runs of an alias model: "attak101".."attak112" → ('attak1', first, 12).
CREATE TABLE anims (
  model_id INTEGER NOT NULL,
  anim     VARCHAR(16) NOT NULL,
  first_frame INTEGER NOT NULL,
  frame_count INTEGER NOT NULL,
  PRIMARY KEY (model_id, anim)
);

CREATE TABLE lightstyles (
  style   INTEGER NOT NULL PRIMARY KEY,
  pattern VARCHAR(64) NOT NULL,         -- 'a' dark … 'm' normal … 'z' double
  base_pattern VARCHAR(64)              -- the pattern at map start (the page holds those; the frame lists what differs)
);

-- ── map geometry ─────────────────────────────────────────────────────────
-- The BSP tree. Children < 0 are leaves: leaf = -(child + 1). The plane is
-- copied in so a step of the walk is one lookup; ptype 0..2 is an axial plane.
CREATE TABLE nodes (
  id   INTEGER NOT NULL PRIMARY KEY,
  nx DOUBLE PRECISION NOT NULL, ny DOUBLE PRECISION NOT NULL, nz DOUBLE PRECISION NOT NULL,
  dist DOUBLE PRECISION NOT NULL,
  ptype SMALLINT DEFAULT 3 NOT NULL,
  c0 INTEGER NOT NULL,
  c1 INTEGER NOT NULL,
  cc0 INTEGER,                         -- a leaf child's contents (NULL for a node): empty leaves are skipped without a visit
  cc1 INTEGER
);

CREATE TABLE leaves (
  id       INTEGER NOT NULL PRIMARY KEY,
  contents INTEGER NOT NULL,            -- CONTENTS_* bits (1 solid, 8 lava, 16 slime, 32 water, …)
  cluster  INTEGER NOT NULL,            -- -1: outside the world
  area     INTEGER DEFAULT 0 NOT NULL,
  minx DOUBLE PRECISION, miny DOUBLE PRECISION, minz DOUBLE PRECISION,
  maxx DOUBLE PRECISION, maxy DOUBLE PRECISION, maxz DOUBLE PRECISION,
  first_lf INTEGER NOT NULL,            -- leaffaces
  num_lf   INTEGER NOT NULL,
  first_lb INTEGER NOT NULL,            -- leafbrushes
  num_lb   INTEGER NOT NULL,
  -- the decompressed PVS of the leaf's cluster as hex: cluster j visible ⇔ bit j
  -- (the character at index j >> 2, low nibble first). '' means everything.
  pvs      VARCHAR(2048) CHARACTER SET ASCII
);
CREATE INDEX leaves_cluster ON leaves (cluster);

-- the map's areas and the portals between them (AREAS and AREAPORTALS lumps). A portal is open while a
-- door holds it open (portal_state); areas reachable from one another through open portals share a
-- flood number (area_flood, FloodAreaConnections), and the view marks only the leaves of its own flood.
CREATE TABLE areas (
  id       INTEGER NOT NULL PRIMARY KEY,
  num_ap   INTEGER NOT NULL,
  first_ap INTEGER NOT NULL
);
CREATE TABLE areaportals (
  id         INTEGER NOT NULL PRIMARY KEY,
  portal     INTEGER NOT NULL,              -- the func_areaportal's style
  other_area INTEGER NOT NULL
);
CREATE TABLE portal_state (
  portal INTEGER NOT NULL PRIMARY KEY,
  open_  SMALLINT DEFAULT 0 NOT NULL
);
CREATE TABLE area_flood (
  area  INTEGER NOT NULL PRIMARY KEY,
  flood INTEGER NOT NULL
);

CREATE TABLE leaffaces (
  id   INTEGER NOT NULL PRIMARY KEY,
  face INTEGER NOT NULL
);

CREATE TABLE leafbrushes (
  id    INTEGER NOT NULL PRIMARY KEY,
  brush INTEGER NOT NULL
);

-- Collision: a brush is a convex volume bounded by its sides' planes.
CREATE TABLE brushes (
  id         INTEGER NOT NULL PRIMARY KEY,
  contents   INTEGER NOT NULL,
  first_side INTEGER NOT NULL,
  num_sides  INTEGER NOT NULL,
  -- the union of the leaves that list the brush: a bound to skip it by
  minx DOUBLE PRECISION DEFAULT -99999 NOT NULL, miny DOUBLE PRECISION DEFAULT -99999 NOT NULL, minz DOUBLE PRECISION DEFAULT -99999 NOT NULL,
  maxx DOUBLE PRECISION DEFAULT 99999 NOT NULL, maxy DOUBLE PRECISION DEFAULT 99999 NOT NULL, maxz DOUBLE PRECISION DEFAULT 99999 NOT NULL
);

CREATE TABLE brushsides (
  id   INTEGER NOT NULL PRIMARY KEY,   -- brushes.first_side + k
  nx DOUBLE PRECISION NOT NULL, ny DOUBLE PRECISION NOT NULL, nz DOUBLE PRECISION NOT NULL,
  dist DOUBLE PRECISION NOT NULL,
  flags INTEGER DEFAULT 0 NOT NULL     -- the side's texinfo SURF_* flags (4 sky, 8 warp, 2 slick …)
);

CREATE TABLE faces (
  id        INTEGER NOT NULL PRIMARY KEY,
  model_id  INTEGER NOT NULL,
  -- plane, already flipped for side = 1 so the normal faces the front
  nx DOUBLE PRECISION NOT NULL, ny DOUBLE PRECISION NOT NULL, nz DOUBLE PRECISION NOT NULL,
  dist DOUBLE PRECISION NOT NULL,
  nverts    INTEGER NOT NULL,
  tex       INTEGER,                    -- textures.id
  -- texinfo: texel s = p·svec + soff, t = p·tvec + toff
  sx DOUBLE PRECISION NOT NULL, sy DOUBLE PRECISION NOT NULL, sz DOUBLE PRECISION NOT NULL, soff DOUBLE PRECISION NOT NULL,
  tx DOUBLE PRECISION NOT NULL, ty DOUBLE PRECISION NOT NULL, tz DOUBLE PRECISION NOT NULL, toff DOUBLE PRECISION NOT NULL,
  flags     INTEGER DEFAULT 0 NOT NULL, -- SURF_*: 4 sky 8 warp 16 trans33 32 trans66 64 flowing 128 nodraw
  style0    INTEGER DEFAULT 0 NOT NULL,
  cx DOUBLE PRECISION DEFAULT 0 NOT NULL, cy DOUBLE PRECISION DEFAULT 0 NOT NULL, cz DOUBLE PRECISION DEFAULT 0 NOT NULL,
  radius DOUBLE PRECISION DEFAULT 0 NOT NULL
);
CREATE INDEX faces_model ON faces (model_id);

CREATE TABLE face_verts (
  face INTEGER NOT NULL,
  seq  INTEGER NOT NULL,
  x DOUBLE PRECISION NOT NULL, y DOUBLE PRECISION NOT NULL, z DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (face, seq)
);

CREATE TABLE textures (
  id    INTEGER NOT NULL PRIMARY KEY,
  name  VARCHAR(32) NOT NULL,           -- textures/<name>.wal
  w     INTEGER NOT NULL,
  h     INTEGER NOT NULL,
  flags INTEGER DEFAULT 0 NOT NULL
);

-- The entity lump as authored (the keys the game reads; spawn_map_ents uses it).
CREATE TABLE map_ents (
  id         INTEGER NOT NULL PRIMARY KEY,
  classname  VARCHAR(40) NOT NULL,
  targetname VARCHAR(40),
  target     VARCHAR(40),
  killtarget VARCHAR(40),
  pathtarget VARCHAR(40),
  deathtarget VARCHAR(40),
  combattarget VARCHAR(40),
  team       VARCHAR(40),
  model      VARCHAR(64),              -- '*N' for brush models, or a file
  ox DOUBLE PRECISION DEFAULT 0 NOT NULL, oy DOUBLE PRECISION DEFAULT 0 NOT NULL, oz DOUBLE PRECISION DEFAULT 0 NOT NULL,
  angle      DOUBLE PRECISION,
  apitch DOUBLE PRECISION, ayaw DOUBLE PRECISION, aroll DOUBLE PRECISION,   -- "angles"
  spawnflags INTEGER DEFAULT 0 NOT NULL,
  message    VARCHAR(400),
  wait_      DOUBLE PRECISION,
  delay      DOUBLE PRECISION,
  random_    DOUBLE PRECISION,
  speed      DOUBLE PRECISION,
  accel      DOUBLE PRECISION,
  decel      DOUBLE PRECISION,
  lip        DOUBLE PRECISION,
  height     DOUBLE PRECISION,
  health     INTEGER,
  light      INTEGER,
  style      INTEGER,
  sounds     INTEGER,
  dmg        INTEGER,
  count_     INTEGER,
  map        VARCHAR(64),
  noise      VARCHAR(64),
  item       VARCHAR(40),
  mass       INTEGER,
  volume     DOUBLE PRECISION,
  attenuation DOUBLE PRECISION,
  distance   DOUBLE PRECISION,
  gravity    DOUBLE PRECISION,
  sky        VARCHAR(32),
  skyrotate  DOUBLE PRECISION
);
CREATE INDEX map_ents_class ON map_ents (classname);
CREATE INDEX map_ents_tname ON map_ents (targetname);

-- ── live entities (Quake 2's edicts) ────────────────────────────────────
CREATE SEQUENCE ent_seq;

CREATE TABLE ents (
  id         INTEGER NOT NULL PRIMARY KEY,
  classname  VARCHAR(40) NOT NULL,
  model_id   INTEGER,                   -- NULL = invisible
  frame      INTEGER DEFAULT 0 NOT NULL,
  skin       INTEGER DEFAULT 0 NOT NULL,
  effects    INTEGER DEFAULT 0 NOT NULL,  -- EF_: 1 rotate 2 gib 8 blaster 16 rocket 32 grenade 64 hyperblaster 128 bfg … 0x80000 anim all
  renderfx   INTEGER DEFAULT 0 NOT NULL,  -- RF_: 2 translucent 4 glow 8 shell …
  x DOUBLE PRECISION DEFAULT 0 NOT NULL, y DOUBLE PRECISION DEFAULT 0 NOT NULL, z DOUBLE PRECISION DEFAULT 0 NOT NULL,
  vx DOUBLE PRECISION DEFAULT 0 NOT NULL, vy DOUBLE PRECISION DEFAULT 0 NOT NULL, vz DOUBLE PRECISION DEFAULT 0 NOT NULL,
  pitch DOUBLE PRECISION DEFAULT 0 NOT NULL, yaw DOUBLE PRECISION DEFAULT 0 NOT NULL, roll DOUBLE PRECISION DEFAULT 0 NOT NULL,
  avel_yaw   DOUBLE PRECISION DEFAULT 0 NOT NULL,   -- degrees per second
  avel_pitch DOUBLE PRECISION DEFAULT 0 NOT NULL,
  avel_roll  DOUBLE PRECISION DEFAULT 0 NOT NULL,
  minx DOUBLE PRECISION DEFAULT 0 NOT NULL, miny DOUBLE PRECISION DEFAULT 0 NOT NULL, minz DOUBLE PRECISION DEFAULT 0 NOT NULL,
  maxx DOUBLE PRECISION DEFAULT 0 NOT NULL, maxy DOUBLE PRECISION DEFAULT 0 NOT NULL, maxz DOUBLE PRECISION DEFAULT 0 NOT NULL,
  solid      SMALLINT DEFAULT 0 NOT NULL,   -- 0 not 1 trigger 2 bbox 3 bbox (player/monster) 4 bsp
  movetype   SMALLINT DEFAULT 0 NOT NULL,   -- 0 none 2 noclip 3 walk(player) 4 step 5 fly 6 toss 7 push 8 stop 9 flymissile 10 bounce
  clipmask   INTEGER DEFAULT 3 NOT NULL,    -- what this entity collides with (MASK_*)
  flags      INTEGER DEFAULT 0 NOT NULL,    -- FL_*: 1 fly 2 swim 8 inwater 16 godmode 32 monster 64 notarget 512 onground 1024 partialground 2048 teamslave 4096 noknockback
  health     INTEGER DEFAULT 0 NOT NULL,
  max_health INTEGER DEFAULT 0 NOT NULL,
  gib_health INTEGER DEFAULT -40 NOT NULL,
  takedamage SMALLINT DEFAULT 0 NOT NULL,   -- 0 no 1 yes 2 aim
  deadflag   SMALLINT DEFAULT 0 NOT NULL,
  mass       INTEGER DEFAULT 200 NOT NULL,
  owner_id   INTEGER,
  enemy_id   INTEGER,
  goal_id    INTEGER,
  movetarget INTEGER,
  st         VARCHAR(12) DEFAULT 'idle' NOT NULL,  -- monsters: stand walk run melee missile pain die dead / doors: top bottom up down
  anim       VARCHAR(16),
  anim_frame INTEGER DEFAULT 0 NOT NULL,
  anim_tic   INTEGER DEFAULT 0 NOT NULL,
  think      VARCHAR(24),
  nextthink  DOUBLE PRECISION,
  targetname VARCHAR(40),
  target     VARCHAR(40),
  killtarget VARCHAR(40),
  pathtarget VARCHAR(40),
  deathtarget VARCHAR(40),
  combattarget VARCHAR(40),
  team       VARCHAR(40),
  message    VARCHAR(400),
  spawnflags INTEGER DEFAULT 0 NOT NULL,
  wait_      DOUBLE PRECISION DEFAULT 0 NOT NULL,
  delay      DOUBLE PRECISION DEFAULT 0 NOT NULL,
  random_    DOUBLE PRECISION DEFAULT 0 NOT NULL,
  speed      DOUBLE PRECISION DEFAULT 0 NOT NULL,
  accel      DOUBLE PRECISION DEFAULT 0 NOT NULL,
  decel      DOUBLE PRECISION DEFAULT 0 NOT NULL,
  lip        DOUBLE PRECISION DEFAULT 0 NOT NULL,
  dmg        INTEGER DEFAULT 0 NOT NULL,
  dmg_radius DOUBLE PRECISION DEFAULT 0 NOT NULL,
  count_     INTEGER DEFAULT 0 NOT NULL,
  style      INTEGER DEFAULT 0 NOT NULL,
  sounds     INTEGER DEFAULT 0 NOT NULL,
  height     DOUBLE PRECISION DEFAULT 0 NOT NULL,
  map        VARCHAR(64),
  item       VARCHAR(40),                   -- items: the item name; trigger_key: the key needed
  -- movers (doors, plats, buttons, trains)
  p1x DOUBLE PRECISION DEFAULT 0 NOT NULL, p1y DOUBLE PRECISION DEFAULT 0 NOT NULL, p1z DOUBLE PRECISION DEFAULT 0 NOT NULL,
  p2x DOUBLE PRECISION DEFAULT 0 NOT NULL, p2y DOUBLE PRECISION DEFAULT 0 NOT NULL, p2z DOUBLE PRECISION DEFAULT 0 NOT NULL,
  dstx DOUBLE PRECISION DEFAULT 0 NOT NULL, dsty DOUBLE PRECISION DEFAULT 0 NOT NULL, dstz DOUBLE PRECISION DEFAULT 0 NOT NULL,
  mv_state   SMALLINT DEFAULT 0 NOT NULL,   -- 0 top 1 bottom 2 up 3 down
  mv_done    VARCHAR(24),                   -- think to run when the move finishes
  mv_time    DOUBLE PRECISION,              -- when it finishes
  linked_id  INTEGER,                       -- the master of a team of movers
  noise1     VARCHAR(64),                   -- start / open sound
  noise2     VARCHAR(64),                   -- middle (looping) sound
  noise3     VARCHAR(64),                   -- end / close sound
  -- monsters
  ideal_yaw  DOUBLE PRECISION DEFAULT 0 NOT NULL,
  yaw_speed  DOUBLE PRECISION DEFAULT 20 NOT NULL,
  attack_finished DOUBLE PRECISION DEFAULT 0 NOT NULL,
  pain_finished   DOUBLE PRECISION DEFAULT 0 NOT NULL,
  search_time     DOUBLE PRECISION DEFAULT 0 NOT NULL,
  idle_time       DOUBLE PRECISION DEFAULT 0 NOT NULL,   -- when the next idle (standing) or search (walking) sound is due
  aiflags         INTEGER DEFAULT 0 NOT NULL,            -- 1 AI_STAND_GROUND, 2 AI_COMBAT_POINT, 4 AI_DUCKED, 8 AI_HOLD_FRAME, 16 AI_LOST_SIGHT, 32 AI_PURSUIT_LAST_SEEN, 64 AI_PURSUE_NEXT, 128 AI_PURSUE_TEMP
  pausetime       DOUBLE PRECISION,                      -- monsterinfo.pausetime: how long a soldier's crouch-and-fire keeps firing
  ls_x DOUBLE PRECISION, ls_y DOUBLE PRECISION, ls_z DOUBLE PRECISION,   -- monsterinfo.last_sighting: where the enemy was last seen, or the trail marker run to
  trail_time      DOUBLE PRECISION DEFAULT 0 NOT NULL,   -- monsterinfo.trail_time: the time of the last trail marker taken (or of the last sighting)
  sg_x DOUBLE PRECISION, sg_y DOUBLE PRECISION, sg_z DOUBLE PRECISION,   -- monsterinfo.saved_goal: the pursuit target a detour stands in for
  attack_state    SMALLINT DEFAULT 0 NOT NULL,   -- 1 straight 2 sliding 3 melee 4 missile 5 leaping
  lefty      SMALLINT DEFAULT 0 NOT NULL,
  -- placement
  leaf       INTEGER,                      -- leaf of the origin
  cluster    INTEGER,
  area       INTEGER,                      -- the origin leaf's area (entities in areas cut off by closed doors are not drawn)
  cl2        INTEGER, cl3 INTEGER,           -- further clusters the box touches (its corners), if any
  lx DOUBLE PRECISION, ly DOUBLE PRECISION, lz DOUBLE PRECISION,   -- where it was last linked
  mkind      CHAR(1),                      -- the model's kind (B bsp, M md2, S sp2), copied in by set_model
  mradius    DOUBLE PRECISION DEFAULT 0 NOT NULL,   -- ... and its bounding radius
  vis_cl     INTEGER,                      -- brush models: the view cluster VIS was decided for
  vis        SMALLINT,                     -- ... and whether the model is in that cluster's PVS
  fl_stamp   INTEGER,                      -- brush models: the view stamp and pose FACES_LST was made for ...
  fl_x DOUBLE PRECISION, fl_y DOUBLE PRECISION, fl_z DOUBLE PRECISION, fl_p DOUBLE PRECISION, fl_yaw DOUBLE PRECISION, fl_r DOUBLE PRECISION,
  faces_lst  BLOB SUB_TYPE TEXT CHARACTER SET ASCII,   -- ... and the model's visible faces for them
  waterlevel SMALLINT DEFAULT 0 NOT NULL,
  watertype  INTEGER DEFAULT 0 NOT NULL,
  ltime      DOUBLE PRECISION DEFAULT 0 NOT NULL,
  teleport_time DOUBLE PRECISION DEFAULT 0 NOT NULL,
  spawn_x DOUBLE PRECISION DEFAULT 0 NOT NULL, spawn_y DOUBLE PRECISION DEFAULT 0 NOT NULL, spawn_z DOUBLE PRECISION DEFAULT 0 NOT NULL,
  mtype      VARCHAR(16),                  -- monster_types.name
  alpha      SMALLINT DEFAULT 0 NOT NULL,  -- 1 = draw translucent
  viewheight DOUBLE PRECISION DEFAULT 0 NOT NULL,
  gravity    DOUBLE PRECISION DEFAULT 1 NOT NULL     -- a multiplier of the world's
);
CREATE INDEX ents_class ON ents (classname);
CREATE INDEX ents_tname ON ents (targetname);
CREATE INDEX ents_solid ON ents (solid);
CREATE INDEX ents_think ON ents (nextthink);
CREATE INDEX ents_model ON ents (model_id);
CREATE INDEX ents_movetype ON ents (movetype);
CREATE INDEX ents_mkind ON ents (mkind);
CREATE INDEX ents_team ON ents (team);

-- The one client.
CREATE TABLE player (
  id              SMALLINT NOT NULL PRIMARY KEY,
  ent_id          INTEGER,
  armor           INTEGER DEFAULT 0 NOT NULL,
  armor_type      SMALLINT DEFAULT 0 NOT NULL,            -- 0 none 1 jacket 2 combat 3 body
  power_armor     SMALLINT DEFAULT 0 NOT NULL,            -- FL_POWER_ARMOR: 1 while the screen or shield held is switched on
  bullets         INTEGER DEFAULT 0 NOT NULL,
  shells          INTEGER DEFAULT 0 NOT NULL,
  rockets         INTEGER DEFAULT 0 NOT NULL,
  grenades        INTEGER DEFAULT 0 NOT NULL,
  cells           INTEGER DEFAULT 0 NOT NULL,
  slugs           INTEGER DEFAULT 0 NOT NULL,
  max_bullets     INTEGER DEFAULT 200 NOT NULL,
  max_shells      INTEGER DEFAULT 100 NOT NULL,
  max_rockets     INTEGER DEFAULT 50 NOT NULL,
  max_grenades    INTEGER DEFAULT 50 NOT NULL,
  max_cells       INTEGER DEFAULT 200 NOT NULL,
  max_slugs       INTEGER DEFAULT 50 NOT NULL,
  weapons         INTEGER DEFAULT 1 NOT NULL,             -- WP_ bits: 1 blaster 2 shotgun 4 sshotgun 8 machinegun 16 chaingun 32 grenades 64 gl 128 rl 256 hyperblaster 512 railgun 1024 bfg
  keys            INTEGER DEFAULT 0 NOT NULL,             -- KEY_ bits: 1 blue 2 red 4 data cd 8 power cube 16 pyramid 32 data spinner 64 pass 128 commander's head 256 airstrike
  power_cubes     INTEGER DEFAULT 0 NOT NULL,
  weapon          INTEGER DEFAULT 1 NOT NULL,             -- the WP_ bit of the current weapon
  weaponframe     INTEGER DEFAULT 0 NOT NULL,
  weaponstate     SMALLINT DEFAULT 0 NOT NULL,            -- 0 ready 1 firing 2 changing
  attack_finished DOUBLE PRECISION DEFAULT 0 NOT NULL,
  attack_start    DOUBLE PRECISION DEFAULT 0 NOT NULL,
  pain_finished   DOUBLE PRECISION DEFAULT 0 NOT NULL,
  punchangle      DOUBLE PRECISION DEFAULT 0 NOT NULL,
  view_ofs        DOUBLE PRECISION DEFAULT 22 NOT NULL,
  dmg_take        INTEGER DEFAULT 0 NOT NULL,
  dmg_save        INTEGER DEFAULT 0 NOT NULL,
  dmg_time        DOUBLE PRECISION DEFAULT 0 NOT NULL,
  bonus_time      DOUBLE PRECISION DEFAULT 0 NOT NULL,
  quad_finished   DOUBLE PRECISION DEFAULT 0 NOT NULL,
  invincible_finished DOUBLE PRECISION DEFAULT 0 NOT NULL,
  breather_finished   DOUBLE PRECISION DEFAULT 0 NOT NULL,
  enviro_finished     DOUBLE PRECISION DEFAULT 0 NOT NULL,
  silencer_shots  INTEGER DEFAULT 0 NOT NULL,
  inv_quad        SMALLINT DEFAULT 0 NOT NULL,            -- pers.inventory of the items that wait there to be used:
  inv_invuln      SMALLINT DEFAULT 0 NOT NULL,            --   the powerups (single player keeps them for their key or invuse)
  inv_silencer    SMALLINT DEFAULT 0 NOT NULL,
  inv_breather    SMALLINT DEFAULT 0 NOT NULL,
  inv_enviro      SMALLINT DEFAULT 0 NOT NULL,
  inv_screen      SMALLINT DEFAULT 0 NOT NULL,            --   and the power armour (power_armor says whether it is on)
  inv_shield      SMALLINT DEFAULT 0 NOT NULL,
  inv_sel         SMALLINT DEFAULT 7 NOT NULL,            -- pers.selected_item: an itemlist index (7 the blaster), -1 none
  pickup_item     SMALLINT DEFAULT 0 NOT NULL,            -- STAT_PICKUP_ICON/STRING: the itemlist index last picked up (41 health)
  pickup_time     DOUBLE PRECISION DEFAULT 0 NOT NULL,    -- ... shown until then
  water_x         DOUBLE PRECISION DEFAULT 1e30 NOT NULL, -- where the player's water level was last worked out (none yet: far away)
  water_y         DOUBLE PRECISION DEFAULT 1e30 NOT NULL,
  water_z         DOUBLE PRECISION DEFAULT 1e30 NOT NULL,
  trail_x         DOUBLE PRECISION DEFAULT 1e30 NOT NULL, -- where the player stood when the trail was last checked (none yet: far away)
  trail_y         DOUBLE PRECISION DEFAULT 1e30 NOT NULL,
  trail_z         DOUBLE PRECISION DEFAULT 1e30 NOT NULL,
  jump_released   SMALLINT DEFAULT 1 NOT NULL,
  fly_sound_time  DOUBLE PRECISION DEFAULT 0 NOT NULL,
  swim_time       DOUBLE PRECISION DEFAULT 0 NOT NULL,
  air_finished    DOUBLE PRECISION DEFAULT 0 NOT NULL,
  dmg_lava_time   DOUBLE PRECISION DEFAULT 0 NOT NULL,
  next_drown_time DOUBLE PRECISION DEFAULT 0 NOT NULL,
  drown_dmg       INTEGER DEFAULT 2 NOT NULL,
  msg             VARCHAR(200),
  msg_time        DOUBLE PRECISION DEFAULT 0 NOT NULL,
  cprint          VARCHAR(400),                           -- centerprint
  cprint_time     DOUBLE PRECISION DEFAULT 0 NOT NULL,
  kills           INTEGER DEFAULT 0 NOT NULL,
  dead_time       DOUBLE PRECISION DEFAULT 0 NOT NULL,
  show_hostile    DOUBLE PRECISION DEFAULT 0 NOT NULL,
  impulse         SMALLINT DEFAULT 0 NOT NULL,
  pitch           DOUBLE PRECISION DEFAULT 0 NOT NULL,    -- view pitch, degrees (+down)
  oldz            DOUBLE PRECISION DEFAULT 0 NOT NULL,
  stepz           DOUBLE PRECISION DEFAULT 0 NOT NULL,
  machinegun_shots INTEGER DEFAULT 0 NOT NULL,            -- the machine gun's climbing kick
  chaingun_spin   DOUBLE PRECISION DEFAULT 0 NOT NULL,    -- how long the chain gun has been firing
  grenade_time    DOUBLE PRECISION DEFAULT 0 NOT NULL,    -- a hand grenade's fuse is lit
  weapon_sound    SMALLINT DEFAULT 0 NOT NULL,            -- the looped firing sound (client weapon_sound): 1 hyperblaster, 2 chaingun
  mega_time       DOUBLE PRECISION DEFAULT 0 NOT NULL,    -- megahealth rot timer
  ducked          SMALLINT DEFAULT 0 NOT NULL,            -- PMF_DUCKED: the box 32 → 4 high, the eye at -2
  bobtime         DOUBLE PRECISION DEFAULT 0 NOT NULL,    -- the walk cycle (p_view.c's bobtime)
  bob_z           DOUBLE PRECISION DEFAULT 0 NOT NULL,    -- the view's bob this tic: height, pitch and roll
  bob_pitch       DOUBLE PRECISION DEFAULT 0 NOT NULL,
  bob_roll        DOUBLE PRECISION DEFAULT 0 NOT NULL
);

-- S_StartSound: every sound the simulation makes, for the browser to play.
CREATE SEQUENCE sound_seq;
-- p_trail.c: the player's trail, the last eight spots it moved out of sight of the one before (seq oldest first)
CREATE TABLE player_trail (
  seq  INTEGER NOT NULL PRIMARY KEY,
  x DOUBLE PRECISION, y DOUBLE PRECISION, z DOUBLE PRECISION,
  yaw  DOUBLE PRECISION,                    -- from the marker before to this one
  ts   DOUBLE PRECISION                     -- level time it was dropped
);

CREATE TABLE sound_events (
  id     INTEGER NOT NULL PRIMARY KEY,
  tic    INTEGER NOT NULL,
  ent_id INTEGER,                  -- a new sound on the same ent/channel cuts the old one
  chan   SMALLINT DEFAULT 0 NOT NULL,
  snd    VARCHAR(64) NOT NULL,
  vol    DOUBLE PRECISION DEFAULT 1 NOT NULL,
  attn   DOUBLE PRECISION DEFAULT 1 NOT NULL,
  x DOUBLE PRECISION, y DOUBLE PRECISION, z DOUBLE PRECISION
);

-- Temp entities the browser draws for a moment (TE_*): 1 gunshot, 2 explosion,
-- 3 blood, 4 rail trail (to x2 y2 z2), 5 teleport effect, 6 blaster hit, 7 sparks,
-- 8 bfg explosion, 9 grenade explosion, 10 bubbles, 11 shotgun puff, 12 laser sparks, 14 bubble trail,
-- 15 a muzzle flash's light (n: its radius)
CREATE SEQUENCE fx_seq;
CREATE TABLE fx_events (
  id   INTEGER NOT NULL PRIMARY KEY,
  tic  INTEGER NOT NULL,
  kind SMALLINT NOT NULL,
  x DOUBLE PRECISION, y DOUBLE PRECISION, z DOUBLE PRECISION,
  x2 DOUBLE PRECISION, y2 DOUBLE PRECISION, z2 DOUBLE PRECISION,
  n    INTEGER DEFAULT 0 NOT NULL
);

-- Monster definitions: the data side of g_ai.c + each m_*.c.
CREATE TABLE monster_types (
  name        VARCHAR(16) NOT NULL PRIMARY KEY,   -- classname without monster_
  model       VARCHAR(64) NOT NULL,
  skin        INTEGER DEFAULT 0 NOT NULL,
  health      INTEGER NOT NULL,
  gib_health  INTEGER DEFAULT -40 NOT NULL,
  mass        INTEGER DEFAULT 200 NOT NULL,
  minx DOUBLE PRECISION DEFAULT -16 NOT NULL, miny DOUBLE PRECISION DEFAULT -16 NOT NULL, minz DOUBLE PRECISION DEFAULT -24 NOT NULL,
  maxx DOUBLE PRECISION DEFAULT 16 NOT NULL, maxy DOUBLE PRECISION DEFAULT 16 NOT NULL, maxz DOUBLE PRECISION DEFAULT 32 NOT NULL,
  flags       INTEGER DEFAULT 0 NOT NULL,          -- FL_FLY 1, FL_SWIM 2
  run_speed   DOUBLE PRECISION NOT NULL,           -- units per 10 Hz frame while running
  walk_speed  DOUBLE PRECISION NOT NULL,
  yaw_speed   DOUBLE PRECISION NOT NULL,
  stand_anim  VARCHAR(16) NOT NULL,
  walk_anim   VARCHAR(16) NOT NULL,
  run_anim    VARCHAR(16) NOT NULL,
  pain_anims  VARCHAR(80) NOT NULL,                -- ',' separated alternatives
  death_anims VARCHAR(80) NOT NULL,
  melee_anim  VARCHAR(16),
  melee_frame INTEGER,
  melee_range DOUBLE PRECISION DEFAULT 80 NOT NULL,
  melee_dmg   INTEGER,
  missile_anim VARCHAR(16),
  missile_frames VARCHAR(60),                      -- ',' separated frames that fire
  missile_kind VARCHAR(16),                        -- blaster shotgun machinegun grenade rocket …
  attack_chance DOUBLE PRECISION DEFAULT 0.3 NOT NULL,
  pain_chance DOUBLE PRECISION DEFAULT 1 NOT NULL,
  sight_snd   VARCHAR(64),
  idle_snd    VARCHAR(64),
  search_snd  VARCHAR(64),
  pain_snd    VARCHAR(64),
  death_snd   VARCHAR(64),
  attack_snd  VARCHAR(64),
  melee_snd   VARCHAR(64),
  drop_item   VARCHAR(40)                          -- what it leaves behind
);
