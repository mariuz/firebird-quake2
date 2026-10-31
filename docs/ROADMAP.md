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
  a loopback in one process; the browser test joins a second page to the first over real WebRTC. The guest
  predicts its own move (the second list's entry below), and a third and a fourth page join the game as it runs (the third
  list's first entry). A TURN relay for the networks a STUN cannot cross and spectating came with the fourth
  list, a signalling relay of the player's own in place of the texts with the fifth.
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
  row. `test:dm` checks all of it headless; the browser test starts a deathmatch from the select. The quad
  drop and friendly fire came after (the second list's last entry). Left: the dmflags with no bearing here
  (teams by model or skin), and the player's skin (see *Player setup*).
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
  fixed, as Quake's menu did not list them; the mouse buttons and the wheel became bindable with the fifth list.
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
  pak. The medic's cable, the mutant's leap, the floater's zap and the chick's duck came after (the second
  list's entry below). Left, under *The full game*: the insane marines' forms, the commander body.
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
  runs. The music tracks go into the data cache as they play; the picked pak and a picked folder's tracks are
  kept in IndexedDB (*The picked pak and the music tracks kept*, below).
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
  on a diagonal, stood at 100 units with a swipe of 100 and never struck; its swipe reaches 112, and its leap
  is here now (`test:monsters` has a `MONSTER_DEBUG` trace of a monster's attack window for the next such case).

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
- **The HUD drawn to a view's width**: done. The status bar was 320 wide and overflowed a narrower view at
  its sides with three or four players at 320×240 (a quarter is 160 wide). `Hud.parts` lists the bar's parts
  as `single_statusbar` had them (the health, ammo and armour each a number with its icon, the selected item's
  icon, the pickup line, the timer, the help icon) and `Hud.layout` places them: at 320 and wider the one
  layout as before, centred; narrower, each part into the lowest row with room for it from the bottom up (a
  first fit, 6 between, rows 26 apart), the pickup line and the help icon after the rest, so nothing leaves the
  view (a 160×120 quarter with everything on takes three rows). The frags stay at the top right, the crosshair
  at the centre. `test:hud` lays the bar out at 640, 320, 240, 160 and 80 wide against a renderer that records
  every picture and character, and checks the classic positions, the rows, and that nothing is outside or over
  another. A centre print's line longer than the view wraps at its spaces (`Hud.drawCenter`;
  the game's fit 320). The help computer, the inventory and the score board lay themselves out to a narrow
  view too (the third list's fourth entry).
- **The guest's prediction**: done. A guest saw its own move a round trip late, as a client with
  `cl_predict 0` did; Quake 2 ran pmove ahead on the client. `src/pmove.js` is that pmove: the traces of
  `sql/physics.sql` (`ClipMap`: the BSP's planes, nodes, leaves, brushes and sides with the loader's brush
  bounds; `rhc`, `clip_leaf`, `trace_hull`, `trace_box`, `trace_move` as `traceHull`, `traceBox`, `trace`,
  the brush models in their own space, rotated ones through `angleMatrix`) and `player_think`'s movement
  (the angles, the water level, the duck, the jump, friction, the acceleration on the ground, in the air and
  in water, gravity, noclip, `walk_move` with `fly_move` and `push_entity`, the ground under the box, the
  step smoothing and the bob) as `pmove`. The tic row carries what it starts from (`VX`…`VZ`, `ONGROUND`,
  `STEPZ`, `JUMP_RELEASED`, `NOCLIP`, `BOB_PITCH`). On the wire each command carries a sequence number and
  each frame the newest its tic took (`ack`); the guest's page (`guestAck`, `guestPredict`, `guestView` in
  `src/main.js`, `CL_PredictMovement`) runs the frame's row through the commands past the ack, each
  command it sends through the state at once, and paints the predicted eye and angles (`FrameLerp.at`'s
  `view`), the frame's entities still lerped. Where a frame's correction lands the state away from where the
  prediction had it, the difference fades over the next tenth of a second (`CL_CheckPredictionError`,
  `prediction_error`); a teleport (more than 640 units) snaps. The brush models come from the frame (its
  faces name them with their origins, the angles ride along), and so do the box entities about the guest (the
  third list's second entry; a guest walking into a monster used to be put back by the next frame), and a
  dead or frozen player is painted where the host has it. `test:predict` runs the JS beside the SQL over
  two hundred tics of walking, turning, jumping, crouching, strafing, stairs and a wall on demo1, each tic
  from the SQL's row, and gets the same numbers every tic (the largest difference 0), the traces agreeing
  with `trace_move` and the water with `point_contents`, and no drift run free; `test:net` acks the commands
  and predicts the guest's forty tics exactly; the browser test sees the guest's predicted origin run ahead
  of the host's frames while it walks.
- **The full game's remaining monster moves as logic**: done. The chick and the medic duck under a shot a
  quarter of the time as the soldiers do (`chick_dodge`, `medic_dodge`: two names in `monster_dodge`). The
  floater's melee is its zap (`floater_zap` in `monster_melee`): a splash of 32 sparks from its muzzle
  toward the enemy, 5 + rand() % 6 of energy damage with a pull of 10 (a negative knockback, which
  `t_damage` now takes). The mutant leaps (`mutant_check_jump` in `check_attack`: the enemy neither far
  above nor far below its box, past 100 units, one think in ten; its "missile" is the jump frames, and
  `mutant_leap` takes off at the third, 425 forward and 160 up, off the ground with its cry and the leap bit
  `aiflags` 4096, holds the sixth until it lands, with a thud, or three seconds pass; `impact` hurts what a
  leaping mutant lands on at more than 400 by 40 + 10 × random(), as `mutant_jump_touch` did). The medic
  raises the dead (`medic_find_dead`, `medic_take`, `medic_cable`, `monster_revive`: the dead monster in
  sight within 1024 with the most health becomes its enemy and its own, `aiflags` 8192 as `AI_MEDIC`; it
  attacks at once with the cable frames, the beam drawn as the parasite's tongue is while the body is within
  256, not more than 45° up or down and in a clear line, the hook's launch, hit, heal and retract heard, and
  at the eighteenth frame the corpse is the monster its spawn made, counted again, after the player; raised
  or gibbed, the medic goes back to the fight). `test:monsters` sees the chick and the medic duck, the
  floater's zap sparks and sound, the mutant choose the leap from 220 away, take off, land with its thud and
  hurt a body it lands on, and a medic take a shot soldier's corpse, cable it with the three sounds and stand
  it up again with its health and box, the level's monsters one more and the kill as it was.
- **Cinematics**: done (`src/cinematic.js`). A `.cin` named by a level exit (`ntro.cin+base1`) was skipped;
  now the page plays it from `video/` when the pak has it (the demo pak has none; the full game's intro
  and unit transitions do). The format as `cl_cin.c` read it: the header (the picture's size, the sound's
  rate, width and channels), 256 rows of 256 byte counts from which `Huff1TableInit` built a Huffman tree
  per previous byte (`huffTables`: the two smallest counts joined, the lowest index on a tie; a row with one
  count or none has the leaf 255 for its root, as the C left `numhnodes - 1`), then a frame at a time
  (`CinReader.next`, `SCR_ReadNextFrame`): a command (0 a frame, 1 a new palette first, 2 the end), the
  compressed picture (its count, then the bits low first down the tree of the byte before,
  `huffDecompress`) and the frame's fourteenth of a second of raw sound. `huffCompress` is the encoder,
  the inverse, and `makeCin` writes a whole file from frames: the demo pak has no cinematic, so the tests
  make one. The page (`playCinematic`, `SCR_PlayCinematic`) draws the frames at fourteen a second in their
  own palette with the game stopped, queues the sound as raw samples (`Q2Audio.playRaw`, `S_RawSamples`),
  reads a frame it was too slow for for its sound alone, ends at the file's end or a key, a click or the
  pad (`SCR_FinishCinematic`) and goes on to the map after the `+`; a host sends the file's name and the
  guest plays its own copy until the next map comes. `test:cinematic` checks the trees against hand-built
  cases, the decoder on a hand-packed bit stream, the encoder against the decoder for every byte after every
  byte and for noise, a whole file read back frame by frame (the header, the palettes, the pictures and the
  sound exactly, the end marker) and the player's clock; the browser test plays a cinematic it makes through
  the page, sees the frames come with the game stopped, the end on its own and the game going on, and a
  key ending a second one.
- **Deathmatch leftovers**: done. With `DF_QUAD_DROP` (16384) a deathmatch death tosses a quad that had more
  than a second left along with the weapon in hand, the two 22.5° to either side of the view, the quad to go
  when it would have run out (`toss_client_weapon`, as `TossClientWeapon`; `drop_item` is `Drop_Item` on its
  own now, `drop_cmd` and the toss both using it). With `DF_NO_FRIENDLY_FIRE` (256) in coop, where every
  client is on the one team, a client's hit on another does no damage, the knockback staying
  (`CheckTeamDamage` in `t_damage`; a deathmatch has no teams here, so the flag means nothing there, as it
  meant nothing without `DF_MODELTEAMS` or `DF_SKINTEAMS`). `test:dm` sees the quad tossed with the weapon,
  apart, to go at the quad's time, and not without the flag; `test:coop` a client's shot doing nothing to the
  other with the flag, hurting without it, and the world's hurting either way.

The third list, from what is left in the entries above and below: in the order they are to be taken.

- **Three or four pages over the network**: done. The host's loop sent one guest; the SQL took up to four
  clients. Now `net.guests` is a list, each guest with its own channel, `Peer` and `HostLink` and a client
  number of its own (the lowest of 2 to 4 no guest holds; a guest that leaves leaves its client standing for
  the next, as a client whose packets stopped stood). Host, while hosting, makes an offer for the next player
  (one offer out at a time; Leave closes every channel). The first guest's connect starts a new coop game as
  before; a later one joins the game as it runs, `Session.addClient` being ClientConnect and ClientBegin for
  it (the row with fresh pers, the entity at the level's coop spot by `client_begin`, the game that many
  clients from then on and at the next level), and is sent the map as it is. Each tic the host writes every
  client's command (a guest's merged, a client without one standing) and sends each guest its own frame; the
  map, a picture and a cinematic go to all; the stats line counts the guests. Found on the way: three or four
  players at one page sent only the first two pads' commands to the tic (`readInput` read them all;
  `session.tic` was given two): the third and fourth stood still, and move now. `test:net` adds a second
  guest to the game running (its row and entity, fresh pers, a spot of its own, no second entity when added
  again, the map as it is, a tic with both, each guest its own row and frame, the third client walked by its
  guest while the other stands, a level change keeping three, the second guest leaving and the game going on
  with its client standing); the browser test joins a third page to the running game with a second offer, sees
  the third client put in and painted, the first guest's frames going on, the stats line counting both, and the
  pages leaving one by one.
- **The guest clipped against the monsters**: done. The frame carried no box for them, so a guest walking
  into one was put back by the next frame. Now a guest's frame carries the box entities about it (`frame_all`'s
  kind 10, asked for with `with_boxes`, `Session.frame`'s `boxes`: the entities of `solid` 2 and 3 within 384
  of its eye but its own and its own missiles, as `trace_move` clips the client's move, each with its absolute
  box and the contents `trace_move` gives it, `CONTENTS_MONSTER` alive and `CONTENTS_DEADMONSTER` a corpse),
  the host's own frame none; `packFrame` carries them over the wire and the guest's `pmove` clips against
  them as against the brush models, so the guest stops at a monster, another client or a barrel where the
  host stops it. `test:net` sees the frame's boxes match the host's tables (every one within 384 there, the
  far ones not, the first client's among them), the guest walk into the first client and the prediction meet
  its box at the tic the host does and slide along it, exactly, where without the boxes it would have walked
  on; the forty-tic walk still matches to the last digit.
- **A recording played from a file, and recordings kept**: done. The Demo select played the pak's demos and
  this session's recordings; a `.dm2` of the player's own could not be opened, and a recording was gone with
  the page. Now the recordings are kept across reloads (`src/demostore.js`: a `.dm2` by name in IndexedDB,
  which takes the bytes as they are where localStorage's quota would not; a browser without it keeps them for
  the page): a recording made here goes in as `stop` ends it, the select lists the kept names at the start
  after the pak's, and one's bytes are read when it plays. A `.dm2` opened from the file input beside the
  select (one made here and downloaded, or Quake 2's own) is parsed, kept under its name cleaned as `record`
  cleans one, and played. `demos` at the console lists the pak's and the kept, `deldemo <name>` drops a kept
  one from the select and the store (the pak's are not the page's to drop). `test:console` checks the two
  commands against a host; the browser test sees a recording in the store, a `.dm2` file opened from the input
  play under its cleaned name and listed, `demos` listing both, `deldemo` dropping one from the list, the
  select and the store, the kept one listed again after the page's reload and playing from the store, and
  dropped after it.
- **The help computer, the inventory and the score board to a narrow view**: done. The status bar laid
  itself out to the view (the second list's entry); these were 256- and 320-wide pictures and layouts that
  clipped in a quarter view. In a view narrower or shorter than 320×240 (`Hud`'s `narrow`) each screen now
  scales its panel to the view (`Hud.narrowPanel`: the 320×240 screen at the one scale that fits, centred,
  the panel with it through `Renderer.drawPicScaled`, nearest texel) as a backdrop, the font not scaling, and
  lays its text out to the view's columns: the help computer's skill at the top right, the level name and
  the two messages wrapped at their spaces (`wrap`) down to the counts, which take a line each at the bottom;
  the inventory's header and lines cut to the width with a two-wide key column, as many lines as the height
  holds scrolled about the selected item, its cursor at the left; the score board one column of two lines a
  client (the name over its tag where the tag fits, the score and the minutes), as many as fit. At 320 and
  wider the three draw as they did, to the pixel. `test:hud` checks the three at 320 against the classic
  positions and at 160×120 (and the board at 80×40): the panel scaled to half behind, every character inside
  the view and none over another, the lines where the layout says.
- **The insane marines and the commander's body as logic**: done. `misc_insane` was not spawned at all (its
  classname is not `monster_`); `monster_commander_body` neither. Now `misc_insane` becomes the monster type its
  spawnflags say (`spawn_map_ents`: 8 CRUCIFIED `insane_cross`, 4 CRAWL `insane_crawl`, else `insane`, the
  three rows of `monster_types` on the one model and frame table), in one of three skins (`rand() % 3`), and
  STAND_GROUND (16) holds it where it is. The standing one raves and, roused, runs about (`insane_run`; it
  never attacks, as m_insane.c has no attack); the crawling one's stand, walk and run are the crawl frames
  (`insane_move_down`, `insane_move_crawl`, `insane_move_runcrawl`), its pain and death the crawl's; the
  crucified one flies (`FL_FLY`: it never drops), in a box 8 deep, with `AI_STAND_GROUND` and no yaw, through
  the cross frames, struggles when hurt (`insane_move_struggle_cross`) and, killed, dies on the cross and
  stays there (`insane_dead` keeps `FL_FLY` and the box; `monster_die` leaves it hanging). The commander's body
  (`SP_monster_commander_body`, g_misc.c) is a decoration on a model row of 24 frames (`DECORATIONS` in
  `src/gamedata.js`, a placeholder the loader makes as for the full game's monsters): a box shots hit but never
  hurt (`FL_GODMODE`, which `t_damage` now honours on anything, the knockback kept), let fall to the floor half
  a second in (`commander_body_drop`), and used it sits up a frame a tenth of a second to its last with the tank's
  pain sound, the thud at the twenty-second (`commander_body_use`, `commander_body_think`). `misc_deadsoldier`'s
  six poses were in already. `test:monsters` runs the three forms through every monster's checks (they see the
  player, never attack, die) and sees the crawler come on its knees, the crucified one hang unmoving, struggle
  and die on its cross; `test:entities` spawns the three from `misc_insane` and the body, which a shot does not
  harm and which sits up with its two sounds when used.
- **A brush model's loop at its origin**: done. The game's own sounds came from a brush model's box's middle
  already (`snd`, the frame's loops); a demo's did not: the player placed an entity's looped sound, and a one-shot
  sound at an entity with no position of its own, at the entity's origin, which for a brush model (the client's
  `solid` 31) is wherever the mapper left it, often the map's centre, so a door's middle sound in the pak's demo hummed
  from far away. `DemoPlayer.soundOrigin` is `CL_GetEntitySoundOrigin`: given the map's bounds for its `*N` models
  (`brushBounds`, the page's from the loaded map), a brush model's sounds come from its origin plus the middle of its
  bounds; without the bounds, from the origin as before. `test:demo` finds the door brush model with its middle sound
  looped in q2demo1 and sees its loop come from the middle of its box with the bounds and from the origin without,
  and a one-shot sound at a brush model placed the same way.

The fourth list, from what the entries above and below still leave: in the order they are to be taken.

- **The trail per client in coop**: done. `p_trail.c` kept one trail, the player's; here it followed the first
  client, so a monster that lost sight of the second client followed the first's markers. A marker belongs to
  the client that dropped it now (`player_trail.client`, the key with `seq`; an older save's markers load as
  the first's), `player_trail_check` looks at every client each time and drops one for each that has moved out
  of sight of its last marker (eight kept a client, `trail_add`), and a monster pursuing a client picks that
  client's markers (`trail_pick` by the client its enemy is; an enemy that is no client has no trail).
  `test:coop` sees a marker a client where each stands, the second client out of sight of its marker drop
  another of its own with the first's trail untouched, and a monster pick the second's markers when it pursues
  the second and the first's when the first; `test:monsters`' pursuit is as it was.
- **The actors as logic**: done. `misc_actor` and `target_actor` (m_actor.c) were not spawned. The actor is
  the monster `actor` now (`misc_actor` becomes `monster_actor` in `spawn_map_ents`; one without a target is
  freed, as it was): a row of `monster_types` on the player's model, which the demo pak lacks, so he runs on a
  model row without a mesh with m_actor.h's thirteen runs (133 frames: attack, two deaths, the flipoff, three
  pains, push, run, stand, taunt, walk, jump), 100 health, gibbed at -80, a machine gun on the first two attack
  frames (`actorMachineGun`), the male player's pain and death sounds. He stands where he is put until used
  (`actor_use` starts him down his path, facing its first `target_actor`); the corners are triggers 16 across
  (`SP_target_actor`), and the walk to path corners takes them too: reaching one (`target_actor_touch`) he
  says its message to every client by name (`actor_names`: Hellrot, Tokay, Killme, Disruptor, Adrianator,
  Rambear, Titus, Bitterman, by his entity number), a JUMP corner throws him along its angle at its speed and
  up by its height, an ATTACK corner makes whatever its pathtarget names his enemy (held where he stands with
  HOLD, run at otherwise), a corner neither SHOOT nor ATTACK fires its pathtarget, and the corner's target is
  the next; with nowhere to go and no enemy he stands for good. `test:monsters` runs him through every
  monster's checks (he sees the player, shoots with the machine gun, dies; he has no sight sound, which the
  test now allows); `test:entities` spawns him with a path of three corners in the corridor east of the
  yard and a soldier for the third's pathtarget, sees him stand until used, walk to the first and say its
  message by name, be thrown up at the second, take the soldier for his enemy at the third and hold there,
  and shoot at it. Found on the way: a monster holding its ground (`AI_STAND_GROUND`, a held `point_combat`) never
  fired, the run state's held branch exiting on the attack check's word every think before the missile transition
  could run; the attack states come first now, as `ai_run` took them.
- **Spectating over the network**: done. A joined page that ticks "spectate" beside the Network controls (or
  `spectator 1` at its console; `spectator` alone shows it, a page that has not joined is told it cannot) sends
  it with its userinfo (3.20's `spectator`, `player.spectator`), and the host puts its client back in at its spot
  as a watcher (`client_spectator`, as `spectator_respawn` did; `put_client_in_server` marks every entry of such a
  client): nothing solid, no model, no damage, nothing in hand, the noclip move through the level
  (`PM_SPECTATOR`, the move the player already had) and `FL_NOTARGET`, so the monsters pass it over
  (`ai_set_sight_client` skips it too). Unticked, the client goes back in as a player at its spot, solid, with
  its model and a weapon in hand. Only a joined page watches: the host's and a local game's clients play.
  `test:net` sees the guest's word make the second client a watcher, the monsters look for the first alone,
  a shot do no harm, the watcher fly through the yard's wall the players stop at, and the client back as a player
  with the blaster; `test:console` the command's cases; the browser test the box ticked on the guest's page
  and unticked.
- **The picked pak and the music tracks kept**: done. The player's files go into IndexedDB as the recordings
  do (`src/demostore.js`: a `KeptStore` per object store of the one database, the recordings' `demos` and the
  files' `files`): a pak picked from the PAK control is kept with its name and the next start loads it in place
  of the demo's download (a kept pak that fails to load is forgotten and the demo's downloads), the button
  beside the control ("demo pak", shown while a picked pak is in use) forgets it and loads the demo's now; a
  picked folder's track is kept as it plays, under its number, and plays from the store at the next start when
  no folder is picked (the site's `music/` tracks were in the data cache already, as the service worker fetches
  them). `test:audio` sees the picked track kept and played from the store, a track neither picked nor kept fall
  to the drone; the browser test picks a copy of the pak under another name and a folder with demo1's track
  made as a WAV, reloads offline and finds the picked pak loaded from the store and the track playing with no
  folder picked, then forgets the pak and sees the demo's load with the track still kept.
- **A slot downloaded from the load menu, and keys for the silencer and the power shield**: done. `d` on a
  slot of the load menu writes it as a file as it is stored (`Session.slotText`, `save<n>-<map>.q2sav`, the
  page's `downloadSlot`), the menu staying up and its status bar offering it on a slot with a game; an
  empty slot gives nothing. The silencer and the power shield are bindable actions (`ACTIONS`: impulses 18
  and 21, which the game took already), `l` and `h` by default since default.cfg's `s` and `p` are the
  page's back and pause, in the keys menu with the rest. `test:input` sees the keys send their impulses and
  the twenty actions with their defaults; `test:menu` d on an empty slot do nothing, the status bar offer it
  on a slot with a game and d there write it with the menu up; the browser test saves slot 1 from the save
  menu, opens the load menu on it and finds d's file the slot's text under its name, and with everything
  given sees l silence thirty shots and h turn the power shield on.
- **A TURN server for the networks a STUN cannot cross**: done. `Peer` asked one STUN server; two players
  behind symmetric NATs never connected. `rtc_ice <url>` or `rtc_ice <url> <user> <pass>` at the console
  (a `stun:`, `stuns:`, `turn:` or `turns:` url; `rtc_ice` alone shows it, `rtc_ice none` drops it) keeps
  an ICE server in the settings (`rtcIce`, checked on the way in like every setting), and the next offer or
  answer's peer connection is made with the STUN server and it (`parseIceServer`, `iceServers` in
  `src/net.js`), on both pages. `test:net` parses the setting's forms and refuses the rest, and sees the Peer
  give the servers to its connection; `test:settings` the round trip and the fallbacks; `test:console` the
  command shown, set, refused and cleared; the browser test the command kept in the settings and cleared.

The fifth list, from what the entries above and below still leave: in the order they are to be taken.

- **A signalling relay of the player's own**: done. The offer and the answer went by hand, as texts, since
  Pages is static. `scripts/signal.mjs` (`npm run signal`, port 8787) is a relay anyone can run on a machine
  both players reach: an offer published under a four-letter room code (no 0, O, 1 or I: a code is said
  aloud), the answer posted under it, rooms swept after ten minutes, nothing on disk, any origin let in
  (Chrome's private network access header too; a page served over https reaches an http relay only at
  `localhost`, so a relay elsewhere goes behind https).
  `rtc_signal <url>` at the console (shown alone, `none` clears it; kept in the settings as `rtcSignal`) on
  both pages makes Host publish its offer there and show the code in place of the text, waiting for the
  answer by itself (`SignalClient` in `src/net.js`: publish, offer, answer, waitAnswer, drop), and Join take
  the code (an offer text still works; a code with no relay set says what it needs); the room is dropped once
  the answer is in. `test:net` runs the relay in-process: the code's shape, the offer by the code, the wait
  until the answer comes, a wrong code, a second answer, an empty offer, a dropped room and a swept one
  refused, a relay that is not there named; `test:settings` and `test:console` the setting and the command;
  the browser test spawns the relay, sets it on both pages, hosts (a code shown) and joins by the code, sees
  the room gone once connected, then clears it for the third page's join by text.
- **The multiplayer menu's network items**: done. `join network server` and `start network server` were drawn
  greyed; the page's Join and Host buttons did the work. The items drive the same functions now (the host's
  `netJoin` and `netHost`: the menu goes away and the page's panel shows under the view, scrolled to, with the
  offer or the code, or the box for the host's), as `M_Menu_JoinServer_f` and `M_Menu_StartServer_f` opened
  theirs; the status bar says where the texts go; a page with no network keeps them greyed. `test:menu` sees
  each item call the page's and the menu go, and a host without them greyed; the browser test hosts from the
  menu over the attract loop and joins from the guest's menu.
- **The mouse buttons and the wheel bindable**: done. The keys menu bound keys alone; the left button fired and
  the wheel changed weapon, fixed. The buttons and the wheel are keys now (`Mouse1`–`Mouse3`, `MWheelUp`,
  `MWheelDown`, named `MOUSE1`… and `MWHEELUP`/`MWHEELDOWN` as `Key_KeynumToString` named them): under the
  lock `src/input.js` presses and releases them through the binds like any key, a wheel notch pressed and let
  go at once (so a held action bound to it does nothing, as Quake's `K_MWHEELUP` was released in the same
  event), and in the keys menu Enter then a button or a notch binds ("press a key or button", as
  `KeyBindingFunc` took `K_MOUSE1`). The defaults are default.cfg's: MOUSE1 attack (with CTRL; `F` is no
  longer one), MWHEELDOWN weapnext (with `/`) and MWHEELUP `weapprev`, a new action with its impulse 22
  (`Cmd_WeapPrev`: the previous weapon held with the ammo for a shot, `player_impulse` walking the other way).
  `test:input` sees the buttons fire and stop, the wheel's two impulses, a notch let go at once, a button
  bound to jump, the wired browser events under the lock and outside it; `test:menu` a button and a notch
  bind in the menu and draw as named; `test:settings` keeps them; the smoke test the previous weapon back
  over one without ammo and round the end; the browser test the left button firing under the lock and the
  right button binding attack in the keys menu, reset defaults putting MOUSE1 back.
- **`bind`, `unbind`, `unbindall` and `bindlist` at the console**: done. Quake's words over the keys menu's
  binds (`settings.binds`, kept with the settings and read by the input): `bind <key> <command>` binds the key
  (named as the keys menu names it and `Key_StringToKeynum` took it: `k`, `3`, `UPARROW`, `CTRL`, `MOUSE1`,
  `KP_5`, `F1`, case aside; `keyCode` in `src/input.js`) to the action whose command that is (each action
  carries bindnames' command, `cmd`: `+attack`, `weapnext`, `+speed`, `inven`, `use silencer`…;
  `actionOfCommand`), as the keys menu binds it (the key leaves its old action, a third key makes two go);
  `bind <key>` shows the key's binding as `Key_Bind_f` printed it (`"k" = "+attack"`); `unbind <key>` takes the
  key off, `unbindall` empties every action, `bindlist` shows every key bound with its command on the page's
  one line. A key or a command the page has not is refused with the words. `test:console` runs them all,
  `test:input` the names back to their codes and every action's command; the browser test binds J to attack
  at the console, sees it in the settings and the input, unbinds it and puts the defaults back.
- **The notify lines and the console's scrollback**: done. The message line showed one print at a time, the
  newest. `src/notify.js` is console.c's notify: each print of the first view's row (a new one by the time the
  tic row now carries, `MSG_TIME`: the same words printed again are a new print) goes in with the game's
  clock, and the view draws the last four not yet three seconds old at the top, a line each, as
  `Con_DrawNotify` did (`NUM_CON_TIMES`, `con_notifytime`); another view of a split screen keeps its one
  line. The same entries are the scrollback: the backquote console shows the last twelve lines printed under
  its input line (a `pre` the page fills as it opens), the lines typed echoed as `]line` and the commands'
  answers among them, those two in the scrollback alone; a level change clears it with the level's clock.
  `test:console` holds the lines to their seconds, count and order, the hidden lines to the scrollback, the
  keep; the browser test sees the game's answer to `use nosuch` drawn in the notify lines and kept in the
  scrollback after the line typed, the console show it and hide it as it closes.
- **`timedemo` and `screenshot`**: done. `timedemo <demo>` plays a recording of the pak or the page's own a
  frame of the recording a painted frame, whatever the wall clock says (`CL_Timedemo_f`'s `cl.time` stepped
  per frame; the map name says `timedemo`), counts the frames painted and, at its end, reports them with the
  seconds they took and the frames a second as `CL_DemoCompleted` did (on the status line and in the
  console's scrollback), a new game starting as after a demo stopped. `screenshot` downloads the view as it
  stands as `quakeNN.png`, the number counting up this session (`SCR_ScreenShot_f` took the first free
  `quakeNN.pcx`, which a download cannot ask for). `test:console` sees both commands reach the page and the
  refusals; the browser test runs the recording it made as a timedemo (the pak's would take minutes at a
  headless page's rate) and reads its figures, a frame of the recording a painted frame, with the game
  starting again, and downloads a screenshot that is a PNG of the view's size. Found on the way: a demo's
  end never came. The end was the last frame reached with the fraction past it at 1, and past the last frame
  the player's fraction is 0, so every demo stood on its last frame for ever and the attract loop never went on
  to the pak's next; the end is the last frame reached with the clock past it now, and the browser test sees a
  recording's end bring the pak's demo on.

The sixth list, from what the entries above and below still leave and what a game shared over the network
wants: in the order they are to be taken.

- **`say`, `say_team` and the chat key**: done. There was no way to talk to the other players. `say <text>` at
  the console (and `say_team`, which is `say` here: there are no model or skin teams) puts the words on every
  client's message line as "name: text", as `Cmd_Say_f` printed them (`client_say` in game.sql: the client's
  name or "player N", the text as typed and not the console's lower case, 150 characters at most, trimmed;
  nothing said prints nothing); a guest's words go to the host as a `say` message, which says them for the
  guest's client (`GuestLink.sendSay`, `HostLink.onSay`, the text cleaned on arrival). `T` is default.cfg's
  `messagemode`, a bindable action ("chat" in the keys menu): the console opens with `say ` on its line.
  `test:console` sees the words sent as typed, the usage line and nothing with no game; `test:coop` the words
  on every client's line by the client's name, a named client by its name, nothing for nothing; `test:net` a
  guest's say reach the host cleaned and cut at 150; `test:input` the key; the browser test T opening the
  console with `say `, the words on the message line and in the notify lines, and a guest's say on the host's
  line by its client's name.
- **No pause in a shared game**: done. The host's menu, its pause key and its hidden tab stopped the tics, and
  every guest with them; Quake 2 paused single player alone (`SV_Frame` ran the game frame unless paused with
  `maxclients 1`, and `pause` said "only valid in single player"). While a guest is connected the loop's halt
  is for `running` alone: the tics go on under the host's menu (drawn over the frame just painted, the host's
  player standing as the menu takes its keys) and in a hidden tab as far as the browser's timers let it (no
  painting there), `P` does nothing on a host with guests or on a guest, and a guest's connecting lifts a pause
  the host had on. The browser test, with the guest connected, sees the host's frames and the guest's keep
  coming under the host's main menu and after its `P`.
- **The settings as cvars at the console**: done. `name`, `hand`, `sensitivity`, `cl_run`, `m_pitch` (0.022, or
  -0.022 to invert, as the invert mouse option sets it), `crosshair`, `s_volume` and `cd_volume` (0 to 1) are
  console commands over the settings, as `Cvar_Command` took a cvar's name: alone they show the value as the
  cvar showed it, with a word they set it through the page's `setSetting` (so the page's controls, the menus
  and the userinfo follow, the name reaching the player's row), clamped or refused with the range (`CVARS` in
  `src/console.js`); `name ""` clears the name; `cvarlist` lists them with `fov` and `skill` on the one line.
  `test:console` runs each: shown, set, clamped, refused, the list; the browser test sets the sensitivity and
  the name at the console and finds them in the settings, the storage, the game's row and the list.
- **`writeconfig` and `exec`**: done. The settings lived in one browser's storage. `writeconfig` at the console
  (or the Config control's Download) writes the binds and the cvars as Quake's `config.cfg`
  (`Key_WriteBindings` and `Cvar_WriteVariables`: `unbindall`, a `bind <key> "<command>"` line a key in the
  actions' order, a `set <cvar> "<value>"` line a cvar, `fov` and `skill` among them; `writeConfig` in
  `src/console.js`) and downloads it; `exec` opens the Config control's file picker (a page cannot read a file
  by name), and the file picked runs line by line through the console (`Console.execText`: the comments and the
  blank lines skipped, `set` and the quotes config.cfg puts round a command or a value taken), so a
  configuration moves between browsers as a save does. `test:console` holds the lines written, the download,
  the picker, a config run back with its comments, quotes and a bad line, and `set`'s refusals; the browser
  test downloads config.cfg at the console, puts the settings back and runs the file through the control,
  which brings them again.
- **Saves across schema changes**: done. A save lacking a column the schema gained took its default already
  (the columns come from the save's field list); one carrying a column the schema has lost failed on the
  insert, and another `SAVE_VERSION` was refused outright. `insertRows` now asks the table for its columns and
  drops the saved ones it has not, naming them; `importSave` loads any older version (refusing a newer one and
  rubbish) and returns the version and the columns dropped, which `saveNote` words and the page shows with
  "Game loaded" (five seconds, for a note); `SAVE_VERSION`'s comment says what each version meant and when to
  bump (a column's meaning changed, not its presence). `test:save` loads a version-1 save with a column the
  schema has lost and one it gained and sees the first dropped and named, the second defaulted and the rest
  as saved, a newer version and rubbish refused; the browser test's file load is as it was.
- **`timescale`**: done. `timescale <n>` at the console runs the game's clock at `n` times the wall's (`0.5`
  slow motion, `2` twice the pace, as `Qcommon_Frame` scaled the frame's milliseconds by the cvar): the loop
  owes a tic every `TIC_MS / timescale` of the wall's, still at most two a frame (a slow page cannot reach
  twice the pace), the frames between tics move by the scaled fraction, and a demo's clock runs by it too
  (a timedemo not: a frame a frame). `timescale` alone shows it, `1` puts it back, 0.1 to 10 for the
  session (Quake did not archive it either), 0 and words refused; a guest's clock is the host's, and a guest
  is told so. `test:console` runs the cases; the browser test measures the game's clock against the wall's
  at 2 (faster than the wall where the page keeps up), at 0.5 (half) and back at 1.

The seventh list, from what a game shared over the network still lacks and what the console's binds were in
Quake: in the order they are to be taken.

- **A guest's console commands forwarded to the host**: done. A joined page's console ran `god`, `give`, `kill`
  and the rest against its own idle database, to no effect. The commands that reach `player_command` go to
  the host now as a `con` message (`GuestLink.sendConsole`, `HostLink.onConsole`, the command and its argument
  cut to the game's sizes), and the host runs `player_command` for the guest's client, whose answer comes
  back on the guest's message line with its frames, as `Cmd_ForwardToServer` sent what the client did not
  know. `test:net` sees a guest's `god` reach the host and switch the second client's godmode on and off, the
  first untouched, the sizes cut; `test:console` the forwarding when joined and the local run alone; the
  browser test `god` typed on the guest's page take at the host and answer on the guest's line.
- **Deathmatch over the network**: done. A hosted game was coop whatever the Players select said
  (`startMap`'s modes had `deathmatch: !netHost() && settings.deathmatch`). The select's deathmatch makes the
  shared game a deathmatch now, coop otherwise: the guests' clients at deathmatch spots with fresh pers
  (`client_begin` chose them already), the maps' deathmatch items and no monster, the frags on every page's
  status bar and score board (the row and its `SCORES` carried them already), `dmflags`, `fraglimit` and
  `timelimit` the host's. `test:net` hosts a deathmatch and sees the guest's row say so with the board's rows,
  its forwarded `kill` cost it a frag; the browser test flips the host's select to deathmatch with a guest
  connected and back.
- **Keys bound to command lines**: done. `bind` took the actions alone; Quake's binds were command lines
  (`bind t "say hello"`, `bind k god`). A line that is no action's command goes into `settings.lines` (key code
  → the line, kept with the settings and checked back: printable, at most 128 characters; `bindLine` in
  `src/input.js`, the key leaving its action), and runs through the console when the key, a mouse button or a
  wheel notch goes down (`runBoundLine` in `src/main.js`, echoed into the scrollback), as `Key_Event` put a
  key's binding into the command buffer; the `+` actions stay the held ones. `bind <key>` shows the line,
  `unbind` and `unbindall` take it off, `bindlist` lists the lines after the actions, `writeconfig` writes
  them after the actions' lines and `exec` runs them back, the keys menu's reset defaults drops them (default.cfg
  began with `unbindall`) and a key the menu binds to an action loses its line. `test:console`, `test:input`
  and `test:settings` cover the words, the helpers and the round trip; the browser test binds K to `god` at
  the console and presses it.
- **Recording on a joined page**: done. `record` was refused on a guest. The frames the host sends are what
  its recording writes now, as the client recorded the server's messages: the recorder is set up from the map
  message (the sky, the track, the level's name, which the message carries now), the brush models are named by
  their faces as the frames show them (`modelOfFace`, which the prediction keeps), and its own entity is in no
  frame, so none is named; `stop`, a map change, the host leaving or the page leaving the game downloads it and
  keeps it as the page's own. `test:record` records a guest's frames over a loopback and reads them back (the
  level's name and the sky from the map message, every frame's player state the row the host sent, the brush
  models by their inline names, the models and sounds the frames carried); the browser test records on the
  joined page, parses the download and finds it kept.
- **An autoexec.cfg kept in the browser**: done. A config file picked ran once. With the Config control's
  autoexec box ticked, the file picked is kept in IndexedDB as the pak is (`FileStore`, under `autoexec`) and
  runs through the console once a start, after the attract loop is up, as `autoexec.cfg` did (`runAutoexec`);
  `exec autoexec` runs it again, `unautoexec` or the box unticked drops it, and the box ticked with none kept
  opens the picker. `test:console` covers the words, the browser test keeps a config, sees it run, run again
  and run at the next start (the offline reload), and dropped.
- **`players` and `kick` at the host's console**: done. The host had no list of its guests but the stats
  line's count. `players` lists the game's clients as `SV_Status_f` did: the number, the name and what drives
  each (this page; a guest, with the frames sent to it and dropped, and watching when it only watches; a pad;
  nothing, standing), on the page's one line (`listPlayers` in `src/main.js`; a joined page is told the host
  lists them). `kick <n>` drops the guest driving client `n` as `SV_Kick_f` did (`kickGuest`): a `kick` message
  with the reason goes first, which the guest's page shows in place of "The host left" and stands for a key,
  then the channel closes and the client stands as one that left; "<name> was kicked" goes to every message
  line (`sprint(NULL, …)`, `SV_BroadcastPrintf`); the usage and "Bad user id" as Quake printed them.
  `test:console` covers the words over a fake host, `test:net` the kick message reaching the guest with its
  reason before the close, the browser test `players` listing the host and two guests and `kick 3` dropping
  the third page, which says why, every message line saying who.

The eighth list: what a game shared over the network and the console still lack, from Quake 2's own words.

- **`connect`, `disconnect` and `reconnect` at the console**: Join, Leave and the last host are the page's
  buttons alone. `connect <code or offer>` joins as Join does (`CL_Connect_f`), `disconnect` leaves a joined
  or hosted game (`CL_Disconnect_f`), `reconnect` joins the last host again through the relay's code.
- **The chase cam for a watcher**: a spectator floats where it likes. 3.20's `g_chase.c`: a watcher's view at
  a player's eye (`UpdateChaseCam`), the attack key cycling to the next player (`ChaseNext`, `ChasePrev`),
  `chase <n>` at the console, and back to floating on jump.
- **Pings on the score board**: "Ping: 0" for everyone. The host measures each guest's round trip with a
  `ping` message a second and puts it in the row (`ping`), the score board shows it; a joined page shows its
  own on the stats line.
- **The host's save and load with guests connected**: a save in a shared game loads with its player rows but
  the guests' clients are not put back under their guests, nor sent the map again. A load keeps the guests'
  clients (`applyUserinfo` over them) and sends each its map message, as a level change does.
- **`netgraph`**: nothing shows a guest's dropped or late frames but the stats line's count. `netgraph 1`
  draws the frames' arrival and the drops in the view's corner as `SCR_DrawNet` and `netgraph` did.
- **The menus from the console**: `menu_main`, `menu_game`, `menu_loadgame`, `menu_savegame`, `menu_options`,
  `menu_keys`, `menu_video`, `menu_multiplayer`, `menu_playerconfig`, `menu_credits` and `menu_quit` open the
  menus as `M_Init` registered them, so a key bound to one (`bind F4 menu_options`) opens it.

## Playing the demo

- **Save and load**: done as Quake 2 had them in single player: fifteen slots in the load and save menus
  (`F3`, `F2`), save0 the autosave written as each map starts ("ENTERING Outer Base", as
  `SV_GameMap_f` copied it), the others named with the time and the level as `SV_WriteServerFile` did,
  plus the quick slot (`F6` / `F9`). Dying and pressing fire brings up the load menu (`respawn` in single
  player). `src/savegame.js`, tested by `scripts/save-test.mjs`. A save carries the unit's other levels
  as they were left (below), as `SV_WriteServerFile` copied every level's `.sav` beside the game's, and a
  loaded game comes back to them as left. A save made by an older schema loads with the new columns'
  defaults and the columns since lost dropped and named (*Saves across schema changes*, the sixth list).
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
  `noise` is now its middle sound, looped while it moves, not a one-shot at each corner. Quake 2's client placed a brush model's
  sounds at the middle of its bounds (`CL_GetEntitySoundOrigin`); here the game's come from the box's middle,
  and a demo's too (see *Next*, the third list).
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
  headers; a registered pak's MD2 supplies the real ones, and is where their timing is to be checked. The
  medic's cable, the mutant's leap, the floater's zap and the chick's duck are in (see *Next*). Not yet:
  nothing of the insane marines' forms or the commander body: they are in (see *Next*, the third list).
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
  `scripts/entities-test.mjs` adds them all to demo1's lump and checks them, the insane marines' three forms
  and the commander's body too, and the actor with his `target_actor` path (see *Next*, the fourth list).
  Nothing is missing from g_spawn.c's spawn table now. `misc_bigviper` stands still, as in Quake 2. `func_group` is editor-only and correctly ignored;
  `viewthing` is a debugging aid. (`target_mal_laser`, once listed here, is the first mission pack's.)
- **Trains**: `func_train_find` put a train on its first corner and aimed it at the next; the port aimed
  it at the first again, so every train (and demo1's three strogg ships) began with that corner's wait
  and pathtarget, which Quake skipped. And `train_wait` lent a corner's target to its pathtarget without
  giving it back, so a looping train that came round to it again followed the pathtarget. Both as in
  g_func.c now; the ships are unseen until their trigger uses them.
- **Cutscenes**: the intro and the unit transitions are cinematics (`.cin`); a level exit naming one
  plays it from the pak's `video/` (see *Next*) and goes on to the map after its `+` (`src/levels.js`).
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
  the last cube; another key in coop is taken from every client. The trail is each client's own (see *Next*,
  the fourth list). Coop over the network, more than two local players and deathmatch are under *Next*.

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
