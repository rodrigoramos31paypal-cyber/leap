// ════════════════════════════════════════════════════════════════
// Rótulos legíveis para o Registo de atividade (audit log).
//
// Traduz cada `action` guardada em audit_log para uma frase curta em
// PT-PT, e agrupa as ações para o dropdown de filtro. Manter em sync com
// o allowlist da RPC log_audit_event (migration 0133) e com lib/audit.ts.
// ════════════════════════════════════════════════════════════════

export type AuditActionMeta = {
  /** Frase curta mostrada na coluna "Ação". */
  label: string;
  /** Quem tipicamente despoleta a ação (para o texto "por"). */
  actor: "admin" | "cliente" | "sistema";
};

export const AUDIT_ACTIONS: Record<string, AuditActionMeta> = {
  // ── Ações de admin ────────────────────────────────────────────
  client_create_admin: { label: "Conta criada (admin)", actor: "admin" },
  account_approve: { label: "Conta aprovada", actor: "admin" },
  account_reject: { label: "Conta rejeitada", actor: "admin" },
  client_delete_admin: { label: "Conta de cliente apagada", actor: "admin" },
  client_ban: { label: "Cliente bloqueado", actor: "admin" },
  client_unban: { label: "Cliente desbloqueado", actor: "admin" },
  booking_create_admin: { label: "Sessão criada (admin)", actor: "admin" },
  booking_cancel_admin: { label: "Sessão cancelada (admin)", actor: "admin" },
  booking_reschedule_admin: { label: "Sessão movida (admin)", actor: "admin" },
  pack_grant: { label: "Pack/sessões atribuídas", actor: "admin" },
  credits_adjust: { label: "Sessões ajustadas", actor: "admin" },
  purchase_confirm: { label: "Pagamento confirmado", actor: "admin" },
  purchase_reject: { label: "Pagamento rejeitado", actor: "admin" },
  purchase_cancel_confirmed: { label: "Compra confirmada cancelada", actor: "admin" },
  purchase_delete: { label: "Compra apagada", actor: "admin" },
  duo_link: { label: "Contas ligadas (duo)", actor: "admin" },
  duo_unlink: { label: "Contas desligadas (duo)", actor: "admin" },
  export_pii: { label: "Dados exportados (admin)", actor: "admin" },

  // ── Ações do próprio cliente ──────────────────────────────────
  account_create_self: { label: "Conta criada (pelo cliente)", actor: "cliente" },
  booking_create_client: { label: "Sessão marcada", actor: "cliente" },
  booking_reschedule_client: { label: "Sessão movida", actor: "cliente" },
  booking_cancel_client: { label: "Sessão cancelada", actor: "cliente" },
  purchase_create_client: { label: "Compra iniciada", actor: "cliente" },
  profile_update_self: { label: "Perfil alterado (nome/telefone)", actor: "cliente" },
  password_change_self: { label: "Palavra-passe alterada", actor: "cliente" },
  account_delete_self: { label: "Conta apagada (pelo cliente)", actor: "cliente" },
  export_pii_self: { label: "Dados exportados (cliente)", actor: "cliente" },
};

/** Ordem de apresentação no dropdown de filtro (lista plana). */
export const AUDIT_FILTER_OPTIONS: { value: string; label: string }[] = Object.entries(
  AUDIT_ACTIONS,
).map(([value, meta]) => ({ value, label: meta.label }));

/**
 * Opções agrupadas para o dropdown de filtro (Admin vs Cliente). Encurta
 * visualmente a lista e ajuda a escolher — cada ação aparece sob o grupo
 * de quem tipicamente a faz.
 */
export const AUDIT_FILTER_GROUPS: {
  group: string;
  options: { value: string; label: string }[];
}[] = [
  {
    group: "Admin",
    options: Object.entries(AUDIT_ACTIONS)
      .filter(([, m]) => m.actor === "admin")
      .map(([value, m]) => ({ value, label: m.label })),
  },
  {
    group: "Cliente",
    options: Object.entries(AUDIT_ACTIONS)
      .filter(([, m]) => m.actor === "cliente")
      .map(([value, m]) => ({ value, label: m.label })),
  },
];

/** Rótulo legível para uma ação; cai para a própria string se desconhecida. */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTIONS[action]?.label ?? action;
}
