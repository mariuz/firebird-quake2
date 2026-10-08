// menu.js – Quake 2's menus (client/menu.c on client/qmenu.c, win32/vid_menu.c's video menu), drawn
// into the 8-bit frame over the paused game: the main menu with its spinning cursor, the game menu
// (a new game at a skill, load, save), the fifteen save slots, the options and video menus bound to
// the page's settings, and the quit screen. The page supplies `host` for everything the menus act on.

const MENU_IN = 'misc/menu1.wav', MENU_MOVE = 'misc/menu2.wav', MENU_OUT = 'misc/menu3.wav';
const RCOLUMN_OFFSET = 16, LCOLUMN_OFFSET = -16, SLIDER_RANGE = 10;
const MAX_SAVEGAMES = 15;
const NUM_CURSOR_FRAMES = 15;
const MAIN_ITEMS = ['m_main_game', 'm_main_multiplayer', 'm_main_options', 'm_main_video', 'm_main_quit'];
const YESNO = ['no', 'yes'];

/** qmenu's item kinds: action (left-justified or not), slider, spin control, separator. */
const action = (name, y, callback, extra = {}) => ({ type: 'action', name, x: 0, y, callback, ...extra });
const slider = (name, y, min, max, get, set) => ({ type: 'slider', name, x: 0, y, min, max, get, set });
const spin = (name, y, items, get, set) => ({ type: 'spin', name, x: 0, y, items, get, set });
const separator = () => ({ type: 'separator', x: 0, y: 0 });

export class Menu {
  /**
   * host: { hud, playing(), newGame(skill), slots() → [{ valid, name }] × 15, loadSlot(i), saveSlot(i),
   *         get(key), set(key, value), console(), quit(), sound(name) }
   */
  constructor(host) {
    this.host = host;
    this.layers = [];      // the menus under the current one (m_layers)
    this.current = null;   // { draw, key } of the menu showing
    this.mainCursor = 0;
    this.loadCursor = 0;
    this.saveCursor = 0;
  }

  get active() { return !!this.current; }

  // ── the stack (M_PushMenu, M_PopMenu, M_ForceMenuOff) ─────────────────────
  push(menu) {
    // a menu already open drops back to its level, so hotkeys don't stack menus
    const at = this.layers.findIndex((m) => m.id === menu.id);
    if (at >= 0) this.layers.length = at;
    else if (this.current && this.current.id !== menu.id) this.layers.push(this.current);
    this.current = menu;
    this.host.sound(MENU_IN);
  }
  pop() {
    this.host.sound(MENU_OUT);
    this.current = this.layers.pop() ?? null;
  }
  off() {
    this.layers = [];
    this.current = null;
  }

  /** A key (a KeyboardEvent code) while a menu is up. */
  key(code) {
    if (!this.current) return;
    const s = this.current.key(code);
    if (s) this.host.sound(s);
  }

  /** realtime in milliseconds. */
  draw(r, realtime) {
    if (!this.current) return;
    fadeScreen(r);
    this.current.draw(r, realtime);
  }

  // ── drawing helpers ───────────────────────────────────────────────────────
  pic(name) { return this.host.hud.pic(name); }
  /** M_Banner: a title picture centred over the menu. */
  banner(r, name) {
    const p = this.pic(name);
    if (p) r.drawPic(p, (r.w >> 1) - (p.w >> 1), (r.h >> 1) - 110);
  }
  str(r, x, y, s, dark = false) { r.drawString(this.host.hud.conchars, s, x, y, dark); }
  /** Menu_DrawStringR2L: right-aligned, the last character at x. */
  strR2L(r, x, y, s, dark = false) { this.str(r, x - (s.length - 1) * 8, y, s, dark); }

  // ── qmenu: a framework of items ───────────────────────────────────────────
  /** A list menu: { id, x, y, items, cursor, banner, statusbar, onEscape } with the default keys. */
  framework(m) {
    m.cursor ??= 0;
    m.draw = (r, realtime) => {
      if (m.layout) m.layout(r);
      if (m.banner) this.banner(r, m.banner);
      adjustCursor(m, 1);
      this.drawFramework(r, m, realtime);
    };
    m.key = (code) => this.defaultKey(m, code);
    return m;
  }

