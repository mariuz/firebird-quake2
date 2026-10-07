# Roadmap: what is missing

What the port does not do yet, in rough order of how much it would add for a player of the demo,
then for the full game. Each item names where it would go. See [ARCHITECTURE.md](ARCHITECTURE.md)
for how the existing parts work and the repository's [CLAUDE.md](../CLAUDE.md) for how to work on
them.

## Playing the demo

- **Save and load**: done as one quick slot (`F6` / `F9`, `src/savegame.js`, tested by
  `scripts/save-test.mjs`). Left: several named slots and a load/save menu, autosave on entering a
  map, saving across a level change (the save is one map's tables; the unit's cross-level flags are
  below), and a save format version bump whenever `ents` or `player` gain columns (the format is the
  schema's column list, so old saves simply fail to load).
- **Cross-level state**: done. `game.serverflags` holds the unit's eight flags across maps (a new
  game clears them); a used `target_crosslevel_trigger` sets its spawnflags there and is spent; a
  `target_crosslevel_target` looks once, after its delay, and fires its targets when every flag it
  asks for is set (`crosslevel_think`). The smoke test exercises the pair and the level change. Left:
  per-level state when returning to a map (Quake 2 keeps each level's entities in the unit's save;
  here a revisited map spawns fresh, so the Installation's exit opens but its monsters are back).
- **Area portals**: done. The BSP's areas and portals are tables; `portal_state` says which are open,
  `area_flood` (`FloodAreaConnections`) which areas are connected, recomputed when a door opens or
  closes (`door_use_areaportals`) or a `func_areaportal` is used. Marking keeps only the leaves of the
  eye's connected areas, and the entity pass only the entities in them; a change forgets the marked
  view. Left: a door's own faces are still listed from either side (brush models skip the area test,
  which keeps a door visible from both areas), and the re-mark a door causes is the usual hitch.
