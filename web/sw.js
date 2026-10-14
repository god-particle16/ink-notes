// Offline cache. Every published release gets its own cache (named after the commit).
// Unstamped (local testing) the worker stays out of the way and everything loads from the network.
const BUILD = '__BUILD__';                       // replaced with the commit id by the publish workflow
const V = 'inknotes-' + BUILD, DEV = BUILD.startsWith('__');
const FILES = ['./', 'index.html', 'style.css', 'boot.js', 'web-api.js', 'renderer.js', 'app.js', 'landing.js', 'pdf.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => {
  const fresh = !!self.registration.active;     // an update: skip the HTTP cache so we never store stale files
  e.waitUntil(caches.open(V)
    .then(c => Promise.all(FILES.map(u => c.add(new Request(u, { cache: fresh ? 'reload' : 'default' })))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (DEV || r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(caches.match(r, { ignoreSearch: true }).then(hit => hit || fetch(r)));     // cache first: instant, works offline
});
