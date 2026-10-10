// gamepad.js – a gamepad read as Quake's usercmd, through the Gamepad API's standard mapping.
//
// Left stick moves (forward and strafe, a run past 0.9 of its throw), right stick looks (at the
// keyboard's turning speed at full throw, scaled by the mouse sensitivity), RT fires, A jumps, B
// crouches, LB and RB step through the weapons, Start opens the menu. In a menu the d-pad and the
// left stick move the cursor, A chooses, B goes back. Pure: it takes a Gamepad object (or anything
// with `axes` and `buttons`) and the previous read, and returns the command and the buttons that
// went down since, so the page's tests can drive it with plain objects.

export const DEAD = 0.2;               // a stick's dead zone, of its throw
export const RUN_AT = 0.9;             // a stick this far out runs
export const TURN = 7;                 // degrees a tic at full throw, the keyboard's turning speed
export const LOOK = 5;                 // degrees a tic at full throw, the keyboard's looking speed

// the standard mapping's buttons, by index
export const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

/** A stick axis with its dead zone taken out and the rest rescaled to 0..1. */
export function axis(v) {
  const a = Math.abs(v ?? 0);
  if (a < DEAD) return 0;
  return Math.sign(v) * Math.min(1, (a - DEAD) / (1 - DEAD));
}

/** Whether a button is down: pressed, or (a trigger) past half its travel. */
export function down(pad, i) {
  const b = pad?.buttons?.[i];
  if (!b) return false;
  return typeof b === 'object' ? b.pressed || (b.value ?? 0) > 0.5 : b > 0.5;
}

/**
 * Read a pad. `prev` is the last read's `held` (a Set of button indices), so a press is reported once.
 * Returns { fwd, side, turn, look, fire, jump, crouch, run, held, pressed } with turn/look as fractions
 * of full throw (the caller multiplies by TURN/LOOK and the tics), or null without a pad.
 */
export function readPad(pad, prev = new Set()) {
  if (!pad || !pad.axes) return null;
  const held = new Set();
  for (let i = 0; i < 16; i++) if (down(pad, i)) held.add(i);
  const pressed = new Set([...held].filter((i) => !prev.has(i)));
  const lx = axis(pad.axes[0]), ly = axis(pad.axes[1]);
  const rx = axis(pad.axes[2]), ry = axis(pad.axes[3]);
  return {
    fwd: -ly,
    side: lx,
    turn: -rx,
    look: ry,
    fire: held.has(BUTTON.RT) || held.has(BUTTON.X),
    jump: held.has(BUTTON.A),
    crouch: held.has(BUTTON.B),
    run: Math.hypot(pad.axes[0] ?? 0, pad.axes[1] ?? 0) >= RUN_AT,   // of the raw throw: the edge of the stick
    held,
    pressed,
  };
}

/** The impulses a read asks for: RB the next weapon (12), LB the previous (13); 0 for none. */
export function padImpulse(read) {
  if (!read) return 0;
  if (read.pressed.has(BUTTON.RB)) return 12;
  if (read.pressed.has(BUTTON.LB)) return 13;
  return 0;
}

/** The menu keys a read presses, as key codes the menu takes: d-pad and left stick move, A chooses, B backs out. */
export function padMenuKeys(read, prevStick = { x: 0, y: 0 }) {
  if (!read) return { keys: [], stick: prevStick };
  const keys = [];
  if (read.pressed.has(BUTTON.UP)) keys.push('ArrowUp');
  if (read.pressed.has(BUTTON.DOWN)) keys.push('ArrowDown');
  if (read.pressed.has(BUTTON.LEFT)) keys.push('ArrowLeft');
  if (read.pressed.has(BUTTON.RIGHT)) keys.push('ArrowRight');
  // the stick as a d-pad: a key when it crosses out of the middle, nothing while it stays out
  const sx = Math.abs(read.side) > 0.5 ? Math.sign(read.side) : 0, sy = Math.abs(read.fwd) > 0.5 ? Math.sign(read.fwd) : 0;
  if (sy !== 0 && sy !== prevStick.y) keys.push(sy > 0 ? 'ArrowUp' : 'ArrowDown');
  if (sx !== 0 && sx !== prevStick.x) keys.push(sx > 0 ? 'ArrowRight' : 'ArrowLeft');
  if (read.pressed.has(BUTTON.A) || read.pressed.has(BUTTON.START)) keys.push('Enter');
  if (read.pressed.has(BUTTON.B) || read.pressed.has(BUTTON.BACK)) keys.push('Escape');
  return { keys, stick: { x: sx, y: sy } };
}

/** The first connected pad the browser reports, or null. */
export function firstPad(pads) {
  if (!pads) return null;
  for (const p of pads) if (p && p.connected !== false && p.axes) return p;
  return null;
}
