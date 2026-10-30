# Roadmap: what is missing

What the port does not do yet, in rough order of how much it would add for a player of the demo,
then for the full game. Each item names where it would go. See [ARCHITECTURE.md](ARCHITECTURE.md)
for how the existing parts work and the repository's [CLAUDE.md](../CLAUDE.md) for how to work on
them.

## Next

What the demo pak still allows, now that everything below is done or waits on the registered pak. In
the order they are to be taken.

- **Networked coop over WebRTC**: done for two pages, the one way past the local limit, since each
  browser runs its own database (`src/net.js`; ARCHITECTURE.md §8). The host's page is the server, as
  `sv_main.c` was: its `Session` runs a coop game, and the second client's usercmd is what the guest sent
  since the last tic, merged (the turns summed, a button pressed in any held, the last impulse). After
  each tic the host asks the frame for the guest too and sends it with the guest's own player row, the
  tic's sounds and effects and, when the guest's screen is up, its inventory rows; the guest's page paints
  it as it paints its own, the sounds at its own ear, from the pak and the map's geometry alone
  (`loadMapModels`: no database, no game logic; its own Firebird stands idle). A map message at each
  level (the sky, the music, the speakers, the host's view, which the guest's frustum must match) and
  the picture at a unit's end come the same way. The wire is JSON in 16 KB chunks over one data channel,
  10–30 KB a frame, a frame dropped when the channel is 256 KB behind. Signalling is by hand, as Pages
  is static: Host shows the offer as a text of some six hundred characters (the description with its
  candidates, gzipped and base64'd), the other player's Join answers it with one to send back, Connect
  takes it; a STUN server is asked for at most three seconds, a connection on one machine or one network
  needs none. The guest leaving leaves the host's game with its second client standing (the gamepad
  moves it again); the host leaving ends the guest's game. `test:net` runs the host and guest sides over
  a loopback in one process; the browser test joins a second page to the first over real WebRTC. Left:
  prediction (a guest sees its own move a round trip late, as a client with `cl_predict 0` did; Quake 2
  ran pmove ahead on the client, which here would be a JS pmove beside the SQL's, kept in step by
  `test:replay`), a TURN relay for the networks a STUN cannot cross, a signalling service of the
  player's own in place of the texts, a third page (the SQL takes a client number already; the host's
  loop sends one guest), and spectating.
