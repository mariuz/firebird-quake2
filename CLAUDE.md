# Working notes for the next agent (or human)

This file is the memory handed to whoever works on Firebird Quake 2 next. Read it with
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how everything works) and
[docs/ROADMAP.md](docs/ROADMAP.md) (what is missing). The README is the public face; the
"Firebird lessons" section there is the short version of what is below.

## What this is

Quake 2 (the 3.14 demo's data) simulated and rendered in Firebird 6 PSQL, running in the browser on
`firebird-wasm` (the author's Electric Firebird). Sibling of `firebird-quake` and `firebird-doom`
by the same author (mariuz), which live next to this repository under `C:\fbq\`. Deployed at
https://mariuz.github.io/firebird-quake2/ by the Pages workflow on every push to `main`.

Layout: `sql/` (schema, physics, game, weapons, monsters, render — loaded in that order),
`src/` (pak/bsp/md2 parsers, loader, session, net, pmove, demo, record, demostore, cinematic, lerp, effects, renderer, hud, audio, main), `scripts/` (tests, benchmarks,
tools), `public/` (page, the manifest and icons, the caching service worker `sw.js`, the retired `coi-serviceworker.js`,
the pak goes in `public/pak/`), `docs/`.

## Commands

```bash
npm install && npm run fetch-pak      # once: the demo's pak0.pak (needs 7-Zip or unzip)
node scripts/sql-check.mjs            # compile the SQL (run after every SQL edit; ~20 s)
npm test && npm run test:base2 && npm run test:base3   # smoke tests, demo1, demo2 and demo3 (~1 min each)
npm run test:monsters                 # every monster: sees, attacks, dies (MONSTER=a,b runs these alone; the full game's run on their frame tables, no model)
npm run test:save                     # save, play on, load: the game comes back exactly
npm run test:menu                     # the menus, headless: keys, slots, settings, pictures
npm run test:painter                  # the painter headless: dynamic lights, mip levels
npm run test:walkthrough              # every trigger the player can walk into fires, its movers move
npm run test:entities                 # the full game's entities, added to demo1: secret doors, earthquake, elevator, viper, clock, turret, the insane marines, the commander's body, the actor's path
npm run test:replay                   # the same seed and inputs give the same game twice; a save carries the chances on
npm run test:input                    # the page's input as the usercmd: keys, mouse, touches, buttons, a gamepad
npm run test:console                  # the console line headless: the page's commands (demos and deldemo among them), player_command, history, Tab
npm run test:settings                 # the settings: defaults, storage round trip, bad stored values back to defaults
npm run test:session                  # the game without the page: maps, tics, the frame, slots, levels left and come back to
npm run test:effects                  # the temporary entities: explosions, beams, the tongue, flashes, their lights and how they draw
npm run test:audio                    # the sound mix headless: spatialisation, channels, the loops summed per sound, speakers, music
npm run test:golden                   # the docs screenshots rendered again and compared pixel for pixel (a painter change: regenerate them)
npm run test:coop                     # a coop game headless: two clients, their rows and views, the sight client, respawns, items that stay
npm run test:net                      # a game shared over a link headless: the guest's commands merged, its frames sent, the map and a level change, chunks, the signalling texts, a second guest into the game running
npm run test:dm                       # a deathmatch headless: the spots, no monsters, items that come back, the frags, respawns, the exit, the limits, the dmflags
npm run test:demo                     # the pak's demo headless: every block read exactly, the view and entities between frames, the events once, the session's demo frame, a frame painted
npm run test:lerp                     # the frames between tics: the eye, the entities and the brush models moved by the fraction, snaps, the turn immediate, the poses blended (backlerp)
npm run test:record                   # a game recorded as a demo and read back: the header, a frame a tenth of a second, the blocks under MAX_MSGLEN, the view, entities, sounds and effects as the rows had them
npm run test:hud                      # the status bar, the help computer, the inventory and the score board laid out to a view's width: the classic positions at 320 and wider, rows and wrapped text in a narrower view, nothing outside or over another
npm run test:predict                  # the player's move in JS (a guest's prediction) against the SQL's, tic by tic: the same numbers every tic, the traces, the water, no drift
npm run test:cinematic                # a .cin made and read back: the Huffman trees as cl_cin.c built them, the decoder and the encoder, a whole file frame by frame, the player's clock
npm run test:browser                  # the page in a headless Chromium (npx playwright install chromium once, or CHROME=/path/to/chrome)
node scripts/screenshot.mjs demo1 /tmp/x --compare   # both renderer modes paint identical pixels
npm run serve                         # dev server as Pages serves it: the engine's build without threads (PORT=8081 to pick a port)
npm run serve -- --coi                # with COOP/COEP: cross-origin isolated, the threaded build
npm run perf                          # the performance guard CI runs: the load, the tics, the frame query and the raster against docs/perf-baseline.json (--record after a change meant to cost more)
npm run bench:tic / bench:raster / bench:calls / bench:ab -- <dir>   # measuring (below)
```

A change is done when: `sql-check` passes, the three smoke tests, the monsters, walkthrough, entities, save, menu, painter and coop tests say `all good`,
`screenshot.mjs --compare` reports `differ in 0 of 76800 pixels` on demo1 and demo2 (and the
viewpoint `--at=300,500,-40,90` by the fan and doors when touching brush models), `test:golden` says
`all good` (the docs screenshots, pixel for pixel; a painter change on purpose regenerates them in the same
commit), `test:browser` says `all good` (the page in a real Chromium, served as Pages serves it), and CI is green. Commit messages here are written as
short stories of what changed and what it measured; keep that.

## How to measure (do this before optimising anything)

- Timing a procedure in isolation misses the real costs. `scripts/call-counts.mjs` loads the SQL
  with a counter in every hot routine and prints calls per tic: that is what found a 17 ms-per-tic
  bug that no profile showed.
- This machine's timings vary by ±50 % between runs. Compare two SQL trees with
  `node scripts/ab-bench.mjs /tmp/oldsql demo1 [--walk] [--frame [--turn] [--sql]] [--at=x,y,z,yaw]` (`--sql`: the
  SQL-projecting mode's frame), which loads both into
  two in-memory databases and alternates tics, so load noise hits both alike. Make the baseline
  with `for f in schema physics game weapons monsters render; do git show HEAD:sql/$f.sql > /tmp/oldsql/$f.sql; done`
  (the old SQL must still load with the current `src/loader.js`: keep schema-dependent resets in SQL, not in the loader).
- `perf-guard.mjs` is what CI holds the figures with: each in units of a calibration run on the same machine
  (so a runner's speed drops out), failing past twice the baseline in `docs/perf-baseline.json`. A change
  that costs more on purpose records the baseline again with `--record` in the same commit; a red guard
  on a change that should not cost more is a regression to find with the tools below.
- `tic-bench.mjs` (median over 200 tics), `raster-bench.mjs` (`--cold` rebuilds every surface),
  `bench.mjs` (a breakdown), and `node --cpu-prof` with `scripts/prof-summary.mjs` for the JS side.
- Expect, in `firebird-wasm` 0.3.0: PSQL statement ~1.2 µs, PK fetch ~5.5 µs, cursor open ~10 µs,
  a tree level ~16 µs, a wide-row UPDATE ~35 µs, a row out of a procedure ~6 µs, `LIST()` ~1 µs
  per element, a WHERE row with ~50 operations ~2 µs.

## Engine rules learned the hard way

1. A function in a `WHERE` clause is evaluated three times; one nested in a condition's
   expression (`IF (BIN_AND(f(x), 56) <> 0)`) twice. Assign to a variable first.
2. Derived tables and CTEs are inlined: an expression in one is re-evaluated per reference.
   A recursive CTE that fans out (several recursive members) can run for minutes and take the
   WASM engine down; a linear one (one row per row) is fine.
3. `VARCHAR(32000)` output columns fail ("Implementation limit exceeded"); use `BLOB SUB_TYPE
   TEXT`, which comes back to JS as a string.
4. `db.exec` splits on `;`: procedure bodies need `SET TERM ^ ;`, and an `EXECUTE BLOCK` with
   inner semicolons must go through `db.query`.
5. Column aliases come back upper-cased unless quoted; `rowMode: 'array'` avoids the question.
6. `RDB$SET_CONTEXT('USER_SESSION', …)` counters persist across queries on one connection: that
   is how `call-counts.mjs` works.
7. Reserved words that bit as variable names: `at`, `dec`, `acc`, `position`.
8. In JS, `String.replace` with `$'` in the replacement duplicated a file once; use split/join
   or a function replacement when the replacement text is SQL.
9. In Bash on this Windows machine, long heredocs that contain `'` sometimes fail to parse;
   write the edit script to a file (the scratchpad) and run it. `python -` falls into a REPL;
   `cat > file` without a heredoc blocks on stdin.
10. Since firebird-wasm 0.4.0 a JS number binds in binary where the column is a number (a double
    for `DOUBLE PRECISION`, an INT64 for `INTEGER`), so a double arrives exactly; a `NUMERIC`,
    `VARCHAR` or date column still gets the text. Before 0.4.0 every parameter was text and
    Firebird's text-to-double conversion was off by an ulp for about one value in six (the save
    used to send `m` and `e` with `v = m × 2^e`). `db.execBatch(sql, rows)` runs one INSERT for
    many rows in one call; since 0.4.1 the rows are one `IBatch` request inside the engine, and
    the map load uses it (`bulkLoad`). 0.4.0's batch was a statement execute per row and measured
    13 % slower than the old `LOAD_<table>` PSQL chunk procedures, whose INSERT was a node of one
    compiled request; a PSQL loop beats per-row executes, an `IBatch` beats the loop by 15 %.

- A forward-declaration stub (`CREATE OR ALTER PROCEDURE x (...) AS BEGIN END^`) must sit in the same
  file as the real body or an earlier one: the files load in order, and a stub in a later file
  replaces the body. `mover_blocked` was empty from the start that way, and no blocked mover reacted.

## Game-logic rules learned the hard way

- `CM_TraceToLeaf` clips the whole segment, not the piece inside the leaf. Clipping sub-segments
  gave phantom zero-fraction hits.
- A thing placed exactly on the floor starts its first trace in solid: `M_droptofloor` starts a
  unit up, and a thing that cannot move at all is on the ground. Otherwise it "falls" every tic
  forever (6 barrels and 12 monsters did, at 17 ms a tic).
- A brush model's origin is far from its box; probe the box centre for its leaf. A model whose
  probes all land in solid (the fan's hub) has no cluster and must be drawn anyway.
- Firebird evaluates `AND` left to right and short-circuits: put the cheap, selective test first.
- The player's `pitch` lives on `player`, the yaw on `ents`; `view_setup` reads both.
- There is a `player` row per client (two to four in coop or deathmatch: `init_map(…, coop, deathmatch, nclients)`), found by its entity: a routine that has the player's edict
  in hand (`pe`, `other`, `targ`, `attacker`) reads and writes `player p WHERE p.ent_id = :pe`, never `p.id = 1`;
  `client_of(eid)` says whether an entity is a client at all. `player_ent()` is the first client's entity, for
  what is the page's own (the console, `premark_ahead`, the trail) or a default activator. Messages take the
  client they are for (`cprint(pe, msg)`, NULL for all). The monsters look for `game.sight_client`, which
  `ai_set_sight_client` rotates through the living clients each tic (`AI_SetSightClient`).
- "Not moved since the last link" (`lx = x`) is true right after every move, because the move relinks:
  it cannot stand for "not moved since the last check". The player's water check was skipped that way
  and swimming silently died; remember the position of the check itself (`player.water_x/y/z`).
- Spawn points: `info_player_start` with the targetname the previous level's
  `target_changelevel` asked for (`map$spawnpoint`), else the one without a targetname.
- A monster's `combattarget` names a `point_combat` to run to when it first sees the player, not
  targets to fire; `point_combat` is a trigger the monster touches. `trigger_monsterjump` (like
  `trigger_push`) keeps its direction in `p1x`/`p1y` because the trigger spawn zeroes every
  trigger's yaw.
- Level exits: single-player Quake 2 has no intermission between ordinary levels; only a unit's end
  (`*` in the map string) stops at one. The map string is kept as written in `game.next_map` and
  parsed by `src/levels.js`, never in SQL.
- The page's loop runs the tics the wall clock owes (`floor((now - lastTic) / 50)`, at most two) and paints every
  animation frame from the last two tics' frames (`src/lerp.js`): a loop that runs at least a tic a frame plays at
  the display's rate (it did, at 2.9× on 60 Hz). The game's clock against the wall's is a browser-test check, which
  must allow a slow page: CI's runner paints four frames a second right after the quick load (23 a second with
  jitter a little later), so the game there runs at two tics a frame and falls behind on purpose (Quake 2's
  `SV_Frame` clamp: slow motion, never a leap). Measure the clock once the page has settled, and never ask for
  more than 0.6 of the wall's: a frame past 150 ms drops a tic, and a runner has such frames.
- A tic is 0.05 s (20 Hz): 20 tics are a second. The ground flag (512) must hold every tic the player
  stands on a floor; pmove-style code that runs only `IF (onground = 1)` silently halves otherwise. On the ground the
  player's `vz` is 0 (pmove); any path that skips the move must still write the speed it computed.
- Items are named by their itemlist index (g_items.c's order: 7 blaster, 12 grenades, 23 quad, 41 health):
  `inv_count`, `inv_sel`, `pickup_item` and the page's `ITEMS` all use it. Usable items (power armour,
  weapons, powerups) are the ones the selection visits.
- Skill numbers are Quake's: 0 easy, 1 medium, 2 hard, 3 nightmare (the console's `skill 3` alone; the menus stop at
  hard). Nightmare is hard with no flinch: `monster_pain` exits after the sound, and every other test of the skill is
  `>= 2`, never `= 2`. The scripts load maps at skill 2 (hard) and with
  `seed: 1` on their first load, so a failing run replays as it failed; `ab-bench` and the other benches
  too, so both trees play the same game.
