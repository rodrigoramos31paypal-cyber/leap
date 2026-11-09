alter table public.leap_chat_messages add column kind text not null default 'message'
  check (kind in ('message', 'cancellation', 'cancellation_approved', 'cancellation_rejected'));

CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_chat_id uuid;
  v_late_client_cancel boolean := false;
  v_grp text;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  v_when := to_char(v_booking.starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');
  v_grp := case when v_booking.session_type = 'tripla' then 'trio' else 'duo' end;

  -- ── Autorização ───────────────────────────────────────────────
  if auth.uid() is null then
    null; -- service: ok
  elsif v_booking.client_id = auth.uid()
        or v_booking.partner_client_id = auth.uid()
        or v_booking.partner2_client_id = auth.uid() then   -- TRIO: a 3.ª conta também pode cancelar
    null;
  elsif is_admin() then
    if not _trainer_is_accessible(v_booking.trainer_id) then
      raise exception 'access denied' using errcode = '42501';
    end if;
  else
    raise exception 'access denied' using errcode = '42501';
  end if;

  -- IDEMPOTÊNCIA (0139): já cancelada/no_show → no-op (devolve false).
  if v_booking.status in ('cancelled', 'no_show') then return false; end if;

  -- Quem está a cancelar? Qualquer membro do grupo conta como CLIENTE.
  v_by_admin := auth.uid() is null
                or _is_service_or_admin()
                or (auth.uid() <> v_booking.client_id
                    and auth.uid() <> coalesce(v_booking.partner_client_id, v_booking.client_id)
                    and auth.uid() <> coalesce(v_booking.partner2_client_id, v_booking.client_id));

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

  v_late_client_cancel := (not v_by_admin) and (not v_refund);

  update bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        cancellation_reason = p_reason,
        confirmed_at = null,
        confirmed_by = null,
        credit_charged = not v_refund,
        late_cancel_review = case when v_late_client_cancel then 'pending' else null end
    where id = p_booking_id;

  if v_refund and v_booking.credit_charged then
    update purchases
      set sessions_remaining = sessions_remaining + 1
      where id = v_booking.purchase_id;

    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
    values (v_booking.purchase_id, p_booking_id, 1, 'cancel_refund', auth.uid(),
            'Devolução de crédito por cancelamento');

    -- Legado (marcações antigas com 2.º desconto): devolve também ao par.
    if v_booking.partner_purchase_id is not null then
      update purchases
        set sessions_remaining = sessions_remaining + 1
        where id = v_booking.partner_purchase_id;
      insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
      values (v_booking.partner_purchase_id, p_booking_id, 1, 'cancel_refund', auth.uid(),
              'Devolução de crédito por cancelamento (par duo)');
    end if;
    if v_booking.partner2_purchase_id is not null then
      update purchases
        set sessions_remaining = sessions_remaining + 1
        where id = v_booking.partner2_purchase_id;
      insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
      values (v_booking.partner2_purchase_id, p_booking_id, 1, 'cancel_refund', auth.uid(),
              'Devolução de crédito por cancelamento (trio)');
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

  -- DUO/TRIO: avisa os outros membros da sessão partilhada.
  if v_booking.partner_client_id is not null then
    insert into notifications (user_id, type, title, body, link)
    values (v_booking.partner_client_id, 'booking_cancelled', 'Marcação ' || v_grp || ' cancelada',
            'A tua sessão ' || v_grp || ' de ' || v_when || ' foi cancelada'
            || case when v_refund then ' e foi devolvida à tua conta.' else '.' end,
            '/app/historico');
  end if;
  if v_booking.partner2_client_id is not null then
    insert into notifications (user_id, type, title, body, link)
    values (v_booking.partner2_client_id, 'booking_cancelled', 'Marcação ' || v_grp || ' cancelada',
            'A tua sessão ' || v_grp || ' de ' || v_when || ' foi cancelada'
            || case when v_refund then ' e foi devolvida à tua conta.' else '.' end,
            '/app/historico');
  end if;

  if not v_by_admin then
    select profile_id into v_trainer_profile from trainers where id = v_booking.trainer_id;
    if v_trainer_profile is not null then
      v_chat_id := gen_random_uuid();
      perform public.leap_send_chat_message(v_chat_id, auth.uid(), v_trainer_profile, auth.uid(),
        case when nullif(btrim(p_reason), '') is null or p_reason = 'Cancelado pelo cliente'
          then 'Sem justificação indicada.'
          else left(btrim(p_reason), 1000) end,
        p_booking_id, v_booking.starts_at);
      update public.leap_chat_messages set kind = 'cancellation' where id = v_chat_id;
    end if;
  end if;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.review_late_cancel(p_booking_id uuid, p_approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_chat_id uuid;
  v_chat_staff uuid;
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

      -- Notifica o cliente do reembolso (push + in-app; ver notifications-config).
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

  if v_booking.late_cancel_review::text is distinct from (case when p_approve then 'approved' else 'rejected' end) then
    select staff_id into v_chat_staff from public.leap_chat_messages
      where booking_id = p_booking_id and client_id = v_booking.cancelled_by and kind = 'cancellation'
      order by created_at desc limit 1;
    if v_chat_staff is not null then
      v_chat_id := gen_random_uuid();
      perform public.leap_send_chat_message(v_chat_id, v_booking.cancelled_by, v_chat_staff, v_chat_staff,
        case when p_approve then 'A sessão foi devolvida ao saldo.' else 'A sessão mantém-se descontada.' end,
        p_booking_id, v_booking.starts_at);
      update public.leap_chat_messages
        set kind = case when p_approve then 'cancellation_approved' else 'cancellation_rejected' end
        where id = v_chat_id;
    end if;
  end if;
end;
$function$
;
