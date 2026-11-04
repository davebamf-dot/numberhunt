// Makes NumberHunt work offline. Change VERSION whenever any file changes, so devices pick up the update.
const VERSION = "numberhunt-v3";
const FILES = [
  "./", "./index.html", "./style.css", "./game.js", "./app.js", "./manifest.webmanifest",
  "./fonts/barlow-300.woff2", "./fonts/barlow-500.woff2", "./fonts/barlow-600.woff2", "./fonts/barlow-700.woff2",
  "./icons/apple-touch-icon.png", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-512-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== VERSION).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => cached || fetch(event.request))
  );
});
