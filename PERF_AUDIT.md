# LEAP — Performance Audit (stable baseline)

**Date:** 2026-06-16
**Method:** Full read of routing, data layer, middleware, client components, build config.
**Scope:** Speed / rendering / resource use only. No feature work.

> ## How to use this file
> This is a **living inventory**, not a one-shot highlight reel. The reason earlier audits
> kept surfacing a *different* "critical bottleneck" each run is that the prompt asked for
> *the biggest* problems and a short list — so each pass ranked and reported only the top
> few, and which few rose to the top varied run to run (fresh exploration each time, no
> memory between runs, normal model non-determinism).
>
> To stop that: keep **every** finding here with a fixed ID, a severity, and a status. On
> future audits, *update this file* (flip `Status`, add new rows) rather than regenerating.

**Severity:** 🟥 Critical · 🟧 High · 🟨 Medium · 🟦 Low / quick win
**Status:** `OPEN` · `IN PROGRESS` · `FIXED` · `ACCEPTED` (known trade-off) · `CANCELLED` (investigated, not worth doing) · `SKIPPED` (low value / small risk, left alone)

---

## Progress log — 2026-06-16

Actions taken this session, and *why* the plan changed after deeper checks:

- **P-02 — FIXED & shipped.** Moved the empty-banners guard below all hooks in
  `components/promo-carousel.tsx`. Verified: type-check clean, lint no longer reports the
  rules-of-hooks error. Committed and pushed to `main`.
- **P-04 — done in code, awaiting commit.** Investigation found the project is **already on
  ES256 asymmetric JWTs** (the JWKS endpoint publishes an EC P-256 signing key), so the
  middleware's `getClaims()` already validates locally — no round-trip there. The real
  remaining cost was `getCurrentProfile()` calling `getUser()` (a GoTrue round-trip) on
  **every authenticated page load**, via both layouts. Switched it to local `getClaims()`
  validation (same pattern the middleware uses). Type-check clean; MFA flow keeps strict
  `getAuthUser()`. *The "migrate to RS256" idea in the original P-04 was unnecessary — you
  were already on asymmetric keys.*
- **P-05 — done in code, needs migration + commit.** Added migration
  `0084_perf_dashboard_kpis.sql` (a `SECURITY INVOKER` RPC that aggregates
  revenue / packs / pending / per-status session counts / distinct active
  clients in one round-trip) and switched `app/admin/dashboard/page.tsx`
  `Kpis()` to call it, **with a fallback to the old fetch+JS path** so a
  mis-ordered deploy can't break the dashboard. Type-check clean; math
  verified identical to the old code. *Apply the migration first, then push.*
- **P-01 — CANCELLED after investigation.** It is **not** a small/clean fix. All-route
  dynamic rendering is driven by the **nonce-based CSP** itself (a fresh per-request nonce
  must be read for scripts to run), not just the one `headers()` line. Making routes static
  would require dropping the nonce for a weaker CSP — a real security regression. The repo's
  own comment in `lib/public-trainer.ts` already reached this conclusion. Declined.
- **P-03 — DEFERRED.** Re-enabling ESLint in the build requires a clean `lint` first, but
  `eslint --fix` in this repo has a bug that **truncates files** and flips line endings
  (it corrupted `promo-carousel.tsx` mid-session; recovered from git). Until that tooling
  bug is understood, do **not** run `lint --fix` here. Left `eslint.ignoreDuringBuilds` as-is.
- **P-08 / P-09 / P-10 — SKIPPED.** Cosmetic / marginal value with a small risk of
  unintended visual change (e.g. dropping "Inter" changes rendering for users who have the
  font locally). Left untouched in keeping with "don't change what already works."

> ⚠️ **Environment hazard noted:** the editor's format/lint-on-save on this folder rewrites
> files on every save and has truncated files twice. Recommend disabling format/lint-on-save
> for this project until fixed. Edits this session were applied via shell to avoid it.

---

## Findings index

