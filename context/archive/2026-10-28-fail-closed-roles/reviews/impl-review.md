<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-403 Fail-Closed Roles

- **Plan**: context/changes/fail-closed-roles/plan.md
- **Scope**: Phases 1–5 of 5 (full plan; PR 1 #166 merged, PR 2 #167 open at `bdbca4e`)
- **Date**: 2026-10-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Evidence

**Plan adherence.** Every planned item is implemented as contracted, with no MISSING item. The relocation from `shared/lib/access/` to `shared/config/` is a recorded decision in `change.md`, and the contracts held. Small drifts:

- migration 1's comment cites a CLAUDE.md rule name that has since changed (F7);
- one `it(...)` title in `solver-credential.integration.test.ts` was reworded where the plan said "docblock only";
- PR 1 was merged without squashing (F8).

**Benign extras:**

- `e2e/support/sign-in.ts`, promoted per `e2e/CLAUDE.md`;
- `scripts/lib/is-loopback-url.mjs` and `load-test-env-fallback.mjs`, which deduplicate code;
- one sentence in `ui-conventions.md`;
- a fifth no-role e2e probe (`deletePlan` → 403, which proves the guard rather than RLS);
- `FORBIDDEN_MESSAGE`, exported path constants, and a log line when the role lookup fails.

**Automated checks, run in this review:**

| Check | Result |
|---|---|
| `pnpm check` | 0 errors |
| `pnpm test` | 236 files, 2327 tests, pass |
| `pnpm lint`, `pnpm steiger` | clean |
| `pnpm test:integration src/test/role-matrix.integration.test.ts` | 247 / 247 |
| `pnpm build` (+ postbuild Supabase-key assertion) | clean |
| Phase 5 stale-doc `rg` | no matches |
| `prettier --check` on docs | clean |

**Not re-run locally:**

- `supabase db reset` would wipe local users and roles. The local DB already holds both migrations (70 `public` policies; `current_app_role` is the only DEFINER function).
- The full integration lane and e2e need the solver. PR #167's CI at `bdbca4e` is green on Integration, E2E, Lint/unit/build and Solver.

**Manual rows.** None is marked done without evidence, so there is no rubber-stamping. Pending:

- 1.8, 1.9, 3.7, 3.8, 4.7–4.10 (human sign-off; 4.7–4.10 have Playwright evidence in `change.md`);
- 2.9–2.14 (hosted, after PR 1; see F3);
- 5.4–5.8 (hosted, PR 2).

## Findings

### F1 — Migration 2's post-conditions don't prove the new policies are the only ones

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261028200630_fail_closed_policies.sql:135-176
- **Detail**:
  - **The gap.** Post-condition 1 rejects only a literal `true`, and post-condition 2 only proves that *some* SELECT policy calls `can_read()`. Permissive policies are OR'd. So a hosted-only policy with a permissive condition that isn't the literal `true`, such as `auth.role() = 'authenticated'` or `auth.uid() is not null`, keeps its table open to role-less users and passes both checks.
  - **Why the local suite doesn't cover it.** The exact-four-policies assertion lives only in the local matrix (`role-matrix.integration.test.ts:211-216`), which never runs against hosted. The migration's own header says hosted policy names have drifted before.
  - **Tables without RLS.** Post-condition 2 also skips tables with RLS off. There are none locally, but hosted is unverified.
  - **Still fixable.** Migration 2 is not yet applied on hosted (#167 is open), so it can still change.
- **Fix A ⭐ Recommended**: Add a post-condition with two checks:
  - on every RLS table except `profiles`/`user_roles`, the policies that `authenticated`/`public` fall under are exactly the four capability ones;
  - every `public` base table has RLS enabled.
  - Strength: the deploy itself checks hosted, and fails atomically before anyone is locked out. This is the same mechanism as the existing "16" count, and it mirrors `CAPABILITY_POLICIES`, which is already written in TS.
  - Tradeoff: a benign hosted extra aborts the deploy until it is handled. That is fail-closed and can be re-run. The edited migration must pass `db reset` and the matrix again.
  - Confidence: HIGH — the local structural test already encodes the exact rule.
  - Blind spot: hosted's actual `pg_policies` has not been seen.
- **Fix B**: Add a read-only hosted dump to 5.4's pre-merge checklist: `select tablename, policyname, roles, cmd, qual, with_check from pg_policies where schemaname = 'public'`, plus a check for tables with RLS off.
  - Strength: no code change, and it observes reality directly.
  - Tradeoff: it is manual and relies on a human reading it, and it misses a policy added between the check and the deploy.
  - Confidence: MED — only as good as the reading.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A.
  - **Change.** Migration 2's post-condition block gained two checks: every `public` base table has RLS on, and each table holds exactly its intended policies (the four capability policies by name; `profiles` and `user_roles` by command).
  - **Verified on the local DB, without a reset.**
    - The block passes on the live state.
    - It raises on each of three injected faults, each in a rolled-back transaction: a stray `auth.uid() is not null` SELECT on `plans`, RLS disabled on `courses`, and an extra PUBLIC SELECT on `profiles`.
  - **Not yet verified.** The from-scratch apply (`db reset`) was left to CI's fresh stack.

### F2 — The capability-map test copies the composition root's action list

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/actions/action-capabilities.test.ts:27-45
- **Detail**:
  - **The duplication.** `ACTIONS` repeats the nine spreads of `src/actions/index.ts:20-30` by hand.
  - **What escapes.** A new action group added to `server` but not here escapes the "only four non-edit actions" assertion. That is the risky case: a new slice declaring `requires: "read"` or `"session"`. The `edit` default only covers an action that forgets to declare anything.
  - **The plan's reason no longer holds.** The plan chose slice barrels because `index.ts` reads `astro:env/server`, but `vitest.config.ts:13` already aliases that module. The only blocker left is `solver-config.ts`'s `cloudflare:workers` import, which a `vi.mock` of that module removes.
- **Fix**: `vi.mock("@/entities/timetable/api/solver-config", () => ({ getSolverTransport: () => null }))`, then iterate `server` from `@/actions`. Record the deviation in `change.md`.
  - Strength: the test covers exactly the actions that ship, with no second list to maintain.
  - Tradeoff: a small departure from the plan's composition contract.
  - Confidence: MED — not run yet.
  - Blind spot: whether `@/actions` pulls another server-only import that also needs a stub.
- **Decision**: FIXED.
  - **Change.** The test mocks `solver-config` and walks `server` from `@/actions`. The deviation is recorded in `change.md` § Implementation decisions.
  - **Verified.** The test runs green: 41 tests, the same 40 actions plus the exceptions check. ESLint is clean.

### F3 — PR 1's hosted gates are unrecorded, and they gate PR 2

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/fail-closed-roles/plan.md:756-761 (Progress 2.9–2.14)
- **Detail**:
  - **The gap.** #166 merged on 2026-10-28 and deployed, but 2.9–2.14 are unchecked.
  - **Why it gates PR 2.** Critical Implementation Details (plan.md:112) make two of them preconditions for merging PR 2: the developer holds `admin` on hosted, and every hosted human holds a role or a deliberate `none`. Migration 2 grants nothing and does no re-backfill, so any human created after PR 1 loses all access at deploy. #167's checklist carries these items, unchecked.
  - **A second point for 5.4.** Migration 2 takes AccessExclusive locks on 17 tables. `lock_timeout` caps the wait, but not a deadlock with a concurrent `clone_plan`. So "deploy in a quiet window" belongs beside "no solve running" in 5.4.
- **Fix**: Confirm 2.9–2.14 and tick them with evidence before merging #167, and add "quiet window" to 5.4.
- **Decision**: FIXED.
  - **Quiet window.** 5.4's Phase 5 manual bullet now asks for a quiet window, with the reason (locks and deadlock).
  - **Ticked on the user's confirmation.** Rows 2.9, 2.10, 2.12, 2.13 and 2.14, both in Progress and in the Phase 2 bullets.
  - **Still open.** Row 2.11: hosted holds every human as `author`, the solver user holds no row, and `private` is not exposed.

### F4 — An unknown role value becomes `granted`, then a 500

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/shared/config/resolve-access.ts:17
- **Detail**:
  - Any fulfilled value other than `null` becomes `granted`.
  - `grants()` (`capability.ts:12`) then calls `CAPABILITIES_BY_ROLE[role].includes`, which throws a TypeError for a role the Worker doesn't know, so the sidebar and every action return 500.
  - Trigger: a future migration adds an enum value, it applies before the Worker deploys, and someone already holds that value.
  - RLS still protects the data, and the trigger is unlikely.
- **Fix**: In `loadOwnRole`, accept only `null` or a member of `Constants.public.Enums.app_role`, and throw otherwise, so the value maps to `unavailable`.
- **Decision**: FIXED.
  - **Change.** `loadOwnRole` now throws a `DomainError` on a role this build doesn't know, so the middleware maps it to `unavailable`.
  - **Tests.** New `load-own-role.test.ts`, 4 cases: a known role, null, an unknown role, a PostgREST error. All pass, and ESLint is clean.

### F5 — Promoting an existing account to the solver machine user keeps its role row

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/provision-solver-user.mjs:71-77
- **Detail**:
  - The `email_exists` path sets `app_metadata.machine_role` on an existing account and leaves `user_roles` alone.
  - "Machines hold no role" is asserted only once, by migration 1's backfill post-condition. `assign-role.mjs` refuses machine accounts, but nothing covers the reverse direction.
  - If `SOLVER_MACHINE_EMAIL` ever names a human and the token hook misfires, that account keeps its old role's access.
- **Fix**: After the update, delete the account's `user_roles` row, or refuse when one exists.
- **Decision**: FIXED.
  - **Change.** The `email_exists` path now deletes any `user_roles` row and reports it.
  - **Verified on a throwaway local account**, deleted afterwards:
    - an `author` was promoted, and its role was removed ("human role author removed");
    - a second run was a clean no-op.

### F6 — The one-DEFINER catalog check scans only `private`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/test/role-matrix.integration.test.ts:463-470
- **Detail**:
  - CLAUDE.md states "one SECURITY DEFINER function" for the whole repo, but the catalog test reads `pg_proc` only where `nspname = 'private'`.
  - A DEFINER function added in `public` passes.
  - Today there is exactly one DEFINER function across the non-system schemas (verified locally).
- **Fix**: Assert that the only `prosecdef` function in `public` and `private` is `private.current_app_role()`.
- **Decision**: FIXED.
  - **Change.** New matrix catalog test: `current_app_role` is the only SECURITY DEFINER function in the schemas this repo owns.
  - **Verified.** The matrix passes, 248/248. In a rolled-back transaction, the query also lists an added `public` DEFINER function, which is what would turn the test red.

### F7 — Stale comments in CI and migration 1

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: .github/workflows/ci.yml:276; supabase/migrations/20261028140939_user_roles.sql:23-24, 32-35
- **Detail**:
  - `ci.yml` says `pretest:e2e` "provisions the author", but it now also provisions the no-role account.
  - Migration 1 cites CLAUDE.md's "No SECURITY DEFINER" rule, which Phase 2 renamed to "One SECURITY DEFINER function, by recorded exception".
  - Migration 1's owner comment says an owner without BYPASSRLS "would read no rows". That overlooks that a table owner bypasses RLS unless it is FORCEd. The assertion is stricter than needed, which is fail-safe.
- **Fix**: Update the `ci.yml` comment. Leave migration 1 alone, since it is already applied on hosted.
- **Decision**: FIXED. The `ci.yml` comment now names both provisioned accounts. Migration 1 was left untouched (already applied on hosted).

### F8 — PR 1 merged unsquashed, carrying an unrelated deps commit

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: pnpm-workspace.yaml (commit 76d8ba2)
- **Detail**:
  - The plan and CLAUDE.md say to squash-merge with a `(#NN)` suffix. #166 landed as four separate commits.
  - One of them is `76d8ba2`: undici overrides, plus an `audit.ignore` entry for GHSA-mrhx-c7xc-m3w5.
  - That commit was needed for CI's audit gate, and its `audit.ignore` entry records a reason and a condition for dropping it. But it is unrelated to S-403, and it is already on `main`.
- **Fix**: Squash-merge #167 as CLAUDE.md asks.
- **Decision**: FIXED (a process action, with no file change). Phase 5's manual bullet for 5.5 already requires a squash-merge. Carry it out when #167 merges, with a `(#167)` suffix.
