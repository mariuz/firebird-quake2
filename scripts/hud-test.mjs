// hud-test.mjs – the status bar (src/hud.js) laid out to a view's width, against a renderer that records what is
// drawn: at 320 and wider single_statusbar's one layout, centred (the health at 0, the ammo at 100, the armour at
// 200, the item at 296 along the bottom; the pickup, the help icon at 148 and the timer at 262 above); narrower (a
// split screen's quarter) the parts flow into rows from the bottom up, as many a row as fit, the pickup line and
// the help icon above, every picture and character inside the view and none over another; the frags at the top
// right and the crosshair centred either way.
//   node scripts/hud-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pak } from '../src/pak.js';
import { Hud, wrap } from '../src/hud.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
let failed = 0;
const assert = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const hud = new Hud(pak);

/** A renderer `w`×`h` that records every picture and character as a rectangle. */
function recorder(w, h) {
  const drawn = [];
  return {
    w, h, drawn,
    drawPic: (p, x, y) => { if (p) drawn.push({ kind: 'pic', pic: p, x, y, w: p.w, h: p.h }); },
    drawPicScaled: (p, x, y, w, h) => { if (p) drawn.push({ kind: 'pic', pic: p, x, y, w, h, scaled: true }); },
    drawChar: (c, n, x, y) => { if (n !== 32 && n !== 160) drawn.push({ kind: 'char', n, x, y, w: 8, h: 8 }); },   // (a space in either font draws nothing)
    drawString(c, s, x, y, alt) { for (let i = 0; i < s.length; i++) this.drawChar(c, (s.charCodeAt(i) & 127) + (alt ? 128 : 0), x + i * 8, y); },
  };
}
const picAt = (r, name) => r.drawn.find((d) => d.kind === 'pic' && d.pic === hud.pic(name));
const inside = (r) => r.drawn.every((d) => d.x >= 0 && d.y >= 0 && d.x + d.w <= r.w && d.y + d.h <= r.h);
// (the crosshair is left out: SCR_DrawCrosshair drew it over everything at the centre, which a 120-high view's rows reach)
const overlaps = (r) => { const d = r.drawn.filter((x) => x.pic !== hud.pic('ch1')); let n = 0; for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) if (d[i].x < d[j].x + d[j].w && d[j].x < d[i].x + d[i].w && d[i].y < d[j].y + d[j].h && d[j].y < d[i].y + d[i].h) n++; return n; };

// a row with everything on: 100 health, the rocket launcher with 7 rockets, 50 combat armour, the launcher selected,
// shells just picked up, a quad with 12 seconds, the help icon, a crosshair, a deathmatch score
const row = { HEALTH: 100, DMG_TIME: -10, WEAPON: 128, ROCKETS: 7, ARMOR: 50, ARMOR_TYPE: 2, POWER_ARMOR: 0, CELLS: 0, INV_SEL: 14, PICKUP_ITEM: 18,
  TIMER_ICON: 1, TIMER: 12, HELP_ICON: 1, FOV: 90, DEATHMATCH: 1, SCORE: 3, CROSSHAIR: 1, DEAD: 0 };

// ── 320 wide: the layout as it was ──
let r = recorder(320, 240);
hud.draw(r, row, 1);
const at320 = { health: picAt(r, 'i_health'), ammo: picAt(r, 'a_rockets'), armor: picAt(r, 'i_combatarmor'), item: picAt(r, 'w_rlauncher'), pickup: picAt(r, 'a_shells'), timer: picAt(r, 'p_quad'), help: picAt(r, 'i_help') };
assert(at320.health?.x === 50 && at320.health.y === 216 && at320.ammo?.x === 150 && at320.armor?.x === 250 && at320.item?.x === 296 && at320.item.y === 216,
  'at 320 the health, ammo, armour and item icons sit at 50, 150, 250 and 296 along the bottom');
assert(at320.pickup?.x === 0 && at320.pickup.y === 190 && at320.timer?.x === 296 && at320.timer.y === 190 && at320.help?.x === 148 && at320.help.y === 190,
  'the pickup, the timer and the help icon on the row above, at 0, 296 and 148');
