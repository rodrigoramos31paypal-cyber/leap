"use client";

// Botões Validar / Rejeitar por atividade (aba Atividades do Ranking).
import { useRef, useState, useTransition } from "react";
import { decideActivityAction, loadActivityProofAction } from "./actions";
import { useIsViewer } from "@/components/viewer-mode";
import type { Flash } from "@/lib/flash-types";

function toast(f: Flash) {
  window.dispatchEvent(new CustomEvent<Flash>("leap:toast", { detail: f }));
}

export function ActivityDecide({ id, name, activity }: { id: string; name: string; activity: string }) {
  const [pending, startTransition] = useTransition();
  const isViewer = useIsViewer();
  const dialog = useRef<HTMLDialogElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [comment, setComment] = useState<string | null>(null);
  const [error, setError] = useState("");

  function review() {
    setPhoto(null);
    setComment(null);
    setError("");
    dialog.current?.showModal();
    startTransition(async () => {
      try {
        const result = await loadActivityProofAction(id);
        setPhoto(result.photo ?? null);
        setComment(result.comment ?? null);
        setError(result.error ?? "");
      } catch {
        setError("Não foi possível carregar o comprovativo.");
      }
    });
  }

  // viewer (só-consulta) não vê os botões Validar/Rejeitar.
  if (isViewer) return null;

  function decide(status: "validated" | "rejected") {
    startTransition(async () => {
      const res = await decideActivityAction(id, status);
      if (res?.error) {
        toast({ title: res.error, kind: "error" });
        return;
      }
      setPhoto(null);
      dialog.current?.close();
      toast({
        title: status === "validated" ? "Atividade validada" : "Atividade rejeitada",
        kind: "success",
      });
    });
  }

  return (
    <>
      <button type="button" className="btn-outline shrink-0 text-xs" onClick={review}>Rever</button>
      <dialog ref={dialog} aria-label="Comprovativo da atividade"
        className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl bg-white p-4 text-ink-900 backdrop:bg-black/60 dark:bg-ink-800 dark:text-bone-50"
        onClose={() => { setPhoto(null); setComment(null); }} onCancel={event => { if (pending) event.preventDefault(); }}>
      <h3 className="font-bold">{name}</h3><p className="mb-3 text-sm text-ink-500">{activity}</p>
      {pending && !photo ? <p className="text-sm">A carregar…</p> : error ? <p role="alert" className="text-sm">{error}</p> : photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="Comprovativo enviado pelo cliente" className="mb-4 max-h-[62dvh] w-full rounded-lg object-contain" />
      ) : <p className="mb-4 text-sm">Esta atividade não tem foto anexada.</p>}
      {comment && <div className="mb-4 text-sm">
        <p className="font-semibold">Comentário do cliente</p>
        <p className="mt-1 whitespace-pre-wrap break-words">{comment}</p>
      </div>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
      <button type="button" disabled={pending} className="btn-outline text-xs" onClick={() => dialog.current?.close()}>Fechar</button>
      <button
        type="button"
        disabled={pending || !!error}
        onClick={() => decide("rejected")}
        className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-300"
      >
        Rejeitar
      </button>
      <button
        type="button"
        disabled={pending || !!error}
        onClick={() => decide("validated")}
        className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300"
      >
        Validar
      </button>
      </div>
      </dialog>
    </>
  );
}
