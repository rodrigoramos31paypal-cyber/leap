# LEAP — Security Audit (June 2026, independent re-review)

**Reviewer posture:** adversarial / paranoid. Threat actors modelled: anonymous attacker on public endpoints, authenticated-but-malicious client, and a malicious/semi-trusted **trainer** in a multi-trainer studio. Application code + SQL migrations reviewed; live Supabase RLS/grants and the production env were *not* directly observable and are flagged where they matter.

---

## Scope correction (read this first)

The brief assumed **Stripe + Eupago**, a **real-time bidding/auction engine**, **invoices**, and **webhooks**. **None of these exist in this codebase.** What is actually here:

- **Payments:** *manual only* — MB WAY / Revolut / cash, confirmed by an admin in-app. The IfthenPay gateway that used to exist was **removed** (`0082_remove_ifthenpay.sql`). **There is no payment webhook handler, no Stripe, no Eupago.** So "webhook signature verification", "replay attacks", and "double-charge via idempotency keys" have no live attack surface today.
- **Domain:** a personal-training studio — bookings, packs/credits, clients. **No bidding, no auction.** The integrity-critical equivalent is the **booking + credit ledger** (Postgres `SECURITY DEFINER` RPCs), which I audited in place of the non-existent auction engine.
- **Stack:** Next.js 14 App Router, Supabase (Postgres + RLS + SECURITY DEFINER RPCs), Upstash rate-limiting, Vercel.

There is also a prior `SECURITY-AUDIT.md` in the repo. **It is now largely stale** — its headline findings are fixed:
- C1 (JSON-LD XSS on `/t/[slug]`) → **fixed**: `jsonLdSafe()` escapes `< > & U+2028/9` and bio is sanitised at write (`definicoes/actions.ts:24`).
- H1 (form-supplied `trainerId` IDOR) → **fixed** in `saveTrainerBioAction` / `saveSettingsAction`.
- H2 (authz boundary) → **partly fixed**: `requireStaff()`/`requireOwner()` now exist and are used.
- H3 (IfthenPay callback) → **moot**: integration removed.

Net assessment: **this is a well-secured codebase.** Nonce CSP, full security-header set, per-trainer RLS write-scoping, advisory-lock booking concurrency, CSV formula-injection escaping, scoped+audited PII export, OAuth-state CSRF, open-redirect defence, and gitignored secrets are all already in place. The findings below are the *real* remaining gaps, honestly graded.

---

## 🚨 Critical Vulnerabilities (Fix Immediately)

### C-1 — Admin credit/client RPCs gate on *role* only, not *trainer scope* → cross-trainer financial fraud & PII destruction

**Severity:** Critical **in a multi-trainer deployment**; low impact if the studio only ever has a single owner/trainer. Grade it Critical because the customer's stated model is "a gym where he hosts personal-trainer sessions" — more than one trainer is plausible.

**Files:**
- `supabase/migrations/0015_security_harden_rpcs.sql` — `confirm_purchase` (line 43), `adjust_credits` (line 131)
- `supabase/migrations/0081_admin_client_management.sql` — `anonymize_client_account` (line 35)
- Callers: `app/admin/clientes/[id]/actions.ts` — `adjustCreditsAction:20`, `grantPackAction:49`, `adminDeleteClientAction:177`, `setClientBannedAction:242`

Every one of these RPCs authorises with only:

```sql
if not _is_service_or_admin() then            -- = auth.uid() IS NULL OR is_admin()
  raise exception 'access denied' using errcode = '42501';
end if;
-- ...then operates on p_purchase_id / p_client_id taken verbatim from the caller
```

and `is_admin()` is **role-based** (`role in ('trainer','owner')`). There is **no check that the target `purchase`/`client` belongs to the caller's accessible trainer(s).**

This is *not* protected by the good per-trainer RLS work in `0051_scope_trainer_resource_writes.sql`: those policies scope **table writes** (`packs`, `trainer_settings`, `trainer_availability`, `trainers`) via `_trainer_is_accessible(trainer_id)`. But these operations go through **`SECURITY DEFINER` RPCs that run as the owner and bypass RLS entirely** — so the scoping never applies.

