// settings.js – the page's settings: their defaults, the video modes, what the menus' "reset" puts back,
// and their round trip through localStorage, with what comes back checked against what each setting
// can be (an old or hand-edited value falls back to its default instead of reaching the game).
// Pure but for the storage passed in, so the tests drive it with a plain object.

import { ACTIONS, DEFAULT_BINDS, DEFAULT_LINES, defaultBinds, defaultLines, normalizeKey, checkLine } from './input.js';

export const KEY = 'firebird-quake2:settings';

export const DEFAULTS = Object.freeze({ map: 'demo1', detail: 'high', sfx: 70, music: 50, musicMode: 'tracks', cdLoopcount: 4, cdLooptrack: 11, cdNocd: false, skill: 1, fov: 90,
  renderer: 'fast', brightness: 1.4, alwaysRun: true, sensitivity: 7, invertMouse: false, freelook: true, lookspring: false, lookstrafe: false, mForward: 1, mSide: 1, mFilter: false,
  crosshair: 1, clPredict: true, clShowmiss: false, clAddEntities: true, clAddParticles: true, clAddLights: true, clAddBlend: true, clTestentities: false, clTestparticles: false, clTestlights: false, clTestblend: false, viewsize: 100, rFullbright: false, rDrawentities: true, rDrawworld: true, rLerpmodels: true, rNovis: false, rLockpvs: false, rSpeeds: false, rDspeeds: false, hostSpeeds: false, swDrawflat: false, swWaterwarp: true, swClearcolor: 0, swMipcap: 0, swMipscale: 1, swStipplealpha: false, developer: false, logfile: false, logStats: false, svNoreload: false, sShow: false, inJoystick: true, sKhz: 44, clShownet: 0, clShowclamp: false, showpackets: false, showdrop: false,
  mYaw: 0.022, clGun: true, conNotifytime: 3, hostname: '', password: '', spectatorPassword: '', rconPassword: '',
  clYawspeed: 140, clPitchspeed: 150, clAnglespeedkey: 1.5, clForwardspeed: 200, clSidespeed: 200, clUpspeed: 200, timeout: 125, clTimeout: 120,
  gunX: 0, gunY: 0, gunZ: 0, scrCentertime: 2.5, clFootsteps: true, scrShowpause: true, scrShowturtle: false, clMaxfps: 90,
  coop: false, deathmatch: false,
  dmflags: 0, fraglimit: 0, timelimit: 0, cheats: 0, players: 2, binds: DEFAULT_BINDS, lines: DEFAULT_LINES, name: '', hand: 0, gender: 'male', msg: 1, rate: 500000, skin: 'male/grunt', rtcIce: '', rtcSignal: '', addressBook: Object.freeze([]), netgraph: false, timegraph: false, debuggraph: false, graphheight: 32, graphscale: 1, graphshift: 0 });

