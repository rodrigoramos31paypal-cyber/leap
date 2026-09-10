// ════════════════════════════════════════════════════════════════
// Sistema LEAP — Sequência + Níveis (helpers puros, sem I/O).
// Os números vêm das funções SQL get_client_streak / get_leaderboard (0149).
// ════════════════════════════════════════════════════════════════

export type LeapLevel = "bronze" | "silver" | "gold" | "elite";

export type LeapStreak = {
  currentStreak: number;
  bestStreak: number;
  currentWeekStatus: "none" | "on_track" | "broken";
};

// Níveis pela sequência atual (semanas).
//   Bronze 0–3 · Silver 4–11 · Gold 12–23 · Elite 24+
export function levelForStreak(weeks: number): LeapLevel {
  if (weeks >= 24) return "elite";
  if (weeks >= 12) return "gold";
  if (weeks >= 4) return "silver";
  return "bronze";
}

export const LEVEL_LABEL: Record<LeapLevel, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  elite: "Elite",
};

// Cores por nível (classes/hex usadas nos chips). Mantidas aqui para
// coerência entre dashboard, leaderboard e perfil.
export const LEVEL_CHIP: Record<LeapLevel, { bg: string; text: string }> = {
  bronze: { bg: "bg-[#FAECE7] dark:bg-[#F0997B]/10", text: "text-[#993C1D] dark:text-[#F0997B]" },
  silver: { bg: "bg-ink-900/[0.06] dark:bg-white/10", text: "text-ink-600 dark:text-bone-100" },
  gold: { bg: "bg-gold-100 dark:bg-gold-400/15", text: "text-gold-700 dark:text-gold-300" },
  elite: { bg: "bg-[#EEEDFE] dark:bg-[#7F77DD]/15", text: "text-[#3C3489] dark:text-[#AFA9EC]" },
};

// Nome próprio + inicial do apelido: "João Silva" → "João S.".
export function displayName(fullName: string | null | undefined): string {
  const parts = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Cliente";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

// Taxa de presença em % inteira (0–100), ou null se ainda não há dados.
export function attendanceRate(attended: number, faltas: number): number | null {
  const total = attended + faltas;
  if (total <= 0) return null;
  return Math.round((attended / total) * 100);
}
