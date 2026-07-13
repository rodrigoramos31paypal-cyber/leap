"use server";

// ════════════════════════════════════════════════════════════════
// createClientAction · cria um cliente "silencioso" (sem login) a partir
// da lista de Clientes. Mesmo padrão que o modo "Novo cliente" do
// BookingDialog (app/admin/agenda/actions.ts): conta criada via service
// role, password aleatória, email confirmado. O trigger handle_new_user
// cria o perfil (role='client') a partir do user_metadata.
//
// trainer_id: se quem cria for um trainer, o cliente fica no scope dele;
// se for owner (sem trainer próprio), fica "órfão" — o owner vê-o na vista
// "Todos clientes". Devolve { ok, clientId } ou { error } para a UI.
// ════════════════════════════════════════════════════════════════
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentTrainerId } from "@/lib/trainer";
import { randomUUID } from "crypto";
import { logError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { captureAlert, isAccessDenied } from "@/lib/alerts";
import { requireStaff } from "@/lib/authz";

const NOEMAIL_DOMAIN = "sem-email.leap.local";

export async function createClientAction(
  formData: FormData,
): Promise<{ ok?: true; clientId?: string; error?: string }> {
  try {
    await requireStaff(); // S-10

    const name = String(formData.get("new_name") ?? "").trim().slice(0, 120);
    const emailRaw = String(formData.get("new_email") ?? "").trim().toLowerCase();
    const phone = String(formData.get("new_phone") ?? "").trim().slice(0, 40) || undefined;

    if (!name) return { error: "Indica o nome do cliente." };
    if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      return { error: "Email inválido." };
    }

    const trainerId = await getCurrentTrainerId(); // null se for owner

    const admin = createAdminClient();
    // Sem email → gera um placeholder único (a conta tem de ter email).
    const email = emailRaw || `cliente.${randomUUID()}@${NOEMAIL_DOMAIN}`;
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email,
      password: randomUUID() + randomUUID(), // aleatória — o cliente nunca faz login
      email_confirm: true, // sem email de confirmação
      // created_by_admin: marca para o trigger handle_new_user NÃO registar
      // isto como auto-registo (já registamos client_create_admin abaixo).
      user_metadata: { full_name: name, phone, trainer_id: trainerId ?? undefined, created_by_admin: true },
    });
    if (authErr || !created?.user) {
      const m = String(authErr?.message ?? "");
      if (/already|registered|exists/i.test(m)) {
        return { error: "Já existe um cliente com esse email." };
      }
      logError("createClientAction:createUser", authErr);
      return { error: "Não foi possível criar o cliente." };
    }

    const clientId = created.user.id;
    await logAudit("client_create_admin", {
      targetTable: "profiles",
      targetId: clientId,
      payload: { name, hasEmail: !!emailRaw, source: "clientes" },
    });

    revalidatePath("/admin/clientes");
    return { ok: true, clientId };
  } catch (e) {
    if (isAccessDenied(e)) {
      await captureAlert("admin_access_denied", { action: "createClient" });
      return { error: "Sem permissão." };
    }
    logError("createClientAction", e);
    return { error: "Não foi possível criar o cliente." };
  }
}
