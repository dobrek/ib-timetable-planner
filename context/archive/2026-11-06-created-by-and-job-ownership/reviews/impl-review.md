<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Created-by and Job Ownership (S-407)

- **Plan**: context/changes/created-by-and-job-ownership/plan.md
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-11-07
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 7 observations

## Triage summary (2026-11-07)

All 10 findings fixed, none skipped, accepted or recorded as lessons. The fixes are uncommitted in the worktree.

After triage:
- `pnpm check`: 0 errors.
- `pnpm lint`, `pnpm steiger` and prettier on the changed files: clean.
- `pnpm test`: 263 files, 2661 tests.
- `pnpm build`: clean.
- Integration suites: attribution, role-matrix, stop and lifecycle (410 tests), and user-directory with change-user-role (13 tests).
- E2E: `created-by.spec` and `read-only.viewer.spec`, 6/6.

Not re-run: `generation.spec` and the full E2E and integration lanes, which need the solver. The migration's from-scratch apply was not re-run either: the edited guard was applied to the local DB with `create or replace`, to keep local accounts. CI's `integration` job covers both.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Nothing blocks. Every planned change is implemented. No "What We're NOT Doing" boundary was crossed. The tooltip deviation recorded in change.md is built as described. The stop guard's step order matches the plan's Critical Implementation Details, and no bypass was found beyond the accepted residual gap. The migration is additive, re-declares `plans_updated_at` from its latest definition, and asserts its own posture. Extra files (`load-credit.ts`, `credited-users.ts`, `PlanSummaryBar.tsx`, `e2e/support/credit.ts`, the factory's `requestedBy`) are necessary plumbing.

### Success criteria re-run in this review

| Command | Result |
|---|---|
| `pnpm check` | pass (0 errors, 0 warnings, 1 hint) |
| `pnpm lint` | pass |
| `pnpm steiger` | pass |
| `pnpm test` | pass (262 files, 2643 tests) |
| `pnpm build` (+ server-only Supabase assert) | pass |
| `pnpm test:integration` role-matrix, job-attribution, generation-stop, generation-jobs, solver-credential, generation-lifecycle, generation-enqueue | pass (7 files, 437 tests) |
| `pnpm exec supabase db advisors --local` | no issues |
| `pnpm test:e2e`, full `pnpm test:integration` (4.1–4.3) | **not re-run**: solver not running, and the branch has no PR or CI run yet |

## Findings

### F1 — Non-owner authors lose the "Stopping…" indicator

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/_pages/plan-detail/ui/PendingProposalPage.tsx:189 (gate), src/_pages/plan-detail/ui/StopAndKeep.tsx:75-84 (indicator)
- **Detail**: The "Stopping…" status for a durable stop request lives inside `StopAndKeep`. S-407 now renders `StopAndKeep` only when `canStopJob(...)`. So when an admin stops author A's job, author B (also watching) sees only the stage line advancing until the row flips to `stopped`. Before S-407, every editor saw "Stopping…". The plan said to gate the *control*, but never mentioned this status, so this is a plan gap rather than an implementation slip. Viewers never saw the indicator, and that predates S-407.
- **Fix**: Split the status from the control. Render a status-only "Stopping…" whenever `job.stopRequestedAt !== null`, and gate only the "Stop & keep" button on `canStopJob`.
  - Strength: it's status, not an edit control, so the "absent, never disabled" rule is untouched, and authors get back what they had before S-407.
  - Tradeoff: it needs a call on whether viewers see it too. Showing it to everyone is simplest and harmless.
  - Confidence: HIGH, because the indicator branch is self-contained at StopAndKeep.tsx:75-84.
  - Blind spot: the PendingProposalPage.test.tsx cases for non-owner and viewer would need updating.
- **Decision**: FIXED (Fix now; viewers included). `stopAffordance` in `model/generation/can-stop-job.ts` decides the slot (control, stopping, or none); `StoppingIndicator` is a named export of `StopAndKeep.tsx`; the page renders it for everyone once a stop is pending. Tests: a `stopAffordance` table, a non-owner editor "Stopping…" case, and the viewer case now expects "Stopping…".

### F2 — Comments misstate how a viewer's stop is refused

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20261106192749_created_by_and_job_ownership.sql:55-56, :70-71; src/test/role-matrix-expectations.ts:240-241, :267
- **Detail**: Both files say a viewer "is refused by the UPDATE policy before the guard is reached". That is wrong. The UPDATE policy is `using (can_read()) with check (can_edit())` (`20261028200630_fail_closed_policies.sql:86-87`), so a viewer's row passes USING. Postgres then evaluates WITH CHECK *after* BEFORE ROW triggers (CREATE POLICY docs). So a viewer does reach the guard:
  - on someone else's job, the guard refuses them;
  - on their own job, WITH CHECK refuses them after the guard has run.

  Either way the result is 42501, so the matrix cells are right. But two normative comments cite the wrong mechanism (lessons.md: "a convention that cites a mechanism is coupled to it"). Separately, the residual-gap note (:70) names only `status = 'failed'`. A direct `status = 'stopped'` or `'interrupted'` write skips the guard just the same, because `status` is not in the trigger's `UPDATE OF` list.
- **Fix**: Reword the three comments: a viewer is refused with 42501, either by the guard or by the policy's WITH CHECK, which runs after BEFORE triggers. Widen the residual-gap note to "any terminal status". The migration hasn't reached hosted (the branch isn't pushed), so editing its comments in place is safe.
- **Decision**: FIXED (Fix now). The mechanism was confirmed live first, in a rolled-back transaction on the local stack: a viewer stopping another user's job got the guard's "Only whoever started this generation, or an admin, can stop it."; on their own job, "new row violates row-level security policy". Reworded the migration header (viewer paragraph; residual gap now names `failed`, `stopped`, `interrupted`) and the `JOB_STOPS` / `JOB_ATTRIBUTION_REWRITES` docblocks. Comments only, no SQL change.

### F3 — `sameView` ignores `requestedBy` and `stoppedBy`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/model/generation/use-pending-proposal.ts:163-180
- **Detail**: The gate's docblock says: "Every field the page renders must be named here, in the same commit that adds it." Phase 3 added `requestedBy` (read by `canStopJob`) and `stoppedBy` (the stopped panel's copy) to the view, but `sameView` compares neither. Today this is latent:
  - `requestedBy` never changes within a job;
  - the tick that flips a job to `stopped` is published because its status changed;
  - after that tick the poll stops (`boardStillComing`, :141).

  It does break the rule the next change will lean on.
- **Fix**: Add `a.requestedBy === b.requestedBy` and a structural `stoppedBy` comparison (kind, plus `user.id` for a user), with a case in `use-pending-proposal.test.ts`.
- **Decision**: FIXED (Fix now). `sameView` compares `requestedBy` and a structural `sameCredit(stoppedBy)` (kind, `user.id` and `creditText`, so a rename between ticks still republishes), and its docblock names the S-407 fields. Tests: two rows in the field-change table, and a case showing a fresh credit for the same stopper doesn't republish. Against the old gate, the two new rows fail as they should.

### F4 — A stop can be retracted, leaving a stale stopper

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261106192749_created_by_and_job_ownership.sql:185-198
- **Detail**: Setting `stop_requested_at` back to null counts as distinct from OLD. It passes the ownership check for the requester or an admin, and keeps `old.stop_requested_by`. That has three effects:
  - the row records a stopper but no stop;
  - a requester can undo an admin's stop before the solver reacts;
  - a later re-stop records a new "first" stopper.

  This isn't reachable from the app: only `stopGeneration` writes the flag, it never writes null, and the publishable key never reaches a browser. It's the same class as the accepted residual gap, but it weakens "the first stopper wins", which the attribution suite claims.
- **Fix**: In the guard, refuse `old.stop_requested_at is not null and new.stop_requested_at is null` with 42501 (a stop is never retracted), and add a matrix cell or an attribution case for it.
  - Strength: makes the first-stopper invariant hold at the database, not just by app discipline.
  - Tradeoff: it's a trigger change, so it needs a local `db reset` and a re-run of the matrix and attribution suites.
  - Confidence: HIGH. Service-role and solver paths return before this check, and grep shows no app path clears the flag.
  - Blind spot: whether future S-304 recovery work ever wants to clear a stop as a signed-in user.
- **Decision**: FIXED (Fix now). The guard now refuses `new.stop_requested_at is null` inside the stop branch for every signed-in caller (42501, "A requested stop cannot be withdrawn."). The header's UPDATE bullet and the function comment say so. New attribution case: the requester and an admin both fail to withdraw an admin's stop, and the row is unchanged. Grep first confirmed no writer clears the flag (only `generation-stop.ts:90,115`, always with a timestamp). **Applied to the local DB with `create or replace`, not `db reset`, to keep local accounts.** CI's integration job runs the from-scratch apply. Attribution, role-matrix, stop and lifecycle suites green (410 tests). Against the old guard, the new case fails as it should.

### F5 — The stopper lookup runs on every tick of a viewer's awaiting-delivery poll

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/api/generation-read.ts:225, with use-pending-proposal.ts:141-142
- **Detail**: A stopped job with a kept checkpoint stays `awaitingDelivery` until an author opens it, and a viewer's page polls every 5 s in the meantime. `withStopper` fires `loadCredit` (two more queries) on every one of those ticks, though the awaiting-author panel never renders the stopper. The cost is small (indexed point reads, few viewers), but it doubles the per-tick reads, possibly for hours.
- **Fix**: Return early from `withStopper` when `view.awaitingDelivery` is true.
- **Decision**: FIXED (Fix now). `withStopper` returns early for `awaitingDelivery` views, and its docblock says why. Checked first that no surface names the stopper on such a view. The provenance strip needs a delivered view, and the halted strip and the stopped panel need a stopped job with no checkpoint, which is never deliverable. New unit test `api/generation-read.test.ts` (3 cases: a stopped job names its stopper; awaiting delivery and a non-stopped job query nothing).

### F6 — The creator lookup adds a serial round trip to every board load

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/plans/[id]/index.astro:122-129
- **Detail**: The lookup runs after `loadCombinedPlannerData` (:113), although it depends only on `settled`. It also runs when the board load has already failed.
- **Fix**: Run it in a `Promise.all` with `loadCombinedPlannerData`, keeping its log-and-null fallback.
- **Decision**: FIXED (Fix now). The board load and the creator lookup now run in one `Promise.all`, and the response status is set after both. The log-and-null fallback is unchanged. It still runs when the board load fails, which costs nothing now that it's parallel. `pnpm check` and lint are clean.

### F7 — "You stopped" depends on the directory lookup succeeding

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/model/generation/stopped-by.ts:16-20
- **Detail**: `stoppedBy` takes the stopper's id from the resolved credit. If `loadCredit` fails (which degrades to null), the stopper reads the neutral line instead of "You stopped…". That's harmless but avoidable: the raw `stop_requested_by` id is already on the row.
- **Fix**: Carry the raw id on the view (e.g. `stoppedById`) and decide "you" from it, so only the name depends on the lookup.
- **Decision**: FIXED (Fix now). `GenerationJobView.stopRequestedBy` (the raw id, named to pair with `stopRequestedAt` and `requestedBy`) is set by `toView` from `stop_requested_by` and compared by `sameView`. `stoppedBy()` decides "you" from it, and only the "Stopped by <name>" line needs the lookup. Fixtures gained `stopRequestedBy: null`, and the "You" cases set the id. New `stoppedBy` cases: "you" despite a failed lookup; unknown to others when the lookup failed; a null id never matches a null viewer. Full unit suite green (2661), `pnpm check` 0 errors, lint clean.

### F8 — change.md doesn't record the smaller deviations from the plan

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/created-by-and-job-ownership/change.md
- **Detail**: Each of these is an improvement and is commented in code, but change.md records only the tooltip deviation:
  - `loadCreditedUsers` inlines the `assertNoQueryErrors` check (load-credited-users.ts:27-32), because the islands-safe barrel can't value-import `@/shared/api`, and it accepts `(string | null)[]`;
  - `StoppedBy` gains a `text` field (stopped-by.ts:8);
  - the defaults are set in a separate `ALTER`, so no existing row is credited (migration :99-103, :123-128);
  - the guard uses `can_stop_any_job() is not true` (:188-190), which fails closed for a caller with no role;
  - there are two unplanned helper modules (`api/load-credit.ts`, `model/credited-users.ts`).
- **Fix**: Add one change.md note listing these, so the plan stays an accurate source of truth for `/10x-archive`.
- **Decision**: FIXED (Fix now). change.md gained a dated note listing the five deviations, and a second note summarising this review's fixes (F1–F7).

### F9 — The directory and profile join is duplicated

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/entities/user/model/credited-users.ts:18-29, src/_pages/users/model/user-rows.ts:44-49
- **Detail**: Both join `user_directory` and `profiles` rows and call `profileLabel` the same way. The plan keeps the Users page's own four-table loader, and that still holds, but the pure join could be shared.
- **Fix**: Have `buildUserRows` build each row's label and service-account flag on `buildCreditedUsers`, or leave it as is until a third consumer appears.
- **Decision**: FIXED (Fix now). `entities/user` exports `buildCreditedUsers` (pure, island-safe). `buildUserRows` names its rows and its change actors from that one map, so its own `displayNames` and `labels` maps are gone. The Users page and `entities/user` tests pass unchanged (66), and lint and steiger are clean.

### F10 — Two success criteria have no evidence

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md Progress 1.1, 4.1–4.3
- **Detail**:
  - 1.1 asks to "record which cells fail" on the red run. It's ticked, but no list exists in plan.md, change.md or the p1 commit message.
  - 4.1–4.3 (the E2E suite and the full integration lane) could not be re-run in this review, because the solver is down and there is no PR or CI run yet.
  - The manual rows are human walkthroughs with no artifacts, which is expected.
- **Fix**: Note in change.md that the red run's cell list wasn't kept. Treat the PR's CI `integration` and `e2e` jobs as the confirmation for 4.1–4.3.
- **Decision**: FIXED (Fix now). change.md records that the red run's cell list wasn't kept, and that the PR's CI `integration` and `e2e` jobs confirm 4.1–4.3. After all the fixes, `pnpm build` plus a preview, then `pnpm test:e2e e2e/specs/created-by.spec.ts e2e/specs/read-only.viewer.spec.ts`: 6/6 passed, covering F6's route change and the creator credit for author and viewer. `generation.spec.ts` still needs the solver and was not run.
