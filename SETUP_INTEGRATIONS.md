# LEAP-FITNESS · Setup de integrações externas

Três integrações a configurar fora do código: **Resend** (emails), **Google Calendar** (sync) e **Microsoft 365 / Outlook** (sync). Todas opcionais — o portal funciona sem elas.

Depois de cada setup, copia os valores para `.env.local` e reinicia `npm run dev`.

---

## 1. Resend (emails de confirmação/cancelamento)

**O que faz:** envia emails ao cliente (sessão marcada, cancelada, confirmada, pack ativo) e ao admin (nova marcação, pagamento pendente).

### Passos

1. Cria conta em https://resend.com (3.000 emails/mês grátis).
2. **Add Domain** → adiciona `leap-fitness.pt` (ou outro). Resend dá-te 4 registos DNS (SPF/DKIM/MX) para colares no painel do registrar (Cloudflare, Namecheap, etc.). Espera 5-30 min até verificar.
   - **Atalho de teste:** se ainda não tens domínio, podes usar `onboarding@resend.dev` como remetente sem verificação (só funciona para o teu email da conta Resend).
3. **API Keys** → **Create API Key** → nome "LEAP portal" → copia o valor (`re_...`). Só o vês uma vez.
4. Em `.env.local`:

```env
NOTIFICATIONS_EMAIL_ENABLED=true
RESEND_API_KEY=re_xxx
NOTIFICATION_FROM_EMAIL=no-reply@leap-fitness.pt   # ou onboarding@resend.dev para teste
```

5. Reinicia o `npm run dev`. Marca uma sessão de teste — vê chegar email.

---

## 2. Google Calendar (sync admin agenda)

**O que faz:** quando um cliente marca uma sessão, ela aparece automaticamente no Google Calendar do João. Quando cancela, é removida.

### Passos

1. Vai a https://console.cloud.google.com → cria/seleciona um projeto (ex: "LEAP-FITNESS Portal").
2. **APIs & Services** → **Library** → procura **Google Calendar API** → **Enable**.
3. **APIs & Services** → **OAuth consent screen**:
   - User type: **External**.
   - App name: "LEAP-FITNESS Portal".
   - User support email: o teu.
   - Developer contact: o teu.
   - Scopes: adiciona `auth/calendar.events`.
   - Test users: adiciona o email do João (enquanto a app não estiver publicada, só users em "Test users" podem ligar).
   - Save.
4. **Credentials** → **Create Credentials** → **OAuth client ID**:
   - Application type: **Web application**.
   - Name: "LEAP Portal".
   - Authorized JavaScript origins: `http://localhost:3000` (e o domínio prod quando tiveres, ex: `https://portal.leap-fitness.pt`).
   - Authorized redirect URIs: `http://localhost:3000/api/integrations/google/callback` (e `https://portal.leap-fitness.pt/api/integrations/google/callback`).
   - Create. Vais ver **Client ID** e **Client Secret**.
5. Em `.env.local`:

```env
GOOGLE_OAUTH_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxx
```

6. Reinicia. No portal: **Admin → Definições → Sincronizar calendário → Ligar (Google)**. Aceita o consent screen, voltas e fica "Ligado".

---

## 3. Microsoft 365 / Outlook (sync admin agenda)

**O que faz:** mesmo que Google, mas para o Outlook do João (calendar.microsoft.com / Outlook desktop).

### Passos

1. Vai a https://portal.azure.com → **Microsoft Entra ID** (antigo Azure AD) → **App registrations** → **New registration**.
2. Preenche:
   - Name: "LEAP-FITNESS Portal".
   - Supported account types: **Personal Microsoft accounts and accounts in any organizational directory** (multi-tenant + pessoal).
   - Redirect URI: **Web** → `http://localhost:3000/api/integrations/microsoft/callback`.
   - Register.
3. Na app criada → **Authentication** → **Add a platform** → **Web** → adiciona também `https://portal.leap-fitness.pt/api/integrations/microsoft/callback` quando tiveres prod.
4. **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions** → marca:
   - `Calendars.ReadWrite`
   - `offline_access`
   - `openid`
   - `email`
   - Add permissions.
5. **Certificates & secrets** → **New client secret** → descrição "LEAP portal", expira em 24 meses → cria. **Copia o "Value"** imediatamente (só aparece uma vez).
6. Em **Overview**: copia **Application (client) ID**.
7. Em `.env.local`:

```env
MICROSOFT_OAUTH_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MICROSOFT_OAUTH_CLIENT_SECRET=xxx
```

8. Reinicia. No portal: **Admin → Definições → Sincronizar calendário → Ligar (Outlook)**.

---

## 4. Atualizar a base de dados

Antes de a sincronização funcionar, corre a migration `0007_calendar_integrations.sql` no SQL Editor do Supabase. Também há a `0005_booking_immediate_credit.sql` (fluxo de créditos imediato) e `0006_payment_notify_admin.sql` (notificação admin em pagamento pendente) caso ainda não tenhas corrido.

Ordem:
1. `0005_booking_immediate_credit.sql`
2. `0006_payment_notify_admin.sql`
3. `0007_calendar_integrations.sql`

---

## 5. Em produção

Quando fizeres deploy à Vercel:
- Copia **todas** as env vars do `.env.local` para Vercel → Project Settings → Environment Variables.
- Em cada integração (Google, Microsoft, Resend domain), adiciona o domínio de produção aos redirect URIs / domínios autorizados.
- Republica a OAuth consent screen do Google de "Testing" para "In production" para qualquer cliente conseguir ligar (não só users de teste). Pode pedir verificação Google se pedires scopes sensíveis — `calendar.events` não pede.

---

## Troubleshooting

- **"OAuth client was not found"** → client_id errado, ou app ainda em modo "Testing" e o email não está em "Test users" (Google).
- **"AADSTS50011: The redirect URI specified in the request does not match"** → o `NEXT_PUBLIC_APP_URL` no `.env.local` tem de bater certo com o que registaste em Azure / Google. Sem `/` no fim.
- **Sem email a chegar** → confirma `NOTIFICATIONS_EMAIL_ENABLED=true`, key Resend válida, e domínio verificado (ou usa `onboarding@resend.dev` como `NOTIFICATION_FROM_EMAIL` para teste rápido).
- **Eventos não aparecem no Google Calendar** → confirma na consent screen que "Calendar.events" está marcado. Ver consola do `npm run dev` para erros de push.
