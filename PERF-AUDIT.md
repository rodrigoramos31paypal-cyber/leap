# LEAP — Performance Audit

Scope: speed / resource optimization only. No feature work. Line references are to the current `main`.

---

## 🚨 Critical Bottlenecks

### 1. Every request (incl. RSC prefetches) pays a round-trip to the Supabase auth server

**Where:** `lib/supabase/middleware.ts` → `supabase.auth.getClaims()` (the `getClaims` call), run on essentially every matched route.

**Why it's the #1 cause of "sluggish":** The code comment is explicit — `getClaims()` only validates the JWT *in-process* (zero network) **when the project uses asymmetric signing keys (ES256/RS256/EdDSA)**. While the project is still on the legacy **HS256 shared secret**, auth-js falls back to `getUser()`, which is a **network call to GoTrue on every request**. Next.js prefetches `<Link>`s on hover/viewport, so a single dashboard with 6–10 links fires 6–10 middleware invocations, each doing a GoTrue round-trip. That round-trip sits on the critical path of every navigation and prefetch — exactly the "feels slow everywhere" symptom.

**Fix (no code change, biggest single win):** In the Supabase dashboard → **Auth → JWT Keys**, migrate the project to asymmetric signing keys (ECC/EdDSA). After migration, `getClaims()` verifies the signature locally and the per-request GoTrue call disappears. Verify with the network tab that navigations no longer block on `…/auth/v1/user`.

**If you cannot migrate yet:** the middleware currently re-validates on prefetch requests too. You are paying full auth cost for requests the user may never visit. Until keys are migrated, gate the heavy validation so prefetches read the cookie only and full validation happens on the real navigation.

---

### 2. Admin Agenda does up to ~8 **sequential** DB round-trips before the calendar paints

**Where:** `app/admin/agenda/page.tsx`, `CalendarView()` (lines ~122–296).

The query chain is serial:

1. `Promise.all([getAccessibleTrainerIds, getCurrentTrainerId])` (125–128) ✅ parallel
2. `show_cancelled_in_calendar` setting (134–141) — **blocks** step 3
3. `Promise.all([bookings, blocks, reserved])` (157–171) ✅ parallel, but waits on step 2
4. `getMyNotesMapForBookings(...)` (175–178) — depends on bookings
5. `purchases` credit rows (194–198) — depends on bookings
6. `bookings` "last credit" rows (219–225) — depends on step 5
7. `trainer_recurring_blocks` (240–244) **then** `trainer_recurring_block_skips` (245–250) — **two separate `await`s, not parallel**
8. `trainer_availability` (285–289) — serial, week view

Steps 2, 7, and 8 are **independent of the bookings payload** and are needlessly waterfalled. On a typical Supabase region hop (~40–80 ms each) this is ~400–600 ms of pure serial latency on the most-opened admin screen.

**Rewrite:** Collapse all booking-independent reads into the *first* batch, and merge the two recurring-block reads:

```ts
const scope = trainerIds.length > 0 ? trainerIds : [""];

// One parallel wave for everything that does NOT depend on `bookings`
const [
  settingRes,
  bookingsRes,
  blocksRes,
  reservedRes,
  recurringBlocksRes,
  blockSkipsRes,
  availRes,
] = await Promise.all([
  myTrainerId
    ? supabase.from("trainer_settings")
        .select("show_cancelled_in_calendar").eq("trainer_id", myTrainerId).maybeSingle()
    : Promise.resolve({ data: null }),
  // build bookingsQuery WITHOUT the showCancelled filter, then drop cancelled in JS
  baseBookingsQuery.order("starts_at"),
  supabase.from("trainer_blocked_times").select("id, trainer_id, starts_at, ends_at, reason")
    .in("trainer_id", scope).gte("starts_at", rangeStart.toISOString()).lt("starts_at", rangeEnd.toISOString()),
  supabase.from("reserved_slots_active").select("series_id, client_id, trainer_id, starts_at, ends_at, client_name")
    .in("trainer_id", scope).gte("starts_at", rangeStart.toISOString()).lt("starts_at", rangeEnd.toISOString()),
  supabase.from("trainer_recurring_blocks").select("id, trainer_id, day_of_week, start_time, end_time, reason, active")
    .in("trainer_id", scope).eq("active", true),
  supabase.from("trainer_recurring_block_skips").select("trainer_id, skip_date")
    .in("trainer_id", scope).gte("skip_date", isoDate(rangeStart)).lt("skip_date", isoDate(rangeEnd)),
  view === "week"
    ? supabase.from("trainer_availability").select("day_of_week, start_time, end_time, active").in("trainer_id", scope).eq("active", true)
    : Promise.resolve({ data: [] }),
]);

const showCancelled = settingRes.data?.show_cancelled_in_calendar ?? false;
let bookings = bookingsRes.data ?? [];
if (!showCancelled) bookings = bookings.filter((b) => b.status !== "cancelled");

// Second (and final) wave: only the two reads that truly need `bookings`
const [notesMap, creditRows] = await Promise.all([
  view === "month" ? new Map() : getMyNotesMapForBookings(bookings.map((b) => b.id)),
  fetchCreditRowsForClients(bookings), // wraps the purchases query
]);
```

This turns ~8 serial hops into **2 waves** (≈2 round-trips of latency). The "last credit" lookup (step 6) can stay conditional inside the second wave.

---

### 3. Client dashboard blocks the whole page on a 3-level waterfall (no streaming)

**Where:** `app/app/dashboard/page.tsx`.

Unlike the admin dashboard (which streams KPIs/today via `<Suspense>`), the client dashboard `await`s everything before the first byte:

