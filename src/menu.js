// menu.js – Quake 2's menus (client/menu.c on client/qmenu.c, win32/vid_menu.c's video menu), drawn
// into the 8-bit frame over the paused game: the main menu with its spinning cursor, the game menu
// (a new game at a skill, load, save, the credits), the fifteen save slots, the options and video menus bound to
// the page's settings, the keys menu that rebinds them, and the quit screen. The page supplies `host` for
// everything the menus act on.

import { ACTIONS, keyName } from './input.js';

const MENU_IN = 'misc/menu1.wav', MENU_MOVE = 'misc/menu2.wav', MENU_OUT = 'misc/menu3.wav';
const RCOLUMN_OFFSET = 16, LCOLUMN_OFFSET = -16, SLIDER_RANGE = 10;
const MAX_SAVEGAMES = 15;
const NUM_CURSOR_FRAMES = 15;
const MAIN_ITEMS = ['m_main_game', 'm_main_multiplayer', 'm_main_options', 'm_main_video', 'm_main_quit'];
const YESNO = ['no', 'yes'];
/** The players spin's choices, in the order of the page's select (one; two to four in coop; two to four in deathmatch). */
export const PLAYERS = ['one', 'two (coop)', 'three (coop)', 'four (coop)', 'two (deathmatch)', 'three (deathmatch)', 'four (deathmatch)'];

/** qmenu's item kinds: action (left-justified or not), slider, spin control, text field, separator. */
const action = (name, y, callback, extra = {}) => ({ type: 'action', name, x: 0, y, callback, ...extra });
const slider = (name, y, min, max, get, set) => ({ type: 'slider', name, x: 0, y, min, max, get, set });
const spin = (name, y, items, get, set) => ({ type: 'spin', name, x: 0, y, items, get, set });
/** menufield_s: a text of at most `length` characters, `visible` of them shown (`numbers`: QMF_NUMBERSONLY, the digits alone typed). */
const field = (name, y, length, visible, get, set, extra = {}) => ({ type: 'field', name, x: 0, y, length, visible, get, set, ...extra });
const separator = () => ({ type: 'separator', x: 0, y: 0 });
/** The handedness spin's choices (M_Menu_PlayerConfig_f's handedness_box), in the hand cvar's order. */
export const HANDS = ['right', 'left', 'center'];
/** The start server menu's rules (StartServer_MenuInit's dm_coop_names, with the page's single player first). */
export const RULES = ['single player', 'cooperative', 'deathmatch'];

