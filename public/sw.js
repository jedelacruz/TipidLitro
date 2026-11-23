// Offline support: app shell is cached; price/forecast API responses are network-first with
// the last good copy kept for offline use.
const SHELL = 'tl-shell-v3';
const DATA = 'tl-data-v2';
const SHELL_FILES = ['/', '/index.html', '/css/app.css', '/js/app.js', '/js/lib.js', '/js/ui.js', '/js/theme-init.js', '/icon.svg', '/vendor/leaflet/leaflet.css', '/vendor/leaflet/leaflet.js', '/vendor/chart/chart.umd.js'];
const OFFLINE_API = ['/api/prices/summary', '/api/prices/region/', '/api/prices/weeks', '/api/prices/history', '/api/forecast', '/api/news', '/api/vehicles', '/api/status'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (!OFFLINE_API.some((p) => url.pathname.startsWith(p))) return;
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(DATA).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || new Response(JSON.stringify({ error: 'You are offline.' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))));
    return;
  }
  // Static files: network first (so updates show immediately), cache as fallback.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && (url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/') || url.pathname.startsWith('/vendor/'))) {
      const copy = res.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))));
});
