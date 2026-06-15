<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Disambiguate Palette Drag — Single Course from Palette

- **Plan**: context/changes/dnd-single-course-from-palette/plan.md
- **Scope**: Phase 1 & 2 of 2 (full plan)
- **Date**: 2026-06-15
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Summary

Tight, faithful execution. Exactly the 3 files the plan named changed
(`PaletteCourseChip.tsx` new; `PlannerPalette.tsx` + `GroupingBox.tsx` modified) — no
unplanned files, no scope creep. Every "What We're NOT Doing" boundary held: no
model/Action/DB change, no `catalog` prop, no new overlay, `GroupingFilter` untouched. The
old `PaletteCourse` row draggable and its `palette:${groupingId}:${courseId}` id are fully
removed; no code parses drag-ids, and the drop handler keys purely on `data.kind`, so the new
`single:${courseId}` id is safe. All four automated gates pass.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS (1 observation) |
| Success Criteria | PASS |

## Success Criteria (automated, re-run during review)

- `pnpm lint` — PASS
- `pnpm steiger` — PASS (No problems found)
- `pnpm test` — PASS (52 files, 402 tests)
- `pnpm build` — PASS

## Findings

### F1 — Promoted chip + singleton chip duplicate when a course is both

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🔎 MEDIUM — real (small) design tradeoff; pause to decide
- **Dimension**: Scope Discipline
- **Location**: src/_pages/plan-detail/ui/PlannerPalette.tsx:32-35
- **Detail**: Selecting a leading course that is itself a 1-member grouping renders two
  visually identical chips: the promoted chip (`CourseDrag → addCourse`) and the singleton
  grouping chip (`GroupDrag → addGroup([member])`). Both place the same single course, so it's
  benign, but the plan's visual goal ("chip = a single placeable course") shows the same
  course twice. Only the singleton case is affected.
- **Fix A ⭐ Recommended**: Accept and document the overlap as a benign trade-off.
  - Strength: Both chips place the same course correctly; de-duping adds conditional logic for
    a narrow case. The plan already accepts a comparable trade-off.
  - Tradeoff: A user can briefly see two identical chips.
  - Confidence: HIGH — verified both paths land the same placement.
  - Blind spot: How often singleton groupings occur in real data.
- **Fix B**: Suppress the promoted chip when the selected course's only groupings are singletons.
  - Strength: Removes the visual duplicate entirely.
  - Tradeoff: Conditional render logic keyed on grouping memberships; easy to get subtly wrong.
  - Confidence: MED — needs the membership check written and tested.
  - Blind spot: Whether users rely on the top chip's fixed position.
- **Decision**: FIXED via Fix A — documented as an accepted trade-off in `change.md` Notes.

### F2 — Hours-counter markup duplicated across two components

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/ui/PaletteCourseChip.tsx:36-47 + src/_pages/plan-detail/ui/GroupingBox.tsx:76-87 (MemberRow)
- **Detail**: The placed/required hours-counter `<span>` (same data-slot, title, tabular-nums,
  and `placed === required` token logic) was copied verbatim in `PaletteCourseChip` and in
  `MemberRow`. A theme/format tweak would need editing two files.
- **Fix**: Extract a tiny presentational `HoursCounter({ hours })` component and use it in both
  call sites.
- **Decision**: FIXED — added `src/_pages/plan-detail/ui/HoursCounter.tsx`; both call sites now
  render `<HoursCounter hours={hours} />`. All four gates re-run green.
