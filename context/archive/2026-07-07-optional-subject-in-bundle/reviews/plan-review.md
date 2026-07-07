<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Optional Subject in Bundle

- **Plan**: context/changes/optional-subject-in-bundle/plan.md
- **Mode**: Deep
- **Date**: 2026-07-07
- **Verdict**: REVISE → SOUND (all findings fixed in triage)
- **Findings**: 1 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL → fixed (F1, F2) |
| Plan Completeness | WARNING → fixed (F3) |

## Grounding

28/28 paths ✓, 7/7 symbols ✓, brief↔plan ✓. Progress section well-formed (4 phases, 22 criteria mapped). Deep verification (sub-agent, Q1–Q7) confirmed the load-bearing claims: business key + `reconcile.ts:30-31` duplicate as described; `place_course` is the 6-param function (`20260624120004`) with the on-conflict RETURNING trick; `unshelve_bundle` calls it with 6 args; `move_bundle_members` UPDATE-based in all branches; `clone_plan_carry_color.sql:147-148/:181-182` line refs exact; `deriveHours` counts rows unfiltered; `bundle-operations.spec.ts` is the only spec touching the inline remove; `CellOccupant` embeds the full placement.

## Findings

### F1 — `shelve_courses` without a default breaks Phase 1 neutrality

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 #4 vs Phase 1's "no client change, all suites stay green" invariant
- **Detail**: The plan gives `place_course` a `DEFAULT false` so old callers keep resolving, but the `shelve_courses` contract added `p_optionals boolean[]` with no default. In Phase 1 (before the Phase 2 #4 client zip), regenerated types mark the arg required → `pnpm check` (criterion 1.2) fails, and PostgREST cannot resolve the existing 4-arg RPC call (PGRST202) → park-members flow + integration suite (1.4/1.6) break. Phase 1's success criteria were unachievable as specified.
- **Fix**: `p_optionals boolean[] DEFAULT null` + per-element `coalesce(p_optionals[i], false)` via `unnest … with ordinality`; Phase 2 #4 always passes the array explicitly. Applied to Phase 1 #4 contract + Migration Notes.
- **Decision**: FIXED (fix applied to plan)

### F2 — Dropdown inside a dnd-kit draggable is a first-in-codebase combination

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 #6 — Chip overflow menu
- **Detail**: The cited "⋯" precedents (`CourseTable.tsx:149-190` etc.) are static tables outside the dnd tree; no dropdown exists inside it today. The chip is a `useDraggable` (`PlacedChip.tsx:50-54`) nested in the cell's own draggable+droppable (`SlotCell.tsx:181,188`), and since menu and chip-drag both gate on `!bundled`, the menu exists exactly when the chip IS draggable. `stopDrag` on the trigger likely prevents drag-start, but an open portal-rendered menu during a chip drag (orphaned anchored menu, flaky e2e) was unguarded.
- **Fix A ⭐ Recommended**: Pin the guard in Phase 3 #6 — `stopDrag` on trigger AND chip's `useDraggable` disabled while the menu is open.
  - Strength: Deterministic; kills the interaction class before e2e builds on it.
  - Tradeoff: Slightly more chip state; possibly defensive.
  - Confidence: MED — pointerdown-stopPropagation likely covers drag-start, but not open-menu-during-drag.
  - Blind spot: @dnd-kit/react sensor internals untested here.
- **Fix B**: Verify-first — explicit manual + e2e interaction checks, guard only if interference shows.
  - Strength: No speculative code.
  - Tradeoff: Unplanned work mid-Phase-3 if it bites.
  - Confidence: MED.
  - Blind spot: Same unknowns, discovered later.
- **Decision**: FIXED via Fix A (contract + manual criterion 3.9 updated)

### F3 — Phase 2 threading list misses four construction/mapping sites

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 #2/#3/#7 file lists; Phase 4 #2's "data already flows"
- **Detail**: The required-`isOptional` compile sweep surfaces these, but they were absent from the file lists and two are load-bearing for Phase 4: private duplicate `toPlannerPlacement` mappers in `student-plan-view/api/loader.ts:206-220` and `teacher-plan-view/api/loader.ts:174-188` (must map `row.is_optional`, not a `false` default); `api/placement-client.ts:7-16` placeCourse wrapper args type; `entities/timetable/model/__fixtures__/builders.ts:46-52` fixture builder. Also `reconcile.test.ts:22` + `api/reconcile.integration.test.ts:35` re-spell the business key inline and will fail on extension — planned realignment, not regressions.
- **Fix**: All sites added to Phase 2 #2/#3/#7 contracts with the `row.is_optional` mapping pinned.
- **Decision**: FIXED (fix applied to plan)
