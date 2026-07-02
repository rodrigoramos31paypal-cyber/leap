-- ════════════════════════════════════════════════════════════════
-- 0130 · Revisão de CANCELAMENTOS TARDIOS pelo admin
--
-- Contexto: quando um CLIENTE cancela com menos de
-- `cancellation_window_hours` (default 12h) de antecedência e o trainer
-- cobra o cancelamento tardio (`charge_late_cancel`), a sessão é
-- DESCONTADA (credit_charged = true, sem devolução) — comportamento
-- inalterado e o DEFAULT (o cliente perde sempre a sessão).
--
-- NOVO: essa cobrança passa a ficar "por rever". O admin abre a
-- notificação do sino (deep-link para o perfil do cliente) e decide:
--   • APROVAR o cancelamento → devolve a sessão ao saldo (e ao par duo,
--     por espelho) e avisa o cliente que foi reembolsada;
--   • REJEITAR → a sessão mantém-se descontada (decisão default), sem
--     notificação extra ao cliente.
-- A decisão é reversível: o admin pode alternar aprovar/rejeitar quantas
-- vezes quiser — cada alternância aplica/desfaz a devolução idempotente-
-- mente com base em `credit_charged`.
--
-- Alterações:
--   1. bookings.late_cancel_review  text  null|'pending'|'approved'|'rejected'
--   2. cancel_booking (base: 0096) — marca 'pending' no cancelamento
--      tardio do cliente e aponta a notif do admin para o perfil do
--      cliente (?tab=sessoes&review=<booking>). Restante = cópia fiel.
--   3. review_late_cancel(uuid, boolean) — RPC de decisão (staff-only).
--
-- REVERT: repor cancel_booking da 0096, dropar review_late_cancel e a
-- coluna late_cancel_review.
-- ════════════════════════════════════════════════════════════════

-- ── 1. Coluna de estado da revisão ──────────────────────────────
alter table bookings
  add column if not exists late_cancel_review text
  check (late_cancel_review in ('pending', 'approved', 'rejected'));

comment on column bookings.late_cancel_review is
  '0130: estado da revisão de cancelamento tardio pelo admin. null = não aplicável; pending = à espera de decisão; approved = sessão devolvida; rejected = mantém-se descontada.';

