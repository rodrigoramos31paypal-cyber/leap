"use client";

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { Check, CheckCheck, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { markChatRead, sendChatMessage } from "@/app/app/mensagens/actions";
import type { ChatMessage } from "@/lib/chat";
import { formatDateTime } from "@/lib/utils";

const dayKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Lisbon", dateStyle: "short" });
const dayLabel = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", dateStyle: "medium" });
const messageTime = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit" });

export function ChatPanel({ messages, reviewLinks, userId, clientId, recipientId, booking, latest, fill }: {
  messages: ChatMessage[];
  reviewLinks: Record<string, string>;
  userId: string;
  clientId?: string;
  recipientId?: string;
  booking?: { id: string; starts_at: string } | null;
  latest: boolean;
  fill?: boolean;
}) {
  const router = useRouter();
  const history = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const lastMessageId = messages.at(-1)?.id;
  const requestId = useRef<string | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const unreadIds = messages.filter(m => m.sender_id !== userId && !m.read_at).map(m => m.id).join(",");

  useEffect(() => {
    if (unreadIds && document.visibilityState === "visible") {
      void markChatRead(clientId, unreadIds.split(","), recipientId).catch(() => {});
    }
  }, [clientId, unreadIds, recipientId]);

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

  useLayoutEffect(() => {
    const viewport = history.current;
    if (viewport && latest && followLatest.current) viewport.scrollTop = viewport.scrollHeight;
  }, [lastMessageId, latest]);

  const today = dayKey.format(new Date());
  return (
    <div className={`overflow-hidden rounded-2xl border border-ink-900/10 bg-bone-100 dark:border-white/10 dark:bg-ink-900 ${fill ? "flex min-h-0 flex-1 flex-col" : ""}`}>
      <div ref={history} tabIndex={0} aria-label="Histórico da conversa"
        onScroll={event => {
          const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
          followLatest.current = scrollHeight - scrollTop - clientHeight < 80;
        }}
        className={`overflow-y-auto overscroll-contain px-3 py-4 sm:px-5 ${fill ? "min-h-0 flex-1" : "min-h-32 max-h-[min(52dvh,32rem)]"}`}>
        {messages.length ? (
          <ol aria-label="Mensagens da conversa">
            {messages.map((message, index) => {
              const mine = message.sender_id === userId;
              const reviewLink = message.booking_id ? reviewLinks[message.booking_id] : undefined;
              const rescheduled = message.rescheduled_from && message.booking_starts_at;
              const body = rescheduled
                ? (message.body.startsWith("Sessão reagendada\n\n") ? message.body.slice("Sessão reagendada\n\n".length) : "")
                : message.body;
              const date = new Date(message.created_at);
              const day = dayKey.format(date);
              const previous = messages[index - 1];
              const newDay = !previous || dayKey.format(new Date(previous.created_at)) !== day;
              const grouped = !newDay && previous.sender_id === message.sender_id;

              return (
                <li key={message.id} className={grouped ? "mt-1" : "mt-3 first:mt-0"}>
                  {newDay && (
                    <p className="mx-auto mb-3 w-fit rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-ink-600 dark:bg-white/10 dark:text-bone-100">
                      {day === today ? "Hoje" : dayLabel.format(date)}
                    </p>
                  )}
                  <div className={`w-fit max-w-[88%] rounded-2xl px-3 py-2 shadow-sm ${
                    mine
                      ? "ml-auto rounded-br-sm bg-gold-100 text-ink-900 dark:bg-[#3f3314] dark:text-bone-50"
                      : "mr-auto rounded-bl-sm bg-white text-ink-900 dark:bg-ink-800 dark:text-bone-50"
                  }`}>
                    <span className="sr-only">{mine ? "Tu" : clientId ? "Cliente" : "Treinador"}: </span>
                    {message.rescheduled_from && message.booking_starts_at ? (
                      <div className="mb-1 rounded-md border-l-2 border-gold-500 bg-black/5 px-2 py-1 text-xs dark:bg-white/5">
                        <strong className="block">Sessão reagendada</strong>
                        <span>De <del>{formatDateTime(message.rescheduled_from)}</del>{" "}</span>
                        <span>para <strong>{formatDateTime(message.booking_starts_at)}</strong></span>
                      </div>
                    ) : message.booking_starts_at && (
                      <p className="mb-1 rounded-md border-l-2 border-gold-500 bg-black/5 px-2 py-1 text-xs font-medium dark:bg-white/5">
                        {message.kind !== "message" && (
                          <strong className="block">{message.kind === "cancellation" ? "Cancelamento de treino" : "Decisão sobre o cancelamento"}</strong>
                        )}
                        Treino de {formatDateTime(message.booking_starts_at)}
                      </p>
                    )}
                    {body && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{body}</p>}
                    {message.kind === "cancellation" && reviewLink && (
                      <Link href={reviewLink} className="mt-2 inline-block text-sm font-semibold underline">Rever devolução da sessão</Link>
                    )}
                    <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[10px] text-ink-600 dark:text-bone-100/70">
                      <time dateTime={message.created_at}>{messageTime.format(date)}</time>
                      {mine && (message.read_at
                        ? <CheckCheck size={14} role="img" aria-label="Lida" className="text-gold-700 dark:text-gold-300" />
                        : <Check size={14} role="img" aria-label="Enviada" />)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : <p className="py-6 text-center text-sm text-ink-500">Envia uma mensagem para começar a conversa.</p>}
      </div>
      {latest && (
        <form className="shrink-0 space-y-2 border-t border-ink-900/10 bg-bone-50 p-2.5 dark:border-white/10 dark:bg-ink-900" onSubmit={event => {
          event.preventDefault();
          if (pending || !body.trim()) return;
          setError("");
          const form = new FormData();
          requestId.current ??= crypto.randomUUID();
          form.set("requestId", requestId.current);
          form.set("body", body);
          if (clientId) form.set("clientId", clientId);
          if (recipientId) form.set("recipientId", recipientId);
          if (booking) form.set("bookingId", booking.id);
          startTransition(async () => {
            try {
              const result = await sendChatMessage(form);
              if (result.error) { setError(result.error); return; }
              requestId.current = null;
              followLatest.current = true;
              setBody("");
              router.refresh();
            } catch { setError("Não foi possível enviar. Tenta novamente."); }
          });
        }}>
          {booking && <p className="text-xs font-semibold">Sobre o treino de {formatDateTime(booking.starts_at)}</p>}
          <div className="flex items-end gap-2">
            <label htmlFor="chat-body" className="sr-only">Mensagem</label>
            <textarea id="chat-body" rows={1} required maxLength={2000}
              className="min-h-11 min-w-0 flex-1 resize-none rounded-2xl border border-ink-900/10 bg-white px-3 py-2.5 text-base leading-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500 dark:border-white/10 dark:bg-ink-800"
              style={{ fieldSizing: "content", maxHeight: "7rem" }}
              placeholder="Escreve uma mensagem…" value={body} readOnly={pending}
              onChange={event => { requestId.current = null; setBody(event.target.value); }} />
            <button type="submit" aria-label={pending ? "A enviar…" : "Enviar mensagem"}
              className="grid size-11 shrink-0 place-items-center rounded-full bg-gold-400 text-ink-900 hover:bg-gold-300 disabled:opacity-45"
              disabled={pending || !body.trim()}>
              <Send size={18} aria-hidden="true" />
            </button>
          </div>
          {error && <p role="alert" className="px-2 text-sm text-red-600 dark:text-red-300">{error}</p>}
        </form>
      )}
    </div>
  );
}
