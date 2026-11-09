alter table public.leap_chat_messages add column rescheduled_from timestamptz;

CREATE OR REPLACE FUNCTION public.reschedule_booking_admin(p_old_booking_id uuid, p_starts_at timestamp with time zone, p_duration_min integer, p_notify_client boolean DEFAULT true, p_force boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old bookings%rowtype;
  v_client uuid;
  v_chat_id uuid;
  v_trainer uuid;
  v_ends_at timestamptz := p_starts_at + (p_duration_min || ' minutes')::interval;
  v_actor uuid := auth.uid();
  v_when text := to_char(p_starts_at at time zone 'Europe/Lisbon', 'DD/MM "às" HH24:MI');
begin
  select * into v_old from bookings where id = p_old_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  -- 0124: autorização relaxada — QUALQUER staff (trainer/owner) pode
  -- mover QUALQUER sessão. Deixa de exigir _trainer_is_accessible.
  -- (service role: v_actor null → passa, como antes.)
  if v_actor is not null and not is_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_old.status not in ('booked', 'confirmed') then
    raise exception 'Só sessões ativas podem ser reagendadas.';
  end if;

  v_client := v_old.client_id;
  v_trainer := v_old.trainer_id;

  perform pg_advisory_xact_lock(hashtextextended(v_trainer::text, 0));

  if p_duration_min is null or p_duration_min < 5 or p_duration_min > 600 then
    raise exception 'A duração tem de estar entre 5 e 600 minutos.';
  end if;

  -- "Ocupado" (trainer_blocked_times) → aviso confirmável (P0098).
  if not coalesce(p_force, false) and exists (
    select 1 from trainer_blocked_times
    where trainer_id = v_trainer
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'Este horário está ocupado.' using errcode = 'P0098';
  end if;
  -- Sobreposição com OUTRA sessão activa → aviso confirmável (P0099).
  if not coalesce(p_force, false) and exists (
    select 1 from bookings
    where trainer_id = v_trainer
      and id <> p_old_booking_id
      and status in ('booked', 'confirmed')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'Esta sessão vai sobrepor outra.' using errcode = 'P0099';
  end if;
  if is_reserved_slot_blocked(v_trainer, v_client, p_starts_at, v_ends_at) then
    raise exception 'Horário reservado para outro cliente.';
  end if;

  -- 0124: UPDATE in-place — só muda o horário e a duração. PRESERVA
  -- purchase_id, credit_charged, status, confirmed_at/by. Neutro em
  -- créditos: a 1 sessão descontada na criação continua descontada.
  -- Nunca toca em purchases nem em pick_purchase → sem "Sem sessões".
  update bookings
    set starts_at = p_starts_at,
        ends_at = v_ends_at
  where id = p_old_booking_id;

  if p_notify_client and v_actor is not null then
    if v_old.starts_at is distinct from p_starts_at or v_old.ends_at is distinct from v_ends_at then
      v_chat_id := gen_random_uuid();
      perform public.leap_send_chat_message(
        v_chat_id, v_client, v_actor, v_actor,
        'Sessão reagendada para ' || v_when || '.', p_old_booking_id, p_starts_at
      );
      update public.leap_chat_messages set rescheduled_from = v_old.starts_at where id = v_chat_id;
    end if;
  elsif p_notify_client then
    insert into notifications (user_id, type, title, body, link)
    values (v_client, 'booking_created', 'Sessão reagendada',
            'A tua sessão foi reagendada para ' || v_when || '.',
            '/app/agenda');
  end if;

  return p_old_booking_id;
end;
$function$;

create or replace function public.reschedule_booking_admin(
  p_old_booking_id uuid, p_starts_at timestamptz, p_duration_min integer,
  p_notify_client boolean, p_force boolean, p_message text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_client uuid;
  v_chat_id uuid;
  v_old_start timestamptz;
  v_old_end timestamptz;
  v_actor uuid := auth.uid();
  v_message text := case when p_notify_client then nullif(btrim(p_message), '') end;
begin
  if not public.is_admin() or not exists (
    select 1 from public.profiles where id = v_actor and role in ('owner', 'trainer')
      and access_blocked is not true
  ) then
    raise exception 'Acesso restrito.' using errcode = '42501';
  end if;
  if char_length(v_message) > 1000 then
    raise exception 'A mensagem pode ter até 1000 caracteres.';
  end if;

  select starts_at, ends_at into v_old_start, v_old_end
    from public.bookings where id = p_old_booking_id for update;

  v_id := public.reschedule_booking_admin(
    p_old_booking_id, p_starts_at, p_duration_min, p_notify_client and v_message is null, p_force
  );

  if v_message is not null and (
    v_old_start is distinct from p_starts_at
    or v_old_end is distinct from p_starts_at + make_interval(mins => p_duration_min)
  ) then
    select client_id into strict v_client from public.bookings where id = v_id;
    v_chat_id := gen_random_uuid();
    perform public.leap_send_chat_message(
      v_chat_id, v_client, v_actor, v_actor,
      'Sessão reagendada' || E'\n\n' || v_message, v_id, p_starts_at
    );
    update public.leap_chat_messages set rescheduled_from = v_old_start where id = v_chat_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.reschedule_booking_admin(uuid,timestamptz,integer,boolean,boolean,text)
  from public, anon;
grant execute on function public.reschedule_booking_admin(uuid,timestamptz,integer,boolean,boolean,text)
  to authenticated;
