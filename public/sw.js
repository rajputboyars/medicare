/* DawaDost service worker (v2) – small and conservative.
 *  - Precaches the offline page and icons so the app always opens, even with no signal.
 *  - /_next/static and /icons: cache-first (content-hashed, immutable).
 *  - Page navigations: network-first; on failure show the cached offline page.
 *  - Public images/fonts of our own origin: stale-while-revalidate.
 *  - NEVER caches /api responses or prescription files: they contain personal health information.
 *  - No background sync of orders: ordering needs a live connection so stock and prescription rules are enforced. */
const VERSION = "v2";
const STATIC = `mc-static-${VERSION}`;
const OFFLINE = `mc-offline-${VERSION}`;
const PRECACHE = ["/offline.html", "/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/rider-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(OFFLINE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![STATIC, OFFLINE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.registration.navigationPreload?.enable?.())
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never touch health data

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          return preload || (await fetch(req));
        } catch {
          return (await caches.match("/offline.html")) || Response.error();
        }
      })(),
    );
    return;
  }

  if (/\.(?:png|jpg|jpeg|webp|svg|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || fresh;
      }),
    );
  }
});
