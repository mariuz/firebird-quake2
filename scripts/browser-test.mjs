// browser-test.mjs – the page itself, in a real (headless) Chromium: the worker, the engine
// build it picks, the pak download, the game loop, the keys, a quick save and load, a game recorded
// at the console and played back from the Demo select.
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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { parseDemo } from '../src/demo.js';
import { makeCin } from '../src/cinematic.js';

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
// the signalling relay (scripts/signal.mjs) on the next port, for the network section: the pages' rtc_signal
const RELAY_PORT = PORT + 1;
const relay = spawn(process.execPath, ['scripts/signal.mjs'], { cwd: root, env: { ...process.env, PORT: String(RELAY_PORT) }, stdio: ['ignore', 'ignore', 'pipe'] });
let relayUp = false;
for (let i = 0; i < 60 && !relayUp; i++) { try { relayUp = (await fetch(`http://localhost:${RELAY_PORT}/rooms/ZZZZ`)).status === 404; } catch { await sleep(500); } }

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

  // the pak downloads, Firebird starts in its worker, the map loads and the loop runs
  let ready = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 300_000) {
    const s = await stats();
    if (/q2_tic \d+ ms/.test(s) && !/^0\.0 fps/.test(s)) { ready = true; break; }
    await sleep(1000);
  }
  assert(ready, `the page is up (${((Date.now() - t0) / 1000).toFixed(0)} s to the first frames): ${await stats()}`);
  // the attract loop: the page opens on the pak's demo with the main menu over it, as Quake 2 did; Escape puts the menu
  // away and the demo plays on, a key brings it back; the save menu is not to be had; the Map select starts the game
  const attractState = () => page.evaluate(() => ({ demo: window.quake2?.demo, running: window.quake2?.running, menu: window.quake2?.menu?.current?.id ?? null,
    map: document.getElementById('mapname')?.textContent, select: document.getElementById('map')?.value })).catch(() => ({}));
  let at = await attractState();
  assert(at.demo?.name === 'q2demo1' && at.running === true && at.menu === 'main' && /\(demo q2demo1\)/.test(at.map ?? '') && at.select === 'demo1',
    `the page opens on the attract loop: the demo with the main menu over it (${JSON.stringify({ demo: at.demo?.name, menu: at.menu, map: at.map, select: at.select })})`);
  const af0 = at.demo.frame; await sleep(800); at = await attractState();
  assert(at.demo?.frame > af0 && at.menu === 'main', `the demo plays on behind the menu (frame ${af0} → ${at.demo?.frame})`);
  await page.keyboard.press('Escape'); await sleep(300);
  at = await attractState();
  assert(at.menu === null && at.demo, 'Escape puts the menu away, the demo stays');
  await page.keyboard.press('Space'); await sleep(300);
  await page.keyboard.press('F2'); await sleep(300);
  at = await attractState();
  assert(at.menu === 'main' && at.demo, `a key brings the main menu back, and F2 opens no save menu over a demo (${at.menu})`);
  await page.selectOption('#map', 'demo1');
  let playing = false;
  for (let i = 0; i < 240 && !playing; i++) { await sleep(250); const a = await attractState(); const s = await stats(); playing = a.demo === null && a.running === true && a.menu === null && /q2_tic \d+ ms/.test(s) && !/^0\.0 fps/.test(s); }
  assert(playing, `the Map select starts the game, the demo and the menu gone (${JSON.stringify(await attractState())})`);
  const want = coi ? 'firebird-embedded.wasm' : 'firebird-embedded-st.wasm';
  assert(engines.size === 1 && engines.has(want), `it runs ${coi ? 'the threaded build' : 'the build without threads'} (${[...engines].join(', ') || 'none'})`);
  assert((await page.evaluate(() => document.getElementById('engine')?.textContent ?? '')).includes(coi ? ', threads' : 'Firebird'),
    'the page says which build it runs');
  assert((await status()) === '', 'no status message is left showing');

  // the caching service worker (public/sw.js) is registered once the game is up, and the page fills its caches: the
  // build's files under their ?v= URLs and the pak; the manifest and its icons are served; the "offline ready" pill shows
  const offline = () => page.evaluate(async () => ({
    workers: (await navigator.serviceWorker.getRegistrations()).map((r) => (r.active ?? r.waiting ?? r.installing)?.scriptURL ?? '?'),
    caches: await caches.keys(),
    pill: !document.getElementById('offline').hidden,
    build: await caches.open((await caches.keys()).find((k) => k.startsWith('fbq2-build-')) ?? 'none').then((c) => c.keys()).then((ks) => ks.map((r) => new URL(r.url).pathname + new URL(r.url).search)),
    pak: await caches.open('fbq2-data').then((c) => c.keys()).then((ks) => ks.map((r) => new URL(r.url).pathname)),
  })).catch((e) => ({ error: e.message }));
  let off = {};
  for (let i = 0; i < 240 && !off.pill; i++) { await sleep(250); off = await offline(); }
  assert(off.workers?.length === 1 && /\/sw\.js$/.test(off.workers[0]), `the caching service worker is registered, and no other (${JSON.stringify(off.workers ?? off.error)})`);
  const engineFile = coi ? 'firebird-embedded' : 'firebird-embedded-st';
  assert(off.pill && off.build?.some((p) => /\/main\.js\?v=\w+$/.test(p)) && off.build.some((p) => p.endsWith('/') || p.endsWith('/index.html')) && off.build.some((p) => new RegExp(`/${engineFile}\\.wasm\\?v=`).test(p))
    && off.build.some((p) => p.endsWith('/manifest.webmanifest')) && off.pak?.some((p) => p.endsWith('/pak/pak0.pak')),
    `the build's files and the pak are cached and the page says offline ready (${off.build?.length} build files, pak: ${off.pak?.join(', ')})`);
  const manifest = await page.evaluate(() => fetch('./manifest.webmanifest').then((r) => r.json())).catch(() => null);
  assert(manifest?.name === 'Firebird Quake 2' && manifest.display === 'standalone' && manifest.icons?.length === 2 && (await page.evaluate(() => document.querySelector('link[rel=manifest]')?.href ?? '')).endsWith('/manifest.webmanifest'),
    'the web app manifest is linked and served, with its two icons');
  const icons = await page.evaluate(() => Promise.all(['./icon-192.png', './icon-512.png'].map((u) => fetch(u).then((r) => r.ok && r.headers.get('content-type'))))).catch(() => []);
  assert(icons.every((t) => /image\/png/.test(t || '')), `the icons are served as PNG (${icons.join(', ')})`);

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

    // the credits scroll from the game menu; the keys menu (options, customize controls) binds K to attack through
    // the page's keys, kept in the settings, and K then fires; reset defaults puts the keys back
    const menuId = () => page.evaluate(() => window.quake2?.menu?.current?.id ?? null).catch(() => null);
    const press = async (...codes) => { for (const c of codes) { await page.keyboard.press(c); await sleep(120); } };
    await press('Escape', 'Enter', 'ArrowUp', 'Enter');
    assert((await menuId()) === 'credits', 'the game menu\'s last item opens the credits');
    await sleep(1200);
    const scrolled = await page.evaluate(() => performance.now() - (window.quake2.menu.current.start ?? performance.now())).catch(() => 0);
    assert(scrolled > 1000, `which scroll (${scrolled.toFixed(0)} ms in)`);
    await press('Escape', 'Escape', 'ArrowDown', 'ArrowDown', 'Enter', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
    assert((await menuId()) === 'keys', 'options, customize controls opens the keys menu');
    await press('Enter', 'KeyK');
    const bound = await page.evaluate(() => ({ attack: window.quake2.settings.binds.attack, stored: JSON.parse(localStorage.getItem('firebird-quake2:settings')).binds.attack, input: window.quake2.input.bound('KeyK') })).catch(() => ({}));
    assert(bound.attack?.join() === 'KeyK' && bound.stored?.join() === 'KeyK' && bound.input === 'attack', `Enter then K binds attack to K, kept in the settings (${JSON.stringify(bound)})`);
    await press('Escape', 'Escape', 'Escape');
    assert((await menuId()) === null, 'Escape leaves the menus');
    const shots = () => page.evaluate(() => window.quake2.sql("SELECT COUNT(*) n FROM sound_events WHERE snd = 'weapons/blastf1a.wav'").then((r) => r[0].N)).catch(() => -1);
    const sh0 = await shots();
    await page.keyboard.down('k'); await sleep(700); await page.keyboard.up('k'); await sleep(300);
    const sh1 = await shots();
    assert(sh1 > sh0 && sh0 >= 0, `K now fires the blaster (${sh0} → ${sh1} shots)`);
    await press('Escape', 'Enter', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');   // (the main menu's cursor stayed on options)
    const reset = await page.evaluate(() => window.quake2.settings.binds.attack.join()).catch(() => '');
    assert(reset === 'Control,Mouse1', `reset defaults puts the keys back (${reset})`);
    await press('Escape', 'Escape');
    assert((await menuId()) === null, 'and the menus close');
    // the mouse: the left button fires under the lock (MOUSE1, attack's second default key), the wheel changes weapon,
    // and in the keys menu a button binds (Enter on attack, then the right button)
    // (the lock: Chromium refuses a request made too soon after the menus let the pointer go, so the click is
    // tried until the canvas holds it, and the button held until a shot is heard, a slow runner allowed its time)
    const locked = () => page.evaluate(() => document.pointerLockElement === document.getElementById('screen')).catch(() => false);
    for (let i = 0; i < 10 && !(await locked()); i++) { await page.mouse.click(480, 360); await sleep(500); }
    assert(await locked(), 'a click on the view locks the pointer');
    const sm0 = await shots();
    await page.mouse.down();
    let sm1 = sm0;
    for (let i = 0; i < 30 && !(sm1 > sm0); i++) { await sleep(200); sm1 = await shots(); }
    await page.mouse.up(); await sleep(300);
    assert(sm1 > sm0, `the left mouse button fires the blaster under the lock (${sm0} → ${sm1} shots)`);
    await page.evaluate(() => document.exitPointerLock?.()); await sleep(400);
    if ((await menuId()) !== 'main') await press('Escape');   // (the pointer let go brings the main menu up by itself)
    await press('Enter', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');   // (the main menu's cursor stayed on options)
    assert((await menuId()) === 'keys', `the keys menu again (${await menuId()})`);
    await press('Enter');
    await page.mouse.click(480, 360, { button: 'right' }); await sleep(200);
    const mouseBound = await page.evaluate(() => ({ attack: window.quake2.settings.binds.attack.join(), grab: !!window.quake2.menu.current?.grab, menu: window.quake2.menu.current?.id })).catch(() => ({}));
    assert(mouseBound.attack === 'Mouse2' && !mouseBound.grab && mouseBound.menu === 'keys', `Enter then the right button binds attack to MOUSE2 (${JSON.stringify(mouseBound)})`);
    await press('Escape', 'ArrowDown', 'Enter');   // (back in options, the cursor on customize controls: reset defaults is next)
    await press('Escape', 'Escape');
    assert((await page.evaluate(() => window.quake2.settings.binds.attack.join()).catch(() => '')) === 'Control,Mouse1' && (await menuId()) === null, 'reset defaults puts MOUSE1 back on attack, and the menus close');

    // the tics are paced by the wall clock (20 Hz) and the frames painted between them: the game's clock never runs
    // ahead of the wall's, and at twenty frames a second or more runs at it, within what a runner's jitter loses (a
    // frame past 150 ms drops a tic by design); a slower page (CI's runner paints four a second right after a load)
    // runs at most two tics a frame and falls behind, slow motion as Quake 2's SV_Frame clamp gave it. Every frame
    // that tics paints; a tic counted between the two reads may not have painted yet. Measured once the page has
    // settled (right after a load it is at its slowest), over three seconds.
    const clock = () => page.evaluate(() => ({ game: window.quake2.session.last.TIME_, wall: performance.now(), tics: window.quake2.session.frameNo, paints: window.quake2.paints })).catch(() => null);
    await sleep(1000);
    const k0 = await clock(); await sleep(3000); const k1 = await clock();
    const secs = (k1.wall - k0.wall) / 1000, rate = (k1.game - k0.game) / secs, fps = (k1.paints - k0.paints) / secs;
    const ticFrames = k1.tics - k0.tics, gameTics = Math.round((k1.game - k0.game) / 0.05);
    if (fps >= 20) assert(rate > 0.6 && rate < 1.3, `the game's clock runs at the wall's (${rate.toFixed(2)}× over ${secs.toFixed(1)} s at ${fps.toFixed(0)} fps)`);
    else assert(rate < 1.3 && gameTics >= ticFrames && gameTics <= 2 * ticFrames + 2,
      `a page slower than the tic rate (${fps.toFixed(1)} fps) plays in slow motion, at most two tics a frame (${rate.toFixed(2)}×, ${gameTics} tics in ${ticFrames} frames)`);
    assert(k1.paints - k0.paints >= ticFrames - 1, `the frames painted (${k1.paints - k0.paints}) are at least the frames that ticked (${ticFrames})`);

    // the game as a file (the pointer is not locked here, so the page's controls take clicks): Download writes a
    // .q2sav (a slot's text), and the Saves file input loads one back
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.click('#save-download')]);
    const dlPath = dl ? await dl.path() : null;
    const dlText = dlPath ? fs.readFileSync(dlPath, 'utf8') : '';
    assert(dl && /^demo1-\d{4}-\d\d-\d\d-\d{4}\.q2sav$/.test(dl.suggestedFilename()) && dlText.startsWith('q2gz1\n'), `Download writes the game as a file (${dl?.suggestedFilename()}, ${(dlText.length / 1024).toFixed(0)} KB)`);
    // (the game's clock says whether the file came back: it ran on a second after the download, and the load sets it back)
    const gameTime = () => page.evaluate(() => window.quake2.session.last.TIME_).catch(() => -1);
    const tSaved = await gameTime();
    await sleep(1000);
    const tOn = await gameTime();
    await page.setInputFiles('#save-file', { name: 'moved.q2sav', mimeType: 'text/plain', buffer: Buffer.from(dlText) });
    let fileLoaded = '';
    for (let i = 0; i < 240 && !/Game loaded/.test(fileLoaded); i++) { await sleep(250); fileLoaded = await status(); }
    // (the session's row is the last tic's: the first tic after the load brings the file's clock)
    let tBack = tOn;
    for (let i = 0; i < 40 && tBack >= tOn; i++) { await sleep(100); tBack = await gameTime(); }
    assert(/Game loaded/.test(fileLoaded) && tOn > tSaved + 0.5 && tBack < tOn && tBack <= tSaved + 0.5,
      `the file loads back and the game is where the file had it (${JSON.stringify(fileLoaded)}: the clock at ${tSaved.toFixed(2)} s when saved, ${tOn.toFixed(2)} s before the load, ${tBack.toFixed(2)} s after)`);
    await page.setInputFiles('#save-file', { name: 'junk.q2sav', mimeType: 'text/plain', buffer: Buffer.from('not a save') });
    await sleep(500);
    assert(/is not a saved game/.test(await status()), `a file that is no save is refused: ${JSON.stringify(await status())}`);
    // a slot of the load menu as a file: F2 Enter saves slot 1, F3 opens the load menu on it, d writes it as it is stored
    await page.keyboard.press('F2'); await sleep(300); await page.keyboard.press('Enter');
    let slotSaved = '';
    for (let i = 0; i < 20 && !/Game saved/.test(slotSaved); i++) { await sleep(250); slotSaved = await status(); }
    await page.keyboard.press('F3'); await sleep(300);
    const loadMenu = await page.evaluate(() => ({ id: window.quake2?.menu?.current?.id ?? null, cursor: window.quake2?.menu?.current?.cursor, slot1: localStorage.getItem('firebird-quake2:save:save1') })).catch(() => ({}));
    const [dl3] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.keyboard.press('KeyD')]);
    const dl3Text = dl3 ? fs.readFileSync(await dl3.path(), 'utf8') : '';
    const stillLoad = await page.evaluate(() => window.quake2?.menu?.current?.id ?? null).catch(() => null);
    assert(/Game saved/.test(slotSaved) && loadMenu.id === 'load' && loadMenu.cursor === 1 && dl3 && dl3.suggestedFilename() === 'save1-demo1.q2sav' && dl3Text === loadMenu.slot1 && stillLoad === 'load',
      `F2 Enter saves slot 1, the load menu opens on it, and d writes the slot as a file, as stored (${dl3?.suggestedFilename()}, ${(dl3Text.length / 1024).toFixed(0)} KB), the menu staying up`);
    await page.keyboard.press('Escape'); await sleep(300);
    await sleep(1500);
    assert(/q2_tic \d+ ms/.test(await stats()), `the game runs on after the file load: ${await stats()}`);

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
    // four players: four clients, the screen in quarters (each view half as wide and half as high), the game runs on
    await page.selectOption('#players', '4');
    let fourp = {};
    const state4 = () => page.evaluate(() => ({ coop: window.quake2?.session?.coop, clients: window.quake2?.session?.clients?.length, views: window.quake2?.renderer?.views,
      w: window.quake2?.renderer?.w, h: window.quake2?.renderer?.h, screenW: window.quake2?.renderer?.screenW, screenH: window.quake2?.renderer?.screenH, players: window.quake2?.settings?.players })).catch(() => ({}));
    for (let i = 0; i < 240 && !(fourp.coop === true && fourp.clients === 4 && fourp.views === 4); i++) { await sleep(250); fourp = await state4(); }
    assert(fourp.coop === true && fourp.clients === 4 && fourp.views === 4 && fourp.players === 4, `four players: a new coop game with four clients and four views (${JSON.stringify(fourp)})`);
    assert(fourp.w * 2 === fourp.screenW && fourp.h * 2 === fourp.screenH, `each view a quarter of the screen (${fourp.w}×${fourp.h} of ${fourp.screenW}×${fourp.screenH})`);
    const q1 = await frames(page); await sleep(700); const q2 = await frames(page);
    assert(q2 > q1, `the game of four runs on (${q2 - q1} frames in 0.7 s)`);
    await page.selectOption('#players', '1');
    let one = {};
    for (let i = 0; i < 240 && !(one.coop === false && one.clients === 1 && one.views === 1); i++) { await sleep(250); one = await state(); }
    assert(one.coop === false && one.clients === 1 && one.views === 1 && one.h === one.screenH, `one player again: a new single-player game on the whole screen (${JSON.stringify(one)})`);

    // the console: the backquote opens the line; `skill 3` sets nightmare for the next game (the setting keeps it, the
    // Skill select shows it through its hidden option, Quake's latched-cvar notice shows), `map demo1` starts a game
    // whose row says 3, and `skill 1` puts medium back
    const skillState = () => page.evaluate(() => ({ setting: window.quake2?.settings?.skill, select: document.getElementById('skill').value,
      shown: document.getElementById('skill').selectedOptions[0]?.textContent, status: document.getElementById('status')?.textContent,
      stored: JSON.parse(localStorage.getItem('firebird-quake2:settings') ?? '{}').skill })).catch(() => ({}));
    const typeCommand = async (line) => { await page.mouse.click(480, 360); await sleep(200); await page.keyboard.press('Backquote'); await sleep(200); await page.keyboard.type(line); await page.keyboard.press('Enter'); await sleep(300); };
    await typeCommand('skill 3');
    const nm = await skillState();
    assert(nm.setting === 3 && nm.stored === 3 && nm.select === '3' && nm.shown === 'Nightmare' && /skill will be changed for next game/.test(nm.status ?? ''),
      `skill 3 at the console sets nightmare for the next game, kept in the settings and shown by the select (${JSON.stringify(nm)})`);
    await typeCommand('map demo1');
    let gskill = -1;
    for (let i = 0; i < 240 && gskill !== 3; i++) { await sleep(250); gskill = await page.evaluate(() => window.quake2.sql('SELECT skill FROM game').then((r) => r[0].SKILL)).catch(() => -1); }
    assert(gskill === 3, `and the next game is played at nightmare (game.skill ${gskill})`);
    for (let i = 0; i < 240 && !/q2_tic \d+ ms/.test(await stats()); i++) await sleep(250);
    await typeCommand('skill 1');
    const md = await skillState();
    assert(md.setting === 1 && md.select === '1' && md.shown === 'Medium', `skill 1 puts medium back (${JSON.stringify({ setting: md.setting, shown: md.shown })})`);
    // the silencer's and the power shield's keys (l and h: default.cfg's s and p are the page's back and pause): with
    // everything given, l silences thirty shots and h turns the power shield on
    await typeCommand('give all');
    const items = () => page.evaluate(() => window.quake2.sql('SELECT silencer_shots, power_armor, inv_silencer FROM player').then((r) => r[0])).catch(() => ({}));
    const it0 = await items();
    await page.keyboard.press('KeyL'); await sleep(300);
    const it1 = await items();
    await page.keyboard.press('KeyH'); await sleep(300);
    const it2 = await items();
    assert(it0.SILENCER_SHOTS === 0 && it1.SILENCER_SHOTS === 30 && it1.INV_SILENCER === it0.INV_SILENCER - 1 && it0.POWER_ARMOR === 0 && it2.POWER_ARMOR === 1,
      `l uses the silencer (${it0.SILENCER_SHOTS} → ${it1.SILENCER_SHOTS} silenced shots) and h the power shield (on: ${it2.POWER_ARMOR})`);
    // the notify lines (src/notify.js): the game's answer to `use nosuch` ("unknown item: nosuch", a print) is drawn at the
    // top for three seconds; the console opened again shows its scrollback with the line typed and the print, and hides
    // it when it closes
    await typeCommand('use nosuch');
    const nl = await page.evaluate(() => { const q = window.quake2; return { lines: q.notify.lines(q.session.last.TIME_), log: q.notify.log(6) }; }).catch(() => ({}));
    await page.keyboard.press('Backquote'); await sleep(200);
    const opened = await page.evaluate(() => ({ shown: !document.getElementById('conlog').hidden, text: document.getElementById('conlog').textContent })).catch(() => ({}));
    await page.keyboard.press('Escape'); await sleep(200);
    const closed = await page.evaluate(() => document.getElementById('conlog').hidden).catch(() => false);
    assert(nl.lines?.includes('unknown item: nosuch') && nl.log?.includes(']use nosuch') && opened.shown && /\]use nosuch\nunknown item: nosuch/.test(opened.text ?? '') && closed,
      `the print is drawn in the notify lines and kept in the scrollback after the line typed, which the console shows and hides (${JSON.stringify({ lines: nl.lines, log: nl.log })})`);
    // the chat: T (messagemode) opens the console with "say " on its line, and the words go to the message line by the
    // player's name (Cmd_Say_f), drawn in the notify lines
    await page.mouse.click(480, 360); await sleep(200);
    await page.keyboard.press('KeyT'); await sleep(200);
    const chatLine = await page.evaluate(() => ({ hidden: document.getElementById('cmdline').hidden, value: document.getElementById('cmdline').value })).catch(() => ({}));
    await page.keyboard.type('Hello, World!'); await page.keyboard.press('Enter'); await sleep(400);
    const chat = await page.evaluate(() => { const q = window.quake2; return { lines: q.notify.lines(q.session.last.TIME_), msg: q.session.last.MSG }; }).catch(() => ({}));
    assert(!chatLine.hidden && chatLine.value === 'say ' && chat.msg === 'player 1: Hello, World!' && chat.lines?.includes('player 1: Hello, World!'),
      `T opens the console with "say ", and the words reach the message line by the player's name (${JSON.stringify({ chatLine, chat })})`);
    // rtc_ice: the ICE server for the network game, kept in the settings and shown; cleared again before the network
    // section below (a relay that is not there would hold each offer three seconds)
    await typeCommand('rtc_ice turn:relay.example.org:3478 ace secret');
    const ice = await page.evaluate(() => ({ setting: window.quake2.settings.rtcIce, stored: JSON.parse(localStorage.getItem('firebird-quake2:settings')).rtcIce, status: document.getElementById('status')?.textContent })).catch(() => ({}));
    await typeCommand('rtc_ice none');
    const iceOff = await page.evaluate(() => window.quake2.settings.rtcIce).catch(() => null);
    assert(ice.setting === 'turn:relay.example.org:3478 ace secret' && ice.stored === ice.setting && /rtc_ice: turn:relay.example.org:3478 for the next network game/.test(ice.status ?? '') && iceOff === '',
      `rtc_ice keeps a TURN server in the settings for the next network game, and none clears it (${JSON.stringify(ice)})`);
    // the settings as cvars: sensitivity and name set at the console reach the settings (stored), the name the game's
    // player row as the player setup's does; cvarlist shows them
    await typeCommand('sensitivity 5');
    await typeCommand('name Ace');
    let cvName = '';
    for (let i = 0; i < 20 && cvName !== 'Ace'; i++) { await sleep(250); cvName = await page.evaluate(() => window.quake2.session.last.NETNAME).catch(() => ''); }
    await typeCommand('cvarlist');
    const cv = await page.evaluate(() => ({ sens: window.quake2.settings.sensitivity, stored: JSON.parse(localStorage.getItem('firebird-quake2:settings')).sensitivity, name: window.quake2.settings.name, list: document.getElementById('status')?.textContent })).catch(() => ({}));
    assert(cv.sens === 5 && cv.stored === 5 && cv.name === 'Ace' && cvName === 'Ace' && /sensitivity "5"/.test(cv.list ?? '') && /name "Ace"/.test(cv.list ?? ''),
      `sensitivity and name at the console reach the settings and the game's row, cvarlist shows them (${JSON.stringify(cv)})`);
    // writeconfig downloads config.cfg with the keys and the cvars; the settings put back, the file run through the Config
    // control (exec's picker) brings them again
    const [cfgDl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), typeCommand('writeconfig')]);
    const cfgText = cfgDl ? fs.readFileSync(await cfgDl.path(), 'utf8') : '';
    await typeCommand('sensitivity 7'); await typeCommand('name ""');
    const cfgBefore = await page.evaluate(() => ({ sens: window.quake2.settings.sensitivity, name: window.quake2.settings.name })).catch(() => ({}));
    await page.setInputFiles('#cfg-file', { name: 'config.cfg', mimeType: 'text/plain', buffer: Buffer.from(cfgText) });
    let ran = '';
    for (let i = 0; i < 40 && !/config\.cfg: \d+ lines run/.test(ran); i++) { await sleep(250); ran = await status(); }
    const cfgAfter = await page.evaluate(() => ({ sens: window.quake2.settings.sensitivity, name: window.quake2.settings.name, attack: window.quake2.settings.binds.attack.join() })).catch(() => ({}));
    await typeCommand('sensitivity 7'); await typeCommand('name ""');
    assert(cfgDl && cfgDl.suggestedFilename() === 'config.cfg' && /^unbindall$/m.test(cfgText) && /^bind MOUSE1 "\+attack"$/m.test(cfgText) && /^set sensitivity "5"$/m.test(cfgText) && /^set name "Ace"$/m.test(cfgText)
      && cfgBefore.sens === 7 && cfgBefore.name === '' && /config\.cfg: \d+ lines run/.test(ran) && cfgAfter.sens === 5 && cfgAfter.name === 'Ace' && cfgAfter.attack === 'Control,Mouse1',
      `writeconfig writes config.cfg (${cfgText.split('\n').length} lines) and the Config control runs it back: ${ran} (${JSON.stringify(cfgAfter)})`);
    // timescale: the game's clock against the wall's (the tics owed scaled; at most two a frame still, so a slow page
    // cannot reach twice the pace: at 2 the clock runs faster than the wall where the page keeps up, at 0.5 half as fast)
    const clock2 = () => page.evaluate(() => ({ game: window.quake2.session.last.TIME_, wall: performance.now(), paints: window.quake2.paints, scale: window.quake2.timescale })).catch(() => null);
    const measure = async () => { const a = await clock2(); await sleep(2000); const b = await clock2(); return { rate: (b.game - a.game) / ((b.wall - a.wall) / 1000), fps: (b.paints - a.paints) / ((b.wall - a.wall) / 1000), scale: b.scale }; };
    await typeCommand('timescale 2'); await sleep(300);
    const fast = await measure();
    await typeCommand('timescale 0.5'); await sleep(300);
    const slow = await measure();
    await typeCommand('timescale 1'); await sleep(300);
    const normal = await measure();
    assert(fast.scale === 2 && (fast.fps < 20 ? fast.rate <= 2.6 : fast.rate > 1.3 && fast.rate < 2.6) && slow.scale === 0.5 && slow.rate > 0.3 && slow.rate < 0.7 && normal.scale === 1 && normal.rate > 0.6 && normal.rate < 1.3,
      `timescale 2 runs the clock at ${fast.rate.toFixed(2)}× the wall's (${fast.fps.toFixed(0)} fps), 0.5 at ${slow.rate.toFixed(2)}×, 1 at ${normal.rate.toFixed(2)}×`);
    // bind and unbind at the console: Quake's words over the keys menu's binds, kept in the settings and read by the input
    await typeCommand('bind j +attack');
    const bj = await page.evaluate(() => ({ attack: window.quake2.settings.binds.attack.join(), stored: JSON.parse(localStorage.getItem('firebird-quake2:settings')).binds.attack.join(), input: window.quake2.input.bound('KeyJ'), status: document.getElementById('status')?.textContent })).catch(() => ({}));
    await typeCommand('unbind j');
    const uj = await page.evaluate(() => ({ attack: window.quake2.settings.binds.attack.join(), input: window.quake2.input.bound('KeyJ') })).catch(() => ({}));
    await typeCommand('bind ctrl +attack'); await typeCommand('bind mouse1 +attack');   // (the defaults back)
    const back = await page.evaluate(() => window.quake2.settings.binds.attack.join()).catch(() => '');
    assert(bj.attack === 'KeyJ' && bj.stored === 'KeyJ' && bj.input === 'attack' && bj.status === '"j" = "+attack"' && uj.attack === '' && uj.input === null && back === 'Control,Mouse1',
      `bind j +attack binds J to attack in the settings and the input, unbind j takes it off, bind ctrl and mouse1 put the defaults back (${JSON.stringify({ bj, uj, back })})`);

    // a recording: `record run` at the console writes the game from then on as a demo (src/record.js: the stats line
    // counts its frames), `stop` downloads it as run.dm2 (parsed here as the page parses the pak's: every block read
    // exactly, a frame a tenth of a second, the map and the blaster named) and puts it in the Demo select, which plays it
    const recState = () => page.evaluate(() => ({ rec: window.quake2?.recorder, list: window.quake2?.recordings(), status: document.getElementById('status')?.textContent,
      options: [...document.querySelectorAll('#demo option')].map((o) => o.value) })).catch(() => ({}));
    await typeCommand('record run');
    await sleep(1500);
    const mid = await recState();
    assert(mid.rec?.name === 'run' && mid.rec.frames > 3 && /recording run: \d+ frames/.test(await stats()), `record run records the game: ${mid.rec?.frames} frames so far, the stats line says so`);
    const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), typeCommand('stop')]);
    const dm2 = dl2 ? fs.readFileSync(await dl2.path()) : null;
    let parsed = null;
    try { parsed = dm2 ? parseDemo(new Uint8Array(dm2)) : null; } catch (e) { errors.push(`the recording does not parse: ${e.message}`); }
    assert(dl2 && dl2.suggestedFilename() === 'run.dm2' && parsed && parsed.protocol === 34 && parsed.frames.length >= mid.rec.frames && parsed.map === 'maps/demo1.bsp' && parsed.models.includes('models/weapons/v_blast/tris.md2'),
      `stop downloads run.dm2, which reads back whole: ${parsed?.frames.length} frames on ${parsed?.map}, ${parsed?.blocks} blocks (${dm2 ? (dm2.length / 1024).toFixed(0) : '?'} KB)`);
    const after = await recState();
    assert(after.rec === null && after.list?.includes('run') && after.options?.includes('run') && /^Recorded run\.dm2: \d+ frames/.test(after.status ?? ''),
      `the recording ends, is kept by name and listed in the Demo select (${after.status})`);
    await page.selectOption('#demo', 'run');
    let rd = {};
    for (let i = 0; i < 240 && !(rd.demo?.name === 'run' && rd.demo.frame > 3); i++) { await sleep(250); rd = await page.evaluate(() => ({ demo: window.quake2?.demo, map: document.getElementById('mapname')?.textContent })).catch(() => ({})); }
    assert(rd.demo?.name === 'run' && rd.demo.frame > 3 && rd.demo.frames === parsed?.frames.length && /demo1 \(demo run\)/.test(rd.map ?? ''), `the select plays the recording over its map: frame ${rd.demo?.frame} of ${rd.demo?.frames}, ${rd.map}`);
    // at its end the pak's next demo plays (the loop's nextserver), as the attract loop went on
    let nd = {};
    for (let i = 0; i < 120 && nd.demo?.name !== 'q2demo1'; i++) { await sleep(250); nd = await page.evaluate(() => ({ demo: window.quake2?.demo })).catch(() => ({})); }
    assert(nd.demo?.name === 'q2demo1', `at the recording's end the pak's demo plays next (${nd.demo?.name})`);
    // the recording is kept across reloads (src/demostore.js: IndexedDB), and a .dm2 file opens from the select's file
    // input, kept under its name and played; `demos` lists them; the reload below finds them again
    const stored = await page.evaluate(() => window.quake2.demoStore.list()).catch(() => null);
    assert(Array.isArray(stored) && stored.includes('run'), `the recording is in the store (${JSON.stringify(stored)})`);
    if (dm2) {
      await page.setInputFiles('#demo-file', { name: 'My Copy.dm2', mimeType: 'application/octet-stream', buffer: dm2 });
      let od = {};
      for (let i = 0; i < 240 && !(od.demo?.name === 'mycopy' && od.demo.frame > 3); i++) { await sleep(250); od = await page.evaluate(() => ({ demo: window.quake2?.demo, list: window.quake2?.recordings(), options: [...document.querySelectorAll('#demo option')].map((o) => o.value) })).catch(() => ({})); }
      assert(od.demo?.name === 'mycopy' && od.demo.frame > 3 && od.list?.includes('mycopy') && od.options?.includes('mycopy'), `a .dm2 file opened from the input plays under its cleaned name and is listed (${JSON.stringify({ demo: od.demo?.name, list: od.list })})`);
    }

    // (the demos end and go on to the pak's now: a game of the page's own under the cinematics below)
    await page.selectOption('#demo', '');
    for (let i = 0; i < 240; i++) { await sleep(250); if (await page.evaluate(() => !window.quake2?.demo && !!window.quake2?.running).catch(() => false)) break; }
    // a cinematic (src/cinematic.js): the demo pak has none, so one made here (twenty frames of 64×48 with a palette and
    // sound) plays through the page's SCR_PlayCinematic: the frames come at fourteen a second with the game stopped, it
    // ends on its own and the game goes on; a second one ends at a key
    const cinFrames = Array.from({ length: 20 }, (_, k) => ({ image: Uint8Array.from({ length: 64 * 48 }, (_, i) => ((i % 64) + k * 5) & 255), palette: k === 0 ? Uint8Array.from({ length: 768 }, (_, i) => (i * 3) & 255) : null, samples: Uint8Array.from({ length: 1600 }, (_, i) => 128 + Math.round(60 * Math.sin(i / 5))) }));
    const cinBytes = Array.from(makeCin({ width: 64, height: 48, frames: cinFrames }));
    await page.evaluate((b) => { window.quake2.cinematicFrom(b, 'test.cin'); }, cinBytes);
    let cs = null;
    for (let i = 0; i < 40 && !(cs && cs.frame >= 3); i++) { await sleep(100); cs = await page.evaluate(() => window.quake2.cinematic).catch(() => null); }
    const cRunning = await page.evaluate(() => window.quake2.running);
    assert(cs && cs.file === 'test.cin' && cs.frame >= 3 && cs.fps === 14 && cRunning === false, `a cinematic plays with the game stopped: frame ${cs?.frame} of twenty at ${cs?.fps} a second`);
    let cEnd = cs;
    for (let i = 0; i < 60 && cEnd; i++) { await sleep(100); cEnd = await page.evaluate(() => window.quake2.cinematic).catch(() => null); }
    const cBack = await page.evaluate(() => window.quake2.running);
    assert(cEnd === null && cBack === true, 'it ends on its own after its twenty frames and the game goes on');
    await page.evaluate((b) => { window.quake2.cinematicFrom(b, 'test2.cin'); }, cinBytes);
    await sleep(300);
    await page.keyboard.press('Space');
    await sleep(200);
    const cKey = await page.evaluate(() => ({ cin: window.quake2.cinematic, running: window.quake2.running }));
    assert(cKey.cin === null && cKey.running === true, 'a key ends a cinematic early, as SCR_FinishCinematic did');

    // the pak's demo from the select: its map loads, the recording plays (the frame count climbs, the stats line says
    // so, no tic runs), a key brings the main menu up over it and it plays on, the select put back to none starts a new game
    const demoState = () => page.evaluate(() => ({ demo: window.quake2?.demo, running: window.quake2?.running, map: document.getElementById('mapname')?.textContent,
      menu: window.quake2?.menu?.current?.id ?? null, options: [...document.querySelectorAll('#demo option')].map((o) => o.value) })).catch(() => ({}));
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
    await page.keyboard.press('Space'); await sleep(400);
    const overMenu = await demoState();
    assert(overMenu.menu === 'main' && overMenu.demo?.name === 'q2demo1' && overMenu.demo.frame > dp2, `a key brings the main menu up and the demo plays on behind it (frame ${overMenu.demo?.frame})`);
    await page.keyboard.press('Escape'); await sleep(200);
    await page.selectOption('#demo', '');
    let stopped = {};
    for (let i = 0; i < 240 && !(stopped.demo === null && stopped.running === true && /^demo1$/.test(stopped.map ?? '')); i++) { await sleep(250); stopped = await demoState(); }
    assert(stopped.demo === null && stopped.running === true && stopped.map === 'demo1' && stopped.menu === null, `the select put back to none starts a new game on the first map (${JSON.stringify({ demo: stopped.demo, map: stopped.map })})`);
    // timedemo (CL_Timedemo_f): the recording made above (run: a few seconds; the pak's would take minutes at a headless
    // page's rate) played a frame of the recording a painted frame, no pacing, the frames and the seconds reported at its
    // end and a new game started; screenshot (SCR_ScreenShot_f) downloads the view as quake00.png
    const tdFrames = parsed?.frames.length ?? 0;
    await typeCommand('timedemo run');
    let td = {};
    const tdState = () => page.evaluate(() => ({ done: window.quake2.lastTimedemo, demo: window.quake2.demo?.name ?? null, running: window.quake2.running, map: document.getElementById('mapname')?.textContent })).catch(() => ({}));
    for (let i = 0; i < 8 && !td.map?.includes('timedemo run'); i++) { await sleep(250); td = await tdState(); }
    const tdMap = td.map;
    for (let i = 0; i < 480 && !td.done; i++) { await sleep(250); td = await tdState(); }
    if (!td.done) await page.selectOption('#demo', '');   // (not done: the demo stopped, so the rest of the test goes on)
    for (let i = 0; i < 240 && !(td.demo === null && td.running); i++) { await sleep(250); td = await tdState(); }
    assert(/\(timedemo run\)/.test(tdMap ?? '') && td.done && Math.abs(td.done.frames - tdFrames) <= 2 && td.done.seconds > 0 && /^\d+ frames, [\d.]+ seconds: [\d.]+ fps$/.test(td.done.report) && td.demo === null && td.running,
      `timedemo plays the recording as fast as the page paints, a frame of its ${tdFrames} a painted frame, and reports it (${td.done?.report}), the game starting again`);
    const [shot] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), typeCommand('screenshot')]);
    const shotBytes = shot ? fs.readFileSync(await shot.path()) : Buffer.alloc(0);
    const shotSize = shotBytes.length > 24 ? `${shotBytes.readUInt32BE(16)}×${shotBytes.readUInt32BE(20)}` : '?';
    assert(shot && shot.suggestedFilename() === 'quake00.png' && shotBytes.subarray(1, 4).toString() === 'PNG' && shotSize === '320×240',
      `screenshot downloads the view as ${shot?.suggestedFilename()} (a PNG of ${shotSize}, ${shotBytes.length} bytes)`);
    // (a game running: the console takes `demos` and `deldemo`; a click during a demo would bring the menu up instead)
    if (dm2) {
      await typeCommand('demos');
      assert(/recorded: mycopy, run/.test(await page.evaluate(() => document.getElementById('status')?.textContent ?? '').catch(() => '')), 'demos lists the recordings kept');
      await typeCommand('deldemo mycopy');
      const dropped = await page.evaluate(async () => ({ list: window.quake2.recordings(), stored: await window.quake2.demoStore.list(), options: [...document.querySelectorAll('#demo option')].map((o) => o.value) })).catch(() => ({}));
      assert(!dropped.list?.includes('mycopy') && !dropped.stored?.includes('mycopy') && !dropped.options?.includes('mycopy') && dropped.stored?.includes('run'), `deldemo drops it from the list, the select and the store, the other staying (${JSON.stringify(dropped)})`);
    }

    // the player's files are kept across reloads too (src/demostore.js's file store): a pak picked from the PAK control
    // (a copy of the demo's under another name) loads and goes into the store with its name, and the game on demo1 with
    // a folder picked for the music (one file, track09.wav made here: demo1's track) keeps the track as it plays
    const pickedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbq2-picked-'));
    const pickedPath = path.join(pickedDir, 'picked.pak');
    fs.copyFileSync(path.join(root, 'public/pak/pak0.pak'), pickedPath);
    await page.setInputFiles('#pakfile', pickedPath);
    const pakState = () => page.evaluate(async () => ({ name: document.getElementById('pakname')?.textContent, picked: window.quake2?.pickedPak, forget: !document.getElementById('pak-forget')?.hidden,
      kept: await window.quake2.fileStore.list(), pak: (await window.quake2.fileStore.get('pak'))?.name ?? null, demo: window.quake2?.demo?.name ?? null, running: window.quake2?.running })).catch((e) => ({ error: e.message }));
    let ps = {};
    for (let i = 0; i < 480 && !(ps.name === 'picked.pak' && ps.pak === 'picked.pak' && ps.demo); i++) { await sleep(250); ps = await pakState(); }
    assert(ps.name === 'picked.pak' && ps.picked === 'picked.pak' && ps.forget && ps.pak === 'picked.pak' && ps.demo === 'q2demo1',
      `a picked pak loads (the attract loop again), is kept under its name and the button to forget it shows (${JSON.stringify(ps)})`);
    await page.selectOption('#map', 'demo1');
    let onDemo1 = {};
    for (let i = 0; i < 240 && !(onDemo1.demo === null && onDemo1.running === true && onDemo1.map === 'demo1'); i++) { await sleep(250); onDemo1 = await attractState(); }
    const wav = (() => {   // half a second of a 440 Hz tone, 8 kHz mono 16-bit: what decodeAudioData takes
      const n = 4000, b = Buffer.alloc(44 + n * 2);
      b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
      b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
      for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 8000)), 44 + i * 2);
      return b;
    })();
    const musicDir = path.join(pickedDir, 'music');
    fs.mkdirSync(musicDir);
    fs.writeFileSync(path.join(musicDir, 'track09.wav'), wav);
    await page.evaluate(() => { window.quake2.audio.unlock(); });
    await page.setInputFiles('#musicdir', musicDir);   // (a folder, as the control takes one)
    const musicState = () => page.evaluate(async () => ({ kind: window.quake2?.audio?.music?.kind ?? null, track: window.quake2?.audio?.track, mode: window.quake2?.audio?.musicMode,
      kept: await window.quake2.fileStore.list(), file: (await window.quake2.fileStore.get('music/track09'))?.name ?? null })).catch((e) => ({ error: e.message }));
    let ms = {};
    for (let i = 0; i < 80 && !(ms.kind === 'track' && ms.file); i++) { await sleep(250); ms = await musicState(); }
    assert(onDemo1.map === 'demo1' && ms.kind === 'track' && ms.track === 9 && ms.file === 'track09.wav' && ms.kept?.join() === 'music/track09,pak',
      `on demo1 the picked folder's track plays and is kept as it plays (${JSON.stringify(ms)})`);

    // without a network: the page reloads from the service worker's caches (the page, the build's files, the pak)
    // and the game runs as before; then the network is back
    await page.context().setOffline(true);
    let offReady = false;
    try {
      await page.reload({ waitUntil: 'load' });
      const t1 = Date.now();
      while (Date.now() - t1 < 120_000) { const s = await stats(); if (/q2_tic \d+ ms/.test(s) && !/^0\.0 fps/.test(s)) { offReady = true; break; } await sleep(1000); }
    } catch (e) { errors.push(`offline reload: ${e.message}`); }
    assert(offReady, `offline, the page loads from the caches and the game runs (${await stats()})`);
    assert(engines.has(want), 'on the same engine build');
    await page.context().setOffline(false);
    // the reload found the recording kept before it: listed in the select, and it plays from the store
    if (offReady) {
      const back = await page.evaluate(() => ({ list: window.quake2?.recordings(), options: [...document.querySelectorAll('#demo option')].map((o) => o.value) })).catch(() => ({}));
      assert(back.list?.includes('run') && back.options?.includes('run') && !back.options?.includes('mycopy'), `after the reload the recording kept is listed again, the dropped one not (${JSON.stringify(back)})`);
      await page.selectOption('#demo', 'run');
      let kd = {};
      for (let i = 0; i < 240 && !(kd.demo?.name === 'run' && kd.demo.frame > 3); i++) { await sleep(250); kd = await page.evaluate(() => ({ demo: window.quake2?.demo })).catch(() => ({})); }
      assert(kd.demo?.name === 'run' && kd.demo.frame > 3, `and it plays from the store (frame ${kd.demo?.frames ? kd.demo.frame : '?'} of ${kd.demo?.frames})`);
      await page.selectOption('#demo', '');   // (a game again: the console takes a command; a click during a demo brings the menu up)
      let again = {};
      for (let i = 0; i < 240 && !(again.demo === null && again.running === true); i++) { await sleep(250); again = await page.evaluate(() => ({ demo: window.quake2?.demo, running: window.quake2?.running })).catch(() => ({})); }
      await typeCommand('deldemo run');
      const gone = await page.evaluate(async () => ({ stored: await window.quake2.demoStore.list(), options: [...document.querySelectorAll('#demo option')].map((o) => o.value) })).catch(() => ({}));
      assert(!gone.stored?.includes('run') && !gone.options?.includes('run'), `deldemo drops it after the reload too (${JSON.stringify(gone)})`);
      // the reload (offline: no download to be had) loaded the picked pak from the store, and the game on demo1 plays the
      // kept track with no folder picked; the button forgets the pak: the demo's loads now, and the next start downloads it
      const kp = await pakState();
      assert(kp.name === 'picked.pak' && kp.picked === 'picked.pak' && kp.forget && kp.pak === 'picked.pak', `the picked pak was loaded from the store at the start (${JSON.stringify(kp)})`);
      await page.evaluate(() => { window.quake2.audio.unlock(); });
      let km = {};
      for (let i = 0; i < 80 && !(km.kind === 'track'); i++) { await sleep(250); km = await musicState(); }
      assert(km.kind === 'track' && km.track === 9 && km.file === 'track09.wav', `and the kept track plays, no folder picked (${JSON.stringify(km)})`);
      await page.click('#pak-forget');
      let fp = {};
      for (let i = 0; i < 480 && !(fp.name === 'pak0.pak' && fp.demo); i++) { await sleep(250); fp = await pakState(); }
      assert(fp.name === 'pak0.pak' && fp.picked === null && !fp.forget && fp.pak === null && fp.kept?.join() === 'music/track09', `the button forgets it: the demo's pak loads, the store keeps the track alone (${JSON.stringify(fp)})`);
    }
    fs.rmSync(pickedDir, { recursive: true, force: true });
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
      // through the relay (scripts/signal.mjs, spawned above; rtc_signal on both pages, set in place: both are on the attract
      // loop here, where a key brings the menu up and not the console): Host shows a four-letter code, the guest types it
      // after Join, the answer goes back by itself, and the room is dropped once they are connected; then the host's
      // console clears it (a game runs by then) for the third page's join by text
      const typeOn = async (p, line) => { await p.evaluate(() => document.exitPointerLock?.()); await p.mouse.click(480, 360); await sleep(200); await p.keyboard.press('Backquote'); await sleep(200); await p.keyboard.type(line); await p.keyboard.press('Enter'); await sleep(300); };
      assert(relayUp, `the signalling relay runs on port ${RELAY_PORT}`);
      for (const p of [page, gp]) await p.evaluate((url) => { window.quake2.settings.rtcSignal = url; }, `http://localhost:${RELAY_PORT}`);
      const relaySet = await Promise.all([page, gp].map((p) => p.evaluate(() => window.quake2?.settings?.rtcSignal).catch(() => null)));
      assert(relaySet.every((s) => s === `http://localhost:${RELAY_PORT}`), `rtc_signal points both pages at it (${relaySet.join(', ')})`);
      // (Host from the multiplayer menu's start network server, over the attract loop, where the main menu is up already
      // or a key brings it up; its cursor is put on multiplayer, wherever it was left)
      const menuKeys = async (p, ...codes) => { for (const c of codes) { await p.keyboard.press(c); await sleep(150); } };
      const toMultiplayer = async (p) => {
        if (!(await p.evaluate(() => window.quake2?.menu?.active).catch(() => false))) await menuKeys(p, 'Escape');
        await p.evaluate(() => { if (window.quake2.menu.current?.id === 'main') window.quake2.menu.mainCursor = 1; });
        await menuKeys(p, 'Enter');
        return p.evaluate(() => window.quake2?.menu?.current?.id ?? null).catch(() => null);
      };
      assert((await toMultiplayer(page)) === 'multiplayer', 'the main menu over the attract loop opens the multiplayer menu');
      await menuKeys(page, 'ArrowDown', 'Enter');
      let fromMenu = {};   // (the panel shows once the offer is made: the candidates take up to three seconds)
      for (let i = 0; i < 80 && !fromMenu.panel; i++) { await sleep(250); fromMenu = await page.evaluate(() => ({ menu: window.quake2?.menu?.current?.id ?? null, panel: !document.getElementById('net').hidden })).catch(() => ({})); }
      assert(fromMenu.menu === null && fromMenu.panel, `the multiplayer menu's start network server is Host: the menu goes away and the panel shows (${JSON.stringify(fromMenu)})`);
      let offer = '';   // (the code, here; the third page below joins by text)
      for (let i = 0; i < 80 && !/^[A-Z2-9]{4}$/.test(offer); i++) { await sleep(250); offer = await text(page); }
      const hostHelp = await page.evaluate(() => document.getElementById('net-help')?.textContent ?? '').catch(() => '');
      const room = /^[A-Z2-9]{4}$/.test(offer) ? (await fetch(`http://localhost:${RELAY_PORT}/rooms/${offer}`)).status : 0;
      assert(/^[A-Z2-9]{4}$/.test(offer) && hostHelp.includes(`the code ${offer}`) && room === 200, `Host publishes the offer at the relay and shows its code (${offer}; the room there: ${room})`);
      await toMultiplayer(gp);
      await menuKeys(gp, 'Enter');   // (join network server, from the menu too)
      const joinHelp = await gp.evaluate(() => (window.quake2?.menu?.active ? 'menu still up' : document.getElementById('net-help')?.textContent ?? '')).catch(() => '');
      assert(/Type the code/.test(joinHelp), `the menu's join network server is Join, which asks for the code (${joinHelp})`);
      await gp.fill('#net-text', offer.toLowerCase());
      await gp.click('#net-go');
      const answer = '';   // (none to pass by hand: the relay carries it)
      const hstate = () => page.evaluate(() => ({ role: window.quake2?.net?.role, guests: window.quake2?.net?.guests?.map((g) => g.client), clients: window.quake2?.session?.clients?.length,
        coop: window.quake2?.session?.coop, views: window.quake2?.renderer?.views, sent: window.quake2?.net?.guests?.reduce((n, g) => n + g.host.sentFrames, 0) ?? 0 })).catch(() => ({}));
      const gstate = () => gp.evaluate(() => ({ role: window.quake2?.net?.role, frames: window.quake2?.net?.guest?.frames ?? 0, map: window.quake2?.net?.guest?.map?.name,
        w: window.quake2?.renderer?.w, h: window.quake2?.renderer?.h })).catch(() => ({}));
      let hs = {}, gs = {};
      for (let i = 0; i < 240 && !(hs.sent > 20 && gs.frames > 20); i++) { await sleep(250); hs = await hstate(); gs = await gstate(); }
      assert(hs.role === 'host' && hs.guests?.length === 1 && hs.guests[0] === 2 && hs.coop && hs.clients === 2 && hs.views === 1 && hs.sent > 20,
        `connected, the host runs a game with two clients, one view of its own, and sends the guest its frames (${JSON.stringify(hs)})`);
      assert(gs.role === 'guest' && gs.map === 'demo1' && gs.frames > 20 && gs.w === 320 && gs.h === 240,
        `the guest has the host's map and paints the frames it is sent, at the host's view (${JSON.stringify(gs)})`);
      assert(/joined: \d+ frames from the host/.test(await gstats()) && /hosting: \d+ frames sent/.test(await stats()), 'both stats lines say so');
      // the guest's say goes to the host, which prints it for the guest's client on every message line
      await typeOn(gp, 'say hi from the guest');
      let gsaid = null;
      for (let i = 0; i < 20 && gsaid !== 'player 2: hi from the guest'; i++) { await sleep(250); gsaid = await page.evaluate(() => window.quake2.session.last.MSG).catch(() => null); }
      assert(gsaid === 'player 2: hi from the guest', `the guest's say reaches the host's message line by its client's name (${JSON.stringify(gsaid)})`);
      // a game command at the guest's console goes to the host (Cmd_ForwardToServer): god runs for the guest's client, the
      // answer on the guest's message line
      await typeOn(gp, 'god');
      let ggod = null;
      for (let i = 0; i < 20 && !(ggod?.flags & 16); i++) { await sleep(250); ggod = await page.evaluate(() => window.quake2.sql('SELECT e.flags, p.msg FROM player p JOIN ents e ON e.id = p.ent_id WHERE p.id = 2').then((r) => ({ flags: r[0].FLAGS, msg: r[0].MSG }))).catch(() => null); }
      let gmsg = null;
      for (let i = 0; i < 20 && gmsg !== 'godmode ON'; i++) { await sleep(250); gmsg = await gp.evaluate(() => window.quake2.net?.guest?.row?.MSG ?? null).catch(() => null); }
      await typeOn(gp, 'god');   // (off again)
      assert((ggod?.flags & 16) !== 0 && ggod?.msg === 'godmode ON' && gmsg === 'godmode ON', `god at the guest's console runs at the host for the guest's client, the answer on the guest's line (${JSON.stringify({ ggod, gmsg })})`);
      // the host's Players select at deathmatch makes the shared game a deathmatch: a new one with both clients, no
      // monster, the guest's row saying so with the score board's rows; back at one, a coop game again
      await page.selectOption('#players', 'dm');
      const dmState = () => page.evaluate(() => ({ dm: window.quake2.session.deathmatch, coop: window.quake2.session.coop, clients: window.quake2.session.clients?.length, guests: window.quake2.net?.guests?.length })).catch(() => ({}));
      const dmGuest = () => gp.evaluate(() => { const r = window.quake2.net?.guest?.row; return { dm: r?.DEATHMATCH, scores: r?.SCORES?.length, client: r?.CLIENT }; }).catch(() => ({}));
      let dms = {}, dmg = {};
      for (let i = 0; i < 120 && !(dms.dm === true && dms.clients === 2 && dmg.dm === 1 && dmg.scores === 2); i++) { await sleep(250); dms = await dmState(); dmg = await dmGuest(); }
      const dmMonsters = await page.evaluate(() => window.quake2.sql('SELECT COUNT(*) n FROM ents WHERE mtype IS NOT NULL').then((r) => r[0].N)).catch(() => -1);
      assert(dms.dm === true && dms.coop === false && dms.clients === 2 && dms.guests === 1 && dmMonsters === 0,
        `the host's select at deathmatch starts a deathmatch with both clients and no monster (${JSON.stringify(dms)}, ${dmMonsters} monsters)`);
      assert(dmg.dm === 1 && dmg.scores === 2 && dmg.client === 2, `the guest's row says deathmatch and carries the score board's two rows (${JSON.stringify(dmg)})`);
      await page.selectOption('#players', '1');
      for (let i = 0; i < 120 && !(dms.dm === false && dms.coop === true && dms.clients === 2); i++) { await sleep(250); dms = await dmState(); }
      assert(dms.dm === false && dms.coop === true && dms.clients === 2 && dms.guests === 1, `the select back at one, the shared game is coop again with both clients (${JSON.stringify(dms)})`);
      for (let i = 0; i < 40 && (await gp.evaluate(() => window.quake2.net?.guest?.row?.DEATHMATCH).catch(() => 1)) !== 0; i++) await sleep(250);
      // a shared game runs on under the host's menu and its pause key (Quake 2 paused single player alone): the host's
      // frames and the guest's keep coming
      await page.evaluate(() => document.exitPointerLock?.()); await sleep(300);
      if ((await page.evaluate(() => window.quake2.menu.active).catch(() => false)) === false) await page.keyboard.press('Escape');
      await sleep(400);
      const guestFrames = () => gp.evaluate(() => window.quake2.net?.guest?.frames ?? 0).catch(() => 0);
      const sm = await page.evaluate(() => window.quake2.menu.current?.id ?? null).catch(() => null);
      const sh1 = await frames(page), sg1 = await guestFrames();
      await sleep(700);
      const sh2 = await frames(page), sg2 = await guestFrames();
      await page.keyboard.press('Escape'); await sleep(300);
      await page.keyboard.press('KeyP'); await sleep(300);
      const sp = await page.evaluate(() => window.quake2.paused).catch(() => true);
      const sh3 = await frames(page); await sleep(700); const sh4 = await frames(page);
      assert(sm === 'main' && sh2 > sh1 && sg2 > sg1 && sp === false && sh4 > sh3,
        `the host's menu and P do not stop the shared game: ${sh2 - sh1} host tics and ${sg2 - sg1} guest frames under the menu, ${sh4 - sh3} tics after P (paused: ${sp})`);
      const roomAfter = /^[A-Z2-9]{4}$/.test(offer) ? (await fetch(`http://localhost:${RELAY_PORT}/rooms/${offer}`)).status : 0;
      assert(roomAfter === 404, `the room at the relay is dropped once they are connected (${roomAfter})`);
      await typeOn(page, 'rtc_signal none');
      const relayOff = await page.evaluate(() => ({ setting: window.quake2.settings.rtcSignal, status: document.getElementById('status')?.textContent })).catch(() => ({}));
      assert(relayOff.setting === '' && /the offer and the answer as texts/.test(relayOff.status ?? ''), `rtc_signal none at the host's console clears it (${JSON.stringify(relayOff)})`);
      // the guest's keys move its player at the host
      const p2 = () => page.evaluate(() => { const c = window.quake2.session.clients[1]; return [c.PX, c.PY]; }).catch(() => [0, 0]);
      const [x0, y0] = await p2();
      await gp.locator('#screen').click();   // (the page scrolled to the texts: the canvas, wherever it is)
      await gp.keyboard.down('w');
      // the guest predicts its own move (src/pmove.js): while walking, its predicted origin runs ahead of the row the
      // host last sent, by at most a few tics' worth
      let ahead = 0, samples = 0, farthest = 0, boxed = 0;
      for (let i = 0; i < 12; i++) {
        await sleep(100);
        const s = await gp.evaluate(() => { const p = window.quake2?.prediction, r = window.quake2?.net?.guest?.row; return p && r && p.x != null ? { d: Math.hypot(p.x - r.PX, p.y - r.PY), pending: p.pending, seq: p.seq, boxes: p.boxes } : null; }).catch(() => null);
        if (!s) continue;
        samples++;
        if (s.d > 0.5) ahead++;
        farthest = Math.max(farthest, s.d);
        boxed = Math.max(boxed, s.boxes ?? 0);
      }
      await gp.keyboard.up('w');
      await sleep(300);
      const [x1, y1] = await p2();
      const moved = Math.hypot(x1 - x0, y1 - y0);
      assert(moved > 50, `the guest's W walks its player at the host (${moved.toFixed(0)} units)`);
      assert(samples > 5 && ahead > 0 && farthest < 120, `the guest's own move is predicted ahead of the host's frames (${ahead} of ${samples} samples ahead, at most ${farthest.toFixed(1)} units)`);
      assert(boxed > 0, `the prediction clips against the box entities the frames carry (${boxed} about the guest)`);
      // the guest ticks spectate: the host puts its client back in as a watcher (no body, noclip); unticked, a player again
      await gp.evaluate(() => document.exitPointerLock?.());
      await sleep(300);
      await gp.check('#net-spectate');
      const c2 = () => page.evaluate(() => window.quake2.sql('SELECT e.solid, e.movetype, e.takedamage, p.spectator FROM player p JOIN ents e ON e.id = p.ent_id WHERE p.id = 2').then((r) => r[0])).catch(() => null);
      let watcher = null;
      for (let i = 0; i < 40 && !watcher; i++) { await sleep(250); const r = await c2(); if (r && r.SPECTATOR === 1 && r.SOLID === 0) watcher = r; }
      assert(watcher && watcher.MOVETYPE === 2 && watcher.TAKEDAMAGE === 0, `spectate ticked on the guest's page makes its client a watcher at the host (${JSON.stringify(watcher)})`);
      await gp.uncheck('#net-spectate');
      let player2 = null;
      for (let i = 0; i < 40 && !player2; i++) { await sleep(250); const r = await c2(); if (r && r.SPECTATOR === 0 && r.SOLID === 3) player2 = r; }
      assert(player2 && player2.MOVETYPE === 3 && player2.TAKEDAMAGE === 2, `unticked, a player again (${JSON.stringify(player2)})`);
      // a third page joins the game running: Host makes another offer while hosting, the third answers it, and the
      // host's game gets a third client (ClientBegin) that the third page drives, each guest sent its own frames
      const tctx = await browser.newContext({ viewport: { width: 960, height: 720 } });
      const tp = await tctx.newPage();
      tp.on('console', (m) => { if (m.type() === 'error') errors.push('third: ' + m.text()); });
      tp.on('pageerror', (e) => errors.push(`third pageerror: ${e.message}`));
      await tp.goto(base, { waitUntil: 'load' });
      const t3 = Date.now();
      let tready = false;
      while (Date.now() - t3 < 300_000) { const s = await tp.evaluate(() => document.getElementById('stats')?.textContent ?? '').catch(() => ''); if (/q2_tic \d+ ms/.test(s) && !/^0\.0 fps/.test(s)) { tready = true; break; } await sleep(1000); }
      assert(tready, 'a third page loads, to join from');
      if (tready) {
        await page.evaluate(() => document.exitPointerLock?.());
        await page.click('#net-host');
        let offer2 = '';
        // (the box held the first guest's answer until the new offer is made)
        for (let i = 0; i < 80 && !(offer2.startsWith('q2net1:') && offer2 !== offer && offer2 !== answer); i++) { await sleep(250); offer2 = await text(page); }
        assert(offer2.startsWith('q2net1:') && offer2 !== offer && offer2 !== answer, 'Host, while hosting, makes another offer for the next player');
        const mid = await hstate();
        assert(mid.role === 'host' && mid.guests?.length === 1 && mid.clients === 2, `and the game with the first guest goes on meanwhile (${JSON.stringify(mid)})`);
        await tp.click('#net-join');
        await tp.fill('#net-text', offer2);
        await tp.click('#net-go');
        let answer2 = '';
        for (let i = 0; i < 80 && !(answer2.startsWith('q2net1:') && answer2 !== offer2); i++) { await sleep(250); answer2 = await text(tp); }
        assert(answer2.startsWith('q2net1:'), 'the third page answers it');
        await page.fill('#net-text', answer2);
        await page.click('#net-go');
        const tstate = () => tp.evaluate(() => ({ role: window.quake2?.net?.role, frames: window.quake2?.net?.guest?.frames ?? 0, map: window.quake2?.net?.guest?.map?.name, client: window.quake2?.net?.guest?.row?.CLIENT })).catch(() => ({}));
        let h3 = {}, ts = {};
        for (let i = 0; i < 240 && !(h3.clients === 3 && ts.frames > 20); i++) { await sleep(250); h3 = await hstate(); ts = await tstate(); }
        assert(h3.role === 'host' && h3.guests?.length === 2 && h3.guests[1] === 3 && h3.clients === 3 && h3.coop && h3.views === 1,
          `the host's game has a third client, the second guest's, put in as it ran (${JSON.stringify(h3)})`);
        assert(ts.role === 'guest' && ts.map === 'demo1' && ts.frames > 20 && ts.client === 3, `the third page has the map as it is and its own frames, its row the third client's (${JSON.stringify(ts)})`);
        const g2f = await gp.evaluate(() => window.quake2?.net?.guest?.frames ?? 0).catch(() => 0);
        await sleep(700);
        const g2f2 = await gp.evaluate(() => window.quake2?.net?.guest?.frames ?? 0).catch(() => 0);
        assert(g2f2 > g2f, `the first guest's frames keep coming (${g2f2 - g2f} in 0.7 s)`);
        assert(/hosting: \d+ frames sent to 2 guests/.test(await stats()), 'the host\'s stats line counts both guests');
        // the third leaves: its client stands, the first guest plays on
        await tp.click('#net-leave');
        let h4 = await hstate();
        for (let i = 0; i < 40 && h4.guests?.length !== 1; i++) { await sleep(250); h4 = await hstate(); }
        assert(h4.role === 'host' && h4.guests?.length === 1 && h4.guests[0] === 2 && h4.clients === 3, `the third page leaves: the host keeps the first guest, its game its three clients (${JSON.stringify(h4)})`);
      }
      await tctx.close();
      // the guest leaves: the host plays on, its other players standing; the guest's page starts a game of its own
      await gp.evaluate(() => document.exitPointerLock?.());   // (the view holds the pointer since the click: a button needs it back)
      await sleep(300);
      await gp.click('#net-leave');
      let left = await hstate();
      for (let i = 0; i < 40 && left.role !== undefined; i++) { await sleep(250); left = await hstate(); }
      assert(left.role === undefined && left.clients === (tready ? 3 : 2), `the guest leaves and the host's game goes on with its other players (${JSON.stringify(left)})`);
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
    assert(tready, 'with a touch screen the page loads too');
    if (tready) {
      // (the page opens on the attract loop: the game from the Map select, as above)
      await tp.selectOption('#map', 'demo1');
      let tplaying = false;
      for (let i = 0; i < 240 && !tplaying; i++) { await sleep(250); tplaying = await tp.evaluate(() => !window.quake2?.demo && !!window.quake2?.running && !window.quake2?.menu?.active).catch(() => false); }
      assert(tplaying, 'and the Map select starts the game');
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
      left = await sp.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.filter((x) => /coi-serviceworker/.test((x.active ?? x.waiting ?? x.installing)?.scriptURL ?? '')).length)).catch(() => 1);
    }
    assert(left === 0, 'the retired service worker unregisters itself (the caching one stays)');
    assert(loads >= 1, `and reloads the page it held (${loads} reload(s))`);
    await ctx.close();
  }

  // nothing optional is loud: only the music tracks and the favicon may be missing
  const unexpected = missing.filter((p) => !/\/music\/|favicon/.test(p));
  assert(unexpected.length === 0, `no unexpected 404s (${missing.length} optional: ${[...new Set(missing)].join(', ') || 'none'})`);
  const loud = errors.filter((e) => !/404 \(Not Found\)/.test(e) && !(/\/music\//.test(e) && /Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_FAILED/.test(e)));   // (offline, the music is not there)
  assert(loud.length === 0, `no console errors${loud.length ? ':\n  ' + loud.join('\n  ') : ''}`);
} catch (e) {
  console.error('FAIL:', e.message);
  failed++;
} finally {
  if (!process.argv.includes('--keep')) { await browser.close(); server.kill(); relay.kill(); }
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('all good');
process.exit(0);
