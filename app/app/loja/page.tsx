import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/supabase/server";
import { Package, BookOpen, Shirt, Pill, type LucideIcon } from "lucide-react";

type Bubble = { href: string; label: string; desc: string; icon: LucideIcon };

const bubbles: Bubble[] = [
  { href: "/app/comprar", label: "Packs", desc: "Sessões de treino", icon: Package },
  { href: "/app/loja/ebooks", label: "Ebooks", desc: "Guias e receitas", icon: BookOpen },
  { href: "/app/loja/roupa", label: "Roupa", desc: "Merch & vestuário", icon: Shirt },
  { href: "/app/loja/suplementos", label: "Suplementos", desc: "Nutrição", icon: Pill },
];

export default async function LojaPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-[70vh] flex-col">
      <h1 className="font-display text-2xl font-bold tracking-tight">Loja</h1>

      <div className="grid flex-1 grid-cols-2 content-center gap-3">
        {bubbles.map((b) => {
          const Icon = b.icon;
          return (
            <Link
              key={b.href}
              href={b.href}
              className="card flex flex-col items-center justify-center gap-2 p-6 text-center transition hover:border-gold-400 hover:shadow-glow"
            >
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-900 text-gold-400">
                <Icon size={26} />
              </div>
              <div className="font-display text-base font-bold">{b.label}</div>
              <div className="text-[11px] text-ink-500">{b.desc}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
