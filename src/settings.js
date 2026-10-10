// settings.js – the page's settings: their defaults, the video modes, what the menus' "reset" puts back,
// and their round trip through localStorage, with what comes back checked against what each setting
// can be (an old or hand-edited value falls back to its default instead of reaching the game).
// Pure but for the storage passed in, so the tests drive it with a plain object.

export const KEY = 'firebird-quake2:settings';

export const DEFAULTS = Object.freeze({ map: 'demo1', detail: 'high', sfx: 70, music: 50, musicMode: 'tracks', skill: 1, fov: 90,
  renderer: 'fast', brightness: 1.4, alwaysRun: true, sensitivity: 7, invertMouse: false, crosshair: 1 });

// the options menu's "reset defaults" and the video menu's "reset" (M_Menu_Options_f, VID_MenuInit)
export const OPTIONS_RESET = Object.freeze({ sfx: 70, musicMode: 'tracks', sensitivity: 7, alwaysRun: true, invertMouse: false, crosshair: 1 });
export const VIDEO_RESET = Object.freeze({ renderer: 'fast', detail: 'high', brightness: 1.4, fullscreen: false });

/** The video modes the page offers (the detail setting), as [width, height]. */
export const DETAIL = Object.freeze({ low: [160, 120], high: [320, 240], ultra: [640, 480] });
export const viewSize = (settings) => DETAIL[settings.detail] ?? DETAIL.high;

const num = (lo, hi) => (v) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
const int = (lo, hi) => (v) => (Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
const oneOf = (...xs) => (v) => (xs.includes(v) ? v : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
// what each setting may be: the range ClientUserinfoChanged clamped fov to, the menus' sliders' ends, the selects' options
const CHECK = {
  map: (v) => (typeof v === 'string' && /^[a-z0-9_]{1,32}$/i.test(v) ? v : undefined),
  detail: oneOf(...Object.keys(DETAIL)),
  sfx: int(0, 100), music: int(0, 100),
  musicMode: oneOf('tracks', 'synth', 'off'),
  skill: oneOf(0, 1, 2),
  fov: int(1, 160),
  renderer: oneOf('fast', 'sql'),
  brightness: num(0.5, 3),
  alwaysRun: bool, invertMouse: bool,
  sensitivity: num(1, 20),
  crosshair: int(0, 3),
};

/** The settings as stored, each checked; anything missing, unknown or out of its range is its default. */
export function loadSettings(storage) {
  let stored = {};
  try { stored = JSON.parse(storage?.getItem(KEY) || '{}') ?? {}; } catch { stored = {}; }
  const out = { ...DEFAULTS };
  if (stored && typeof stored === 'object') {
    for (const [k, check] of Object.entries(CHECK)) {
      const v = check(stored[k]);
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

export function saveSettings(settings, storage) {
  try { storage?.setItem(KEY, JSON.stringify(settings)); } catch { /* full or blocked: the settings live for this page */ }
}
