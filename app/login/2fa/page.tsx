import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/supabase/server";
import { listVerifiedFactors, isMfaSatisfied } from "@/lib/mfa";
import { verifyChallengeAction } from "./actions";

export default async function TwoFaChallengePage(
  props: {
    searchParams: Promise<{ error?: string; next?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Se já está satisfeito (AAL2 ou trusted device), salta o desafio.
  if (await isMfaSatisfied(user.id)) {
    redirect(searchParams.next && searchParams.next.startsWith("/") ? searchParams.next : "/app/dashboard");
  }

  const factors = await listVerifiedFactors();
  if (factors.length === 0) {
    // Não tem factor → não tem 2FA. Manda para o dashboard.
    redirect("/app/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col items-center bg-bone-50 p-6 pt-12 dark:bg-ink-900 sm:pt-16">
      <Link href="/" className="mb-6 flex flex-col items-center gap-2 sm:mb-8">
        <Image
          src="/images/logo-slogan.png"
          alt="LEAP-FITNESS STUDIO"
          width={500}
          height={375}
          priority
          className="h-auto w-80 dark:invert sm:w-[22rem]"
        />
      </Link>

      <div className="w-full max-w-sm">
        <div className="card p-6">
          <h1 className="text-xl font-bold">Verificação em dois passos</h1>
          <p className="mt-1 text-sm text-ink-500">
            Abre o teu app de autenticação e introduz o código de 6 dígitos.
          </p>

          {searchParams.error && (
            <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {searchParams.error}
            </div>
          )}

          <form action={verifyChallengeAction} className="mt-6 space-y-4">
            {searchParams.next && (
              <input type="hidden" name="next" value={searchParams.next} />
            )}
            <div>
              <label htmlFor="code" className="label">Código</label>
              <input
                id="code"
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                autoComplete="one-time-code"
                className="input text-center font-mono text-2xl tracking-[0.5em]"
                placeholder="000000"
              />
            </div>
            <label className="flex items-start gap-2 rounded-md border border-ink-900/10 bg-bone-50 px-3 py-2 text-xs">
              <input
                type="checkbox"
                name="trust"
                defaultChecked
                className="mt-0.5 h-4 w-4 rounded border-ink-900/30"
              />
              <span>
                <span className="block font-semibold">Confiar neste dispositivo 30 dias</span>
                <span className="text-ink-500">
                  Não te pedimos o código outra vez neste browser durante 30 dias.
                </span>
              </span>
            </label>
            <button type="submit" className="btn-gold w-full">Verificar</button>
          </form>
        </div>
      </div>
    </main>
  );
}
