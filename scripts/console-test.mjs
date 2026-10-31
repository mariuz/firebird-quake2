// console-test.mjs – the console line headless (src/console.js): the page's own commands reach the host,
// the rest reach player_command, the history steps and forgets as Key_Console's did, Tab completes.
//   node scripts/console-test.mjs

import { Console, COMMANDS, writeConfig } from '../src/console.js';
import { Notify } from '../src/notify.js';
import { ACTIONS, defaultBinds } from '../src/input.js';

let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

const calls = [];
const status = [];
const host = {
  db: { query: async (sql, params = []) => { calls.push(['query', sql.slice(0, 40), ...params]); return { rows: [{ S: 12345, R: 999 }] }; } },
  pak: { has: (p) => p === 'maps/demo2.bsp' },
  settings: { fov: 90, skill: 1, binds: defaultBinds(), lines: {}, name: '', hand: 0, sensitivity: 7, alwaysRun: true, invertMouse: false, freelook: true, lookspring: false, lookstrafe: false, mForward: 1, mSide: 1, crosshair: 1, sfx: 70, music: 50, netgraph: false, clPredict: true, clShowmiss: false, viewsize: 100, rFullbright: false, rDrawentities: true, rDrawworld: true, rLerpmodels: true, rNovis: false, rSpeeds: false, mYaw: 0.022, clGun: true, conNotifytime: 3, brightness: 1.4, hostname: '', coop: false, deathmatch: false, players: 2 },
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
  check(con.complete('pl') === 'players ' && con.complete('ki') === 'kick ', 'Tab completes players and kick');
  delete host.listPlayers; delete host.kick;
}

