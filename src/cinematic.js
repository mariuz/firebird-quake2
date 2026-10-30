// cinematic.js – a Quake 2 cinematic (video/*.cin) read as cl_cin.c read it: the header (the picture's width
// and height, the sound's rate, width and channels), the 256 rows of 256 byte counts from which Huff1TableInit
// built a Huffman tree per previous byte, then a frame at a time (SCR_ReadNextFrame): a command (0 a frame, 1 a
// frame with a new palette of 768 bytes first, 2 the end), the compressed picture's size and bytes (the first four
// the uncompressed count, then the bits, low bit first, walked down the tree of the byte before: Huff1Decompress)
// and the frame's fourteenth of a second of raw sound samples. The frames come at 14 a second.
//
// `huffTables` builds the trees, `huffDecompress` and `huffCompress` are the decoder and its inverse (the demo
// pak has no cinematic: the test makes one with the encoder and reads it back), `CinReader` walks a file a frame
// at a time, `CinPlayer` says which frame a time wants. Nothing here touches the DOM or the database.

export const CIN_FPS = 14;

/**
 * Huff1TableInit: for each previous byte a tree of up to 511 nodes from its row of counts: the leaves are the
 * 256 byte values, the nodes above join the two smallest counts not yet used (SmallestNode1, the lowest index on
 * a tie), until one is left or no counts remain. Returns { nodes: Int32Array(256 × 512), roots: Int32Array(256) }:
 * node n (256 and up) of row p has its children at nodes[p × 512 + (n − 256) × 2] and + 1; a child under 256 is
 * a byte. A row with one count or none gets no node and the "root" 255 (numhnodes − 1 as the C left it): a leaf.
 */
export function huffTables(counts) {
  const nodes = new Int32Array(256 * 512);
  const roots = new Int32Array(256);
  const count = new Int32Array(511), used = new Uint8Array(511);
  const smallest = (numhnodes) => {
    let best = 99999999, bestnode = -1;
    for (let i = 0; i < numhnodes; i++) {
      if (used[i] || !count[i]) continue;
      if (count[i] < best) { best = count[i]; bestnode = i; }
    }
    if (bestnode >= 0) used[bestnode] = 1;
    return bestnode;
  };
  for (let prev = 0; prev < 256; prev++) {
    count.fill(0); used.fill(0);
    for (let j = 0; j < 256; j++) count[j] = counts[prev * 256 + j];
    let numhnodes = 256;
    const base = prev * 512;
    while (numhnodes !== 511) {
      const n = base + (numhnodes - 256) * 2;
      const a = smallest(numhnodes);
      if (a === -1) break;
      nodes[n] = a;
      const b = smallest(numhnodes);
      if (b === -1) break;
      nodes[n + 1] = b;
      count[numhnodes] = count[a] + count[b];
      numhnodes++;
    }
    roots[prev] = numhnodes - 1;
  }
  return { nodes, roots };
}

/**
 * Huff1Decompress: `data` (its first four bytes the count of bytes to make) through the trees, from row 0: a
 * bit a step down the tree of the last byte, a byte out at each leaf. (A leaf for a root, the C read past its
 * table; here it stays on the leaf for the step, so the byte costs a bit.)
 */
export function huffDecompress(tables, data) {
  const { nodes, roots } = tables;
  let count = (data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24)) >>> 0;
  const out = new Uint8Array(count);
  let o = 0, p = 4;
  let base = 0, nodenum = roots[0];
  while (count) {
    let inbyte = data[p++] ?? 0;
    for (let bit = 0; bit < 8; bit++) {
      if (nodenum < 256) {
        base = nodenum << 9;
        out[o++] = nodenum;
        if (!--count) break;
        nodenum = roots[nodenum];
      }
      if (nodenum >= 256) nodenum = nodes[base + ((nodenum - 256) << 1) + (inbyte & 1)];
      inbyte >>= 1;
    }
  }
  return out;
}

/**
 * The inverse (the tool side: id's cinematic maker): `bytes` as the bits that lead the decoder to them, each
 * byte's code read off the tree of the byte before. Returns the compressed block, count first.
 */
export function huffCompress(tables, bytes) {
  const { nodes, roots } = tables;
  // each row's codes: the path from the root to each leaf, as [bits, length]
  const codes = new Array(256);
  const codesOf = (prev) => {
    if (codes[prev]) return codes[prev];
    const c = new Array(256).fill(null);
    const base = prev << 9;
    const walk = (n, bits, len) => {
      if (n < 256) { c[n] = [bits, len]; return; }
      if (len > 30) return;
      walk(nodes[base + (n - 256) * 2], bits, len + 1);
      walk(nodes[base + (n - 256) * 2 + 1], bits | (1 << len), len + 1);
    };
    if (roots[prev] >= 256) walk(roots[prev], 0, 0);
    else c[roots[prev]] = [0, 1];   // (a leaf for a root: the byte for a bit, as the decoder takes it)
    codes[prev] = c;
    return c;
  };
  const out = [bytes.length & 255, (bytes.length >> 8) & 255, (bytes.length >> 16) & 255, (bytes.length >>> 24) & 255];
  let acc = 0, nbits = 0, prev = 0;
  for (let i = 0; i < bytes.length; i++) {
    const code = codesOf(prev)[bytes[i]];
    if (!code) throw new Error(`byte ${bytes[i]} has no code after ${prev}: its count is zero`);
    acc |= code[0] << nbits; nbits += code[1];
    while (nbits >= 8) { out.push(acc & 255); acc >>>= 8; nbits -= 8; }
    prev = bytes[i];
  }
  if (nbits) out.push(acc & 255);
  return Uint8Array.from(out);
}

