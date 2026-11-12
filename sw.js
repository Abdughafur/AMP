const CACHE_NAME = "amp-app-shell-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./src/audio-engine.js",
  "./src/equalizer.js",
  "./src/file-importer.js",
  "./src/metadata-parser.js",
  "./src/queue.js",
  "./src/storage.js",
  "./manifest.webmanifest",
  "./logo.jpeg",
  "./icons/amp-icon.svg",
  "./offline.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((error) => {
        console.error("AMP app shell could not be cached.", error);
        throw error;
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("amp-app-shell-") && key !== CACHE_NAME,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    request.destination === "audio" ||
    request.destination === "video"
  )
    return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put("./index.html", copy)),
            );
          }
          return response;
        })
        .catch(
          async () =>
            (await caches.match(request)) ||
            (await caches.match("./index.html")) ||
            (await caches.match("./offline.html")),
        ),
    );
    return;
  }

  const cacheable = ["script", "style", "image", "font", "manifest"].includes(
    request.destination,
  );
  if (!cacheable) return;
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      const network = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)),
          );
        }
        return response;
      });
      if (cached) {
        event.waitUntil(network.catch(() => undefined));
        return cached;
      }
      return network.catch(
        async () => (await caches.match(request)) || Response.error(),
      );
    })(),
  );
});
