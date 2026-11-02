# S-403 Fail-Closed Roles — Plan Brief

> Full plan: `context/changes/fail-closed-roles/plan.md`
> Research: `context/changes/fail-closed-roles/research.md`

## What & Why

Today any signed-in human can read and write everything: 17 human-facing tables carry `using (true)` policies. S-403 makes access follow the one role an admin assigned:

- **Existing authors:** keep everything, including Generate → solve → proposal → delivery.
- **The developer:** becomes admin through a documented operator step.
- **A signed-in user with no role:** sees only "no access yet — ask your admin" and their own account.

It is the milestone's riskiest slice, because it rewrites every human-facing database rule on live school data, and migrations auto-deploy on merge.

## Starting Point

Research prototyped the full database design locally in a rolled-back transaction: authors matched today's behaviour on all 29 probes, viewers read but can't write, and role-less users read nothing. F-401's role matrix and `createSignedInUser` are in place but know only `anon` and `noRole`. Nothing stores a role, and no `SECURITY DEFINER` function exists yet.

## Desired End State

- Role → access:

  | Role | Access |
  |---|---|
  | admin, author | as today |
  | viewer | reads everything; every write is refused with a clear `FORBIDDEN` and rolled back |
  | no role | redirected to the dashboard notice; `/account` and sign-out still work |

- A role change applies on the person's next action.
- A failed role lookup shows a 503 page, never the notice.
- The solver is unchanged with its token hook on. With the hook off it now reads nothing; today it reads everything.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Role storage | `public.user_roles`, one row per user, enum `app_role` | An enum is additively extensible and gives TS a generated role type. | Research + Plan |
| Lookup | Live read on every request, not a JWT claim | A claim changes only on refresh, up to an hour later, which misses "next action". | Research |
| Helper shape | One DEFINER `private.current_app_role()` + INVOKER `can_read`/`can_edit`, USAGE on `private` | It is literally one recorded exception, and DEFINER is required anyway before S-406 (probe C stack overflow). | Research + Plan |
| App role read | `public.own_app_role()` RPC wrapping the DEFINER | The app sees exactly what policies see, and S-406's admin-reads-all policy can't break it. | Plan |
| Rollout | Two PRs: roles first (behaviour-neutral), then the flip | Hosted's backfill is observed, and the developer promoted, before anything is enforced. | Plan |
| Re-backfill in migration 2 | None; the operator assigns role-less humans before PR 2 | A deliberate `none` is never silently re-granted. | Plan |
| Notice | On `/dashboard`; other gated pages redirect there | Sign-in and `/` already land there, and it keeps the weak-password banner. | Plan |
| Lookup failure | 503 / `SERVICE_UNAVAILABLE`, never the notice | An author is never told "no access" during a blip; it still denies. | Plan |
| Action guard | `requires` defaults to `edit`; only 4 actions declare otherwise | A forgotten declaration is fail-closed, and the diff touches about 4 sites. | Plan |
| Viewer UPDATE policy | `using can_read`, `with check can_edit` | A viewer's UPDATE fails loudly (42501) instead of a silent 0-row no-op. | Plan |
| Matrix principals | All five (anon, noRole, viewer, author, admin) | Only an admin column catches `can_edit` silently dropping the day-one admin. | Plan |
| E2E | A provisioned role-less account, its own setup project and spec | It proves the gate and `FORBIDDEN` on real workerd and cookie SSR. | Plan |
| HC Fix 7 (SQL lint) | Separate follow-up change | It keeps the riskiest diff purely about access. | Plan |

## Scope

**In scope:**
- **Database:** the role table and helpers; the shape-matched rewrite of 16 policies and `profiles`' own-row SELECT; post-condition asserts in both migrations.
- **App:** the middleware `locals.access`, page gate and 503; the dashboard notice and filtered nav; `requires` with `FORBIDDEN` and 42501 → `FORBIDDEN`.
- **Tests:** five-principal matrix with own/others reads, self-grant denials, `private` catalog checks and the structural policy assertion; the factory `role` option; an action capability-map test.
- **Tooling:** the e2e author role, a no-role e2e account, `scripts/assign-role.mjs`.
- **Docs:** CLAUDE.md DEFINER exception and role rules, README, three runbooks, test-plan, roadmap.

**Out of scope:**
- Viewer UI gating and viewer-triggered delivery (S-405)
- Users page, admin writes and the access-change record (S-406)
- Job-stop ownership (S-407) and the `active` flag (S-408)
- The SQL lint gate and `anon`'s grant residue on older tables
- A `/no-access` route
- JWT role claims

## Architecture / Approach

Enforcement is RLS alone: each human table has four capability policies on `(select private.can_read())` / `(select private.can_edit())`, over one DEFINER read of the caller's own row. The app adds clarity, not security:

- the middleware reads the role (through `own_app_role()`, concurrently with `getUser()`) into `locals.access`;
- a pure `decideRoleGate` routes pages;
- `defineDomainAction`'s guard turns RLS's silent 0-row denials into `FORBIDDEN`, so optimistic board writes roll back.

The role → capability map lives in SQL and in `shared/lib/access`; the matrix pins one, unit tests the other.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Roles schema, types, matrix learns `user_roles` | Migration 1 (behaviour-neutral) + types + factory role + catalog checks | A hosted helper owner without `bypassrls`, which the migration asserts and aborts on |
| 2. All roles at today's posture, tooling, PR 1 docs | Five-principal matrix, e2e author role, `assign-role.mjs`; **PR 1 merged, hosted verified, developer admin** | E2E red if the provisioner misses the `email_exists` id path |
| 3. The flip | Expectations flipped (red, recorded) → migration 2 → green | An over-tight policy passing as a silent no-op; caught only by the read-back matrix |
| 4. App follows the role | Gate, notice, nav, action guard, no-role e2e | Gating `/account` or the account actions would break FR-410 and two suites |
| 5. Docs & rollout | Role rules, runbooks, roadmap; **PR 2 merged, hosted smoke** | Merging with role-less humans not yet assigned (no re-backfill) |

**Prerequisites:** S-401 and F-401 (done). Local Supabase stack. `mise run solver:dev` for the generation suites and spec. The hosted secret key in a human shell for the operator steps.
**Estimated effort:** about 4–5 sessions across 5 phases and 2 PRs, with two hosted check-points.

## Open Risks & Assumptions

- **Silent denials.** Proof that authors are untouched rests on the read-back matrix and the structural catalog assertion, never on "lanes stayed green".
- **Integration-lane growth.** The lane grows from 81 to about 220 matrix tests in a lane that is about 1-in-5 red from transient 502s, so a red run must be read against that baseline.
- **Viewers before S-405.** A viewer meets edit controls whose write actions all fail with `FORBIDDEN`. The page-load delivery path is not an action. A viewer's visit, and the pending page's 5 s poll, retry delivery, report "failed" or "clone removed" while nothing changed, and keep polling a dead job. Nothing is corrupted, and S-405 inherits the list (plan § What We're NOT Doing). Before S-406 a viewer exists only through `assign-role.mjs`.
- **Collateral seq scans.** `enum_eq` isn't leakproof, so `course_groupings` seq-scans under any RLS qual. It's harmless at today's volumes; watch it as proposal clones accumulate.

## Success Criteria (Summary)

- On go-live day every hosted author edits and generates exactly as before, and the developer is admin.
- A role-less account sees only the notice and its own account. A viewer's edits are refused with a clear error and rolled back.
- The flipped role matrix went red before migration 2 and green after, and every CI lane stays green.
