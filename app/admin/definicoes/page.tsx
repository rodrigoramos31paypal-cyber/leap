import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import {
  saveSettingsAction,
  saveTrainerBioAction,
  deleteBlockAction,
  changeStaffPasswordAction,
} from "./actions";
import { googleEnabled, microsoftEnabled } from "@/lib/calendar-sync";
import { getCurrentTrainer } from "@/lib/trainer";
import { CopyButton } from "@/components/copy-button";
import { AvatarUploader } from "@/components/avatar-uploader";
import { WeeklyScheduleEditor } from "@/components/weekly-schedule-editor";
import { EquipaSection } from "@/app/admin/equipa/equipa-section";
import { NotificationCategoryPrefs, type CategoryPrefs } from "@/components/notification-category-prefs";
import { TRAINER_CATEGORIES } from "@/lib/notifications-config";
import {
  Smartphone,
  ShieldCheck,
  ChevronRight,
  User,
  SlidersHorizontal,
  Clock,
  Calendar as CalendarIcon,
  UserCog,
  Bell,
  Images,
  ScrollText,
} from "lucide-react";
import Link from "next/link";
import { ForceUpdateButton } from "@/components/force-update-button";
import { AuditControls } from "./audit-filter";
import { AUDIT_ACTIONS } from "./audit-log-labels";
import { AuditTable, type AuditRow } from "./audit-table";

type TabId = "perfil" | "notificacoes" | "slideshow" | "regras" | "horarios" | "calendario" | "seguranca" | "registo" | "equipa";

const TABS: { id: TabId; label: string; icon: React.ReactNode; ownerOnly?: boolean }[] = [
  { id: "perfil",     label: "Perfil",     icon: <User size={14} /> },
  { id: "notificacoes", label: "Notificações", icon: <Bell size={14} /> },
  { id: "slideshow",  label: "Slideshow",  icon: <Images size={14} /> },
  { id: "regras",     label: "Regras",     icon: <SlidersHorizontal size={14} /> },
  { id: "horarios",   label: "Horários",   icon: <Clock size={14} /> },
  { id: "calendario", label: "Calendário", icon: <CalendarIcon size={14} /> },
  { id: "seguranca",  label: "Segurança",  icon: <ShieldCheck size={14} /> },
  { id: "registo",    label: "Registo de atividade", icon: <ScrollText size={14} /> },
  { id: "equipa",     label: "Equipa",     icon: <UserCog size={14} />, ownerOnly: true },
];

