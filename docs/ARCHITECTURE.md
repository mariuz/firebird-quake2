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
src/main.js   input, loop, console       sql/monsters.sql  AI, pushers, the tic, map init
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

Firebird needs threads, so the page must be cross-origin isolated: the dev server sends the
COOP/COEP headers (`--coi`), GitHub Pages cannot, so `public/coi-serviceworker.js` re-issues
responses with the headers after a one-time reload.

## 2. Loading: the pak becomes tables (`src/loader.js`)

`createSchema(db, sql)` executes the six SQL files in order (`SQL_FILES` in loader.js). The WASM
build's `exec` splits on `;`, so procedure bodies are wrapped in `SET TERM ^ ;` and the files are
fed as one script each.

`loadResources(db, pak)` runs once per pak: every `.md2` with its PCX skins, every `.sp2`, the
frame runs (`anims`, from the frame names, with the sequence digit kept for names like `attak1`),
the 64 light styles, the `monster_types` table built from `src/gamedata.js`, and the single `game`,
`player` and `viewcfg` rows.

`loadMap(db, pak, res, name, { skill, newGame, spawnpoint })` parses the BSP (`src/bsp.js`) and
bulk-loads it, then calls `init_map`.

### Bulk loading

The WASM build binds every parameter as text. Row-by-row inserts of 90 000 rows would take
minutes, so each table has a generated `LOAD_<table>` procedure that takes one 30 KB chunk of
`|`-separated lines and parses it in PSQL (`loaderSql()` writes those procedures from the column
specs in `TABLES`). The Outer Base loads in about three seconds.

### What the BSP becomes

| table | from the BSP | notes |
|---|---|---|
| `nodes` | NODES + PLANES | the plane copied in; `c0`/`c1` children (negative = leaf), `cc0`/`cc1` the child leaves' contents, so a trace can skip an empty leaf without visiting it |
| `leaves` | LEAVES | cluster, area, bounds, `first_lf`/`num_lf`, `first_lb`/`num_lb`, and the cluster's PVS decompressed to a hex string (`pvs`) |
| `leaffaces`, `leafbrushes` | the index arrays | |
| `brushes`, `brushsides` | BRUSHES, BRUSHSIDES + PLANES + TEXINFO flags | brush bounds are computed by the loader (union of the leaves that reference the brush, then tightened by its axial sides) |
| `faces` | FACES + PLANES (flipped for `side`) + TEXINFO | the texture's `.wal` name, SURF_* flags, texel vectors, and a bounding sphere (`cx cy cz radius`) |
| `face_verts` | EDGES and SURFEDGES resolved to an ordered vertex list | |
| `textures` | TEXINFO names | |
| `models` | the world and its `*N` submodels, plus every MD2 and SP2 | `kind` B/M/S, bounds, `headnode`, `radius` |
| `map_ents` | the entity lump | one row per entity with the Quake 2 keys as columns |

Lightmaps are not in SQL: the painter reads them from the parsed BSP (`bsp.lightdata`), collapsed
from RGB to the brightest channel the way `Mod_LoadLighting` did for ref_soft.

### Game state tables

`ents` is the entity table: one wide row (about 120 columns) per edict, with the Quake 2 fields
(origin, angles, velocity, bounds, model, frame, skin, flags, health, movetype, solid, think,
nextthink, targets, pusher state…) plus port-specific ones: `leaf`, `cluster`, `cl2`, `cl3` (the
leaf and the clusters the box touches), `lx ly lz` (where it was last linked), `mkind`/`mradius`
(the model's kind and radius, copied in by `set_model`), `vis_cl`/`vis` and `fl_*`/`faces_lst`
(brush-model visibility caches, section 6). `player` holds the client: ammo, armour, weapons,
keys, timers, pitch, punch, step smoothing. `game` is the level: time, tic, skill, counts, the
next map, `has_water`. `sound_events` and `fx_events` are the outgoing queues (section 7).
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
(the page catches up by at most two per frame) and returns the player's view of itself: health,
ammo, weapons, position and angles, view height and punch, messages, damage flash values,
level counts, water, powerups, the eye's leaf and cluster. Each tic:

1. `player_think` – pmove.c: friction, acceleration (300/200 units per second, no air
   acceleration), jumping (270), swimming, water transitions and drowning, lava and slime,
   then the move (`walk_move` or `fly_move` in water), the relink, the step smoothing, touching
   triggers and items, door and plat trigger fields, megahealth rot, then `player_fire`. A player
   standing still on the ground with no velocity makes no move; the floor is re-checked twice a
   second. The player and entity rows are each written once per tic.
2. `run_pushers` – doors (with teams), rotating doors, plats, buttons, trains and path corners,
   rotating fans, timers: `push_move` is `SV_Push` with the pushed set in the `pushed` GTT, the
   crush and the blocked callbacks; an idle pusher costs nothing.
3. `run_physics` – the thinks that are due (dispatched by name in `run_think`), then
   `SV_Physics_Step`/`Toss` for everything that falls, flies or bounces, then monsters touching
   `trigger_hurt` and `trigger_monsterjump` on maps that have any.

The rest of g_*.c lives here too: `spawn_map_ents(skill, spawnpoint)` is `SpawnEntities` with the
skill and coop spawnflag filters and Quake's spawn-point selection (`info_player_start` with the
matching or absent targetname); triggers (once, multiple, relay, always, counter, key, push,
hurt); `use_targets` is the big dispatcher for targets (speaker, explosion, splash, secret, goal,
help, laser, lightramp, changelevel with `map$spawnpoint`); items from stimpacks to the power
shield, ammo, keys, timed powerups (g_items.c); the ten weapons (p_weapon.c, g_weapon.c:
bullets with the 8192-unit spread, rail, blaster bolts, grenades with the held-grenade timing,
rockets, hyperblaster, BFG with its think); `t_damage`, `t_radius_damage`, armour
(`CheckArmor`, power armour), knockback, gibs (g_combat.c, g_misc.c). Sounds and temp entities
are rows: `snd`, `snd_at` and `fx` insert into `sound_events` / `fx_events`.

