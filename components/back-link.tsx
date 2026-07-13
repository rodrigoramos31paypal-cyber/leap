import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function BackLink({ href = "/app/dashboard", label = "Voltar" }: { href?: string; label?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900"
    >
      <ArrowLeft size={14} /> {label}
    </Link>
  );
}