- **Local deathmatch**: done for two players at one page (the Players select's "Two (deathmatch)", the
  game menu's players spin) or over the network (the host's mode is the game's), as g_spawn.c, g_items.c
  and p_client.c had it. The spawn keeps out `NOT_DEATHMATCH` entities instead of the skill's, so the
  demo maps' deathmatch-only weapons, ammo, powerups and demo3's teleporter are in, and no monster is
  (every monster's spawn freed itself in deathmatch). Each client starts afresh (`InitClientPersistant`)
  at a deathmatch spot (`SelectDeathmatchSpawnPoint`: one at random of all but the two nearest a living
  client, or the farthest with `DF_SPAWN_FARTHEST`), and comes back the same way a second after dying,
  on fire or jump, or on its own with `DF_FORCE_RESPAWN`; the weapon in hand is tossed at death
  (`TossClientWeapon`). A map's item taken goes unseen and untouchable and comes back after its delay
  (`SetRespawn`, `DoRespawn`: 30 s for weapons, ammo and health, 20 for armour, a powerup's quantity,
  with `items/respawn1.wav` and its particles), the mega health only once its owner is back at the
  maximum (`MegaHealth_think`); a dropped one goes. Weapons stay with `DF_WEAPONS_STAY` (one already held
  is left), a new weapon is raised only over the blaster, a powerup is used as it is taken with
  `DF_INSTANT_ITEMS`, and `DF_NO_HEALTH`, `DF_NO_ARMOR`, `DF_INFINITE_AMMO` (no ammo spent either) and
  `DF_NO_FALLING` do what g_local.h says. The frags are `ClientObituary`'s (`player.score`: a kill one for
  the killer, a suicide or the world's kill one off), on the status bar's top right (`dm_statusbar`) and
  the score board (`DeathmatchScoreboardMessage`'s layout: F1 or the pad's Back in place of the help
  computer, and at every intermission). An exit kills whoever touches it ("found a way out") unless
  `DF_ALLOW_EXIT`; `CheckDMRules` ends the level at the frag or time limit, at the intermission, bound
  where the map's exit leads or the same map with `DF_SAME_LEVEL`; the next level starts the frags over.
  `dmflags`, `fraglimit` and `timelimit` are console commands, kept in the settings and in the game
  row. `test:dm` checks all of it headless; the browser test starts a deathmatch from the select. Left:
  the dmflags with no bearing here (teams by model or skin, friendly fire), the quad drop, and the
  player's name and skin (see *Player setup*).
- **Demo playback**: done (`src/demo.js`, the Demo select, `demomap` at the console). The pak's
  `demos/q2demo1.dm2` is read as `CL_ParseServerMessage` read the server's messages (`svc_serverdata`,
  `svc_configstring`, `svc_spawnbaseline`, `svc_frame` with its `svc_playerinfo` and `svc_packetentities`,
  the sounds, the temporary entities, the muzzle flashes and the prints) into a player view and entity
  states a frame, every block consumed to its last byte; `DemoPlayer` lerps the view and the entities between
  frames as `CL_AddPacketEntities` did and gives each frame's events once. The demo's map is loaded as a
  game's, its own alias models hidden, and each display frame the SQL is asked the faces for the recording's
  view (`Session.demoFrame`: the player's entity and row moved there, the brush models to where the demo
  has them), so the walls are the database's and the rest the recording's: no tic runs. A key or a click
  stops it and a new game starts, as the attract loop gave way to the menu. `test:demo` checks the parsing,
  the player, the session's frame and a painted frame headless; the browser test plays it from the select.
  The attract loop itself came after (see *The attract loop* in the second list). Left: recording, which
  follows from the same format: the frame's rows written as the
  messages (`SV_WriteFrameToClient`), so a recorded game plays in Quake 2 itself.
- **The credits screen and the key bindings menu**: done. The game menu's `credits` scrolls menu.c's
  `idcredits` text (`src/credits.js`; the pak has no `credits` file) up the screen as
  `M_Credits_MenuDraw` did, the `+` lines highlighted, round again once the last is off the top. The
  options menu's `customize controls` is `M_Menu_Keys_f`: the eighteen actions of `bindnames` that mean
  something here (no mouse look, keyboard look, sidestep or centre view) with their keys named as
  `Key_KeynumToString` named them, Enter then a key binds (the key leaves whatever it was bound to; two keys an
  action, a third makes both go first), Backspace unbinds, and the binds live in `settings.binds`
  (`src/settings.js` checks them on the way in) which `src/input.js` reads each tic; the options' reset
  defaults puts them back as `exec default.cfg` did. The weapon and item keys (1–0, G, Q, I, B, E) stay
  fixed, as Quake's menu did not list them; the mouse button and the wheel are not bindable.
- **Fidelity against the real software renderer**: `test:golden` compares the painter against itself.
  Screenshots from ref_soft at the same viewpoints (the real engine on a Windows machine, `screenshot`
  at 320×240 with the same fov, the same frame of the same map), kept beside the docs' shots and
  compared with a tolerance, would measure how far the painter is from the original rather than from
  its own last commit. No code: the pictures and a comparison script.
- **A performance guard in CI**: done (`scripts/perf-guard.mjs`, `npm run perf`, a step of the workflow).
  It measures demo1's load, an idle and a walking tic, the frame query and the raster, and takes each in
  units of a calibration run just before and after on the same machine (50,000 primary-key fetches of the
  engine for the SQL figures, a fixed loop over a frame's buffer for the raster), so a runner faster or
  slower than the machine that recorded the baseline compares all the same; `docs/perf-baseline.json`
  holds the units and the margin, and a figure past twice its baseline fails the build. The calibration
  holds the units within about ±15 % between runs here, against ±50 % for the milliseconds, so the margin
  catches only what matters (the 17 ms a tic of the falling barrels was four times the tic). A change that
  is meant to cost more records the baseline again (`--record`) in the same commit.
- **More than two local players**: done. The Players select (and the players spin) offers two to four in
  coop and in deathmatch; `init_map` takes the count (`nclients`) and puts the second client on at the map's
  `info_player_coop` in order, or at deathmatch spots; `Session.tic` takes a usercmd per client, a gamepad
  each in the order the browser lists them; the painter splits the screen in quarters for three or four
  (the fourth black with three), the SQL's view the quarter's size. The status bar is 320 wide and overflows
  a narrower view at its sides: 640×480 is the detail for four. Left: the HUD drawn to a view's width.
- **The full game's monsters, logic first**: done for thirteen (gladiator, iron maiden, brain, medic,
  mutant, icarus, technician, barracuda shark, the supertank, the hornet, Jorg, Makron, the insane
  marines): a row each in `src/gamedata.js` with the frame runs of its m_*.h as a table, which the loader
  makes a model row without a mesh from when the pak lacks the MD2, so the logic runs headless and the
  painter skips what it has no mesh for; their attack kinds (bolts of 1, 2 and 15, the bosses' machine
  guns, the railgun, the BFG) and a second ranged attack per monster (`alt_*`) in `monsters.sql`, Makron's
  three, Makron out of Jorg's body. `test:monsters` runs every one of them as it runs the demo's; the smoke
  test's sound check lets a full-game monster's directory be missing. Seeing them waits for a registered
  pak. Left, under *The full game*: the medic's cable, the mutant's leap, the floater's zap, the chick's
  duck, the insane marines' forms, the commander body.
- **Frames between tics**: done (`src/lerp.js`). The loop used to run a tic every animation frame
  (at least one, two at most), so on a 60 Hz display the game ran at three times its speed and painted
  each tic once; now the tics are the wall clock's (20 Hz) and every animation frame paints the last tic's
  frame moved toward the current one by the fraction of the tic gone by, as `CL_AddPacketEntities` and
  `CL_CalcViewValues` lerped the server's frames: the eye, the alias models and sprites (a newcomer or a
  teleport snaps), the brush models' origins and angles, the particles by the real time; the view's angles
  are the current tic's plus the mouse's turn not yet sent, so looking around is immediate. The
  SQL-projecting mode, whose faces are projected at the tic's eye, still paints once a tic. `test:lerp`
  checks the lerp headless; the browser test measures the game's clock against the wall's (1.00× at 60 fps,
  where it was 2.9×; a page slower than ten frames a second falls behind at two tics a frame, slow motion as
  `SV_Frame`'s clamp gave it, which CI's runner showed at four frames a second) and the paints against the
  tics. The model frames' own lerp came after (see *The poses between frames* below).
