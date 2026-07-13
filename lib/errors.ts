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

/**
 * Mensagem SEGURA para o utilizador a partir de um erro de RPC Postgres.
 *
 * Só devolve texto quando o erro é uma EXCEÇÃO DE NEGÓCIO escrita por nós
 * — `raise exception '...'` sem errcode → SQLSTATE 'P0001'. Essas mensagens
 * são em português, pensadas para o utilizador, e não contêm nomes de
 * colunas/constraints nem valores sensíveis (ex.: "Duração 45 min não
 * permitida.", "A primeira marcação tem de ser no futuro.").
 *
 * Para tudo o resto — violações de constraint, RLS, erros de driver, etc.
 * — devolve `null`, e o call site usa a sua mensagem genérica. Assim o
 * detalhe cru do schema NUNCA chega ao browser (ver nota no topo).
 */
export function userFacingRpcError(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message.trim() : "";
  if (!message) return null;
  // Exceção de negócio nossa (raise exception sem errcode).
  if (code === "P0001") return message;
  // Permissão negada — mensagem neutra, nunca a crua.
  if (code === "42501") return "Não tens permissão para fazer esta marcação.";
  return null;
}

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
