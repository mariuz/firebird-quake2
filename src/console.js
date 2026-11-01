// console.js – Quake's console line: the commands the page runs itself (map, fov, seed, save, load,
// inven, bind and its kin over the keys menu's binds, rtc_ice …) and the rest handed to the game's player_command (god, noclip, give, use, kill, drop …);
// the history (Key_Console: up and down step through the lines typed) and Tab completion
// (Cmd_CompleteCommand: the first command that starts with what is typed).
//
// Nothing here touches the DOM: the page wires the input element to historyStep(), complete() and
// submit(), and gives a host with what the commands act on, so the tests can drive it with a fake one.

import { parseChangeMap } from './levels.js';
import { parseIceServer } from './net.js';
import { ACTIONS, actionOfCommand, bindKey, bindLine, unbindKey, checkLine, keyCode, keyName } from './input.js';

export const COMMANDS = ['alias', 'bind', 'bindlist', 'bob_pitch', 'bob_roll', 'bob_up', 'cd', 'cd_loopcount', 'cd_looptrack', 'cd_nocd', 'cd_volume', 'centerview', 'chase', 'cheats', 'cl_add_blend', 'cl_add_entities', 'cl_add_lights', 'cl_add_particles', 'cl_anglespeedkey', 'cl_footsteps', 'cl_forwardspeed', 'cl_gun', 'cl_lightlevel', 'cl_maxfps', 'cl_paused', 'cl_pitchspeed', 'cl_predict', 'cl_run', 'cl_showclamp', 'cl_showmiss', 'cl_shownet', 'cl_sidespeed', 'cl_testblend', 'cl_testentities', 'cl_testlights', 'cl_testparticles', 'cl_timeout', 'cl_upspeed', 'cl_yawspeed', 'clear', 'cmd', 'cmdlist', 'con_notifytime', 'condump', 'connect', 'coop', 'crosshair', 'cvarlist', 'deathmatch', 'debuggraph', 'deldemo', 'demomap', 'demos', 'developer', 'dir', 'disconnect', 'dmflags', 'drop', 'dumpuser', 'echo', 'exec', 'fixedtime', 'flood_msgs', 'flood_persecond', 'flood_waitdelay', 'fov', 'fraglimit', 'freelook', 'g_select_empty', 'gamemap', 'gender', 'give', 'god', 'graphheight', 'graphscale', 'graphshift', 'gun_x', 'gun_y', 'gun_z', 'hand', 'help', 'host_speeds', 'hostname', 'imagelist', 'impulse', 'in_joystick', 'in_mouse', 'in_restart', 'invdrop', 'inven', 'invnext', 'invprev', 'invuse', 'joy_forwardsensitivity', 'joy_forwardthreshold', 'joy_pitchsensitivity', 'joy_pitchthreshold', 'joy_sidesensitivity', 'joy_sidethreshold', 'joy_yawsensitivity', 'joy_yawthreshold', 'kick', 'kill', 'killserver', 'load', 'log_stats', 'logfile', 'lookspring', 'lookstrafe', 'm_filter', 'm_forward', 'm_pitch', 'm_side', 'm_yaw', 'map', 'maxclients', 'menu_addressbook', 'menu_credits', 'menu_dmoptions', 'menu_game', 'menu_joinserver', 'menu_keys', 'menu_loadgame', 'menu_main', 'menu_multiplayer', 'menu_options', 'menu_playerconfig', 'menu_quit', 'menu_savegame', 'menu_startserver', 'menu_video', 'messagemode', 'messagemode2', 'modellist', 'msg', 'name', 'netgraph', 'nextserver', 'noclip', 'notarget', 'password', 'path', 'pause', 'play', 'playerlist', 'players', 'putaway', 'quit', 'r_drawentities', 'r_drawworld', 'r_dspeeds', 'r_fullbright', 'r_lerpmodels', 'r_lockpvs', 'r_novis', 'r_speeds', 'rate', 'rcon', 'rcon_password', 'reconnect', 'record', 'rtc_ice', 'rtc_signal', 'run_pitch', 'run_roll', 's_khz', 's_mixahead', 's_show', 's_testsound', 's_volume', 'save', 'say', 'say_team', 'score', 'scr_centertime', 'scr_showpause', 'scr_showturtle', 'screenshot', 'seed', 'sensitivity', 'serverinfo', 'set', 'showdrop', 'showpackets', 'sizedown', 'sizeup', 'skill', 'skin', 'skins', 'sky', 'snd_restart', 'soundinfo', 'soundlist', 'spectator', 'spectator_password', 'status', 'stop', 'stopsound', 'sv_airaccelerate', 'sv_gravity', 'sv_maplist', 'sv_maxvelocity', 'sv_noreload', 'sv_rollangle', 'sv_rollspeed', 'sw_aliasstats', 'sw_clearcolor', 'sw_drawflat', 'sw_maxsurfs', 'sw_mipcap', 'sw_mipscale', 'sw_reportsurfout', 'sw_stipplealpha', 'sw_waterwarp', 'timedemo', 'timegraph', 'timelimit', 'timeout', 'timerefresh', 'timescale', 'togglechat', 'toggleconsole', 'unautoexec', 'unbind', 'unbindall', 'use', 'userinfo', 'version', 'vid_fullscreen', 'vid_gamma', 'vid_mode', 'vid_ref', 'vid_restart', 'viewpos', 'viewsize', 'wait', 'wave', 'weaplast', 'weapnext', 'weapprev', 'writeconfig', 'z_stats'];

/**
 * The settings as Quake's cvars (the names the options and player setup menus set, as config.cfg named them): the
 * setting each stands for, its value as the cvar showed it and the setting's value from a word typed (null for one
 * the cvar refuses). m_pitch is 0.022 or -0.022 (the invert mouse option), s_volume and cd_volume 0..1, cl_run 0 or 1.
 */
