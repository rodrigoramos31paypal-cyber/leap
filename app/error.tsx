"use client";

// 0141: error boundary global de segmento. Sem isto, qualquer throw não
// capturado num Server Component (ex.: falha transitória do Supabase, um
// .single() sem linhas) resultava num ecrã branco do Next sem recuperação.
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log no cliente; o detalhe do erro não é exposto ao utilizador.
    console.error("app error boundary:", error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bone-50 p-6 dark:bg-ink-900">
      <div className="w-full max-w-sm text-center">
        <div className="card p-6">
          <h1 className="text-xl font-bold">Algo correu mal</h1>
          <p className="mt-2 text-sm text-ink-500">
            Ocorreu um erro inesperado. Tenta novamente. Se persistir, contacta o
            suporte.
          </p>
          <button onClick={() => reset()} className="btn-gold mt-6 w-full">
            Tentar de novo
          </button>
        </div>
      </div>
    </main>
  );
}
