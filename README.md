# Firebird Quake 2

![The Outer Base rendered from Firebird query results](docs/screenshot-demo1-0.png) ![the start of the Installation](docs/screenshot-demo2-0.png)

Quake 2, simulated and rendered inside the [Firebird](https://firebirdsql.org) SQL database, running
entirely in your browser on Firebird 6 compiled to WebAssembly. The sequel to
[Firebird Quake](https://github.com/mariuz/firebird-quake), which grew out of
[Firebird DOOM](https://github.com/mariuz/firebird-doom).

Every game tic is a PSQL procedure call. Every frame is a `SELECT`. JavaScript handles the keyboard,
the mouse and the canvas; everything else — collision against the BSP's brushes, the player's physics,
doors, platforms, rotating doors and fans, triggers and targets, items, the ten weapons, damage, the
monster AI, and the visibility and projection of every polygon on screen — happens in SQL.

```
keyboard/mouse → SELECT * FROM q2_tic(...)        game logic: 20 Hz, PSQL
               → SELECT * FROM frame_faces_fast   visible polygons (or frame_faces: projected, with texel coordinates)
               → SELECT * FROM frame_ents          MD2 models and sprites in the PVS, with their pose
               → SELECT * FROM frame_lightstyles   this frame's light animation
               → SELECT ... FROM sound_events      what to play, and where
               → JS rasterises polygons and models through colormap.pcx → canvas
```

## Running it

```bash
npm install
npm run fetch-pak      # downloads the Quake 2 demo (q2-314-demo-x86.exe) and extracts baseq2/pak0.pak
npm test               # SQL smoke test in Node against the real Firebird WASM engine: the Outer Base
npm run test:base2     # the same on the Installation (demo2)
npm run test:monsters  # every monster of the demo: spawned, it sees the player, attacks, and dies
npm run serve          # http://localhost:8080/ — add -- --coi if your browser blocks service workers
npm run screenshots    # headless frames to docs/ (node scripts/screenshot.mjs demo1 --at=x,y,z,yaw)
npm run bench          # where a tic and a frame spend their time
npm run inspect        # what is in the pak (maps, models and their frame runs, sounds)
```

`fetch-pak` needs 7-Zip or `unzip` to open the demo's self-extracting archive. If you own Quake 2, point
the page at your own `pak0.pak` with the file picker, or copy it with `PAK=/path/to/pak0.pak npm run fetch-pak`:
the base unit's maps and monsters work the same way.

Firebird WASM uses pthreads, so the page must be cross-origin isolated. The dev server sends the
COOP/COEP headers with `--coi`; a static host like GitHub Pages cannot, so `coi-serviceworker.js`
re-issues responses with the headers after a one-time reload.

## How it works

### The BSP becomes tables (`sql/schema.sql`, `src/loader.js`)

A Quake 2 BSP (IBSP version 38) is a relational database in disguise, and more so than Quake's:
`loader.js` parses it (`src/bsp.js`) and copies it in, denormalised so the hot loops never need a
second lookup:

| table | from |
|---|---|
| `faces` | FACES + PLANES (flipped for `side`) + TEXINFO (the .wal name, the SURF_* flags), plus a bounding sphere |
| `face_verts` | EDGES and SURFEDGES resolved to an ordered vertex list per face |
| `nodes` | NODES with their plane copied in (children < 0 are leaves) |
| `leaves` | LEAVES with their cluster and area, and the cluster's PVS decompressed to a hex string |
| `leaffaces`, `leafbrushes` | the leaf → face and leaf → brush index arrays |
| `brushes`, `brushsides` | the collision volumes: contents, and each side's plane and surface flags |
| `models`, `anims` | the world, its submodels (`*N`), every `.md2` with its frame runs, the `.sp2` sprites |
| `map_ents` | the entity lump |

The WASM build binds parameters as text, so each table has a generated `LOAD_<table>` procedure that
parses 30 KB chunks of `|`-separated lines in PSQL. The Outer Base (90 k rows) loads in about three seconds.

### Collision is a recursive procedure (`sql/physics.sql`)

Quake 2 ships no clipnodes: a trace walks the node tree with the moving box's extents pushing each
split plane out (`CM_RecursiveHullCheck`) and, in every leaf it reaches, clips the segment against the
leaf's brushes whose contents match the mask (`CM_ClipBoxToBrush`). `RHC` is that walk as a recursive
PSQL procedure threading the trace state — fraction, hit plane, surface flags, contents, `allsolid`,
`startsolid` — through its parameters; `CLIP_LEAF` is the brush clipping. `TRACE_MOVE` runs it against
the world and against every brush-model entity at its own origin (rotating doors are traced in their own
rotated space, as `CM_TransformedBoxTrace` does), and clips against monsters and the player with a
Minkowski slab test, honouring `CONTENTS_MONSTER` / `CONTENTS_DEADMONSTER` so bullets hit corpses and
players walk through them. `FLY_MOVE`, `WALK_MOVE` (the 18-unit step), `MOVE_STEP` (monsters),
`TOSS_MOVE` and `PUSH_MOVE` (doors crushing and carrying, fans turning) are g_phys.c; the clip planes
and the pushed entities live in global temporary tables because PSQL has no arrays.

### The game is PSQL (`sql/game.sql`, `sql/weapons.sql`, `sql/monsters.sql`)

`Q2_TIC` runs the player (pmove.c: friction, acceleration, jumping, swimming, drowning, lava),
the pushers (doors and their teams, rotating doors, plats, buttons, trains with path corners, rotating
fans, timers), the thinks that are due, and the physics of everything that flies, bounces or falls.
Triggers (once, multiple, relay, always, counter, key, push, hurt) and targets (speaker, explosion,
splash, secret, goal, help, laser, changelevel with its `map$spawnpoint`) are g_trigger.c and g_target.c.
Items from stimpacks to the power shield, the ammo boxes, the keys and the timed powerups are
g_items.c; the blaster, shotgun, super shotgun, machinegun, chaingun, hand grenades, grenade and rocket
launchers, hyperblaster, railgun and BFG10K are p_weapon.c and g_weapon.c; armour, knockback, radius
damage and gibs are g_combat.c. The monsters run g_ai.c's state machine — `FIND_TARGET`,
`MOVE_TO_GOAL`, `NEW_CHASE_DIR`, `CHECK_ATTACK` — with the light, shotgun and machinegun guards, the
enforcer, gunner, berserker, flyer, parasite and tank defined in `monster_types`. Everything the
simulation wants heard is a row in `sound_events`; temp entities are rows in `fx_events`.

### The renderer is a query (`sql/render.sql`)

`FRAME_FACES` finds the leaf and cluster the eye is in and, once per cluster, marks every face of every
leaf whose cluster is in its PVS into `vis_faces` (Quake's `visframe`). Visible brush models are marked
too, at their origin and with their rotation matrix. One cursor then joins the marked faces to their
vertices, dropping back faces and faces whose bounding sphere is outside the frustum in the `WHERE`
clause and computing the rotation, the view transform, the projection and the texel coordinates in the
select list. Two renderer modes are selectable in the page: **SQL picks faces, JS projects** (the
default, `FRAME_FACES_FAST`, one row per visible face) and **SQL projects every vertex**
(`FRAME_FACES`); both paint the same pixels (`node scripts/screenshot.mjs demo1 --compare`).
`FRAME_ENTS` lists the MD2 models and sprites whose clusters are in the PVS.

### JavaScript only paints (`src/renderer.js`)

An 8-bit framebuffer of palette indices and a z-buffer, like ref_soft. Polygons are scan-converted with
perspective-correct spans over a surface cache: the `.wal` tiled under the face's lightmap (the RGB
lightmap collapsed to its brightest channel, as `Mod_LoadLighting` did), run through `colormap.pcx`.
Translucent surfaces (`SURF_TRANS33/66`) are blended through the alpha map in the same picture; warping
surfaces ripple and flow; the sky is the `env/` cube map sampled by each pixel's direction. MD2 models
are drawn with the lightmap value under the entity and Gouraud light from the vertex normals, clipped
against the near plane triangle by triangle; sprites are billboards; explosions, blood, blaster sparks
and the rail trail are particles. The status bar comes from `pics/`.

Sound: `sound_events` rows are played with the Web Audio API, attenuated and panned from where they
happened. The map's looped `target_speaker`s play at their origins and follow their on/off state in the
`ents` table. Quake 2's music was CD audio, not in the pak: put `track02.ogg`…`track11.ogg` (or `.mp3`)
in `public/music/`, or pick that folder in the page, and each map plays its `worldspawn` track;
without them a synthesised drone fills in.

## Firebird lessons

The ones from Firebird Quake still hold (join the marked set rather than `IN (subquery)`; arithmetic in
the select list is cheap, PSQL statements are not; rows are the cost; keep what does not change; bind as
text). New here:

- **Brush collision is more work than clipnodes, and most of the work is visiting leaves.** A player-sized
  box straddles many split planes, so the walk reaches dozens of leaves, nearly all of them empty. The
  `nodes` rows carry each leaf child's contents, so an empty leaf is skipped without a call, and the walk
  descends iteratively while the segment stays on one side, recursing only at a split. Each procedure
  call costs about 18 µs with 36 parameters, so calls are what to count.
- **Clip the whole segment in every leaf.** `CM_TraceToLeaf` clips the full trace, not the piece of it
  inside the leaf; clipping sub-segments made fractions incomparable and produced phantom hits at the start.
- **Arithmetic belongs in the select list; PSQL runs once per brush side.** The side's distances to both
  endpoints are expressions of the cursor, the loop only branches. An attempt to go further, one aggregate
  row per brush (`MAX`/`MIN` over the sides' enter and leave fractions from a grid of brushes), was
  slower: derived tables are inlined, so every reference to `d1` and `d2` re-evaluated the dot products.
- **Linking is the hidden cost of a move.** Every step relinks the entity to find its clusters for the
  PVS test; an entity that did not move is not relinked, and three point lookups serve instead of ten.
- **Idle rows should cost nothing.** Pushers that are not moving and have no think pending are skipped
  entirely; patrolling monsters out of the player's PVS think at 3 Hz and stride three times as far.

With all that, a tic on the Outer Base at medium skill (21 monsters) costs about 20 ms in Node, down from 40.

## Licence

MIT for the code here. Firebird and Electric Firebird are Apache-2.0. The Quake 2 demo is freely
redistributable; Quake 2 is a trademark of id Software.