  drawFramework(r, m, realtime) {
    for (const it of m.items) {
      const x = m.x + it.x, y = m.y + it.y;
      if (it.type === 'action') {
        const name = typeof it.name === 'function' ? it.name() : it.name;
        if (it.left) this.str(r, x + LCOLUMN_OFFSET, y, name, !!it.grayed);
        else this.strR2L(r, x + LCOLUMN_OFFSET, y, name, !!it.grayed);
      } else if (it.type === 'slider') {
        this.strR2L(r, x + LCOLUMN_OFFSET, y, it.name, true);
        const range = Math.max(0, Math.min(1, (it.get() - it.min) / (it.max - it.min)));
        const cc = this.host.hud.conchars;
        r.drawChar(cc, 128, x + RCOLUMN_OFFSET, y);
        let i = 0;
        for (; i < SLIDER_RANGE; i++) r.drawChar(cc, 129, RCOLUMN_OFFSET + x + i * 8 + 8, y);
        r.drawChar(cc, 130, RCOLUMN_OFFSET + x + i * 8 + 8, y);
        r.drawChar(cc, 131, Math.floor(8 + RCOLUMN_OFFSET + x + (SLIDER_RANGE - 1) * 8 * range), y);
      } else if (it.type === 'spin') {
        this.strR2L(r, x + LCOLUMN_OFFSET, y, it.name, true);
        this.str(r, x + RCOLUMN_OFFSET, y, it.items[it.get()] ?? '');
      }
    }
    // the cursor: a blinking arrow left of a left-justified item, else between the label and the value
    const it = m.items[m.cursor];
    if (it && it.type !== 'separator') {
      const ch = 12 + (Math.floor(realtime / 250) & 1);
      r.drawChar(this.host.hud.conchars, ch, it.left ? m.x + it.x - 24 : m.x, m.y + it.y);
    }
    // Menu_DrawStatusBar: the bottom line, dark blue with a message, else black
    const sb = it?.statusbar ?? m.statusbar;
    r.fillRect(0, r.h - 8, r.w, 8, sb ? 4 : 0);
    if (sb) this.str(r, ((r.w >> 3) >> 1) * 8 - (sb.length >> 1) * 8, r.h - 8, sb);
  }

  defaultKey(m, code) {
    switch (code) {
      case 'Escape': if (m.onEscape) m.onEscape(); this.pop(); return null;
      case 'ArrowUp': case 'Numpad8': m.cursor--; adjustCursor(m, -1); return MENU_MOVE;
      case 'Tab': case 'ArrowDown': case 'Numpad2': m.cursor++; adjustCursor(m, 1); return MENU_MOVE;
      case 'ArrowLeft': case 'Numpad4': this.slide(m, -1); return MENU_MOVE;
      case 'ArrowRight': case 'Numpad6': this.slide(m, 1); return MENU_MOVE;
      case 'Enter': case 'NumpadEnter': {
        const it = m.items[m.cursor];
        if (it?.type === 'action' && it.callback && !it.grayed) { if (m.onEnter) m.onEnter(); it.callback(); }
        return MENU_MOVE;
      }
    }
    return null;
  }

  /** Menu_SlideItem: a slider steps, a spin control turns, both clamped. */
  slide(m, dir) {
    const it = m.items[m.cursor];
    if (it?.type === 'slider') it.set(Math.max(it.min, Math.min(it.max, it.get() + dir)));
    else if (it?.type === 'spin') it.set(Math.max(0, Math.min(it.items.length - 1, it.get() + dir)));
  }

  // ── the menus ─────────────────────────────────────────────────────────────
  /** M_Menu_Main_f */
  main() {
    const draw = (r, realtime) => {
      const sizes = MAIN_ITEMS.map((n) => this.pic(n));
      const widest = Math.max(...sizes.map((p) => p?.w ?? 0));
      const ystart = (r.h >> 1) - 110;
      const xoffset = (r.w - widest + 70) >> 1;
      MAIN_ITEMS.forEach((n, i) => { if (i !== this.mainCursor && sizes[i]) r.drawPic(sizes[i], xoffset, ystart + i * 40 + 13); });
      const lit = this.pic(`${MAIN_ITEMS[this.mainCursor]}_sel`);
      if (lit) r.drawPic(lit, xoffset, ystart + this.mainCursor * 40 + 13);
      const cur = this.pic(`m_cursor${Math.floor(realtime / 100) % NUM_CURSOR_FRAMES}`);
      if (cur) r.drawPic(cur, xoffset - 25, ystart + this.mainCursor * 40 + 11);
      const plaque = this.pic('m_main_plaque'), logo = this.pic('m_main_logo');
      if (plaque) {
        r.drawPic(plaque, xoffset - 30 - plaque.w, ystart);
        if (logo) r.drawPic(logo, xoffset - 30 - plaque.w, ystart + plaque.h + 5);
      }
    };
    const key = (code) => {
      switch (code) {
        case 'Escape': this.pop(); return null;
        case 'ArrowDown': case 'Numpad2': this.mainCursor = (this.mainCursor + 1) % MAIN_ITEMS.length; return MENU_MOVE;
        case 'ArrowUp': case 'Numpad8': this.mainCursor = (this.mainCursor + MAIN_ITEMS.length - 1) % MAIN_ITEMS.length; return MENU_MOVE;
        case 'Enter': case 'NumpadEnter':
          [() => this.game(), () => this.multiplayer(), () => this.options(), () => this.video(), () => this.quitMenu()][this.mainCursor]();
          return null;
      }
      return null;
    };
    this.push({ id: 'main', draw, key });
  }

