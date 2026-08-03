import Link from "next/link";
import Image from "next/image";
import { recoverAction, verifyResetAction } from "./actions";

import type { Metadata } from "next";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function RecoverPage(
  props: {
    searchParams: Promise<{ step?: string; email?: string; error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const isCodeStep = searchParams.step === "code";
  const email = searchParams.email ?? "";

  return (
    // Padding-top fixo em vez de justify-center: assim o logo
    // aterra na mesma coordenada Y em /login, /recuperar e /registar
    // (que têm cards de alturas diferentes).
    <main className="flex min-h-screen flex-col items-center bg-bone-50 p-6 pt-12 dark:bg-ink-900 sm:pt-16">
      <Link href="/" className="mb-6 flex flex-col items-center gap-2 sm:mb-8">
        <Image
          src="/images/logo-slogan.png"
          alt="LEAP Fitness Studio"
          width={500}
          height={375}
          priority
          className="h-auto w-80 dark:invert sm:w-[22rem]"
        />
      </Link>
      <div className="w-full max-w-sm">
        <div className="card p-6">
          {!isCodeStep ? (
            <>
              <h1 className="text-xl font-bold">Recuperar password</h1>
              <p className="mt-1 text-sm text-ink-500">Enviamos-te um código por email.</p>

              <form action={recoverAction} className="mt-6 space-y-4">
                <div>
                  <label className="label">Email</label>
                  <input name="email" type="email" required className="input" autoComplete="email" />
                </div>
                {searchParams.error && (
                  <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                    {searchParams.error}
                  </div>
                )}
                <button type="submit" className="btn-gold w-full">Enviar código</button>
              </form>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold">Nova password</h1>
              <p className="mt-1 text-sm text-ink-500">
                Se o email existir, enviámos um código
                {email ? ` para ${email}` : ""}. Introduz o código e escolhe a nova password.
              </p>

              <form action={verifyResetAction} className="mt-6 space-y-4">
                <input type="hidden" name="email" value={email} />
                <div>
                  <label className="label">Código do email</label>
                  <input
                    name="token"
                    inputMode="numeric"
                    pattern="\d{6,10}"
                    maxLength={10}
                    required
                    autoComplete="one-time-code"
                    placeholder="Código de acesso"
                    className="input tracking-[0.3em]"
                  />
                </div>
                <div>
                  <label className="label">Nova password</label>
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={8}
                    className="input"
                    autoComplete="new-password"
                  />
                </div>
                {searchParams.error && (
                  <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                    {searchParams.error}
                  </div>
                )}
                <button type="submit" className="btn-gold w-full">Guardar password</button>
              </form>

              <p className="mt-4 text-center text-sm text-ink-500">
                Não recebeste?{" "}
                <Link href="/recuperar" className="font-medium text-gold-600 hover:text-gold-700">
                  Pedir novo código
                </Link>
              </p>
            </>
          )}

          <p className="mt-5 text-center text-sm text-ink-500">
            <Link href="/login" className="font-medium text-gold-600 hover:text-gold-700">
              Voltar a entrar
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
