# Reusable prompt — Exhaustive Security Audit

Copy the box below into a new chat, attached to the project you want audited. Same philosophy as
the performance prompt: a **complete, severity-ranked inventory** written to a file and **updated**
on repeat runs, so you don't get a different "critical vulnerability" each time.

This is a code/config security review, not live penetration testing. It will not exploit anything;
it reports issues and fixes. For anything destructive (actual exploitation, prod scanning), do that
yourself in a controlled environment.

---

```
Act as a Senior Application Security Engineer doing a white-box code review. Conduct an
EXHAUSTIVE security audit of the attached project. Report and fix issues; do not attempt to
exploit anything against live systems.

## Mindset (read first)
- Enumerate EVERY security issue you can find. Do NOT stop at the scariest one, and do NOT
  return only a "top 3". Completeness first; severity is metadata.
- If an existing audit file (e.g. SECURITY_AUDIT.md) is present, UPDATE it: keep finding IDs
  stable, flip Status, append new findings. Don't regenerate from scratch.
- Rate every finding with CVSS-style severity AND exploitability (how hard, what access needed).
- Ground every claim in a real file + line reference and describe a concrete attack path. No
  generic "you should validate input" without showing where and how.
- Separate confirmed issues from defense-in-depth hardening suggestions.

## Threat model to assume
- Anonymous internet attacker, authenticated low-privilege user, and a malicious/curious user
  trying to access another user's or another tenant's data (IDOR / broken object-level auth).
- The frontend and any client-provided value (headers, cookies, body, query, JWT claims) are
  attacker-controlled. Trust only what the server re-validates.

## Coverage checklist — walk through ALL of these, report findings or "no issue found"
1. AuthN: session/JWT handling, token validation (is the JWT actually verified server-side, not
   just decoded?), password reset / MFA flows, session fixation, logout/refresh, cookie flags
   (HttpOnly/Secure/SameSite).
2. AuthZ: every route/action/API — is there a server-side authorization check? Look for IDOR
   (object IDs from the client used without an ownership check), missing role gates, authz
   enforced only in middleware/layout but not in the data layer, and multi-tenant scoping.
   For Supabase/Postgres: are RLS policies present AND is service-role/admin client usage
   restricted to trusted server code only?
3. Injection: SQL/NoSQL injection, command injection, SSRF (user-controlled URLs fetched
   server-side), path traversal, XXE, template injection, unsafe deserialization.
4. XSS & output encoding: dangerouslySetInnerHTML / innerHTML, unescaped JSON in <script>
   (JSON-LD breakout via </script> and U+2028/2029), href schemes (javascript:/data:), CSP
   strength (nonce/hash, strict-dynamic, no unsafe-inline/unsafe-eval).
5. CSRF: state-changing GETs, server actions / API routes without origin or token protection.
6. Secrets & config: secrets in client bundles (anything NEXT_PUBLIC_* that shouldn't be),
   committed .env, service-role keys reachable from client, leaked keys in logs.
7. Input validation: server-side schema validation (e.g. zod) on every action/route boundary;
   mass-assignment; type confusion; numeric/range abuse.
8. Rate limiting & abuse: auth endpoints, enumeration (login/reset revealing account existence),
   expensive endpoints, account lockout, brute force.
9. Sensitive data exposure: PII in URLs/logs/responses, over-broad SELECTs returning fields the
   client shouldn't see, error messages leaking internals, data export endpoints.
10. Headers & transport: HSTS, X-Frame-Options/frame-ancestors, X-Content-Type-Options,
    Referrer-Policy, Permissions-Policy, COOP/CORP, CORS allow-list correctness.
11. Dependencies & supply chain: known-vulnerable packages (npm audit), risky postinstall,
    pinned/locked versions.
12. File upload / storage: type/size validation, content-type sniffing, signed-URL scope,
    public bucket exposure.
13. Business logic: payment/credit flows, can a user grant themselves credits, double-spend,
    replay, negative quantities, race conditions on booking/inventory.

## Before analyzing, establish a deterministic baseline
Run (or ask me to run) and read: `npm audit`, type-check, lint, and a grep for the obvious tells
(dangerouslySetInnerHTML, service role key, .rpc(, NEXT_PUBLIC_, getSession vs getUser, etc.).
Cite what you found.

## Output format — write to SECURITY_AUDIT.md (create if absent, update if present)
1. A findings INDEX table: | ID | Severity | CWE/Category | Title | Exploitability | Status |
   - Severity: Critical / High / Medium / Low / Info.
   - Status: OPEN / IN PROGRESS / FIXED / ACCEPTED (with justification).
   - IDs stable across runs (S-01, S-02, ...).
2. For EACH finding: file + line(s), the vulnerability, a concrete attack path (who/how),
   impact, the exact fix (code), and how to verify it's closed.
3. A "Controls already in place" section listing correct protections, so they aren't re-flagged.
4. A prioritized remediation order.
After writing, give me the index table inline and a one-paragraph risk summary. Do not bury the
file behind prose.

## Rules
- Verify the JWT is actually validated server-side, not just decoded — call this out explicitly
  for every authorization boundary.
- For each authorization check, confirm it stands alone in the data layer (not only in
  middleware/layout, which can lose coverage if matchers change).
- Don't mark something safe without saying which control makes it safe.
- Flag deliberate trade-offs as ACCEPTED with a reason instead of re-raising them every run.
- Do not write or run exploit code against any live system; this is a code review.
```