| ID | Sev | Area | Title | Status |
|----|-----|------|-------|--------|
| P-01 | 🟥 | Rendering | Root layout `headers()` / nonce-CSP forces whole app into dynamic SSR | CANCELLED |
| P-02 | 🟥 | Correctness/Render | `promo-carousel.tsx` Rules-of-Hooks violation | FIXED |
| P-03 | 🟧 | Build hygiene | `eslint.ignoreDuringBuilds: true` ships bugs / hides regressions | DEFERRED |
| P-04 | 🟧 | Edge/Auth | `getCurrentProfile()` did a GoTrue round-trip (`getUser`) on every page | FIXED |
| P-05 | 🟧 | Data | Admin dashboard KPIs over-fetch rows and aggregate in JS | FIXED (code; migration + commit pending) |
| P-06 | 🟨 | Data | Client dashboard "BelowFold" fetches full rows to compute counts | OPEN |
| P-07 | 🟨 | UX/CLS | Promo banner computes `aspect-ratio` from `onLoad` → layout shift | OPEN |
| P-08 | 🟨 | Assets | `font-family: Inter` declared but no font is loaded (dead intent) | SKIPPED |
| P-09 | 🟦 | Images | Above-the-fold images lack `priority` / explicit `sizes` audit | SKIPPED |
| P-10 | 🟦 | Edge | API routes could declare `runtime`/`revalidate` explicitly | SKIPPED |
| P-11 | 🟦 | Realtime | `NotificationBell` realtime + poll + immediate refresh redundancy | ACCEPTED |
| P-12 | 🟦 | Data | `listMyNotes` `IN (bookingIds)` can grow unbounded | OPEN |

---

## 🟥 Critical

### P-01 — Nonce-based CSP forces app-wide dynamic rendering — CANCELLED
**Files:** `app/layout.tsx`, `lib/security-headers.ts`, `middleware.ts`
**What:** `script-src` uses `'nonce-<per-request>' 'strict-dynamic'`. A fresh nonce must be
generated and read on every request for scripts to be allowed to execute, which is
fundamentally incompatible with static rendering / Full Route Cache / ISR. The `headers()`
call in the root layout is a symptom, not the sole cause — removing it alone would break the
service-worker script while everything stayed dynamic.
**Why cancelled:** the only way to make routes static is to drop the nonce and adopt a weaker
CSP (`'unsafe-inline'` or a brittle hash setup) — a genuine security regression. The codebase
already documents this trade-off (`lib/public-trainer.ts`). Not worth weakening security, and
a CSP change can't be safely verified without a browser on a preview deploy anyway.
**Better lever instead:** since rendering stays dynamic, make each dynamic render cheap →
that's what P-04 does (removes the per-request auth round-trip) and P-05/P-06 (cheaper queries).

### P-02 — Rules-of-Hooks violation in the promo carousel — FIXED
**File:** `components/promo-carousel.tsx`
The early `if (!banners.length) return null;` sat *between* `useRef` and `useEffect`, so an
empty `banners` rendered fewer hooks than a populated one. Moved the guard below all hooks.
This was also the lone real error forcing `eslint.ignoreDuringBuilds` (see P-03).
**Verified:** type-check clean; lint no longer flags it. **Committed & pushed.**

---

## 🟧 High

### P-03 — ESLint disabled during builds — DEFERRED (tooling hazard)
`next.config.mjs` keeps `eslint: { ignoreDuringBuilds: true }`. The remaining lint errors are
~20 cosmetic `react/no-unescaped-entities` (PT quotes). Re-enabling requires a clean lint
first, but **`eslint --fix` truncates files in this repo** — a real tooling bug that must be
resolved before touching lint here. Fix the quote escapes *by hand* (not `--fix`) later, then
remove the flag. Left as-is for safety.

### P-04 — Per-request auth round-trip on every authenticated page — FIXED
**File:** `lib/supabase/server.ts`
`getCurrentProfile()` (run in both `app/app/layout.tsx` and `app/admin/layout.tsx`, i.e. every
authenticated navigation) called `getAuthUser()` → `supabase.auth.getUser()`, a network
round-trip to GoTrue. The project is on **ES256 asymmetric keys**, so the JWT can be verified
**in-process** with `getClaims()` (no network) — the same approach the middleware already uses.
Added a `getClaimsUser()` helper and switched `getCurrentProfile()` to it.
**Trade-off (accepted):** `getClaims()` trusts a cryptographically-valid token until it expires,
so server-side revocation (sign-out elsewhere / ban) can lag up to the access-token TTL. Mitigated
by (1) `role` re-read from `profiles` each request → admin demotion caught live; (2) MFA/security
flows keep strict `getAuthUser()`. **Verified:** type-check clean. *Awaiting commit.*
**Note:** the original "migrate to RS256" framing was moot — the project was already asymmetric.