- **Nightmare skill**: done. Quake 2's skill 3, reachable only from the console (`skill 3`; `skill` alone
  shows it, the number is clamped to 0..3 as `SpawnEntities` clamped the cvar), the menus and the Skill select
  stopping at hard (the select shows "Nightmare" through a hidden option when the console set it). The cvar
  was latched: set with a game running it takes hold at the next map ("skill will be changed for next
  game."), a new one or the next level. Its effects: the monsters cry out but do not flinch (`monster_pain`
  returns after the sound at skill 3, as every pain function did: "no pain anims in nightmare"), the hard spawn
  filter applies (`NOT_HARD` for 2 and 3), and whatever reads `skill >= 2` (the soldiers' crouched fire, the
  gunner's duck grenade, one powerup held) is hard's; the help computer says "hard+" as `HelpComputer` did.
  `test:monsters` hurts every monster at hard and at nightmare; the console, settings and browser tests cover
  the command, the setting and the page. Left out: `M_CheckAttack`'s halving of the missile chance on easy and
  doubling at hard and above, which the port's own chance table (`check_attack`, per monster) never had.
- **Player setup: name and handedness**: done. The multiplayer menu's `player setup` is `M_Menu_PlayerConfig_f`
  with what the demo pak allows: a name field (`menufield_s`: fifteen characters, Backspace, the blinking
  cursor in its box of frame pieces) and the handedness spin; the model and skin boxes are greyed until a pak
  has the player model. The name is `pers.netname`, in the obituaries and on the score board ("player N"
  without one); the hand is `pers.hand`: `muzzle` (`P_ProjectSource`) puts a left-hander's shots 8 to the left
  and a centre-hander's in the middle, and the gun is drawn mirrored for a left-hander (`drawAlias`'s
  `mirror`, as ref_soft negated `aliasxscale`) and not at all for a centre-hander. Both are the client's
  userinfo (`Session.setUserinfo`): the session writes them to the client's row after every map load and
  loaded game, a guest sends its own to the host at the connect (an `info` message) and on every change, and
  each `Q2_TIC` row carries its client's `hand` and `netname` for the page. Tested in the menu, settings, coop,
  net and painter tests. Left: the model and skin (the registered pak), the rate box, the model's preview.
- **Save files**: done. The page's Saves controls: Download writes the game as it stands to a file
  (`<map>-<time>.q2sav`, the slot text of `src/savestore.js`: the header line, the JSON gzipped and
  base64'd; `Session.packGame`), and Load takes such a file (`Session.unpackText`, the plain JSON of a save
  too; another `SAVE_VERSION` or anything else refused with a message) into the same load as a slot's, so a
  game moves between browsers and outlives the site data. `test:session` packs and unpacks; the browser test
  downloads a file, walks on, loads it back and finds the player where the file had it, and sees rubbish
  refused. Left: a slot downloaded from the load menu (the game as it stands covers the use).
