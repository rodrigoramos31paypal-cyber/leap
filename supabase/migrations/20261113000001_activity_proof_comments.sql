alter table public.activity_proofs
  add column comment text check (char_length(comment) <= 300);

grant update (comment) on public.activity_proofs to service_role;

create function public.log_activity_with_proof(p_client uuid, p_type text, p_jpeg text, p_comment text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  v_id := public.log_activity_with_proof(p_client, p_type, p_jpeg);
  update public.activity_proofs set comment = nullif(btrim(p_comment), '') where activity_id = v_id;
  return v_id;
end;
$$;
revoke all on function public.log_activity_with_proof(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.log_activity_with_proof(uuid, text, text, text) to service_role;
