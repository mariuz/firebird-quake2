// main.js – boot Firebird in a Worker, load the PAK into it, run the loop.
//
// Per frame the browser does a handful of queries:
//   SELECT * FROM q2_tic(...)         – advance the game by N tics
//   SELECT * FROM frame_all(...)      – the frame: the polygons on screen, the models in view,
//                                       this frame's light animation, what to play, the effects
// and then paints. All game state lives in Firebird tables.

import { FirebirdBrowser } from 'firebird-wasm/browser';
import schemaSql from '../sql/schema.sql';
import physicsSql from '../sql/physics.sql';
import gameSql from '../sql/game.sql';
import weaponsSql from '../sql/weapons.sql';
import monstersSql from '../sql/monsters.sql';
import renderSql from '../sql/render.sql';
import { Pak, loadColormap, loadPcx } from './pak.js';
import { createSchema, loadResources, loadMapModels, setView } from './loader.js';
import { HostLink, GuestLink, Peer, SignalClient, isRoomCode, iceServers } from './net.js';
import { parseDemo, DemoPlayer } from './demo.js';
import { FrameLerp } from './lerp.js';
import { Renderer, lightPoint, dlightAt, entityFrame } from './renderer.js';
import { Effects } from './effects.js';
import { Hud, viewFrameLerp } from './hud.js';
import { Menu, saveComment } from './menu.js';
import { Session, SLOT_KEY, QUICK_KEY } from './session.js';
import { SAVE_VERSION } from './savegame.js';
import { Q2Audio } from './audio.js';
import { WEAPONS, ITEMS, ARMOR_ICONS, TIMER_ICONS } from './gamedata.js';
import { padMenuKeys, padScreens, BUTTON } from './gamepad.js';
import { Input, GAME_KEYS, DEFAULT_BINDS, MOUSE_KEYS, bindKey } from './input.js';
import { CREDITS } from './credits.js';
import { Console } from './console.js';
import { Notify } from './notify.js';
import { DemoRecorder } from './record.js';
import { DemoStore, FileStore } from './demostore.js';
import { ClipMap, pmove, stateFromRow } from './pmove.js';
import { CinReader, CinPlayer, CIN_FPS } from './cinematic.js';
import { loadSettings, saveSettings as saveSettingsTo, viewSize, OPTIONS_RESET, VIDEO_RESET } from './settings.js';

const $ = (id) => document.getElementById(id);
const canvas = $('screen');
const statusEl = $('status');
const statsEl = $('stats');
const TIC_MS = 50;

let db, pak, res, renderer, hud;
// src/session.js: the game without the page (maps, tics, the frame, the unit's levels, the slots);
// `map` and `last` are its map and its last Q2_TIC row, kept here for the drawing
let session = null;
let map = null;          // { name, bsp }
let last = null;         // last Q2_TIC row
let running = false;
let paused = false;
let lastTic = 0;
// src/net.js: a game shared over a data channel. The host runs the game here and sends the guest its frames
// (`host`, a HostLink); the guest paints the host's frames and sends its commands (`guest`, a GuestLink)
// hosting: { role: 'host', guests: [{ client, peer, host }], offer: { peer } | null }, a guest a client of 2 to 4 with its own
// channel and HostLink, and at most one offer out at a time; joined: { role: 'guest', peer, guest }
let net = null;
const netHost = () => net?.role === 'host' && net.guests.length > 0;   // (a guest connected: before that the page plays alone)
const netGuest = () => net?.role === 'guest' && !!net.guest;
const MAX_GUESTS = 3;    // (MAX_PLAYERS less the host, the first client)
/** The highest client number a guest drives (the hosted game has that many clients). */
const hostClients = () => (netHost() ? Math.max(...net.guests.map((g) => g.client)) : 1);
const IDLE_CMD = [1, 0, 0, 0, 0, 0, 0, 1, 0];
// src/demo.js: a demo of the pak playing (the attract mode): the view and the entities are the recording's, the
// faces the SQL's for that view; a key or a click stops it and a new game starts
let demo = null;         // { name, player: DemoPlayer, time, at, frames, cprint, msg }
let cinematic = null;    // src/cinematic.js: { file, player: CinPlayer, frame, finish } while one plays (SCR_PlayCinematic)
// src/record.js: the game being written as a demo (`record <name>` at the console, `stop` or the level's end ends
// it), and the demos recorded this session by name, which the Demo select and `demomap` play like the pak's
let recorder = null;     // { name, rec: DemoRecorder }
const recordings = new Map();   // the bytes of the recordings in hand this session, by name
// src/demostore.js: the recordings kept across reloads (a recording made here, or a .dm2 opened from a file) in
// IndexedDB; `kept` is their names, loaded at the start, their bytes read when one plays
const demoStore = new DemoStore();
const kept = new Set();
// the player's files kept the same way: the pak picked from the file input (`pak`), which the next start loads in
// place of the demo's download until the button beside it forgets it, and a picked folder's tracks as they play
const fileStore = new FileStore();
let pickedPak = null;    // the name of the picked pak in use, kept or just picked; null on the demo's
let mapSetup = null;     // what session.startMap returned for the map in (the sky, the CD track: a recording's configstrings)
/** The view's fov: the host's for a guest (the frustum is the host's), the setting otherwise. */
const viewFov = () => (netGuest() && net.guest.map ? net.guest.map.view.fov : settings.fov);
// src/effects.js: the explosions, beams, tongues and muzzle flashes between frames, and the frame's dynamic lights
const tempEnts = new Effects({ model: (name) => model(name), sprite: (name) => sprite(name) });
// src/settings.js: the defaults, the video modes, and the round trip through localStorage, checked on the way in
const storage = (() => { try { return window.localStorage; } catch { return null; } })();
const settings = loadSettings(storage);
const saveSettings = () => saveSettingsTo(settings, storage);
const viewWidth = () => viewSize(settings)[0];
const viewHeight = () => viewSize(settings)[1];
const audio = new Q2Audio();
audio.setVolume(settings.sfx / 100);
audio.setMusicVolume(settings.music / 100);
audio.musicMode = settings.musicMode;
audio.setMusicStore(fileStore);
for (const ev of ['keydown', 'pointerdown', 'touchstart']) window.addEventListener(ev, () => audio.unlock(), { capture: true });
document.addEventListener('visibilitychange', () => audio.suspend(document.hidden));
const perf = { tic: 0, faces: 0, draw: 0, rows: 0 };

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
  statusEl.hidden = !msg;
}

// ── input ────────────────────────────────────────────────────────────────
// src/input.js holds the keys, the mouse, the touches and the pad between tics and reads them as the usercmd
const input = new Input({ binds: settings.binds });   // (the keys menu edits settings.binds in place: the Input reads the same object)
let anyKey = null;      // a picture screen waiting for a key or a click
// the help computer (F1, or the pad's Back) and the inventory screen (TAB, or the pad's Y), per view: the
// keys are the first player's, the pad is its player's (the second in coop)
const MAX_PLAYERS = 4;       // at this page: the view split in two or four
const perPlayer = (v) => Array.from({ length: MAX_PLAYERS }, () => (typeof v === 'function' ? v() : v));
let showHelp = perPlayer(false);
let showInv = perPlayer(false);
let showScores = perPlayer(false);   // the deathmatch score board (Cmd_Help_f shows it in place of the help computer)
let invItems = perPlayer(() => []);  // the inventory's rows: [itemlist index, count]
let helpSeen = perPlayer(0);         // the help_changed count each player has looked at
/** The help computer (the score board in deathmatch) or the inventory toggled for player `p` (0 or 1), the other screen put away. */
function toggleScreen(p, which) {
  const row = netGuest() ? last : (session?.clients[p] ?? last);
  if (which === 'help' && row?.DEATHMATCH) { showScores[p] = !showScores[p]; showInv[p] = false; showHelp[p] = false; }
  else if (which === 'help') { showHelp[p] = !showHelp[p]; showInv[p] = false; showScores[p] = false; if (row) helpSeen[p] = row.HELP_CHANGED ?? 0; }
  else { showInv[p] = !showInv[p]; showHelp[p] = false; showScores[p] = false; }
}
/** The score board's rows: every client's frags (a guest's come with its row). */
function scoreRows() {
  if (netGuest()) return last?.SCORES ?? [{ id: last?.CLIENT ?? 1, name: last?.NETNAME, score: last?.SCORE ?? 0 }];
  return session.clients.map((c) => ({ id: c.CLIENT, name: c.NETNAME, score: c.SCORE ?? 0 }));
}
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
  if (anyKey && !e.repeat) { e.preventDefault(); const go = anyKey; anyKey = null; go(); return; }
  if (menu.active) { e.preventDefault(); menu.key(e.code, e.key); return; }   // (the key's character too: the player setup's name field types)
  // a demo playing (the attract loop): a key brings the main menu up over it, and it plays on behind (Key_Event
  // with cl.attractloop: M_Menu_Main_f); a game starts from the menu or the page's controls
  if (demo) { if (!e.repeat) { e.preventDefault(); openMenu(() => menu.main()); } return; }
  // default.cfg: F2 the save menu, F3 the load menu, F10 quit; Escape puts the help computer or the
  // inventory away (cmd putaway), else brings up the main menu
  if (e.code === 'F3') { e.preventDefault(); openMenu(() => menu.loadMenu()); return; }
  if (!running) return;
  if (e.code === 'F2') { e.preventDefault(); openMenu(() => menu.saveMenu()); return; }
  if (e.code === 'F10') { e.preventDefault(); openMenu(() => menu.quitMenu()); return; }
  if (e.code === 'Escape') { e.preventDefault(); escape(); return; }
  if (e.code === 'Backquote') { e.preventDefault(); openConsole(); return; }
  // the bound actions (settings.binds, the keys menu): the help computer and the inventory screen are the page's,
  // the rest the movement keys, and the weapon, inventory and item keys as impulses
  const act = input.bound(e.code);
  if (act === 'messagemode') { e.preventDefault(); openConsole('say '); return; }   // (default.cfg's t: the words to every player)
  if (act === 'help') { e.preventDefault(); toggleScreen(0, 'help'); }
  if (act === 'inven') { e.preventDefault(); toggleScreen(0, 'inventory'); }         // inven
  if (act || GAME_KEYS.has(e.code)) e.preventDefault();
  input.key(e.code);
  if (e.code === 'KeyP' || e.code === 'Pause') { if (!netHost() && !netGuest()) paused = !paused; }   // ("Pause command is only valid in single player")
  if (e.code === 'F6') { e.preventDefault(); saveGame(); }
  if (e.code === 'F9') { e.preventDefault(); loadGame(); }
});

