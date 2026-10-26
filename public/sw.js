/*
 * sw.js – the caching service worker: the page runs installed, and without a network once it has run once.
 *
 * Two caches. `fbq2-build-<id>` holds the build's own files (the page, its script and stylesheet, the engine
 * Worker, the engine's glue and .wasm), every one under the URL the page asks for it by, with its ?v=; the page
 * fills it after its first load (main.js: the files it just used, from the browser's cache), and this worker adds
 * whatever else the build serves as it is fetched. `fbq2-data` holds the pak and the music tracks, which a build
 * does not change: the page puts the pak in as it downloads it, the tracks go in as they play. A new build's
 * worker (its id is written in by scripts/build.mjs) deletes the older builds' caches when it takes over, and
 * takes over at once (skipWaiting, clients.claim) so the page that fetched it is served by it.
 *
 * Fetches: the pak and the music come from the data cache, else the network (and into the cache); a navigation
 * comes from the network, else the cached page; anything else of this origin comes from the build cache, else
 * the network (and into the cache). Nothing of another origin is touched. A response that is not 200 (a 404 for a
 * music track that is not there, a 206 for a range of one) is not kept.
 *
 * public/coi-serviceworker.js, the retired worker that once supplied COOP/COEP, lives on at its own URL to
 * remove itself from the browsers that still have it; this one is registered at ./sw.js.
 */
const BUILD = '__BUILD__';
const BUILD_CACHE = `fbq2-build-${BUILD}`;
const DATA_CACHE = 'fbq2-data';
const PAGE = new URL('./', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const c = await caches.open(BUILD_CACHE);
    await c.addAll([PAGE]).catch(() => undefined);   // (the page itself, for a navigation offline; the rest as it is fetched)
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('fbq2-build-') && k !== BUILD_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isData = (url) => /\/pak\/[^/]+\.pak$/i.test(url.pathname) || /\/music\/[^/]+\.(ogg|mp3)$/i.test(url.pathname);

async function fromCache(cacheName, req, { fallback = null } = {}) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && res.status === 200 && !req.headers.get('range')) cache.put(req, res.clone()).catch(() => undefined);
    return res;
  } catch (err) {
    if (fallback) { const f = await cache.match(fallback); if (f) return f; }
    throw err;
  }
}

async function page(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(BUILD_CACHE)).put(PAGE, res.clone()).catch(() => undefined);
    return res;
  } catch (err) {
    const hit = await (await caches.open(BUILD_CACHE)).match(PAGE);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isData(url)) { event.respondWith(fromCache(DATA_CACHE, req)); return; }
  if (req.mode === 'navigate') { event.respondWith(page(req)); return; }
  event.respondWith(fromCache(BUILD_CACHE, req));
});
