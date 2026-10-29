<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Current-Plan Marker (S-404)

- **Plan**: context/changes/current-plan-marker/plan.md
- **Scope**: Full plan (Phases 1–4 of 4)
- **Date**: 2026-10-29
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (1 observation) |
| Scope Discipline | PASS |
| Safety & Quality | PASS (3 observations) |
| Architecture | PASS |
| Pattern Consistency | PASS (2 observations) |
| Success Criteria | PASS |

Every file the plan names is in the diff; no planned item is missing. The additions the plan does not describe are all benign: the migration's post-conditions block, which asserts the planned invariants in house style; Star/StarOff icons on the new menu item, matching its siblings; extra race-safe test assertions; and the roadmap `ready → in-progress` flip, which is `/10x-implement`'s step.

Checked and clean: INVOKER posture, `search_path = ''`, the anon and PUBLIC revoke (the catalog check and the post-conditions both prove it); RLS through the RPC (a viewer fails WITH CHECK with 42501, a role-less user gets no row); advisory lock plus read-committed snapshots; the error mapping (23505, PGRST116, 42501); the trigger re-declaration (the original was never amended); additive-only migration safety; `clone_plan` never copies the column; no XSS; no other suite depends on hub order or on which plan is current; React render purity and hook rules; badge accessibility; semantic tokens only.

### Verification run (2026-10-29)

- `pnpm test:integration` current-plan + role-matrix: 270/270 passed. Catalog check (`-t "only authenticated may execute"`): passed. `src/_pages/plans-list` suites: 57/57.
- `pnpm test` 2338/2338 · `pnpm check` 0 errors · `pnpm lint` clean · `pnpm steiger` clean.
- `pnpm test:e2e e2e/specs/current-plan.spec.ts`: passed. Every other e2e spec passed (55/55), except `generation.spec.ts`, which was not run because no solver was up.
- Not re-run: `pnpm build` and `pnpm audit`. The build would have restarted the running preview; the gate was recorded green at 4.3 (`ee9c18e`), and no `src/` file changed after the 17:00 build that the e2e run used.
- Manual rows: all checked. 1.8 is also proved by the migration's post-conditions, and 2.7, 2.9, 3.5 and 3.6 by the e2e spec (in part). 2.8 (pending CONFLICT toast), 2.10 (viewer FORBIDDEN toast) and 3.7 rest on manual sign-off; the domain and matrix suites cover their logic.

## Findings

### F1 — `FOR UPDATE` blocks FK checks on the target plan

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261029143936_current_plan_marker.sql:93-97
- **Detail**: `perform 1 from public.plans where id = p_plan_id and not pending_proposal for update` takes the strongest row lock. `FOR UPDATE` conflicts with `FOR KEY SHARE`, which every child-row FK check takes on its `plans` row (placements, courses, students and the other `plan_id … references plans(id)` tables). So a drag-drop write on the plan being marked waits for the marker move, and the other way round. Neither of the function's UPDATEs needs that strength: `is_current` sits only in a partial unique index, which Postgres doesn't count as a key column, so both take `FOR NO KEY UPDATE`. `FOR NO KEY UPDATE` still blocks a concurrent `pending_proposal` flip (`NO KEY UPDATE`) and a delete (`FOR UPDATE`), which is all the validation needs. The wait is milliseconds and there's no deadlock cycle (movers are serialised by the advisory lock).
- **Fix A ⭐ Recommended**: Change `for update` to `for no key update` in this migration, which hasn't reached hosted yet (the branch is unmerged).
  - Strength: One migration stays the single definition of an unreleased function; CI's stack is ephemeral, so it picks the change up.
  - Tradeoff: This machine's stack already ran the old body. Re-apply it by hand (the `create or replace` form of the function via psql) or `supabase db reset`, which wipes local users and roles.
  - Confidence: HIGH — Postgres row-lock docs: "partial indexes and expressional indexes are not considered" for the key-column rule.
  - Blind spot: Contention wasn't measured. The win is avoiding a rare wait of a few ms, not a correctness fix.
- **Fix B**: Leave this migration and add a follow-up `create or replace function` with the weaker lock.
  - Strength: No local re-apply step.
  - Tradeoff: Two migrations for a function nobody has used yet, and the body must be copied from the latest definition (lessons: re-create from the latest live definition).
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A) — migration edited in place with a one-line rationale in the step-2 comment; function re-applied on the local stack via psql (grants/INVOKER/search_path confirmed unchanged); marker + role-matrix suites 270/270.

