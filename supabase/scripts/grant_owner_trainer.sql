-- ════════════════════════════════════════════════════════════════
-- grant_owner_trainer.sql
--
-- Promove uma conta JÁ REGISTADA a OWNER + TRAINER — i.e. exactamente
-- com os mesmos poderes/notificações da conta principal:
--   • role = 'owner'  → recebe TODAS as notificações de admin
--                       (novas marcações, pagamentos, etc.) e gere o
--                       estúdio inteiro.
--   • registo em `trainers` → fica "marcável" pelos clientes e deixa
--                       de aparecer "Sem trainer configurado". Também
--                       passa a receber a notificação de trainer das
--                       suas próprias marcações.
--
-- COMO USAR:
--   1. A pessoa tem de se registar / fazer login no app pelo menos uma
--      vez (cria a linha em `profiles`).
--   2. No Supabase: SQL Editor → cola este script.
--   3. Muda APENAS as duas variáveis abaixo (email + slug) e corre.
--   4. Idempotente: podes voltar a correr sem duplicar nada.
--
-- NOTA: corre no SQL Editor (role `postgres`, auth.uid() = NULL), por
-- isso o trigger protect_profile_role permite a mudança de role.
-- ════════════════════════════════════════════════════════════════

do $$
declare
  -- ▼▼▼ MUDAR ESTES DOIS VALORES ▼▼▼
  v_email text := 'cliente@exemplo.com';   -- email da conta a promover
  v_slug  text := 'nome-do-trainer';       -- url-safe: só a-z, 0-9 e '-'
  -- ▲▲▲ MUDAR ESTES DOIS VALORES ▲▲▲

  v_user_id    uuid;
  v_trainer_id uuid;
begin
  -- 1) Resolver a conta pelo email (tem de existir em profiles)
  select id into v_user_id
  from profiles
  where lower(email) = lower(v_email);

  if v_user_id is null then
    raise exception
      'Nenhuma conta encontrada para "%". Tem de se registar/login primeiro.',
      v_email;
  end if;

  -- 2) Promover a OWNER (full admin + todas as notificações de owner)
  update profiles set role = 'owner' where id = v_user_id;

  -- 3) Garantir registo de trainer (bookable + sem "Sem trainer configurado")
  select id into v_trainer_id from trainers where profile_id = v_user_id;
  if v_trainer_id is null then
    insert into trainers (profile_id, slug, bio, active)
    values (v_user_id, v_slug, 'Personal Trainer', true)
    returning id into v_trainer_id;
  end if;

  -- 4) Garantir settings 1:1 do trainer
  insert into trainer_settings (trainer_id)
  values (v_trainer_id)
  on conflict (trainer_id) do nothing;

  -- 5) Horário semanal default (só se ainda não tiver nenhum)
  if not exists (
    select 1 from trainer_availability where trainer_id = v_trainer_id
  ) then
    insert into trainer_availability (trainer_id, day_of_week, start_time, end_time) values
      (v_trainer_id, 1, '07:00', '21:00'),  -- Seg
      (v_trainer_id, 2, '07:00', '21:00'),  -- Ter
      (v_trainer_id, 3, '07:00', '21:00'),  -- Qua
      (v_trainer_id, 4, '07:00', '21:00'),  -- Qui
      (v_trainer_id, 5, '07:00', '21:00'),  -- Sex
      (v_trainer_id, 6, '08:00', '13:00');  -- Sáb
  end if;

  raise notice 'OK: % é agora owner + trainer (trainer_id=%).', v_email, v_trainer_id;
end $$;

-- ── Verificação rápida (corre depois, opcional) ──────────────────
-- select p.email, p.role, t.id as trainer_id, t.slug, t.active
-- from profiles p
-- left join trainers t on t.profile_id = p.id
-- where lower(p.email) = lower('cliente@exemplo.com');
