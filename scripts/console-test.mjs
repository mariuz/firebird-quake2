// console-test.mjs – the console line headless (src/console.js): the page's own commands reach the host,
// the rest reach player_command, the history steps and forgets as Key_Console's did, Tab completes.
//   node scripts/console-test.mjs

import { Console, COMMANDS, writeConfig, dirList } from '../src/console.js';
import { Notify, CenterPrint } from '../src/notify.js';
import { ACTIONS, defaultBinds } from '../src/input.js';

let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

const calls = [];
const status = [];
const host = {
  db: { query: async (sql, params = []) => { calls.push(['query', sql.slice(0, 40), ...params]); return { rows: [{ S: 12345, R: 999 }] }; } },
  pak: { has: (p) => p === 'maps/demo2.bsp' || p === 'pics/victory.pcx', list: () => ['maps/demo1.bsp', 'maps/demo2.bsp', 'pics/conchars.pcx', 'sound/weapons/blastf1a.wav', 'readme.txt'] },
  settings: { fov: 90, skill: 1, detail: 'high', renderer: 'fast', binds: defaultBinds(), lines: {}, name: '', hand: 0, gender: 'male', msg: 1, password: '', spectatorPassword: '', sensitivity: 7, alwaysRun: true, invertMouse: false, freelook: true, lookspring: false, lookstrafe: false, mForward: 1, mSide: 1, mFilter: false, crosshair: 1, clAddEntities: true, clAddParticles: true, clAddLights: true, clAddBlend: true, clTestentities: false, clTestparticles: false, clTestlights: false, clTestblend: false, sfx: 70, music: 50, cdLoopcount: 4, cdLooptrack: 11, cdNocd: false, netgraph: false, timegraph: false, debuggraph: false, graphheight: 32, graphscale: 1, graphshift: 0, clPredict: true, clShowmiss: false, viewsize: 100, rFullbright: false, rDrawentities: true, rDrawworld: true, rLerpmodels: true, rNovis: false, rSpeeds: false, hostSpeeds: false, swDrawflat: false, swWaterwarp: true, swClearcolor: 0, swMipcap: 0, swMipscale: 1, swStipplealpha: false, developer: false, logfile: false, logStats: false, svNoreload: false, sShow: false, inJoystick: true, mYaw: 0.022, clGun: true, conNotifytime: 3, clYawspeed: 140, clPitchspeed: 150, clAnglespeedkey: 1.5, clForwardspeed: 200, clSidespeed: 200, clUpspeed: 200, timeout: 125, clTimeout: 120, gunX: 0, gunY: 0, gunZ: 0, scrCentertime: 2.5, clFootsteps: true, scrShowpause: true, scrShowturtle: false, clMaxfps: 90, brightness: 1.4, hostname: '', coop: false, deathmatch: false, players: 2 },
  setSetting: (k, v) => { host.settings[k] = v; calls.push(['set', k, String(v)]); },
  saveSettings: () => calls.push(['saveSettings']),
  setSkill: (n) => calls.push(['setSkill', n]),
  setStatus: (msg, isError = false) => status.push([msg, isError]),
  startMap: async (name) => calls.push(['startMap', name]),
  setView: async (fov) => calls.push(['setView', fov]),
  saveGame: async () => calls.push(['saveGame']),
  loadGame: async () => calls.push(['loadGame']),
  toggleInventory: () => calls.push(['inven']),
  isRunning: () => running,
  playDemo: async (name) => calls.push(['playDemo', name]),
};
let running = true;
const con = new Console(host);
const last = () => calls[calls.length - 1]?.join(' ');

await con.submit('map demo2');
check(last() === 'startMap demo2', 'map <name> starts the map');
await con.submit('map nowhere');
check(status.at(-1)?.[0] === 'no map "nowhere" in this pak' && status.at(-1)?.[1] === true && last() === 'startMap demo2', 'a map not in the pak is refused with a message, nothing started');
// map with a map string (a spawn point, a picture or a cinematic, "+" what follows), gamemap keeping the level, nextserver
{
  const strings = [];
  host.mapString = (t) => { strings.push(`map ${t}`); return true; };
  host.gameMap = (t) => { strings.push(`gamemap ${t}`); return true; };
  let next = '';
  host.nextServer = (t) => { if (t != null) next = t; return next; };
  await con.submit('map demo2$start'); await con.submit('map victory.pcx+demo2'); await con.submit('map *demo2');
  check(strings.join('|') === 'map demo2$start|map victory.pcx+demo2|map *demo2' && last() === 'startMap demo2', `a spawn point, a picture with what follows, or a unit's end go through the page as a string (${strings.join('|')})`);
  await con.submit('map nosuch.pcx+demo2'); await con.submit('map ntro.cin+demo2'); await con.submit('map nowhere$start');
  check(strings.length === 3 && status.at(-3)?.[0] === 'no picture "nosuch.pcx" in this pak' && status.at(-2)?.[0] === 'no cinematic "ntro.cin" in this pak' && status.at(-1)?.[0] === 'no map "nowhere" in this pak' && status.at(-1)?.[1] === true,
    'a picture, a cinematic or a map the pak lacks is refused');
  await con.submit('gamemap'); check(status.at(-1)?.[0] === 'usage: gamemap <map>' && status.at(-1)?.[1] === true, 'gamemap alone shows its usage');
  await con.submit('gamemap demo2'); await con.submit('GameMap *demo2$start');
  check(strings.slice(3).join('|') === 'gamemap demo2|gamemap *demo2$start', 'gamemap goes through the page with the string as typed, case aside');
  await con.submit('nextserver'); check(status.at(-1)?.[0] === '"nextserver" is ""', 'nextserver shows nothing to follow');
  await con.submit('nextserver demo2'); check(next === 'demo2' && status.at(-1)?.[0] === '"nextserver" is "demo2"', 'nextserver demo2 sets what follows');
  check(con.complete('gam') === 'gamemap ' && con.complete('nex') === 'nextserver ', 'Tab completes gamemap and nextserver');
  delete host.mapString; delete host.gameMap; delete host.nextServer;
}
await con.submit('fov');
check(status.at(-1)?.[0] === '"fov" is "90"', 'fov alone shows the fov');
await con.submit('fov 200');
check(host.settings.fov === 160 && last() === 'setView 160' && calls.some((c) => c[0] === 'saveSettings'), 'fov 200 clamps to 160, saves the setting and sets the view');
await con.submit('fov abc');
check(host.settings.fov === 160 && status.at(-1)?.[0] === '"fov" is "160"', 'a fov that is not a number shows the fov');
await con.submit('seed');
check(status.at(-1)?.[0] === 'seed 12345 (the generator is at 999)', 'seed alone shows the game\'s seed and the generator\'s state');
await con.submit('seed 42');
const seeded = calls.at(-1);
check(seeded[0] === 'query' && seeded[1].startsWith("SELECT RDB$SET_CONTEXT('USER_SESSION'") && seeded[2] === 42 && status.at(-1)?.[0] === 'the next new game starts from seed 42', 'seed 42 seeds the next new game');
await con.submit('seed x');
check(status.at(-1)?.[0] === 'seed takes a number' && status.at(-1)?.[1] === true, 'seed x is refused');
// the skill cvar: shown, set for the next game (latched: a game running keeps its own), clamped to 0..3, nightmare being 3
await con.submit('skill');
check(status.at(-1)?.[0] === '"skill" is "1"', 'skill alone shows the skill');
await con.submit('skill 3');
check(host.settings.skill === 3 && last() === 'setSkill 3' && calls.at(-2)?.[0] === 'saveSettings' && status.at(-1)?.[0] === 'skill will be changed for next game.',
  'skill 3 sets nightmare for the next game, kept in the settings and shown on the page, with Quake\'s latched-cvar notice');
await con.submit('skill 9');
check(host.settings.skill === 3 && last() === 'setSkill 3', 'skill 9 clamps to 3');
await con.submit('skill -1');
check(host.settings.skill === 0 && last() === 'setSkill 0', 'skill -1 clamps to 0');
await con.submit('skill x');
check(host.settings.skill === 0 && status.at(-1)?.[0] === 'skill takes a number: 0 easy, 1 medium, 2 hard, 3 nightmare' && status.at(-1)?.[1] === true, 'skill x is refused');
running = false;
await con.submit('skill 2');
check(host.settings.skill === 2 && status.at(-1)?.[0] === '"skill" is "2"', 'with no game running, the skill is set at once');
running = true;
await con.submit('save'); check(last() === 'saveGame', 'save saves');
await con.submit('load'); check(last() === 'loadGame', 'load loads');
await con.submit('inven'); check(last() === 'inven', 'inven toggles the inventory');
await con.submit('give all');
check(last() === 'query SELECT msg FROM player_command(?, ?) give all', 'give all goes to player_command as (give, all)');
await con.submit('GOD');
check(last() === 'query SELECT msg FROM player_command(?, ?) GOD ', 'a command in capitals goes as typed, the game lower-cases');
running = false;
const n = calls.length;
await con.submit('noclip');
check(calls.length === n, 'with no game running, a game command does nothing');
running = true;
// record and stop: CL_Record_f's and CL_Stop_f's words, the name cleaned, a demo recorded this session playable by demomap
let recording = false;
host.record = async (name) => { calls.push(['record', name]); recording = true; };
host.stopRecord = async () => { calls.push(['stopRecord']); recording = false; };
host.isRecording = () => recording;
host.hasDemo = (name) => name === 'q2demo1' || name === 'mine';
await con.submit('record');
check(status.at(-1)?.[0] === 'record <demoname>' && status.at(-1)?.[1] === true && !recording, 'record alone asks for a name');
await con.submit('stop');
check(status.at(-1)?.[0] === 'Not recording a demo.' && last() !== 'stopRecord', 'stop with no recording says so');
await con.submit('record My Run.dm2');
check(last() === 'record myrun' && recording, 'record <name> starts a recording under a cleaned name (lower case, letters, digits, - and _)');
await con.submit('record again');
check(status.at(-1)?.[0] === 'Already recording.' && last() === 'record myrun', 'a second record is refused while one runs');
await con.submit('stop');
check(last() === 'stopRecord' && !recording, 'stop ends it');
running = false;
await con.submit('record x');
check(status.at(-1)?.[0] === 'You must be in a level to record.' && last() === 'stopRecord', 'with no game running, record is refused');
running = true;
await con.submit('demomap mine');
check(last() === 'playDemo mine', 'demomap plays a demo recorded this session, which the host knows by name');
// timedemo and screenshot: CL_Timedemo_f's and SCR_ScreenShot_f's words
host.timedemo = async (name) => calls.push(['timedemo', name]);
host.screenshot = () => calls.push(['screenshot']);
await con.submit('timedemo Q2Demo1.dm2');
check(last() === 'timedemo q2demo1', 'timedemo plays a demo as a timedemo (the name lower-cased, .dm2 off)');
await con.submit('timedemo nosuch');
check(status.at(-1)?.[0] === 'no demo "nosuch" in this pak' && status.at(-1)?.[1] === true && last() === 'timedemo q2demo1', 'a demo not to be had is refused');
await con.submit('screenshot');
check(last() === 'screenshot', 'screenshot takes the view');
// viewpos and timerefresh: V_Viewpos_f's line (whole numbers) and SCR_TimeRefresh_f's "seconds (fps)", an argument without page flipping
host.viewPos = () => ({ x: 100.7, y: -200.2, z: 30.5, yaw: 89.9 });
await con.submit('viewpos'); check(status.at(-1)?.[0] === '(100 -200 30) : 89', 'viewpos says the eye and the yaw as whole numbers');
host.viewPos = () => null;
await con.submit('viewpos'); check(status.at(-1)?.[0] === 'viewpos: nothing is on the view' && status.at(-1)?.[1] === true, 'and nothing without a view');
let flipped = null;
host.timeRefresh = async (flip) => { flipped = flip; return { seconds: 0.512, fps: 128 / 0.512 }; };
await con.submit('timerefresh'); check(flipped === true && status.at(-1)?.[0] === '0.512000 seconds (250.000000 fps)', 'timerefresh spins the view and says the seconds and the frames a second');
await con.submit('timerefresh 1'); check(flipped === false, 'timerefresh 1 runs without page flipping');
host.timeRefresh = async () => null;
await con.submit('timerefresh'); check(status.at(-1)?.[1] === true, 'refused without a game of this page\'s own');
check(con.complete('timer') === 'timerefresh ' && con.complete('viewp') === 'viewpos ', 'Tab completes the two');
// play, stopsound and soundinfo: S_Play's words with .wav added, S_StopAllSounds, S_SoundInfo_f's lines
const played = [];
host.playSound = (name) => { played.push(name); return name !== 'nope/missing.wav'; };
host.stopSounds = () => calls.push(['stopsound']);
host.soundInfo = () => ({ started: true, rate: 44100, stereo: 1, decoded: 12, playing: 2, loops: 3 });
let sprinted = null;
host.print = (text) => { sprinted = text; };
await con.submit('play weapons/blastf1a Misc/Menu1.wav');
check(played.join('|') === 'weapons/blastf1a.wav|misc/menu1.wav' && status.at(-1)?.[0] === 'playing weapons/blastf1a.wav, misc/menu1.wav', 'play plays each word as a pak sound, .wav added to one without a dot, lower-cased');
await con.submit('play nope/missing');
check(status.at(-1)?.[0] === 'play: no nope/missing.wav in the pak' && status.at(-1)?.[1] === true, 'a sound the pak lacks is named');
await con.submit('play'); check(status.at(-1)?.[1] === true, 'play alone says what it takes');
await con.submit('stopsound'); check(last() === 'stopsound' && status.at(-1)?.[0] === 'sounds stopped', 'stopsound cuts every sound through the page');
await con.submit('soundinfo');
check(sprinted === '44100 speed\n    1 stereo\n   12 sounds decoded\n    2 playing\n    3 looping' && status.at(-1)?.[0] === 'sound: 44100 Hz stereo, 12 decoded, 2 playing, 3 looping', 'soundinfo lays the figures out as S_SoundInfo_f did and sums them on the line');
host.soundInfo = () => ({ started: false });
await con.submit('soundinfo'); check(status.at(-1)?.[0] === 'sound system not started' && status.at(-1)?.[1] === true, 'before the context exists, "sound system not started"');
check(con.complete('pla') === 'play ' && con.complete('soundi') === 'soundinfo ' && con.complete('stops') === 'stopsound ', 'Tab completes the three');
// say and say_team: Cmd_Say_f's words, as typed
host.say = async (text) => calls.push(['say', text]);
await con.submit('say Hello, World!');
check(last() === 'say Hello, World!', 'say sends the words as typed, their case kept');
await con.submit('say_team go  left');
check(last() === 'say go left', 'say_team says too (no teams here), the spaces one');
await con.submit('say');
check(status.at(-1)?.[0] === 'say <text>' && status.at(-1)?.[1] === true && last() === 'say go left', 'say alone shows its usage');
running = false;
await con.submit('say nobody');
check(last() === 'say go left', 'with no game running, nothing is said');
running = true;
running = false;
await con.submit('screenshot');
check(!calls.slice(-1).some((c) => c[0] === 'screenshot' && calls.indexOf(c) > 0 && calls.at(-2)?.[0] !== 'say') && last() === 'say go left' && status.at(-1)?.[0] === 'screenshot: nothing is on the view' && status.at(-1)?.[1] === true, 'with nothing on the view it is refused');
running = true;
// demos and deldemo: the page's own, for the recordings kept across reloads (src/demostore.js)
const keptDemos = ['mine', 'run'];
host.listDemos = () => ({ pak: ['q2demo1'], kept: [...keptDemos] });
host.dropDemo = async (name) => { calls.push(['dropDemo', name]); const i = keptDemos.indexOf(name); if (i < 0) return false; keptDemos.splice(i, 1); return true; };
await con.submit('demos');
check(status.at(-1)?.[0] === 'demos: q2demo1; recorded: mine, run' && status.at(-1)?.[1] === false, 'demos lists the pak\'s and the recordings kept');
await con.submit('deldemo');
check(status.at(-1)?.[0] === 'deldemo <demoname>' && status.at(-1)?.[1] === true, 'deldemo alone asks for a name');
await con.submit('deldemo Run.dm2');
check(last() === 'dropDemo run' && keptDemos.join() === 'mine' && status.at(-1)?.[0] === 'run dropped', 'deldemo <name> drops a kept recording (the name lower-cased, .dm2 off)');
await con.submit('deldemo run');
check(status.at(-1)?.[0] === 'no recording "run"' && status.at(-1)?.[1] === true, 'one not kept is refused');
await con.submit('demos');
check(status.at(-1)?.[0] === 'demos: q2demo1; recorded: mine', 'and the list says so');
// a joined page: the game commands go to the host (forward true), not to this page's idle database
{
  const forwarded = [];
  let joined = true;
  host.forward = (c, a) => { if (!joined) return false; forwarded.push([c, a]); return true; };
  const n = calls.length;
  await con.submit('give all');
  check(forwarded.length === 1 && forwarded[0].join(' ') === 'give all' && calls.length === n, 'joined, give all goes to the host and not to the database here');
  joined = false;
  await con.submit('god');
  check(forwarded.length === 1 && calls.length === n + 1 && last().startsWith('query SELECT msg FROM player_command'), 'alone, it runs here');
  delete host.forward;
}
host.db.query = async () => { throw new Error('boom'); };
await con.submit('kill');
check(status.at(-1)?.[0] === 'kill: boom' && status.at(-1)?.[1] === true, 'an error from the game is shown with the command');

