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

- **Monster details.** Done: soldiers, infantry and gunners duck under a quarter of the player's
  blaster bolts, rockets and BFG balls aimed at them (`check_dodge`, `monster_dodge`: the duck frames
  with the box 32 units lower); idle sounds while standing and search sounds while walking come every
  15–30 seconds, as `ai_stand` and `ai_walk` timed them; a `combattarget` sends the monster running
  for its `point_combat`, ignoring the enemy, on along the points' targets, firing their pathtargets,
  and standing its ground at a held one (it used to fire the combattarget as an ambush trigger, and
  the points were not spawned); `trigger_monsterjump` throws the monster the trigger's way (it used
  the monster's own facing). Left: the soldiers' crouch-and-fire (`attack3`) as a dodge on medium and
  hard, the gunner's grenade from the duck, the exact `ai_run` sub-states (lost sight, trail following,
  sliding), and the parasite's drain is a laser beam, not the hooked animation.
- **Pusher edge cases**: done, against Quake 2 3.14's g_func.c. A door, plat or train blocked by
  anything but a monster or the player hurts it to death and blows it away; a train deals 100 at most
  every half second (none with `TRAIN_BLOCK_STOPS`), buttons none. `func_water` has the water sounds
  for sounds 1 and 2, speed 25, no damage, and is a toggle when its wait is -1. `func_object` (a brush
  that drops, at once or when used), `func_killbox` and `func_conveyor` (solid; its speed only
  scrolls textures) are spawned and tested on synthetic entities, as none of the demo maps has one.
  Testing it found `mover_blocked` had never run: a forward-declaration stub in monsters.sql, which
  loads after game.sql, replaced its body with an empty one. Left: `func_clock`, which needs
  `target_string`'s digits. (The roadmap used to list `movewith`
  and `WATER_SMART`: those come from later mods, not from Quake 2.)
- **Damage effects**: done, against g_combat.c and g_weapon.c. Blast damage reaches as far as
  `findradius` (the radius, measured to the middle of the target) and no farther, and `CanDamage`
  looks along five lines, as Quake 2 did. The BFG has its final blast (the frame after the ball
  strikes, up to 500 × (1 − √(d/1000)) to everything both the ball and the shooter can see), its
  impact splash over 100 units rather than the blast's 1000, a core hit that is not energy damage,
  and lasers of 10 that carry on through monsters to the wall and reach barrels too. The railgun is
  no longer marked as energy damage, so armour protects fully against it. The per-cause death
  messages and the means-of-death bookkeeping are left out on purpose: Quake 2 prints them only in
  deathmatch and coop, and in single player says "died." and nothing else.
- **Water**: done as far as Quake 2 had it. Bullets that reach water splash at the surface in its
  colour (`TE_SPLASH`), go on under it with twice the spread and leave a bubble trail
  (`TE_BUBBLETRAIL`), as `fire_lead` did; the splash colours are `cl_tent.c`'s (`target_splash`'s
  slime, lava and blood used to come out orange, blue and grey). The rest of the old entry was not
  Quake 2: both its renderers ripple every warping surface at one speed, a player or a grenade
  entering water makes only a sound, and no monster of the demo swims (the full game's barracuda
  shark is in the list of missing monsters). Left: murky water's brown splash, which Quake 2 told
  from the surface's texture name (`*brwater`), not passed through the traces here.
- **View**: done. `C` crouches as pmove's `PM_CheckDuck` did: on the ground the box drops to 4 units
  high, the eye to -2 and the speed to 100, and a ducked player stands up only where the full box fits
  (under a low ceiling it stays ducked); crouching in water swims down. The view bobs as
  `SV_CalcViewOffset` had it: a walk cycle (`bobtime`) that advances with the speed while on the
  ground, four times as fast ducked, giving the height (at most 6), pitch and roll; the gun sways with
  the same cycle and lags behind turns (`SV_CalcGunOffset`). The Run setting is `cl_run`: always run
  with Shift to walk, or the other way. Found on the way: the player's ground flag came and went every
  other tic (the move finds the floor only by falling onto it), so friction, acceleration, jumping and
  ducking acted on half the tics; `player_think` now probes a quarter unit down after the move, as
  `PM_CatagorizePosition` did. With that, two more came to light: on the ground the vertical speed is
  now zero as in pmove (a knockback's small downward push used to sink the box into the floor a few
  thousandths at a time until the player was stuck), and the standing-still shortcut writes the speed
  friction has just taken away (the row kept 12 units a second forever). And a saved game now comes
  back exactly: a double passed as a query parameter goes to Firebird as text, whose conversion lost the
  last bit of one value in six, so `importSave` sends doubles as an integer and a power of two.
- **Weapon keys**: done, as the demo's own `default.cfg` binds them: 1–5 blaster to chaingun, 6 grenade
  launcher, 7 rocket launcher, 8 hyperblaster, 9 railgun, 0 BFG10K, and `G` "use grenades" (the page's
  give-everything key moved to the console's `give all`). Choosing follows `Cmd_Use_f` and
  `Use_Weapon`: "Out of item: Shotgun", "No Shells for Shotgun.", "Not enough Cells for BFG10K.";
  `/` and the wheel (`weapnext`) pass over weapons without the ammo for a shot.
- **Powerups in the inventory.** Single-player Quake 2 put a picked-up quad, invulnerability, rebreather,
  environment suit and silencer in the inventory, used with `default.cfg`'s keys (`q`, `i`, `b`, `e`,
  `s`) or the inventory (`TAB`, `[` `]`, `ENTER`), at most one held (two on easy and medium); here
  they take effect on pickup, as deathmatch's instant items did.
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
