import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function eur(cents: number): string {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function eurFromEuros(euros: number): string {
  return eur(Math.round(euros * 100));
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function formatTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

export function hoursBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / 36e5;
}

export function startOfDayPT(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export const SESSION_TYPE = {
  individual: "Individual",
  dupla: "Dupla",
} as const;

export const PURCHASE_STATUS = {
  pending_payment: "Pagamento pendente",
  awaiting_confirmation: "Aguarda confirmação",
  confirmed: "Confirmado",
  rejected: "Rejeitado",
  cancelled: "Cancelado",
} as const;

export const BOOKING_STATUS = {
  booked: "Marcada",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  no_show: "Faltou",
} as const;

/**
 * Valida que um caminho de redirect controlado pelo utilizador é seguro.
 *
 * Bloqueia (C3 do audit de segurança):
 *   • protocol-relative URLs (`//evil.com`, `/\evil.com`) — interpretadas
 *     como external hosts pelos browsers
 *   • URLs absolutos com scheme (`https://evil.com`, `javascript:...`)
 *   • barras invertidas (alguns browsers tratam `\` como `/`)
 *   • newlines/CR (header injection no Location)
 *   • whitespace inicial (truques de parsing)
 *
 * Aceita SÓ paths absolutos do próprio site: começam por `/` e o
 * segundo caractere é um path char (não `/`, `\`, `:`).
 *
 * Usar onde quer que aceitemos `next=...` ou `redirectTo=...` vindos
 * do query string ou de form data.
 */
export function isSafePath(p: unknown): p is string {
  if (typeof p !== "string" || p.length === 0) return false;
  // Tem de começar por '/' e o segundo char NÃO pode ser '/' ou '\' ou ':'
  if (p[0] !== "/") return false;
  if (p.length === 1) return true; // "/" é ok
  const c2 = p[1];
  if (c2 === "/" || c2 === "\\") return false;
  // Sem caracteres de controlo (newlines, tabs) — defesa contra header injection
  if (/[\r\n\t]/.test(p)) return false;
  return true;
}

/**
 * Devolve `p` se for um path seguro, caso contrário `fallback`.
 * Helper para uso inline em redirects.
 */
export function safePathOr(p: unknown, fallback: string): string {
  return isSafePath(p) ? p : fallback;
}
