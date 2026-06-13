import { redirect } from "next/navigation";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { updateProfileAction } from "./actions";
import { BackLink } from "@/components/back-link";
import { NotificationPrefToggle } from "@/components/notification-pref-toggle";

export default async function PerfilPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = createClient();

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  const { data: notifPref } = await (supabase as any)
    .from("notification_preferences")
    .select("enabled")
    .eq("user_id", user.id)
    .eq("kind", "session_reminder")
    .maybeSingle();
  const reminderOn = (notifPref as any)?.enabled ?? true;

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
          initial={reminderOn}
          label="Lembretes de sessão"
          desc="Recebe um email e uma notificação na app antes de cada sessão."
        />
      </div>
    </div>
  );
}