- Spawnflags 256/512/1024 keep an entity out of easy/medium/hard; an entity with all three (1792) is
  deathmatch-only, and the demo maps have many (weapons, ammo, demo3's teleporter). Before calling
  an entity "missing", check its spawnflags. A deathmatch (`game.deathmatch`) spawns them and no monster.
- `IIF`/`CASE` over string literals of different lengths pads the shorter one with spaces: `TRIM`
  the result when it is compared or shown.
- An entity Quake kept from the client (`SVF_NOCLIENT`: the ships, the viper and its bomb until used) has
  no model here until it shows up (`set_model` then); `alpha = 1` is translucent, not hidden.
- `t_damage` ignores a non-monster, non-player at health 0 or less (it is dead already). Quake had no such
  test: something that takes damage at health 0 (`func_door_secret`) needs its class let through.
- The spawn functions schedule first thinks from the level clock (`spawn_map_ents` reads `now_()` once into
  `t0`; `init_map` runs at time 0, so a level start is unchanged), and a pusher's from its own `ltime`, which
  starts at zero. Something spawned later through them (`target_spawner`) therefore needs no shifting; it used
  to get `now_()` added to its nextthink, which was wrong for a spawned pusher.
- A pusher's (movetype 7) thinks are scheduled on its own clock, `ltime`; everything else's on `now_()`.
- The effect kinds (`fx(kind, …)`, listed in docs/ARCHITECTURE.md §6) are the port's own numbers, not `TE_`'s: a new
  temporary entity gets the next kind in `src/effects.js`, a row in `src/demo.js`'s `TE_KIND`, one in `src/record.js`'s
  `KIND_TE` (how a recording writes it) and a line in the list.
- `player_think`'s movement (the duck, the jump, friction, the acceleration, gravity, noclip, `walk_move`, `fly_move`,
  the ground check, the step smoothing, the bob) and the traces (`rhc`, `clip_leaf`, `trace_hull`, `trace_box`,
  `trace_move`, `check_water`) have a JS twin in `src/pmove.js`, the guest's prediction, which `test:predict` holds
  to the SQL's numbers tic by tic: a change to the player's move or the traces in SQL is made there too, in the
  same commit. The tic row carries what the prediction starts from (`VX`…`VZ`, `ONGROUND`, `STEPZ`, `JUMP_RELEASED`,
  `NOCLIP`, `BOB_PITCH`); a new piece of state the move reads goes there as well.
