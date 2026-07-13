-- ════════════════════════════════════════════════════════════════
-- 0110 · S-18 (audit jun/2026) — proteger colunas sensíveis de `profiles`
--        contra self-write via PostgREST.
--
-- ROOT CAUSE
-- A policy RLS "profiles: self update" (0003) permite ao utilizador
-- escrever QUALQUER coluna da sua PRÓPRIA linha:
--     for update using (id = auth.uid()) with check (id = auth.uid())
-- O único guard de coluna existente é o trigger `protect_profile_role`
-- (0010/0050), que SÓ bloqueia mudanças a `role`. As colunas `banned`
-- (0066) e `trainer_id` (0001) ficaram sem protecção.
--
-- EXPLORAÇÃO (utilizador autenticado low-priv, só com a anon key pública)
--   • Self-unban: um cliente suspenso (`banned = true`, controlo que o
--     painel usa para o impedir de COMPRAR packs — ver create_purchase
--     em 0066) faz:
--        PATCH /rest/v1/profiles?id=eq.<self>   {"banned": false}
--     com `apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>` + o seu próprio JWT.
--     A self-update policy aceita (id = auth.uid()), o trigger só olha
--     para `role` → a suspensão é anulada e o cliente volta a comprar.
--   • Self-rescope: o mesmo cliente faz {"trainer_id": "<trainer B>"}.
--     `_client_is_accessible` (0083) usa a união profiles.trainer_id, por
--     isso o cliente passa a "pertencer" a um trainer arbitrário —
--     injecta-se no scope/listas de PII de B e/ou foge ao seu trainer.
--
-- FIX
-- Estende o trigger BEFORE UPDATE para também bloquear mudanças a
-- `banned` e `trainer_id` quando o caller é um utilizador autenticado
-- que NÃO é staff. Caminhos legítimos mantêm-se intactos:
--   • service role / signup → `auth.uid() IS NULL` (e o signup é INSERT,
--     não dispara este trigger BEFORE UPDATE de qualquer forma);
--   • owner a editar contas → is_owner()/is_admin() = true;
--   • trainer a (des)suspender cliente do seu scope via a RPC
--     `set_client_banned` (SECURITY DEFINER, corre com o auth.uid() do
--     trainer) → is_admin() = true → permitido;
--   • cliente a editar full_name/phone/email → nenhuma destas colunas
--     muda → permitido.
--
-- NOTA: `role` continua OWNER-only (mantém 0050). `banned`/`trainer_id`
-- ficam STAFF-only (is_admin) porque a RPC scoped de ban é chamável por
-- trainers dentro do seu scope; o scope cross-trainer já é validado
-- dentro dessa RPC (_client_is_accessible, 0083).
--
-- REVERT: reaplicar a definição de `protect_profile_role` de 0050.
-- ════════════════════════════════════════════════════════════════

create or replace function protect_profile_role()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  -- service role / triggers de sistema (sem sessão) passam sempre.
  if auth.uid() is null then
    return new;
  end if;

  -- role: exclusivo do owner (mantém 0050).
  if new.role is distinct from old.role and not is_owner() then
    raise exception 'Apenas o owner pode alterar roles.'
      using errcode = '42501';
  end if;

  -- banned: nunca pelo próprio cliente. Staff (owner ou trainer via a
  -- RPC scoped set_client_banned) e service role podem.
  if new.banned is distinct from old.banned and not is_admin() then
    raise exception 'Apenas staff pode alterar o estado de suspensão da conta.'
      using errcode = '42501';
  end if;

  -- trainer_id: nunca self-rescope por um cliente. Definido no signup
  -- (INSERT) e, daí em diante, só staff/serviço o muda.
  if new.trainer_id is distinct from old.trainer_id and not is_admin() then
    raise exception 'Apenas staff pode alterar o trainer associado à conta.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function protect_profile_role() is
  'S-18 hardening (jun/2026): BEFORE UPDATE em profiles. Bloqueia '
  'self-write de colunas sensiveis via PostgREST — role (owner-only), '
  'banned e trainer_id (staff-only). Service role / signup (auth.uid() '
  'NULL) passam. Substitui a versao de 0050 (so protegia role).';

-- (o trigger trg_protect_profile_role de 0003 continua a apontar para
--  esta função — CREATE OR REPLACE não o desliga.)