const digits = r.drawn.filter((d) => d.kind === 'pic' && hud.nums.includes(d.pic));
assert(digits.some((d) => d.x === 2 + 16 * 0 && d.y === 216) && r.drawn.some((d) => d.kind === 'char' && d.x === 26 && d.y === 198), 'the health\'s first digit at 2, the pickup\'s name at 26 on the row above');
assert(inside(r) && overlaps(r) === 0, `everything inside the view, nothing over anything (${r.drawn.length} pictures and characters)`);
const ch = picAt(r, 'ch1'), frags = r.drawn.filter((d) => d.kind === 'pic' && d.y === 2);
assert(ch?.x === 156 && ch.y === 116 && frags.length === 1 && frags[0].x === 2 + 320 - 50 + 32, 'the crosshair centred, the frags at the top right');
// wider: centred
r = recorder(640, 480);
hud.draw(r, row, 1);
assert(picAt(r, 'i_health').x === 160 + 50 && picAt(r, 'w_rlauncher').x === 160 + 296 && picAt(r, 'i_health').y === 456 && inside(r) && overlaps(r) === 0, 'at 640 the same layout, centred');

// ── 160 wide (a quarter of 320×240): rows from the bottom, nothing off the sides ──
r = recorder(160, 120);
hud.draw(r, row, 1);
const at160 = { health: picAt(r, 'i_health'), ammo: picAt(r, 'a_rockets'), armor: picAt(r, 'i_combatarmor'), item: picAt(r, 'w_rlauncher'), pickup: picAt(r, 'a_shells'), timer: picAt(r, 'p_quad'), help: picAt(r, 'i_help') };
assert(inside(r) && overlaps(r) === 0, `at 160 everything is inside the view and nothing over anything (${r.drawn.length} pictures and characters)`);
assert(at160.health?.x === 52 && at160.health.y === 96 && at160.ammo?.x === 2 + 80 + 50 && at160.ammo.y === 96, 'the health and the ammo share the bottom row, the ammo 80 on');
assert(at160.armor?.x === 52 && at160.armor.y === 70 && at160.item?.x === 2 + 80 && at160.item.y === 70 && at160.help?.x === 2 + 80 + 24 + 6 && at160.help.y === 70, 'the armour, the item and the help icon the row above');
assert(at160.timer?.x === 2 + 34 && at160.timer.y === 44 && at160.pickup?.x === 2 + 58 + 6 && at160.pickup.y === 44 && r.drawn.some((d) => d.kind === 'char' && d.x === 66 + 26 && d.y === 52),
  'the timer and the pickup line, with its name, the row above that: three rows of a 120-high view');
assert(picAt(r, 'ch1')?.x === 76 && picAt(r, 'ch1').y === 56 && r.drawn.filter((d) => d.y === 2).every((d) => d.x >= 110 && d.x + d.w <= 160), 'the crosshair centred, the frags at the top right inside the view');
// a long pickup name and no room beside it: the help icon goes above
r = recorder(160, 120);
hud.draw(r, { ...row, PICKUP_ITEM: 14 }, 1);   // "Rocket Launcher": 26 + 120 = 146 of 160
const long = r.drawn.filter((d) => d.kind === 'char');
assert(inside(r) && overlaps(r) === 0 && long.length === 14 && long.every((d) => d.y === long[0].y) && r.drawn.filter((d) => d.y === long[0].y - 8).every((d) => d.kind === 'char' || d.x + d.w <= 26),
  'a long pickup name takes a row of its own with its icon, nothing off the sides');
// fewer parts: fewer rows
r = recorder(160, 120);
hud.draw(r, { HEALTH: 60, DMG_TIME: -10, WEAPON: 1, ARMOR: 0, POWER_ARMOR: 0, INV_SEL: 0, PICKUP_ITEM: 0, TIMER_ICON: 0, HELP_ICON: 0, FOV: 90, DEATHMATCH: 0, CROSSHAIR: 0, DEAD: 0 }, 1);
assert(r.drawn.every((d) => d.y === 96) && picAt(r, 'i_health').x === 52 && !picAt(r, 'ch1'), 'the blaster with no armour: the health alone on the bottom row, no crosshair at setting 0');
// 240 wide: three to a row
r = recorder(240, 180);
hud.draw(r, row, 1);
assert(inside(r) && overlaps(r) === 0 && picAt(r, 'i_health').y === 156 && picAt(r, 'a_rockets').y === 156 && picAt(r, 'i_combatarmor').y === 156 && picAt(r, 'w_rlauncher').y === 130, 'at 240 the health, ammo and armour share the bottom row, the item above');
// 80 wide: one number a row, the item icon and the help icon sharing one, still inside a view tall enough
r = recorder(80, 200);
hud.draw(r, row, 1);
assert(inside(r) && overlaps(r) === 0 && picAt(r, 'i_health').y === 176 && picAt(r, 'a_rockets').y === 150 && picAt(r, 'i_help').y === picAt(r, 'w_rlauncher').y, 'at 80 one number a row, the two lone icons sharing one, everything still inside');
// the damage flash: the health red for 0.4 s on even tenths; low health red
r = recorder(320, 240);
hud.draw(r, { ...row, DMG_TIME: 1 }, 1.0);
assert(r.drawn.some((d) => d.kind === 'pic' && hud.anums.includes(d.pic) && d.y === 216), 'the health flashes red just after damage');
r = recorder(320, 240);
hud.draw(r, { ...row, HEALTH: 20 }, 5);
assert(r.drawn.filter((d) => d.kind === 'pic' && hud.anums.includes(d.pic) && d.y === 216).length === 2, 'and is red at 25 or under');

