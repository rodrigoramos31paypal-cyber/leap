import Image from "next/image";

import type { Metadata } from "next";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-bone-50 p-6 text-ink-900 dark:bg-ink-900 dark:text-bone-50">
      <div className="max-w-sm text-center">
        <Image
          src="/images/logo.png"
          alt="LEAP Fitness Studio"
          width={64}
          height={64}
          className="mx-auto mb-6 h-16 w-16 dark:invert"
        />

        <h1 className="font-display text-2xl font-bold tracking-tight">Sem ligação</h1>
        <p className="mt-2 text-sm text-ink-500">
          Não conseguimos chegar ao portal. Verifica a internet e tenta de novo.
        </p>
        <a
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-gold-400 px-4 py-2 text-sm font-bold text-ink-900"
        >
          Tentar de novo
        </a>
      </div>
    </main>
  );
}
