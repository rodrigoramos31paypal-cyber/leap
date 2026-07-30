import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/supabase/server";
import { Package, BookOpen, Shirt, Pill, type LucideIcon } from "lucide-react";

type Bubble = { href: string; label: string; desc: string; icon: LucideIcon; box: string };

const bubbles: Bubble[] = [
  { href: "/app/comprar", label: "Packs", desc: "Sessões de treino", icon: Package, box: "bg-ink-900 text-gold-400 dark:bg-white/10" },
  { href: "/app/loja/ebooks", label: "Ebooks", desc: "Guias e receitas", icon: BookOpen, box: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  { href: "/app/loja/roupa", label: "Roupa", desc: "Merch & vestuário", icon: Shirt, box: "bg-[#EEEDFE] text-[#534AB7] dark:bg-[#534AB7]/25 dark:text-[#AFA9EC]" },
  { href: "/app/loja/suplementos", label: "Suplementos", desc: "Nutrição", icon: Pill, box: "bg-[#FAEEDA] text-[#854F0B] dark:bg-amber-500/15 dark:text-amber-300" },
];

export default async function LojaPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-[1.75rem] font-bold leading-tight tracking-tight">Loja</h1>
        <p className="text-[12.5px] text-ink-500">Packs, ebooks, roupa e suplementos</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {bubbles.map((b) => {
          const Icon = b.icon;
          return (
            <Link
              key={b.href}
              href={b.href}
              className="card flex flex-col gap-2.5 p-4 transition hover:border-gold-400"
            >
              <span className={`grid h-11 w-11 place-items-center rounded-xl ${b.box}`}>
                <Icon size={22} />
              </span>
              <span>
                <span className="block text-[14.5px] font-semibold text-ink-900 dark:text-bone-50">{b.label}</span>
                <span className="block text-[11.5px] text-ink-500">{b.desc}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
