"use client";

// ════════════════════════════════════════════════════════════════
// ActivityButtons · zona "A tua atividade extra" na Home. Dois botões
// que registam treino autónomo / cardio do próprio dia (fica pendente
// de validação). Feedback imediato via evento leap:toast (Toaster).
// Reutiliza o estilo dos cards/botões existentes.
// ════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Dumbbell, Trophy, ChevronRight, Camera, Plus, CheckCircle2 } from "lucide-react";
import { logActivityAction } from "@/app/app/dashboard/actions";
import type { Flash } from "@/lib/flash-types";

function toast(f: Flash) {
  window.dispatchEvent(new CustomEvent<Flash>("leap:toast", { detail: f }));
}

export function ActivityButtons() {
  const [pending, startTransition] = useTransition();

  const dialog = useRef<HTMLDialogElement>(null);
  const [type, setType] = useState<"autonomous" | "cardio">("autonomous");
  const [minutes, setMinutes] = useState("");
  const [custom, setCustom] = useState(false);
  const [filename, setFilename] = useState("");
  const [preview, setPreview] = useState("");
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const submission = useRef<string | null>(null);
  const [error, setError] = useState("");

  function open(next: typeof type) {
    setType(next);
    setMinutes("");
    setCustom(false);
    setFilename("");
    setPreview("");
    submission.current = null;
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
    if (!submission.current) submission.current = crypto.randomUUID();
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
        payload.set("minutes", minutes);
        payload.set("distance", String(fields.get("distance") ?? ""));
        payload.set("submission", submission.current!);
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
        className="m-auto max-h-[90dvh] overflow-y-auto w-[calc(100%_-_2rem)] max-w-md rounded-2xl bg-white p-4 text-ink-900 backdrop:bg-black/60 dark:bg-ink-800 dark:text-bone-50"
        onCancel={event => { if (pending) event.preventDefault(); }}>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!pending) log(event.currentTarget); }}>
          <div className={type === "cardio" ? "text-center" : ""}>
            {type === "cardio" && <span className="mb-2 block text-2xl" aria-hidden="true">🏃</span>}
            <h2 id="activity-proof-title" tabIndex={-1} autoFocus className="font-display text-lg font-bold outline-none">{type === "cardio" ? "Cardio feito. Bem jogado!" : "Comprovativo de treino"}</h2>
            {type === "cardio" && <p className="mt-1 text-sm text-ink-500">Regista o esforço de hoje.</p>}
          </div>
          {type === "cardio" && <>
            <fieldset disabled={pending}>
              <legend className="mb-2 text-sm font-semibold">Quanto tempo fizeste?</legend>
              <div className="grid grid-cols-5 gap-2">
                {[20, 30, 45, 60].map(value => (
                  <button type="button" key={value} aria-pressed={!custom && minutes === String(value)}
                    onClick={() => { setCustom(false); setMinutes(String(value)); }}
                    className={`min-h-11 rounded-xl border px-1 text-sm font-semibold ${!custom && minutes === String(value) ? "border-gold-500 bg-gold-400 text-ink-900" : "border-ink-900/20 dark:border-white/20"}`}>
                    {value} min
                  </button>
                ))}
                <button type="button" aria-label="Outro tempo" aria-expanded={custom}
                  className="grid min-h-11 place-items-center rounded-xl border border-ink-900/20 dark:border-white/20"
                  onClick={() => { setCustom(true); setMinutes(""); }}>
                  <Plus size={18} aria-hidden="true" />
                </button>
              </div>
              {custom && <label className="mt-3 block text-sm">Minutos
                <input className="input mt-1" type="number" min={1} max={1440} step={1} required
                  value={minutes} onChange={event => setMinutes(event.target.value)} />
              </label>}
            </fieldset>
            <label className="block text-sm">Distância (opcional)
              <div className="relative mt-1">
                <input className="input pr-10" name="distance" inputMode="decimal" placeholder="Ex.: 2,5" disabled={pending} />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-500">km</span>
              </div>
            </label>
          </>}
          <div className="text-sm">
            <p className="mb-2 font-semibold">Comprovativo do treino</p>
            <label className="relative flex cursor-pointer flex-col items-center gap-1 overflow-hidden rounded-xl border border-ink-900/20 p-4 text-center focus-within:ring-2 focus-within:ring-gold-500 dark:border-white/20">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="Pré-visualização do comprovativo" className="h-20 w-20 rounded-lg object-cover" />
              ) : <Camera size={22} aria-hidden="true" />}
              <span className="flex items-center gap-1.5 font-semibold">{filename && <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />}{filename ? "Foto adicionada" : "Adicionar foto"}</span>
              <span className="text-xs text-ink-500">{filename ? "Pronta para enviar · toca para trocar" : "Escolher da galeria ou tirar foto"}</span>
              {filename && <span role="status" className="max-w-full break-all text-xs">{filename}</span>}
              <input className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Comprovativo do treino" name="proof" type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif" required disabled={pending}
                onChange={event => {
                  const file = event.target.files?.[0];
                  setFilename(file?.name ?? "");
                  setPreview(file ? URL.createObjectURL(file) : "");
                }} />
            </label>
          </div>
          <label className="block text-sm">
            Comentário
            <textarea className="input mt-2 w-full" name="comment" rows={2} maxLength={300} placeholder="Como correu?" disabled={pending} />
          </label>
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
          {type === "cardio" && <p className="flex items-center justify-center gap-2 text-xs text-ink-500"><Trophy size={16} className="text-gold-500" aria-hidden="true" /> +1 atividade no ranking após validação</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-outline" disabled={pending} onClick={() => dialog.current?.close()}>Cancelar</button>
            <button className="btn-primary disabled:opacity-50" disabled={pending || (type === "cardio" && !minutes)}>{pending ? "A enviar…" : type === "cardio" ? "Registar o meu cardio" : "Enviar comprovativo"}</button>
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
          <span aria-hidden="true">🏃</span> Fiz cardio hoje
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
