// console.js – Quake's console line: the commands the page runs itself (map, fov, seed, save, load,
// inven, bind and its kin over the keys menu's binds, rtc_ice …) and the rest handed to the game's player_command (god, noclip, give, use, kill, drop …);
// the history (Key_Console: up and down step through the lines typed) and Tab completion
// (Cmd_CompleteCommand: the first command that starts with what is typed).
//
// Nothing here touches the DOM: the page wires the input element to historyStep(), complete() and
// submit(), and gives a host with what the commands act on, so the tests can drive it with a fake one.

import { parseIceServer } from './net.js';
import { ACTIONS, actionOfCommand, bindKey, bindLine, unbindKey, checkLine, keyCode, keyName } from './input.js';

export const COMMANDS = ['alias', 'bind', 'bindlist', 'bob_pitch', 'bob_roll', 'bob_up', 'cd_volume', 'centerview', 'chase', 'cheats', 'cl_anglespeedkey', 'cl_forwardspeed', 'cl_gun', 'cl_pitchspeed', 'cl_predict', 'cl_run', 'cl_showmiss', 'cl_sidespeed', 'cl_yawspeed', 'clear', 'cmdlist', 'con_notifytime', 'condump', 'connect', 'coop', 'crosshair', 'cvarlist', 'deathmatch', 'deldemo', 'demomap', 'demos', 'dir', 'disconnect', 'dmflags', 'drop', 'echo', 'exec', 'fov', 'fraglimit', 'freelook', 'gender', 'give', 'god', 'gun_x', 'gun_y', 'gun_z', 'hand', 'help', 'hostname', 'imagelist', 'invdrop', 'inven', 'invnext', 'invprev', 'invuse', 'kick', 'kill', 'load', 'lookspring', 'lookstrafe', 'm_forward', 'm_pitch', 'm_side', 'm_yaw', 'map', 'maxclients', 'menu_credits', 'menu_game', 'menu_keys', 'menu_loadgame', 'menu_main', 'menu_multiplayer', 'menu_options', 'menu_playerconfig', 'menu_quit', 'menu_savegame', 'menu_video', 'modellist', 'msg', 'name', 'netgraph', 'noclip', 'notarget', 'path', 'pause', 'players', 'putaway', 'r_drawentities', 'r_drawworld', 'r_fullbright', 'r_lerpmodels', 'r_novis', 'r_speeds', 'reconnect', 'record', 'rtc_ice', 'rtc_signal', 'run_pitch', 'run_roll', 's_volume', 'save', 'say', 'say_team', 'score', 'scr_centertime', 'screenshot', 'seed', 'sensitivity', 'serverinfo', 'set', 'sizedown', 'sizeup', 'skill', 'soundlist', 'spectator', 'status', 'stop', 'sv_gravity', 'sv_rollangle', 'sv_rollspeed', 'timedemo', 'timelimit', 'timerefresh', 'timescale', 'unautoexec', 'unbind', 'unbindall', 'use', 'userinfo', 'version', 'vid_fullscreen', 'vid_gamma', 'viewpos', 'viewsize', 'wait', 'wave', 'weaplast', 'writeconfig'];

/**
 * The settings as Quake's cvars (the names the options and player setup menus set, as config.cfg named them): the
 * setting each stands for, its value as the cvar showed it and the setting's value from a word typed (null for one
 * the cvar refuses). m_pitch is 0.022 or -0.022 (the invert mouse option), s_volume and cd_volume 0..1, cl_run 0 or 1.
 */
