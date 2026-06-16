// Service worker · LEAP-FITNESS portal
// - Estáticos (icons, manifest) → cache-first.
// - Chunks Next.js (_next/static) → network-first (evita carregar
//   bundles obsoletos depois de um rebuild — era a causa dos
//   "Cannot read properties of undefined" intermitentes).
// - Páginas app/admin/públicas → network-first, fallback /offline.
// - APIs e auth → sempre rede.
// - Web Push → handlers `push` + `notificationclick` no fim do ficheiro.
//
// BUMP `CACHE_NAME` sempre que mexes em chunks/policies — o handler
// `activate` apaga as caches antigas e o utilizador pega já na nova.
const CACHE_NAME = "leap-v6";
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

// ─── Web Push ──────────────────────────────────────────────────────
// Payload (JSON) enviado por /api/push/dispatch: { title, body, url, id }.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = data.title || "LEAP-FITNESS";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // `id` = notificação in-app correspondente; usado no clique para a
    // marcar como lida e manter push/in-app sincronizados.
    data: { url: data.url || "/", id: data.id },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const info = event.notification.data || {};
  const target = info.url || "/";

  // Marca a notificação in-app como lida (push e in-app andam a par).
  // credentials:'include' → envia o cookie de sessão Supabase, por isso
  // funciona mesmo com a app fechada. Falha em silêncio (offline, etc.).
  const markRead = info.id
    ? fetch("/api/notifications/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: info.id }),
      }).catch(() => {})
    : Promise.resolve();

  const focusOrOpen = self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((list) => {
      for (const c of list) {
        if (c.url.includes(target) && "focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    });

  event.waitUntil(Promise.all([markRead, focusOrOpen]));
});