// ── the menus (src/menu.js): up, the game is paused (M_PushMenu sets "paused" in single player) ──────
let quietUnlock = false;   // the page let the pointer go itself: no menu for that
function openMenu(push) {
  input.clear();
  push();
  if (menu.active && document.pointerLockElement) { quietUnlock = true; document.exitPointerLock?.(); }
}
function escape() {
  if (showHelp[0] || showInv[0] || showScores[0]) { showHelp[0] = false; showInv[0] = false; showScores[0] = false; return; }
  openMenu(() => menu.main());
}
// the browser takes Escape to free the mouse, so the page sees the pointer go instead
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) return;
  if (quietUnlock) { quietUnlock = false; return; }
  if (demo) { if (!menu.active) openMenu(() => menu.main()); return; }   // (Escape under the lock: a key, and the menu comes up over the demo)
  if (running && !menu.active && !anyKey && cmdline.hidden) escape();
});
const menu = new Menu({
  get hud() { return hud; },
  playing: () => running && !!map && !demo,   // (a demo playing is nobody's game to save)
  newGame: (skill) => {
    settings.skill = skill; $('skill').value = String(skill); saveSettings();
    startMap(session.firstMap(), true).catch((err) => setStatus(err.message, true));
  },
  slots: () => session?.slots() ?? [],
  loadSlot: (i) => loadGame(SLOT_KEY(i)),
  saveSlot: (i) => saveGame(SLOT_KEY(i)),
  downloadSlot: (i) => downloadSlot(i),
  get: (k) => (k === 'fullscreen' ? !!document.fullscreenElement : k === 'players' ? PLAYER_CHOICES.indexOf(playersValue()) : settings[k]),
  set: (k, v) => setSetting(k, v),
  // ControlsResetDefaultsFunc ran default.cfg: the options and the keys go back
  resetDefaults: () => { for (const [k, v] of Object.entries(OPTIONS_RESET)) setSetting(k, v); for (const [a, keys] of Object.entries(DEFAULT_BINDS)) settings.binds[a] = [...keys]; saveSettings(); },
  bind: (action, code) => { bindKey(settings.binds, action, code); saveSettings(); },
  unbind: (action) => { settings.binds[action] = []; saveSettings(); },
  credits: () => CREDITS,
  resetVideo: () => { for (const [k, v] of Object.entries(VIDEO_RESET)) setSetting(k, v); },
  console: () => openConsole(),
  quit: () => quitGame(),
  sound: (name) => audio.playLocal(name),
  // the multiplayer menu's join and start network server: the page's Join and Host
  netHost: () => hostGame(),
  netJoin: () => joinGame(),
});
/** A setting changed from a menu: through the page's own control where there is one, so both agree. */
function setSetting(k, v) {
  const control = { sfx: ['sfxvol', 'input'], music: ['musicvol', 'input'], musicMode: ['music', 'change'], alwaysRun: ['run', 'change'], renderer: ['renderer', 'change'],
    detail: ['detail', 'change'], brightness: ['brightness', 'change'], players: ['players', 'change'] }[k];
  if (control) {
    const el = $(control[0]);
    el.value = k === 'alwaysRun' ? (v ? '1' : '0') : k === 'players' ? PLAYER_CHOICES[v] ?? '1' : String(v);
    el.dispatchEvent(new Event(control[1]));
  } else if (k === 'fullscreen') {
    if (v && !document.fullscreenElement) canvas.requestFullscreen?.().catch(() => {});
    else if (!v && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  } else { settings[k] = v; saveSettings(); }
  if (k === 'name' || k === 'hand') applyUserinfo();
}
/**
 * The player setup's name and hand as this client's userinfo (ClientUserinfoChanged): to the game's first client,
 * or, joined, sent to the host for the guest's client. Given at the start, with every map (the session keeps it)
 * and whenever the setup changes.
 */
function applyUserinfo() {
  // (only a joined page watches: the host's and a local game's clients play)
  const info = { name: settings.name, hand: settings.hand, spectator: netGuest() && $('net-spectate').checked ? 1 : 0 };
  if (netGuest()) { if (net.guest?.open) net.guest.sendInfo(info); return; }
  session?.setUserinfo(1, info).catch((err) => console.warn('userinfo:', err.message));
}
/** The console's `spectator`: a joined page watches or plays; none joined, it says so. Returns what it is now, or null. */
function setSpectator(on) {
  if (!netGuest()) return null;
  if (on !== null && on !== undefined) { $('net-spectate').checked = !!on; applyUserinfo(); }
  return $('net-spectate').checked ? 1 : 0;
}
/** Quit: the game ends and the attract loop comes back (Quake 2 quit the program; a page has nowhere to go). */
function quitGame() {
  running = false;
  audio.setSpeakers([]);
  audio.stopLoops();
  attract().catch((err) => setStatus(err.message, true));
}

// ── the console: Quake's commands on a line (backquote opens it, Enter runs, Escape closes) ─────────
// src/notify.js: the game's prints (the first view's row, a new one by its time) drawn at the top of the view for three
// seconds, four at most, as Con_DrawNotify drew them, and kept for the console's scrollback with the lines typed
// and the commands' answers (those two in the scrollback alone)
const notify = new Notify();
let lastMsgTime = null;
const gameClock = () => last?.TIME_ ?? 0;
function noteMessage(row) {
  if (!row?.MSG || row.MSG_TIME === lastMsgTime) return;
  lastMsgTime = row.MSG_TIME;
  notify.add(row.MSG, row.TIME_);
}
// src/console.js runs the commands and keeps the history; this is the input element around it, with the scrollback above
const cmdline = $('cmdline');
const conlog = $('conlog');
const con = new Console({
  get db() { return db; }, get pak() { return pak; }, settings, saveSettings,
  setStatus: (msg, isError) => { setStatus(msg, isError); if (msg) notify.add(msg, gameClock(), { show: false }); },
  startMap: (name) => startMap(name, true),
  setView: (fov) => applyView(fov),
  saveGame: () => saveGame(), loadGame: () => loadGame(),
  toggleInventory: () => toggleScreen(0, 'inventory'),
  isRunning: () => running,
  // the deathmatch cvars: the game running takes the new value at once, the next maps through the session
  setCvar: async (name, value) => { session.cvars[name] = value; if (map && !netGuest()) await db.exec(`UPDATE game SET ${name} = ${value} WHERE id = 1`); },
  // the skill (latched: the next map's): the select shows it, nightmare through its hidden option
  setSkill: (n) => { $('skill').value = String(n); },
  playDemo: (name) => playDemo(name),
  timedemo: (name) => playDemo(name, { timedemo: true }),
  screenshot: () => screenshot(),
  say: (text) => sayText(text),
  setSetting: (k, v) => setSetting(k, v),   // (the cvars: name, hand, sensitivity, cl_run, m_pitch, crosshair, s_volume, cd_volume)
  download: (name, text) => downloadText(name, text),   // (writeconfig: config.cfg)
  execConfig: () => $('cfg-file').click(),              // (exec: the Config control's picker; its file runs through execText)
  hasDemo: (name) => recordings.has(name) || kept.has(name) || pak.has(`demos/${name}.dm2`),
  listDemos: () => ({ pak: pakDemos(), kept: [...new Set([...kept, ...recordings.keys()])].sort() }),
  dropDemo: (name) => dropRecording(name),
  record: (name) => startRecording(name),
  stopRecord: () => stopRecording(),
  isRecording: () => !!recorder,
  setSpectator: (on) => setSpectator(on),
});
function openConsole(prefill = '') {
  if (document.pointerLockElement) { quietUnlock = true; document.exitPointerLock?.(); }
  input.clear();
  cmdline.hidden = false;
  cmdline.value = prefill;   // ("say " from the chat key: messagemode)
  // the scrollback: the last lines printed, the lines typed and the answers, under the input line
  conlog.textContent = notify.log(12).join('\n');
  conlog.hidden = !conlog.textContent;
  con.reset();
  cmdline.focus();
}
function closeConsole() {
  cmdline.hidden = true;
  conlog.hidden = true;
  canvas.focus();
}
/** Cmd_Say_f: the words to every client's message line, by this client's name; a guest's go to the host to say for it. */
async function sayText(text) {
  const t = String(text ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 150);
  if (!t) return;
  if (netGuest()) { net.guest.sendSay(t); return; }
  if (!map || demo) return;
  await session.say(1, t);
}
cmdline.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape' || e.code === 'Backquote') { e.preventDefault(); closeConsole(); return; }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); cmdline.value = con.historyStep(e.key === 'ArrowUp' ? -1 : 1); return; }
  if (e.key === 'Tab') { e.preventDefault(); const done = con.complete(cmdline.value); if (done) cmdline.value = done; return; }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const line = cmdline.value;
  closeConsole();
  if (line.trim()) notify.add(`]${line}`, gameClock(), { show: false });   // (the line echoed into the scrollback, as the console echoed it)
  await con.submit(line);
});

// ── saved games: the game tables and the unit's other levels, gzipped JSON in localStorage (F6 saves, F9 loads) ─────
/** Save with the comment the slot shows: the level's name after "ENTERING " (the autosave) or the time. */
const writeSave = async (key, autosave) => session.writeSave(key, saveComment(await session.levelName(), autosave));
/** A joined game is the host's to save and load. */
function guestNotice() {
  if (!netGuest()) return false;
  setStatus('A joined game is saved and loaded by its host', true);
  setTimeout(() => setStatus(''), 2000);
  return true;
}
async function saveGame(key = QUICK_KEY) {
  if (!running || !map || guestNotice()) return;
  if (last?.DEAD) { setStatus("Can't savegame while dead!", true); setTimeout(() => setStatus(''), 2000); return; }
  try {
    const size = await writeSave(key, false);
    setStatus(`Game saved (${map.name}, ${(size / 1024).toFixed(0)} KB)`);
    setTimeout(() => { if (statusEl.textContent.startsWith('Game saved')) setStatus(''); }, 2000);
  } catch (err) { console.error(err); setStatus(`Save failed: ${err.message}`, true); }
}
async function loadGame(key = QUICK_KEY) {
  if (guestNotice()) return;
  const save = await session.readSave(key);
  if (!save) { setStatus('No saved game', true); setTimeout(() => setStatus(''), 2000); return; }
  await loadSaved(save);
}
/**
 * The game as a file, and a file as the game: a save file is what a slot stores (src/savestore.js: the header
 * line, the JSON gzipped and base64'd), so a game moves between browsers, which `localStorage` does not.
 * Download writes the game as it stands, named with the map and the time; Load takes a file and plays it. A slot
 * of the load menu is written as it is stored (`d` on it), named with the slot and its map.
 */
async function downloadSave() {
  if (!running || !map || guestNotice()) return;
  if (last?.DEAD) { setStatus("Can't savegame while dead!", true); setTimeout(() => setStatus(''), 2000); return; }
  try {
    const text = await session.packGame(saveComment(await session.levelName(), false));
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    downloadText(`${map.name}-${stamp}.q2sav`, text);
    setStatus(`Game saved as a file (${map.name}, ${(text.length / 1024).toFixed(0)} KB)`);
    setTimeout(() => { if (statusEl.textContent.startsWith('Game saved')) setStatus(''); }, 2000);
  } catch (err) { console.error(err); setStatus(`Save failed: ${err.message}`, true); }
}
function downloadSlot(i) {
  if (guestNotice()) return;
  const slot = session.slotText(i);
  if (!slot) { setStatus('No saved game', true); setTimeout(() => setStatus(''), 2000); return; }
  downloadText(`save${i}-${slot.header.map}.q2sav`, slot.text);
  setStatus(`Slot ${i} saved as a file (${slot.header.map}, ${(slot.text.length / 1024).toFixed(0)} KB)`);
  setTimeout(() => { if (statusEl.textContent.startsWith(`Slot ${i} saved`)) setStatus(''); }, 2000);
}
/** A text downloaded under a name. */
const downloadText = (name, text) => downloadBlob(name, new Blob([text], { type: 'text/plain' }));
function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
// SCR_ScreenShot_f: the view as it stands, downloaded as quakeNN.png, the number counting up this session (Quake took the
// first free name in the screenshots directory, which a download cannot ask for)
let shots = 0;
function screenshot() {
  if (!renderer) return;
  const name = `quake${String(shots++).padStart(2, '0')}.png`;
  canvas.toBlob((blob) => {
    if (!blob) { setStatus('screenshot: the view could not be read', true); return; }
    downloadBlob(name, blob);
    setStatus(`Wrote ${name}`);
    notify.add(`Wrote ${name}`, gameClock(), { show: false });
    setTimeout(() => { if (statusEl.textContent === `Wrote ${name}`) setStatus(''); }, 2000);
  }, 'image/png');
}
async function loadSaveFile(file) {
  if (!file || guestNotice()) return;
  const save = await session.unpackText(await file.text());
  if (!save) { setStatus(`${file.name} is not a saved game of this port`, true); return; }
  if (save.version > SAVE_VERSION) { setStatus(`${file.name} is a saved game of a newer version (${save.version}, this is ${SAVE_VERSION})`, true); return; }
  await loadSaved(save);   // (an older version loads: the columns it lacks take their defaults, the ones the schema has lost are dropped and named)
}
async function loadSaved(save) {
  if (!pak.has(`maps/${save.map}.bsp`)) { setStatus(`The saved game is on ${save.map}, which is not in this pak`, true); return; }
  running = false;
  try {
    beginMap();
    setStatus('Loading the saved game…');
    // the map's geometry and models afresh, then the saved rows, then the unit's other levels as the save left them
    const setup = await session.loadSave(save, { skill: settings.skill, faceVerts: settings.renderer === 'sql' });
    await mapLoaded(setup);
    const loaded = setup.saveNote ? `Game loaded (${setup.saveNote})` : 'Game loaded';
    setStatus(loaded);
    setTimeout(() => { if (statusEl.textContent === loaded) setStatus(''); }, setup.saveNote ? 5000 : 2000);
    lastTic = performance.now();
    running = true;
  } catch (err) { console.error(err); setStatus(`Load failed: ${err.message}`, true); }
}
input.attach(canvas, window, { locked: () => document.pointerLockElement === canvas, settings: () => settings });
canvas.addEventListener('pointerdown', () => { if (anyKey) { const go = anyKey; anyKey = null; go(); } else if (demo && !menu.active) openMenu(() => menu.main()); });
// the keys menu waiting for a key takes a mouse button or the wheel too ("press a key or button"), as KeyBindingFunc took K_MOUSE1
canvas.addEventListener('mousedown', (e) => { if (menu.active && menu.current?.grab && MOUSE_KEYS[e.button]) { e.preventDefault(); menu.key(MOUSE_KEYS[e.button]); } });
canvas.addEventListener('wheel', (e) => { if (menu.active && menu.current?.grab) { e.preventDefault(); menu.key(e.deltaY > 0 ? 'MWheelDown' : 'MWheelUp'); } }, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());   // (the right button is a key under the lock, and in the keys menu)
canvas.addEventListener('click', () => {
  if (running && !menu.active && !demo && document.pointerLockElement !== canvas) canvas.requestPointerLock?.()?.catch?.(() => {});
});
// on-screen buttons for touch screens (the halves of the view move and look): fire and jump while held, the next
// weapon, the menu. Shown where the browser reports touch points or a coarse pointer.
const touchBar = $('touch');
if (touchBar) {
  if (navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches) touchBar.hidden = false;
  for (const b of touchBar.querySelectorAll('button')) {
    const act = b.dataset.act;
    const press = (on) => {
      if (act === 'fire') input.hold('TouchFire', on);
      else if (act === 'jump') input.hold('Space', on);
      else if (on && act === 'weapon') input.impulse = 12;
      else if (on && act === 'menu') { if (anyKey) { const go = anyKey; anyKey = null; go(); } else if (menu.active) menu.key('Escape'); else if (running) escape(); }
    };
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); press(true); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => press(false));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

