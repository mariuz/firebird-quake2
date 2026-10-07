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
import { createSchema, loadResources, loadMap, setView } from './loader.js';
import { Renderer, lightPoint, dlightAt } from './renderer.js';
import { Hud, viewFrame } from './hud.js';
import { Menu, saveComment } from './menu.js';
import { exportSave, importSave } from './savegame.js';
import { parseChangeMap } from './levels.js';
import { Q2Audio } from './audio.js';
import { WEAPONS } from './gamedata.js';

const $ = (id) => document.getElementById(id);
const canvas = $('screen');
const statusEl = $('status');
const statsEl = $('stats');
const TIC_MS = 50;

let db, pak, res, renderer, hud;
let map = null;          // { name, bsp }
let last = null;         // last Q2_TIC row
let running = false;
let paused = false;
let lastTic = 0;
let lastSoundId = 0;
let lastFxId = 0;
let frameNo = 0;
let beams = [];          // [{ a, b, color, until }]
let explosions = [];     // [{ x, y, z, t0, spr }]
let flashes = [];        // muzzle flashes' lights: [{ x, y, z, r, die }] (each lasts the frame it is seen in)
let exLights = [];       // explosions' lights: [{ x, y, z, t0, light, frames, misc }]
const settings = { map: 'demo1', detail: 'high', sfx: 70, music: 50, musicMode: 'tracks', skill: 1, fov: 90, renderer: 'fast', brightness: 1.4, alwaysRun: true,
  sensitivity: 7, invertMouse: false, crosshair: 1 };
try { Object.assign(settings, JSON.parse(localStorage.getItem('firebird-quake2:settings') || '{}')); } catch { /* defaults */ }
const saveSettings = () => { try { localStorage.setItem('firebird-quake2:settings', JSON.stringify(settings)); } catch { /* ignore */ } };
const viewWidth = () => (settings.detail === 'high' ? 320 : 160);
const viewHeight = () => (settings.detail === 'high' ? 240 : 120);
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
const keys = new Set();
let mouseYaw = 0, mousePitch = 0;
let fireClick = false;
let impulse = 0;
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyE', 'KeyQ', 'KeyI', 'KeyB',
  'BracketLeft', 'BracketRight', 'Enter',
  'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'Tab', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7',
  'Digit8', 'Digit9', 'Digit0', 'KeyF', 'KeyG', 'KeyC', 'Comma', 'Period', 'PageUp', 'PageDown', 'Slash']);
let anyKey = null;      // a picture screen waiting for a key or a click
let showHelp = false;   // the help computer (F1)
let showInv = false;    // the inventory screen (TAB)
let invItems = [];      // its rows: [itemlist index, count]
let helpSeen = 0;       // the help_changed count the player has looked at
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
  if (e.code === 'F1') { e.preventDefault(); showHelp = !showHelp; showInv = false; if (last) helpSeen = last.HELP_CHANGED ?? 0; }
  if (e.code === 'Tab') { e.preventDefault(); showInv = !showInv; showHelp = false; }         // inven
  if (e.code === 'Backquote') { e.preventDefault(); openConsole(); return; }
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  keys.add(e.code);
  // default.cfg: 1-5 blaster to chaingun, 6 grenade launcher … 0 BFG10K, G "use grenades", / weapnext
  // (the impulses are the weapons in item order, hand grenades 6 between the chaingun and the launcher)
  if (e.code.startsWith('Digit')) impulse = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, Digit6: 7, Digit7: 8, Digit8: 9, Digit9: 10, Digit0: 11 }[e.code];
  if (e.code === 'KeyG') impulse = 6;
  if (e.code === 'Slash') impulse = 12;
  // the inventory (invuse, invnext, invprev) and default.cfg's item keys: q quad damage, i invulnerability,
  // b rebreather, e environment suit (s, the silencer, and p, the power shield, are the page's back and pause)
  const inv = { Enter: 13, BracketRight: 14, BracketLeft: 15, KeyQ: 16, KeyI: 17, KeyB: 19, KeyE: 20 }[e.code];
  if (inv) impulse = inv;
  if (e.code === 'KeyP' || e.code === 'Pause') paused = !paused;
  if (e.code === 'F6') { e.preventDefault(); saveGame(); }
  if (e.code === 'F9') { e.preventDefault(); loadGame(); }
});