// the centre print: each line centred, wrapped at its spaces when the view is narrower than it (the game's fit 320)
r = recorder(320, 240);
hud.drawCenter(r, 'establish communications\nlink to command ship.', 72);
let lines = [...new Set(r.drawn.map((d) => d.y))];
assert(lines.length === 2 && r.drawn.filter((d) => d.y === 72)[0].x === (320 - 24 * 8) >> 1 && inside(r), 'at 320 a two-line centerprint is two lines, each centred');
r = recorder(160, 120);
hud.drawCenter(r, 'establish communications\nlink to command ship.', 36);
lines = [...new Set(r.drawn.map((d) => d.y))].sort((a, b) => a - b);
const firstLine = r.drawn.filter((d) => d.y === 36);
assert(lines.length === 4 && lines.join(',') === '36,44,52,60' && inside(r) && firstLine[0].x === (160 - 9 * 8) >> 1 && firstLine.length === 9,
  `at 160 the lines wrap at their spaces into four, each centred and inside ("establish" first, ${firstLine.length} characters)`);
assert(wrap('a word longer than the view xxxxxxxxxxxxxxxxxxxxxxxxxx', 20).every((l) => l.length <= 20) && wrap('short', 20).length === 1 && wrap('', 20).length === 1,
  'a word longer than the view is cut, a short line stays as it is');

// ── the help computer, the inventory and the score board: the 320×240 layouts as they were, and in a narrow view the
// panel scaled behind the text laid out to the view's columns, nothing outside, no text over other text ──
const textOverlaps = (r) => { const d = r.drawn.filter((x) => x.kind === 'char'); let n = 0; for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) if (d[i].x < d[j].x + d[j].w && d[j].x < d[i].x + d[i].w && d[i].y < d[j].y + d[j].h && d[j].y < d[i].y + d[i].h) n++; return n; };
const textAt = (r, y) => r.drawn.filter((d) => d.kind === 'char' && d.y === y).sort((a, b) => a.x - b.x).map((d) => String.fromCharCode(d.n & 127)).join('');
const help = { SKILL: 1, LEVEL_MSG: 'Outer Base', HELP_MSG: 'establish communications\nlink to command ship.', HELP_MSG2: 'find the key to\nthe next level', KILLED: 3, TOTAL_MONSTERS: 10, FOUND_GOALS: 0, TOTAL_GOALS: 1, FOUND_SECRETS: 1, TOTAL_SECRETS: 3 };
r = recorder(320, 240);
hud.drawHelp(r, help);
let panel = picAt(r, 'help');
assert(panel?.x === 32 && panel.y === 8 && !panel.scaled && textAt(r, 12) === 'medium' && textAt(r, 24) === 'OuterBase' && r.drawn.some((d) => d.kind === 'char' && d.y === 164) && inside(r),
  'at 320 the help computer is as it was: the panel at 32,8, the skill, the level name, the counts');
r = recorder(160, 120);
hud.drawHelp(r, help);
panel = picAt(r, 'help');
const helpLines = [...new Set(r.drawn.filter((d) => d.kind === 'char').map((d) => d.y))].sort((a, b) => a - b);
assert(panel?.scaled && panel.w === 128 && panel.h === 96 && panel.x === 16 && panel.y === 4, `at 160×120 the panel is scaled to half behind (${panel?.w}×${panel?.h} at ${panel?.x},${panel?.y})`);
assert(inside(r) && textOverlaps(r) === 0 && textAt(r, 2) === 'medium' && textAt(r, 10) === 'OuterBase' && helpLines.every((y) => y + 8 <= 120),
  `the text is inside and clear of itself: the skill at the top right, the level name, ${helpLines.length} lines`);