- **Intermission and the unit's end**: done, as single-player Quake 2 has them. A plain exit is taken
  at once behind the loading plaque; a unit's end (`*` in the map) parks the player at an
  `info_player_intermission`, the world frozen, until fire or jump after five seconds; a `.pcx` exit
  (the demo's `victory.pcx`) shows the picture in its own palette until a key, then a new game; `a+b`
  chains. The help computer (`F1`) shows the level's counts and the two `target_help` messages, and the
  status bar blinks its icon while there is news. Left: cinematics (`.cin`) are skipped; Quake 2 single
  player shows nothing over the intermission view, while here the help computer's counts are drawn on it.
- **Teleporter in demo3**: not a bug. It and its destination carry spawnflags 1792 (not easy, not
  medium, not hard), Quake 2's mark for deathmatch-only entities, like every other entity the demo
  maps leave out in single player. Checking it found the filter skipping spawnflag 4096 as "coop
  only"; it is `SPAWNFLAG_NOT_COOP`, which single player ignores, so that line is gone, and the
  five filter bits are now cleared after filtering, as `SpawnEntities` did.
- **Cheats and console commands**: done. The backquote opens a command line over the view:
  `god`, `notarget`, `noclip` (flies where the view points, through walls, touching nothing),
  `give all|health|weapons|ammo|armor|keys`, `kill` (godmode or not), `map <name>` (a new game),
  `save`, `load` (`player_command` in weapons.sql for the game's part). Left: `give` of a single
  named item, `fov`, `use`/`drop`, command history and completion.
- **Demo playback / recording** (the `.dm2` files in the pak) is out of scope for now.

## Fidelity gaps in what exists

- **Monster details.** Soldiers, infantry, gunners, berserkers, flyers, parasites and the tank
  are here with their attacks; missing are duck/dodge (`monster_dodge`), the sight/idle/search
  sound cadence of each monster, `point_combat` paths (spawned but unused), `trigger_monsterjump`
  jumps (handled in `run_physics` but untested), and the exact `ai_run` sub-states (ai_charge
  turning while firing, the "blind fire" of 3.20). Flyers and parasites use the generic ranged
  attack; the parasite's drain beam is a laser beam, not the hooked animation.
- **Pusher edge cases.** Trains with `func_train` `block` damage and `movewith` are not there;
  rotating doors with `X_AXIS`/`Y_AXIS` exist, `func_door` `TOGGLE` and `START_OPEN` are honoured,
  but `func_water` moves only as a plain door (no `WATER_SMART`). `func_conveyor`, `func_killbox`,
  `func_object` and `func_clock` are not implemented (none in the demo).
- **Damage effects.** Armour, power screen/shield, quad and invulnerability work; missing are the
  `DAMAGE_RADIUS` falloff details for the BFG's final blast against the world, `MOD_*` death
  messages (there is one generic message), and the `means of death` bookkeeping.
- **Water.** Swimming, drowning, lava and slime damage, water surface warping and the underwater
  tint are in. Missing: the water-entry splash particles and bubbles, `SURF_WARP` turbulence
  speed by contents, the swim animation of monsters.
- **View.** Bob, step smoothing, kick and the death roll exist; the view weapon has no bob
  animation of its own, there is no `cl_run` toggle (shift walks), and crouching is not
  implemented at all (pmove's duck state and the 32-unit box).
- **HUD.** The status bar and the main numbers, pickup messages, centre prints and the help
  computer (`F1`) are in; the inventory screen, the score board and the menu system are not.

## Rendering

- **Dynamic lights**: muzzle flashes, rockets, the BFG glow and explosions light nothing;
  `R_PushDlights` would mark surfaces to rebuild with an added light term (the surface cache key
  would carry it).
- **Mipmaps**: the painter samples mip 0 always; ref_soft picked the mip level by scale, which
  is the visible difference on far walls (shimmer). `Wal.mips` has all four.
- **Translucent water from inside / warp surfaces**: the underwater screen warp
  (`D_WarpScreen`) is not done; the tint is.
- **Entity lighting**: alias models take the lightmap value under them plus Gouraud; there is no
  light from dynamic lights and no shadow (ref_soft had none either).
- **Sprites**: oriented sprites (`SPR_ORIENTED`) are drawn as billboards.
- **Sky**: the cube map is sampled per pixel; the sky's rotation (`sky_rotate`, `sky_axis`) is
  stored by the loader but the painter does not turn it.
- **Resolution and scaling**: 320×240 and 160×120 with CSS scaling; a 640×480 mode would cost
  four times the raster, which the painter could now afford on a desktop.

## Sound

- **Sound effects list**: everything the game references exists in the pak (the smoke test
  asserts it). Looped entity sounds (`s.sound`: a rocket's flight, the BFG's hum) are played once
  at launch instead of following the entity; item respawn sounds are not needed in single player.
- **Music**: CD tracks are optional files; the synthesised drone is a placeholder.
- **Attenuation of looped speakers** follows the spawn's `attenuation`; `ATTN_STATIC` (3) is
  treated like `ATTN_IDLE`.

## The full game (a registered `pak0.pak`)

The base unit's maps load (`npm run fetch-pak` with `PAK=/path/to/pak0.pak`, or the page's file
picker). Missing for the rest of the game:

- **Monsters**: gladiator, iron maiden (chick), brain, medic (and its resurrection), mutant,
  icarus (hover), technician (floater), barracuda shark (flipper), the supertank, the hornet
  (boss2), Makron with Jorg (boss3), the insane marines, the commander body. Each is a row in
  `monster_types` (`src/gamedata.js`) plus whatever special attack or behaviour it has in
  `monsters.sql` (`check_attack`, `monster_missile`, `monster_melee`).
- **Map entities**: `target_actor` / `misc_actor`, `target_character`, `target_string`,
  `target_earthquake`, `target_mal_laser`, `misc_blackhole`, `misc_eastertank`,
  `misc_easterchick`, `trigger_elevator`, `func_conveyor`, `func_killbox`, `misc_bigviper` flight
  paths, the `misc_strogg_ship` flyby, `target_spawner` (recognised), `func_group` (editor-only,
  correctly ignored).
- **Cutscenes**: the intro and the unit transitions are cinematics (`.cin`); a level exit naming one
  skips it and goes on to the map after its `+` (`src/levels.js`).
- **Coop and deathmatch**: `info_player_coop` / `info_player_deathmatch` are recognised and the
  spawnflag filters are applied, but there is one player row and no networking; a second local
  player would mean a second `player` row and a second view, which the SQL could carry.

## Engineering

- **Load time**: about three seconds for a map, mostly the text bulk loader (`LOAD_<table>`
  procedures parsing 30 KB chunks). A binary blob path would need `firebird-wasm` to bind blobs.
- **The cluster-change hitch**: `mark_faces` re-marks the PVS's faces on a cluster change
  (tens of milliseconds). Marking the next cluster ahead of time, or keeping the last few marked
  sets in their own tables, would hide it.
- **The tic's floor**: a monster step is a three-call box trace plus a relink, about 0.7 ms;
  with many monsters in a big room the tic grows linearly. The engine's per-level cost of a tree
  descent (~16 µs) is the limit; ideas left on the table are in ARCHITECTURE.md §10.
- **Tests**: the smoke tests cover movement, weapons and doors on demo1 and demo2; demo3 is only
  screenshotted. There is no test of triggers and targets firing in sequence (a scripted
  walkthrough of a map would catch regressions in `use_targets`), none of the pushers crushing,
  and the painter's only regression test is the two-mode pixel comparison plus the docs
  screenshots viewed by eye.
- **`firebird-wasm` features to watch**: binding non-text parameters, batch inserts, and
  `SharedArrayBuffer`-free builds (which would remove the COOP/COEP requirement and the service
  worker).
