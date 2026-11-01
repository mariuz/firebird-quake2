// settings-test.mjs – the page's settings (src/settings.js): defaults, the round trip through storage, and
// what storage hands back checked against what each setting can be.
//   node scripts/settings-test.mjs

import { loadSettings, saveSettings, viewSize, DEFAULTS, OPTIONS_RESET, VIDEO_RESET, KEY } from '../src/settings.js';

let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const store = (text) => { const m = new Map(text === undefined ? [] : [[KEY, text]]); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };

check(JSON.stringify(loadSettings(store())) === JSON.stringify(DEFAULTS), 'nothing stored: the defaults');
check(JSON.stringify(loadSettings(null)) === JSON.stringify(DEFAULTS), 'no storage at all (a blocked one): the defaults');
check(JSON.stringify(loadSettings(store('{not json'))) === JSON.stringify(DEFAULTS), 'what is stored is not JSON: the defaults');
check(JSON.stringify(loadSettings(store('null'))) === JSON.stringify(DEFAULTS) && JSON.stringify(loadSettings(store('[1,2]'))) === JSON.stringify(DEFAULTS), 'JSON that is not an object: the defaults');

const s = store();
const mine = { ...DEFAULTS, map: 'demo2', detail: 'ultra', fov: 110, skill: 2, renderer: 'sql', alwaysRun: false, sensitivity: 4.5, brightness: 1.7, crosshair: 3 };
saveSettings(mine, s);
check(JSON.stringify(loadSettings(s)) === JSON.stringify(mine), 'what is saved comes back as it was');

const bad = loadSettings(store(JSON.stringify({ fov: 500, detail: 'bogus', skill: 7, sfx: -3, renderer: 'gl', alwaysRun: 'yes', map: '../x', sensitivity: NaN, crosshair: 1.5, extra: 1 })));
check(bad.fov === 90 && bad.detail === 'high' && bad.skill === 1 && bad.sfx === 70 && bad.renderer === 'fast' && bad.alwaysRun === true && bad.map === 'demo1' && bad.sensitivity === 7 && bad.crosshair === 1,
  'an out-of-range or wrongly typed value falls back to its default, one by one');
check(!('extra' in bad), 'an unknown key is dropped');
const half = loadSettings(store(JSON.stringify({ fov: 120, detail: 'nope' })));
check(half.fov === 120 && half.detail === 'high', 'a good value next to a bad one is kept');
check(loadSettings(store(JSON.stringify({ fov: 1 }))).fov === 1 && loadSettings(store(JSON.stringify({ fov: 160 }))).fov === 160 && loadSettings(store(JSON.stringify({ fov: 161 }))).fov === 90, 'fov is 1 to 160, as ClientUserinfoChanged clamped it');

// the player setup: a name of at most 15 printable characters (empty by default: the game says "player 1"), a hand of 0 to 2
check(DEFAULTS.name === '' && DEFAULTS.hand === 0 && loadSettings(store(JSON.stringify({ name: 'Ace', hand: 2 }))).name === 'Ace' && loadSettings(store(JSON.stringify({ name: 'Ace', hand: 2 }))).hand === 2
  && loadSettings(store(JSON.stringify({ name: 'sixteen chars...!', hand: 3 }))).name === '' && loadSettings(store(JSON.stringify({ name: 'bad\nname', hand: -1 }))).hand === 0
  && loadSettings(store(JSON.stringify({ name: 42 }))).name === ''
  && DEFAULTS.gender === 'male' && loadSettings(store(JSON.stringify({ gender: 'female' }))).gender === 'female' && loadSettings(store(JSON.stringify({ gender: 'bad word' }))).gender === 'male' && loadSettings(store(JSON.stringify({ gender: 3 }))).gender === 'male'
  && DEFAULTS.msg === 1 && loadSettings(store(JSON.stringify({ msg: 3 }))).msg === 3 && loadSettings(store(JSON.stringify({ msg: 4 }))).msg === 1,
  'the name is kept up to 15 printable characters (longer, a control character or a number fall back to none), the hand 0 to 2, the gender a word (male by default), the msg level 0 to 3 (1)');
check(loadSettings(store(JSON.stringify({ skill: 3 }))).skill === 3 && loadSettings(store(JSON.stringify({ skill: 4 }))).skill === 1, 'the skill goes up to 3, nightmare (the console\'s), and no further');
check(viewSize({ detail: 'low' }).join('x') === '160x120' && viewSize({ detail: 'ultra' }).join('x') === '640x480' && viewSize({ detail: '?' }).join('x') === '320x240', 'the video modes, 320×240 for anything else');
check(Object.entries(OPTIONS_RESET).every(([k, v]) => DEFAULTS[k] === v) && Object.entries(VIDEO_RESET).every(([k, v]) => k === 'fullscreen' || DEFAULTS[k] === v), 'the menus\' resets put back the defaults');

