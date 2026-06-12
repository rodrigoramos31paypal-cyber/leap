"use server";

// ════════════════════════════════════════════════════════════════
// Procura de clientes para typeahead/autocomplete.
// Devolve até 5 hits ordenados por nome para o dropdown mostrar.
// Server action por RPC — chamada directamente do client component.
// ════════════════════════════════════════════════════════════════
import { createClient } from "@/lib/supabase/server";

export type ClientHit = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

export async function searchClientsAction(q: string): Promise<ClientHit[]> {
  const term = q.trim();
  if (term.length < 1) return [];
  const supabase = createClient();
  const safe = term.replace(/[%_,()]/g, (m) => `\\${m}`);
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone")
    .eq("role", "client")
    .or(
      `full_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`,
    )
    .order("full_name")
    .limit(5);
  return (data ?? []) as ClientHit[];
}
