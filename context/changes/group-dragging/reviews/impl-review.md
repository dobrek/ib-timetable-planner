<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Group Dragging

- **Plan**: context/changes/group-dragging/plan.md
- **Scope**: Full plan (Phases 1–2 of 2)
- **Date**: 2026-06-12
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (1 observation — amendment-consistent drift) |
| Scope Discipline | PASS |
| Safety & Quality | WARNING (1 warning, 1 observation) |
| Architecture | PASS |
| Pattern Consistency | PASS (2 observations) |
| Success Criteria | PASS (lint, steiger, 249/249 tests, build all green at review time) |

## Review summary

Faithful, high-quality implementation. All planned items verified as MATCH; the only unplanned file (`GroupDragOverlay.tsx`) is covered by the documented Phase 1 amendment. All plan invariants hold — exactly two `setPlacements` per group drop, eligibility filtered once against the pre-drop snapshot, opaque drag payload — and every "What We're NOT Doing" guardrail is respected (no RPC/migration, no pre-drop validation, silent duplicate skips). Security, data safety, rollback correctness, semantic tokens, and FSD discipline all clean. Manual checkboxes corroborated by the Phase 1 amendment narrative (two documented drag-feedback iterations) — no rubber-stamping signal.

## Findings

### F1 — Settlement invariant rests on an incidental inner catch

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/model/use-placements.ts:90-98
- **Detail**: After the optimistic batch update, nothing structurally guaranteed `settleMany` runs — safe only because `persistMember` catches every rejection so `Promise.all` never rejects. If the settlement section ever threw, pending rows would be stranded until reload (move/remove are gated on `pending`). Sibling persist* paths all use try/catch. Related cosmetic drift: plan specified `Promise.allSettled`.
- **Fix**: Wrap the await-and-settle section in try/catch with a settle-all-failed fallback (`settleMany(prev, entries.map(e => ({ tempId: e.tempId, result: null })))`), mirroring the sibling persist* guards.
- **Decision**: FIXED — try/catch + settle-all-failed fallback applied in `persistAddGroup`.

### F2 — Failure reasons are swallowed; banner says which, never why

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/model/use-placements.ts:101-111
- **Detail**: `persistMember`'s bare `catch {}` discarded the underlying error — the single-add path surfaces `messageOf(err)`, the group path gave zero diagnosability.
- **Fix**: Capture `messageOf(err)` per member and log it.
- **Decision**: FIXED — tagged `console.error` added in the `persistMember` catch (with the repo's justified `eslint-disable-next-line no-console` pattern).

### F3 — `else` makes "grouping" the implicit fallback drag kind

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/ui/PlannerBoard.tsx:40-42
- **Detail**: `handleDrop`'s final branch was a bare `else`, so a future fourth `DragData` variant would silently be treated as a group drop.
- **Fix**: Branch explicitly on the kind.
- **Decision**: FIXED — `handleDrop` rewritten as an explicit `switch` on `data.kind` (a plain `else if` tripped `@typescript-eslint/no-unnecessary-condition`); unknown kinds now no-op instead of misrouting.

### F4 — Display-names map passed into the hook bends the "identity opaque, display at the edges" lesson

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/model/use-placements.ts:25-26
- **Detail**: `usePlacements` received `names: Record<string, string>` solely to format the failure banner — plan-sanctioned but pulled a display concern one layer inward.
- **Fix**: Accept as-is, or return failed ids and format in the UI.
- **Decision**: FIXED (fix differently — user chose the purist refactor): introduced `PlacementError` discriminated union (`{ kind: "message" } | { kind: "groupFailure", failedCourseIds, attempted }`) and pure `placementErrorMessage(error, names)` in `placement-transitions.ts`; hook is id-only again (`names` removed from `UsePlacementsArgs`); `PlannerBoard` formats at the render edge. Three new tests cover `placementErrorMessage`.

### F5 — GroupingBox uses box-as-draggable + header handle, not the sibling-draggables structure the plan's contract specified

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/_pages/plan-detail/ui/GroupingBox.tsx:34-39
- **Detail**: Plan said "the header must not wrap the member list in its draggable element". Implementation makes the outer box the draggable element with the header as activation handle — effectively required by the recorded overlay amendment (box must be the Feedback plugin's source element for the in-place "in use" treatment). Functional intent holds; checkpoint 1.7 passed.
- **Fix**: One-line plan addendum superseding the sibling contract.
- **Decision**: FIXED — Phase 1 GroupingBox contract in plan.md amended (strikethrough + amendment note).

## Post-triage verification

After all fixes: `pnpm lint` clean, `pnpm steiger` clean, `pnpm test` 252/252, `pnpm build` clean.