  /** M_Menu_Game_f: easy, medium, hard; load game, save game (the credits are left out) */
  game() {
    const start = (skill) => () => { this.off(); this.host.newGame(skill); };
    const m = this.framework({
      id: 'game', banner: 'm_banner_game', items: [
        action('easy', 0, start(0), { left: true }),
        action('medium', 10, start(1), { left: true }),
        action('hard', 20, start(2), { left: true }),
        separator(),
        action('load game', 40, () => this.loadMenu(), { left: true }),
        action('save game', 50, () => this.saveMenu(), { left: true }),
      ],
    });
    m.layout = (r) => { m.x = r.w >> 1; m.y = (r.h - (m.items[m.items.length - 1].y + 10)) >> 1; };
    this.push(m);
  }

  /** M_Menu_LoadGame_f: the fifteen slots, the autosave (save0) set apart above the rest */
  loadMenu() {
    const slots = this.host.slots();
    const items = slots.map((s, i) => action(s.valid ? s.name : '<EMPTY>', i * 10 + (i > 0 ? 10 : 0),
      () => { this.off(); if (s.valid) this.host.loadSlot(i); }, { left: true }));
    const m = this.framework({ id: 'load', banner: 'm_banner_load_game', items, cursor: this.loadCursor });
    m.layout = (r) => { m.x = (r.w >> 1) - 120; m.y = (r.h >> 1) - 58; };
    // LoadGame_MenuKey: leaving, the save menu's cursor follows (one slot less: it has no autosave)
    m.onEnter = m.onEscape = () => { this.loadCursor = m.cursor; this.saveCursor = Math.max(0, m.cursor - 1); };
    this.push(m);
  }

  /** M_Menu_SaveGame_f: slots 1-14 (save0 is the autosave), only while a game is being played */
  saveMenu() {
    if (!this.host.playing()) return;
    const slots = this.host.slots();
    const items = [];
    for (let i = 0; i < MAX_SAVEGAMES - 1; i++) {
      const s = slots[i + 1];
      items.push(action(s.valid ? s.name : '<EMPTY>', i * 10, () => { this.off(); this.host.saveSlot(i + 1); }, { left: true }));
    }
    const m = this.framework({ id: 'save', banner: 'm_banner_save_game', items, cursor: this.saveCursor });
    m.layout = (r) => { m.x = (r.w >> 1) - 120; m.y = (r.h >> 1) - 58; };
    m.onEnter = m.onEscape = () => { this.saveCursor = m.cursor; this.loadCursor = m.cursor + 1; };
    this.push(m);
  }

  /** M_Menu_Multiplayer_f: shown as it was, but there is no network here */
  multiplayer() {
    const m = this.framework({
      id: 'multiplayer', banner: 'm_banner_multiplayer', statusbar: 'there is no network in this port', items: [
        action('join network server', 0, null, { left: true, grayed: true }),
        action('start network server', 10, null, { left: true, grayed: true }),
        action('player setup', 20, null, { left: true, grayed: true }),
      ],
    });
    m.layout = (r) => { m.x = (r.w >> 1) - 64; m.y = (r.h - 30) >> 1; };
    this.push(m);
  }

