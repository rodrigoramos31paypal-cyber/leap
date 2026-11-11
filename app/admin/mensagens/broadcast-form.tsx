"use client";

import { useState } from "react";
import { sendBroadcast } from "./broadcast-actions";

const updateDraft = `Olá! Já podes acompanhar as tuas pesagens na app LEAP.

Vai a Perfil → A tua evolução para veres o teu histórico e comparares as pesagens ao longo do tempo. Se tiveres um relatório Starfit, podes carregar uma foto, confirmar os valores e guardar.

Se precisares de ajuda, responde aqui no chat.

João Pedro`;

export function BroadcastForm({ clients }: { clients: { id: string; full_name: string }[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [review, setReview] = useState(false);
  const [pending, setPending] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [feedback, setFeedback] = useState("");
  const [retry, setRetry] = useState(false);
  const [sent, setSent] = useState(0);

  async function send() {
    if (pending || !review || !selected.length) return;
    const id = requestId || crypto.randomUUID();
    setRequestId(id);
    setPending(true);
    try {
      const result = await sendBroadcast({ recipients: selected, body, requestId: id });
      if (result.error) {
        setFeedback(result.error);
        return;
      }
      const total = sent + (result.sent ?? 0);
      setSent(total);
      const failed = result.failed ?? [];
      setSelected(failed);
      setRetry(failed.length > 0);
      setFeedback(`Entregue em ${total} conversas.${failed.length ? ` Faltam ${failed.length} destinatários.` : ""}`);
      if (!failed.length) {
        setReview(false);
        setRequestId("");
        setBody("");
        setSent(0);
      }
    } catch {
      setRetry(true);
      setFeedback("Não foi possível confirmar o envio. Podes voltar a tentar com os mesmos destinatários.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="broadcast-body" className="font-semibold">Mensagem</label>
          {!review && (
            <button type="button" onClick={() => setBody(updateDraft)} className="text-sm font-semibold text-gold-700 dark:text-gold-300">
              Usar rascunho sobre pesagens
            </button>
          )}
        </div>
        <textarea id="broadcast-body" className="input w-full resize-y" rows={7} maxLength={2000}
          value={body} readOnly={review} onChange={event => setBody(event.target.value)} />
      </div>

      <fieldset className="card space-y-3 p-4" disabled={review}>
        <legend className="px-1 font-semibold">Destinatários ({selected.length})</legend>
        <button type="button" className="text-sm font-semibold text-gold-700 dark:text-gold-300"
          onClick={() => setSelected(selected.length === clients.length ? [] : clients.map(client => client.id))}>
          {selected.length === clients.length && clients.length ? "Limpar seleção" : "Selecionar todos"}
        </button>
        <div className="max-h-72 overflow-y-auto divide-y divide-ink-900/10 dark:divide-white/10">
          {clients.map(client => (
            <label key={client.id} className="flex min-h-10 items-center gap-3">
              <input type="checkbox" checked={selected.includes(client.id)} onChange={event => {
                const checked = event.target.checked;
                setSelected(current => checked ? [...current, client.id] : current.filter(id => id !== client.id));
              }} />
              {client.full_name}
            </label>
          ))}
        </div>
      </fieldset>

      {review ? (
        <div className="card space-y-3 p-4">
          <p>A mensagem será enviada separadamente para {selected.length} conversas privadas.</p>
          <div className="flex flex-wrap gap-2">
            {!retry && <button type="button" className="btn-outline" disabled={pending} onClick={() => setReview(false)}>Voltar a editar</button>}
            <button type="button" className="btn-primary" disabled={pending || !selected.length} onClick={send}>
              {pending ? "A enviar…" : retry ? "Tentar novamente" : "Confirmar envio"}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn-primary" disabled={!body.trim() || !selected.length}
          onClick={() => { setFeedback(""); setReview(true); }}>
          Rever envio
        </button>
      )}
      {feedback && <p role="status" className="text-sm">{feedback}</p>}
    </div>
  );
}
