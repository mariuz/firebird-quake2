/*
 * coi-serviceworker.js – retired.
 *
 * This service worker used to make the page cross-origin isolated on GitHub
 * Pages (which sends no COOP/COEP headers), because the threaded Firebird
 * WASM build needs SharedArrayBuffer. Since firebird-wasm 0.8.0 the page runs
 * the build without threads wherever it is not isolated, so it needs no
 * service worker, and the page no longer registers one.
 *
 * Browsers that registered the old one still check this URL for updates.
 * This version replaces it and removes itself: it unregisters, and reloads
 * the open pages once so they are served without it.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.registration.unregister();
    const pages = await self.clients.matchAll({ type: 'window' });
    for (const page of pages) page.navigate(page.url).catch(() => undefined);
  })());
});
