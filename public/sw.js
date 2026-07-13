// Service worker · LEAP Fitness Studio portal
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
// v11 (PERF, jun/2026): páginas autenticadas (/app/*, /admin/*) não
// são metidas em cache. Antes eram (network-first + cache write em
// todas as navegações RSC), o que (a) escrevia HTML/RSC per-user no
// CacheStorage — risco de privacidade num tablet partilhado entre
// users que faz logout/login, e (b) inflava a cache em MB nos
// primeiros minutos de uso. Agora estas rotas vão sempre à rede e
// caem em /offline em falha. As públicas (/, /login, /registar)
// continuam com cache, agora com event.waitUntil para garantir
// que a escrita conclui.
// v12 (jun/2026): bump para invalidar ícones PWA cacheados (cache-first
// em /icons/) — devices que tinham um ícone antigo/placeholder em cache
// passam a re-fetch dos ícones corretos no próximo arranque.
// v15 (jun/2026): ÍCONE DO HOME-SCREEN intermitente (50/50). O iOS busca o
// apple-touch-icon no momento do "Adicionar ao ecrã principal" com um
// timeout curto; como o apple-touch.png NÃO estava no precache, o SW tinha
// de ir à rede e em ligações lentas o iOS desistia e gerava o tile "L"
// fallback. Agora precache de TODOS os ícones de instalação + /icons/ em
// stale-while-revalidate (responde já do cache, actualiza em background).
// v16 (jun/2026): URL nova p/ o ícone 180 (apple-touch-180.png) — o
// iOS cacheia o apple-touch-icon por URL e re-adicionar não limpa;
// um URL novo força fetch fresco no iPhone.
// v17 (jun/2026): ícone maskable Android com fundo full-bleed +
// logo dentro da safe-zone (antes aparecia minúsculo num quadrado
// cinzento). Ficheiros novos → fetch fresco no re-install.
// v18 (jun/2026): REGRESSÃO do deep-link da notificação. O handler
// notificationclick passou (v13) a usar WindowClient.navigate() quando a
// PWA já estava aberta noutra página. No iOS standalone navigate() NÃO é
// suportado → rejeitava e só focava a página atual, nunca levava à agenda.
// Agora tenta navigate() e, se falhar/não existir, recorre a openWindow()
// (que no iOS navega a janela da PWA para o destino).
// v19 (jun/2026): deep-link da notificação fiável no iOS. Em vez de
// WindowClient.navigate() (sem efeito no iOS standalone) ou openWindow
// (que abre o start_url), o clique passa a (a) postMessage para a app
// navegar pelo router interno quando já está aberta, e (b) guardar a
// navegação pendente para a app pedir ao montar (cold start via push).
// v20 (jun/2026): deep-link de push em COLD START perdia-se. A navegação
// pendente vivia numa variável em memória (`pendingNav`); como o iOS/Android
// matam o SW agressivamente após o `notificationclick`, em arranques lentos
// o SW reiniciava (módulo re-avaliado → pendingNav=null) ANTES de a app
// pedir "get-pending-nav", deixando o utilizador preso no start_url
// (/app/dashboard) em vez do destino (ex.: /app/agenda do "Pack ativo").
// Agora a navegação pendente é PERSISTIDA na Cache API (sobrevive a
// reinícios do SW) numa cache dedicada que o `activate` nunca apaga.
// v22 (jun/2026): bump para propagar o fix do bottom nav a flutuar no
// arranque a frio do iOS PWA (altura do viewport medida em JS) — força
// `activate` a limpar caches antigas e dispara o reload por
// `controllerchange` no próximo arranque, sem reinstalar a PWA.
// v23 (jun/2026): barra inferior passa a `position: fixed` + scroll normal
// do documento (sem app-shell de altura fixa). O navegador ancora a barra
// ao fundo REAL do viewport, imune ao bug de altura do cold start iOS.
const CACHE_NAME = "leap-v24";

// Cache dedicada (NÃO versionada) para a navegação pendente de um push
// tocado com a app fechada. Mantida à parte de CACHE_NAME para não ser
// apagada quando a versão sobe no `activate`.
const NAV_CACHE = "leap-nav";
const PENDING_NAV_KEY = "/__leap_pending_nav__";

async function setPendingNav(dest) {
  try {
    const c = await caches.open(NAV_CACHE);
    await c.put(PENDING_NAV_KEY, new Response(dest, { headers: { "content-type": "text/plain" } }));
  } catch (e) {}
}

