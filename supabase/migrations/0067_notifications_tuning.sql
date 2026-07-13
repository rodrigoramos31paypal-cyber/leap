-- ════════════════════════════════════════════════════════════════
-- 0067 · Afinação de notificações
--
--   A) confirm_booking_attendance — quando o trainer ACEITA uma
--      marcação pendente (booked → confirmed), o cliente passa a
--      receber "Marcação aceite" (em vez de "Presença confirmada").
--      Isto remove a antiga notificação de presença e, ao mesmo tempo,
--      fecha o gap "o cliente não era avisado quando a marcação era
--      aceite". (O email de presença é removido no lado do servidor.)
--
--   B) cancel_booking — quando é o CLIENTE a cancelar, o trainer/admin
--      passa a ser avisado ("Cliente cancelou — horário livre"). Antes
--      só o cliente recebia notificação do próprio cancelamento.
--
-- Bases: ambas as funções vêm de 0037_enrich_booking_notifications.sql.
-- REVERT: reaplicar 0037.
-- ════════════════════════════════════════════════════════════════

-- ── A) confirm_booking_attendance → "Marcação aceite" ─────────────
create or replace function confirm_booking_attendance(p_booking_id uuid)
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

  v_when := to_char(v_booking.starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');

  if not _is_service_or_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;
  if auth.uid() is not null and not _trainer_is_accessible(v_booking.trainer_id) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_booking.status = 'confirmed' then return; end if;
  if v_booking.status <> 'booked' then
    raise exception 'Só marcações ativas podem ser confirmadas.';
  end if;

  update bookings
    set status = 'confirmed',
        confirmed_at = now(),
        confirmed_by = auth.uid()
    where id = p_booking_id;

  -- Aceitação da marcação pendente → avisa o cliente.
  insert into notifications (user_id, type, title, body, link)
  values (v_booking.client_id, 'booking_confirmed',
          'Marcação aceite',
          'O treinador aceitou a tua sessão de ' || v_when || '. Até lá!',
          '/app/historico');
end;
$$;

-- ── B) cancel_booking → avisa o trainer quando o CLIENTE cancela ──
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
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  v_when := to_char(v_booking.starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');

  -- ── Autorização ───────────────────────────────────────────────
  if auth.uid() is null then
    null; -- service: ok
  elsif v_booking.client_id = auth.uid() then
    null; -- cliente cancela própria marcação: ok
  elsif is_admin() then
    if not _trainer_is_accessible(v_booking.trainer_id) then
      raise exception 'access denied' using errcode = '42501';
    end if;
  else
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_booking.status in ('cancelled', 'no_show') then return; end if;

  if v_booking.starts_at <= now() then
    raise exception 'Não é possível cancelar uma sessão que já decorreu.';
  end if;

  select * into v_settings from trainer_settings where trainer_id = v_booking.trainer_id;

  v_hours_to_session := extract(epoch from (v_booking.starts_at - now())) / 3600.0;

  v_by_admin := auth.uid() is null
                or _is_service_or_admin()
                or auth.uid() <> v_booking.client_id;

  if not v_by_admin
     and v_settings.charge_late_cancel
     and v_hours_to_session < v_settings.cancellation_window_hours then
    v_refund := false;
  end if;

  update bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        cancellation_reason = p_reason,
        confirmed_at = null,
        confirmed_by = null,
        credit_charged = not v_refund
    where id = p_booking_id;

  if v_refund and v_booking.credit_charged then
    update purchases
      set sessions_remaining = sessions_remaining + 1
      where id = v_booking.purchase_id;

    insert into credit_transactions (purchase_id, booking_id, delta, reason, created_by, notes)
    values (v_booking.purchase_id, p_booking_id, 1, 'cancel_refund', auth.uid(),
            'Devolução de crédito por cancelamento');
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

  -- GAP fechado: quando foi o CLIENTE a cancelar, avisa o trainer/admin.
  if not v_by_admin then
    select profile_id into v_trainer_profile from trainers where id = v_booking.trainer_id;
    select full_name into v_client_name from profiles where id = v_booking.client_id;
    if v_trainer_profile is not null then
      insert into notifications (user_id, type, title, body, link)
      values (v_trainer_profile, 'booking_cancelled_admin',
              'Cliente cancelou',
              coalesce(v_client_name, 'Um cliente') || ' cancelou a sessão de ' || v_when ||
                '. O horário ficou livre.',
              '/admin/agenda');
    end if;
  end if;
end;
$$;
