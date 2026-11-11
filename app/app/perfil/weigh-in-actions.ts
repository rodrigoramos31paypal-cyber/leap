"use server";

import { revalidatePath } from "next/cache";
import { weighInAccess } from "@/lib/weigh-ins";
import { lisbonDate, weighInMetrics } from "@/lib/weigh-in-metrics";
import { isChatId } from "@/lib/chat";

export async function saveWeighIn(form: FormData) {
  const target = form.get("clientId");
  const access = await weighInAccess(typeof target === "string" ? target : undefined);
  if (!access) return { error: "Sem acesso a estas pesagens." };
  const id = form.get("id");
  const date = String(form.get("measured_on") ?? "");
  const parsed = new Date(date + "T00:00:00Z");
  if (!isChatId(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+parsed)
    || parsed.toISOString().slice(0,10) !== date || date > lisbonDate()) return { error: "Confirma a data da pesagem." };

  const values: Record<string,number|null> = {};
  for (const { key,label,max,zero } of weighInMetrics) {
    const raw = String(form.get(key) ?? "").trim();
    const value = Number(raw.replace(",","."));
    if (raw && (!/^\d+(?:[.,]\d{1,2})?$/.test(raw) || value > max || (!zero && value === 0))) {
      return { error: `Confirma o valor de ${label.toLowerCase()}.` };
    }
    values[key] = raw ? value : null;
  }
  if (weighInMetrics.slice(0,4).every(metric => values[metric.key] === null)) {
    return { error: "Preenche pelo menos um dos quatro indicadores principais." };
  }
  const note = String(form.get("note") ?? "").trim();
  if (note.length > 500) return { error: "A nota pode ter até 500 caracteres." };
  const { error } = await access.db.from("leap_weigh_ins").upsert({
    id, client_id: access.clientId, recorded_by: access.viewerId, measured_on: date,
    source: form.get("source") === "starfit" ? "starfit" : "manual", note: note || null, ...values,
  }, { onConflict: "id", ignoreDuplicates: true });
  if (error) return { error: "Não foi possível guardar a pesagem." };
  revalidatePath("/app/perfil");
  revalidatePath(`/admin/clientes/${access.clientId}`);
  return { ok: true };
}