-- ── 2. cancel_booking (cópia fiel da 0096 + marcação/deep-link) ──
create or replace function cancel_booking(
  p_booking_id uuid,
  p_reason text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_settings trainer_settings%rowtype;
  v_hours_to_session numeric;
  v_refund boolean := true;
  v_by_admin boolean;
  v_user_reason text;
  v_notif_body text;
  v_when text;
  v_trainer_profile uuid;
  v_client_name text;
  v_late_client_cancel boolean := false;   -- 0130
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  v_when := to_char(v_booking.starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');

  -- ── Autorização ───────────────────────────────────────────────
  if auth.uid() is null then
    null; -- service: ok
  elsif v_booking.client_id = auth.uid()
        or v_booking.partner_client_id = auth.uid() then   -- DUO: o par também pode cancelar
    null;
  elsif is_admin() then
    if not _trainer_is_accessible(v_booking.trainer_id) then
      raise exception 'access denied' using errcode = '42501';
    end if;
  else
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_booking.status in ('cancelled', 'no_show') then return; end if;

  -- Quem está a cancelar? (admin/serviço vs um dos clientes do par).
  -- DUO: o par (partner_client_id) conta como CLIENTE, não como admin.
  v_by_admin := auth.uid() is null
                or _is_service_or_admin()
                or (auth.uid() <> v_booking.client_id
                    and auth.uid() <> coalesce(v_booking.partner_client_id, v_booking.client_id));

  -- Sessão passada: o cliente não pode; o trainer/admin pode.
  if v_booking.starts_at <= now() and not v_by_admin then
    raise exception 'Não é possível cancelar uma sessão que já decorreu.';
  end if;

  select * into v_settings from trainer_settings where trainer_id = v_booking.trainer_id;

  v_hours_to_session := extract(epoch from (v_booking.starts_at - now())) / 3600.0;

  if not v_by_admin
     and v_settings.charge_late_cancel
     and v_hours_to_session < v_settings.cancellation_window_hours then
    v_refund := false;
  end if;

  -- 0130: cancelamento TARDIO do cliente (descontado) fica "por rever".
  v_late_client_cancel := (not v_by_admin) and (not v_refund);

  update bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        cancellation_reason = p_reason,
        confirmed_at = null,
        confirmed_by = null,
        credit_charged = not v_refund,
        late_cancel_review = case when v_late_client_cancel then 'pending' else null end   -- 0130
    where id = p_booking_id;

  if v_refund and v_booking.credit_charged then
    update purchases
      set sessions_remaining = sessions_remaining + 1
      where id = v_booking.purchase_id;

    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
    values (v_booking.purchase_id, p_booking_id, 1, 'cancel_refund', auth.uid(),
            'Devolução de crédito por cancelamento');

    -- DUO: devolve também ao par.
    if v_booking.partner_purchase_id is not null then
      update purchases
        set sessions_remaining = sessions_remaining + 1
        where id = v_booking.partner_purchase_id;

      insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
      values (v_booking.partner_purchase_id, p_booking_id, 1, 'cancel_refund', auth.uid(),
              'Devolução de crédito por cancelamento (par duo)');
    end if;
  end if;

  if v_by_admin and p_reason is not null then
    if position('—' in p_reason) > 0 then
      v_user_reason := trim(both ' ' from split_part(p_reason, '—', 2));
    else
      v_user_reason := p_reason;
    end if;
    if v_user_reason = '' then
      v_user_reason := null;
    end if;
  end if;

  if v_by_admin then
    v_notif_body :=
      'A tua sessão de ' || v_when || ' foi cancelada pelo trainer e foi devolvida à tua conta.'
      || case when v_user_reason is not null
              then ' Motivo: ' || v_user_reason
              else '' end;
  else
    v_notif_body := case
      when not v_refund then
        'A tua sessão de ' || v_when || ' foi cancelada com menos de '
        || v_settings.cancellation_window_hours || 'h — 1 sessão foi descontada.'
      else
        'A tua sessão de ' || v_when || ' foi cancelada e foi devolvida à tua conta.'
    end;
  end if;

  insert into notifications (user_id, type, title, body, link)
  values (v_booking.client_id, 'booking_cancelled', 'Marcação cancelada', v_notif_body, '/app/historico');

  -- DUO: avisa também o par de que a sessão partilhada foi cancelada.
  if v_booking.partner_client_id is not null then
    insert into notifications (user_id, type, title, body, link)
    values (v_booking.partner_client_id, 'booking_cancelled', 'Marcação duo cancelada',
            'A tua sessão duo de ' || v_when || ' foi cancelada'
            || case when v_refund then ' e foi devolvida à tua conta.' else '.' end,
            '/app/historico');
  end if;

  -- Quando foi o CLIENTE a cancelar, avisa o trainer/admin.
  -- 0130: num cancelamento TARDIO (descontado) o link vai para o perfil do
  -- cliente com ?review=<booking> — o admin abre o pop-up de decisão e pode
  -- devolver ou manter a sessão. Nos restantes casos mantém-se /admin/agenda.
  if not v_by_admin then
    select profile_id into v_trainer_profile from trainers where id = v_booking.trainer_id;
    select full_name into v_client_name from profiles where id = v_booking.client_id;
    if v_trainer_profile is not null then
      insert into notifications (user_id, type, title, body, link)
      values (v_trainer_profile, 'booking_cancelled_admin',
              'Cliente cancelou',
              coalesce(v_client_name, 'Um cliente') || ' cancelou a sessão de ' || v_when || '.'
                || case when v_late_client_cancel
                        then ' Cancelou com menos de ' || v_settings.cancellation_window_hours
                             || 'h — toca para reveres se devolves a sessão.'
                        else ' O horário ficou livre.' end,
              case when v_late_client_cancel
                   then '/admin/clientes/' || v_booking.client_id || '?tab=sessoes&review=' || p_booking_id
                   else '/admin/agenda' end);
    end if;
  end if;
end;
$$;

revoke all on function cancel_booking(uuid, text) from public, anon;
grant execute on function cancel_booking(uuid, text) to authenticated, service_role;

-- ── 3. review_late_cancel · decisão do admin (staff-only) ────────
create or replace function review_late_cancel(
  p_booking_id uuid,
  p_approve boolean
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_when text;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  -- Autorização: só staff com acesso ao trainer da sessão.
  if not is_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;
  if not _trainer_is_accessible(v_booking.trainer_id) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  -- Só sessões canceladas com cancelamento tardio em revisão.
  if v_booking.status <> 'cancelled' or v_booking.late_cancel_review is null then
    raise exception 'Esta sessão não tem cancelamento tardio para rever.';
  end if;

  v_when := to_char(v_booking.starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');

  if p_approve then
    -- APROVAR: devolve a sessão (só se ainda estiver descontada → idempotente).
    if v_booking.credit_charged then
      update purchases set sessions_remaining = sessions_remaining + 1
        where id = v_booking.purchase_id;
      insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
      values (v_booking.purchase_id, p_booking_id, 1, 'cancel_refund', auth.uid(),
              'Cancelamento tardio aprovado — sessão devolvida');

      -- DUO: marcações antigas com par explícito devolvem também ao par.
      if v_booking.partner_purchase_id is not null then
        update purchases set sessions_remaining = sessions_remaining + 1
          where id = v_booking.partner_purchase_id;
        insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
        values (v_booking.partner_purchase_id, p_booking_id, 1, 'cancel_refund', auth.uid(),
                'Cancelamento tardio aprovado — sessão devolvida (par duo)');
      end if;

      -- Notifica o cliente do reembolso.
      insert into notifications (user_id, type, title, body, link)
      values (v_booking.client_id, 'booking_refunded', 'Sessão reembolsada',
              'A tua sessão de ' || v_when || ' foi reembolsada e voltou ao teu saldo.',
              '/app/historico');
      -- DUO: avisa o par (saldo partilhado reflecte para ambos).
      if v_booking.partner_client_id is not null then
        insert into notifications (user_id, type, title, body, link)
        values (v_booking.partner_client_id, 'booking_refunded', 'Sessão reembolsada',
                'A tua sessão duo de ' || v_when || ' foi reembolsada e voltou ao teu saldo.',
                '/app/historico');
      end if;
    end if;

    update bookings set credit_charged = false, late_cancel_review = 'approved'
      where id = p_booking_id;
  else
    -- REJEITAR: mantém descontada. Se tinha sido aprovada/devolvida antes,
    -- reverte a devolução. Sem notificação ao cliente (decisão default).
    if not v_booking.credit_charged then
      update purchases set sessions_remaining = greatest(sessions_remaining - 1, 0)
        where id = v_booking.purchase_id;
      insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
      values (v_booking.purchase_id, p_booking_id, -1, 'late_cancel', auth.uid(),
              'Cancelamento tardio rejeitado — sessão descontada de novo');

      if v_booking.partner_purchase_id is not null then
        update purchases set sessions_remaining = greatest(sessions_remaining - 1, 0)
          where id = v_booking.partner_purchase_id;
        insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
        values (v_booking.partner_purchase_id, p_booking_id, -1, 'late_cancel', auth.uid(),
                'Cancelamento tardio rejeitado — sessão descontada de novo (par duo)');
      end if;
    end if;

    update bookings set credit_charged = true, late_cancel_review = 'rejected'
      where id = p_booking_id;
  end if;
end;
$$;

revoke all on function review_late_cancel(uuid, boolean) from public, anon;
grant execute on function review_late_cancel(uuid, boolean) to authenticated, service_role;

comment on function review_late_cancel(uuid, boolean) is
  '0130: admin aprova (devolve sessão + avisa cliente) ou rejeita (mantém descontada) um cancelamento tardio. Idempotente/reversível via credit_charged.';