export class Menu {
  /**
   * host: { hud, playing(), newGame(skill), slots() → [{ valid, name }] × 15, loadSlot(i), saveSlot(i),
   *         downloadSlot(i), get(key), set(key, value), resetDefaults(), resetVideo(), bind(action, code), unbind(action),
   *         credits() → lines, console(), quit(), sound(name), netHost(), netJoin() (the last two optional: greyed without),
   *         maps() → the pak's map names, gameMode() → { coop, deathmatch, players }, setGameMode({ coop, deathmatch, players }),
   *         startServer(map) (the start server menu's) }
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

  /** A key (a KeyboardEvent code, and its character where the key types one) while a menu is up. */
  key(code, char = null) {
    if (!this.current) return;
    const s = this.current.key(code, char);
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
    m.key = (code, char) => this.defaultKey(m, code, char);
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
      } else if (it.type === 'field') {
        // Field_Draw: the label, a box of the conchars' frame pieces (18-20 above, 24-26 below) around the text's
        // last `visible` characters, and, with the cursor on it, a blinking cursor after the text
        this.strR2L(r, x + LCOLUMN_OFFSET, y, it.name, true);
        const cc = this.host.hud.conchars;
        r.drawChar(cc, 18, x + RCOLUMN_OFFSET, y - 4); r.drawChar(cc, 24, x + RCOLUMN_OFFSET, y + 4);
        r.drawChar(cc, 20, x + RCOLUMN_OFFSET + 8 + it.visible * 8, y - 4); r.drawChar(cc, 26, x + RCOLUMN_OFFSET + 8 + it.visible * 8, y + 4);
        for (let i = 0; i < it.visible; i++) { r.drawChar(cc, 19, x + RCOLUMN_OFFSET + 8 + i * 8, y - 4); r.drawChar(cc, 25, x + RCOLUMN_OFFSET + 8 + i * 8, y + 4); }
        const text = String(it.get() ?? '');
        const shown = text.length > it.visible ? text.slice(text.length - it.visible) : text;
        this.str(r, x + RCOLUMN_OFFSET + 8, y, shown);
        if (m.items[m.cursor] === it && (Math.floor(realtime / 250) & 1)) r.drawChar(cc, 11, x + RCOLUMN_OFFSET + 8 + Math.min(shown.length, it.visible - 1) * 8, y);
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

  defaultKey(m, code, char = null) {
    // Field_Key: a text field under the cursor takes the printable keys and Backspace first (Menu_Keydown gave the
    // field the key before the menu's own keys; the arrows, Tab, Enter and Escape fall through to those)
    const it = m.items[m.cursor];
    if (it?.type === 'field') {
      if (code === 'Backspace') { const t = String(it.get() ?? ''); if (t.length) it.set(t.slice(0, -1)); return null; }
      if (typeof char === 'string' && char.length === 1 && char >= ' ' && char <= '~' && code !== 'Tab') {
        if (it.numbers && !(char >= '0' && char <= '9')) return null;
        const t = String(it.get() ?? '');
        if (t.length < it.length) it.set(t + char);
        return null;
      }
    }
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

  /**
   * M_Menu_Game_f: easy, medium, hard; load game, save game, credits. The players spin
   * is this port's: a new game at a skill is for one player, or two to four in coop or deathmatch (the view
   * split, the gamepads the others'), which Quake 2 reached through its network menu.
   */
  game() {
    const h = this.host;
    const start = (skill) => () => { this.off(); h.newGame(skill); };
    const m = this.framework({
      id: 'game', banner: 'm_banner_game', items: [
        action('easy', 0, start(0), { left: true }),
        action('medium', 10, start(1), { left: true }),
        action('hard', 20, start(2), { left: true }),
        separator(),
        spin('players', 40, PLAYERS, () => h.get('players') ?? 0, (v) => h.set('players', v)),
        separator(),
        action('load game', 60, () => this.loadMenu(), { left: true }),
        action('save game', 70, () => this.saveMenu(), { left: true }),
        action('credits', 80, () => this.credits(), { left: true }),
      ],
    });
    m.layout = (r) => { m.x = r.w >> 1; m.y = (r.h - (m.items[m.items.length - 1].y + 10)) >> 1; };
    this.push(m);
  }

  /**
   * M_Menu_Credits_f: the credits scrolled up the screen, a line every ten pixels rising a pixel every 40 ms,
   * a line that starts with '+' in the highlighted font, each centred; once the last line is off the top they
   * start again from the bottom. Escape leaves.
   */
  credits(now = null) {
    const lines = this.host.credits();
    let start = now;
    const draw = (r, realtime) => {
      start ??= realtime;
      let y = r.h - (realtime - start) / 40;
      for (let i = 0; i < lines.length && y < r.h; y += 10, i++) {
        if (y <= -8) continue;
        const bold = lines[i][0] === '+';
        const s = bold ? lines[i].slice(1) : lines[i];
        const x = (r.w - s.length * 8) >> 1;
        for (let j = 0; j < s.length; j++) r.drawChar(this.host.hud.conchars, (s.charCodeAt(j) & 127) + (bold ? 128 : 0), x + j * 8, Math.floor(y));
      }
      if (y < 0) start = realtime;
    };
    const key = (code) => { if (code === 'Escape') this.pop(); return null; };
    this.push({ id: 'credits', draw, key, get start() { return start; } });
  }

  /**
   * M_Menu_Keys_f: every bindable action with its keys (Key_KeynumToString's names, "or" between two), nine
   * pixels a row, the cursor an '=' while a key is awaited: Enter asks for a key for the action (the next key
   * pressed binds it, taking it from whatever it was bound to; Escape and the backquote cancel), Backspace or
   * Delete unbinds. The status bar says which.
   */
  keysMenu() {
    const h = this.host;
    const IDLE = 'enter to change, backspace to clear', GRAB = 'press a key or button for this action';
    const m = this.framework({
      id: 'keys', banner: 'm_banner_customize', statusbar: IDLE,
      items: ACTIONS.map((a, i) => action(a.name, i * 9, null, { grayed: true, action: a.id })),
    });
    m.grab = false;
    m.layout = (r) => { m.x = r.w >> 1; m.y = (r.h - (ACTIONS.length * 9)) >> 1; };
    const base = m.draw;
    m.draw = (r, realtime) => {
      base(r, realtime);
      // DrawKeyBindingFunc: the keys after the column, "???" for none
      const binds = h.get('binds') ?? {};
      for (const it of m.items) {
        const keys = binds[it.action] ?? [];
        const x = m.x + RCOLUMN_OFFSET, y = m.y + it.y;
        if (!keys.length) { this.str(r, x, y, '???'); continue; }
        const name = keyName(keys[0]);
        this.str(r, x, y, name);
        if (keys[1]) { this.str(r, x + 8 + name.length * 8, y, 'or'); this.str(r, x + 32 + name.length * 8, y, keyName(keys[1])); }
      }
      // KeyCursorDrawFunc: '=' while a key is awaited (the framework drew the blinking arrow)
      if (m.grab) r.drawChar(this.host.hud.conchars, 61, m.x, m.y + m.items[m.cursor].y);
    };
    m.key = (code) => {
      const it = m.items[m.cursor];
      if (m.grab) {
        if (code !== 'Escape' && code !== 'Backquote') h.bind(it.action, code);
        m.grab = false; m.statusbar = IDLE;
        return MENU_OUT;
      }
      switch (code) {
        case 'Enter': case 'NumpadEnter': m.grab = true; m.statusbar = GRAB; return MENU_IN;   // KeyBindingFunc
        case 'Backspace': case 'Delete': case 'NumpadDecimal': h.unbind(it.action); return MENU_OUT;
        default: return this.defaultKey(m, code);
      }
    };
    this.push(m);
  }

  /**
   * M_Menu_LoadGame_f: the fifteen slots, the autosave (save0) set apart above the rest. This port's own: d on a
   * slot with a game writes it as a file (the host's downloadSlot), the menu staying up; the status bar says so.
   */
  loadMenu() {
    const slots = this.host.slots();
    const items = slots.map((s, i) => action(s.valid ? s.name : '<EMPTY>', i * 10 + (i > 0 ? 10 : 0),
      () => { this.off(); if (s.valid) this.host.loadSlot(i); }, { left: true, statusbar: s.valid && this.host.downloadSlot ? 'enter loads, d writes the game as a file' : null }));
    const m = this.framework({ id: 'load', banner: 'm_banner_load_game', items, cursor: this.loadCursor });
    m.layout = (r) => { m.x = (r.w >> 1) - 120; m.y = (r.h >> 1) - 58; };
    // LoadGame_MenuKey: leaving, the save menu's cursor follows (one slot less: it has no autosave)
    m.onEnter = m.onEscape = () => { this.loadCursor = m.cursor; this.saveCursor = Math.max(0, m.cursor - 1); };
    m.key = (code, char) => {
      if (code === 'KeyD' && slots[m.cursor]?.valid && this.host.downloadSlot) { this.host.downloadSlot(m.cursor); return MENU_IN; }
      return this.defaultKey(m, code, char);
    };
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

  /**
   * M_Menu_Multiplayer_f: join and start network server are the page's Join and Host (the host's netJoin and
   * netHost: the menu goes away and the page's panel shows under the view, as M_Menu_JoinServer_f and
   * M_Menu_StartServer_f opened theirs; greyed where the page has none), the player setup live, the deathmatch
   * options, and start server: M_Menu_StartServer_f's menu for a game at this page
   */
  multiplayer() {
    const h = this.host;
    const net = (fn, how) => (fn ? { callback: () => { this.off(); fn(); }, statusbar: how } : { callback: null, grayed: true, statusbar: 'the network game has the page\'s own buttons' });
    const join = net(h.netJoin, 'join a game over the network: the host\'s offer, or its code, goes in the box under the view');
    const start = net(h.netHost, 'host a game over the network: the offer, or its code, shows under the view');
    const m = this.framework({
      id: 'multiplayer', banner: 'm_banner_multiplayer', items: [
        action('join network server', 0, join.callback, { left: true, grayed: join.grayed, statusbar: join.statusbar }),
        action('start network server', 10, start.callback, { left: true, grayed: start.grayed, statusbar: start.statusbar }),
        action('player setup', 20, () => this.playerConfig(), { left: true }),
        action('deathmatch options', 30, () => this.dmOptions(), { left: true, statusbar: 'the dmflags for the next deathmatch, and the one running' }),
        action('start server', 40, () => this.startServer(), { left: true, statusbar: 'a game at this page: the map, the rules, the limits, the players, the hostname' }),
      ],
    });
    m.layout = (r) => { m.x = (r.w >> 1) - 64; m.y = (r.h - 50) >> 1; };
    this.push(m);
  }

  /**
   * M_Menu_StartServer_f: a game at this page as StartServer_MenuInit laid it out: the initial map (the pak's maps by
   * name, in place of maps.lst; the settings' map first), the rules (single player, cooperative, deathmatch: the page's
   * mode, latched for the next game as the coop and deathmatch cvars were), the time limit and the frag limit (numbers-only
   * fields, QMF_NUMBERSONLY, each key writing the cvar: the next game's and the game running's), the max players (two to
   * four at this page, the rules allowing), the hostname (twelve characters, as its field had), the deathmatch flags
   * (M_Menu_DMOptions_f, greyed outside a deathmatch as RulesChangeFunc greyed them) and begin, which starts the game on
   * the map as StartServerActionFunc ran `map`. A field's text is the menu's own (menufield_s's buffer): the setting is
   * written at every key, the text shows what was typed.
   */
  startServer() {
    const h = this.host;
    const maps = h.maps?.() ?? [];
    let mapIndex = Math.max(0, maps.indexOf(h.get('map')));
    const mode = () => h.gameMode?.() ?? { coop: false, deathmatch: false, players: 2 };
    const rules = () => { const g = mode(); return g.deathmatch ? 2 : g.coop ? 1 : 0; };
    const buffer = (initial, write) => { let text = String(initial ?? ''); return [() => text, (v) => { text = v; write(v); }, (v) => { text = v; }]; };
    const limit = (name) => buffer(h.get(name) ?? 0, (v) => h.set(name, Math.max(0, Math.min(999, Number(v) || 0))));
    const [getTime, setTime] = limit('timelimit');
    const [getFrag, setFrag] = limit('fraglimit');
    const players = () => (rules() ? mode().players : 1);
    const [getMax, setMax, showMax] = buffer(players(), (v) => { const n = Number(v); if (rules() && n >= 2 && n <= 4) h.setGameMode?.({ ...mode(), players: n }); });
    const flags = action('deathmatch flags', 108, () => this.dmOptions(), { x: 24 });
    const setFlags = () => { flags.grayed = rules() !== 2; flags.statusbar = flags.grayed ? 'N/A outside a deathmatch' : null; };
    setFlags();
    const setRules = (v) => { h.setGameMode?.({ ...mode(), coop: v > 0, deathmatch: v === 2 }); setFlags(); showMax(String(players())); };
    const m = this.framework({
      id: 'startserver', banner: 'm_banner_start_server', items: [
        spin('initial map', 0, maps.length ? maps : ['-'], () => mapIndex, (v) => { mapIndex = v; }),
        spin('rules', 20, RULES, rules, setRules),
        field('time limit', 36, 3, 3, getTime, setTime, { numbers: true, statusbar: '0 = no limit' }),
        field('frag limit', 54, 3, 3, getFrag, setFrag, { numbers: true, statusbar: '0 = no limit' }),
        field('max players', 72, 3, 3, getMax, setMax, { numbers: true, statusbar: 'two to four at this page in coop or deathmatch' }),
        field('hostname', 90, 12, 12, () => h.get('hostname') ?? '', (v) => h.set('hostname', v)),
        flags,
        action('begin', 128, () => { this.off(); h.startServer?.(maps[mapIndex]); }, { x: 24 }),
      ],
    });
    m.layout = (r) => { m.x = r.w >> 1; m.y = (r.h - 138) >> 1; };   // (Menu_Center: the last item at 128, ten under it)
    this.push(m);
  }

  /**
   * M_Menu_DMOptions_f: the deathmatch flags as rows to turn (DMOptions_MenuInit's, less teamplay: there are no model or skin
   * teams here), each writing the page's dmflags setting as DMFlagCallback wrote the cvar; the status bar says the value.
   */
  dmOptions() {
    const h = this.host;
    const m = this.framework({ id: 'dmoptions', banner: 'm_banner_multiplayer', items: [] });
    const value = () => Number(h.get('dmflags')) || 0;
    m.statusbar = `dmflags = ${value()}`;
    // a row: the flag's bit, `inverted` for the "no" flags (DF_NO_FALLING is "falling damage: yes" when clear)
    const row = (name, y, bit, inverted = false) => spin(name, y, YESNO,
      () => ((((value() & bit) !== 0) !== inverted) ? 1 : 0),
      (v) => { const on = (v === 1) !== inverted; h.set('dmflags', on ? value() | bit : value() & ~bit); m.statusbar = `dmflags = ${value()}`; });
    m.items.push(
      row('falling damage', 0, 8, true),        // DF_NO_FALLING
      row('weapons stay', 10, 4),               // DF_WEAPONS_STAY
      row('instant powerups', 20, 16),          // DF_INSTANT_ITEMS
      row('allow powerups', 30, 2, true),       // DF_NO_ITEMS
      row('allow health', 40, 1, true),         // DF_NO_HEALTH
      row('allow armor', 50, 2048, true),       // DF_NO_ARMOR
      row('spawn farthest', 60, 512),           // DF_SPAWN_FARTHEST
      row('same map', 70, 32),                  // DF_SAME_LEVEL
      row('force respawn', 80, 1024),           // DF_FORCE_RESPAWN
      row('allow exit', 90, 4096),              // DF_ALLOW_EXIT
      row('infinite ammo', 100, 8192),          // DF_INFINITE_AMMO
      row('quad drop', 110, 16384),             // DF_QUAD_DROP
      row('friendly fire', 120, 256, true),     // DF_NO_FRIENDLY_FIRE
    );
    m.layout = (r) => { m.x = r.w >> 1; m.y = (r.h >> 1) - 60; };
    this.push(m);
  }

  /**
   * M_Menu_PlayerConfig_f: the name (the netname cvar: the obituaries and the score board; at most 15 characters)
   * and the handedness (the hand cvar: right, left, center: where the shots come from and how the gun is drawn).
   * The model and skin boxes wait on a pak with the player model (the demo's has none), the rate on a network
   * with a rate; the player's preview went with the model.
   */
  playerConfig() {
    const h = this.host;
    const m = this.framework({
      id: 'player', banner: 'm_banner_multiplayer', items: [
        field('name', 0, 15, 15, () => h.get('name') ?? '', (v) => h.set('name', v)),
        action('model: male', 20, null, { grayed: true, statusbar: 'the player model and its skins wait on a pak that has them' }),
        action('skin: grunt', 30, null, { grayed: true, statusbar: 'the player model and its skins wait on a pak that has them' }),
        spin('handedness', 50, HANDS, () => HANDS[h.get('hand')] ? h.get('hand') : 0, (v) => h.set('hand', v)),
      ],
    });
    m.layout = (r) => { m.x = (r.w >> 1) - 40; m.y = (r.h >> 1) - 70; };
    this.push(m);
  }

  /** M_Menu_Options_f: the options that the page has (sound quality and the joystick have no meaning here) */
  options() {
    const h = this.host;
    const m = this.framework({
      id: 'options', banner: 'm_banner_options', items: [
        slider('effects volume', 0, 0, 10, () => Math.round(h.get('sfx') / 10), (v) => h.set('sfx', v * 10)),
        spin('CD music', 10, ['disabled', 'enabled'], () => (h.get('musicMode') === 'off' ? 0 : 1), (v) => h.set('musicMode', v ? 'tracks' : 'off')),
        slider('mouse speed', 30, 2, 22, () => Math.round(h.get('sensitivity') * 2), (v) => h.set('sensitivity', v / 2)),
        spin('always run', 40, YESNO, () => (h.get('alwaysRun') ? 1 : 0), (v) => h.set('alwaysRun', !!v)),
        spin('invert mouse', 50, YESNO, () => (h.get('invertMouse') ? 1 : 0), (v) => h.set('invertMouse', !!v)),
        // the mouse look cvars (Options_MenuInit's lookspring, lookstrafe and free look boxes)
        spin('lookspring', 60, YESNO, () => (h.get('lookspring') ? 1 : 0), (v) => h.set('lookspring', !!v)),
        spin('lookstrafe', 70, YESNO, () => (h.get('lookstrafe') ? 1 : 0), (v) => h.set('lookstrafe', !!v)),
        spin('free look', 80, YESNO, () => (h.get('freelook') ? 1 : 0), (v) => h.set('freelook', !!v)),
        spin('crosshair', 90, ['none', 'cross', 'dot', 'angle'], () => h.get('crosshair'), (v) => h.set('crosshair', v)),
        action('customize controls', 110, () => this.keysMenu()),
        action('reset defaults', 120, () => h.resetDefaults()),
        action('go to console', 130, () => { this.off(); h.console(); }),
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