// ── the menus (src/menu.js): up, the game is paused (M_PushMenu sets "paused" in single player) ──────
let quietUnlock = false;   // the page let the pointer go itself: no menu for that
function openMenu(push) {
  keys.clear();
  push();
  if (menu.active && document.pointerLockElement) { quietUnlock = true; document.exitPointerLock?.(); }
}
function escape() {
  if (showHelp || showInv) { showHelp = false; showInv = false; return; }
  openMenu(() => menu.main());
}
// the browser takes Escape to free the mouse, so the page sees the pointer go instead
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) return;
  if (quietUnlock) { quietUnlock = false; return; }
  if (running && !menu.active && !anyKey && cmdline.hidden) escape();
});
const SLOT_KEY = (i) => `firebird-quake2:save:save${i}`;
const menu = new Menu({
  get hud() { return hud; },
  playing: () => running && !!map,
  newGame: (skill) => {
    settings.skill = skill; $('skill').value = String(skill); saveSettings();
    startMap(pak.has('maps/demo1.bsp') ? 'demo1' : 'base1', true).catch((err) => setStatus(err.message, true));
  },
  slots: () => Array.from({ length: 15 }, (_, i) => {
    try {
      const s = JSON.parse(localStorage.getItem(SLOT_KEY(i)) ?? 'null');
      return s ? { valid: true, name: s.comment ?? s.map } : { valid: false };
    } catch { return { valid: false }; }
  }),
  loadSlot: (i) => loadGame(SLOT_KEY(i)),
  saveSlot: (i) => saveGame(SLOT_KEY(i)),
  get: (k) => (k === 'fullscreen' ? !!document.fullscreenElement : settings[k]),
  set: (k, v) => setSetting(k, v),
  resetDefaults: () => { for (const [k, v] of Object.entries({ sfx: 70, musicMode: 'tracks', sensitivity: 7, alwaysRun: true, invertMouse: false, crosshair: 1 })) setSetting(k, v); },
  resetVideo: () => { for (const [k, v] of Object.entries({ renderer: 'fast', detail: 'high', brightness: 1.4, fullscreen: false })) setSetting(k, v); },
  console: () => openConsole(),
  quit: () => quitGame(),
  sound: (name) => audio.playLocal(name),
});
/** A setting changed from a menu: through the page's own control where there is one, so both agree. */
function setSetting(k, v) {
  const control = { sfx: ['sfxvol', 'input'], musicMode: ['music', 'change'], alwaysRun: ['run', 'change'], renderer: ['renderer', 'change'],
    detail: ['detail', 'change'], brightness: ['brightness', 'change'] }[k];
  if (control) {
    const el = $(control[0]);
    el.value = k === 'alwaysRun' ? (v ? '1' : '0') : String(v);
    el.dispatchEvent(new Event(control[1]));
  } else if (k === 'fullscreen') {
    if (v && !document.fullscreenElement) canvas.requestFullscreen?.().catch(() => {});
    else if (!v && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  } else { settings[k] = v; saveSettings(); }
}
/** Quit: the game stops; a key or a click starts a new one. */
function quitGame() {
  running = false;
  audio.stopSpeakers?.();
  setStatus('Quit. Press a key or click the view for a new game.');
  anyKey = () => { setStatus(''); endGame(); };
}

// ── the console: Quake's commands on a line (backquote opens it, Enter runs, Escape closes) ─────────
const cmdline = $('cmdline');
function openConsole() {
  if (document.pointerLockElement) { quietUnlock = true; document.exitPointerLock?.(); }
  keys.clear();
  cmdline.hidden = false;
  cmdline.value = '';
  cmdline.focus();
}
function closeConsole() {
  cmdline.hidden = true;
  canvas.focus();
}
cmdline.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape' || e.code === 'Backquote') { e.preventDefault(); closeConsole(); return; }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const line = cmdline.value.trim();
  closeConsole();
  if (line) await runCommand(line);
});
async function runCommand(line) {
  const [cmd, ...rest] = line.split(/\s+/);
  const arg = rest.join(' ');
  switch (cmd.toLowerCase()) {
    case 'map': {
      const name = arg.toLowerCase();
      if (!pak.has(`maps/${name}.bsp`)) { setStatus(`no map "${name}" in this pak`, true); setTimeout(() => setStatus(''), 2500); return; }
      await startMap(name, true);
      return;
    }
    case 'inven': showInv = !showInv; showHelp = false; return;
    case 'save': return saveGame();
    case 'load': return loadGame();
    default:
      if (!running) return;
      try { await db.query('SELECT msg FROM player_command(?, ?)', [cmd, arg]); }
      catch (err) { console.error(err); setStatus(`${cmd}: ${err.message}`, true); }
  }
}

