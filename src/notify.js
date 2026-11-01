// notify.js – the console's notify lines and its scrollback (console.c): what the game prints (pickups, the
// obituaries, the help's news, a command's answer) is drawn at the top of the view for con_notifytime seconds,
// NUM_CON_TIMES lines of it at most (Con_DrawNotify), and kept for the backquote console to show above its
// input line (Con_DrawConsole's text). Pure: the page gives it the game's clock in seconds.

export class Notify {
  constructor({ lines = 4, seconds = 3, keep = 64 } = {}) {
    this.max = lines;        // NUM_CON_TIMES
    this.seconds = seconds;  // con_notifytime
    this.keep = keep;        // the scrollback's lines
    this.entries = [];       // { text, at, show }
    this.onAdd = null;       // told each line as it comes (the page's logfile: Com_Printf's write to qconsole.log)
  }

  /** A print at `now`: each of its lines an entry (show: false keeps it for the scrollback alone); the oldest past `keep` forgotten. */
  add(text, now, { show = true } = {}) {
    for (const line of String(text ?? '').replace(/\n+$/, '').split('\n')) { this.entries.push({ text: line, at: now, show }); if (this.onAdd) this.onAdd(line); }
    if (this.entries.length > this.keep) this.entries.splice(0, this.entries.length - this.keep);
  }

  /** The lines to draw at `now`: the newest `lines` shown ones not yet `seconds` old, oldest first (one from a clock ahead of now is left out). */
  lines(now) {
    const out = [];
    for (let i = this.entries.length - 1; i >= 0 && out.length < this.max; i--) {
      const e = this.entries[i];
      if (e.show && now >= e.at && now - e.at < this.seconds) out.unshift(e.text);
    }
    return out;
  }

  /** The scrollback: the last `n` lines printed, the hidden ones among them. */
  log(n = 16) { return this.entries.slice(-n).map((e) => e.text); }

  clear() { this.entries.length = 0; }
}

/**
 * The centre print's clock (SCR_CenterPrint, SCR_DrawCenterString): a print stays scr_centertime seconds from when it
 * came, whatever the game's row carries it for (the SQL keeps it three seconds, as the demo's frames were written). Pure:
 * see(text, now) is told the row's text (null for none) at the game's clock, text(now) is what to draw.
 */
export class CenterPrint {
  constructor({ seconds = 2.5 } = {}) {
    this.seconds = seconds;   // scr_centertime
    this.cur = null;          // { text, at, held }: the print seen, when it came, whether the row still carries it
  }

  /** The row's centre print at `now`: a new text, or one back after the row dropped it, starts the clock again. */
  see(text, now) {
    const c = this.cur;
    if (text) { if (!c || c.text !== text || !c.held || now < c.at) this.cur = { text, at: now, held: true }; }
    else if (c) c.held = false;
  }

  /** The text to draw at `now`, or null once `seconds` have gone (a clock behind the print's, a new level's, drops it). */
  text(now) {
    const c = this.cur;
    if (!c) return null;
    if (now < c.at) { this.cur = null; return null; }
    return now - c.at < this.seconds ? c.text : null;
  }

  clear() { this.cur = null; }
}