- **Installable and offline**: done. A web app manifest (`public/manifest.webmanifest`: standalone, landscape,
  icons of "Q2" in the pak's console font from `scripts/icon.mjs`) and a caching service worker
  (`public/sw.js`, its build id written in by the build): the page fills the build's cache and the data cache
  (the pak) after its first load and shows "offline ready", the worker serves from them and drops older builds'
  caches when a new one takes over, a navigation falling back to the cached page. The browser test checks
  the registration, the caches, the manifest and the icons, and reloads the page offline, where the game
  runs. Left: the music tracks go into the data cache only as they play; the picked pak and music folder are
  not cached (they are the player's files).
- **An audit of the temporary entities**: done, against cl_tent.c's `CL_ParseTEnt` and the game's senders
  (g_weapon.c, g_misc.c). The BFG's lasers were there already (kind 12); what was not: the water explosions
  (`TE_ROCKET_EXPLOSION_WATER`, `TE_GRENADE_EXPLOSION_WATER`: the same pictures with `weapons/xpld_wat.wav`,
  and a grenade going off in the air makes a rocket's explosion, as `Grenade_Explode` chose; a missile's water
  level is now read as it flies, as `SV_Physics_Toss` read it), a gunshot's `CL_SmokeAndFlash` (the smoke
  model, translucent over four frames and lit where it hangs, and the flash model, fullbright for one tic) and
  its ricochet (`world/ric1-3.wav`, three of sixteen hits, played by the game since the sounds are its), the
  sparks' count and colour (kind 10 packs them: `TE_LASER_SPARKS` at the end of each BFG laser, four in the
  ball's skin colour; the demo's sparks kinds map through the same), and the BFG's strike as Quake had it
  (`TE_BFG_BIGEXPLOSION`, kind 18, particles alone; the ball becomes the `s_bfg3` sprite and steps a frame a
  think, the blast on its first, gone after five; `TE_BFG_EXPLOSION` on each thing reached is the `s_bfg2`
  sprite alone). Checked by `test:effects`, now with the game's side: a rocket and a grenade fired into
  demo1's water, a grenade in the air and one on the ground, sixty-four bullets into a wall and their
  ricochets, a BFG shot's lasers, sparks, strike and sprite. Not in the demo's game: `TE_BOSSTPORT` (the
  final boss's entrance), `TE_MEDIC_CABLE_ATTACK` (with the medic's cable, see *The full game*), the mission
  packs' effects. Found on the way: the mutant, stopped a stride short of the player's box by `SV_CloseEnough`
  on a diagonal, stood at 100 units with a swipe of 100 and never struck; its swipe reaches 112 until its leap
  is here (`test:monsters` has a `MONSTER_DEBUG` trace of a monster's attack window for the next such case).

The second list, from what the entries above and below left: in the order they are to be taken.

- **The poses between frames**: done. The animations step at 10 Hz, the server's rate, and the client blended
  each step over the tenth of a second it took (`CL_AddPacketEntities`' `oldframe` and `backlerp`, ref_soft
  moving every vertex from the old frame's place toward the new one's), so a walk cycle flowed where here it
  stepped. `FrameLerp` now keeps each entity's frame and the one before it with the tic the change came in,
  and gives the row the old frame and the blend (1 as the change comes, 0 a tenth of a second on: the change
  tic 1 → 0.5, the next 0.5 → 0); `drawAlias` takes `oldFrame` and `backlerp` and lerps the vertices, the
  lighting normals the new frame's; the view weapon blends the same way (`viewFrameLerp`: its idle and firing
  runs stepped by time), and the demo's entities and gun come as `CL_AddPacketEntities` and `CL_AddViewWeapon`
  had them, the newer frame's pose blended from the older's by what is left of the way. A newcomer, another
  model and the SQL-projecting mode do not blend. `test:lerp`, `test:painter` (every vertex halfway at 0.5)
  and `test:demo` check it.
