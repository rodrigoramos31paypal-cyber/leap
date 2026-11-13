"use client";

// ════════════════════════════════════════════════════════════════
// ActivityButtons · zona "A tua atividade extra" na Home. Dois botões
// que registam treino autónomo / cardio do próprio dia (fica pendente
// de validação). Feedback imediato via evento leap:toast (Toaster).
// Reutiliza o estilo dos cards/botões existentes.
// ════════════════════════════════════════════════════════════════
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Dumbbell, Heart, Trophy, ChevronRight } from "lucide-react";
import { logActivityAction } from "@/app/app/dashboard/actions";
import type { Flash } from "@/lib/flash-types";

function toast(f: Flash) {
  window.dispatchEvent(new CustomEvent<Flash>("leap:toast", { detail: f }));
}

export function ActivityButtons() {
  const [pending, startTransition] = useTransition();

  const dialog = useRef<HTMLDialogElement>(null);
  const [type, setType] = useState<"autonomous" | "cardio">("autonomous");
  const [error, setError] = useState("");

  function open(next: typeof type) {
    setType(next);
    setError("");
    dialog.current?.querySelector("form")?.reset();
    dialog.current?.showModal();
  }

  function log(form: HTMLFormElement) {
    setError("");
    const fields = new FormData(form);
    const file = fields.get("proof");
    const comment = String(fields.get("comment") ?? "").trim();
    if (!(file instanceof File) || !file.size || file.size > 20_000_000) {
      setError("Escolhe uma foto até 20 MB.");
      return;
    }
    startTransition(async () => {
      try {
        const image = await createImageBitmap(file);
        const canvas = document.createElement("canvas");
        try {
          const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error();
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        } finally {
          image.close();
        }
        const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.78));
        if (!jpeg || jpeg.size > 512_000) {
          setError("A foto é demasiado grande. Experimenta outra imagem.");
          return;
        }
        const payload = new FormData();
        payload.set("proof", jpeg, "comprovativo.jpg");
        payload.set("comment", comment);
        const res = await logActivityAction(type, payload);
        if (res?.error) {
          setError(res.error);
          return;
        }
        dialog.current?.close();
        toast({
          title: type === "cardio" ? "Cardio registado" : "Treino registado",
          body: "Comprovativo enviado · pendente de validação.",
          kind: "success",
        });
      } catch {
        setError("Não foi possível enviar a foto. Tenta novamente.");
      }
    });
  }

  return (
    <div className="rounded-[18px] border border-ink-900/10 bg-white p-4 dark:border-white/10 dark:bg-ink-800">
      <dialog ref={dialog} aria-labelledby="activity-proof-title"
        className="m-auto max-h-[90dvh] overflow-y-auto w-[calc(100%_-_2rem)] max-w-sm rounded-2xl bg-white p-4 text-ink-900 backdrop:bg-black/60 dark:bg-ink-800 dark:text-bone-50"
        onCancel={event => { if (pending) event.preventDefault(); }}>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!pending) log(event.currentTarget); }}>
          <h2 id="activity-proof-title" tabIndex={-1} autoFocus className="font-bold outline-none">{type === "cardio" ? "Comprovativo de cardio" : "Comprovativo de treino"}</h2>
          <label className="block text-sm">
            Foto do teu treino
            <input className="mt-2 block w-full text-sm" name="proof" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" required disabled={pending} />
          </label>
          <label className="block text-sm">
            Comentário (opcional)
            <textarea className="input mt-2 w-full" name="comment" rows={2} maxLength={300} disabled={pending} />
          </label>
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-outline" disabled={pending} onClick={() => dialog.current?.close()}>Cancelar</button>
            <button className="btn-primary disabled:opacity-50" disabled={pending}>{pending ? "A enviar…" : "Enviar comprovativo"}</button>
          </div>
        </form>
      </dialog>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
        A tua atividade extra
      </span>
      <div className="mt-2 flex gap-2.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => open("autonomous")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-ink-900/10 bg-bone-50 px-3 py-3 text-sm font-medium text-ink-900 transition hover:bg-ink-900/5 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-bone-50 dark:hover:bg-white/10"
        >
          <Dumbbell size={16} /> Treinei hoje
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => open("cardio")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-ink-900/10 bg-bone-50 px-3 py-3 text-sm font-medium text-ink-900 transition hover:bg-ink-900/5 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-bone-50 dark:hover:bg-white/10"
        >
          <Heart size={16} /> Fiz cardio hoje
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-ink-900/5 pt-2 dark:border-white/10">
        <p className="text-[11px] text-ink-500">Conta para o ranking após validação.</p>
        <Link href="/app/leaderboard" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-gold-700 hover:underline dark:text-gold-300">
          <Trophy size={16} aria-hidden="true" /> Ver Ranking LEAP <ChevronRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
