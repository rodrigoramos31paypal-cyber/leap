// ════════════════════════════════════════════════════════════════
// Audit log · #6 do hardening estrutural
//
// Wrapper TS sobre a RPC SECURITY DEFINER `log_audit_event` (migration
// 0032). A RPC força `actor_id = auth.uid()` (não falsificável) e só
// aceita callers autenticados — por isso é usada a partir de server
// actions de admin, onde o utilizador autenticado é o próprio admin.
//
// Best-effort por omissão: uma falha de auditoria NÃO reverte a acção
// já concluída nem rebenta o fluxo do admin — apenas regista o erro
// server-side para alerting. (A exportação de PII em /api/relatorios/
// export usa fail-closed à parte, por ser requisito RGPD: lá, se a
// auditoria falhar, NÃO devolvemos os dados.)
// ════════════════════════════════════════════════════════════════
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";

type AuditOpts = {
  targetTable?: string;
  targetId?: string;
  payload?: Record<string, unknown>;
};

/** Regista uma acção administrativa sensível em audit_log. */
export async function logAudit(action: string, opts: AuditOpts = {}): Promise<void> {
  try {
    const supabase = createClient();
    const { error } = await supabase.rpc("log_audit_event", {
      p_action: action,
      p_target_table: opts.targetTable ?? undefined,
      p_target_id: opts.targetId ?? undefined,
      p_payload: (opts.payload ?? undefined) as any,
    });
    if (error) logError(`logAudit:${action}`, error);
  } catch (e) {
    logError(`logAudit:${action}`, e);
  }
}
