-- ════════════════════════════════════════════════════════════════
-- 0120 · Full account lockout (ban / delete) — instant logout + no re-login
--
-- CONTEXTO
-- Antes existiam DOIS mecanismos, nenhum dos quais bloqueava o ACESSO:
--   1) profiles.banned (0066)  → só impede COMPRAR packs. O cliente
--      continua logado e consegue voltar a entrar normalmente.
--   2) "Apagar conta" (adminDeleteClientAction / deleteAccountAction)
--      → anonimiza + aplica ban no Supabase Auth. Bloqueia o RE-LOGIN,
--      mas a sessão ABERTA continua a funcionar até o access token
--      expirar (~1h), porque o middleware/layouts validam o JWT
--      localmente (getClaims) e não havia flag verificada por request.
--
-- DECISÃO (produto)
--   • "Bloquear compras" (banned) MANTÉM-SE como está — só bloqueia a
--     compra de packs; o cliente continua a poder entrar e usar a app.
--   • "Apagar conta" (DELETE, irreversível) passa a ser LOCKOUT TOTAL:
--       (a) não consegue voltar a entrar (login bloqueado),
--       (b) a sessão aberta cai no PRÓXIMO request (gate por-request),
--       (c) refresh tokens deixam de poder ser trocados (ban no GoTrue).
--     NÃO há acção de "bloquear acesso" separada — o lockout é o delete.
--
-- ESTE FICHEIRO
--   • Coluna `profiles.access_blocked` (default false) — a flag lida por
--     request nos layouts (gate de logout instantâneo) e no login.
--   • Estende `protect_profile_role()` para impedir self-write desta
--     coluna via PostgREST (mesmo padrão de `banned`/`trainer_id`, 0110).
--
-- A aplicação do ban no Supabase Auth (ban_duration) e a marcação de
-- access_blocked são feitas server-side com a service-role key na
-- server action (ver app/admin/clientes/[id]/actions.ts), por isso NÃO
-- é preciso uma RPC nova nem grants extra. O service role bypassa RLS e
-- o trigger isenta auth.uid() IS NULL.
--
-- REVERT:
--   alter table profiles drop column if exists access_blocked;
--   (e reaplicar protect_profile_role de 0110)
-- ════════════════════════════════════════════════════════════════

-- ── Coluna ────────────────────────────────────────────────────────
alter table profiles
  add column if not exists access_blocked boolean not null default false;

comment on column profiles.access_blocked is
  'Lockout TOTAL da conta (via Apagar conta). TRUE → login bloqueado + sessão '
  'aberta termina no próximo request (gate nos layouts) + refresh '
  'bloqueado (ban no GoTrue). Distinto de `banned` (que só bloqueia '
  'compra de packs). Só staff/service podem alterar (ver trigger).';

-- ── Trigger: bloquear self-write de access_blocked ────────────────
-- Reaplica a versão de 0110 acrescentando o guard de `access_blocked`.
-- Caminhos legítimos mantêm-se: service role / signup (auth.uid() NULL)
-- passam; owner/trainer (is_admin) podem; o próprio cliente não.
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

  -- banned: nunca pelo próprio cliente. Staff e service role podem.
  if new.banned is distinct from old.banned and not is_admin() then
    raise exception 'Apenas staff pode alterar o estado de suspensão da conta.'
      using errcode = '42501';
  end if;

  -- access_blocked (0120): lockout total — nunca pelo próprio cliente.
  -- Staff e service role podem; um cliente bloqueado NÃO se pode
  -- auto-desbloquear via PATCH /rest/v1/profiles.
  if new.access_blocked is distinct from old.access_blocked and not is_admin() then
    raise exception 'Apenas staff pode alterar o bloqueio de acesso da conta.'
      using errcode = '42501';
  end if;

  -- trainer_id: nunca self-rescope por um cliente.
  if new.trainer_id is distinct from old.trainer_id and not is_admin() then
    raise exception 'Apenas staff pode alterar o trainer associado à conta.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function protect_profile_role() is
  '0120 hardening: BEFORE UPDATE em profiles. Bloqueia self-write de '
  'colunas sensíveis via PostgREST — role (owner-only), banned, '
  'access_blocked e trainer_id (staff-only). Service role / signup '
  '(auth.uid() NULL) passam. Substitui a versão de 0110.';
