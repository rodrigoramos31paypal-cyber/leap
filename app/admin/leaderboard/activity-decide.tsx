"use client";

// Botões Validar / Rejeitar por atividade (aba Atividades do Ranking).
import { useTransition } from "react";
import { decideActivityAction } from "./actions";
import type { Flash } from "@/lib/flash-types";

function toast(f: Flash) {
  window.dispatchEvent(new CustomEvent<Flash>("leap:toast", { detail: f }));
}

export function ActivityDecide({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();

  function decide(status: "validated" | "rejected") {
    startTransition(async () => {
      const res = await decideActivityAction(id, status);
      if (res?.error) {
        toast({ title: res.error, kind: "error" });
        return;
      }
      toast({
        title: status === "validated" ? "Atividade validada" : "Atividade rejeitada",
        kind: "success",
      });
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={() => decide("rejected")}
        className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-300"
      >
        Rejeitar
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => decide("validated")}
        className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300"
      >
        Validar
      </button>
    </div>
  );
}
