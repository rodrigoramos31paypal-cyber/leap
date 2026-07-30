"use client";

// Botão pequeno para copiar texto (ex.: URL do feed iCal) para o
// clipboard. Render-time é zero — só ativa quando o user clica.
import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyButton({
  value,
  label = "Copiar",
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback: selecionar e copiar via execCommand
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md border border-ink-900/15 bg-white px-2.5 py-1.5 text-xs font-medium text-ink-800 hover:bg-ink-900/5 dark:border-white/15 dark:bg-ink-800 dark:text-bone-50 ${className}`}
    >
      {copied ? (
        <>
          <Check size={12} /> Copiado
        </>
      ) : (
        <>
          <Copy size={12} /> {label}
        </>
      )}
    </button>
  );
}
