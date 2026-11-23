export const ENROLLMENT_INTERESTS = ["Treino individual", "Treino em dupla", "Ainda estou a explorar"] as const;
export const ENROLLMENT_GOALS = ["Ganhar músculo", "Perder gordura", "Melhorar a condição física", "Outro"] as const;
export type Enrollment = { interest: string; goal: string; availability: string; submitted_at?: string };
export function enrollmentDraft(name: string) {
  const first = name.trim().split(/\s+/)[0] || "";
  return `Olá${first ? ", " + first : ""}! Obrigado pelo interesse 😊 Vi a tua inscrição. Já treinaste com acompanhamento ou seria a primeira vez?`;
}
