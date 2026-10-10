// input.js – the page's input as Quake's usercmd: the keys, the mouse under pointer lock, touches on
// the view's halves and the on-screen buttons, and a gamepad (gamepad.js).
//
// An Input holds what happened since the last tic (keys down, mouse movement, taps, a weapon
// impulse, the pad's last read) and read(tics, settings) turns it into one command,
// [tics, fwd, side, yaw, pitch, fire, jump, run, imp], clearing what was one-shot. attach() wires
// the browser events whose meaning is the game's alone; the page keeps the keys that are its own
// (menus, the console, the F keys) and hands the rest to key(). Nothing here touches the page's
// state, so a test can drive it with plain calls.

import { readPad, padImpulse, firstPad, BUTTON, TURN, LOOK } from './gamepad.js';

// default.cfg's keys the browser must not act on itself (scrolling, the menu bar, tabbing away)
export const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyE', 'KeyQ', 'KeyI', 'KeyB',
  'BracketLeft', 'BracketRight', 'Enter',
  'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'Tab', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7',
  'Digit8', 'Digit9', 'Digit0', 'KeyF', 'KeyG', 'KeyC', 'Comma', 'Period', 'PageUp', 'PageDown', 'Slash']);

// default.cfg: 1-5 blaster to chaingun, 6 grenade launcher … 0 BFG10K, G "use grenades", / weapnext
// (the impulses are the weapons in item order, hand grenades 6 between the chaingun and the launcher);
// the inventory (invuse, invnext, invprev) and the item keys: q quad damage, i invulnerability,
// b rebreather, e environment suit (s, the silencer, and p, the power shield, are the page's back and pause)
export const KEY_IMPULSE = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, Digit6: 7, Digit7: 8, Digit8: 9, Digit9: 10, Digit0: 11, KeyG: 6, Slash: 12,
  Enter: 13, BracketRight: 14, BracketLeft: 15, KeyQ: 16, KeyI: 17, KeyB: 19, KeyE: 20 };

const MOUSE = 0.022;      // degrees per count at sensitivity 1 (m_yaw, m_pitch)
const TOUCH_LOOK = 0.4;   // degrees per pixel of a look drag
const TOUCH_MOVE = 40;    // pixels of a move drag for full speed
const TAP = { px: 10, ms: 250 };

export class Input {
  /** getPads: the browser's gamepads (navigator.getGamepads), now: a clock in ms. */
  constructor({ getPads = () => (typeof navigator !== 'undefined' ? navigator.getGamepads?.() : null), now = () => performance.now() } = {}) {
    this.keys = new Set();
    this.mouseYaw = 0; this.mousePitch = 0;
    this.fireClick = false;      // the mouse button, or 'tap' for a touch's single shot
    this.impulse = 0;
    this.touch = { move: null, look: null };
    this.pad = { held: new Set(), stick: { x: 0, y: 0 }, last: null };
    this.menuPressed = false;    // the pad's Start went down at the last read
    this.getPads = getPads;
    this.now = now;
  }

  /** A game key went down (the page has routed its own keys first). */
  key(code) {
    this.keys.add(code);
    const imp = KEY_IMPULSE[code];
    if (imp) this.impulse = imp;
  }
  release(code) { this.keys.delete(code); }
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

  /**
   * Wire the browser events whose meaning is the game's alone. `locked()` says whether the mouse is
   * captured by the view, `settings()` gives the live settings.
   */
  attach(canvas, win, { locked, settings }) {
    win.addEventListener('keyup', (e) => this.release(e.code));
    win.addEventListener('blur', () => this.clear());
    canvas.addEventListener('mousedown', (e) => { if (locked() && e.button === 0) this.fireClick = true; });
    win.addEventListener('mouseup', () => { this.fireClick = false; });
    win.addEventListener('mousemove', (e) => { if (locked()) this.mouse(e.movementX, e.movementY, settings()); });
    win.addEventListener('wheel', () => { if (locked()) this.impulse = 12; });
    canvas.addEventListener('touchstart', (e) => {
      const r = canvas.getBoundingClientRect();
      for (const t of e.changedTouches) this.touchStart(t.identifier, t.clientX, t.clientY, t.clientX - r.left < r.width / 2);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => { for (const t of e.changedTouches) this.touchMove(t.identifier, t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchend', (e) => { for (const t of e.changedTouches) this.touchEnd(t.identifier); e.preventDefault(); }, { passive: false });
  }

  /** One tic's command. `tics` is how many the frame owes; the turning keys and sticks scale with it. */
  read(tics, settings) {
    const k = (c) => this.keys.has(c);
    const pad = this.pollPad();
    this.menuPressed = !!pad && pad.pressed.has(BUTTON.START);
    if (pad) { const pi = padImpulse(pad); if (pi) this.impulse = pi; }
    let fwd = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    let side = (k('KeyD') || k('Period') ? 1 : 0) - (k('KeyA') || k('Comma') ? 1 : 0);
    const turnKeys = (k('ArrowLeft') ? 1 : 0) - (k('ArrowRight') ? 1 : 0);
    const lookKeys = (k('PageDown') ? 1 : 0) - (k('PageUp') ? 1 : 0);
    const shift = k('ShiftLeft') || k('ShiftRight');
    let run = settings.alwaysRun ? (shift ? 0 : 1) : (shift ? 1 : 0);    // cl_run: always run with shift to walk, or the other way
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
    const fire = k('ControlLeft') || k('ControlRight') || k('KeyF') || k('TouchFire') || this.fireClick || pad?.fire ? 1 : 0;
    if (this.fireClick === 'tap') this.fireClick = false;
    // Quake's upmove: jump up, crouch (C) down, both nothing
    const jump = (k('Space') || k('TapJump') || pad?.jump ? 1 : 0) - (k('KeyC') || pad?.crouch ? 1 : 0);
    this.keys.delete('TapJump');
    const imp = this.impulse;
    this.impulse = 0;
    return [tics, fwd, side, yaw, pitch, fire, jump, run, imp];
  }
}
