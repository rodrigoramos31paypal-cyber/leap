// ════════════════════════════════════════════════════════════════
// Authz · guards explícitos no boundary das Server Actions (H2).
//
// As Server Actions são endpoints POST invocáveis isoladamente — um
// atacante não precisa de carregar o layout /admin para as chamar. As
// RPC SECURITY DEFINER e a RLS já rejeitam não-staff, mas confiar só
// nisso é frágil: uma policy mal configurada = escalada silenciosa.
// Estes guards tornam a autorização explícita e auditável no boundary.
//
// S-13 (audit jun/2026): o gate de 2FA vivia SÓ no `app/admin/layout.tsx`.
// As Server Actions não renderizam o layout, por isso uma sessão AAL1
// (password correcta, sem TOTP) — exactamente o cenário que o 2FA
// existe para travar — podia invocar QUALQUER action de staff
// directamente (apagar cliente, atribuir créditos, cancelar sessões,
// conceder admin) sem nunca passar o desafio. `is_admin()` nas RPCs
// também devolve true em AAL1, por isso a camada de dados não apanhava
// isto. A asserção abaixo replica o gate do layout NO boundary de dados,
// para que o 2FA passe a "estar de pé sozinho" fora do layout.
// ════════════════════════════════════════════════════════════════
import { getCurrentProfile, getAuthUser } from "@/lib/supabase/server";
import { getAalInfo, isDeviceTrusted } from "@/lib/mfa";

/** S-13: replica o gate de 2FA do `app/admin/layout.tsx` no boundary de
 *  dados. Se o caller TEM um factor verificado mas a sessão ainda não
 *  está em AAL2 e o device não é confiado, recusa — mesmo que o role
 *  seja staff. Sem custo para sessões já em AAL2 ou sem 2FA (não toca
 *  na BD nesses casos). `getAalInfo` é cached por request. */
async function assertMfaSatisfied(userId: string): Promise<void> {
  const { currentLevel, hasMfa } = await getAalInfo();
  if (hasMfa && currentLevel !== "aal2" && !(await isDeviceTrusted(userId))) {
    throw new Error("2FA necessária.");
  }
}

/** Garante que o caller é staff (trainer ou owner) E satisfez o 2FA
 *  (S-13). Lança se não for. Cached por request (getCurrentProfile usa
 *  React.cache). */
export async function requireStaff() {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "trainer" && profile.role !== "owner")) {
    throw new Error("Acesso restrito.");
  }
  // 0141 (audit jul/2026): um staff BANIDO (access_blocked) cujo access token
  // ainda é válido podia invocar server actions até o TTL expirar — o gate de
  // ban só existia nos layouts. Bloqueamos aqui, no boundary de dados.
  if ((profile as any).access_blocked) {
    throw new Error("Conta bloqueada.");
  }
  await assertMfaSatisfied(profile.id);
  return profile;
}

/** Garante que o caller é owner E satisfez o 2FA (S-13). Lança se não for.
 *
 *  M-3 (audit jul/2026): as ações de OWNER são as mais sensíveis (conceder/
 *  revogar admin, apagar/anonimizar contas, banir). Por isso, ao contrário
 *  do `requireStaff` (que confia no JWT verificado localmente até expirar),
 *  aqui fazemos um round-trip ao GoTrue via `getAuthUser()`. Assim, uma
 *  REVOGAÇÃO server-side (sign-out forçado noutro device, ban do owner) é
 *  apanhada de IMEDIATO, sem esperar pelo fim do TTL do access token. Custo:
 *  1 chamada extra ao auth server — desprezável porque ações de owner são
 *  raras. `getAuthUser` é cached por request. */
export async function requireOwner() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "owner") {
    throw new Error("Acesso restrito ao owner.");
  }
  // 0141: bloqueia owner banido no boundary (ver requireStaff).
  if ((profile as any).access_blocked) {
    throw new Error("Conta bloqueada.");
  }
  // Revalida a sessão contra o auth server (apanha revogação instantânea).
  const fresh = await getAuthUser();
  if (!fresh || fresh.id !== profile.id) {
    throw new Error("Sessão inválida ou revogada.");
  }
  await assertMfaSatisfied(profile.id);
  return profile;
}

/** 0138: bloqueio de conta por aprovar no BOUNDARY das server actions do
 *  cliente. O gate visual (app/app/layout.tsx) só cobre a navegação; as
 *  server actions são POSTs invocáveis diretamente. Devolve uma mensagem
 *  amigável se o caller for um cliente PENDENTE (para a action abortar com
 *  um erro claro), ou null caso contrário (staff, cliente aprovado). */
export async function pendingApprovalBlock(): Promise<string | null> {
  const profile = await getCurrentProfile();
  // 0141: um cliente BANIDO não deve marcar/comprar, mesmo já aprovado.
  if (profile?.role === "client" && (profile as any).access_blocked) {
    return "A tua conta está bloqueada. Contacta o teu treinador.";
  }
  if (profile?.role === "client" && (profile as any).approval_status === "pending") {
    return "A tua conta está a aguardar aprovação. Assim que for aprovada, poderás marcar e comprar.";
  }
  return null;
}