// ── saved games: the four game tables as JSON in localStorage (F6 saves, F9 loads) ─────────
const SAVE_KEY = 'firebird-quake2:save:quick';
/** The save's comment: the level's name (the worldspawn message) after "ENTERING " or the time. */
async function levelName() {
  const g = (await db.query('SELECT level_msg FROM game')).rows[0];
  return (g?.LEVEL_MSG ?? '').trim() || map.name;
}
async function writeSave(key, autosave) {
  const save = await exportSave(db, map.name);
  save.comment = saveComment(await levelName(), autosave);
  const json = JSON.stringify(save);
  localStorage.setItem(key, json);
  return json.length;
}
async function saveGame(key = SAVE_KEY) {
  if (!running || !map) return;
  if (last?.DEAD) { setStatus("Can't savegame while dead!", true); setTimeout(() => setStatus(''), 2000); return; }
  try {
    const size = await writeSave(key, false);
    setStatus(`Game saved (${map.name}, ${(size / 1024).toFixed(0)} KB)`);
    setTimeout(() => { if (statusEl.textContent.startsWith('Game saved')) setStatus(''); }, 2000);
  } catch (err) { console.error(err); setStatus(`Save failed: ${err.message}`, true); }
}
async function loadGame(key = SAVE_KEY) {
  let save;
  try { save = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { save = null; }
  if (!save) { setStatus('No saved game', true); setTimeout(() => setStatus(''), 2000); return; }
  if (!pak.has(`maps/${save.map}.bsp`)) { setStatus(`The saved game is on ${save.map}, which is not in this pak`, true); return; }
  running = false;
  try {
    await startMap(save.map, false, null, false);   // the map's geometry and models afresh, then the saved rows
    running = false;
    setStatus('Loading the saved game…');
    await importSave(db, save);
    await loadStyleBase();
    brushFrames.clear(); brushAngles.clear();
    const { rows } = await db.query('SELECT MAX(id) m FROM sound_events');
    lastSoundId = rows[0].M ?? 0; lastFxId = 0;
    setStatus('Game loaded');
    setTimeout(() => { if (statusEl.textContent === 'Game loaded') setStatus(''); }, 2000);
    lastTic = performance.now();
    running = true;
  } catch (err) { console.error(err); setStatus(`Load failed: ${err.message}`, true); }
}
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
canvas.addEventListener('pointerdown', () => { if (anyKey) { const go = anyKey; anyKey = null; go(); } });
canvas.addEventListener('click', () => {
  if (running && !menu.active && document.pointerLockElement !== canvas) canvas.requestPointerLock?.()?.catch?.(() => {});
});
canvas.addEventListener('mousedown', (e) => { if (document.pointerLockElement === canvas && e.button === 0) fireClick = true; });
window.addEventListener('mouseup', () => { fireClick = false; });
window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) {
    mouseYaw -= e.movementX * 0.022 * settings.sensitivity;
    mousePitch += e.movementY * 0.022 * settings.sensitivity * (settings.invertMouse ? -1 : 1);
  }
});
window.addEventListener('wheel', () => { if (document.pointerLockElement === canvas) impulse = 12; });
// touch: left half moves, right half looks, tap fires
const touch = { move: null, look: null };
canvas.addEventListener('touchstart', (e) => {
  const r = canvas.getBoundingClientRect();
  for (const t of e.changedTouches) {
    const rec = { id: t.identifier, x: t.clientX, y: t.clientY, dx: 0, dy: 0, t: performance.now() };
    if (t.clientX - r.left < r.width / 2) touch.move = rec; else touch.look = rec;
  }
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) for (const k of ['move', 'look']) {
    const rec = touch[k];
    if (rec && rec.id === t.identifier) {
      if (k === 'look') { mouseYaw -= (t.clientX - rec.x - rec.dx) * 0.4; mousePitch += (t.clientY - rec.y - rec.dy) * 0.4; }
      rec.dx = t.clientX - rec.x; rec.dy = t.clientY - rec.y;
    }
  }
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
  for (const t of e.changedTouches) for (const k of ['move', 'look']) {
    const rec = touch[k];
    if (rec && rec.id === t.identifier) {
      if (k === 'look' && Math.abs(rec.dx) < 10 && Math.abs(rec.dy) < 10 && performance.now() - rec.t < 250) fireClick = 'tap';
      if (k === 'move' && Math.abs(rec.dx) < 10 && Math.abs(rec.dy) < 10 && performance.now() - rec.t < 250) keys.add('TapJump');
      touch[k] = null;
    }
  }
  e.preventDefault();
}, { passive: false });

