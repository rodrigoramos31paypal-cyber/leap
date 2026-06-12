// Service worker · LEAP-FITNESS portal
// - Estáticos (icons, manifest) → cache-first.
// - Chunks Next.js (_next/static) → network-first (evita carregar
//   bundles obsoletos depois de um rebuild — era a causa dos
//   "Cannot read properties of undefined" intermitentes).
// - Páginas app/admin/públicas → network-first, fallback /offline.
// - APIs e auth → sempre rede.
//
// BUMP `CACHE_NAME` sempre que mexes em chunks/policies — o handler
// `activate` apaga as caches antigas e o utilizador pega já na nova.
const CACHE_NAME = "leap-v3";
const APP_SHELL = [
  "/",
  "/login",
  "/registar",
  "/offline",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon.svg",
  "/icons/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(APP_SHELL).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // APIs e auth — sempre rede
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  // Chunks Next.js (_next/static/) — network-first.
  // Caso contrário, após um rebuild os IDs dos chunks mudam e o SW
  // continua a servir os antigos do cache → "Cannot read properties
  // of undefined (reading 'call')" em webpack.js.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || Response.error())),
    );
    return;
  }

  // Estáticos imutáveis (icons, manifest) — cache-first
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.json"
  ) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        })
      )
    );
    return;
  }

  // Páginas dinâmicas — network-first com fallback offline
  if (
    url.pathname.startsWith("/app/") ||
    url.pathname.startsWith("/admin/") ||
    url.pathname === "/" ||
    url.pathname === "/login" ||
    url.pathname === "/registar"
  ) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match("/offline"))
        )
    );
  }
});