// the menus from the console (M_Init's commands): each menu_* word opens its menu through the host, so a key bound to one opens it
{
  const opened = []; let menusReady = false;
  host.openMenu = (name) => { if (!menusReady) return false; opened.push(name); return true; };
  await con.submit('menu_options');
  check(opened.length === 0 && status.at(-1)?.[0] === 'menu_options: the menus wait on the pak' && status.at(-1)?.[1] === true, 'before the pak is in, a menu word says the menus wait');
  menusReady = true;
  for (const w of ['menu_main', 'menu_game', 'menu_loadgame', 'menu_savegame', 'menu_options', 'menu_keys', 'menu_video', 'menu_multiplayer', 'menu_playerconfig', 'menu_credits', 'menu_quit']) await con.submit(w);
  check(opened.join() === 'main,game,loadgame,savegame,options,keys,video,multiplayer,playerconfig,credits,quit', `the eleven menu words open their menus (${opened.join(', ')})`);
  await con.submit('MENU_KEYS');
  check(opened.at(-1) === 'keys' && con.complete('menu_') === 'menu_credits ' && con.complete('menu_o') === 'menu_options ', 'case aside, and Tab completes them');
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
await con.submit('crosshair 3'); check(s.crosshair === 3, 'crosshair 3');
await con.submit('crosshair 4'); check(s.crosshair === 3 && status.at(-1)?.[1] === true, 'crosshair 4 is refused');
await con.submit('s_volume'); check(status.at(-1)?.[0] === '"s_volume" is "0.70"', 's_volume shows the effects volume as 0..1');
await con.submit('s_volume 0.25'); check(s.sfx === 25 && last() === 'set sfx 25', 's_volume 0.25 sets it as a percentage through the page');
await con.submit('cd_volume 2'); check(s.music === 100 && status.at(-1)?.[0] === '"cd_volume" is "1.00"', 'cd_volume clamps to 1');
await con.submit('netgraph'); check(status.at(-1)?.[0] === '"netgraph" is "0"', 'netgraph shows 0 by default');
await con.submit('netgraph 1'); check(s.netgraph === true && last() === 'set netgraph true' && status.at(-1)?.[0] === '"netgraph" is "1"', 'netgraph 1 turns the graph on through the page');
await con.submit('netgraph 2'); check(s.netgraph === true && status.at(-1)?.[0] === 'netgraph takes 0 or 1' && status.at(-1)?.[1] === true, 'netgraph 2 is refused');
await con.submit('netgraph 0'); check(s.netgraph === false, 'netgraph 0 turns it off');
await con.submit('cvarlist');
check(/^name "" · hand "2" · sensitivity "20" · cl_run "1" · m_pitch "0.022" · crosshair "3" · s_volume "0.25" · cd_volume "1.00" · freelook "1" · lookspring "0" · lookstrafe "0" · m_forward "1" · m_side "1" · netgraph "0" · cl_predict "1" · cl_showmiss "0" · viewsize "100" · r_fullbright "0" · r_drawentities "1" · r_drawworld "1" · r_lerpmodels "1" · r_novis "0" · r_speeds "0" · m_yaw "0.022" · cl_gun "1" · con_notifytime "3" · vid_gamma "1.4" · hostname "" · fov "160" · skill "/.test(status.at(-1)?.[0] ?? ''), `cvarlist lists them with their values (${status.at(-1)?.[0]})`);
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
// m_yaw (the turn a count), cl_gun (the view weapon) and con_notifytime (the notify lines' seconds)
await con.submit('m_yaw'); check(status.at(-1)?.[0] === '"m_yaw" is "0.022"', 'm_yaw shows 0.022 by default');
await con.submit('m_yaw 0.044'); check(s.mYaw === 0.044 && last() === 'set mYaw 0.044', 'm_yaw 0.044 doubles the turn a count');
await con.submit('m_yaw x'); check(s.mYaw === 0.044 && status.at(-1)?.[1] === true, 'm_yaw x is refused');
await con.submit('cl_gun 0'); check(s.clGun === false && last() === 'set clGun false', 'cl_gun 0 draws no view weapon');
await con.submit('cl_gun 2'); check(s.clGun === false && status.at(-1)?.[0] === 'cl_gun takes 0 or 1' && status.at(-1)?.[1] === true, 'cl_gun 2 is refused');
await con.submit('con_notifytime 1.5'); check(s.conNotifytime === 1.5 && last() === 'set conNotifytime 1.5', 'con_notifytime 1.5 shortens the notify lines\' stay');
await con.submit('con_notifytime -1'); check(s.conNotifytime === 1.5 && status.at(-1)?.[0] === 'con_notifytime takes seconds, 0 to 60' && status.at(-1)?.[1] === true, 'con_notifytime -1 is refused');
Object.assign(s, { mYaw: 0.022, clGun: true, conNotifytime: 3 });
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
  host.userInfo = () => ({ name: 'Ace', hand: 1, fov: 90, spectator: 0 });
  host.status = () => ({ map: 'demo1', rows: [{ num: 1, score: 3, ping: 0, name: 'Ace' }, { num: 2, score: 1, ping: 12, name: 'player 2' }] });
  await con.submit('serverinfo');
  check(status.at(-1)?.[0] === 'Server info settings: mapname "demo1" · deathmatch "0" · coop "1" · dmflags "0" · fraglimit "0" · timelimit "0" · cheats "0" · skill "2"', 'serverinfo lists the game\'s cvars as Info_Print listed them');
  await con.submit('userinfo');
  check(status.at(-1)?.[0] === 'User info settings: name "Ace" · hand "1" · fov "90" · spectator "0"', 'userinfo lists this page\'s userinfo');
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
Object.assign(s, { name: '', hand: 0, sensitivity: 7, alwaysRun: true, invertMouse: false, freelook: true, lookspring: false, lookstrafe: false, mForward: 1, mSide: 1, crosshair: 1, sfx: 70, music: 50, netgraph: false, clPredict: true, clShowmiss: false, viewsize: 100, rFullbright: false, rDrawentities: true, rDrawworld: true, rLerpmodels: true, rNovis: false, rSpeeds: false, mYaw: 0.022, clGun: true, conNotifytime: 3, brightness: 1.4, hostname: '', coop: false, deathmatch: false, players: 2 });

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
  check(lines[0].startsWith('//') && lines[1] === 'unbindall' && lines[2] === 'bind k "+attack"' && lines[3] === 'bind MOUSE2 "+attack"' && lines.includes('bind MWHEELDOWN "weapnext"') && !lines.some((l) => l.includes('"+moveup"'))
    && godAt > 3 && godAt < setAt && lines[godAt + 1] === 'bind MOUSE3 "say hello"'
    && lines.includes('set name "Ace Rimmer"') && lines.includes('set sensitivity "5"') && lines.includes('set m_pitch "-0.022"') && lines.includes('set s_volume "0.70"') && lines.includes('set fov "160"') && lines.includes('set skill "2"') && lines.includes('set freelook "1"') && lines.includes('set lookspring "0"') && lines.includes('set viewsize "100"') && lines.includes('set vid_gamma "1.4"') && lines.includes('set hostname ""') && !lines.some((l) => l.startsWith('set netgraph') || l.startsWith('set m_forward') || l.startsWith('set m_side') || l.startsWith('set cl_predict') || l.startsWith('set cl_showmiss') || l.startsWith('set r_') || l.startsWith('set m_yaw') || l.startsWith('set cl_gun') || l.startsWith('set con_notifytime')) && cfg.endsWith('\n'),
    'writeConfig writes unbindall, a bind line a key in the actions\' order, the keys bound to lines after them, and a set line a cvar, as config.cfg had them (netgraph, m_forward, m_side, m_yaw, cl_gun, con_notifytime, cl_predict, cl_showmiss and the r_ switches, not archived, left out)');
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
  Object.assign(s, { name: '', hand: 0, sensitivity: 7, alwaysRun: true, invertMouse: false, crosshair: 1, sfx: 70, music: 50 });
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
