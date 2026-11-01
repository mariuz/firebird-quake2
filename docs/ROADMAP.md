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
  level (the sky, the music, the speakers, the host's view size; the fov is the guest's own since the ninth list) and
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
  net and painter tests. The rate box and the skin's words came with the seventeenth list (`rate` and `skin`); left: the
  model and skin themselves (a pak with the player model) and the model's preview.
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

- **`connect`, `disconnect` and `reconnect` at the console**: done. Join and Leave were the page's buttons
  alone, and the last host was gone with its code. `connect <code or offer>` joins as Join and Answer do
  (`CL_Connect_f`; `connectTo` in `src/main.js`), `disconnect` is the Leave button (`CL_Disconnect_f`: a
  joined page starts a game of its own), `reconnect` joins again with what the page last joined with
  (`CL_Reconnect_f`; `lastConnect`, set by Join's box too). For that the host keeps its code for the session
  (`hostCode`): Host again publishes the new offer under it (`POST /rooms/<code>` at the relay, the room made
  anew; `SignalClient.publish(offer, own)`), so the guest's `reconnect` finds it. `test:console` covers the
  words, `test:net` the relay's room under the host's own code, the browser test `disconnect` at the guest's
  console and, the host Hosting again under its code, `reconnect` joining the game again.
- **The chase cam for a watcher**: done. A spectator floated where it liked. 3.20's `g_chase.c` now: the
  attack key, as it goes down (`player.fire_held`, the latched button), chases the next client playing
  (`chase_next`, cycling; "No other players to chase." when there is none), and each tic `update_chase_cam`
  puts the watcher's eye thirty units behind the chased client's along its view, traced out of the walls and
  two units back, its angles the client's, no move of its own (`PM_FREEZE`); jump lets go, floating free
  from there; `chase <n>` and `chase 0` at the console (`player_command`, forwarded from a guest) do the same
  by hand, `chase` alone says whom. `player.chase` is the target (0 free), in the tic row as `CHASE`, which
  the guest's prediction stands down on; a watcher turning player again chases nobody. `test:net` runs the
  keys and the words over a loopback (the eye behind the client's, the view following its turn, a second
  press with nobody else, jump, the console's refusals), the browser test the watcher's Ctrl and Space.
- **Pings on the score board**: done. "Ping: 0" was everyone's. The host sends each guest a `ping` carrying
  its clock once a second (with the frames), the guest's link answers with a `pong` carrying it back at once,
  and the host reads the round trip (`HostLink.ping`, whole milliseconds), which goes into the score board's
  rows it sends (`SCORES`: `ping`, 0 for the host's own client) and into `players`' listing; the board draws
  it as `DeathmatchScoreboardMessage` laid it out (`Ping:  n`, at most 999), and a joined page's stats line
  shows its own. `test:net` runs a ping and pongs against a clock, `test:hud` the line drawn, the browser test
  sees the host's measure, the guest's row and its stats line.
- **The host's save and load with guests connected**: done. A save loaded while hosting had the save's
  clients, so a guest whose client the save lacked (one played alone) got no frames. The host's load keeps the
  guests' clients whatever the save had (`Session.ensureClients`, with the guests' clients: a save of a game
  played alone makes the game coop again, its row saying so, and a client the save lacks is put in afresh at
  the level's spot by `addClient`, its name, hand and watching back with `applyUserinfo`; a coop save keeps
  them as saved), and `mapLoaded` sends each guest the map as it is, as at a level change. `test:net` loads a
  save played alone and a coop save over a loopback, the browser test has the host press F6 and F9 with the
  guest connected and sees its frames come on.
- **`netgraph`**: done. Nothing showed a guest's dropped or late frames but the stats line's count. `netgraph 1`
  (a cvar, kept with the settings, not written to config.cfg as Quake's was not) draws cl_scrn.c's debug graph
  along the bottom of a joined page's view (`src/netgraph.js`: `SCR_DebugGraph`'s ring of columns and
  `SCR_DrawDebugGraph`'s band 32 high, the newest column at the right), a column a frame from the host as
  `CL_AddNetgraph` added them: a tall red one for each tic the host skipped between two frames, a tall orange
  one for a frame that came past twice its time, and one as high as the ping is long in thirtieths of a
  millisecond. `test:hud` draws the graph against a recorder, `test:console` the cvar, the browser test
  turns it on at the joined page's console and sees the columns come.
- **The menus from the console**: done. `menu_main`, `menu_game`, `menu_loadgame`, `menu_savegame`,
  `menu_options`, `menu_keys`, `menu_video`, `menu_multiplayer`, `menu_playerconfig`, `menu_credits` and
  `menu_quit` open the menus as `M_Init` registered them (the console's `openMenu` host hook, through the
  page's `openMenu`, so the pointer is let go as a key would), so a key bound to one (`bind F4 menu_video`)
  opens it as it goes down; before the pak is in they say the menus wait. `test:console` runs the eleven
  words and Tab, the browser test `menu_options` at the console and F4 bound to `menu_video`.

The ninth list: what the console and a shared game still lack of Quake 2's own words, with the demo pak.

- **`alias` and `;` at the console**: done. A line was one command. A line's commands part at `;` outside
  quotes now (`splitLine`, as `Cbuf_ExecuteText` parted them, a bind's quoted line kept whole), so `god;
  noclip` and `bind k "god; noclip"` run both; `alias <name> <line>` names a line (`Cmd_Alias_f`: the name in
  lower case, 32 characters at most, `alias` alone listing them, `alias <name>` an empty one), the name runs
  it unless a command has that name (`Cmd_ExecuteString` looked at the commands first), sixteen deep at most
  (`ALIAS_LOOP_COUNT`); the aliases last the session, as Quake's did (an autoexec.cfg brings them back).
  `wait` holds the rest of a line to the next frame (`cmd_wait`: `Console.pending`, run by `tick` from the
  page's frame). `test:console` runs the parting, the binds, the aliases, the loop guard and `wait`; the
  browser test an alias of `god; noclip` and the line typed.
- **`centerview`, `+strafe` and `+klook`**: done. default.cfg's words the page lacked. `+strafe` (sidestep,
  ALT) and `+klook` (keyboard look, INS) are bindable actions now, the twenty-third and twenty-fourth: held,
  the turning keys step sideways and turn nothing, the walking keys look up and down and walk nothing, as
  `CL_BaseMove` and `CL_AdjustAngles` read them (`Input.read`). `centerview` is a game word (`player_command`:
  the pitch to level, `IN_CenterView`), bound to END by default as a command line (`DEFAULT_LINES`, the first
  default line: the keys menu's reset puts it back, `unbindall` takes it off). `test:input` runs the keys,
  `test:coop` the word for one client alone, `test:settings` the default line, the browser test the mouse
  pitching the view down and End levelling it.
- **The `cheats` cvar**: done. `god`, `noclip`, `notarget` and `give` ran in a deathmatch for anyone.
  `player_command` refuses them in a deathmatch unless the game's `cheats` is on, as `CheatsOk` did ("You must
  run the server with '+set cheats 1' to enable this command.", on the client's message line too); a game
  played alone or in coop keeps them. `cheats 0|1` at the console is a deathmatch cvar like `dmflags` (kept
  with the settings, given to each map load, the game running taking it at once; the host's, a guest's going
  to the host as its other words do). `test:dm` sees the four refused with the client untouched and run with
  cheats on, `test:console` the word.
- **A guest's own fov**: done. A guest saw the host's fov (the map message's view). The guest's `fov` goes
  with its userinfo now, as the fov userinfo did (`ClientUserinfoChanged`: clamped to 1..160, on `player.fov`;
  NULL, the view's), and `view_setup` makes the client's frame at it, so the host's frame for the guest is at
  the fov the guest paints with (`viewFov` is the page's own setting on every page; `fov <n>` on a joined page
  sends it again). `test:net` sends a fov with the userinfo and sees the row take it, clamped, and the frame
  narrower at 30 than at 160; the browser test types `fov 60` at the joined page's console and reads it on the
  host's row, the frames coming on.
- **`clear` and `condump`**: done. The console's scrollback was read in the backquote line alone. `clear`
  empties it, the notify lines with it (`Con_Clear_f`; the page's `clearLog`), `condump <name>` downloads it
  as `<name>.txt`, the lines typed and the answers in it (`Con_Dump_f`; `dumpLog`: the name as typed with a
  path's characters and a `.txt` taken off, none refused with the usage, "Dumped console text to name.txt."
  said). `test:console` sees both reach the host and the name cleaned; the browser test types `condump mylog`
  and reads the file downloaded, the print and the line typed before it in it, and `clear` leaving an empty
  scrollback.
- **`invdrop` and `weaplast`**: done. bindnames' "drop item" is an action now, `invdrop` (`Cmd_InvDrop_f`: the
  selected item dropped as `drop` drops it, "No item to drop." with nothing selected; impulse 23 through
  `inv_impulse`; BACKSPACE by default, the twenty-fifth row of the keys menu), and `weaplast` (`Cmd_WeapLast_f`:
  the weapon held before the one in hand raised again, through `Use_Weapon` and its refusals; nothing without
  one in hand, one held before, or that one still held) is a game word for the console and `bind`, impulse 24
  (`weaplast_cmd`), over `player.lastweapon`, which every weapon change sets as `ChangeWeapon` set
  `pers.lastweapon` (`Use_Weapon`, the pickups' switch, the change when the ammo runs out; a fresh client has
  none). The smoke test drops the selected shells by the impulse and by the word, sees `weaplast` go back and
  forth between the shotgun and the railgun and do nothing once the shotgun is dropped; `test:input` and
  `test:menu` count the action.

The tenth list: what the console, the keys and a shared game still lack of Quake 2's own words, with the demo
pak. In the order they are to be taken.

- **`+mlook`, `freelook`, `lookspring` and `lookstrafe`**: done. The mouse always looked here. `+mlook` is a
  bindable action now, bindnames' "mouse look" (`\` by default, the twenty-sixth row of the keys menu), and the
  options menu has Quake's lookspring, lookstrafe and free look boxes, the cvars `freelook` (on by default, as the
  mouse always looked; Quake's default was off), `lookspring`, `lookstrafe`, `m_forward` and `m_side` (the last two
  not archived, as Quake's were not). `Input.mouse` reads the mouse as `CL_MouseMove` did: its horizontal a turn,
  or a sidestep with `+strafe` held or lookstrafe on under `+mlook` (`m_side`, in `cl_sidespeed`'s 200 a tic); its
  vertical a look with `+mlook` held or free look on and not `+strafe`, else a walk (`m_forward`, in
  `cl_forwardspeed`'s 200); the moves add to the keys' within full speed. `+mlook` let go with lookspring on and
  free look off levels the view (`IN_MLookUp`: the page runs `centerview`, `Input.onCenterView`). `test:input`
  holds each switch to its numbers and the levelling to its one case; `test:menu` turns the three boxes;
  `test:console` the five cvars, `cvarlist` and `writeconfig` with them; the browser test types `freelook 0` and
  `lookspring 1` and reads them in the settings.
- **`echo`, `cmdlist`, `version` and `pause`**: done. `echo` prints its words as typed (`Cmd_Echo_f`),
  `cmdlist` puts every command on a line of the scrollback and says how many (`Cmd_List_f`; the page's
  `print`), `version` names the page's version and build (`scripts/build.mjs` stamps them into the bundle with
  the engine package's version) and the engine line, Firebird's version with or without threads, and `pause`
  is the P key's word (`CL_Pause_f`: a single-player game running pauses or goes on, `togglePause`; a shared
  game or none, "Pause command is only valid in single player"). `test:console` sees the four reach the host
  with their answers; the browser test types them on both builds and reads the words, the version string, the
  count with the scrollback filled, and the game paused and on again.
- **`wave 0–4`**: done. `Cmd_Wave_f` as `wave_cmd`: flipoff, salute, taunt, wave and point as the player
  model's frames (m_player.h's flip01 72–83, salute01 84–94, taunt01 95–111, wave01 112–122, point01 123–134,
  started one short and stepped by `set_client_frame` under the wave priority), the word said on the line and
  the frames seen by the other players and in a recording; no number is the flipoff, as `atoi` had it; none
  ducked, none over a jump, a pain, an attack or a death. The smoke test taunts and sees the frames set under
  the wave priority, the word said, a flipoff over the taunt, and none over a pain or ducked; `test:coop`
  sees a client's taunt step a frame a tic where the other client sees it.
- **`score` and `putaway`**: done. `score` is `Cmd_Score_f`: the score board toggled in a game of more than
  one client (coop, deathmatch or a shared game), the inventory and the help put away either way, nothing in
  single player (`toggleScreen`'s 'scores' kind, the host's `toggleScores`); `putaway` is `Cmd_PutAway_f`: the
  help computer, the inventory and the score board put away (`putAway`). `test:console` sees `score` reach the
  host in a game running and not without one, and `putaway` reach it; the browser test types `score` in single
  player and sees no board, then at the host of a shared game sees the board up and `putaway` take it down.
- **`cl_predict` and `cl_showmiss`**: done. `cl_predict 0` at a joined page's console stops its prediction
  (`CL_PredictMovement`'s early return: the commands go, nothing runs ahead, the host's frames painted as they
  come; `cl_predict 1` starts it again), and `cl_showmiss 1` prints each miss as `CL_CheckPredictionError`
  printed it ("prediction miss on <tic>: <the deltas summed in eighths>"), the misses counted on the page's
  `prediction` debug object; neither archived, as Quake's were not. `test:console` shows, sets and refuses
  them and leaves them out of config.cfg; the browser test, on the joined page of both builds, turns the
  prediction off and sees no state ahead of the frames while its keys still reach the host as its command,
  the misses counted.
- **`viewsize`, `sizeup` and `sizedown`**: done. The painter draws the 3D view in `SCR_CalcVrect`'s rectangle
  now (`Renderer.setViewSize`: `viewsize` percent of the view, 40 to 100, the width a multiple of 8 and the
  height of 2, centred), the backtile tiled around it (`tileClear`, `Draw_TileClear`'s `pics/backtile.pcx`)
  and the status bar, the notify lines and the menus where they were: the projection's centre and scale are
  the rectangle's, every span, triangle and particle clips to it, and the SQL-projecting mode's points move
  with it; the SQL's frustum (`viewcfg`) is the rectangle's size, so a smaller view culls like one. `viewsize`
  is a cvar kept with the settings (archived, as Quake's was), `sizeup` and `sizedown` step it by ten
  (`SCR_SizeUp_f`, `SCR_SizeDown_f`), `=` and `-` their keys by default as default.cfg bound them (default
  lines beside END's centerview); a guest's rectangle lies within the host's frustum. `test:painter` paints a
  view at 60 and finds the backtile outside the rectangle and the world inside, the whole at 100 as before;
  `test:console` the cvar, its range and the two words; `test:settings` and `test:input` the default lines;
  the browser test types `viewsize 60` and reads the rectangle, the tile and the SQL's frustum, `sizeup`, `=`
  and `-` stepping it, `viewsize 100` the whole again; the golden screenshots and the pixel comparison hold at
  100.

The eleventh list: what the console still lacks of Quake 2's own words with the demo pak, the painter's and
the server's among them. In the order they are to be taken.

- **`r_fullbright`, `r_drawentities`, `r_drawworld`, `r_lerpmodels`, `r_novis` and `r_speeds`**: done. ref_soft's
  switches at the console, none archived as Quake's were not: `r_fullbright` builds every surface at full light
  (`R_BuildLightMap`'s, no lightmap and no dynamic light, the surface cache cleared with the switch) and draws
  every model at light 255; `r_drawentities 0` leaves out the brush models' faces, the models, the sprites and
  the view weapon, `r_drawworld 0` the world's faces; `r_lerpmodels 0` blends no pose; `r_novis` is
  `viewcfg.novis`, which `build_vis_set` reads to mark every leaf with the PVS and the area portals ignored as
  `R_MarkLeaves` did with it, the kept sets dropped with the switch (a guest paints the host's frames as they
  are); `r_speeds` prints the frame's figures on the console's line once a second, "ms, wpoly, epoly" as
  `R_RenderFrame` printed them every frame. The smoke test switches novis on and finds more faces in the frame,
  then the PVS's count again; `test:painter` builds a surface at full light and finds it brighter than lit, as
  it was once the switch is off; `test:console` shows, flips, refuses and restores the six and leaves them out of
  config.cfg; the browser test marks every leaf, sets the painter's flag, reads an r_speeds line, and sees the
  defaults back.
- **`serverinfo`, `userinfo` and `status`**: done. `serverinfo` is `SV_Serverinfo_f`: the game's cvars
  (`mapname`, `deathmatch`, `coop`, `dmflags`, `fraglimit`, `timelimit`, `cheats`, `skill`) as `Info_Print`
  listed them, from the game row (the host's `serverInfo`; a joined page runs no server of its own and says
  so); `userinfo` is `CL_Userinfo_f`: this page's `name`, `hand`, `fov` and `spectator`; `status` is
  `SV_Status_f`: the map and the clients with their frags, pings and names, a line each in the scrollback as
  it laid them out and the sum on the line, over the score board's rows (a joined page's from its row).
  `test:console` reads the three lines and the scrollback's layout, and the refusals; the browser test types
  them in single player and reads the cvars, the userinfo and the one client, then `status` on the joined page
  with both clients and `serverinfo` refused there.
- **`m_yaw`, `cl_gun` and `con_notifytime`**: done. `m_yaw` is the turn a mouse count (0.022 as Quake had
  it; `Input.mouse` reads it beside `m_pitch`'s sign), `cl_gun 0` draws no view weapon (as `CL_AddViewWeapon`
  had it), and `con_notifytime` is the notify lines' seconds (3; `Notify.seconds`, set at the start and on the
  word). None archived, as Quake's were not. `test:input` doubles the turn with `m_yaw`; `test:console` shows,
  sets and refuses the three and leaves them out of config.cfg; the browser test sets the three and reads them
  in the settings and the notify's seconds, then puts them back.
- **`vid_gamma` and `vid_fullscreen`**: done. `vid_gamma` is the video menu's brightness as a cvar (the
  control's tenths from 1 to 1.8, 1.4 by default, a number between snapped and clamped to them; archived, as
  Quake's was: the painter's light scale and the control follow through the page's `setSetting`), `vid_fullscreen` the page's live fullscreen state shown (`isFullscreen`), 0 or 1
  asking the page for it or leaving it, as the video menu's box does. `test:console` shows, sets and refuses
  the two and writes `vid_gamma` to config.cfg; the browser test sets the brightness by the word and reads
  the setting, the painter's scale and the control, and reads the fullscreen state of a headless page.
- **`help`, `sv_gravity` and `hostname`**: done. `help` is `Cmd_Help_f` as a word (the help computer, or the
  score board in deathmatch, as F1 brings it; `toggleHelp`), `sv_gravity` the game row's gravity for the game
  running (`gravity`, `setGravity`: `sv_gravity 300` floats; a new map takes its worldspawn's again; a joined
  page runs no server and says so), and `hostname` the host's name (archived, as Quake's was; "noname" when
  empty): the serverinfo lists it, and the map message carries it so a joined page's stats line names the host
  ("joined Hal: …"). The relay's room does not carry it yet. `test:console` sets and refuses the name, sees
  `help` reach the host in a game running, and `sv_gravity` shown, set, refused and refused on a joined page;
  the browser test reads the name in the serverinfo, the gravity on the game row, the help computer up and put
  away, and, hosting again under a name, the rejoined guest's stats line naming it.
- **`deathmatch`, `coop` and `maxclients` as cvars**: done. The Players select's words, latched as Quake
  latched them: `deathmatch 1` is a deathmatch of the clients at the next game, `coop 1` a coop game of them,
  `maxclients 2`–`4` how many (`1` single player), each saying "will be changed for next game." and going to
  the settings and the select through the page's `setGameMode` without starting a game; shown alone, each
  says what the next game is. `test:console` sees the three latch, show and refuse; the browser test types
  them and reads the settings and the select following while the game running goes on.

The twelfth list: what the console still lacks of Quake 2's own words and cvars with the demo pak, the
client's speeds and the game's view cvars among them. In the order they are to be taken.

- **`cl_yawspeed`, `cl_pitchspeed`, `cl_anglespeedkey`, `cl_forwardspeed` and `cl_sidespeed`**: done. The keys'
  speeds as cvars, `CL_AdjustAngles` and `CL_BaseMove`'s, with Quake's defaults: 140 and 150 degrees a second (the
  look was 100 here), `cl_anglespeedkey`'s 1.5 on the turn and the look with `+speed` held, 200 units a second each
  move. `Input.read` has them from the settings (`speeds`): the keys and the right stick turn and look by them a tic,
  the walk and the sidestep are scaled in the full speed's 200, the command's fraction kept within 1 (the game runs at
  300 over 200 as pmove's most, so a speed past 200 is the full one). None archived, as Quake's were not. `cl_upspeed`
  is not here: the command's up is the jump and the crouch keys, and the swim and noclip rise are the fixed 200.
  `test:input` holds each to its numbers; `test:console` shows, sets and refuses them, `cvarlist` with them; the
  browser test types `cl_yawspeed 280` and `cl_forwardspeed 100` and reads the settings on both builds.
- **`gun_x`, `gun_y`, `gun_z` and `scr_centertime`**: done. The three are `SV_CalcGunOffset`'s development tools
  (g_main.c's cvars, 0): the view weapon drawn moved along the view's right, forward and down by them (the page's
  `drawFrame`, the renderer's view vectors). `scr_centertime` is `SCR_DrawCenterString`'s 2.5 seconds: a centre print
  is drawn that long from when it came, a clock a view (`CenterPrint` in `src/notify.js`), whatever the row carries
  it for (the SQL's three seconds stay the game's, as a demo's frames were written: a print was the client's to time).
  None archived, as Quake's were not. `test:console` shows, sets and refuses the four, `cvarlist` with them, and
  holds the clock to its cases (the same text, the text back, a new one, the seconds changed, a new level); the
  browser test types `gun_z 10` and `scr_centertime 1` and reads the settings on both builds.
- **`dir`, `path`, `modellist`, `imagelist` and `soundlist`**: done. `path` is `FS_Path_f`: the pak in use (the
  demo's, or the picked one the browser keeps), its files counted and where it came from. `dir <wildcard>` is
  `FS_Dir_f`: the pak's files the wildcard names (`*.*` without one; `*` and `?` within a directory, as the file
  system's glob had them, so `dir maps/*.bsp`), on the scrollback by their names under "Directory of", and how many
  on the line. `modellist`, `imagelist` and `soundlist` are `Mod_Modellist_f`, `R_ImageList_f` and `S_SoundList_f`:
  the models with their size in the pak (the full game's monsters on a row without a mesh at 0), the pictures (P),
  the wall textures the painter has built (W) and the models' skins (M) with their sizes, and the sounds decoded so
  far with L on the ones looping, a line each as those laid them out, and the totals. `test:console` reads the
  lines printed and the answers, the glob's cases and Tab; the browser test types the five on the demo pak and
  reads the pak's name, the three maps and the counts, on both builds.
- **`gender`**: done. The gender userinfo, a word (archived, as Quake's was: male by default; one starting with
  f is female, with m male, any other neutral, as `IsFemale` and `IsNeutral` read it), on `player.gender` (0, 1, 2)
  through `Session.setUserinfo` with the name and the hand, a guest's over the link. `client_obituary` chooses the
  pronouns by it ("tripped on her own grenade", "blew herself up", "killed itself": `his_`, `himself_`), and the
  sexed sounds (the pains, the deaths, the gurgles, the jump) come from `player/female/` for a female client
  (`sexed`, `S_RegisterSexedSound`); the demo pak has no female sounds, so the page's audio plays the male's where a
  pak lacks them, as the client fell back. `test:coop` sees the pronouns on the message line and the sounds' paths
  by the row; `test:net` the guest's word on the host's row; `test:audio` the fallback; `test:console` the cvar,
  `cvarlist`, `writeconfig` and `userinfo` with it; the browser test types `gender female` and reads the settings
  and the userinfo line on both builds.
- **`msg`**: done. The message level userinfo (`SV_ClientPrintf`: a print below the client's level is dropped), 0 to
  3, archived, 1 by default as Quake's cvar was: so the "No shells for shotgun" prints, `PRINT_LOW`, stay off the line
  unless `msg 0`, as they did in Quake 2; at 2 the obituaries (`PRINT_MEDIUM`) go too, at 3 only the chat. `sprint`
  takes the level (high unless said), `player.msglevel` holds the client's, from `Session.setUserinfo` with the rest
  of the userinfo, a guest's over the link. `test:coop` sees an obituary reach the first client alone at 2, a low
  print none at 1 and one client at 0, the chat at 3; the smoke test reads the no-ammo prints at `msg 0` and none
  at 1; `test:net` the guest's level on the row; `test:console` the cvar, `cvarlist`, `writeconfig` and `userinfo`
  with it; the browser test types `msg 0` and reads the settings, the userinfo line and the row, on both builds.
- **`bob_up`, `bob_pitch`, `bob_roll`, `run_pitch`, `run_roll`, `sv_rollangle` and `sv_rollspeed`**: done. p_view.c's
  cvars on the game row (Quake's defaults, in the save), set at the console for the game running as `sv_gravity` is
  (`gameCvar`, `setGameCvar`, `GAME_CVARS`'s ranges). `player_think` bobs the eye, the pitch and the roll by the first
  three a unit of speed and adds the velocity along the view's forward and right times `run_pitch` and `run_roll`
  (`SV_CalcViewOffset`'s "angles based on velocity", which the port lacked: a run pitches the view down a little, a
  sidestep rolls it), and rolls the player's model by `SV_CalcRoll` times four (`sv_rollangle`, full at a sideways
  `sv_rollspeed`), what the other players and a recording see. `src/pmove.js` is the twin, the cvars given with the
  world (`VIEW_CVARS` the defaults; a guest's come in the map message, so one changed at the host's console reaches a
  guest's prediction at the next map). The smoke test walks with `bob_up 0`, sidesteps with `run_roll` and reads the
  model's roll; `test:predict` holds the JS to the SQL's eye, pitch and roll with the cvars changed; `test:console`
  shows, sets and refuses them and Tab; the browser test sets two on the game row on both builds.

The thirteenth list: what the page still lacks of Quake 2's own words, sounds and pictures with the demo pak, the
client's events among them. In the order they are to be taken.

- **`viewpos` and `timerefresh`**: done. `viewpos` is `V_Viewpos_f`: the eye's position and the yaw as whole
  numbers, "(x y z) : yaw" (`screenshot.mjs --at=` takes the same, its z the origin's, 22 under the eye standing).
  `timerefresh` is `SCR_TimeRefresh_f`: the view spun a full turn in 128 frames, each a frame query with the
  player's yaw set on its row (put back after; the loop held meanwhile, so no tic runs and nothing in the game
  changes) and a paint, presented each or once at the end with an argument, then the seconds and the frames a
  second as `Com_Printf("%f seconds (%f fps)")` said them; a joined page, a demo or the menu up refuse it.
  `test:console` reads the line's whole numbers, the two ways and the refusals, and Tab; the browser test types
  both, reads the position, the timing, and the game going on after, on both builds.
- **`play`, `stopsound` and `soundinfo`**: done. `play <sound> …` is `S_Play`: each word a pak sound played at the
  ear (`.wav` added to one without a dot, lower-cased; one the pak lacks is named), `stopsound` is
  `S_StopAllSounds` (every one-shot cut, `Q2Audio.playing` tracks them, the channels and the loops cleared, a
  cinematic's samples too; the next frame's rows start the loops again), and `soundinfo` is `S_SoundInfo_f`: the
  mix's rate, stereo, the sounds decoded, the ones playing and looping, a line each on the scrollback as it laid
  them out and the sum on the line, "sound system not started" before the first click or key makes the context.
  `test:audio` plays one at the ear, reads the figures and cuts everything; `test:console` the words with `.wav`
  added, a missing one named, the lines laid out, the not-started line and Tab (`play` comes before `players`
  now); the browser test plays a sound, reads the figures and stops, on both builds.
- **Footsteps and `cl_footsteps`**: done. `G_SetClientEvent`'s `EV_FOOTSTEP` in `player_think`: on the ground past
  225 units a second, each time the bob cycle's next step turns its whole number, `player/step1-4.wav` is queued on
  the body channel at the player as `CL_EntityEvent` played it, so every page hears its own and the others' and a
  recording carries them as sounds. A demo's entity events (`entity_event_t` on the states: a footstep, a short
  landing, a fall and a far one, an item respawning, a teleport) come with the frames reached and play through
  `DemoPlayer.soundRows` as the client played them. `cl_footsteps 0` drops the footsteps at the page
  (`Q2Audio.footsteps`, the demo's too); not archived, as Quake's was not. The smoke test counts the steps queued
  running and none walking at 200; `test:demo` finds the events in the pak's demo and the rows they make, none with
  the switch off; `test:audio` the switch; `test:console` the cvar; the browser test flips it on both builds.
- **`scr_showpause`, `scr_showturtle` and `cl_maxfps`**: done. Paused, the page draws `pics/pause.pcx` centred a
  little under the middle as `SCR_DrawPause` did (`Hud.drawPause`; the word "paused" went), nothing with
  `scr_showpause 0`. `Hud.drawTurtle` is `SCR_DrawNet`'s turtle: `pics/turtle.pcx` at the view's corner from the
  third frame in a row that took a tenth of a second or more, the count starting over at a faster one, with
  `scr_showturtle 1` (0 by default, as Quake's). `cl_maxfps` is `CL_Frame`'s cap: a frame paints once
  1000/cl_maxfps ms have passed since the last painted (`paintDue`, 90 as Quake had it; 0 every animation frame,
  else 5 to 1000), the tics running as the wall clock owes them either way, a guest's paints capped too; the
  SQL-projecting mode paints a tic's frame as it is. None archived, as Quake's were not. `test:hud` draws the
  plaque and not, and the turtle from the third slow frame, reset by a fast one or the switch; `test:console`
  the three cvars, `cvarlist` with them; the browser test pauses and reads the plaque drawn and not, counts the
  paints a second under `cl_maxfps 10`, and reads the turtle's switch, on both builds.
- **`sv_maxvelocity`, `sv_airaccelerate` and `g_select_empty`**: done. Three more of the game's cvars on the game row,
  set at the console as the bob's. `sv_maxvelocity` is `SV_CheckVelocity`'s clamp (2000): a tossed thing's speed in
  `toss_move`, a falling monster's in the step. `sv_airaccelerate` is pmove's air acceleration: 0 gives
  `PM_Accelerate` at 1 in the air (a little control, as Quake had it; the port had none), on it is `PM_AirAccelerate`
  with the wish speed capped at 30 and the acceleration 10 over the whole of it, a strafe jump, in `player_think` and
  `src/pmove.js` alike (a guest's from the map message with the bob's). `g_select_empty` lets `Use_Weapon` take a
  weapon with no ammo for it and the cycle visit it. `weapnext` and `weapprev` are words at the console too. The
  smoke test takes the empty shotgun and cycles to it with `g_select_empty 1`, not without, and clamps a rocket's 500
  to 100 under `sv_maxvelocity 100`; `test:predict` holds the JS to the SQL's origin, speed and view over a jump with
  `sv_airaccelerate 10`; `test:console` the three on the game row and Tab; the browser test sets two on the row and
  cycles the weapons by the words, on both builds.
- **`sv_maplist` and `sky`**: done. `sv_maplist` is a text on the game row (map names parted by spaces or commas,
  set at the console; in the save): `end_dm_level` walks it through `maplist_next` as `EndDMLevel` did, the map
  after the one running at the exit, the frag limit or the time limit, round again from the end, a map not in the
  list going where the exit leads, the same-level flag first. `sky <name> [rotate] [axis x y z]` is `SCR_Sky_f`: the
  sky box of the map running changed and spun about an axis (`setSky`; the demo pak has `unit1_`), this page's
  alone; one the pak lacks is refused and the one up stays. `test:dm` ends the level under a list three ways and
  parts a list's cases; `test:console` the text set, cleared and refused, the sky's usage, the box, the spin, a
  missing one and no map, and Tab; the browser test spins the demo's sky and reads the renderer, refuses a missing
  one, and reads the list on the row, on both builds.

The fourteenth list: what the menus, the network game, the painter, the music and the console still lack of Quake 2's
own words with the demo pak. In the order they are to be taken.

- **`menu_dmoptions`**: done. The multiplayer menu's fourth row, `deathmatch options`, is `M_Menu_DMOptions_f`: the
  dmflags as thirteen yes/no rows (falling damage, weapons stay, instant powerups, allow powerups, allow health,
  allow armor, spawn farthest, same map, force respawn, allow exit, infinite ammo, quad drop, friendly fire; the
  "no" flags inverted as `DMOptions_MenuInit` showed them; no teamplay row, there being no model or skin teams
  here), each turn writing the page's `dmflags` setting as `DMFlagCallback` wrote the cvar, for the next game and
  the game running (`setSetting` puts it on the game row), the status bar saying the value; `menu_dmoptions` opens
  it at the console. `test:menu` opens it from the multiplayer menu, turns rows and reads the bits and the status
  bar; `test:console` the word; the browser test opens it, turns weapons stay and reads the settings and the game
  row, on both builds.
- **`password` and `spectator_password`**: done. A guest's info carries its `password` (the cvar at its console, with
  the userinfo), and the host judges it as `SV_DirectConnect` and `ClientConnect` did (`connectRefusal` in
  `src/net.js`): a player's against the host's `password`, a watcher's against its `spectator_password`, empty or
  "none" asking nothing; a guest refused is kicked with the reason before it is in ("Password required or
  incorrect", "Spectator password required or incorrect"), its page saying so and standing for a key, the host
  keeping its other guests. The serverinfo's `needpass` counts the two (1 and 2), as `SV_StatusString` set it.
  Neither archived, as Quake's were not. `test:net` carries the password with the info and judges the cases;
  `test:console` the two cvars, a space refused, `cvarlist` with them; the browser test reads `needpass` as they are
  set and cleared, and has a third page refused with the reason by a host with a password, the first guest kept,
  then let in once it is cleared, on both builds.
- **`sw_drawflat`, `sw_waterwarp` and `sw_clearcolor`**: done. ref_soft's three: `sw_drawflat 1` builds every face in
  a flat colour of its own (`D_DrawflatSurfaces` took the surface pointer's low byte; the face's id here), no texture
  and no light, the surface cache cleared with the switch; `sw_waterwarp 0` draws the view under water as above it
  (`D_WarpScreen` skipped); `sw_clearcolor` is the palette index the view is cleared to before a frame (Quake's
  default 2, 0 here so the goldens stand). Painter switches like `r_fullbright`, none archived. `test:painter`
  builds a flat surface and another face's in another colour, textured again after, and clears to the index;
  `test:console` the three cvars, `cvarlist` with them; the browser test flips them and reads the painter and the
  settings on both builds.
- **`cd_loopcount`, `cd_looptrack` and `cd_nocd`**: done. The music loops as `CDAudio_Update` looped it: a map's
  track plays over again at its end until it has played `cd_loopcount` times (4), then `cd_looptrack` (11) over and
  over (`Q2Audio.playMusic`'s `onended`, the track's play count on the music token; the drone that stands in for a
  track with no file is one endless track); `cd_nocd 1` stops the music and plays none until it is off again
  (archived, as Quake's was; the two counts not). `test:audio` ends a track twice under `cd_loopcount 2` and sees it
  again, then the loop track, and the music stopped and back with `cd_nocd`; `test:console` the three cvars,
  `cvarlist` with them; the browser test reads the audio's counts and the music stopped and back, on both builds.
- **`m_filter` and `host_speeds`**: done. `m_filter 1` averages each mouse sample with the one before as
  `CL_MouseMove` did with `old_mouse_x` and `old_mouse_y` (`Input.mouse`; archived, as Quake's was), and `host_speeds 1`
  prints a frame's times on the line once a second as `Qcommon_Frame` printed "all, sv, gm, cl, rf": the whole, the
  server frame outside the game (none: the SQL tic is the game), the game (the tic), the client outside the painter
  (the frame query) and the painter. `test:input` averages two samples and takes one whole without the switch;
  `test:console` the two cvars and `config.cfg` with `m_filter`; the browser test reads the line and the setting on
  both builds.
- **`timeout` and `cl_timeout`**: done. Each link notes when it last heard the other (`heardAt`, `silentPast` in
  `src/net.js`): the host drops a guest silent past `timeout` seconds (`SV_CheckTimeouts`, 125: "<name> timed out" on
  every message line, "Connection timed out" at its page, its client standing as a kicked guest's), and a guest
  leaves a host silent past `cl_timeout` seconds (`CL_CheckTimeout`, 120: "Server connection timed out.", its page
  standing for a key as a kicked one does); 0 never, neither archived, both words at the console. `test:net` moves
  the clock past each and sees the link past its time, not before; `test:console` the two cvars; the browser test
  has a joined page hear nothing under `cl_timeout 2` and leave with the reason, on both builds.

The fifteenth list: what the menus, the host's console, the chat, the painter and the page's logs still lack of
Quake 2's own words with the demo pak. In the order they are to be taken.

- **`menu_startserver`**: done. The multiplayer menu's fifth row, `start server`, is `M_Menu_StartServer_f` as
  `StartServer_MenuInit` laid it out: the initial map (the pak's maps by name on a spin, the settings' map first), the
  rules (single player, cooperative, deathmatch: the page's mode, latched for the next game as the `coop` and
  `deathmatch` words latch it, the Players select following), the time limit and the frag limit (numbers-only fields,
  `QMF_NUMBERSONLY`, writing the settings and the game row at every key as the console's words do), the max players
  (two to four at this page, the rules allowing), the hostname (twelve characters, as its field had), the deathmatch
  flags (`M_Menu_DMOptions_f`, greyed outside a deathmatch as `RulesChangeFunc` greyed them) and `begin`, which starts
  a new game on the map as the Map select does (`StartServerActionFunc` ran `map`); `menu_startserver` opens it at the
  console. `test:menu` opens it from the multiplayer menu, turns the map and the rules, types the limits, the players
  and the hostname, reads the settings and the mode latched, and begins; `test:console` the word; the browser test
  opens it, turns the rules to deathmatch and types a time limit, reads the settings, the select and the game row with
  the game running on, on both builds.
- **`menu_joinserver` and `menu_addressbook`**: done. The multiplayer menu's sixth row, `join server`, is
  `M_Menu_JoinServer_f` as `JoinServer_MenuInit` laid it out: `address book` first, then (in place of the server search:
  no LAN here) the relay (the `rtcSignal` setting typed) and the host's code at it, or its offer text, `connect` joining
  with it as Join and Answer would (the menu goes, the page's panel shows the answer or waits for the host), and under
  "connect to..." the address book's entries as the found servers were listed, each joining with its code (a relay named
  in it, "http://host:8787 K9H2", set first), "<no server>" greyed while the book is empty, the rows reading the book
  live. `address book` is `M_Menu_AddressBook_f`: nine text fields (`adr0` to `adr8`, sixty characters, thirty shown)
  kept in the settings (`addressBook`, checked at the load) as the cvars were archived, each key writing the setting; a
  page that joins by code puts the relay and the code first in the book by itself, once, the last entry off past nine.
  `menu_joinserver` and `menu_addressbook` open them at the console. `test:menu` opens the join menu from the multiplayer
  menu, fills two entries of the address book and sees them on the join menu's rows on return, types a relay and a code
  and connects, and joins an entry with its relay set; `test:settings` the book's check; `test:console` the two words;
  the browser test types an entry and sees it on the join menu, and the network game's join by code puts the relay and
  the code in the guest's book, on both builds.
- **`dumpuser` and the chat's flood cvars**: done. `dumpuser <n>` is `SV_DumpUser_f`: a client's userinfo in the
  scrollback as `Info_Print` laid it out (each key on twenty characters, its value after), the line summing it; this
  page's, a guest's from its connect, a pad's player's name and hand from its row (the host's `dumpUser`); a joined
  page is sent to the host, a client not in the game "is not active", a number past four "a bad client slot".
  `flood_msgs`, `flood_persecond` and `flood_waitdelay` are game-row cvars (4, 4 and 10 as Quake's, set at the console
  as the bob's): `client_say` is `Cmd_Say_f`'s flood protection first, the last ten says' times on the player row
  (`flood_when`, ten characters each, `flood_locktill`): more than `flood_msgs` says in `flood_persecond` seconds and
  the sayer alone is told "Flood protection:  You can't talk for N seconds.", saying again "You can't talk for N more
  seconds", the lock lifting with the level clock; `flood_msgs 0` is no protection. `test:coop` says four times at
  once, is refused the fifth and told the lock, told how many more seconds three seconds on, talks again past the
  wait, and floods freely at 0; `test:console` the three cvars shown, set and refused, and dumpuser's usage, a joined
  page, no game, a client's print and sum, a pad's, an inactive client and a bad slot; the browser test prints this
  page's userinfo, asks for an inactive client and sets a flood cvar on the row, on both builds.
- **`sw_mipcap`, `sw_mipscale` and `sw_stipplealpha`**: done. `mipLevel(scale, mipscale, mipcap)` is `D_MipLevelForScale`
  whole: the thresholds 1, 0.4 and 0.2 scaled by `sw_mipscale` (`d_scalemip`, 1) and the level at least `sw_mipcap`
  (`d_minmip`, 0 to 3), both the painter's (`Renderer.mipscale`, `mipcap`) from the settings, neither archived.
  `sw_stipplealpha 1` draws the translucent surfaces stippled in place of the blend through the alpha map
  (`stippleKeep`: three pixels in four at 66% and one in four at 33%, as `R_DrawSpanlet66Stipple` and
  `R_DrawSpanlet33Stipple` kept them, the parity turned each frame, the depth left as the blend leaves it; the models'
  blend stays, as ref_soft's did), archived as Quake's was. `test:painter` holds the thresholds scaled and capped, the
  stipple's counts, a frame at the cap with every surface at mip 3 and a frame stippled differing where its translucent
  faces are; `test:settings` the three checked; `test:console` shown, set, refused, Tab and config.cfg (the stipple
  archived, the two not); the browser test sets the three, sees surfaces built at mip 3 under the cap and puts them
  back, on both builds.
- **`developer` and `logfile`**: done. `developer 1` is `Com_DPrintf`'s switch: the page's warnings (`console.warn`'s,
  wrapped once at the start) go to the console's lines and scrollback as well; not archived, as Quake's was not.
  `logfile 1` is `Com_Printf`'s write to `qconsole.log`: the scrollback's lines go to the file as they come
  (`Notify.onAdd`), kept in the page's file store a second after a line and at the page's end (`pagehide`), so a
  reload's run follows the last; `logfile 0` downloads the file and drops it (`setLogfile`; Quake left it in the game
  directory), "nothing was logged" when there is none. `test:settings` the two as booleans; `test:console` developer
  shown, set and refused, logfile's cases (shown, refused, nothing logged, on, already on, downloaded with its lines)
  and Tab, and `onAdd` told each line; the browser test logs a line and downloads `qconsole.log` with it, and sees a
  warning on the console with `developer 1` and not without, on both builds.
- **`fixedtime` and `sv_noreload`**: done. `fixedtime <ms>` steps the game's clock a fixed number of milliseconds an
  animation frame whatever the wall says, as `Qcommon_Frame`'s `fixedtime` did (the ms owed kept to two tics' worth, as
  the loop runs at most two a frame, so past 100 it runs as 100; the fraction between tics from what is left, a demo's
  clock with it; 0 the wall's; a guest's clock is the host's; not archived, as Quake's was not). `sv_noreload 1` (3.20's)
  makes a level of the unit come back to spawn fresh, what was left in it unread (`Session.startMap`'s `noreload`, the
  kept levels staying aside), as a coop game wants its monsters back; not archived. On the way, a level come back to a
  second time failed to import: a level entered by a spawn point puts the player amid its entities, so the fresh load's
  ids run past it, and `importLevel`'s moves of the players' ids collided with a fresh entity still in the table; the
  base clears the table's highest id as well now. `test:session` comes back to demo2 a second time (the player's id
  above every entity's), then leaves demo1 marked, comes back under `noreload` and finds the map's fresh spawn with the
  kept levels still aside and the player's health carried; `test:console` fixedtime shown, set, refused (a fraction, past 1000, a word), a guest told, and sv_noreload
  shown, set and refused, Tab for both; `test:settings` the setting; the browser test steps the clock a tic a painted
  frame under `fixedtime 50` and the wall's again at 0, and reads sv_noreload in the settings, on both builds.

The sixteenth list: what the chat, the music, the view, the keys, the graphs and the page's ends still lack of
Quake 2's own words with the demo pak. In the order they are to be taken.

- **`messagemode` and `messagemode2`**: done. The chat prompt is `Key_Message`'s now: T (the `messagemode` action) or
  either word at the console brings "say:" ("say_team:" for `messagemode2`) up under the notify lines with the line
  typed after it and a blinking cursor, as `Con_DrawNotify` drew it (the page's `drawChat`), every key going to it,
  Enter saying the line (`say`; `say_team` is `say` here), Escape dropping it, Backspace taking a character off, in
  place of the console opened with "say " typed; a game must be running, and the prompt goes with the level. `bind y
  messagemode2` works as a command line. `test:console` the two words through the page, refused without a game, Tab;
  the browser test brings the prompt up with T, types and says a line that reaches the message line by the player's
  name, and drops the team's prompt with Escape, on both builds.
- **`cd` and `s_show`**: done. `cd` is `CD_f`'s word over the music: `cd play <n>` plays a track once (nothing at its
  end) and `cd loop <n>` over and over, whatever `cd_loopcount` says (`playMusic`'s `how`), `cd stop`, `cd pause` and
  `cd resume` from where it was (`pauseMusic`, `resumeMusic`: the offset into the track), `cd off` and `cd on`
  (`setEnabled`: no music until on again), `cd info` printing the tracks (a picked folder's, else the CD's eleven),
  what plays or is paused and how, and the volume as it did, summed on the line; the Music control off is said.
  `s_show 1` prints each sound started on the scrollback as "left right name" with the volumes 0 to 255, a line a
  sound rather than `S_Update`'s every frame (`Q2Audio.onStart`); not archived, as Quake's was not. `test:audio` plays
  once and at the end nothing, loops, pauses with the offset and resumes from it, turns the music off and on, and is
  told a sound started; `test:console` s_show shown, set and refused, cd's words through the page, info laid out and
  summed, an unknown word refused, Tab; `test:settings` the setting; the browser test prints a sound started and drives
  the music with the words, on both builds.
- **`cl_add_entities`, `cl_add_particles`, `cl_add_lights`, `cl_add_blend` and the `cl_test*` cvars**: done. The four
  switches are `V_RenderView`'s: 0 leaves the entities (the brush models and the view weapon with them, as
  `r_numentities` 0 did), the particles, the dynamic lights or the palette blend out of a frame. `cl_testentities`,
  `cl_testlights`, `cl_testparticles` and `cl_testblend` are `V_TestEntities`, `V_TestLights`, `V_TestParticles` and
  `V_TestBlend`: 32 models (the first model with a mesh, there being no player model in the demo pak) and 32 lights of
  200 units in four columns 64 apart from 128 on, 4096 particles a quarter unit on in an 8 by 8 spread of 4 units, and a
  blend of 1, 0.5, 0.25 at half, about the eye each frame; a switch at 0 leaves a test's ring out too. None archived.
  `test:settings` the eight; `test:console` shown, set, refused and Tab; the browser test reads a frame with the tests
  on (32 lights and models, 4096 particles, the blend), the switches at 0 (none of them), and back, on both builds.
  `frameInfo` on the page's debug object says what the first view's last frame had.
- **`cl_upspeed` and `cl_lightlevel`**: done. The usercmd's jump is Quake's upmove now, ±`cl_upspeed` (200) as
  `CL_BaseMove` made it from `+moveup` and `+movedown` (it was ±1 as a flag): `player_think` and `src/pmove.js` take
  10 or more as the jump key held, as `PM_CheckJump` had it, add the upmove to the wish in water (up on the jump key,
  the crouch swimming down) and rise in noclip by its share of 200, so the numbers at the default are as they were
  (`test:predict` holds the twin to the SQL's over the run); `cl_upspeed` at the console, units a second 0 to 1000,
  not archived. `cl_lightlevel` shows the light at the eye as `R_SetLightLevel` saved it for the server each frame (150
  at full light), read from the lightmap under the eye (`lightLevel`); a value given is refused. `test:input` reads
  the upmove at 200 and at 100; `test:console` the cvar shown, set and refused, cvarlist with it, the light shown,
  refused a value and without a map, Tab; `test:settings` the setting; the coop, deathmatch, prediction, smoke and net
  tests jump at 200 (the crouches at -200); the browser test reads the setting and the upmove from the keys, and the
  light at the eye, on both builds. On the way, the host's merge of a guest's pending commands turned any upmove into
  1, a crouch into a jump: the upmove is carried as sent now, its sign kept.
- **`scr_timegraph` and `scr_debuggraph`**: done, under the names cl_scrn.c registered the cvars (the `scr_` is the C
  variables' alone): `timegraph 1` adds a frame's time as a column each painted frame (`cls.frametime` × 300, colour 0,
  as `SCR_DebugGraph` took it), `debuggraph 1` draws the band along the bottom of the view whatever it holds (a joined
  page's netgraph columns among them), and `graphheight` (32), `graphscale` (1) and `graphshift` (0) lay it out as
  `SCR_DrawDebugGraph` did (`Netgraph.draw`'s options from the settings); none archived. `test:hud` draws the band at a
  height with a shift; `test:settings` the five within their ranges; `test:console` shown, set, refused and Tab; the
  browser test sees a column added a painted frame under `timegraph 1` and the layout cvars in the settings and back,
  on both builds.
- **`quit`, `killserver`, `vid_restart` and `snd_restart`**: done. `quit` ends the game for the attract loop as the quit
  menu's yes does (`Com_Quit`; the page stays), `killserver` drops a hosted game's guests first and does the same
  (`SV_KillServer_f`, "Server was killed"), `vid_restart` makes the painter anew from the settings (`VID_Restart_f`:
  `makeRenderer`, shared with the pak's load; the map's geometry given again, its sky, its spin, the backtile and the
  view's rectangle put back, the held frames dropped) and `snd_restart` the mixer (`CL_Snd_Restart_f`: `Q2Audio.restart` closes the context and
  makes it anew, the decoded sounds forgotten and decoded again as they play, the music played again). `test:audio`
  restarts the mixer and sees a new context, no sounds decoded and the track back; `test:console` the four through the
  page, each refused before it can be done, Tab; the browser test remakes the painter (another object, the sky and the
  size kept, the game painting on) and the mixer (another context), and kills the server for the attract loop and
  brings a game back with `map`, on both builds.

The seventeenth list: what the video menu's cvars, the level words, the mixer, the pad, the painter's switches and
the userinfo still lack of Quake 2's own words with the demo pak. In the order they are to be taken.

- **`vid_mode` and `vid_ref`**: done. `vid_mode` is the mode as the Detail select has it (0 160×120, 1 320×240, 2
  640×480, the video menu's spin) and `vid_ref` the refresh as the renderer mode (`soft` the painter with SQL picking
  the faces and JS projecting, `sql` the projector); a change goes through the page's control (`setSetting`, so the
  menus and the selects agree) and restarts the painter as `VID_CheckChanges` did, the same value again doing nothing;
  both archived in config.cfg as Quake's were (`CONFIG_CVARS` maps them onto the detail and renderer settings).
  `test:console` shows, sets (case aside), refuses, counts the restarts, reads config.cfg and Tab; the browser test
  sets the mode to 160×120 and the refresh to the projector and sees the controls and the painter follow, and back,
  on both builds.
- **`gamemap` and `nextserver`**: `SV_GameMap_f` as the level change with the one running kept aside (an ordinary
  exit's way, `*` wiping the unit), and the `+` chain of `SV_Map` (`map intro.cin+demo1`: the cinematic, then the
  map, `nextserver` holding what follows and read back with `nextserver` at the console).
- **`in_joystick`, `cl_paused` and `log_stats`**: done. `in_joystick 0` leaves the pads unread (`IN_Frame`'s;
  `Input.joystick`, `pollPad` and `pollPadAt` returning none), archived as Quake's was, 1 here where Quake's was 0;
  `cl_paused` shows the pause's state as `CL_Frame` set the cvar, a value refused (`pause` sets it); `log_stats 1`
  writes a line a painted frame, "entities,dlights,parts,frame time" after that header, to `stats.log` in the file
  store as `logfile` writes the console (`keptLog` serves both now), `log_stats 0` downloading it. `test:input` reads
  no pad with it off and the pad again with it on; `test:settings` the two settings; `test:console` in_joystick shown,
  set, refused and in config.cfg, cl_paused shown both ways and refused a value, log_stats's cases, Tab; the browser
  test downloads stats.log with its header and lines, flips in_joystick through to the input and reads cl_paused
  around pause, on both builds.
- **`s_khz`, `cl_shownet` and `cl_showclamp`**: done. `s_khz` is `S_Init`'s rate: 11 or 22 asks the next
  `snd_restart`'s context for 11025 or 22050 (`Q2Audio.khz`), 44 leaves the browser's own rate, the default here;
  archived as Quake's was. `cl_shownet` prints a joined page's messages on its scrollback as `CL_ParseServerMessage`
  printed them: 1 each message's size, 2 its size and kind ("f" the host's frames; `GuestLink.onNet`, the size from
  the link). `cl_showclamp` prints the clock's clamps as `CL_ParseFrame` said them: "high clamp" with the milliseconds
  dropped when the wall is ahead of the game past the two tics a frame runs, "low clamp" at a joined page when a host
  frame comes past its time. `test:audio` sees the context asked at 22050 and 11025 and the browser's own at 44;
  `test:net` the guest told each message's kind and size; `test:settings` the three; `test:console` shown, set,
  refused, config.cfg with s_khz, Tab; the browser test restarts the mixer at 22 kHz and back, and reads the host's
  frames' sizes at a joined page, on both builds.
- **`r_lockpvs` and `r_dspeeds`**: done. `r_lockpvs 1` keeps the view's cluster where it was locked (`viewcfg.lockpvs`:
  `mark_faces` exits with the cluster and the slot as they are, so the leaves stay marked from there while the eye
  moves on, as `R_MarkLeaves` held `r_viewcluster`); off, the eye's cluster is marked anew. `r_dspeeds 1` prints the
  painter's times in detail on the line once a second (the world's faces, the models and the sprites, the temporary
  entities and the particles, and the rest), as `R_RenderFrame` printed its "ms"s under it. Neither archived. The
  smoke test locks the view on another cluster, draws a frame and sees it held, then let go; `test:settings` the two;
  `test:console` shown, set, refused and Tab; the browser test sets the lock on the row and reads the times line, on
  both builds.
- **`rate` and `skin` userinfos**: done. `rate` is the bytes a second a joined page asks for: the host holds a frame when
  the frames of the last second sum past it (`HostLink.sendFrame`, as `SV_RateDrop` held a packet past the last ten's
  sum; `heldFrames` as its `surpressCount`, on `players`' line and the stats line), clamped as `SV_UserinfoChanged`
  clamped it, to 1000..1000000 here: Quake's 100..25000 was a modem's figure for frames of a few hundred bytes, and a
  frame here is the face list, kilobytes, twenty a second, so 500000 by default; the player setup's connection speed
  spin is `rate_tbl` at twenty times Quake's figures. `skin` is kept and sent with the userinfo as
  `ClientUserinfoChanged` took it (model/skin, male/grunt), shown by `userinfo` and `dumpuser`, in the setup's model and
  skin boxes (greyed still) and in a recording's `CS_PLAYERSKINS`; the model and skin themselves wait on a pak that has
  them. Both archived, as Quake's were. `test:net` sees the rate and the skin reach the host and the session, frames
  held at 25000 and none at 500000, the clamps; `test:settings` the two; `test:console` shown, set, clamped, refused,
  cvarlist, config.cfg, `userinfo`, `dumpuser`, `players` with the held count and Tab; `test:menu` the spin and the
  boxes; `test:record` the skin in the configstring; the browser test sets both and reads the userinfo line and the
  session's, and at a joined page sees the host hold its frames at 25000 and let them go at 500000, on both builds.

The eighteenth list: what the console, the link, the pad, the mixer and the painter still lack of Quake 2's own words
with the demo pak. In the order they are to be taken.

- **`playerlist` and `cmd`**: done. `playerlist` is 3.20's `Cmd_PlayerList_f`: each client's minutes and seconds in the
  game, ping, score and name as it laid them out ("%02d:%02d %4d %3d %s%s"), "(spectator)" for a watcher, a line each
  in the scrollback and the sum on the line; a joined page's from its score board rows. The time in the game is the
  level clock less the client's `enter_time` (`resp.enterframe`, `InitClientResp`: 0 at the level's start, the level
  time for a client `client_begin` puts into the game running), a player column in the save (older saves load it at
  0), in the tic row as `ENTER_TIME` and in the score board's rows, whose "Time" is each client's own now (it was the
  level's for every client). `cmd <words>` is `Cmd_ForwardToServer_f`: the words go to the host as typed on a joined
  page (`forward`), and run here on a page of its own. Both in the console's list for Tab. `test:net` sees a third
  client's enter time at the level time and the first two's at 0, the tic row carrying it; `test:console` playerlist's
  lines and sum, no game, cmd forwarded, its usage, run here, Tab; the browser test reads playerlist's line and runs cmd
  god here and, at a joined page, lists both clients and runs cmd god for its client at the host, on both builds.
- **`rcon` and `rcon_password`**: done. `rcon <line>` at a joined page is `CL_Rcon_f`: the line goes to the host with
  the page's `rcon_password` (the client's cvar and the server's were one name; one setting here, not archived), and
  the host's `SV_RemoteCommand_f` runs it at its own console when the password is its `rcon_password` (`Rcon_Validate`:
  none set, none taken), keeping the prints and the status line meanwhile (`Com_BeginRedirect`) and sending them back
  as a `print` message, onto the guest's scrollback with the last on its line; a wrong password answers "Bad
  rcon_password." and the host's scrollback says "Bad rcon from client N", a right one "Rcon from client N". No
  password set, the page says so as Quake did; no game joined (there is no `rcon_address` here), it says so too. Both
  words in the console's list for Tab. `test:net` sees the password and the line reach the host cut to their sizes
  and a print reach the guest; `test:settings` the setting; `test:console` the cvar shown, set and refused, rcon
  without a password, on a page of its own, joined (the line as typed), its usage and Tab; the browser test runs
  status at the host from the joined page and reads its lines there, then is refused with another password, both
  scrollbacks saying so, on both builds.
- **`showpackets` and `showdrop`**: done. `showpackets 1` prints each message sent or received at either end of a shared
  game on the scrollback with its size and kind, as `Netchan_Transmit` and `Netchan_Process` printed "send %4i" and
  "recv %4i" (`HostLink.send` and `GuestLink.send` tell `onPacket`, the receives too; the host's lines name the client).
  `showdrop 1` is `Netchan_Process`'s "Dropped %i packets at %i": at the host each frame dropped (the channel behind)
  or held (the guest's rate) with its tic (`HostLink.onDrop`), at a joined page the frames missed before one, counted by
  the tics between its tic and the last frame's past the tics it ran (`GuestLink.onDrop`, `lastTic`). Neither archived,
  as Quake's were not; both in the console's list for Tab. `test:net` sees either end told each message with its kind
  and size, the host told a frame dropped and one held at their tics, the guest the frame it missed at the next;
  `test:settings` the two; `test:console` shown, set, refused, cvarlist, left out of config.cfg, Tab; the browser test
  reads the frames received and the commands sent at the joined page, the frames held at the host at a rate of 25000
  and the frames missed at the guest, on both builds.
- **The pad's `joy_*` cvars**: done. `joy_forwardthreshold`, `joy_sidethreshold`, `joy_pitchthreshold` and
  `joy_yawthreshold` are each stick axis's dead zone, of its throw (0.15, as `IN_JoyMove` had them; the one dead zone
  was 0.2), and `joy_forwardsensitivity`, `joy_sidesensitivity`, `joy_pitchsensitivity` and `joy_yawsensitivity`
  each axis's speed, with Quake's signs (-1 forward, side and yaw, 1 pitch: the move and the turn as the standard
  mapping points them, the side axis taken negated as the Windows joystick's x was; 2 doubles a stick, the other
  sign turns it, the result clamped to full throw). `gamepad.js`'s `JOY` and `readPad`'s third argument, `Input.joy`
  from the settings on every change; none archived, as Quake's were not; all in the console's list for Tab. There is
  no up axis (A jumps, B crouches), so `joy_upthreshold` and `joy_upsensitivity` are left out. `test:input` holds a
  stick inside its threshold still and the pitch past its own looking, a sensitivity scaling and turning each axis,
  the Input's joy reaching both pads; `test:settings` the eight within their ranges; `test:console` shown, set,
  refused, cvarlist with them, left out of config.cfg, Tab; the browser test sets a threshold and a sensitivity and
  reads them on the settings and the input, and the defaults back, on both builds.
- **`s_mixahead` and `s_testsound`**: done. `s_mixahead` is `S_Update`'s lead, how far past the clock the mixer painted
  (0.2 for a DMA): here how far ahead of the clock the raw stream's samples, a cinematic's, are queued when they start
  or have fallen behind (`Q2Audio.mixahead`; 0.05, a frame's worth, where the browser schedules the one-shots itself);
  archived as Quake's was. `s_testsound 1` is `S_TransferPaintBuffer`'s fixed sine in place of the mix: an oscillator at
  0.1 radians a sample of the mixer's rate (351 Hz at 22050), 20000 of 32768, into the output with the sounds' gain
  muted while it plays and back at the volume after (`setTestsound`, remembered for the first start); not archived.
  Both in the console's list for Tab. `test:audio` sees the raw stream queued 0.05 s ahead and 0.3 s at the cvar, the
  tone made at the rate's frequency and gain with the mix muted, the volume set meanwhile kept, and the mix back when
  off; `test:settings` the two; `test:console` shown, set, refused, cvarlist, config.cfg with s_mixahead and without
  s_testsound, Tab; the browser test sets the lead and plays the tone, the mix muted and back, on both builds.
- **`sw_aliasstats`, `sw_polymodelstats`, `sw_reportsurfout`, `sw_reportedgeout` and `z_stats`**: the painter's
  reports (the models drawn and their triangles a frame, the surfaces and edges past the limits) and the memory in use
  (the engine's heap, the page's).

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
