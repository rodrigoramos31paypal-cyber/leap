alter table public.activities
  add column duration_minutes integer check (duration_minutes between 1 and 1440),
  add column distance_km numeric(7,2) check (distance_km > 0 and distance_km <= 1000),
  add column submission_id uuid unique;

create function public.log_cardio_with_proof(
 p_client uuid, p_jpeg text, p_comment text, p_minutes integer,
 p_distance numeric, p_submission uuid, p_staff uuid
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
 v_id uuid;
 v_body text;
begin
 if p_submission is null or p_minutes is null or p_minutes not between 1 and 1440
   or (p_distance is not null and (p_distance <= 0 or p_distance > 1000))
   or char_length(p_comment) > 300 then raise exception 'Dados inválidos.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_submission::text, 0));
 select id into v_id from public.activities
   where submission_id = p_submission and client_id = p_client;
 if found then return v_id; end if;
 v_id := public.log_activity_with_proof(p_client, 'cardio', p_jpeg, p_comment);
 update public.activities set duration_minutes=p_minutes, distance_km=p_distance,
   submission_id=p_submission where id=v_id;
 if nullif(btrim(p_comment), '') is not null then
   if not exists(select 1 from public.profiles where id=p_staff
     and role in ('owner','trainer') and access_blocked is not true) then
     raise exception 'Conversa indisponível.';
   end if;
   v_body := 'Registo de cardio · ' || to_char(now() at time zone 'Europe/Lisbon', 'DD/MM/YYYY')
     || E'\n' || p_minutes::text || ' min'
     || case when p_distance is null then '' else ' · ' || replace(p_distance::text, '.', ',') || ' km' end
     || E'\n\n' || btrim(p_comment);
   perform public.leap_send_chat_message(p_submission,p_client,p_staff,p_client,v_body,null,null);
 end if;
 return v_id;
end;
$$;
revoke all on function public.log_cardio_with_proof(uuid,text,text,integer,numeric,uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.log_cardio_with_proof(uuid,text,text,integer,numeric,uuid,uuid)
 to service_role;
