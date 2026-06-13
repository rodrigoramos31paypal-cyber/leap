// ════════════════════════════════════════════════════════════════
// Error helpers · H6
//
// Regra: o detalhe cru de um erro (mensagem do Postgres/Supabase)
// inclui nomes de colunas, constraints e valores. Isso NUNCA pode
// chegar ao browser — nem em `return { error }` de server actions,
// nem no `body` do setFlash (que vai num cookie legível por JS).
//
// `logError` regista o detalhe real do lado do servidor (logs do
// Vercel/host) para debug; ao utilizador devolvemos sempre uma
// mensagem genérica escrita à mão no call site.
// ════════════════════════════════════════════════════════════════

/** Loga o erro real server-side. Nunca devolve o detalhe ao caller. */
export function logError(context: string, err: unknown): void {
  let detail: string;
  if (err instanceof Error) {
    detail = err.message;
  } else if (typeof err === "string") {
    detail = err;
  } else {
    try {
      detail = JSON.stringify(err);
    } catch {
      detail = String(err);
    }
  }
  console.error(`[${context}]`, detail);
}
