// icon.mjs – the page's icons for the web app manifest (public/icon-192.png, public/icon-512.png): "Q2" in the
// pak's console font (pics/conchars.pcx, the glyphs the status bar and the menus are drawn with) in the page's
// accent colour on its background, scaled up without smoothing, as the font looks on screen. Run once, and again
// when the colours change; the files are committed.
//
//   node scripts/icon.mjs [public/pak/pak0.pak]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pak, pic } from '../src/pak.js';
import { png } from './png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pak = new Pak(fs.readFileSync(process.argv[2] ?? process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
const chars = pic(pak, 'conchars');
if (!chars) throw new Error('no pics/conchars.pcx in the pak');

const BG = [0x0c, 0x0f, 0x0d], FG = [0xd8, 0xa2, 0x3a];   // style.css: --bg and --accent
const TEXT = 'Q2';

/** The icon of `size` pixels: the glyphs (8 × 8 each) scaled by `scale`, centred. */
function icon(size, scale) {
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) rgba.set([...BG, 255], i * 4);
  const tw = TEXT.length * 8 * scale, x0 = (size - tw) >> 1, y0 = (size - 8 * scale) >> 1;
  for (let k = 0; k < TEXT.length; k++) {
    const c = TEXT.charCodeAt(k) & 127, cx = (c & 15) * 8, cy = (c >> 4) * 8;
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        if (chars.data[(cy + j) * chars.w + cx + i] === 255) continue;   // (255 is the font's transparent index)
        for (let yy = 0; yy < scale; yy++) {
          for (let xx = 0; xx < scale; xx++) {
            const o = ((y0 + j * scale + yy) * size + x0 + k * 8 * scale + i * scale + xx) * 4;
            rgba[o] = FG[0]; rgba[o + 1] = FG[1]; rgba[o + 2] = FG[2]; rgba[o + 3] = 255;
          }
        }
      }
    }
  }
  return png(size, size, rgba);
}

for (const [size, scale] of [[192, 9], [512, 24]]) {
  const file = path.join(root, `public/icon-${size}.png`);
  fs.writeFileSync(file, icon(size, scale));
  console.log(`${path.relative(root, file)}: ${size}×${size}, the glyphs ${8 * scale} pixels high`);
}
