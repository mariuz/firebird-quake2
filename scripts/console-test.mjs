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
  settings: { fov: 90 },
  saveSettings: () => calls.push(['saveSettings']),
  setStatus: (msg, isError = false) => status.push([msg, isError]),
  startMap: async (name) => calls.push(['startMap', name]),
  setView: async (fov) => calls.push(['setView', fov]),
  saveGame: async () => calls.push(['saveGame']),
  loadGame: async () => calls.push(['loadGame']),
  toggleInventory: () => calls.push(['inven']),
  isRunning: () => running,
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
host.db.query = async () => { throw new Error('boom'); };
await con.submit('kill');
check(status.at(-1)?.[0] === 'kill: boom' && status.at(-1)?.[1] === true, 'an error from the game is shown with the command');

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
