// netgraph.js – SCR_DebugGraph and SCR_DrawDebugGraph (cl_scrn.c) for the network game: a column a client frame
// along the bottom of the view, as CL_AddNetgraph added them (a dropped frame a tall red bar, a late one a tall
// orange one, a frame that came a bar as high as the ping is long, a thirtieth of a millisecond a pixel), over a
// dark band `height` high. Nothing here touches the DOM or the renderer's pixels but through fillRect, so a test
// can drive it with a recorder.

export const GRAPH_HEIGHT = 32;      // scr_graphheight
export const GRAPH_SCALE = 1;        // scr_graphscale
export const GRAPH_SHIFT = 0;        // scr_graphshift
export const GRAPH_BACK = 8;         // the band's colour
export const COLOUR_DROPPED = 0x40;  // CL_AddNetgraph: a packet dropped
export const COLOUR_LATE = 0xdf;     // ... a packet surpressed (here: a frame that came late)
export const COLOUR_PING = 0xd0;     // ... the ping, in thirtieths of a millisecond (ping/30), at most 30
export const SAMPLES = 1024;         // the ring (cl_scrn.c's 1024 values)

export class Netgraph {
  constructor(samples = SAMPLES) {
    this.values = new Float32Array(samples);
    this.colours = new Uint8Array(samples);
    this.n = samples;
    this.current = 0;   // the next column to write (SCR_DebugGraph's current)
    this.added = 0;     // how many columns have been added in all
  }
  /** SCR_DebugGraph: one column, its height and its colour. */
  add(value, colour) {
    this.values[this.current] = value;
    this.colours[this.current] = colour & 255;
    this.current = (this.current + 1) % this.n;
    this.added++;
  }
  /**
   * CL_AddNetgraph, a client frame at a time: `dropped` frames since the last (a tall red column each), `late` (the
   * frame came past its time: a tall orange one), and the ping in milliseconds (a column ping/30 high, at most 30,
   * the blue of the original's latency column).
   */
  frame({ dropped = 0, late = false, ping = 0 } = {}) {
    for (let i = 0; i < Math.min(dropped, 32); i++) this.add(30, COLOUR_DROPPED);
    if (late) this.add(30, COLOUR_LATE);
    this.add(Math.min(30, Math.max(0, (ping || 0) / 30)), COLOUR_PING);
  }
  /**
   * SCR_DrawDebugGraph: the band `w` wide along the bottom of a view `h` high (the newest column at the right), each
   * column `value * scale + shift` high, wrapped as the original wrapped a value past the height.
   */
  draw(r, { x = 0, y = r.h, w = r.w, height = GRAPH_HEIGHT, scale = GRAPH_SCALE, shift = GRAPH_SHIFT } = {}) {
    r.fillRect(x, y - height, w, height, GRAPH_BACK);
    for (let a = 0; a < w && a < this.n; a++) {
      const i = (this.current - 1 - a + this.n * 2) % this.n;
      if (a >= this.added) break;
      let v = this.values[i] * scale + shift;
      if (v < 0) v += height * (1 + Math.floor(-v / height));
      const hh = Math.floor(v % height);
      if (hh > 0) r.fillRect(x + w - 1 - a, y - hh, 1, hh, this.colours[i]);
    }
  }
}