function readInput(tics) {
  const k = (c) => keys.has(c);
  let fwd = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
  let side = (k('KeyD') || k('Period') ? 1 : 0) - (k('KeyA') || k('Comma') ? 1 : 0);
  const turnKeys = (k('ArrowLeft') ? 1 : 0) - (k('ArrowRight') ? 1 : 0);
  const lookKeys = (k('PageDown') ? 1 : 0) - (k('PageUp') ? 1 : 0);
  const shift = k('ShiftLeft') || k('ShiftRight');
  const run = settings.alwaysRun ? (shift ? 0 : 1) : (shift ? 1 : 0);    // cl_run: always run with shift to walk, or the other way
  if (touch.move) {
    fwd = Math.max(-1, Math.min(1, -touch.move.dy / 40));
    side = Math.max(-1, Math.min(1, touch.move.dx / 40));
  }
  const yaw = turnKeys * 7 * tics + mouseYaw;
  const pitch = lookKeys * 5 * tics + mousePitch;
  mouseYaw = 0; mousePitch = 0;
  const fire = k('ControlLeft') || k('ControlRight') || k('KeyF') || fireClick ? 1 : 0;
  if (fireClick === 'tap') fireClick = false;
  // Quake's upmove: jump up, crouch (C) down, both nothing
  const jump = (k('Space') || k('TapJump') ? 1 : 0) - (k('KeyC') ? 1 : 0);
  keys.delete('TapJump');
  const imp = impulse;
  impulse = 0;
  return [tics, fwd, side, yaw, pitch, fire, jump, run, imp];
}

