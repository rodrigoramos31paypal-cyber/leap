"use server";

import { redirect } from "next/navigation";
import { createClient, createPublicClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function registerAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const full_name = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (password.length < 8) {
    redirect("/registar?error=" + encodeURIComponent("Password tem de ter pelo menos 8 caracteres."));
  }

  // Telemóvel obrigatório com exactamente 9 dígitos (PT). Ignora espaços
  // que o utilizador possa ter colado, mas exige strictly 9 dígitos.
  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length !== 9) {
    redirect(
      "/registar?error=" +
        encodeURIComponent("O telemóvel tem de ter exactamente 9 dígitos."),
    );
  }

  // Data de nascimento (OPCIONAL). Se preenchida, tem de ser uma data real
  // (YYYY-MM-DD) e não no futuro; senão devolve erro. Em branco → ignorada.
  const dobRaw = String(formData.get("date_of_birth") ?? "").trim();
  let date_of_birth: string | null = null;
  if (dobRaw) {
    const d = new Date(dobRaw + "T00:00:00Z");
    const valid =
      /^\d{4}-\d{2}-\d{2}$/.test(dobRaw) &&
      !Number.isNaN(d.getTime()) &&
      d.getTime() <= Date.now();
    if (!valid) {
      redirect("/registar?error=" + encodeURIComponent("Data de nascimento inválida."));
    }
    date_of_birth = dobRaw;
  }

  // SEC (H-C, audit jun/2026): defesa em profundidade no boundary.
  // O trainer_id vem do form (página pública /t/<slug> → /registar?
  // trainer=<id>) e acaba em user_metadata → handle_new_user. O trigger
  // 0046 já valida que o trainer existe e está ACTIVO (senão grava NULL),
  // mas validamos também aqui: se o trigger for alterado/perder esta
  // verificação numa migração futura, não queremos gravar um trainer_id
  // arbitrário — um atacante associar-se-ia como "ghost client" de outro
  // trainer. Só passamos o valor adiante se for um UUID válido E
  // corresponder a um trainer activo.
  const trainerIdRaw = String(formData.get("trainer_id") ?? "").trim();
  let trainer_id: string | null = null;
  if (trainerIdRaw && UUID_RE.test(trainerIdRaw)) {
    const pub = createPublicClient();
    const { data } = await pub
      .from("trainers")
      .select("id")
      .eq("id", trainerIdRaw)
      .eq("active", true)
      .maybeSingle();
    if (data) trainer_id = trainerIdRaw;
  }

  // Metadados do signUp → lidos pelo trigger handle_new_user ao criar o perfil.
  const meta: Record<string, unknown> = { full_name, phone: phoneDigits };
  if (trainer_id) meta.trainer_id = trainer_id;
  if (date_of_birth) meta.date_of_birth = date_of_birth;

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: meta,
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/auth/callback`,
    },
  });

  if (error) {
    logError("registerAction", error);
    // SEC (H-B, audit jun/2026): anti-enumeração. NÃO distinguir
    // "email já registado" de outros erros — caso contrário um atacante
    // itera emails e descobre quem tem conta (input valioso para
    // credential stuffing). Por simetria com /recuperar, redireccionamos
    // sempre para a página de sucesso: ou a conta foi criada, ou já
    // existia (Supabase manda um email idempotente nesse caso) — em
    // qualquer cenário não há acção útil para o atacante. Quem realmente
    // já tinha conta usa o fluxo "esqueci-me da password".
    redirect("/registar?success=1");
  }

  redirect("/registar?success=1");
}