- A recording (`record <name>` at the console, `src/record.js`) writes protocol 34 (the released Quake 2's) and
  `CS_MAPCHECKSUM` as `Com_BlockChecksum` of the .bsp (an MD4), which the client checks against the map it loads:
  a recorded game plays in Quake 2 itself only with the same pak. The page plays its own recordings from the Demo
  select or `demomap`; a block must stay under `MAX_MSGLEN` (1400 bytes), so the entities that do not fit a frame wait.
  A kind's `n` packs what the message carried (7: count × 16 + colour; 10: count × 256 + colour). The client's own
  chances and sounds in `CL_ParseTEnt` (a gunshot's ricochet) are the game's here, drawn from `rnd()`.
- A projectile's `waterlevel` is read as it flies (`toss_move`'s water check covers movetype 9, the missiles), so a
  rocket's explosion knows it is under water; a thing spawned under water and hitting the bottom in its first tic
  explodes dry, as Quake's did.
  Entity pitch is Quake's: positive is downward (`angleMatrix`, `AngleVectors`).
- A monster whose model the pak lacks (the full game's in the demo pak) runs on a model row without a mesh: its
  `anims` table in `src/gamedata.js` (the m_*.h runs, in the model's order) becomes its `anims` rows, every
  animation it names must be in it, and the painter skips a model it has no mesh for. A pak with the MD2 uses
  the MD2's runs instead. Its sounds are queued like any other; the smoke test's sound check lets a monster's
  whole directory be missing from the pak.
- A client's userinfo (`player.netname`, `player.hand`, `player.spectator`: the player setup's name and hand, and a guest's "spectate") is not the level's:
  `init_map` and a loaded save make the player table anew, so `Session.userinfo` keeps it and `applyUserinfo`
  writes it after every load; a guest's comes over the link (`info`). Read the hand from the tic row (`HAND`),
  never from the page's settings: the other views' clients have their own.
- Every chance comes from `rnd()` (game.sql), never `RAND()`: a seeded generator in the session context,
  so a game is a function of its seed and its inputs (`test:replay` holds it to that). Seed with
  `loadMap(…, { seed })` or the console's `seed <n>`; `game.rng_seed` records a new game's; a save carries
  the state.

## Browser testing

- The desktop app's built-in browser pane cannot start the Firebird worker; use Claude in Chrome
  (the user's Chrome) or a real browser. The dev server: `PORT=8081 node scripts/build.mjs --serve`
  (as Pages: the engine's build without threads), `--coi` added for the threaded build.
- A background tab is throttled and `document.hidden` pauses the loop; the stats line's fps is
  meaningless there. Read the tic / frame query / raster costs instead, or bring the tab to the
  front.
- Nothing in the page needs sign-in or personal data; the only inputs are the pak and music files, which the
  page keeps in IndexedDB (`src/demostore.js`, with the recordings): a picked pak loads at the next start
  in place of the demo's until the "demo pak" button forgets it. A browser test that picks one uses a copy
  of the demo's pak under another name, and the music control takes a folder path (Playwright's rule for a
  `webkitdirectory` input), never a file buffer.
- Each build stamps its files with a new `?v=` id, so a reload after a rebuild fetches the new bundle;
  a page left open from before still runs the old one until it is reloaded. The caching service worker
  (`public/sw.js`) serves a build's files from its own cache (`fbq2-build-<id>`) and the pak from `fbq2-data`:
  a browser that has run the page keeps playing a build offline until a new one's worker takes over (it does at
  once, and drops the older caches). In a headless test, `context.setOffline(true)` and a reload play from the caches. A hidden tab
  (`document.visibilityState`) is throttled so hard that a load takes tens of seconds and screenshots
  time out: judge timings in Node, check the page's state with JS.

## Conventions

- SQL comments say which Quake 2 function a routine is (`-- SV_movestep`, `-- R_MarkLeaves`).
  Keep that: it is how the port stays checkable against the original.
- Keep `frame_faces` (the SQL-projecting renderer mode) in step with `frame_all`; the pixel
  comparison depends on both selecting the same faces.
- When adding a column to `ents`, remember `set_model` (kind, radius), `link_core` (leaf,
  clusters, link position), and that the row is already ~120 columns wide: prefer fewer writes.
  A per-frame cache column goes into `SKIP` in `src/savegame.js`; any other new column changes the
  save format (bump `SAVE_VERSION` if old saves must not load).
- README and docs are updated in the same commit as the change they describe; the docs
  screenshots are regenerated (`node scripts/screenshot.mjs demo1`, `demo2`, `demo3`) when the painter
  changes, visibly or not: `test:golden` compares them pixel for pixel, so a painter change that leaves
  them as they were fails CI until they are.
- Attribution: when an agent wrote a commit, end its message with a `Co-Authored-By:` line naming
  the model that wrote it (the session tells the agent which).