check(DEFAULTS.players === 2 && loadSettings(store(JSON.stringify({ players: 4 }))).players === 4 && loadSettings(store(JSON.stringify({ players: 5 }))).players === 2 && loadSettings(store(JSON.stringify({ players: 1 }))).players === 2,
  'the players at this page are two to four (one is no coop at all)');

// the key bindings: stored as an object of arrays, each checked
const binds = loadSettings(store(JSON.stringify({ binds: { attack: ['KeyK'], forward: ['KeyW', 'KeyK', 'KeyJ'], back: 'KeyS', left: [], right: ['Arrow Right', 'ShiftLeft'], bogus: ['KeyB'] } }))).binds;
check(binds.attack.join() === 'KeyK' && binds.forward.join() === 'KeyW' && binds.back.join() === 'KeyS,ArrowDown' && binds.left.length === 0 && binds.right.join() === 'Shift' && !('bogus' in binds)
  && binds.moveup.join() === 'Space',
  'the binds come back checked: a key bound twice keeps its first action, a third key is dropped, a bad list keeps the default, a bad code is skipped, a side-key is the key, an unknown action is dropped, a missing one is its default');
check(loadSettings(store(JSON.stringify({ binds: 'none' }))).binds.attack.join() === 'Control,Mouse1' && loadSettings(store()).binds !== DEFAULTS.binds, 'binds that are not an object are the defaults, and the defaults a fresh copy');
check(loadSettings(store(JSON.stringify({ binds: { moveup: ['Mouse2', 'Mouse3'], weapprev: ['MWheelDown'] } }))).binds.moveup.join() === 'Mouse2,Mouse3' && DEFAULTS.binds.weapprev.join() === 'MWheelUp',
  'the mouse buttons and the wheel are keys the binds keep (the wheel up the previous weapon by default)');
const fresh = loadSettings(store());
fresh.binds.attack.push('KeyZ');
check(DEFAULTS.binds.attack.length === 2, 'editing a loaded bind leaves the defaults alone');
// the keys bound to command lines (bind k god): key code → the line, each checked; a key an action holds runs no line
const lines = loadSettings(store(JSON.stringify({ binds: { attack: ['KeyK'] }, lines: { KeyK: 'god', KeyJ: 'say hello', AltLeft: 'kill', 'Key J': 'x', KeyL: 'bad\nline', KeyM: 'x'.repeat(129), KeyN: 7, KeyO: '  give all  ' } }))).lines;
check(JSON.stringify(lines) === JSON.stringify({ KeyJ: 'say hello', KeyO: 'give all' }) && JSON.stringify(DEFAULTS.lines) === '{"End":"centerview","Minus":"sizedown","Equal":"sizeup"}',
  `the lines come back checked: a key an action holds (ALT, sidestep's) drops its line, a bad code, a control character, a line past 128 characters or a number is skipped, the rest trimmed; END centerview, - sizedown and = sizeup by default, as default.cfg had them (${JSON.stringify(lines)})`);
check(JSON.stringify(loadSettings(store(JSON.stringify({ lines: ['god'] }))).lines) === '{"End":"centerview","Minus":"sizedown","Equal":"sizeup"}' && JSON.stringify(loadSettings(store(JSON.stringify({ lines: 'god' }))).lines) === '{"End":"centerview","Minus":"sizedown","Equal":"sizeup"}' && JSON.stringify(loadSettings(store(JSON.stringify({ lines: {} }))).lines) === '{}',
  'lines that are not an object are the default, an empty object none (END unbound stays so)');
fresh.lines.KeyZ = 'god';
check(!('KeyZ' in DEFAULTS.lines) && !('KeyZ' in loadSettings(store()).lines), 'editing loaded lines leaves the defaults alone');

// the ICE server (rtc_ice at the console): none by default; a url, or a url with a user and a password; anything else is none
check(DEFAULTS.rtcIce === '' && loadSettings(store(JSON.stringify({ rtcIce: 'turn:relay.example.org:3478 ace secret' }))).rtcIce === 'turn:relay.example.org:3478 ace secret'
  && loadSettings(store(JSON.stringify({ rtcIce: 'stun:stun.example.org' }))).rtcIce === 'stun:stun.example.org'
  && loadSettings(store(JSON.stringify({ rtcIce: 'http://relay' }))).rtcIce === '' && loadSettings(store(JSON.stringify({ rtcIce: 'turn:relay ace' }))).rtcIce === '' && loadSettings(store(JSON.stringify({ rtcIce: 7 }))).rtcIce === '',
  'the ICE server setting is kept as a url, or a url with a user and a password; another scheme, two words or a number fall back to none');
