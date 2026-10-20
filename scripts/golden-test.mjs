// golden-test.mjs – the painter's look, held to the docs screenshots: the twelve frames in docs/ (three maps, four
// shots each, as `npm run screenshots` makes them) are rendered again and compared pixel for pixel. The painter is
// deterministic, so a change shows as a count of pixels; when it is on purpose, regenerate the shots with
// `node scripts/screenshot.mjs <map>` for each map and commit them with the change, as CLAUDE.md asks.
//   node scripts/golden-test.mjs [map ...]    (the maps to check; all three by default)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const maps = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!maps.length) maps.push('demo1', 'demo2', 'demo3');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'q2-golden-'));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

/** The RGBA of a PNG scripts/png.mjs wrote (one IDAT, no row filters). */
function decode(file) {
  const b = fs.readFileSync(file);
  let p = 8, w = 0, h = 0;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString('latin1', p + 4, p + 8), data = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    if (raw[y * (w * 4 + 1)] !== 0) throw new Error(`${file}: a row filter the docs' PNGs never use`);
    rgba.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4);
  }
  return { w, h, rgba };
}

/** How many pixels differ between two frames, and the box they lie in. */
function compare(a, b) {
  if (a.w !== b.w || a.h !== b.h) return { n: a.w * a.h, box: `${a.w}x${a.h} against ${b.w}x${b.h}` };
  let n = 0, x0 = a.w, x1 = -1, y0 = a.h, y1 = -1;
  for (let i = 0; i < a.rgba.length; i += 4) {
    if (a.rgba[i] === b.rgba[i] && a.rgba[i + 1] === b.rgba[i + 1] && a.rgba[i + 2] === b.rgba[i + 2]) continue;
    n++;
    const x = (i >> 2) % a.w, y = ((i >> 2) / a.w) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { n, box: n ? `x ${x0}-${x1}, y ${y0}-${y1}` : '' };
}

for (const map of maps) {
  // exactly what `npm run screenshots` runs, into a scratch directory
  const run = spawnSync(process.execPath, ['scripts/screenshot.mjs', map, path.join(out, 'screenshot')], { cwd: root, encoding: 'utf8', env: process.env });
  check(run.status === 0, `${map} renders (${(run.stdout.match(/face rows/g) ?? []).length} shots)`);
  if (run.status !== 0) { console.log(run.stdout, run.stderr); continue; }
  for (let i = 0; i < 4; i++) {
    const name = `screenshot-${map}-${i}.png`;
    const golden = path.join(root, 'docs', name), fresh = path.join(out, name);
    if (!fs.existsSync(golden)) { check(false, `${name}: no docs/${name} to compare with`); continue; }
    if (fs.readFileSync(golden).equals(fs.readFileSync(fresh))) { check(true, `${name} is the docs' frame, byte for byte`); continue; }
    const { n, box } = compare(decode(golden), decode(fresh));
    check(n === 0, `${name}: ${n} of ${decode(golden).w * decode(golden).h} pixels differ from docs/${name} (${box})`);
  }
}
fs.rmSync(out, { recursive: true, force: true });
if (failed) console.log('A painter change on purpose: regenerate the shots (node scripts/screenshot.mjs demo1, demo2, demo3) and commit them with it.');
console.log(failed ? `${failed} failure(s)` : 'all good');
process.exit(failed ? 1 : 0);
