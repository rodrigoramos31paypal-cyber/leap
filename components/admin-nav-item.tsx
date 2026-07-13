"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function AdminNavItem({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  const path = usePathname();
  const active = path === href || path?.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition",
        active
          ? "bg-ink-900/10 text-ink-900"
          : "text-ink-600 hover:bg-ink-900/5 hover:text-ink-900",
      )}
    >
      {icon} {label}
    </Link>
  );
}
