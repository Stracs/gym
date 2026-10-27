// Offline-Kopie der App. Version erhöhen, wenn sich Dateien ändern.
const CACHE = 'gym-1.2.1';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'lib/chart.umd.min.js', 'manifest.json', 'icon.svg', 'icon-180.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('gym-') && k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
// Netz zuerst (immer neueste Version), offline aus dem Speicher
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
