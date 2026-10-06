// hud.js – cl_scrn.c's status bar layout, drawn into the 8-bit frame from
// the pics/*.pcx pictures: health, the current weapon's ammo and armour
// along the bottom, keys and timed powerups on the right, the crosshair.

import { pic } from './pak.js';
import { WEAPONS, AMMO_ICONS, ARMOR_ICONS, KEY_ICONS } from './gamedata.js';

export class Hud {
  constructor(pak) {
    this.pak = pak;
    this.cache = new Map();
    this.conchars = pic(pak, 'conchars');
    this.nums = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => pic(pak, `num_${i}`));
    this.anums = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => pic(pak, `anum_${i}`));
    this.numMinus = pic(pak, 'num_minus');
    this.anumMinus = pic(pak, 'anum_minus');
    this.crosshair = pic(pak, 'ch1');
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
    const yb = h - 24;
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
    // armour
    if (hud.ARMOR > 0 && hud.ARMOR_TYPE > 0) {
      this.drawNum(r, x0 + 200, yb, hud.ARMOR, 3, false);
      r.drawPic(this.pic(ARMOR_ICONS[hud.ARMOR_TYPE]), x0 + 250, yb);
    } else if (hud.POWER_ARMOR > 0) {
      this.drawNum(r, x0 + 200, yb, hud.CELLS, 3, false);
      r.drawPic(this.pic(hud.POWER_ARMOR === 2 ? 'i_powershield' : 'i_powerscreen'), x0 + 250, yb);
    }
    // the weapon in hand, the keys and powerups up the right edge
    let y = yb - 26;
    if (wp) { r.drawPic(this.pic(wp.icon), x0 + 296, yb); }
    for (let i = 0; i < 9; i++) if (hud.KEYS & (1 << i)) { r.drawPic(this.pic(KEY_ICONS[i]), x0 + 296, y); y -= 26; }
    if (hud.QUAD) { r.drawPic(this.pic('p_quad'), x0 + 296, y); y -= 26; }
    if (hud.INVINCIBLE) { r.drawPic(this.pic('p_invulnerability'), x0 + 296, y); y -= 26; }
    if (hud.ENVIRO) { r.drawPic(this.pic('p_envirosuit'), x0 + 296, y); y -= 26; }
    if (hud.BREATHER) { r.drawPic(this.pic('p_rebreather'), x0 + 296, y); y -= 26; }
    // crosshair
    if (!hud.DEAD && this.crosshair) r.drawPic(this.crosshair, (w >> 1) - 4, ((h) >> 1) - 4);
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
