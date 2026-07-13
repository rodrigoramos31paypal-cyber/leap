"use client";

// ════════════════════════════════════════════════════════════════
// Avatar uploader · usado no card "Perfil público" das Definições.
// Mostra a foto actual + input de ficheiro + botões guardar/remover.
// Validação client-side leve (mime + size) para feedback imediato; o
// servidor revalida em saveTrainerAvatarAction.
// ════════════════════════════════════════════════════════════════
import { useRef, useState } from "react";
import { Camera, Trash2, Upload } from "lucide-react";
import {
  saveTrainerAvatarAction,
  removeTrainerAvatarAction,
} from "@/app/admin/definicoes/actions";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export function AvatarUploader({
  trainerId,
  currentUrl,
  fullName,
}: {
  trainerId: string;
  currentUrl: string | null;
  fullName: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const displayUrl = preview ?? currentUrl;
  const initial = (fullName.trim()[0] ?? "T").toUpperCase();

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const f = e.target.files?.[0];
    if (!f) {
      setPreview(null);
      return;
    }
    if (!ALLOWED.includes(f.type)) {
      setError("Formato não suportado (JPG, PNG ou WEBP)");
      e.target.value = "";
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("Imagem demasiado grande (máx. 2 MB)");
      e.target.value = "";
      return;
    }
    const url = URL.createObjectURL(f);
    setPreview(url);
  }

  return (
    <div className="space-y-3 border-t border-ink-900/10 pt-4 dark:border-white/10">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-700 dark:text-bone-100">
          Foto de perfil
        </h3>
        <p className="mt-0.5 text-xs text-ink-500">
          Aparece na tua página pública e onde os clientes escolhem trainer. JPG, PNG ou WEBP até 2 MB.
        </p>
      </div>

      <div className="flex items-start gap-4">
        {/* Avatar preview */}
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border border-ink-900/10 bg-bone-100 dark:border-white/10 dark:bg-white/[0.06]">
          {displayUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayUrl}
              alt={fullName}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center font-display text-2xl font-bold text-ink-500">
              {initial}
            </div>
          )}
        </div>

        <form
          ref={formRef}
          action={async (fd) => {
            setSubmitting(true);
            try {
              await saveTrainerAvatarAction(fd);
              setPreview(null);
              if (inputRef.current) inputRef.current.value = "";
            } finally {
              setSubmitting(false);
            }
          }}
          className="flex-1 space-y-2"
        >
          <input type="hidden" name="trainerId" value={trainerId} />
          <input
            ref={inputRef}
            type="file"
            name="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onFileChange}
            className="block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-ink-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-bone-50 hover:file:bg-ink-700 dark:file:bg-bone-50 dark:file:text-ink-900"
          />
          {error ? (
            <p className="text-xs text-red-600">{error}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={submitting || !preview}
              className="inline-flex items-center gap-1.5 rounded-md bg-ink-900 px-3 py-1.5 text-xs font-medium text-bone-50 disabled:opacity-40 dark:bg-bone-50 dark:text-ink-900"
            >
              <Upload size={12} />
              {submitting ? "A enviar..." : "Guardar foto"}
            </button>
            {currentUrl ? (
              <button
                type="button"
                onClick={async () => {
                  const fd = new FormData();
                  fd.set("trainerId", trainerId);
                  setSubmitting(true);
                  try {
                    await removeTrainerAvatarAction(fd);
                  } finally {
                    setSubmitting(false);
                  }
                }}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-md border border-ink-900/15 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-900/5 disabled:opacity-40 dark:border-white/15 dark:bg-ink-800 dark:text-bone-50"
              >
                <Trash2 size={12} /> Remover
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
