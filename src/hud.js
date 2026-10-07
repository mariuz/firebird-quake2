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

  /** hud: the Q2_TIC row. time: game time. */
  draw(r, hud, time) {
    const w = r.w, h = r.h;
    const x0 = (w - 320) >> 1;
    const yb = h - 24, y2 = h - 50;
    const frame = Math.floor(time * 10);
    // health
    const hp = hud.HEALTH;
    this.drawNum(r, x0, yb, hp, 3, hp <= 25 || (hp > 0 && time - hud.DMG_TIME < 0.4 && Math.floor(time * 10) % 2 === 0));
    r.drawPic(this.pic('i_health'), x0 + 50, yb);
    // ammo
    const wp = WEAPONS[hud.WEAPON];
    if (wp && wp.ammo) {
      const cnt = hud[wp.ammo.toUpperCase()];
      this.drawNum(r, x0 + 100, yb, cnt, 3, cnt <= 5);
      r.drawPic(this.pic(AMMO_ICONS[wp.ammo]), x0 + 150, yb);
    }
    // armour: power armour that is on, with its cells, flashing with the other armour's count when there is some
    const armor = hud.ARMOR > 0 && hud.ARMOR_TYPE > 0;
    if (hud.POWER_ARMOR > 0 && (!armor || (frame & 8))) {
      this.drawNum(r, x0 + 200, yb, hud.CELLS, 3, false);
      r.drawPic(this.pic('i_powershield'), x0 + 250, yb);
    } else if (armor) {
      this.drawNum(r, x0 + 200, yb, hud.ARMOR, 3, false);
      r.drawPic(this.pic(ARMOR_ICONS[hud.ARMOR_TYPE]), x0 + 250, yb);
    }
    // the selected item
    if (hud.INV_SEL > 0 && ITEMS[hud.INV_SEL]) r.drawPic(this.pic(ITEMS[hud.INV_SEL][1]), x0 + 296, yb);
    // the item just picked up: its icon and name
    const got = ITEMS[hud.PICKUP_ITEM];
    if (got) {
      r.drawPic(this.pic(got[1]), x0, y2);
      r.drawString(this.conchars, got[0], x0 + 26, h - 42);
    }
    // the powerup timer: seconds left and the powerup's icon
    if (hud.TIMER_ICON > 0) {
      this.drawNum(r, x0 + 262, y2, hud.TIMER, 2, false);
      r.drawPic(this.pic(TIMER_ICONS[hud.TIMER_ICON]), x0 + 296, y2);
    }
    // STAT_HELPICON: news on the help computer, else the weapon in hand when the view's fov hides the gun
    if (hud.HELP_ICON) r.drawPic(this.pic('i_help'), x0 + 148, y2);
    else if (wp && hud.FOV > 91) r.drawPic(this.pic(wp.icon), x0 + 148, y2);
    // SCR_DrawCrosshair: ch1-ch3 by the crosshair setting, centred
    const ch = hud.CROSSHAIR ? this.pic(`ch${hud.CROSSHAIR}`) : null;
    if (!hud.DEAD && ch) r.drawPic(ch, (w - ch.w) >> 1, (h - ch.h) >> 1);
  }

  /**
   * The help computer (HelpComputer in p_hud.c): the skill, the level's name, the two messages
   * target_help left, and the level's counts, laid out on the 320×240 virtual screen.
   */
  drawHelp(r, h) {
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

  /**
   * CL_DrawInventory: every item held with its key and count, 17 lines scrolled around the selected one,
   * which is drawn in the plain font with a blinking cursor; the rest in the alternate font.
   * items: [index, count] rows in itemlist order.
   */
  drawInventory(r, items, selected, realtime) {
    let x = (r.w - 256) >> 1, y = (r.h - 240) >> 1;
    const panel = this.pic('inventory');
    if (panel) r.drawPic(panel, x, y + 8);
    y += 24; x += 24;
    r.drawString(this.conchars, 'hotkey ### item', x, y);
    r.drawString(this.conchars, '------ --- ----', x, y + 8);
    y += 16;
    const DISPLAY_ITEMS = 17;
    let selNum = 0;
    items.forEach(([idx], n) => { if (idx === selected) selNum = n; });
    let top = selNum - (DISPLAY_ITEMS >> 1);
    if (items.length - top < DISPLAY_ITEMS) top = items.length - DISPLAY_ITEMS;
    if (top < 0) top = 0;
    for (let i = top; i < items.length && i < top + DISPLAY_ITEMS; i++) {
      const [idx, cnt] = items[i];
      const line = `${(ITEM_KEYS[idx] ?? '').padStart(6)} ${String(cnt).padStart(3)} ${ITEMS[idx]?.[0] ?? ''}`;
      if (idx !== selected) r.drawString(this.conchars, line, x, y, true);
      else {
        if (Math.floor(realtime * 10) & 1) r.drawChar(this.conchars, 15, x - 8, y);
        r.drawString(this.conchars, line, x, y);
      }
      y += 8;
    }
  }

  /** cstring2: each line centred in the 320 wide virtual screen, in the alternate font. */
  cstring(r, s, x, y) {
    for (const line of String(s).split(/\\n|\n/)) {
      r.drawString(this.conchars, line, x + ((320 - line.length * 8) >> 1), y, true);
      y += 8;
    }
  }

  drawCenter(r, msg, y) {
    const lines = String(msg).split(/\\n|\n/);
    for (const line of lines) {
      r.drawString(this.conchars, line, (r.w - line.length * 8) >> 1, y);
      y += 8;
    }
  }
}

/** The frame of the weapon in hand: the 'pow' run while a shot plays, else the idle loop. */
export function viewFrame(mdl, hud, time) {
  const anims = mdl.anims ?? (mdl.anims = Object.fromEntries(mdl.animations().map((a) => [a.name, a])));
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