// spectator: 3.20's userinfo for a joined page (null from the host: this page has not joined)
let spectating = 0, joined = false;
host.setSpectator = (on) => { if (!joined) return null; if (on !== null && on !== undefined) spectating = on ? 1 : 0; return spectating; };
await con.submit('spectator 1');
check(status.at(-1)?.[0] === 'spectator: only a page that has joined a game can watch' && status.at(-1)?.[1] === true, 'a page that has not joined cannot watch');
joined = true;
await con.submit('spectator');
check(status.at(-1)?.[0] === '"spectator" is "0"', 'spectator alone shows it');
await con.submit('spectator 1');
check(spectating === 1 && status.at(-1)?.[0] === 'spectator: watching', 'spectator 1 watches');
await con.submit('spectator x');
check(spectating === 1 && status.at(-1)?.[0] === 'spectator takes 0 or 1' && status.at(-1)?.[1] === true, 'anything but a number is refused');
await con.submit('spectator 0');
check(spectating === 0 && status.at(-1)?.[0] === 'spectator: playing again', 'spectator 0 plays again');

// players and kick: SV_Status_f's list of the clients and what drives each, SV_Kick_f dropping a guest by its client number
{
  let rows = null, kicked = [];
  host.listPlayers = () => rows;
  host.kick = (n) => { if (rows === 'guest' || !rows?.some((r) => r.kind === 'guest')) return 'not-hosting'; const r = rows.find((x) => x.num === n && x.kind === 'guest'); if (!r) return 'none'; kicked.push(n); return r.name; };
  await con.submit('players');
  check(status.at(-1)?.[0] === 'players: no game is running' && status.at(-1)?.[1] === true, 'players with no game says so');
  rows = 'guest';
  await con.submit('players');
  check(status.at(-1)?.[0] === 'players: the host lists them' && status.at(-1)?.[1] === true, 'on a joined page, the host lists them');
  await con.submit('kick 2');
  check(kicked.length === 0 && status.at(-1)?.[0] === 'kick: only the host of a game over the network can kick' && status.at(-1)?.[1] === true, 'kick on a page that does not host is refused');
  rows = [{ num: 1, name: 'Ace', kind: 'page' }, { num: 2, name: 'Rimmer', kind: 'guest', sent: 120, dropped: 3, ping: 37, spectator: true }, { num: 3, name: 'player 3', kind: 'guest', sent: 40, dropped: 0, ping: null, spectator: false }, { num: 4, name: 'player 4', kind: 'standing' }];
  await con.submit('players');
  check(status.at(-1)?.[0] === '1 Ace (this page) · 2 Rimmer (guest: 120 frames sent, 3 dropped, ping 37 ms, watching) · 3 player 3 (guest: 40 frames sent) · 4 player 4 (standing)' && status.at(-1)?.[1] === false,
    'players lists every client with its number, name and what drives it, a guest with its frames sent and dropped, its ping once measured, and whether it watches');
  await con.submit('kick');
  check(status.at(-1)?.[0] === 'Usage: kick <userid>' && status.at(-1)?.[1] === true, 'kick alone shows its usage, as SV_Kick_f did');
  await con.submit('kick x');
  check(status.at(-1)?.[0] === 'Usage: kick <userid>' && kicked.length === 0, 'kick with no number too');
  await con.submit('kick 4');
  check(status.at(-1)?.[0] === 'Bad user id: no guest drives client 4' && status.at(-1)?.[1] === true && kicked.length === 0, 'a client no guest drives is a bad user id');
  await con.submit('kick 2');
  check(kicked.join() === '2' && status.at(-1)?.[0] === 'Rimmer was kicked' && status.at(-1)?.[1] === false, 'kick 2 drops the guest and says who was kicked');
  rows = [{ num: 1, name: 'player 1', kind: 'page' }, { num: 2, name: 'player 2', kind: 'pad' }];
  await con.submit('players');
  check(status.at(-1)?.[0] === '1 player 1 (this page) · 2 player 2 (a pad)', 'a coop game at one page lists the pad\'s player');
  check(con.complete('pl') === 'play ' && con.complete('playe') === 'players ' && con.complete('ki') === 'kick ', 'Tab completes play, players and kick');
  // dumpuser: SV_DumpUser_f's print of a client's userinfo as Info_Print laid it out, in the scrollback, the sum on the line
  let dumped = null;
  const printBefore = host.print;
  host.print = (t) => { dumped = t; };
  let users = 'none';
  host.dumpUser = (n) => (typeof users === 'string' ? users : n < 1 || n > 4 ? 'slot' : users[n] ?? 'inactive');
  await con.submit('dumpuser');
  check(status.at(-1)?.[0] === 'Usage: dumpuser <userid>' && status.at(-1)?.[1] === true, 'dumpuser alone shows its usage');
  await con.submit('dumpuser 1');
  check(status.at(-1)?.[0] === 'dumpuser: no game is running' && status.at(-1)?.[1] === true && dumped === null, 'with no game it says so');
  users = 'guest';
  await con.submit('dumpuser 1');
  check(status.at(-1)?.[0] === 'dumpuser: the host has the userinfos' && status.at(-1)?.[1] === true, 'a joined page is sent to the host');
  users = { 1: { name: 'Ace', hand: 1, gender: 'female', msg: 1, fov: 90, spectator: 0 }, 2: { name: '', hand: 0 } };
  await con.submit('dumpuser 1');
  check(dumped === 'userinfo\n--------\nname                Ace\nhand                1\ngender              female\nmsg                 1\nfov                 90\nspectator           0'
    && status.at(-1)?.[0] === 'client 1: name "Ace" · hand "1" · gender "female" · msg "1" · fov "90" · spectator "0"' && status.at(-1)?.[1] === false,
    'dumpuser 1 prints the client\'s userinfo, each key on twenty characters, and sums it on the line');
  await con.submit('dumpuser 2');
  check(dumped === 'userinfo\n--------\nname                \nhand                0', 'a pad\'s player has its row\'s name and hand');
  await con.submit('dumpuser 3');
  check(status.at(-1)?.[0] === 'Client 3 is not active' && status.at(-1)?.[1] === true, 'a client not in the game is not active');
  await con.submit('dumpuser 7');
  check(status.at(-1)?.[0] === 'Bad client slot: 7' && status.at(-1)?.[1] === true && con.complete('dump') === 'dumpuser ', 'a number past the clients is a bad slot; Tab completes dumpuser');
  host.print = printBefore; delete host.dumpUser;
  delete host.listPlayers; delete host.kick;
}

// the menus from the console (M_Init's commands): each menu_* word opens its menu through the host, so a key bound to one opens it
{
  const opened = []; let menusReady = false;
  host.openMenu = (name) => { if (!menusReady) return false; opened.push(name); return true; };
  await con.submit('menu_options');
  check(opened.length === 0 && status.at(-1)?.[0] === 'menu_options: the menus wait on the pak' && status.at(-1)?.[1] === true, 'before the pak is in, a menu word says the menus wait');
  menusReady = true;
  for (const w of ['menu_main', 'menu_game', 'menu_loadgame', 'menu_savegame', 'menu_options', 'menu_keys', 'menu_video', 'menu_multiplayer', 'menu_playerconfig', 'menu_credits', 'menu_quit', 'menu_dmoptions', 'menu_startserver', 'menu_joinserver', 'menu_addressbook']) await con.submit(w);
  check(opened.join() === 'main,game,loadgame,savegame,options,keys,video,multiplayer,playerconfig,credits,quit,dmoptions,startserver,joinserver,addressbook', `the fifteen menu words open their menus (${opened.join(', ')})`);
  await con.submit('MENU_KEYS');
  check(opened.at(-1) === 'keys' && con.complete('menu_') === 'menu_addressbook ' && con.complete('menu_o') === 'menu_options ', 'case aside, and Tab completes them');
  delete host.openMenu;
}

// connect, disconnect and reconnect: Join with a code or an offer, Leave, and the last host joined again (CL_Connect_f,
// CL_Disconnect_f, CL_Reconnect_f over the page's buttons)
{
  const joins = []; let inGame = false, last = '', pakIn = true;
  host.connect = async (t) => { if (!pakIn) return false; joins.push(t); last = t; inGame = true; return true; };
  host.disconnect = () => { const was = inGame; inGame = false; return was; };
  host.reconnect = async () => host.connect(last);
  host.lastConnect = () => last;
  await con.submit('connect');
  check(status.at(-1)?.[0] === 'usage: connect <code or offer>' && status.at(-1)?.[1] === true && joins.length === 0, 'connect alone shows its usage');
  await con.submit('reconnect');
  check(status.at(-1)?.[0] === 'reconnect: this page has not joined a game yet' && status.at(-1)?.[1] === true, 'reconnect with nothing joined says so');
  await con.submit('disconnect');
  check(status.at(-1)?.[0] === 'not connected' && status.at(-1)?.[1] === true, 'disconnect with no connection says so');
  pakIn = false;
  await con.submit('connect K9H2');
  check(status.at(-1)?.[0] === 'connect: no pak is loaded yet' && status.at(-1)?.[1] === true && joins.length === 0, 'connect before the pak is loaded is refused');
  pakIn = true;
  await con.submit('connect k9h2');
  check(joins.join() === 'k9h2' && status.at(-1)?.[0] === 'connecting to k9h2' && status.at(-1)?.[1] === false, 'connect <code> joins with the code');
  await con.submit('disconnect');
  check(!inGame && status.at(-1)?.[0] === 'disconnected' && status.at(-1)?.[1] === false, 'disconnect leaves');
  await con.submit('reconnect');
  check(joins.join() === 'k9h2,k9h2' && inGame && status.at(-1)?.[0] === 'reconnecting to k9h2', 'reconnect joins the last host again');
  const offer = 'q2net1:' + 'A'.repeat(600);
  await con.submit(`connect ${offer}`);
  check(joins.at(-1) === offer && status.at(-1)?.[0] === 'connecting to q2net1:AAAAAAAAAAAAAAAAA…', 'connect <offer> takes an offer text, shown cut');
  check(con.complete('con') === 'con_notifytime ' && con.complete('cond') === 'condump ' && con.complete('conn') === 'connect ' && con.complete('dis') === 'disconnect ' && con.complete('rec') === 'reconnect ',
    'Tab completes con_notifytime, condump, connect, disconnect and reconnect (the alphabetical first each time, reconnect before record)');
  delete host.connect; delete host.disconnect; delete host.reconnect; delete host.lastConnect;
}

// rtc_ice: the ICE server for the next network game, kept in the settings; shown, set, refused, cleared
host.settings.rtcIce = '';
await con.submit('rtc_ice');
check(status.at(-1)?.[0] === '"rtc_ice" is "none"', 'rtc_ice alone shows none');
await con.submit('rtc_ice turn:relay.example.org:3478   ace secret');
check(host.settings.rtcIce === 'turn:relay.example.org:3478 ace secret' && last() === 'saveSettings' && status.at(-1)?.[0] === 'rtc_ice: turn:relay.example.org:3478 for the next network game',
  'rtc_ice <url> <user> <pass> keeps the server in the settings, the words one space apart');
await con.submit('rtc_ice');
check(status.at(-1)?.[0] === '"rtc_ice" is "turn:relay.example.org:3478 ace secret"', 'and shows it');
await con.submit('rtc_ice turn:relay.example.org:3478 ace');
check(host.settings.rtcIce === 'turn:relay.example.org:3478 ace secret' && status.at(-1)?.[0] === 'rtc_ice: rtc_ice takes a url, or a url, a user and a password' && status.at(-1)?.[1] === true, 'a url with a user and no password is refused, the setting as it was');
await con.submit('rtc_ice http://relay');
check(host.settings.rtcIce === 'turn:relay.example.org:3478 ace secret' && status.at(-1)?.[1] === true, 'another scheme is refused');
await con.submit('rtc_ice none');
check(host.settings.rtcIce === '' && status.at(-1)?.[0] === 'rtc_ice: the STUN server alone', 'rtc_ice none clears it');
// rtc_signal: the relay the network game's texts go through under a code (scripts/signal.mjs), kept in the settings
host.settings.rtcSignal = '';
await con.submit('rtc_signal');
check(status.at(-1)?.[0] === '"rtc_signal" is "none"', 'rtc_signal alone shows none');
await con.submit('rtc_signal http://relay.example.org:8787/');
check(host.settings.rtcSignal === 'http://relay.example.org:8787' && last() === 'saveSettings' && status.at(-1)?.[0] === 'rtc_signal: http://relay.example.org:8787 for the next network game',
  'rtc_signal <url> keeps the relay in the settings, a trailing slash off');
