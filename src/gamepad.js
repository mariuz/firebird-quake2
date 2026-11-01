// gamepad.js – a gamepad read as Quake's usercmd, through the Gamepad API's standard mapping.
//
// Left stick moves (forward and strafe, a run past 0.9 of its throw), right stick looks (at the
// keyboard's turning speed at full throw, scaled by the mouse sensitivity), RT fires, A jumps, B
// crouches, LB and RB step through the weapons, the d-pad steps through the inventory (left and
// right) and uses the selected item (up), Y shows the inventory, Back the help computer, Start opens
// the menu. In a menu the d-pad and the left stick move the cursor, A chooses, B goes back. Pure: it
// takes a Gamepad object (or anything with `axes` and `buttons`) and the previous read, and returns
// the command and the buttons that went down since, so the page's tests can drive it with plain objects.

export const DEAD = 0.15;              // a stick's dead zone, of its throw (the joy_*threshold cvars' default, as IN_JoyMove had them)
/**
 * IN_JoyMove's cvars as the pad reads them: the thresholds (each stick axis's dead zone, of its throw) and the sensitivities (each
 * axis's speed, with Quake's signs: -1 forward, side and yaw and 1 pitch give the move and the turn as the standard mapping points
 * them, the side axis taken negated as the Windows joystick's x was; 2 doubles a stick, the other sign turns it).
 */
export const JOY = Object.freeze({ forwardThreshold: 0.15, sideThreshold: 0.15, pitchThreshold: 0.15, yawThreshold: 0.15, forwardSensitivity: -1, sideSensitivity: -1, pitchSensitivity: 1, yawSensitivity: -1 });
export const RUN_AT = 0.9;             // a stick this far out runs (the right stick turns and looks at the keyboard's speeds: input.js's cl_yawspeed and cl_pitchspeed)

// the standard mapping's buttons, by index
export const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

/** A stick axis with its dead zone (`dead`, a joy_*threshold) taken out and the rest rescaled to 0..1. */
export function axis(v, dead = DEAD) {
  const a = Math.abs(v ?? 0);
  if (a < dead) return 0;
  return Math.sign(v) * Math.min(1, (a - dead) / ((1 - dead) || 1));
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
 * of full throw (the caller multiplies by the keyboard's speeds a tic, cl_yawspeed and cl_pitchspeed's, and the tics), or null without a pad.
 * `joy` is the joy_ cvars (JOY's keys; one missing or no number is the default): the sticks' dead zones and speeds, clamped to full throw.
 */
export function readPad(pad, prev = new Set(), joy = JOY) {
  if (!pad || !pad.axes) return null;
  const held = new Set();
  for (let i = 0; i < 16; i++) if (down(pad, i)) held.add(i);
  const pressed = new Set([...held].filter((i) => !prev.has(i)));
  const j = {};
  for (const k of Object.keys(JOY)) j[k] = Number.isFinite(joy?.[k]) ? joy[k] : JOY[k];
  const lx = axis(pad.axes[0], j.sideThreshold), ly = axis(pad.axes[1], j.forwardThreshold);
  const rx = axis(pad.axes[2], j.yawThreshold), ry = axis(pad.axes[3], j.pitchThreshold);
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  return {
    fwd: clamp(ly * j.forwardSensitivity),
    side: clamp(-lx * j.sideSensitivity),
    turn: clamp(rx * j.yawSensitivity),
    look: clamp(ry * j.pitchSensitivity),
    fire: held.has(BUTTON.RT) || held.has(BUTTON.X),
    jump: held.has(BUTTON.A),
    crouch: held.has(BUTTON.B),
    run: Math.hypot(pad.axes[0] ?? 0, pad.axes[1] ?? 0) >= RUN_AT,   // of the raw throw: the edge of the stick
    held,
    pressed,
  };
}

/**
 * The impulses a read asks for: RB the next weapon (12), LB the previous (13); the d-pad's right and left the
 * inventory's next and previous (14, 15) and up invuse (13: uses the selected item); 0 for none.
 */
export function padImpulse(read) {
  if (!read) return 0;
  if (read.pressed.has(BUTTON.RB)) return 12;
  if (read.pressed.has(BUTTON.LB)) return 13;
  if (read.pressed.has(BUTTON.RIGHT)) return 14;
  if (read.pressed.has(BUTTON.LEFT)) return 15;
  if (read.pressed.has(BUTTON.UP)) return 13;
  return 0;
}

/** The screens a read toggles: Y the inventory (inven), Back the help computer (F1); each once per press. */
export function padScreens(read) {
  return { inventory: !!read && read.pressed.has(BUTTON.Y), help: !!read && read.pressed.has(BUTTON.BACK) };
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

/** The connected pads the browser reports, in order. */
export function connectedPads(pads) {
  const out = [];
  if (pads) for (const p of pads) if (p && p.connected !== false && p.axes) out.push(p);
  return out;
}
/** The first connected pad the browser reports, or null. */
export function firstPad(pads) {
  return connectedPads(pads)[0] ?? null;
}