**Exploit (trainer A against trainer B's data):**
- `adjust_credits(any_purchase_id, +999, '...')` → grant unlimited free sessions to any purchase → direct financial loss.
- `confirm_purchase` / `create_custom_purchase` for any client → conjure paid packs for free.
- `anonymize_client_account(any_client_id)` → wipe any client's PII (name/email/phone/notes/notifications) and rotate their calendar token, locking them out. (It only blocks targeting non-`client` roles, so trainers can't nuke each other — but they can nuke *each other's clients*.)

The server actions sit behind `requireStaff()`, i.e. *any* trainer, so the action layer does not constrain this either.

**Fix — enforce trainer scope inside each RPC** (defence at the DB, where it can't be bypassed). Example for `adjust_credits`:

```sql
if not _is_service_or_admin() then
  raise exception 'access denied' using errcode = '42501';
end if;

select * into v_purchase from purchases where id = p_purchase_id for update;
if not found then raise exception 'Compra não encontrada'; end if;

-- NEW: non-owner staff may only touch purchases of trainers they manage.
if auth.uid() is not null and not is_owner()
   and not _trainer_is_accessible(v_purchase.trainer_id) then
  raise exception 'access denied (scope)' using errcode = '42501';
end if;
```

Apply the same `_trainer_is_accessible(...)` (or, for client targets, a "client is in my scope" check using the `count_clients_in_scope` union logic from `0081`) to `confirm_purchase`, `create_custom_purchase`, `remove_client_sessions`, `cancel_confirmed_purchase`, `set_client_banned`, and `anonymize_client_account`. Service-role (`auth.uid() IS NULL`) and `owner` keep full access.

**And** at the action layer, make destructive client ops owner-only (see H-2).

> If you confirm in Supabase that this studio will only ever have one staff account, downgrade C-1 to Low and treat the action-layer hardening (H-2) as sufficient. The DB fix is still worth doing before you ever onboard a second trainer.

---

## 🛡️ High-Risk Exposures

### H-1 — Authorization decisions read an *unverified* session (`getSession()`), not `getUser()`/`getClaims()`

**Files:** `lib/supabase/server.ts` — `getSessionUser` (lines 39–43) → used by `getCurrentProfile` (53–63) → used by `requireStaff`/`requireOwner` in `lib/authz.ts`.

`getSession()` decodes the session **from the cookie without verifying the JWT signature** (Supabase's own docs warn: never trust `getSession()` for authorization on the server). Your role guard then looks up `role` by the `user.id` taken from that unverified token. Today this is backstopped by `middleware.ts`, which runs `getClaims()` (signature-verifying, or `getUser()` fallback on legacy HS256) on every non-public path — so a forged cookie is rejected before the action runs. But the **guard itself does not validate**, so security depends entirely on middleware ordering and matcher coverage never regressing.

**Fix:** make the boundary self-sufficient. In `getCurrentProfile`, resolve identity via `getClaims()` (verifies in-process) or `getAuthUser()` (you already have it, `server.ts:46`) instead of `getSessionUser()`. The extra cost is deduplicated by `React.cache()`.

### H-2 — Destructive client operations are available to *any* trainer (should be owner-only)

**File:** `app/admin/clientes/[id]/actions.ts` — `adminDeleteClientAction:177` and `setClientBannedAction:242` call `requireStaff()` (trainer **or** owner).

Anonymising/deleting a client account and banning a client are owner-grade, irreversible actions. Even setting aside the scope issue in C-1, least privilege says a regular trainer should not be able to delete client accounts.

**Fix:** swap `await requireStaff();` → `await requireOwner();` in both. (Keep `adjustCreditsAction`/`grantPackAction` as staff, but scope them per C-1.)

### H-3 — Rate-limiting is best-effort and unevenly applied

**Files:** `lib/rate-limit.ts`, `middleware.ts:27-35`, `.env.example:41-52`.

1. **In-memory fallback when Upstash isn't configured.** `.env.example` ships `UPSTASH_REDIS_REST_URL`/`_TOKEN` blank (and its comment still says the limiter "degrada para no-op", which is stale — the code now does in-memory). On Vercel's serverless/edge fan-out, an in-memory sliding window is **per-instance**, so the effective login/registration brute-force limit is `5 × (number of warm instances)` per minute, and resets on cold start. If `UPSTASH_*` is unset in production, anti-brute-force is materially weaker than it looks.
   **Fix:** treat Upstash as **required in production** — log-and-alert loudly (you already `console.error`) and consider failing health checks when it's missing.

2. **Coverage gaps.** Only `/login`, `/registar`, `/recuperar`, `/auth/reset` (POST) and the non-existent `/api/webhooks/*` are limited. Not limited: `GET /api/slots` (runs availability computation — cheap enumeration/DoS), `GET /api/bookings/[id]/ics`, `POST /api/notifications/read`, and the `startPurchaseAction` server action (lets a client spam pending `purchases` rows). The two export routes correctly self-limit.
   **Fix:** add a `generic` bucket to `/api/slots` and the notification/ics routes keyed by user-id/IP, and a small per-user limit on purchase creation.

### H-4 — App-layer ownership checks are inconsistent on availability/block actions (defence-in-depth gap)

**File:** `app/admin/definicoes/actions.ts` — `addAvailabilityAction:68`, `updateAvailabilityAction:115`, `deleteAvailabilityAction:136`, `deleteBlockAction:145`, `addBlockAction:156`.

These take `trainerId`/`id` straight from the form and act on them; unlike the sibling `saveTrainerBioAction`/`saveSettingsAction`, they perform **no explicit ownership check**. I verified this is **not currently exploitable** because RLS (`0051` for availability, `0028` for blocked-times) scopes writes via `_trainer_is_accessible(trainer_id)`. But the inconsistency means the app relies on those exact policies remaining perfect — one dropped/edited policy and these become a cross-trainer IDOR. Mirror the H1 fix (`if profile.role !== 'owner' && trainerId !== (await getCurrentTrainerId())) return;`) for parity and a second layer. For the by-`id` variants, fetch the row's `trainer_id` first and check it.

---

## 🔐 Security Best Practices

- **Constant-time secret comparison for cron/push.** `app/api/cron/*/route.ts` and `app/api/push/dispatch/route.ts` use `auth !== \`Bearer ${secret}\``. You already have a `timingSafeEqual` helper pattern in `app/api/integrations/[provider]/callback/route.ts:10` — reuse it so the `CRON_SECRET` check is constant-time and consistent.
- **Build-time safety nets are disabled.** `next.config.mjs` sets `typescript.ignoreBuildErrors: true` *and* `eslint.ignoreDuringBuilds: true`. Combined with the many `(supabase as any)` casts around RLS-sensitive queries, a type error that masks a real auth/scope bug won't block a deploy. Your `CLAUDE.md` already mandates `npm run type-check` before pushing — enforce it in CI (a GitHub Action gate) rather than by convention, and burn down the `as any` casts by regenerating Supabase types.
- **Booking no-overlap now rests solely on the advisory lock.** The `EXCLUDE USING gist` constraint added in `0025` was intentionally dropped in `0070_allow_intentional_overlap.sql` to permit forced duration overlaps. Concurrency safety is now entirely `pg_advisory_xact_lock(hashtextextended(trainer_id,0))` at the top of every booking RPC. I checked the current paths (`create_booking`, `create_booking_admin`, recurring, reschedule, duration-update) and they all take it — but there is no structural guarantee a *future* RPC won't forget it. Consider a partial `EXCLUDE` constraint that still allows the one intentional-overlap path, or a regression test that asserts concurrent same-slot inserts collapse to one.
- **Avatar upload trusts client-declared MIME.** `saveTrainerAvatarAction` (`definicoes/actions.ts:178`) derives extension/content-type from `file.type`. Risk is low (ownership-checked, served from a separate `*.supabase.co` origin, SVG not allowed), but sniff magic bytes before upload as belt-and-suspenders.
- **Calendar-feed token shape is loose.** `/api/calendar/feed/[token]` validates `/^[0-9a-f-]{36}$/i`, which also accepts non-UUID strings like all-dashes. Harmless (exact-match query) but tighten to a real UUID regex. The token is a bearer secret carried in the URL — make sure your Vercel log drain scrubs it (same applies to any query-string secret).
- **`zod` is a dependency but imported nowhere.** All input handling is manual `String(...)`/`Number(...)` — careful today, but adopting zod schemas at each server-action/route boundary makes validation declarative and would structurally prevent the "trusted a raw form field" class (C-1/H-4).
- **Confirmed clean / strong (no action):** no `dangerouslySetInnerHTML` with user input outside the fixed JSON-LD; no string-built SQL (all PostgREST/parameterised RPC) → no SQL/NoSQL injection surface; no `NEXT_PUBLIC_` secret leakage (only anon key, app URL/name, VAPID **public** key, business MB WAY phone are public); `SUPABASE_SERVICE_ROLE_KEY` is server-only; secrets are gitignored (`.env*.local`, `.env`); CSP nonce + `strict-dynamic` + `object-src 'none'` + `frame-ancestors 'none'` + `form-action 'self'`; HSTS/XFO/nosniff/Referrer-Policy/Permissions-Policy/COOP all set; open-redirect blocked by `isSafePath`; CSV export neutralises formula injection; PII export is self/trainer-scoped, time-windowed, and **fail-closed on audit-log failure**.

---

## Priority order

1. **C-1** — add trainer-scope checks inside the credit/client `SECURITY DEFINER` RPCs (financial + PII integrity across trainers). Verify your staff model first; if truly single-owner, this drops to Low.
2. **H-2** — make `adminDeleteClientAction` / `setClientBannedAction` `requireOwner()`.
3. **H-1** — authorize via `getClaims()`/`getUser()` in `getCurrentProfile`, not `getSession()`.
4. **H-3** — require Upstash in prod; add rate limits to `/api/slots`, ics, notifications, and purchase creation.
5. **H-4** + best-practice cleanup.

> Caveat: severity for C-1/H-2/H-4 assumes the role-based-vs-ownership behaviour visible in the migrations. I audited application code and SQL files; I could not read the *live* Supabase policies/grants. Confirm the deployed `is_admin()`, `is_owner()`, `_trainer_is_accessible()`, and the RPC grants match these files before standing down.
