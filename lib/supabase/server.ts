import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Database } from "@/types/database";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            /* Server Components cannot set cookies; ignored. */
          }
        },
      },
    },
  );
}

// ────────────────────────────────────────────────────────────────
// PERF: helpers cached por React.cache() para deduplicar chamadas
// dentro do mesmo request. Middleware já validou o cookie (chama
// getUser() no edge), por isso aqui em SC usamos getSession() que
// só lê o cookie e não bate no auth server. Para casos em que
// precisamos mesmo de revalidar o JWT, há getAuthUser().
// ────────────────────────────────────────────────────────────────

/** Sessão do request actual. Lê apenas cookie — sem round-trip ao auth server. */
export const getSessionUser = cache(async () => {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
});

/** Como getSessionUser, mas valida o JWT contra o auth server (round-trip ao
 *  GoTrue). Apanha REVOGAÇÃO server-side (sign-out noutro device, ban) de
 *  imediato. Usar quando a revogação instantânea importa mesmo (ex.: MFA). */
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ?? null;
});

/** Claims do JWT do request, validadas LOCALMENTE.
 *
 *  PERF (P-04, audit jun/2026): o projecto usa chaves assimétricas (ES256 —
 *  ver JWKS). `getClaims()` verifica a assinatura do JWT em processo contra
 *  a chave pública (cacheada), SEM round-trip ao auth server. Mesma
 *  estratégia que o middleware já corre em produção. `sub` = user id. */
export const getClaimsUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
});

/** Profile do user logado (role, full_name). Cached por request.
 *
 *  SECURITY/PERF (P-04, audit jun/2026): valida o JWT CRIPTOGRAFICAMENTE via
 *  `getClaims()` (assinatura ES256 verificada localmente) em vez de
 *  `getUser()` (round-trip ao GoTrue em CADA navegação). A fronteira de
 *  autorização continua a ficar "de pé sozinha" — sem JWT válido devolve
 *  null aqui, independentemente do middleware.
 *
 *  Trade-off consciente: confia num JWT válido até EXPIRAR (TTL do access
 *  token); não apanha revogação server-side instantânea. Mitigações: (1) o
 *  `role` é relido de `profiles` a cada request → despromoção de admin é
 *  apanhada AO VIVO; (2) fluxos sensíveis (MFA) usam `getAuthUser()`. */
export const getCurrentProfile = cache(async () => {
  const claims = await getClaimsUser();
  const userId = claims?.sub;
  if (!userId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, role, full_name, access_blocked")
    .eq("id", userId)
    .single();
  return data ?? null;
});

/** Cliente anon SEM cookies — para dados PÚBLICOS (sem sessão). Seguro
 *  dentro de unstable_cache / geração estática: não chama cookies(). */
export function createPublicClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => [],
        setAll: () => {},
      },
    },
  );
}

/** Service-role client — bypasses RLS. Use only in trusted server code. */
export function createAdminClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll: () => [],
        setAll: () => {},
      },
    },
  );
}
