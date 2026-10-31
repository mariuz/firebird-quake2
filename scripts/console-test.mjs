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
  settings: { fov: 90, skill: 1, binds: defaultBinds(), name: '', hand: 0, sensitivity: 7, alwaysRun: true, invertMouse: false, crosshair: 1, sfx: 70, music: 50 },
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
await con.submit('cvarlist');
check(/^name "" · hand "2" · sensitivity "20" · cl_run "1" · m_pitch "0.022" · crosshair "3" · s_volume "0.25" · cd_volume "1.00" · fov "160" · skill "/.test(status.at(-1)?.[0] ?? ''), `cvarlist lists them with their values (${status.at(-1)?.[0]})`);
Object.assign(s, { name: '', hand: 0, sensitivity: 7, alwaysRun: true, invertMouse: false, crosshair: 1, sfx: 70, music: 50 });

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
  const cfg = writeConfig({ ...s, name: 'Ace Rimmer', sensitivity: 5, invertMouse: true, binds: { ...defaultBinds(), attack: ['KeyK', 'Mouse2'], moveup: [] } });
  const lines = cfg.split('\n');
  check(lines[0].startsWith('//') && lines[1] === 'unbindall' && lines[2] === 'bind k "+attack"' && lines[3] === 'bind MOUSE2 "+attack"' && lines.includes('bind MWHEELDOWN "weapnext"') && !lines.some((l) => l.includes('"+moveup"'))
    && lines.includes('set name "Ace Rimmer"') && lines.includes('set sensitivity "5"') && lines.includes('set m_pitch "-0.022"') && lines.includes('set s_volume "0.70"') && lines.includes('set fov "160"') && lines.includes('set skill "2"') && cfg.endsWith('\n'),
    'writeConfig writes unbindall, a bind line a key in the actions\' order and a set line a cvar, as config.cfg had them');
  let downloaded = null;
  host.download = (name, text) => { downloaded = { name, text }; };
  await con.submit('writeconfig');
  check(downloaded?.name === 'config.cfg' && downloaded.text === writeConfig(host.settings) && status.at(-1)?.[0] === 'config.cfg written', 'writeconfig downloads config.cfg');
  let picked = 0;
  host.execConfig = () => { picked++; };
  await con.submit('exec');
  check(picked === 1, 'exec opens the Config picker');
  s.sensitivity = 7; s.name = ''; s.invertMouse = false; host.settings.binds = defaultBinds();
  const n = await con.execText(cfg + '\n// a comment\n\nset fov 100 // trailing\nbind nosuch +attack\n');
  check(n === lines.length && s.name === 'Ace Rimmer' && s.sensitivity === 5 && s.invertMouse === true && host.settings.fov === 100 && host.settings.binds.attack.join() === 'KeyK,Mouse2' && host.settings.binds.moveup.length === 0,
    `exec runs a config's lines (${n}): the comments and blanks skipped, the quotes off, a bad key refused and the rest run`);
  await con.submit('set');
  check(status.at(-1)?.[0] === 'usage: set <variable> <value>' && status.at(-1)?.[1] === true, 'set alone shows its usage');
  await con.submit('set bogus 1');
  check(status.at(-1)?.[0] === '"bogus" is not a cvar this page keeps' && status.at(-1)?.[1] === true, 'set on a cvar the page has not is refused');
  host.settings.fov = 160; host.settings.binds = defaultBinds();
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
await con.submit('bind k nosuch');
check(binds.attack.join() === 'KeyJ' && /"nosuch" is not a command this page binds: \+attack, weapnext/.test(status.at(-1)?.[0] ?? '') && status.at(-1)?.[1] === true, 'a command the page has not is refused, the commands listed');
await con.submit('bind zz +attack');
check(binds.attack.join() === 'KeyJ' && status.at(-1)?.[0] === '"zz" isn\'t a valid key' && status.at(-1)?.[1] === true, 'a key that is not one is refused');
await con.submit('bind m');
check(status.at(-1)?.[0] === '"m" is not bound', 'a key with no binding says so');
await con.submit('bindlist');
check(status.at(-1)?.[0].startsWith('j "+attack" · / "weapnext" · MWHEELDOWN "weapnext" · MWHEELUP "weapprev" · UPARROW "weapprev"') && status.at(-1)?.[0].includes('MOUSE2 "use power shield"'), 'bindlist shows every key bound with its command, in the actions\' order');
await con.submit('unbind');
check(status.at(-1)?.[0] === 'unbind <key> : remove commands from a key' && status.at(-1)?.[1] === true, 'unbind alone shows its usage');
await con.submit('unbind j');
check(binds.attack.length === 0 && last() === 'saveSettings' && status.at(-1)?.[0] === '"j" unbound', 'unbind j takes the key off');
await con.submit('unbindall');
check(ACTIONS.every((a) => binds[a.id].length === 0) && status.at(-1)?.[0] === 'all keys unbound', 'unbindall empties every action');
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
