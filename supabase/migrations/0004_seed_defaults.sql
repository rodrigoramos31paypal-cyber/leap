-- ════════════════════════════════════════════════════════════════
-- LEAP Fitness Studio · Seed inicial
-- Corre depois de teres criado o user "João" no Supabase Auth.
-- ════════════════════════════════════════════════════════════════

-- Função auxiliar: cria trainer + settings + packs default
-- Uso: select bootstrap_trainer('email-do-joao@x.pt', 'João', 'joao');
create or replace function bootstrap_trainer(
  p_email text,
  p_full_name text,
  p_slug text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_trainer_id uuid;
begin
  select id into v_user_id from auth.users where email = p_email;
  if v_user_id is null then
    raise exception 'Cria primeiro o user % no Supabase Auth (Authentication → Users → Add user).', p_email;
  end if;

  -- promove a trainer/owner
  update profiles
    set role = 'owner',
        full_name = p_full_name
    where id = v_user_id;

  -- garante profile (caso trigger não tenha corrido)
  if not found then
    insert into profiles (id, email, full_name, role)
    values (v_user_id, p_email, p_full_name, 'owner');
  end if;

  -- cria trainer
  insert into trainers (profile_id, slug, bio)
  values (v_user_id, p_slug, 'Personal Trainer · LEAP Fitness Studio')
  returning id into v_trainer_id;

  -- settings default
  insert into trainer_settings (trainer_id) values (v_trainer_id);

  -- horários default (seg-sex 7h-21h, sáb 8h-13h)
  insert into trainer_availability (trainer_id, day_of_week, start_time, end_time) values
    (v_trainer_id, 1, '07:00', '21:00'),
    (v_trainer_id, 2, '07:00', '21:00'),
    (v_trainer_id, 3, '07:00', '21:00'),
    (v_trainer_id, 4, '07:00', '21:00'),
    (v_trainer_id, 5, '07:00', '21:00'),
    (v_trainer_id, 6, '08:00', '13:00');

  -- packs default (20€/sessão · admin pode ajustar em /admin/packs)
  insert into packs (trainer_id, name, session_type, sessions, price_cents, sort_order) values
    (v_trainer_id, 'PT Individual · 4 Sessões',  'individual', 4,  8000,  10),
    (v_trainer_id, 'PT Individual · 8 Sessões',  'individual', 8,  16000, 20),
    (v_trainer_id, 'PT Individual · 12 Sessões', 'individual', 12, 24000, 30),
    (v_trainer_id, 'PT Individual · 16 Sessões', 'individual', 16, 32000, 40);

  return v_trainer_id;
end;
$$;

-- Exemplo (descomenta e corre depois de criar o user):
-- select bootstrap_trainer('joao@leap-fitness.pt', 'João', 'joao');