export const CVARS = {
  name: { key: 'name', show: (v) => String(v ?? ''), read: (w) => (/^[\x20-\x7e]{0,15}$/.test(w) ? w : null), help: 'at most 15 printable characters' },
  hand: { key: 'hand', show: (v) => String(v), read: (w) => ([0, 1, 2].includes(Number(w)) ? Number(w) : null), help: '0 right, 1 left, 2 center' },
  // the gender userinfo (archived, as Quake's was): a word, male by default; one starting with f is female, with m male, any other neutral
  // (IsFemale, IsNeutral): the obituaries' pronouns and the sexed sounds
  gender: { key: 'gender', show: (v) => String(v ?? 'male'), read: (w) => (/^[\x21-\x7e]{1,15}$/.test(w) ? w : null), help: 'a word: male, female or none' },
  // the msg userinfo (archived, as Quake's was): the level a print must reach this client, 0 low (every print), 1 medium (Quake's default:
  // the "No shells for shotgun" prints off), 2 high, 3 chat alone, as SV_ClientPrintf filtered them
  msg: { key: 'msg', show: (v) => String(v), read: (w) => (/^[0-3]$/.test(w) ? Number(w) : null), help: '0 to 3' },
  sensitivity: { key: 'sensitivity', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) ? Math.max(1, Math.min(20, n)) : null; }, help: '1 to 20' },
  cl_run: { key: 'alwaysRun', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1' },
  m_pitch: { key: 'invertMouse', show: (v) => (v ? '-0.022' : '0.022'), read: (w) => { const n = Number(w); return Number.isFinite(n) && n !== 0 ? n < 0 : null; }, help: '0.022, or -0.022 to invert' },
  crosshair: { key: 'crosshair', show: (v) => String(v), read: (w) => (/^[0-3]$/.test(w) ? Number(w) : null), help: '0 to 3' },
  s_volume: { key: 'sfx', show: (v) => (v / 100).toFixed(2), read: (w) => { const n = Number(w); return Number.isFinite(n) ? Math.round(Math.max(0, Math.min(1, n)) * 100) : null; }, help: '0 to 1' },
  cd_volume: { key: 'music', show: (v) => (v / 100).toFixed(2), read: (w) => { const n = Number(w); return Number.isFinite(n) ? Math.round(Math.max(0, Math.min(1, n)) * 100) : null; }, help: '0 to 1' },
  // the mouse look cvars (CL_MouseMove, IN_MLookUp): free look (the mouse looks without +mlook held; off, its vertical walks the
  // player, as Quake's default had it; on here, as the mouse always looked), lookspring (+mlook let go levels the view, free look
  // off), lookstrafe (+mlook held, the mouse's horizontal sidesteps), and m_forward and m_side, the walk and the sidestep a count
  // (not archived, as Quake's were not)
  freelook: { key: 'freelook', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1' },
  lookspring: { key: 'lookspring', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1' },
  lookstrafe: { key: 'lookstrafe', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1' },
  m_forward: { key: 'mForward', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && Math.abs(n) <= 100 ? n : null; }, help: 'a number, 1 as Quake had it', archive: false },
  m_side: { key: 'mSide', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && Math.abs(n) <= 100 ? n : null; }, help: 'a number, 1 as Quake had it', archive: false },
  // the network graph along the bottom of a joined page's view (SCR_DrawDebugGraph: a column a frame); not archived, as Quake's was not
  netgraph: { key: 'netgraph', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  // a guest's prediction (CL_PredictMovement): cl_predict 0 paints the host's frames as they come, cl_showmiss 1 prints each
  // prediction miss as CL_CheckPredictionError printed it; neither archived, as Quake's were not
  cl_predict: { key: 'clPredict', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  cl_showmiss: { key: 'clShowmiss', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  // SCR_CalcVrect's viewsize: the 3D view's share of the screen, 40 to 100 percent, the backtile around a smaller one (sizeup and sizedown step it by ten)
  viewsize: { key: 'viewsize', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) ? Math.max(40, Math.min(100, Math.round(n))) : null; }, help: '40 to 100' },
  // ref_soft's switches (none archived, as Quake's were not): r_fullbright 1 lights nothing, r_drawentities 0 and r_drawworld 0 leave
  // the entities or the world out, r_lerpmodels 0 blends no poses, r_novis 1 marks every leaf, r_speeds 1 prints the frame's figures
  r_fullbright: { key: 'rFullbright', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  r_drawentities: { key: 'rDrawentities', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  r_drawworld: { key: 'rDrawworld', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  r_lerpmodels: { key: 'rLerpmodels', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  r_novis: { key: 'rNovis', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  r_speeds: { key: 'rSpeeds', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  // m_yaw (the turn a mouse count, 0.022 as Quake had it), cl_gun (0: no view weapon, CL_AddViewWeapon's) and con_notifytime (the notify
  // lines' seconds, 3): none archived, as Quake's were not
  m_yaw: { key: 'mYaw', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && Math.abs(n) <= 10 ? n : null; }, help: 'a number, 0.022 as Quake had it', archive: false },
  cl_gun: { key: 'clGun', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  con_notifytime: { key: 'conNotifytime', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && n >= 0 && n <= 60 ? n : null; }, help: 'seconds, 0 to 60', archive: false },
  // the keys' speeds (CL_AdjustAngles, CL_BaseMove; none archived, as Quake's were not): cl_yawspeed and cl_pitchspeed in degrees a second
  // (140 and 150), cl_anglespeedkey the run key's factor on them (1.5), cl_forwardspeed and cl_sidespeed in units a second (200, the
  // full speed: the command's fraction, within it)
  cl_yawspeed: { key: 'clYawspeed', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && n >= 0 && n <= 3600 ? n : null; }, help: 'degrees a second, 0 to 3600', archive: false },
  cl_pitchspeed: { key: 'clPitchspeed', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && n >= 0 && n <= 3600 ? n : null; }, help: 'degrees a second, 0 to 3600', archive: false },
  cl_anglespeedkey: { key: 'clAnglespeedkey', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null; }, help: 'a factor, 0 to 100', archive: false },
  cl_forwardspeed: { key: 'clForwardspeed', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : null; }, help: 'units a second, 0 to 1000', archive: false },
  cl_sidespeed: { key: 'clSidespeed', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : null; }, help: 'units a second, 0 to 1000', archive: false },
  // gun_x, gun_y and gun_z (SV_CalcGunOffset's development tools, 0: the view weapon moved along the view's right, forward and down) and
  // scr_centertime (SCR_DrawCenterString: a centre print's seconds, 2.5); none archived, as Quake's were not
  gun_x: { key: 'gunX', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && Math.abs(n) <= 100 ? n : null; }, help: 'units, -100 to 100', archive: false },
  gun_y: { key: 'gunY', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && Math.abs(n) <= 100 ? n : null; }, help: 'units, -100 to 100', archive: false },
  gun_z: { key: 'gunZ', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && Math.abs(n) <= 100 ? n : null; }, help: 'units, -100 to 100', archive: false },
  scr_centertime: { key: 'scrCentertime', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && n >= 0 && n <= 60 ? n : null; }, help: 'seconds, 0 to 60', archive: false },
  // vid_gamma: the video menu's brightness (the lightmaps' modulate: the control's tenths from 1 to 1.8, 1.4 by default, a number between
  // snapped and clamped to them), archived as Quake's was; vid_fullscreen is the page's live state, a case of its own
  vid_gamma: { key: 'brightness', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) ? Math.round(Math.max(1, Math.min(1.8, n)) * 10) / 10 : null; }, help: '1 to 1.8' },
  // hostname: the host's name (serverinfo's, a guest's stats line's; "noname" when empty, as Quake had it), archived as Quake's was
  hostname: { key: 'hostname', show: (v) => String(v ?? ''), read: (w) => (/^[\x20-\x7e]{0,32}$/.test(w) ? w : null), help: 'at most 32 printable characters' },
};
/**
 * FS_Dir_f's wildcard over the pak's names: the directory before the last slash as written, the rest a glob (* any run, ? one
 * character, neither across a slash), case aside; the matching names, sorted.
 */
export function dirList(names, filter) {
  const slash = filter.lastIndexOf('/');
  const dir = slash >= 0 ? filter.slice(0, slash + 1).toLowerCase() : '', wild = slash >= 0 ? filter.slice(slash + 1) : filter;
  const re = new RegExp(`^${wild.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`, 'i');
  return names.filter((n) => n.startsWith(dir) && !n.slice(dir.length).includes('/') && re.test(n.slice(dir.length))).sort();
}
// p_view.c's cvars on the game row for the game running (SV_CalcViewOffset, SV_CalcRoll), as sv_gravity: Quake's default, the least and
// the most taken. bob_up, bob_pitch and bob_roll are the bob's height, pitch and roll a unit of speed, run_pitch and run_roll the pitch
// and roll from the velocity along the view, sv_rollangle the player model's roll, full at a sideways speed of sv_rollspeed
export const GAME_CVARS = Object.freeze({ bob_up: [0.005, 0, 1], bob_pitch: [0.002, -1, 1], bob_roll: [0.002, -1, 1], run_pitch: [0.002, -1, 1], run_roll: [0.005, -1, 1], sv_rollangle: [2, -90, 90], sv_rollspeed: [200, 0, 10000] });
const HISTORY = 32;

