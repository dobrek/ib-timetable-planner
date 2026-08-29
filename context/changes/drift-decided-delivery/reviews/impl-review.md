<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: The Proposal Is a Plan (S-306)

- **Plan**: context/changes/drift-decided-delivery/plan.md
- **Scope**: Full plan (Phases 1–5 of 5)
- **Date**: 2026-08-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 6 observations

Gates run locally: prettier ✅ · migration applied + `database.types.ts` in sync ✅ · `astro check` 0/0/0 ✅ · lint ✅ · steiger ✅ · unit 1739/1739 ✅ · changed integration suites 51/51 ✅ (solver down locally — solver-touching suites covered by PR CI run 33214840163, green, 7m55s) · `pnpm build` ✅. Manual Progress items all have diff/CI evidence.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS — two plan-permitted relocations (`deliverable` → entities, toast diff → `generation-toasts.ts`), one documented drift (F8) |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Deleting the source loses a finished-but-undelivered solve

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (plan gap, implemented as written)
- **Location**: src/_pages/plans-list/api/pending-guards.ts:65-68
- **Detail**: `assertNoActiveJob` refuses only queued/running. A succeeded (or interrupted/stopped-with-checkpoint) job whose proposal was never opened is not active, so deleting the SOURCE passes. `generation_jobs.plan_id` is ON DELETE CASCADE (20260810200122:60) → job row and solved `result` vanish; the clone survives `pending=true` with no referencing job. A 12–20 min solve is lost silently. The plan only asked for "active-and-not-stale" on the source side.
- **Fix**: In `assertNoActiveJob`, also refuse when any job on `plan_id` satisfies `isDeliverableJob`, with the "open the proposal to deliver it first" message; add the integration case.
  - Strength: Symmetric with the proposal-side delete guard; one predicate call.
  - Tradeoff: A source with an abandoned deliverable proposal must have that proposal opened or deleted first.
  - Confidence: HIGH — cascade verified.
  - Blind spot: None significant (e2e teardown deletes after delivery).
- **Decision**: FIXED — `assertNoActiveJob` also refuses on `isDeliverableJob`; new integration case (14/14 green)

### F2 — Detach-then-clear ordering can strand a plan read-only

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/api/generation-delivery.ts:313-321
- **Detail**: Mismatch branch runs `failJob({detachClone:true})` then `clearPending`. A crash between them leaves `proposal_plan_id = null` and `pending_proposal = true`; the next `checkPlan` finds no job by proposal id, so nothing retries the clear. Inverts the file's own clear-before-mark argument (:325-330).
- **Fix**: Swap: `clearPending` first, then the detaching `failJob`.
- **Decision**: FIXED — `clearPending` now precedes the detaching `failJob`

### F3 — Rename guard is check-then-act without a CAS

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plans-list/api/rename-plan.ts:17-18
- **Detail**: `assertNotPending` reads the flag, then the update runs unconditionally. Window is the ms between `clone_plan` and `markPending`.
- **Fix**: `.update({name}).eq("id", id).eq("pending_proposal", false)`, map 0 rows to the same CONFLICT. Clone stays (RPC, no CAS) — note in docblock.
- **Decision**: FIXED — rename update filters on `pending_proposal = false`; clone documented as check-then-act (RPC)

### F4 — Pending status code differs between routes

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/plans/[id]/students/[studentId].astro:25, teachers/[teacherId].astro:25
- **Detail**: By-member routes set 409 for pending; courses/students/teachers/index return 200 with the notice.
- **Fix**: Return 200 in the two by-member routes to match the majority.
- **Decision**: FIXED — both by-member routes answer 200 for pending

### F5 — Clicking a failed proposal's hub row lands on 404

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (UX)
- **Location**: src/pages/plans/[id]/index.astro:50-72
- **Detail**: The hub lists a failed job's clone until a visit sweeps it; that visit is the click, so the author sees "Plan not found".
- **Fix**: When `summary` was pending and `settled` is null, render "this proposal was removed because generation failed — open the source" instead of 404.
- **Decision**: FIXED — new `SweptProposalNotice.astro`; `index.astro` renders it (200) when the visit swept the clone

### F6 — Polling-store skeleton duplicated

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/model/generation/use-pending-proposal.ts:59-147
- **Detail**: ~90 lines copied from plans-list/model/job-progress-store.ts:61-145; already differ in visibility gating.
- **Fix**: Extract a `shared/lib/polling-store.ts` factory `{ shouldRun, tick, initial }` — follow-up.
- **Decision**: QUEUED (Fix A) — `follow-ups/review-fixes.md`

### F7 — No `pending_proposal` backfill for in-flight clones at deploy

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260828093000_proposal_pending_and_delivery_vocabulary.sql:64
- **Detail**: Plan's Migration Notes chose this deliberately; a succeeded-undelivered hosted row at deploy keeps an editable clone until first visit.
- **Fix**: Accept, or one `update plans set pending_proposal = true where id in (select proposal_plan_id from generation_jobs where delivered_plan_id is null and proposal_plan_id is not null)`.
- **Decision**: FIXED — backfill statement added to the migration; `supabase db reset` clean

### F8 — E2E spec asserts the pending heading, not "Generating"

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence (documented drift)
- **Location**: e2e/specs/generation.spec.ts:73-78
- **Detail**: The ~1 s fixture may already be delivered by click time; the pending panel has unit coverage only. Also: `checkPlan` uses two parallel reads instead of one `.or()` — justified in its docblock, no action.
- **Fix**: Accept, or an either/or assertion (pending status OR board).
- **Decision**: FIXED — either/or assertion (pending status OR board) added; verified by CI's e2e job

### F9 — FR-313 still says "(auto-apply, FR-307)"

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/prd.md:554
- **Detail**: Plan said "do not touch FR-313", but the parenthetical names the retired model.
- **Fix**: "(auto-apply, FR-307)" → "(onto the proposal, FR-307)".
- **Decision**: FIXED — FR-313 parenthetical re-worded
