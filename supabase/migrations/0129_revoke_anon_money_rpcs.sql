-- ════════════════════════════════════════════════════════════════
-- 0129_revoke_anon_money_rpcs
--
-- [CRITICAL C-1] Seis RPCs SECURITY DEFINER de dinheiro/marcações eram
-- executáveis pelo role `anon` (chave pública no browser). O guard
-- `_is_service_or_admin()` devolvia TRUE sempre que `auth.uid()` é NULL
-- — o que acontece para pedidos anónimos — abrindo a porta a:
--   • adjust_credits           → créditos infinitos sem login
--   • confirm_purchase         → activar packs não pagos
--   • create_purchase          → criar packs a qualquer cliente
--   • reject_purchase          → adulterar compras alheias
--   • confirm_booking_attendance / cancel_booking → mexer marcações alheias
--
-- Ao contrário de ~15 outras RPCs (create_booking, delete_purchase, …),
-- estas seis nunca tiveram `REVOKE ... FROM anon`, herdando o
-- `EXECUTE TO PUBLIC` default do Postgres que o CREATE OR REPLACE preserva.
--
-- Correcção (defesa em profundidade):
--   1. REVOKE anon/public + GRANT explícito a authenticated/service_role.
--   2. Endurecer `_is_service_or_admin()` para identificar o service_role
--      pelo claim do JWT em vez de tratar "sem uid" como backend de confiança.
--
-- VERIFICAR (Supabase SQL editor) — nenhuma linha anon deve ter can_execute=true:
--   select p.proname, r.rolname,
--          has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_execute
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
--   cross join (values ('anon'),('authenticated')) as r(rolname)
--   where p.proname in ('adjust_credits','confirm_purchase','create_purchase',
--                       'reject_purchase','confirm_booking_attendance','cancel_booking')
--   order by 1,2;
--
-- REVERT:
--   grant execute on function adjust_credits(uuid,integer,text)              to anon;
--   grant execute on function confirm_purchase(uuid,uuid)                    to anon;
--   grant execute on function create_purchase(uuid,payment_method,uuid)      to anon;
--   grant execute on function reject_purchase(uuid,text)                     to anon;
--   grant execute on function confirm_booking_attendance(uuid)              to anon;
--   grant execute on function cancel_booking(uuid,text)                      to anon;
--   create or replace function _is_service_or_admin() returns boolean
--     language sql stable security definer set search_path = public
--     as $$ select auth.uid() is null or is_admin(); $$;
-- ════════════════════════════════════════════════════════════════

-- ── 1. Revogar anon/public e conceder só a authenticated + service_role ──
revoke all on function adjust_credits(uuid,integer,text)            from public, anon;
revoke all on function confirm_purchase(uuid,uuid)                  from public, anon;
revoke all on function create_purchase(uuid,payment_method,uuid)   from public, anon;
revoke all on function reject_purchase(uuid,text)                   from public, anon;
revoke all on function confirm_booking_attendance(uuid)            from public, anon;
revoke all on function cancel_booking(uuid,text)                    from public, anon;

grant execute on function adjust_credits(uuid,integer,text)          to authenticated, service_role;
grant execute on function confirm_purchase(uuid,uuid)                to authenticated, service_role;
grant execute on function create_purchase(uuid,payment_method,uuid)  to authenticated, service_role;
grant execute on function reject_purchase(uuid,text)                 to authenticated, service_role;
grant execute on function confirm_booking_attendance(uuid)          to authenticated, service_role;
grant execute on function cancel_booking(uuid,text)                  to authenticated, service_role;

-- ── 2. Endurecer o guard: identificar o service_role pelo claim do JWT ──
-- O service_role apresenta "role":"service_role"; o anon apresenta "role":"anon".
-- Assim, mesmo que um EXECUTE seja concedido a anon por engano no futuro, o
-- anon falha na verificação (deixa de bastar ter uid NULL).
create or replace function _is_service_or_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role' or is_admin();
$$;