assert(textAt(r, 94) === 'kills3/10' && textAt(r, 102) === 'goals0/1' && textAt(r, 110) === 'secrets1/3', 'the counts a line each at the bottom');
assert(r.drawn.filter((d) => d.kind === 'char' && d.y >= 22 && d.y < 94).every((d) => d.x >= 0 && d.x + 8 <= 160) && helpLines.length >= 7, 'the messages wrap to the width');
// the inventory
const items = [[7, 1], [8, 1], [9, 1], [11, 1], [12, 5], [14, 1], [23, 1], [41, 2], [42, 3], [43, 1], [44, 1], [45, 1], [46, 1], [47, 1], [48, 1], [49, 1], [50, 1], [51, 1], [52, 1], [53, 1]];
r = recorder(320, 240);
hud.drawInventory(r, items, 14, 0.15);
panel = picAt(r, 'inventory');
assert(panel?.x === 32 && panel.y === 8 && !panel.scaled && textAt(r, 24) === 'hotkey###item' && r.drawn.filter((d) => d.kind === 'char' && d.y >= 40).length > 0 && inside(r),
  'at 320 the inventory is as it was: the panel at 32,8, the header at 24, seventeen lines');
assert([...new Set(r.drawn.filter((d) => d.kind === 'char' && d.y >= 40).map((d) => d.y))].length === 17, 'seventeen lines scrolled about the selected item');
r = recorder(160, 120);
hud.drawInventory(r, items, 14, 0.15);
panel = picAt(r, 'inventory');
const invLines = [...new Set(r.drawn.filter((d) => d.kind === 'char' && d.y >= 18).map((d) => d.y))].sort((a, b) => a - b);
assert(panel?.scaled && panel.w === 128 && inside(r) && textOverlaps(r) === 0 && textAt(r, 2) === 'ky###item', `at 160×120 the panel is scaled behind, the lines inside the view and clear of each other (${invLines.length} lines)`);
assert(invLines.length === 12 && invLines[invLines.length - 1] + 8 <= 120 && r.drawn.filter((d) => d.kind === 'char').every((d) => d.x + 8 <= 160), 'as many lines as the height holds, each cut to the width');
assert(r.drawn.some((d) => d.kind === 'char' && d.n === 15 && d.x === 2) && r.drawn.some((d) => d.kind === 'char' && d.n < 128 && d.y > 18), 'the selected item in the plain font with its cursor at the left');
// the score board
const scores = [{ id: 1, name: 'Rimmer', score: 5, time: 0 }, { id: 2, name: 'Lister', score: 7, ping: 37, time: 30 }, { id: 3, name: '', score: 0, ping: 1234.6, time: 0 }, { id: 4, name: 'Kryten', score: 2, time: 0 }];
r = recorder(320, 240);
hud.drawScores(r, scores, 2, 120);
assert(picAt(r, 'tag1')?.x === 32 && picAt(r, 'tag1').y === 32 && textAt(r, 32) === 'Lister' && textAt(r, 64) === 'Rimmer' && textAt(r, 40) === 'Score:7' && inside(r),
  'at 320 the score board is as it was: the clients by score down a column, the tag at 32,32, four lines each');
assert(textAt(r, 48) === 'Ping:37' && textAt(r, 80) === 'Ping:0' && textAt(r, 144) === 'Ping:999', 'the ping line is each client\'s round trip, 0 for none, whole and at most 999');
r = recorder(160, 120);
hud.drawScores(r, scores, 2, 120);
const scoreLines = [...new Set(r.drawn.filter((d) => d.kind === 'char').map((d) => d.y))].sort((a, b) => a - b);
assert(inside(r) && textOverlaps(r) === 0 && picAt(r, 'tag1')?.x === 2 && picAt(r, 'tag1').y === 4 && textAt(r, 4) === 'Lister' && textAt(r, 12) === 'Score:7Time:1' && textAt(r, 24) === 'Rimmer' && textAt(r, 44) === 'Kryten' && textAt(r, 64) === 'player3',
  `at 160×120 one column, two lines a client (${scoreLines.join(',')}), the tag where it fits, everything inside`);
r = recorder(80, 40);
hud.drawScores(r, scores, 2, 120);
assert(inside(r) && textOverlaps(r) === 0 && !picAt(r, 'tag1') && textAt(r, 4) === 'Lister' && textAt(r, 12) === 'Score:7' && !textAt(r, 24), 'at 80×40 one client fits, no tag, the time left off');

