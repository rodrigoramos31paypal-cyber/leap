import Link from "next/link";

// 0141: página 404 com marca, em vez do fallback cru do Next.
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bone-50 p-6 dark:bg-ink-900">
      <div className="w-full max-w-sm text-center">
        <div className="card p-6">
          <h1 className="text-xl font-bold">Página não encontrada</h1>
          <p className="mt-2 text-sm text-ink-500">
            O endereço que procuras não existe ou foi movido.
          </p>
          <Link href="/" className="btn-gold mt-6 inline-block w-full">
            Voltar ao início
          </Link>
        </div>
      </div>
    </main>
  );
}
