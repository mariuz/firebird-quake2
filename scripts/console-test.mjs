// console-test.mjs – the console line headless (src/console.js): the page's own commands reach the host,
// the rest reach player_command, the history steps and forgets as Key_Console's did, Tab completes.
//   node scripts/console-test.mjs

import { Console, COMMANDS } from '../src/console.js';

let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

const calls = [];
const status = [];
const host = {
  db: { query: async (sql, params = []) => { calls.push(['query', sql.slice(0, 40), ...params]); return { rows: [{ S: 12345, R: 999 }] }; } },
  pak: { has: (p) => p === 'maps/demo2.bsp' },
  settings: { fov: 90, skill: 1 },
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
