"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "leap-install-dismissed-at";
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 dias

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // nao mostra se ja instalado
    if (typeof window === "undefined") return;
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    if (standalone) return;

    // Na pagina dedicada /instalar ja existe um CTA de instalacao proprio —
    // nao duplicamos o banner flutuante por cima dele.
    if (window.location.pathname.startsWith("/instalar")) return;

    // PERF (QW-15 audit jun/2026): o read de localStorage e diferido
    // para dentro do handler. Antes corria sincrono em mount em todos
    // os utilizadores; agora montamos o listener leve e so lemos o
    // dismiss quando o browser dispara beforeinstallprompt (raro).
    const handler = (e: Event) => {
      const last = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
      if (last && Date.now() - last < DISMISS_TTL_MS) return;
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!show || !deferred) return null;

  return (
    <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 px-3 md:bottom-6">
      <div className="flex max-w-sm items-center gap-3 rounded-2xl border border-ink-900/10 bg-white px-4 py-3 shadow-soft">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-ink-900 text-gold-400 font-black">
          L
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold">Instalar app</div>
          <div className="text-xs text-ink-500">Acesso rápido, sem browser.</div>
        </div>
        <button
          onClick={async () => {
            await deferred.prompt();
            const choice = await deferred.userChoice;
            if (choice.outcome === "dismissed") {
              localStorage.setItem(DISMISS_KEY, String(Date.now()));
            }
            setShow(false);
            setDeferred(null);
          }}
          className="inline-flex items-center gap-1.5 rounded-md bg-gold-400 px-3 py-1.5 text-xs font-bold text-ink-900 hover:bg-gold-300"
        >
          <Download size={14} /> Instalar
        </button>
        <button
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, String(Date.now()));
            setShow(false);
          }}
          className="rounded-md p-1.5 text-ink-500 hover:bg-ink-900/5"
          aria-label="Dispensar"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
