"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markChatRead, sendChatMessage } from "@/app/app/mensagens/actions";
import type { ChatMessage } from "@/lib/chat";
import { formatDateTime } from "@/lib/utils";

export function ChatPanel({ messages, userId, clientId, booking, latest }: {
  messages: ChatMessage[];
  userId: string;
  clientId?: string;
  booking?: { id: string; starts_at: string } | null;
  latest: boolean;
}) {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const unreadIds = messages.filter(m => m.sender_id !== userId && !m.read_at).map(m => m.id).join(",");

  useEffect(() => {
    if (unreadIds && document.visibilityState === "visible") {
      void markChatRead(clientId, unreadIds.split(",")).catch(() => {});
    }
  }, [clientId, unreadIds]);

  useEffect(() => {
    if (!latest) return;
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(refresh, 12000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [latest, router]);

  return (
    <>
      <ol className="space-y-3" aria-label="Mensagens da conversa">
        {messages.map(message => {
          const mine = message.sender_id === userId;
          return (
            <li key={message.id} className={`card max-w-[90%] p-3 ${mine ? "ml-auto border-gold-500/40 bg-gold-400/10" : "mr-auto"}`}>
              <p className="text-xs font-semibold text-ink-500">{mine ? "Tu" : clientId ? "Cliente" : "Treinador"}</p>
              {message.booking_starts_at && <p className="mt-1 text-xs font-medium">Treino de {formatDateTime(message.booking_starts_at)}</p>}
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{message.body}</p>
              <time dateTime={message.created_at} className="mt-2 block text-xs text-ink-500">{formatDateTime(message.created_at)}</time>
            </li>
          );
        })}
      </ol>
      {!messages.length && <p className="card p-4 text-sm text-ink-500">Ainda não há mensagens nesta conversa.</p>}
      {latest && (
        <form className="card space-y-3 p-4" onSubmit={event => {
          event.preventDefault();
          if (pending || !body.trim()) return;
          setError("");
          const form = new FormData();
          requestId.current ??= crypto.randomUUID();
          form.set("requestId", requestId.current);
          form.set("body", body);
          if (clientId) form.set("clientId", clientId);
          if (booking) form.set("bookingId", booking.id);
          startTransition(async () => {
            try {
              const result = await sendChatMessage(form);
              if (result.error) { setError(result.error); return; }
              requestId.current = null;
              setBody("");
              router.refresh();
            } catch { setError("Não foi possível enviar. Tenta novamente."); }
          });
        }}>
          {booking && <p className="text-xs font-semibold">Sobre o treino de {formatDateTime(booking.starts_at)}</p>}
          <label htmlFor="chat-body" className="label">Mensagem</label>
          <textarea id="chat-body" className="input w-full" rows={3} required maxLength={2000}
            placeholder="Escreve a tua mensagem…" value={body} disabled={pending}
            onChange={event => { requestId.current = null; setBody(event.target.value); }} />
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
          <button className="btn-primary min-h-11" disabled={pending || !body.trim()}>
            {pending ? "A enviar…" : "Enviar mensagem"}
          </button>
        </form>
      )}
    </>
  );
}
