import Link from "next/link";
import Image from "next/image";
import { resetAction } from "./actions";

export default function ResetPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  return (
    <main className="flex min-h-screen flex-col items-center bg-bone-50 p-6 pt-16 sm:pt-24 dark:bg-ink-900">
      <Link href="/" className="mb-10 flex flex-col items-center gap-2">
        <Image
          src="/images/logo-slogan.png"
          alt="LEAP-FITNESS STUDIO"
          width={500}
          height={375}
          priority
          className="h-auto w-96 dark:invert"
        />
      </Link>

      <div className="w-full max-w-sm">
        <div className="card p-6">
          <h1 className="text-xl font-bold">Nova password</h1>
          <form action={resetAction} className="mt-6 space-y-4">
            <div>
              <label className="label">Nova password</label>
              <input name="password" type="password" required minLength={8} className="input" autoComplete="new-password" />
            </div>
            {searchParams.error && (
              <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {searchParams.error}
              </div>
            )}
            <button type="submit" className="btn-gold w-full">Guardar</button>
          </form>
        </div>
      </div>
    </main>
  );
}
