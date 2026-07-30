"use client";

import { useState, useTransition } from "react";
import { Pencil, Save, X, Plus, Trash2 } from "lucide-react";
import { upsertNoteAction } from "@/app/api/notes/actions";

export function NoteEditor({
  bookingId,
  initialBody,
  placeholder = "Escreve aqui a tua nota desta sessão…",
  compact = false,
  sharedWithTrainer = false,
}: {
  bookingId: string;
  initialBody?: string;
  placeholder?: string;
  compact?: boolean;
  sharedWithTrainer?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(initialBody ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const hasNote = !!initialBody?.trim();

  function save() {
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("bookingId", bookingId);
      fd.set("body", body);
      const res = await upsertNoteAction(fd);
      if (res?.error) setError(res.error);
      else setEditing(false);
    });
  }

  function remove() {
    if (!confirm("Apagar esta nota? Não dá para recuperar.")) return;
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("bookingId", bookingId);
      fd.set("body", "");
      await upsertNoteAction(fd);
      setBody("");
      setEditing(false);
    });
  }

  if (!editing) {
    return (
      <div className={compact ? "text-xs" : "text-sm"}>
        {hasNote ? (
          <div className="space-y-2">
            <p className="whitespace-pre-wrap text-ink-700">{initialBody}</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 text-xs font-medium text-gold-600 hover:text-gold-700"
              >
                <Pencil size={12} /> Editar
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                className="inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:text-red-900 disabled:opacity-50"
              >
                <Trash2 size={12} /> {pending ? "…" : "Apagar"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-gold-600 hover:text-gold-700"
          >
            <Plus size={12} /> Adicionar nota
          </button>
        )}
      </div>
    );
  }

  // modo edição

  return (
    <div className="space-y-2">
      <textarea
        rows={compact ? 3 : 4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        maxLength={5000}
        className="input"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink-900 px-3 py-1.5 text-xs font-semibold text-bone-50 hover:bg-ink-700 disabled:opacity-50"
        >
          <Save size={12} /> {pending ? "A guardar…" : "Guardar"}
        </button>
        <button
          type="button"
          onClick={() => {
            setBody(initialBody ?? "");
            setEditing(false);
            setError(null);
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-ink-900/10 px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-900/5"
        >
          <X size={12} /> Cancelar
        </button>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
      <p className="text-[10px] text-ink-500">{sharedWithTrainer ? "O teu trainer também vê esta nota." : "Só tu vês esta nota."}</p>
    </div>
  );
}
