"use server";

// ════════════════════════════════════════════════════════════════
// Procura de clientes para typeahead/autocomplete.
// Devolve até 5 hits ordenados por nome para o dropdown mostrar.
// Server action — chamada por client components (ClientSearch e
// BookingDialog).
//
// SEC (C-A audit jun/2026): endurecimento contra enumeração de PII
// cross-trainer.
//
// Bugs corrigidos:
//   1) Não havia guard de aplicação — qualquer chamada autenticada
//      passava. RLS `profiles: self select` (0003) é `id = auth.uid()
//      OR is_admin()`. Para clientes a query devolvia nada (no máximo
//      o próprio perfil); para staff devolvia QUALQUER cliente do
//      estúdio porque a policy não tem scope check por trainer.
//   2) Sem filtro por scope. `is_admin()` = trainer OU owner. Trainer
//      A descobria nome/email/telefone de TODOS os clientes do
//      estúdio (incluindo de trainer B) com 26 queries — uma por
//      letra do alfabeto. Leak de PII cross-trainer.
//
// Fix:
//   • requireStaff() à cabeça (também documenta a intenção).
//   • Filtra pelo conjunto de clientes acessíveis ao caller via
//     getClientIdsInScope (purchases ∪ bookings ∪ profiles.trainer_id
//     dentro dos trainers do caller — mesma união usada pelas
//     listagens de clientes admin).
//   • Owner num estúdio multi-trainer continua a ver tudo (scope
//     inclui todos os trainers).
//   • Single-owner studio: scope = único trainer → comportamento
//     idêntico para o owner (vê todos os seus clientes).
// ════════════════════════════════════════════════════════════════
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/authz";
import { getAccessibleTrainerIds, getClientIdsInScope } from "@/lib/trainer";

export type ClientHit = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

export async function searchClientsAction(q: string): Promise<ClientHit[]> {
  // C-A: gate de aplicação. Throw se non-staff — o caller (ClientSearch
  // / BookingDialog) já tem catch { setHits([]) }, fail-closed.
  await requireStaff();

  const term = q.trim();
  if (term.length < 1) return [];

  const supabase = await createClient();
  // Escape de wildcards do ILIKE — mesmo padrão que admin/clientes/page.tsx.
  const safe = term.replace(/[%_,()]/g, (m) => `\\${m}`);

  let query = (supabase as any)
    .from("profiles")
    .select("id, full_name, email, phone")
    .eq("role", "client");

  // OWNER vê TODOS os clientes (incluindo "órfãos" sem trainer/atividade —
  // ex. acabados de registar). A RLS já permite (is_admin). Para um TRAINER
  // não-owner mantemos o scope (não vazar PII de clientes de outro trainer).
  const profile = await getCurrentProfile();
  if (profile?.role !== "owner") {
    const trainerIds = await getAccessibleTrainerIds();
    const scopeIds = await getClientIdsInScope(trainerIds);
    if (scopeIds.length === 0) return [];
    query = query.in("id", scopeIds);
  }

  const { data } = await query
    .or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`)
    .order("full_name")
    .limit(5);

  // Exclui contas anonimizadas (RGPD). email NULL fica incluído.
  return ((data ?? []) as ClientHit[]).filter(
    (c) => !(c.email ?? "").endsWith("@removido.invalid"),
  );
}