/**
 * host: { db, pak, settings, saveSettings(), setStatus(msg, isError), startMap(name), setView(fov),
 *         saveGame(), loadGame(), toggleInventory(), isRunning(), setCvar(name, value), setSkill(n), playDemo(name),
 *         hasDemo(name), listDemos() → { pak, kept }, dropDemo(name) → dropped, record(name), stopRecord(), isRecording(),
 *         setSpectator(on | null) → 0 | 1 | null (null: this page has not joined a game), timedemo(name), screenshot(), say(text), setSetting(key, value) (the cvars: through the page's controls and the userinfo),
 *         download(name, text) (writeconfig), clearLog() (clear: the scrollback emptied), dumpLog(name) (condump: the scrollback downloaded as <name>.txt),
 *         print(text) (lines into the scrollback alone: cmdlist, dir and the listings), pakInfo() → { name, files, from } (path, dir: the pak's name, how many files, where it came from),
 *         modelList() → [{ name, size }] (modellist), imageList() → [{ kind, w, h, name }] (imagelist: P a picture, W a wall texture, M a skin), soundList() → [{ name, size, loop }] (soundlist), version() → the page's version string (version), togglePause() → paused now, null for a shared game or none (pause),
 *         toggleScores() (score: the score board, in a game of more than one client), putAway() (putaway: every screen off),
 *         serverInfo() → the game's cvars as { mapname, deathmatch, coop, dmflags, fraglimit, timelimit, cheats, skill }, null on a joined page or without a map (serverinfo),
 *         userInfo() → this page's { name, hand, gender, msg, fov, spectator } (userinfo),
 *         viewPos() → the first view's { x, y, z, yaw } (viewpos), timeRefresh(flip) → { seconds, fps } after a full turn in 128 frames, null without a game of this page's own (timerefresh), status() → { map, rows: [{ num, score, ping, name }] }, null without a game (status),
 *         isFullscreen() → whether the page is fullscreen now (vid_fullscreen; set through setSetting('fullscreen', bool)),
 *         toggleHelp() (help: the help computer, F1's), gravity() → the game's gravity, null on a joined page or without a map, setGravity(n) (sv_gravity),
 *         gameCvar(col) → the game row's column, null on a joined page or without a map, setGameCvar(col, n) (bob_up, bob_pitch, bob_roll, run_pitch, run_roll, sv_rollangle, sv_rollspeed: GAME_CVARS),
 *         setGameMode({ coop, deathmatch, players }) (deathmatch, coop, maxclients: the next game's, latched; the Players select follows),
 *         execConfig() (exec: the page's file picker, whose file runs through execText),
 *         execAutoexec() → the lines run, or null when none is kept (exec autoexec), dropAutoexec() → true when one was kept (unautoexec),
 *         setTimescale(n | null) → the timescale now (null: a guest, whose clock is the host's),
 *         listPlayers() → the clients as [{ num, name, kind: 'page' | 'guest' | 'pad' | 'standing', sent, dropped, spectator }], 'guest' on a joined page, null without a game (players),
 *         kick(n) → the name kicked, or 'none' | 'not-hosting' (kick),
 *         connect(text) → true once joining began (false: no pak yet), disconnect() → true when this page was in a shared game,
 *         reconnect(), lastConnect() → what this page last joined with ('' for nothing),
 *         openMenu(name) → true once the menu is up (main, game, loadgame, savegame, options, keys, video, multiplayer, playerconfig, credits, quit; the menu_* commands),
 *         forward(cmd, arg) → true when the command went to the host (a joined page), false to run it here }
 */
/** The cvars config.cfg carries (CVARS, and fov and skill with them), each with its setting and how it shows. */
const CONFIG_CVARS = () => ({ ...CVARS, fov: { key: 'fov', show: (v) => String(v) }, skill: { key: 'skill', show: (v) => String(v) } });

/**
 * Key_WriteBindings and Cvar_WriteVariables: the binds and the cvars as config.cfg's lines (`unbindall`, then
 * `bind <key> "<command>"` for every key bound, in the actions' order, the keys bound to command lines after
 * them, then `set <cvar> "<value>"`), which `exec` runs back through the console line by line.
 */
export function writeConfig(settings) {
  const lines = ['// generated by Firebird Quake 2, do not modify', 'unbindall'];
  for (const a of ACTIONS) for (const c of settings.binds?.[a.id] ?? []) lines.push(`bind ${keyName(c)} "${a.cmd}"`);
  for (const [c, line] of Object.entries(settings.lines ?? {})) lines.push(`bind ${keyName(c)} "${line}"`);
  for (const [name, c] of Object.entries(CONFIG_CVARS())) if (c.archive !== false) lines.push(`set ${name} "${c.show(settings[c.key])}"`);
  return lines.join('\n') + '\n';
}

