# Go-live · Emails de conta, password e notificações

Guia para garantir que os clientes recebem emails ao **criar conta**, ao
**recuperar a password**, e os emails da **app** (marcações, lembretes).

Domínio de produção: **leapfitnesstudio.com**
Email de envio: **no-reply@leapfitnesstudio.com**

> Há **dois sistemas de email** diferentes:
> 1. **Conta / password** → enviados pelo **Supabase Auth** (confirmar conta,
>    recuperar password, mudar email). Em produção precisam de **SMTP próprio**.
> 2. **App** → confirmações de marcação, lembretes, etc. Já estão no código
>    (via **Resend**), só precisam de estar ligados.
>
> Ambos vão usar a **mesma conta Resend** e o mesmo domínio verificado.

O que já está feito no código (não precisas de mexer): páginas de registo,
login, recuperação e reset, e o fluxo de sessão do reset (passa por
`/auth/callback`). Falta só a **configuração** abaixo (dashboards + DNS).

---

## Passo 1 · Resend — criar conta e verificar o domínio

1. Cria conta em https://resend.com (grátis até 3.000 emails/mês, 100/dia).
2. **Domains → Add Domain** → escreve `leapfitnesstudio.com`.
3. O Resend mostra **registos DNS** para adicionares (no sítio onde geres o
   DNS do domínio — registrar/Cloudflare/etc.). Tipicamente:
   - 1 registo **MX** (para o subdomínio de envio, ex. `send`)
   - 1 **TXT** de **SPF** (`v=spf1 include:amazonses.com ~all`)
   - 1–3 **TXT/CNAME** de **DKIM**
   - (recomendado) 1 **TXT** de **DMARC** em `_dmarc` → `v=DMARC1; p=none;`
   Copia exatamente os valores que o Resend te dá (variam por conta/região).
4. Depois de adicionar os registos, carrega em **Verify**. Pode demorar de
   minutos a algumas horas a propagar. Só avança quando ficar **Verified ✅**.

> Sem domínio verificado, os emails ou não saem ou caem em spam.

## Passo 2 · Resend — API key

1. **API Keys → Create API Key** (permissão *Sending access*).
2. Copia a key (`re_...`) — vais usá-la em **dois sítios**:
   - como `RESEND_API_KEY` na Vercel (emails da app);
   - como **password do SMTP** no Supabase (emails de conta/password).
   Podes criar duas keys separadas se preferires.

## Passo 3 · Vercel — Environment Variables (Production)

Project → **Settings → Environment Variables**. Confirma/define:

| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://leapfitnesstudio.com` |
| `NEXT_PUBLIC_APP_NAME` | `LEAP-FITNESS STUDIO` |
| `NOTIFICATIONS_EMAIL_ENABLED` | `true` |
| `RESEND_API_KEY` | `re_...` (do Passo 2) |
| `NOTIFICATION_FROM_EMAIL` | `no-reply@leapfitnesstudio.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | (já deves ter) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (já deves ter) |
| `SUPABASE_SERVICE_ROLE_KEY` | (já deves ter) |
| `UPSTASH_REDIS_REST_URL` / `..._TOKEN` | **recomendado em prod** (rate-limit de login/registo) |

Depois de mudar variáveis, faz **Redeploy** para entrarem em vigor.

> ⚠️ `NEXT_PUBLIC_APP_URL` é crítico: é o que constrói os links dos emails de
> conta/password. Se ficar errado, os links não funcionam.

## Passo 4 · Supabase — URL Configuration

Dashboard → **Authentication → URL Configuration**:

- **Site URL**: `https://leapfitnesstudio.com`
- **Redirect URLs** (Add URL):
  - `https://leapfitnesstudio.com/**`
  - (se usares www) `https://www.leapfitnesstudio.com/**`
  - (dev, opcional) `http://localhost:3000/**`

Isto autoriza os redirects de `/auth/callback` e `/auth/reset`.

## Passo 5 · Supabase — SMTP próprio (Resend)

Dashboard → **Authentication → Emails → SMTP Settings** → **Enable custom SMTP**:

| Campo | Valor |
|---|---|
| Sender email | `no-reply@leapfitnesstudio.com` |
| Sender name | `LEAP-FITNESS STUDIO` |
| Host | `smtp.resend.com` |
| Port | `465` (SSL) — ou `587` (TLS) |
| Username | `resend` |
| Password | a tua **API key do Resend** (`re_...`) |

Guarda. (Sem isto, o Supabase usa o sender interno, limitado a ~3–4
emails/hora — não serve para go-live.)

## Passo 6 · Supabase — Provider de email

Dashboard → **Authentication → Providers → Email**:

- **Confirm email**: **ON** ✅ (envia email ao criar conta — é o que queres).
- **Secure email change**: ON (recomendado).
- **Minimum password length**: `8` (igual ao código).

Opcional: **Authentication → Rate Limits** → com SMTP próprio podes subir o
limite de envio de emails (ex. 30–100/hora) para não bloquear picos.

## Passo 7 · Supabase — Templates de email (PT)

Dashboard → **Authentication → Emails → Templates**. Para cada um, cola o
HTML do ficheiro correspondente e define o assunto:

| Template Supabase | Ficheiro | Assunto sugerido |
|---|---|---|
| Confirm signup | `supabase/email-templates/confirmacao-conta.html` | Confirma a tua conta · LEAP-FITNESS STUDIO |
| Reset password | `supabase/email-templates/recuperar-password.html` | Recuperar a tua password · LEAP-FITNESS STUDIO |
| Change Email Address | `supabase/email-templates/mudar-email.html` | Confirma o teu novo email · LEAP-FITNESS STUDIO |

Não alteres a variável `{{ .ConfirmationURL }}` dentro dos templates — é o
link que faz o fluxo funcionar.

## Passo 8 · Migrações de BD pendentes

Confirma que aplicaste todas as migrações novas no Supabase (SQL Editor ou
`supabase db push`), incluindo as do Duo: `0096`–`0100`. As páginas usam
colunas/funções que essas migrações criam.

---

## Passo 9 · Testar (com emails reais)

1. **Criar conta**: regista-te em `/registar` com um email teu real →
   deve chegar o email "Confirma a tua conta" → carregar no botão →
   ficas autenticado no dashboard.
2. **Recuperar password**: em `/recuperar` mete o email → chega o email →
   carregar → escolher nova password em `/auth/reset` → entra na app.
3. **Email da app**: faz uma marcação → confirma que chega o email de
   marcação (e o admin recebe a notificação).
4. Confirma que os emails **não caem em spam** (domínio verificado ajuda).
   Vê os logs em **Resend → Emails** e em **Supabase → Auth → Logs**.

## Se algo falhar

- **Link de confirmação/reset não funciona** → revê `NEXT_PUBLIC_APP_URL`
  (Passo 3) e os Redirect URLs (Passo 4).
- **Não chega email de conta/password** → revê o SMTP (Passo 5) e os logs do
  Resend; confirma o domínio Verified (Passo 1).
- **"Auth session missing" ao repor password** → garante que o deploy com o
  fix do `/auth/callback?next=/auth/reset` já está em produção.
- **Não chega email de marcação** → confirma `NOTIFICATIONS_EMAIL_ENABLED=true`
  e `RESEND_API_KEY` na Vercel, e o Redeploy.
