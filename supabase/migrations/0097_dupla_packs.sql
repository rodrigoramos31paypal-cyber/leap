-- ════════════════════════════════════════════════════════════════
-- 0097 · Packs "PT Dupla" (4 / 6 / 8 / 12 sessões)
--
-- Cria os 4 packs de sessões DUPLAS para cada treinador que já tenha
-- packs PT Individual activos. Preço a 0 (cortesia/placeholder) — o
-- admin define o preço real em /admin/packs. Cada cliente do par compra
-- o seu pack dupla; uma marcação duo gasta 1 sessão a cada um.
--
-- Idempotente: só insere o que ainda não existe (chave: trainer_id +
-- nome). Re-correr não duplica.
-- ════════════════════════════════════════════════════════════════

insert into packs (trainer_id, name, description, session_type, sessions, price_cents, validity_days, active, sort_order)
select
  t.trainer_id,
  v.name,
  null,
  'dupla'::session_type,
  v.sessions,
  0,            -- preço placeholder; define em /admin/packs
  null,         -- validade: herda de trainer_settings
  true,
  v.sort_order
from (
  -- Treinadores com pelo menos um pack individual activo.
  select distinct trainer_id
  from packs
  where session_type = 'individual' and active
) t
cross join (values
  ('PT Dupla · 4 Sessões',   4,  10),
  ('PT Dupla · 6 Sessões',   6,  20),
  ('PT Dupla · 8 Sessões',   8,  30),
  ('PT Dupla · 12 Sessões', 12,  40)
) as v(name, sessions, sort_order)
where not exists (
  select 1 from packs p2
  where p2.trainer_id = t.trainer_id
    and p2.session_type = 'dupla'
    and p2.name = v.name
);