/** Cmd_TokenizeString's line split: a line is commands parted by `;` outside quotes (a `;` within "" stays, as a bind's line does). */
export function splitLine(line) {
  const parts = [];
  let cur = '', quoted = false;
  for (const ch of String(line ?? '')) {
    if (ch === '"') { quoted = !quoted; cur += ch; continue; }
    if (ch === ';' && !quoted) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}
const MAX_ALIAS_NAME = 32;   // cmd.c's MAX_ALIAS_NAME
const ALIAS_LOOP_COUNT = 16; // cmd.c's ALIAS_LOOP_COUNT: an alias that runs itself (through others) sixteen deep stops

export class Console {
  constructor(host) {
    this.host = host;
    this.history = [];
    this.histPos = 0;
    this.said = 0;   // the messages said, for their clearing timers
    this.aliases = new Map();   // Cmd_Alias_f's: a name for a line (several commands with `;`), for the session as Quake kept them
    this.pending = [];          // the lines `wait` held back for the next frame (Cbuf's cmd_wait), run by tick()
    this.aliasDepth = 0;
  }

  /** Cbuf_Execute's wait: the frame has come, so the lines held back run (the page calls it once a frame). */
  async tick() {
    if (!this.pending.length) return 0;
    const lines = this.pending; this.pending = [];
    let n = 0;
    for (const line of lines) { await this.run(line); n++; }
    return n;
  }

  /** Opening the line: the history cursor past its end. */
  reset() { this.histPos = this.history.length; }

  /** Up (-1) or down (+1) through the lines typed before; past the newest is the empty line. */
  historyStep(dir) {
    this.histPos = Math.max(0, Math.min(this.history.length, this.histPos + dir));
    return this.history[this.histPos] ?? '';
  }

  /** Cmd_CompleteCommand: what the line becomes on Tab, or null when nothing completes it. */
  complete(typed) {
    const t = typed.trim().toLowerCase();
    if (!t || t.includes(' ')) return null;
    const hit = COMMANDS.find((c) => c.startsWith(t));
    return hit ? hit + ' ' : null;
  }

  /** Enter: the line into the history (not twice in a row, the oldest forgotten past 32) and run. */
  async submit(line) {
    line = line.trim();
    if (line && this.history[this.history.length - 1] !== line) this.history.push(line);
    if (this.history.length > HISTORY) this.history.shift();
    this.histPos = this.history.length;
    if (line) await this.run(line);
  }

  /** Cmd_ExecuteString over a config's text (exec): every line but the blank ones and the comments, in order; how many ran. */
  async execText(text) {
    let n = 0;
    for (const raw of String(text ?? '').split(/\r?\n/)) {
      const line = raw.replace(/\/\/.*$/, '').trim();
      if (!line) continue;
      await this.run(line);
      n++;
    }
    return n;
  }

  /**
   * Cbuf_ExecuteText over a line: its commands parted at `;` run in order; `wait` holds the rest to the next frame
   * (tick); a command that is an alias runs the alias's line, sixteen deep at most (ALIAS_LOOP_COUNT).
   */
  async run(line) {
    const parts = splitLine(line);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const word = part.split(/\s+/)[0].toLowerCase();
      if (word === 'wait') { if (i + 1 < parts.length) this.pending.push(parts.slice(i + 1).join('; ')); return; }
      const alias = this.aliases.get(word);
      if (alias !== undefined && !this.builtin(word)) {
        if (this.aliasDepth >= ALIAS_LOOP_COUNT) { this.host.setStatus('ALIAS_LOOP_COUNT', true); return; }   // (each level's finally takes its depth back)
        this.aliasDepth++;
        try { if (alias) await this.run(alias); } finally { this.aliasDepth--; }
        continue;
      }
      await this.runOne(part);
    }
  }
  /** Whether a word is one of the console's own (an alias of that name is never run: Cmd_ExecuteString looked at the commands first). */
  builtin(word) { return COMMANDS.includes(word); }

  async runOne(line) {
    const h = this.host;
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(' ');
    // (a message clears itself after its time unless a newer one has taken the line: an earlier message's timer
    // used to clear whatever was showing)
    const say = (msg, isError = false, ms = 2500) => { h.setStatus(msg, isError); const id = ++this.said; setTimeout(() => { if (this.said === id) h.setStatus(''); }, ms); };
    switch (cmd.toLowerCase()) {
      case 'map': {
        const name = arg.toLowerCase();
        if (!h.pak.has(`maps/${name}.bsp`)) { say(`no map "${name}" in this pak`, true); return; }
        await h.startMap(name);
        return;
      }
      case 'demomap': {
        // CL_PlayDemo_f: a demo of the pak (demos/<name>.dm2), or one recorded this session, played over its map
        const name = arg.toLowerCase().replace(/\.dm2$/, '');
        const has = h.hasDemo ? h.hasDemo(name) : h.pak.has(`demos/${name}.dm2`);
        if (!name || !has) { say(`no demo "${name}" in this pak`, true); return; }
        await h.playDemo?.(name);
        return;
      }
      case 'timedemo': {
        // CL_Timedemo_f: the demo played a frame of the recording a painted frame, no pacing, the frames and the seconds
        // reported at its end as CL_DemoCompleted reported them
        const name = arg.toLowerCase().replace(/\.dm2$/, '');
        const has = h.hasDemo ? h.hasDemo(name) : h.pak.has(`demos/${name}.dm2`);
        if (!name || !has) { say(`no demo "${name}" in this pak`, true); return; }
        await h.timedemo?.(name);
        return;
      }
      case 'set': {
        // Cvar_Set_f: `set <cvar> <value>`, config.cfg's way of setting one (fov and skill among them)
        const [name, ...words] = arg.split(/\s+/).filter(Boolean);
        if (!name || !words.length) { say('usage: set <variable> <value>', true); return; }
        if (!(name.toLowerCase() in CONFIG_CVARS())) { say(`"${name}" is not a cvar this page keeps`, true); return; }
        return this.run(`${name} ${words.join(' ')}`);
      }
      case 'writeconfig':
        // Key_WriteBindings and Cvar_WriteVariables: the binds and the cvars as config.cfg, downloaded (Quake wrote it on
        // the way out; the page has the settings for that, and this for carrying them to another browser)
        h.download?.('config.cfg', writeConfig(h.settings));
        say('config.cfg written');
        return;
      case 'exec': {
        // Cmd_Exec_f: a config file run line by line; the file comes from the Config control's picker (a page cannot
        // read a file by name), which exec opens; `exec autoexec` runs the autoexec.cfg kept in the browser (the
        // control's box), which runs at every start as autoexec.cfg did
        if (/^autoexec(\.cfg)?$/i.test(arg.trim())) {
          const n = await h.execAutoexec?.();
          if (n == null) { say('no autoexec.cfg kept: tick the Config control\'s autoexec and pick one', true); return; }
          say(`execing autoexec.cfg: ${n} line${n === 1 ? '' : 's'} run`);
          return;
        }
        h.execConfig?.();
        return;
      }
      case 'unautoexec':
        // the kept autoexec.cfg dropped
        say((await h.dropAutoexec?.()) ? 'autoexec.cfg dropped' : 'no autoexec.cfg kept');
        return;
      case 'name': case 'hand': case 'gender': case 'msg': case 'sensitivity': case 'cl_run': case 'm_pitch': case 'crosshair': case 's_volume': case 'cd_volume':
      case 'freelook': case 'lookspring': case 'lookstrafe': case 'm_forward': case 'm_side': case 'netgraph': case 'cl_predict': case 'cl_showmiss': case 'viewsize':
      case 'r_fullbright': case 'r_drawentities': case 'r_drawworld': case 'r_lerpmodels': case 'r_novis': case 'r_speeds':
      case 'm_yaw': case 'cl_gun': case 'con_notifytime': case 'vid_gamma': case 'hostname':
      case 'cl_yawspeed': case 'cl_pitchspeed': case 'cl_anglespeedkey': case 'cl_forwardspeed': case 'cl_sidespeed':
      case 'gun_x': case 'gun_y': case 'gun_z': case 'scr_centertime': {
        // a setting as its cvar (Cvar_Command: the name alone shows it, a word sets it), kept with the settings through the
        // page's setSetting, so the menus and the page's controls agree; a word the cvar refuses leaves it
        const name = cmd.toLowerCase(), cv = CVARS[name];
        const now = cv.show(h.settings[cv.key]);
        const word = arg.replace(/^"(.*)"$/, '$1');   // (config.cfg's quotes; name "" clears the name)
        if (!arg) { say(`"${name}" is "${now}"`); return; }
        const value = cv.read(word);
        if (value === null) { say(`${name} takes ${cv.help}`, true); return; }
        h.setSetting(cv.key, value);
        say(`"${name}" is "${cv.show(h.settings[cv.key])}"`);
        return;
      }
      case 'timescale': {
        // the timescale cvar: the game's clock against the wall's (Qcommon_Frame scaled the frame's milliseconds by it):
        // 0.5 slow motion, 2 twice the pace, 1 back; 0.1 to 10 here, for the session (Quake did not archive it either). A
        // guest's clock is the host's, so a guest is told.
        const now = h.setTimescale?.(null);
        if (!arg) { say(`"timescale" is "${now ?? 1}"`); return; }
        const v = Number(arg);
        if (!Number.isFinite(v) || v <= 0) { say('timescale takes a number above 0 (0.1 to 10)', true); return; }
        const set = h.setTimescale?.(Math.max(0.1, Math.min(10, v)));
        if (set === null) { say('timescale: a joined game runs at the host\'s pace', true); return; }
        say(`"timescale" is "${set}"`);
        return;
      }
      case 'cvarlist': {
        // Cvar_List_f: the cvars with their values, on the one line the page has (fov and skill with them)
        say(Object.entries(CONFIG_CVARS()).map(([n, c]) => `${n} "${c.show(h.settings[c.key])}"`).join(' · '), false, 8000);
        return;
      }
      case 'say': case 'say_team': {
        // Cmd_Say_f: the words to every client's message line as "name: text", as typed and not the console's lower
        // case (a guest's go to the host; say_team is say, there being no model or skin teams here)
        if (!arg) { say(`${cmd.toLowerCase()} <text>`, true); return; }
        if (!h.isRunning()) return;
        await h.say?.(arg);
        return;
      }
      case 'screenshot':
        // SCR_ScreenShot_f: the view as a picture (quakeNN.png here, downloaded), as it stands
        if (!h.isRunning()) { say('screenshot: nothing is on the view', true); return; }
        h.screenshot?.();
        return;
      case 'viewpos': {
        // V_Viewpos_f: the eye's position and the yaw, whole numbers as Com_Printf("(%i %i %i) : %i") had them (what screenshot.mjs --at= takes, its z the origin's)
        const v = h.viewPos?.();
        if (!v) { say('viewpos: nothing is on the view', true); return; }
        say(`(${Math.trunc(v.x)} ${Math.trunc(v.y)} ${Math.trunc(v.z)}) : ${Math.trunc(v.yaw)}`, false, 8000);
        return;
      }
      case 'timerefresh': {
        // SCR_TimeRefresh_f: the view spun a full turn in 128 frames with the painter timed, "seconds (fps)" as Com_Printf("%f") had
        // them; an argument runs it without page flipping (timerefresh 1: one present at the end)
        const r = await h.timeRefresh?.(!arg);
        if (!r) { say('timerefresh: a game of this page\'s own must be running, its menu away', true); return; }
        say(`${r.seconds.toFixed(6)} seconds (${r.fps.toFixed(6)} fps)`, false, 8000);
        return;
      }
      case 'clear':
        // Con_Clear_f: the scrollback emptied, the notify lines with it (the line typed goes too, as the console's own echo of it did)
        h.clearLog?.();
        return;
      case 'condump': {
        // Con_Dump_f: the scrollback as a text file, <name>.txt, downloaded (Quake wrote it into the game directory)
        const name = arg.replace(/^"(.*)"$/, '$1').replace(/\.txt$/i, '').replace(/[\\/:*?"<>|]/g, '').trim();
        if (!name) { say('usage: condump <filename>', true); return; }
        h.dumpLog?.(name);
        say(`Dumped console text to ${name}.txt.`);
        return;
      }
      case 'echo':
        // Cmd_Echo_f: the words printed as typed
        say(arg);
        return;
      case 'cmdlist':
        // Cmd_List_f: every command on a line of the scrollback, and how many
        h.print?.(COMMANDS.join('\n'));
        say(`${COMMANDS.length} commands`);
        return;
      case 'path': {
        // FS_Path_f: the search path, one pak here, with its files counted and where it came from
        const pk = h.pakInfo?.();
        if (!pk) { say('path: no pak loaded yet', true); return; }
        say(`Current search path: ${pk.name} (${pk.files} files${pk.from ? `, ${pk.from}` : ''})`, false, 8000);
        return;
      }
      case 'dir': {
        // FS_Dir_f: the pak's files a wildcard names (*.* without one; * and ? within a directory, as the file system's glob
        // had them: dir maps/*.bsp), on the scrollback by their names after the last slash under "Directory of", and how many
        const pk = h.pakInfo?.();
        if (!h.pak || !pk) { say('dir: no pak loaded yet', true); return; }
        const filter = arg || '*.*';
        const names = dirList(h.pak.list(), filter);
        h.print?.([`Directory of ${pk.name}/${filter}`, '----', ...names.map((n) => n.slice(n.lastIndexOf('/') + 1))].join('\n'));
        say(names.length ? `dir ${filter}: ${names.length} file${names.length === 1 ? '' : 's'}` : `dir ${filter}: no files`, false, 8000);
        return;
      }
      case 'modellist': {
        // Mod_Modellist_f: the models loaded, their size in the pak and their names, a line each, and the total
        const ms = h.modelList?.() ?? [];
        const total = ms.reduce((t, m) => t + (m.size || 0), 0);
        h.print?.(['Loaded models:', ...ms.map((m) => `${String(m.size || 0).padStart(8)} : ${m.name}`), `Total resident: ${total}`].join('\n'));
        say(`${ms.length} model${ms.length === 1 ? '' : 's'} loaded, ${total} bytes`, false, 8000);
        return;
      }
      case 'imagelist': {
        // R_ImageList_f: the pictures in use with their kind (P a picture, W a wall texture, M a skin), their size and name, and the texels
        const im = h.imageList?.() ?? [];
        const texels = im.reduce((t, i) => t + (i.w || 0) * (i.h || 0), 0);
        h.print?.([...im.map((i) => `${i.kind} ${String(i.w).padStart(4)} ${String(i.h).padStart(4)} ${i.name}`), `Total texel count: ${texels}`].join('\n'));
        say(`${im.length} image${im.length === 1 ? '' : 's'}, ${texels} texels`, false, 8000);
        return;
      }
      case 'soundlist': {
        // S_SoundList_f: the sounds loaded, L on the ones looping, their size in the pak and their names, and the total
        const ss = h.soundList?.() ?? [];
        const total = ss.reduce((t, x) => t + (x.size || 0), 0);
        h.print?.([...ss.map((x) => `${x.loop ? 'L' : ' '} ${String(x.size || 0).padStart(6)} : ${x.name}`), `Total resident: ${total}`].join('\n'));
        say(`${ss.length} sound${ss.length === 1 ? '' : 's'} loaded, ${total} bytes`, false, 8000);
        return;
      }
      case 'version':
        // the version command (Com_Printf of the version string): the page's version and build, the engine's package and Firebird's
        say(h.version?.() ?? 'version: unknown', false, 8000);
        return;
      case 'pause': {
        // CL_Pause_f: a single-player game running pauses or goes on; a shared game, or none, "Pause command is only valid in single player"
        const p = h.togglePause?.();
        if (p === null || p === undefined) say('Pause command is only valid in single player');
        return;
      }
      case 'score':
        // Cmd_Score_f: the score board toggled, the inventory and the help put away; nothing in single player
        if (!h.isRunning()) return;
        h.toggleScores?.();
        return;
      case 'putaway':
        // Cmd_PutAway_f: the help computer, the inventory and the score board put away
        h.putAway?.();
        return;
      case 'sizeup': case 'sizedown': {
        // SCR_SizeUp_f and SCR_SizeDown_f: the viewsize cvar ten up or down, within 40 to 100 (default.cfg's = and -)
        const cv = CVARS.viewsize;
        const next = cv.read(String((Number(h.settings[cv.key]) || 100) + (cmd.toLowerCase() === 'sizeup' ? 10 : -10)));
        h.setSetting(cv.key, next);
        say(`"viewsize" is "${cv.show(h.settings[cv.key])}"`);
        return;
      }
      case 'serverinfo': {
        // SV_Serverinfo_f: the server's info cvars (Info_Print of Cvar_Serverinfo); a joined page runs no server of its own
        const info = await h.serverInfo?.();
        if (!info) { say('serverinfo: a joined page runs no server of its own', true); return; }
        say(`Server info settings: ${Object.entries(info).map(([k, v]) => `${k} "${v}"`).join(' · ')}`, false, 8000);
        return;
      }
      case 'userinfo': {
        // CL_Userinfo_f: this page's userinfo (ClientUserinfoChanged's name, hand, gender, msg, fov and spectator)
        const info = h.userInfo?.() ?? {};
        say(`User info settings: ${Object.entries(info).map(([k, v]) => `${k} "${v}"`).join(' · ')}`, false, 8000);
        return;
      }
      case 'status': {
        // SV_Status_f: the map and the clients with their frags, pings and names, a line each in the scrollback, the sum on the line
        const st = h.status?.();
        if (!st) { say('status: no game running', true); return; }
        h.print?.(['num score ping name', ...st.rows.map((c) => `${String(c.num).padStart(3)} ${String(c.score).padStart(5)} ${String(c.ping).padStart(4)} ${c.name}`)].join('\n'));
        say(`map: ${st.map} · ${st.rows.length} client${st.rows.length === 1 ? '' : 's'}: ${st.rows.map((c) => `${c.num} ${c.name} ${c.score} frags, ${c.ping} ms`).join(' · ')}`, false, 8000);
        return;
      }
      case 'vid_fullscreen': {
        // the video menu's fullscreen as a cvar: the page's live state shown, set through the page (a request the browser may refuse)
        if (!arg) { say(`"vid_fullscreen" is "${h.isFullscreen?.() ? '1' : '0'}"`); return; }
        if (!/^(0|1)$/.test(arg)) { say('vid_fullscreen takes 0 or 1', true); return; }
        h.setSetting('fullscreen', arg === '1');
        say(`"vid_fullscreen" is "${arg}"`);
        return;
      }
      case 'help':
        // Cmd_Help_f: the help computer (the score board in deathmatch) as F1 brings it, in a game running
        if (!h.isRunning()) return;
        h.toggleHelp?.();
        return;
      case 'sv_gravity': {
        // the sv_gravity cvar: the level's gravity for the game running (a joined page runs no server; a new map takes the worldspawn's again)
        const g = await h.gravity?.();
        if (g == null) { say('sv_gravity: a joined page runs no server of its own, and a map must be running', true); return; }
        if (!arg) { say(`"sv_gravity" is "${g}"`); return; }
        const n = Number(arg);
        if (!Number.isFinite(n) || n < -5000 || n > 5000) { say('sv_gravity takes a number, 800 as Quake had it', true); return; }
        await h.setGravity?.(n);
        say(`"sv_gravity" is "${n}"`);
        return;
      }
      case 'bob_up': case 'bob_pitch': case 'bob_roll': case 'run_pitch': case 'run_roll': case 'sv_rollangle': case 'sv_rollspeed': {
        // p_view.c's cvars on the game row for the game running (GAME_CVARS), as sv_gravity: shown, or set within their range
        const name = cmd.toLowerCase(), [dflt, lo, hi] = GAME_CVARS[name];
        const v = await h.gameCvar?.(name);
        if (v == null) { say(`${name}: a joined page runs no server of its own, and a map must be running`, true); return; }
        if (!arg) { say(`"${name}" is "${v}"`); return; }
        const n = Number(arg);
        if (!Number.isFinite(n) || n < lo || n > hi) { say(`${name} takes a number from ${lo} to ${hi}, ${dflt} as Quake had it`, true); return; }
        await h.setGameCvar?.(name, n);
        say(`"${name}" is "${n}"`);
        return;
      }
      case 'deathmatch': case 'coop': case 'maxclients': {
        // the Players select's words, latched as Quake latched them: the next game's mode and clients ("will be changed for next
        // game."); the page's coop is more than one client at it, deathmatch them against each other
        const name = cmd.toLowerCase(), s = h.settings;
        const mode = { coop: !!s.coop, deathmatch: !!s.deathmatch, players: Number(s.players) || 2 };
        const now = name === 'deathmatch' ? (mode.deathmatch ? '1' : '0') : name === 'coop' ? (mode.coop && !mode.deathmatch ? '1' : '0') : String(mode.coop ? mode.players : 1);
        if (!arg) { say(`"${name}" is "${now}"`); return; }
        if (name === 'maxclients') {
          const n = Number(arg);
          if (!Number.isInteger(n) || n < 1 || n > 4) { say('maxclients takes 1 to 4', true); return; }
          if (n === 1) { mode.coop = false; mode.deathmatch = false; } else { mode.players = n; mode.coop = true; }
        } else {
          if (!/^(0|1)$/.test(arg)) { say(`${name} takes 0 or 1`, true); return; }
          const on = arg === '1';
          if (name === 'deathmatch') { mode.deathmatch = on; if (on) mode.coop = true; }
          else if (on) { mode.coop = true; mode.deathmatch = false; }
          else if (!mode.deathmatch) mode.coop = false;
          if (mode.coop) mode.players = Math.max(2, mode.players);
        }
        h.setGameMode?.(mode);
        say(`${name} will be changed for next game.`);
        return;
      }
      case 'demos': {
        // the page's own: the pak's demos and the recordings kept (this session's, and the earlier ones' from the store)
        const d = h.listDemos?.() ?? { pak: [], kept: [] };
        say(`demos: ${d.pak.length ? d.pak.join(', ') : 'none in the pak'}; recorded: ${d.kept.length ? d.kept.join(', ') : 'none'}`, false, 5000);
        return;
      }
      case 'deldemo': {
        // the page's own: a kept recording dropped, from the select and the store; the pak's demos are not the page's to drop
        const name = arg.toLowerCase().replace(/\.dm2$/, '');
        if (!name) { say('deldemo <demoname>', true); return; }
        if (!(await h.dropDemo?.(name))) { say(`no recording "${name}"`, true); return; }
        say(`${name} dropped`);
        return;
      }
      case 'record': {
        // CL_Record_f: the game from here on written as a demo (src/record.js), until `stop` or the level's end
        const name = arg.toLowerCase().replace(/\.dm2$/, '').replace(/[^a-z0-9_-]/g, '');
        if (!name) { say('record <demoname>', true); return; }
        if (h.isRecording?.()) { say('Already recording.', true); return; }
        if (!h.isRunning()) { say('You must be in a level to record.', true); return; }
        await h.record?.(name);
        return;
      }
      case 'stop':
        // CL_Stop_f: the demo written out (the page downloads it and keeps it in the Demo select)
        if (!h.isRecording?.()) { say('Not recording a demo.', true); return; }
        await h.stopRecord?.();
        return;
      case 'inven': h.toggleInventory(); return;
      case 'fov': {
        // the client's fov, clamped as ClientUserinfoChanged clamped it (1-160); no argument shows it
        const v = Number(arg);
        if (!arg || !Number.isFinite(v)) { say(`"fov" is "${h.settings.fov}"`); return; }
        h.settings.fov = Math.max(1, Math.min(160, Math.round(v)));
        h.saveSettings();
        await h.setView(h.settings.fov);
        return;
      }
      case 'seed': {
        // the game's chances come from a seeded generator (rnd() in game.sql): no argument shows the seed this game
        // began with and the generator's state now; a number seeds the next new game, so a run can be played again
        if (!arg) {
          const g = (await h.db.query("SELECT g.rng_seed s, RDB$GET_CONTEXT('USER_SESSION', 'rng') r FROM game g WHERE g.id = 1")).rows[0];
          say(`seed ${g?.S ?? '?'} (the generator is at ${g?.R ?? '?'})`, false, 4000);
          return;
        }
        const v = Number(arg);
        if (!Number.isFinite(v)) { say('seed takes a number', true); return; }
        const seed = Math.floor(v) >>> 0;
        await h.db.query("SELECT RDB$SET_CONTEXT('USER_SESSION', 'rng', ?) FROM rdb$database", [seed]);
        say(`the next new game starts from seed ${seed}`);
        return;
      }
      case 'skill': {
        // the skill cvar: no argument shows it; 0 easy, 1 medium, 2 hard, 3 nightmare (SpawnEntities clamped it so),
        // and nightmare only from here, as the menus stop at hard. It was latched (CVAR_LATCH in g_main.c): set with
        // a game running it took hold at the next map, "skill will be changed for next game."
        if (!arg) { say(`"skill" is "${h.settings.skill}"`); return; }
        const v = Number(arg);
        if (!Number.isFinite(v)) { say('skill takes a number: 0 easy, 1 medium, 2 hard, 3 nightmare', true); return; }
        const value = Math.max(0, Math.min(3, Math.floor(v)));
        h.settings.skill = value;
        h.saveSettings();
        h.setSkill?.(value);
        say(h.isRunning() ? 'skill will be changed for next game.' : `"skill" is "${value}"`);
        return;
      }
      case 'connect': {
        // CL_Connect_f: a game over the network joined with the host's code (at the relay) or its offer text, as Join and
        // Answer would; the host's answer, by text, shows in the box to send back
        if (!arg) { say('usage: connect <code or offer>', true); return; }
        if (!(await h.connect?.(arg))) { say('connect: no pak is loaded yet', true); return; }
        say(`connecting to ${arg.length > 24 ? `${arg.slice(0, 24)}…` : arg}`);
        return;
      }
      case 'disconnect':
        // CL_Disconnect_f: the connection dropped (the Leave button); a joined page starts a game of its own
        { const was = !!h.disconnect?.(); say(was ? 'disconnected' : 'not connected', !was); }
        return;
      case 'reconnect': {
        // CL_Reconnect_f: the last host joined again (its code at the relay, under which Host again publishes, or its offer)
        const last = h.lastConnect?.() ?? '';
        if (!last) { say('reconnect: this page has not joined a game yet', true); return; }
        await h.reconnect?.();
        say(`reconnecting to ${last.length > 24 ? `${last.slice(0, 24)}…` : last}`);
        return;
      }
      case 'alias': {
        // Cmd_Alias_f: `alias` lists them, `alias <name> <line>` names a line (the rest of the command, `;` and all: it ran as
        // one line, so quote it where a bind would), `alias <name>` an empty one; a name past 32 characters is refused
        const [name, ...words] = arg.split(/\s+/).filter(Boolean);
        if (!name) {
          say(this.aliases.size ? `Current alias commands: ${[...this.aliases].map(([n, l]) => `${n} : ${l}`).join(' · ')}` : 'Current alias commands: none', false, 8000);
          return;
        }
        if (name.length >= MAX_ALIAS_NAME) { say('Alias name is too long', true); return; }
        const value = words.join(' ').replace(/^"(.*)"$/, '$1');
        this.aliases.set(name.toLowerCase(), value);
        say(`alias ${name.toLowerCase()} : ${value}`);
        return;
      }
      case 'wait': return;   // (alone on a line: nothing to hold back)
      case 'menu_main': case 'menu_game': case 'menu_loadgame': case 'menu_savegame': case 'menu_options': case 'menu_keys':
      case 'menu_video': case 'menu_multiplayer': case 'menu_playerconfig': case 'menu_credits': case 'menu_quit': {
        // M_Init's commands (M_Menu_Main_f and its kin): the menu opens over the view, so a key bound to one opens it
        if (!h.openMenu?.(cmd.toLowerCase().slice(5))) say(`${cmd.toLowerCase()}: the menus wait on the pak`, true);
        return;
      }
      case 'players': {
        // SV_Status_f: the game's clients on the page's one line, each with its number, its name and what drives it (this
        // page; a guest, with the frames sent to it and dropped, and watching when it only watches; a pad; nothing, standing)
        const rows = h.listPlayers?.();
        if (rows === 'guest') { say('players: the host lists them', true); return; }
        if (!rows) { say('players: no game is running', true); return; }
        const what = (r) => (r.kind === 'page' ? 'this page' : r.kind === 'guest' ? `guest: ${r.sent} frames sent${r.dropped ? `, ${r.dropped} dropped` : ''}${r.ping != null ? `, ping ${r.ping} ms` : ''}${r.spectator ? ', watching' : ''}` : r.kind === 'pad' ? 'a pad' : 'standing');
        say(rows.map((r) => `${r.num} ${r.name} (${what(r)})`).join(' · '), false, 8000);
        return;
      }
      case 'kick': {
        // SV_Kick_f: the guest driving a client dropped by the client's number, at the host's console alone
        const n = Number(arg);
        if (!arg || !Number.isInteger(n)) { say('Usage: kick <userid>', true); return; }
        const r = h.kick?.(n) ?? 'not-hosting';
        if (r === 'not-hosting') say('kick: only the host of a game over the network can kick', true);
        else if (r === 'none') say(`Bad user id: no guest drives client ${n}`, true);
        else say(`${r} was kicked`);
        return;
      }
      case 'spectator': {
        // 3.20's spectator userinfo, for a page that has joined a game: no argument shows it, 0 or 1 sets it (the host
        // puts the client back in as a watcher with no body, or as a player again)
        const now = h.setSpectator?.(null);
        if (now === null || now === undefined) { say('spectator: only a page that has joined a game can watch', true); return; }
        if (!arg) { say(`"spectator" is "${now}"`); return; }
        const v = Number(arg);
        if (!Number.isFinite(v)) { say('spectator takes 0 or 1', true); return; }
        h.setSpectator(v !== 0);
        say(v !== 0 ? 'spectator: watching' : 'spectator: playing again');
        return;
      }
      case 'rtc_ice': {
        // the ICE server the next network game adds to the STUN, for the networks a STUN cannot cross (a TURN relay:
        // `rtc_ice turn:host:3478 user pass`); no argument shows it, `none` clears it. Kept in the settings.
        if (!arg) { say(`"rtc_ice" is "${h.settings.rtcIce || 'none'}"`); return; }
        if (/^(none|off|0)$/i.test(arg)) { h.settings.rtcIce = ''; h.saveSettings(); say('rtc_ice: the STUN server alone'); return; }
        try { parseIceServer(arg); } catch (err) { say(`rtc_ice: ${err.message}`, true); return; }
        h.settings.rtcIce = arg.trim().split(/\s+/).join(' ');
        h.saveSettings();
        say(`rtc_ice: ${h.settings.rtcIce.split(' ')[0]} for the next network game`);
        return;
      }
      case 'rtc_signal': {
        // the signalling relay (scripts/signal.mjs) the next network game passes its offer and answer through under a
        // room code, in place of the texts; no argument shows it, `none` clears it. Kept in the settings; both pages set it.
        if (!arg) { say(`"rtc_signal" is "${h.settings.rtcSignal || 'none'}"`); return; }
        if (/^(none|off|0)$/i.test(arg)) { h.settings.rtcSignal = ''; h.saveSettings(); say('rtc_signal: the offer and the answer as texts'); return; }
        if (!/^https?:\/\/\S+$/i.test(arg) || arg.length > 300) { say("rtc_signal takes the relay's http(s) url", true); return; }
        h.settings.rtcSignal = arg.replace(/\/+$/, '');
        h.saveSettings();
        say(`rtc_signal: ${h.settings.rtcSignal} for the next network game`);
        return;
      }
      case 'bind': {
        // Key_Bind_f over the keys menu's binds (settings.binds): `bind <key> <command>` binds the key (named as the keys menu
        // names it: k, 3, UPARROW, CTRL, MOUSE1, KP_5…) to the action whose command that is (+attack, weapnext, use silencer…),
        // as bindKey binds it, and any other line (`bind k god`, `bind t "say hello"`) to run at the console when the key goes
        // down (settings.lines, bindLine), as Quake ran a key's binding through Cbuf; `bind <key>` shows the key's binding.
        // A key the page has not, or a line it cannot keep (not printable, past 128 characters), is refused.
        const [key, ...words] = arg.split(/\s+/).filter(Boolean);
        if (!key) { say('bind <key> [command] : attach a command to a key', true); return; }
        const code = keyCode(key);
        if (!code) { say(`"${key}" isn't a valid key`, true); return; }
        const binds = h.settings.binds, lines = h.settings.lines ?? (h.settings.lines = {});
        if (!words.length) {
          const a = ACTIONS.find((x) => binds[x.id]?.includes(code));
          say(a ? `"${keyName(code)}" = "${a.cmd}"` : lines[code] ? `"${keyName(code)}" = "${lines[code]}"` : `"${keyName(code)}" is not bound`);
          return;
        }
        const command = words.join(' ').replace(/^"(.*)"$/, '$1');   // (config.cfg quotes the command)
        const act = actionOfCommand(command);
        if (act) bindKey(binds, act.id, code, lines);
        else {
          const line = checkLine(command);
          if (!line) { say(`"${command}" is not a line this page can bind (printable, at most 128 characters)`, true); return; }
          bindLine(binds, lines, code, line);
        }
        h.saveSettings();
        say(`"${keyName(code)}" = "${act ? act.cmd : lines[code]}"`);
        return;
      }
      case 'unbind': {
        // Key_Unbind_f: the key leaves whatever it was bound to, an action or a line
        if (!arg) { say('unbind <key> : remove commands from a key', true); return; }
        const code = keyCode(arg);
        if (!code) { say(`"${arg}" isn't a valid key`, true); return; }
        unbindKey(h.settings.binds, h.settings.lines, code);
        h.saveSettings();
        say(`"${keyName(code)}" unbound`);
        return;
      }
      case 'unbindall': {
        // Key_Unbindall_f: every action loses its keys, and every line its key (the keys menu's reset defaults, or bind, gives them back)
        for (const a of ACTIONS) h.settings.binds[a.id] = [];
        h.settings.lines = {};
        h.saveSettings();
        say('all keys unbound');
        return;
      }
      case 'bindlist': {
        // Key_Bindlist_f: every key bound with its command, in the actions' order, the lines after, on the one line the page has
        const lines = [];
        for (const a of ACTIONS) for (const c of h.settings.binds[a.id] ?? []) lines.push(`${keyName(c)} "${a.cmd}"`);
        for (const [c, line] of Object.entries(h.settings.lines ?? {})) lines.push(`${keyName(c)} "${line}"`);
        say(lines.length ? lines.join(' · ') : 'no keys bound', false, 8000);
        return;
      }
      case 'save': return h.saveGame();
      case 'load': return h.loadGame();
      case 'dmflags': case 'fraglimit': case 'timelimit': case 'cheats': {
        // the deathmatch cvars, and cheats (CheatsOk: god, notarget, noclip and give in a deathmatch only with it): no
        // argument shows one; a number sets it for the game running and the next ones
        const name = cmd.toLowerCase();
        const v = Number(arg);
        if (!arg || !Number.isFinite(v)) { say(`"${name}" is "${h.settings[name]}"`); return; }
        const value = Math.max(0, Math.min(name === 'dmflags' ? 65535 : name === 'cheats' ? 1 : 999, Math.floor(v)));
        h.settings[name] = value;
        h.saveSettings();
        await h.setCvar?.(name, value);
        return;
      }
      default:
        if (!h.isRunning()) return;
        if (h.forward?.(cmd, arg)) return;   // (a joined page: the command goes to the host, which runs it for this page's client, as Cmd_ForwardToServer sent it)
        try { await h.db.query('SELECT msg FROM player_command(?, ?)', [cmd, arg]); }
        catch (err) { console.error(err); say(`${cmd}: ${err.message}`, true); }
    }
  }
}