/** The header and the tables of a .cin; the frames are read one by one with `next()`. */
export class CinReader {
  constructor(bytes) {
    this.b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(this.b.buffer, this.b.byteOffset, this.b.byteLength);
    this.width = dv.getInt32(0, true); this.height = dv.getInt32(4, true);
    this.rate = dv.getInt32(8, true); this.sampleWidth = dv.getInt32(12, true); this.channels = dv.getInt32(16, true);
    if (this.width <= 0 || this.height <= 0 || this.width > 4096 || this.height > 4096) throw new Error('not a cinematic');
    this.tables = huffTables(this.b.subarray(20, 20 + 65536));
    this.pos = 20 + 65536;
    this.frame = 0;          // the next frame's number
    this.palette = null;     // the current palette (768 bytes)
    this.done = false;
  }
  /**
   * SCR_ReadNextFrame: the next frame as { palette, image (width × height palette indices), samples (the raw
   * bytes of its sound: count × width × channels) }, or null at the end (command 2, or the file's end).
   */
  next() {
    if (this.done) return null;
    const dv = new DataView(this.b.buffer, this.b.byteOffset, this.b.byteLength);
    if (this.pos + 4 > this.b.length) { this.done = true; return null; }
    const command = dv.getInt32(this.pos, true); this.pos += 4;
    if (command === 2) { this.done = true; return null; }
    if (command === 1) { this.palette = this.b.slice(this.pos, this.pos + 768); this.pos += 768; }
    const size = dv.getInt32(this.pos, true); this.pos += 4;
    if (size < 1 || this.pos + size > this.b.length) throw new Error('bad compressed frame size');
    const image = huffDecompress(this.tables, this.b.subarray(this.pos, this.pos + size));
    this.pos += size;
    // the sound: the fourteenth of a second this frame covers, in samples (start and end as integers, as the C did)
    const start = Math.floor(this.frame * this.rate / CIN_FPS), end = Math.floor((this.frame + 1) * this.rate / CIN_FPS);
    const n = (end - start) * this.sampleWidth * this.channels;
    const samples = this.b.subarray(this.pos, Math.min(this.b.length, this.pos + n));
    this.pos += n;
    this.frame++;
    return { palette: this.palette, image, samples };
  }
}

/** The frames as a cinematic plays them: `at(t)` is the frame due at `t` seconds (SCR_RunCinematic's clock). */
export class CinPlayer {
  constructor(reader) {
    this.reader = reader;
    this.frames = [];        // the frames read so far
    this.finished = false;
  }
  frameIndex(t) { return Math.max(0, Math.floor(t * CIN_FPS)); }
  /** Frame `i`, reading forward as needed; null past the end. */
  frameAt(i) {
    while (this.frames.length <= i && !this.finished) {
      const f = this.reader.next();
      if (!f) { this.finished = true; break; }
      this.frames.push(f);
    }
    return i < this.frames.length ? this.frames[i] : null;
  }
  /** The frame for `t`, reading forward as needed; null once the cinematic is over. */
  at(t) { return this.frameAt(this.frameIndex(t)); }
}

/**
 * A cinematic made from frames (the test's, or a tool's): `frames` are { image (width × height bytes), palette
 * (768 bytes, on the frames that change it), samples (raw sound bytes) }; the counts are the bytes' pair
 * frequencies over all the frames (a byte after each byte), 1 at least so every byte has a code.
 */
export function makeCin({ width, height, rate = 22050, sampleWidth = 1, channels = 1, frames }) {
  const counts = new Uint8Array(65536).fill(1);
  const tally = new Uint32Array(65536);
  for (const f of frames) { let prev = 0; for (const b of f.image) { tally[prev * 256 + b]++; prev = b; } }
  let max = 1;
  for (let i = 0; i < 65536; i++) if (tally[i] > max) max = tally[i];
  for (let i = 0; i < 65536; i++) if (tally[i]) counts[i] = Math.max(1, Math.min(255, Math.round(tally[i] * 255 / max)));
  const tables = huffTables(counts);
  const out = [];
  const int32 = (v) => out.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
  int32(width); int32(height); int32(rate); int32(sampleWidth); int32(channels);
  for (const c of counts) out.push(c);
  frames.forEach((f, i) => {
    int32(f.palette ? 1 : 0);
    if (f.palette) for (const b of f.palette) out.push(b);
    const comp = huffCompress(tables, f.image);
    int32(comp.length);
    for (const b of comp) out.push(b);
    const start = Math.floor(i * rate / CIN_FPS), end = Math.floor((i + 1) * rate / CIN_FPS);
    const n = (end - start) * sampleWidth * channels;
    for (let k = 0; k < n; k++) out.push(f.samples?.[k] ?? 0);
  });
  int32(2);
  return Uint8Array.from(out);
}
