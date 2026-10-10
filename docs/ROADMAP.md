# Roadmap: what is missing

What the port does not do yet, in rough order of how much it would add for a player of the demo,
then for the full game. Each item names where it would go. See [ARCHITECTURE.md](ARCHITECTURE.md)
for how the existing parts work and the repository's [CLAUDE.md](../CLAUDE.md) for how to work on
them.

## Playing the demo

- **Save and load**: done as Quake 2 had them in single player: fifteen slots in the load and save menus
  (`F3`, `F2`), save0 the autosave written as each map starts ("ENTERING Outer Base", as
  `SV_GameMap_f` copied it), the others named with the time and the level as `SV_WriteServerFile` did,
  plus the quick slot (`F6` / `F9`). Dying and pressing fire brings up the load menu (`respawn` in single
  player). `src/savegame.js`, tested by `scripts/save-test.mjs`. A save carries the unit's other levels
  as they were left (below), as `SV_WriteServerFile` copied every level's `.sav` beside the game's, and a
  loaded game comes back to them as left. Left: a save made by an older schema loads with the new columns'
  defaults, and one whose columns are gone fails (bump `SAVE_VERSION` when that matters).
- **Cross-level state**: done. `game.serverflags` holds the unit's eight flags across maps (a new
  game clears them); a used `target_crosslevel_trigger` sets its spawnflags there and is spent; a
  `target_crosslevel_target` looks once, after its delay, and fires its targets when every flag it
  asks for is set (`crosslevel_think`). The smoke test exercises the pair and the level change. A level
  left by an ordinary exit is kept (`exportLevel` in `src/savegame.js`, as `SV_WriteLevelFile` wrote it: its
  entities but the player, its lights, its area portals, its clock and counts) and comes back as it was left
  when the unit returns to it (`importLevel`, `SV_ReadLevelFile`), the player put in afresh at the spawn point
  it came in by; a unit's end, a new game or a loaded game forgets them. The levels live in the page's memory,
  not in the saved game. Powerups running when a level is left stop there, as `PutClientInServer` cleared them
  (they used to run on for as long as the old level's clock had left them).
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
  status bar blinks its icon while there is news. At the intermission the status bar is drawn over the
  frozen view and nothing else, as `SCR_DrawStats` drew it with no layout in single player (the help
  computer's counts used to be drawn there). Left: cinematics (`.cin`) are skipped.
- **Teleporter in demo3**: not a bug. It and its destination carry spawnflags 1792 (not easy, not
  medium, not hard), Quake 2's mark for deathmatch-only entities, like every other entity the demo
  maps leave out in single player. Checking it found the filter skipping spawnflag 4096 as "coop
  only"; it is `SPAWNFLAG_NOT_COOP`, which single player ignores, so that line is gone, and the
  five filter bits are now cleared after filtering, as `SpawnEntities` did.
- **Cheats and console commands**: done. The backquote opens a command line over the view:
  `god`, `notarget`, `noclip` (flies where the view points, through walls, touching nothing),
  `give all|health|weapons|ammo|armor|keys`, `give <item>` by its pickup name as `Cmd_Give_f` had it
  (spawned on the player and touched; an ammo adds one pickup's worth, `give shells 20` or `give health 50`
  sets the count), `use <item>`, `kill` (godmode or not), `map <name>` (a new game), `fov <degrees>` (1 to
  160), `save`, `load` (`player_command` in weapons.sql for the game's part). Up and down step through the
  lines typed, Tab completes a command's name. `drop <item>` is `Cmd_Drop_f`: ammo a pickup's worth, a weapon
  not in hand, a powerup, power armour (off with the last), thrown ahead and not back to its dropper for a
  second; a dropped weapon carries no ammo.
- **Demo playback / recording** (the `.dm2` files in the pak) is out of scope for now.

## Fidelity gaps in what exists

- **Monster details.** Done: soldiers, infantry and gunners duck under a quarter of the player's
  blaster bolts, rockets and BFG balls aimed at them (`check_dodge`, `monster_dodge`: the duck frames
  with the box 32 units lower); idle sounds while standing and search sounds while walking come every
  15–30 seconds, as `ai_stand` and `ai_walk` timed them; a `combattarget` sends the monster running
  for its `point_combat`, ignoring the enemy, on along the points' targets, firing their pathtargets,
  and standing its ground at a held one (it used to fire the combattarget as an ambush trigger, and
  the points were not spawned); `trigger_monsterjump` throws the monster the trigger's way (it used
  the monster's own facing). On medium and hard a soldier often dodges
  with its crouch-and-fire (`soldier_move_attack3`: a third of the dodges on medium, two thirds on hard,
  none on easy): down at the third frame, a shot, back for a second one while `pausetime` allows; the SS
  holds the frame for a burst of 3 to 10 rounds instead. The gunner throws grenades: half its attacks out of
  melee range are `gunner_attack`'s grenade run (`attak1`, four grenades along its facing), and on hard half
  its ducks throw one as it goes down (`gunner_duck_down`); it used to have only the chain gun. A monster that loses sight of the player
  no longer homes in on it through walls: it runs to where it last saw it, then along the player's trail
  (`p_trail.c`: eight markers, one dropped each time the player moves out of sight of the last), five more
  seconds of search for each marker reached, and twenty seconds after the search runs out goes straight for
  the player, as `ai_run` had it; seeing is `visible()`'s, walls only (a monster in the way spoils the shot,
  not the view). The parasite drains as `parasite_drain_attack` did:
  its tongue (`TE_PARASITE_ATTACK`, the segment model strung every 30 units as `CL_AddBeams` drew it) reaches
  up to 256 units and no steeper than 30 degrees, 5 damage as it strikes and 2 a frame for ten frames more,
  with the launch, impact, suck and reel-in sounds (it used to be one bite of 12). A flyer that does not fire slides around its enemy three times
  in ten (`M_CheckAttack`'s `AS_SLIDING`, `ai_run_slide`: square to it, the other way when blocked); the port
  used to set an attack state of its own by range for every monster. The drain is the parasite's attack, as
  `parasite_attack` was, chosen by the attack chances like any monster's missile (it used to be a melee
  started at 200 units). A new pursuit target the monster's box cannot reach straight is detoured as
  `ai_run` detoured it (`AI_PURSUE_TEMP`): a spot 16 units to whichever side goes further, part of the way,
  the real target kept in `saved_goal` until the spot is reached.
- **Pusher edge cases**: done, against Quake 2 3.14's g_func.c. A door, plat or train blocked by
  anything but a monster or the player hurts it to death and blows it away; a train deals 100 at most
  every half second (none with `TRAIN_BLOCK_STOPS`), buttons none. `func_water` has the water sounds
  for sounds 1 and 2, speed 25, no damage, and is a toggle when its wait is -1. `func_object` (a brush
  that drops, at once or when used), `func_killbox` and `func_conveyor` (solid; its speed only
  scrolls textures) are spawned and tested on synthetic entities, as none of the demo maps has one.
  Testing it found `mover_blocked` had never run: a forward-declaration stub in monsters.sql, which
  loads after game.sql, replaced its body with an empty one. (The roadmap used to list `movewith`
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
  shark is in the list of missing monsters). Murky water's brown splash is not a gap either:
  `fire_lead` tells it by the surface name `*brwater`, a Quake 1 name that no Quake 2 texture (they carry
  their directory, `e1u1/…`, and no `*`) can match, so 3.14 splashed blue there too, as the port does.
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
  back exactly: a double passed as a query parameter went to Firebird as text, whose conversion lost the
  last bit of one value in six, so `importSave` sent doubles as an integer and a power of two until
  firebird-wasm 0.4.0 bound numbers in binary.
- **Weapon keys**: done, as the demo's own `default.cfg` binds them: 1–5 blaster to chaingun, 6 grenade
  launcher, 7 rocket launcher, 8 hyperblaster, 9 railgun, 0 BFG10K, and `G` "use grenades" (the page's
  give-everything key moved to the console's `give all`). Choosing follows `Cmd_Use_f` and
  `Use_Weapon`: "Out of item: Shotgun", "No Shells for Shotgun.", "Not enough Cells for BFG10K.";
  `/` and the wheel (`weapnext`) pass over weapons without the ammo for a shot.
- **The inventory**: done, from g_items.c, g_cmds.c and cl_inv.c. Items carry their itemlist index (1 body
  armor … 7 blaster … 23 quad … 40 airstrike marker, 41 health). Powerups go into the inventory (one each on
  hard, two on medium, any number on easy) and are used with `default.cfg`'s keys (Q quad damage, I
  invulnerability, B rebreather, E environment suit; E no longer jumps) or the inventory: TAB shows it (the
  `inventory` panel, keys and counts, the selected line white with a blinking cursor), `[` `]` move the
  selection, ENTER uses it. A power screen or shield is held until used, then switched on and off
  (`Use_PowerArmor`), off by itself when the cells run out; `CheckPowerArmor` as it was: the screen stops a
  third of a blow and only from in front, a cell a point, the shield two thirds from anywhere, a cell for
  two, with their green or blue sparks. The console has `use <item>`, `invuse`, `invnext`, `invprev`,
  `inven`. The status bar is `single_statusbar`: the selected item bottom right, the item just picked up
  (icon and name, three seconds) in place of a message, one powerup timer with its seconds, the help icon
  (or the weapon's when the fov hides the gun), the power armour flashing with the armour; keys show in the
  inventory, as in Quake 2. Pickups as single player had them: a new weapon (or the first grenades) is
  raised at once, a weapon already held is taken for its ammo, a picked-up usable item becomes the
  selection, and an item's targets fire the first time it is touched even when it stays. Left: the
  silencer and the power shield have no key of their own here (`s` and `p` are the page's back and
  pause): the inventory or `use` reach them.
- **HUD and menus**: done. The status bar, centre prints, the help computer (`F1`), the inventory
  (`TAB`) and the menus (`src/menu.js`, from menu.c, qmenu.c and vid_menu.c): Escape (or the mouse let
  go) brings up the main menu over the game, which pauses as single player did, faded by ref_soft's
  stipple; the game menu starts a new game at a skill or opens the load and save menus; options and
  video set the page's settings (effects volume, CD music, mouse speed, always run, invert mouse,
  crosshair; driver = the renderer mode, video mode = the detail, brightness, fullscreen); quit shows the
  quit picture. The score board is a deathmatch and coop screen (`Cmd_Score_f` returns in single player).
  Left out: the credits (id's text), multiplayer (drawn greyed: there is no network), and the options
  that mean nothing here (sound quality, lookspring, lookstrafe, free look, joystick, the key bindings).

## Rendering

- **Dynamic lights**: done, as ref_soft lit them. The page gathers each frame's lights as the client did:
  muzzle flashes (fx 15 from `player_fire` and `monster_missile`: 200 + 0..31, 100 + 0..31 silenced, for
  the frame they arrive in), rockets, blaster and hyperblaster bolts and the BFG ball at 200 (their
  `EF_*` bits), explosions fading with their frames (350, `CL_AddExplosions`'s `ex_poly` alpha; a blaster
  hitting a wall 150). The painter marks a face lit when a light's reach, less its distance to the plane,
  leaves the minimum 32 and overlaps the face (from either side, as Quake 2's lights shone through thin
  walls), adds `R_AddDynamicLights`'s term to its light samples and builds it afresh for the frame, not
  cached; models get `R_LightPoint`'s intensity less distance. Monochrome, as ref_soft was. An entity
  carrying a light comes in the frame whether in the frustum or not (the client had every entity in the PVS
  and lit by all of them): a rocket flying past lights the wall in front. Brush models are lit in their
  BSP position (a moved door or a rotating fan takes the light where it stood): so did ref_soft, whose
  `R_PushDlights` marked a brush model's faces with the light's untransformed origin (later source ports
  moved the light into the model's space; this port keeps ref_soft's look).
- **Mipmaps**: done, as ref_soft chose them. Each polygon's level is `D_MipLevelForScale` of the nearest
  vertex's 1/z times the projection scale times the texture's `mipadjust` (from the length of its texture
  vectors), against `d_scalemip`'s 1, 0.4 and 0.2; the surface is cached per level, built from the
  `.wal`'s smaller image with a light sample every 16 >> level pixels, and the spans step the texels scaled
  to it. Far walls no longer shimmer, and a cold frame builds faster (smaller surfaces). Warping and
  translucent surfaces stay at the full-size image, as ref_soft drew them. At 320×240 most of a room is
  drawn at mip 1 or 2, as it was in the software renderer at that size.
- **The underwater view**: done. With the eye in water, slime or lava (`RDF_UNDERWATER`) the frame is
  resampled as `D_WarpScreen` did it, through `R_InitTurb`'s integer sine table (amplitude 3, a cycle of
  128, sliding 20 steps a second): rows shift along by the table at their row, columns take their row from
  the table at their column, over a grid six pixels larger than the view. The view weapon wobbles with
  it; the status bar does not; the tint is laid over as before. Found on the way: the player's water level
  had not been updated since an optimisation skipped the check when the link position matched the
  origin, which every move's relink makes true, so swimming, drowning, the tint and the water sounds had
  stopped working. `player_think` now remembers where it last worked the level out (`player.water_x/y/z`)
  and works it out again wherever the player is, as `PM_CatagorizePosition` did every frame; the smoke
  test puts the player under water and back.
- **Entity lighting**: done, as `R_AliasSetupLighting` had it. The light under the model's origin
  (`R_LightPoint`, with the dynamic lights near it: a rocket or a bolt is bright by its own light, not by a
  fullbright rule) splits into ambient (at most 128) and shade (at most 192 together, ambient at least 5);
  the shade falls by how far each vertex's normal faces +x, as from `lightvec` (-1, 0, 0) in the world. The
  view weapon has `RF_MINLIGHT` (at least 0.1) and is lit from the eye; items have `RF_GLOW` (`SpawnItem`:
  the light pulses by 0.1 sin 7t, never below 0.8 of itself). No shadows: ref_soft had none.
- **Sprites and explosions**: done. The old entry was Quake 1's: a Quake 2 `.sp2` has no orientation, and
  `R_DrawSprite` always faces the view, as the painter does (each frame anchored by its origin, unlit). What
  was off were the explosions, drawn as a generic sprite: now they are `CL_AddExplosions`'s. Rockets, barrels
  and `target_explosion` are the `r_explode` model from frame 0 or 15 for 15 frames, grenades from frame 30
  for 19; the skin climbs 0-4 over the first ten frames, then 5 and 6 translucent; the BFG's is the `s_bfg2`
  sprite; a blaster's hit is the small `explode` model turned to the hit's direction (now sent with it),
  fading over 4 frames. All fullbright, translucent at 66% or 33% by their alpha as ref_soft chose, and their
  dynamic lights fade with them.
- **Sky**: done. The cube map is sampled per pixel, and a map's `skyrotate` and `skyaxis` (read from its
  worldspawn, as `CL_SetSky` read them from the configstrings) turn it as ref_gl's `R_DrawSkyBox` did:
  time × skyrotate degrees about the normalised axis, the view's axes turned back once a frame so the pixels
  cost the same. ref_soft kept the two values and never used them; none of the demo's maps sets them, so it
  shows in the full game's.
- **Texture animation on brush models**: done, as `R_TextureAnimation` and `CL_AddPacketEntities` had
  it. A button's lights blink between its texture's first two frames and, pressed, its last two
  (`SP_func_button`, `button_wait` and `button_done` switch EF_ANIM01 and EF_ANIM23); doors, rotating doors,
  rotators, walls, objects and explosives with their ANIMATED or ANIMATED_FAST spawnflag cycle every frame
  at 2 or 10 Hz (demo3 has one such door). Before, every brush model's animated texture ran through its
  whole chain with the time, and a frame past the chain's end showed its first picture. `misc_banner`
  waves: `misc_banner_think` moves it to its next frame every 0.1 s (it stood still at a random one).
- **Resolution**: done: 640×480 joins 320×240 and 160×120 (the Detail setting, the video menu's video mode),
  scaled to the page by CSS. As in ref_soft at higher resolutions the status bar, menus and text keep their
  pixel size, centred; particles keep their size on screen (`D_DrawParticle`'s `d_pix_shift`, between
  w/320 and w/80 pixels a side, which also makes near particles at 320×240 up to 4 pixels as they were);
  the mip levels follow the larger projection scale. The raster costs about three times 320×240's (4.2 ms
  warm and 6.4 cold in Node, against 1.4 and 3.1). An underwater view at 640×480 is drawn into ref_soft's
  320×240 warp buffer and warped up to the screen (`R_RenderFrame` made the view rect at most
  `WARP_WIDTH × WARP_HEIGHT`), as coarse as it was.

## Sound

- **Sound effects list**: everything the game references exists in the pak (the smoke test
  asserts it); item respawn sounds are not needed in single player.
- **Looped entity sounds**: done, as `s.sound` and `S_AddLoopSounds` had them. Bolts, rockets and the
  BFG ball carry their flight sound, doors, plats and trains their middle sound while they move (only
  the team's master, as `FL_TEAMSLAVE` kept the others quiet), and the player the lava fry, the
  railgun's and BFG's hum and the hyperblaster's and chaingun's firing loop, each from where the entity
  is every frame (they used to play once at launch, or as a fresh copy every shot, piling up). A train's
  `noise` is now its middle sound, looped while it moves, not a one-shot at each corner. Left: Quake 2
  placed a brush model's loop at its origin, often the map's centre; here it sounds from the box's
  middle, as the one-shot sounds already did.
- **Music**: CD tracks are optional files; the synthesised drone is a placeholder.
- **Looped speakers**: done. In 3.14 a looped `target_speaker` is its `s.sound`, so it goes through
  `S_AddLoopSounds` with the entities' loops: full volume and `ATTN_STATIC` (heard to about 410 units),
  whatever its `volume` and `attenuation` keys say (those apply to its one-shots), and two speakers of the
  same sound add up, each side clamped. They used to play at their own attenuation, at 0.6 of their volume.

## The full game (a registered `pak0.pak`)

The base unit's maps load (`npm run fetch-pak` with `PAK=/path/to/pak0.pak`, or the page's file
picker). Missing for the rest of the game:

- **Monsters**: gladiator, iron maiden (chick), brain, medic (and its resurrection), mutant,
  icarus (hover), technician (floater), barracuda shark (flipper), the supertank, the hornet
  (boss2), Makron with Jorg (boss3), the insane marines, the commander body. Each is a row in
  `monster_types` (`src/gamedata.js`) plus whatever special attack or behaviour it has in
  `monsters.sql` (`check_attack`, `monster_missile`, `monster_melee`).
- **Map entities**: done for `func_door_secret` (back, a second, aside, its wait, and home; shot open
  unless named, or with ALWAYS_SHOOT; silent, as its own moves never played the sounds it loaded),
  `target_earthquake` (a grounded player thrown up and about every 0.1 s, the rumble every half second,
  for `count` seconds), `trigger_elevator` (the train goes to the corner its user's pathtarget names, not
  while it moves), `misc_viper` (a train like the strogg ship, unseen until used) and `misc_viper_bomb`
  (falls along the viper's way and goes off where it lands); `target_string` with its
  `target_character`s (the string's characters as the brush models' frames: digits, `-` 10, `:` 11,
  blank 12, each character the `count`th) and `func_clock` (counting up or down once a second to its
  `target_string`, its pathtarget fired past its count, MULTI_USE starting over, START_OFF waiting to be
  used; else the time of day as `hh:mm:ss`); the decorations `misc_blackhole` (19 frames at 10 Hz,
  translucent, gone when used), `misc_eastertank` and `misc_easterchick`/`2` (their monsters' frame
  runs; the demo pak has no chick model, so those show nothing here) and `light_mine1`/`2`.
  The turrets (g_turret.c): `turret_breach` aims where its driver points it, clamped to its
  minpitch/maxpitch and minyaw/maxyaw, turning at its speed as a pusher, the `turret_base` turning with it
  and the `turret_driver` (an infantry, counted as a monster) carried round on it; the driver finds the player
  as a monster does, keeps it while seen, and asks for a rocket after the reaction time (3 − skill seconds),
  then every reaction time + 1, fired from the muzzle its target marked in the driver's name; killed, it
  dies as an infantry and the gun levels; what blocks a turning part is hurt by the breach's dmg.
  `target_spawner` spawns its target's classname at its place through the map's own spawn function
  (`spawn_map_ents` with one row) and sets it off along its angle at its speed.
  `scripts/entities-test.mjs` adds them all to demo1's lump and checks them. Missing (checked against
  g_spawn.c's spawn table): `target_actor` / `misc_actor` and `misc_insane`, which need the actor and
  insane marines' models and animation tables. `misc_bigviper` stands still, as in Quake 2. `func_group` is editor-only and correctly ignored;
  `viewthing` is a debugging aid. (`target_mal_laser`, once listed here, is the first mission pack's.)
- **Trains**: `func_train_find` put a train on its first corner and aimed it at the next; the port aimed
  it at the first again, so every train (and demo1's three strogg ships) began with that corner's wait
  and pathtarget, which Quake skipped. And `train_wait` lent a corner's target to its pathtarget without
  giving it back, so a looping train that came round to it again followed the pathtarget. Both as in
  g_func.c now; the ships are unseen until their trigger uses them.
- **Cutscenes**: the intro and the unit transitions are cinematics (`.cin`); a level exit naming one
  skips it and goes on to the map after its `+` (`src/levels.js`).
- **Coop and deathmatch**: `info_player_coop` / `info_player_deathmatch` are recognised and the
  spawnflag filters are applied, but there is one player row and no networking; a second local
  player would mean a second `player` row and a second view, which the SQL could carry.

## Engineering

- **Load time**: about two and a half seconds for a map in Node, 2.3 on a good run. The map's
  rows go in through firebird-wasm's `execBatch`, since 0.4.1 one `IBatch` request to the engine
  per 8,192 rows. Measured with both loaders in one process, alternating, demo1 four times each:
  the `LOAD_<table>` PSQL chunk procedures 2753 ms, `execBatch` 2331 ms (0.4.0's batch, a
  statement execute per row inside the engine, had been 13 % slower than the procedures). What is
  left is the inserts themselves (`face_verts`' 37 k rows at ~12 µs each, mostly the primary key),
  `init_map` and, on a reload, the old map's `DELETE`s (half a second). Next: drop the primary keys
  before the load and create them after (an index built in one pass is cheaper than 37 k index
  inserts), load `face_verts` after the first frame is up (only the painter's surface builds read
  it), and put the `DELETE`s into the loading plaque's first tic.
- **Saves and `localStorage`**: a save is JSON, uncompressed; a demo3 save carrying two levels left
  is 495 KB (46 KB gzipped), and fifteen slots plus the autosave share an origin's ~5 MB. Compress
  with `CompressionStream('gzip')` on the way in (and accept both forms on the way out), or move the
  slots to IndexedDB, which has no such budget.
- **A browser test in CI**: every test runs the SQL in Node through `DirectTransport`; the page
  itself (the worker, the service worker's cross-origin isolation, the canvas, the input) is checked
  by hand. A Playwright run against `scripts/build.mjs --serve --coi` that loads demo1, plays a few
  tics and reads the stats line would catch what the Node tests cannot.
- **Deterministic replays**: the SQL draws its chances from Firebird's `RAND()`, so a bug seen once
  cannot be played again. A seeded generator in SQL (an LCG kept in `game`, the seed saved with the
  game and printed by the console) would make a replay of the inputs reproduce the run, and would let
  the tests assert exact outcomes where they now assert ranges.
- **`run_think`**: a chain of 38 `IF (think = '…')` string comparisons, walked for every think of
  every entity every tic. A think code (an integer column set with the name, `CASE` over it) or
  `EXECUTE STATEMENT` are the two ways out; the chain's cost should be measured with
  `call-counts.mjs` before either, as the tic's floor is the trace, not this.
- **Spawn-time thinks**: spawn functions schedule first thinks from the level's start (`nextthink =
  0.1`), as `init_map` runs at time 0, and `target_spawner` adds `now_()` for an entity spawned later.
  Scheduling every spawn relative to `now_()` would remove the special case and the trap for the next
  spawner-like entity.
- **Phone and gamepad**: the page takes keys and the mouse only. Touch controls (a stick for moving, a
  drag for looking, buttons for fire and jump) and the Gamepad API would make the demo playable on a
  phone, where the WASM engine already runs; the view at 160×120 is the detail setting for it.
- **Code health**: `src/main.js` is 839 lines: the loop, input, settings, the menus' `host` object, the
  console and the page's wiring in one file. The `host` object and the loop could stand apart from the
  DOM, so the headless tests could drive the page's logic as `menu-test.mjs` drives the menus.
- **The cluster-change hitch**: smaller. Marking a new cluster went from ~43 to ~17 ms (the
  PVS's clusters looked up by index instead of every leaf's bit tested), and the last eight marked
  sets are kept, so walking back into one costs ~0.3 ms. A door opening or closing drops only the
  sets whose area's connections changed (each set keeps the areas its flood joined), so the others
  outlive it. Left: marking the next cluster ahead of time (the page would need an idle moment in
  the worker to spend on it); the eye's own re-mark when a door in its group of areas moves is
  the one hitch that stays, since what it sees changes.
- **The tic's floor**: a monster step is a three-call box trace plus a relink, about 0.7 ms;
  with many monsters in a big room the tic grows linearly. The engine's per-level cost of a tree
  descent (~16 µs) is the limit: a trace is 23 levels and 6.6 `rhc` calls on average, and the walk
  is nine tenths of it. Brush deduplication (`checkcount`) and a cached start node were measured on
  replayed real traces and rejected (ARCHITECTURE.md §10). A player wedged between two steep
  slopes, falling every tic without moving (as pmove would leave it), costs ~11 ms a tic: each of
  its traces reaches seven leaves.
- **Tests**: the smoke tests cover movement, weapons, doors, items and the console on all three demo
  maps; `test:monsters` every monster's sight, attacks and death; `test:entities` the full game's entities
  that the demo lacks, put into demo1; `test:walkthrough` every trigger the
  player can walk into on the three maps (it fires, the movers it targets move), with the smoke test
  closing a door on a monster and on a barrel as `door_blocked` had it; `test:save` saves, levels left
  and come back to; `test:menu` the menus; `test:painter` the painter's dynamic lights and mip levels.
  What has no test but the docs screenshots viewed by eye: the painter's look beyond those, and the
  sound mix.
- **`firebird-wasm`**: 0.4.0 binds a number in binary where the column is a number (a double
  arrives exactly: the save's mantissa-and-exponent trick is gone) and has `execBatch` (one statement,
  many rows, one call); 0.4.1 runs the batch as one `IBatch` request, and the map load uses it (see
  *Load time*). Still to come there: a `SharedArrayBuffer`-free build, which would remove the
  COOP/COEP requirement and the service worker that exists only to supply it (planned in
  firebird-wasm's `docs/plans/sab-free-build.md`: the engine starts threads, so it is not a flag).
