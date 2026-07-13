"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// ════════════════════════════════════════════════════════════════
// Mantém a PWA atualizada SEM o utilizador ter de fechar/reabrir ou
// remover do ecrã principal. Duas vias:
//
//  (1) Service worker: verifica updates periodicamente e sempre que a app
//      volta ao 1º plano. Quando um SW novo assume o controlo
//      (controllerchange), recarrega para apanhar o código novo.
//
//  (2) Kill-switch: o staff pode forçar um reload global em Definições →
//      Segurança. Lemos app_config.force_reload_at; se mudar DURANTE a
//      sessão (via realtime, com poll de fallback), recarregamos.
//
// O reload é "silencioso", mas ADIADO se o utilizador estiver a escrever
// num campo (evita perder dados de um formulário a meio). Quando deixa de
// escrever / a app volta ao 1º plano, o reload pendente é aplicado.
// ════════════════════════════════════════════════════════════════

const SW_UPDATE_MS = 20 * 60 * 1000; // verifica SW a cada 20 min
const POLL_MS = 90 * 1000; // fallback do realtime para o kill-switch

export function AppUpdater() {
  useEffect(() => {
    let reloaded = false;
    let pendingReload = false;

    const isEditing = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable === true
      );
    };

    const doReload = () => {
      if (reloaded) return;
      if (isEditing()) {
        pendingReload = true;
        return;
      }
      reloaded = true;
      try {
        if ("serviceWorker" in navigator) {
          // Best-effort: garante o SW/chunks mais recentes antes do reload.
          navigator.serviceWorker
            .getRegistration()
            .then((r) => (r ? r.update().catch(() => {}) : undefined))
            .finally(() => window.location.reload());
          // Salvaguarda: se o update() ficar pendurado, recarrega na mesma.
          window.setTimeout(() => window.location.reload(), 2000);
        } else {
          window.location.reload();
        }
      } catch {
        window.location.reload();
      }
    };

    const retryPending = () => {
      if (pendingReload && !isEditing()) {
        pendingReload = false;
        doReload();
      }
    };

    // ── (1) Service worker lifecycle ─────────────────────────────────
    let swCleanup = () => {};
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      const onController = () => doReload();
      navigator.serviceWorker.addEventListener("controllerchange", onController);

      const checkUpdate = () => {
        navigator.serviceWorker
          .getRegistration()
          .then((r) => {
            if (r) r.update().catch(() => {});
          })
          .catch(() => {});
      };
      const swInterval = window.setInterval(checkUpdate, SW_UPDATE_MS);
      checkUpdate();

      swCleanup = () => {
        navigator.serviceWorker.removeEventListener("controllerchange", onController);
        window.clearInterval(swInterval);
      };
    }

    // ── (2) Kill-switch (app_config.force_reload_at) ─────────────────
    const supabase = createClient();
    let baseline: string | null = null;

    const apply = (val: string | null) => {
      if (!val) return;
      if (baseline === null) {
        // Primeira leitura desta sessão = referência. Não recarrega (a
        // página já está fresca). Só um bump POSTERIOR dispara reload.
        baseline = val;
        return;
      }
      if (val !== baseline) {
        baseline = val;
        doReload();
      }
    };

    const readConfig = async () => {
      try {
        const { data } = await (supabase as any)
          .from("app_config")
          .select("force_reload_at")
          .maybeSingle();
        apply((data as any)?.force_reload_at ?? null);
      } catch {}
    };
    readConfig();

    const channel = supabase
      .channel("app-config")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "app_config" },
        (payload: any) => apply(payload?.new?.force_reload_at ?? null),
      )
      .subscribe();

    const pollInterval = window.setInterval(() => {
      if (document.visibilityState === "visible") readConfig();
    }, POLL_MS);

    // ── Visibility / focus: re-check tudo + aplica reload pendente ────
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker
          .getRegistration()
          .then((r) => {
            if (r) r.update().catch(() => {});
          })
          .catch(() => {});
      }
      readConfig();
      retryPending();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    document.addEventListener("focusout", retryPending);

    return () => {
      swCleanup();
      try {
        supabase.removeChannel(channel);
      } catch {}
      window.clearInterval(pollInterval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("focusout", retryPending);
    };
  }, []);

  return null;
}
