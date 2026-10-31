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
  }

  /** A print at `now`: each of its lines an entry (show: false keeps it for the scrollback alone); the oldest past `keep` forgotten. */
  add(text, now, { show = true } = {}) {
    for (const line of String(text ?? '').replace(/\n+$/, '').split('\n')) this.entries.push({ text: line, at: now, show });
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