// the painter's mip cap and scale and the stipple: within their ranges, else the defaults
check(DEFAULTS.swMipcap === 0 && DEFAULTS.swMipscale === 1 && DEFAULTS.swStipplealpha === false && loadSettings(store(JSON.stringify({ swMipcap: 3, swMipscale: 2.5, swStipplealpha: true }))).swMipcap === 3
  && loadSettings(store(JSON.stringify({ swMipcap: 3, swMipscale: 2.5, swStipplealpha: true }))).swMipscale === 2.5 && loadSettings(store(JSON.stringify({ swStipplealpha: true }))).swStipplealpha === true
  && loadSettings(store(JSON.stringify({ swMipcap: 4, swMipscale: 11, swStipplealpha: 1 }))).swMipcap === 0 && loadSettings(store(JSON.stringify({ swMipscale: 11 }))).swMipscale === 1 && loadSettings(store(JSON.stringify({ swStipplealpha: 1 }))).swStipplealpha === false,
  'sw_mipcap 0 to 3, sw_mipscale 0 to 10 and sw_stipplealpha a boolean come back, anything else is the default');
// V_RenderView's switches on by default and its tests off, booleans
check(DEFAULTS.clAddEntities === true && DEFAULTS.clAddParticles === true && DEFAULTS.clAddLights === true && DEFAULTS.clAddBlend === true && DEFAULTS.clTestentities === false && DEFAULTS.clTestparticles === false && DEFAULTS.clTestlights === false && DEFAULTS.clTestblend === false
  && loadSettings(store(JSON.stringify({ clAddLights: false, clTestlights: true }))).clAddLights === false && loadSettings(store(JSON.stringify({ clAddLights: false, clTestlights: true }))).clTestlights === true
  && loadSettings(store(JSON.stringify({ clAddBlend: 0, clTestblend: 1 }))).clAddBlend === true && loadSettings(store(JSON.stringify({ clAddBlend: 0, clTestblend: 1 }))).clTestblend === false,
  'the cl_add switches come back on by default and the cl_test cvars off, anything but a boolean the default');
// s_show: a boolean, off by default
check(DEFAULTS.sShow === false && loadSettings(store(JSON.stringify({ sShow: true }))).sShow === true && loadSettings(store(JSON.stringify({ sShow: 'yes' }))).sShow === false, 's_show comes back as a boolean, anything else off');
// sv_noreload: a boolean, off by default
check(DEFAULTS.svNoreload === false && loadSettings(store(JSON.stringify({ svNoreload: true }))).svNoreload === true && loadSettings(store(JSON.stringify({ svNoreload: 1 }))).svNoreload === false, 'sv_noreload comes back as a boolean, anything else off');
// developer and logfile: booleans, off by default
check(DEFAULTS.developer === false && DEFAULTS.logfile === false && loadSettings(store(JSON.stringify({ developer: true, logfile: true }))).developer === true && loadSettings(store(JSON.stringify({ developer: true, logfile: true }))).logfile === true
  && loadSettings(store(JSON.stringify({ developer: 1, logfile: 'yes' }))).developer === false && loadSettings(store(JSON.stringify({ developer: 1, logfile: 'yes' }))).logfile === false,
  'developer and logfile come back as booleans, anything else off');
// the address book: up to nine printable texts, a bad one blank, anything else empty (and a fresh array each load)
check(DEFAULTS.addressBook.length === 0 && loadSettings(store()).addressBook.length === 0 && loadSettings(store()).addressBook !== DEFAULTS.addressBook
  && loadSettings(store(JSON.stringify({ addressBook: ['K9H2', 'http://relay:8787 AB12', 7, 'bad\nline', ...Array(9).fill('X')] }))).addressBook.join('|') === 'K9H2|http://relay:8787 AB12|||X|X|X|X|X'
  && loadSettings(store(JSON.stringify({ addressBook: 'K9H2' }))).addressBook.length === 0,
  'the address book keeps up to nine printable texts, a bad one blank, and is empty for anything else');
check(DEFAULTS.rtcSignal === '' && loadSettings(store(JSON.stringify({ rtcSignal: 'https://relay.example.org:8787' }))).rtcSignal === 'https://relay.example.org:8787'
  && loadSettings(store(JSON.stringify({ rtcSignal: 'ws://relay' }))).rtcSignal === '' && loadSettings(store(JSON.stringify({ rtcSignal: 'http://re lay' }))).rtcSignal === '' && loadSettings(store(JSON.stringify({ rtcSignal: 1 }))).rtcSignal === '',
  'the signalling relay setting is an http(s) url; another scheme, a space or a number fall back to none');

const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
let threw = false; try { saveSettings(mine, full); } catch { threw = true; }
check(!threw, 'a full storage does not throw: the settings live for the page');

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('all good');
