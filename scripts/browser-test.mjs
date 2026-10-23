// browser-test.mjs – the page itself, in a real (headless) Chromium: the worker, the engine
// build it picks, the pak download, the game loop, the keys, a quick save and load.
//
//   node scripts/browser-test.mjs [--coi] [--keep]
//
// Builds and serves dist/ like scripts/build.mjs --serve. Without --coi the server sends no
// COOP/COEP headers, exactly like GitHub Pages: the page is not cross-origin isolated and runs
// firebird-wasm's build without threads. That is the deployed path, and the one tested by
// default. With --coi the headers come from the server and the page runs the threaded build.
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
console.log(`serving on ${base} (${coi ? 'COOP/COEP from the server: the threaded build' : 'no headers, like Pages: the build without threads'})`);

// ── the browser ───────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
const missing = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('response', (r) => { if (r.status() === 404) missing.push(new URL(r.url()).pathname); });
// The engine binary each page asked for: the build it runs.
const engines = new Set();
page.on('request', (r) => { const m = /(firebird-embedded(-st)?\.wasm)/.exec(r.url()); if (m) engines.add(m[1]); });

const status = () => page.evaluate(() => document.getElementById('status')?.textContent ?? '').catch(() => '');
const stats = () => page.evaluate(() => document.getElementById('stats')?.textContent ?? '').catch(() => '');
// The frames the game has played (src/session.js counts them): the stats line is rounded, and two reads of it
// can match while frames come, so whether the game runs or stands is read from this count.
const frames = (p) => p.evaluate(() => window.quake2?.session?.frameNo ?? -1).catch(() => -1);
const isolated = () => page.evaluate(() => window.crossOriginIsolated).catch(() => false);

