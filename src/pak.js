// pak.js – Quake 2's archive and picture formats: PAK (baseq2/pak0.pak),
// PCX (pics/*.pcx, skins, the sky box, the palette) and WAL (textures).

const td = new TextDecoder('latin1');

export const cstr = (bytes, off, len) => {
  let end = off;
  const max = off + len;
  while (end < max && bytes[end] !== 0) end++;
  return td.decode(bytes.subarray(off, end));
};

export class Pak {
  constructor(buffer) {
    this.bytes = new Uint8Array(buffer);
    this.dv = new DataView(buffer);
    if (cstr(this.bytes, 0, 4) !== 'PACK') throw new Error('not a PAK file');
    const dirOff = this.dv.getInt32(4, true);
    const dirLen = this.dv.getInt32(8, true);
    this.files = new Map();
    for (let p = dirOff; p < dirOff + dirLen; p += 64) {
      const name = cstr(this.bytes, p, 56).toLowerCase().replace(/\\/g, '/');
      this.files.set(name, { off: this.dv.getInt32(p + 56, true), size: this.dv.getInt32(p + 60, true) });
    }
  }

  has(name) { return this.files.has(name.toLowerCase()); }

  /** The file's bytes as a Uint8Array view (no copy). */
  get(name) {
    const e = this.files.get(name.toLowerCase());
    if (!e) throw new Error(`${name} not in pak`);
    return this.bytes.subarray(e.off, e.off + e.size);
  }

  /** A copy, as an ArrayBuffer (for DataView parsers and decodeAudioData). */
  buffer(name) {
    return this.get(name).slice().buffer;
  }

  list(prefix = '', suffix = '') {
    return [...this.files.keys()].filter((n) => n.startsWith(prefix) && n.endsWith(suffix)).sort();
  }

  mapNames() {
    return this.list('maps/', '.bsp').map((n) => n.slice(5, -4));
  }
}

/**
 * A PCX picture: 8-bit, RLE. Returns { w, h, data (palette indices), palette (768 bytes or null) }.
 */
export function loadPcx(bytes) {
  if (bytes[0] !== 0x0a || bytes[3] !== 8) throw new Error('not an 8-bit PCX');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const xmin = dv.getUint16(4, true), ymin = dv.getUint16(6, true), xmax = dv.getUint16(8, true), ymax = dv.getUint16(10, true);
  const bytesPerLine = dv.getUint16(66, true);
  const w = xmax - xmin + 1, h = ymax - ymin + 1;
  const data = new Uint8Array(w * h);
  let p = 128;
  const n = bytes.length;
  for (let y = 0; y < h; y++) {
    let x = 0;
    const row = y * w;
    while (x < bytesPerLine && p < n) {
      let c = bytes[p++];
      let run = 1;
      if ((c & 0xc0) === 0xc0) { run = c & 0x3f; c = bytes[p++]; }
      while (run-- > 0) { if (x < w) data[row + x] = c; x++; }
    }
  }
  let palette = null;
  if (n >= 769 && bytes[n - 769] === 0x0c) palette = bytes.subarray(n - 768, n);
  return { w, h, data, palette };
}

/** A WAL texture: 4 mip levels of palette indices. */
export class Wal {
  constructor(bytes, name = '') {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.name = cstr(bytes, 0, 32).toLowerCase() || name;
    this.w = dv.getInt32(32, true);
    this.h = dv.getInt32(36, true);
    const offs = [0, 1, 2, 3].map((m) => dv.getInt32(40 + m * 4, true));
    this.mips = offs.map((o, m) => bytes.subarray(o, o + ((this.w >> m) * (this.h >> m))));
    this.animname = cstr(bytes, 56, 32).toLowerCase();
    this.flags = dv.getInt32(88, true);
    this.contents = dv.getInt32(92, true);
    this.value = dv.getInt32(96, true);
  }
}

/**
 * pics/colormap.pcx: its palette is the game palette; its rows are the 64
 * light levels of the colormap (64×256) followed by the 256×256 alpha map
 * the software renderer blends translucent surfaces with.
 */
export function loadColormap(pak) {
  const pcx = loadPcx(pak.get('pics/colormap.pcx'));
  const pal = new Uint32Array(256);
  const p = pcx.palette;
  for (let i = 0; i < 256; i++) pal[i] = (255 << 24) | (p[i * 3 + 2] << 16) | (p[i * 3 + 1] << 8) | p[i * 3];
  pal[255] &= 0x00ffffff;   // the transparent index
  const colormap = pcx.data.subarray(0, 64 * 256);
  const alphamap = pcx.h >= 320 ? pcx.data.subarray(64 * 256, 64 * 256 + 256 * 256) : null;
  return { palette: pal, palette24: p, colormap, alphamap };
}

/** pics/<name>.pcx as { w, h, data }, or null when the pak lacks it. */
export function pic(pak, name) {
  const n = name.includes('/') ? name : `pics/${name}.pcx`;
  if (!pak.has(n)) return null;
  const p = loadPcx(pak.get(n));
  return { w: p.w, h: p.h, data: p.data };
}
