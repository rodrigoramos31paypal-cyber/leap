"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Download, Share, Plus, MoreVertical, CheckCircle2, Apple } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Platform = "loading" | "android" | "ios" | "desktop" | "installed";

function detectPlatform(): Platform {
  if (typeof window === "undefined") return "loading";
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true;
  if (standalone) return "installed";
  const ua = window.navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua) || (/macintosh/.test(ua) && "ontouchend" in document);
  if (isIos) return "ios";
  if (/android/.test(ua)) return "android";
  return "desktop";
}

export function InstallClient() {
  const [platform, setPlatform] = useState<Platform>("loading");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [outcome, setOutcome] = useState<"accepted" | "dismissed" | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      // Se o Chrome considera a app instalável, garantimos a UI de Android.
      setPlatform((p) => (p === "installed" ? p : "android"));
    };
    const onInstalled = () => {
      setOutcome("accepted");
      setPlatform("installed");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setOutcome(choice.outcome);
    setDeferred(null);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-bone-50 p-6 text-ink-900 dark:bg-ink-900 dark:text-bone-50">
      <div className="w-full max-w-sm text-center">
        <Image
          src="/images/logo.png"
          alt="LEAP Fitness Studio"
          width={64}
          height={64}
          priority
          className="mx-auto mb-5 h-16 w-16 dark:invert"
        />
        <h1 className="font-display text-2xl font-bold tracking-tight">Instalar a app LEAP</h1>
        <p className="mt-2 text-sm text-ink-500 dark:text-bone-50/60">
          Adiciona a LEAP ao teu ecrã principal e abre-a como uma app — sem browser, sem
          loja de apps.
        </p>

        <div className="mt-6 rounded-2xl border border-ink-900/10 bg-white p-5 text-left shadow-soft dark:border-bone-50/10 dark:bg-ink-900/40">
          {platform === "loading" && (
            <p className="text-center text-sm text-ink-500">A preparar…</p>
          )}

          {platform === "installed" && (
            <div className="text-center">
              <CheckCircle2 className="mx-auto mb-3 text-gold-400" size={36} />
              <div className="text-base font-semibold">
                {outcome === "accepted" ? "App instalada!" : "Já tens a app instalada"}
              </div>
              <p className="mt-1 text-sm text-ink-500 dark:text-bone-50/60">
                Procura o ícone da LEAP no teu ecrã principal.
              </p>
              <a
                href="/app/dashboard"
                className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-gold-400 px-4 py-2.5 text-sm font-bold text-ink-900 hover:bg-gold-300"
              >
                Abrir a app
              </a>
            </div>
          )}

          {platform === "android" && (
            <div className="text-center">
              <button
                onClick={handleInstall}
                disabled={!deferred}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-gold-400 px-4 py-3 text-base font-bold text-ink-900 hover:bg-gold-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download size={18} /> Instalar app
              </button>
              {deferred ? (
                <p className="mt-3 text-xs text-ink-500 dark:text-bone-50/60">
                  Toca em <strong>Instalar</strong> e confirma no aviso do telemóvel.
                </p>
              ) : (
                <div className="mt-4 text-left text-sm text-ink-500 dark:text-bone-50/60">
                  <p className="mb-2">
                    Se o botão não ativar, instala pelo menu do Chrome:
                  </p>
                  <ol className="space-y-2">
                    <li className="flex items-start gap-2">
                      <MoreVertical size={16} className="mt-0.5 shrink-0" />
                      <span>Toca no menu <strong>⋮</strong> (canto superior direito).</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Plus size={16} className="mt-0.5 shrink-0" />
                      <span>Escolhe <strong>“Instalar aplicação”</strong> ou <strong>“Adicionar ao ecrã principal”</strong>.</span>
                    </li>
                  </ol>
                </div>
              )}
            </div>
          )}

          {platform === "ios" && (
            <div>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Apple size={18} /> iPhone / iPad — usa o Safari
              </div>
              <ol className="space-y-3 text-sm text-ink-500 dark:text-bone-50/60">
                <li className="flex items-start gap-2">
                  <Share size={16} className="mt-0.5 shrink-0 text-ink-900 dark:text-bone-50" />
                  <span>Toca no botão <strong>Partilhar</strong> (o quadrado com a seta para cima, em baixo).</span>
                </li>
                <li className="flex items-start gap-2">
                  <Plus size={16} className="mt-0.5 shrink-0 text-ink-900 dark:text-bone-50" />
                  <span>Desliza e escolhe <strong>“Adicionar ao ecrã principal”</strong>.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ink-900 dark:text-bone-50" />
                  <span>Toca em <strong>“Adicionar”</strong>. O ícone da LEAP aparece no teu ecrã.</span>
                </li>
              </ol>
              <p className="mt-4 rounded-lg bg-bone-50 px-3 py-2 text-xs text-ink-500 dark:bg-ink-900/60 dark:text-bone-50/60">
                No iPhone tem mesmo de ser pelo <strong>Safari</strong> — o Chrome não mostra esta opção.
              </p>
            </div>
          )}

          {platform === "desktop" && (
            <div className="text-center text-sm text-ink-500 dark:text-bone-50/60">
              <p>
                Para instalares no telemóvel, abre esta página no teu telefone (lê o código
                QR) e segue os passos.
              </p>
              <p className="mt-3">
                No computador (Chrome/Edge), também podes instalar pelo ícone de instalação
                na barra de endereço.
              </p>
              <a
                href="/app/dashboard"
                className="mt-4 inline-flex items-center justify-center rounded-md bg-gold-400 px-4 py-2 text-sm font-bold text-ink-900 hover:bg-gold-300"
              >
                Abrir o portal
              </a>
            </div>
          )}
        </div>

        <p className="mt-5 text-xs text-ink-500 dark:text-bone-50/50">
          Problemas a instalar? Fala connosco — ajudamos-te em menos de um minuto. 💪
        </p>
      </div>
    </main>
  );
}
