// Offline support: cache-first for content-hashed build assets, network-first
// (falling back to cache) for everything else so deployments update promptly.
const CACHE = 'pon-intended-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

function put(req, res) {
  if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/assets/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => put(req, res))));
    return;
  }
  e.respondWith(
    fetch(req)
      .then(res => put(req, res))
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')).then(r => r || caches.match('./'))),
  );
});