export default async function DefinicoesPage(
  props: {
    searchParams: Promise<{
      tab?: string;
      integration_ok?: string;
      integration_error?: string;
      integration_removed?: string;
      action?: string;
      page?: string;
      q?: string;
      client?: string;
    }>;
  }
) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const [trainer, { data: { user } }, profile] = await Promise.all([
    getCurrentTrainer(),
    supabase.auth.getUser(),
    getCurrentProfile(),
  ]);
  const isOwner = profile?.role === "owner";
  if (!trainer) {
    return (
      <div className="card p-5 text-sm text-ink-500">
        Sem trainer configurado para este utilizador.
      </div>
    );
  }

  // Tab activo (default perfil).
  const activeTab: TabId = ((): TabId => {
    const t = searchParams.tab;
    if (
      t === "notificacoes" ||
      t === "slideshow" ||
      t === "regras" ||
      t === "horarios" ||
      t === "calendario" ||
      t === "seguranca" ||
      t === "registo"
    )
      return t;
    if (t === "equipa" && isOwner) return "equipa";
    return "perfil";
  })();

  // PERF: só carrega os dados necessários para a aba activa. Antes carregava
  // tudo independentemente do que estava visível — agora só pagamos o que
  // mostramos.
  const tabData = await loadTabData(activeTab, supabase, trainer, user?.id, searchParams);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Definições</h1>
        <p className="text-sm text-ink-500">
          Configura o teu perfil público, regras de negócio, horários e mais.
        </p>
      </div>

      <TabNav active={activeTab} isOwner={isOwner} />

      {activeTab === "perfil" && <PerfilTab trainer={trainer} />}
      {activeTab === "notificacoes" && (
        <NotificacoesTab prefs={tabData.notifPrefs ?? {}} />
      )}
      {activeTab === "slideshow" && <SlideshowTab />}
      {activeTab === "regras" && (
        <RegrasTab trainerId={trainer.id} settings={tabData.settings} />
      )}
      {activeTab === "horarios" && (
        <HorariosTab
          trainerId={trainer.id}
          availability={tabData.availability}
          blocks={tabData.blocks}
        />
      )}
      {activeTab === "calendario" && (
        <CalendarioTab
          googleConnected={tabData.googleConnected}
          microsoftConnected={tabData.microsoftConnected}
          feedHttpUrl={tabData.feedHttpUrl}
          feedWebcalUrl={tabData.feedWebcalUrl}
          searchParams={searchParams}
        />
      )}
      {activeTab === "seguranca" && <SegurancaTab />}
      {activeTab === "registo" && (
        <RegistoTab
          rows={tabData.auditRows ?? []}
          total={tabData.auditTotal ?? 0}
          page={tabData.auditPage ?? 1}
          pageSize={tabData.auditPageSize ?? 10}
          action={tabData.auditAction ?? ""}
          search={tabData.auditSearch ?? ""}
          clientId={tabData.auditClientId ?? ""}
          clientName={tabData.auditClientName ?? ""}
        />
      )}
      {activeTab === "equipa" && isOwner && <EquipaSection />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Tab navigation (server component).
// ════════════════════════════════════════════════════════════════
function TabNav({ active, isOwner }: { active: TabId; isOwner: boolean }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-ink-900/10 pb-px">
      {TABS.filter((t) => isOwner || !t.ownerOnly).map((t) => {
        const isActive = t.id === active;
        return (
          <Link
            key={t.id}
            href={`/admin/definicoes?tab=${t.id}`}
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

// ════════════════════════════════════════════════════════════════
// Data loading por aba. Só puxa as queries necessárias.
// ════════════════════════════════════════════════════════════════
async function loadTabData(
  tab: TabId,
  supabase: Awaited<ReturnType<typeof createClient>>,
  trainer: NonNullable<Awaited<ReturnType<typeof getCurrentTrainer>>>,
  userId: string | undefined,
  searchParams: { action?: string; page?: string; q?: string; client?: string },
) {
  const data: any = {};

  if (tab === "registo") {
    const pageSize = 10;
    // Página 1-based no URL; offset 0-based na RPC.
    const pageNum = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
    // Só aceita ações conhecidas como filtro (evita queries com lixo).
    const rawAction = String(searchParams.action ?? "");
    const action = rawAction && rawAction in AUDIT_ACTIONS ? rawAction : "";
    // Pesquisa por cliente (nome/email/telefone). Limita o tamanho.
    const search = String(searchParams.q ?? "").trim().slice(0, 120);
    // Filtro exato por cliente escolhido no typeahead (só uuid válido).
    const rawClient = String(searchParams.client ?? "");
    const clientId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawClient)
      ? rawClient
      : "";

    // Nome do cliente escolhido, para pré-preencher a caixa de pesquisa.
    let clientName = "";
    if (clientId) {
      const { data: cp } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", clientId)
        .maybeSingle();
      clientName = ((cp as any)?.full_name as string | undefined) ?? "";
    }

    const { data: rows, error } = await (supabase as any).rpc("audit_log_page", {
      p_action: action || undefined,
      p_search: clientId ? undefined : search || undefined,
      p_client_id: clientId || undefined,
      p_limit: pageSize,
      p_offset: (pageNum - 1) * pageSize,
    });
    if (error) {
      // Falha a carregar não deve rebentar a página inteira das Definições.
      data.auditRows = [];
      data.auditTotal = 0;
    } else {
      const list = (rows ?? []) as any[];
      data.auditRows = list;
      data.auditTotal = list.length > 0 ? Number(list[0].total_count ?? 0) : 0;
    }
    data.auditPage = pageNum;
    data.auditPageSize = pageSize;
    data.auditAction = action;
    data.auditSearch = search;
    data.auditClientId = clientId;
    data.auditClientName = clientName;
    return data;
  }

  if (tab === "notificacoes") {
    const { data: prefsRows } = await (supabase as any)
      .from("notification_preferences")
      .select("kind, email_enabled, push_enabled")
      .eq("user_id", userId ?? "");
    const map: CategoryPrefs = {};
    for (const r of (prefsRows ?? []) as any[]) {
      map[String(r.kind)] = {
        email: r.email_enabled !== false,
        push: r.push_enabled !== false,
      };
    }
    data.notifPrefs = map;
  }

  if (tab === "regras") {
    const { data: settings } = await supabase
      .from("trainer_settings")
      .select("*")
      .eq("trainer_id", trainer.id)
      .single();
    data.settings = settings;
  }

  if (tab === "horarios") {
    const [{ data: availability }, { data: blocks }] = await Promise.all([
      supabase
        .from("trainer_availability")
        .select("*")
        .eq("trainer_id", trainer.id)
        .order("day_of_week")
        .order("start_time"),
      supabase
        .from("trainer_blocked_times")
        .select("*")
        .eq("trainer_id", trainer.id)
        .order("starts_at"),
    ]);
    data.availability = availability ?? [];
    data.blocks = blocks ?? [];
  }

  if (tab === "calendario") {
    const { data: integrations } = await supabase
      .from("calendar_integrations")
      .select("provider, account_email, created_at")
      .eq("user_id", userId ?? "");
    data.googleConnected = integrations?.some((i: any) => i.provider === "google") ?? false;
    data.microsoftConnected = integrations?.some((i: any) => i.provider === "microsoft") ?? false;

    const { data: feedRow } = await supabase
      .from("profiles")
      .select("calendar_feed_token")
      .eq("id", userId ?? "")
      .maybeSingle();
    const feedToken = (feedRow as any)?.calendar_feed_token as string | undefined;
    const appBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    data.feedHttpUrl = feedToken && appBase
      ? `${appBase}/api/calendar/feed/${feedToken}.ics`
      : null;
    data.feedWebcalUrl = data.feedHttpUrl
      ? (data.feedHttpUrl as string).replace(/^https?:\/\//, "webcal://")
      : null;
  }

  return data;
}

// ════════════════════════════════════════════════════════════════
// Tabs
// ════════════════════════════════════════════════════════════════
function NotificacoesTab({ prefs }: { prefs: CategoryPrefs }) {
  return (
    <div className="card space-y-4 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Notificações</h2>
      <p className="text-xs text-ink-500">
        Escolhe como queres ser avisado em cada tipo. Ativa o push no cartão do dashboard.
      </p>
      <NotificationCategoryPrefs categories={TRAINER_CATEGORIES} initial={prefs} />
    </div>
  );
}

function SlideshowTab() {
  return (
    <Link
      href="/admin/promocoes"
      className="card flex items-center justify-between p-4 hover:border-gold-400"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-bone-100 text-ink-700 dark:bg-white/[0.04] dark:text-bone-100">
          <Images size={18} />
        </span>
        <div>
          <div className="text-sm font-semibold">Slideshow / Promoções</div>
          <div className="text-xs text-ink-500">
            Gere os banners que aparecem no início da app dos clientes.
          </div>
        </div>
      </div>
      <ChevronRight size={16} className="text-ink-500" />
    </Link>
  );
}

function PerfilTab({
  trainer,
}: {
  trainer: NonNullable<Awaited<ReturnType<typeof getCurrentTrainer>>>;
}) {
  // Links partilháveis com o teu slug — o cliente que clicar fica logo
  // associado a ti. Base URL vem de NEXT_PUBLIC_APP_URL.
  const appBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const publicUrl = `${appBase}/t/${trainer.slug}`;

  return (
    <div className="space-y-5">
      <form action={saveTrainerBioAction} className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Perfil público
        </h2>
        <p className="text-xs text-ink-500">
          O teu nome e biografia aparecem ao cliente quando escolhe trainer.
        </p>
        <input type="hidden" name="trainerId" value={trainer.id} />
        <div>
          <label className="label">Nome completo</label>
          <input
            name="full_name"
            type="text"
            maxLength={120}
            defaultValue={trainer.full_name ?? ""}
            className="input"
            placeholder="Ex: João Pedro Silva"
            required
          />
        </div>
        <div>
          <label className="label">Biografia (máx. 500 caracteres)</label>
          <textarea
            name="bio"
            rows={3}
            maxLength={500}
            defaultValue={trainer.bio ?? ""}
            className="input"
            placeholder="Ex: Personal Trainer especializado em força e mobilidade. 10 anos de experiência."
          />
        </div>
        <button className="btn-primary">Guardar perfil</button>
      </form>

      <div className="card space-y-3 p-5">
        <AvatarUploader
          trainerId={trainer.id}
          currentUrl={(trainer as any).avatar_url ?? null}
          fullName={trainer.full_name || "Trainer"}
        />
      </div>

      {trainer.slug ? (
        <div className="card space-y-2 p-5">
          <label className="label">Página pública</label>
          <p className="mb-1.5 text-xs text-ink-500">
            Bio, rating e reviews. Partilha por WhatsApp ou Instagram.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              readOnly
              defaultValue={publicUrl}
              className="input flex-1 font-mono text-xs"
            />
            <CopyButton value={publicUrl} label="Copiar" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RegrasTab({
  trainerId,
  settings,
}: {
  trainerId: string;
  settings: any;
}) {
  return (
    <form action={saveSettingsAction} className="card space-y-4 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
        Regras de negócio
      </h2>
      <input type="hidden" name="trainerId" value={trainerId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Durações permitidas (min, separadas por vírgula)</label>
          <input
            name="slot_durations"
            defaultValue={(settings?.slot_durations_min ?? [45, 60, 90]).join(", ")}
            className="input"
          />
        </div>
        <div>
          <label className="label">Duração default (min)</label>
          <input
            name="default_duration"
            type="number"
            defaultValue={settings?.default_slot_duration_min ?? 45}
            className="input"
          />
        </div>
        <div>
          <label className="label">Janela cancelamento (horas)</label>
          <input
            name="cancellation_window"
            type="number"
            defaultValue={settings?.cancellation_window_hours ?? 12}
            className="input"
          />
        </div>
        <div>
          <label className="label">Antecedência mínima de marcação (horas)</label>
          <input
            name="min_booking_notice"
            type="number"
            min={0}
            defaultValue={settings?.min_booking_notice_hours ?? 12}
            className="input"
          />
        </div>
        <div>
          <label className="label">Aviso a partir de (sessões)</label>
          <input
            name="low_threshold"
            type="number"
            defaultValue={settings?.low_credits_threshold ?? 2}
            className="input"
          />
        </div>
        <div>
          <label className="label">Validade default packs (dias, vazio = sem validade)</label>
          <input
            name="validity_days"
            type="number"
            defaultValue={settings?.default_pack_validity_days ?? ""}
            className="input"
          />
        </div>
        <div>
          <label className="label">Buffer entre sessões (min)</label>
          <input
            name="buffer"
            type="number"
            defaultValue={settings?.buffer_between_sessions_min ?? 0}
            className="input"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="charge_late_cancel"
            defaultChecked={settings?.charge_late_cancel ?? true}
          />
          Descontar em cancelamento tardio
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="charge_no_show"
            defaultChecked={settings?.charge_no_show ?? true}
          />
          Descontar em falta
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="auto_confirm_bookings"
            defaultChecked={settings?.auto_confirm_bookings ?? true}
            className="mt-0.5"
          />
          <span>
            <span className="font-semibold">Confirmar marcações automaticamente</span>
            <span className="block text-xs text-ink-500">
              Quando ligado, qualquer marcação do cliente fica logo confirmada. Desligado, fica
              pendente até carregares em &quot;Aceitar&quot;.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="show_cancelled_in_calendar"
            defaultChecked={(settings as any)?.show_cancelled_in_calendar ?? false}
            className="mt-0.5"
          />
          <span>
            <span className="font-semibold">Mostrar sessões canceladas na agenda</span>
            <span className="block text-xs text-ink-500">
              Desligado (default), as sessões canceladas não aparecem no calendário.
            </span>
          </span>
        </label>
      </div>
      <button className="btn-primary">Guardar</button>
    </form>
  );
}

function HorariosTab({
  trainerId,
  availability,
  blocks,
}: {
  trainerId: string;
  availability: any[];
  blocks: any[];
}) {
  return (
    <div className="space-y-5">
      <div className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Horários disponíveis
        </h2>
        <p className="mt-1 text-xs text-ink-500">
          Define os intervalos em que aceitas marcações. Podes ter mais do que um
          intervalo por dia (ex.: manhã e tarde). As alterações são guardadas
          automaticamente.
        </p>
        <WeeklyScheduleEditor trainerId={trainerId} initial={availability} />
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Bloqueios / férias
        </h2>
        <p className="mt-1 text-xs text-ink-500">
          Para adicionar novos bloqueios, usa{" "}
          <a
            href="/admin/agenda"
            className="font-medium text-ink-900 underline hover:no-underline"
          >
            Agenda → Marcar-me indisponível
          </a>. Aqui só removes os existentes.
        </p>
        <ul className="mt-3 space-y-2">
          {blocks.length === 0 && <li className="text-sm text-ink-500">Sem bloqueios.</li>}
          {blocks.map((b: any) => (
            <li
              key={b.id}
              className="flex items-center justify-between gap-3 border-b border-ink-900/5 pb-2 text-sm last:border-0"
            >
              <div className="min-w-0">
                <div className="tabular-nums">
                  {new Date(b.starts_at).toLocaleString("pt-PT", { hour12: false })} →{" "}
                  {new Date(b.ends_at).toLocaleString("pt-PT", { hour12: false })}
                </div>
                {b.reason && <div className="text-xs text-ink-500">{b.reason}</div>}
              </div>
              <form action={deleteBlockAction}>
                <input type="hidden" name="id" value={b.id} />
                <button className="text-xs font-medium text-red-700 hover:underline">
                  Apagar
                </button>
              </form>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CalendarioTab({
  googleConnected,
  microsoftConnected,
  feedHttpUrl,
  feedWebcalUrl,
  searchParams,
}: {
  googleConnected: boolean;
  microsoftConnected: boolean;
  feedHttpUrl: string | null;
  feedWebcalUrl: string | null;
  searchParams: { integration_ok?: string; integration_error?: string; integration_removed?: string };
}) {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
        Sincronizar calendário
      </h2>
      <p className="mt-1 text-xs text-ink-500">
        Liga o teu Google Calendar e/ou Outlook. Sempre que um cliente marcar uma sessão, ela
        aparece no teu calendário.
      </p>

      {searchParams.integration_ok && (
        <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Calendário ligado com sucesso.
        </div>
      )}
      {searchParams.integration_removed && (
        <div className="mt-3 rounded-md bg-bone-100 px-3 py-2 text-sm text-ink-700">
          Calendário desligado.
        </div>
      )}
      {searchParams.integration_error && (
        <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Erro: {decodeURIComponent(searchParams.integration_error)}
        </div>
      )}

      <div className="mt-4 space-y-3">
        <IntegrationRow
          name="Google Calendar"
          connected={!!googleConnected}
          enabled={googleEnabled()}
          connectHref="/api/integrations/google/connect"
          disconnectAction="/api/integrations/google/disconnect"
        />
        <IntegrationRow
          name="Outlook / Microsoft 365"
          connected={!!microsoftConnected}
          enabled={microsoftEnabled()}
          connectHref="/api/integrations/microsoft/connect"
          disconnectAction="/api/integrations/microsoft/disconnect"
        />
        <PhoneCalendarRow httpUrl={feedHttpUrl} webcalUrl={feedWebcalUrl} />
      </div>
    </div>
  );
}

function SegurancaTab() {
  return (
    <div className="space-y-5">
      <Link
        href="/admin/seguranca"
        className="card flex items-center justify-between p-4 hover:border-gold-400"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-bone-100 text-ink-700 dark:bg-white/[0.04] dark:text-bone-100">
            <ShieldCheck size={18} />
          </span>
          <div>
            <div className="text-sm font-semibold">Verificação em dois passos (2FA)</div>
            <div className="text-xs text-ink-500">
              Activa o 2FA e gere os dispositivos onde dispensaste o código.
            </div>
          </div>
        </div>
        <ChevronRight size={16} className="text-ink-500" />
      </Link>

      <form action={changeStaffPasswordAction} className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Palavra-passe
        </h2>
        <p className="text-xs text-ink-500">
          Define uma nova palavra-passe. Mínimo de 8 caracteres.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="staff-password">Nova palavra-passe</label>
            <input
              id="staff-password"
              type="password"
              name="password"
              minLength={8}
              autoComplete="new-password"
              required
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="staff-password-confirm">Confirmar</label>
            <input
              id="staff-password-confirm"
              type="password"
              name="confirm"
              minLength={8}
              autoComplete="new-password"
              required
              className="input"
            />
          </div>
        </div>
        <button className="btn-primary">Actualizar palavra-passe</button>
      </form>

      <div className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Atualização da app
        </h2>
        <p className="text-xs text-ink-500">
          Força todos os dispositivos (clientes e equipa) com a app aberta a
          recarregar para a versão mais recente. Útil após um lançamento
          importante ou para recuperar de um problema. As apps abertas atualizam
          em segundos; as fechadas já abrem na versão nova.
        </p>
        <ForceUpdateButton />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Registo de atividade (audit log). Lista cronológica (mais recentes
// primeiro), 10 por página, filtrável por ação e pesquisável por cliente.
// A tabela/cartões e o modal de detalhe vivem em audit-table.tsx (client).
// ════════════════════════════════════════════════════════════════
function RegistoTab({
  rows,
  total,
  page,
  pageSize,
  action,
  search,
  clientId,
  clientName,
}: {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  action: string;
  search: string;
  clientId: string;
  clientName: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    params.set("tab", "registo");
    if (action) params.set("action", action);
    if (clientId) params.set("client", clientId);
    else if (search) params.set("q", search);
    if (p > 1) params.set("page", String(p));
    return `/admin/definicoes?${params.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Registo de atividade
        </h2>
        <p className="text-xs text-ink-500">
          Todas as ações sensíveis de admins ou clientes ficam aqui registadas.
        </p>
        <div className="pt-1">
          <AuditControls
            action={action}
            search={search}
            clientId={clientId}
            clientName={clientName}
          />
        </div>
      </div>

      <AuditTable rows={rows} />

      {/* Paginação */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-ink-500">
          {total === 0 ? "0 registos" : `${from}–${to} de ${total}`}
        </span>
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="btn-outline">
              Anterior
            </Link>
          ) : (
            <span className="btn-outline pointer-events-none opacity-40">Anterior</span>
          )}
          <span className="text-xs text-ink-500 tabular-nums">
            Página {page} de {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={pageHref(page + 1)} className="btn-outline">
              Seguinte
            </Link>
          ) : (
            <span className="btn-outline pointer-events-none opacity-40">Seguinte</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Helpers (re-uso dos componentes que já estavam neste ficheiro).
// ════════════════════════════════════════════════════════════════
function IntegrationRow({
  name,
  connected,
  enabled,
  connectHref,
  disconnectAction,
}: {
  name: string;
  connected: boolean;
  enabled: boolean;
  connectHref: string;
  disconnectAction: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-ink-900/5 pb-3 last:border-0">
      <div>
        <div className="text-sm font-medium">{name}</div>
        <div className="text-xs text-ink-500">
          {!enabled
            ? "OAuth ainda não configurado (ver .env.local)."
            : connected
              ? "Ligado · sessões aparecem automaticamente."
              : "Não ligado."}
        </div>
      </div>
      {!enabled ? (
        <span className="chip-mute text-xs">Indisponível</span>
      ) : connected ? (
        <form action={disconnectAction} method="post">
          <button className="btn-outline border-red-200 text-red-700 hover:bg-red-50">
            Desligar
          </button>
        </form>
      ) : (
        <a href={connectHref} className="btn-primary">Ligar</a>
      )}
    </div>
  );
}

function PhoneCalendarRow({
  httpUrl,
  webcalUrl,
}: {
  httpUrl: string | null;
  webcalUrl: string | null;
}) {
  const disabled = !httpUrl || !webcalUrl;
  return (
    <div className="border-b border-ink-900/5 pb-3 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <Smartphone size={14} className="text-ink-500" />
            Calendário do telemóvel (iPhone / Android)
          </div>
          <div className="text-xs text-ink-500">
            {disabled
              ? "Indisponível: definir NEXT_PUBLIC_APP_URL no .env."
              : "Subscreve esta URL no telemóvel para receber as sessões automaticamente."}
          </div>
        </div>
        {webcalUrl && (
          <a href={webcalUrl} className="btn-primary shrink-0">
            Subscrever
          </a>
        )}
      </div>

      {httpUrl && (
        <details className="mt-3 rounded-md border border-ink-900/10 bg-bone-50 p-3 text-xs dark:border-white/10 dark:bg-white/[0.02]">
          <summary className="cursor-pointer font-medium text-ink-700 dark:text-bone-100">
            Como subscrever passo a passo
          </summary>

          <div className="mt-3 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1.5 text-[11px] text-ink-700 dark:bg-ink-900 dark:text-bone-100">
                {httpUrl}
              </code>
              <CopyButton value={httpUrl} label="Copiar URL" />
            </div>

            <div>
              <div className="font-semibold text-ink-700 dark:text-bone-100">iPhone</div>
              <ol className="ml-4 list-decimal space-y-0.5 text-ink-500 dark:text-bone-100/70">
                <li>Toca em <strong>Subscrever</strong> em cima (abre o app Calendário automaticamente), OU</li>
                <li>Definições → Calendário → Contas → Adicionar conta → Outro → Adicionar Calendário Subscrito → cola o URL acima.</li>
              </ol>
            </div>

            <div>
              <div className="font-semibold text-ink-700 dark:text-bone-100">Android</div>
              <ol className="ml-4 list-decimal space-y-0.5 text-ink-500 dark:text-bone-100/70">
                <li>
                  Abre{" "}
                  <a
                    href="https://calendar.google.com/calendar/r/settings/addbyurl"
                    className="text-ink-900 underline dark:text-bone-50"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    calendar.google.com → Adicionar por URL
                  </a>{" "}
                  no telemóvel ou PC.
                </li>
                <li>Cola o URL acima → Adicionar calendário.</li>
                <li>O Google Calendar do telemóvel sincroniza-o ao fim de alguns minutos.</li>
              </ol>
            </div>

            <p className="text-[11px] text-ink-500">
              O telemóvel atualiza o feed periodicamente (≈ a cada hora). Não dá acesso à app —
              só leitura dos eventos.
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
