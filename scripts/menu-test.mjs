// menu-test.mjs – the menus (src/menu.js) without a browser: the keys move through them as Quake 2's
// did, the slots and their comments are laid out as m_menu.c had them, the settings reach the host,
// and every menu draws its pictures from the pak.
//   node scripts/menu-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pak, pic } from '../src/pak.js';
import { Menu, saveComment, PLAYERS, HANDS } from '../src/menu.js';
import { defaultBinds, bindKey } from '../src/input.js';
import { CREDITS } from '../src/credits.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
let failed = 0;
const assert = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

// a host that records what the menus ask for, and a renderer that records what they draw
const calls = [];
const settings = { sfx: 70, musicMode: 'tracks', sensitivity: 7, alwaysRun: true, invertMouse: false, freelook: true, lookspring: false, lookstrafe: false, crosshair: 1, renderer: 'fast', detail: 'high', brightness: 1.4, fullscreen: false, binds: defaultBinds(), name: '', hand: 0 };
const slots = Array.from({ length: 15 }, (_, i) => (i === 0 ? { valid: true, name: 'ENTERING Outer Base' } : i === 3 ? { valid: true, name: ' 9:05 10/ 8  Outer Base' } : { valid: false }));
const cache = new Map();
const hud = { conchars: pic(pak, 'conchars'), pic: (n) => (cache.has(n) ? cache.get(n) : (cache.set(n, pic(pak, n)), cache.get(n))) };
const host = {
  hud, playing: () => true, slots: () => slots,
  newGame: (s) => calls.push(`new ${s}`), loadSlot: (i) => calls.push(`load ${i}`), saveSlot: (i) => calls.push(`save ${i}`), downloadSlot: (i) => calls.push(`download ${i}`),
  get: (k) => settings[k], set: (k, v) => { settings[k] = v; },
  resetDefaults: () => calls.push('defaults'), resetVideo: () => calls.push('video defaults'),
  bind: (a, code) => bindKey(settings.binds, a, code), unbind: (a) => { settings.binds[a] = []; }, credits: () => CREDITS,
  console: () => calls.push('console'), quit: () => calls.push('quit'), sound: (n) => calls.push(`sound ${n}`),
  netHost: () => calls.push('net host'), netJoin: () => calls.push('net join'),
};
const drawn = [];
const r = {
  w: 320, h: 240, fb: new Uint8Array(320 * 240).fill(100),
  drawPic: (p, x, y) => drawn.push(['pic', p, x, y]), drawChar: (c, n, x, y) => drawn.push(['char', n, x, y]),
  drawString: (c, s, x, y, alt) => drawn.push(['str', s, x, y, !!alt]), fillRect: () => {},
};
const menu = new Menu(host);
const keys = (...codes) => { for (const c of codes) menu.key(c); return menu.current?.id ?? '-'; };
/** Typing, as the page's keydown gives the menu the code and the character. */
const type = (text) => { for (const ch of text) menu.key(ch === ' ' ? 'Space' : `Key${ch.toUpperCase()}`, ch); };
const draw = () => { drawn.length = 0; r.fb.fill(100); menu.draw(r, 1234); return drawn; };

// the main menu
menu.main();
draw();
const missing = drawn.filter(([k, p]) => k === 'pic' && !p).length;
assert(menu.current.id === 'main' && drawn.filter(([k]) => k === 'pic').length === 8 && missing === 0, 'the main menu draws its five items, the lit one, the spinning cursor, the plaque and the logo');
assert(r.fb.filter((b) => b === 0).length === 320 * 240 * 3 / 4, 'the game behind is stippled out, three pixels in four (Draw_FadeScreen)');
assert(keys('ArrowUp') === 'main' && menu.mainCursor === 4 && keys('ArrowDown') === 'main' && menu.mainCursor === 0, 'up from game wraps to quit, down comes back');

// the game menu: a new game at a skill
assert(keys('Enter') === 'game', 'Enter on game opens the game menu');
draw();
const easy = drawn.find(([k, s]) => k === 'str' && s === 'easy');
assert(easy && easy[2] === 160 - 16 && !easy[4], `its items are left-justified at the centre less 16, in the plain font (easy at ${easy?.[2]})`);
keys('ArrowDown', 'ArrowDown', 'ArrowDown');
assert(menu.current.cursor === 4, `the cursor steps over the blank line to the players spin (${menu.current.cursor})`);
draw();
assert(drawn.some(([k, s]) => k === 'str' && s === 'one'), 'the players spin shows one player');
keys('ArrowRight');
assert(settings.players === 1, 'turned, it asks the host for a coop game of two');
keys('ArrowRight', 'ArrowRight');
assert(settings.players === 3, 'turned twice more, four in coop');
keys('ArrowRight');
assert(settings.players === 4, 'then a deathmatch of two');
keys('ArrowRight', 'ArrowRight', 'ArrowRight');
assert(settings.players === 6 && PLAYERS.length === 7 && PLAYERS[6] === 'four (deathmatch)', 'up to a deathmatch of four, and no further');
for (let i = 0; i < 6; i++) keys('ArrowLeft');
assert(settings.players === 0, 'and back for one player');
keys('ArrowDown');
assert(menu.current.cursor === 6, `the cursor steps over the next blank line to load game (${menu.current.cursor})`);
keys('ArrowUp', 'ArrowUp', 'ArrowUp', 'Enter');
assert(calls.includes('new 1') && !menu.active, 'medium starts a new game at skill 1 and puts the menu away');