try {
  await page.goto(base, { waitUntil: 'load' });

  // isolation comes from the server's headers or not at all: no service worker supplies it
  assert((await isolated()) === coi, coi ? 'the page is cross-origin isolated (the server\'s headers)' : 'the page is not cross-origin isolated, as on Pages');
  const workers = await page.evaluate(() => navigator.serviceWorker?.getRegistrations().then((r) => r.length) ?? 0);
  assert(workers === 0, `no service worker is registered (${workers})`);

  // the pak downloads, Firebird starts in its worker, the map loads and the loop runs
  let ready = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 300_000) {
    const s = await stats();
    if (/q2_tic \d+ ms/.test(s) && !/^0\.0 fps/.test(s)) { ready = true; break; }
    await sleep(1000);
  }
  assert(ready, `the game is running (${((Date.now() - t0) / 1000).toFixed(0)} s to the first frames): ${await stats()}`);
  const want = coi ? 'firebird-embedded.wasm' : 'firebird-embedded-st.wasm';
  assert(engines.size === 1 && engines.has(want), `it runs ${coi ? 'the threaded build' : 'the build without threads'} (${[...engines].join(', ') || 'none'})`);
  assert((await page.evaluate(() => document.getElementById('engine')?.textContent ?? '')).includes(coi ? ', threads' : 'Firebird'),
    'the page says which build it runs');
  assert((await status()) === '', 'no status message is left showing');

  if (ready) {
    // the loop advances: the frame counter in the stats line changes between reads
    const a = await frames(page); await sleep(700); const b = await frames(page);
    assert(b > a, `frames keep coming (${b - a} in 0.7 s)`);

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

    // the menu opens over the game (the loop pauses: no frame is played) and closes again
    await page.keyboard.press('Escape'); await sleep(500);
    const m1 = await frames(page); await sleep(700); const m2 = await frames(page);
    assert(m1 === m2, 'Escape opens the menu and the game pauses');
    await page.keyboard.press('Escape'); await sleep(500);
    const m3 = await frames(page); await sleep(700); const m4 = await frames(page);
    assert(m4 > m3, `Escape again closes it and the game goes on (${m4 - m3} frames in 0.7 s)`);

    // two players: the players select starts a new coop game; both clients come with every tic, the screen is
    // split in two views half as high, the game runs on; then one player again, the whole screen
    const state = () => page.evaluate(() => ({ coop: window.quake2?.session?.coop, clients: window.quake2?.session?.clients?.length,
      views: window.quake2?.renderer?.views, h: window.quake2?.renderer?.h, screenH: window.quake2?.renderer?.screenH, canvasH: document.getElementById('screen').height })).catch(() => ({}));
    await page.selectOption('#players', '2');
    let two = {};
    for (let i = 0; i < 240 && !(two.coop === true && two.clients === 2 && two.views === 2); i++) { await sleep(250); two = await state(); }
    assert(two.coop === true && two.clients === 2 && two.views === 2, `two players: a new coop game with both clients and a split view (${JSON.stringify(two)})`);
    assert(two.h * 2 === two.screenH && two.screenH === two.canvasH, `each view is half the screen (${two.h} of ${two.screenH})`);
    const c1 = await frames(page); await sleep(700); const c2 = await frames(page);
    assert(c2 > c1, `the coop game runs on (${c2 - c1} frames in 0.7 s)`);
    await page.keyboard.press('Escape'); await sleep(500);
    assert((await state()).views === 1, 'the menu over a coop game takes the whole screen');
    await page.keyboard.press('Escape'); await sleep(700);
    assert((await state()).views === 2, 'and the split view comes back with the game');
    await page.selectOption('#players', '1');
    let one = {};
    for (let i = 0; i < 240 && !(one.coop === false && one.clients === 1 && one.views === 1); i++) { await sleep(250); one = await state(); }
    assert(one.coop === false && one.clients === 1 && one.views === 1 && one.h === one.screenH, `one player again: a new single-player game on the whole screen (${JSON.stringify(one)})`);
  }

  // a touch screen: the on-screen buttons show, and taps on them and on the view's halves reach the game
  if (ready) {
    const touchCtx = await browser.newContext({ hasTouch: true, viewport: { width: 800, height: 600 } });
    const tp = await touchCtx.newPage();
    tp.on('console', (m) => { if (m.type() === 'error') errors.push('touch: ' + m.text()); });
    tp.on('pageerror', (e) => errors.push(`touch pageerror: ${e.message}`));
    tp.on('response', (r) => { if (r.status() === 404) missing.push(new URL(r.url()).pathname); });
    await tp.goto(base, { waitUntil: 'load' });
    const tstats = () => tp.evaluate(() => document.getElementById('stats')?.textContent ?? '').catch(() => '');
    const t1 = Date.now();
    let tready = false;
    while (Date.now() - t1 < 300_000) { const s = await tstats(); if (/q2_tic \d+ ms/.test(s) && !/^0\.0 fps/.test(s)) { tready = true; break; } await sleep(1000); }
    assert(tready, 'with a touch screen the game loads too');
    if (tready) {
      const shown = await tp.evaluate(() => { const t = document.getElementById('touch'); return !!t && !t.hidden && getComputedStyle(t).display !== 'none'; });
      assert(shown, 'the on-screen buttons show on a touch screen');
      const box = await tp.locator('#screen').boundingBox();
      await tp.touchscreen.tap(box.x + box.width * 0.25, box.y + box.height * 0.5);   // the move half: a tap jumps
      await tp.touchscreen.tap(box.x + box.width * 0.75, box.y + box.height * 0.5);   // the look half: a tap fires
      for (const act of ['jump', 'weapon', 'fire']) await tp.locator(`#touch button[data-act="${act}"]`).tap();
      await sleep(1000);
      assert(/q2_tic \d+ ms/.test(await tstats()), 'the game runs on after the taps');
      await tp.locator('#touch button[data-act="menu"]').tap();
      await sleep(600);
      const m1 = await frames(tp); await sleep(700); const m2 = await frames(tp);
      assert(m1 === m2, 'the menu button opens the menu and the game pauses');
      await tp.locator('#touch button[data-act="menu"]').tap();
      await sleep(600);
      const m3 = await frames(tp); await sleep(700); const m4 = await frames(tp);
      assert(m4 > m3, `and again closes it (${m4 - m3} frames in 0.7 s)`);
    }
    await touchCtx.close();
  }

  // a browser that still has the old service worker (it isolated the page before firebird-wasm
  // 0.8.0): the script at its URL now removes itself, and reloads the page once without it
  {
    const ctx = await browser.newContext();
    const sp = await ctx.newPage();
    sp.on('pageerror', (e) => errors.push(`retire pageerror: ${e.message}`));
    await sp.goto(base, { waitUntil: 'domcontentloaded' });
    let loads = 0;
    sp.on('load', () => { loads++; });
    await sp.evaluate(() => navigator.serviceWorker.register('./coi-serviceworker.js'));
    let left = 1;
    for (let i = 0; i < 40 && (left > 0 || loads === 0); i++) {
      await sleep(250);
      left = await sp.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length)).catch(() => 1);
    }
    assert(left === 0, 'the retired service worker unregisters itself');
    assert(loads >= 1, `and reloads the page it held (${loads} reload(s))`);
    await ctx.close();
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