/**
 * One tic's commands from the input: the first player's (the keys, the mouse, the touches, and the pad in
 * single player) and, in coop or deathmatch, the others' (a pad each, in order, or over the network the guest's
 * commands since the last tic); a pad's Start is the page's Escape either way.
 */
function readInput(tics) {
  const local = session.twoPlayers && !net ? session.nclients : 1;   // the players at this page: past the first, a pad each
  const cmd = input.read(tics, settings, { pad: local === 1 });
  if (input.menuPressed) escape();
  // the pad's Y and Back: the inventory and the help computer of the player the pad drives
  const padPlayer = local > 1 ? 1 : 0;
  if (input.padScreens.inventory) toggleScreen(padPlayer, 'inventory');
  if (input.padScreens.help) toggleScreen(padPlayer, 'help');
  if (netHost()) {
    // the guests' clients, each the commands its guest sent; a client whose guest left stands
    const cmds = [cmd];
    for (let c = 2; c <= session.nclients; c++) cmds.push(net.guests.find((g) => g.client === c)?.host.takeCommand() ?? IDLE_CMD);
    return cmds;
  }
  const cmds = [cmd];
  for (let p = 1; p < local; p++) {
    cmds.push(input.readPad(tics, settings, p - 1));
    // the other pads' Start, Y and Back: the menu, and their players' screens
    const pad = p > 1 ? input.pads[p - 1]?.last : null;
    if (pad) {
      if (pad.pressed.has(BUTTON.START)) escape();
      const s = padScreens(pad);
      if (s.inventory) toggleScreen(p, 'inventory');
      if (s.help) toggleScreen(p, 'help');
    }
  }
  return cmds;
}

/**
 * The view's size for the SQL's frustum (viewcfg) and the painter: the whole screen for one player, the
 * screen split along the middle for two at this page (each view half as high; Quake's fov is horizontal, so
 * the same fov), in four for three or four (a quarter each); a game over the network has one view a page, the
 * guest's the size the host's frustum has.
 */
async function applyView(fov = settings.fov) {
  if (netGuest()) {
    const v = net.guest.map?.view;
    if (v && renderer) renderer.setSize(v.w, v.h, 1);
    return;
  }
  const views = localViews();
  const cols = views > 2 ? 2 : 1, rows = views > 1 ? 2 : 1;
  await setView(db, Math.floor(viewWidth() / cols), Math.floor(viewHeight() / rows), fov);
  if (renderer) renderer.setSize(viewWidth(), viewHeight(), views);
}
/** The views this page paints: one per client of its own game, one when it hosts (the guest paints its own). */
const localViews = () => (session?.twoPlayers && !netHost() ? session.nclients : 1);

// ── maps ─────────────────────────────────────────────────────────────────
/** Before a map loads: the menus, the help and inventory screens away. */
function beginMap() {
  running = false;
  demo = null;
  if (recorder) stopRecording();   // (a recording ends with its level, as the client's did at the disconnect)
  for (const L of lerps) { L.prev = null; L.cur = null; }   // (the frames of the map being left)
  lastPaint = 0;
  notify.clear(); lastMsgTime = null;   // (the prints were the level's; its clock starts over)
  menu.off();
  showHelp = perPlayer(false);
  showInv = perPlayer(false);
  showScores = perPlayer(false);
}
/** A map is in (session.startMap's setup): the renderer and the sound set up from it. */
async function mapLoaded(setup) {
  map = session.map;
  mapSetup = setup;
  await applyView();          // one view or two, as the game (a new one, or a save) has players
  renderer.setResources(res);
  renderer.particles = [];
  tempEnts.clear();
  renderer.setSky(setup.sky);
  renderer.skyRotate = setup.skyRotate;
  renderer.skyAxis = setup.skyAxis;
  audio.setSpeakers(setup.speakers);
  audio.stopLoops();
  audio.playMusic(setup.cdTrack);
  $('mapname').textContent = map.name;
  $('map').value = map.name;
  // the guest's page sets itself up from the same (SV_SpawnServer's configstrings, sent at the connect)
  if (netHost()) for (const g of net.guests) g.host.sendMap(mapMessage(setup));
}
/** The map message a guest sets itself up from (SV_SpawnServer's configstrings): at every map, and at a connect to a game running. */
function mapMessage(setup = mapSetup) {
  return { name: map.name, sky: setup.sky, skyRotate: setup.skyRotate, skyAxis: setup.skyAxis, cdTrack: setup.cdTrack, gravity: setup.gravity,
    speakers: setup.speakers, view: { w: viewWidth(), h: viewHeight(), fov: settings.fov }, nmodels: res.byName.size };
}
async function startMap(name, newGame, spawnpoint = null, autosave = true) {
  if (netGuest()) leaveNet();   // a game of this page's own: the joined one is left
  beginMap();
  if (newGame) helpSeen = perPlayer(0);
  setStatus(`Loading ${name} into Firebird…`);
  const t0 = performance.now();
  // the face vertices are only for the SQL-projecting renderer: left out of the load until it is on; a new
  // game has the players the setting says (one, or two to four in coop or deathmatch; two when a guest is connected)
  // and the deathmatch cvars, a level change keeps the game's
  const modes = newGame ? { coop: netHost() || settings.coop, deathmatch: !netHost() && settings.deathmatch, players: netHost() ? hostClients() : settings.players,
    cvars: { dmflags: settings.dmflags, fraglimit: settings.fraglimit, timelimit: settings.timelimit } } : {};
  await mapLoaded(await session.startMap(name, { newGame, spawnpoint, skill: settings.skill, faceVerts: settings.renderer === 'sql', ...modes }));
  console.log(`[firebird-quake2] ${name} loaded in ${(performance.now() - t0).toFixed(0)} ms`);
  setStatus('');
  if (autosave) {
    try { await writeSave(SLOT_KEY(0), true); } catch (err) { console.warn('autosave:', err.message); }
  }
  lastTic = performance.now();
  running = true;
}

// ── the loop ─────────────────────────────────────────────────────────────
function nextFrame() {
  let done = false;
  const go = () => { if (!done) { done = true; frame(); } };
  requestAnimationFrame(go);
  setTimeout(go, 60);
}

// the brush models' frames and angles in the frame being drawn (FRAME_ALL's kind 6)
let brushFrames = new Map();
let brushAngles = new Map();
// src/lerp.js: the last two tics' frames of each view, painted between tics moved by the fraction of the tic gone by
const lerps = perPlayer(() => new FrameLerp());
let lastPaint = 0;
let paints = 0;          // frames painted (the tics are session.frameNo)
let guestGotAt = 0, guestDt = 0.05, guestSentAt = 0;   // a guest: when the host's last frame came and how long it stands for
// a guest's prediction (src/pmove.js, CL_PredictMovement): the map's clip data, the commands sent and not yet taken by a
// host tic (each numbered), the state run from the last frame's row through them, and the error the last frame corrected
let guestPred = null;   // { cm, seq, cmds: [{ seq, cmd, dt }], st, world, gravity, modelOfFace, error: { dx, dy, dz, at } | null }