- Wave 1: the big `Promise.all([...])` (profile, credits, creditsByTrainer, upcoming, recentPast, latestPack, banners) — good.
- Wave 2: **`presenca` query** (lines ~116–127) — runs *after* wave 1 because it needs `latestPack`.
- Wave 3: **`packPct` query** (lines ~138–150) — runs *after* wave 1 because it needs `barPack`.

Waves 2 and 3 are independent of each other but both run sequentially after wave 1, and the entire route is blocked on all three. This is the client's home screen — the first thing they see after login.

**Rewrite (two changes):**

1. **Parallelize waves 2 & 3.** They don't depend on each other:

```ts
const [presencaData, packBookings] = await Promise.all([
  latestPack
    ? supabase.from("bookings").select("status")
        .eq("client_id", user.id).gte("starts_at", latestPack.created_at)
        .lt("starts_at", nowIso).in("status", ["confirmed", "no_show"])
    : Promise.resolve({ data: [] }),
  barPack
    ? supabase.from("bookings").select("ends_at")
        .eq("purchase_id", barPack.id).in("status", ["booked", "confirmed", "no_show"])
    : Promise.resolve({ data: [] }),
]);
```

2. **Stream the below-the-fold sections** ("O teu progresso" + "Histórico recente") behind `<Suspense>` exactly like the admin dashboard does, so the credits card + CTA buttons (the part the user acts on) paint immediately while the stats resolve.

---

### 4. The image optimizer is configured but disabled for every heavy image

**Where:** `next.config.mjs` declares `images.formats = ["image/avif","image/webp"]`, but the actual heavy images are rendered with raw `<img>` (each with an `eslint-disable @next/next/no-img-element`):

- `components/promo-carousel.tsx:129` — **full-bleed hero banner** on the client dashboard
- `app/admin/loja/page.tsx:74`, `app/app/loja/[categoria]/page.tsx:50` — **store product photos**
- `app/app/dashboard/page.tsx:205`, `app/t/[slug]/page.tsx:106`, `components/avatar-uploader.tsx:74` — avatars

Because these are raw `<img>` pointing at Supabase Storage URLs, they **bypass the Vercel image optimizer entirely** — no AVIF/WebP, no resizing, no `srcset`, served at whatever resolution was uploaded. The promo banner and product grids are the largest image payloads in the app and get zero optimization. The raw tags also omit `width`/`height`, causing layout shift (CLS).

**Fix:** Replace these with `next/image`, allow the Supabase storage host in `images.remotePatterns`, and pass explicit `sizes`. The promo hero alone (a wide image scaled into an `h-28` card on mobile) is likely shipping hundreds of KB it doesn't need. This is the single biggest payload win.

---

## ⚡ Quick Wins

- **`/t/[slug]` is `force-dynamic` but fully public** (`app/t/[slug]/page.tsx:15`). It carries no per-user session. Switch from `force-dynamic` to ISR/stale-while-revalidate (`export const revalidate = 300;` and drop the `force-dynamic`). Public, indexable, shareable pages should be served from the CDN, not recomputed per request. Immediate TTFB win for the most shared URL.

- **Defer the layout notification count.** Both `app/app/layout.tsx` and `app/admin/layout.tsx` run an extra `notifications` count query (`select("id",{count:"exact",head:true})`) on **every navigation**, blocking layout render. The `<NotificationBell>` is a client component that already refreshes itself (realtime + 120 s poll + on-visibility). Pass `initialUnread={0}` and let the bell hydrate the count, or wrap the count in `<Suspense>`. Removes one blocking DB hop from every page load.

- **Avatar in client dashboard (`app/app/dashboard/page.tsx:205`)** and the promo `<style>` injection are minor, but the per-card injected `<style>` tag in `promo-carousel.tsx` (one per banner) is avoidable — set `aspectRatio` via inline `style` on the element instead of emitting a `<style>` block per slide.

- **`getClientIdsInScope` (`lib/trainer.ts`)** issues 3 parallel reads + 1 follow-up filter read to strip `@removido.invalid` accounts. You already have a `count_clients_in_scope` RPC fallback; push the `@removido.invalid` exclusion into the SQL (`WHERE email NOT LIKE '%@removido.invalid'`) so the final filter round-trip disappears.

- **Confirm `optimizePackageImports: ["lucide-react"]` is actually taking effect** (it's set in `next.config.mjs`). With ~10 icons imported per layout/dashboard, verify the build output tree-shakes to per-icon modules; if any file does `import * as Icons from "lucide-react"` it defeats it. (Current imports look named/correct — just verify in the bundle analyzer.)

- **`reactStrictMode: true`** double-invokes effects in dev only (no prod cost) — fine to keep. Noting it so it isn't mistaken for a prod issue.

---

## What's already good (don't touch)

- Middleware **skips auth entirely** for cron/push/webhook/calendar-feed routes (`lib/supabase/middleware.ts`) — correct.
- Admin dashboard and agenda already use **Suspense streaming** with shape-matched skeletons — no CLS, fast shell.
- `getSessionUser` / `getCurrentProfile` / `getAccessibleTrainerIds` are wrapped in **`React.cache()`** — properly deduped per request.
- Notification bell poll already tuned to 120 s with realtime + visibility refresh — leave it.
- `exceljs` and `web-push` are imported **only in API routes** — they never reach the client bundle.

---

### Suggested order of attack
1. Migrate Supabase to asymmetric JWT keys (#1) — zero code, kills per-request auth latency.
2. Parallelize the Agenda waterfall (#2) and stream the client dashboard (#3).
3. Move heavy images to `next/image` (#4).
4. Pick off the Quick Wins.
