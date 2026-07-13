"use client";

import { Copy } from "lucide-react";

export function CopyButton({ text }: { text: string }) {
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(text)}
      className="rounded-md p-1.5 text-ink-500 hover:bg-ink-900/5"
      aria-label="Copiar"
    >
      <Copy size={14} />
    </button>
  );
}
