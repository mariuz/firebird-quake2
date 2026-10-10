// browser-test.mjs – the page itself, in a real (headless) Chromium: the worker, the
// cross-origin isolation, the pak download, the game loop, the keys, a quick save and load.
//
//   node scripts/browser-test.mjs [--coi] [--keep]
//
// Builds and serves dist/ like scripts/build.mjs --serve. Without --coi the server sends no
// COOP/COEP headers, exactly like GitHub Pages, so the service worker has to supply the
// isolation and reload the page once: that is the deployed path, and the one tested by default.
// With --coi the headers come from the server and the service worker is bypassed.
//
// Needs the `playwright` dev dependency and a Chromium: `npx playwright install chromium`, or
// CHROME=/path/to/chrome to use one already there. The every-Node test scripts run the SQL
// through DirectTransport; this is the one that runs the page.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coi = process.argv.includes('--coi');
const PORT = Number(process.env.PORT ?? 8097);
const base = `http://localhost:${PORT}/`;

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); failed++; } else console.log(`ok   ${msg}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the server: build, then serve dist/ ───────────────────────────────────────────────────
const server = spawn(process.execPath, ['scripts/build.mjs', '--serve', ...(coi ? ['--coi'] : [])], {
  cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
let up = false;
for (let i = 0; i < 180 && !up; i++) {
  try { up = (await fetch(base)).ok; } catch { await sleep(1000); }
}
if (!up) { console.error('the dev server did not come up:\n' + serverLog); server.kill(); process.exit(1); }
console.log(`serving on ${base} (${coi ? 'COOP/COEP from the server' : 'no headers, like Pages: the service worker isolates'})`);

// ── the browser ───────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
const missing = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('response', (r) => { if (r.status() === 404) missing.push(new URL(r.url()).pathname); });

const status = () => page.evaluate(() => document.getElementById('status')?.textContent ?? '').catch(() => '');
const stats = () => page.evaluate(() => document.getElementById('stats')?.textContent ?? '').catch(() => '');
const isolated = () => page.evaluate(() => window.crossOriginIsolated).catch(() => false);

try {
  await page.goto(base, { waitUntil: 'load' });

  // isolation: with no headers the service worker installs and reloads the page once
  let iso = false;
  for (let i = 0; i < 30 && !iso; i++) { iso = await isolated(); if (!iso) await sleep(500); }
  assert(iso, `the page is cross-origin isolated${coi ? '' : ' through the service worker'}`);

  // the pak downloads, Firebird starts in its worker, the map loads and the loop runs
  let ready = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 300_000) {
    const s = await stats();
    if (/q2_tic \d+ ms/.test(s) && !/^0\.0 fps/.test(s)) { ready = true; break; }
    await sleep(1000);
  }
  assert(ready, `the game is running (${((Date.now() - t0) / 1000).toFixed(0)} s to the first frames): ${await stats()}`);
  assert((await status()) === '', 'no status message is left showing');

  if (ready) {
    // the loop advances: the frame counter in the stats line changes between reads
    const a = await stats(); await sleep(700); const b = await stats();
    assert(a !== b, 'frames keep coming');

    // keys reach the game: walk forward, then the quick save and quick load
    await page.mouse.click(480, 360);
    await page.keyboard.down('w'); await sleep(1200); await page.keyboard.up('w');
    await page.keyboard.press('F6');
    let saved = '';
    for (let i = 0; i < 20 && !/Game saved/.test(saved); i++) { await sleep(250); saved = await status(); }
    assert(/Game saved \(demo1, \d+ KB\)/.test(saved), `F6 saves: ${JSON.stringify(saved)}`);
    await page.keyboard.press('F9');
    let loaded = '';
    for (let i = 0; i < 240 && !/Game loaded/.test(loaded); i++) { await sleep(250); loaded = await status(); }
    assert(/Game loaded/.test(loaded), `F9 loads: ${JSON.stringify(loaded)}`);
    await sleep(1500);
    assert(/q2_tic \d+ ms/.test(await stats()), `the game runs on after the load: ${await stats()}`);
    const slot = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('firebird-quake2:save:')).length);
    assert(slot >= 1, `a save is in localStorage (${slot} slot(s))`);

    // the menu opens over the game (the loop pauses: the stats line stands still) and closes again
    await page.keyboard.press('Escape'); await sleep(500);
    const m1 = await stats(); await sleep(700); const m2 = await stats();
    assert(m1 === m2, 'Escape opens the menu and the game pauses');
    await page.keyboard.press('Escape'); await sleep(500);
    const m3 = await stats(); await sleep(700); const m4 = await stats();
    assert(m3 !== m4, 'Escape again closes it and the game goes on');
  }

  // nothing optional is loud: only the music tracks and the favicon may be missing
  const unexpected = missing.filter((p) => !/\/music\/|favicon/.test(p));
  assert(unexpected.length === 0, `no unexpected 404s (${missing.length} optional: ${[...new Set(missing)].join(', ') || 'none'})`);
  const loud = errors.filter((e) => !/404 \(Not Found\)/.test(e));
  assert(loud.length === 0, `no console errors${loud.length ? ':\n  ' + loud.join('\n  ') : ''}`);
} catch (e) {
  console.error('FAIL:', e.message);
  failed++;
} finally {
  if (!process.argv.includes('--keep')) { await browser.close(); server.kill(); }
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('all good');
process.exit(0);