await con.submit('rtc_signal ws://relay');
check(host.settings.rtcSignal === 'http://relay.example.org:8787' && status.at(-1)?.[0] === "rtc_signal takes the relay's http(s) url" && status.at(-1)?.[1] === true, 'another scheme is refused, the setting as it was');
await con.submit('rtc_signal none');
check(host.settings.rtcSignal === '' && status.at(-1)?.[0] === 'rtc_signal: the offer and the answer as texts', 'rtc_signal none clears it');

// the settings as cvars (Cvar_Command): shown alone, set with a word through the page's setSetting, refused with the range
const s = host.settings;
await con.submit('sensitivity');
check(status.at(-1)?.[0] === '"sensitivity" is "7"', 'sensitivity alone shows it');
await con.submit('sensitivity 5.5');
check(s.sensitivity === 5.5 && last() === 'set sensitivity 5.5' && status.at(-1)?.[0] === '"sensitivity" is "5.5"', 'sensitivity 5.5 sets it through the page, shown back');
await con.submit('sensitivity 99');
check(s.sensitivity === 20, 'clamped to 20');
await con.submit('sensitivity x');
check(s.sensitivity === 20 && status.at(-1)?.[0] === 'sensitivity takes 1 to 20' && status.at(-1)?.[1] === true, 'a word that is no number is refused with the range');
await con.submit('name Ace Rimmer');
check(s.name === 'Ace Rimmer' && last() === 'set name Ace Rimmer' && status.at(-1)?.[0] === '"name" is "Ace Rimmer"', 'name takes the words, case and spaces kept');
await con.submit('name sixteen chars...!');
check(s.name === 'Ace Rimmer' && status.at(-1)?.[1] === true, 'a name past fifteen characters is refused');
await con.submit('name ""');
check(s.name === '', 'name "" clears it');
await con.submit('hand 2'); check(s.hand === 2, 'hand 2 is centre-handed');
await con.submit('hand 3'); check(s.hand === 2 && status.at(-1)?.[0] === 'hand takes 0 right, 1 left, 2 center', 'hand 3 is refused');
await con.submit('cl_run 0'); check(s.alwaysRun === false && status.at(-1)?.[0] === '"cl_run" is "0"', 'cl_run 0 walks');
await con.submit('cl_run 1'); check(s.alwaysRun === true, 'cl_run 1 runs');
await con.submit('m_pitch'); check(status.at(-1)?.[0] === '"m_pitch" is "0.022"', 'm_pitch shows 0.022 with the mouse not inverted');
await con.submit('m_pitch -0.022'); check(s.invertMouse === true && status.at(-1)?.[0] === '"m_pitch" is "-0.022"', 'a negative m_pitch inverts the mouse');
await con.submit('m_pitch 0.022'); check(s.invertMouse === false, 'a positive one puts it back');
await con.submit('m_pitch 0'); check(s.invertMouse === false && status.at(-1)?.[1] === true, 'm_pitch 0 is refused');
// password (the network game's, a guest's userinfo and the host's requirement) and spectator_password (a watcher's)
await con.submit('password'); check(status.at(-1)?.[0] === '"password" is ""', 'password shows none by default');
await con.submit('password secret'); check(s.password === 'secret' && last() === 'set password secret', 'password secret sets it through the page (a guest\'s info carries it, the host requires it)');
await con.submit('password two words'); check(s.password === 'secret' && status.at(-1)?.[0] === 'password takes at most 32 characters, no spaces' && status.at(-1)?.[1] === true, 'a password with a space is refused');
await con.submit('spectator_password watch'); check(s.spectatorPassword === 'watch', 'spectator_password watch sets the watchers\' one');
await con.submit('password ""'); await con.submit('spectator_password ""'); check(s.password === '' && s.spectatorPassword === '', '"" clears them');
// the gender userinfo: a word (f… female, m… male, else neutral), male by default, archived
await con.submit('gender'); check(status.at(-1)?.[0] === '"gender" is "male"', 'gender shows male by default');
await con.submit('gender Female'); check(s.gender === 'Female' && last() === 'set gender Female' && status.at(-1)?.[0] === '"gender" is "Female"', 'gender Female sets the word as typed through the page');
await con.submit('gender none'); check(s.gender === 'none', 'gender none is neutral');
await con.submit('gender "sixteen chars...!"'); check(s.gender === 'none' && status.at(-1)?.[0] === 'gender takes a word: male, female or none' && status.at(-1)?.[1] === true, 'a word past fifteen characters is refused');
await con.submit('gender male');
// the msg userinfo: the message level, 0 to 3, 1 by default (the low prints off), archived
await con.submit('msg'); check(status.at(-1)?.[0] === '"msg" is "1"', 'msg shows 1 by default');
await con.submit('msg 0'); check(s.msg === 0 && last() === 'set msg 0' && status.at(-1)?.[0] === '"msg" is "0"', 'msg 0 lets every print through, through the page');
await con.submit('msg 4'); check(s.msg === 0 && status.at(-1)?.[0] === 'msg takes 0 to 3' && status.at(-1)?.[1] === true, 'msg 4 is refused');
await con.submit('msg 1');
await con.submit('crosshair 3'); check(s.crosshair === 3, 'crosshair 3');
await con.submit('crosshair 4'); check(s.crosshair === 3 && status.at(-1)?.[1] === true, 'crosshair 4 is refused');
await con.submit('s_volume'); check(status.at(-1)?.[0] === '"s_volume" is "0.70"', 's_volume shows the effects volume as 0..1');
await con.submit('s_volume 0.25'); check(s.sfx === 25 && last() === 'set sfx 25', 's_volume 0.25 sets it as a percentage through the page');
await con.submit('cd_volume 2'); check(s.music === 100 && status.at(-1)?.[0] === '"cd_volume" is "1.00"', 'cd_volume clamps to 1');
// cd_loopcount, cd_looptrack and cd_nocd: the music's loop and none
await con.submit('cd_loopcount'); check(status.at(-1)?.[0] === '"cd_loopcount" is "4"', 'cd_loopcount shows 4 by default');
await con.submit('cd_loopcount 2'); check(s.cdLoopcount === 2 && last() === 'set cdLoopcount 2', 'cd_loopcount 2 plays the track twice before the loop track');
await con.submit('cd_loopcount 0'); check(s.cdLoopcount === 2 && status.at(-1)?.[1] === true, 'cd_loopcount 0 is refused');
await con.submit('cd_looptrack 3'); check(s.cdLooptrack === 3 && last() === 'set cdLooptrack 3', 'cd_looptrack 3 is the track after them');
await con.submit('cd_nocd 1'); check(s.cdNocd === true && last() === 'set cdNocd true', 'cd_nocd 1 plays no music');
await con.submit('cd_nocd 0'); await con.submit('cd_loopcount 4'); await con.submit('cd_looptrack 11');
// V_RenderView's switches and tests as cvars
await con.submit('cl_add_lights 0'); check(s.clAddLights === false && last() === 'set clAddLights false' && status.at(-1)?.[0] === '"cl_add_lights" is "0"', 'cl_add_lights 0 leaves the dynamic lights out, through the page');
await con.submit('cl_testlights 1'); check(s.clTestlights === true && last() === 'set clTestlights true', 'cl_testlights 1 adds V_TestLights\' ring');
await con.submit('cl_add_blend x'); check(s.clAddBlend === true && status.at(-1)?.[0] === 'cl_add_blend takes 0 or 1' && status.at(-1)?.[1] === true, 'cl_add_blend x is refused');
await con.submit('cl_add_entities'); check(status.at(-1)?.[0] === '"cl_add_entities" is "1"', 'cl_add_entities shows 1');
await con.submit('cl_add_lights 1'); await con.submit('cl_testlights 0');
check(con.complete('cl_add_e') === 'cl_add_entities ' && con.complete('cl_add_p') === 'cl_add_particles ' && con.complete('cl_add_l') === 'cl_add_lights ' && con.complete('cl_add_b') === 'cl_add_blend ' && con.complete('cl_teste') === 'cl_testentities ' && con.complete('cl_testp') === 'cl_testparticles ' && con.complete('cl_testl') === 'cl_testlights ' && con.complete('cl_testb') === 'cl_testblend ', 'Tab completes the eight');
// s_show: a setting as its cvar
await con.submit('s_show 1'); check(s.sShow === true && last() === 'set sShow true' && status.at(-1)?.[0] === '"s_show" is "1"', 's_show 1 prints the sounds started, through the page');
await con.submit('s_show 2'); check(s.sShow === true && status.at(-1)?.[0] === 's_show takes 0 or 1' && status.at(-1)?.[1] === true, 's_show 2 is refused');
await con.submit('s_show 0');
// the cd word (CD_f): its words through the page, the info laid out on the scrollback and summed on the line, an unknown word refused
{
  const asked = [];
  let info = { tracks: 11, state: 'Currently playing track 9', volume: 0.5, enabled: true };
  host.cd = (word, n) => { asked.push(`${word}${n == null ? '' : ` ${n}`}`); return word === 'info' ? info : word === 'nosuch' ? null : word === 'play' && n == null ? 'cd play <track>: a track number, 1 to 99' : `${word} done`; };
  let cdPrinted = null;
  const printBefore = host.print;
  host.print = (t) => { cdPrinted = t; };
  await con.submit('cd');
  check(asked.length === 0 && status.at(-1)?.[0] === 'cd play|loop <track> · stop · pause · resume · on · off · info' && status.at(-1)?.[1] === true, 'cd alone shows its words');
  await con.submit('cd play 9'); await con.submit('CD Loop 10'); await con.submit('cd stop'); await con.submit('cd pause'); await con.submit('cd resume'); await con.submit('cd on'); await con.submit('cd off');
  check(asked.join('|') === 'play 9|loop 10|stop|pause|resume|on|off' && status.at(-1)?.[0] === 'off done' && status.at(-1)?.[1] === false, 'cd play, loop (case aside), stop, pause, resume, on and off reach the page, which says what it did');
  await con.submit('cd play');
  check(status.at(-1)?.[0] === 'cd play <track>: a track number, 1 to 99' && status.at(-1)?.[1] === true, 'cd play without a number is told');
  await con.submit('cd nosuch');
  check(status.at(-1)?.[0] === 'cd: no "nosuch" (play, loop, stop, pause, resume, on, off, info)' && status.at(-1)?.[1] === true, 'an unknown word is refused');
  await con.submit('cd info');
  check(cdPrinted === '11 tracks\nCurrently playing track 9\nVolume is 0.500000' && status.at(-1)?.[0] === '11 tracks · Currently playing track 9 · volume 0.50', 'cd info prints the tracks, what plays and the volume as CD_f did, and sums them on the line');
  info = { tracks: 11, state: null, volume: 0.5, enabled: false };
  await con.submit('cd info');
  check(cdPrinted === '11 tracks\nVolume is 0.500000' && status.at(-1)?.[0] === '11 tracks · the cd is off · volume 0.50', 'off, nothing plays');
  check(con.complete('cd') === 'cd ' && con.complete('s_s') === 's_show ', 'Tab completes cd and s_show');
  host.print = printBefore; delete host.cd;
}
await con.submit('netgraph'); check(status.at(-1)?.[0] === '"netgraph" is "0"', 'netgraph shows 0 by default');
await con.submit('netgraph 1'); check(s.netgraph === true && last() === 'set netgraph true' && status.at(-1)?.[0] === '"netgraph" is "1"', 'netgraph 1 turns the graph on through the page');
await con.submit('netgraph 2'); check(s.netgraph === true && status.at(-1)?.[0] === 'netgraph takes 0 or 1' && status.at(-1)?.[1] === true, 'netgraph 2 is refused');
await con.submit('netgraph 0'); check(s.netgraph === false, 'netgraph 0 turns it off');
await con.submit('cvarlist');
check(/^name "" · hand "2" · gender "male" · msg "1" · sensitivity "20" · cl_run "1" · m_pitch "0.022" · crosshair "3" · s_volume "0.25" · cd_volume "1.00" · cd_loopcount "4" · cd_looptrack "11" · cd_nocd "0" · s_show "0" · freelook "1" · lookspring "0" · lookstrafe "0" · m_forward "1" · m_side "1" · m_filter "0" · in_joystick "1" · netgraph "0" · timegraph "0" · debuggraph "0" · graphheight "32" · graphscale "1" · graphshift "0" · cl_predict "1" · cl_showmiss "0" · viewsize "100" · r_fullbright "0" · cl_add_entities "1" · cl_add_particles "1" · cl_add_lights "1" · cl_add_blend "1" · cl_testentities "0" · cl_testparticles "0" · cl_testlights "0" · cl_testblend "0" · r_drawentities "1" · r_drawworld "1" · r_lerpmodels "1" · r_novis "0" · r_speeds "0" · host_speeds "0" · developer "0" · sv_noreload "0" · sw_drawflat "0" · sw_waterwarp "1" · sw_clearcolor "0" · sw_mipcap "0" · sw_mipscale "1" · sw_stipplealpha "0" · m_yaw "0.022" · cl_gun "1" · con_notifytime "3" · cl_yawspeed "140" · cl_pitchspeed "150" · cl_anglespeedkey "1.5" · cl_forwardspeed "200" · cl_sidespeed "200" · cl_upspeed "200" · timeout "125" · cl_timeout "120" · gun_x "0" · gun_y "0" · gun_z "0" · scr_centertime "2.5" · cl_footsteps "1" · scr_showpause "1" · scr_showturtle "0" · cl_maxfps "90" · vid_gamma "1.4" · hostname "" · password "" · spectator_password "" · fov "160" · skill "/.test(status.at(-1)?.[0] ?? ''), `cvarlist lists them with their values (${status.at(-1)?.[0]})`);
// hostname (the host's name, at most 32 printable characters), help (Cmd_Help_f) and sv_gravity (the game's gravity)
await con.submit('hostname'); check(status.at(-1)?.[0] === '"hostname" is ""', 'hostname shows the empty default');
await con.submit('hostname Hal 9000'); check(s.hostname === 'Hal 9000' && last() === 'set hostname Hal 9000', 'hostname takes a name with spaces');
await con.submit(`hostname ${'x'.repeat(33)}`); check(s.hostname === 'Hal 9000' && status.at(-1)?.[1] === true, 'a name past 32 characters is refused');
s.hostname = '';
let helped = 0;
host.toggleHelp = () => { helped++; };
await con.submit('help'); running = false; await con.submit('help'); running = true;
check(helped === 1, 'help brings the help computer in a game running, not without one');
let gravityNow = 800;
host.gravity = async () => gravityNow;
host.setGravity = async (n) => { gravityNow = n; };
await con.submit('sv_gravity'); check(status.at(-1)?.[0] === '"sv_gravity" is "800"', 'sv_gravity shows the game\'s gravity');
await con.submit('sv_gravity 300'); check(gravityNow === 300 && status.at(-1)?.[0] === '"sv_gravity" is "300"', 'sv_gravity 300 sets it through the page');
await con.submit('sv_gravity x'); check(gravityNow === 300 && status.at(-1)?.[1] === true, 'sv_gravity x is refused');
host.gravity = async () => null;
await con.submit('sv_gravity'); check(status.at(-1)?.[0] === 'sv_gravity: a joined page runs no server of its own, and a map must be running' && status.at(-1)?.[1] === true, 'sv_gravity on a joined page, or without a map, says so');
// p_view.c's cvars on the game row (bob_up, bob_pitch, bob_roll, run_pitch, run_roll, sv_rollangle, sv_rollspeed), as sv_gravity
{
  const gameRow = { bob_up: 0.005, bob_pitch: 0.002, bob_roll: 0.002, run_pitch: 0.002, run_roll: 0.005, sv_rollangle: 2, sv_rollspeed: 200, sv_maxvelocity: 2000, sv_airaccelerate: 0, g_select_empty: 0, flood_msgs: 4, flood_persecond: 4, flood_waitdelay: 10 };
  host.gameCvar = async (col) => gameRow[col] ?? null;
  host.setGameCvar = async (col, n) => { gameRow[col] = n; };
  await con.submit('bob_up'); check(status.at(-1)?.[0] === '"bob_up" is "0.005"', 'bob_up shows the game row\'s 0.005');
  await con.submit('bob_up 0'); check(gameRow.bob_up === 0 && status.at(-1)?.[0] === '"bob_up" is "0"', 'bob_up 0 sets it through the page');
  await con.submit('bob_up 2'); check(gameRow.bob_up === 0 && status.at(-1)?.[0] === 'bob_up takes a number from 0 to 1, 0.005 as Quake had it' && status.at(-1)?.[1] === true, 'bob_up 2 is refused');
  await con.submit('sv_rollangle 4'); await con.submit('sv_rollspeed 100'); await con.submit('run_roll 0.01'); await con.submit('run_pitch x');
  check(gameRow.sv_rollangle === 4 && gameRow.sv_rollspeed === 100 && gameRow.run_roll === 0.01 && gameRow.run_pitch === 0.002 && status.at(-1)?.[1] === true, 'sv_rollangle, sv_rollspeed and run_roll set, run_pitch x refused');
  await con.submit('bob_pitch'); await con.submit('bob_roll'); check(status.at(-2)?.[0] === '"bob_pitch" is "0.002"' && status.at(-1)?.[0] === '"bob_roll" is "0.002"', 'bob_pitch and bob_roll show theirs');
  await con.submit('sv_maxvelocity'); check(status.at(-1)?.[0] === '"sv_maxvelocity" is "2000"', 'sv_maxvelocity shows 2000');
  await con.submit('sv_airaccelerate 10'); await con.submit('g_select_empty 1'); await con.submit('sv_maxvelocity 500'); await con.submit('g_select_empty 2');
  check(gameRow.sv_airaccelerate === 10 && gameRow.g_select_empty === 1 && gameRow.sv_maxvelocity === 500 && status.at(-1)?.[0] === 'g_select_empty takes a number from 0 to 1, 0 as Quake had it' && status.at(-1)?.[1] === true, 'sv_airaccelerate, g_select_empty and sv_maxvelocity set on the game row, g_select_empty 2 refused');
  await con.submit('flood_msgs'); check(status.at(-1)?.[0] === '"flood_msgs" is "4"', 'flood_msgs shows the game row\'s 4');
  await con.submit('flood_waitdelay 20'); await con.submit('flood_persecond 2'); await con.submit('flood_msgs 11');
  check(gameRow.flood_waitdelay === 20 && gameRow.flood_persecond === 2 && gameRow.flood_msgs === 4 && status.at(-1)?.[0] === 'flood_msgs takes a number from 0 to 10, 4 as Quake had it' && status.at(-1)?.[1] === true,
    'flood_waitdelay and flood_persecond set on the game row, flood_msgs 11 refused (the ring holds ten)');
  check(con.complete('flood_m') === 'flood_msgs ' && con.complete('flood_p') === 'flood_persecond ' && con.complete('flood_w') === 'flood_waitdelay ', 'Tab completes the three');
  host.gameCvar = async () => null;
  await con.submit('bob_up'); check(status.at(-1)?.[0] === 'bob_up: a joined page runs no server of its own, and a map must be running' && status.at(-1)?.[1] === true, 'on a joined page, or without a map, refused');
  // sv_maplist (a text on the game row) and sky (SCR_Sky_f: the sky box, the rotation and the axis through the page)
  gameRow.sv_maplist = '';
  host.gameCvar = async (col) => gameRow[col] ?? null;
  let strSet = null;
  host.setGameString = async (col, text) => { strSet = [col, text]; gameRow[col] = text; };
  await con.submit('sv_maplist'); check(status.at(-1)?.[0] === '"sv_maplist" is ""', 'sv_maplist shows the empty list');
  await con.submit('sv_maplist demo1, demo2 demo3'); check(strSet?.join('|') === 'sv_maplist|demo1, demo2 demo3' && status.at(-1)?.[0] === '"sv_maplist" is "demo1, demo2 demo3"', 'sv_maplist sets the list on the game row as typed');
  await con.submit('sv_maplist ""'); check(gameRow.sv_maplist === '', 'sv_maplist "" clears it');
  await con.submit('sv_maplist a/b'); check(gameRow.sv_maplist === '' && status.at(-1)?.[1] === true, 'a list with other characters is refused');
  let skySet = null;
  host.setSky = (name, rotate, axis) => { skySet = [name, rotate, axis]; return name !== 'nosuch'; };
  await con.submit('sky'); check(status.at(-1)?.[0] === 'Usage: sky <basename> <rotate> <axis x y z>' && status.at(-1)?.[1] === true, 'sky alone says its usage');
  await con.submit('sky Unit1_'); check(skySet?.[0] === 'unit1_' && skySet[1] === 0 && skySet[2].join() === '0,0,1' && status.at(-1)?.[0] === 'sky unit1_', 'sky <name> sets the sky box, no turn, the axis up');
  await con.submit('sky unit1_ 10 0 1 0'); check(skySet[1] === 10 && skySet[2].join() === '0,1,0' && status.at(-1)?.[0] === 'sky unit1_, 10 degrees a second about 0 1 0', 'sky <name> <rotate> <axis x y z> spins it about the axis');
  await con.submit('sky nosuch'); check(status.at(-1)?.[0] === 'sky: no env/nosuch*.pcx in the pak' && status.at(-1)?.[1] === true, 'a sky the pak lacks is refused');
  host.setSky = () => null;
  await con.submit('sky unit1_'); check(status.at(-1)?.[0] === 'sky: a map must be running' && status.at(-1)?.[1] === true, 'and without a map');
  check(con.complete('sky') === 'sky ' && con.complete('sv_map') === 'sv_maplist ', 'Tab completes sky and sv_maplist');
  check(con.complete('bob') === 'bob_pitch ' && con.complete('run_') === 'run_pitch ' && con.complete('sv_r') === 'sv_rollangle ' && con.complete('sv_a') === 'sv_airaccelerate ' && con.complete('sv_max') === 'sv_maxvelocity ' && con.complete('g_') === 'g_select_empty ' && con.complete('weapn') === 'weapnext ' && con.complete('weapp') === 'weapprev ', 'Tab completes them, weapnext and weapprev too');
}
// deathmatch, coop and maxclients: the Players select's words, latched for the next game
{
  let mode = null;
  host.setGameMode = (m) => { mode = m; Object.assign(s, m); };
  await con.submit('deathmatch'); check(status.at(-1)?.[0] === '"deathmatch" is "0"', 'deathmatch shows 0 in single player');
  await con.submit('deathmatch 1');
  check(mode?.deathmatch === true && mode.coop === true && mode.players === 2 && status.at(-1)?.[0] === 'deathmatch will be changed for next game.', 'deathmatch 1 latches a deathmatch of two for the next game, as Quake said');
  await con.submit('maxclients 4'); check(mode?.players === 4 && mode.deathmatch === true && status.at(-1)?.[0] === 'maxclients will be changed for next game.', 'maxclients 4 makes it four');
  await con.submit('maxclients'); check(status.at(-1)?.[0] === '"maxclients" is "4"', 'and shows so');
  await con.submit('coop 1'); check(mode?.coop === true && mode.deathmatch === false && mode.players === 4, 'coop 1 makes it a coop game of the four');
  await con.submit('coop'); check(status.at(-1)?.[0] === '"coop" is "1"', 'coop shows 1');
  await con.submit('maxclients 1'); check(mode?.coop === false && mode.deathmatch === false, 'maxclients 1 is single player again');
  await con.submit('maxclients 9'); check(status.at(-1)?.[0] === 'maxclients takes 1 to 4' && status.at(-1)?.[1] === true, 'maxclients 9 is refused');
  await con.submit('coop 2'); check(status.at(-1)?.[0] === 'coop takes 0 or 1' && status.at(-1)?.[1] === true, 'coop 2 is refused');
  Object.assign(s, { coop: false, deathmatch: false, players: 2 });
}
// vid_gamma (the video menu's brightness) and vid_fullscreen (the page's live state, set through the page)
await con.submit('vid_gamma'); check(status.at(-1)?.[0] === '"vid_gamma" is "1.4"', 'vid_gamma shows the brightness, 1.4 by default');
await con.submit('vid_gamma 1.6'); check(s.brightness === 1.6 && last() === 'set brightness 1.6', 'vid_gamma 1.6 sets the brightness through the page');
await con.submit('vid_gamma 3'); check(s.brightness === 1.8, 'vid_gamma 3 clamps to the control\'s 1.8');
await con.submit('vid_gamma 1.23'); check(s.brightness === 1.2, 'vid_gamma 1.23 snaps to the control\'s tenths');
await con.submit('vid_gamma x'); check(s.brightness === 1.2 && status.at(-1)?.[0] === 'vid_gamma takes 1 to 1.8' && status.at(-1)?.[1] === true, 'vid_gamma x is refused');
s.brightness = 1.4;
let fullNow = false;
host.isFullscreen = () => fullNow;
await con.submit('vid_fullscreen'); check(status.at(-1)?.[0] === '"vid_fullscreen" is "0"', 'vid_fullscreen shows the page\'s state');
await con.submit('vid_fullscreen 1'); check(last() === 'set fullscreen true' && status.at(-1)?.[0] === '"vid_fullscreen" is "1"', 'vid_fullscreen 1 asks the page for fullscreen');
fullNow = true;
await con.submit('vid_fullscreen'); check(status.at(-1)?.[0] === '"vid_fullscreen" is "1"', 'and shows it once the page is');
await con.submit('vid_fullscreen x'); check(status.at(-1)?.[0] === 'vid_fullscreen takes 0 or 1' && status.at(-1)?.[1] === true, 'vid_fullscreen x is refused');
await con.submit('vid_fullscreen 0'); check(last() === 'set fullscreen false', 'vid_fullscreen 0 leaves it');
// m_filter (the mouse averaged) and host_speeds (a frame's times on the line)
await con.submit('m_filter 1'); check(s.mFilter === true && last() === 'set mFilter true', 'm_filter 1 averages the mouse, through the page');
await con.submit('m_filter 2'); check(s.mFilter === true && status.at(-1)?.[1] === true, 'm_filter 2 is refused');
await con.submit('host_speeds 1'); check(s.hostSpeeds === true, 'host_speeds 1 prints the times');
await con.submit('m_filter 0'); await con.submit('host_speeds 0');
// ref_soft's sw_ switches: sw_drawflat, sw_waterwarp and sw_clearcolor
await con.submit('sw_drawflat 1'); check(s.swDrawflat === true && last() === 'set swDrawflat true', 'sw_drawflat 1 paints the faces flat, through the page');
await con.submit('sw_waterwarp 0'); check(s.swWaterwarp === false, 'sw_waterwarp 0 leaves the view unwarped');
await con.submit('sw_clearcolor 2'); check(s.swClearcolor === 2 && status.at(-1)?.[0] === '"sw_clearcolor" is "2"', 'sw_clearcolor 2 sets the clear\'s palette index');
await con.submit('sw_clearcolor 300'); check(s.swClearcolor === 2 && status.at(-1)?.[0] === 'sw_clearcolor takes a palette index, 0 to 255' && status.at(-1)?.[1] === true, 'sw_clearcolor 300 is refused');
await con.submit('sw_drawflat 0'); await con.submit('sw_waterwarp 1'); await con.submit('sw_clearcolor 0');
// the mip cap and scale and the stipple (sw_mipcap, sw_mipscale, sw_stipplealpha)
await con.submit('sw_mipcap 3'); check(s.swMipcap === 3 && last() === 'set swMipcap 3' && status.at(-1)?.[0] === '"sw_mipcap" is "3"', 'sw_mipcap 3 caps the mip level through the page');
await con.submit('sw_mipcap 4'); check(s.swMipcap === 3 && status.at(-1)?.[0] === 'sw_mipcap takes 0 to 3' && status.at(-1)?.[1] === true, 'sw_mipcap 4 is refused');
await con.submit('sw_mipscale 2.5'); check(s.swMipscale === 2.5 && last() === 'set swMipscale 2.5', 'sw_mipscale 2.5 scales the thresholds');
await con.submit('sw_mipscale x'); check(s.swMipscale === 2.5 && status.at(-1)?.[0] === 'sw_mipscale takes a number from 0 to 10, 1 as Quake had it' && status.at(-1)?.[1] === true, 'sw_mipscale x is refused');
await con.submit('sw_stipplealpha 1'); check(s.swStipplealpha === true && last() === 'set swStipplealpha true', 'sw_stipplealpha 1 stipples the translucent surfaces');
await con.submit('sw_mipcap 0'); await con.submit('sw_mipscale 1'); await con.submit('sw_stipplealpha 0');
check(con.complete('sw_m') === 'sw_mipcap ' && con.complete('sw_mips') === 'sw_mipscale ' && con.complete('sw_s') === 'sw_stipplealpha ', 'Tab completes the three');
// m_yaw (the turn a count), cl_gun (the view weapon) and con_notifytime (the notify lines' seconds)
await con.submit('m_yaw'); check(status.at(-1)?.[0] === '"m_yaw" is "0.022"', 'm_yaw shows 0.022 by default');
await con.submit('m_yaw 0.044'); check(s.mYaw === 0.044 && last() === 'set mYaw 0.044', 'm_yaw 0.044 doubles the turn a count');
await con.submit('m_yaw x'); check(s.mYaw === 0.044 && status.at(-1)?.[1] === true, 'm_yaw x is refused');
await con.submit('cl_gun 0'); check(s.clGun === false && last() === 'set clGun false', 'cl_gun 0 draws no view weapon');
await con.submit('cl_gun 2'); check(s.clGun === false && status.at(-1)?.[0] === 'cl_gun takes 0 or 1' && status.at(-1)?.[1] === true, 'cl_gun 2 is refused');
await con.submit('con_notifytime 1.5'); check(s.conNotifytime === 1.5 && last() === 'set conNotifytime 1.5', 'con_notifytime 1.5 shortens the notify lines\' stay');
await con.submit('con_notifytime -1'); check(s.conNotifytime === 1.5 && status.at(-1)?.[0] === 'con_notifytime takes seconds, 0 to 60' && status.at(-1)?.[1] === true, 'con_notifytime -1 is refused');
Object.assign(s, { mYaw: 0.022, clGun: true, conNotifytime: 3 });
// the keys' speeds (CL_AdjustAngles, CL_BaseMove): cl_yawspeed, cl_pitchspeed, cl_anglespeedkey, cl_forwardspeed and cl_sidespeed, numbers through the page
await con.submit('cl_yawspeed'); check(status.at(-1)?.[0] === '"cl_yawspeed" is "140"', 'cl_yawspeed shows 140 by default');
await con.submit('cl_yawspeed 280'); check(s.clYawspeed === 280 && last() === 'set clYawspeed 280' && status.at(-1)?.[0] === '"cl_yawspeed" is "280"', 'cl_yawspeed 280 doubles the keys\' turn through the page');
await con.submit('cl_yawspeed -1'); check(s.clYawspeed === 280 && status.at(-1)?.[0] === 'cl_yawspeed takes degrees a second, 0 to 3600' && status.at(-1)?.[1] === true, 'cl_yawspeed -1 is refused');
await con.submit('cl_pitchspeed'); check(status.at(-1)?.[0] === '"cl_pitchspeed" is "150"', 'cl_pitchspeed shows 150 by default');
await con.submit('cl_pitchspeed 100'); check(s.clPitchspeed === 100 && last() === 'set clPitchspeed 100', 'cl_pitchspeed 100 slows the look');
await con.submit('cl_anglespeedkey'); check(status.at(-1)?.[0] === '"cl_anglespeedkey" is "1.5"', 'cl_anglespeedkey shows 1.5 by default');
await con.submit('cl_anglespeedkey 2'); check(s.clAnglespeedkey === 2 && last() === 'set clAnglespeedkey 2', 'cl_anglespeedkey 2 doubles the turn with +speed');
await con.submit('cl_anglespeedkey x'); check(s.clAnglespeedkey === 2 && status.at(-1)?.[1] === true, 'cl_anglespeedkey x is refused');
await con.submit('cl_forwardspeed 100'); check(s.clForwardspeed === 100 && last() === 'set clForwardspeed 100' && status.at(-1)?.[0] === '"cl_forwardspeed" is "100"', 'cl_forwardspeed 100 halves the walk');
await con.submit('cl_forwardspeed 2000'); check(s.clForwardspeed === 100 && status.at(-1)?.[0] === 'cl_forwardspeed takes units a second, 0 to 1000' && status.at(-1)?.[1] === true, 'cl_forwardspeed 2000 is refused');
await con.submit('cl_sidespeed 0'); check(s.clSidespeed === 0 && last() === 'set clSidespeed 0', 'cl_sidespeed 0 is no sidestep');
// the debug graph's cvars (cl_scrn.c's names: timegraph, debuggraph, graphheight, graphscale, graphshift)
await con.submit('timegraph 1'); check(s.timegraph === true && last() === 'set timegraph true', 'timegraph 1 adds a frame\'s time as a column, through the page');
await con.submit('debuggraph 1'); check(s.debuggraph === true && last() === 'set debuggraph true', 'debuggraph 1 draws the band');
await con.submit('graphheight 16'); check(s.graphheight === 16 && status.at(-1)?.[0] === '"graphheight" is "16"', 'graphheight 16 lowers the band');
await con.submit('graphheight 0'); check(s.graphheight === 16 && status.at(-1)?.[0] === 'graphheight takes pixels, 1 to 240' && status.at(-1)?.[1] === true, 'graphheight 0 is refused');
await con.submit('graphscale -2'); check(s.graphscale === -2 && status.at(-1)?.[0] === '"graphscale" is "-2"', 'graphscale -2 turns the columns down');
await con.submit('graphshift 300'); check(s.graphshift === 0 && status.at(-1)?.[0] === 'graphshift takes pixels, -240 to 240' && status.at(-1)?.[1] === true, 'graphshift 300 is refused');
await con.submit('timegraph 0'); await con.submit('debuggraph 0'); await con.submit('graphheight 32'); await con.submit('graphscale 1');
check(con.complete('timeg') === 'timegraph ' && con.complete('debug') === 'debuggraph ' && con.complete('graphh') === 'graphheight ' && con.complete('graphsc') === 'graphscale ' && con.complete('graphsh') === 'graphshift ', 'Tab completes the five');
await con.submit('cl_upspeed 100'); check(s.clUpspeed === 100 && last() === 'set clUpspeed 100' && status.at(-1)?.[0] === '"cl_upspeed" is "100"', 'cl_upspeed 100 halves the upmove, through the page');
await con.submit('cl_upspeed 1001'); check(s.clUpspeed === 100 && status.at(-1)?.[0] === 'cl_upspeed takes units a second, 0 to 1000' && status.at(-1)?.[1] === true, 'cl_upspeed 1001 is refused');
await con.submit('cl_upspeed 200');
// cl_lightlevel: the light at the eye, read from the page, no value taken
{
  let light = null;
  host.lightLevel = () => light;
  await con.submit('cl_lightlevel'); check(status.at(-1)?.[0] === 'cl_lightlevel: a map must be running' && status.at(-1)?.[1] === true, 'cl_lightlevel without a map says so');
  light = 75;
  await con.submit('cl_lightlevel'); check(status.at(-1)?.[0] === '"cl_lightlevel" is "75"' && status.at(-1)?.[1] === false, 'cl_lightlevel shows the light at the eye');
  await con.submit('cl_lightlevel 5'); check(status.at(-1)?.[0] === 'cl_lightlevel is written from the lightmap under the eye each frame; it takes no value' && status.at(-1)?.[1] === true, 'a value is refused');
  check(con.complete('cl_u') === 'cl_upspeed ' && con.complete('cl_l') === 'cl_lightlevel ', 'Tab completes cl_upspeed and cl_lightlevel');
  delete host.lightLevel;
}
Object.assign(s, { clYawspeed: 140, clPitchspeed: 150, clAnglespeedkey: 1.5, clForwardspeed: 200, clSidespeed: 200 });
// timeout and cl_timeout: the seconds a silent guest or host is dropped after
await con.submit('timeout'); check(status.at(-1)?.[0] === '"timeout" is "125"', 'timeout shows 125 by default');
await con.submit('timeout 30'); check(s.timeout === 30 && last() === 'set timeout 30', 'timeout 30 drops a guest silent half a minute');
await con.submit('cl_timeout 0'); check(s.clTimeout === 0, 'cl_timeout 0 never leaves');
await con.submit('cl_timeout x'); check(s.clTimeout === 0 && status.at(-1)?.[0] === 'cl_timeout takes seconds, 0 to 3600' && status.at(-1)?.[1] === true, 'cl_timeout x is refused');
await con.submit('timeout 125'); await con.submit('cl_timeout 120');
// gun_x, gun_y and gun_z (the view weapon's offset) and scr_centertime (a centre print's seconds), numbers through the page
await con.submit('gun_x'); check(status.at(-1)?.[0] === '"gun_x" is "0"', 'gun_x shows 0 by default');
await con.submit('gun_z 10'); check(s.gunZ === 10 && last() === 'set gunZ 10' && status.at(-1)?.[0] === '"gun_z" is "10"', 'gun_z 10 lowers the gun through the page');
await con.submit('gun_y -5'); check(s.gunY === -5 && last() === 'set gunY -5', 'gun_y -5 draws it back');
await con.submit('gun_x 200'); check(s.gunX === 0 && status.at(-1)?.[0] === 'gun_x takes units, -100 to 100' && status.at(-1)?.[1] === true, 'gun_x 200 is refused');
await con.submit('scr_centertime'); check(status.at(-1)?.[0] === '"scr_centertime" is "2.5"', 'scr_centertime shows 2.5 by default');
await con.submit('scr_centertime 5'); check(s.scrCentertime === 5 && last() === 'set scrCentertime 5', 'scr_centertime 5 keeps a centre print longer');
await con.submit('scr_centertime x'); check(s.scrCentertime === 5 && status.at(-1)?.[0] === 'scr_centertime takes seconds, 0 to 60' && status.at(-1)?.[1] === true, 'scr_centertime x is refused');
// cl_footsteps: 0 plays no footstep
await con.submit('cl_footsteps'); check(status.at(-1)?.[0] === '"cl_footsteps" is "1"', 'cl_footsteps shows 1 by default');
await con.submit('cl_footsteps 0'); check(s.clFootsteps === false && last() === 'set clFootsteps false', 'cl_footsteps 0 drops the footsteps through the page');
await con.submit('cl_footsteps 2'); check(s.clFootsteps === false && status.at(-1)?.[0] === 'cl_footsteps takes 0 or 1' && status.at(-1)?.[1] === true, 'cl_footsteps 2 is refused');
await con.submit('cl_footsteps 1');
// scr_showpause, scr_showturtle and cl_maxfps: the plaque, the turtle and the paint rate's cap
await con.submit('scr_showpause 0'); check(s.scrShowpause === false && last() === 'set scrShowpause false', 'scr_showpause 0 draws no plaque, through the page');
await con.submit('scr_showturtle 1'); check(s.scrShowturtle === true, 'scr_showturtle 1 turns the turtle on');
await con.submit('cl_maxfps'); check(status.at(-1)?.[0] === '"cl_maxfps" is "90"', 'cl_maxfps shows 90 by default');
await con.submit('cl_maxfps 30'); check(s.clMaxfps === 30 && last() === 'set clMaxfps 30', 'cl_maxfps 30 caps the paints');
await con.submit('cl_maxfps 0'); check(s.clMaxfps === 0, 'cl_maxfps 0 paints every frame');
await con.submit('cl_maxfps 2'); check(s.clMaxfps === 0 && status.at(-1)?.[0] === 'cl_maxfps takes 0 (every frame) or 5 to 1000' && status.at(-1)?.[1] === true, 'cl_maxfps 2 is refused');
Object.assign(s, { scrShowpause: true, scrShowturtle: false, clMaxfps: 90 });
Object.assign(s, { gunX: 0, gunY: 0, gunZ: 0, scrCentertime: 2.5 });
// ref_soft's switches: r_fullbright, r_drawentities, r_drawworld, r_lerpmodels, r_novis and r_speeds, 0 or 1 through the page
for (const [name, key, dflt] of [['r_fullbright', 'rFullbright', false], ['r_drawentities', 'rDrawentities', true], ['r_drawworld', 'rDrawworld', true], ['r_lerpmodels', 'rLerpmodels', true], ['r_novis', 'rNovis', false], ['r_speeds', 'rSpeeds', false]]) {
  await con.submit(name); const shown = status.at(-1)?.[0] === `"${name}" is "${dflt ? '1' : '0'}"`;
  await con.submit(`${name} ${dflt ? '0' : '1'}`); const flipped = s[key] === !dflt && last() === `set ${key} ${!dflt}`;
  await con.submit(`${name} 2`); const refused = s[key] === !dflt && status.at(-1)?.[0] === `${name} takes 0 or 1` && status.at(-1)?.[1] === true;
  await con.submit(`${name} ${dflt ? '1' : '0'}`);
  check(shown && flipped && refused && s[key] === dflt, `${name} shows ${dflt ? '1' : '0'} by default, takes the other through the page, refuses 2, and comes back`);
}
// serverinfo (SV_Serverinfo_f), userinfo (CL_Userinfo_f) and status (SV_Status_f): the server's cvars, this page's userinfo, the clients
{
  let printed = null;
  host.print = (text) => { printed = text; };
  host.serverInfo = async () => ({ mapname: 'demo1', deathmatch: 0, coop: 1, dmflags: 0, fraglimit: 0, timelimit: 0, cheats: 0, skill: 2 });
  host.userInfo = () => ({ name: 'Ace', hand: 1, gender: 'female', msg: 1, fov: 90, spectator: 0 });
  host.status = () => ({ map: 'demo1', rows: [{ num: 1, score: 3, ping: 0, name: 'Ace' }, { num: 2, score: 1, ping: 12, name: 'player 2' }] });
  await con.submit('serverinfo');
  check(status.at(-1)?.[0] === 'Server info settings: mapname "demo1" · deathmatch "0" · coop "1" · dmflags "0" · fraglimit "0" · timelimit "0" · cheats "0" · skill "2"', 'serverinfo lists the game\'s cvars as Info_Print listed them');
  await con.submit('userinfo');
  check(status.at(-1)?.[0] === 'User info settings: name "Ace" · hand "1" · gender "female" · msg "1" · fov "90" · spectator "0"', 'userinfo lists this page\'s userinfo');
  await con.submit('status');
  check(status.at(-1)?.[0] === 'map: demo1 · 2 clients: 1 Ace 3 frags, 0 ms · 2 player 2 1 frags, 12 ms' && printed === 'num score ping name\n  1     3    0 Ace\n  2     1   12 player 2',
    'status says the map and the clients on the line, and prints them as SV_Status_f laid them out');
  host.serverInfo = async () => null; host.status = () => null;
  await con.submit('serverinfo');
  check(status.at(-1)?.[0] === 'serverinfo: a joined page runs no server of its own' && status.at(-1)?.[1] === true, 'serverinfo on a joined page says so');
  await con.submit('status');
  check(status.at(-1)?.[0] === 'status: no game running' && status.at(-1)?.[1] === true, 'status without a game says so');
}
// viewsize (SCR_CalcVrect's cvar, 40 to 100), sizeup and sizedown (SCR_SizeUp_f, SCR_SizeDown_f: ten at a time, within the range)
await con.submit('viewsize'); check(status.at(-1)?.[0] === '"viewsize" is "100"', 'viewsize shows 100 by default');
await con.submit('viewsize 60'); check(s.viewsize === 60 && last() === 'set viewsize 60', 'viewsize 60 makes the view six tenths of the screen');
await con.submit('viewsize 20'); check(s.viewsize === 40, 'viewsize 20 clamps to 40');
await con.submit('viewsize x'); check(s.viewsize === 40 && status.at(-1)?.[0] === 'viewsize takes 40 to 100' && status.at(-1)?.[1] === true, 'viewsize x is refused');
await con.submit('sizeup'); check(s.viewsize === 50 && status.at(-1)?.[0] === '"viewsize" is "50"', 'sizeup adds ten');
await con.submit('sizedown'); await con.submit('sizedown'); check(s.viewsize === 40, 'sizedown takes ten, not under 40');
await con.submit('viewsize 100'); check(s.viewsize === 100, 'viewsize 100 is the whole screen again');
// a guest's prediction cvars: cl_predict (on by default) and cl_showmiss (off), 0 or 1
await con.submit('cl_predict'); check(status.at(-1)?.[0] === '"cl_predict" is "1"', 'cl_predict shows 1 by default');
await con.submit('cl_predict 0'); check(s.clPredict === false && last() === 'set clPredict false', 'cl_predict 0 stops a guest\'s prediction');
await con.submit('cl_showmiss 1'); check(s.clShowmiss === true && last() === 'set clShowmiss true', 'cl_showmiss 1 prints the misses');
await con.submit('cl_showmiss 3'); check(s.clShowmiss === true && status.at(-1)?.[0] === 'cl_showmiss takes 0 or 1' && status.at(-1)?.[1] === true, 'cl_showmiss 3 is refused');
// the mouse look cvars: shown, set as 0 or 1 (m_forward and m_side any number), refused otherwise
await con.submit('freelook'); check(status.at(-1)?.[0] === '"freelook" is "1"', 'freelook shows 1 by default (the mouse always looked here; Quake\'s default was 0)');
await con.submit('freelook 0'); check(s.freelook === false && last() === 'set freelook false', 'freelook 0 makes the mouse\'s vertical a walk');
await con.submit('lookspring 1'); check(s.lookspring === true && last() === 'set lookspring true', 'lookspring 1');
await con.submit('lookstrafe 1'); check(s.lookstrafe === true && last() === 'set lookstrafe true', 'lookstrafe 1');
await con.submit('lookstrafe 2'); check(s.lookstrafe === true && status.at(-1)?.[0] === 'lookstrafe takes 0 or 1' && status.at(-1)?.[1] === true, 'lookstrafe 2 is refused');
await con.submit('m_forward 2'); check(s.mForward === 2 && last() === 'set mForward 2', 'm_forward 2');
await con.submit('m_side -1'); check(s.mSide === -1 && last() === 'set mSide -1' && status.at(-1)?.[0] === '"m_side" is "-1"', 'm_side -1');
await con.submit('m_side x'); check(s.mSide === -1 && status.at(-1)?.[1] === true, 'm_side x is refused');
Object.assign(s, { name: '', hand: 0, gender: 'male', msg: 1, password: '', spectatorPassword: '', sensitivity: 7, alwaysRun: true, invertMouse: false, freelook: true, lookspring: false, lookstrafe: false, mForward: 1, mSide: 1, mFilter: false, crosshair: 1, clAddEntities: true, clAddParticles: true, clAddLights: true, clAddBlend: true, clTestentities: false, clTestparticles: false, clTestlights: false, clTestblend: false, sfx: 70, music: 50, cdLoopcount: 4, cdLooptrack: 11, cdNocd: false, netgraph: false, timegraph: false, debuggraph: false, graphheight: 32, graphscale: 1, graphshift: 0, clPredict: true, clShowmiss: false, viewsize: 100, rFullbright: false, rDrawentities: true, rDrawworld: true, rLerpmodels: true, rNovis: false, rSpeeds: false, hostSpeeds: false, swDrawflat: false, swWaterwarp: true, swClearcolor: 0, swMipcap: 0, swMipscale: 1, swStipplealpha: false, developer: false, logfile: false, logStats: false, svNoreload: false, sShow: false, inJoystick: true, mYaw: 0.022, clGun: true, conNotifytime: 3, clYawspeed: 140, clPitchspeed: 150, clAnglespeedkey: 1.5, clForwardspeed: 200, clSidespeed: 200, clUpspeed: 200, timeout: 125, clTimeout: 120, gunX: 0, gunY: 0, gunZ: 0, scrCentertime: 2.5, clFootsteps: true, scrShowpause: true, scrShowturtle: false, clMaxfps: 90, brightness: 1.4, hostname: '', coop: false, deathmatch: false, players: 2 });

// the deathmatch cvars and cheats: shown alone, set for the game running and the next ones through the host's setCvar, clamped
{
  const set = [];
  host.setCvar = async (name, value) => set.push(`${name}=${value}`);
  host.settings.dmflags = 0; host.settings.cheats = 0;
  await con.submit('cheats');
  check(status.at(-1)?.[0] === '"cheats" is "0"', 'cheats shows 0 by default');
  await con.submit('cheats 1');
  check(host.settings.cheats === 1 && set.at(-1) === 'cheats=1', 'cheats 1 turns the cheats on for a deathmatch, through the host');
  await con.submit('cheats 5');
  check(host.settings.cheats === 1 && set.at(-1) === 'cheats=1', 'cheats takes 0 or 1');
  await con.submit('cheats 0');
  await con.submit('dmflags 70000');
  check(host.settings.cheats === 0 && host.settings.dmflags === 65535 && set.at(-1) === 'dmflags=65535', 'cheats 0 puts them off; dmflags clamps to 65535');
  await con.submit('dmflags x');
  check(status.at(-1)?.[0] === '"dmflags" is "65535"', 'a word shows the value');
  host.settings.dmflags = 0;
  delete host.setCvar;
}

// vid_mode and vid_ref: the video menu's cvars, through the page's controls, the painter restarted on a change; archived
{
  let restarts = 0;
  host.vidRestart = () => { restarts++; return true; };
  await con.submit('vid_mode'); check(status.at(-1)?.[0] === '"vid_mode" is "1"', 'vid_mode shows 1 for 320×240');
  await con.submit('vid_mode 2'); check(s.detail === 'ultra' && last() === 'set detail ultra' && restarts === 1 && status.at(-1)?.[0] === '"vid_mode" is "2"', 'vid_mode 2 is 640×480 through the page, the painter restarted');
  await con.submit('vid_mode 2'); check(restarts === 1, 'the same mode again restarts nothing');
  await con.submit('vid_mode 5'); check(s.detail === 'ultra' && status.at(-1)?.[0] === 'vid_mode takes 0 (160×120), 1 (320×240) or 2 (640×480)' && status.at(-1)?.[1] === true, 'vid_mode 5 is refused');
  await con.submit('vid_ref'); check(status.at(-1)?.[0] === '"vid_ref" is "soft"', 'vid_ref shows soft for the face picker');
  await con.submit('vid_ref SQL'); check(s.renderer === 'sql' && last() === 'set renderer sql' && restarts === 2 && status.at(-1)?.[0] === '"vid_ref" is "sql"', 'vid_ref sql is the projector, case aside, the painter restarted');
  await con.submit('vid_ref gl'); check(s.renderer === 'sql' && status.at(-1)?.[0] === 'vid_ref takes soft (SQL picks the faces, JS projects) or sql (SQL projects every vertex)' && status.at(-1)?.[1] === true, 'vid_ref gl is refused');
  await con.submit('vid_mode 1'); await con.submit('vid_ref soft');
  const cfgLines = writeConfig(s).split('\n');
  check(cfgLines.includes('set vid_mode "1"') && cfgLines.includes('set vid_ref "soft"'), 'config.cfg carries vid_mode and vid_ref, archived as Quake\'s were');
  check(con.complete('vid_m') === 'vid_mode ' && con.complete('vid_ref') === 'vid_ref ', 'Tab completes vid_mode and vid_ref');
  delete host.vidRestart;
}
// quit, killserver, vid_restart and snd_restart through the page, each refused before it can be done
{
  const done = [];
  let ready = false;
  host.quit = () => ready && (done.push('quit'), true); host.killServer = () => ready && (done.push('kill'), true);
  host.vidRestart = () => ready && (done.push('vid'), true); host.sndRestart = () => ready && (done.push('snd'), true);
  await con.submit('quit'); check(done.length === 0 && status.at(-1)?.[0] === 'quit: no pak is loaded yet' && status.at(-1)?.[1] === true, 'quit before the pak says so');
  await con.submit('vid_restart'); check(status.at(-1)?.[0] === 'vid_restart: no painter yet (a pak must be loaded)' && status.at(-1)?.[1] === true, 'vid_restart without a painter says so');
  await con.submit('snd_restart'); check(status.at(-1)?.[0] === 'snd_restart: sound system not started (a click or a key makes it)' && status.at(-1)?.[1] === true, 'snd_restart before the mixer says so');
  ready = true;
  await con.submit('quit'); await con.submit('killserver'); await con.submit('vid_restart'); await con.submit('snd_restart');
  check(done.join() === 'quit,kill,vid,snd' && status.at(-4)?.[0] === 'the game ends: the attract loop' && status.at(-3)?.[0] === 'Server was killed' && status.at(-2)?.[0] === 'vid_restart: the painter made again' && status.at(-1)?.[0] === 'snd_restart: sound system restarted',
    'quit ends the game, killserver kills the server, vid_restart and snd_restart remake the painter and the mixer, each saying so');
  check(con.complete('qu') === 'quit ' && con.complete('kills') === 'killserver ' && con.complete('vid_res') === 'vid_restart ' && con.complete('snd') === 'snd_restart ', 'Tab completes the four');
  delete host.quit; delete host.killServer; delete host.vidRestart; delete host.sndRestart;
}
// messagemode and messagemode2: the chat prompt through the page (team for the second), refused without a game
{
  let prompts = [], up = true;
  host.messageMode = (team) => { if (!up) return false; prompts.push(team); return true; };
  await con.submit('messagemode'); await con.submit('messagemode2'); await con.submit('MessageMode');
  check(prompts.join() === 'false,true,false' && status.at(-1)?.[1] !== true, 'messagemode brings the chat prompt up, messagemode2 the team\'s, case aside');
  up = false;
  await con.submit('messagemode');
  check(prompts.length === 3 && status.at(-1)?.[0] === 'messagemode: a game must be running' && status.at(-1)?.[1] === true, 'without a game it says so');
  check(con.complete('mess') === 'messagemode ' && con.complete('messagemode2') === 'messagemode2 ', 'Tab completes messagemode and messagemode2');
  delete host.messageMode;
}
// fixedtime: the game's clock stepped a fixed number of milliseconds a frame, shown, set within 0..1000, refused for a fraction or a word, a guest told
{
  let fixed = 0, guest = false;
  host.setFixedtime = (n) => { if (n !== null) { if (guest) return null; fixed = n; } return fixed; };
  await con.submit('fixedtime');
  check(status.at(-1)?.[0] === '"fixedtime" is "0"', 'fixedtime alone shows 0, the wall clock');
  await con.submit('fixedtime 100');
  check(fixed === 100 && status.at(-1)?.[0] === '"fixedtime" is "100"', 'fixedtime 100 steps the clock a tenth of a second a frame');
  await con.submit('fixedtime 2.5');
  check(fixed === 100 && status.at(-1)?.[0] === 'fixedtime takes a whole number of milliseconds, 0 (the wall clock) to 1000' && status.at(-1)?.[1] === true, 'a fraction is refused');
  await con.submit('fixedtime 1001'); check(fixed === 100 && status.at(-1)?.[1] === true, 'past 1000 refused');
  await con.submit('fixedtime x'); check(fixed === 100 && status.at(-1)?.[1] === true, 'a word refused');
  guest = true;
  await con.submit('fixedtime 50');
  check(fixed === 100 && status.at(-1)?.[0] === 'fixedtime: a joined game runs at the host\'s pace' && status.at(-1)?.[1] === true, 'a guest is told the host\'s pace rules');
  guest = false;
  await con.submit('fixedtime 0'); check(fixed === 0, 'fixedtime 0 is the wall clock again');
  // sv_noreload: a setting as its cvar
  await con.submit('sv_noreload 1'); check(s.svNoreload === true && last() === 'set svNoreload true' && status.at(-1)?.[0] === '"sv_noreload" is "1"', 'sv_noreload 1 sets it through the page');
  await con.submit('sv_noreload 2'); check(s.svNoreload === true && status.at(-1)?.[0] === 'sv_noreload takes 0 or 1' && status.at(-1)?.[1] === true, 'sv_noreload 2 is refused');
  await con.submit('sv_noreload 0');
  check(con.complete('fixed') === 'fixedtime ' && con.complete('sv_n') === 'sv_noreload ', 'Tab completes fixedtime and sv_noreload');
  delete host.setFixedtime;
}
// timescale: the game's clock against the wall's, shown, set within 0.1..10, refused at 0 or for a word, a guest told
{
  let scale = 1, guest = false;
  host.setTimescale = (n) => { if (n !== null) { if (guest) return null; scale = n; } return scale; };
  await con.submit('timescale');
  check(status.at(-1)?.[0] === '"timescale" is "1"', 'timescale alone shows 1');
  await con.submit('timescale 0.5');
  check(scale === 0.5 && status.at(-1)?.[0] === '"timescale" is "0.5"', 'timescale 0.5 is slow motion');
  await con.submit('timescale 50');
  check(scale === 10, 'clamped to 10');
  await con.submit('timescale 0');
  check(scale === 10 && status.at(-1)?.[0] === 'timescale takes a number above 0 (0.1 to 10)' && status.at(-1)?.[1] === true, '0 is refused (the game would stop)');
  await con.submit('timescale x');
  check(scale === 10 && status.at(-1)?.[1] === true, 'a word is refused');
  guest = true;
  await con.submit('timescale 2');
  check(scale === 10 && status.at(-1)?.[0] === "timescale: a joined game runs at the host's pace" && status.at(-1)?.[1] === true, 'a guest is told the pace is the host\'s');
  guest = false;
  await con.submit('timescale 1');
  check(scale === 1, 'timescale 1 puts it back');
}

// writeconfig and exec: the binds and the cvars as config.cfg (Key_WriteBindings, Cvar_WriteVariables), run back line by line
{
  const cfg = writeConfig({ ...s, name: 'Ace Rimmer', sensitivity: 5, invertMouse: true, binds: { ...defaultBinds(), attack: ['KeyK', 'Mouse2'], moveup: [] }, lines: { KeyJ: 'god', Mouse3: 'say hello' } });
  const lines = cfg.split('\n');
  const setAt = lines.findIndex((l) => l.startsWith('set ')), godAt = lines.indexOf('bind j "god"');
  check(lines.includes('set sw_stipplealpha "0"') && !lines.some((l) => l.startsWith('set sw_mipcap') || l.startsWith('set sw_mipscale') || l.startsWith('set sw_drawflat')), 'sw_stipplealpha is archived as Quake\'s was, sw_mipcap and sw_mipscale not');
  check(lines[0].startsWith('//') && lines[1] === 'unbindall' && lines[2] === 'bind k "+attack"' && lines[3] === 'bind MOUSE2 "+attack"' && lines.includes('bind MWHEELDOWN "weapnext"') && !lines.some((l) => l.includes('"+moveup"'))
    && godAt > 3 && godAt < setAt && lines[godAt + 1] === 'bind MOUSE3 "say hello"'
    && lines.includes('set name "Ace Rimmer"') && lines.includes('set sensitivity "5"') && lines.includes('set m_pitch "-0.022"') && lines.includes('set s_volume "0.70"') && lines.includes('set fov "160"') && lines.includes('set skill "2"') && lines.includes('set freelook "1"') && lines.includes('set lookspring "0"') && lines.includes('set viewsize "100"') && lines.includes('set vid_gamma "1.4"') && lines.includes('set gender "male"') && lines.includes('set m_filter "0"') && lines.includes('set msg "1"') && lines.includes('set hostname ""') && !lines.some((l) => l.startsWith('set netgraph') || l.startsWith('set m_forward') || l.startsWith('set m_side') || l.startsWith('set cl_predict') || l.startsWith('set cl_showmiss') || l.startsWith('set r_') || l.startsWith('set m_yaw') || l.startsWith('set cl_gun') || l.startsWith('set con_notifytime')) && cfg.endsWith('\n'),
    'writeConfig writes unbindall, a bind line a key in the actions\' order, the keys bound to lines after them, and a set line a cvar, as config.cfg had them (netgraph, m_forward, m_side, m_yaw, cl_gun, con_notifytime, the cl_ speeds, gun_x, gun_y, gun_z, scr_centertime, cl_predict, cl_showmiss and the r_ switches, not archived, left out)');
  let downloaded = null;
  host.download = (name, text) => { downloaded = { name, text }; };
  await con.submit('writeconfig');
  check(downloaded?.name === 'config.cfg' && downloaded.text === writeConfig(host.settings) && status.at(-1)?.[0] === 'config.cfg written', 'writeconfig downloads config.cfg');
  let picked = 0;
  host.execConfig = () => { picked++; };
  await con.submit('exec');
  check(picked === 1, 'exec opens the Config picker');
  // clear and condump: the scrollback emptied (Con_Clear_f), or downloaded as <name>.txt (Con_Dump_f)
  let cleared = 0, dumpedAs = null;
  host.clearLog = () => { cleared++; };
  host.dumpLog = (name) => { dumpedAs = name; return 3; };
  const before = status.length;
  await con.submit('clear');
  check(cleared === 1 && status.length === before, 'clear empties the scrollback and says nothing');
  await con.submit('condump');
  check(dumpedAs === null && status.at(-1)?.[0] === 'usage: condump <filename>' && status.at(-1)?.[1] === true, 'condump alone is refused with its usage');
  await con.submit('condump mylog');
  check(dumpedAs === 'mylog' && status.at(-1)?.[0] === 'Dumped console text to mylog.txt.', 'condump <name> downloads the scrollback as <name>.txt and says so');
  await con.submit('condump "my log.txt"');
  check(dumpedAs === 'my log', 'the name as typed, the quotes and a .txt taken off');
  await con.submit('condump ../x:y');
  check(dumpedAs === '..xy', 'a path\'s characters are dropped from the name');
  // developer: a setting as its cvar (the page's warnings on the console with it); logfile: the scrollback to qconsole.log through the page
  await con.submit('developer 1'); check(s.developer === true && last() === 'set developer true' && status.at(-1)?.[0] === '"developer" is "1"', 'developer 1 sets it through the page');
  await con.submit('developer 2'); check(s.developer === true && status.at(-1)?.[0] === 'developer takes 0 or 1' && status.at(-1)?.[1] === true, 'developer 2 is refused');
  await con.submit('developer 0');
  // in_joystick: a setting as its cvar, archived; cl_paused: the pause's state shown, never set; log_stats: stats.log through the page
  await con.submit('in_joystick 0'); check(s.inJoystick === false && last() === 'set inJoystick false' && status.at(-1)?.[0] === '"in_joystick" is "0"', 'in_joystick 0 leaves the pads unread, through the page');
  await con.submit('in_joystick 2'); check(s.inJoystick === false && status.at(-1)?.[0] === 'in_joystick takes 0 or 1' && status.at(-1)?.[1] === true, 'in_joystick 2 is refused');
  check(writeConfig({ ...s, inJoystick: false }).split('\n').includes('set in_joystick "0"'), 'config.cfg carries in_joystick, archived as Quake\'s was');
  await con.submit('in_joystick 1');
  let pausedState = false;
  host.isPaused = () => pausedState;
  await con.submit('cl_paused'); check(status.at(-1)?.[0] === '"cl_paused" is "0"', 'cl_paused shows 0 with the game going');
  pausedState = true;
  await con.submit('cl_paused'); check(status.at(-1)?.[0] === '"cl_paused" is "1"', '... and 1 paused');
  await con.submit('cl_paused 0'); check(status.at(-1)?.[0] === 'cl_paused is the pause\'s own: pause sets it' && status.at(-1)?.[1] === true, 'a value is refused: pause sets it');
  delete host.isPaused;
  let statsOn = false, statsLines = null;
  host.setLogStats = async (on) => { if (on) { if (statsOn) return 'already'; statsOn = true; return 'on'; } if (!statsOn) return null; statsOn = false; return statsLines; };
  await con.submit('log_stats'); check(status.at(-1)?.[0] === '"log_stats" is "0"', 'log_stats alone shows 0');
  await con.submit('log_stats 0'); check(status.at(-1)?.[0] === 'log_stats: nothing was logged' && status.at(-1)?.[1] === true, 'log_stats 0 with nothing logged says so');
  await con.submit('log_stats 1'); check(statsOn && status.at(-1)?.[0] === 'log_stats: a line a frame goes to stats.log', 'log_stats 1 starts the log');
  await con.submit('log_stats 1'); check(status.at(-1)?.[0] === 'log_stats: already on', 'log_stats 1 again says it is on');
  statsLines = 40;
  await con.submit('log_stats 0'); check(!statsOn && status.at(-1)?.[0] === 'log_stats: stats.log downloaded, 40 lines', 'log_stats 0 downloads the file and says how many lines');
  check(con.complete('in_') === 'in_joystick ' && con.complete('cl_pa') === 'cl_paused ' && con.complete('log_') === 'log_stats ', 'Tab completes the three');
  delete host.setLogStats;
  let logOn = false, logLines = null;
  host.setLogfile = async (on) => { if (on) { if (logOn) return 'already'; logOn = true; return 'on'; } if (!logOn) return null; logOn = false; return logLines; };
  await con.submit('logfile'); check(status.at(-1)?.[0] === '"logfile" is "0"', 'logfile alone shows 0');
  await con.submit('logfile 2'); check(status.at(-1)?.[0] === 'logfile takes 0 or 1' && status.at(-1)?.[1] === true, 'logfile 2 is refused');
  await con.submit('logfile 0'); check(status.at(-1)?.[0] === 'logfile: nothing was logged' && status.at(-1)?.[1] === true, 'logfile 0 with nothing logged says so');
  await con.submit('logfile 1'); check(logOn && status.at(-1)?.[0] === 'logfile: the console goes to qconsole.log' && status.at(-1)?.[1] === false, 'logfile 1 starts the log');
  s.logfile = true;
  await con.submit('logfile'); check(status.at(-1)?.[0] === '"logfile" is "1"', 'and shows 1');
  await con.submit('logfile 1'); check(status.at(-1)?.[0] === 'logfile: already on', 'logfile 1 again says it is on');
  logLines = 12; s.logfile = false;
  await con.submit('logfile 0'); check(!logOn && status.at(-1)?.[0] === 'logfile: qconsole.log downloaded, 12 lines' && status.at(-1)?.[1] === false, 'logfile 0 downloads the file and says how many lines');
  logLines = 1; logOn = true;
  await con.submit('logfile 0'); check(status.at(-1)?.[0] === 'logfile: qconsole.log downloaded, 1 line', 'one line, singular');
  check(con.complete('dev') === 'developer ' && con.complete('logf') === 'logfile ', 'Tab completes developer and logfile');
  delete host.setLogfile;
  // echo, cmdlist, version and pause: cmd.c's, common.c's and cl_main.c's words
  await con.submit('echo Hello, World!');
  check(status.at(-1)?.[0] === 'Hello, World!' && status.at(-1)?.[1] === false, 'echo prints its words as typed');
  let printed = null;
  host.print = (text) => { printed = text; };
  host.version = () => 'Firebird Quake 2 0.1.0 build x';
  await con.submit('cmdlist');
  check(printed === COMMANDS.join('\n') && status.at(-1)?.[0] === `${COMMANDS.length} commands`, 'cmdlist prints every command on a line of the scrollback and says how many');
  await con.submit('version');
  check(status.at(-1)?.[0] === 'Firebird Quake 2 0.1.0 build x', 'version says which build the page runs');
  // path, dir and the listings (FS_Path_f, FS_Dir_f, Mod_Modellist_f, R_ImageList_f, S_SoundList_f): the pak's name and files, its
  // files a wildcard names, and the models, the images and the sounds loaded, a line each in the scrollback with their sizes
  host.pakInfo = () => ({ name: 'pak0.pak', files: 5, from: "the demo's, ./pak/pak0.pak" });
  await con.submit('path');
  check(status.at(-1)?.[0] === "Current search path: pak0.pak (5 files, the demo's, ./pak/pak0.pak)", 'path names the pak, its files and where it came from');
  await con.submit('dir maps/*.bsp');
  check(printed === 'Directory of pak0.pak/maps/*.bsp\n----\ndemo1.bsp\ndemo2.bsp' && status.at(-1)?.[0] === 'dir maps/*.bsp: 2 files', 'dir lists the files a wildcard names by their names, under "Directory of", and counts them');
  await con.submit('dir');
  check(printed === 'Directory of pak0.pak/*.*\n----\nreadme.txt' && status.at(-1)?.[0] === 'dir *.*: 1 file', 'dir alone is *.* at the root, as FS_Dir_f had it');
  await con.submit('dir *.bsp');
  check(printed === 'Directory of pak0.pak/*.bsp\n----' && status.at(-1)?.[0] === 'dir *.bsp: no files', 'a wildcard stays in its directory');
  check(dirList(['a/b.wav', 'a/c.wav', 'a/d/e.wav', 'b.wav'], 'a/?.wav').join() === 'a/b.wav,a/c.wav' && dirList(['x.txt', 'x+y.txt'], 'x+y.txt').join() === 'x+y.txt', 'dirList: ? is one character, the rest as written');
  host.pakInfo = () => null;
  await con.submit('path'); check(status.at(-1)?.[0] === 'path: no pak loaded yet' && status.at(-1)?.[1] === true, 'path without a pak says so');
  await con.submit('dir'); check(status.at(-1)?.[1] === true, 'dir too');
  host.modelList = () => [{ name: 'models/weapons/v_blast/tris.md2', size: 12345 }, { name: 'models/monsters/berserk/tris.md2', size: 0 }];
  await con.submit('modellist');
  check(printed === 'Loaded models:\n   12345 : models/weapons/v_blast/tris.md2\n       0 : models/monsters/berserk/tris.md2\nTotal resident: 12345' && status.at(-1)?.[0] === '2 models loaded, 12345 bytes', 'modellist lists the models with their size in the pak, as Mod_Modellist_f laid them out, and sums them');
  host.imageList = () => [{ kind: 'P', w: 128, h: 128, name: 'pics/conchars.pcx' }, { kind: 'W', w: 64, h: 32, name: 'textures/e1u1/floor1_1.wal' }];
  await con.submit('imagelist');
  check(printed === 'P  128  128 pics/conchars.pcx\nW   64   32 textures/e1u1/floor1_1.wal\nTotal texel count: 18432' && status.at(-1)?.[0] === '2 images, 18432 texels', 'imagelist lists the images with their kind and size, as R_ImageList_f did, and counts the texels');
  host.soundList = () => [{ name: 'weapons/blastf1a.wav', size: 4000, loop: false }, { name: 'world/fan1.wav', size: 300, loop: true }];
  await con.submit('soundlist');
  check(printed === '    4000 : weapons/blastf1a.wav\nL    300 : world/fan1.wav\nTotal resident: 4300' && status.at(-1)?.[0] === '2 sounds loaded, 4300 bytes', 'soundlist lists the sounds with L on the looping ones and their sizes, as S_SoundList_f did');
  delete host.modelList; delete host.imageList; delete host.soundList;
  await con.submit('modellist'); check(printed === 'Loaded models:\nTotal resident: 0' && status.at(-1)?.[0] === '0 models loaded, 0 bytes', 'without the page\'s listing, none');
  check(con.complete('di') === 'dir ' && con.complete('pat') === 'path ' && con.complete('mod') === 'modellist ' && con.complete('ima') === 'imagelist ' && con.complete('soundl') === 'soundlist ', 'Tab completes the five');
  let pausedNow = null;
  host.togglePause = () => (pausedNow === null ? null : (pausedNow = !pausedNow));
  const n0 = status.length;
  await con.submit('pause');
  check(status.at(-1)?.[0] === 'Pause command is only valid in single player' && status.length === n0 + 1, 'pause in a shared game, or without one, says so as CL_Pause_f did');
  pausedNow = false;
  await con.submit('pause');
  check(pausedNow === true && status.length === n0 + 1, 'pause pauses a single-player game, saying nothing');
  await con.submit('pause');
  check(pausedNow === false, 'and again goes on');
  // score and putaway: the score board toggled (Cmd_Score_f: in a game running), every screen put away (Cmd_PutAway_f)
  let scores = 0, putAway = 0;
  host.toggleScores = () => { scores++; };
  host.putAway = () => { putAway++; };
  await con.submit('score');
  running = false;
  await con.submit('score');
  running = true;
  await con.submit('putaway');
  check(scores === 1 && putAway === 1, 'score toggles the score board in a game running, not without one; putaway puts every screen away');
  // exec autoexec runs the autoexec.cfg kept in the browser (the Config control's box), unautoexec drops it
  let keptLines = null, dropped = 0;
  host.execAutoexec = async () => keptLines;
  host.dropAutoexec = async () => { dropped++; const had = keptLines !== null; keptLines = null; return had; };
  await con.submit('exec autoexec');
  check(picked === 1 && status.at(-1)?.[0] === 'no autoexec.cfg kept: tick the Config control\'s autoexec and pick one' && status.at(-1)?.[1] === true, 'exec autoexec with none kept says so, the picker left alone');
  keptLines = 3;
  await con.submit('exec autoexec.cfg');
  check(status.at(-1)?.[0] === 'execing autoexec.cfg: 3 lines run' && status.at(-1)?.[1] === false, 'exec autoexec (.cfg or not) runs the kept one and says how many lines');
  await con.submit('unautoexec');
  check(dropped === 1 && keptLines === null && status.at(-1)?.[0] === 'autoexec.cfg dropped', 'unautoexec drops it');
  await con.submit('unautoexec');
  check(dropped === 2 && status.at(-1)?.[0] === 'no autoexec.cfg kept', 'and says when there was none');
  check(con.complete('una') === 'unautoexec ' && con.complete('unb') === 'unbind ', 'Tab completes unautoexec before unbind');
  s.sensitivity = 7; s.name = ''; s.invertMouse = false; host.settings.binds = defaultBinds(); host.settings.lines = {};
  const n = await con.execText(cfg + '\n// a comment\n\nset fov 100 // trailing\nbind nosuch +attack\n');
  check(n === lines.length && s.name === 'Ace Rimmer' && s.sensitivity === 5 && s.invertMouse === true && host.settings.fov === 100 && host.settings.binds.attack.join() === 'KeyK,Mouse2' && host.settings.binds.moveup.length === 0
    && host.settings.lines.KeyJ === 'god' && host.settings.lines.Mouse3 === 'say hello',
    `exec runs a config's lines (${n}): the comments and blanks skipped, the quotes off, a bad key refused and the rest run, the keys bound to lines among them`);
  await con.submit('set');
  check(status.at(-1)?.[0] === 'usage: set <variable> <value>' && status.at(-1)?.[1] === true, 'set alone shows its usage');
  await con.submit('set bogus 1');
  check(status.at(-1)?.[0] === '"bogus" is not a cvar this page keeps' && status.at(-1)?.[1] === true, 'set on a cvar the page has not is refused');
  host.settings.fov = 160; host.settings.binds = defaultBinds(); host.settings.lines = {};
  Object.assign(s, { name: '', hand: 0, gender: 'male', msg: 1, password: '', spectatorPassword: '', sensitivity: 7, alwaysRun: true, invertMouse: false, crosshair: 1, clAddEntities: true, clAddParticles: true, clAddLights: true, clAddBlend: true, clTestentities: false, clTestparticles: false, clTestlights: false, clTestblend: false, sfx: 70, music: 50, cdLoopcount: 4, cdLooptrack: 11, cdNocd: false });
}

// bind and its kin: Key_Bind_f, Key_Unbind_f, Key_Unbindall_f and Key_Bindlist_f over the keys menu's binds
const binds = host.settings.binds;
await con.submit('bind');
check(status.at(-1)?.[0] === 'bind <key> [command] : attach a command to a key' && status.at(-1)?.[1] === true, 'bind alone shows its usage');
await con.submit('bind j +attack');
check(binds.attack.join() === 'KeyJ' && last() === 'saveSettings' && status.at(-1)?.[0] === '"j" = "+attack"', 'bind j +attack binds J to attack (its two defaults made room), saved, shown as Key_Bind_f printed it');
await con.submit('bind J');
check(status.at(-1)?.[0] === '"j" = "+attack"' && status.at(-1)?.[1] === false, 'bind <key> alone shows the binding, case aside');
await con.submit('bind uparrow weapprev');
check(binds.weapprev.join() === 'MWheelUp,ArrowUp' && binds.forward.join() === 'KeyW', 'a key bound to another action leaves its old one (UPARROW off walk forward)');
await con.submit('bind mouse2 use power shield');
check(binds.shield.join() === 'KeyH,Mouse2' && status.at(-1)?.[0] === '"MOUSE2" = "use power shield"', 'a mouse button binds to a command of two words');
// a line that is no action's command binds as Quake bound any line: the key runs it at the console when it goes down
const lines = host.settings.lines;
await con.submit('bind k god');
check(lines.KeyK === 'god' && last() === 'saveSettings' && status.at(-1)?.[0] === '"k" = "god"', 'bind k god binds K to the line god, saved and shown');
await con.submit('bind t "say hello"');
check(lines.KeyT === 'say hello' && binds.messagemode.length === 0 && status.at(-1)?.[0] === '"t" = "say hello"', 'bind t "say hello" binds T to the line, the quotes off, T leaving the chat action');
await con.submit('bind T');
check(status.at(-1)?.[0] === '"t" = "say hello"', 'bind <key> shows the line');
await con.submit('bind t +attack');
check(!('KeyT' in lines) && binds.attack.join() === 'KeyJ,KeyT', 'bound to an action again, the key loses its line');
await con.submit('bind j ""');
check(binds.attack.join() === 'KeyJ,KeyT' && status.at(-1)?.[0] === '"" is not a line this page can bind (printable, at most 128 characters)' && status.at(-1)?.[1] === true, 'a line that is nothing is refused');
await con.submit(`bind j ${'x'.repeat(129)}`);
check(binds.attack.join() === 'KeyJ,KeyT' && status.at(-1)?.[1] === true, 'a line past 128 characters is refused');
await con.submit('bind zz +attack');
check(binds.attack.join() === 'KeyJ,KeyT' && status.at(-1)?.[0] === '"zz" isn\'t a valid key' && status.at(-1)?.[1] === true, 'a key that is not one is refused');
await con.submit('bind m');
check(status.at(-1)?.[0] === '"m" is not bound', 'a key with no binding says so');
await con.submit('bindlist');
check(status.at(-1)?.[0].startsWith('j "+attack" · t "+attack" · / "weapnext" · MWHEELDOWN "weapnext" · MWHEELUP "weapprev" · UPARROW "weapprev"') && status.at(-1)?.[0].includes('MOUSE2 "use power shield"') && status.at(-1)?.[0].endsWith(' · k "god"'),
  'bindlist shows every key bound with its command, in the actions\' order, the lines after');
await con.submit('unbind');
check(status.at(-1)?.[0] === 'unbind <key> : remove commands from a key' && status.at(-1)?.[1] === true, 'unbind alone shows its usage');
await con.submit('unbind j');
check(binds.attack.join() === 'KeyT' && last() === 'saveSettings' && status.at(-1)?.[0] === '"j" unbound', 'unbind j takes the key off');
await con.submit('unbind k');
check(!('KeyK' in lines) && status.at(-1)?.[0] === '"k" unbound', 'unbind k takes a line\'s key off');
await con.submit('bind k god');
await con.submit('unbindall');
check(ACTIONS.every((a) => binds[a.id].length === 0) && Object.keys(host.settings.lines).length === 0 && status.at(-1)?.[0] === 'all keys unbound', 'unbindall empties every action and the lines');
await con.submit('bindlist');
check(status.at(-1)?.[0] === 'no keys bound', 'and bindlist says so');

// the notify lines (src/notify.js, Con_DrawNotify): the last four prints, three seconds each, and the scrollback
{
  {
    const told = [], w = new Notify();
    w.onAdd = (line) => told.push(line);
    w.add('one\ntwo\n', 0); w.add('three', 1, { show: false });
    check(told.join('|') === 'one|two|three', 'onAdd is told each line as it comes, the hidden ones too (the logfile)');
  }
  const n = new Notify();
  n.add('You got the shotgun', 0);
  n.add('Primary objective\nfind the key\n', 1);
  check(n.lines(1).join('|') === 'You got the shotgun|Primary objective|find the key', 'a print is its lines, drawn oldest first');
  check(n.lines(3.5).join('|') === 'Primary objective|find the key' && n.lines(4.2).length === 0, 'a line goes after three seconds');
  for (let i = 0; i < 6; i++) n.add(`line ${i}`, 10);
  check(n.lines(10).join('|') === 'line 2|line 3|line 4|line 5', 'four lines at most, the newest');
  n.add(']give all', 10, { show: false }); n.add('Very impressive', 10.1);
  check(n.lines(10.2).join('|') === 'line 3|line 4|line 5|Very impressive' && n.log(3).join('|') === 'line 5|]give all|Very impressive', 'a hidden line is in the scrollback and not drawn');
  check(n.lines(9.9).length === 0, 'a print from a clock ahead of now is not drawn yet');
  const big = new Notify({ keep: 5 });
  for (let i = 0; i < 9; i++) big.add(`l${i}`, i);
  check(big.log().join('|') === 'l4|l5|l6|l7|l8', 'the scrollback keeps the last lines alone');
  n.clear();
  check(n.lines(10).length === 0 && n.log().length === 0, 'cleared with the level');
}

// the centre print's clock (src/notify.js, SCR_DrawCenterString): the row's text stays scr_centertime seconds from when it came
{
  const c = new CenterPrint();
  c.see('ENTERING Outer Base', 0);
  check(c.text(0) === 'ENTERING Outer Base' && c.text(2.4) === 'ENTERING Outer Base' && c.text(2.5) === null, 'a print is drawn 2.5 seconds, the row carrying it or not');
  c.see('ENTERING Outer Base', 2.6);
  check(c.text(2.6) === null, 'the same text the row still carries starts no new clock');
  c.see(null, 2.7); c.see('ENTERING Outer Base', 2.8);
  check(c.text(2.8) === 'ENTERING Outer Base' && c.text(5.2) === 'ENTERING Outer Base' && c.text(5.3) === null, 'the text back after the row dropped it is a new print');
  c.see('You need the blue key', 4);
  check(c.text(4) === 'You need the blue key' && c.text(6.4) === 'You need the blue key', 'a new text starts the clock again');
  c.seconds = 1;
  check(c.text(4.9) === 'You need the blue key' && c.text(5) === null, 'scr_centertime changed, the clock follows');
  check(c.text(1) === null && c.cur === null, 'a clock behind the print\'s (a new level) drops it');
  c.see('Hello', 1); c.clear();
  check(c.text(1) === null, 'cleared with the level');
}

// `;`, alias and wait (Cbuf_ExecuteText, Cmd_Alias_f, cmd_wait): a line's commands parted at `;` outside quotes run in order,
// an alias names a line and runs it by name (sixteen deep at most), wait holds the rest of a line to the next frame
{
  const { splitLine } = await import('../src/console.js');
  check(splitLine('god; noclip ;  notarget').join('|') === 'god|noclip|notarget' && splitLine('bind k "god; noclip"; fov 90').join('|') === 'bind k "god; noclip"|fov 90' && splitLine(' ; ;').length === 0,
    'a line parts at ; outside quotes, the parts trimmed and the empty ones dropped');
  const n0 = calls.length;
  await con.submit('fov 100; fov 110');
  check(host.settings.fov === 110 && calls.filter((c, i) => i >= n0 && c[0] === 'setView').map((c) => c[1]).join() === '100,110', 'two commands on a line run in order');
  await con.submit('bind k "fov 120; fov 130"');
  check(host.settings.lines.KeyK === 'fov 120; fov 130', 'a bind keeps its quoted line whole, ; and all');
  await con.submit('unbind k');
  await con.submit('alias');
  check(status.at(-1)?.[0] === 'Current alias commands: none', 'alias alone lists none');
  await con.submit('alias Wide "fov 140; fov 150"');
  check(con.aliases.get('wide') === 'fov 140; fov 150' && status.at(-1)?.[0] === 'alias wide : fov 140; fov 150', 'alias names a line, the name in lower case, the quotes off');
  await con.submit('alias narrow fov 20');
  await con.submit('WIDE');
  check(host.settings.fov === 150, 'the alias runs its line, case aside');
  await con.submit('narrow; wide');
  check(host.settings.fov === 150 && calls.filter((c) => c[0] === 'setView').slice(-3).map((c) => c[1]).join() === '20,140,150', 'aliases part at ; too, each its line');
  await con.submit('alias');
  check(status.at(-1)?.[0] === 'Current alias commands: wide : fov 140; fov 150 · narrow : fov 20', 'alias lists them as Cmd_Alias_f printed them');
  await con.submit(`alias ${'x'.repeat(32)} fov 1`);
  check(status.at(-1)?.[0] === 'Alias name is too long' && status.at(-1)?.[1] === true && con.aliases.size === 2, 'a name of 32 characters or more is refused');
  await con.submit('alias fov fov 1');
  await con.submit('fov 90');
  check(host.settings.fov === 90, 'an alias named as a command never runs: the command does (Cmd_ExecuteString looked at the commands first)');
  await con.submit('alias loop loop');
  await con.submit('loop');
  check(status.at(-1)?.[0] === 'ALIAS_LOOP_COUNT' && status.at(-1)?.[1] === true && con.aliasDepth === 0, 'an alias that runs itself stops at ALIAS_LOOP_COUNT, the depth back at zero');
  await con.submit('alias empty');
  await con.submit('empty');
  check(con.aliases.get('empty') === '' && host.settings.fov === 90, 'an empty alias runs nothing');
  await con.submit('fov 50; wait; fov 60; fov 70');
  check(host.settings.fov === 50 && con.pending.join('|') === 'fov 60; fov 70', 'wait holds the rest of the line for the next frame');
  check(await con.tick() === 1 && host.settings.fov === 70 && con.pending.length === 0 && await con.tick() === 0, 'tick runs what was held, once');
  await con.submit('wait');
  check(con.pending.length === 0, 'wait alone holds nothing');
  check(con.complete('al') === 'alias ' && con.complete('wa') === 'wait ', 'Tab completes alias and wait');
  con.aliases.clear();
}

// the history: not twice in a row, 32 at most, up and down through it, the empty line past the newest
const h = new Console(host);
await h.submit('god'); await h.submit('god'); await h.submit('noclip'); await h.submit('   ');
check(h.history.join(',') === 'god,noclip', `the same line twice in a row is kept once, a blank line not at all (${h.history.join(',')})`);
h.reset();
check(h.historyStep(-1) === 'noclip' && h.historyStep(-1) === 'god' && h.historyStep(-1) === 'god', 'up steps back and stops at the oldest');
check(h.historyStep(1) === 'noclip' && h.historyStep(1) === '' && h.historyStep(1) === '', 'down steps forward to the empty line past the newest');
for (let i = 0; i < 40; i++) await h.submit(`fov ${i}`);
check(h.history.length === 32 && h.history[0] === 'fov 8', 'past 32 lines the oldest are forgotten');

// Tab completion
check(con.complete('no') === 'noclip ', 'no completes to the first command that starts with it (noclip, before notarget)');
check(con.complete('NOT') === 'notarget ', 'in capitals too');
check(con.complete('give all') === null && con.complete('') === null && con.complete('zzz') === null, 'a line with an argument, an empty one or no match completes to nothing');
check(COMMANDS.every((c, i) => i === 0 || COMMANDS[i - 1] < c), 'the commands are in order, so the first match is the alphabetical one');

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('all good');