// the netgraph (src/netgraph.js, SCR_DebugGraph and SCR_DrawDebugGraph): a column a client frame along the bottom of
// the view, the newest at the right, over a band 32 high; a dropped frame a tall red column, a late one a tall orange
// one, a frame that came a column ping/30 high; a value past the height wraps as the original's did
{
  const { Netgraph, GRAPH_HEIGHT, GRAPH_BACK, COLOUR_DROPPED, COLOUR_LATE, COLOUR_PING } = await import('../src/netgraph.js');
  const fills = [];
  const rr = { w: 320, h: 240, fillRect: (x, y, w, h, c) => fills.push({ x, y, w, h, c }) };
  const g = new Netgraph(8);
  g.draw(rr);
  assert(fills.length === 1 && fills[0].x === 0 && fills[0].y === 240 - GRAPH_HEIGHT && fills[0].w === 320 && fills[0].h === GRAPH_HEIGHT && fills[0].c === GRAPH_BACK, 'with no frame yet the band alone is drawn along the bottom');
  g.frame({ ping: 60 }); g.frame({ dropped: 2, ping: 900 }); g.frame({ late: true, ping: 0 });
  fills.length = 0;
  g.draw(rr);
  const cols = fills.slice(1);
  assert(g.added === 6 && cols.length === 5 && cols[0].x === 318 && cols[0].h === 30 && cols[0].c === COLOUR_LATE && cols[1].x === 317 && cols[1].h === 30 && cols[1].c === COLOUR_PING
    && cols[2].x === 316 && cols[2].h === 30 && cols[2].c === COLOUR_DROPPED && cols[3].x === 315 && cols[3].c === COLOUR_DROPPED && cols[4].x === 314 && cols[4].h === 2 && cols[4].c === COLOUR_PING,
    `the columns stand right to left, newest first (a ping of 0 at 319 draws nothing): a late frame, a 900 ms ping clamped to 30, two drops, a 60 ms ping two high (${cols.map((c) => `${c.h}@${c.x}`).join(' ')})`);
  assert(cols.every((c) => c.y === 240 - c.h && c.w === 1) && !fills.some((c) => c.y < 240 - GRAPH_HEIGHT), 'each column one wide from the bottom, none above the band');
  for (let i = 0; i < 10; i++) g.frame({ ping: 30 * i });
  fills.length = 0; g.draw(rr);
  assert(fills.length === 1 + 8 && fills[1].h === 9 && fills[8].h === 2, 'the ring keeps the last eight (its size), the newest at the right');
  fills.length = 0; g.draw(rr, { scale: 4 });
  assert(fills[1].h === (9 * 4) % GRAPH_HEIGHT, 'a value past the height wraps, as scr_graphscale could make one');
  fills.length = 0; g.draw(rr, { height: 16, scale: 1, shift: 3 });
  assert(fills[0].h === 16 && fills[0].y === 224 && fills[1].h === (9 + 3) % 16 && fills[1].y === 240 - fills[1].h, 'graphheight and graphshift lay the band out: 16 high, each column lifted three');
}

// the pause plaque (SCR_DrawPause: pics/pause.pcx centred a little under the middle, none with scr_showpause 0) and the turtle
// (SCR_DrawNet's: pics/turtle.pcx at the view's corner from the third frame in a row of a tenth of a second or more, the count
// starting over at a faster frame or with scr_showturtle off)
{
  const r = recorder(320, 240);
  const pz = hud.pic('pause');
  assert(hud.drawPause(r, true) === true && pz && picAt(r, 'pause') && picAt(r, 'pause').x === (320 - pz.w) >> 1 && picAt(r, 'pause').y === 120 + 8, 'the pause plaque is drawn centred, 8 under the middle');
  const r2 = recorder(320, 240);
  assert(hud.drawPause(r2, false) === false && r2.drawn.length === 0, 'scr_showpause 0 draws nothing');
  const r3 = recorder(320, 240);
  hud.slow = 0;
  const seq = [hud.drawTurtle(r3, 0.05, true), hud.drawTurtle(r3, 0.1, true), hud.drawTurtle(r3, 0.2, true), hud.drawTurtle(r3, 0.1, true, 64, 48)];
  assert(seq.join() === 'false,false,false,true' && picAt(r3, 'turtle') && picAt(r3, 'turtle').x === 64 && picAt(r3, 'turtle').y === 48, `the turtle is drawn at the corner given from the third slow frame in a row (${seq.join()})`);
  const r4 = recorder(320, 240);
  const seq2 = [hud.drawTurtle(r4, 0.05, true), hud.drawTurtle(r4, 0.1, true), hud.drawTurtle(r4, 0.1, true), hud.drawTurtle(r4, 0.1, false), hud.drawTurtle(r4, 0.1, true)];
  assert(seq2.join() === 'false,false,false,false,false' && r4.drawn.length === 0, 'a fast frame starts the count over, and the switch off resets it and draws nothing');
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('all good');
