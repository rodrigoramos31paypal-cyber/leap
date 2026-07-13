-- ════════════════════════════════════════════════════════════════
-- 0046_register_with_trainer
--
-- Quando o cliente regista pela página pública de um trainer
-- (/t/<slug> → /registar?trainer=<id>), o ID do trainer chega via
-- raw_user_meta_data → o handle_new_user() lê-o e associa logo o
-- profile.trainer_id. Se o trainer não existir/estiver inactivo, fica
-- NULL (o flow normal de escolher trainer trata disso depois).
--
-- REVERT: republica a versão anterior de handle_new_user (0002).
-- ════════════════════════════════════════════════════════════════
create or replace function handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_trainer_id uuid;
begin
  -- Lê e valida o trainer (se vier no metadata). Inválido → NULL.
  begin
    v_trainer_id := (new.raw_user_meta_data->>'trainer_id')::uuid;
  exception when others then
    v_trainer_id := null;
  end;

  if v_trainer_id is not null then
    if not exists (
      select 1 from trainers where id = v_trainer_id and active = true
    ) then
      v_trainer_id := null;
    end if;
  end if;

  insert into profiles (id, email, full_name, phone, role, trainer_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'phone',
    'client',
    v_trainer_id
  );
  return new;
end;
$$;
