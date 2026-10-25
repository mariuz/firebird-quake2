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
import { HostLink, GuestLink, Peer } from './net.js';
import { Renderer, lightPoint, dlightAt, entityFrame } from './renderer.js';
import { Effects } from './effects.js';
import { Hud, viewFrame } from './hud.js';
import { Menu, saveComment } from './menu.js';
import { Session, SLOT_KEY, QUICK_KEY } from './session.js';
import { Q2Audio } from './audio.js';
import { WEAPONS } from './gamedata.js';
import { padMenuKeys, BUTTON } from './gamepad.js';
import { Input, GAME_KEYS } from './input.js';
import { Console } from './console.js';
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
let net = null;          // { role: 'host' | 'guest', peer, host | guest }
const netHost = () => net?.role === 'host' && !!net.host;      // (connected: before that the page plays alone)
const netGuest = () => net?.role === 'guest' && !!net.guest;
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
const input = new Input();
let anyKey = null;      // a picture screen waiting for a key or a click
// the help computer (F1, or the pad's Back) and the inventory screen (TAB, or the pad's Y), per view: the
// keys are the first player's, the pad is its player's (the second in coop)
let showHelp = [false, false];
let showInv = [false, false];
let invItems = [[], []];     // the inventory's rows: [itemlist index, count]
let helpSeen = [0, 0];       // the help_changed count each player has looked at
/** The help computer or the inventory toggled for player `p` (0 or 1), the other screen put away. */
function toggleScreen(p, which) {
  if (which === 'help') { showHelp[p] = !showHelp[p]; showInv[p] = false; const row = netGuest() ? last : (session?.clients[p] ?? last); if (row) helpSeen[p] = row.HELP_CHANGED ?? 0; }
  else { showInv[p] = !showInv[p]; showHelp[p] = false; }
}
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
  if (anyKey && !e.repeat) { e.preventDefault(); const go = anyKey; anyKey = null; go(); return; }
  if (menu.active) { e.preventDefault(); menu.key(e.code); return; }
  // default.cfg: F2 the save menu, F3 the load menu, F10 quit; Escape puts the help computer or the
  // inventory away (cmd putaway), else brings up the main menu
  if (e.code === 'F3') { e.preventDefault(); openMenu(() => menu.loadMenu()); return; }
  if (!running) return;
  if (e.code === 'F2') { e.preventDefault(); openMenu(() => menu.saveMenu()); return; }
  if (e.code === 'F10') { e.preventDefault(); openMenu(() => menu.quitMenu()); return; }
  if (e.code === 'Escape') { e.preventDefault(); escape(); return; }
  if (e.code === 'F1') { e.preventDefault(); toggleScreen(0, 'help'); }
  if (e.code === 'Tab') { e.preventDefault(); toggleScreen(0, 'inventory'); }         // inven
  if (e.code === 'Backquote') { e.preventDefault(); openConsole(); return; }
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  input.key(e.code);   // the movement keys, and the weapon, inventory and item keys as impulses
  if (e.code === 'KeyP' || e.code === 'Pause') paused = !paused;
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
  if (showHelp[0] || showInv[0]) { showHelp[0] = false; showInv[0] = false; return; }
  openMenu(() => menu.main());
}
// the browser takes Escape to free the mouse, so the page sees the pointer go instead
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) return;
  if (quietUnlock) { quietUnlock = false; return; }
  if (running && !menu.active && !anyKey && cmdline.hidden) escape();
});
const menu = new Menu({
  get hud() { return hud; },
  playing: () => running && !!map,
  newGame: (skill) => {
    settings.skill = skill; $('skill').value = String(skill); saveSettings();
    startMap(session.firstMap(), true).catch((err) => setStatus(err.message, true));
  },
  slots: () => session?.slots() ?? [],
  loadSlot: (i) => loadGame(SLOT_KEY(i)),
  saveSlot: (i) => saveGame(SLOT_KEY(i)),
  get: (k) => (k === 'fullscreen' ? !!document.fullscreenElement : settings[k]),
  set: (k, v) => setSetting(k, v),
  resetDefaults: () => { for (const [k, v] of Object.entries(OPTIONS_RESET)) setSetting(k, v); },
  resetVideo: () => { for (const [k, v] of Object.entries(VIDEO_RESET)) setSetting(k, v); },
  console: () => openConsole(),
  quit: () => quitGame(),
  sound: (name) => audio.playLocal(name),
});
/** A setting changed from a menu: through the page's own control where there is one, so both agree. */
function setSetting(k, v) {
  const control = { sfx: ['sfxvol', 'input'], musicMode: ['music', 'change'], alwaysRun: ['run', 'change'], renderer: ['renderer', 'change'],
    detail: ['detail', 'change'], brightness: ['brightness', 'change'], coop: ['players', 'change'] }[k];
  if (control) {
    const el = $(control[0]);
    el.value = k === 'alwaysRun' ? (v ? '1' : '0') : k === 'coop' ? (v ? '2' : '1') : String(v);
    el.dispatchEvent(new Event(control[1]));
  } else if (k === 'fullscreen') {
    if (v && !document.fullscreenElement) canvas.requestFullscreen?.().catch(() => {});
    else if (!v && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  } else { settings[k] = v; saveSettings(); }
}
/** Quit: the game stops; a key or a click starts a new one. */
function quitGame() {
  running = false;
  audio.setSpeakers([]);
  audio.stopLoops();
  setStatus('Quit. Press a key or click the view for a new game.');
  anyKey = () => { setStatus(''); endGame(); };
}

// ── the console: Quake's commands on a line (backquote opens it, Enter runs, Escape closes) ─────────
// src/console.js runs the commands and keeps the history; this is the input element around it
const cmdline = $('cmdline');
const con = new Console({
  get db() { return db; }, get pak() { return pak; }, settings, saveSettings, setStatus,
  startMap: (name) => startMap(name, true),
  setView: (fov) => applyView(fov),
  saveGame: () => saveGame(), loadGame: () => loadGame(),
  toggleInventory: () => toggleScreen(0, 'inventory'),
  isRunning: () => running,
});
function openConsole() {
  if (document.pointerLockElement) { quietUnlock = true; document.exitPointerLock?.(); }
  input.clear();
  cmdline.hidden = false;
  cmdline.value = '';
  con.reset();
  cmdline.focus();
}
function closeConsole() {
  cmdline.hidden = true;
  canvas.focus();
}
cmdline.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape' || e.code === 'Backquote') { e.preventDefault(); closeConsole(); return; }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); cmdline.value = con.historyStep(e.key === 'ArrowUp' ? -1 : 1); return; }
  if (e.key === 'Tab') { e.preventDefault(); const done = con.complete(cmdline.value); if (done) cmdline.value = done; return; }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const line = cmdline.value;
  closeConsole();
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
  if (!pak.has(`maps/${save.map}.bsp`)) { setStatus(`The saved game is on ${save.map}, which is not in this pak`, true); return; }
  running = false;
  try {
    beginMap();
    setStatus('Loading the saved game…');
    // the map's geometry and models afresh, then the saved rows, then the unit's other levels as the save left them
    await mapLoaded(await session.loadSave(save, { skill: settings.skill, faceVerts: settings.renderer === 'sql' }));
    setStatus('Game loaded');
    setTimeout(() => { if (statusEl.textContent === 'Game loaded') setStatus(''); }, 2000);
    lastTic = performance.now();
    running = true;
  } catch (err) { console.error(err); setStatus(`Load failed: ${err.message}`, true); }
}
input.attach(canvas, window, { locked: () => document.pointerLockElement === canvas, settings: () => settings });
canvas.addEventListener('pointerdown', () => { if (anyKey) { const go = anyKey; anyKey = null; go(); } });
canvas.addEventListener('click', () => {
  if (running && !menu.active && document.pointerLockElement !== canvas) canvas.requestPointerLock?.()?.catch?.(() => {});
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
 * single player) and, in coop, the second's (the pad alone, or over the network the guest's commands since
 * the last tic); the pad's Start is the page's Escape either way.
 */
