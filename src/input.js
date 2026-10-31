// input.js – the page's input as Quake's usercmd: the keys, the mouse under pointer lock, touches on
// the view's halves and the on-screen buttons, and a gamepad (gamepad.js).
//
// An Input holds what happened since the last tic (keys down, mouse movement, taps, a weapon
// impulse, the pad's last read) and read(tics, settings) turns it into one command,
// [tics, fwd, side, yaw, pitch, fire, jump, run, imp], clearing what was one-shot. attach() wires
// the browser events whose meaning is the game's alone; the page keeps the keys that are its own
// (menus, the console, the F keys) and hands the rest to key(). Nothing here touches the page's
// state, so a test can drive it with plain calls.

import { readPad, padImpulse, padScreens, firstPad, connectedPads, BUTTON, TURN, LOOK } from './gamepad.js';

// default.cfg's keys the browser must not act on itself (scrolling, the menu bar, tabbing away)
export const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyE', 'KeyQ', 'KeyI', 'KeyB',
  'BracketLeft', 'BracketRight', 'Enter',
  'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'Tab', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7',
  'Digit8', 'Digit9', 'Digit0', 'KeyF', 'KeyG', 'KeyC', 'KeyL', 'KeyH', 'Comma', 'Period', 'PageUp', 'PageDown', 'Slash']);

// default.cfg: 1-5 blaster to chaingun, 6 grenade launcher … 0 BFG10K, G "use grenades"
// (the impulses are the weapons in item order, hand grenades 6 between the chaingun and the launcher; 12 and 22 the
// next and the previous weapon, the bindable weapnext and weapprev below);
// the item keys: q quad damage, i invulnerability, b rebreather, e environment suit (s, the silencer, and p,
// the power shield, are the page's back and pause: those two are bindable actions below, l and h by default).
// The rest of the keys are the bindable actions below.
export const KEY_IMPULSE = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, Digit6: 7, Digit7: 8, Digit8: 9, Digit9: 10, Digit0: 11, KeyG: 6,
  KeyQ: 16, KeyI: 17, KeyB: 19, KeyE: 20 };

