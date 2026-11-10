import "server-only";
import { createAdminClient, getCurrentProfile } from "@/lib/supabase/server";
import { getAccessibleTrainerIds, getTrainerForClient } from "@/lib/trainer";
import { getAvailableSlots } from "@/lib/availability";
import { isChatId } from "@/lib/chat";

export type ReactivationAlert = {
  id: string;
  client_id: string;
  trainer_id: string | null;
  week_at: string;
  reasons: string[];
  days: number | null;
  last_session: string | null;
  remaining: number;
};

export async function reactivationScope() {
  const profile = await getCurrentProfile();
  if (!profile || profile.access_blocked || !["owner", "trainer"].includes(profile.role)) return null;
  return { profile, trainers: profile.role === "owner" ? null : await getAccessibleTrainerIds() };
}

export function reactivationDb() {
  return createAdminClient() as any;
}

export async function getReactivationAlert(id: string, clientId?: string) {
  if (!isChatId(id)) return null;
  const scope = await reactivationScope();
  if (!scope) return null;
  const db = reactivationDb();
  const { data: alert } = await db.from("leap_reactivation_alerts").select("*").eq("id", id).maybeSingle();
  const row = alert as ReactivationAlert | null;
  if (!row || (clientId && row.client_id !== clientId)) return null;
  if (scope.trainers && (!row.trainer_id || !scope.trainers.includes(row.trainer_id)
    || await getTrainerForClient(row.client_id) !== row.trainer_id)) return null;
  return row;
}

const slotLabel = new Intl.DateTimeFormat("pt-PT", {
  timeZone: "Europe/Lisbon", weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
});
const dateKey = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit",
});

export async function reactivationDraft(alert: ReactivationAlert, fullName: string | null) {
  const name = fullName?.trim().split(/\s+/)[0] || "atleta";
  switch (alert.reasons[0]) {
    case "level1": {
      let slots: Date[] = [];
      if (alert.trainer_id) {
        const db = reactivationDb();
        const { data: settings } = await db.from("trainer_settings").select("default_slot_duration_min")
          .eq("trainer_id", alert.trainer_id).maybeSingle();
        const today = Date.parse(dateKey.format(new Date()) + "T00:00:00Z");
        for (let i = 0; i < 7 && slots.length < 2; i++) {
          const day = await getAvailableSlots({
            trainerId: alert.trainer_id, date: new Date(today + i * 86400000),
            durationMin: settings?.default_slot_duration_min ?? 45,
          });
          slots = slots.concat(day.slice(0, 2 - slots.length).map(slot => slot.startsAt));
        }
      }
      const availability = slots.length
        ? `Tenho ${slots.length === 1 ? "um horário livre" : "horários livres"} em ${slots.map(slot => slotLabel.format(slot)).join(" e ")}. Queres que te reserve um?`
        : "Que dia te dava jeito para voltares a treinar?";
      return `Olá ${name}! Senti a tua falta esta semana. Está tudo bem? ${availability}`;
    }
    case "level2":
      return `Olá ${name}, já passaram ${alert.days} dias desde o nosso último treino. Sei que a vida aperta. Vamos voltar com um treino leve esta semana? Diz-me o dia que dá mais jeito.`;
    case "level3":
      return `Olá ${name}! Tenho saudades de te ver no estúdio. Esta semana tenho um treino de regresso para ti, com avaliação incluída. Queres marcar?`;
    case "low":
      return `Olá ${name}, ${alert.remaining === 1 ? "resta-te 1 sessão" : "restam-te 2 sessões"} no pack. Para não perderes o ritmo, queres que deixe já o próximo preparado?`;
    case "empty":
      return `Olá ${name}, o teu pack terminou. Excelente trabalho! Queres continuar? Se renovares esta semana, garanto-te os teus horários habituais.`;
    default:
      return `Olá ${name}, notei que os últimos horários não deram jeito. Queres que encontremos um horário mais fácil para ti?`;
  }
}
