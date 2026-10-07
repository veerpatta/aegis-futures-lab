/* Aegis service worker — offline screen and fast repeat loads. Nothing else.

   - Pages: network first. A fresh deploy is never hidden behind a cached page;
     a page opened before is shown from cache only when the network fails, and
     anything else falls back to /offline.
   - /_next/static: cache first. Those file names carry a content hash, so a
     cached copy can never be stale.
   - Fonts: cached after first use.
   - Data (prices, ideas, accounts): never cached here. A stale price shown as
     current would be worse than "offline". The screens keep their own last
     read for the session and say when it was taken.

   Bump VERSION to drop every older cache on the next visit. A new worker
   waits until the reader taps "Update now" (components/ui/ServiceWorker.tsx),
   so an update never interrupts what they are doing. Offline the app is
   read-only: nothing here queues a trade, a pause or any other command. */
const VERSION = "aegis-v2";
const SHELL = ["/offline", "/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && url.origin === self.location.origin) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match("/offline"))),
    );
    return;
  }

  const immutable = url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
  const font = url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com";
  if (immutable || font) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok || response.type === "opaque") {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