- **The attract loop**: done. The page opens as Quake 2 did, on the pak's first demo with the main menu
  over it (`attract` in `src/main.js`; a pak without demos starts a game), and comes back to it after a
  game's end or the menu's quit (which used to leave a message asking for a key). A key, a click or the pad
  while a demo plays brings the main menu up and the demo plays on behind it, as `Key_Event` did with
  `cl.attractloop` (the loop runs the demo's frame and draws the menu over it; the save menu stays shut);
  Escape puts the menu away. A demo's end plays the pak's next, round again (the loop's `nextserver`), the
  menu staying if it was up; a new game from the menu, the Map select, the console or a load ends the demo,
  and so does the Demo select put back to none. The browser test opens on it, puts the menu away and brings it
  back, sees no save menu, and starts the game from the Map select. Recording too (`src/record.js`; `record
  <name>` and `stop` at the console, as `CL_Record_f` and `CL_Stop_f`): the tics' rows and frames written as the
  server's messages (`SV_WriteFrameToClient`, `SV_EmitPacketEntities`, `MSG_WriteDeltaEntity`), a frame a tenth
  of a second with the tic between folded into it, the header `CL_Record_f` wrote (the server data, the
  configstrings with the map's `Com_BlockChecksum`, "precache"), a baseline the first time an entity shows and
  a configstring the first time a model, sound or image is used, every block under `MAX_MSGLEN`. The file
  downloads as `<name>.dm2` (protocol 34: it plays in Quake 2 itself with the same pak) and stays in the Demo
  select for this session. `test:record` records a game headless and reads it back; the browser test records
  and stops at the console, parses the download and plays the recording from the select.
- **The HUD drawn to a view's width**: the status bar is 320 wide and overflows a narrower view at its
  sides with three or four players at 320×240.
- **The guest's prediction**: a guest sees its own move a round trip late, as a client with `cl_predict 0`
  did; Quake 2 ran pmove ahead on the client, which here is a JS pmove beside the SQL's, kept in step by
  `test:replay`.
- **The full game's remaining monster moves as logic**: the mutant's leap, the floater's zap, the chick's
  duck, the medic's cable (`TE_MEDIC_CABLE_ATTACK`), on the frame tables as the thirteen rows are.
- **Cinematics**: `.cin` between units are skipped; the format is a palette and RLE frames with PCM audio.
- **Deathmatch leftovers**: the quad drop at death, friendly fire's dmflag.

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
  (they used to run on for as long as the old level's clock had left them). The health comes along: Quake 2's
  `SaveClientData` kept each client's health, max health and god or notarget flags in its pers at a level's
  exit and `PutClientInServer` gave them back at the next (`save_client_data`, run by the session's `leave`;
  the port used to start every level at a hundred). A new game's are fresh.
- **Area portals**: done. The BSP's areas and portals are tables; `portal_state` says which are open,
  `area_flood` (`FloodAreaConnections`) which areas are connected, recomputed when a door opens or
  closes (`door_use_areaportals`) or a `func_areaportal` is used. Marking keeps only the leaves of the
  eye's connected areas, and the entity pass only the entities in them; a change forgets the marked
  view. Brush models skip the area test, so a door is listed from either side: that is Quake 2's
  own rule by another route (`SV_LinkEdict` gave a door straddling two areas an `areanum2`, and
  `SV_BuildClientFrame` sent it to a client in either), and each demo map has one portal, its
  door in it. What the skip costs is a brush model inside the PVS but behind a closed door, listed
  and then hidden by the door; no pixel. Left: the re-mark a door causes is the usual hitch.
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
  sets the count), `use <item>`, `kill` (godmode or not), `map <name>` (a new game), `seed [n]` (the game's
  seed and the generator's state, or the next new game's seed: see *Deterministic replays*), `fov <degrees>` (1 to
  160), `skill [0-3]` (the next map's skill; 3 is nightmare, the console's alone: see *Nightmare skill* under
  *Next*), `save`, `load` (`player_command` in weapons.sql for the game's part). Up and down step through the
  lines typed, Tab completes a command's name. `drop <item>` is `Cmd_Drop_f`: ammo a pickup's worth, a weapon
  not in hand, a powerup, power armour (off with the last), thrown ahead and not back to its dropper for a
  second; a dropped weapon carries no ammo.
- **Demo playback**: done (see *Next*), and recording (the attract loop's entry there).

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
  no longer marked as energy damage, so armour protects fully against it. The means-of-death bookkeeping
  (`meansOfDeath`, set by every attack and read at the kill) is left out: Quake 2 printed the per-cause
  messages only in deathmatch and coop, and in single player said "died." and nothing else. Coop's
  obituaries (`client_obituary`, since the port has coop) tell the cause from what the kill has in hand
  instead: the inflictor's class and effect, the damage flags, the attacker's weapon.
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
  friction has just taken away (the row kept 12 units a second forever). A jump held while airborne or
  in water left `jump_released` unassigned (NULL to a NOT NULL column, the tic failing): pmove's
  `PMF_JUMP_HELD` keeps the flag while the button is held, and so does `player_think` now; the smoke
  test holds the jump through the air. And a saved game now comes
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
  inventory, as in Quake 2, the power cube with its count (each cube taken is one, each door wanting one
  spends one; see *Coop* for the bits that tell them apart). Pickups as single player had them: a new weapon (or the first grenades) is
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
  quit picture. The score board is a deathmatch screen (`Cmd_Score_f` returns in single player; see *Local
  deathmatch*).
  The credits and the key bindings menu came later (see *Next*). Left out: multiplayer (drawn greyed:
  the network game has its own buttons on the page), and the options that mean nothing here (sound
  quality, lookspring, lookstrafe, free look, joystick).

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

- **Monsters**: the logic of gladiator, iron maiden (chick), brain, medic, mutant, icarus (hover),
  technician (floater), barracuda shark (flipper), the supertank, the hornet (boss2), Makron with Jorg
  (boss3) and the insane marines is in (see *Next*): each a row in `monster_types` (`src/gamedata.js`) with
  its frame table, its attacks kinds of `monster_missile`. Their frame runs come from memory of the m_*.h
  headers; a registered pak's MD2 supplies the real ones, and is where their timing is to be checked. Not
  yet: the medic's cable (`medic_cable_attack`, raising a dead monster), the mutant's leap
  (`mutant_jump`), the floater's zap beam, the chick's duck, the insane marines' crawling and crucified
  spawnflags, the commander body (`monster_commander_body`, which only sits up when used).
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
- **Coop**: done for two local clients (there is no networking), as p_client.c and g_items.c had it. The page's
  part: the Players select or the game menu's players spin starts a coop game, the screen split in two views
  (each half as high, the SQL's view with it), the keyboard, mouse and touches the first player's command and
  the gamepad alone the second's, the frame asked for per view, the sounds with the first (the listener), the
  menus over the whole screen; a save brings its players back. The game side: a
  `player` row per client, found by its entity (`p.ent_id = :pe`: every routine that reads or writes the
  client does so for the edict it has in hand, as `ent->client` did); `init_map(…, coop)` puts the second
  client in at its `info_player_coop` (`SelectCoopSpawnPoint`: the ones named by the exit's spawnpoint, in
  order; the start when a map has none, telefragging as `KillBox` did); each client's usercmd (`usercmd`, the
  first's from `q2_tic`'s parameters) runs its own `player_think`, and the tic returns a row per client;
  `view_setup(client)` and `frame_all(…, client)` give each its view, with the other's model in it
  (`G_SetClientFrame` animates it: stand, run, crouch, jump, attack, pain and death frames; the demo pak has no
  `players/male/tris.md2`, so here the other player is unseen until a registered pak supplies it). The
  monsters look for `game.sight_client`, which `AI_SetSightClient` rotates through the living, targetable
  clients each tic, and drop a dead enemy for the other. A weapon or a key one client takes stays for the
  other (`IT_STAY_COOP`; one already held is left). A dead client's button a second later is `respawn`: the
  body stays behind (`CopyToBodyQue`, gibbable), the client goes back in at its spot with the pers it entered
  the level with (`coop_respawn`, taken by `InitClientResp` at each level start; the keys found since kept)
  and a teleport's effect. Messages go to the client they are for (`cprint(pe, …)`), the kill count to the
  killer's row, a level change and a save carry both clients. `test:coop` checks all of it, and that single
  player is as it was: one row, the same tic; the browser test starts a coop game on the page and sees the
  split view. The obituaries are `ClientObituary`'s, in coop ("player 2 was blasted by player 1.", "player 1
  tripped on his own grenade.", "player 2 does a back flip into the lava.", "player 1 died." for a monster's
  kill), on every client's message line as `gi.bprintf` put them; Quake carried a means of death through
  `T_Damage`, and here it is read off the kill from the inflictor, the damage flags and the attacker's weapon
  (see *Damage effects*). The gamepad has the inventory and the help computer for the player it drives
  (the d-pad selects and uses, Y and Back show the screens), so the second player has them too. The full
  game's power cubes are per client as g_items.c had them: `SpawnItem` gives each cube a spawnflag bit of
  its own (256 on, up to eight a level), `Pickup_Key` counts a client's cubes (`player.power_cubes`, the
  inventory's count) and marks which (`cube_mask`, pers.power_cubes), so in coop a client takes each cube
  once and the cube stays for the other; a `trigger_key` wanting one spends the activator's first cube
  (`trigger_key_touch`), in coop the same cube from every client that has it, and the key bit goes with
  the last cube; another key in coop is taken from every client. Left: the trail (`p_trail.c` is single
  player's: it follows the first client). Coop over the network, more than two local players and
  deathmatch are under *Next*.

## Engineering

- **Load time**: about two and a half seconds for a map in Node, 2.3 on a good run. The map's
  rows go in through firebird-wasm's `execBatch`, since 0.4.1 one `IBatch` request to the engine
  per 8,192 rows. Measured with both loaders in one process, alternating, demo1 four times each:
  the `LOAD_<table>` PSQL chunk procedures 2753 ms, `execBatch` 2331 ms (0.4.0's batch, a
  statement execute per row inside the engine, had been 13 % slower than the procedures). What is
  left is the inserts themselves (`face_verts`' 37 k rows at ~12 µs each, mostly the primary key),
  `init_map` and, on a reload, the old map's `DELETE`s (half a second). Dropping the geometry
  tables' primary keys before the load and adding them back before `init_map` was measured
  (alternating with the plain load, four each) and rejected: 2384 ms against 2000, because the
  rows went in no faster without their keys and the eight index builds cost 290 ms; the per-row
  cost is the record itself, not the key. (A compiled procedure whose plan uses a dropped index
  fails with error 260 until the index is back: the keys must return before `init_map`.)
  `face_verts` turned out to be read by nothing but `frame_faces`, the SQL-projecting renderer
  mode, so the page now loads the map without it unless that mode is on and `ensureFaceVerts`
  loads it on demand (the smoke test checks both): 2561 → 2167 ms median for demo1, alternating
  four loads each, and a quiet run reloads in 1.5 s. That also settled the old map's `DELETE`s:
  they were half a second when `face_verts`' 37 k rows had to go, and are 45 ms without them;
  the loading plaque is up while `loadMap` runs, so there was nothing to move. What is left of
  the load is the inserts into indexed tables (`faces` 280 ms, `leaves`, `brushsides`) and
  `init_map`.
  The PVS moved off the leaves: each leaf carried its cluster's decompressed PVS in a `VARCHAR(2048)`, and
  Firebird builds a record at its declared width, so the column made every leaf's write about three times as
  dear whatever it held (demo1's 5241 leaves, best of four in one run: 269 ms with it, 269 with it NULL, 86
  without the column). The
  strings are now a `clusters` table, one row per cluster (1448 on demo1); leaves and clusters together
  measured 302 and 337 ms before and 239 and 208 after, alternating trees, and the walking tic's median
  7.41–7.51 ms against 7.61–8.62 (no slower). The entity test in `frame_all` reads the eye's PVS from
  `view_setup` instead of joining `leaves` for it. `ab-bench` cannot compare across this change (a tree
  from before it has no `clusters` table for the loader to fill).
  Measured next and rejected: the two low-selectivity indexes, `faces_model` (7393 of demo1's 7905 faces
  are the world model's) and `leaves_cluster` (2632 leaves share one cluster), made unique by adding the
  primary key to each. An isolated insert into a fresh table looked twice as fast with `(model_id, id)`,
  but a map load is a `DELETE` and a reinsert of the same ids, and against that index each reload got
  slower (302, 398, 576, 997 ms over four loads, twice over; the plain index held at 306–410): a key that
  meets its own dead entry costs more than a duplicate appended to a chain. Two databases loading
  alternately in one process, one schema each, six loads: median 1896 ms with the composite indexes
  against 1830 without. The isolated measurements on this machine also moved by 2× between runs of the
  same thing; only the two-database A/B is worth believing for a change this size.
- **Saves and `localStorage`**: done. A save was JSON, uncompressed: a demo3 save carrying two
  levels left was 495 KB, and fifteen slots plus the autosave and the quick slot share an origin's
  ~5 MB. `src/savestore.js` now stores a header line (the map, the comment, the version, which the
  load menu reads without inflating anything) and the JSON gzipped through `CompressionStream` and
  base64'd: a tenth of the size. A plain JSON save from before still loads. The save test packs and
  unpacks a save byte for byte; the browser test saves and loads through the page.
- **A browser test in CI**: done. `scripts/browser-test.mjs` (`npm run test:browser`) serves the
  build without COOP/COEP, as Pages does, and drives it in a headless Chromium through Playwright:
  the page runs the engine's build without threads (with `--coi`, the threaded one), the pak downloads, Firebird starts in
  its worker and the first frames come (7 s here), the stats line keeps changing, `W` walks, `F6`
  saves and `F9` loads, Escape pauses the loop and again resumes it, and nothing is logged as an
  error or missing but the music tracks and the favicon. The Pages workflow runs it after the Node
  suites. Every other test still runs the SQL in Node through `DirectTransport`, which is where a
  failure is easiest to read; this one is for what only the page can break.
- **Deterministic replays**: done. The SQL drew its chances from Firebird's `RAND()`, so a bug seen
  once could not be played again. Every draw now comes from `rnd()` (game.sql), a 32-bit linear
  congruential generator whose state lives in the session context: a game is a function of its seed
  and its inputs. `init_map` seeds it if nothing has and records the seed a new game starts with in
  `game.rng_seed`; `loadMap` takes a `seed`; the console's `seed` shows the game's seed and the
  generator's state, `seed <n>` sets the next new game's; a save carries the state, so a loaded game
  goes on with the chances it would have had. `scripts/replay-test.mjs` plays 120 tics twice from one
  seed and compares every entity, the game row and the sounds (ids left out: the sequences run on
  across loads), then from another seed, then the second half again from a save. The cost is within
  the noise (`ab-bench`: idle 4.19 → 4.26 ms, walking 10.00 → 10.05). Every test and bench script
  seeds its first load with 1, so a failing run replays as it failed and an A/B plays the same game
  in both trees. The range assertions stay ranges on purpose: an exact snapshot of a run would
  churn with every behaviour change, and what a range states is the rule being tested.
- **`run_think`**: measured, and the cheap fix taken. The chain of 38 `IF (think = '…')` string
  comparisons is walked 6 times a tic on demo1 (a counter in each branch: 4.6 of them
  `monster_think`, 1 `banner_think`, the rest timers and trains), and `monster_think` was the last
  branch: about 170 failed comparisons a tic, 0.2 ms of a 5 ms idle tic. It is now the first
  comparison. `ab-bench` against the old SQL: idle median 4.93 → 4.35 ms, walking 9.52 → 8.96,
  the means within the noise (5.01 → 4.95, 10.45 → 10.34). A think code with a `CASE`, or
  `EXECUTE STATEMENT`, would save what is left of the chain, which is now a few comparisons a
  tic: not worth a schema column.
- **Spawn-time thinks**: done. The spawn functions used to schedule first thinks from zero
  (`nextthink = 0.1`), which `init_map` at time 0 made right, and `target_spawner` added `now_()`
  to whatever it spawned, pushers included, whose thinks run on their own `ltime` from zero: a
  spawned train would have waited the level's age. `spawn_map_ents` now reads the level clock once
  and schedules the non-pusher thinks from it (the eleven of them: monsters, turret drivers, lasers,
  timers, clocks, banners, decorations, gibs, `always_fire`, `crosslevel_think`, `elevator_init`);
  the pushers keep `ltime`; the spawner shifts nothing.
- **Phone and gamepad**: done. The view's halves already moved and looked on a touch screen, with a
  tap firing; now on-screen buttons (shown where the browser reports touch points or a coarse
  pointer) fire and jump while held, change weapon and open the menu, and a gamepad works through
  the Gamepad API's standard mapping (`src/gamepad.js`): left stick moves, a run at its edge, right
  stick looks at the keyboard's turning speed scaled by the mouse sensitivity, RT or X fires, A
  jumps, B crouches, LB/RB change weapon, Start opens the menu, and in a menu the d-pad, the stick,
  A and B do what the keys do; a press counts once. `test:input` checks the reading in Node, and
  the browser test's touch phase taps the halves and every button on an emulated touch screen. The
  view at 160×120 is the detail setting for a phone.
- **Code health**: the input is out of `src/main.js`: `src/input.js` holds the keys, the mouse, the
  touches and the pad between tics and reads them as the usercmd, attached to the canvas by the page,
  which keeps only the keys that are its own (menus, console, F keys); `test:input` drives it headless
  (keys, Shift and the Run setting, the impulses, the mouse at 0.022 degrees a count, drags and taps on
  the view's halves, the on-screen buttons, the pad). That found a crash: a jump held while airborne
  left `jump_released` NULL. The console followed: `src/console.js` runs the commands (`map`, `fov`,
  `seed`, `save`, `load`, `inven` against a host object, the rest through `player_command`), keeps
  the history and completes on Tab, and `test:console` drives it with a fake host; the page keeps
  the input element. The settings went next: `src/settings.js` has the defaults, the video modes, the
  menus' resets and the storage round trip, and checks what storage hands back (a hand-edited
  `fov: 500` or `detail: 'bogus'` used to reach the game as it was); `test:settings` covers it.
  Then the game itself: `src/session.js` is what the server did in single player, with no DOM: a map
  started or a level of the unit come back to as it was left, a tic, the frame read and decoded
  (`decodeFrame`), a level left (a unit's end forgetting the unit), the slots written, listed and loaded
  against a storage object. `main.js` keeps the canvas, the sound, the status line, the keys and the
  menus' host, and is 695 lines. `test:session` drives a `Session` headless through the page's own calls.
  Writing it showed one thing the pixel comparison cannot: from demo1's start the SQL-projecting renderer
  mode lists the fan's 24 faces where the fast mode leaves the fan out, both modes drawing the same world
  faces; the fan is out of sight there, so no pixel differs. The frame's effects followed:
  `src/effects.js` keeps cl_tent.c's temporary entities (the explosions, the beams, the parasite's tongue,
  the muzzle flashes), gives the frame's dynamic lights and draws them; its chances come from a `random` a
  test can give, and `test:effects` checks each effect's life, light and drawing with a renderer that
  records, then paints one. `main.js` is 606 lines: the canvas, the sound, the status line, the keys, the
  menus' host, the loop and the drawing order, which is what a page is.
- **The cluster-change hitch**: smaller. Marking a new cluster went from ~43 to ~17 ms (the
  PVS's clusters looked up by index instead of every leaf's bit tested), and the last sixteen marked
  sets are kept, so walking back into one costs ~0.3 ms. A door opening or closing drops only the
  sets whose area's connections changed (each set keeps the areas its flood joined), so the others
  outlive it. Marking the next cluster ahead of time is done: `premark_ahead()` runs in the frame's
  spare time (the page calls it when the tic, the query and the raster took under 30 ms), probes
  half a second and a second along the velocity and 128 and 256 units along the view, and builds
  a set for the first cluster that has none, in the slot used longest ago that is not the view's;
  sixteen sets are kept now instead of eight, as eight thrashed. On a 400-tic walk through the
  first rooms (18 clusters) the frames over 8 ms went from 19–22 to 9–10. What stays: corners where
  two or three small clusters are crossed within a few tics, the first frame's mark, and the eye's
  own re-mark when a door in its group of areas moves, since what it sees changes. Letting the
  page mark up to three clusters a frame was measured and brought nothing (8–11 hitches against
  9–11, three more marks): the probes do not see round the corner, so more marks a frame mark the
  wrong clusters sooner.
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
  `test:audio` holds the sound mix (`src/audio.js`) to snd_dma.c against a Web Audio that records what it is
  asked to build: `S_Spatialize`'s fall-off and pan, a one-shot cut by the next on its channel, the loops
  summed per sound with each side clamped, the speakers, the page hidden, the music's three modes. The
  painter's look is held by `test:golden`: the twelve docs screenshots rendered again and compared pixel
  for pixel. The painter is deterministic (two renders agree byte for byte), so a difference is a change,
  and a change on purpose regenerates the shots in the same commit. Writing it found demo1's two later
  shots stale: made on 2026-10-08 with the other ten, they had drifted by 66 and 53 scattered pixels,
  nothing the eye sees, from a change since that reached only demo1's frames after the walk.
- **`firebird-wasm`**: 0.4.0 binds a number in binary where the column is a number (a double
  arrives exactly: the save's mantissa-and-exponent trick is gone) and has `execBatch` (one statement,
  many rows, one call); 0.4.1 runs the batch as one `IBatch` request, and the map load uses it (see
  *Load time*). 0.8.0 ships a build without threads, which needs no `SharedArrayBuffer`: the page
  runs it wherever it is not cross-origin isolated, so on Pages, and the service worker that only
  supplied COOP/COEP is retired (what is at its URL now unregisters itself; a caching one came later, see
  *Installable and offline* under *Next*). Measured in a headless
  Chromium on demo1, idle: a 5 ms tic and 3 ms of frame queries on both builds, the first frames in
  5.6 s without threads against 6.5 s with them.
