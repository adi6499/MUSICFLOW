// Sukoon service worker: keeps the app's own files on the device so it opens
// instantly and still opens offline. It never stores songs (downloaded songs
// are kept by the app itself, in its own storage), and it leaves requests to
// other sites (the catalog, artwork, audio) completely alone.

const CACHE = 'sukoon-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(['./', './manifest.webmanifest', './icon.svg'])).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// The page hands over the list of its own files after the first visit, so
// they are kept even though they were loaded before this worker took over.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'keep' || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter((u) => typeof u === 'string' && u.startsWith(self.location.origin) && u.includes('/assets/')).slice(0, 60);
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.all(urls.map((u) =>
      cache.match(u).then((hit) => hit || fetch(u).then((res) => { if (res.ok) return cache.put(u, res); }).catch(() => {})),
    ))).catch(() => {}),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return;

  // The page itself: fresh from the network when possible, saved copy otherwise.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./').then((hit) => hit || Response.error())),
    );
    return;
  }

  // Built files have a fingerprint in their name and never change: saved copy first.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })),
    );
    return;
  }

  // Icons and the like: saved copy now, refreshed quietly for next time.
  event.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit || Response.error());
      return hit || fresh;
    }),
  );
});
