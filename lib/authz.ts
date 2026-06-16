// ════════════════════════════════════════════════════════════════
// Authz · guards explícitos no boundary das Server Actions (H2).
//
// As Server Actions são endpoints POST invocáveis isoladamente — um
// atacante não precisa de carregar o layout /admin para as chamar. As
// RPC SECURITY DEFINER e a RLS já rejeitam não-staff, mas confiar só
// nisso é frágil: uma policy mal configurada = escalada silenciosa.
// Estes guards tornam a autorização explícita e auditável no boundary.
// ════════════════════════════════════════════════════════════════
import { getCurrentProfile } from "@/lib/supabase/server";

/** Garante que o caller é staff (trainer ou owner). Lança se não for.
 *  Cached por request (getCurrentProfile usa React.cache). */
export async function requireStaff() {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "trainer" && profile.role !== "owner")) {
    throw new Error("Acesso restrito.");
  }
  return profile;
}

/** Garante que o caller é owner. Lança se não for. */
export async function requireOwner() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "owner") {
    throw new Error("Acesso restrito ao owner.");
  }
  return profile;
}
