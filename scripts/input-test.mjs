// input-test.mjs – the page's input as Quake's usercmd (src/input.js): keys, the mouse, touches, the
// on-screen buttons and a gamepad; the gamepad's reading in particular (src/gamepad.js): dead zones, the
// run, the buttons once per press, the weapons' impulses, and the menu driven by the d-pad, the stick and A/B.
//   node scripts/input-test.mjs

import { readPad, padImpulse, padScreens, padMenuKeys, firstPad, connectedPads, axis, DEAD, BUTTON } from '../src/gamepad.js';
import { Input, GAME_KEYS, ACTIONS, DEFAULT_BINDS, defaultBinds, bindKey, keyName, keyCode, actionOfCommand, normalizeKey } from '../src/input.js';

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
check(padImpulse(readPad(pad([0, 0, 0, 0], [BUTTON.RIGHT]))) === 14 && padImpulse(readPad(pad([0, 0, 0, 0], [BUTTON.LEFT]))) === 15 && padImpulse(readPad(pad([0, 0, 0, 0], [BUTTON.UP]))) === 13,
  'the d-pad steps through the inventory (right 14, left 15) and uses the selected item (up, invuse 13)');
const sc = padScreens(readPad(pad([0, 0, 0, 0], [BUTTON.Y])));
check(sc.inventory && !sc.help && padScreens(readPad(pad([0, 0, 0, 0], [BUTTON.BACK]))).help && !padScreens(null).inventory, 'Y asks for the inventory screen, Back for the help computer, once per press');

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
check(connectedPads([null, { connected: false, axes: [0, 0, 0, 0], buttons: [] }, pad(), null, pad()]).length === 2 && connectedPads(null).length === 0, 'and all the connected ones, in order');
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
  inp.key('KeyQ'); check(cmd()[8] === 16, 'Q uses the quad (16)');
  inp.key('KeyL'); check(cmd()[8] === 18, 'L uses the silencer (18: default.cfg\'s s, the page\'s back)');
  inp.key('KeyH'); check(cmd()[8] === 21, 'H uses the power shield (21: default.cfg\'s p, the page\'s pause)');
  check(GAME_KEYS.has('KeyL') && GAME_KEYS.has('KeyH'), 'both are game keys the browser must not act on');
  check(GAME_KEYS.has('KeyW') && GAME_KEYS.has('Tab') && !GAME_KEYS.has('F6'), 'the game keys the browser must not act on are listed, the page\'s own are not');
  // the binds (settings.binds, the keys menu): the keys read are whatever each action is bound to
  check(inp.bound('KeyW') === 'forward' && inp.bound('ControlRight') === 'attack' && inp.bound('F1') === 'help' && inp.bound('KeyZ') === null, 'a key says what it is bound to (the right control as the control)');
  bindKey(inp.binds, 'forward', 'KeyK');
  check(inp.binds.forward.join() === 'KeyW,ArrowUp'.replace('KeyW,ArrowUp', 'KeyK') || inp.binds.forward.length === 1, `bound anew with two keys held, the action keeps the new key alone (${inp.binds.forward.join()})`);
  inp.clear(); inp.key('KeyW'); c = cmd();
  check(c[1] === 0 && inp.bound('KeyW') === null, 'W no longer walks');
  inp.clear(); inp.key('KeyK'); c = cmd();
  check(c[1] === 1, 'K does');
  bindKey(inp.binds, 'invnext', 'KeyK');
  inp.clear(); inp.key('KeyK'); c = cmd();
  check(c[1] === 0 && c[8] === 14 && inp.binds.forward.length === 0, 'bound to the inventory\'s next, K sends its impulse and walks no more (a key has one action)');
  check(inp.binds.invnext.join() === 'BracketRight,KeyK', 'a second key joins an action with one');
  bindKey(inp.binds, 'invnext', 'KeyM');
  check(inp.binds.invnext.join() === 'KeyM', 'a third makes both go first (KeyBindingFunc unbound the two)');
  inp.binds = defaultBinds();
  inp.clear(); inp.key('KeyW'); c = cmd();
  check(c[1] === 1 && inp.binds.attack.join() === 'Control,Mouse1', 'the defaults put back');
  // the mouse buttons and the wheel are keys: MOUSE1 fires by default, the wheel is weapnext down and weapprev up, and
  // either can be bound to anything, as default.cfg bound K_MOUSE1 and K_MWHEELUP/DOWN
  inp.clear(); inp.key('Mouse1'); c = cmd();
  check(c[5] === 1 && inp.bound('Mouse1') === 'attack', 'the left mouse button fires');
  inp.release('Mouse1'); c = cmd();
  check(c[5] === 0, 'and stops when let go');
  inp.wheel(100); check(cmd()[8] === 12, 'the wheel down is the next weapon (12)');
  inp.wheel(-100); check(cmd()[8] === 22, 'the wheel up the previous (22)');
  check(cmd()[8] === 0 && inp.keys.size === 0, 'a wheel notch is let go at once');
  bindKey(inp.binds, 'moveup', 'Mouse2');
  inp.key('Mouse2'); c = cmd();
  check(c[6] === 1 && inp.binds.moveup.join() === 'Space,Mouse2', 'the right button bound to jump jumps');
  inp.release('Mouse2');
  bindKey(inp.binds, 'moveup', 'MWheelUp');
  inp.wheel(-100); c = cmd();
  check(c[6] === 0 && c[8] === 0 && inp.binds.weapprev.length === 0, 'the wheel bound to a held action does nothing (let go at once), and leaves its old action');
  check(keyName('Mouse1') === 'MOUSE1' && keyName('Mouse3') === 'MOUSE3' && keyName('MWheelUp') === 'MWHEELUP' && keyName('MWheelDown') === 'MWHEELDOWN', 'named as Key_KeynumToString named them');
  inp.binds = defaultBinds();
  // the browser events wired by attach: a button under the lock is a key down and up, the wheel a notch, a button outside the lock nothing
  {
    const on = {};
    const el = { addEventListener: (t, f) => { on[t] = f; }, getBoundingClientRect: () => ({ left: 0, width: 640 }) };
    let locked = true;
    inp.attach(el, el, { locked: () => locked, settings: () => settings });
    on.mousedown({ button: 0 }); c = cmd();
    check(c[5] === 1, 'a mousedown under the lock fires');
    on.mouseup({ button: 0 }); c = cmd();
    check(c[5] === 0, 'the mouseup stops it');
    on.wheel({ deltaY: 120 }); check(cmd()[8] === 12, 'a wheel event down is the next weapon');
    on.wheel({ deltaY: -120 }); check(cmd()[8] === 22, 'up the previous');
    locked = false;
    on.mousedown({ button: 0 }); c = cmd();
    check(c[5] === 0, 'outside the lock a button is the page\'s, not the game\'s');
    on.mouseup({ button: 0 });
  }
  check(keyName('KeyW') === 'w' && keyName('Digit3') === '3' && keyName('ArrowUp') === 'UPARROW' && keyName('ControlLeft') === 'CTRL' && keyName('ShiftRight') === 'SHIFT' && keyName('Space') === 'SPACE'
    && keyName('BracketLeft') === '[' && keyName('PageDown') === 'PGDN' && keyName('F1') === 'F1' && keyName('Numpad5') === 'KP_5' && keyName('Delete') === 'DEL',
    'the keys are named as Key_KeynumToString named them');
  check(normalizeKey('ShiftLeft') === 'Shift' && normalizeKey('AltRight') === 'Alt' && normalizeKey('KeyA') === 'KeyA', 'the two shifts, controls and alts are one key each');
  // Key_StringToKeynum (keyCode): a name back to its code, for `bind` at the console; and every action's bind command
  check(keyCode('k') === 'KeyK' && keyCode('K') === 'KeyK' && keyCode('3') === 'Digit3' && keyCode('UPARROW') === 'ArrowUp' && keyCode('ctrl') === 'Control' && keyCode('MOUSE1') === 'Mouse1'
    && keyCode('mwheelup') === 'MWheelUp' && keyCode('KP_5') === 'Numpad5' && keyCode('f12') === 'F12' && keyCode('[') === 'BracketLeft' && keyCode('SPACE') === 'Space' && keyCode('zz') === null && keyCode('') === null && keyCode('F13') === null,
    'a key\'s name goes back to its code, case aside, nothing for rubbish');
  check(['KeyW', 'Digit0', 'ArrowUp', 'Control', 'Mouse2', 'MWheelDown', 'Numpad7', 'F1', 'Comma', 'Slash', 'Backquote', 'Space', 'Tab', 'Delete'].every((c) => keyCode(keyName(c)) === c), 'every code round-trips through its name');
  check(actionOfCommand('+attack')?.id === 'attack' && actionOfCommand('USE  Silencer')?.id === 'silencer' && actionOfCommand('weapprev')?.id === 'weapprev' && actionOfCommand('+speed')?.id === 'run'
    && actionOfCommand('nosuch') === null && ACTIONS.every((a) => a.cmd && actionOfCommand(a.cmd) === a), 'every action has Quake\'s bind command for it, found case and spacing aside');
  check(ACTIONS.length === 21 && ACTIONS.every((a) => DEFAULT_BINDS[a.id]) && new Set(Object.values(DEFAULT_BINDS).flat()).size === Object.values(DEFAULT_BINDS).flat().length,
    'every action has its default keys, no key twice');
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
  // coop: the pad is the second player's command, read apart; the keys stay the first's
  inp.clear(); inp.key('KeyW');
  pads = [pad([0, 0, 0, 1], [BUTTON.A, BUTTON.LB])];
  c = inp.read(1, settings, { pad: false });
  const c2 = inp.readPad(1, settings);
  check(c[1] === 1 && c[3] === 0 && c[6] === 0 && c[8] === 0, `read without the pad is the keys alone: [${c.join(', ')}]`);
  check(c2[1] === 0 && c2[4] === 5 && c2[6] === 1 && c2[7] === 0 && c2[8] === 13, `readPad is the pad alone: looks down, jumps, the previous weapon [${c2.join(', ')}]`);
  pads = [pad([0, 0, 0, 0], [BUTTON.START, BUTTON.Y])];
  inp.read(1, settings, { pad: false });
  check(inp.menuPressed && inp.padScreens.inventory && !inp.padScreens.help, 'the pad\'s Start still asks for the menu, and its Y for the inventory screen, whoever it drives');
  pads = [];
  inp.read(1, settings, { pad: false });
  check(inp.readPad(1, settings).join(',') === '1,0,0,0,0,0,0,0,0', 'without a pad the second player\'s command does nothing');
}

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('all good');
