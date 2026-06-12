import { createClient } from "@/lib/supabase/server";
import { saveSettingsAction, saveTrainerBioAction, addAvailabilityAction, deleteAvailabilityAction, deleteBlockAction } from "./actions";
import { googleEnabled, microsoftEnabled } from "@/lib/calendar-sync";
import { getCurrentTrainer } from "@/lib/trainer";
import { CopyButton } from "@/components/copy-button";
import { Smartphone } from "lucide-react";

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default async function DefinicoesPage({
  searchParams,
}: {
  searchParams: { integration_ok?: string; integration_error?: string; integration_removed?: string };
}) {
  const supabase = createClient();
  // PERF: paralelizar trainer + user lookup
  const [trainer, { data: { user } }] = await Promise.all([
    getCurrentTrainer(),
    supabase.auth.getUser(),
  ]);
  if (!trainer) return <div className="card p-5 text-sm text-ink-500">Sem trainer configurado para este utilizador.</div>;

  const { data: integrations } = await supabase
    .from("calendar_integrations")
    .select("provider, account_email, created_at")
    .eq("user_id", user?.id ?? "");
  const googleConnected = integrations?.some((i) => i.provider === "google");
  const microsoftConnected = integrations?.some((i) => i.provider === "microsoft");

  // Per-user iCal feed token (subscrição no telemóvel).
  const { data: feedRow } = await supabase
    .from("profiles")
    .select("calendar_feed_token")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  const feedToken = (feedRow as any)?.calendar_feed_token as string | undefined;
  const appBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const feedHttpUrl = feedToken && appBase
    ? `${appBase}/api/calendar/feed/${feedToken}.ics`
    : null;
  const feedWebcalUrl = feedHttpUrl ? feedHttpUrl.replace(/^https?:\/\//, "webcal://") : null;

  const [
    { data: settings },
    { data: availability },
    { data: blocks },
  ] = await Promise.all([
    supabase.from("trainer_settings").select("*").eq("trainer_id", trainer.id).single(),
    supabase.from("trainer_availability").select("*").eq("trainer_id", trainer.id).order("day_of_week").order("start_time"),
    supabase.from("trainer_blocked_times").select("*").eq("trainer_id", trainer.id).order("starts_at"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Definições</h1>
        <p className="text-sm text-ink-500">Configura horários, durações, validades e regras.</p>
      </div>

      <form action={saveTrainerBioAction} className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Perfil público</h2>
        <p className="text-xs text-ink-500">
          O teu nome ({trainer.full_name || "—"}) e esta biografia aparecem ao cliente quando escolhe treinador.
        </p>
        <input type="hidden" name="trainerId" value={trainer.id} />
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

      <form action={saveSettingsAction} className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Regras de negócio</h2>
        <input type="hidden" name="trainerId" value={trainer.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Durações permitidas (min, separadas por vírgula)</label>
            <input name="slot_durations" defaultValue={(settings?.slot_durations_min ?? [45, 60, 90]).join(", ")} className="input" />
          </div>
          <div>
            <label className="label">Duração default (min)</label>
            <input name="default_duration" type="number" defaultValue={settings?.default_slot_duration_min ?? 45} className="input" />
          </div>
          <div>
            <label className="label">Janela cancelamento (horas)</label>
            <input name="cancellation_window" type="number" defaultValue={settings?.cancellation_window_hours ?? 12} className="input" />
          </div>
          <div>
            <label className="label">Aviso a partir de (sessões)</label>
            <input name="low_threshold" type="number" defaultValue={settings?.low_credits_threshold ?? 2} className="input" />
          </div>
          <div>
            <label className="label">Validade default packs (dias, vazio = sem validade)</label>
            <input name="validity_days" type="number" defaultValue={settings?.default_pack_validity_days ?? ""} className="input" />
          </div>
          <div>
            <label className="label">Buffer entre sessões (min)</label>
            <input name="buffer" type="number" defaultValue={settings?.buffer_between_sessions_min ?? 0} className="input" />
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="charge_late_cancel" defaultChecked={settings?.charge_late_cancel ?? true} />
            Descontar em cancelamento tardio
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="charge_no_show" defaultChecked={settings?.charge_no_show ?? true} />
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
                pendente até carregares em "Aceitar".
              </span>
            </span>
          </label>
        </div>
        <button className="btn-primary">Guardar</button>
      </form>

      <div className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Horários disponíveis</h2>
        <ul className="mt-3 space-y-2">
          {(availability ?? []).map((a) => (
            <li key={a.id} className="flex items-center justify-between border-b border-ink-900/5 pb-2 last:border-0">
              <div>
                <span className="font-medium">{DAYS[a.day_of_week]}</span>{" "}
                <span className="text-ink-500">{a.start_time.slice(0, 5)} – {a.end_time.slice(0, 5)}</span>
              </div>
              <form action={deleteAvailabilityAction}>
                <input type="hidden" name="id" value={a.id} />
                <button className="text-xs font-medium text-red-700 hover:underline">Eliminar</button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addAvailabilityAction} className="mt-4 grid gap-2 sm:grid-cols-4">
          <input type="hidden" name="trainerId" value={trainer.id} />
          <select name="day_of_week" className="input">
            {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
          <input name="start_time" type="time" required className="input" defaultValue="07:00" />
          <input name="end_time" type="time" required className="input" defaultValue="21:00" />
          <button className="btn-primary">Adicionar</button>
        </form>
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Sincronizar calendário</h2>
        <p className="mt-1 text-xs text-ink-500">
          Liga o teu Google Calendar e/ou Outlook. Sempre que um cliente marcar uma sessão, ela aparece no teu calendário.
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
          <PhoneCalendarRow
            httpUrl={feedHttpUrl}
            webcalUrl={feedWebcalUrl}
          />
        </div>
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Bloqueios / férias</h2>
        <p className="mt-1 text-xs text-ink-500">
          Para adicionar novos bloqueios, usa <a href="/admin/agenda" className="font-medium text-ink-900 underline hover:no-underline">Agenda → Marcar-me indisponível</a>. Aqui só removes os existentes.
        </p>
        <ul className="mt-3 space-y-2">
          {(blocks ?? []).length === 0 && <li className="text-sm text-ink-500">Sem bloqueios.</li>}
          {(blocks ?? []).map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 border-b border-ink-900/5 pb-2 text-sm last:border-0">
              <div className="min-w-0">
                <div className="tabular-nums">
                  {new Date(b.starts_at).toLocaleString("pt-PT", { hour12: false })} →{" "}
                  {new Date(b.ends_at).toLocaleString("pt-PT", { hour12: false })}
                </div>
                {b.reason && <div className="text-xs text-ink-500">{b.reason}</div>}
              </div>
              <form action={deleteBlockAction}>
                <input type="hidden" name="id" value={b.id} />
                <button className="text-xs font-medium text-red-700 hover:underline">Apagar</button>
              </form>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

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
          <button className="btn-outline border-red-200 text-red-700 hover:bg-red-50">Desligar</button>
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
  // Linha de subscrição iCal para o calendário do telemóvel.
  // Sem OAuth — basta o user adicionar o URL ao seu Calendário.
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
                <li>Abre <a href="https://calendar.google.com/calendar/r/settings/addbyurl" className="text-ink-900 underline dark:text-bone-50" target="_blank" rel="noopener noreferrer">calendar.google.com → Adicionar por URL</a> no telemóvel ou PC.</li>
                <li>Cola o URL acima → Adicionar calendário.</li>
                <li>O Google Calendar do telemóvel sincroniza-o ao fim de alguns minutos.</li>
              </ol>
            </div>

            <p className="text-[11px] text-ink-500">
              O telemóvel atualiza o feed periodicamente (≈ a cada hora). Não dá acesso à app — só leitura dos eventos.
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
