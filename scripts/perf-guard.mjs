// perf-guard.mjs – the figures the docs quote, held: the load of the Outer Base, an idle and a walking tic,
// the frame query and the raster, measured here and compared with docs/perf-baseline.json. A machine is faster
// or slower than another and the same one varies by half between runs, so each figure is taken in units of a
// calibration run on the same machine right before it (the SQL ones in primary-key fetches of the engine, the
// raster in a fixed loop of JS), and the guard fails only past the baseline by the margin the file sets, wide
// enough for a runner's noise: what it catches is the kind of slip that cost 17 ms a tic once, not a slow day.
//   node scripts/perf-guard.mjs            compare with the baseline (exit 1 past it)
//   node scripts/perf-guard.mjs --record   write the baseline from this run
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FirebirdBrowser, DirectTransport } from 'firebird-wasm/browser';
import { Pak, loadColormap } from '../src/pak.js';
import { createSchema, loadResources, loadMap, SQL_FILES } from '../src/loader.js';
import { Session } from '../src/session.js';
import { Renderer, entityFrame } from '../src/renderer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = process.env.PERF_BASELINE ?? path.join(root, 'docs/perf-baseline.json');   // (another file: to try the guard against)
const record = process.argv.includes('--record');
const mapName = 'demo1';
const sql = Object.fromEntries(SQL_FILES.map((n) => [n, fs.readFileSync(path.join(root, `sql/${n}.sql`), 'utf8')]));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const t = () => performance.now();

const db = new FirebirdBrowser('memory://quake2', { transport: new DirectTransport() });
await createSchema(db, sql);
const engine = (await db.query("SELECT rdb$get_context('SYSTEM', 'ENGINE_VERSION') AS v FROM rdb$database")).rows[0].V;
const pak = new Pak(fs.readFileSync(process.env.PAK ?? path.join(root, 'public/pak/pak0.pak')).buffer);
const res = await loadResources(db, pak, { width: 320, height: 240 });

// the calibrations: 50,000 primary-key fetches in one PSQL block (what a tic is mostly made of), seven runs
// before the figures and seven after (the engine's pace drifts over a run), the median of all; and a fixed
// loop over a 320×240 byte buffer, as the raster's spans are, the median of five
async function sqlUnit(ts = []) {
  for (let i = 0; i < 7; i++) {
    const t0 = t();
    await db.query('EXECUTE BLOCK RETURNS (n INTEGER) AS DECLARE i INTEGER = 0; DECLARE v INTEGER; BEGIN n = 0; WHILE (i < 50000) DO BEGIN SELECT m.id FROM models m WHERE m.id = 1 + MOD(:i, 3) INTO :v; n = n + COALESCE(v, 0); i = i + 1; END SUSPEND; END');
    ts.push(t() - t0);
  }
  return ts;
}
function jsUnit() {
  const ts = [];
  const fb = new Uint8Array(320 * 240), zb = new Float32Array(320 * 240);
  for (let i = 0; i < 5; i++) {
    const t0 = t();
    for (let k = 0; k < 40; k++) for (let p = 0; p < fb.length; p++) { const z = 1 / (1 + ((p * 7 + k) & 1023)); if (z > zb[p]) { zb[p] = z; fb[p] = (p + k) & 255; } }
    ts.push(t() - t0);
  }
  return median(ts);
}

