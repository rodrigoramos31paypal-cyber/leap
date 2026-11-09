"use client";

// ════════════════════════════════════════════════════════════════
// Toaster · mostra confirmações depois de server actions.
// Recebe a flash inicial (lida a partir do cookie no layout RSC)
// e auto-dismiss em ~4s.
// ════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import type { Flash } from "@/lib/flash-types";

export function Toaster({ initial }: { initial: Flash | null }) {
  const [items, setItems] = useState<Array<Flash & { id: string }>>([]);
  // Dedup: a mesma mensagem pode chegar por duas vias quase em simultâneo
  // (cookie-watcher + `initial` do servidor após router.refresh). Ignora
  // repetições de conteúdo idêntico numa janela curta.
  const recentRef = useRef<Map<string, number>>(new Map());

  // empurra a flash inicial recebida do servidor (uma vez por mount).
  useEffect(() => {
    if (initial) push(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.title, initial?.kind, initial?.body]);

  // permite a outros componentes client emitirem toasts via window event.
  useEffect(() => {
    function onToast(e: Event) {
      const ce = e as CustomEvent<Flash>;
      if (ce.detail) push(ce.detail);
    }
    window.addEventListener("leap:toast", onToast as EventListener);
    return () => window.removeEventListener("leap:toast", onToast as EventListener);
  }, []);

  // Vigia o cookie de flash do LADO DO CLIENTE. Cobre o caso dos
  // `<form action={serverAction}>` que terminam em revalidatePath (sem
  // redirect): aí o layout RSC não relê o cookie na MESMA resposta, por
  // isso o toast ficava silencioso (ex.: "Guardar" nas Definições/Regras).
  // Aqui lemos o cookie no browser, mostramos o toast e apagamo-lo. Em
  // navegações/redirects o servidor consome o cookie primeiro (consumeFlash
  // apaga-o) → aqui não encontra nada, logo NÃO duplica.
  useEffect(() => {
    function readFlashCookie(): Flash | null {
      try {
        const m = document.cookie.match(/(?:^|;\s*)leap_flash=([^;]+)/);
        if (!m) return null;
        // Uso único: apaga já para não repetir no próximo tick.
        document.cookie = "leap_flash=; max-age=0; path=/";
        const parsed = JSON.parse(decodeURIComponent(m[1])) as Flash;
        return parsed && parsed.title ? parsed : null;
      } catch {
        return null;
      }
    }
    function check() {
      const f = readFlashCookie();
      if (f) push(f);
    }
    check();
    const iv = window.setInterval(check, 700);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  function push(t: Flash) {
    const key = `${t.kind}|${t.title}|${t.body ?? ""}`;
    const now = Date.now();
    const last = recentRef.current.get(key);
    if (last && now - last < 1500) return; // repetição imediata → ignora
    recentRef.current.set(key, now);
    const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    setItems((arr) => [...arr, { ...t, id }]);
    window.setTimeout(() => {
      setItems((arr) => arr.filter((x) => x.id !== id));
    }, 4000);
  }

  function dismiss(id: string) {
    setItems((arr) => arr.filter((x) => x.id !== id));
  }

  if (items.length === 0) return null;

  return createPortal(
    <div className="pointer-events-none fixed left-[max(1rem,env(safe-area-inset-left))] right-[max(1rem,env(safe-area-inset-right))] top-[calc(env(safe-area-inset-top,0px)+5rem)] z-[100] flex flex-col items-center gap-2 sm:items-end">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          aria-live="polite"
          className={`pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg ${
            t.kind === "error"
              ? "border-red-200 bg-red-50 text-red-900"
              : t.kind === "info"
                ? "border-ink-900/10 bg-white text-ink-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          <span className="mt-0.5 shrink-0">
            {t.kind === "error" ? (
              <AlertCircle size={16} />
            ) : t.kind === "info" ? (
              <Info size={16} />
            ) : (
              <CheckCircle2 size={16} />
            )}
          </span>
          <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <div className="font-semibold">{t.title}</div>
            {t.body && <div className="mt-0.5 text-xs opacity-80">{t.body}</div>}
          </div>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="grid min-h-8 min-w-8 shrink-0 place-items-center rounded opacity-60 hover:opacity-100"
            aria-label="Fechar"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
