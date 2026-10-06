// fetch-pak.mjs – get the Quake 2 demo data into public/pak/pak0.pak.
//
// The Quake 2 demo (q2-314-demo-x86.exe, 39 MB) is freely redistributable.
// It is a self-extracting zip holding Install/Data/baseq2/pak0.pak, which
// 7-Zip (7z) or unzip can open directly.
//
//   node scripts/fetch-pak.mjs                       downloads and extracts
//   PAK=/path/to/pak0.pak node scripts/fetch-pak.mjs copies a pak you have (the full game works too)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public/pak');
const out = path.join(outDir, 'pak0.pak');
fs.mkdirSync(outDir, { recursive: true });

if (process.env.PAK) {
  fs.copyFileSync(process.env.PAK, out);
  console.log(`copied ${process.env.PAK} → ${path.relative(root, out)}`);
  process.exit(0);
}
if (fs.existsSync(out)) {
  console.log(`${path.relative(root, out)} already present (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
  process.exit(0);
}

const URLS = [
  'https://ftp.gwdg.de/pub/misc/ftp.idsoftware.com/idstuff/quake2/q2-314-demo-x86.exe',
  'https://deponie.yamagi.org/quake2/idstuff/q2-314-demo-x86.exe',
  'https://archive.org/download/quake2demo/q2-314-demo-x86.exe',
];
const SIZE = 39015499;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'q2demo-'));
let exe = process.env.Q2DEMO_EXE ?? null;
if (!exe) {
  for (const url of URLS) {
    try {
      console.log(`downloading ${url}…`);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length !== SIZE) console.warn(`  size ${buf.length} differs from the known ${SIZE}; trying anyway`);
      exe = path.join(tmp, 'q2-314-demo-x86.exe');
      fs.writeFileSync(exe, buf);
      break;
    } catch (e) {
      console.warn(`  ${e.message}`);
    }
  }
}
if (!exe) {
  console.error('could not download the Quake 2 demo; put a pak0.pak at public/pak/pak0.pak yourself (PAK=... node scripts/fetch-pak.mjs)');
  process.exit(1);
}

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe', cwd: tmp });
const which = (cmds) => {
  for (const c of cmds) {
    try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [c], { stdio: 'pipe' }); return c; } catch { /* next */ }
  }
  return null;
};
const sevenZip = which(['7z', '7za', '7zz']) ?? (process.platform === 'win32' && fs.existsSync('C:/Program Files/7-Zip/7z.exe') ? 'C:/Program Files/7-Zip/7z.exe' : null);
try {
  const outTmp = path.join(tmp, 'x');
  fs.mkdirSync(outTmp, { recursive: true });
  // only the pak is needed; both tools accept a path filter
  if (sevenZip) run(sevenZip, ['x', '-y', `-o${outTmp}`, exe, 'Install/Data/baseq2/pak0.pak', '-r']);
  else if (which(['unzip'])) run('unzip', ['-o', exe, '*pak0.pak', '-d', outTmp]);
  else throw new Error('the demo is a self-extracting zip: install 7-Zip or unzip to extract it');
  const found = findFile(outTmp, /^pak0\.pak$/i);
  if (!found) throw new Error('pak0.pak not found inside the demo');
  fs.copyFileSync(found, out);
  console.log(`wrote ${path.relative(root, out)} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function findFile(dir, re) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = findFile(p, re); if (r) return r; } else if (re.test(e.name)) return p;
  }
  return null;
}