// the figures
const units = await sqlUnit();
const t0 = t();
await loadMap(db, pak, res, mapName, { skill: 2, seed: 1 });
const load = t() - t0;
const session = new Session(db);
session.use(pak, res);
session.map = { name: mapName, bsp: res.world.bsp };
await session.loadStyleBase();
const tic = async (walk, n) => {
  const q = `SELECT * FROM q2_tic(1, ${walk}, 0, ${walk ? 3 : 0}, 0, 0, 0, 1, 0)`;
  for (let i = 0; i < 20; i++) await db.query(q);
  const ts = [];
  for (let i = 0; i < n; i++) { const a = t(); await db.query(q); ts.push(t() - a); }
  return median(ts);
};
const ticIdle = await tic(0, 200);
const ticWalk = await tic(1, 100);
await session.tic([1, 0, 0, 0, 0, 0, 0, 1, 0]);
let frame = null;
const fts = [];
for (let i = 0; i < 30; i++) { const a = t(); frame = await session.frame(); fts.push(t() - a); }
const frameQuery = median(fts);
const cm = loadColormap(pak);
const stubCanvas = { width: 320, height: 240, getContext: () => ({ createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) };
const r = new Renderer(stubCanvas, { palette: cm.palette, colormap: cm.colormap, alphamap: cm.alphamap, pak });
r.setSize(320, 240);
r.setResources(res);
const last = session.last;
const view = { x: last.PX, y: last.PY, z: last.VIEW_Z, yaw: last.YAW, pitch: last.PITCH, roll: 0, fov: 90 };
const frames = new Map();
for (const [id, [f, eff]] of frame.brushFrames) frames.set(id, entityFrame(f, eff, last.TIME_));
const paint = () => { r.dlights = []; r.beginFrame(view); r.drawFaceList(frame.faces, frame.styles, last.TIME_, frames, frame.brushAngles); r.present(); };
for (let i = 0; i < 10; i++) paint();
const rts = [];
for (let i = 0; i < 100; i++) { const a = t(); paint(); rts.push(t() - a); }
const raster = median(rts);
const junit = jsUnit();
const u = median(await sqlUnit(units));

const figures = {
  load: { ms: load, units: load / u, unit: 'sql' },
  tic: { ms: ticIdle, units: ticIdle / u, unit: 'sql' },
  ticWalk: { ms: ticWalk, units: ticWalk / u, unit: 'sql' },
  frame: { ms: frameQuery, units: frameQuery / u, unit: 'sql' },
  raster: { ms: raster, units: raster / junit, unit: 'js' },
};
const what = { load: `${mapName} loaded (the pak's tables, the entities spawned)`, tic: 'an idle tic, median of 200', ticWalk: 'a walking tic, median of 100',
  frame: 'the frame query (frame_all, fast mode), median of 30', raster: 'the raster of that frame at 320×240, warm, median of 100' };
console.log(`engine ${engine}; the SQL unit (50,000 PK fetches) ${u.toFixed(1)} ms, the JS unit ${junit.toFixed(1)} ms`);

let failed = 0;
if (record) {
  const out = { recorded: new Date().toISOString().slice(0, 10), engine, margin: 1.0, sqlUnitMs: +u.toFixed(2), jsUnitMs: +junit.toFixed(2),
    figures: Object.fromEntries(Object.entries(figures).map(([k, f]) => [k, { units: +f.units.toFixed(3), ms: +f.ms.toFixed(2), unit: f.unit }])) };
  fs.writeFileSync(BASELINE, JSON.stringify(out, null, 2) + '\n');
  for (const [k, f] of Object.entries(figures)) console.log(`${k.padEnd(8)} ${f.ms.toFixed(1).padStart(8)} ms  ${f.units.toFixed(3).padStart(8)} ${f.unit} units   ${what[k]}`);
  console.log(`baseline written to ${path.relative(root, BASELINE)}`);
} else {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const margin = base.margin ?? 1.0;
  console.log(`baseline of ${base.recorded} (engine ${base.engine}); a figure fails past ${(1 + margin).toFixed(2)}× its units`);
  for (const [k, f] of Object.entries(figures)) {
    const b = base.figures[k];
    const ratio = b ? f.units / b.units : NaN;
    const ok = b && ratio <= 1 + margin;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${k.padEnd(8)} ${f.ms.toFixed(1).padStart(8)} ms  ${f.units.toFixed(3).padStart(8)} ${f.unit} units  ${b ? `${ratio.toFixed(2)}× the baseline's ${b.units.toFixed(3)} (${b.ms} ms then)` : 'no baseline'}   ${what[k]}`);
  }
  console.log(failed ? `${failed} figure(s) past the baseline: a regression, or a baseline to record again with --record if the change is meant` : 'all good');
}
await db.close();
process.exit(failed ? 1 : 0);
