// hud.js – g_spawn.c's single_statusbar as cl_scrn.c lays it out, drawn into the 8-bit frame from
// the pics/*.pcx pictures: health, the current weapon's ammo, armour and the selected item along the
// bottom; the item just picked up, the powerup timer and the help icon above; the crosshair; and the
// inventory screen (cl_inv.c).

import { pic } from './pak.js';
import { WEAPONS, AMMO_ICONS, ARMOR_ICONS, ITEMS, ITEM_KEYS, TIMER_ICONS } from './gamedata.js';

export class Hud {
  constructor(pak) {
    this.pak = pak;
    this.cache = new Map();
    this.conchars = pic(pak, 'conchars');
    this.backtile = pic(pak, 'backtile');   // (Draw_TileClear's tile, around a view smaller than the screen: the viewsize cvar)
    this.nums = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => pic(pak, `num_${i}`));
    this.anums = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => pic(pak, `anum_${i}`));
    this.numMinus = pic(pak, 'num_minus');
    this.anumMinus = pic(pak, 'anum_minus');
  }

  pic(name) {
    if (!name) return null;
    let p = this.cache.get(name);
    if (p === undefined) { p = pic(this.pak, name); this.cache.set(name, p); }
    return p;
  }

  /** SCR_DrawField: a right-aligned number of up to `width` digits, red when `alt`. */
  drawNum(r, x, y, num, width, alt) {
    let s = String(Math.max(-999, Math.min(999, Math.round(num))));
    if (s.length > width) s = s.slice(s.length - width);
    x += 2 + 16 * (width - s.length);
    for (const ch of s) {
      const p = ch === '-' ? (alt ? this.anumMinus : this.numMinus) : (alt ? this.anums : this.nums)[Number(ch)];
      r.drawPic(p, x, y);
      x += 16;
    }
  }

  /**
   * The status bar's parts for a row, as single_statusbar lists them: [name, draw(x, y), width]. The health, the
   * current weapon's ammo and the armour are a number of three digits with an icon after it (74 wide); the selected
   * item an icon; the timer a number of two with its icon; the pickup an icon and its name; the help icon alone.
   */
  parts(r, hud, time) {
    const frame = Math.floor(time * 10);
    const num = (x, y, n, width, alt) => this.drawNum(r, x, y, n, width, alt);
    const icon = (name, x, y) => r.drawPic(this.pic(name), x, y);
    const out = [];
    const hp = hud.HEALTH;
    out.push(['health', (x, y) => { num(x, y, hp, 3, hp <= 25 || (hp > 0 && time - hud.DMG_TIME < 0.4 && frame % 2 === 0)); icon('i_health', x + 50, y); }, 74]);
    const wp = WEAPONS[hud.WEAPON];
    if (wp && wp.ammo) { const cnt = hud[wp.ammo.toUpperCase()]; out.push(['ammo', (x, y) => { num(x, y, cnt, 3, cnt <= 5); icon(AMMO_ICONS[wp.ammo], x + 50, y); }, 74]); }
    // armour: power armour that is on, with its cells, flashing with the other armour's count when there is some
    const armor = hud.ARMOR > 0 && hud.ARMOR_TYPE > 0;
    if (hud.POWER_ARMOR > 0 && (!armor || (frame & 8))) out.push(['armor', (x, y) => { num(x, y, hud.CELLS, 3, false); icon('i_powershield', x + 50, y); }, 74]);
    else if (armor) out.push(['armor', (x, y) => { num(x, y, hud.ARMOR, 3, false); icon(ARMOR_ICONS[hud.ARMOR_TYPE], x + 50, y); }, 74]);
    if (hud.INV_SEL > 0 && ITEMS[hud.INV_SEL]) out.push(['item', (x, y) => icon(ITEMS[hud.INV_SEL][1], x, y), 24]);
    const got = ITEMS[hud.PICKUP_ITEM];
    if (got) out.push(['pickup', (x, y) => { icon(got[1], x, y); r.drawString(this.conchars, got[0], x + 26, y + 8); }, 26 + got[0].length * 8]);
    if (hud.TIMER_ICON > 0) out.push(['timer', (x, y) => { num(x, y, hud.TIMER, 2, false); icon(TIMER_ICONS[hud.TIMER_ICON], x + 34, y); }, 58]);
    // STAT_HELPICON: news on the help computer, else the weapon in hand when the view's fov hides the gun
    if (hud.HELP_ICON) out.push(['help', (x, y) => icon('i_help', x, y), 24]);
    else if (wp && hud.FOV > 91) out.push(['help', (x, y) => icon(wp.icon, x, y), 24]);
    return out;
  }

  /**
   * The rows of a status bar `w` wide: at 320 and wider the one layout single_statusbar had (the health, ammo and
   * armour at 0, 100 and 200 along the bottom with the item at 296; the pickup, the help icon at 148 and the timer
   * at 262 on the row above), centred. Narrower (a split screen's quarter: 160 wide at 320×240) the parts flow
   * from the left into rows from the bottom up, each into the lowest row with room for it (6 between), the pickup
   * line and the help icon after the rest, so nothing goes off the sides. Returns [[name, x, y]] of the parts to draw.
   */
  layout(parts, w, h) {
    const yb = h - 24, y2 = h - 50;
    const at = {};
    if (w >= 320) {
      const x0 = (w - 320) >> 1;
      const fixed = { health: [x0, yb], ammo: [x0 + 100, yb], armor: [x0 + 200, yb], item: [x0 + 296, yb], pickup: [x0, y2], timer: [x0 + 262, y2], help: [x0 + 148, y2] };
      return parts.map(([name]) => [name, ...fixed[name]]);
    }
    // (first fit: a part goes into the lowest row with room for it, so the help icon sits by the timer and a
    // pickup's long name takes a row of its own; a row is 24 high with 2 between)
    const rows = [];
    const order = [...parts.filter(([n]) => n !== 'pickup' && n !== 'help'), ...parts.filter(([n]) => n === 'pickup' || n === 'help')];
    for (const [name, , width] of order) {
      let i = rows.findIndex((row) => row.x + width <= w);
      if (i < 0) { i = rows.length; rows.push({ x: 2 }); }
      at[name] = [rows[i].x, i];
      rows[i].x += width + 6;
    }
    return parts.map(([name]) => { const [x, i] = at[name]; return [name, x, yb - 26 * i]; });
  }

  /** hud: the Q2_TIC row. time: game time. */
  draw(r, hud, time) {
    const w = r.w, h = r.h;
    const parts = this.parts(r, hud, time);
    const draw = Object.fromEntries(parts.map(([name, fn]) => [name, fn]));
    for (const [name, x, y] of this.layout(parts, w, h)) draw[name](x, y);
    // dm_statusbar: the frags at the top right (xr -50 yt 2 num 3 14)
    if (hud.DEATHMATCH) this.drawNum(r, w - 50, 2, hud.SCORE ?? 0, 3, false);
    // SCR_DrawCrosshair: ch1-ch3 by the crosshair setting, centred
    const ch = hud.CROSSHAIR ? this.pic(`ch${hud.CROSSHAIR}`) : null;
    if (!hud.DEAD && ch) r.drawPic(ch, (w - ch.w) >> 1, (h - ch.h) >> 1);
  }

  /**
   * A screen's panel picture in a view narrower than the 320×240 the layouts were made for: the virtual screen
   * scaled to fit the view (the same scale both ways, centred), and the panel with it, as a backdrop for the
   * text laid out to the view's columns, since the font does not scale. Returns the scaled screen's box.
   */
  narrowPanel(r, name, px, py) {
    const s = Math.min(r.w / 320, r.h / 240);
    const sw = Math.round(320 * s), sh = Math.round(240 * s);
    const xv = (r.w - sw) >> 1, yv = (r.h - sh) >> 1;
    const panel = this.pic(name);
    if (panel) {
      const dw = Math.round(panel.w * s), dh = Math.round(panel.h * s), x = xv + Math.round(px * s), y = yv + Math.round(py * s);
      if (r.drawPicScaled) r.drawPicScaled(panel, x, y, dw, dh); else r.drawPic(panel, x, y);
    }
    return { xv, yv, sw, sh };
  }

  /**
   * The help computer (HelpComputer in p_hud.c): the skill, the level's name, the two messages
   * target_help left, and the level's counts, laid out on the 320×240 virtual screen; in a narrower view
   * (a split screen's quarter) the panel scaled behind and the text to the view's columns, the messages
   * wrapped, the counts a line each at the bottom.
   */
  drawHelp(r, h) {
    if (narrow(r)) return this.drawHelpNarrow(r, h);
    const xv = (r.w >> 1) - 160, yv = (r.h >> 1) - 120;
    const panel = this.pic('help');
    if (panel) r.drawPic(panel, xv + 32, yv + 8);
    r.drawString(this.conchars, ['easy', 'medium', 'hard'][h.SKILL] ?? 'hard+', xv + 202, yv + 12, true);
    this.cstring(r, h.LEVEL_MSG ?? '', xv, yv + 24);
    this.cstring(r, h.HELP_MSG ?? '', xv, yv + 54);
    this.cstring(r, h.HELP_MSG2 ?? '', xv, yv + 110);
    const n3 = (n) => String(n ?? 0).padStart(3);
    r.drawString(this.conchars, ' kills     goals    secrets', xv + 50, yv + 164, true);
    r.drawString(this.conchars, `${n3(h.KILLED)}/${n3(h.TOTAL_MONSTERS)}     ${h.FOUND_GOALS ?? 0}/${h.TOTAL_GOALS ?? 0}       ${h.FOUND_SECRETS ?? 0}/${h.TOTAL_SECRETS ?? 0}`, xv + 50, yv + 172, true);
  }
  drawHelpNarrow(r, h) {
    this.narrowPanel(r, 'help', 32, 8);
    const cols = Math.max(4, r.w >> 3);
    const centred = (s, y) => r.drawString(this.conchars, s, (r.w - s.length * 8) >> 1, y, true);
    const skill = ['easy', 'medium', 'hard'][h.SKILL] ?? 'hard+';
    r.drawString(this.conchars, skill, r.w - skill.length * 8 - 2, 2, true);
    let y = 10;
    const countsY = r.h - 26;   // the three count lines at the bottom
    const text = (msg) => {
      if (!msg) return;
      for (const line of String(msg).split(/\\n|\n/)) for (const part of wrap(line, cols)) { if (y + 8 > countsY - 2) return; centred(part, y); y += 8; }
      y += 4;
    };
    text(h.LEVEL_MSG); text(h.HELP_MSG); text(h.HELP_MSG2);
    centred(`kills ${h.KILLED ?? 0}/${h.TOTAL_MONSTERS ?? 0}`, countsY);
    centred(`goals ${h.FOUND_GOALS ?? 0}/${h.TOTAL_GOALS ?? 0}`, countsY + 8);
    centred(`secrets ${h.FOUND_SECRETS ?? 0}/${h.TOTAL_SECRETS ?? 0}`, countsY + 16);
  }

  /**
   * CL_DrawInventory: every item held with its key and count, 17 lines scrolled around the selected one,
   * which is drawn in the plain font with a blinking cursor; the rest in the alternate font. In a narrower
   * view the panel is scaled behind, the lines are as many as the height holds and cut to the width, the
   * key column two wide. items: [index, count] rows in itemlist order.
   */
  drawInventory(r, items, selected, realtime) {
    const isNarrow = narrow(r);
    let x, y, lines, keyWidth, cols;
    if (!isNarrow) {
      x = (r.w - 256) >> 1; y = (r.h - 240) >> 1;
      const panel = this.pic('inventory');
      if (panel) r.drawPic(panel, x, y + 8);
      y += 24; x += 24; lines = 17; keyWidth = 6; cols = Infinity;
    } else {
      this.narrowPanel(r, 'inventory', 32, 8);
      x = 10; y = 2; keyWidth = 2; cols = Math.max(4, (r.w - x) >> 3);
      lines = Math.max(1, (r.h - y - 16) >> 3);
    }
    const cut = (s) => (s.length > cols ? s.slice(0, cols) : s);
    r.drawString(this.conchars, cut(keyWidth === 6 ? 'hotkey ### item' : 'ky ### item'), x, y);
    r.drawString(this.conchars, cut(keyWidth === 6 ? '------ --- ----' : '-- --- ----'), x, y + 8);
    y += 16;
    const DISPLAY_ITEMS = lines;
    let selNum = 0;
    items.forEach(([idx], n) => { if (idx === selected) selNum = n; });
    let top = selNum - (DISPLAY_ITEMS >> 1);
    if (items.length - top < DISPLAY_ITEMS) top = items.length - DISPLAY_ITEMS;
    if (top < 0) top = 0;
    for (let i = top; i < items.length && i < top + DISPLAY_ITEMS; i++) {
      const [idx, cnt] = items[i];
      const line = cut(`${(ITEM_KEYS[idx] ?? '').padStart(keyWidth)} ${String(cnt).padStart(3)} ${ITEMS[idx]?.[0] ?? ''}`);
      if (idx !== selected) r.drawString(this.conchars, line, x, y, true);
      else {
        if (Math.floor(realtime * 10) & 1) r.drawChar(this.conchars, 15, x - 8, y);
        r.drawString(this.conchars, line, x, y);
      }
      y += 8;
    }
  }

  /**
   * DeathmatchScoreboardMessage as the client laid it out: the clients sorted by score, up to six a column,
   * each with its tag (tag1 for the one whose screen this is), its name, "Score:" with the frags in the
   * alternate font, the ping (a guest's round trip over the network, which the host measures; 0 at the page itself)
   * and the minutes in the game; the skin icon the demo pak lacks.
   * rows: [{ id, name, score, ping, time }] (`name` the client's netname, "player N" without one; `ping` in whole
   * milliseconds; `time` in seconds); self: the client whose screen this is.
   */
  drawScores(r, rows, self, time) {
    const sorted = [...rows].sort((a, b) => b.score - a.score || a.id - b.id).slice(0, 12);
    if (narrow(r)) {
      // one column, two lines a client (the name over its tag where the tag fits, the score and the minutes), as
      // many as the height holds
      const cols = Math.max(4, r.w >> 3), per = 20, fit = Math.max(1, Math.floor((r.h - 4) / per));
      sorted.slice(0, fit).forEach((c, i) => {
        const y = 4 + i * per;
        const tag = this.pic(c.id === self ? 'tag1' : 'tag2');
        if (tag && tag.w <= r.w - 4) r.drawPic(tag, 2, y);
        r.drawString(this.conchars, (c.name || `player ${c.id}`).slice(0, cols), 2, y);
        const score = String(c.score ?? 0), mins = `  Time: ${Math.floor(Math.max(0, time - (c.time ?? 0)) / 60)}`;
        r.drawString(this.conchars, 'Score: ', 2, y + 8);
        r.drawString(this.conchars, score, 2 + 7 * 8, y + 8, true);
        if ((7 + score.length + mins.length) <= cols) r.drawString(this.conchars, mins, 2 + (7 + score.length) * 8, y + 8);
      });
      return;
    }
    const xv = (r.w >> 1) - 160, yv = (r.h >> 1) - 120;
    sorted.forEach((c, i) => {
      const x = xv + (i >= 6 ? 160 : 0), y = yv + 32 + 32 * (i % 6);
      const tag = this.pic(c.id === self ? 'tag1' : 'tag2');
      if (tag) r.drawPic(tag, x + 32, y);
      r.drawString(this.conchars, c.name || `player ${c.id}`, x + 32, y);
      r.drawString(this.conchars, 'Score: ', x + 32, y + 8);
      r.drawString(this.conchars, String(c.score ?? 0), x + 32 + 7 * 8, y + 8, true);
      r.drawString(this.conchars, `Ping:  ${Math.min(999, Math.max(0, Math.round(c.ping ?? 0)))}`, x + 32, y + 16);
      r.drawString(this.conchars, `Time:  ${Math.floor(Math.max(0, time - (c.time ?? 0)) / 60)}`, x + 32, y + 24);
    });
  }

  /** cstring2: each line centred in the 320 wide virtual screen, in the alternate font. */
  cstring(r, s, x, y) {
    for (const line of String(s).split(/\\n|\n/)) {
      r.drawString(this.conchars, line, x + ((320 - line.length * 8) >> 1), y, true);
      y += 8;
    }
  }

  /**
   * SCR_DrawCenterString: each line centred. A line longer than the view is wide (a quarter of a split screen; the
   * game's messages fit 320) wraps at its spaces, so none runs off the sides.
   */
  drawCenter(r, msg, y) {
    const cols = Math.max(1, r.w >> 3);
    for (const line of String(msg).split(/\\n|\n/)) {
      for (const part of wrap(line, cols)) {
        r.drawString(this.conchars, part, (r.w - part.length * 8) >> 1, y);
        y += 8;
      }
    }
  }
}