// the options menu's "reset defaults" and the video menu's "reset" (M_Menu_Options_f, VID_MenuInit)
export const OPTIONS_RESET = Object.freeze({ sfx: 70, musicMode: 'tracks', sensitivity: 7, alwaysRun: true, invertMouse: false, freelook: true, lookspring: false, lookstrafe: false, crosshair: 1 });
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
  cdLoopcount: int(1, 99), cdLooptrack: int(0, 99), cdNocd: bool,   // the music's loop (CDAudio_Update: the map's track that many times, then the loop track), and no music
  skill: oneOf(0, 1, 2, 3),   // 3 is nightmare: the console's alone (skill 3), the menus and the select stop at hard
  fov: int(1, 160),
  renderer: oneOf('fast', 'sql'),
  brightness: num(0.5, 3),
  alwaysRun: bool, invertMouse: bool,
  // the mouse look cvars (CL_MouseMove): free look (the mouse looks without +mlook held; off, its vertical walks), lookspring
  // (+mlook let go levels the view, free look off), lookstrafe (+mlook held, its horizontal sidesteps), m_forward and m_side
  freelook: bool, lookspring: bool, lookstrafe: bool, mForward: num(-100, 100), mSide: num(-100, 100),
  mFilter: bool,         // m_filter: each mouse sample averaged with the one before (CL_MouseMove)
  sensitivity: num(1, 20),
  crosshair: int(0, 3),
  // a guest's prediction (CL_PredictMovement): cl_predict runs it, cl_showmiss prints the misses (CL_CheckPredictionError)
  clPredict: bool, clShowmiss: bool,
  clAddEntities: bool, clAddParticles: bool, clAddLights: bool, clAddBlend: bool, clTestentities: bool, clTestparticles: bool, clTestlights: bool, clTestblend: bool,   // V_RenderView's switches and tests
  viewsize: int(40, 100),   // SCR_CalcVrect's viewsize: the 3D view's share of the screen, the backtile around a smaller one
  // ref_soft's switches: the world unlit, the entities or the world left out, the poses unblended, the PVS ignored, the frame's figures printed
  rFullbright: bool, rDrawentities: bool, rDrawworld: bool, rLerpmodels: bool, rNovis: bool, rSpeeds: bool,
  hostSpeeds: bool,      // host_speeds: a frame's times printed once a second (Qcommon_Frame's all, sv, gm, cl, rf)
  // ref_soft's sw_ switches: every face flat in a colour of its own, the underwater warp, the palette index the view is cleared to
  swDrawflat: bool, swWaterwarp: bool, swClearcolor: int(0, 255), swMipcap: int(0, 3), swMipscale: num(0, 10), swStipplealpha: bool,   // (the mip cap and scale, the stipple)
  developer: bool, logfile: bool,   // the page's warnings on the console (developer), the scrollback kept as qconsole.log (logfile)
  svNoreload: bool,   // sv_noreload: a level of the unit come back to spawns fresh, what was left in it unread
  sShow: bool,        // s_show: each sound started printed on the scrollback
  logStats: bool, inJoystick: bool,   // log_stats: a line a frame kept as stats.log; in_joystick: the pads read (1 here, where Quake's was 0)
  sKhz: oneOf(11, 22, 44), clShownet: int(0, 2), clShowclamp: bool,
  showpackets: bool, showdrop: bool,   // Netchan_Transmit's and Netchan_Process's prints: each message's direction, size and kind; the frames dropped, held or missed
  rLockpvs: bool, rDspeeds: bool,   // r_lockpvs: the view's cluster held where it was locked; r_dspeeds: the painter's times in detail   // s_khz: the mixer's rate; cl_shownet: a joined page's messages printed; cl_showclamp: the clock's clamps printed
  // m_yaw (the turn a mouse count, 0.022), cl_gun (the view weapon drawn), con_notifytime (the notify lines' seconds, 3)
  mYaw: num(-10, 10), clGun: bool, conNotifytime: num(0, 60),
  // the keys' speeds (CL_AdjustAngles, CL_BaseMove): cl_yawspeed and cl_pitchspeed in degrees a second (140, 150), cl_anglespeedkey
  // the run key's factor on them (1.5), cl_forwardspeed and cl_sidespeed in units a second (200, the full speed: the command's 1)
  clYawspeed: num(0, 3600), clPitchspeed: num(0, 3600), clAnglespeedkey: num(0, 100), clForwardspeed: num(0, 1000), clSidespeed: num(0, 1000), clUpspeed: num(0, 1000),
  // timeout (the host drops a guest silent that long, SV_CheckTimeouts, 125) and cl_timeout (a guest leaves a host silent that long, CL_CheckTimeout, 120); 0 never
  timeout: int(0, 3600), clTimeout: int(0, 3600),
  // gun_x, gun_y and gun_z (SV_CalcGunOffset's development tools: the view weapon moved right, forward and down, 0) and
  // scr_centertime (a centre print's seconds, 2.5)
  gunX: num(-100, 100), gunY: num(-100, 100), gunZ: num(-100, 100), scrCentertime: num(0, 60),
  clFootsteps: bool,     // cl_footsteps: the footsteps played (CL_EntityEvent's EV_FOOTSTEP), or not
  // scr_showpause (the pause plaque drawn, 1), scr_showturtle (the turtle after three slow frames, 0), cl_maxfps (the paint rate's cap, 90; 0 the display's, else 5 to 1000)
  scrShowpause: bool, scrShowturtle: bool, clMaxfps: (v) => (v === 0 ? 0 : num(5, 1000)(v)),
  // hostname (the host's name, serverinfo's and a guest's stats line's; at most 32 printable characters, empty "noname" as Quake had it)
  hostname: (v) => (typeof v === 'string' && /^[\x20-\x7e]{0,32}$/.test(v) ? v : undefined),
  // password (the network game's: a guest's userinfo, the host's requirement) and spectator_password (a watcher's): at most 32 characters, no spaces
  password: (v) => (typeof v === 'string' && /^[\x21-\x7e]{0,32}$/.test(v) ? v : undefined),
  spectatorPassword: (v) => (typeof v === 'string' && /^[\x21-\x7e]{0,32}$/.test(v) ? v : undefined),
  // rcon_password (CL_Rcon_f's and Rcon_Validate's in one: what a joined page sends with rcon, what the host asks for): at most 32 characters, no spaces
  rconPassword: (v) => (typeof v === 'string' && /^[\x21-\x7e]{0,32}$/.test(v) ? v : undefined),
  coop: bool,            // a new game with two players: the view split, the gamepad the second's
  deathmatch: bool,      // ... against each other (deathmatch wins over coop)
  dmflags: int(0, 65535), fraglimit: int(0, 999), timelimit: int(0, 999),   // the deathmatch cvars
  cheats: int(0, 1),     // the cheats cvar: god, notarget, noclip and give in a deathmatch only with it (CheatsOk)
  players: int(2, 4),    // how many at this page in coop or deathmatch (the view split in two or four)
  binds: checkBinds,     // the key bindings: action → at most two key codes
  lines: checkLines,     // the keys bound to command lines (bind k god): key code → the line (default.cfg's END centerview until changed)
  // the player setup (M_Menu_PlayerConfig_f): the name (the netname cvar: at most 15 printable characters; empty, the game
  // says "player 1") and the hand (0 right, 1 left, 2 centre)
  name: (v) => (typeof v === 'string' && /^[\x20-\x7e]{0,15}$/.test(v) ? v : undefined),
  hand: int(0, 2),
  // the gender userinfo (a word of at most 15 printable characters, male by default: f… is female, m… male, else neutral)
  gender: (v) => (typeof v === 'string' && /^[\x21-\x7e]{1,15}$/.test(v) ? v : undefined),
  msg: int(0, 3),        // the msg userinfo: the message level a print must reach (0 low, 1 medium, 2 high, 3 chat), 1 as Quake's cvar
  // the rate userinfo: the bytes a second this client asks the host's frames to keep under (SV_RateDrop holds a frame past it); Quake
  // clamped it to 100..25000 for frames of a few hundred bytes, here a frame is the face list, kilobytes, twenty a second: 1000 to 1000000, 500000
  rate: int(1000, 1000000),
  // the skin userinfo: model/skin (male/grunt by default); the model and skin wait on a pak that has them
  skin: (v) => (typeof v === 'string' && /^[\w-]{1,15}\/[\w-]{1,15}$/.test(v) ? v : undefined),
  // the ICE server the network game adds to the STUN (rtc_ice at the console): a url, or a url, a user and a password
  rtcIce: (v) => (typeof v === 'string' && v.length <= 300 && (v === '' || /^(stuns?|turns?):[^\s@]+( \S+ \S+)?$/i.test(v)) ? v : undefined),
  // the signalling relay (scripts/signal.mjs) the network game's texts go through under a room code (rtc_signal): its http(s) url
  rtcSignal: (v) => (typeof v === 'string' && v.length <= 300 && (v === '' || /^https?:\/\/\S+$/i.test(v)) ? v : undefined),
  // the address book (the menu's adr0 to adr8): up to nine texts of printable characters, a code at the relay or a relay and a code
  addressBook: (v) => (Array.isArray(v) ? v.slice(0, 9).map((e) => (typeof e === 'string' && /^[\x20-\x7e]{0,300}$/.test(e) ? e : '')) : undefined),
  netgraph: bool,        // the network graph along the bottom of a joined page's view (the netgraph cvar)
  timegraph: bool, debuggraph: bool, graphheight: int(1, 240), graphscale: num(-100, 100), graphshift: num(-240, 240),   // cl_scrn.c's debug graph: a frame's time as a column, the band drawn, its height, scale and shift
};

