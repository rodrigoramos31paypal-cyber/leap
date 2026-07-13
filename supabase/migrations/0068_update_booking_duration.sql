-- ════════════════════════════════════════════════════════════════
-- 0068 · Ajustar a DURAÇÃO de uma sessão já marcada
--
-- O trainer pode, clicando numa sessão existente na agenda, mudar a
-- duração (ex.: 45 → 30 min, ou qualquer valor). Mantém a MESMA
-- marcação (mesmo id, mesma hora de início, mesmo crédito) e só altera
-- `ends_at`. O bloco na agenda redimensiona-se sozinho (a altura é
-- derivada de starts_at→ends_at).
--
-- Ao contrário de reschedule_booking_admin, NÃO está limitado às
-- durações pré-definidas (slot_durations_min) — aceita qualquer valor
-- entre 5 e 600 min. Crédito é neutro (1 sessão = 1 crédito, seja qual
-- for a duração). Verifica sobreposição com outras sessões e bloqueios.
--
-- Autorização: só admin com acesso ao trainer (ou service role).
-- REVERT: drop function update_booking_duration(uuid, integer);
-- ════════════════════════════════════════════════════════════════
create or replace function update_booking_duration(
  p_booking_id uuid,
  p_duration_min integer
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_ends_at timestamptz;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found then raise exception 'Marcação não encontrada'; end if;

  -- Autorização: só admin com acesso ao trainer (ou service role).
  if auth.uid() is not null
     and not (is_admin() and _trainer_is_accessible(v_booking.trainer_id)) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_booking.status not in ('booked', 'confirmed') then
    raise exception 'Só sessões ativas podem ser ajustadas.';
  end if;

  if p_duration_min is null or p_duration_min < 5 or p_duration_min > 600 then
    raise exception 'A duração tem de estar entre 5 e 600 minutos.';
  end if;

  v_ends_at := v_booking.starts_at + (p_duration_min || ' minutes')::interval;

  -- Serializa por trainer (mesmo lock das outras RPCs de agenda).
  perform pg_advisory_xact_lock(hashtextextended(v_booking.trainer_id::text, 0));

  -- Sem sobreposição com OUTRA sessão activa.
  if exists (
    select 1 from bookings
    where trainer_id = v_booking.trainer_id
      and id <> p_booking_id
      and status in ('booked', 'confirmed')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(v_booking.starts_at, v_ends_at, '[)')
  ) then
    raise exception 'A nova duração sobrepõe outra sessão.';
  end if;

  -- Sem sobreposição com um horário bloqueado.
  if exists (
    select 1 from trainer_blocked_times
    where trainer_id = v_booking.trainer_id
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(v_booking.starts_at, v_ends_at, '[)')
  ) then
    raise exception 'A nova duração sobrepõe um horário bloqueado.';
  end if;

  update bookings set ends_at = v_ends_at where id = p_booking_id;
end;
$$;

revoke all on function update_booking_duration(uuid, integer) from public, anon;
grant execute on function update_booking_duration(uuid, integer) to authenticated, service_role;
