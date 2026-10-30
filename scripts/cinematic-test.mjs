// cinematic-test.mjs – a cinematic (src/cinematic.js, cl_cin.c) made and read back: the Huffman trees as
// Huff1TableInit built them (the two smallest counts joined, the lowest index on a tie, a row with one count a
// leaf for a root), the decoder through a hand-packed bit stream, the encoder's output decoding to its input for
// every byte after every byte, a whole .cin with its header, its palettes, its pictures and its sound read frame by
// frame to the end marker, and the player's clock at fourteen frames a second.
//   node scripts/cinematic-test.mjs
import { huffTables, huffDecompress, huffCompress, CinReader, CinPlayer, makeCin, CIN_FPS } from '../src/cinematic.js';

let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

// ── the trees ──
// row 0: bytes 0 (count 5), 1 (count 2), 2 (count 3), the rest 0: joined 1+2 → 256 (5), then 0+256 → 257 (10): the root 257
const counts = new Uint8Array(65536);
counts[0] = 5; counts[1] = 2; counts[2] = 3;
counts[256 + 7] = 1;   // row 1: one byte alone
let T = huffTables(counts);
check(T.roots[0] === 257 && T.nodes[0] === 1 && T.nodes[1] === 2 && T.nodes[2] === 0 && T.nodes[3] === 256,
  `row 0's tree joins the two smallest first (1 and 2 into 256), then 0 and 256 into the root 257 (root ${T.roots[0]})`);
check(T.roots[1] === 255 && T.roots[2] === 255, 'a row with one count or none joins nothing: its root is the leaf 255, as the C left numhnodes - 1');
// a tie: equal counts take the lowest index first
counts.fill(0); counts[3] = 4; counts[9] = 4; counts[5] = 4;
T = huffTables(counts);
check(T.nodes[0] === 3 && T.nodes[1] === 5 && T.nodes[2] === 9 && T.nodes[3] === 256 && T.roots[0] === 257, 'on a tie the lowest byte joins first (3 and 5, then 9 and their node)');
// ── the decoder on a bit stream packed by hand: row 0 as above (3: 00? no: 3 is child 0 of 256, 256 child 1 of 257; 9 child 0 of 257) ──
// codes from the root 257 (bits low first): 9 = 0; 3 = 1,0; 5 = 1,1. After a byte the tree is that byte's row: rows 3, 5, 9 have no
// counts, so their root is 255 at once (a leaf): the next byte is 255 with no bits. Hence the stream 9, 255, ... from "0" then "".
const data = Uint8Array.from([2, 0, 0, 0, 0b0]);   // count 2: the bits "0" → 9, then row 9's root is the leaf 255
let out = huffDecompress(T, data);
check(out.length === 2 && out[0] === 9 && out[1] === 255, `the decoder walks row 0 to 9 on a 0 bit, then row 9's lone root 255 (${[...out]})`);

// ── the encoder against the decoder: every byte after every byte, on a row with every count ──
const full = new Uint8Array(65536);
for (let p = 0; p < 256; p++) for (let j = 0; j < 256; j++) full[p * 256 + j] = 1 + ((p * 7 + j * 13) % 200);
T = huffTables(full);
const seq = new Uint8Array(65536 + 1);
seq[0] = 0;
for (let p = 0; p < 256; p++) for (let j = 0; j < 256; j++) seq[1 + p * 256 + j] = j;
const comp = huffCompress(T, seq);
out = huffDecompress(T, comp);
check(out.length === seq.length && out.every((b, i) => b === seq[i]), `a sequence of every byte after every byte (${seq.length} bytes, ${comp.length} compressed: nothing to gain on it) decodes to itself`);
// a picture with few colours, counted: short codes
const flat = Uint8Array.from({ length: 10000 }, (_, i) => (i % 97 === 0 ? 7 : 3));
const skew = new Uint8Array(65536).fill(1); skew[3 * 256 + 3] = 255; skew[3 * 256 + 7] = 20; skew[7 * 256 + 3] = 255;
const TS = huffTables(skew);
const fc = huffCompress(TS, flat);
check(fc.length < flat.length / 4 && huffDecompress(TS, fc).every((b, i) => b === flat[i]), `a flat picture compresses to ${fc.length} of ${flat.length} bytes with counts that favour its bytes`);
const rnd = (() => { let s = 12345; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s; }; })();
const noise = Uint8Array.from({ length: 5000 }, () => rnd() & 255);
check(huffDecompress(T, huffCompress(T, noise)).every((b, i) => b === noise[i]), 'so does noise');

// ── a whole cinematic: three frames of 64 × 48, a palette on the first and the third, sound ──
const W = 64, H = 48;
const pal = (seed) => Uint8Array.from({ length: 768 }, (_, i) => (i * seed + 3) & 255);
const frameImage = (k) => Uint8Array.from({ length: W * H }, (_, i) => ((i % W) + (i / W | 0) * 2 + k * 10) & 255);
const samplesOf = (k) => Uint8Array.from({ length: 2000 }, (_, i) => 128 + Math.round(100 * Math.sin((i + k * 500) / 7)));
const frames = [{ image: frameImage(0), palette: pal(1), samples: samplesOf(0) }, { image: frameImage(1), samples: samplesOf(1) }, { image: frameImage(2), palette: pal(5), samples: samplesOf(2) }];
const cin = makeCin({ width: W, height: H, rate: 22050, sampleWidth: 1, channels: 1, frames });
const r = new CinReader(cin);
check(r.width === W && r.height === H && r.rate === 22050 && r.sampleWidth === 1 && r.channels === 1 && r.pos === 20 + 65536, `the header reads back (${r.width}×${r.height}, ${r.rate} Hz, ${r.sampleWidth} byte, ${r.channels} channel), the tables after it`);
const f0 = r.next();
const per = Math.floor(22050 / CIN_FPS);
check(f0 && f0.palette && f0.palette.every((b, i) => b === pal(1)[i]) && f0.image.length === W * H && f0.image.every((b, i) => b === frames[0].image[i]) && f0.samples.length === per && f0.samples.every((b, i) => b === frames[0].samples[i]),
  `the first frame: its palette, its ${W * H} pixels exactly, its ${per} samples (a fourteenth of a second)`);
const f1 = r.next();
check(f1 && f1.palette === f0.palette && f1.image.every((b, i) => b === frames[1].image[i]), 'the second keeps the palette and has its own picture');
const f2 = r.next();
check(f2 && f2.palette !== f0.palette && f2.palette[1] === pal(5)[1] && f2.image.every((b, i) => b === frames[2].image[i]) && f2.samples.length === Math.floor(3 * 22050 / CIN_FPS) - Math.floor(2 * 22050 / CIN_FPS), 'the third brings a new palette; its sound is the third fourteenth (the integer split the C made)');
check(r.next() === null && r.done && r.next() === null, 'then the end marker, and nothing more');
let threw = false;
try { new CinReader(new Uint8Array(30)); } catch { threw = true; }
check(threw, 'a file that is no cinematic is refused');

// ── the player's clock ──
const p = new CinPlayer(new CinReader(cin));
check(p.at(0) === p.frames[0] && p.at(0.05) === p.frames[0] && p.at(1 / CIN_FPS) === p.frames[1] && p.at(2.5 / CIN_FPS) === p.frames[2], 'the frame at a time is the fourteenth of a second it falls in');
check(p.at(1) === null && p.finished && p.frames.length === 3, 'past the last frame the player is finished');

console.log(failures ? `${failures} FAILED` : 'all good');
process.exit(failures ? 1 : 0);
