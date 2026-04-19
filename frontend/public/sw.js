const CACHE_NAME = "opencode-controller-v1";
const APP_SHELL = ["/", "/manifest.webmanifest", "/pwa-icon.svg"];

// Destinations that are safe to cache (static assets only).
const CACHEABLE_DESTINATIONS = new Set([
  "style", "script", "font", "image", "manifest",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  // Never intercept cross-origin requests.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Never intercept API calls or file downloads – always go to the network.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Navigation requests (HTML pages): network-first so deploys are picked up
  // immediately; fall back to cache when offline.
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            const clone = networkResponse.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static assets: cache-first, populate cache on first fetch.
  if (CACHEABLE_DESTINATIONS.has(request.destination)) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse.ok) {
            const clone = networkResponse.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        });
      })
    );
  }
});
