// input-test.mjs – a gamepad read as Quake's usercmd: dead zones, the run, the buttons once per press,
// the weapons' impulses, and the menu driven by the d-pad, the stick and A/B.
//   node scripts/input-test.mjs

import { readPad, padImpulse, padMenuKeys, firstPad, axis, DEAD, BUTTON } from '../src/gamepad.js';

let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

const pad = (axes = [0, 0, 0, 0], held = [], triggers = {}) => ({
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: held.includes(i), value: triggers[i] ?? (held.includes(i) ? 1 : 0) })),
  connected: true,
});

// the sticks
check(axis(0.1) === 0 && axis(-0.19) === 0, `inside the dead zone (${DEAD}) a stick is still`);
check(axis(1) === 1 && axis(-1) === -1 && Math.abs(axis(0.6) - 0.5) < 1e-9, 'past it the throw rescales to 0..1');
const still = readPad(pad());
check(still.fwd === 0 && still.side === 0 && still.turn === 0 && still.look === 0 && !still.fire && !still.jump && !still.run, 'an idle pad asks for nothing');
const walk = readPad(pad([0, -0.5, 0, 0]));
check(walk.fwd > 0.3 && walk.fwd < 0.5 && !walk.run, `half the left stick forward walks (${walk.fwd.toFixed(2)})`);
const run = readPad(pad([0.7, -0.7, 0, 0]));
check(run.fwd > 0 && run.side > 0 && run.run, 'the left stick near its edge runs, strafing');
const look = readPad(pad([0, 0, 1, -1]));
check(look.turn === -1 && look.look === -1, 'the right stick turns right and looks up (Quake pitch: negative is up)');

// the buttons
const fire = readPad(pad([0, 0, 0, 0], [], { [BUTTON.RT]: 0.8 }));
check(fire.fire && !fire.jump, 'RT past half its travel fires');
const jump = readPad(pad([0, 0, 0, 0], [BUTTON.A, BUTTON.B]));
check(jump.jump && jump.crouch, 'A jumps, B crouches');

// a press is reported once, so a weapon changes once per click of the bumper
let prev = new Set();
let r = readPad(pad([0, 0, 0, 0], [BUTTON.RB]), prev);
check(padImpulse(r) === 12, 'RB pressed asks for the next weapon (impulse 12)');
prev = r.held;
r = readPad(pad([0, 0, 0, 0], [BUTTON.RB]), prev);
check(padImpulse(r) === 0, 'held on, it asks nothing more');
prev = r.held;
r = readPad(pad([0, 0, 0, 0], [BUTTON.LB]), prev);
check(padImpulse(r) === 13, 'LB asks for the previous (13)');

// the menu: d-pad keys once per press, the stick once per crossing, A chooses, B backs out
let stick = { x: 0, y: 0 };
let m = padMenuKeys(readPad(pad([0, 0, 0, 0], [BUTTON.DOWN, BUTTON.A])), stick);
check(m.keys.join(' ') === 'ArrowDown Enter', `d-pad down and A press ArrowDown and Enter (${m.keys.join(' ')})`);
m = padMenuKeys(readPad(pad([0, 1, 0, 0])), stick); stick = m.stick;
check(m.keys.join(' ') === 'ArrowDown', 'the stick pushed down presses ArrowDown once');
m = padMenuKeys(readPad(pad([0, 1, 0, 0])), stick); stick = m.stick;
check(m.keys.length === 0, 'and nothing while it stays down');
m = padMenuKeys(readPad(pad([0, 0, 0, 0])), stick); stick = m.stick;
m = padMenuKeys(readPad(pad([0, -1, 0, 0])), stick); stick = m.stick;
check(m.keys.join(' ') === 'ArrowUp', 'back to the middle and up presses ArrowUp');
m = padMenuKeys(readPad(pad([0, 0, 0, 0], [BUTTON.B])), stick);
check(m.keys.join(' ') === 'Escape', 'B presses Escape');

// the pads the browser reports: nulls for empty slots, disconnected ones skipped
check(firstPad([null, { connected: false, axes: [0, 0, 0, 0], buttons: [] }, pad()]) !== null && firstPad([null, null]) === null && firstPad(null) === null, 'the first connected pad is found among the slots');
check(readPad(null) === null, 'no pad reads as null');

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('all good');
