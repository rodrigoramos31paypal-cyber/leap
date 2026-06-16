import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Database } from "@/types/database";

export function createClient() {
  const cookieStore = cookies();
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
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
});

/** Como getSessionUser, mas valida o JWT contra o auth server. Usar só quando necessário. */
export const getAuthUser = cache(async () => {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ?? null;
});

/** Profile do user logado (role, full_name). Cached por request. */
export const getCurrentProfile = cache(async () => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, role, full_name")
    .eq("id", user.id)
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
