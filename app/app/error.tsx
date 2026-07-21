"use client";

// 0141: error boundary da área de cliente. Recupera sem sair do /app.
import { useEffect } from "react";
import Link from "next/link";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("/app error boundary:", error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        <div className="card p-6">
          <h1 className="text-xl font-bold">Algo correu mal</h1>
          <p className="mt-2 text-sm text-ink-500">
            Não foi possível carregar esta secção. Tenta novamente.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <button onClick={() => reset()} className="btn-gold w-full">
              Tentar de novo
            </button>
            <Link href="/app/dashboard" className="btn-ghost w-full">
              Ir para o painel
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
