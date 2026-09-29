"use client";

// ════════════════════════════════════════════════════════════════
// ActivityButtons · zona "A tua atividade extra" na Home. Dois botões
// que registam treino autónomo / cardio do próprio dia (fica pendente
// de validação). Feedback imediato via evento leap:toast (Toaster).
// Reutiliza o estilo dos cards/botões existentes.
// ════════════════════════════════════════════════════════════════
import { useTransition } from "react";
import { Dumbbell, Heart } from "lucide-react";
import { logActivityAction } from "@/app/app/dashboard/actions";
import type { Flash } from "@/lib/flash-types";

function toast(f: Flash) {
  window.dispatchEvent(new CustomEvent<Flash>("leap:toast", { detail: f }));
}

export function ActivityButtons() {
  const [pending, startTransition] = useTransition();

  function log(type: "autonomous" | "cardio") {
    startTransition(async () => {
      const res = await logActivityAction(type);
      if (res?.error) {
        toast({ title: res.error, kind: "error" });
        return;
      }
      toast({
        title: type === "cardio" ? "Cardio registado" : "Treino registado",
        body: "Pendente de validação · envia o comprovativo por WhatsApp.",
        kind: "success",
      });
    });
  }

  return (
    <div className="rounded-[18px] border border-ink-900/10 bg-white p-4 dark:border-white/10 dark:bg-ink-800">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
        A tua atividade extra
      </span>
      <div className="mt-2 flex gap-2.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => log("autonomous")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-ink-900/10 bg-bone-50 px-3 py-3 text-sm font-medium text-ink-900 transition hover:bg-ink-900/5 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-bone-50 dark:hover:bg-white/10"
        >
          <Dumbbell size={16} /> Treinei hoje
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => log("cardio")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-ink-900/10 bg-bone-50 px-3 py-3 text-sm font-medium text-ink-900 transition hover:bg-ink-900/5 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-bone-50 dark:hover:bg-white/10"
        >
          <Heart size={16} /> Fiz cardio hoje
        </button>
      </div>
      <p className="mt-2 text-[11px] text-ink-500">
        Conta para o Ranking LEAP após validação.
      </p>
    </div>
  );
}
