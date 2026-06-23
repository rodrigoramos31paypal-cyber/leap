import { Smartphone } from "lucide-react";
import { CopyButton } from "@/components/copy-button";

// Cartão de subscrição do calendário pessoal (feed iCal por utilizador).
// Subscrição ÚNICA: o telemóvel sincroniza automaticamente todas as
// sessões futuras (e reagendamentos/cancelamentos), sem ter de adicionar
// sessão a sessão pelo .ics — esse fluxo nativo do iOS exige vários toques
// e a escolha de calendário a cada vez.
export function CalendarSubscribeCard({
  httpUrl,
  webcalUrl,
}: {
  httpUrl: string | null;
  webcalUrl: string | null;
}) {
  const disabled = !httpUrl || !webcalUrl;
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
              só leitura das tuas sessões.
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
