import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { changePasswordAction, updateProfileAction } from "./actions";
import { NotificationPrefToggle } from "@/components/notification-pref-toggle";
import { DeleteAccountSection } from "@/components/delete-account-section";
import { ShieldCheck, User, Bell, NotebookPen, Plus, Sparkles, KeyRound } from "lucide-react";
import { NoteEditor } from "@/components/note-editor";
import { GeneralNoteEditor } from "@/components/general-note-editor";
import { listMyNotes } from "@/lib/notes";
import { formatDateTime } from "@/lib/utils";
import { listVerifiedFactors } from "@/lib/mfa";
import { EnrollCard } from "./seguranca/enroll-card";
import { unenrollAction } from "./seguranca/actions";

// "seguranca" foi absorvida pela tab "Perfil" — 2FA + mudança de
// palavra-passe + apagar conta estão agora no mesmo ecrã.
type TabId = "perfil" | "notas" | "notificacoes";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "perfil",       label: "Perfil",       icon: <User size={14} /> },
  { id: "notas",        label: "Notas",        icon: <NotebookPen size={14} /> },
  { id: "notificacoes", label: "Notificações", icon: <Bell size={14} /> },
];

export default async function PerfilPage(
  props: {
    searchParams: Promise<{ ok?: string; tab?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  const activeTab: TabId = ((): TabId => {
    const t = searchParams.tab;
    if (t === "notas" || t === "notificacoes") return t;
    return "perfil";
  })();

  const tabData = await loadTabData(activeTab, supabase, user.id);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Perfil</h1>
        <p className="text-sm text-ink-500">Os teus dados, notificações e segurança.</p>
      </div>

      {searchParams.ok && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Perfil atualizado.</div>
      )}

      <TabNav active={activeTab} />

      {activeTab === "perfil" && (
        <PerfilTab profile={tabData.profile} factors={tabData.factors ?? []} />
      )}
      {activeTab === "notas" && <NotasTab notes={tabData.notes ?? []} />}
      {activeTab === "notificacoes" && (
        <NotificacoesTab reminderOn={tabData.reminderOn} creditAlertOn={tabData.creditAlertOn} />
      )}
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
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const data: any = {};

  if (tab === "perfil") {
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).single();
    data.profile = profile;
    data.factors = await listVerifiedFactors().catch(() => []);
  }

  if (tab === "notas") {
    data.notes = await listMyNotes({ clientId: userId, limit: 100 });
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

function PerfilTab({ profile, factors }: { profile: any; factors: any[] }) {
  const hasFactor = factors.length > 0;
  return (
    <div className="space-y-4">
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

      <section>
        <h2 className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-ink-500">
          <ShieldCheck size={14} /> Verificação em dois passos
        </h2>
        {hasFactor ? (
          <div className="card space-y-3 p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
                <ShieldCheck size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">2FA está activa</div>
                <div className="text-xs text-ink-500">
                  Vais ter de meter um código do teu app de autenticação ao entrares
                  em dispositivos novos.
                </div>
              </div>
            </div>
            {factors.map((f: any) => (
              <form
                key={f.id}
                action={unenrollAction}
                className="space-y-2 rounded-lg border border-ink-900/10 bg-bone-50 px-3 py-2"
              >
                <input type="hidden" name="factorId" value={f.id} />
                <input type="hidden" name="returnTo" value="/app/perfil?tab=perfil" />
                <div className="text-xs">
                  <div className="font-semibold">{f.friendly_name || "Authenticator app"}</div>
                  <div className="text-ink-500">
                    Configurado em {new Date(f.created_at).toLocaleDateString("pt-PT")}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    name="code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    autoComplete="one-time-code"
                    className="input flex-1 text-center font-mono tracking-[0.3em]"
                    placeholder="Código 2FA"
                    aria-label="Código 2FA actual"
                  />
                  <button className="btn-outline shrink-0 text-xs text-red-700 hover:bg-red-50 border-red-200">
                    Desactivar
                  </button>
                </div>
              </form>
            ))}
          </div>
        ) : (
          <EnrollCard returnTo="/app/perfil?tab=perfil" />
        )}
      </section>

      <section>
        <h2 className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-ink-500">
          <KeyRound size={14} /> Mudar palavra-passe
        </h2>
        <form action={changePasswordAction} className="card space-y-4 p-5">
          <div>
            <label className="label">Nova palavra-passe</label>
            <input
              name="password"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
              className="input"
              placeholder="Mínimo 8 caracteres"
            />
          </div>
          <div>
            <label className="label">Confirmar nova palavra-passe</label>
            <input
              name="confirm"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
              className="input"
            />
          </div>
          <button type="submit" className="btn-primary w-full">Atualizar palavra-passe</button>
        </form>
      </section>

      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">Apagar conta</h2>
        <DeleteAccountSection />
      </div>
    </div>
  );
}

function NotasTab({ notes }: { notes: any[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-500">Diário das tuas sessões. Só tu lês.</p>
        <Link href="/app/notas/nova" className="btn-primary inline-flex shrink-0 items-center gap-1.5 text-xs">
          <Plus size={14} /> Adicionar nota
        </Link>
      </div>
      {notes.length === 0 ? (
        <div className="card p-5 text-center text-sm text-ink-500">
          Ainda não tens notas. Carrega em{" "}
          <Link href="/app/notas/nova" className="font-semibold text-gold-600">Adicionar nota</Link>{" "}
          para começar.
        </div>
      ) : (
        <ul className="space-y-3">
          {notes.map((n: any) => (
            <li key={n.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  {n.booking_id ? (
                    <>
                      <div className="text-sm font-semibold">
                        {n.bookings?.starts_at ? formatDateTime(n.bookings.starts_at) : "—"}
                      </div>
                      <div className="text-xs text-ink-500 capitalize">{n.bookings?.session_type ?? "sessão"}</div>
                    </>
                  ) : (
                    <>
                      <div className="inline-flex items-center gap-1.5 text-sm font-semibold">
                        <Sparkles size={12} className="text-gold-600" /> Nota geral
                      </div>
                      <div className="text-xs text-ink-500">{formatDateTime(n.created_at)}</div>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-3 border-t border-ink-900/5 pt-3">
                {n.booking_id ? (
                  <NoteEditor bookingId={n.booking_id} initialBody={n.body} compact />
                ) : (
                  <GeneralNoteEditor noteId={n.id} initialBody={n.body} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
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
