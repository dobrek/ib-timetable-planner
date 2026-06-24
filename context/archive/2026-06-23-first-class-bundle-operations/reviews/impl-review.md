<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: First-Class Bundle Operations (S-05)

- **Plan**: context/changes/first-class-bundle-operations/plan.md
- **Scope**: Full plan — Phases 1–5 of 5
- **Date**: 2026-06-24
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Summary

Two parallel sub-agents (plan-drift + safety/pattern) report unusually high fidelity. Every
planned change across all five phases is present and behaviorally correct. The three new RPCs
faithfully follow the `replace_course_teachers` (security invoker, `set search_path=''`,
`public.`-qualified, no dynamic SQL) and `course_teachers` (composite FK, anon revoke)
templates; `anon` is genuinely two-layer excluded (explicit `revoke` + standing
`alter default privileges`); the no-temp-bundle-id rule and the single-`setPlacements`
no-flicker invariant are both honored; `clone_plan` is a faithful create-or-replace with only
the three intended deltas. Each board op is a single transactional RPC round-trip (net
improvement over the prior best-effort N-call fan-out), preserving the <200ms drag budget.

Static gate re-run live: `pnpm check` (0 errors), `pnpm lint`, `pnpm steiger`, `pnpm test`
(541 passed), `pnpm build` — all green. Grep-clean confirmed: no `slot_bundles` reference in
`src/`; in `supabase/` only historical migrations + the three expected new ones. Integration
(`test:integration`) and E2E (`test:e2e`) were NOT re-executed (need a running local Supabase +
workerd); Progress marks them done with commit shas and the test files are present.

Two EXTRA surfaces are both in-scope, not scope creep: `exploded-cells.ts` /
`use-exploded-cells.ts` (the plan permits "a small UI-state helper if warranted"), and the
`teachers/*` comment edits (required to satisfy the Phase 3.4 grep-clean criterion — the stale
comments referenced `useSlotBundles`/`slot-bundle`).

## Findings

### F1 — move_bundle_members silently no-ops on an empty/stale source

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260624120005_move_bundle_members_fn.sql:43-71
- **Detail**: If the source cell is empty (stale/duplicate/concurrent call), `v_source_bundle_id`
  is NULL; the empty-target branch computes `v_source_total = 0` and `v_movers = 0`, so `0 = 0`
  takes the whole-bundle path → `update bundles … where id = NULL` (0 rows) and returns an empty
  set instead of failing loudly. The optimistic client mis-reads this as a failed group op and
  surfaces a spurious banner; a genuinely-stale call is undiagnosable. Atomic, no corruption.
  No integration test exercised the empty-source case.
- **Fix**: Add a `if v_source_bundle_id is null then raise exception … end if;` guard after the
  source-bundle lookup, plus a matching integration case.
- **Decision**: FIXED — added the `raise exception` guard to migration `…005` (in-place, since
  the migration was authored on this unmerged branch and never deployed) and a
  "move from an empty source cell fails loudly" integration case in
  `bundle-operations.integration.test.ts`. Verified via `pnpm check`/`lint`/`test`; the new
  integration assertion + `db reset` validation are pending a local Supabase run.

### F2 — Partial-move-into-empty-cell insert lacks `on conflict`

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260624120005_move_bundle_members_fn.sql:75-77
- **Detail**: `place_course` is race-safe via `on conflict (bundles_cell_unique) do update`; the
  partial-move-into-empty path here does a bare `insert into bundles … values(…)` with no
  on-conflict, so two ops concurrently targeting the same previously-empty cell make the loser
  raise a unique-violation and the whole RPC aborts (atomic rollback — safe, correct deny)
  rather than merging. Acceptable under the single-author usage model; the two sibling paths
  just resolve the same race differently.
- **Fix (optional)**: Mirror `place_course`'s `on conflict … do update set status = excluded.status returning id`.
- **Decision**: SKIPPED — atomic rollback is already safe under the single-author model; note for a future multi-author scenario.

### F3 — Pure transitions not literally collapsed into one function

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/_pages/plan-detail/model/placement-transitions.ts
- **Detail**: Phase 3 §2 reads "Collapse add/addMany/move/moveMany/remove/removeMany into one
  member-set primitive." The pure transitions remain separate functions; the member-set
  unification lives one level up in the `use-placements` orchestrator (M-of-one for singles,
  M-of-many for group/bundle, single-pass, mover/merger partition). Behavior matches intent
  exactly — a faithful interpretation, not a functional drift. Recorded only because a reader
  diffing plan-wording vs code will notice the literal mismatch.
- **Fix**: Add a one-line comment pointing at `use-placements` as the unification point.
- **Decision**: FIXED — added a module-level note in `placement-transitions.ts` clarifying that
  the "one member-set primitive" is composed in `use-placements.ts`, not here.
