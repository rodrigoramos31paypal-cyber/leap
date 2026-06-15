"use client";

// ════════════════════════════════════════════════════════════════
// ThemeToggle · botão sol/lua que flipa a class `dark` no <html>
// e persiste a preferência em cookie de longa duração.
// ════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const COOKIE = "leap_theme";

function readCurrent(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function persist(theme: "light" | "dark") {
  try {
    // 1 ano
    document.cookie = `${COOKIE}=${theme}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  } catch {}
}

export function ThemeToggle({
  className = "",
  tone = "auto",
}: {
  className?: string;
  /** "auto" usa cores que respeitam tanto bg claro como escuro.
   *  "dark-surface" optimiza para superfícies escuras (landing/login). */
  tone?: "auto" | "dark-surface";
}) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // Sincroniza com o estado real do <html> depois da hidratação.
  useEffect(() => {
    setTheme(readCurrent());
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    if (next === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
    persist(next);
    setTheme(next);
  }

  const styles =
    tone === "dark-surface"
      ? "text-bone-50 hover:bg-white/10"
      : "text-ink-500 hover:bg-ink-900/5 dark:text-bone-100 dark:hover:bg-white/10";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
      title={theme === "dark" ? "Tema claro" : "Tema escuro"}
      className={`rounded-md p-2 transition ${styles} ${className}`}
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