function readInput(tics) {
  const localCoop = session.coop && !net;   // two players at this page: the pad is the second's
  const cmd = input.read(tics, settings, { pad: !localCoop });
  if (input.menuPressed) escape();
  // the pad's Y and Back: the inventory and the help computer of the player the pad drives
  const padPlayer = localCoop ? 1 : 0;
  if (input.padScreens.inventory) toggleScreen(padPlayer, 'inventory');
  if (input.padScreens.help) toggleScreen(padPlayer, 'help');
  return [cmd, netHost() ? net.host.takeCommand() : localCoop ? input.readPad(tics, settings) : null];
}

/**
 * The view's size for the SQL's frustum (viewcfg) and the painter: the whole screen for one player, the
 * screen split along the middle for two at this page (each view half as high; Quake's fov is horizontal, so
 * the same fov); a game over the network has one view a page, the guest's the size the host's frustum has.
 */
async function applyView(fov = settings.fov) {
  if (netGuest()) {
    const v = net.guest.map?.view;
    if (v && renderer) renderer.setSize(v.w, v.h, 1);
    return;
  }
  const views = session?.coop && !netHost() ? 2 : 1;
  await setView(db, viewWidth(), Math.floor(viewHeight() / views), fov);
  if (renderer) renderer.setSize(viewWidth(), viewHeight(), views);
}

