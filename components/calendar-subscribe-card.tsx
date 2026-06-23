import { Smartphone, CheckCircle2, AlertTriangle } from "lucide-react";
import { CopyButton } from "@/components/copy-button";

// Janela (dias) durante a qual consideramos a subscrição "ativa". Os
// clientes de calendário vão buscar o feed várias vezes por dia (iOS
// ~de hora a hora). Se passarem 7 dias sem nenhum fetch, algo parou
// (subscrição removida, sem rede, etc.) -> avisamos o cliente.
const ACTIVE_WINDOW_DAYS = 7;

function relTime(from: Date, now: Date) {
  const s = Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000));
  if (s < 60) return "há segundos";
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} minuto${m === 1 ? "" : "s"}`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} hora${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `há ${d} dia${d === 1 ? "" : "s"}`;
}

// Cartão de subscrição do calendário pessoal (feed iCal por utilizador).
// Subscrição ÚNICA: o telemóvel sincroniza automaticamente todas as
// sessões futuras (e reagendamentos/cancelamentos).
//
// Estado: inferido do último fetch do feed pelo dispositivo
// (calendar_feed_last_fetched_at). Mostra ao cliente se está subscrito e
// quando sincronizou pela última vez.
export function CalendarSubscribeCard({
  httpUrl,
  webcalUrl,
  lastFetchedAt,
}: {
  httpUrl: string | null;
  webcalUrl: string | null;
  lastFetchedAt: string | null;
}) {
  const disabled = !httpUrl || !webcalUrl;
  const now = new Date();
  const fetched = lastFetchedAt ? new Date(lastFetchedAt) : null;
  const ageDays = fetched ? (now.getTime() - fetched.getTime()) / 86_400_000 : Infinity;
  const status: "none" | "active" | "stale" = !fetched
    ? "none"
    : ageDays <= ACTIVE_WINDOW_DAYS
      ? "active"
      : "stale";

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <Smartphone size={14} className="text-ink-500" />
            Sincronizar com o calendário do telemóvel
          </div>
          <div className="mt-0.5 text-xs text-ink-500">
            {disabled
              ? "Indisponível de momento. Tenta mais tarde."
              : "Subscreve uma vez e as tuas sessões aparecem sozinhas no calendário — sem teres de as adicionar uma a uma."}
          </div>
        </div>
        {webcalUrl && (
          <a
            href={webcalUrl}
            className={(status === "active" ? "btn-outline" : "btn-primary") + " shrink-0"}
          >
            {status === "none" ? "Subscrever" : "Voltar a subscrever"}
          </a>
        )}
      </div>

      {!disabled && status === "active" && fetched && (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          <CheckCircle2 size={14} className="shrink-0" />
          <span>Subscrito e a sincronizar — última sincronização {relTime(fetched, now)}.</span>
        </div>
      )}
      {!disabled && status === "stale" && fetched && (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          <AlertTriangle size={14} className="shrink-0" />
          <span>
            A última sincronização foi {relTime(fetched, now)}. Pode ter parado — toca em
            &quot;Voltar a subscrever&quot;.
          </span>
        </div>
      )}
      {!disabled && status === "none" && (
        <div className="mt-3 rounded-md bg-bone-100 px-3 py-2 text-xs text-ink-500 dark:bg-white/[0.04]">
          Ainda não subscrito neste dispositivo. Depois de subscreveres, a sincronização começa
          em segundos e atualiza-se sozinha (≈ a cada hora).
        </div>
      )}

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
              só leitura das tuas sessões.
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
