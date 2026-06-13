-- ════════════════════════════════════════════════════════════════
-- 0034_session_reminders
--
-- Lembretes de sessão (24h antes) por email + in-app.
--
--   • notification_preferences — opt-out por utilizador e por tipo de
--     notificação. AUSÊNCIA de linha = ativado (default on). Extensível
--     a futuros tipos (low_credit, etc.) sem mudar o schema.
--
--   • booking_reminders — dedup. Garante que cada (booking, destinatário,
--     canal) só dispara UMA vez, mesmo que o cron corra várias vezes ou
--     o cliente reabra a app repetidamente.
--
--   • claim_due_session_reminders() — chamada quando o CLIENTE abre a app.
--     Cria a notificação in-app (uma só vez) para sessões nas próximas
--     24h. SECURITY DEFINER mas estritamente limitada a auth.uid().
--
-- REVERT:
--   drop function if exists claim_due_session_reminders();
--   drop table if exists booking_reminders;
--   drop table if exists notification_preferences;
-- ════════════════════════════════════════════════════════════════

-- ── Preferências de notificação (opt-out) ─────────────────────────
create table if not exists notification_preferences (
  user_id    uuid not null references profiles(id) on delete cascade,
  kind       text not null,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

alter table notification_preferences enable row level security;

-- Cada utilizador gere apenas as SUAS preferências.
create policy notif_prefs_select on notification_preferences
  for select using (user_id = auth.uid());
create policy notif_prefs_insert on notification_preferences
  for insert with check (user_id = auth.uid());
create policy notif_prefs_update on notification_preferences
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_prefs_delete on notification_preferences
  for delete using (user_id = auth.uid());

-- ── Dedup de lembretes ────────────────────────────────────────────
create table if not exists booking_reminders (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references bookings(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  channel      text not null,                       -- 'email' | 'in_app'
  sent_at      timestamptz not null default now(),
  unique (booking_id, recipient_id, channel)
);

-- RLS ligado SEM políticas: nega acesso direto a utilizadores. Só o
-- service role (cron de email) e a função SECURITY DEFINER abaixo lhe
-- tocam.
alter table booking_reminders enable row level security;

-- ── In-app: reclama lembretes em falta para o cliente autenticado ──
-- Devolve quantas notificações foram criadas (0 se nenhuma / opt-out).
create or replace function claim_due_session_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  rec record;
  n int := 0;
begin
  if uid is null then
    return 0;
  end if;

  -- Respeita o opt-out (ausência de linha = ativado).
  if exists (
    select 1 from notification_preferences p
    where p.user_id = uid and p.kind = 'session_reminder' and p.enabled = false
  ) then
    return 0;
  end if;

  for rec in
    select b.id, b.starts_at
    from bookings b
    where b.client_id = uid
      and b.status in ('booked', 'confirmed')
      and b.starts_at > now()
      and b.starts_at <= now() + interval '24 hours'
      and not exists (
        select 1 from booking_reminders r
        where r.booking_id = b.id
          and r.recipient_id = uid
          and r.channel = 'in_app'
      )
  loop
    insert into booking_reminders (booking_id, recipient_id, channel)
    values (rec.id, uid, 'in_app')
    on conflict (booking_id, recipient_id, channel) do nothing;

    if found then
      insert into notifications (user_id, type, title, body, link)
      values (
        uid,
        'session_reminder',
        'Lembrete de sessão',
        'Tens uma sessão dia '
          || to_char(rec.starts_at at time zone 'Europe/Lisbon', 'DD/MM')
          || ' às '
          || to_char(rec.starts_at at time zone 'Europe/Lisbon', 'HH24:MI')
          || '.',
        '/app/agenda'
      );
      n := n + 1;
    end if;
  end loop;

  return n;
end;
$$;

grant execute on function claim_due_session_reminders() to authenticated;
