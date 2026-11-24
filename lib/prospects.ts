import "server-only";
import { cache } from "react";
import { requireStaff } from "@/lib/authz";
import { createAdminClient } from "@/lib/supabase/server";
import { isChatId } from "@/lib/chat";

export type Prospect = {
  client_id: string;
  full_name: string | null;
  registered_at: string;
  approval_status: string;
  trainer_id: string | null;
  completed_sessions: number;
  last_session_at: string | null;
  next_session_at: string | null;
  last_contact_at: string | null;
  disposition: "active" | "snoozed" | "declined";
  snooze_until: string | null;
};

export const loadProspects = cache(async (): Promise<Prospect[]> => {
  const actor = await requireStaff();
  const { data, error } = await (createAdminClient() as any).rpc("leap_prospect_list", { p_actor: actor.id });
  if (error) throw new Error("Não foi possível carregar os novos clientes.");
  return data ?? [];
});

export async function getProspect(clientId: string) {
  if (!isChatId(clientId)) return null;
  return (await loadProspects()).find(row => row.client_id === clientId) ?? null;
}

export function prospectDraft(prospect: Prospect) {
  const name = prospect.full_name?.trim().split(/\s+/)[0] || "atleta";
  if (prospect.completed_sessions > 0) {
    return `Olá, ${name}! Como te sentiste depois do treino? 💪 Queres que te apresente os packs e encontremos o acompanhamento e os horários mais indicados para o teu objetivo?`;
  }
  if (prospect.next_session_at) {
    return `Olá, ${name}! Já tens a tua sessão marcada na LEAP 💪 Há algum objetivo ou alguma questão que queiras partilhar comigo antes do treino?`;
  }
  return `Olá, ${name}! Já vi o teu registo na LEAP 💪 Qual é o teu principal objetivo e que horários te dão mais jeito? Podemos combinar uma sessão experimental para conheceres o espaço e percebermos qual o acompanhamento mais indicado para ti.`;
}
