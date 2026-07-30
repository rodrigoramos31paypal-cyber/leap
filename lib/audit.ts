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
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { getRequestIp } from "@/lib/rate-limit";

type AuditOpts = {
  targetTable?: string;
  targetId?: string;
  payload?: Record<string, unknown>;
};

/**
 * IP do request atual, resolvido com o mesmo modelo de confiança do
 * rate-limit (getRequestIp: resistente a spoofing atrás do proxy). Nunca
 * rebenta — se não houver contexto de headers, devolve undefined e a
 * auditoria segue sem IP (best-effort). Ver 0133 para a coluna.
 */
async function currentRequestIp(): Promise<string | undefined> {
  try {
    const h = await headers();
    const ip = getRequestIp(h);
    return ip && ip !== "no-trusted-ip" ? ip : undefined;
  } catch {
    return undefined;
  }
}

/** Regista uma acção sensível (de admin OU do próprio cliente) em audit_log. */
export async function logAudit(action: string, opts: AuditOpts = {}): Promise<void> {
  try {
    const [supabase, ip] = await Promise.all([createClient(), currentRequestIp()]);
    const { error } = await (supabase as any).rpc("log_audit_event", {
      p_action: action,
      p_target_table: opts.targetTable ?? undefined,
      p_target_id: opts.targetId ?? undefined,
      p_payload: (opts.payload ?? undefined) as any,
      p_ip: ip ?? undefined,
    });
    if (error) logError(`logAudit:${action}`, error);
  } catch (e) {
    logError(`logAudit:${action}`, e);
  }
}