async function frame() {
  // a demo with the menu over it (the attract loop): the demo plays on behind, the menu drawn over each frame,
  // the pad driving the menu (SCR_UpdateScreen drew the demo's frame, then M_Draw)
  if (demo && running && menu.active && !document.hidden && renderer) {
    try {
      const pad = input.pollPad();
      if (pad) { const mk = padMenuKeys(pad, input.pad.stick); input.pad.stick = mk.stick; for (const key of mk.keys) menu.key(key); }
      if (renderer.views !== 1) renderer.setSize(viewWidth(), viewHeight(), 1);
      await demoFrame(performance.now());
      if (demo && menu.active) { menu.draw(renderer, performance.now()); renderer.present(); }
    } catch (err) { console.error(err); setStatus(`Error: ${err.message}`, true); running = false; }
    nextFrame();
    return;
  }
  // a game shared with guests runs on under the host's menu and pause, and in a hidden tab as far as the browser's timers
  // let it (Quake 2 paused single player alone: SV_Frame ran the game frame unless paused with maxclients 1)
  const shared = netHost();
  if (!running || (!shared && (paused || document.hidden || menu.active))) {
    lastTic = performance.now();
    audio.silenceLoops();
    const pad = input.pollPad();
    if (pad && pad.pressed.size && anyKey) { const go = anyKey; anyKey = null; go(); }
    else if (pad && menu.active) { const mk = padMenuKeys(pad, input.pad.stick); input.pad.stick = mk.stick; for (const key of mk.keys) menu.key(key); }
    else if (pad && paused && pad.pressed.has(BUTTON.START)) paused = false;
    // (the menus and the pause take the whole screen, a split one too: one view, drawn again full size)
    if (renderer && renderer.views !== 1) renderer.setSize(viewWidth(), viewHeight(), 1);
    if (menu.active && renderer && last && !document.hidden) { drawFrame(0, last, null, [], new Float32Array(64), last.TIME_); menu.draw(renderer, performance.now()); renderer.present(); }
    else if (paused && renderer && last) { drawFrame(0, last, null, [], new Float32Array(64), last.TIME_); hud.drawCenter(renderer, 'paused', 80); renderer.present(); }
    nextFrame();
    return;
  }
  try {
    const now = performance.now();
    // the tics owed by the wall clock (20 Hz), at most two a frame: a stall is slow motion, never a leap; a frame
    // that owes none paints the last tic's frame again, moved toward the current one (src/lerp.js)
    let owed = Math.floor((now - lastTic) / TIC_MS);
    if (owed > 2) { owed = 2; lastTic = now - 2 * TIC_MS; }

    if (netGuest()) { guestFrame(now); nextFrame(); return; }
    if (demo) { await demoFrame(now); nextFrame(); return; }
    if (owed === 0) {
      if (lerps[0].frame && settings.renderer !== 'sql' && !document.hidden) { paintFrames(now); overlayMenu(); }   // (the SQL-projecting mode paints a tic's frame as it is)
      nextFrame();
      return;
    }
    const tics = owed;
    lastTic += tics * TIC_MS;

    let t = performance.now();
    last = await session.tic(...readInput(tics));   // (every client's command: the pads', or the guests')
    // (a new map began loading while the tic ran: this frame is the old map's, and its tables are going)
    if (!running) { nextFrame(); return; }
    for (let p = 0; p < session.clients.length; p++) if (showInv[p]) invItems[p] = await session.inventory(p + 1);
    perf.tic = performance.now() - t;

    if (last.EXIT_KIND === 1 && last.NEXT_MAP) {
      await changeLevel(last.NEXT_MAP);
      nextFrame();
      return;
    }
    if (await session.takeLoadRequest()) openMenu(() => menu.loadMenu());

    t = performance.now();
    // one round trip, decoded (FRAME_ALL in sql/render.sql, decodeFrame in src/session.js); in coop a second
    // for the second player's view (the sounds and effects came with the first: the first player is the
    // listener). The tic's rows say how many clients the game has: a view each; over the network the second
    // view is the guest's, sent to it (the faces as the fast mode lists them: the guest projects them itself).
    const views = netHost() ? 1 : Math.min(MAX_PLAYERS, session.clients.length);
    if (renderer.views !== views) renderer.setSize(viewWidth(), viewHeight(), views);
    const f = await session.frame({ sqlRenderer: settings.renderer === 'sql', client: 1 });
    const more = [];   // the other views' frames, the second client's first (a map that began loading meanwhile ends the frame)
    for (let c = 2; c <= views && running; c++) more.push(await session.frame({ sqlRenderer: settings.renderer === 'sql', client: c }));
    if (netHost()) {
      for (const g of [...net.guests]) {   // (a guest may leave during a query: the list is this frame's)
        const row = session.clients.find((c) => c.CLIENT === g.client);
        if (!row || !running) continue;
        const gf = await session.frame({ sqlRenderer: false, client: g.client, boxes: true });   // (the boxes about it: its prediction clips against them)
        const inv = g.host.wantInv ? await session.inventory(g.client) : null;
        if (g.host.open) g.host.sendFrame({ ...row, SCORES: scoreRows() }, gf, { sounds: f.sounds, fx: f.fx, dt: tics * 0.05, inv });
      }
    }
    if (!running) { nextFrame(); return; }
    if (recorder) await recordFrame(last, f);
    const { faces, ents, sounds, fx, loops } = f;
    if (f.speakers) audio.setSpeakersOn(f.speakers);
    perf.faces = performance.now() - t;
    perf.rows = faces.length + more.reduce((n, m) => n + m.faces.length, 0);
    const listener = { x: last.PX, y: last.PY, z: last.VIEW_Z, yaw: last.YAW };
    if (sounds.length) audio.playEvents(sounds, listener);
    audio.setLoops(loops);
    audio.update(listener);
    if (fx.length) tempEnts.add(fx, last.TIME_, renderer);

    // this tic's frames become the current ones (the last tic's the previous), and are painted at the fraction gone by
    lerps[0].push(last, f);
    more.forEach((m, i) => lerps[i + 1].push(session.clients[i + 1] ?? last, m));
    if (!document.hidden) { paintFrames(now); overlayMenu(); }   // (a shared game's host hidden tics on and paints nothing)
    // the frame's spare time marks the cluster the player is heading into (premark_ahead), so the
    // crossing is a switch of slot and not a hitch; a call that finds nothing to do costs ~0.3 ms
    if (perf.tic + perf.faces + perf.draw < 30) await session.premark();
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`, true);
    running = false;   // the game stops on an error; the loop idles on, so a new map (the select, a load) plays again
  }
  nextFrame();
}

/**
 * Every view painted once from its last two tics' frames (src/lerp.js), moved toward the current one by the
 * fraction of the tic gone by at `now`; the first view's angles take the turn the input holds, not yet sent
 * with a tic, so looking around is immediate. The particles run by the real time since the last paint.
 */
/** A shared game's host in a menu: the menu drawn over the frame just painted (the game goes on behind, as a server's did). */
function overlayMenu() {
  if (menu.active && renderer && netHost()) { menu.draw(renderer, performance.now()); renderer.present(); }
}
function paintFrames(now) {
  const t = performance.now();
  const dt = lastPaint ? Math.min(0.1, Math.max(0, (now - lastPaint) / 1000)) : 0.05;
  lastPaint = now;
  const exact = settings.renderer === 'sql';
  const frac = netGuest() ? (now - guestGotAt) / (guestDt * 1000) : (now - lastTic) / TIC_MS;
  const f0 = Math.max(0, Math.min(1, frac));
  const cur = lerps[0].cur.row;
  const time = cur.TIME_ - (exact ? 0 : (1 - f0) * 0.05);   // the clock between the two tics
  renderer.runParticles(dt, time);
  const views = renderer.views;
  for (let v = 0; v < views; v++) {
    const L = lerps[v];
    if (!L.frame) continue;
    const predicted = v === 0 && netGuest() ? guestView(now) : null;
    const turn = predicted ? { view: predicted } : v === 0 && !netGuest() ? { yaw: input.mouseYaw, pitch: input.mousePitch } : {};
    const s = L.at(frac, turn, exact);
    brushFrames = L.frame.brushFrames; brushAngles = s.brushAngles;
    drawFrame(v, s.row, s.faces, s.ents, L.frame.styles, time, dt);
  }
  if (views === 3) renderer.clearView(3);   // (the fourth quarter stays black)
  paints++;
  perf.draw = performance.now() - t;
  updateStats();
}

/**
 * A guest's frame: its command goes to the host every frame (the turning keys scaled by the fraction of a tic
 * since the last), and the newest frame the host sent is painted as the page paints its own (the sounds at this
 * player's ear, the effects and particles run here), moved between the host's last two by the time since it came.
 */
function guestFrame(now) {
  const frameTics = guestSentAt ? Math.min(2, (now - guestSentAt) / TIC_MS) : 1;
  guestSentAt = now;
  const [cmd] = readInput(frameTics);
  if (!net?.guest?.open) return;
  const seq = guestPred ? ++guestPred.seq : undefined;
  net.guest.sendCommand(cmd, { inv: showInv[0], seq });
  const got = net.guest.take();
  if (!map) return;
  if (got) {
    last = got.row;
    const f = got.frame;
    if (f.speakers) audio.setSpeakersOn(f.speakers);
    const listener = { x: last.PX, y: last.PY, z: last.VIEW_Z, yaw: last.YAW };
    if (f.sounds.length) audio.playEvents(f.sounds, listener);
    audio.setLoops(f.loops);
    audio.update(listener);
    if (f.fx.length) tempEnts.add(f.fx, last.TIME_, renderer);
    if (showInv[0]) invItems[0] = got.inv;
    lerps[0].push(last, f);
    guestGotAt = now; guestDt = got.dt || 0.05;
    perf.tic = 0; perf.faces = 0; perf.rows = f.faces.length;
    guestAck(got, now);
  }
  if (seq !== undefined) guestPredict(cmd, frameTics, seq);
  if (lerps[0].frame) paintFrames(now);
}
/** Input.read's usercmd array as pmove's command. */
const cmdOf = (c) => ({ fwd: c[1], side: c[2], yawd: c[3], pitchd: c[4], jump: c[6], run: c[7] });
/**
 * CL_PredictMovement: a host frame came with the newest command its tic took. The commands up to it are done
 * with; the state is the frame's row run through the ones after it (the host's brush models where the frame
 * has them: the faces' entities and their origins, the angles the frame carries; the box entities about the
 * guest, the monsters and the other clients, as the frame carries them). Where the new state lands away from where the prediction
 * had it, the difference is the prediction error, faded out over the next tenth of a second
 * (CL_CheckPredictionError, V_CalcRefdef's prediction_error) so the correction glides instead of snapping.
 * A dead or frozen player is painted where the host has it.
 */
function guestAck(got, now) {
  const p = guestPred;
  if (!p) return;
  const row = got.row;
  if (row.DEAD || row.INTERMISSION || row.VX == null) { p.st = null; p.cmds = []; p.error = null; return; }
  const before = p.st ? { x: p.st.x, y: p.st.y, z: p.st.z } : null;
  p.cmds = p.cmds.filter((c) => c.seq > got.ack);
  const solids = [], seen = new Set();
  for (const r of got.frame.faces) {
    if (r.length !== 5 || !r[1] || seen.has(r[1])) continue;
    seen.add(r[1]);
    const mi = p.modelOfFace[r[0]];
    if (mi > 0) solids.push({ model: mi, origin: [r[2], r[3], r[4]], angles: got.frame.brushAngles.get(r[1]) ?? [0, 0, 0] });
  }
  p.world = { solids, boxes: got.frame.boxes ?? [], gravity: p.gravity };
  const st = stateFromRow(row);
  for (const c of p.cmds) pmove(p.cm, st, c.cmd, c.dt, p.world);
  p.st = p.cmds.length ? st : null;
  if (before && p.st) {
    const dx = before.x - st.x, dy = before.y - st.y, dz = before.z - st.z;
    p.error = Math.hypot(dx, dy, dz) < 640 && (dx || dy || dz) ? { dx, dy, dz, at: now } : null;   // (farther is a teleport: no glide)
  } else p.error = null;
}
/** The command just sent, run ahead on the predicted state (its own turn and its share of a tic). */
function guestPredict(cmd, tics, seq) {
  const p = guestPred;
  if (!p) return;
  const c = { seq, cmd: cmdOf(cmd), dt: tics * 0.05 };
  p.cmds.push(c);
  if (p.st) pmove(p.cm, p.st, c.cmd, c.dt, p.world ?? { gravity: p.gravity });
  else if (last && !last.DEAD && !last.INTERMISSION && last.VX != null) { p.st = stateFromRow(last); pmove(p.cm, p.st, c.cmd, c.dt, p.world ?? { gravity: p.gravity }); }
}
/** The guest's view now: the predicted state's, with what is left of the last correction's error added back. */
function guestView(now) {
  const p = guestPred;
  if (!p?.st?.view) return null;
  const v = p.st.view;
  if (!p.error) return v;
  const k = Math.max(0, 1 - (now - p.error.at) / 100);
  if (k <= 0) { p.error = null; return v; }
  return { ...v, x: v.x + p.error.dx * k, y: v.y + p.error.dy * k, z: v.z + p.error.dz * k, viewZ: v.viewZ + p.error.dz * k };
}

const sprite = (name) => res.models.get(res.byName.get(name))?.spr;
const model = (name) => res.models.get(res.byName.get(name))?.mdl;

// ── a demo played (src/demo.js): CL_PlayDemo_f's attract loop over the demo's map, loaded as a game's ─────────
// ── recording (src/record.js): the game's frames written as the server's messages, a .dm2 Quake 2 plays ─────
/**
 * CL_Record_f: from here on, each tic's row and frame go to a recorder set up for this map (its checksum, sky and
 * CD track as the server's configstrings, the brush models by name, the recording client's entity).
 */
async function startRecording(name) {
  if (recorder || !running || !map || demo || netGuest()) return;
  const playerEnt = (await db.query('SELECT ent_id FROM player WHERE id = 1')).rows[0]?.ENT_ID ?? 0;
  const brushNames = new Map((await db.query("SELECT e.id, m.name FROM ents e JOIN models m ON m.id = e.model_id WHERE m.kind = 'B' AND m.name STARTING WITH '*'", [], { rowMode: 'array' })).rows);
  const rec = new DemoRecorder({ map: map.name, res, bsp: map.bsp, mapBytes: pak.get(`maps/${map.name}.bsp`), setup: mapSetup ?? {}, playerEnt, brushNames,
    levelname: await session.levelName(), fov: viewFov(), netname: settings.name || 'player' });
  recorder = { name, rec };
  setStatus(`Recording to ${name}.dm2`);
  setTimeout(() => { if (statusEl.textContent.startsWith('Recording to')) setStatus(''); }, 2500);
}
/** One tic to the recorder: the brush models' places go with it (a frame's faces carry them only in the fast mode). */
async function recordFrame(row, f) {
  const r = recorder;
  try {
    if (!r.rec.due(row)) { r.rec.frame(row, f); return; }
    const brushes = (await db.query('SELECT e.id, e.x, e.y, e.z, e.pitch, e.yaw, e.roll, e.frame, e.effects FROM ents e WHERE e.mkind = \'B\'', [], { rowMode: 'array' })).rows;
    if (recorder === r) r.rec.frame(row, f, { brushes });
  } catch (err) { console.error(err); setStatus(`Recording failed: ${err.message}`, true); recorder = null; }
}
/** CL_Stop_f: the file downloads as <name>.dm2 and stays in the Demo select for this session. */
function stopRecording() {
  const r = recorder;
  if (!r) return;
  recorder = null;
  const bytes = r.rec.finish();
  keepRecording(r.name, bytes);
  try {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${r.name}.dm2` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) { console.error(err); }
  const left = r.rec.dropped ? `, ${r.rec.dropped} entities left out of a full block` : '';
  setStatus(`Recorded ${r.name}.dm2: ${r.rec.frames} frames (${(bytes.length / 1024).toFixed(0)} KB)${left}`);
  setTimeout(() => { if (statusEl.textContent.startsWith('Recorded ')) setStatus(''); }, 3000);
}

/**
 * A recording is in hand (just made, or opened from a file): into the Demo select, and kept across reloads where
 * there is an IndexedDB (src/demostore.js), the same name replacing the earlier one.
 */
