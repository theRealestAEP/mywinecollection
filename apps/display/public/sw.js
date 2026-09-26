// The book's service worker. It keeps a copy of each file of the site, and of
// the fonts, as it fetches them. When the network fails, for example while a
// tablet waits for its Wi-Fi after a restart, it answers from the copy.
// src/main.ts keeps a copy of the wines.
const FONTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// A new version of this file takes over at once, and so does the first one.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const { origin, hostname } = new URL(request.url);
  if (request.method !== 'GET' || (origin !== location.origin && !FONTS.includes(hostname))) return;
  event.respondWith(
    fetch(request).then(
      (response) => {
        // The fonts' stylesheet comes back opaque, with no status to check.
        if (response.ok || response.type === 'opaque') {
          const copy = response.clone();
          event.waitUntil(caches.open('book').then((cache) => cache.put(request, copy)));
        }
        return response;
      },
      async () => (await caches.match(request)) ?? Response.error()
    )
  );
});
