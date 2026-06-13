import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Dumbbell, Calendar, CreditCard, ShieldCheck } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

export default function HomePage() {
  return (
    // Layout em flex column garante footer no fundo do viewport.
    // Cores light por defeito + variantes dark: para o tema escuro.
    <main className="flex min-h-screen flex-col bg-bone-50 text-ink-900 dark:bg-ink-900 dark:text-bone-50">
      {/* safe-top: respeita a Dynamic Island / notch quando a app corre
          em modo PWA (adicionada ao ecrã principal do iPhone). */}
      <header className="safe-top w-full">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-4 sm:px-6 sm:py-5">
          <Link href="/" className="flex items-center gap-2 sm:gap-3">
            <Image
              src="/images/logo.png"
              alt="LEAP-FITNESS"
              width={44}
              height={44}
              priority
              className="h-9 w-9 sm:h-10 sm:w-10 dark:invert"
            />
            <span className="font-display text-base font-semibold tracking-tight sm:text-lg">
              LEAP<span className="text-gold-400">·</span>FITNESS
            </span>
          </Link>
          <nav className="flex items-center gap-1.5 sm:gap-2">
            {/* Light bg + border para que ThemeToggle e Entrar leiam
                como botões (antes eram quase invisíveis no header). */}
            <ThemeToggle className="border border-ink-900/10 bg-white/60 hover:bg-white dark:border-white/10 dark:bg-white/[0.06] dark:hover:bg-white/[0.12]" />
            <Link
              href="/login"
              className="inline-flex items-center rounded-lg border border-ink-900/10 bg-white/60 px-3 py-2 text-sm font-medium text-ink-900 transition hover:bg-white dark:border-white/10 dark:bg-white/[0.06] dark:text-bone-50 dark:hover:bg-white/[0.12]"
            >
              Entrar
            </Link>
            <Link href="/registar" className="btn-gold">
              Criar conta
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl flex-1 px-6 pt-10 pb-16">
        <div className="grid gap-10 md:grid-cols-2 md:items-center">
          <div>
            <span className="chip-gold mb-5">Portal oficial · v2.0</span>
            <h1 className="font-display text-5xl font-black leading-[1.05] tracking-tight md:text-6xl">
              A tua jornada,
              <br />
              <span className="text-gold-400">as tuas sessões,</span>
              <br />
              num só sítio.
            </h1>
            <p className="mt-6 max-w-md text-base text-ink-600 dark:text-bone-100/80">
              Compra packs, marca sessões e segue o teu histórico. Sem confusões, sem sessões perdidas.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/registar" className="btn-gold">
                Começar agora <ArrowRight size={16} />
              </Link>
              <Link
                href="/login"
                className="btn-outline border-ink-900/20 text-ink-900 hover:bg-ink-900/5 dark:border-bone-50/20 dark:text-bone-50 dark:hover:bg-white/10"
              >
                Já tenho conta
              </Link>
            </div>
          </div>

          {/* Lock-up completo (logo + FITNESS STUDIO + slogan) — ligeiramente maior. */}
          <div className="flex flex-col items-center gap-6">
            <Image
              src="/images/logo-slogan.png"
              alt="LEAP-FITNESS STUDIO · Love. Energy. Ambition. Power."
              width={640}
              height={480}
              priority
              className="w-full max-w-lg dark:invert"
            />
            <div className="grid w-full grid-cols-2 gap-3">
              <FeatureCard icon={<Dumbbell size={18} />} title="Packs" desc="PT Individual ou Dupla." />
              <FeatureCard icon={<Calendar size={18} />} title="Agenda" desc="Marca em segundos." />
              <FeatureCard icon={<CreditCard size={18} />} title="Pagamentos" desc="MB Way, Multibanco, Cartão." />
              <FeatureCard icon={<ShieldCheck size={18} />} title="Sessões" desc="Sempre actualizadas." />
            </div>
          </div>
        </div>
      </section>

      <footer className="mt-auto border-t border-ink-900/10 dark:border-white/5">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-xs text-ink-500 dark:text-bone-100/50">
          <span>© {new Date().getFullYear()} LEAP-FITNESS STUDIO</span>
          <span>Made with discipline.</span>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-ink-900/10 bg-white p-4 dark:border-white/5 dark:bg-ink-800">
      <div className="mb-2 grid h-8 w-8 place-items-center rounded-lg bg-gold-400/15 text-gold-600 dark:text-gold-400">
        {icon}
      </div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-0.5 text-[11px] text-ink-500 dark:text-bone-100/60">{desc}</div>
    </div>
  );
}
