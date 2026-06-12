// ════════════════════════════════════════════════════════════════
// Theme · light/dark mode persistido em cookie
//
// O cookie é lido server-side em `app/layout.tsx` para definir a class
// `dark` no <html> ANTES da hidratação (evita FOUC). O client component
// `ThemeToggle` flipa a class + actualiza o cookie.
// ════════════════════════════════════════════════════════════════
import { cookies } from "next/headers";

export type Theme = "light" | "dark";
export const THEME_COOKIE = "leap_theme";
export const DEFAULT_THEME: Theme = "light";

/** Lê a preferência do utilizador (server-side). */
export function getTheme(): Theme {
  try {
    const c = cookies().get(THEME_COOKIE)?.value;
    return c === "light" || c === "dark" ? c : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}