// IN_JoyMove's cvars: a threshold 0 to 0.9 of a stick's throw, a sensitivity -10 to 10 (a number as typed, no padding)
const readThreshold = (w) => { const n = Number(w); return /^-?\d*\.?\d+$/.test(w) && n >= 0 && n <= 0.9 ? n : null; };
const readSens = (w) => { const n = Number(w); return /^-?\d*\.?\d+$/.test(w) && n >= -10 && n <= 10 ? n : null; };
export const CVARS = {
  name: { key: 'name', show: (v) => String(v ?? ''), read: (w) => (/^[\x20-\x7e]{0,15}$/.test(w) ? w : null), help: 'at most 15 printable characters' },
  hand: { key: 'hand', show: (v) => String(v), read: (w) => ([0, 1, 2].includes(Number(w)) ? Number(w) : null), help: '0 right, 1 left, 2 center' },
  // the gender userinfo (archived, as Quake's was): a word, male by default; one starting with f is female, with m male, any other neutral
  // (IsFemale, IsNeutral): the obituaries' pronouns and the sexed sounds
  gender: { key: 'gender', show: (v) => String(v ?? 'male'), read: (w) => (/^[\x21-\x7e]{1,15}$/.test(w) ? w : null), help: 'a word: male, female or none' },
  // the msg userinfo (archived, as Quake's was): the level a print must reach this client, 0 low (every print), 1 medium (Quake's default:
  // the "No shells for shotgun" prints off), 2 high, 3 chat alone, as SV_ClientPrintf filtered them
  msg: { key: 'msg', show: (v) => String(v), read: (w) => (/^[0-3]$/.test(w) ? Number(w) : null), help: '0 to 3' },
  // the rate userinfo (archived, as Quake's was): the bytes a second this client asks the host's frames to keep under (SV_RateDrop holds a
  // frame past the sum of the last second's); clamped as SV_UserinfoChanged clamped it, to 1000..1000000 here (Quake's 100..25000 was a
  // modem's figure for frames of a few hundred bytes: a frame here is the face list, kilobytes, twenty a second)
  rate: { key: 'rate', show: (v) => String(v), read: (w) => (/^\d{1,7}$/.test(w) ? Math.max(1000, Math.min(1000000, Number(w))) : null), help: 'bytes a second, 1000 to 1000000' },
  // the skin userinfo (archived, as Quake's was): model/skin, male/grunt by default, kept and sent with the userinfo as ClientUserinfoChanged
  // took it; the model and skin wait on a pak that has them
  skin: { key: 'skin', show: (v) => String(v ?? 'male/grunt'), read: (w) => (/^[\w-]{1,15}\/[\w-]{1,15}$/.test(w) ? w : null), help: 'model/skin, as male/grunt' },
  sensitivity: { key: 'sensitivity', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) ? Math.max(1, Math.min(20, n)) : null; }, help: '1 to 20' },
  cl_run: { key: 'alwaysRun', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1' },
  m_pitch: { key: 'invertMouse', show: (v) => (v ? '-0.022' : '0.022'), read: (w) => { const n = Number(w); return Number.isFinite(n) && n !== 0 ? n < 0 : null; }, help: '0.022, or -0.022 to invert' },
  crosshair: { key: 'crosshair', show: (v) => String(v), read: (w) => (/^[0-3]$/.test(w) ? Number(w) : null), help: '0 to 3' },
  s_volume: { key: 'sfx', show: (v) => (v / 100).toFixed(2), read: (w) => { const n = Number(w); return Number.isFinite(n) ? Math.round(Math.max(0, Math.min(1, n)) * 100) : null; }, help: '0 to 1' },
  // s_khz (S_Init's rate: 11, 22 or 44 kHz, the mixer's context made at it on the next snd_restart; 44 the browser's own rate, the default here), archived
  s_khz: { key: 'sKhz', show: (v) => String(v), read: (w) => (/^(11|22|44)$/.test(w) ? Number(w) : null), help: '11, 22 or 44' },
  // s_mixahead (S_Update's lead: how far past the clock the mixer painted, 0.2 for a DMA; here how far ahead of the clock the raw stream's
  // samples, a cinematic's, are queued when they start or have fallen behind, 0.05: a frame's worth), archived as Quake's was; s_testsound
  // (S_TransferPaintBuffer's fixed sine in place of the mix, the sounds muted while it plays), not archived
  s_mixahead: { key: 'sMixahead', show: (v) => String(v), read: (w) => { const n = Number(w); return /^\d*\.?\d+$/.test(w) && n >= 0 && n <= 1 ? n : null; }, help: '0 to 1 seconds' },
  s_testsound: { key: 'sTestsound', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  cd_volume: { key: 'music', show: (v) => (v / 100).toFixed(2), read: (w) => { const n = Number(w); return Number.isFinite(n) ? Math.round(Math.max(0, Math.min(1, n)) * 100) : null; }, help: '0 to 1' },
  // the music's loop as CDAudio_Update had it: cd_loopcount times the map's track, then cd_looptrack over and over; cd_nocd 1 no music (archived, as Quake's was)
  cd_loopcount: { key: 'cdLoopcount', show: (v) => String(v), read: (w) => (/^\d{1,2}$/.test(w) && Number(w) >= 1 ? Number(w) : null), help: '1 to 99', archive: false },
  cd_looptrack: { key: 'cdLooptrack', show: (v) => String(v), read: (w) => (/^\d{1,2}$/.test(w) ? Number(w) : null), help: 'a track, 0 to 99', archive: false },
  cd_nocd: { key: 'cdNocd', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1' },
  // s_show (S_Update's print of the channels playing: here a line a sound started, "left right name"), not archived as Quake's was not
  s_show: { key: 'sShow', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  // the mouse look cvars (CL_MouseMove, IN_MLookUp): free look (the mouse looks without +mlook held; off, its vertical walks the
  // player, as Quake's default had it; on here, as the mouse always looked), lookspring (+mlook let go levels the view, free look
  // off), lookstrafe (+mlook held, the mouse's horizontal sidesteps), and m_forward and m_side, the walk and the sidestep a count
  // (not archived, as Quake's were not)
  freelook: { key: 'freelook', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1' },
  lookspring: { key: 'lookspring', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1' },
  lookstrafe: { key: 'lookstrafe', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1' },
  m_forward: { key: 'mForward', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && Math.abs(n) <= 100 ? n : null; }, help: 'a number, 1 as Quake had it', archive: false },
  m_side: { key: 'mSide', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && Math.abs(n) <= 100 ? n : null; }, help: 'a number, 1 as Quake had it', archive: false },
  // m_filter (CL_MouseMove: each sample averaged with the one before), archived as Quake's was
  m_filter: { key: 'mFilter', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1' },
  // in_joystick (IN_Frame's: the pads read; 0 leaves them unread), archived as Quake's was, 1 here where Quake's was 0
  in_joystick: { key: 'inJoystick', show: (v) => (v === false ? '0' : '1'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1' },
  // in_mouse (IN_StartupMouse's: 0 leaves the mouse unread, Input.mouseOn; archived as Quake's was)
  in_mouse: { key: 'inMouse', show: (v) => (v === false ? '0' : '1'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1' },
  // IN_JoyMove's cvars (none archived, as Quake's were not): the thresholds the sticks' dead zones (of the throw, 0.15), the sensitivities their
  // speeds with Quake's signs (-1 forward, side and yaw, 1 pitch: the standard mapping's directions; 2 doubles a stick, the other sign turns it)
  joy_forwardthreshold: { key: 'joyForwardthreshold', show: (v) => String(v), read: readThreshold, help: '0 to 0.9', archive: false },
  joy_sidethreshold: { key: 'joySidethreshold', show: (v) => String(v), read: readThreshold, help: '0 to 0.9', archive: false },
  joy_pitchthreshold: { key: 'joyPitchthreshold', show: (v) => String(v), read: readThreshold, help: '0 to 0.9', archive: false },
  joy_yawthreshold: { key: 'joyYawthreshold', show: (v) => String(v), read: readThreshold, help: '0 to 0.9', archive: false },
  joy_forwardsensitivity: { key: 'joyForwardsensitivity', show: (v) => String(v), read: readSens, help: '-10 to 10', archive: false },
  joy_sidesensitivity: { key: 'joySidesensitivity', show: (v) => String(v), read: readSens, help: '-10 to 10', archive: false },
  joy_pitchsensitivity: { key: 'joyPitchsensitivity', show: (v) => String(v), read: readSens, help: '-10 to 10', archive: false },
  joy_yawsensitivity: { key: 'joyYawsensitivity', show: (v) => String(v), read: readSens, help: '-10 to 10', archive: false },
  // the network graph along the bottom of a joined page's view (SCR_DrawDebugGraph: a column a frame); not archived, as Quake's was not
  netgraph: { key: 'netgraph', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  // cl_scrn.c's debug graph as it registered the cvars (no scr_ on the names): timegraph 1 adds a frame's time as a column (cls.frametime × 300),
  // debuggraph 1 draws the band whatever it holds, graphheight, graphscale and graphshift lay it out as SCR_DrawDebugGraph did; none archived
  timegraph: { key: 'timegraph', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  debuggraph: { key: 'debuggraph', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  graphheight: { key: 'graphheight', show: (v) => String(v), read: (w) => (/^\d{1,3}$/.test(w) && Number(w) >= 1 && Number(w) <= 240 ? Number(w) : null), help: 'pixels, 1 to 240', archive: false },
  graphscale: { key: 'graphscale', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && n >= -100 && n <= 100 ? n : null; }, help: 'a number from -100 to 100', archive: false },
  graphshift: { key: 'graphshift', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && n >= -240 && n <= 240 ? n : null; }, help: 'pixels, -240 to 240', archive: false },
  // a guest's prediction (CL_PredictMovement): cl_predict 0 paints the host's frames as they come, cl_showmiss 1 prints each
  // prediction miss as CL_CheckPredictionError printed it; neither archived, as Quake's were not
  cl_predict: { key: 'clPredict', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  cl_showmiss: { key: 'clShowmiss', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  // cl_shownet (CL_ParseServerMessage's prints on a joined page: 1 each message's size, 2 its size and kind) and cl_showclamp (CL_ParseFrame's
  // "high clamp" and "low clamp": the wall ahead of the game past two tics, a host frame past its time), neither archived
  cl_shownet: { key: 'clShownet', show: (v) => String(v), read: (w) => (/^[0-2]$/.test(w) ? Number(w) : null), help: '0, 1 or 2', archive: false },
  cl_showclamp: { key: 'clShowclamp', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  // showpackets (Netchan_Transmit's and Netchan_Process's prints at either end of a shared game: each message's direction, size and kind) and
  // showdrop (Netchan_Process's "Dropped %i packets at %i": at the host each frame dropped or held, at a joined page the frames missed before one), neither archived
  showpackets: { key: 'showpackets', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  showdrop: { key: 'showdrop', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  // SCR_CalcVrect's viewsize: the 3D view's share of the screen, 40 to 100 percent, the backtile around a smaller one (sizeup and sizedown step it by ten)
  viewsize: { key: 'viewsize', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) ? Math.max(40, Math.min(100, Math.round(n))) : null; }, help: '40 to 100' },
  // ref_soft's switches (none archived, as Quake's were not): r_fullbright 1 lights nothing, r_drawentities 0 and r_drawworld 0 leave
  // the entities or the world out, r_lerpmodels 0 blends no poses, r_novis 1 marks every leaf, r_speeds 1 prints the frame's figures
  r_fullbright: { key: 'rFullbright', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  // V_RenderView's switches (cl_add_entities, cl_add_particles, cl_add_lights, cl_add_blend: 0 leaves that out of a frame) and tests (cl_testentities,
  // cl_testlights, cl_testparticles: V_TestEntities', V_TestLights' and V_TestParticles' rings about the eye; cl_testblend: V_TestBlend's blend), none archived
  cl_add_entities: { key: 'clAddEntities', show: (v) => (v === false ? '0' : '1'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  cl_add_particles: { key: 'clAddParticles', show: (v) => (v === false ? '0' : '1'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  cl_add_lights: { key: 'clAddLights', show: (v) => (v === false ? '0' : '1'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  cl_add_blend: { key: 'clAddBlend', show: (v) => (v === false ? '0' : '1'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  cl_testentities: { key: 'clTestentities', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  cl_testparticles: { key: 'clTestparticles', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  cl_testlights: { key: 'clTestlights', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  cl_testblend: { key: 'clTestblend', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  r_drawentities: { key: 'rDrawentities', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  r_drawworld: { key: 'rDrawworld', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  r_lerpmodels: { key: 'rLerpmodels', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  r_novis: { key: 'rNovis', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  r_lockpvs: { key: 'rLockpvs', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },   // (ref_soft's: the view's cluster held where it was locked, the leaves marked from there as the eye moves on)
  r_speeds: { key: 'rSpeeds', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  r_dspeeds: { key: 'rDspeeds', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },   // (ref_soft's: the painter's times in detail on the line once a second, as R_RenderFrame printed its "ms"s)
  // host_speeds (Qcommon_Frame's "all, sv, gm, cl, rf" line, once a second here), not archived
  host_speeds: { key: 'hostSpeeds', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  // developer (Com_DPrintf's switch: the page's warnings, console.warn's, on the console too), not archived as Quake's was not
  developer: { key: 'developer', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  // sv_noreload (3.20's: a level of the unit come back to spawns fresh, what was left in it unread; a coop game's monsters alive again), not archived
  sv_noreload: { key: 'svNoreload', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  // ref_soft's sw_ switches (none archived): sw_drawflat 1 paints every face in a flat colour of its own (D_DrawflatSurfaces), sw_waterwarp 0 leaves the
  // view under water unwarped (D_WarpScreen skipped), sw_clearcolor is the palette index the view is cleared to (2 in Quake, 0 here)
  sw_drawflat: { key: 'swDrawflat', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  sw_waterwarp: { key: 'swWaterwarp', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  sw_clearcolor: { key: 'swClearcolor', show: (v) => String(v), read: (w) => (/^\d{1,3}$/.test(w) && Number(w) <= 255 ? Number(w) : null), help: 'a palette index, 0 to 255', archive: false },
  // sw_mipcap (d_minmip: the least mip level, 0 to 3) and sw_mipscale (d_scalemip: D_MipLevelForScale's thresholds scaled, 1), neither archived;
  // sw_stipplealpha (translucent surfaces stippled in place of the blend, R_DrawSpanlet66Stipple and _33Stipple), archived as Quake's was
  sw_mipcap: { key: 'swMipcap', show: (v) => String(v), read: (w) => (/^[0-3]$/.test(w) ? Number(w) : null), help: '0 to 3', archive: false },
  sw_mipscale: { key: 'swMipscale', show: (v) => String(v), read: (w) => (/^\d+(\.\d+)?$/.test(w) && Number(w) <= 10 ? Number(w) : null), help: 'a number from 0 to 10, 1 as Quake had it', archive: false },
  sw_stipplealpha: { key: 'swStipplealpha', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1' },
  // the painter's reports, once a second on the console's line (none archived, as ref_soft's were not): sw_aliasstats (R_PrintAliasStats: the
  // polygon models drawn, and their triangles), sw_reportsurfout ("Short %d surfaces": the surfaces built after the cache overflowed in a
  // frame, as r_outofsurfaces counted the ones past r_surfaces); sw_maxsurfs the surface cache's size (0 the painter's own 2000, as Quake's 0 was its 768)
  sw_aliasstats: { key: 'swAliasstats', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  sw_reportsurfout: { key: 'swReportsurfout', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  sw_maxsurfs: { key: 'swMaxsurfs', show: (v) => String(v), read: (w) => (/^\d{1,6}$/.test(w) && Number(w) <= 100000 ? Number(w) : null), help: "0 for the painter's own 2000, or a size up to 100000", archive: false },
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
  cl_upspeed: { key: 'clUpspeed', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : null; }, help: 'units a second, 0 to 1000', archive: false },   // (the usercmd's upmove: +moveup and +movedown swimming, flying and in noclip; under 10 no jump)
  // timeout (SV_CheckTimeouts: the host drops a guest silent that many seconds, 125) and cl_timeout (CL_CheckTimeout: a guest leaves a host silent that
  // long, 120); 0 never; neither archived, as Quake's were not
  timeout: { key: 'timeout', show: (v) => String(v), read: (w) => (/^\d{1,4}$/.test(w) && Number(w) <= 3600 ? Number(w) : null), help: 'seconds, 0 to 3600', archive: false },
  cl_timeout: { key: 'clTimeout', show: (v) => String(v), read: (w) => (/^\d{1,4}$/.test(w) && Number(w) <= 3600 ? Number(w) : null), help: 'seconds, 0 to 3600', archive: false },
  // gun_x, gun_y and gun_z (SV_CalcGunOffset's development tools, 0: the view weapon moved along the view's right, forward and down) and
  // scr_centertime (SCR_DrawCenterString: a centre print's seconds, 2.5); none archived, as Quake's were not
  gun_x: { key: 'gunX', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && Math.abs(n) <= 100 ? n : null; }, help: 'units, -100 to 100', archive: false },
  gun_y: { key: 'gunY', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && Math.abs(n) <= 100 ? n : null; }, help: 'units, -100 to 100', archive: false },
  gun_z: { key: 'gunZ', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && Math.abs(n) <= 100 ? n : null; }, help: 'units, -100 to 100', archive: false },
  scr_centertime: { key: 'scrCentertime', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) && n >= 0 && n <= 60 ? n : null; }, help: 'seconds, 0 to 60', archive: false },
  // cl_footsteps (CL_EntityEvent: 0 plays no footstep, the game's and a demo's), not archived as Quake's was not
  cl_footsteps: { key: 'clFootsteps', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  // scr_showpause (SCR_DrawPause: 0 draws no plaque), scr_showturtle (the turtle at the view's corner after three frames of a tenth of a
  // second or more, 0 by default) and cl_maxfps (CL_Frame: a frame painted once 1000/cl_maxfps ms have passed, 90; 0 every animation
  // frame, else 5 to 1000); none archived, as Quake's were not
  scr_showpause: { key: 'scrShowpause', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  scr_showturtle: { key: 'scrShowturtle', show: (v) => (v ? '1' : '0'), read: (w) => (/^(0|1)$/.test(w) ? w === '1' : null), help: '0 or 1', archive: false },
  cl_maxfps: { key: 'clMaxfps', show: (v) => String(v), read: (w) => { const n = Number(w); return n === 0 ? 0 : Number.isFinite(n) && n >= 5 && n <= 1000 ? n : null; }, help: '0 (every frame) or 5 to 1000', archive: false },
  // vid_gamma: the video menu's brightness (the lightmaps' modulate: the control's tenths from 1 to 1.8, 1.4 by default, a number between
  // snapped and clamped to them), archived as Quake's was; vid_fullscreen is the page's live state, a case of its own
  vid_gamma: { key: 'brightness', show: (v) => String(v), read: (w) => { const n = Number(w); return Number.isFinite(n) ? Math.round(Math.max(1, Math.min(1.8, n)) * 10) / 10 : null; }, help: '1 to 1.8' },
  // hostname: the host's name (serverinfo's, a guest's stats line's; "noname" when empty, as Quake had it), archived as Quake's was
  hostname: { key: 'hostname', show: (v) => String(v ?? ''), read: (w) => (/^[\x20-\x7e]{0,32}$/.test(w) ? w : null), help: 'at most 32 printable characters' },
  // password (SV_DirectConnect: a guest whose password is not the host's is refused; the guest's userinfo and the host's requirement in one) and
  // spectator_password (ClientConnect: a watcher's); neither archived, as Quake's were not; "" clears one, "none" lets watchers in
  password: { key: 'password', show: (v) => String(v ?? ''), read: (w) => (/^[\x21-\x7e]{0,32}$/.test(w) ? w : null), help: 'at most 32 characters, no spaces', archive: false },
  spectator_password: { key: 'spectatorPassword', show: (v) => String(v ?? ''), read: (w) => (/^[\x21-\x7e]{0,32}$/.test(w) ? w : null), help: 'at most 32 characters, no spaces', archive: false },
  // rcon_password (the client's rcon_password and the server's in one, as both were named: what rcon sends from a joined page, what the
  // host's Rcon_Validate asks for; empty, the host takes no rcon); not archived, as Quake's were not
  rcon_password: { key: 'rconPassword', show: (v) => String(v ?? ''), read: (w) => (/^[\x21-\x7e]{0,32}$/.test(w) ? w : null), help: 'at most 32 characters, no spaces', archive: false },
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
// and sv_maxvelocity (SV_CheckVelocity's clamp, 2000), sv_airaccelerate (0: PM_Accelerate at 1 in the air; on, PM_AirAccelerate: strafe jumps) and
// g_select_empty (1: a weapon with no ammo is taken and the cycle visits it)
export const GAME_CVARS = Object.freeze({ bob_up: [0.005, 0, 1], bob_pitch: [0.002, -1, 1], bob_roll: [0.002, -1, 1], run_pitch: [0.002, -1, 1], run_roll: [0.005, -1, 1], sv_rollangle: [2, -90, 90], sv_rollspeed: [200, 0, 10000],
  sv_maxvelocity: [2000, 0, 100000], sv_airaccelerate: [0, 0, 100], g_select_empty: [0, 0, 1], flood_msgs: [4, 0, 10], flood_persecond: [4, 0, 3600], flood_waitdelay: [10, 0, 3600] });
const HISTORY = 32;

/**
 * host: { db, pak, settings, saveSettings(), setStatus(msg, isError), startMap(name), mapString(string) → true once begun (map with a spawn, a picture or a cinematic), gameMap(string) → true once begun (gamemap), nextServer(text | null) → what follows (nextserver), setView(fov),
 *         saveGame(), loadGame(), toggleInventory(), isRunning(), setCvar(name, value), setSkill(n), playDemo(name),
 *         hasDemo(name), listDemos() → { pak, kept }, dropDemo(name) → dropped, record(name), stopRecord(), isRecording(),
 *         setSpectator(on | null) → 0 | 1 | null (null: this page has not joined a game), timedemo(name), screenshot(), say(text), messageMode(team) → true once the chat prompt is up (messagemode, messagemode2), setSetting(key, value) (the cvars: through the page's controls and the userinfo),
 *         download(name, text) (writeconfig), clearLog() (clear: the scrollback emptied), dumpLog(name) (condump: the scrollback downloaded as <name>.txt),
 *         setLogfile(on) → 'on' | 'already' for on, the lines downloaded or null for nothing for off (logfile),
 *         setLogStats(on) → the same for stats.log (log_stats), isPaused() → whether the game is paused (cl_paused),
 *         print(text) (lines into the scrollback alone: cmdlist, dir and the listings), pakInfo() → { name, files, from } (path, dir: the pak's name, how many files, where it came from),
 *         memStats() → [{ what, blocks, bytes }] (z_stats: the surfaces built, the sounds decoded, the pak, the page's heap where the browser tells it),
 *         modelList() → [{ name, size }] (modellist), imageList() → [{ kind, w, h, name }] (imagelist: P a picture, W a wall texture, M a skin), soundList() → [{ name, size, loop }] (soundlist), version() → the page's version string (version), togglePause() → paused now, null for a shared game or none (pause),
 *         toggleScores() (score: the score board, in a game of more than one client), putAway() (putaway: every screen off),
 *         serverInfo() → the game's cvars as { mapname, deathmatch, coop, dmflags, fraglimit, timelimit, cheats, skill }, null on a joined page or without a map (serverinfo),
 *         userInfo() → this page's { name, hand, gender, msg, fov, spectator, rate, skin } (userinfo),
 *         playSound(name) → whether the pak has sound/<name>, played at the ear (play), stopSounds() (stopsound), soundInfo() → { started, rate, stereo, decoded, playing, loops } (soundinfo),
 *         viewPos() → the first view's { x, y, z, yaw } (viewpos), timeRefresh(flip) → { seconds, fps } after a full turn in 128 frames, null without a game of this page's own (timerefresh), status() → { map, rows: [{ num, score, ping, name, time, spectator, skin }] }, null without a game (status, playerlist, skins: `time` the whole seconds in the game, `spectator` a watcher, `skin` the skin userinfo),
 *         toggleConsole(clearNotify) → true once the console is up, false once down (toggleconsole; togglechat with the notify lines cleared first),
 *         setImpulse(n) (impulse: the next command's impulse), inRestart() (in_restart: the keys, the mouse and the pads read anew),
 *         isFullscreen() → whether the page is fullscreen now (vid_fullscreen; set through setSetting('fullscreen', bool)),
 *         toggleHelp() (help: the help computer, F1's), gravity() → the game's gravity, null on a joined page or without a map, setGravity(n) (sv_gravity),
 *         setGameString(col, text) (sv_maplist), setSky(name, rotate, axis) → true, false for a sky the pak lacks, null without a map (sky),
 *         cd(word, n) → the text to say (play, loop, stop, pause, resume, on, off), the info's { tracks, state, volume, enabled }, null for an unknown word (cd),
 *         gameCvar(col) → the game row's column, null on a joined page or without a map, setGameCvar(col, n) (bob_up, bob_pitch, bob_roll, run_pitch, run_roll, sv_rollangle, sv_rollspeed, sv_maxvelocity, sv_airaccelerate, g_select_empty, flood_msgs, flood_persecond, flood_waitdelay: GAME_CVARS),
 *         setGameMode({ coop, deathmatch, players }) (deathmatch, coop, maxclients: the next game's, latched; the Players select follows),
 *         execConfig() (exec: the page's file picker, whose file runs through execText),
 *         execAutoexec() → the lines run, or null when none is kept (exec autoexec), dropAutoexec() → true when one was kept (unautoexec),
 *         setTimescale(n | null) → the timescale now (null: a guest, whose clock is the host's),
 *         setFixedtime(n | null) → the fixedtime now (null: a guest),
 *         lightLevel() → 150 × the lightmap under the eye over 255, rounded, null without a map (cl_lightlevel),
 *         listPlayers() → the clients as [{ num, name, kind: 'page' | 'guest' | 'pad' | 'standing', sent, dropped, held, spectator }], 'guest' on a joined page, null without a game (players),
 *         kick(n) → the name kicked, or 'none' | 'not-hosting' (kick),
 *         dumpUser(n) → a client's userinfo as { name, hand, gender, msg, fov, spectator, rate, skin }, or 'guest' (a joined page) | 'none' (no game) | 'slot' | 'inactive' (dumpuser),
 *         connect(text) → true once joining began (false: no pak yet), disconnect() → true when this page was in a shared game,
 *         reconnect(), lastConnect() → what this page last joined with ('' for nothing),
 *         quit() → true once the game ended for the attract loop (quit), killServer() → the same with a hosted game's guests dropped (killserver),
 *         vidRestart() → true once the painter is remade (vid_restart), sndRestart() → true once the mixer is remade (snd_restart),
 *         openMenu(name) → true once the menu is up (main, game, loadgame, savegame, options, keys, video, multiplayer, playerconfig, credits, quit; the menu_* commands),
 *         forward(cmd, arg) → true when the command went to the host (a joined page), false to run it here,
 *         rcon(line) → true once the line went to the host with rcon_password (a joined page), false on a page of its own (rcon) }
 */
/** The cvars config.cfg carries (CVARS, and fov and skill with them), each with its setting and how it shows. */
const CONFIG_CVARS = () => ({ ...CVARS, fov: { key: 'fov', show: (v) => String(v) }, skill: { key: 'skill', show: (v) => String(v) },
  // the video menu's cvars (VID_MenuInit's, archived as Quake's were): vid_mode the Detail select's mode (0 160×120, 1 320×240, 2 640×480), vid_ref the renderer mode (soft, sql)
  vid_mode: { key: 'detail', show: (v) => String(Math.max(0, VID_MODES.indexOf(v))) }, vid_ref: { key: 'renderer', show: (v) => (v === 'sql' ? 'sql' : 'soft') } });
const VID_MODES = ['low', 'high', 'ultra'];

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
      case 'map': case 'gamemap': {
        // SV_Map_f (map: a new game on the map, the unit's levels forgotten) and SV_GameMap_f (gamemap: the level running kept aside
        // as an exit keeps it, "*" wiping the unit); the string as target_changelevel writes one (src/levels.js): a map, with a "$"
        // spawn point, a .pcx picture or a .cin cinematic, "+" what follows it
        const word = cmd.toLowerCase();
        if (!arg) { say(`usage: ${word} <map>`, true); return; }
        const c = parseChangeMap(arg);
        if (c.kind === 'map' && !h.pak.has(`maps/${c.map}.bsp`)) { say(`no map "${c.map}" in this pak`, true); return; }
        if (c.kind === 'pic' && !h.pak.has(`pics/${c.map}`)) { say(`no picture "${c.map}" in this pak`, true); return; }
        if (c.kind === 'cinematic' && !h.pak.has(`video/${c.map}`)) { say(`no cinematic "${c.map}" in this pak`, true); return; }
        if (word === 'map' && c.kind === 'map' && !c.spawn && !c.then && !c.unitEnd) { await h.startMap(c.map); return; }
        if (!(word === 'map' ? h.mapString?.(arg) : h.gameMap?.(arg))) say(`${word}: no pak is loaded yet`, true);
        return;
      }
      case 'nextserver': {
        // the nextserver cvar: what follows the picture or the cinematic playing (a map string's "+" part, as SV_Map set it), shown
        // or set
        if (!arg) { say(`"nextserver" is "${h.nextServer?.(null) ?? ''}"`); return; }
        h.nextServer?.(arg);
        say(`"nextserver" is "${arg}"`);
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
      case 'name': case 'hand': case 'gender': case 'msg': case 'rate': case 'skin': case 'sensitivity': case 'cl_run': case 'm_pitch': case 'crosshair': case 's_volume': case 's_khz': case 's_mixahead': case 's_testsound': case 'cd_volume': case 'cd_loopcount': case 'cd_looptrack': case 'cd_nocd': case 's_show':
      case 'freelook': case 'lookspring': case 'lookstrafe': case 'm_forward': case 'm_side': case 'm_filter': case 'in_joystick': case 'in_mouse': case 'joy_forwardthreshold': case 'joy_sidethreshold': case 'joy_pitchthreshold': case 'joy_yawthreshold': case 'joy_forwardsensitivity': case 'joy_sidesensitivity': case 'joy_pitchsensitivity': case 'joy_yawsensitivity': case 'netgraph': case 'timegraph': case 'debuggraph': case 'graphheight': case 'graphscale': case 'graphshift': case 'cl_predict': case 'cl_showmiss': case 'cl_shownet': case 'cl_showclamp': case 'showpackets': case 'showdrop': case 'viewsize':
      case 'cl_add_entities': case 'cl_add_particles': case 'cl_add_lights': case 'cl_add_blend': case 'cl_testentities': case 'cl_testparticles': case 'cl_testlights': case 'cl_testblend':
      case 'r_fullbright': case 'r_drawentities': case 'r_drawworld': case 'r_lockpvs': case 'r_dspeeds': case 'r_lerpmodels': case 'r_novis': case 'r_speeds': case 'host_speeds': case 'developer': case 'sv_noreload': case 'sw_drawflat': case 'sw_waterwarp': case 'sw_clearcolor': case 'sw_mipcap': case 'sw_mipscale': case 'sw_stipplealpha': case 'sw_aliasstats': case 'sw_reportsurfout': case 'sw_maxsurfs':
      case 'm_yaw': case 'cl_gun': case 'con_notifytime': case 'vid_gamma': case 'hostname': case 'password': case 'spectator_password': case 'rcon_password':
      case 'cl_yawspeed': case 'cl_pitchspeed': case 'cl_anglespeedkey': case 'cl_forwardspeed': case 'cl_sidespeed': case 'cl_upspeed': case 'timeout': case 'cl_timeout':
      case 'gun_x': case 'gun_y': case 'gun_z': case 'scr_centertime': case 'cl_footsteps': case 'scr_showpause': case 'scr_showturtle': case 'cl_maxfps': {
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
      case 'cl_lightlevel': {
        // the light at the eye as R_SetLightLevel saved it for the server each frame (150 at full light), read from the lightmap
        // under the eye here; a value given is refused, the cvar being the painter's to write
        const v = h.lightLevel?.();
        if (v == null) { say('cl_lightlevel: a map must be running', true); return; }
        if (arg) { say('cl_lightlevel is written from the lightmap under the eye each frame; it takes no value', true); return; }
        say(`"cl_lightlevel" is "${v}"`);
        return;
      }
      case 'fixedtime': {
        // the fixedtime cvar (Qcommon_Frame: the frame's milliseconds a fixed number whatever the wall says, 0 the wall's): the
        // game's clock steps fixedtime ms an animation frame, at most two tics' worth as the loop runs (past 100, as 100); a
        // guest's clock is the host's, so a guest is told
        const now = h.setFixedtime?.(null);
        if (!arg) { say(`"fixedtime" is "${now ?? 0}"`); return; }
        const v = Number(arg);
        if (!Number.isInteger(v) || v < 0 || v > 1000) { say('fixedtime takes a whole number of milliseconds, 0 (the wall clock) to 1000', true); return; }
        const set = h.setFixedtime?.(v);
        if (set === null) { say('fixedtime: a joined game runs at the host\'s pace', true); return; }
        say(`"fixedtime" is "${set}"`);
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
      case 'messagemode': case 'messagemode2': {
        // Con_MessageMode_f, Con_MessageMode2_f: the chat prompt up over the view (the line typed under the notify lines, Enter
        // saying it; messagemode2 says to the team, say_team being say here), the console going; a game must be running
        if (!h.messageMode?.(cmd.toLowerCase().endsWith('2'))) say(`${cmd.toLowerCase()}: a game must be running`, true);
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
      case 'play': {
        // S_Play: each word a pak sound played at the ear (".wav" added to a name without a dot), as S_StartSound at the player's own entity did
        if (!arg) { say('play <sound> …: a pak sound, as weapons/blastf1a', true); return; }
        const names = arg.split(/\s+/).map((w) => (w.includes('.') ? w : `${w}.wav`).toLowerCase());
        const missing = names.filter((n) => !h.playSound?.(n));
        if (missing.length) say(`play: no ${missing.join(', ')} in the pak`, true);
        else say(`playing ${names.join(', ')}`);
        return;
      }
      case 'cd': {
        // CD_f: the music as the CD player's words had it: play or loop a track by its number, stop, pause, resume, on and off,
        // and info (the tracks, what plays or is paused and how, the volume) on the scrollback as it printed them
        const [sub, num] = arg.split(/\s+/);
        const word = (sub ?? '').toLowerCase();
        if (!word) { say('cd play|loop <track> · stop · pause · resume · on · off · info', true); return; }
        const r = h.cd?.(word, num === undefined ? null : Number(num));
        if (r == null) { say(`cd: no "${word}" (play, loop, stop, pause, resume, on, off, info)`, true); return; }
        if (typeof r === 'string') { say(r, /^cd /.test(r) && !/^cd o/.test(r)); return; }
        const lines = [`${r.tracks} tracks`, ...(r.state ? [r.state] : []), `Volume is ${r.volume.toFixed(6)}`];
        h.print?.(lines.join('\n'));
        say(`${r.tracks} tracks · ${r.state ?? (r.enabled ? 'nothing playing' : 'the cd is off')} · volume ${r.volume.toFixed(2)}`, false, 8000);
        return;
      }
      case 'stopsound':
        // S_StopAllSounds: every sound cut, the loops too until the next frame starts them again
        h.stopSounds?.();
        say('sounds stopped');
        return;
      case 'soundinfo': {
        // S_SoundInfo_f: the mix's figures, a line each on the scrollback as it laid them out ("%5d speed"), and the sum on the line;
        // "sound system not started" before the first click or key makes the context
        const i = h.soundInfo?.();
        if (!i?.started) { say('sound system not started', true); return; }
        h.print?.([`${String(i.rate).padStart(5)} speed`, `${String(i.stereo).padStart(5)} stereo`, `${String(i.decoded).padStart(5)} sounds decoded`, `${String(i.playing).padStart(5)} playing`, `${String(i.loops).padStart(5)} looping`].join('\n'));
        say(`sound: ${i.rate} Hz ${i.stereo ? 'stereo' : 'mono'}, ${i.decoded} decoded, ${i.playing} playing, ${i.loops} looping`, false, 8000);
        return;
      }
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
      case 'cl_paused': {
        // the pause as CL_Frame set the cvar: shown; a value given is refused, pause being the word that sets it
        if (arg) { say('cl_paused is the pause\'s own: pause sets it', true); return; }
        say(`"cl_paused" is "${h.isPaused?.() ? '1' : '0'}"`);
        return;
      }
      case 'log_stats': {
        // the log_stats cvar (CL_Frame's): 1 writes a line a painted frame, "entities,dlights,parts,frame time", to stats.log as it
        // did (the page's file store keeps it, through a reload too), 0 downloads what was written and drops it
        if (!arg) { say(`"log_stats" is "${h.settings.logStats ? '1' : '0'}"`); return; }
        if (!/^(0|1)$/.test(arg)) { say('log_stats takes 0 or 1', true); return; }
        const r = await h.setLogStats?.(arg === '1');
        if (arg === '1') say(r === 'already' ? 'log_stats: already on' : 'log_stats: a line a frame goes to stats.log');
        else if (r == null) say('log_stats: nothing was logged', true);
        else say(`log_stats: stats.log downloaded, ${r} line${r === 1 ? '' : 's'}`);
        return;
      }
      case 'logfile': {
        // the logfile cvar: 1 writes the scrollback to qconsole.log as it grows (Com_Printf's logfile write; the page's file store keeps
        // it, through a reload too), 0 downloads what was written and drops it (Quake left the file in the game directory)
        if (!arg) { say(`"logfile" is "${h.settings.logfile ? '1' : '0'}"`); return; }
        if (!/^(0|1)$/.test(arg)) { say('logfile takes 0 or 1', true); return; }
        const r = await h.setLogfile?.(arg === '1');
        if (arg === '1') say(r === 'already' ? 'logfile: already on' : 'logfile: the console goes to qconsole.log');
        else if (r == null) say('logfile: nothing was logged', true);
        else say(`logfile: qconsole.log downloaded, ${r} line${r === 1 ? '' : 's'}`);
        return;
      }
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
        // CL_Userinfo_f: this page's userinfo (ClientUserinfoChanged's name, hand, gender, msg, fov, spectator, rate and skin)
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
      case 'z_stats': {
        // Z_Stats_f ("%i bytes in %i blocks"): what the page holds, a line each in the scrollback (the surfaces built, the sounds decoded, the
        // pak, the page's heap where the browser tells it; the engine's heap is its Worker's and out of reach), the sum on the line
        const rows = h.memStats?.() ?? [];
        const bytes = rows.reduce((n, r) => n + (r.bytes || 0), 0), blocks = rows.reduce((n, r) => n + (r.blocks || 0), 0);
        h.print?.(rows.map((r) => `${String(r.bytes || 0).padStart(10)} bytes in ${String(r.blocks || 0).padStart(5)} blocks  ${r.what}`).join('\n'));
        say(`${bytes} bytes in ${blocks} blocks`, false, 8000);
        return;
      }
      case 'impulse': {
        // IN_Impulse: the number is the next command's impulse (the weapons 1 to 11 by number, the inventory's 12 to 15 and the items' 16 to 23,
        // as the keys and the pad send them); nothing said, as Quake said nothing
        const n = Number(arg);
        if (!arg || !Number.isInteger(n) || n < 0 || n > 255) { say('impulse takes a number, 0 to 255', true); return; }
        h.setImpulse?.(n);
        return;
      }
      case 'in_restart': {
        // IN_Restart_f (IN_Shutdown, IN_Init): the keys, the mouse's samples and the pads read anew, the mouse let go and taken again
        h.inRestart?.();
        return;
      }
      case 'skins': {
        // CL_Skins_f: each client's number and its player skin configstring ("name\model/skin") a line each in the scrollback, as it printed
        // "%i: %s" after loading them, the sum on the line; a joined page's from its score board rows
        const st = h.status?.();
        if (!st) { say('skins: no game running', true); return; }
        const line = (c) => `${c.num}: ${c.name}\\${c.skin ?? 'male/grunt'}`;
        h.print?.(st.rows.map(line).join('\n'));
        say(st.rows.map(line).join(' · '), false, 8000);
        return;
      }
      case 'toggleconsole': case 'togglechat': {
        // Con_ToggleConsole_f and Con_ToggleChat_f: the console up or down (typed at its line, which Enter closed, it comes back up);
        // togglechat clears the notify lines off the view first, as the function did whatever its name
        h.toggleConsole?.(cmd.toLowerCase() === 'togglechat');
        return;
      }
      case 'playerlist': {
        // Cmd_PlayerList_f (3.20): each client's time in the game, ping, score and name, "(spectator)" for a watcher, a line each in the
        // scrollback as it printed them ("%02d:%02d %4d %3d %s%s"), the sum on the line
        const st = h.status?.();
        if (!st) { say('playerlist: no game running', true); return; }
        const line = (c) => { const t = Math.max(0, Math.floor(c.time ?? 0)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')} ${String(c.ping).padStart(4)} ${String(c.score).padStart(3)} ${c.name}${c.spectator ? ' (spectator)' : ''}`; };
        h.print?.(st.rows.map(line).join('\n'));
        say(st.rows.map(line).join(' · '), false, 8000);
        return;
      }
      case 'rcon': {
        // CL_Rcon_f: the line goes to the host with rcon_password, whose SV_RemoteCommand_f runs it at its console when the password is
        // its own and sends the prints back (Com_BeginRedirect); no password set, or no game joined (no rcon_address here), it says so
        if (!h.settings.rconPassword) { say("You must set 'rcon_password' before issuing an rcon command", true); return; }
        if (!arg) { say('Usage: rcon <command>', true); return; }
        if (!h.rcon?.(arg)) { say('You must have joined a game to issue rcon commands', true); return; }
        return;
      }
      case 'cmd': {
        // Cmd_ForwardToServer_f: the words after it go to the host as typed (a joined page), or run here as the game's own command
        if (!arg) { say('Usage: cmd <command>', true); return; }
        const [word, ...more] = arg.split(/\s+/);
        if (h.forward?.(word, more.join(' '))) return;
        await this.run(arg);
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
      case 'sv_maplist': {
        // the sv_maplist cvar on the game row: the deathmatch rotation EndDMLevel follows (map names parted by spaces or commas; "" none)
        const v = await h.gameCvar?.('sv_maplist');
        if (v == null) { say('sv_maplist: a joined page runs no server of its own, and a map must be running', true); return; }
        if (!arg) { say(`"sv_maplist" is "${v}"`); return; }
        const text = arg.replace(/^"(.*)"$/, '$1').trim();
        if (!/^[a-z0-9_ ,]{0,400}$/i.test(text)) { say('sv_maplist takes map names parted by spaces or commas', true); return; }
        await h.setGameString?.('sv_maplist', text);
        say(`"sv_maplist" is "${text}"`);
        return;
      }
      case 'sky': {
        // SCR_Sky_f: sky <basename> [rotate] [axis x y z]: the sky box of the map running changed and spun (this page's alone)
        if (!arg) { say('Usage: sky <basename> <rotate> <axis x y z>', true); return; }
        const w = arg.split(/\s+/);
        const rotate = w.length > 1 ? Number(w[1]) || 0 : 0;
        const axis = w.length === 5 ? w.slice(2, 5).map((x) => Number(x) || 0) : [0, 0, 1];
        const ok = h.setSky?.(w[0].toLowerCase(), rotate, axis);
        if (ok == null) { say('sky: a map must be running', true); return; }
        if (!ok) { say(`sky: no env/${w[0].toLowerCase()}*.pcx in the pak`, true); return; }
        say(`sky ${w[0].toLowerCase()}${rotate ? `, ${rotate} degrees a second about ${axis.join(' ')}` : ''}`);
        return;
      }
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
      case 'bob_up': case 'bob_pitch': case 'bob_roll': case 'run_pitch': case 'run_roll': case 'sv_rollangle': case 'sv_rollspeed':
      case 'sv_maxvelocity': case 'sv_airaccelerate': case 'g_select_empty': case 'flood_msgs': case 'flood_persecond': case 'flood_waitdelay': {
        // p_view.c's cvars on the game row for the game running (GAME_CVARS), as sv_gravity: shown, or set within their range (the
        // flood cvars with them: Cmd_Say_f's flood protection in client_say)
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
      case 'quit': case 'killserver': {
        // Com_Quit (quit: the quit menu's yes, the game ended for the attract loop; the page stays) and SV_KillServer_f
        // (killserver: a hosted game's guests dropped first, "Server was killed")
        const word = cmd.toLowerCase();
        const done = word === 'quit' ? h.quit?.() : h.killServer?.();
        if (!done) { say(`${word}: no pak is loaded yet`, true); return; }
        say(word === 'quit' ? 'the game ends: the attract loop' : 'Server was killed');
        return;
      }
      case 'vid_mode': {
        // the video menu's mode as a cvar (vid_mode: 0 160×120, 1 320×240, 2 640×480, the Detail select's; archived): a change goes
        // through the page's control and restarts the painter, as VID_CheckChanges did on a mode change
        const now = Math.max(0, VID_MODES.indexOf(h.settings.detail));
        if (!arg) { say(`"vid_mode" is "${now}"`); return; }
        if (!/^[0-2]$/.test(arg)) { say('vid_mode takes 0 (160×120), 1 (320×240) or 2 (640×480)', true); return; }
        if (Number(arg) !== now) { h.setSetting('detail', VID_MODES[Number(arg)]); h.vidRestart?.(); }
        say(`"vid_mode" is "${arg}"`);
        return;
      }
      case 'vid_ref': {
        // the refresh as a cvar (vid_ref: soft for the painter with SQL picking the faces and JS projecting, sql for SQL projecting every
        // vertex, the renderer mode; archived): a change goes through the page's control and restarts the painter, as VID_CheckChanges did
        const now = h.settings.renderer === 'sql' ? 'sql' : 'soft';
        if (!arg) { say(`"vid_ref" is "${now}"`); return; }
        const w = arg.toLowerCase();
        if (w !== 'soft' && w !== 'sql') { say('vid_ref takes soft (SQL picks the faces, JS projects) or sql (SQL projects every vertex)', true); return; }
        if (w !== now) { h.setSetting('renderer', w === 'sql' ? 'sql' : 'fast'); h.vidRestart?.(); }
        say(`"vid_ref" is "${w}"`);
        return;
      }
      case 'vid_restart':
        // VID_Restart_f: the painter made anew from the settings (the sky and the view's rectangle as they were)
        if (!h.vidRestart?.()) { say('vid_restart: no painter yet (a pak must be loaded)', true); return; }
        say('vid_restart: the painter made again');
        return;
      case 'snd_restart':
        // CL_Snd_Restart_f: the mixer closed and made anew, the sounds decoded again as they play, the music played again
        if (!h.sndRestart?.()) { say('snd_restart: sound system not started (a click or a key makes it)', true); return; }
        say('snd_restart: sound system restarted');
        return;
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
      case 'menu_video': case 'menu_multiplayer': case 'menu_playerconfig': case 'menu_credits': case 'menu_quit': case 'menu_dmoptions': case 'menu_startserver':
      case 'menu_joinserver': case 'menu_addressbook': {
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
        const what = (r) => (r.kind === 'page' ? 'this page' : r.kind === 'guest' ? `guest: ${r.sent} frames sent${r.dropped ? `, ${r.dropped} dropped` : ''}${r.held ? `, ${r.held} held` : ''}${r.ping != null ? `, ping ${r.ping} ms` : ''}${r.spectator ? ', watching' : ''}` : r.kind === 'pad' ? 'a pad' : 'standing');
        say(rows.map((r) => `${r.num} ${r.name} (${what(r)})`).join(' · '), false, 8000);
        return;
      }
      case 'dumpuser': {
        // SV_DumpUser_f: a client's userinfo in the scrollback as Info_Print laid it out (each key on twenty characters, its value
        // after), the host's console alone (a joined page's userinfo is at the host); the line sums it
        const n = Number(arg);
        if (!arg || !Number.isInteger(n)) { say('Usage: dumpuser <userid>', true); return; }
        const info = h.dumpUser?.(n) ?? 'none';
        if (info === 'guest') { say('dumpuser: the host has the userinfos', true); return; }
        if (info === 'none') { say('dumpuser: no game is running', true); return; }
        if (info === 'slot') { say(`Bad client slot: ${n}`, true); return; }
        if (info === 'inactive') { say(`Client ${n} is not active`, true); return; }
        const pairs = Object.entries(info).filter(([, v]) => v != null);
        h.print?.(['userinfo', '--------', ...pairs.map(([k, v]) => `${k.padEnd(20)}${v}`)].join('\n'));
        say(`client ${n}: ${pairs.map(([k, v]) => `${k} "${v}"`).join(' · ')}`, false, 8000);
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