function keepRecording(name, bytes) {
  recordings.set(name, bytes);
  kept.add(name);
  if (![...$('demo').options].some((o) => o.value === name)) { $('demo').append(new Option(`${name} (recorded)`, name)); $('demo').parentElement.hidden = false; }
  demoStore.put(name, bytes).catch((err) => console.warn('the recording is not kept:', err.message));
}
/** A recording dropped (`deldemo <name>`): from the select, this session and the store; the pak's demos stay. */
async function dropRecording(name) {
  if (!recordings.has(name) && !kept.has(name)) return false;
  recordings.delete(name);
  kept.delete(name);
  await demoStore.remove(name).catch((err) => console.warn('demostore:', err.message));
  if (!pak.has(`demos/${name}.dm2`)) { [...$('demo').options].find((o) => o.value === name)?.remove(); if (demo?.name === name) $('demo').value = ''; }
  return true;
}
/** A .dm2 opened from a file: read as the pak's are, kept under the file's name (cleaned as `record` cleans one), and played. */
async function openDemoFile(file) {
  if (!file) return;
  const name = file.name.toLowerCase().replace(/\.dm2$/, '').replace(/[^a-z0-9_-]/g, '') || 'demo';
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = parseDemo(bytes);   // (throws on anything that is not a demo)
  if (!parsed.frames.length) throw new Error(`${file.name} has no frames`);
  keepRecording(name, bytes);
  await playDemo(name);
}
/** The pak's demos (demos/*.dm2) by name: the demo pak's q2demo1, the full game's three. */
const pakDemos = () => pak.list('demos/', '.dm2').map((n) => n.slice(6, -4));
/** A demo's bytes: one in hand by that name, else one kept from an earlier load (read now), else the pak's. */
async function demoBytes(name) {
  if (recordings.has(name)) return recordings.get(name);
  if (kept.has(name)) {
    const bytes = await demoStore.get(name).catch((err) => { console.warn('demostore:', err.message); return null; });
    if (bytes) { recordings.set(name, bytes); return bytes; }
  }
  return pak.has(`demos/${name}.dm2`) ? pak.get(`demos/${name}.dm2`) : null;
}
/**
 * Play `demos/<name>.dm2`: its map loaded as for a new game, the game's own models hidden, then the recording's
 * frames. `withMenu` brings the main menu up over it (the attract loop at the start, and the menu kept across the
 * loop's next demo). A key, a click or the pad brings the menu up; the demo's end plays the pak's next.
 */
const DEMO_FRAME = 0.1;   // a recording's frames are a tenth of a second apart (the server's 10 Hz)
let lastTimedemo = null;  // { frames, seconds, report }: the last timedemo's figures
/** The demo played, with the main menu over it (the attract loop), or as a timedemo (CL_Timedemo_f: a frame a painted frame, the figures at the end). */
async function playDemo(name, { withMenu = false, timedemo = false } = {}) {
  const bytes = await demoBytes(name);
  if (!bytes) { setStatus(`no demo "${name}" in this pak`, true); setTimeout(() => setStatus(''), 2500); return; }
  const parsed = parseDemo(bytes);
  const mapName = parsed.map.replace(/^maps\//, '').replace(/\.bsp$/, '');
  if (!parsed.frames.length || !pak.has(`maps/${mapName}.bsp`)) { setStatus(`the demo's map ${mapName} is not in this pak`, true); return; }
  if (net) leaveNet();   // a demo plays on a page alone
  if (document.pointerLockElement) { quietUnlock = true; document.exitPointerLock?.(); }   // the mouse is free: nothing to look with
  beginMap();
  setStatus(`Loading ${mapName} for the demo…`);
  await mapLoaded(await session.startMap(mapName, { newGame: true, skill: settings.skill, faceVerts: settings.renderer === 'sql', coop: false, deathmatch: false }));
  await session.demoBegin();
  // (a brush model's sounds come from its box's middle, as the client placed them: the map's bounds for its '*N')
  const player = new DemoPlayer(parsed, { modelId: (n) => res.byName.get(n), brushBounds: (n) => map.bsp.models[Number(n.slice(1))] ?? null });
  demo = { name, player, time: 0, at: performance.now(), frames: parsed.frames.length, cprint: null, msg: null, timedemo: timedemo ? { start: performance.now(), frames: 0 } : null };
  $('mapname').textContent = `${mapName} (${timedemo ? 'timedemo' : 'demo'} ${name})`;
  if ([...$('demo').options].some((o) => o.value === name)) $('demo').value = name;
  setStatus('');
  running = true;
  if (withMenu) openMenu(() => menu.main());
}
/**
 * The attract loop (CL_Disconnect's "d1": the demos one after another with the main menu over them, where Quake 2
 * started and went back to after a game): the pak's first demo with the main menu; a pak without demos starts a game.
 */
async function attract() {
  const demos = pakDemos();
  if (!demos.length) return startMap(session.firstMap(), true);
  await playDemo(demos[0], { withMenu: true });
}
/** A demo's end: the pak's next (the loop's "nextserver": d1, d2, d3, round again), the menu staying up if it was. */
function nextDemo() {
  const d = demo, demos = pakDemos();
  if (!d || !demos.length) return;
  const next = demos[(demos.indexOf(d.name) + 1) % demos.length];
  playDemo(next, { withMenu: menu.active }).catch((err) => setStatus(err.message, true));
}
/** A timedemo's end (CL_DemoCompleted): the frames painted and the seconds they took reported, a new game as after a demo stopped. */
function timedemoDone(d) {
  const seconds = (performance.now() - d.timedemo.start) / 1000;
  const report = `${d.timedemo.frames} frames, ${seconds.toFixed(1)} seconds: ${(d.timedemo.frames / Math.max(seconds, 1e-3)).toFixed(1)} fps`;
  lastTimedemo = { frames: d.timedemo.frames, seconds, report };
  demo = null;
  $('demo').value = '';
  startMap(session.firstMap(), true).then(() => { setStatus(report); notify.add(report, gameClock(), { show: false }); }).catch((err) => setStatus(err.message, true));
}
/** The Demo select put back to none: the demo gives way to a new game. */
function stopDemo() {
  if (!demo) return;
  demo = null;
  $('demo').value = '';
  startMap(session.firstMap(), true).catch((err) => setStatus(err.message, true));
}
/**
 * One display frame of the demo: the clock moves by the real time (at most a fifth of a second: a hidden tab
 * does not skip ahead), the view and the entities are the recording's at that time, the faces come from the SQL
 * for that view (session.demoFrame), the frames reached since the last call play their sounds, effects and prints.
 */
async function demoFrame(now) {
  const d = demo;
  // a timedemo steps a frame of the recording a painted frame, whatever the wall clock says (CL_Timedemo_f's cl.time)
  const dt = d.timedemo ? (d.timedemo.frames ? DEMO_FRAME : 0) : Math.min(0.2, Math.max(0, now - d.at) / 1000);
  d.at = now;
  d.time += dt;
  if (d.timedemo) d.timedemo.frames++;
  const st = d.player.at(d.time);
  // the end: the last frame reached and the clock past it (the fraction past the last frame is 0, never 1: the old
  // test stood on the last frame for ever, and the attract loop never went on to the next demo)
  if (d.player.finished && d.time >= d.player.duration) { if (d.timedemo) timedemoDone(d); else nextDemo(); return; }
  const pad = input.pollPad();
  if (pad && pad.pressed.size && !menu.active) { openMenu(() => menu.main()); return; }
  let t = performance.now();
  const f = await session.demoFrame(st.view, st.brushes);
  if (demo !== d) return;   // (stopped while the query ran: this frame is nobody's)
  perf.tic = 0;
  perf.faces = performance.now() - t;
  perf.rows = f.faces.length;
  last = demoRow(st);
  const listener = { x: last.PX, y: last.PY, z: last.VIEW_Z, yaw: last.YAW };
  const { rows, fx } = d.player.soundRows(st.events, st.frame, st.view);
  if (rows.length) audio.playEvents(rows, listener);
  audio.setLoops(st.loops);
  audio.update(listener);
  const effects = [...st.events.fx, ...fx];
  if (effects.length) tempEnts.add(effects, d.time, renderer);
  t = performance.now();
  renderer.runParticles(dt, d.time);
  brushFrames = f.brushFrames; brushAngles = f.brushAngles;
  drawFrame(0, last, f.faces, st.ents, st.lights, d.time, dt);
  perf.draw = performance.now() - t;
  updateStats();
}
/**
 * The demo's player state as the page's Q2_TIC row: the view, the stats the status bar reads (STAT_HEALTH, STAT_AMMO,
 * STAT_ARMOR with its icon, the selected and the picked-up item by their icons, the timer, the help icon), the gun in
 * hand with its frame and angles as the server sent them, the blend, and the prints of the frames reached.
 */
function demoRow(st) {
  const d = demo, v = st.view, s = v.stats, dm = d.player.demo;
  const image = (i) => (i > 0 ? dm.images[i] ?? '' : '');
  const itemByIcon = (icon) => (icon ? Math.max(0, ITEMS.findIndex((it) => it && it[1] === icon)) : 0);
  const gunName = v.gunindex > 0 ? dm.models[v.gunindex] ?? '' : '';
  const weapon = Number(Object.keys(WEAPONS).find((k) => WEAPONS[k].view === gunName) ?? 0);
  const armorIcon = image(s[4]);
  // the prints: a centerprint for 2.5 s (scr_centertime), a console print at the top for 3 s (con_notifytime)
  for (const cp of st.events.centerprints) d.cprint = { text: cp.replace(/\n+$/, ''), until: d.time + 2.5 };
  for (const [level, text] of st.events.prints) if (level >= 1) d.msg = { text: text.replace(/\n+$/, ''), until: d.time + 3 };
  const row = {
    CLIENT: 1, TIME_: d.time, PX: v.x, PY: v.y, PZ: v.z, VIEW_Z: v.viewZ, YAW: v.yaw, PITCH: v.pitch, ROLL: v.roll,
    HEALTH: s[1], ARMOR: ARMOR_ICONS.includes(armorIcon) ? s[5] : 0, ARMOR_TYPE: Math.max(0, ARMOR_ICONS.indexOf(armorIcon)),
    POWER_ARMOR: armorIcon === 'i_powershield' ? 1 : 0, CELLS: armorIcon === 'i_powershield' ? s[5] : 0,
    WEAPON: weapon, GUN_MODEL: gunName, GUNFRAME: v.gunframe, GUN_OLDFRAME: v.gunOldframe, GUN_BACKLERP: v.gunBacklerp, GUN_ANGLES: st.ps.gunAngles, BLEND: v.blend,
    INV_SEL: itemByIcon(image(s[6])), PICKUP_ITEM: itemByIcon(image(s[7])),
    TIMER_ICON: Math.max(0, TIMER_ICONS.indexOf(image(s[9]))), TIMER: s[10], HELP_CHANGED: s[11] ? 1 : 0,
    DMG_TIME: s[15] & 1 ? d.time : -10, BONUS_TIME: -10, DMG_TAKE: 0, DMG_SAVE: 0,
    WATERLEVEL: v.rdflags & 1 ? 3 : 0, WATERTYPE: 0, INTERMISSION: st.ps.pmType === 4 ? 1 : 0, DEAD: 0, DEATHMATCH: 0,
    CPRINT: d.cprint && d.cprint.until > d.time ? d.cprint.text : null, MSG: d.msg && d.msg.until > d.time ? d.msg.text : null, MSG_TIME: d.msg?.until ?? 0,
    BOBTIME: 0, XYSPEED: 0, DUCKED: 0, DEMO: 1,
  };
  if (weapon && WEAPONS[weapon].ammo) row[WEAPONS[weapon].ammo.toUpperCase()] = s[3];
  return row;
}

// ── leaving a level: what the server did with the map string (SV_Map; src/levels.js) ─────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function changeLevel(target) {
  // the unit's levels and its cross-level flags (session.leave); then a picture, the next map, or the end
  const c = await session.leave(target);
  if (c.kind === 'pic' && pak.has(`pics/${c.map}`)) {
    if (netHost()) for (const g of net.guests) g.host.sendPic(`pics/${c.map}`);
    await showPicture(`pics/${c.map}`);
    return c.then ? changeLevel(c.then) : endGame();
  }
  if (c.kind === 'cinematic' && pak.has(`video/${c.map}`)) {
    if (netHost()) for (const g of net.guests) g.host.sendCin(`video/${c.map}`);
    await playCinematic(`video/${c.map}`);
    return c.then ? changeLevel(c.then) : endGame();
  }
  if (c.kind !== 'map') return c.then ? changeLevel(c.then) : endGame();   // a cinematic the pak lacks, a demo: not played
  if (!pak.has(`maps/${c.map}.bsp`)) {
    setStatus(`${c.map} is not in this pak`);
    await sleep(2500);
    return endGame();
  }
  // SCR_DrawLoading: the plaque over the last frame while the next level loads
  const plaque = hud.pic('loading');
  if (plaque) { renderer.drawPic(plaque, (renderer.w - plaque.w) >> 1, (renderer.h - plaque.h) >> 1); renderer.present(); }
  await startMap(c.map, false, c.spawn);
}

/** A full-screen picture with its own palette (the ss_pic server state), until a key after a second. */
async function showPicture(file) {
  running = false;
  setStatus('');
  const p = loadPcx(pak.get(file));
  renderer.drawPicFull(p);
  renderer.present(null, p.palette);
  await new Promise((resolve) => setTimeout(() => { anyKey = resolve; }, 1000));
}