/**
 * The stored binds, each action's keys checked (a code is a KeyboardEvent code: letters and digits; a key bound
 * twice keeps its first action; an action missing or unreadable keeps its default), as a fresh object.
 */
function checkBinds(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out = defaultBinds();
  const taken = new Set();
  for (const a of ACTIONS) {
    const keys = v[a.id];
    if (!Array.isArray(keys)) { for (const c of out[a.id]) taken.add(c); continue; }
    out[a.id] = [];
    for (const c of keys.slice(0, 2)) {
      if (typeof c !== 'string' || !/^[A-Za-z0-9]{1,24}$/.test(c)) continue;
      const code = normalizeKey(c);
      if (taken.has(code) || out[a.id].includes(code)) continue;
      taken.add(code);
      out[a.id].push(code);
    }
  }
  return out;
}

/** The stored command-line binds: a key code each (as checkBinds takes them) and a line checkLine allows, as a fresh object. */
function checkLines(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out = {};
  for (const [c, line] of Object.entries(v)) {
    if (typeof c !== 'string' || !/^[A-Za-z0-9]{1,24}$/.test(c)) continue;
    const code = normalizeKey(c), s = typeof line === 'string' ? checkLine(line) : null;
    if (s && !(code in out)) out[code] = s;
  }
  return out;
}

/**
 * The settings as stored, each checked; anything missing, unknown or out of its range is its default. A key an
 * action holds runs no line (a key has one command: the action's binds are read first).
 */
export function loadSettings(storage) {
  let stored = {};
  try { stored = JSON.parse(storage?.getItem(KEY) || '{}') ?? {}; } catch { stored = {}; }
  const out = { ...DEFAULTS, binds: defaultBinds(), lines: defaultLines(), addressBook: [] };
  if (stored && typeof stored === 'object') {
    for (const [k, check] of Object.entries(CHECK)) {
      const v = check(stored[k]);
      if (v !== undefined) out[k] = v;
    }
  }
  for (const a of ACTIONS) for (const c of out.binds[a.id] ?? []) delete out.lines[c];
  return out;
}

export function saveSettings(settings, storage) {
  try { storage?.setItem(KEY, JSON.stringify(settings)); } catch { /* full or blocked: the settings live for this page */ }
}
