"use client";

import { useState, useTransition } from "react";
import { Pencil, Save, X, Trash2 } from "lucide-react";
import { updateNoteByIdAction, deleteNoteByIdAction } from "@/app/api/notes/actions";

export function GeneralNoteEditor({
  noteId,
  initialBody,
}: {
  noteId: string;
  initialBody: string;
}) {
  const [body, setBody] = useState(initialBody);
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("noteId", noteId);
      fd.set("body", body);
      const res = await updateNoteByIdAction(fd);
      if (res && "error" in res && res.error) setError(res.error);
      else setEditing(false);
    });
  }

  function remove() {
    if (!confirm("Apagar esta nota? Não dá para recuperar.")) return;
    start(async () => {
      const fd = new FormData();
      fd.set("noteId", noteId);
      await deleteNoteByIdAction(fd);
    });
  }

  if (!editing) {
    return (
      <div className="space-y-2">
        <p className="whitespace-pre-wrap text-sm text-ink-700">{initialBody}</p>
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
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        rows={4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
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
            setBody(initialBody);
            setEditing(false);
            setError(null);
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-ink-900/10 px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-900/5"
        >
          <X size={12} /> Cancelar
        </button>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    </div>
  );
}