// ── maps ─────────────────────────────────────────────────────────────────
/** Before a map loads: the menus, the help and inventory screens away. */
function beginMap() {
  running = false;
  menu.off();
  showHelp = [false, false];
  showInv = [false, false];
}
/** A map is in (session.startMap's setup): the renderer and the sound set up from it. */
async function mapLoaded(setup) {
  map = session.map;
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
  if (netHost()) net.host.sendMap({ name: map.name, sky: setup.sky, skyRotate: setup.skyRotate, skyAxis: setup.skyAxis, cdTrack: setup.cdTrack,
    speakers: setup.speakers, view: { w: viewWidth(), h: viewHeight(), fov: settings.fov }, nmodels: res.byName.size });
}
async function startMap(name, newGame, spawnpoint = null, autosave = true) {
  if (netGuest()) leaveNet();   // a game of this page's own: the joined one is left
  beginMap();
  if (newGame) helpSeen = [0, 0];
  setStatus(`Loading ${name} into Firebird…`);
  const t0 = performance.now();
  // the face vertices are only for the SQL-projecting renderer: left out of the load until it is on; a new
  // game has the players the setting says (one, or two in coop; two when a guest is connected), a level
  // change keeps the game's
  await mapLoaded(await session.startMap(name, { newGame, spawnpoint, skill: settings.skill, faceVerts: settings.renderer === 'sql', ...(newGame ? { coop: netHost() || settings.coop } : {}) }));
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

async function frame() {
  if (!running || paused || document.hidden || menu.active) {
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
    const tics = Math.max(1, Math.min(2, Math.round((now - lastTic) / TIC_MS)));   // at most two tics a frame: better slow motion than a stall
    lastTic += tics * TIC_MS;
    if (now - lastTic > 200) lastTic = now;

    if (netGuest()) { guestFrame(tics); nextFrame(); return; }

    let t = performance.now();
    const [cmd, cmd2] = readInput(tics);
    last = await session.tic(cmd, cmd2);
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
    const views = session.clients.length >= 2 && !netHost() ? 2 : 1;
    if (renderer.views !== views) renderer.setSize(viewWidth(), viewHeight(), views);
    const f = await session.frame({ sqlRenderer: settings.renderer === 'sql', client: 1 });
    const f2 = views === 2 ? await session.frame({ sqlRenderer: settings.renderer === 'sql', client: 2 }) : null;
    if (netHost() && session.clients.length >= 2) {
      const h = net.host;   // (the guest may leave during the query: the link is this frame's)
      const gf = await session.frame({ sqlRenderer: false, client: 2 });
      const inv = h.wantInv ? await session.inventory(2) : null;
      if (h.open) h.sendFrame(session.clients[1], gf, { sounds: f.sounds, fx: f.fx, dt: tics * 0.05, inv });
    }
    if (!running) { nextFrame(); return; }
    const { faces, ents, sounds, fx, loops } = f;
    if (f.speakers) audio.setSpeakersOn(f.speakers);
    perf.faces = performance.now() - t;
    perf.rows = faces.length + (f2?.faces.length ?? 0);
    const listener = { x: last.PX, y: last.PY, z: last.VIEW_Z, yaw: last.YAW };
    if (sounds.length) audio.playEvents(sounds, listener);
    audio.setLoops(loops);
    audio.update(listener);
    if (fx.length) tempEnts.add(fx, last.TIME_, renderer);

    t = performance.now();
    renderer.runParticles(tics * 0.05, last.TIME_);   // once a frame, whatever the views
    brushFrames = f.brushFrames; brushAngles = f.brushAngles;
    drawFrame(0, last, faces, ents, f.styles, last.TIME_, tics * 0.05);
    if (f2) {
      brushFrames = f2.brushFrames; brushAngles = f2.brushAngles;
      drawFrame(1, session.clients[1] ?? last, f2.faces, f2.ents, f2.styles, last.TIME_, tics * 0.05);
    }
    perf.draw = performance.now() - t;
    updateStats();
    // the frame's spare time marks the cluster the player is heading into (premark_ahead), so the
    // crossing is a switch of slot and not a hitch; a call that finds nothing to do costs ~0.3 ms
    if (perf.tic + perf.faces + perf.draw < 30) await session.premark();
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`, true);
    running = false;
    return;
  }
  nextFrame();
}

/**
 * A guest's frame: its command goes to the host, and the newest frame the host sent is painted as the
 * page paints its own (the sounds at this player's ear, the effects and particles run here).
 */
function guestFrame(tics) {
  const [cmd] = readInput(tics);
  if (!net?.guest?.open) return;
  net.guest.sendCommand(cmd, { inv: showInv[0] });
  const got = net.guest.take();
  if (!got || !map) return;
  const t = performance.now();
  last = got.row;
  const f = got.frame;
  if (f.speakers) audio.setSpeakersOn(f.speakers);
  const listener = { x: last.PX, y: last.PY, z: last.VIEW_Z, yaw: last.YAW };
  if (f.sounds.length) audio.playEvents(f.sounds, listener);
  audio.setLoops(f.loops);
  audio.update(listener);
  if (f.fx.length) tempEnts.add(f.fx, last.TIME_, renderer);
  if (showInv[0]) invItems[0] = got.inv;
  renderer.runParticles(got.dt, last.TIME_);
  brushFrames = f.brushFrames; brushAngles = f.brushAngles;
  drawFrame(0, last, f.faces, f.ents, f.styles, last.TIME_, got.dt);
  perf.tic = 0; perf.faces = 0; perf.rows = f.faces.length;
  perf.draw = performance.now() - t;
  updateStats();
}

const sprite = (name) => res.models.get(res.byName.get(name))?.spr;
const model = (name) => res.models.get(res.byName.get(name))?.mdl;

// ── leaving a level: what the server did with the map string (SV_Map; src/levels.js) ─────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function changeLevel(target) {
  // the unit's levels and its cross-level flags (session.leave); then a picture, the next map, or the end
  const c = await session.leave(target);
  if (c.kind === 'pic' && pak.has(`pics/${c.map}`)) {
    if (netHost()) net.host.sendPic(`pics/${c.map}`);
    await showPicture(`pics/${c.map}`);
    return c.then ? changeLevel(c.then) : endGame();
  }
  if (c.kind !== 'map') return c.then ? changeLevel(c.then) : endGame();   // cinematics and demos are not played
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

/** The game is over (the demo's last exit): a new game from the first map. */
async function endGame() {
  await startMap(session.firstMap(), true);
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
      r.drawAlias(m.mdl, frame, skin, [x, y, z], [pitch, yaw + spin, roll], light,
        { time, alpha: alpha === 1, dlight: dlightAt(r.dlights, x, y, z), glow: (e[13] & 4) !== 0 });
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
  const wp = WEAPONS[last.WEAPON];
  if (!last.DEAD && !last.INTERMISSION && wp) {
    const vm = res.models.get(res.byName.get(wp.view));
    if (vm) {
      // SV_CalcGunOffset: the gun sways with the walk cycle and lags behind turns of the view (the delta over a
      // tenth of a second, at most 45 degrees); it sits at the eye, which already carries the view's bob
      const bt = (last.BOBTIME ?? 0) * (last.DUCKED ? 4 : 1), bfs = Math.abs(Math.sin(bt * Math.PI)), xys = last.XYSPEED ?? 0;
      let gr = xys * bfs * 0.005, gy = xys * bfs * 0.01;
      if (Math.floor(bt) & 1) { gr = -gr; gy = -gy; }
      let gp = xys * bfs * 0.005;
      if (gunPrev[which]) {
        const lag = (a, b) => { let d = a - b; if (d > 180) d -= 360; if (d < -180) d += 360; d *= 0.1 / Math.max(dt, 0.05); return Math.max(-45, Math.min(45, d)); };
        const dy = lag(gunPrev[which].yaw, last.YAW);
        gr += 0.1 * dy; gy += 0.2 * dy; gp += 0.2 * lag(gunPrev[which].pitch, last.PITCH);
      }
      gunPrev[which] = { yaw: last.YAW, pitch: last.PITCH };
      // the gun: RF_MINLIGHT, lit from the eye (CL_AddViewWeapon)
      const light = lightPoint(bsp, last.PX, last.PY, last.VIEW_Z);
      r.zb.fill(0, 0, r.w * r.h);
      r.drawAlias(vm.mdl, viewFrame(vm.mdl, last, time), 0, [last.PX, last.PY, last.VIEW_Z], [-(last.PITCH + gp), last.YAW + gy, (last.ROLL ?? 0) + gr], light,
        { near: 1, time, minlight: true, dlight: dlightAt(r.dlights, last.PX, last.PY, last.VIEW_Z) });
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
  if (showHelp[which]) hud.drawHelp(r, last);
  else if (showInv[which] && !last.DEAD) hud.drawInventory(r, invItems[which], last.INV_SEL, performance.now() / 1000);
  if (last.CPRINT) hud.drawCenter(r, last.CPRINT, Math.floor(r.h * 0.3));
  if (last.MSG) r.drawString(hud.conchars, last.MSG, 8, 8);
  if (last.DEAD) hud.drawCenter(r, session.coop || net ? 'You died\n\npress fire or jump' : 'You died\n\npress fire', Math.min(60, r.h >> 2));
  // the palette blend: damage, bonus, powerups, water
  let tint = null;
  const since = time - last.DMG_TIME;
  if (since >= 0 && since < 0.5 && (last.DMG_TAKE || last.DMG_SAVE)) {
    const a = Math.min(0.6, (last.DMG_TAKE * 0.03 + last.DMG_SAVE * 0.01) * (1 - since / 0.5) + 0.1);
    tint = [255, 0, 0, a];
  } else if (time - last.BONUS_TIME >= 0 && time - last.BONUS_TIME < 0.4) tint = [215, 186, 69, 0.25 * (1 - (time - last.BONUS_TIME) / 0.4)];
  else if (last.QUAD) tint = [0, 0, 255, 0.2];
  else if (last.INVINCIBLE) tint = [255, 255, 0, 0.3];
  else if (last.ENVIRO) tint = [0, 255, 0, 0.2];
  else if (last.WATERLEVEL >= 3) tint = last.WATERTYPE & 8 ? [255, 80, 0, 0.6] : last.WATERTYPE & 16 ? [0, 25, 5, 0.6] : [0, 40, 100, 0.4];
  r.present(tint, null, which);
}
const gunPrev = [null, null];     // each view's angles of the last frame (the gun's lag)

let fpsT = performance.now(), fpsN = 0, fps = 0;
function updateStats() {
  fpsN++;
  const now = performance.now();
  if (now - fpsT > 500) { fps = (fpsN * 1000) / (now - fpsT); fpsT = now; fpsN = 0; }
  const link = netGuest() ? ` · joined: ${net.guest.frames} frames from the host` : netHost() ? ` · hosting: ${net.host.sentFrames} frames sent${net.host.droppedFrames ? `, ${net.host.droppedFrames} dropped` : ''}` : '';
  statsEl.textContent = `${fps.toFixed(1)} fps · q2_tic ${perf.tic.toFixed(0)} ms · frame queries ${perf.faces.toFixed(0)} ms (${perf.rows} rows) · raster ${perf.draw.toFixed(0)} ms · ${renderer.particles.length} particles${link}`;
}

// ── a game over the network (src/net.js): this page hosts one, or joins one ───────────────────────
// The offer and the answer are texts the players pass each other (Pages is static: there is no signalling
// server); the texts are the session descriptions with their candidates, gzipped and base64'd.
const netEl = { panel: $('net'), help: $('net-help'), text: $('net-text'), go: $('net-go'), state: $('net-state') };
let netStage = null;   // 'offer' (hosting: the guest's answer goes in the box), 'join' (the host's offer does)
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
  if (text) { netEl.text.focus(); netEl.text.select(); }
}
/** Host: the offer is made, shown to be copied; the guest's answer comes back into the box. */
async function hostGame() {
  if (!res) return;
  leaveNet();
  try {
    netState('making the offer…');
    const peer = new Peer();
    net = { role: 'host', peer, host: null };
    const offer = await peer.offer();
    if (net?.peer !== peer) return;
    netStage = 'offer';
    netPanel('Send this offer to the other player (copy it), then paste their answer here and press Connect.', offer, 'Connect');
    netState('offer made: waiting for the answer');
  } catch (err) { console.error(err); netState(err.message, true); leaveNet(); }
}
/** Guest: the host's offer goes in the box; the answer is made, shown to be copied back. */
function joinGame() {
  if (!res) return;
  leaveNet();
  netStage = 'join';
  netPanel('Paste the host\'s offer here and press Answer; send the answer back to the host.', '', 'Answer');
  netState('waiting for the host\'s offer');
  netEl.text.focus();
}
/** The box's text is used: the answer accepted by a host, the offer answered by a guest. */
async function netGo() {
  const text = netEl.text.value;
  try {
    if (netStage === 'offer' && net?.role === 'host' && net.peer) {
      netState('connecting…');
      await net.peer.accept(text);
      const peer = net.peer;
      const link = await peer.ready;
      if (net?.peer !== peer) return;
      net.host = new HostLink(link);
      net.host.onClose = () => { if (netHost()) { netState('the guest left'); net = null; netEl.panel.hidden = true; } };
      netEl.panel.hidden = true;
      canvas.scrollIntoView?.({ block: 'start' });   // (the page scrolled to the texts; the game is up here)
      netState('hosting: connected');
      // a new game with two clients; the guest gets the map from mapLoaded
      await startMap(session.firstMap(), true);
    } else if (netStage === 'join') {
      netState('answering…');
      const peer = new Peer();
      net = { role: 'guest', peer, guest: null };
      const answer = await peer.answer(text);
      if (net?.peer !== peer) return;
      netPanel('Send this answer back to the host. The game starts when the host connects.', answer, null);
      netState('answered: waiting for the host');
      const link = await peer.ready;
      if (net?.peer !== peer) return;
      running = false;   // this page's own game stands; the host's frames are what is painted
      audio.stopLoops();
      net.guest = new GuestLink(link);
      net.guest.onMap = (m) => guestMap(m).catch((err) => { console.error(err); setStatus(err.message, true); });
      net.guest.onPic = (file) => { if (pak.has(file)) { running = false; const p = loadPcx(pak.get(file)); renderer.drawPicFull(p); renderer.present(null, p.palette); } };
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
  beginMap();
  if (!pak.has(`maps/${m.name}.bsp`)) { setStatus(`${m.name} is not in this pak`, true); return; }
  if (m.nmodels !== res.byName.size) console.warn(`[firebird-quake2] the host's pak has ${m.nmodels} models, this one ${res.byName.size}: the models may not match`);
  setStatus(`Loading ${m.name} for the host's game…`);
  const { bsp } = loadMapModels(pak, res, m.name, { faceVerts: false });
  map = { name: m.name, bsp };
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
  netEl.panel.hidden = true;
  if (!was) return;
  was.host?.close();
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
  $('pakname').textContent = label;
  const first = maps.includes(settings.map) ? settings.map : maps.includes('demo1') ? 'demo1' : maps.includes('base1') ? 'base1' : maps[0];
  await startMap(first, true);
}

async function boot() {
  try {
    db = await openDatabase();
    session = new Session(db, storage);
    window.quake2 = { db, session, audio, menu, get renderer() { return renderer; }, get net() { return net; }, get running() { return running; }, get paused() { return paused; }, sql: (q, p) => db.query(q, p).then((r) => r.rows) };
    setStatus('Downloading pak0.pak (the Quake 2 demo, 50 MB)…');
    const resp = await fetch(new URL('./pak/pak0.pak', location.href));
    if (!resp.ok) throw new Error(`could not fetch pak0.pak (${resp.status}); pick a PAK file instead`);
    await usePak(await resp.arrayBuffer(), 'pak0.pak');
    nextFrame();
  } catch (err) {
    console.error(err);
    setStatus(err.message, true);
  }
}

$('pakfile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f || !db) return;
  try { await usePak(await f.arrayBuffer(), f.name); } catch (err) { setStatus(err.message, true); }
});
$('map').addEventListener('change', (e) => { settings.map = e.target.value; saveSettings(); startMap(e.target.value, true).catch((err) => setStatus(err.message, true)); });
$('detail').value = settings.detail;
$('detail').addEventListener('change', async (e) => {
  settings.detail = e.target.value; saveSettings();
  await applyView();
});
// the players: one, or two in coop; a change starts a new game with that many (the game cannot gain one midway)
$('players').value = settings.coop ? '2' : '1';
$('players').addEventListener('change', (e) => {
  const coop = e.target.value === '2';
  if (coop === settings.coop) return;
  settings.coop = coop; saveSettings();
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
