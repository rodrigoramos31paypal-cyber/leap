"use client";

import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { useState } from "react";

export type Conversation = {
  id: string;
  full_name: string | null;
  unread: number;
  last_message: string | null;
  preview: string | null;
  mine: boolean;
  group?: boolean;
};

const time = new Intl.DateTimeFormat("pt-PT", {
  timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit",
});

export function ConversationList({ rows, staff, searched }: {
  rows: Conversation[];
  staff?: boolean;
  searched?: boolean;
}) {
  const [onlyUnread, setOnlyUnread] = useState(false);
  const unread = rows.filter(row => row.unread > 0);
  const visible = onlyUnread ? unread : rows;

  return (
    <>
      <div className="flex gap-2" role="group" aria-label="Filtrar conversas">
        {[false, true].map(filter => (
          <button key={String(filter)} type="button" aria-pressed={onlyUnread === filter}
            onClick={() => setOnlyUnread(filter)}
            className={`min-h-10 rounded-full border px-3.5 text-sm font-semibold ${onlyUnread === filter
              ? "border-gold-400/40 bg-gold-100 text-gold-800 dark:bg-gold-400/15 dark:text-gold-200"
              : "border-ink-900/10 text-ink-500 dark:border-white/15"}`}>
            {filter ? `Não lidas${unread.length ? ` ${unread.length}` : ""}` : "Tudo"}
          </button>
        ))}
      </div>
      {visible.length === 0 && <p className="py-6 text-center text-sm text-ink-500">
        {onlyUnread ? "Não tens conversas por ler." : searched ? "Nenhum cliente encontrado." : "Ainda não tens conversas."}
      </p>}
      <ul aria-label="Conversas">
        {visible.map(row => {
          const name = row.full_name?.trim() || (staff ? "Cliente" : "Equipa LEAP");
          const initials = name.split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join("").toUpperCase();
          return (
            <li key={`${row.group ? "group" : "private"}:${row.id}`}>
              <Link href={`${staff ? "/admin" : "/app"}/mensagens?${row.group ? "grupo" : staff ? "cliente" : "equipa"}=${row.id}`}
                className="flex items-center gap-3 rounded-lg px-1 hover:bg-ink-900/5 dark:hover:bg-white/5">
                <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-gold-100 text-sm font-bold text-gold-800 dark:bg-gold-400/15 dark:text-gold-200">{initials}</span>
                <span className="flex min-h-16 min-w-0 flex-1 items-start gap-2 border-b border-ink-900/10 py-2.5 dark:border-white/10">
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm sm:text-base">{name}</strong>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-ink-500 sm:text-sm">
                      {row.mine && <CheckCheck size={15} className="shrink-0" aria-label="Enviada por ti" />}
                      <span className="truncate">{row.preview || "Abrir conversa"}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {row.last_message && <time dateTime={row.last_message} className={`text-xs tabular-nums ${row.unread > 0 ? "font-semibold text-gold-700 dark:text-gold-300" : "text-ink-500"}`}>{time.format(new Date(row.last_message))}</time>}
                    {row.unread > 0 && <span className="grid min-h-5 min-w-5 place-items-center rounded-full bg-gold-400 px-1 text-[10px] font-bold text-black" aria-label={`${row.unread} por ler`}>{row.unread > 99 ? "99+" : row.unread}</span>}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
