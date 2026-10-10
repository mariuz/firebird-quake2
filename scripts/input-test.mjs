// input-test.mjs – the page's input as Quake's usercmd (src/input.js): keys, the mouse, touches, the
// on-screen buttons and a gamepad; the gamepad's reading in particular (src/gamepad.js): dead zones, the
// run, the buttons once per press, the weapons' impulses, and the menu driven by the d-pad, the stick and A/B.
//   node scripts/input-test.mjs

import { readPad, padImpulse, padMenuKeys, firstPad, axis, DEAD, BUTTON } from '../src/gamepad.js';
import { Input, GAME_KEYS } from '../src/input.js';

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

// ── the Input: everything the page gathers, read as one tic's command ─────────────────────────────
{
  let clock = 0;
  let pads = [];
  const settings = { sensitivity: 7, invertMouse: false, alwaysRun: true };
  const inp = new Input({ getPads: () => pads, now: () => clock });
  const cmd = (tics = 1) => inp.read(tics, settings);
  const idle = cmd();
  check(idle.join(',') === '1,0,0,0,0,0,0,1,0', `nothing held is a run in place: [${idle.join(', ')}]`);
  inp.key('KeyW'); inp.key('KeyD'); inp.key('ControlLeft'); inp.key('Space');
  let c = cmd();
  check(c[1] === 1 && c[2] === 1 && c[5] === 1 && c[6] === 1 && c[7] === 1, 'W, D, Ctrl and Space move forward and right, fire, jump, running');
  inp.key('ShiftLeft'); c = cmd();
  check(c[7] === 0, 'Shift walks when always-run is on');
  settings.alwaysRun = false; c = cmd();
  check(c[7] === 1, 'and runs when it is off');
  inp.release('ShiftLeft'); c = cmd();
  check(c[7] === 0, 'released, the run goes');
  inp.key('KeyC'); c = cmd();
  check(c[6] === 0, 'Space with C is neither up nor down');
  inp.clear(); inp.key('ArrowLeft'); inp.key('PageDown');
  c = cmd(2);
  check(c[3] === 14 && c[4] === 10, `the turning keys scale with the tics owed (yaw ${c[3]}, pitch ${c[4]} for two)`);
  inp.clear();
  inp.key('Digit3'); c = cmd();
  check(c[8] === 3 && cmd()[8] === 0, '3 is impulse 3, once');
  inp.key('KeyG'); check(cmd()[8] === 6, 'G is the hand grenades (6)');
  inp.key('Slash'); check(cmd()[8] === 12, '/ is the next weapon (12)');
  inp.key('BracketRight'); check(cmd()[8] === 14, '] is the inventory\'s next (14)');
  check(GAME_KEYS.has('KeyW') && GAME_KEYS.has('Tab') && !GAME_KEYS.has('F6'), 'the game keys the browser must not act on are listed, the page\'s own are not');
  inp.clear();
  inp.mouse(100, -50, settings); c = cmd();
  check(Math.abs(c[3] - (-100 * 0.022 * 7)) < 1e-9 && Math.abs(c[4] - (-50 * 0.022 * 7)) < 1e-9, 'the mouse turns right for right and looks up for up, at 0.022 degrees a count times the sensitivity');
  inp.mouse(0, -50, { ...settings, invertMouse: true }); c = cmd();
  check(c[4] > 0, 'inverted, up looks down');
  check(cmd()[3] === 0, 'the movement is spent by the read');
  // touches: the left half moves by the drag, the right half looks; a tap jumps or fires
  inp.touchStart(1, 100, 300, true); inp.touchMove(1, 100, 280); c = cmd();
  check(c[1] === 0.5 && c[2] === 0, 'a drag up on the left half is half speed forward');
  inp.touchMove(1, 180, 220); c = cmd();
  check(c[1] === 1 && c[2] === 1, 'a long drag clamps at full speed, strafing');
  clock = 1000; inp.touchEnd(1); c = cmd();
  check(c[1] === 0 && c[6] === 0, 'lifted, the move stops; a long touch was no tap');
  inp.touchStart(2, 200, 300, true); clock = 1100; inp.touchEnd(2); c = cmd();
  check(c[6] === 1 && cmd()[6] === 0, 'a tap on the left half jumps, once');
  inp.touchStart(3, 600, 300, false); inp.touchMove(3, 610, 300); c = cmd();
  check(c[3] === -4 && c[5] === 0, 'a drag on the right half turns (0.4 degrees a pixel) and does not fire');
  clock = 1200; inp.touchEnd(3); c = cmd();
  check(c[5] === 0, 'a drag lifted was no tap');
  inp.touchStart(4, 600, 300, false); clock = 1300; inp.touchEnd(4); c = cmd();
  check(c[5] === 1 && cmd()[5] === 0, 'a tap on the right half fires, once');
  inp.hold('TouchFire', true); check(cmd()[5] === 1, 'the on-screen fire button fires while held');
  inp.hold('TouchFire', false); check(cmd()[5] === 0, 'and stops when let go');
  // the pad through the same read
  pads = [pad([0, -1, 1, 0], [BUTTON.START, BUTTON.RB])];
  c = cmd();
  check(c[1] === 1 && c[3] === -7 && c[7] === 1 && c[8] === 12 && inp.menuPressed, 'the pad moves, turns at the keyboard\'s speed, runs at the stick\'s edge, changes weapon, and Start asks for the menu');
  c = cmd();
  check(c[8] === 0 && !inp.menuPressed, 'held on, the bumper and Start count no more');
}

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('all good');
