// prof-summary.mjs – self time per function from a .cpuprofile (node --cpu-prof)
//   node scripts/prof-summary.mjs <dir-or-file> [top]
import fs from 'node:fs';
import path from 'node:path';
let p = process.argv[2];
if (fs.statSync(p).isDirectory()) {
  const files = fs.readdirSync(p).filter((f) => f.endsWith('.cpuprofile')).map((f) => path.join(p, f));
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  p = files[0];
}
const prof = JSON.parse(fs.readFileSync(p, 'utf8'));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = prof.timeDeltas;
for (let i = 0; i < prof.samples.length; i++) {
  const n = byId.get(prof.samples[i]);
  const cf = n.callFrame;
  const key = `${cf.functionName || '(anonymous)'} ${path.basename(cf.url)}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
const top = Number(process.argv[3] ?? 25);
console.log(`${p}: ${(total / 1000).toFixed(0)} ms sampled`);
for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${((100 * v) / total).toFixed(1).padStart(5)}%  ${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`);