Monsters are g_ai.c's state machine over the `monster_types` table (`src/gamedata.js`: model,
health, bounds, speeds, animations, missile frames, sounds). `monster_think` runs at 10 Hz in
sight of the player: `find_target` (PVS, range, in-front, then a visibility trace), `move_to_goal`
/ `new_chase_dir` / `step_direction` for walking and chasing, `check_attack`, `monster_melee`,
`monster_missile`, pain and death with corpses and gibs. Out of the player's PVS a standing
monster thinks at 3 Hz and a patrol strides four times as far at 2.5 Hz, with
`SV_CloseEnough`'s stride-sized path-corner check. Supported: soldier (light, shotgun, machinegun),
infantry, gunner, berserker, flyer, parasite, tank; see ROADMAP.md for the rest.

## 5. Visibility and the frame (`sql/render.sql`)

The renderer is a query because the data it needs is already relational: faces with planes and
spheres, leaves with clusters, clusters with PVS bits.

`view_setup` computes the eye (origin + view offset − step smoothing), the view axes from yaw,
pitch and the death roll, the projection scale, and the eye's leaf (cached on `viewcfg` while the
eye stands still) with its cluster and PVS.

`mark_faces(pvs, cluster)` is `R_MarkLeaves`, run when the eye's cluster changes: every face of
every leaf whose cluster is in the PVS goes into `vis_faces` (`DISTINCT`, Quake's `visframe`),
with its plane and bounding sphere copied in so the frame is a scan of that table alone. A face
whose plane has the cluster's whole bounding box behind it is left out: no eye in the cluster
can ever face it. This re-marking is the one per-cluster-change hitch (tens of milliseconds).

`frame_all(mode, last_sound, last_fx, want_speakers)` returns the frame as kind-tagged rows
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

The world's faces are the scan of `vis_faces` with the back-face test and the frustum tests as
expressions, `LIST()`ed into one row. The frustum is four world-space planes (`kx·f ∓ r`,
`ky·f ∓ u`), each a one-sided sphere test that fails at the first plane a face is outside; the
eye's part of every dot product is a constant of the frame. The whole list is kept on `viewcfg`
with the view it was made for and reused while the eye holds still.

Brush models (doors, plats, the fan) are the second pass: for each one in the PVS (decided once
per view cluster and kept on the row), the model is tested against the frustum as a whole, then
its faces at its origin (rotated models skip the per-face tests: the painter clips them), as one
list per model; a model's list is kept on its row with the view stamp and pose it was made for.

Alias models and sprites are one cursor whose `WHERE` holds the frustum tests and the PVS test
(an expression on the eye's leaf row, joined in, over the entity's three cluster columns), so only
the entities drawn reach PSQL.

`frame_faces_fast` and `frame_ents` are thin wrappers over `frame_all` for the scripts and the SQL
console. `frame_faces` is the other renderer mode, selectable on the page: it projects every vertex
in SQL (one cursor over the selected faces' vertices with the rotation, the view transform and the
projection in the select list) and the painter only scan-converts; both modes paint identical
pixels (`node scripts/screenshot.mjs demo1 --compare`), which is the renderer's regression test.

## 6. The painter (`src/renderer.js`)

ref_soft in JavaScript: an 8-bit framebuffer of palette indices and a float z-buffer, converted to
RGBA through the palette on `present` (with the damage/powerup/water tint as a palette blend).

- **Surfaces.** `surface()` returns the face's texture tiled under its lightmap through
  `colormap.pcx` (64 shades × 256 colours), built by `buildSurface` the way `R_DrawSurfaceBlock8`
  did: one row of light values interpolated per texel row, stepped along it; the texture column
  wrap is tabled. Surfaces are cached by face, texture (animation frame) and the face's light
  style values; the cache clears at 2000 entries and when the brightness setting changes.
- **Polygons.** `drawFaceList` takes the frame's face rows, transforms the BSP vertices it holds
  (with the brush model's origin and rotation matrix), clips at the near plane in view space and
  scan-converts with `fillPolygon`: 1/z, s/z, t/z affine in screen space, the texel coordinates
  divided out every 16 pixels (`D_DrawSpans16`), the depth test on every pixel. Warping surfaces
  ripple with a sine table and flow; translucent surfaces are drawn last and blended through the
  alpha map; the sky is the `env/` cube map sampled by each pixel's ray, stepped along the span.
- **Alias models.** `drawAlias` transforms, lights (ambient plus Gouraud from the vertex normals)
  and projects each vertex once, then draws the triangles back-face culled, clipping only those
  that cross the near plane; `triangle` is an affine-textured Gouraud triangle with z-test, used
  by sprites too. The view weapon is drawn after clearing the z-buffer, with a closer near plane.
- **Particles and beams** are cl_fx.c's: explosions, blood, blaster sparks, the rail spiral,
  teleport fog, laser beams as particle lines.
- **2D** (`src/hud.js`): the Quake 2 status bar layout from `pics/`, numbers, icons, the
  crosshair, centre prints and the console font.

`scripts/raster-bench.mjs` times the painter per stage; `--cold` rebuilds every surface each frame.

## 7. Sound (`src/audio.js`)

`sound_events` rows are played with the Web Audio API, attenuated and panned by Quake 2's rules
(full volume within 80 units, then `attenuation × 0.001` per unit). The map's looped
`target_speaker`s play at their origins and follow their on/off state from the frame's kind 7 row.
Music was CD audio: `public/music/trackNN.ogg|mp3`, or a folder picked on the page, plays each map's
`worldspawn` track; without them a synthesised drone fills in.

## 8. The page (`src/main.js`, `public/`)

Boot opens `memory://quake2` through the Worker, loads the pak (the fetched demo or a user-picked
`pak0.pak`), creates the schema and resources, and starts the map. Settings (map, skill, detail,
brightness, renderer mode, sound, music) persist in `localStorage`. Input: WASD/arrows, mouse look
under pointer lock, digits for weapons (`impulse` 1–10), `/` or the wheel to cycle (12), `G` gives
everything (99), `P` pauses; on touch screens the halves of the screen move and look.

The loop: compute the tics owed (one or two), `q2_tic`, then one `frame_all`, split its rows by
kind, play sounds and effects, draw the frame, the view weapon and the HUD, and present. A hidden
tab pauses the loop (`document.hidden`). The stats line shows the costs of the tic, the frame
query and the raster. The SQL console runs any statement against the live game database.

## 9. Testing and measuring (`scripts/`)

| script | purpose |
|---|---|
| `sql-check.mjs` | compiles the six SQL files against the engine (run first after any SQL edit) |
| `sql-smoke.mjs [map]` | end-to-end in Node: load, tics, movement, weapons, doors, all referenced sounds exist |
| `monsters-test.mjs` | every monster of the demo: spawned, sees the player, attacks, dies, is counted |
| `screenshot.mjs [map] [prefix] [--at=x,y,z,yaw] [--sql] [--compare]` | headless frames to PNG; `--compare` asserts both renderer modes paint identical pixels |
| `bench.mjs`, `tic-bench.mjs`, `raster-bench.mjs`, `call-counts.mjs`, `ab-bench.mjs` | where the time goes (section 10) |
| `probe.mjs`, `inspect.mjs` | traces around a point; what is in the pak |
| `fetch-pak.mjs`, `build.mjs` | the demo download; the esbuild bundle and dev server |

CI (`.github/workflows/pages.yml`) runs the smoke tests, the monsters test and the screenshots on
every push and deploys the bundle to GitHub Pages.

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
(the wide-row penalty is only ~20 µs).

Where it stands (Node, Outer Base, medium skill, 31 monsters, 14 patrolling):

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
