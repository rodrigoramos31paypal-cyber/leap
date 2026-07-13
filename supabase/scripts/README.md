# supabase/scripts

One-off administrative SQL you run by hand in the **Supabase → SQL Editor**.
These are *not* migrations — they take parameters and are run on demand.

## grant_owner_trainer.sql — promover uma conta a admin (owner + trainer)

Transforma uma conta **já registada** num espelho do dono do estúdio:

- `role = 'owner'` → recebe **todas** as notificações de admin (novas
  marcações, pagamentos, etc.) e gere o estúdio inteiro.
- registo em `trainers` (+ settings + horário semanal default) → fica
  **marcável** pelos clientes e deixa de aparecer *"Sem trainer configurado"*.

### Como usar

1. A pessoa regista-se / faz login na app pelo menos uma vez (cria a linha
   em `profiles`).
2. Supabase → **SQL Editor** → cola o conteúdo de `grant_owner_trainer.sql`.
3. Muda **apenas** as duas variáveis no topo (`v_email` e `v_slug`) e corre.
4. É **idempotente** — podes voltar a correr sem duplicar nada. No fim há
   uma query de verificação (comentada) para confirmar o resultado.

> Funciona porque o SQL Editor corre como `postgres` (`auth.uid()` = NULL),
> por isso o trigger `protect_profile_role` permite a mudança de role.

## Equivalente in-app (sem SQL)

O mesmo resultado está disponível no painel admin sem tocar em SQL:

**Equipa → "Conceder admin a conta existente"** → escreve o email → *Tornar admin*.

- Só o **owner** vê e usa esta opção.
- Email registado → a conta vira owner + trainer instantaneamente.
- Email não registado → erro.

O slug do trainer é gerado automaticamente a partir do nome/email (com
sufixo numérico se já existir). Usa o script SQL quando quiseres controlar o
slug manualmente ou fazer a operação em massa.

## Notas

- **Notificações in-app (sino):** funcionam assim que o role muda.
- **Push (notificações no telemóvel):** a conta tem de activar o push no
  **próprio dispositivo** (regista uma push subscription).
- **Email:** requer o Resend configurado.
- Se o cliente vai ser o **único** trainer, lembra-te de desactivar os outros
  trainers (Equipa → Desactivar) para os clientes não verem uma escolha.