/**
 * SCR_PlayCinematic: the file's frames at fourteen a second in their own palette, its sound as raw samples, until
 * the end or a key, a click or the pad (SCR_FinishCinematic); no game runs meanwhile (the cinematic server state).
 * A frame the page was too slow for is read for its sound and not drawn. The host's guest plays its own copy
 * (sendCin) and stops when the next map comes.
 */
async function playCinematic(file) {
  return playCinematicFrom(pak.get(file), file);
}
async function playCinematicFrom(bytes, file) {
  running = false;
  setStatus('');
  let reader;
  try { reader = new CinReader(bytes); } catch (err) { console.warn(`[firebird-quake2] ${file}: ${err.message}`); return; }
  const player = new CinPlayer(reader);
  const t0 = performance.now();
  let lastFrame = -1;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; anyKey = null; cinematic = null; audio.stopRaw(); resolve(); };
    cinematic = { file, player, frame: -1, finish };
    anyKey = finish;
    const step = () => {
      if (done) return;
      const i = player.frameIndex((performance.now() - t0) / 1000);
      let f = null;
      for (let k = lastFrame + 1; k <= i; k++) {
        const g = player.frameAt(k);
        if (!g) break;
        audio.playRaw(g.samples, reader.rate, reader.sampleWidth, reader.channels);
        f = g; lastFrame = k;
      }
      if (player.finished && i > lastFrame) { finish(); return; }
      if (f) { renderer.drawPicFull({ w: reader.width, h: reader.height, data: f.image }); renderer.present(null, f.palette); cinematic.frame = lastFrame; }
      requestAnimationFrame(step);
    };
    step();
  });
}

/** The game is over (the demo's last exit, a guest's host gone): the attract loop, as Quake 2 went back to it. */
async function endGame() {
  await attract();
}

/**
 * One view painted: `which` is 0 for the top (or whole) screen, 1 for a split screen's bottom; `last` the
 * client's Q2_TIC row the view belongs to (the page's `last` for the first player).
 */
function drawFrame(which, last, faces, ents, styles, time, dt = 0.05) {
  const r = renderer;
  r.dlights = tempEnts.lights(ents, time);
  const view = { x: last.PX, y: last.PY, z: last.VIEW_Z, yaw: last.YAW, pitch: last.PITCH, roll: last.ROLL ?? (last.DEAD ? 40 : 0), fov: viewFov() };
  // RDF_UNDERWATER: the eye in water, slime or lava draws the view into the 320×240 warp buffer and warps it up
  const underwater = last.WATERLEVEL >= 3 && !last.INTERMISSION;
  if (underwater) r.beginUnderwater();
  r.beginFrame(view);
  if (faces) {
    const frames = new Map();
    for (const [id, [f, eff]] of brushFrames) frames.set(id, entityFrame(f, eff, time));
    if (settings.renderer === 'sql') r.drawFaces(faces, styles, time, frames);
    else r.drawFaceList(faces, styles, time, frames, brushAngles);
  }
  const bsp = map.bsp;
  for (const e of ents) {
    const [, mid, frame, skin, x, y, z, pitch, yaw, roll, effects, alpha, kindRaw] = e;
    const kind = String(kindRaw).trim();
    const m = res.models.get(mid);
    if (!m) continue;
    if (kind === 'M') {
      // R_LightPoint at the origin, with the dynamic lights (a projectile's own light makes it bright); items glow
      const light = lightPoint(bsp, x, y, z);
      const spin = effects & 1 ? (time * 100) % 360 : 0;   // EF_ROTATE items spin
      // (a row that carries the frame it left and the blend toward this one, from the lerp or the demo: the pose between)
      r.drawAlias(m.mdl, frame, skin, [x, y, z], [pitch, yaw + spin, roll], light,
        { time, alpha: alpha === 1, dlight: dlightAt(r.dlights, x, y, z), glow: (e[13] & 4) !== 0, oldFrame: e[14], backlerp: e[15] ?? 0 });
      if (effects & 8) r.particles.push({ x, y, z, vx: 0, vy: 0, vz: 0, color: 0xe0 + (Math.random() * 4 | 0), die: time + 0.05, type: 'still' });   // the blaster bolt's glow
      if (effects & 16) r.spawnParticles('gunshot', x, y, z, 2, [0, 0, 0], 0xe0 + 8);   // rocket smoke
    } else if (kind === 'S') {
      r.drawSprite(m.spr, Math.floor(time * 10) % Math.max(1, m.spr.frames.length), [x, y, z], 255, effects & 128 ? true : false);
    }
  }
  // the temporary entities: beams, the parasite's tongue, the explosions (src/effects.js); the particles were
  // run once for the frame
  tempEnts.draw(r, bsp, time);
  r.drawParticles();
  // the weapon in hand (depth hack: drawn over everything near); none at the intermission
  // (a demo's row names the gun model, its frame and its angles as the server sent them: ps.gunindex, gunframe, gunangles)
  // (the hand: a left-hander's gun is drawn mirrored, a centre-hander's not at all, as ref_soft and ref_gl had hand 1 and 2)
  const wp = WEAPONS[last.WEAPON];
  const gunName = last.GUN_MODEL ?? wp?.view;
  if (!last.DEAD && !last.INTERMISSION && gunName && last.HAND !== 2) {
    const vm = res.models.get(res.byName.get(gunName));
    if (vm) {
      // SV_CalcGunOffset: the gun sways with the walk cycle and lags behind turns of the view (the delta over a
      // tenth of a second, at most 45 degrees); it sits at the eye, which already carries the view's bob
      const bt = (last.BOBTIME ?? 0) * (last.DUCKED ? 4 : 1), bfs = Math.abs(Math.sin(bt * Math.PI)), xys = last.XYSPEED ?? 0;
      let gr = xys * bfs * 0.005, gy = xys * bfs * 0.01;
      if (Math.floor(bt) & 1) { gr = -gr; gy = -gy; }
      let gp = xys * bfs * 0.005;
      if (last.GUN_ANGLES) [gp, gy, gr] = last.GUN_ANGLES;
      else if (gunPrev[which]) {
        const lag = (a, b) => { let d = a - b; if (d > 180) d -= 360; if (d < -180) d += 360; d *= 0.1 / Math.max(dt, 0.05); return Math.max(-45, Math.min(45, d)); };
        const dy = lag(gunPrev[which].yaw, last.YAW);
        gr += 0.1 * dy; gy += 0.2 * dy; gp += 0.2 * lag(gunPrev[which].pitch, last.PITCH);
      }
      gunPrev[which] = { yaw: last.YAW, pitch: last.PITCH };
      // the gun: RF_MINLIGHT, lit from the eye (CL_AddViewWeapon)
      const light = lightPoint(bsp, last.PX, last.PY, last.VIEW_Z);
      r.zb.fill(0, 0, r.w * r.h);
      // its frame with the one it stepped from and the blend (CL_AddViewWeapon's backlerp): the demo's as the server sent them
      const [gframe, gold, gbl] = last.GUNFRAME != null ? [last.GUNFRAME, last.GUN_OLDFRAME ?? last.GUNFRAME, last.GUN_BACKLERP ?? 0] : viewFrameLerp(vm.mdl, last, time);
      r.drawAlias(vm.mdl, gframe, 0, [last.PX, last.PY, last.VIEW_Z], [-(last.PITCH + gp), last.YAW + gy, (last.ROLL ?? 0) + gr], light,
        { near: 1, time, minlight: true, dlight: dlightAt(r.dlights, last.PX, last.PY, last.VIEW_Z), mirror: last.HAND === 1, oldFrame: gold, backlerp: gbl });
    }
  }
  // ... warped (D_WarpScreen) onto the screen; the status bar is drawn over that
  if (underwater) r.warpScreen(time);

  // 2D: the status bar (with the help icon blinking while there is news on the help computer; at the
  // intermission too, as SCR_DrawStats drew it over the frozen view with no layout in single player), and this
  // player's help computer or inventory when it is up
  last.HELP_ICON = (last.HELP_CHANGED ?? 0) > helpSeen[which] && Math.floor(time * 10) & 8;
  last.FOV = viewFov();
  last.CROSSHAIR = settings.crosshair;
  hud.draw(r, last, time);
  // the deathmatch score board: asked for (F1, Back), and at the intermission for everyone (MoveClientToIntermission)
  if (showScores[which] || (last.DEATHMATCH && last.INTERMISSION)) hud.drawScores(r, scoreRows(), last.CLIENT, time);
  else if (showHelp[which]) hud.drawHelp(r, last);
  else if (showInv[which] && !last.DEAD) hud.drawInventory(r, invItems[which], last.INV_SEL, performance.now() / 1000);
  if (last.CPRINT) hud.drawCenter(r, last.CPRINT, Math.floor(r.h * 0.3));
  // Con_DrawNotify for the first view: the last prints at the top, a line each, three seconds; another view its one line
  if (which === 0) { noteMessage(last); notify.lines(last.TIME_).forEach((s, i) => r.drawString(hud.conchars, s, 8, 8 + i * 8)); }
  else if (last.MSG) r.drawString(hud.conchars, last.MSG, 8, 8);
  if (last.DEAD) hud.drawCenter(r, session.twoPlayers || net ? 'You died\n\npress fire or jump' : 'You died\n\npress fire', Math.min(60, r.h >> 2));
  // the palette blend: damage, bonus, powerups, water (a demo's row carries the server's ps.blend as it was)
  let tint = null;
  const since = time - last.DMG_TIME;
  if (last.BLEND) tint = last.BLEND[3] > 0 ? [last.BLEND[0] * 255, last.BLEND[1] * 255, last.BLEND[2] * 255, last.BLEND[3]] : null;
  else if (since >= 0 && since < 0.5 && (last.DMG_TAKE || last.DMG_SAVE)) {
    const a = Math.min(0.6, (last.DMG_TAKE * 0.03 + last.DMG_SAVE * 0.01) * (1 - since / 0.5) + 0.1);
    tint = [255, 0, 0, a];
  } else if (time - last.BONUS_TIME >= 0 && time - last.BONUS_TIME < 0.4) tint = [215, 186, 69, 0.25 * (1 - (time - last.BONUS_TIME) / 0.4)];
  else if (last.QUAD) tint = [0, 0, 255, 0.2];
  else if (last.INVINCIBLE) tint = [255, 255, 0, 0.3];
  else if (last.ENVIRO) tint = [0, 255, 0, 0.2];
  else if (last.WATERLEVEL >= 3) tint = last.WATERTYPE & 8 ? [255, 80, 0, 0.6] : last.WATERTYPE & 16 ? [0, 25, 5, 0.6] : [0, 40, 100, 0.4];
  r.present(tint, null, which);
}
const gunPrev = perPlayer(null);     // each view's angles of the last frame (the gun's lag)

let fpsT = performance.now(), fpsN = 0, fps = 0;
function updateStats() {
  fpsN++;
  const now = performance.now();
  if (now - fpsT > 500) { fps = (fpsN * 1000) / (now - fpsT); fpsT = now; fpsN = 0; }
  const sum = (k) => net.guests.reduce((n, g) => n + g.host[k], 0);
  const link = netGuest() ? ` · joined: ${net.guest.frames} frames from the host`
    : netHost() ? ` · hosting: ${sum('sentFrames')} frames sent${net.guests.length > 1 ? ` to ${net.guests.length} guests` : ''}${sum('droppedFrames') ? `, ${sum('droppedFrames')} dropped` : ''}`
    : demo ? ` · demo ${demo.name}: frame ${demo.player.played + 1} of ${demo.frames}` : '';
  const rec = recorder ? ` · recording ${recorder.name}: ${recorder.rec.frames} frames (${(recorder.rec.size / 1024).toFixed(0)} KB)` : '';
  statsEl.textContent = `${fps.toFixed(1)} fps · q2_tic ${perf.tic.toFixed(0)} ms · frame queries ${perf.faces.toFixed(0)} ms (${perf.rows} rows) · raster ${perf.draw.toFixed(0)} ms · ${renderer.particles.length} particles${link}${rec}`;
}

