-- ════════════════════════════════════════════════════════════════
-- 0131 · Notificação de cancelamento do CLIENTE → deep-link ao perfil
--
-- Na 0130, a notificação do admin só apontava ao perfil do cliente
-- quando o cancelamento era TARDIO (<12h, descontado); os restantes
-- cancelamentos continuavam a levar o admin a /admin/agenda.
--
-- AGORA: QUALQUER cancelamento feito pelo cliente leva o admin ao perfil
-- do cliente (?tab=sessoes&review=<booking>). A página resolve sozinha o
-- separador correto — "Futuras" se a sessão ainda está no futuro,
-- "Passadas" se já passou. O pop-up de decisão continua a aparecer APENAS
-- nos cancelamentos tardios (a linha `late_cancel_review` só existe
-- nesses; sem ela o componente não abre nada — é só navegação).
--
-- Append-only: redefine cancel_booking (base: 0130) só com o link do
-- admin sempre a apontar ao perfil. Tudo o resto é cópia fiel.
-- REVERT: reaplicar 0130.
-- ════════════════════════════════════════════════════════════════

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
  -- 0131: o link aponta SEMPRE ao perfil do cliente (?review=<booking>).
  -- A página escolhe o separador (Futuras/Passadas) conforme a data da
  -- sessão. O pop-up de decisão só surge nos cancelamentos tardios (a
  -- linha `late_cancel_review` só existe nesses — nos restantes é apenas
  -- navegação para o perfil).
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
              '/admin/clientes/' || v_booking.client_id || '?tab=sessoes&review=' || p_booking_id);
    end if;
  end if;
end;
$$;

revoke all on function cancel_booking(uuid, text) from public, anon;
grant execute on function cancel_booking(uuid, text) to authenticated, service_role;