// ── maps ─────────────────────────────────────────────────────────────────
async function startMap(name, newGame, spawnpoint = null, autosave = true) {
  running = false;
  menu.off();
  showHelp = false;
  showInv = false;
  if (newGame) helpSeen = 0;
  setStatus(`Loading ${name} into Firebird…`);
  const t0 = performance.now();
  const bsp = await loadMap(db, pak, res, name, { skill: settings.skill, newGame, spawnpoint });
  map = { name, bsp };
  renderer.setResources(res);
  renderer.particles = [];
  beams = []; explosions = []; flashes = []; exLights = [];
  const g = (await db.query('SELECT sky, cd_track FROM game')).rows[0];
  renderer.setSky(g.SKY);
  await loadStyleBase();
  const speakers = (await db.query("SELECT id, x, y, z, noise1, speed, height, sounds FROM ents WHERE classname = 'target_speaker' AND BIN_AND(spawnflags, 3) <> 0 AND noise1 IS NOT NULL", [], arr)).rows;
  audio.setSpeakers(speakers);
  audio.playMusic(Number(g.CD_TRACK ?? 0));
  const { rows } = await db.query('SELECT MAX(id) m FROM sound_events');
  lastSoundId = rows[0].M ?? 0;
  lastFxId = 0;
  console.log(`[firebird-quake2] ${name} loaded in ${(performance.now() - t0).toFixed(0)} ms`);
  setStatus('');
  $('mapname').textContent = name;
  $('map').value = name;
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

const arr = { rowMode: 'array' };
const brushFrames = new Map();
const styleBase = new Float32Array(64);
/** The light styles' resting values: the frame lists only the ones that animate or that the map has switched. */
async function loadStyleBase() {
  styleBase.fill(0);
  for (const [s, p] of (await db.query('SELECT style, pattern FROM lightstyles', [], arr)).rows) if (s < 64 && p) styleBase[s] = (p.charCodeAt(0) - 97) / 12.5;
}
const brushAngles = new Map();

async function frame() {
  if (!running || paused || document.hidden || menu.active) {
    lastTic = performance.now();
    if (menu.active && renderer && last && !document.hidden) { drawFrame(null, [], new Float32Array(64), last.TIME_); menu.draw(renderer, performance.now()); renderer.present(); }
    else if (paused && renderer && last) { drawFrame(null, [], new Float32Array(64), last.TIME_); hud.drawCenter(renderer, 'paused', 80); renderer.present(); }
    nextFrame();
    return;
  }
  try {
    const now = performance.now();
    const tics = Math.max(1, Math.min(2, Math.round((now - lastTic) / TIC_MS)));   // at most two tics a frame: better slow motion than a stall
    lastTic += tics * TIC_MS;
    if (now - lastTic > 200) lastTic = now;

    let t = performance.now();
    last = (await db.query('SELECT * FROM q2_tic(?, ?, ?, ?, ?, ?, ?, ?, ?)', readInput(tics), { rowMode: 'object' })).rows[0];
    if (showInv) invItems = (await db.query('SELECT idx, cnt FROM inventory_list', [], { rowMode: 'array' })).rows;
    perf.tic = performance.now() - t;

    if (last.EXIT_KIND === 1 && last.NEXT_MAP) {
      await changeLevel(last.NEXT_MAP);
      nextFrame();
      return;
    }
    if (last.EXIT_KIND === 3) {
      await db.exec('UPDATE game SET exit_kind = 0 WHERE id = 1');
      openMenu(() => menu.loadMenu());
    }

    t = performance.now();
    // one round trip: every row is tagged with what it is (see FRAME_ALL in sql/render.sql)
    //   r = [kind, i1, i2, i3, i4, i5, d1, d2, d3, d4, d5, d6, d7, d8, s, lst]
    const wantSpeakers = ++frameNo % 10 === 0;
    const rows = (await db.query(`SELECT * FROM frame_all(${settings.renderer === 'sql' ? 1 : 0}, ${lastSoundId}, ${lastFxId}, ${wantSpeakers ? 1 : 0})`, [], arr)).rows;
    const faces = [], ents = [], sounds = [], fx = [];
    const styleMap = styleBase.slice();
    let speakers = null;
    brushFrames.clear(); brushAngles.clear();
    for (const r of rows) {
      switch (r[0]) {
        case 1: { const ent = r[2], ox = r[6], oy = r[7], oz = r[8]; for (const id of r[15].split(',')) faces.push([+id, ent, ox, oy, oz]); break; }
        case 8: faces.push([r[1], r[2], r[6], r[7], r[8], r[9], r[10], r[11], r[12], r[3]]); break;
        case 2: ents.push([r[1], r[2], r[3], r[4], r[6], r[7], r[8], r[9], r[10], r[11], r[5], r[12], r[14], r[13]]); break;
        case 3: if (r[15]) for (const kv of r[15].split(',')) { const i = kv.indexOf(':'); const st = +kv.slice(0, i); if (st < 64) styleMap[st] = (kv.charCodeAt(i + 1) - 97) / 12.5; } break;
        case 4: sounds.push([r[1], 0, r[2], r[3], r[14], r[6], r[7], r[8], r[9], r[10]]); break;
        case 5: fx.push([r[1], r[2], r[6], r[7], r[8], r[9], r[10], r[11], r[3]]); break;
        case 6: brushFrames.set(r[1], r[2]); if (r[6] || r[7] || r[8]) brushAngles.set(r[1], [r[6], r[7], r[8]]); break;
        case 7: speakers = r[15] ? r[15].split(',').map(Number) : []; break;
        default: break;
      }
    }
    if (speakers) audio.setSpeakersOn(speakers);
    perf.faces = performance.now() - t;
    perf.rows = faces.length;
    const listener = { x: last.PX, y: last.PY, z: last.VIEW_Z, yaw: last.YAW };
    if (sounds.length) { lastSoundId = sounds[sounds.length - 1][0]; audio.playEvents(sounds, listener); }
    audio.update(listener);
    if (fx.length) { lastFxId = fx[fx.length - 1][0]; handleFx(fx, last.TIME_); }

    t = performance.now();
    drawFrame(faces, ents, styleMap, last.TIME_, tics * 0.05);
    perf.draw = performance.now() - t;
    updateStats();
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`, true);
    running = false;
    return;
  }
  nextFrame();
}

const sprite = (name) => res.models.get(res.byName.get(name))?.spr;

// ── leaving a level: what the server did with the map string (SV_Map; src/levels.js) ─────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function changeLevel(target) {
  const c = parseChangeMap(target);
  // the unit's cross-level flags last the unit ("within the same unit", g_target.c)
  if (c.unitEnd) await db.exec('UPDATE game SET serverflags = 0 WHERE id = 1');
  if (c.kind === 'pic' && pak.has(`pics/${c.map}`)) {
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
  await startMap(pak.has('maps/demo1.bsp') ? 'demo1' : 'base1', true);
}

function handleFx(rows, time) {
  for (const [, kind, x, y, z, x2, y2, z2, n] of rows) {
    switch (kind) {
      case 1: renderer.spawnParticles('gunshot', x, y, z, 40, [x2, y2, z2], 0); break;
      case 11: renderer.spawnParticles('gunshot', x, y, z, 20, [x2, y2, z2], 0); break;
      case 2: renderer.spawnParticles('explosion', x, y, z, 0); explosions.push({ x, y, z, t0: time, spr: sprite('sprites/s_explod.sp2') }); exLights.push({ x, y, z, t0: time, light: 350, frames: 15 }); break;
      case 9: renderer.spawnParticles('explosion', x, y, z, 0); explosions.push({ x, y, z, t0: time, spr: sprite('sprites/s_explod.sp2') }); exLights.push({ x, y, z, t0: time, light: 350, frames: 19 }); break;
      case 3: renderer.spawnParticles('blood', x, y, z, Math.min(n * 2, 60), [0, 0, 0], 0xe8); break;
      case 4: renderer.spawnParticles('rail', x, y, z, 0, [x2, y2, z2]); break;
      case 5: renderer.spawnParticles('teleport', x, y, z, 0); break;
      case 6: renderer.spawnParticles('gunshot', x, y, z, 40, [0, 0, 0], 0xe0); exLights.push({ x, y, z, t0: time, light: 150, frames: 4, misc: true }); break;
      case 15: flashes.push({ x, y, z, r: n, die: time }); break;   // a muzzle flash (MZ_*, MZ2_*)
      // TE_SPLASH: count and colour (cl_tent.c's splash_color: unknown, sparks, blue water, brown water, slime, lava, blood)
      case 7: renderer.spawnParticles('gunshot', x, y, z, Math.min(n >> 4, 64), [x2 || 0, y2 || 0, z2 || 1], [0x00, 0xe0, 0xb0, 0x50, 0xd0, 0xe0, 0xe8][n & 7] ?? 0); break;
      case 14: renderer.spawnParticles('bubbles', x, y, z, 0, [x2, y2, z2]); break;   // TE_BUBBLETRAIL
      case 8: renderer.spawnParticles('bfg', x, y, z, 0); explosions.push({ x, y, z, t0: time, spr: sprite('sprites/s_bfg3.sp2'), scale: 1 }); exLights.push({ x, y, z, t0: time, light: 350, frames: 4, c: 1 / 3 }); break;
      case 10: renderer.spawnParticles('gunshot', x, y, z, 8, [0, 0, 1], 4); break;
      case 12: beams.push({ a: [x, y, z], b: [x2, y2, z2], color: 0xd0, until: time + 0.1 }); break;
      case 13: beams.push({ a: [x, y, z], b: [x2, y2, z2], color: n & 2 ? 0xf2 : n & 4 ? 0xd0 : n & 8 ? 0xf3 : n & 16 ? 0xdc : 0xe0, until: time + 0.12 }); break;
      default: break;
    }
  }
}

/**
 * The frame's dynamic lights: muzzle flashes for the frame they come in, rockets, blaster and
 * hyperblaster bolts and the BFG ball at 200 (EF_ROCKET, EF_BLASTER, EF_HYPERBLASTER, EF_BFG), and the
 * explosions fading with their frames (CL_AddExplosions: ex_poly at (16 - frame) / 16 of 350 from frame 1,
 * the blaster's hit, ex_misc, at 1 - frac / 3 of 150).
 */
function frameDlights(ents, time) {
  const lights = [];
  flashes = flashes.filter((f) => f.die >= time);
  lights.push(...flashes);
  for (const e of ents) {
    const effects = e[10];
    if (effects & (8 | 16 | 64 | 128)) lights.push({ x: e[4], y: e[5], z: e[6], r: 200, c: effects & 128 ? 1 / 3 : 2 / 3 });
  }
  exLights = exLights.filter((l) => {
    const frac = 1 + (time - l.t0) * 10, f = Math.floor(frac);
    if (f >= l.frames - 1) return false;
    const a = l.misc ? 1 - frac / (l.frames - 1) : (16 - f) / 16;
    if (a > 0) lights.push({ x: l.x, y: l.y, z: l.z, r: l.light * a, c: l.c });
    return true;
  });
  return lights;
}

function drawFrame(faces, ents, styles, time, dt = 0.05) {
  const r = renderer;
  r.dlights = frameDlights(ents, time);
  const view = { x: last.PX, y: last.PY, z: last.VIEW_Z, yaw: last.YAW, pitch: last.PITCH, roll: last.ROLL ?? (last.DEAD ? 40 : 0), fov: settings.fov };
  r.beginFrame(view);
  if (faces) {
    if (settings.renderer === 'sql') r.drawFaces(faces, styles, time, brushFrames);
    else r.drawFaceList(faces, styles, time, brushFrames, brushAngles);
  }
  const bsp = map.bsp;
  for (const e of ents) {
    const [, mid, frame, skin, x, y, z, pitch, yaw, roll, effects, alpha, kindRaw] = e;
    const kind = String(kindRaw).trim();
    const m = res.models.get(mid);
    if (!m) continue;
    if (kind === 'M') {
      const glow = effects & (8 | 16 | 64 | 128) ? 255 : 0;
      const light = glow || lightPoint(bsp, x, y, z + 8) + dlightAt(r.dlights, x, y, z) / r.lightScale;
      const spin = effects & 1 ? (time * 100) % 360 : 0;   // EF_ROTATE items spin
      r.drawAlias(m.mdl, frame, skin, [x, y, z], [pitch, yaw + spin, roll], light, { time, alpha: alpha === 1 });
      if (effects & 8) r.particles.push({ x, y, z, vx: 0, vy: 0, vz: 0, color: 0xe0 + (Math.random() * 4 | 0), die: time + 0.05, type: 'still' });   // the blaster bolt's glow
      if (effects & 16) r.spawnParticles('gunshot', x, y, z, 2, [0, 0, 0], 0xe0 + 8);   // rocket smoke
    } else if (kind === 'S') {
      r.drawSprite(m.spr, Math.floor(time * 10) % Math.max(1, m.spr.frames.length), [x, y, z], 255, effects & 128 ? true : false);
    }
  }
  beams = beams.filter((b) => b.until > time);
  for (const b of beams) r.drawBeam(b.a, b.b, b.color);
  explosions = explosions.filter((x) => time - x.t0 < 0.6);
  for (const x of explosions) if (x.spr) r.drawSprite(x.spr, Math.floor((time - x.t0) * 10), [x.x, x.y, x.z]);
  r.runParticles(dt, time);
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
      if (gunPrev) {
        const lag = (a, b) => { let d = a - b; if (d > 180) d -= 360; if (d < -180) d += 360; d *= 0.1 / Math.max(dt, 0.05); return Math.max(-45, Math.min(45, d)); };
        const dy = lag(gunPrev.yaw, last.YAW);
        gr += 0.1 * dy; gy += 0.2 * dy; gp += 0.2 * lag(gunPrev.pitch, last.PITCH);
      }
      gunPrev = { yaw: last.YAW, pitch: last.PITCH };
      const light = Math.max(lightPoint(bsp, last.PX, last.PY, last.PZ), 32) + dlightAt(r.dlights, last.PX, last.PY, last.VIEW_Z) / r.lightScale;
      r.zb.fill(0, 0, r.w * r.h);
      r.drawAlias(vm.mdl, viewFrame(vm.mdl, last, time), 0, [last.PX, last.PY, last.VIEW_Z], [-(last.PITCH + gp), last.YAW + gy, (last.ROLL ?? 0) + gr], light, { near: 1, time });
    }
  }
  prevPos = { x: last.PX, y: last.PY };

  // 2D: the status bar (with the help icon blinking while there is news on the help computer), and the
  // help computer itself on F1 and at the intermission
  last.HELP_ICON = (last.HELP_CHANGED ?? 0) > helpSeen && Math.floor(time * 10) & 8;
  last.FOV = settings.fov;
  last.CROSSHAIR = settings.crosshair;
  if (!last.INTERMISSION) hud.draw(r, last, time);
  if (showHelp || last.INTERMISSION) hud.drawHelp(r, last);
  else if (showInv && !last.DEAD) hud.drawInventory(r, invItems, last.INV_SEL, performance.now() / 1000);
  if (last.CPRINT) hud.drawCenter(r, last.CPRINT, Math.floor(r.h * 0.3));
  if (last.MSG) r.drawString(hud.conchars, last.MSG, 8, 8);
  if (last.DEAD) hud.drawCenter(r, 'You died\n\npress fire', 60);
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
  r.present(tint);
}
let prevPos = null;
let gunPrev = null;     // the view angles of the last frame (the gun's lag)

let fpsT = performance.now(), fpsN = 0, fps = 0;
function updateStats() {
  fpsN++;
  const now = performance.now();
  if (now - fpsT > 500) { fps = (fpsN * 1000) / (now - fpsT); fpsT = now; fpsN = 0; }
  statsEl.textContent = `${fps.toFixed(1)} fps · q2_tic ${perf.tic.toFixed(0)} ms · frame queries ${perf.faces.toFixed(0)} ms (${perf.rows} rows) · raster ${perf.draw.toFixed(0)} ms · ${renderer.particles.length} particles`;
}

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
  if (!window.crossOriginIsolated && window.isSecureContext && 'serviceWorker' in navigator &&
      Number(sessionStorage.getItem('firebird-quake2:coi-reloads') || '0') < 2) {
    setStatus('Enabling cross-origin isolation for Firebird WASM (one-time reload)…');
    return new Promise(() => {});
  }
  if (!window.crossOriginIsolated) {
    throw new Error('This page is not cross-origin isolated, so Firebird WASM cannot start. Reload once (the service worker enables it), and use HTTPS or localhost.');
  }
  setStatus('Starting Firebird 6 (WebAssembly)…');
  const instance = new FirebirdBrowser('memory://quake2', {
    worker: new Worker(new URL('./firebird-engine-worker.js', import.meta.url)),
    multiTab: 'allow-unsafe',
    autoPersist: false,
  });
  const v = await instance.query("SELECT rdb$get_context('SYSTEM', 'ENGINE_VERSION') AS v FROM rdb$database");
  $('engine').textContent = `Firebird ${v.rows[0].V}`;
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
    window.quake2 = { db, audio, menu, get renderer() { return renderer; }, sql: (q, p) => db.query(q, p).then((r) => r.rows) };
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
  await setView(db, viewWidth(), viewHeight(), settings.fov);
  renderer.setSize(viewWidth(), viewHeight());
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
