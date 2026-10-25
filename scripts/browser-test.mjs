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
    const state = () => page.evaluate(() => ({ coop: window.quake2?.session?.coop, deathmatch: window.quake2?.session?.deathmatch, clients: window.quake2?.session?.clients?.length,
      views: window.quake2?.renderer?.views, h: window.quake2?.renderer?.h, screenH: window.quake2?.renderer?.screenH, canvasH: document.getElementById('screen').height,
      dm: window.quake2?.session?.clients?.[0]?.DEATHMATCH, monsters: null })).catch(() => ({}));
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
    // a deathmatch: two clients against each other, the split view, the rows marked
    await page.selectOption('#players', 'dm');
    let dm = {};
    for (let i = 0; i < 240 && !(dm.deathmatch === true && dm.clients === 2 && dm.views === 2 && dm.dm === 1); i++) { await sleep(250); dm = await state(); }
    assert(dm.deathmatch === true && dm.coop === false && dm.clients === 2 && dm.views === 2 && dm.dm === 1, `two players in deathmatch: a new deathmatch with both clients, the split view, the rows marked (${JSON.stringify(dm)})`);
    const monsters = await page.evaluate(() => window.quake2.sql('SELECT COUNT(*) n FROM ents WHERE mtype IS NOT NULL').then((r) => r[0].N)).catch(() => -1);
    assert(monsters === 0, `and no monsters (${monsters})`);
    const d1 = await frames(page); await sleep(700); const d2 = await frames(page);
    assert(d2 > d1, `the deathmatch runs on (${d2 - d1} frames in 0.7 s)`);
    await page.selectOption('#players', '1');
    let one = {};
    for (let i = 0; i < 240 && !(one.coop === false && one.clients === 1 && one.views === 1); i++) { await sleep(250); one = await state(); }
    assert(one.coop === false && one.clients === 1 && one.views === 1 && one.h === one.screenH, `one player again: a new single-player game on the whole screen (${JSON.stringify(one)})`);

    // the pak's demo from the select: its map loads, the recording plays (the frame count climbs, the stats line says
    // so, no tic runs), a key stops it and a new game starts
    const demoState = () => page.evaluate(() => ({ demo: window.quake2?.demo, running: window.quake2?.running, map: document.getElementById('mapname')?.textContent,
      options: [...document.querySelectorAll('#demo option')].map((o) => o.value) })).catch(() => ({}));
    const ds0 = await demoState();
    assert(ds0.options?.includes('q2demo1'), `the Demo select lists the pak's demos (${JSON.stringify(ds0.options)})`);
    await page.selectOption('#demo', 'q2demo1');
    let ds = {};
    for (let i = 0; i < 240 && !(ds.demo && ds.demo.frame > 10); i++) { await sleep(250); ds = await demoState(); }
    assert(ds.demo?.name === 'q2demo1' && ds.demo.frame > 10 && ds.demo.frames === 632 && ds.running === true && /demo2 \(demo q2demo1\)/.test(ds.map),
      `the demo plays on its map: frame ${ds.demo?.frame} of ${ds.demo?.frames}, ${ds.map}`);
    assert(/demo q2demo1: frame \d+ of 632/.test(await stats()) && /q2_tic 0 ms/.test(await stats()), `the stats line says so, and no tic runs: ${await stats()}`);
    const dp1 = ds.demo.frame; await sleep(1000); const dp2 = (await demoState()).demo?.frame ?? -1;
    assert(dp2 > dp1 && dp2 - dp1 <= 12, `the recording runs at its own pace (${dp2 - dp1} frames in a second)`);
    await page.keyboard.press('Space');
    let stopped = {};
    for (let i = 0; i < 240 && !(stopped.demo === null && stopped.running === true && /^demo1$/.test(stopped.map ?? '')); i++) { await sleep(250); stopped = await demoState(); }
    assert(stopped.demo === null && stopped.running === true && stopped.map === 'demo1', `a key stops it and a new game starts on the first map (${JSON.stringify({ demo: stopped.demo, map: stopped.map })})`);
    assert((await page.evaluate(() => document.getElementById('demo').value)) === '', 'the select is back to none');
  }

  // two pages over WebRTC: this one hosts, a second joins with the texts passed between them (the offer and
  // the answer, as the players would pass them); the host's game has the guest's player in it, the guest paints
  // the host's frames, and its keys move its player at the host; when it leaves the host plays on
  if (ready) {
    const gctx = await browser.newContext({ viewport: { width: 960, height: 720 } });
    const gp = await gctx.newPage();
    gp.on('console', (m) => { if (m.type() === 'error') errors.push('guest: ' + m.text()); });
    gp.on('pageerror', (e) => errors.push(`guest pageerror: ${e.message}`));
    gp.on('response', (r) => { if (r.status() === 404) missing.push(new URL(r.url()).pathname); });
    await gp.goto(base, { waitUntil: 'load' });
    const gstats = () => gp.evaluate(() => document.getElementById('stats')?.textContent ?? '').catch(() => '');
    const t2 = Date.now();
    let gready = false;
    while (Date.now() - t2 < 300_000) { const s = await gstats(); if (/q2_tic \d+ ms/.test(s) && !/^0\.0 fps/.test(s)) { gready = true; break; } await sleep(1000); }
    assert(gready, 'a second page loads, to join from');
    if (gready) {
      const text = (p) => p.evaluate(() => document.getElementById('net-text')?.value ?? '').catch(() => '');
      await page.click('#net-host');
      let offer = '';
      for (let i = 0; i < 80 && !offer.startsWith('q2net1:'); i++) { await sleep(250); offer = await text(page); }
      assert(offer.startsWith('q2net1:') && offer.length < 4000, `Host makes an offer text to pass on (${offer.length} characters)`);
      await gp.click('#net-join');
      await gp.fill('#net-text', offer);
      await gp.click('#net-go');
      let answer = '';
      for (let i = 0; i < 80 && !(answer.startsWith('q2net1:') && answer !== offer); i++) { await sleep(250); answer = await text(gp); }
      assert(answer.startsWith('q2net1:') && answer !== offer, `Join answers it with a text to pass back (${answer.length} characters)`);
      await page.fill('#net-text', answer);
      await page.click('#net-go');
      const hstate = () => page.evaluate(() => ({ role: window.quake2?.net?.role, host: !!window.quake2?.net?.host, clients: window.quake2?.session?.clients?.length,
        coop: window.quake2?.session?.coop, views: window.quake2?.renderer?.views, sent: window.quake2?.net?.host?.sentFrames ?? 0 })).catch(() => ({}));
      const gstate = () => gp.evaluate(() => ({ role: window.quake2?.net?.role, frames: window.quake2?.net?.guest?.frames ?? 0, map: window.quake2?.net?.guest?.map?.name,
        w: window.quake2?.renderer?.w, h: window.quake2?.renderer?.h })).catch(() => ({}));
      let hs = {}, gs = {};
      for (let i = 0; i < 240 && !(hs.sent > 20 && gs.frames > 20); i++) { await sleep(250); hs = await hstate(); gs = await gstate(); }
      assert(hs.role === 'host' && hs.host && hs.coop && hs.clients === 2 && hs.views === 1 && hs.sent > 20,
        `connected, the host runs a game with two clients, one view of its own, and sends the guest its frames (${JSON.stringify(hs)})`);
      assert(gs.role === 'guest' && gs.map === 'demo1' && gs.frames > 20 && gs.w === 320 && gs.h === 240,
        `the guest has the host's map and paints the frames it is sent, at the host's view (${JSON.stringify(gs)})`);
      assert(/joined: \d+ frames from the host/.test(await gstats()) && /hosting: \d+ frames sent/.test(await stats()), 'both stats lines say so');
      // the guest's keys move its player at the host
      const p2 = () => page.evaluate(() => { const c = window.quake2.session.clients[1]; return [c.PX, c.PY]; }).catch(() => [0, 0]);
      const [x0, y0] = await p2();
      await gp.locator('#screen').click();   // (the page scrolled to the texts: the canvas, wherever it is)
      await gp.keyboard.down('w'); await sleep(1200); await gp.keyboard.up('w');
      await sleep(300);
      const [x1, y1] = await p2();
      const moved = Math.hypot(x1 - x0, y1 - y0);
      assert(moved > 50, `the guest's W walks its player at the host (${moved.toFixed(0)} units)`);
      // the guest leaves: the host plays on, the second player standing; the guest's page starts a game of its own
      await gp.evaluate(() => document.exitPointerLock?.());   // (the view holds the pointer since the click: a button needs it back)
      await sleep(300);
      await gp.click('#net-leave');
      let left = await hstate();
      for (let i = 0; i < 40 && left.role !== undefined; i++) { await sleep(250); left = await hstate(); }
      assert(left.role === undefined && left.clients === 2, `the guest leaves and the host's game goes on with its second player (${JSON.stringify(left)})`);
      const h1 = await frames(page); await sleep(700); const h2 = await frames(page);
      assert(h2 > h1, `the host's frames keep coming (${h2 - h1} in 0.7 s)`);
      let own = false;
      for (let i = 0; i < 80 && !own; i++) { const g1 = await frames(gp); await sleep(500); own = (await frames(gp)) > g1; }
      assert(own, 'and the guest\'s page plays a game of its own again');
      await page.selectOption('#players', '1');
      await sleep(500);
    }
    await gctx.close();
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
