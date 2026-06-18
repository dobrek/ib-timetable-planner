---
change_id: testing-auth-actions-boundary-rls
title: Auth, Astro Actions boundary, and RLS/PII integration tests
status: archived
created: 2026-06-15
updated: 2026-06-18
archived_at: 2026-06-18T12:33:13Z
---

## Notes

Rollout **Phase 2** of `context/foundation/test-plan.md` — "Auth + Astro Actions
boundary + RLS / PII". Test types planned: integration (local Supabase + auth).

**Risks covered (§2):**

- **#5 — auth / RLS / PII.** Prove an Action invoked *without* a session is
  rejected, and that author B cannot read or mutate author A's
  students/placements/catalog. Challenge "the middleware protects everything" —
  `/_actions/*` is exempt from the redirect, so the gate is per-handler
  `requireSession`; and "logged in" ≠ "authorized for this row".
- **#3 — the Astro Actions-over-HTTP mutation boundary.** Prove the Action
  wrapper over a *real* HTTP `/_actions/*` request enforces auth, translates
  `DomainError` → `ActionError` to the correct client error, persists, and
  rejects malformed/untrusted input. Challenge "the domain function is tested,
  so the boundary is fine" — the handler wiring is what is untested. Do not mock
  the domain function inside the boundary test.

## What shipped (reconciliation)

What landed diverges from the original §2 framing — recorded here so the closed
change doesn't claim coverage it doesn't have:

- **#5 — unauthenticated half: covered.** No-session Action refusal proven over
  real HTTP by the e2e `chromium-guard` spec (`UNAUTHORIZED`), and the page-layer
  guard redirect proven by the guard spec. **Cross-author / IDOR half: deferred**
  (candidate Phase 2.5). It is not meaningfully testable until an ownership
  column + real per-author RLS land; today RLS is permissive (`using(true)`) and
  integration uses the RLS-bypassing service-role key. The two-authenticated-
  clients harness was **not** built here.
- **#3 — Actions-over-HTTP boundary: covered, with persistence anchored at the
  `.handler` layer.** Auth enforcement and `DomainError`→`ActionError`
  translation are proven over real HTTP (e2e unauth) and at the handler layer
  (integration translation matrix for the in-scope codes `CONFLICT` / `NOT_FOUND`
  + malformed-input rejection). **`createPlan` persistence is proven at the
  integration `.handler` layer, not over HTTP** — the UI-driven happy-path e2e
  (the `createPlan` round-trip through the "New plan" dialog) is **deferred** to a
  later browser test once the harness pattern is established.
- **Reachability pinned.** A `GRANT … TO authenticated` migration pins table
  reachability (current + future tables), since the dropped happy-path e2e was
  the only authenticated DB write that would have caught an auto-grant regression.
- **Harness.** This change stood up the project's first Playwright e2e harness
  (root `playwright.config.ts` + `e2e/`) plus a CI `e2e` job that gates deploy —
  the reusable pattern for all future browser tests (`test-plan.md` §3, §6.3).

**Hard prerequisite (carry into research, from §3 Notes):** the cross-author /
IDOR half of #5 is **not** meaningfully testable until an ownership column +
real per-author RLS policies land. Today RLS is permissive (`using(true)`) and
the integration suites use the service-role key, which bypasses RLS entirely
("authenticated = full access"). The unauthenticated-rejection half of #5 and
all of #3 *are* testable today. Research/plan must decide whether this change
also lands the ownership column + RLS, or scopes to testable-today and defers
cross-author.
