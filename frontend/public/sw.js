const CACHE_NAME = "opencode-controller-v2";
const APP_SHELL = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/pwa-icon.svg",
  "/pwa-icon-192.png",
  "/pwa-icon-512.png",
];

// Destinations that are safe to cache (static assets only).
const CACHEABLE_DESTINATIONS = new Set([
  "style", "script", "font", "image", "manifest",
]);

async function addAllSafe(cache, urls) {
  await Promise.all(
    urls.map(async (url) => {
      try {
        await cache.add(url);
      } catch {
        // Ignore individual precache failures so install can still complete.
      }
    })
  );
}

async function precacheAppShell(cache) {
  await addAllSafe(cache, APP_SHELL);

  try {
    const response = await fetch("/", { cache: "no-cache" });
    if (!response.ok) {
      return;
    }

    const html = await response.text();
    const assetMatches = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)];
    const assetUrls = assetMatches
      .map((match) => match[1])
      .filter((value) => typeof value === "string" && value.startsWith("/"))
      .filter((value) => !value.startsWith("/api/"));

    await addAllSafe(cache, [...new Set(assetUrls)]);
  } catch {
    // If the network is unavailable during install, rely on the static shell.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => precacheAppShell(cache))
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
        .catch(async () => (await caches.match(request)) || caches.match("/offline.html"))
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
