import { redirect } from "next/navigation";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { updateProfileAction } from "./actions";
import { BackLink } from "@/components/back-link";
import { NotificationPrefToggle } from "@/components/notification-pref-toggle";
import { DeleteAccountSection } from "@/components/delete-account-section";
import { Download } from "lucide-react";

export default async function PerfilPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = createClient();

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  const { data: prefsRows } = await (supabase as any)
    .from("notification_preferences")
    .select("kind, enabled")
    .eq("user_id", user.id);
  const prefMap = new Map<string, boolean>(
    ((prefsRows ?? []) as any[]).map((r) => [String(r.kind), r.enabled !== false] as [string, boolean]),
  );
  const reminderOn = prefMap.get("session_reminder") ?? true;
  const creditAlertOn = prefMap.get("credit_alert") ?? true;

  return (
    <div className="space-y-5">
      <BackLink />
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Perfil</h1>
        <p className="text-sm text-ink-500">Os teus dados pessoais.</p>
      </div>

      {searchParams.ok && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Perfil atualizado.</div>
      )}

      <form action={updateProfileAction} className="card space-y-4 p-5">
        <div>
          <label className="label">Nome completo</label>
          <input name="full_name" defaultValue={profile?.full_name ?? ""} required className="input" />
        </div>
        <div>
          <label className="label">Email</label>
          <input value={profile?.email ?? ""} disabled className="input bg-bone-100 text-ink-500" />
        </div>
        <div>
          <label className="label">Telemóvel</label>
          <input name="phone" defaultValue={profile?.phone ?? ""} className="input" />
        </div>
        <button type="submit" className="btn-primary w-full">Guardar</button>
      </form>

      <div className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Notificações</h2>
        <NotificationPrefToggle
          kind="session_reminder"
          initial={reminderOn}
          label="Lembretes de sessão"
          desc="Recebe um email e uma notificação na app antes de cada sessão."
        />
        <div className="border-t border-ink-900/5" />
        <NotificationPrefToggle
          kind="credit_alert"
          initial={creditAlertOn}
          label="Avisos de saldo e validade"
          desc="Avisa-te quando as tuas sessões estão a acabar ou um pack está a expirar."
        />
      </div>

      <div className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Dados e privacidade</h2>
        <a
          href="/api/me/export"
          className="flex items-center gap-3 rounded-lg border border-ink-900/10 p-3 hover:border-gold-400"
        >
          <Download size={18} className="shrink-0 text-ink-700" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Descarregar os meus dados</div>
            <div className="text-xs text-ink-500">Perfil, sessões, compras e notas (Excel).</div>
          </div>
        </a>
        <div className="border-t border-ink-900/5 pt-3">
          <DeleteAccountSection />
        </div>
      </div>
    </div>
  );
}
