import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { updateProfileAction } from "./actions";
import { BackLink } from "@/components/back-link";
import { NotificationPrefToggle } from "@/components/notification-pref-toggle";
import { DeleteAccountSection } from "@/components/delete-account-section";
import { Download, ShieldCheck, ChevronRight, User, Bell, Database } from "lucide-react";

type TabId = "perfil" | "notificacoes" | "seguranca" | "dados";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "perfil",       label: "Perfil",       icon: <User size={14} /> },
  { id: "notificacoes", label: "Notificações", icon: <Bell size={14} /> },
  { id: "seguranca",    label: "Segurança",    icon: <ShieldCheck size={14} /> },
  { id: "dados",        label: "Dados",        icon: <Database size={14} /> },
];

export default async function PerfilPage({
  searchParams,
}: {
  searchParams: { ok?: string; tab?: string };
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = createClient();

  const activeTab: TabId = ((): TabId => {
    const t = searchParams.tab;
    if (t === "notificacoes" || t === "seguranca" || t === "dados") return t;
    return "perfil";
  })();

  const tabData = await loadTabData(activeTab, supabase, user.id);

  return (
    <div className="space-y-5">
      <BackLink />
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Perfil</h1>
        <p className="text-sm text-ink-500">Os teus dados, notificações, segurança e privacidade.</p>
      </div>

      {searchParams.ok && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Perfil atualizado.</div>
      )}

      <TabNav active={activeTab} />

      {activeTab === "perfil" && <PerfilTab profile={tabData.profile} />}
      {activeTab === "notificacoes" && (
        <NotificacoesTab reminderOn={tabData.reminderOn} creditAlertOn={tabData.creditAlertOn} />
      )}
      {activeTab === "seguranca" && <SegurancaTab />}
      {activeTab === "dados" && <DadosTab />}
    </div>
  );
}

function TabNav({ active }: { active: TabId }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-ink-900/10 pb-px">
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <Link
            key={t.id}
            href={`/app/perfil?tab=${t.id}`}
            className={
              "inline-flex shrink-0 items-center gap-1.5 -mb-px border-b-2 px-3 py-2 text-sm font-medium transition " +
              (isActive
                ? "border-ink-900 text-ink-900 dark:border-bone-50 dark:text-bone-50"
                : "border-transparent text-ink-500 hover:text-ink-700")
            }
          >
            <span className="text-ink-500">{t.icon}</span>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

async function loadTabData(
  tab: TabId,
  supabase: ReturnType<typeof createClient>,
  userId: string,
) {
  const data: any = {};

  if (tab === "perfil") {
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).single();
    data.profile = profile;
  }

  if (tab === "notificacoes") {
    const { data: prefsRows } = await (supabase as any)
      .from("notification_preferences")
      .select("kind, enabled")
      .eq("user_id", userId);
    const prefMap = new Map<string, boolean>(
      ((prefsRows ?? []) as any[]).map(
        (r) => [String(r.kind), r.enabled !== false] as [string, boolean],
      ),
    );
    data.reminderOn = prefMap.get("session_reminder") ?? true;
    data.creditAlertOn = prefMap.get("credit_alert") ?? true;
  }

  return data;
}

function PerfilTab({ profile }: { profile: any }) {
  return (
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
  );
}

function NotificacoesTab({
  reminderOn,
  creditAlertOn,
}: {
  reminderOn: boolean;
  creditAlertOn: boolean;
}) {
  return (
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
  );
}

function SegurancaTab() {
  return (
    <Link
      href="/app/perfil/seguranca"
      className="card flex items-center justify-between p-4 hover:border-gold-400"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-bone-100 text-ink-700">
          <ShieldCheck size={18} />
        </span>
        <div>
          <div className="text-sm font-semibold">Segurança</div>
          <div className="text-xs text-ink-500">Verificação em dois passos e dispositivos.</div>
        </div>
      </div>
      <ChevronRight size={16} className="text-ink-500" />
    </Link>
  );
}

function DadosTab() {
  return (
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
  );
}
