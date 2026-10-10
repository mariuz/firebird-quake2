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

check(viewSize({ detail: 'low' }).join('x') === '160x120' && viewSize({ detail: 'ultra' }).join('x') === '640x480' && viewSize({ detail: '?' }).join('x') === '320x240', 'the video modes, 320×240 for anything else');
check(Object.entries(OPTIONS_RESET).every(([k, v]) => DEFAULTS[k] === v) && Object.entries(VIDEO_RESET).every(([k, v]) => k === 'fullscreen' || DEFAULTS[k] === v), 'the menus\' resets put back the defaults');

const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
let threw = false; try { saveSettings(mine, full); } catch { threw = true; }
check(!threw, 'a full storage does not throw: the settings live for the page');

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('all good');