// The bindable actions, as menu.c's bindnames listed them (the ones with a meaning here: no mouse look, keyboard
// look, sidestep or centre view), with the impulse the one-shot ones send; the keys menu edits settings.binds.
export const ACTIONS = [
  { id: 'attack', name: 'attack' }, { id: 'weapnext', name: 'next weapon', impulse: 12 }, { id: 'weapprev', name: 'previous weapon', impulse: 22 },
  { id: 'forward', name: 'walk forward' }, { id: 'back', name: 'backpedal' }, { id: 'left', name: 'turn left' }, { id: 'right', name: 'turn right' },
  { id: 'run', name: 'run' }, { id: 'moveleft', name: 'step left' }, { id: 'moveright', name: 'step right' },
  { id: 'lookup', name: 'look up' }, { id: 'lookdown', name: 'look down' }, { id: 'moveup', name: 'up / jump' }, { id: 'movedown', name: 'down / crouch' },
  { id: 'inven', name: 'inventory' }, { id: 'invuse', name: 'use item', impulse: 13 }, { id: 'invprev', name: 'prev item', impulse: 15 }, { id: 'invnext', name: 'next item', impulse: 14 },
  { id: 'help', name: 'help computer' },
  // default.cfg's "use silencer" (s) and "use power shield" (p), whose keys the page has (back, pause): bound to l and h
  { id: 'silencer', name: 'silencer', impulse: 18 }, { id: 'shield', name: 'power shield', impulse: 21 },
];
// default.cfg's keys for them (and this port's WASD and the page keys), at most two a command as the keys menu shows; the
// mouse buttons and the wheel are keys too (MOUSE1-3, MWHEELUP, MWHEELDOWN: Mouse1-3, MWheelUp, MWheelDown here)
export const DEFAULT_BINDS = Object.freeze({
  attack: ['Control', 'Mouse1'], weapnext: ['Slash', 'MWheelDown'], weapprev: ['MWheelUp'], forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
  run: ['Shift'], moveleft: ['KeyA', 'Comma'], moveright: ['KeyD', 'Period'], lookup: ['PageUp'], lookdown: ['PageDown'], moveup: ['Space'], movedown: ['KeyC'],
  inven: ['Tab'], invuse: ['Enter'], invprev: ['BracketLeft'], invnext: ['BracketRight'], help: ['F1'], silencer: ['KeyL'], shield: ['KeyH'],
});
/** A fresh copy of the default binds (each action's keys its own array). */
export const defaultBinds = () => Object.fromEntries(Object.entries(DEFAULT_BINDS).map(([k, v]) => [k, [...v]]));
/** A key's code as the binds hold it: the two controls, shifts and alts are one key each, as Quake's K_CTRL was. */
export const normalizeKey = (code) => (/^(Control|Shift|Alt)(Left|Right)$/.test(code) ? code.replace(/(Left|Right)$/, '') : code);
/** The mouse buttons as keys (K_MOUSE1 the left, K_MOUSE2 the right, K_MOUSE3 the middle), by MouseEvent.button. */
export const MOUSE_KEYS = { 0: 'Mouse1', 2: 'Mouse2', 1: 'Mouse3' };
const KEY_NAMES = { ArrowUp: 'UPARROW', ArrowDown: 'DOWNARROW', ArrowLeft: 'LEFTARROW', ArrowRight: 'RIGHTARROW', Control: 'CTRL', Shift: 'SHIFT', Alt: 'ALT',
  Mouse1: 'MOUSE1', Mouse2: 'MOUSE2', Mouse3: 'MOUSE3', MWheelUp: 'MWHEELUP', MWheelDown: 'MWHEELDOWN',
  Space: 'SPACE', Tab: 'TAB', Enter: 'ENTER', NumpadEnter: 'KP_ENTER', Backspace: 'BACKSPACE', Escape: 'ESCAPE', PageUp: 'PGUP', PageDown: 'PGDN', Home: 'HOME', End: 'END',
  Insert: 'INS', Delete: 'DEL', CapsLock: 'CAPSLOCK', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', NumpadAdd: 'KP_PLUS', NumpadSubtract: 'KP_MINUS', NumpadMultiply: 'KP_MULT', NumpadDivide: 'KP_SLASH', NumpadDecimal: 'KP_DEL' };
/** Key_KeynumToString: the name the keys menu shows for a key (a letter or digit as itself, the rest as Quake named them). */
export function keyName(code) {
  code = normalizeKey(code);
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  let m = /^Key([A-Z])$/.exec(code); if (m) return m[1].toLowerCase();
  m = /^Digit(\d)$/.exec(code); if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code); if (m) return `KP_${m[1]}`;
  if (/^F\d{1,2}$/.test(code)) return code;
  return code.toUpperCase();
}
/** The action a key is bound to, or null. */
export function boundAction(binds, code) {
  code = normalizeKey(code);
  for (const a of ACTIONS) if (binds[a.id]?.includes(code)) return a.id;
  return null;
}
/**
 * Key_SetBinding as the keys menu binds: the key leaves whatever it was bound to (a key has one command), and
 * joins the action's keys; an action keeps at most two, the oldest making room (KeyBindingFunc unbound both first).
 */
export function bindKey(binds, action, code) {
  code = normalizeKey(code);
  for (const a of ACTIONS) if (binds[a.id]) binds[a.id] = binds[a.id].filter((c) => c !== code);
  const keys = binds[action] ?? (binds[action] = []);
  if (keys.length >= 2) keys.length = 0;
  keys.push(code);
}

const MOUSE = 0.022;      // degrees per count at sensitivity 1 (m_yaw, m_pitch)
const TOUCH_LOOK = 0.4;   // degrees per pixel of a look drag
const TOUCH_MOVE = 40;    // pixels of a move drag for full speed
const TAP = { px: 10, ms: 250 };

export class Input {
  /** getPads: the browser's gamepads (navigator.getGamepads), now: a clock in ms. */
  constructor({ getPads = () => (typeof navigator !== 'undefined' ? navigator.getGamepads?.() : null), now = () => performance.now(), binds = defaultBinds() } = {}) {
    this.keys = new Set();
    this.binds = binds;          // action → the keys bound to it (the page's settings.binds, edited in place by the keys menu)
    this.mouseYaw = 0; this.mousePitch = 0;
    this.fireClick = false;      // 'tap' for a touch's single shot (the mouse buttons are keys, through the binds)
    this.impulse = 0;
    this.touch = { move: null, look: null };
    this.pad = { held: new Set(), stick: { x: 0, y: 0 }, last: null };
    this.pads = [];              // the other pads' last reads, by index after the first (the third and fourth players')
    this.menuPressed = false;    // the pad's Start went down at the last read
    this.padScreens = { inventory: false, help: false };   // ... and its Y or Back
    this.getPads = getPads;
    this.now = now;
  }