// Lê e CONSOME (apaga) a navegação pendente. Devolve null se não houver.
async function takePendingNav() {
  try {
    const c = await caches.open(NAV_CACHE);
    const res = await c.match(PENDING_NAV_KEY);
    if (!res) return null;
    await c.delete(PENDING_NAV_KEY);
    return await res.text();
  } catch (e) {
    return null;
  }
}

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
  // Ícones que o iOS/Android pedem ao "Adicionar ao ecrã principal" —
  // precache garante resposta imediata do cache no momento da instalação.
  "/icons/apple-touch.png",
  "/icons/apple-touch-180.png",
  "/icons/apple-touch-120.png",
  "/icons/apple-touch-152.png",
  "/icons/apple-touch-167.png",
  "/icons/icon-maskable-v2-192.png",
  "/icons/icon-maskable-v2-512.png",
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
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== NAV_CACHE)
          .map((k) => caches.delete(k))
      )
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

  // Ícones e manifest — stale-while-revalidate.
  // Responde JÁ a partir do cache (instantâneo — crucial para o iOS
  // apanhar o apple-touch-icon dentro do seu timeout curto ao instalar)
  // e, em paralelo, vai à rede actualizar o cache. Assim o ícone está
  // sempre disponível de imediato MAS nunca fica preso numa versão antiga.
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.json"
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => {
              if (res && res.ok) cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached);
          if (cached) {
            event.waitUntil(network.catch(() => {}));
            return cached;
          }
          return network;
        })
      )
    );
    return;
  }

  // Páginas autenticadas (/app/*, /admin/*) — SEM cache.
  // Cada utilizador vê os seus próprios dados; meter o RSC/HTML em
  // cache partilhada do browser leak para o próximo user que use o
  // dispositivo. Fallback /offline em caso de falha de rede.
  if (
    url.pathname.startsWith("/app/") ||
    url.pathname.startsWith("/admin/")
  ) {
    event.respondWith(
      fetch(req).catch(() => caches.match("/offline"))
    );
    return;
  }

  // Páginas públicas — network-first com cache write. event.waitUntil
  // garante que a escrita conclui mesmo se o handler termina cedo
  // (essencial em iOS, que mata o SW agressivamente após responder).
  if (
    url.pathname === "/" ||
    url.pathname === "/login" ||
    url.pathname === "/registar"
  ) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((c) => c.put(req, copy)));
          }
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
  const title = data.title || "LEAP Fitness Studio";
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

  // O `link` guardado é relativo (ex. "/app/agenda"); resolvemos para
  // absoluto só para comparar com c.url. À app enviamos o caminho relativo.
  const dest = new URL(target, self.location.origin).href;

  const focusOrOpen = self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then(async (list) => {
      // PERSISTE SEMPRE o destino na Cache ANTES de focar/abrir. A app lê
      // esta cache ao montar E sempre que volta a estar visível, por isso
      // o deep-link funciona mesmo que o postMessage abaixo se perca (comum
      // no iOS ao trazer uma PWA congelada para a frente) ou que o SW seja
      // reiniciado num cold start lento.
      await setPendingNav(dest);
      const client = list.find((c) => "focus" in c);
      if (client) {
        // App aberta/em segundo plano: foca e (best-effort) PEDE À APP para
        // navegar via postMessage. Se a mensagem se perder, o re-check da
        // cache no visibilitychange trata na mesma.
        try {
          await client.focus();
        } catch (e) {}
        client.postMessage({ type: "navigate", url: dest });
        return;
      }
      // App fechada: abre (o iOS abre no start_url; a app lê a cache e
      // redireciona para o destino real ao montar).
      if (self.clients.openWindow) {
        const w = await self.clients.openWindow(dest);
        if (w) {
          try {
            w.postMessage({ type: "navigate", url: dest });
          } catch (e) {}
        }
      }
    });

  event.waitUntil(Promise.all([markRead, focusOrOpen]));
});

// A app, ao montar, pergunta se há navegação pendente (cold start via
// push). Respondemos com o destino persistido na Cache e consumimo-lo.
// event.source é o cliente que perguntou.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "get-pending-nav") {
    event.waitUntil(
      (async () => {
        const url = await takePendingNav();
        if (url && event.source && "postMessage" in event.source) {
          event.source.postMessage({ type: "navigate", url });
        }
      })()
    );
  }
});


// ─── Rotação da subscrição de push ─────────────────────────────────
// O browser/OS pode rodar ou invalidar a subscrição (ex.: iOS passados
// uns dias). Quando isso acontece, este evento dispara: voltamos a
// subscrever com a MESMA VAPID key (lida da subscrição antiga) e enviamos
// o endpoint novo para /api/push/subscribe. Sem isto, a BD ficava com um
// endpoint morto e o cliente deixava de receber push em silêncio.
// Nota: nem todos os browsers disparam este evento (iOS é irregular) — o
// <PushAutoHeal/> no layout cobre esse caso a cada abertura da app.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const appServerKey =
          event.oldSubscription &&
          event.oldSubscription.options &&
          event.oldSubscription.options.applicationServerKey;
        const sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey || undefined,
        });
        const json = sub.toJSON();
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            endpoint: json.endpoint,
            p256dh: json.keys && json.keys.p256dh,
            auth: json.keys && json.keys.auth,
          }),
        }).catch(() => {});
      } catch (e) {
        // Sem applicationServerKey não dá para re-subscrever aqui; o
        // auto-heal trata na próxima abertura da app.
      }
    })()
  );
});