// ── a game over the network (src/net.js): this page hosts one, or joins one ───────────────────────
// The offer and the answer are texts the players pass each other (Pages is static: there is no signalling
// server); the texts are the session descriptions with their candidates, gzipped and base64'd. With a relay of
// the player's own set (rtc_signal at the console: scripts/signal.mjs), the host publishes its offer there and
// shows a four-letter code, the guest types the code, and the answer goes back the same way.
const netEl = { panel: $('net'), help: $('net-help'), text: $('net-text'), go: $('net-go'), state: $('net-state') };
let netStage = null;   // 'offer' (hosting: the guest's answer goes in the box), 'code' (hosting through the relay), 'join' (the host's offer or code does)
const signalRelay = () => (settings.rtcSignal ? new SignalClient(settings.rtcSignal) : null);
function netState(msg, error = false) {
  netEl.state.textContent = msg;
  netEl.state.classList.toggle('error', error);
}
function netPanel(help, text, go) {
  netEl.panel.hidden = false;
  netEl.help.textContent = help;
  netEl.text.value = text;
  netEl.go.textContent = go;
  netEl.go.hidden = !go;
  netEl.panel.scrollIntoView?.({ block: 'nearest' });   // (from the menu, the view is at the top and the panel below the controls)
  if (text) { netEl.text.focus(); netEl.text.select(); }
}
/**
 * Host: the offer is made, shown to be copied; the guest's answer comes back into the box. Hosting already, with
 * a guest or two connected, Host makes an offer for the next one (up to three guests: four clients), the game
 * going on; an offer not yet answered is replaced.
 */
async function hostGame() {
  if (!res) return;
  if (net?.role !== 'host') leaveNet();
  if (net && net.guests.length >= MAX_GUESTS) { netState(`hosting: ${MAX_GUESTS} guests is the most`, true); return; }
  try {
    netState('making the offer…');
    net?.offer?.peer.close();
    const peer = new Peer({ iceServers: iceServers(settings.rtcIce) });
    if (net) net.offer = { peer }; else net = { role: 'host', guests: [], offer: { peer } };
    const offer = await peer.offer();
    if (net?.offer?.peer !== peer) return;
    const relay = signalRelay();
    if (relay) {
      // through the relay: the offer under a code the host tells the other player; the answer comes back by itself
      netState('publishing the offer at the relay…');
      const code = await relay.publish(offer);
      if (net?.offer?.peer !== peer) { relay.drop(code); return; }
      net.offer.code = code;
      netStage = 'code';
      netPanel(`Tell the ${net.guests.length ? 'next' : 'other'} player the code ${code} (they type it after Join); the game starts when their answer comes.`, code, null);
      netState(`code ${code}: waiting for the answer${net.guests.length ? ` (${guestsState()})` : ''}`);
      const answer = await relay.waitAnswer(code, { stopped: () => net?.offer?.peer !== peer });
      if (net?.offer?.peer !== peer) return;
      relay.drop(code);
      if (!answer) throw new Error(`no answer came for the code ${code}: Host again`);
      await hostAccept(peer, answer);
      return;
    }
    netStage = 'offer';
    netPanel(`Send this offer to the ${net.guests.length ? 'next' : 'other'} player (copy it), then paste their answer here and press Connect.`, offer, 'Connect');
    netState(`offer made: waiting for the answer${net.guests.length ? ` (${guestsState()})` : ''}`);
  } catch (err) { console.error(err); netState(err.message, true); if (net?.role === 'host' && !net.guests.length) leaveNet(); else if (net) { net.offer?.peer.close(); net.offer = null; } }
}
/** Host: the guest's answer accepted; the guest's client put into a new game, or into the game running. */
async function hostAccept(peer, text) {
  netState('connecting…');
  await peer.accept(text);
  const link = await peer.ready;
  if (net?.offer?.peer !== peer) return;
  net.offer = null;
  netStage = null;
  const g = { client: freeClient(), peer, host: new HostLink(link) };
  net.guests.push(g);
  paused = false;   // (a shared game does not pause)
  g.host.onClose = () => guestLeft(g);
  // the guest's name and hand are its client's (ClientUserinfoChanged), now and with every map
  g.host.onInfo = (info) => { if (net?.guests.includes(g)) session.setUserinfo(g.client, info).catch((err) => console.warn('userinfo:', err.message)); };
  g.host.onSay = (text) => { if (net?.guests.includes(g) && map && !demo) session.say(g.client, text).catch((err) => console.warn('say:', err.message)); };
  netEl.panel.hidden = true;
  canvas.scrollIntoView?.({ block: 'start' });   // (the page scrolled to the texts; the game is up here)
  netState(`hosting: ${guestsState()}`);
  // the first guest: a new game with two clients, the guest getting the map from mapLoaded; another, into the
  // game running (ClientBegin: its client put in at the level's spot), with the map as it is
  if (net.guests.length === 1 || !map || !session.twoPlayers) await startMap(session.firstMap(), true);
  else {
    await session.addClient(g.client);
    if (g.host.open) g.host.sendMap(mapMessage());
  }
}
const guestsState = () => `${net.guests.length} guest${net.guests.length === 1 ? '' : 's'} connected`;
/** A guest's client number: the lowest of 2 to 4 no guest drives (a guest that left leaves its client to the next). */
const freeClient = () => { for (let c = 2; c <= MAX_PLAYERS; c++) if (!net.guests.some((g) => g.client === c)) return c; return null; };
/** A guest leaves: its client stands (the next guest, or a pad, drives it); the last one gone, the page plays alone. */
function guestLeft(g) {
  if (net?.role !== 'host' || !net.guests.includes(g)) return;
  net.guests.splice(net.guests.indexOf(g), 1);
  g.host.close(); g.peer.close();
  delete session.userinfo[g.client];   // (the guest's name and hand leave with it)
  if (net.guests.length || net.offer) netState(`a guest left: ${guestsState()}`);
  else { netState('the guest left'); net = null; netStage = null; netEl.panel.hidden = true; }
}
/** Guest: the host's offer goes in the box; the answer is made, shown to be copied back. */
function joinGame() {
  if (!res) return;
  leaveNet();
  netStage = 'join';
  netPanel(signalRelay() ? 'Type the code the host gave you (or paste an offer) and press Answer.' : 'Paste the host\'s offer here and press Answer; send the answer back to the host.', '', 'Answer');
  netState(signalRelay() ? 'waiting for the host\'s code' : 'waiting for the host\'s offer');
  netEl.text.focus();
}
/** The box's text is used: the answer accepted by a host, the offer (or the code at the relay) answered by a guest. */
async function netGo() {
  const text = netEl.text.value;
  try {
    if (netStage === 'offer' && net?.role === 'host' && net.offer) {
      await hostAccept(net.offer.peer, text);
    } else if (netStage === 'join') {
      const relay = signalRelay();
      const code = isRoomCode(text) ? text.trim().toUpperCase() : null;
      if (code && !relay) { netState('a code needs the relay: rtc_signal <url> at the console', true); return; }
      let offerText = text;
      if (code) { netState(`fetching the offer for ${code}…`); offerText = await relay.offer(code); }
      if (netStage !== 'join') return;
      netState('answering…');
      const peer = new Peer({ iceServers: iceServers(settings.rtcIce) });
      net = { role: 'guest', peer, guest: null };
      const answer = await peer.answer(offerText);
      if (net?.peer !== peer) return;
      if (code) {
        await relay.answer(code, answer);
        if (net?.peer !== peer) return;
        netPanel('The answer went to the host through the relay. The game starts when the host connects.', '', null);
      } else netPanel('Send this answer back to the host. The game starts when the host connects.', answer, null);
      netState('answered: waiting for the host');
      const link = await peer.ready;
      if (net?.peer !== peer) return;
      running = false;   // this page's own game stands; the host's frames are what is painted
      audio.stopLoops();
      net.guest = new GuestLink(link);
      applyUserinfo();   // (the userinfo goes with the connect, as the client's did)
      net.guest.onMap = (m) => guestMap(m).catch((err) => { console.error(err); setStatus(err.message, true); });
      net.guest.onPic = (file) => { if (pak.has(file)) { running = false; const p = loadPcx(pak.get(file)); renderer.drawPicFull(p); renderer.present(null, p.palette); } };
      net.guest.onCin = (file) => { if (pak.has(file) && !cinematic) playCinematic(file).catch((err) => console.error(err)); };
      net.guest.onClose = () => { if (netGuest()) { net = null; running = false; netState('the host left'); setStatus('The host left. Press a key or click the view for a game of your own.'); anyKey = () => { setStatus(''); endGame(); }; } };
      netEl.panel.hidden = true;
      canvas.scrollIntoView?.({ block: 'start' });
      netState('joined: waiting for the map');
      setStatus('Connected: waiting for the host\'s map…');
    }
  } catch (err) { console.error(err); netState(err.message, true); }
}
/** The guest's page takes the host's map: its geometry for the painter, the sky, the music, the view. */
async function guestMap(m) {
  if (!netGuest()) return;
  if (cinematic) cinematic.finish();   // (the host's next map ends the guest's cinematic, however far it got)
  beginMap();
  if (!pak.has(`maps/${m.name}.bsp`)) { setStatus(`${m.name} is not in this pak`, true); return; }
  if (m.nmodels !== res.byName.size) console.warn(`[firebird-quake2] the host's pak has ${m.nmodels} models, this one ${res.byName.size}: the models may not match`);
  setStatus(`Loading ${m.name} for the host's game…`);
  const { bsp } = loadMapModels(pak, res, m.name, { faceVerts: false });
  map = { name: m.name, bsp };
  // the prediction's clip data for this map, and which brush model each face belongs to (the frame names the faces)
  const modelOfFace = new Int32Array(bsp.faces.length).fill(-1);
  bsp.models.forEach((bm, mi) => { for (let f = bm.firstFace; f < bm.firstFace + bm.numFaces; f++) modelOfFace[f] = mi; });
  guestPred = { cm: new ClipMap(bsp), seq: guestPred?.seq ?? 0, cmds: [], st: null, world: null, gravity: Number(m.gravity) || 800, modelOfFace, error: null };
  await applyView();
  renderer.setResources(res);
  renderer.particles = [];
  tempEnts.clear();
  renderer.setSky(m.sky);
  renderer.skyRotate = m.skyRotate;
  renderer.skyAxis = m.skyAxis;
  audio.setSpeakers(m.speakers);
  audio.stopLoops();
  audio.playMusic(m.cdTrack);
  $('mapname').textContent = `${m.name} (joined)`;
  setStatus('');
  lastTic = performance.now();
  running = true;
}
/** The connection is dropped, whichever side this page was; a game of its own goes on or starts. */
function leaveNet() {
  const was = net;
  net = null;
  netStage = null;
  guestPred = null;
  netEl.panel.hidden = true;
  if (!was) return;
  for (const g of was.guests ?? []) { g.host.close(); g.peer.close(); delete session.userinfo[g.client]; }   // (the guests' names and hands leave with them)
  was.offer?.peer.close();
  was.guest?.close();
  was.peer?.close();
  netState('');
  if (was.guest) { running = false; map = session.map; }
}
$('net-host').addEventListener('click', () => hostGame());
$('net-join').addEventListener('click', () => joinGame());
$('net-leave').addEventListener('click', () => { const guest = netGuest(); leaveNet(); if (guest) endGame(); });
netEl.go.addEventListener('click', () => netGo());
$('net-copy').addEventListener('click', () => { netEl.text.select(); navigator.clipboard?.writeText(netEl.text.value).catch(() => {}); });
$('net-spectate').addEventListener('change', () => applyUserinfo());   // (a joined page: the host puts its client in as a watcher, or a player again)

// ── SQL console ─────────────────────────────────────────────────────────
async function runConsole() {
  const sqlText = $('sql').value.trim();
  if (!sqlText || !db) return;
  const out = $('sql-out');
  const t0 = performance.now();
  try {
    const r = /^\s*(select|with|execute\s+block)/i.test(sqlText)
      ? await db.query(sqlText, [], { rowMode: 'object' })
      : { rows: [], exec: await db.exec(sqlText) };
    const ms = (performance.now() - t0).toFixed(1);
    if (!r.rows.length) { out.textContent = `OK (${ms} ms)`; return; }
    const cols = Object.keys(r.rows[0]);
    const lines = [cols.join('\t'), ...r.rows.slice(0, 200).map((row) => cols.map((c) => fmt(row[c])).join('\t'))];
    out.textContent = `${r.rows.length} row(s), ${ms} ms\n${lines.join('\n')}`;
  } catch (err) {
    out.textContent = err.message;
  }
}
const fmt = (v) => (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : String(v));
$('run-sql').addEventListener('click', runConsole);
$('sql').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runConsole(); });
for (const b of document.querySelectorAll('[data-sql]')) b.addEventListener('click', () => { $('sql').value = b.dataset.sql; runConsole(); });