  /** A game key went down (the page has routed its own keys first): held for the command, a one-shot one its impulse. */
  key(code) {
    code = normalizeKey(code);
    this.keys.add(code);
    const act = ACTIONS.find((a) => a.impulse && this.binds[a.id]?.includes(code));
    const imp = act ? act.impulse : KEY_IMPULSE[code];
    if (imp) this.impulse = imp;
  }
  release(code) { this.keys.delete(normalizeKey(code)); }
  /** The action a key is bound to (the page asks before it keeps a key for itself), or null. */
  bound(code) { return boundAction(this.binds, code); }
  /** Hold a key from somewhere that is not the keyboard (the on-screen buttons). */
  hold(code, on) { if (on) this.keys.add(code); else this.keys.delete(code); }
  clear() { this.keys.clear(); this.fireClick = false; this.touch.move = this.touch.look = null; }

  /** Mouse movement under pointer lock, in counts. */
  mouse(dx, dy, settings) {
    this.mouseYaw -= dx * MOUSE * settings.sensitivity;
    this.mousePitch += dy * MOUSE * settings.sensitivity * (settings.invertMouse ? -1 : 1);
  }

  // touches: the left half of the view moves, the right half looks, a tap fires (right) or jumps (left)
  touchStart(id, x, y, leftHalf) {
    const rec = { id, x, y, dx: 0, dy: 0, t: this.now() };
    if (leftHalf) this.touch.move = rec; else this.touch.look = rec;
  }
  touchMove(id, x, y) {
    for (const k of ['move', 'look']) {
      const rec = this.touch[k];
      if (rec && rec.id === id) {
        if (k === 'look') { this.mouseYaw -= (x - rec.x - rec.dx) * TOUCH_LOOK; this.mousePitch += (y - rec.y - rec.dy) * TOUCH_LOOK; }
        rec.dx = x - rec.x; rec.dy = y - rec.y;
      }
    }
  }
  touchEnd(id) {
    for (const k of ['move', 'look']) {
      const rec = this.touch[k];
      if (rec && rec.id === id) {
        const tap = Math.abs(rec.dx) < TAP.px && Math.abs(rec.dy) < TAP.px && this.now() - rec.t < TAP.ms;
        if (tap && k === 'look') this.fireClick = 'tap';
        if (tap && k === 'move') this.keys.add('TapJump');
        this.touch[k] = null;
      }
    }
  }

  /** The gamepad, read once a frame: a press counts once. */
  pollPad() {
    const pad = readPad(firstPad(this.getPads()), this.pad.held);
    if (pad) this.pad.held = pad.held;
    this.pad.last = pad;
    return pad;
  }

  /** The wheel as a key pressed and let go at once (Quake released K_MWHEELUP/DOWN in the same event): a one-shot action's impulse, a held one nothing. */
  wheel(deltaY) {
    const code = deltaY > 0 ? 'MWheelDown' : 'MWheelUp';
    this.key(code);
    this.release(code);
  }

