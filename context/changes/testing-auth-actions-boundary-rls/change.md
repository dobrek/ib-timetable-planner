---
change_id: testing-auth-actions-boundary-rls
title: Auth, Astro Actions boundary, and RLS/PII integration tests
status: implementing
created: 2026-06-15
updated: 2026-06-17
archived_at: null
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

**Hard prerequisite (carry into research, from §3 Notes):** the cross-author /
IDOR half of #5 is **not** meaningfully testable until an ownership column +
real per-author RLS policies land. Today RLS is permissive (`using(true)`) and
the integration suites use the service-role key, which bypasses RLS entirely
("authenticated = full access"). The unauthenticated-rejection half of #5 and
all of #3 *are* testable today. Research/plan must decide whether this change
also lands the ownership column + RLS, or scopes to testable-today and defers
cross-author.
