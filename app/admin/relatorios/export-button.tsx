"use client";

// ════════════════════════════════════════════════════════════════
// ExportButton · descarrega o relatório CSV SEM sair da app.
//
// Antes era um <Link href="/api/relatorios/export?…">. Dois problemas:
//   1. O <Link> do Next faz PREFETCH do href (hover/scroll) → o endpoint
//      de export era chamado sozinho várias vezes, gastava o bucket de
//      rate-limit ("Demasiados pedidos" logo no 1.º clique real) e ainda
//      escrevia entradas-fantasma no audit "export_pii".
//   2. Num PWA (iOS standalone) navegar para um URL com Content-Disposition
//      attachment substituía a vista da app por um ecrã branco do sistema
//      e não dava para voltar sem forçar o fecho.
//
// Solução: vai buscar o CSV via fetch, transforma em blob e dispara o
// download com um <a download> temporário. A app NUNCA navega para fora,
// por isso o utilizador continua exactamente onde estava.
// ════════════════════════════════════════════════════════════════
import { useState } from "react";
import { Download } from "lucide-react";

export function ExportButton({
  href,
  filename,
  children,
}: {
  href: string;
  filename: string;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(href, { headers: { Accept: "text/csv" } });
      if (!res.ok) {
        // Mostra a mensagem do servidor (ex.: limite, intervalo inválido).
        const msg = (await res.text())?.trim();
        setError(msg || "Não foi possível exportar. Tenta novamente.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoga após um instante — alguns browsers precisam do URL vivo
      // até o download arrancar.
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      setError("Falha de rede ao exportar. Verifica a ligação e tenta de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-50"
      >
        <Download size={16} />
        {busy ? "A preparar…" : children}
      </button>
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