  /**
   * Wire the browser events whose meaning is the game's alone. `locked()` says whether the mouse is
   * captured by the view, `settings()` gives the live settings. The mouse buttons are keys under the lock
   * (Mouse1-3, through the binds like any key), the wheel MWheelUp and MWheelDown.
   */
  attach(canvas, win, { locked, settings }) {
    win.addEventListener('keyup', (e) => this.release(e.code));
    win.addEventListener('blur', () => this.clear());
    canvas.addEventListener('mousedown', (e) => { if (locked() && MOUSE_KEYS[e.button]) this.key(MOUSE_KEYS[e.button]); });
    win.addEventListener('mouseup', (e) => { if (MOUSE_KEYS[e.button]) this.release(MOUSE_KEYS[e.button]); });
    win.addEventListener('mousemove', (e) => { if (locked()) this.mouse(e.movementX, e.movementY, settings()); });
    win.addEventListener('wheel', (e) => { if (locked()) this.wheel(e.deltaY); });
    canvas.addEventListener('touchstart', (e) => {
      const r = canvas.getBoundingClientRect();
      for (const t of e.changedTouches) this.touchStart(t.identifier, t.clientX, t.clientY, t.clientX - r.left < r.width / 2);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => { for (const t of e.changedTouches) this.touchMove(t.identifier, t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchend', (e) => { for (const t of e.changedTouches) this.touchEnd(t.identifier); e.preventDefault(); }, { passive: false });
  }

  /**
   * One tic's command. `tics` is how many the frame owes; the turning keys and sticks scale with it. The
   * pad is read here (once a frame) and merged in, unless `pad` is false: then it is the second player's,
   * read by readPad after this.
   */
  read(tics, settings, { pad: usePad = true } = {}) {
    const k = (c) => this.keys.has(c);
    const b = (action) => (this.binds[action] ?? []).some((c) => this.keys.has(c));   // any key bound to the action is down
    const polled = this.pollPad();
    this.menuPressed = !!polled && polled.pressed.has(BUTTON.START);
    this.padScreens = padScreens(polled);   // the inventory and help screens the pad's player asked for
    const pad = usePad ? polled : null;
    if (pad) { const pi = padImpulse(pad); if (pi) this.impulse = pi; }
    let fwd = (b('forward') ? 1 : 0) - (b('back') ? 1 : 0);
    let side = (b('moveright') ? 1 : 0) - (b('moveleft') ? 1 : 0);
    const turnKeys = (b('left') ? 1 : 0) - (b('right') ? 1 : 0);
    const lookKeys = (b('lookdown') ? 1 : 0) - (b('lookup') ? 1 : 0);
    const shift = b('run');
    let run = settings.alwaysRun ? (shift ? 0 : 1) : (shift ? 1 : 0);    // cl_run: always run with the run key to walk, or the other way
    if (this.touch.move) {
      fwd = Math.max(-1, Math.min(1, -this.touch.move.dy / TOUCH_MOVE));
      side = Math.max(-1, Math.min(1, this.touch.move.dx / TOUCH_MOVE));
    }
    let padTurn = 0, padLook = 0;
    if (pad && (pad.fwd || pad.side)) { fwd = pad.fwd; side = pad.side; run = settings.alwaysRun || pad.run ? 1 : 0; }
    if (pad) {
      // the right stick at the keyboard's turning speed at full throw, scaled by the mouse sensitivity (7 is 1×)
      padTurn = pad.turn * TURN * tics * settings.sensitivity / 7;
      padLook = pad.look * LOOK * tics * settings.sensitivity / 7 * (settings.invertMouse ? -1 : 1);
    }
    const yaw = turnKeys * 7 * tics + this.mouseYaw + padTurn;
    const pitch = lookKeys * 5 * tics + this.mousePitch + padLook;
    this.mouseYaw = 0; this.mousePitch = 0;
    const fire = b('attack') || k('TouchFire') || this.fireClick || pad?.fire ? 1 : 0;
    if (this.fireClick === 'tap') this.fireClick = false;   // (a tap fires once)
    // Quake's upmove: jump up, crouch (C) down, both nothing
    const jump = (b('moveup') || k('TapJump') || pad?.jump ? 1 : 0) - (b('movedown') || pad?.crouch ? 1 : 0);
    this.keys.delete('TapJump');
    const imp = this.impulse;
    this.impulse = 0;
    return [tics, fwd, side, yaw, pitch, fire, jump, run, imp];
  }

  /**
   * A pad alone as a tic's command, for a coop game's second player on: `index` 0 is the first pad, read by this
   * frame's read() (call after it), 1 the second pad and so on (the third and fourth players'), read here once a
   * frame. Without a pad, a command that does nothing.
   */
  readPad(tics, settings, index = 0) {
    const pad = index === 0 ? this.pad.last : this.pollPadAt(index);
    if (!pad) return [tics, 0, 0, 0, 0, 0, 0, settings.alwaysRun ? 1 : 0, 0];
    const yaw = pad.turn * TURN * tics * settings.sensitivity / 7;
    const pitch = pad.look * LOOK * tics * settings.sensitivity / 7 * (settings.invertMouse ? -1 : 1);
    return [tics, pad.fwd, pad.side, yaw, pitch, pad.fire ? 1 : 0, (pad.jump ? 1 : 0) - (pad.crouch ? 1 : 0), settings.alwaysRun || pad.run ? 1 : 0, padImpulse(pad)];
  }
  /** The pad at `index` among the connected ones (1 the second), read once: a press counts once; null without one. */
  pollPadAt(index) {
    const p = connectedPads(this.getPads())[index];
    const rec = this.pads[index] ?? (this.pads[index] = { held: new Set(), last: null });
    const pad = readPad(p ?? null, rec.held);
    if (pad) rec.held = pad.held;
    rec.last = pad;
    return pad;
  }
}