// load and save
menu.mainCursor = 0; menu.main(); keys('Enter', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
assert(menu.current.id === 'load', 'load game opens the fifteen slots');
draw();
const lines = drawn.filter(([k, s]) => k === 'str' && !s.startsWith('enter loads')).map(([, s, , y]) => [s, y]);   // (the slots, the status bar aside)
assert(lines.length === 15 && lines[0][0] === 'ENTERING Outer Base' && lines[1][0] === '<EMPTY>' && lines[1][1] - lines[0][1] === 20 && lines[2][1] - lines[1][1] === 10,
  'the autosave first, ten units further apart than the rest, the empty slots <EMPTY>');
// this port's d: a slot with a game is written as a file, the menu staying up; an empty slot gives nothing
keys('ArrowDown', 'KeyD');
assert(!calls.some((c) => c.startsWith('download')) && menu.current.id === 'load', 'd on an empty slot writes nothing');
keys('ArrowDown', 'ArrowDown');
draw();
assert(drawn.some(([k, s]) => k === 'str' && s === 'enter loads, d writes the game as a file'), 'on a slot with a game the status bar offers d');
keys('KeyD');
assert(calls.includes('download 3') && menu.current.id === 'load' && menu.current.cursor === 3, 'd on it writes the slot as a file and the menu stays up');
keys('Enter');
assert(calls.includes('load 3') && !menu.active, 'a slot with a game loads it');
menu.mainCursor = 0; menu.main(); keys('Enter', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
assert(menu.current.id === 'save' && menu.current.items.length === 14 && menu.current.cursor === 2, `save game lists slots 1-14, its cursor following the load menu's (${menu.current.cursor})`);
keys('Enter');
assert(calls.includes('save 3'), 'and saves into the slot chosen');

// options: sliders and spin controls set the page's settings, clamped
menu.mainCursor = 0; menu.main(); keys('ArrowDown', 'ArrowDown', 'Enter');
assert(menu.current.id === 'options', 'options opens');
keys('ArrowLeft', 'ArrowLeft');
assert(settings.sfx === 50, `left on effects volume turns it down a step at a time (${settings.sfx})`);
for (let i = 0; i < 20; i++) keys('ArrowRight');
assert(settings.sfx === 100, 'and no further than the end');
keys('ArrowDown', 'ArrowLeft');
assert(settings.musicMode === 'off', 'CD music disabled turns the music off');
keys('ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowRight');
assert(settings.alwaysRun === false && settings.invertMouse === true && settings.lookspring === true && settings.lookstrafe === true && settings.freelook === false && settings.crosshair === 3,
  'always run, invert mouse, lookspring, lookstrafe, free look and the crosshair turn');
draw();
const slider = drawn.filter(([k, n]) => k === 'char' && n >= 128 && n <= 131).map(([, n]) => n);
assert(slider.filter((n) => n === 129).length === 20 && slider.includes(131), 'the sliders draw their ends, ten notches and the knob');
keys('ArrowDown', 'ArrowDown', 'Enter', 'ArrowDown', 'Enter');
assert(calls.includes('defaults') && calls.includes('console') && !menu.active, 'reset defaults, and go to console puts the menu away');

// the keys menu (M_Menu_Keys_f): every action with its keys, Enter then a key binds, Backspace unbinds
menu.mainCursor = 0; menu.main(); keys('ArrowDown', 'ArrowDown', 'Enter');
for (let i = 0; i < 9; i++) keys('ArrowDown');
keys('Enter');
assert(menu.current.id === 'keys' && menu.current.items.length === 26, `customize controls opens the keys menu with its ${menu.current?.items.length} actions`);
draw();
let rows = drawn.filter(([k]) => k === 'str');
const attack = rows.find(([, s]) => s === 'attack'), ctrl = rows.find(([, s]) => s === 'CTRL'), or = rows.find(([, s]) => s === 'or'), f = rows.find(([, s]) => s === 'MOUSE1');
assert(attack && attack[4] && ctrl && or && f && ctrl[2] === 160 + 16 && or[2] === ctrl[2] + 8 + 32 && f[2] === or[2] + 24 && attack[3] === ctrl[3],
  'attack is drawn greyed with "CTRL or MOUSE1" after the column, as DrawKeyBindingFunc laid them out');
assert(rows.find(([, s]) => s === 'walk forward')[3] - attack[3] === 27 && drawn.some(([k, p]) => k === 'pic' && p === hud.pic('m_banner_customize')), 'the rows are nine pixels apart under the customize banner (walk forward the fourth)');
assert(drawn.some(([k, s]) => k === 'str' && s === 'enter to change, backspace to clear'), 'the status bar says what to do');
keys('Enter');
draw();
assert(menu.current.grab && drawn.some(([k, n, x]) => k === 'char' && n === 61 && x === 160) && drawn.some(([k, s]) => k === 'str' && s === 'press a key or button for this action'),
  'Enter waits for a key: the cursor is an = and the status bar asks for one');
keys('KeyK');
assert(!menu.current.grab && settings.binds.attack.join() === 'KeyK' && calls.at(-1) === 'sound misc/menu3.wav', 'the key pressed binds the action (its two old keys made room, as KeyBindingFunc unbound them first)');
keys('ArrowDown', 'Enter', 'KeyK');
assert(settings.binds.weapnext.join() === 'KeyK' && settings.binds.attack.length === 0, 'bound to another action, the key takes it (its two defaults, / and the wheel, made room) and leaves the first');
keys('Enter', 'Escape');
assert(!menu.current.grab && menu.current.id === 'keys' && settings.binds.weapnext.join() === 'KeyK', 'Escape while waiting cancels and stays in the menu');
keys('Enter', 'ControlRight');
assert(settings.binds.weapnext.join() === 'KeyK,Control', 'a second key joins it (the right control as CTRL)');
keys('Enter', 'KeyJ');
assert(settings.binds.weapnext.join() === 'KeyJ', 'a third makes the two go first');
draw();
assert(drawn.some(([k, s]) => k === 'str' && s === '???'), 'an action with no key shows ???');
keys('Backspace');
assert(settings.binds.weapnext.length === 0, 'Backspace unbinds');
// a mouse button or a wheel notch while waiting binds too ("press a key or button", as KeyBindingFunc took K_MOUSE1)
keys('Enter', 'Mouse2');
assert(!menu.current.grab && settings.binds.weapnext.join() === 'Mouse2', 'a mouse button pressed while waiting binds');
keys('Enter', 'MWheelDown');
draw();
assert(settings.binds.weapnext.join() === 'Mouse2,MWheelDown' && drawn.some(([k, s]) => k === 'str' && s === 'MWHEELDOWN') && drawn.some(([k, s]) => k === 'str' && s === 'MOUSE2'), 'the wheel too, both drawn as Quake named them');
keys('Escape');
assert(menu.current.id === 'options', 'Escape goes back to options');

// the credits (M_Menu_Credits_f): the lines scroll up from the bottom, the '+' ones highlighted, Escape leaves
menu.mainCursor = 0; menu.main(); keys('Enter', 'ArrowUp', 'Enter');
assert(menu.current.id === 'credits', 'the game menu\'s last item is the credits');
drawn.length = 0; menu.draw(r, 1000);
assert(drawn.filter(([k]) => k === 'char').length === 0, 'at the start the first line is just off the bottom');
drawn.length = 0; menu.draw(r, 1000 + 40 * 60);
let chars = drawn.filter(([k]) => k === 'char');
const title = 'QUAKE II BY ID SOFTWARE';
assert(chars.length >= title.length && chars.slice(0, title.length).every(([, n], i) => n === (title.charCodeAt(i) & 127) + 128) && chars[0][2] === (320 - title.length * 8) / 2 && chars[0][3] === 240 - 60,
  '2.4 s in the title has risen 60 pixels, centred, in the highlighted font');
assert(chars.some(([, n, , y]) => n === 'J'.charCodeAt(0) && y === 240 - 60 + 30), 'the plain lines follow ten pixels apart, in the plain font');
drawn.length = 0; menu.draw(r, 1000 + 40 * (240 + 10 * host.credits().length + 20));
assert(menu.current.start > 1000, 'once the last line is off the top they start again');
keys('Space');
assert(menu.current.id === 'credits' && keys('Escape') === 'game', 'any key but Escape is ignored; Escape goes back to the game menu');

// video: cancel puts the settings back as they were
menu.mainCursor = 0; menu.main(); keys('ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
assert(menu.current.id === 'video', 'video opens');
keys('ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowRight');
assert(settings.renderer === 'sql' && settings.detail === 'ultra' && settings.brightness === 1.5, 'the driver, the video mode (up to 640×480) and the brightness change');
keys('ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
assert(settings.renderer === 'fast' && settings.detail === 'high' && settings.brightness === 1.4 && menu.current.id === 'main', 'cancel puts them back');

// multiplayer: join and start network server are the page's Join and Host (the menu goes away for the page's panel),
// greyed where the page has none; the player setup live (M_Menu_PlayerConfig_f: the name field and the handedness)
keys('ArrowUp', 'ArrowUp', 'Enter');
assert(menu.current.id === 'multiplayer' && menu.current.items.every((i) => !i.grayed) && menu.current.items[0].statusbar.startsWith('join a game over the network'),
  'multiplayer shows join and start network server live, the status bar saying where the texts go');
keys('Enter');
assert(calls.at(-2) === 'net join' && !menu.active, 'Enter on join network server is the page\'s Join, the menu gone (the move sound after)');
menu.mainCursor = 1; menu.main(); keys('Enter', 'ArrowDown', 'Enter');
assert(calls.at(-2) === 'net host' && !menu.active, 'start network server is the page\'s Host');
{
  const bare = new Menu({ ...host, netHost: undefined, netJoin: undefined });
  bare.multiplayer();
  bare.key('Enter');
  assert(bare.current.id === 'multiplayer' && bare.current.items.filter((i) => i.grayed).length === 2 && !bare.current.items[2].grayed && !calls.slice(-1).includes('net join'),
    'a page with no network has them greyed, and Enter on one does nothing');
}
menu.mainCursor = 1; menu.main(); keys('Enter');
keys('ArrowDown', 'ArrowDown', 'Enter');
assert(menu.current.id === 'player' && menu.current.items[0].type === 'field' && menu.current.cursor === 0, 'player setup opens on the name field');
draw();
const box = drawn.filter(([k, n]) => k === 'char' && n >= 18 && n <= 26);
assert(box.length === 4 + 2 * 15 && drawn.some(([k, s]) => k === 'str' && s === 'name' && drawn.find((d) => d[0] === 'str' && d[1] === 'name')[4]), `the field draws its box of frame pieces around fifteen characters (${box.length} pieces) after its label`);
type('Ace Rimmer');
assert(settings.name === 'Ace Rimmer', `typing fills the name (${JSON.stringify(settings.name)})`);
keys('Backspace', 'Backspace', 'Backspace', 'Backspace', 'Backspace', 'Backspace', 'Backspace');
assert(settings.name === 'Ace', `Backspace takes a character off (${JSON.stringify(settings.name)})`);
type('0123456789abcdef');
assert(settings.name === 'Ace012345678' && settings.name.length === 12 || settings.name.length === 15, `the name stops at fifteen characters (${settings.name.length})`);
draw();
assert(drawn.some(([k, s]) => k === 'str' && s === settings.name), 'and the field shows it');
keys('ArrowDown', 'ArrowDown', 'ArrowDown');
assert(menu.current.cursor === 3 && menu.current.items[3].type === 'spin' && menu.current.items[3].items === HANDS, 'down past the greyed model and skin reaches the handedness spin');
keys('ArrowRight');
assert(settings.hand === 1, 'right turns it to left-handed');
keys('ArrowRight', 'ArrowRight');
assert(settings.hand === 2, '... then center, and no further');
keys('ArrowLeft', 'ArrowLeft', 'ArrowLeft');
assert(settings.hand === 0, 'left back to right-handed, and no further');
keys('KeyX', 'Tab');
assert(settings.hand === 0 && menu.current.cursor === 0, 'a letter on the spin types nothing; Tab wraps to the field');
menu.key('Tab', '\t'); menu.key('Escape', 'Escape');
assert(menu.current.id === 'multiplayer' && settings.name.length === 15, 'Tab and Escape on the field are the menu\'s keys, not characters');
settings.name = ''; settings.hand = 0;
keys('Escape', 'ArrowUp', 'ArrowUp', 'Enter');
assert(menu.current.id === 'quit', 'quit shows the quit picture');
keys('KeyN');
assert(menu.current.id === 'main', 'N goes back');
keys('Enter', 'KeyY');
assert(calls.includes('quit') && !menu.active, 'Y quits');
menu.mainCursor = 0; menu.main(); keys('Escape');
assert(!menu.active && calls.includes('sound misc/menu3.wav') && calls.includes('sound misc/menu1.wav') && calls.includes('sound misc/menu2.wav'), 'Escape leaves the main menu; the menus click as Quake 2 did');

assert(saveComment('Outer Base', true) === 'ENTERING Outer Base' && saveComment('Outer Base', false, new Date(2026, 9, 8, 9, 5)) === ' 9:05 10/ 8  Outer Base',
  'the save comments are SV_WriteServerFile\'s');

console.log(failed ? `${failed} FAILED` : 'all good');
process.exit(failed ? 1 : 0);