  /** M_Menu_Options_f: the options that the page has (sound quality, lookspring and the like have no meaning here) */
  options() {
    const h = this.host;
    const m = this.framework({
      id: 'options', banner: 'm_banner_options', items: [
        slider('effects volume', 0, 0, 10, () => Math.round(h.get('sfx') / 10), (v) => h.set('sfx', v * 10)),
        spin('CD music', 10, ['disabled', 'enabled'], () => (h.get('musicMode') === 'off' ? 0 : 1), (v) => h.set('musicMode', v ? 'tracks' : 'off')),
        slider('mouse speed', 30, 2, 22, () => Math.round(h.get('sensitivity') * 2), (v) => h.set('sensitivity', v / 2)),
        spin('always run', 40, YESNO, () => (h.get('alwaysRun') ? 1 : 0), (v) => h.set('alwaysRun', !!v)),
        spin('invert mouse', 50, YESNO, () => (h.get('invertMouse') ? 1 : 0), (v) => h.set('invertMouse', !!v)),
        spin('crosshair', 60, ['none', 'cross', 'dot', 'angle'], () => h.get('crosshair'), (v) => h.set('crosshair', v)),
        action('reset defaults', 80, () => h.resetDefaults()),
        action('go to console', 90, () => { this.off(); h.console(); }),
      ],
    });
    m.layout = (r) => { m.x = r.w >> 1; m.y = (r.h >> 1) - 58; };
    this.push(m);
  }

  /** VID_MenuInit: the driver is the page's renderer mode, the video mode its detail */
  video() {
    const h = this.host;
    const before = { renderer: h.get('renderer'), detail: h.get('detail'), brightness: h.get('brightness'), fullscreen: h.get('fullscreen') };
    const m = this.framework({
      id: 'video', banner: 'm_banner_video', items: [
        spin('driver', 0, ['[SQL picks faces]', '[SQL projects   ]'], () => (h.get('renderer') === 'sql' ? 1 : 0), (v) => h.set('renderer', v ? 'sql' : 'fast')),
        spin('video mode', 10, ['[160 120  ]', '[320 240  ]', '[640 480  ]'], () => Math.max(0, ['low', 'high', 'ultra'].indexOf(h.get('detail'))), (v) => h.set('detail', ['low', 'high', 'ultra'][v])),
        slider('brightness', 30, 10, 18, () => Math.round(h.get('brightness') * 10), (v) => h.set('brightness', v / 10)),
        spin('fullscreen', 40, YESNO, () => (h.get('fullscreen') ? 1 : 0), (v) => h.set('fullscreen', !!v)),
        action('reset to defaults', 90, () => h.resetVideo()),
        action('cancel', 100, () => { for (const [k, v] of Object.entries(before)) h.set(k, v); this.pop(); }),
      ],
    });
    m.layout = (r) => { m.x = (r.w >> 1) - 8; m.y = (r.h - 110) >> 1; };
    this.push(m);
  }

  /** M_Menu_Quit_f: the quit picture; Y quits, N or Escape goes back */
  quitMenu() {
    const draw = (r) => {
      const p = this.pic('quit');
      if (p) r.drawPic(p, (r.w - p.w) >> 1, (r.h - p.h) >> 1);
    };
    const key = (code) => {
      if (code === 'Escape' || code === 'KeyN') { this.pop(); return null; }
      if (code === 'KeyY') { this.off(); this.host.quit(); }
      return null;
    };
    this.push({ id: 'quit', draw, key });
  }
}

/** Menu_AdjustCursor: off a separator (or off the end), crawl in the direction given to an item that is not one */
function adjustCursor(m, dir) {
  const n = m.items.length;
  if (m.cursor >= 0 && m.cursor < n && m.items[m.cursor].type !== 'separator') return;
  for (let guard = 0; guard <= n; guard++) {
    if (m.cursor < 0) m.cursor = n - 1;
    if (m.cursor >= n) m.cursor = 0;
    if (m.items[m.cursor].type !== 'separator') return;
    m.cursor += dir;
  }
}

/** ref_soft's Draw_FadeScreen: three pixels in four go black, in a pattern that shifts every other line. */
function fadeScreen(r) {
  const { fb, w, h } = r;
  for (let y = 0; y < h; y++) {
    const t = (y & 1) << 1, row = y * w;
    for (let x = 0; x < w; x++) if ((x & 3) !== t) fb[row + x] = 0;
  }
}

/** The save comment SV_WriteServerFile wrote: "ENTERING <level>" for the autosave, else the time and the level. */
export function saveComment(levelName, autosave, now = new Date()) {
  if (autosave) return `ENTERING ${levelName}`.slice(0, 31);
  const p2 = (n) => String(n).padStart(2);
  const m = now.getMinutes();
  return `${p2(now.getHours())}:${Math.floor(m / 10)}${m % 10} ${p2(now.getMonth() + 1)}/${p2(now.getDate())}  ${levelName}`.slice(0, 31);
}
