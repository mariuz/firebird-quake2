# How Firebird Quake 2 works

Quake 2 simulated and rendered inside a Firebird 6 database compiled to WebAssembly. The game
state is tables, the game logic is PSQL procedures, a frame is a query, and JavaScript only
parses the pak files, drives the input and paints pixels. This document describes the whole
machine, part by part, with the reasons behind the choices. The companion documents are
[ROADMAP.md](ROADMAP.md) (what is missing) and the repository's [CLAUDE.md](../CLAUDE.md)
(working notes for whoever, human or agent, works on this next).

Everything below refers to the Quake 2 3.14 demo data (`pak0.pak`: maps demo1–demo3, the base
unit's monsters and weapons). A registered `pak0.pak` loads the same way; nothing here knows
the difference except the map list.

## 1. Shape of the system

```
browser                                  Firebird 6 WASM (a Web Worker)
──────────────────────────────           ─────────────────────────────────────────────
src/pak.js    pak, PCX, WAL, colormap    tables: game, player, ents, nodes, leaves, brushes…
src/bsp.js    BSP v38 parser             sql/schema.sql    the tables and indexes
src/md2.js    MD2, SP2                   sql/physics.sql   traces, movement, linking
src/loader.js bulk loads it all  ─────►  sql/game.sql      entities, triggers, items, damage
                                         sql/weapons.sql   the player and the ten weapons
src/main.js   the page: loop, drawing    sql/monsters.sql  AI, pushers, the tic, map init
src/session.js maps, tics, the frame, saves (no DOM)
src/net.js     a game shared over a data channel: host, guest, the texts (no DOM)
src/demo.js    a .dm2 read as the server's messages, played between frames (no DOM)
src/lerp.js    the frames between tics: the last two tics' frames moved by the fraction (no DOM)
src/effects.js  explosions, beams, flashes, lights (no DOM)
   each frame:                           sql/render.sql    visibility and the frame
   SELECT * FROM q2_tic(...)      ─────► 20 Hz game logic, returns the player's view of itself
   SELECT * FROM frame_all(...)   ─────► everything to draw, hear and animate this frame
src/renderer.js  8-bit software painter (ref_soft re-done in JS)
src/hud.js       status bar, view weapon frames
src/audio.js     Web Audio spatialisation, looped speakers, music
```

The engine runs in a Worker through `firebird-wasm`; the page talks to it with
`db.query(sql, params, { rowMode: 'array' })`. Each query is a round trip to the worker (about a
millisecond in a browser), which is why the frame is one query and not six.

Which engine: the Worker (`firebird-engine-worker.js`, written by `scripts/build.mjs`) loads
`firebird-wasm`'s threaded build where the page is cross-origin isolated and its build without
threads everywhere else, which needs no `SharedArrayBuffer` and so no COOP/COEP: GitHub Pages
runs that one. The engine line of the page says which (", threads" for the threaded one). A tic
costs the same on both (5 ms idle on demo1, in a headless Chromium). `public/coi-serviceworker.js`
once supplied the headers on Pages; it is now a script that unregisters itself, for the browsers
that registered it. Every reference carries the build's id (`?v=`), so a fresh deploy never meets
a script cached from the last one.

## 2. Loading: the pak becomes tables (`src/loader.js`)

`createSchema(db, sql)` executes the six SQL files in order (`SQL_FILES` in loader.js). The WASM
build's `exec` splits on `;`, so procedure bodies are wrapped in `SET TERM ^ ;` and the files are
fed as one script each.

`loadResources(db, pak)` runs once per pak: every `.md2` with its PCX skins, every `.sp2`, the
frame runs (`anims`, from the frame names, with the sequence digit kept for names like `attak1`),
the 64 light styles, the `monster_types` table built from `src/gamedata.js` (and, for a monster whose
model the pak lacks, a model row without a mesh with the frame runs its table gives), and the single `game`,
`player` and `viewcfg` rows.

`loadMap(db, pak, res, name, { skill, newGame, spawnpoint })` parses the BSP (`src/bsp.js`) and
bulk-loads it, then calls `init_map`.

### Bulk loading

Each table is one `INSERT … VALUES (?, …)` run for every row by firebird-wasm's `execBatch`, 8,192
rows a call (`bulkLoad`; the column specs in `TABLES` give the names and which columns may be
NULL). Since firebird-wasm 0.4.1 a batch is one `IBatch` request to the engine for all its rows,
and since 0.4.0 a number crosses in binary where the column is a number, so the engine parses no
text and the BSP's coordinates arrive exactly. A row of `face_verts` costs ~12 µs, mostly the
insert into the primary key. The Outer Base loads in about two and a half seconds in Node,
`init_map` included. `face_verts` (37 k rows, a sixth of that) is read by `frame_faces` alone,
the SQL-projecting renderer mode: `loadMap(…, { faceVerts: false })` leaves it out and keeps the
rows in `res.world`, `ensureFaceVerts(db, res)` loads them later, and the page does exactly that
unless that mode is on (2561 → 2167 ms median, alternating four loads each). The scripts load
everything.

How it got here: row-by-row `exec()` of 90 000 rows took minutes, and the WASM build bound every
parameter as text, so each table had a generated `LOAD_<table>` procedure that parsed one 30 KB
chunk of fixed-width rows in PSQL, one `INSERT` of `CAST(SUBSTRING(:s FROM :p + :o FOR :w))` per
row, `TRIM`/`NULLIF` only on nullable columns (five and a half seconds, then three). 0.4.0's
`execBatch`, a statement execute per row inside the engine, measured 13 % slower than those
procedures, whose `INSERT` is a node of one compiled request; 0.4.1's `IBatch` measured 15 %
faster, and the generated PSQL is gone.

### What the BSP becomes

| table | from the BSP | notes |
|---|---|---|
| `nodes` | NODES + PLANES | the plane copied in; `c0`/`c1` children (negative = leaf), `cc0`/`cc1` the child leaves' contents, so a trace can skip an empty leaf without visiting it |
| `leaves` | LEAVES | cluster, area, bounds, `first_lf`/`num_lf`, `first_lb`/`num_lb` |
| `clusters` | VISIBILITY | each cluster's PVS decompressed to a hex string (`pvs`); a leaf with no cluster has no row, which reads as everything visible. Once per cluster, not on each leaf: the column's 2048-character width tripled the cost of writing a leaf |
| `leaffaces`, `leafbrushes` | the index arrays | |
| `brushes`, `brushsides` | BRUSHES, BRUSHSIDES + PLANES + TEXINFO flags | brush bounds are computed by the loader (union of the leaves that reference the brush, then tightened by its axial sides) |
| `faces` | FACES + PLANES (flipped for `side`) + TEXINFO | the texture's `.wal` name, SURF_* flags, texel vectors, and a bounding sphere (`cx cy cz radius`) |
| `face_verts` | EDGES and SURFEDGES resolved to an ordered vertex list | read only by `frame_faces`; the page loads it on demand |
| `textures` | TEXINFO names | |
| `models` | the world and its `*N` submodels, plus every MD2 and SP2 | `kind` B/M/S, bounds, `headnode`, `radius` |
| `areas`, `areaportals` | AREAS, AREAPORTALS | the portals between areas; `portal_state` (open while a door holds it) and `area_flood` (which areas are connected, `FloodAreaConnections`) are derived at run time |
| `map_ents` | the entity lump | one row per entity with the Quake 2 keys as columns |

Lightmaps are not in SQL: the painter reads them from the parsed BSP (`bsp.lightdata`), collapsed
from RGB to the brightest channel the way `Mod_LoadLighting` did for ref_soft.

### Game state tables

`ents` is the entity table: one wide row (about 120 columns) per edict, with the Quake 2 fields
(origin, angles, velocity, bounds, model, frame, skin, flags, health, movetype, solid, think,
nextthink, targets, pusher state…) plus port-specific ones: `leaf`, `cluster`, `cl2`, `cl3` (the
leaf and the clusters the box touches), `lx ly lz` (where it was last linked), `mkind`/`mradius`
(the model's kind and radius, copied in by `set_model`), `vis_cl`/`vis` and `fl_*`/`faces_lst`
(brush-model visibility caches, section 6). `player` holds the clients, a row each (one in single
player, two in coop; `ent_id` is the client's edict, and the game's routines find the row by it): ammo,
armour, weapons, keys, timers, pitch, punch, step smoothing, the player model's animation; `coop_respawn`
is each client's pers as the level began, which a coop respawn puts back; `usercmd` is each client's
command for the tic. `game` is the level: time, tic, skill, counts, the next map, `has_water`, `coop`,
`sight_client` (the client the monsters look for this tic). `sound_events` and `fx_events` are the outgoing queues (section 7).
`clip_planes` and `pushed` are global temporary tables standing in for the C arrays of
`SV_FlyMove` and `SV_Push`.

## 3. Collision (`sql/physics.sql`)

Quake 2 ships no clipnodes: traces test the moving box against the brushes of the leaves the
segment passes, with every split plane pushed out by the box's extents. The port is a direct
translation of `cmodel.c`:

- `rhc(node, p1f, p2f, p1, p2, s1, s2, mins, maxs, extents, mask, ispoint, state…)` is
  `CM_RecursiveHullCheck`. It descends iteratively while the whole segment is on one side of
  the plane (skipping into an empty leaf costs nothing: `cc0`/`cc1` say what the child leaf
  contains), and recurses only at a split, near side first, with the `DIST_EPSILON` overlap.
  The trace state (fraction, hit plane, surface flags, contents, allsolid, startsolid) threads
  through its parameters and return values. The plane distances and the box offset come out of
  the node fetch's select list.
- `clip_leaf` is `CM_ClipBoxToBrush` over the leaf's brushes whose contents match the mask,
  as one cursor over `leafbrushes → brushes → brushsides` that finalises a brush when the next
  one begins. It clips the **whole** segment (`s1`, `s2`), as `CM_TraceToLeaf` does; clipping
  the sub-segment the leaf sees was a real bug (phantom zero-fraction hits).
- `trace_hull(head, origin, mins, maxs, from, to, mask)` runs `rhc` against one model.
- `trace_move(mover, mins, maxs, from, to, mask)` is `SV_Trace`: the world, then every solid
  entity whose box the swept box touches: brush models through their own `headnode` (rotating
  ones traced in their own rotated space, as `CM_TransformedBoxTrace` does, via `angle_matrix`),
  monsters and the player as boxes through a Minkowski slab test (`trace_box`), with
  `CONTENTS_MONSTER` / `CONTENTS_DEADMONSTER` so bullets hit corpses and players walk through them.
- `point_leaf`, `model_point_leaf`, `point_contents` are the tree descents (`CM_PointLeafnum`,
  `SV_PointContents`); `point_contents` also looks inside brush models standing on the point.
- `fly_move` (`SV_FlyMove`, clip planes in the GTT), `walk_move` (the 18-unit step, for the
  player), `move_step` (`SV_movestep` for monsters: step up, trace down, don't enter water),
  `toss_move` (`SV_Physics_Toss`: gravity, bounce, rest), `push_entity`, `clip_velocity`.
- `link_ent` / `link_core` are `SV_LinkEdict`: the origin's leaf and cluster plus the clusters
  of two opposite box corners (`cl2`, `cl3`). An entity that has not moved is not relinked; a
  step that stays in the same leaf keeps its cluster list; a brush model's probe is its box
  centre, not its far-away origin; a model whose probes all fall in solid (a fan's hub) has no
  cluster and is always drawn.

Contents masks are the Quake 2 constants: MASK_PLAYERSOLID 33619971, MASK_MONSTERSOLID 33685507,
MASK_SHOT 100663299, MASK_OPAQUE 25, MASK_WATER 56, MASK_SOLID 3.

## 4. The game (`sql/game.sql`, `sql/weapons.sql`, `sql/monsters.sql`)

`q2_tic(tics, fwd, side, yaw_d, pitch_d, fire, jump, run, imp)` runs one or two 20 Hz tics
(the page catches up by at most two per frame) and returns a row per client, the first first (its
`client` column says which): each player's view of itself: health,
ammo, weapons, position and angles, view height and punch, messages, damage flash values,
level counts, water, powerups, the eye's leaf and cluster. The parameters are the first client's usercmd;
a coop game's second client has its row in `usercmd`, written before the tic. Each tic
(`G_RunFrame`: `ai_set_sight_client` first, then `player_think` for each client in turn):

1. `player_think` – pmove.c: ducking (`PM_CheckDuck`: a box 4 high, the eye at -2, 100 units per
   second; standing up only where the full box fits), friction, acceleration (300/200 units per second,
   no air acceleration), jumping (270), swimming, water transitions and drowning, lava and slime,
   then the move (`walk_move` or `fly_move` in water), the ground probe a quarter unit down
   (`PM_CatagorizePosition`: the move alone finds the floor only by falling onto it), the relink, the
   view's bob (`bobtime`, `bob_z`, `bob_pitch`, `bob_roll` on `player`, read by `view_setup`
   and `q2_tic`; the page sways the gun from `BOBTIME` and `XYSPEED`), the step smoothing, touching
   triggers and items, door and plat trigger fields, megahealth rot, then `player_fire`. A player
   standing still on the ground with no velocity makes no move; the floor is re-checked twice a
   second. The player and entity rows are each written once per tic.
2. `run_pushers` – doors (with teams, and the area portals they target: open on the way up, closed at
   the bottom), rotating doors, plats, buttons, trains and path corners,
   rotating fans, timers, falling `func_object`s; a blocked mover does what g_func.c's `*_blocked` did
   (`mover_blocked`: anything not a monster or the player is blown away; trains hurt every half second): `push_move` is `SV_Push` with the pushed set in the `pushed` GTT, the
   crush and the blocked callbacks; an idle pusher costs nothing.
3. `run_physics` – the thinks that are due (dispatched by name in `run_think`), then
   `SV_Physics_Step`/`Toss` for everything that falls, flies or bounces, then monsters touching
   `trigger_hurt` and `trigger_monsterjump` on maps that have any.

The rest of g_*.c lives here too: `spawn_map_ents(skill, spawnpoint)` is `SpawnEntities` with the
skill spawnflag filter (256/512/1024 keep an entity out of easy/medium/hard, nightmare (3) reading hard's bit;
all three mark a deathmatch-only entity; 4096, not-in-coop, is ignored in single player) and Quake's spawn-point selection (`info_player_start` with the
matching or absent targetname); triggers (once, multiple, relay, always, counter, key, push,
hurt); `use_targets` is the big dispatcher for targets (speaker, explosion, splash, secret, goal,
help, laser, lightramp, changelevel, and the unit's cross-level flags on
`game.serverflags`: `target_crosslevel_trigger` sets them, `target_crosslevel_target` fires when they
are set); items from stimpacks to the power
shield, ammo, keys, timed powerups (g_items.c: `item_pickup` is the pickup functions, `item_touch` is
`Touch_Item`; the power cubes are `SpawnItem`'s, each with a spawnflag bit of its own that `Pickup_Key`
sets in the client's `cube_mask` and counts in `power_cubes`, and `trigger_fire` spends one at a time as
`trigger_key_touch` did); the inventory by itemlist index (`inv_count` reads a count from wherever the game keeps it:
weapon bits, ammo, armour, key bits and the cube count, the `inv_*` columns for powerups and power armour; `inv_select` and
`inv_validate` move `inv_sel`; `use_item` is `Cmd_Use_f` with the use functions; `inv_impulse` takes
impulses 13–21: invuse, invnext, invprev and the item keys; `inventory_list` is the inventory screen's rows);
the ten weapons (p_weapon.c, g_weapon.c:
bullets with the 8192-unit spread, rail, blaster bolts, grenades with the held-grenade timing,
rockets, hyperblaster, BFG with its think); `t_damage`, `t_radius_damage` (to `findradius`'s radius, with `can_damage`'s five lines of sight), armour
(`CheckArmor`, with energy damage less well stopped, power armour), knockback, gibs (g_combat.c,
g_misc.c); the BFG ball's lasers (`bfg_think`), its strike and its final blast a frame later
(`bfg_explode`). Sounds and temp entities
are rows: `snd`, `snd_at` and `fx` insert into `sound_events` / `fx_events`.

Monsters are g_ai.c's state machine over the `monster_types` table (`src/gamedata.js`: model,
health, bounds, speeds, animations, missile frames, sounds). `monster_think` runs at 10 Hz in
sight of the player: `find_target` (PVS, range, in-front, then a visibility trace), `move_to_goal`
/ `new_chase_dir` / `step_direction` for walking and chasing, `check_attack`, `monster_melee`,
`monster_missile`, pain and death with corpses and gibs. Out of the player's PVS a standing
monster thinks at 3 Hz and a patrol strides four times as far at 2.5 Hz, with
`SV_CloseEnough`'s stride-sized path-corner check. Idle and search sounds follow `ai_stand`'s and
`ai_walk`'s 15–30 second timer (`ents.idle_time`). A `combattarget` makes `found_target` send the
monster to that `point_combat` first (`aiflags` 2, `AI_COMBAT_POINT`), and `point_combat_touch`
moves it on, fires the point's pathtarget, or holds it there (`aiflags` 1, `AI_STAND_GROUND`). A
player's bolt, rocket or BFG ball is traced along its flight (`check_dodge`) and the soldiers,
infantry and gunners it would hit duck a quarter of the time (`monster_dodge`, `aiflags` 4); on medium
and hard a soldier often crouches and fires instead (state `attack3`, the `attak3` frames, timed by
`pausetime` as `monsterinfo.pausetime` timed them, `aiflags` 8 holding the SS's burst). `check_attack`
says whether the enemy is in sight (1 attack, 0 seen, 2 not) and notes the sighting (`ls_x/y/z`,
`trail_time`, `search_time`); out of sight, `ai_pursue` steers by `aiflags` 16/32/64 to the last sighting
(detouring by a spot to one side, `aiflags` 128 and `sg_x/y/z`, when the box cannot go straight) and then
the `player_trail` markers that `player_trail_check` drops at 10 Hz (`move_to_goal` and
`new_chase_dir` take a spot as well as an entity for that). The demo's monsters: soldier (light, shotgun,
machinegun), infantry, gunner, berserker, flyer, parasite, tank. The full game's, as logic: gladiator, iron
maiden (chick), brain, medic, mutant, icarus (hover), technician (floater), barracuda shark (flipper), the
supertank, the hornet (boss2), Jorg and Makron (boss3), the insane marines. Each is a row like the others
with a frame table of its own (`anims`: the runs of m_*.h, in the model's order), which the loader turns
into a model row without a mesh and its `anims` rows when the pak lacks the MD2 (the demo pak does), so the
logic animates, fires and dies on the right frames and the painter, having no mesh, skips it; a registered
pak's MD2 takes over. Their attacks are kinds of `monster_missile`: 1- and 2-damage bolts (hover, floater,
medic), Makron's hyperblaster, the bosses' 6-damage machine guns (`chaingun`), the gladiator's and Makron's
railgun, Jorg's and Makron's BFG; a second ranged attack (`alt_anim`, `alt_frames`, `alt_kind`,
`alt_chance`: the supertank's rockets beside its machine gun, the hornet's, Jorg's BFG) is chosen by its
chance when a missile is due and fires its own kind on its own frames, and Makron picks the BFG, the railgun
or the hyperblaster a third each (`Makron_CheckAttack`). Jorg's death spawns Makron where it fell, unseen for
four seconds (`makron_toss`, as `MakronToss`). What is not there yet is in ROADMAP.md: the medic's cable,
the mutant's leap, the floater's zap, the chick's duck, the insane marines' crawling and crucified forms.

## 5. Visibility and the frame (`sql/render.sql`)

The renderer is a query because the data it needs is already relational: faces with planes and
spheres, leaves with clusters, clusters with PVS bits.

`view_setup` computes the eye (origin + view offset − step smoothing), the view axes from yaw,
pitch and the death roll, the projection scale, and the eye's leaf (cached on `viewcfg` while the
eye stands still) with its cluster and PVS.

`mark_faces(pvs, cluster, leaf)` is `R_MarkLeaves`, run when the eye's cluster or area changes or a
portal opens or closes: every face of every leaf whose cluster is in the PVS, in an area connected
to the eye's through open portals (`area_flood`), goes into `vis_faces` (`DISTINCT`, Quake's `visframe`),
with its plane and bounding sphere copied in so the frame is a scan of that table alone. A face
whose plane has the cluster's whole bounding box behind it is left out: no eye in the cluster
can ever face it. The PVS's leaves are found by decoding its set bits and looking each visible
cluster up through `leaves_cluster` into a temporary `vis_leaves`; a scan of every leaf testing its
bit in the hex string cost three times as much (~5 µs a leaf). Their faces come in by primary key
from a `DISTINCT` over `leaffaces`, which beat scanning every face with an `IN`. A new cluster
costs ~17 ms (it was ~43). The marking itself is `build_vis_set(pvs, cluster, area, slot, used)`;
`mark_faces` runs it for the view and switches to the slot. The last sixteen marked sets are kept,
each in its own slot of `vis_faces` (primary key `slot, face`; `vis_sets` says which cluster and
area a slot holds and when it was last used), so walking back into a recent cluster is a switch of
`viewcfg.vis_slot` (~0.3 ms); the frame reads `WHERE v.slot = :vslot`, which costs nothing
measurable. A new map or a load (`viewcfg.vis_cluster` reset) drops all the sets; a portal opening
or closing (`flood_areas`) only those whose area's connections changed, each set keeping the areas
its flood joined when it was marked, and the eye's set going means marking afresh.

`premark_ahead()` marks before the eye arrives: the page calls it after each frame whose tic, query
and raster left spare time, and it probes four points (half a second and a second along the
player's velocity, 128 and 256 units along the view) and builds a set for the first whose cluster
and area have none, in a free slot or the one used longest ago that is not the view's (~0.3 ms
when there is nothing to do, a mark's cost when there is). On a 400-tic walk through demo1's first
rooms, 18 clusters crossed, frames over 8 ms went from 19–22 to 9–10 with sixteen slots (with
eight they thrashed: 29 marks for 18 crossings, 15 hitches left). What stays are the corners where
two or three small clusters are crossed within a few tics, and the first frame's mark.

`frame_all(mode, last_sound, last_fx, want_speakers, client = 1)` returns the frame of the client's view
(`view_setup(client)`: its eye; its own model left out, the other client's in) as kind-tagged rows
(`kind`, `i1..i5`, `d1..d8`, `s`, `lst`):

| kind | rows | contents |
|---|---|---|
| 1 | one per model | `i2` entity (0 = world), `d1..3` origin, `lst` the visible face ids as a `,`-separated list |
| 8 | one per vertex (mode 1 only) | the SQL-projected vertices: face, seq, entity, view-space f/r/u, screen x/y, texel s/t |
| 2 | one per alias model or sprite in view | id, model, frame, skin, effects, origin, angles, alpha, renderfx, kind |
| 3 | one | light styles that animate or that the map has switched, as `style:letter` pairs |
| 4 | one per new sound | id, entity, channel, volume, attenuation, position, name |
| 5 | one per new effect | id, kind, count, from, to |
| 6 | one per posed brush model | id, frame, angles |
| 7 | one (when asked) | the looped speakers that are on |
| 9 | one per looped entity sound | entity, position, name (`s.sound`: missiles, moving movers, the player's hum) |

The world's faces are the scan of `vis_faces` with the back-face test and the frustum tests as
expressions, `LIST()`ed into one row. The frustum is four world-space planes (`kx·f ∓ r`,
`ky·f ∓ u`), each a one-sided sphere test that fails at the first plane a face is outside; the
eye's part of every dot product is a constant of the frame. The whole list is kept on `viewcfg`
with the view it was made for and reused while the eye holds still.

Brush models (doors, plats, the fan) are the second pass: for each one in the PVS (decided once
per view cluster and kept on the row), the model is tested against the frustum as a whole, then
its faces at its origin (rotated models skip the per-face tests: the painter clips them), as one
list per model; a model's list is kept on its row with the view stamp and pose it was made for.
Brush models take no area test: a door straddles two areas and was sent to a client in either
(`SV_LinkEdict`'s `areanum2`), and the demo maps' one portal each has its door in it.

Alias models and sprites are one cursor whose `WHERE` holds the frustum tests, the PVS test
(an expression on the eye's leaf row, joined in, over the entity's three cluster columns) and the
area test (the entity's area in the eye's flood), so only the entities drawn reach PSQL.

`frame_faces_fast` and `frame_ents` are thin wrappers over `frame_all` for the scripts and the SQL
console. `frame_faces` is the other renderer mode, selectable on the page: it projects every vertex
in SQL (one cursor over the selected faces' vertices with the rotation, the view transform and the
projection in the select list) and the painter only scan-converts; both modes paint identical
pixels (`node scripts/screenshot.mjs demo1 --compare`), which is the renderer's regression test.
Both select the same faces with the same tests, a brush model's whole-model sphere included
(`R_DrawBrushModel`'s `R_CullBox`; for a rotated one, a sphere about its origin wide enough for any
angle, and no per-face test after it): `frame_faces` once lacked that test and sent all 24 of the fan's
faces from anywhere in its PVS, which no pixel showed. `test:session` compares the two selections,
the world's and the brush models', at the start and by the fan.

## 6. The painter (`src/renderer.js`)

ref_soft in JavaScript: an 8-bit framebuffer of palette indices and a float z-buffer, converted to
RGBA through the palette on `present` (with the damage/powerup/water tint as a palette blend).

- **Surfaces.** `surface()` returns the face's texture tiled under its lightmap through
  `colormap.pcx` (64 shades × 256 colours), built by `buildSurface` the way `R_DrawSurfaceBlock8`
  did: one row of light values interpolated per texel row, stepped along it; the texture column
  wrap is tabled. Surfaces are cached by face, texture (animation frame) and the face's light
  style values and the mip level; the cache clears at 2000 entries and when the brightness setting
  changes. The level is chosen per polygon in `drawSurfacePoly` (`mipLevel`, `D_MipLevelForScale`:
  the nearest vertex's 1/z × `view.scale` × the texinfo's `mipadjust`); a surface at level k is
  `extents >> k` from `tex.mips[k]`, and its `ms` (1/2^k) scales the texels in `fillPolygon`.
- **Texture animation.** A texture's `.wal` names the next picture of its animation (`animname`);
  `animChain` follows them round once, and `surface()` takes the picture at the frame modulo the
  chain's length (`R_TextureAnimation`). The world's frame is the time at 2 Hz; a brush model's is its
  entity's frame, which the server sets and the client cycles by the effects (`entityFrame`,
  `CL_AddPacketEntities`): EF_ANIM01 0/1 and EF_ANIM23 2/3 at 2 Hz (a button at rest and pressed),
  EF_ANIM_ALL every frame at 2 Hz and EF_ANIM_ALLFAST at 10 Hz (the ANIMATED spawnflags). The
  frame query sends a brush model's frame and effects (kind 6) when either asks for something.
- **The underwater view.** At more than 320×240, `beginUnderwater()` draws the frame into a 320×240 warp
  buffer, as `R_RenderFrame` pointed `d_viewbuffer` at `r_warpbuffer`; `warpScreen(time)` is `D_WarpScreen`: the frame (or that buffer, read up to the screen) copied aside and read back
  through the turbulence table (row offsets by column, column offsets by row); `drawFrame` calls it
  after the view weapon when `WATERLEVEL` is 3, before the status bar.
- **Model lighting.** `drawAlias(…, light, { dlight, minlight, glow })` is `R_AliasSetupLighting`: the
  lightmap light (scaled by the brightness) plus the dynamic part, `RF_MINLIGHT` and `RF_GLOW` applied,
  ambient and shade clamped as ref_soft clamped them, the shade by the normal's x.
- **Dynamic lights.** `renderer.dlights` is the frame's lights (`Effects.lights` in `src/effects.js`: muzzle
  flashes from fx 15, projectiles by their effects bits, explosions fading; the frame sends a projectile
  in the PVS whether it is in the frustum or not, so one flying past lights what is in view). `faceDlights` is
  `R_MarkLights` face by face (the plane distance, the reach across the face); a face it returns lights
  for is built by `buildSurface` with `R_AddDynamicLights`'s term added to the samples and is not
  cached. `dlightAt` is `R_LightPoint`'s dynamic part for models and the view weapon.
  `scripts/painter-test.mjs` checks it headless; `scripts/screenshot.mjs --flash` paints frames lit by a
  muzzle flash.
- **Polygons.** `drawFaceList` takes the frame's face rows, transforms the BSP vertices it holds
  (with the brush model's origin and rotation matrix), clips at the near plane in view space and
  scan-converts with `fillPolygon`: 1/z, s/z, t/z affine in screen space, the texel coordinates
  divided out every 16 pixels (`D_DrawSpans16`), the depth test on every pixel. Warping surfaces
  ripple with a sine table and flow; translucent surfaces are drawn last and blended through the
  alpha map; the sky is the `env/` cube map sampled by each pixel's ray, stepped along the span, the
  view's axes first turned back by the map's sky rotation (`skyTurn`, `renderer.skyRotate`/`skyAxis`).
- **Alias models.** `drawAlias` transforms, lights (ambient plus Gouraud from the vertex normals)
  and projects each vertex once, then draws the triangles back-face culled, clipping only those
  that cross the near plane; `triangle` is an affine-textured Gouraud triangle with z-test, used
  by sprites too. The view weapon is drawn after clearing the z-buffer, with a closer near plane.
- **Particles and beams** are cl_fx.c's: explosions, blood, blaster sparks, the rail spiral,
  teleport fog, laser beams as particle lines.
- **Explosions** are `CL_AddExplosions`' list in `src/effects.js` (an `Effects`, cl_tent.c's temporary
  entities, which also keeps the beams, the parasite's tongue and the muzzle flashes): the `r_explode` and
  `explode` models and the `s_bfg2` sprite, stepped at 10 frames a second, skins and translucency by frame and
  alpha, drawn fullbright (`drawAlias`'s `fullbright`, `alpha` 1 for 33% and 2 for 66%); their lights come from
  the same list in `Effects.lights`. `add` takes the frame's effect rows, `lights` gives the frame's dynamic
  lights and drops what has played out, `draw` paints after the entities; the chances come from a `random`
  a test can give.
- **2D** (`src/hud.js`): `single_statusbar` from `pics/` (health, ammo, armour flashing with power
  armour, the selected item; the pickup's icon and name, the powerup timer, the help icon), the
  crosshair, centre prints, the help computer and the inventory screen (`CL_DrawInventory`), with
  `ITEMS`, `ITEM_KEYS` and `TIMER_ICONS` from `src/gamedata.js`.

`scripts/raster-bench.mjs` times the painter per stage; `--cold` rebuilds every surface each frame.

## 7. Sound (`src/audio.js`)

`sound_events` rows are played with the Web Audio API, attenuated and panned by Quake 2's rules
(full volume within 80 units, then `attenuation × 0.001` per unit). The map's looped
`target_speaker`s sound from their origins and follow their on/off state from the frame's kind 7 row;
as in 3.14, where a looped speaker is its `s.sound`, they are mixed with the entities' loops below.
The entities' looped sounds (Quake 2's `s.sound`) are worked out each frame from the rows as they
stand, not kept in a column: a bolt's `misc/lasfly.wav`, a rocket's `rockfly`, the BFG ball's
`bfg__l1a` while they fly; a door's, plat's or train's middle sound (`noise2`) while it moves
(`mv_done` set), from a team's master only; and `G_SetClientSound` for the player (lava or slime
fry, the railgun's or BFG's hum, the hyperblaster's or chaingun's firing loop, `player.weapon_sound`).
The page mixes them as `S_AddLoopSounds` did: one looped channel per sound name, every entity with that
sound adding its spatialised left and right at full volume and `ATTN_STATIC`, each side clamped.
The loops fall silent while the game is paused or in a menu.
Music was CD audio: `public/music/trackNN.ogg|mp3`, or a folder picked on the page, plays each map's
`worldspawn` track; without them a synthesised drone fills in.

## 8. The page (`src/main.js`, `src/session.js`, `public/`)

What the server did in single player is `src/session.js`, a `Session` with no DOM: a map started
(`startMap`, which returns the sky, the CD track and the looped speakers for the page to set up) or a
level of the unit come back to as it was left (`coop: true` puts a second client in), a tic run (`tic`, the
usercmd in, a coop game's second as a second argument; `last` is the first client's row, `clients` every
client's), the frame read in one
round trip and decoded (`frame`, `decodeFrame`: the faces, the entities, the light styles, the sounds and
effects not yet played, the brush models' frames and angles, the looped speakers every tenth frame; `client`
picks whose view), a
level left (`leave`, which keeps the clients' health and flags for the next level as `SaveClientData` did, then
keeps the level or, at a unit's end, forgets the unit), and the slots written, read,
listed and loaded against a storage object. `src/main.js` holds one and does what only a page can: the
canvas, the sound, the status line, the keys and the menus' host. `scripts/session-test.mjs` drives a
`Session` headless through the same calls.

A coop game (the Players select, or the game menu's players spin, for the next new game; a save remembers)
is two to four clients on one page (`init_map`'s `nclients`, the second on at the map's `info_player_coop`
in order; `settings.players`, `Session.players`): the keys, the mouse and the touches are the first player's
command, a gamepad each the others' in the order the browser lists them (`Input.read(…, { pad: false })` and
`Input.readPad(tics, settings, index)`), all sent with the tic (`Session.tic(cmd, …cmds)`, a usercmd row per
client); the frame is asked for once per client (`frame({ client })`), the sounds and effects with the first
(the first player is the listener), and the painter draws each view into a screen split along the middle for
two, or in quarters for three or four (`Renderer.setSize(w, h, views)`, `present(…, view)`; the SQL's
`viewcfg` is the one view's size, the fov being horizontal; 640×480 gives four views of 320×240, and the
status bar overflows a narrower one at its sides). The menus and the pause take the whole screen again. The
help computer and the inventory screen are per view: F1 and Tab are the first player's, a pad's Back and Y
its player's (`Input.padScreens`, `padScreens`), its d-pad the inventory's keys (`padImpulse`: invnext,
invprev, invuse), its Start the menu; the particles are run once a frame and drawn in every view.

A deathmatch (the Players select's third choice, or the players spin; `init_map(…, 0, 1)`, which sets
`game.deathmatch` and clears coop, as the cvars did) is two clients against each other. The spawn keeps
out `NOT_DEATHMATCH` entities instead of the skill's and every monster, and `dmflags` leaves out the
health, the armour, the powerups or the ammo as g_local.h's bits say; each client starts afresh
(`init_client_persistant`) at a deathmatch spot (`dm_spawn_point`: `SelectRandomDeathmatchSpawnPoint`'s
one at random of all but the two nearest a living client, or `SelectFarthestDeathmatchSpawnPoint`'s with
`DF_SPAWN_FARTHEST`; `select_spawn_point` picks that or the coop spot), and `respawn` brings a dead one back
the same way, its weapon tossed where it died (`toss_client_weapon`). A map's item taken is hidden
(`set_respawn`: no model, not solid, a think) and `item_respawn` brings it back after `respawn_delay`'s
seconds with the sound and the particles (fx 17), the mega health through `mega_think`; `item_pickup`
has the deathmatch rules (weapons stay, a new one raised only over the blaster, instant items, no powerup
limit) and `player_fire` spends no ammo with `DF_INFINITE_AMMO`. The frags are `client_obituary`'s on
`player.score`, in the tic's row (`score`, with `deathmatch`) for the status bar's top right and the score
board (`Hud.drawScores`, F1 in place of the help computer and at the intermission); `changelevel` kills the
client at an exit unless `DF_ALLOW_EXIT`, `check_dm_rules` (each tic, exiting at once outside a deathmatch)
ends the level at the frag or time limit through `end_dm_level` and the intermission. The cvars `dmflags`,
`fraglimit` and `timelimit` are console commands the session gives each map load (`Session.cvars`) and
the page keeps in its settings.

A game over the network (`src/net.js`) is a coop game whose second client is on another page. The host's
page is the server, as sv_main.c was: its `Session` runs the game with two clients, and each tic the second
client's usercmd is what `HostLink.takeCommand` merges from the commands the guest sent since the last tic
(the turns summed, a button pressed in any held, the latest movement and run, the last impulse; none, the
guest stands, as a client whose packets did not come stood; a guest sends one every animation frame, so
only a paused, hidden or menu-bound page is silent). After the tic the host asks the frame once for itself and once for
client 2 in the fast mode and sends the guest that frame (`sendFrame`: the faces as `[face, entity, origin]`,
the entities, the loops, the styles, the brush models' frames and angles, the guest's own `Q2_TIC` row, the
tic's sounds and effects, which came with the host's own frame query, and the inventory rows when the
guest's screen is up), dropping it when the channel has more than 256 KB queued. The guest's page
(`GuestLink`) sends its userinfo (the player setup's name and hand, an `info` message) at the connect, then
`Input.read`'s command each of its own tics, and paints the newest frame it holds
exactly as the page paints its own (`drawFrame`), the sounds at its own ear, the effects and particles run
there; it loads the pak as every page does and, at each map message (sent from `mapLoaded`: the name, the
sky and its rotation, the CD track, the looped speakers, the host's view size and fov, which the guest's
frustum must match), the map's geometry for the painter alone (`loadMapModels`, the BSP and its brush
models into `res` with no database), so it runs no game logic and its own Firebird stands idle. A picture
at a unit's end is sent too. The wire is JSON in chunks of 16,000 characters over one ordered data channel
(`Link`), a frame of demo1 being 10–30 KB; the two sides know nothing of WebRTC and the network test runs
them over `Loopback.pair()` in one process. `Peer` holds the `RTCPeerConnection`: the host makes an offer,
gathers its candidates (at most three seconds for the STUN server; one machine or one network needs none)
and shows the description as a text (`packSignal`: gzipped and base64'd, some six hundred characters), the
guest answers it the same way, the host accepts the answer, and `ready` resolves with the Link when the
channel opens. There is no prediction: a guest sees its own move a round trip late, as a Quake 2 client
with `cl_predict 0` did; the roadmap has what a prediction would take. When the guest leaves, the host's
game goes on with its second client standing (the gamepad moves it again); when the host leaves, the
guest's page says so and starts a game of its own on a key.

A demo of the pak (`src/demo.js`; the Demo select, or `demomap <name>` at the console) plays as the attract
loop played it. `parseDemo` reads the `.dm2` up front as `CL_ParseServerMessage` read the server's stream: a
block an int32 length and its messages, the server data, the configstrings (the models, sounds, images and
light styles by index), the spawn baselines, then a frame a block (`svc_frame`: the player state as
`CL_ParsePlayerstate` delta-read it from the frame it names, the packet entities as `CL_ParseDelta` read
each against its last state or baseline), with the sounds, temporary entities, muzzle flashes and prints
that came before it; a block not consumed to its last byte is an error, which is how the protocol (31, the
3.14 demo's) is known to be read right. `DemoPlayer.at(t)` gives the view (origin, view offset, angles with
the kick, the gun, the blend, the stats) and the entities lerped between the frame at `t` and the next
(`CL_AddPacketEntities`: an entity in both moves, one just come snaps), the brush models apart by name, the
looped sounds, the light styles from the configstrings, and the events of every frame reached since the
last call, once; `soundRows` makes the sounds the page's rows (a sound without a position plays where its
entity is) and a flash its weapon's sound and light. The page loads the demo's map as for a new game and
`Session.demoBegin` hides the game's own alias models and sprites (the recording brings its own); each
display frame `Session.demoFrame` moves the player's entity and row to the recording's view (the eye the
frustum and PVS take) and each brush model to where the demo has it (written only when it moved), and asks
`frame_all` as for the page's own game: the walls are the database's, everything else the recording's, and
no tic runs. `demoRow` makes the player state the page's `Q2_TIC` row (the stats as the status bar reads
them, the gun model, frame and angles the server sent, the blend), so `drawFrame` paints it unchanged. A key,
a click, the pad or the demo's end stops it and a new game starts, as the attract loop gave way to the menu.

Boot opens `memory://quake2` through the Worker, loads the pak (the fetched demo or a user-picked
`pak0.pak`), creates the schema and resources, and starts the map. Settings (map, skill, detail: 160×120, 320×240 or 640×480,
brightness, renderer mode, sound, music) persist in `localStorage`. Input (`src/input.js`, an `Input`
the page attaches to the canvas and reads each tic as the usercmd, the page keeping the keys that
are its own): WASD/arrows, or whatever the keys menu bound (`settings.binds`), mouse look under pointer lock; on a touch screen the view's left half moves and its right half looks, a tap
fires, and on-screen buttons (shown where the browser reports touch points) fire and jump while
held, change weapon and open the menu; a gamepad (`src/gamepad.js`, the Gamepad API's standard
mapping, polled each frame) moves with the left stick, looks with the right at the keyboard's
turning speed scaled by the mouse sensitivity, fires with RT, jumps with A, crouches with B, changes
weapon with the bumpers, opens the menu with Start and drives it with the d-pad, A and B; `default.cfg`'s weapon keys (1–5 blaster to chaingun, 6 grenade launcher, 7 rocket
launcher, 8 hyperblaster, 9 railgun, 0 BFG10K, `G` hand grenades) sent as impulses that are the weapons
in item order (1 blaster … 6 hand grenades … 11 BFG10K), `/` or the wheel for the next weapon with ammo
(12), `P` pauses; everything (99) is the console's `give all`. On touch screens the halves of the
screen move and look.

Leaving a level: `changelevel` keeps the `target_changelevel`'s map string as written in `game.next_map`.
A string with `*` (a unit's end) starts the intermission: `begin_intermission` moves the player to an
`info_player_intermission` with its angles and no view height, and `q2_tic` then holds the world still
until fire or jump after five seconds; any other string sets `exit_kind` at once. The page reads the
string the way `SV_Map` did (`src/levels.js`: `map$spawnpoint`, a leading `*`, `a+b` chains, `.pcx`
pictures shown in their own palette, `.cin` cinematics skipped) and loads the next map behind the
loading plaque. `F1` toggles the help computer (`HelpComputer`): skill, level name, the two
`target_help` messages and the counts; it is also drawn at the intermission.

The console: the backquote opens a command line over the view. `map <name>`, `save`, `load`, `fov`,
`seed` and `skill` are the page's (`skill 0`–`3`: the next map's skill, 3 the nightmare the menus stop short
of, latched as the cvar was: "skill will be changed for next game."); the rest go to `player_command(cmd, arg)`
(g_cmds.c: `god`, `notarget`, `noclip`, `give`, `kill`), which answers on the top-left message line. Noclip is movetype 2: `player_think` moves the
player where the view points without tracing and skips the touches, as `ClientThink` did.

The menus (`src/menu.js`) are menu.c on qmenu.c: a stack of menus, each a draw and a key function; list
menus are frameworks of actions, sliders, spin controls and separators laid out as qmenu laid them out
(labels right-aligned before the column, values after it, the blinking cursor between), drawn into the
frame after ref_soft's stippled fade. While one is up `frame()` repaints the last view under it and runs
no tics. The page's `host` object gives the menus what they act on: new games, the save slots
(`firebird-quake2:save:save0` … `save14` in `localStorage`, each with Quake 2's comment), and the
settings, which go through the page's own controls so both agree. The game menu's `credits` scrolls
menu.c's `idcredits` (`src/credits.js`) up the screen as `M_Credits_MenuDraw` did: a line every ten
pixels rising a pixel every 40 ms, the `+` lines in the highlighted font, round again once the last is off
the top, Escape to leave. The options menu's `customize controls` is `M_Menu_Keys_f`: a row nine pixels
high for each of the eighteen bindable actions (`ACTIONS` in `src/input.js`, menu.c's `bindnames` less
mouse look, keyboard look, sidestep and centre view) with its keys named as `Key_KeynumToString` named them
(`keyName`: letters and digits as themselves, `UPARROW`, `CTRL`, `PGDN`…, "or" between two, `???` for
none); Enter waits for a key (the cursor an `=`, the status bar asking) and the next key pressed binds it
(`bindKey`: the key leaves whatever it was bound to, an action keeps two and a third makes both go first,
as `KeyBindingFunc` unbound them), Escape and the backquote cancel, Backspace and Delete unbind. The binds
are `settings.binds` (action → key codes, the two shifts, controls and alts one key each), checked on the
way in from storage like every setting, and the `Input` reads the same object each tic (`read` asks
whether any key bound to an action is down; a one-shot action's impulse comes from `key`); the options'
reset defaults puts them back as `exec default.cfg` did. The weapon and item keys stay fixed, as Quake's
menu did not list them. The multiplayer menu's `player setup` is `M_Menu_PlayerConfig_f` (the servers stay
greyed: the network game has the page's own buttons): a text field for the name (`menufield_s` as `Field_Draw`
and `Field_Key` had it: the box of frame pieces, the blinking cursor, the printable keys and Backspace,
fifteen characters) and a spin for the handedness (right, left, center); the model and skin boxes wait on a
pak with the player model. Both are settings (`name`, `hand`) and this client's userinfo
(`Session.setUserinfo`, `ClientUserinfoChanged`): the session keeps it and writes `player.netname` and
`player.hand` after every map load and loaded game (the player table is made anew by `init_map` and by a save),
and at once to a game running; a guest sends its own to the host (`GuestLink.sendInfo`, an `info` message, at
the connect and on every change), which gives it to the second client. The name is the obituaries'
(`client_obituary`) and the score board's (`Q2_TIC`'s `netname`, "player N" without one); the hand turns the
muzzle (`muzzle`, `P_ProjectSource`: the right distance negated for a left-hander, zero for a centre-hander)
and the gun drawn (`drawAlias`'s `mirror` for hand 1, as ref_soft negated `aliasxscale` for `RF_WEAPONMODEL`;
no gun at all for hand 2, as `R_DrawAliasModel` returned). `scripts/menu-test.mjs` drives the menus headless.

Saved games (`src/savegame.js`): `F6` reads the game tables (`game`, `player`, `ents`,
`lightstyles`, `player_trail`) as rows, with the column names from the result's field list and the
model ids' names, and the unit's other levels as they were left (`exportLevel`'s objects, `savedLevels`
gets them back), and keeps them in `localStorage` as `src/savestore.js` packs them: a header line
(the map, the comment, the version) and the JSON gzipped and base64'd, a tenth of the JSON, so the
fifteen slots fit the origin's quota (a plain JSON save from before still reads); `F9` reloads the map, empties the four tables, inserts the
saved rows with model ids remapped by name, restarts `ent_seq` above the highest id and resets the
frame's caches. The per-frame cache columns of `ents` are not saved. Each table's rows go in as one
`execBatch`, and a `DOUBLE PRECISION` column gets the saved double bit for bit: since firebird-wasm
0.4.0 a number is bound in binary. (Before, every parameter was text, Firebird's text-to-double
conversion was off by an ulp for one value in six, and doubles went over as
`CAST(? AS DOUBLE PRECISION) * POWER(2e0, ?)` from an integer mantissa and an exponent.)

The loop: each animation frame computes the tics the wall clock owes (20 Hz; at most two, a stall being
slow motion rather than a leap), runs `q2_tic` for them, then one `frame_all` per view, splits its rows by
kind, plays sounds and effects, and paints; a frame that owes no tic paints again. Every paint goes through
`src/lerp.js` (`FrameLerp`, one per view, holding the last two tics' frames): the frame shown is the last
tic's moved toward the current one by the fraction of the tic gone by, as the Quake 2 client drew the
server's frames (`CL_AddPacketEntities` by `cl.lerpfrac`, `CL_CalcViewValues` the view's origin): the eye
between its two origins, each alias model and sprite between its two poses (one just come, or moved 512
units, snaps), the brush models' face rows with their origins and angles between the two (the doors,
platforms and fans move smoothly), the particles run by the real time since the last paint; the view's
angles are the current tic's plus the turn the input holds and has not yet sent with a tic (the mouse's
delta), so looking around never waits for a tic, as the client's own `cl.viewangles` did not. The
SQL-projecting renderer mode cannot move its faces, projected at the tic's eye, so it paints a tic's frame
as it is, once a tic. A guest's page does the same with the host's last two frames by the time since the
last came. A hidden tab pauses the loop (`document.hidden`). The stats line shows the costs of the tic,
the frame query and the raster. The SQL console runs any statement against the live game database.

## 9. Testing and measuring (`scripts/`)

| script | purpose |
|---|---|
| `sql-check.mjs` | compiles the six SQL files against the engine (run first after any SQL edit) |
| `sql-smoke.mjs [map]` | end-to-end in Node: load, tics, movement, weapons, doors, all referenced sounds exist |
| `monsters-test.mjs [MONSTER=a,b]` | every monster: spawned, sees the player, attacks, dies, is counted; the full game's on their frame tables alone (the runs the table gives, every animation named in it, no mesh for the painter), their second ranged attack chosen and fired, Makron's three, Makron rising from Jorg; the insane marines never attacking; each hurt on hard (the cry and the flinch) and in nightmare (the cry alone) |
| `walkthrough-test.mjs` | every trigger the player can walk into on the three maps fires, and its movers move |
| `entities-test.mjs` | the full game's entities the demo lacks, added to demo1's lump: secret doors, the earthquake, the elevator, the viper and its bomb, the ships, the string display and the clock, the decorations, a turret, target_spawner |
| `save-test.mjs` | save, play on, load: every entity, mover and light style back as it was; the game keeps running with fresh ids |
| `input-test.mjs` | the page's input read as Quake's usercmd (`src/input.js`): keys, Shift and the Run setting, the impulses once per press, the mouse, drags and taps on the view's halves, the on-screen buttons; and the gamepad's reading (`src/gamepad.js`): dead zones, the run at the stick's edge, a press counted once, the weapon impulses, the menu driven by d-pad, stick, A and B |
| `console-test.mjs` | the console line headless (`src/console.js`): `map`, `fov`, `seed`, `skill` (shown, set for the next game, clamped to 0..3), `save`, `load`, `inven` reach the page's host, the rest reach `player_command`, the history steps and forgets as `Key_Console`'s did, Tab completes |
| `session-test.mjs` | the game as the page plays it, without the page (`src/session.js`): a map started, tics, the frame decoded (the sounds each once, the speakers every tenth frame, both renderer modes the same world faces), a slot saved, listed and loaded back exactly, levels left and come back to as left, a save carrying them, a unit's end and a new game forgetting them, the death screen's load request taken once, no storage no saves |
| `golden-test.mjs` | the painter's look: the twelve docs screenshots (three maps, four shots each) rendered again by `screenshot.mjs` and compared to `docs/` pixel for pixel, with the count and the box of what differs; the painter is deterministic, so a difference is a change, regenerated with the shots when it is meant |
| `coop-test.mjs` | a coop game headless, through a `Session`: two clients, the second at its `info_player_coop`; each one's usercmd, row from the tic, view and inventory; the sight client alternating and passing over notarget; a monster hunting the sight client and, that one dead, the other; a death that ends nothing, the respawn a second later at the spot with the level-start pers and the body left (and gibbed); a weapon and a key that stay for the other client; the obituaries, with the players' names once set and the rows carrying the names and hands; the muzzle 8 to the right, the left or the centre by the hand; a centerprint to one client; a save and a level change (there and back) with both; single player with one row |
| `dm-test.mjs` | a deathmatch headless, through a `Session`: two clients at the map's deathmatch spots, no monsters, the deathmatch-only items; a taken item gone 30 s, back with its sound and particles, a new weapon raised only over the blaster; weapons that stay and one held left; a kill's frag, the tossed weapon, the respawn afresh at a spot by button or forced, a suicide's and the world's cost; an exit that kills, or ends the level when allowed; the frag and time limits, the same level flag, the intermission's button; a level change and a save keeping the mode; no health, armour or ammo spawned, infinite ammo, no falling damage, instant items, spawn farthest; the mega health's wait; coop and single player as they were |
| `demo-test.mjs` | the pak's demo read and played headless (`src/demo.js`): every block of `q2demo1.dm2` consumed exactly, the server data, the configstrings' models and sounds all in the pak, the frames in order a tenth of a second apart, the player state and the entities; the view and an entity halfway between two frames, the events of the frames reached given once, the brush models apart, the light styles, the end; a sound placed at its entity, a muzzle flash's sound and light, the monsters' flash sounds; a `Session`'s demo frame: the map's own models hidden, the player's row at the view, the faces from the SQL, a brush model moved where the demo has it and not written again; a frame painted from the faces, the entities and the gun |
| `lerp-test.mjs` | the frames between tics (`src/lerp.js`): the eye and the entities halfway between two tics' frames, angles the short way round, a newcomer, a teleport and another model snapping, the brush models' face rows and angles moved, the input's turn added to the current angles, the fraction clamped, the SQL-projecting mode exact; then two tics of walking on demo1 and the frame halfway between them, and a turn showing at once |
| `net-test.mjs` | a game shared over a link (`src/net.js`), the two ends a loopback in one process: the host's `Session` with two clients, the map message and the guest's geometry from the pak alone, the guest's userinfo (its name cut at fifteen, its hand checked) reaching the second client, a frame a tic with the guest's own row and every face the map's, the guest's forward command walking its player at the host, two commands in a tic merged (turns summed, buttons held, the last impulse) and none standing, a turn turning it, the shots' sounds arriving, the inventory rows on request, a 48 KB message in four chunks, a frame dropped on a slow link, a level change's map and frames, a picture, the signalling texts packed and unpacked, rubbish refused, one end's close closing the other |
| `audio-test.mjs` | the sound mix (`src/audio.js`) against a Web Audio that records: `S_Spatialize`'s fall-off (full within 80 units, ATTN_NORM silent from 1080, ATTN_IDLE twice as fast, ATTN_NONE everywhere) and pan (0.8 to the side, the listener's yaw), a one-shot per event cut by the next on its entity's channel but not on CHAN_AUTO, out of range or missing from the pak skipped, each sound decoded once, the loops summed per name at ATTN_STATIC with each side clamped, silent when unlisted and the channel kept, the speakers on and off with the frame, the page hidden and back, and the music: off, the drone, a track file from a picked folder, the volume |
| `effects-test.mjs` | the temporary entities (`src/effects.js`): each effect row's particles and what it keeps, the explosions' frames, skins, translucency and fading light, the blaster hit turned to its direction, the BFG's sprite, a muzzle flash lighting its frame only, the `EF_` lights, beams lasting 0.1 and 0.12 s, a parasite's tongue (one per parasite, a segment every 30 units, 0.2 s), and an explosion painting a real frame |
| `settings-test.mjs` | the page's settings (`src/settings.js`): the defaults, the round trip through storage, and each stored value checked against what it can be (a bad one back to its default, a full storage harmless; the name fifteen printable characters at most, the hand 0 to 2) |
| `replay-test.mjs` | the same seed and the same 120 tics of input give the same game twice (every entity, the game row, the sounds), another seed another game, and a game loaded from a save goes on exactly as the saved one did |
| `screenshot.mjs [map] [prefix] [--at=x,y,z,yaw] [--sql] [--compare]` | headless frames to PNG; `--compare` asserts both renderer modes paint identical pixels |
| `browser-test.mjs [--coi]` | the page itself in a headless Chromium (Playwright), served without COOP/COEP as Pages serves it: not isolated, no service worker, the build without threads (with `--coi`: isolated, the threaded build); the pak downloads, Firebird runs in its worker, frames come, keys move, `F6`/`F9` save and load, Escape pauses; a second page joins the first's game over WebRTC with the offer and answer texts passed between them, paints the frames it is sent at the host's view, its W walks its player at the host, and leaves; the retired service worker removes itself; no console errors, no 404 but the music and the favicon. CI runs it; `CHROME=` points it at a Chromium already installed |
| `perf-guard.mjs [--record]` | the figures held in CI: demo1's load, an idle and a walking tic, the frame query and the raster, each measured and taken in units of a calibration run just before and after on the same machine (50,000 primary-key fetches of the engine for the SQL figures, a fixed loop over a frame's buffer for the raster), compared with `docs/perf-baseline.json`; a figure past the baseline's units by the file's margin (twice) fails; `--record` writes the baseline from the run (a change that is meant to cost more records it again in the same commit) |
| `bench.mjs`, `tic-bench.mjs`, `raster-bench.mjs`, `call-counts.mjs`, `ab-bench.mjs` | where the time goes (section 10) |
| `probe.mjs`, `inspect.mjs` | traces around a point; what is in the pak |
| `fetch-pak.mjs`, `build.mjs` | the demo download; the esbuild bundle and dev server |

CI (`.github/workflows/pages.yml`) runs every test above, the docs screenshots compared pixel for
pixel and the performance guard among them, on every push, and deploys the bundle to GitHub Pages.

## 10. Performance: what the engine costs and what that led to

Measured in `firebird-wasm` 0.3.0 under Node (Chrome is similar; its worker round trip adds about
a millisecond per query):

| operation | cost |
|---|---|
| a PSQL statement | ~1.2 µs |
| a SELECT by primary key | ~5.5 µs |
| opening a FOR SELECT cursor | ~10 µs |
| EXECUTE PROCEDURE, 36 parameters / 3 parameters | ~18 µs / ~3 µs |
| one level of a tree descent (fetch + branch) | ~16 µs |
| an UPDATE of a wide row (`ents`) / a narrow one | ~35 µs / ~15 µs |
| a row returned from a selectable procedure | ~6 µs, whatever its width |
| `LIST()` | ~1 µs per element; a BLOB comes back to JS as a string |
| a function taking a 2 KB VARCHAR | ~10–45 µs (the copy, then the parsing) |
| a row of a scan with ~50 arithmetic operations in the WHERE | ~2 µs |

Rules that fell out of those numbers, each of which bought a measurable slice (the README's
"Firebird lessons" tells the story; `git log` has the measurements per step):

1. **Count calls before timing bodies.** `scripts/call-counts.mjs` instruments every hot routine
   with a counter. A 17 ms-per-tic bug (barrels and monsters placed exactly on the floor whose
   first trace started in solid, so they "fell" every tic) was invisible to per-procedure timing.
2. **A function in a `WHERE` clause runs three times** (index probe, predicate, fetch); **a
   function nested in a condition's expression** (`IF (BIN_AND(f(x), 56) <> 0)`) **runs twice.**
   Call it into a variable first.
3. **Write a row once.** The think time rides with the frame write; the step's position write
   carries the link position; the player's tic writes `player` and `ents` once each.
4. **Rows out are the cost of a result**, not columns: id sets travel as `LIST()` strings,
   heterogeneous results as kind-tagged rows, and a frame is one round trip.
5. **Arithmetic belongs in the select list; derived tables are inlined**, so never rely on one to
   compute an expression once.
6. **Keep what does not change**: the marked faces, the world's face list while the view holds,
   the eye's leaf, a brush model's PVS decision per view cluster and its face list per view stamp,
   the cluster list of an entity that stayed in its leaf.
7. **Prune before you loop**: empty leaves skipped from the parent node, a whole brush model
   against the frustum before its faces, the PVS test as a cursor expression so only drawn
   entities reach PSQL.
8. **What nobody sees can think slowly** (3 Hz standing, 2.5 Hz patrolling out of the PVS).

Measured and rejected: a brush grid instead of the tree (derived tables re-evaluate), a
leaf-planes table for a cheap "still in this leaf" test (0.8 s of load for a 1.8× cheaper lookup),
a leaf-level frustum cull before the faces (row fetches cost more than the faces skipped), a cone
test before the planes (the square root costs more than it saves), an expression index on a
coarse x sector for the solid-entity scan (no measurable gain), a narrow think-schedule table
(the wide-row penalty is only ~20 µs). Two more for the trace, measured on the 2,643 traces of 300
real tics on the Outer Base, replayed through the old and the new SQL in turn: CM_BoxTrace's
`checkcount` (a brush lying in several leaves clipped once per trace, through a temporary table)
came out 8 % slower, because a real trace reaches 1.4 leaves and 13.7 brush sides on average and
the repeats it saved were about one side; and a cache of where a trace's walk may start (the
deepest node holding a 64-unit cell grown by 64) skipped 0.9 of a trace's 23 levels, because the
places where things move lie across the tree's top planes. A trace's time is the walk (0.76 of
its 0.87 ms with the clipping taken out): 6.6 `rhc` calls and 23 levels.

Where it stands (Node, Outer Base, hard skill, 31 monsters, 14 patrolling; timings vary between
machines by more than any one step: the sandbox this was last measured in gives 4.7 ms idle and
11.5 ms walking now, and 4.9 / 9.5 ms for the SQL these figures were taken with, the difference
being the scripted walk running since `cl_run`):

| | at the start | now |
|---|---|---|
| idle tic, median of 200 | ~40 ms | 3.4 ms |
| walking tic | ~45 ms | 6.2 ms |
| frame query, turning / view held | ~18 ms (six queries) | 1.9 / 1.6 ms |
| raster, warm / every surface rebuilt | 3.2 / 30 ms | 2.0 / 8 ms |

What is left: a step's three-call box trace (~0.5 ms) and relink, the ~660 front-facing faces of a
cluster in the frame's scan (~1.3 ms), and the per-cluster-change re-mark. Each is at the floor of
the engine's per-row or per-level cost; going further means fewer rows (coarser culling that this
engine's row fetches make unprofitable) or a different representation.
