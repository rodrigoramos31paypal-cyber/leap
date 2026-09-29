// ════════════════════════════════════════════════════════════════
// Atividade extra (treino autónomo / cardio) — tipos e etiquetas
// partilhadas entre Home, histórico, perfil e admin. Sem lógica de
// negócio; só apresentação. NÃO importar server-only APIs aqui.
// ════════════════════════════════════════════════════════════════
import type { LucideIcon } from "lucide-react";
import { Dumbbell, Heart } from "lucide-react";

export type ActivityType = "autonomous" | "cardio";
export type ActivityStatus = "pending" | "validated" | "rejected";

export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  autonomous: "Treino autónomo",
  cardio: "Cardio",
};

export const ACTIVITY_TYPE_ICON: Record<ActivityType, LucideIcon> = {
  autonomous: Dumbbell,
  cardio: Heart,
};

export const ACTIVITY_STATUS_LABEL: Record<ActivityStatus, string> = {
  pending: "Pendente",
  validated: "Validado",
  rejected: "Rejeitado",
};

// Chips no estilo atual (mesmas cores usadas nos estados da agenda/histórico).
export const ACTIVITY_STATUS_CHIP: Record<ActivityStatus, { bg: string; text: string }> = {
  pending: { bg: "bg-amber-100 dark:bg-amber-400/15", text: "text-amber-800 dark:text-amber-300" },
  validated: { bg: "bg-emerald-100 dark:bg-emerald-400/15", text: "text-emerald-800 dark:text-emerald-300" },
  rejected: { bg: "bg-red-100 dark:bg-red-400/15", text: "text-red-800 dark:text-red-300" },
};
