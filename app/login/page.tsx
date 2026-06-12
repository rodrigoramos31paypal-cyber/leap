import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loginAction } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string; error?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    redirect(profile?.role === "client" ? "/app/dashboard" : "/admin/dashboard");
  }

  return (
    // Mobile: padding-top moderado para não bater na barra do teclado
    //         quando o user toca no input.
    // Desktop (sm+): justify-center vertical para o card aterrar na
    //                metade superior do viewport sem ficar colado ao topo.
    <main className="flex min-h-screen flex-col items-center bg-bone-50 p-6 pt-12 dark:bg-ink-900 sm:justify-center sm:pt-6">
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
          <h1 className="text-xl font-bold">Entrar</h1>
          <p className="mt-1 text-sm text-ink-500">Bem-vindo de volta.</p>

          <form action={loginAction} className="mt-6 space-y-4">
            <input type="hidden" name="next" value={searchParams.next ?? ""} />
            <div>
              <label className="label">Email</label>
              <input name="email" type="email" required autoComplete="email" className="input" />
            </div>
            <div>
              <label className="label">Password</label>
              <input name="password" type="password" required autoComplete="current-password" className="input" />
            </div>
            {searchParams.error && (
              <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {searchParams.error}
              </div>
            )}
            <button type="submit" className="btn-gold w-full">Entrar</button>
          </form>

          <div className="mt-4 flex items-center justify-between text-sm">
            <Link href="/recuperar" className="text-ink-500 hover:text-ink-900">
              Esqueci-me da password
            </Link>
            <Link href="/registar" className="font-medium text-gold-600 hover:text-gold-700">
              Criar conta
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