### F2 — Generate's orphan sweep can delete a just-marked clone

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261029143936_current_plan_marker.sql:5-7; src/_pages/plan-detail/api/generation-job.ts:153-168
- **Detail**: The header says "with this rule no automatic path ever deletes the current plan". The exception goes like this. `clone_plan` commits a non-pending clone. `markPending` is the next PostgREST round-trip. An author who marks the clone between the two moves the marker onto it. `markPending` then hits the CHECK (23514), and `deleteOrphanClone` deletes the now-current clone, which leaves no plan current. A human click can't realistically land in that window, and the result is safe (zero current is legal, and a pending plan is never current). Only the comment claims more than is true.
- **Fix**: Narrow the header to "no automatic path deletes a plan that was already current" (or note the Generate window). This is a comment change only.
- **Decision**: FIXED — header narrowed and the Generate window noted (comment only).

### F3 — Sibling test's CONFLICT scope note is now false

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plans-list/api/action-boundary.integration.test.ts:20-26
- **Detail**: "no plans-list domain fn maps a `conflict` message (only the courses/teachers slices do)". `markCurrentPlan` now maps one (`mark-current-plan.ts:28`). The reasoning still holds, because the advisory lock makes 23505 unreachable in practice, but the stated premise is wrong. This is the lesson "a doc that names a mechanism is coupled to it".
- **Fix**: Reword the scope note: `markCurrentPlan` maps `conflict` only as a defence, since the advisory lock serialises movers and a real CONFLICT is still unreachable through a plans-list action.
- **Decision**: FIXED — scope note reworded to name `markCurrentPlan`'s defensive mapping and why it never fires.

### F4 — Matrix probe doesn't use `probeWrite` / `WriteAttempt`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/test/role-matrix.integration.test.ts:855-863
- **Detail**: The plan says the probe goes "through `probeWrite`", with an `attempt` that keeps the returned rows, as `cloneProbe` does. The code instead has a custom `setCurrentProbe` that calls `classifyWrite` itself. Behaviour matches the plan: the returned row is the first evidence and the service-role read is only a fallback. But it's the only RPC probe that skips the shared `WriteAttempt` shape.
- **Fix**: Rewrite it as a `WriteAttempt`. The `attempt` keeps the returned rows in a closure (like `cloneProbe`'s `registerPlan`), and `effectLanded` checks them before the read-back. Or accept the custom form and record it as a deviation in the plan.
- **Decision**: DISMISSED — `probeWrite` drops `attempt()`'s result, so the planned shape needs mutable closure state; the all-const custom probe is kept and recorded in plan.md (Phase 1 §1, "As built").

### F5 — A failed Mark/Unmark leaves the hub stale

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plans-list/ui/PlansHub.tsx:255-265 (with src/shared/lib/forms/use-confirm-action.ts:36-39)
- **Detail**: On an error, `useConfirmAction` shows a toast and returns without refreshing. After a lost race, unmark says "This plan is no longer the current plan. Refresh to see which one is." The badge and the "Unmark as current" label stay stale until the user refreshes by hand. Mark's NOT_FOUND and CONFLICT behave the same way. This matches how the other hub actions fail today, and the message tells the user what to do.
- **Fix**: Optional. Refresh on NOT_FOUND/CONFLICT for this toggle. That would need an `onError` hook on `useConfirmAction`, so this is the place to stop if it isn't worth it.
- **Decision**: FIXED — `useConfirmAction` gained an optional `refreshOn: readonly ActionErrorCode[]` (toast, then refresh); Mark/Unmark passes `["NOT_FOUND", "CONFLICT"]`. Other callers unchanged. No hook test added (none existed). `pnpm check`, lint, prettier and the slice's unit tests pass.

### F6 — `is_current` is optional on the layout's `plan` prop

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/layouts/SidebarLayout.astro:17
- **Detail**: `plan?: { id: string; name: string; is_current?: boolean }`. The plan chose optional so the pending branch (`src/pages/plans/[id]/index.astro:119`) needed no edit. But every other route passes a `PlanSummary`, where `is_current` is required. Optional only lets a future route drop the badge silently.
- **Fix**: Make it `is_current: boolean`, and pass `is_current: settled.is_current` (always false) in the pending branch.
- **Decision**: FIXED — prop made required; pending branch passes `settled.is_current`; plan.md Phase 3 §2 carries an "As built" note. `pnpm check` 0 errors.

## Triage summary (2026-10-29)

- Fixed: F1 (Fix A), F2, F3, F5, F6
- Dismissed: F4 — custom probe kept, recorded in plan.md as an accepted deviation