/** A view narrower or shorter than the 320×240 the screens were laid out for: a split screen's quarter at 320×240. */
const narrow = (r) => r.w < 320 || r.h < 240;

/** A line in pieces of at most `cols` characters, broken at spaces where there are any (a word longer is cut). */
export function wrap(line, cols) {
  if (line.length <= cols) return [line];
  const out = [];
  let rest = line;
  while (rest.length > cols) {
    let cut = rest.lastIndexOf(' ', cols);
    if (cut <= 0) cut = cols;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

const gunAnims = (mdl) => mdl.anims ?? (mdl.anims = Object.fromEntries(mdl.animations().map((a) => [a.name, a])));

/** The frame of the weapon in hand: the 'pow' run while a shot plays, else the idle loop. */
export function viewFrame(mdl, hud, time) {
  const anims = gunAnims(mdl);
  const pow = anims.pow ?? anims.throw;
  const idle = anims.idle ?? anims.idle1 ?? anims[Object.keys(anims)[0]];
  if (hud.GRENADE_TIME > 0 && anims.throw) return anims.throw.first + Math.min(3, Math.floor((time - hud.GRENADE_TIME) * 10));
  const dur = hud.ATTACK_FINISHED - hud.ATTACK_START;
  if (pow && dur > 0 && time < hud.ATTACK_FINISHED && time >= hud.ATTACK_START) {
    const k = Math.min(pow.count - 1, Math.floor(((time - hud.ATTACK_START) / dur) * pow.count));
    return pow.first + k;
  }
  if (!idle) return 0;
  return idle.first + (Math.floor(time * 10) % idle.count);
}

/**
 * The weapon's frame with the one it stepped from and the blend between them (CL_AddViewWeapon's oldframe and
 * backlerp): [frame, oldframe, backlerp], the blend 1 as a step comes and 0 as the next is due.
 */
export function viewFrameLerp(mdl, hud, time) {
  const anims = gunAnims(mdl);
  const pow = anims.pow ?? anims.throw;
  const dur = hud.ATTACK_FINISHED - hud.ATTACK_START;
  let step = 0.1, phase = (time * 10) % 1;
  if (hud.GRENADE_TIME > 0 && anims.throw) phase = ((time - hud.GRENADE_TIME) * 10) % 1;
  else if (pow && dur > 0 && time < hud.ATTACK_FINISHED && time >= hud.ATTACK_START) { step = dur / pow.count; phase = ((time - hud.ATTACK_START) / step) % 1; }
  const f = viewFrame(mdl, hud, time), o = viewFrame(mdl, hud, time - step);
  return o === f ? [f, f, 0] : [f, o, 1 - phase];
}
