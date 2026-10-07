// menu-test.mjs – the menus (src/menu.js) without a browser: the keys move through them as Quake 2's
// did, the slots and their comments are laid out as m_menu.c had them, the settings reach the host,
// and every menu draws its pictures from the pak.
//   node scripts/menu-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pak, pic } from '../src/pak.js';
import { Menu, saveComment } from '../src/menu.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
let failed = 0;
const assert = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

// a host that records what the menus ask for, and a renderer that records what they draw
const calls = [];
const settings = { sfx: 70, musicMode: 'tracks', sensitivity: 7, alwaysRun: true, invertMouse: false, crosshair: 1, renderer: 'fast', detail: 'high', brightness: 1.4, fullscreen: false };
const slots = Array.from({ length: 15 }, (_, i) => (i === 0 ? { valid: true, name: 'ENTERING Outer Base' } : i === 3 ? { valid: true, name: ' 9:05 10/ 8  Outer Base' } : { valid: false }));
const cache = new Map();
const hud = { conchars: pic(pak, 'conchars'), pic: (n) => (cache.has(n) ? cache.get(n) : (cache.set(n, pic(pak, n)), cache.get(n))) };
const host = {
  hud, playing: () => true, slots: () => slots,
  newGame: (s) => calls.push(`new ${s}`), loadSlot: (i) => calls.push(`load ${i}`), saveSlot: (i) => calls.push(`save ${i}`),
  get: (k) => settings[k], set: (k, v) => { settings[k] = v; },
  resetDefaults: () => calls.push('defaults'), resetVideo: () => calls.push('video defaults'),
  console: () => calls.push('console'), quit: () => calls.push('quit'), sound: (n) => calls.push(`sound ${n}`),
};
const drawn = [];
const r = {
  w: 320, h: 240, fb: new Uint8Array(320 * 240).fill(100),
  drawPic: (p, x, y) => drawn.push(['pic', p, x, y]), drawChar: (c, n, x, y) => drawn.push(['char', n, x, y]),
  drawString: (c, s, x, y, alt) => drawn.push(['str', s, x, y, !!alt]), fillRect: () => {},
};
const menu = new Menu(host);
const keys = (...codes) => { for (const c of codes) menu.key(c); return menu.current?.id ?? '-'; };
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
assert(menu.current.cursor === 4, `the cursor steps over the blank line to load game (${menu.current.cursor})`);
keys('ArrowUp', 'ArrowUp', 'Enter');
assert(calls.includes('new 1') && !menu.active, 'medium starts a new game at skill 1 and puts the menu away');

// load and save
menu.mainCursor = 0; menu.main(); keys('Enter', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
assert(menu.current.id === 'load', 'load game opens the fifteen slots');
draw();
const lines = drawn.filter(([k]) => k === 'str').map(([, s, , y]) => [s, y]);
assert(lines.length === 15 && lines[0][0] === 'ENTERING Outer Base' && lines[1][0] === '<EMPTY>' && lines[1][1] - lines[0][1] === 20 && lines[2][1] - lines[1][1] === 10,
  'the autosave first, ten units further apart than the rest, the empty slots <EMPTY>');
keys('ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
assert(calls.includes('load 3') && !menu.active, 'a slot with a game loads it');
menu.mainCursor = 0; menu.main(); keys('Enter', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
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
keys('ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowRight');
assert(settings.alwaysRun === false && settings.invertMouse === true && settings.crosshair === 3, 'always run, invert mouse and the crosshair turn');
draw();
const slider = drawn.filter(([k, n]) => k === 'char' && n >= 128 && n <= 131).map(([, n]) => n);
assert(slider.filter((n) => n === 129).length === 20 && slider.includes(131), 'the sliders draw their ends, ten notches and the knob');
keys('ArrowDown', 'Enter', 'ArrowDown', 'Enter');
assert(calls.includes('defaults') && calls.includes('console') && !menu.active, 'reset defaults, and go to console puts the menu away');

// video: cancel puts the settings back as they were
menu.mainCursor = 0; menu.main(); keys('ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
assert(menu.current.id === 'video', 'video opens');
keys('ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowRight');
assert(settings.renderer === 'sql' && settings.detail === 'low' && settings.brightness === 1.5, 'the driver, the video mode and the brightness change');
keys('ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
assert(settings.renderer === 'fast' && settings.detail === 'high' && settings.brightness === 1.4 && menu.current.id === 'main', 'cancel puts them back');

// multiplayer and quit
keys('ArrowUp', 'ArrowUp', 'Enter');
assert(menu.current.id === 'multiplayer' && menu.current.items.every((i) => i.grayed), 'multiplayer shows its items greyed');
keys('Enter');
assert(menu.current.id === 'multiplayer', '... which do nothing');
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
