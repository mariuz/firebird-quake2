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
`src/` (pak/bsp/md2 parsers, loader, renderer, hud, audio, main), `scripts/` (tests, benchmarks,
tools), `public/` (page, service worker, the pak goes in `public/pak/`), `docs/`.

## Commands

```bash
npm install && npm run fetch-pak      # once: the demo's pak0.pak (needs 7-Zip or unzip)
node scripts/sql-check.mjs            # compile the SQL (run after every SQL edit; ~20 s)
npm test && npm run test:base2 && npm run test:base3   # smoke tests, demo1, demo2 and demo3 (~1 min each)
npm run test:monsters                 # every monster: sees, attacks, dies
npm run test:save                     # save, play on, load: the game comes back exactly
node scripts/screenshot.mjs demo1 /tmp/x --compare   # both renderer modes paint identical pixels
npm run serve -- --coi                # dev server with cross-origin isolation (PORT=8081 to pick a port)
npm run bench:tic / bench:raster / bench:calls / bench:ab -- <dir>   # measuring (below)
```

A change is done when: `sql-check` passes, the three smoke tests, the monsters test and the save test say `all good`,
`screenshot.mjs --compare` reports `differ in 0 of 76800 pixels` on demo1 and demo2 (and the
viewpoint `--at=300,500,-40,90` by the fan and doors when touching brush models), the page runs
in a real browser without console errors, and CI is green. Commit messages here are written as
short stories of what changed and what it measured; keep that.

## How to measure (do this before optimising anything)

- Timing a procedure in isolation misses the real costs. `scripts/call-counts.mjs` loads the SQL
  with a counter in every hot routine and prints calls per tic: that is what found a 17 ms-per-tic
  bug that no profile showed.
- This machine's timings vary by ±50 % between runs. Compare two SQL trees with
  `node scripts/ab-bench.mjs /tmp/oldsql demo1 [--walk] [--frame [--turn]]`, which loads both into
  two in-memory databases and alternates tics, so load noise hits both alike. Make the baseline
  with `for f in schema physics game weapons monsters render; do git show HEAD:sql/$f.sql > /tmp/oldsql/$f.sql; done`
  (the old SQL must still load with the current `src/loader.js`: keep schema-dependent resets in SQL, not in the loader).
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
10. firebird-wasm sends every query parameter as text, and Firebird's text-to-double conversion is
    off by an ulp for about one value in six. Where a double must arrive exactly (the save's load),
    send `m` and `e` with `v = m × 2^e` and insert `CAST(? AS DOUBLE PRECISION) * POWER(2e0, ?)`.

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
- Spawn points: `info_player_start` with the targetname the previous level's
  `target_changelevel` asked for (`map$spawnpoint`), else the one without a targetname.
- A monster's `combattarget` names a `point_combat` to run to when it first sees the player, not
  targets to fire; `point_combat` is a trigger the monster touches. `trigger_monsterjump` (like
  `trigger_push`) keeps its direction in `p1x`/`p1y` because the trigger spawn zeroes every
  trigger's yaw.
- Level exits: single-player Quake 2 has no intermission between ordinary levels; only a unit's end
  (`*` in the map string) stops at one. The map string is kept as written in `game.next_map` and
  parsed by `src/levels.js`, never in SQL.
- A tic is 0.05 s (20 Hz): 20 tics are a second. The ground flag (512) must hold every tic the player
  stands on a floor; pmove-style code that runs only `IF (onground = 1)` silently halves otherwise. On the ground the
  player's `vz` is 0 (pmove); any path that skips the move must still write the speed it computed.
- Skill numbers are Quake's: 0 easy, 1 medium, 2 hard. The scripts load maps at skill 2 (hard).
- Spawnflags 256/512/1024 keep an entity out of easy/medium/hard; an entity with all three (1792) is
  deathmatch-only, and the demo maps have many (weapons, ammo, demo3's teleporter). Before calling
  an entity "missing", check its spawnflags.
- `IIF`/`CASE` over string literals of different lengths pads the shorter one with spaces: `TRIM`
  the result when it is compared or shown.

## Browser testing

- The desktop app's built-in browser pane cannot start the Firebird worker; use Claude in Chrome
  (the user's Chrome) or a real browser. The dev server: `PORT=8081 node scripts/build.mjs --serve --coi`.
- A background tab is throttled and `document.hidden` pauses the loop; the stats line's fps is
  meaningless there. Read the tic / frame query / raster costs instead, or bring the tab to the
  front.
- Nothing in the page needs sign-in or personal data; the only inputs are the pak and music files.

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
  screenshots are regenerated with `npm run screenshots` when the painter changes visibly.
- Attribution: when an agent wrote a commit, end its message with a `Co-Authored-By:` line naming
  the model that wrote it (the session tells the agent which).