### P-05 — Admin dashboard KPIs aggregate in JS over full row sets — FIXED (code)
**File:** `app/admin/dashboard/page.tsx` → `Kpis()`
`monthBookings` selects `status, client_id` for every booking in the month across all in-scope
trainers, then loops in JS (status counts + active-clients `Set`). Same for revenue reduce.
Grows unbounded with volume. Move aggregation into Postgres (per-status `count`, or a single
`get_dashboard_kpis(...)` RPC). **Done:** migration `0084_perf_dashboard_kpis.sql` + `Kpis()` now calls the RPC (with a fallback to the old path). Rollout: apply migration 0084 to Supabase, sanity-check the dashboard numbers vs a known month, then push the code.

---

## 🟨 Medium

### P-06 — Client dashboard counts via full-row fetches — OPEN
`app/app/dashboard/page.tsx` → `BelowFold()` fetches `status` / `ends_at` rows to count in JS.
Convert to DB-side counts. Lower priority (single client's pack, small row sets). Pairs with P-05.

### P-07 — Promo banner causes layout shift (CLS) — OPEN
`components/promo-carousel.tsx` → `PromoCard` derives desktop height from the image ratio read in
`onLoad`, so the slide resizes after load. Reserve the box with a fixed `aspect-[3/1]` (or known
dimensions from the DB record).

### P-08 — Declared font never loaded — SKIPPED
`app/globals.css` names `Inter` first but no font is loaded (silent fallback to system-ui).
Perf-wise harmless. Left alone: dropping it would change rendering for users who have Inter
installed locally — not worth the cosmetic churn.

---

## 🟦 Low / quick wins

### P-09 — Image priority hints — SKIPPED (marginal)
Above-the-fold images could set `priority` and audited `sizes`. Low value; left alone.

### P-10 — Explicit runtime/revalidate on API routes — SKIPPED (marginal)
`force-dynamic` cron/push/feed routes are correct; declaring `runtime`/`revalidate` explicitly is
nice-to-have, not impactful.

### P-11 — NotificationBell redundancy — ACCEPTED
Realtime + 120s background-paused poll + mount refresh is deliberate belt-and-suspenders; cheap. Leave.

### P-12 — `listMyNotes` `IN (bookingIds)` can grow large — OPEN
`lib/notes.ts`: unbounded `IN (...)` for clients with many bookings. Cap it, or filter server-side
via join/RPC. Low urgency.

---

## What's already done well (don't re-flag as new)

- Above-the-fold `<Suspense>` streaming on dashboards and agenda.
- `Promise.all` fan-out (no request waterfalls in reviewed pages).
- `React.cache()` dedup on `getSessionUser`/`getClaimsUser`/`getCurrentProfile`/credits per request.
- `unstable_cache` (Data Cache) on `getPublicTrainerBySlug` and `getActiveTrainersPublic` with tags.
- **ES256 asymmetric JWTs** → middleware validates locally; now `getCurrentProfile` too (P-04).
- Server-only heavy deps (`exceljs`, `web-push`, supabase) externalized from serverless bundles.
- `optimizePackageImports: ["lucide-react"]`.
- Heavy agenda dialogs `dynamic(..., { ssr: false })` out of the initial bundle.
- Notification badge query removed from layouts; SSR-painted first promo slide w/ ssr:false swap.
- `next/image` AVIF/WebP + Supabase remote pattern.

---

## Remaining backlog & suggested order
1. **P-05 / P-06** — DB-side aggregation (needs a SQL migration you run + verify numbers match).
2. **P-07** — reserve banner box to kill CLS (small, improves Lighthouse).
3. **P-12** — bound the notes `IN (...)` query.
4. **P-03** — fix the `eslint --fix` tooling bug, escape PT quotes by hand, then re-enable lint in build.
5. **P-01** — only if you ever decide to trade CSP strength for static rendering (not recommended).

## Keeping this stable
Re-run the exhaustive audit prompt and ask the model to *update this file* (flip statuses, append
IDs) rather than starting fresh. Pair with `next build` (bundle/route report), Lighthouse, and
`npm run type-check` so baseline numbers don't drift between runs.
