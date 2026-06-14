import Link from "next/link";
import Image from "next/image";
import { recoverAction } from "./actions";

import type { Metadata } from "next";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function RecoverPage({
  searchParams,
}: {
  searchParams: { error?: string; success?: string };
}) {
  return (
    // Padding-top fixo em vez de justify-center: assim o logo
    // aterra na mesma coordenada Y em /login, /recuperar e /registar
    // (que têm cards de alturas diferentes).
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
          <h1 className="text-xl font-bold">Recuperar password</h1>
          <p className="mt-1 text-sm text-ink-500">Enviamos-te um link por email.</p>

          {searchParams.success && (
            <div className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              Se o email existir, enviámos instruções para o redefinir.
            </div>
          )}

          <form action={recoverAction} className="mt-6 space-y-4">
            <div>
              <label className="label">Email</label>
              <input name="email" type="email" required className="input" />
            </div>
            {searchParams.error && (
              <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {searchParams.error}
              </div>
            )}
            <button type="submit" className="btn-gold w-full">Enviar link</button>
          </form>

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