// ── boot ────────────────────────────────────────────────────────────────
async function openDatabase() {
  // No cross-origin isolation needed: without it (GitHub Pages sends no
  // COOP/COEP) the Worker loads firebird-wasm's build without threads; a page
  // served with the headers gets the threaded build. See scripts/build.mjs.
  setStatus('Starting Firebird 6 (WebAssembly)…');
  const instance = new FirebirdBrowser('memory://quake2', {
    // ?v= the build's id (scripts/build.mjs): a new deploy's Worker, never a cached one.
    // eslint-disable-next-line no-undef
    worker: new Worker(new URL(`./firebird-engine-worker.js?v=${typeof __BUILD__ === 'string' ? __BUILD__ : ''}`, import.meta.url)),
    multiTab: 'allow-unsafe',
    autoPersist: false,
  });
  const v = await instance.query("SELECT rdb$get_context('SYSTEM', 'ENGINE_VERSION') AS v FROM rdb$database");
  $('engine').textContent = `Firebird ${v.rows[0].V}${window.crossOriginIsolated ? ', threads' : ''}`;
  setStatus('Creating the Quake 2 schema (PSQL)…');
  await createSchema(instance, { schema: schemaSql, physics: physicsSql, game: gameSql, weapons: weaponsSql, monsters: monstersSql, render: renderSql });
  return instance;
}

async function usePak(buffer, label) {
  running = false;
  pak = new Pak(buffer);
  const maps = pak.mapNames();
  if (!maps.length) throw new Error(`${label} has no maps`);
  setStatus(`Copying ${label} models into Firebird…`);
  res = await loadResources(db, pak, { width: viewWidth(), height: viewHeight(), fov: settings.fov });
  session.use(pak, res);
  const cm = loadColormap(pak);
  renderer = new Renderer(canvas, { palette: cm.palette, colormap: cm.colormap, alphamap: cm.alphamap, pak });
  renderer.setSize(viewWidth(), viewHeight());
  renderer.lightScale = settings.brightness;
  hud = new Hud(pak);
  audio.setPak(pak);
  $('map').innerHTML = maps.map((m) => `<option>${m}</option>`).join('');
  const demos = pakDemos();
  $('demo').innerHTML = ['<option value="">—</option>', ...demos.map((m) => `<option>${m}</option>`)].join('');
  // the recordings kept from earlier loads (src/demostore.js), listed after the pak's; their bytes come when one plays
  kept.clear();
  for (const name of await demoStore.list().catch((err) => { console.warn('demostore:', err.message); return []; })) {
    if (recordings.has(name) || pak.has(`demos/${name}.dm2`)) { kept.add(name); continue; }
    kept.add(name);
    $('demo').append(new Option(`${name} (recorded)`, name));
  }
  for (const name of recordings.keys()) if (!demos.includes(name)) $('demo').append(new Option(`${name} (recorded)`, name));
  $('demo').parentElement.hidden = false;
  $('pakname').textContent = label;
  // the attract loop: the pak's demo with the main menu over it, as Quake 2 opened (a new game from the menu, the
  // Map select or the console starts playing); the Map select shows the game's first map meanwhile
  const first = maps.includes(settings.map) ? settings.map : maps.includes('demo1') ? 'demo1' : maps.includes('base1') ? 'base1' : maps[0];
  if (!demos.length) await startMap(first, true);
  else { await attract(); $('map').value = first; }
}

async function boot() {
  try {
    db = await openDatabase();
    session = new Session(db, storage);
    applyUserinfo();   // the player setup's name and hand: this client's userinfo for every game the session starts
    window.quake2 = { db, session, audio, menu, input, settings, notify, get renderer() { return renderer; }, get net() { return net; }, get running() { return running; }, get paused() { return paused; },
      get demo() { return demo ? { name: demo.name, time: demo.time, frame: demo.player.played, frames: demo.frames, timedemo: demo.timedemo ? { ...demo.timedemo } : null } : null; }, get paints() { return paints; },
      get lastTimedemo() { return lastTimedemo; },
      get recorder() { return recorder ? { name: recorder.name, frames: recorder.rec.frames, size: recorder.rec.size, dropped: recorder.rec.dropped } : null; },
      recordings: (name) => (name ? recordings.get(name) ?? null : [...new Set([...recordings.keys(), ...kept])].sort()),
      demoStore, fileStore, get pickedPak() { return pickedPak; },
      get cinematic() { return cinematic ? { file: cinematic.file, frame: cinematic.frame, fps: CIN_FPS } : null; },
      // (the browser test's: a cinematic from bytes it made, the game going on after as it was)
      cinematicFrom: async (bytes, name = 'test') => { const was = running; await playCinematicFrom(Uint8Array.from(bytes), name); running = was; lastTic = performance.now(); },
      get prediction() { const p = guestPred; return p ? { seq: p.seq, pending: p.cmds.length, x: p.st?.x ?? null, y: p.st?.y ?? null, z: p.st?.z ?? null, error: p.error ? Math.hypot(p.error.dx, p.error.dy, p.error.dz) : 0, boxes: p.world?.boxes.length ?? 0 } : null; },
      sql: (q, p) => db.query(q, p).then((r) => r.rows) };
    const forCache = (await useKeptPak()) ? null : await downloadPak();
    nextFrame();
    offlineReady(forCache).catch((err) => console.warn('offline cache:', err.message));
  } catch (err) {
    console.error(err);
    setStatus(err.message, true);
  }
}

/** The demo's pak from the site (or the data cache): loaded; the response's clone, for the data cache. */
async function downloadPak() {
  setStatus('Downloading pak0.pak (the Quake 2 demo, 50 MB)…');
  const resp = await fetch(new URL('./pak/pak0.pak', location.href));
  if (!resp.ok) throw new Error(`could not fetch pak0.pak (${resp.status}); pick a PAK file instead`);
  const forCache = resp.clone();   // (the download goes into the data cache too, for the loads without a network)
  await usePak(await resp.arrayBuffer(), 'pak0.pak');
  return forCache;
}

/** The pak picked at an earlier load, kept in the file store: loaded if there is one (true). One that fails to load is forgotten. */
async function useKeptPak() {
  const f = await fileStore.get('pak').catch((err) => { console.warn('the kept pak:', err.message); return null; });
  if (!f) return false;
  setStatus(`Loading ${f.name}, the pak picked before…`);
  try {
    await usePak(f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength), f.name);
  } catch (err) {
    console.warn(`the kept pak ${f.name} does not load (${err.message}); forgotten`);
    await fileStore.remove('pak').catch(() => undefined);
    return false;
  }
  showPickedPak(f.name);
  return true;
}

/** The PAK controls say a picked pak is in use (the button to forget it shows), or the demo's. */
function showPickedPak(name) {
  pickedPak = name;
  $('pak-forget').hidden = !name;
}

/** Forget the picked pak: dropped from the store, and the demo's pak loads now. */
async function forgetPak() {
  await fileStore.remove('pak').catch((err) => console.warn('the kept pak:', err.message));
  showPickedPak(null);
  await downloadPak();
}

// ── installable and offline: the service worker (public/sw.js) and the caches it serves from ─────────────
/**
 * Once the game is up, everything this load used goes into the caches the service worker serves from: the build's
 * files (the page, its script and stylesheet, the engine Worker, the glue and the .wasm of the engine build this
 * page runs, each by the URL it was asked for, with its ?v=) into this build's cache, from the browser's cache
 * where they just came from, and the pak as it was downloaded into the data cache, which outlives the builds. The
 * next load, with or without a network, comes from there, and the manifest lets the page install as an app. A
 * browser without service workers or the Cache API (an insecure origin, a file: URL) plays as before.
 */
async function offlineReady(pakResponse) {
  if (!('serviceWorker' in navigator) || !('caches' in window)) return;
  const v = typeof __BUILD__ === 'string' ? __BUILD__ : '';   // eslint-disable-line no-undef
  await navigator.serviceWorker.register(new URL('./sw.js', location.href));
  const engine = window.crossOriginIsolated ? 'firebird-embedded' : 'firebird-embedded-st';
  const files = ['./', `./main.js?v=${v}`, `./style.css?v=${v}`, `./firebird-engine-worker.js?v=${v}`, `./${engine}.js?v=${v}`, `./${engine}.wasm?v=${v}`,
    './manifest.webmanifest', './icon-192.png', './icon-512.png'];
  const build = await caches.open(`fbq2-build-${v}`);
  await build.addAll(files.map((f) => new URL(f, location.href).href));
  if (pakResponse) await (await caches.open('fbq2-data')).put(pakResponse.url, pakResponse);
  $('offline').hidden = false;
}

$('pakfile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';   // (the same file again is a change again)
  if (!f || !db) return;
  try {
    const buffer = await f.arrayBuffer();
    await usePak(buffer, f.name);
    // kept for the next start (src/demostore.js); a browser without the store plays it for the page
    showPickedPak(f.name);
    fileStore.put('pak', { name: f.name, bytes: new Uint8Array(buffer) }).catch((err) => console.warn('the pak is not kept:', err.message));
  } catch (err) { setStatus(err.message, true); }
});
$('pak-forget').addEventListener('click', () => forgetPak().catch((err) => setStatus(err.message, true)));
$('map').addEventListener('change', (e) => { settings.map = e.target.value; saveSettings(); startMap(e.target.value, true).catch((err) => setStatus(err.message, true)); });
$('save-download').addEventListener('click', () => downloadSave());
// the Config control: writeconfig's config.cfg downloaded, and a cfg file run line by line through the console (exec)
$('cfg-download').addEventListener('click', () => con.submit('writeconfig'));
$('cfg-file').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';   // (the same file again is a change again)
  if (!f) return;
  try {
    const n = await con.execText(await f.text());
    setStatus(`${f.name}: ${n} line${n === 1 ? '' : 's'} run`);
    setTimeout(() => { if (statusEl.textContent.startsWith(`${f.name}:`)) setStatus(''); }, 2500);
  } catch (err) { console.error(err); setStatus(`${f.name}: ${err.message}`, true); }
});
$('save-file').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';   // (the same file again is a change again)
  try { await loadSaveFile(f); } catch (err) { console.error(err); setStatus(`Load failed: ${err.message}`, true); }
});
$('demo').addEventListener('change', (e) => { if (e.target.value) playDemo(e.target.value).catch((err) => setStatus(err.message, true)); else if (demo) stopDemo(); });
$('demo-file').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';   // (the same file again is a change again)
  if (!res) return;
  try { await openDemoFile(f); } catch (err) { console.error(err); setStatus(`${f?.name ?? 'the file'} is not a demo: ${err.message}`, true); }
});
$('detail').value = settings.detail;
$('detail').addEventListener('change', async (e) => {
  settings.detail = e.target.value; saveSettings();
  await applyView();
});
// the players: one, two to four in coop, or two to four in deathmatch; a change starts a new game with that many (the
// game cannot gain one midway). The select's values, in the game menu's spin's order.
const PLAYER_CHOICES = ['1', '2', '3', '4', 'dm', 'dm3', 'dm4'];
const playersValue = () => (settings.deathmatch ? (settings.players > 2 ? `dm${settings.players}` : 'dm') : settings.coop ? String(settings.players) : '1');
$('players').value = playersValue();
$('players').addEventListener('change', (e) => {
  const v = e.target.value;
  const coop = v !== '1', deathmatch = v.startsWith('dm'), players = coop ? Math.max(2, Math.min(4, Number(v.replace('dm', '')) || 2)) : settings.players;
  if (coop === settings.coop && deathmatch === settings.deathmatch && players === settings.players) return;
  settings.coop = coop; settings.deathmatch = deathmatch; settings.players = players; saveSettings();
  if (map) startMap(map.name, true).catch((err) => setStatus(err.message, true));
});
$('renderer').value = settings.renderer;
$('renderer').addEventListener('change', (e) => { settings.renderer = e.target.value; saveSettings(); });
$('brightness').value = String(settings.brightness);
$('run').value = settings.alwaysRun ? '1' : '0';
$('run').addEventListener('change', (e) => { settings.alwaysRun = e.target.value === '1'; saveSettings(); });
$('brightness').addEventListener('change', (e) => { settings.brightness = Number(e.target.value); saveSettings(); if (renderer) { renderer.lightScale = settings.brightness; renderer.surfCache.clear(); } });
$('skill').value = String(settings.skill);
$('skill').addEventListener('change', (e) => { settings.skill = Number(e.target.value); saveSettings(); });
$('sfxvol').value = settings.sfx;
$('sfxvol').addEventListener('input', () => { settings.sfx = Number($('sfxvol').value); saveSettings(); audio.unlock(); audio.setVolume(settings.sfx / 100); });
$('music').value = settings.musicMode;
$('music').addEventListener('change', (e) => { settings.musicMode = e.target.value; saveSettings(); audio.unlock(); audio.setMusicMode(settings.musicMode); });
$('musicvol').value = settings.music;
$('musicvol').addEventListener('input', () => { settings.music = Number($('musicvol').value); saveSettings(); audio.setMusicVolume(settings.music / 100); });
$('musicdir').addEventListener('change', (e) => { audio.unlock(); audio.setMusicFiles([...e.target.files]); });

boot();
