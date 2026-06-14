# Planner Palette Group Sorting Implementation Plan

## Overview

The planner palette renders its grouping boxes in an accidental, non-deterministic order
(the load query has no `ORDER BY`; the palette maps the rows verbatim). This change gives
the boxes a deterministic, user-meaningful order — **total students descending, then course
count descending, then a stable tiebreaker** — and surfaces the **student total in each box
header** so the ordering is legible.

Both sort keys already live on every `PlannerGrouping` at render time (`coverageCount` and
`memberIds.length`), so this is a **client-only display change** over data that already
exists: a small pure sort function plus a one-line header render. No model, persistence,
migration, API, or prop changes.

## Current State Analysis

- **Order is unsorted.** `load.ts` selects `course_groupings` filtered only by `plan_id` +
  `cohort` with no `ORDER BY`; rows come back in dedup-encounter order keyed by random-UUID
  PKs, and `PlannerPalette.tsx:27` maps `visibleGroupings` straight to `<GroupingBox>`. No
  `.sort()`/`.toSorted()` touches `PlannerGrouping[]` anywhere in the slice. The compute
  core *does* sort deterministically (`compute-groupings.ts:17-21`) but that ranking is
  dropped at the persistence boundary and never reconstructed for display.
- **Both sort keys are already present.** `PlannerGrouping` (`model/grouping.ts:20-25`)
  carries `coverageCount` (total students) and `memberIds` (course count = `.length`),
  built directly from the DB in `load.ts:70-75`. Nothing new needs loading or threading.
- **`coverageCount` = total students, and it is exact for real groups.** It is the sum of
  each member subject's student count (`score.ts:12`). Because the grouping enumerator only
  co-locates subjects that are **student-disjoint** (`enumerate.ts:38` →
  `constraints/student-conflict.ts:21`: two subjects sharing a student is a collision and
  can never be in the same group), the sum equals the count of distinct students for every
  persisted grouping. The "double-count" asserted by `score.test.ts:18-25` is a property of
  the bare arithmetic on a deliberately-invalid set — it cannot arise in a real box. So
  labeling the value "students" is accurate.
- **The header is the render point.** `GroupingBox.tsx:47` shows
  `<span>{grouping.memberIds.length} courses</span>` inside the (drag-handle) header. The
  per-course rows already use a right-aligned counter pattern (`ml-auto shrink-0
  tabular-nums`, `GroupingBox.tsx:92-103`) to mirror for the student total.
- **The slice has a clean home for a pure fn.** `model/` is one-concept-per-file with
  co-located `*.test.ts` (e.g. `score.ts`/`score.test.ts`), and an existing multi-key
  comparator to mirror (`compute-groupings.ts:17-21`).

## Desired End State

Opening a plan, the palette boxes appear ordered by **total students (desc) → course count
(desc) → grouping id (asc)**, identically on every reload, and each box header reads
`N courses` on the left with the student total right-aligned (e.g. `6 students`). The
leading-course filter still works and preserves the order. Verify by loading a plan with
several groupings of differing student totals and confirming the top-down order matches the
header numbers, and that the order is unchanged across reloads.

### Key Discoveries:

- `coverageCount` (`model/grouping.ts:22`, computed at `score.ts:12`) is the requested
  "total students" metric and is exact for real (student-disjoint) groups.
- `PlannerPalette.tsx:18-41` renders groupings verbatim; `useLeadingFilter` preserves array
  order, so sorting **once before the filter** is sufficient.
- `compute-groupings.ts:17-21` is the in-slice precedent for a multi-key `toSorted`
  comparator (`b.x - a.x` for desc, `localeCompare` tiebreak).
- `GroupingBox.tsx:92-103` is the right-aligned `tabular-nums` counter pattern to mirror.

## What We're NOT Doing

- No DB / `load.ts` / SQL `ORDER BY` change, no migration, no new column.
- No new island props or catalog threading — both keys are already at the render site.
- No recompute of student counts from the live catalog (would diverge from the grouping's
  persisted identity; staleness is already handled by `catalog_hash`/`api/staleness.ts`).
- No `useGroupStudentCounts`/unique-union hook (would contradict the requested sum metric
  and recompute an existing value).
- No change to the `GroupingFilter` leading-course **dropdown** ordering — out of scope;
  this touches only the group boxes.
- No singular/plural logic — match the existing un-pluralized "N courses" header.
- `score` plays no role in this ordering (it's hours-similarity, unrelated to students).

## Implementation Approach

Add a pure `sortGroupingsForPalette(groupings)` function in `model/` (newspaper order,
`type` shapes, co-located test) that returns a new array sorted by `coverageCount` desc →
`memberIds.length` desc → `id` asc. Apply it once in `PlannerPalette` inside a `useMemo`
keyed on `groupings`, **before** `useLeadingFilter` (which preserves order). Then render the
persisted `coverageCount` in the `GroupingBox` header as a right-aligned counter mirroring
the existing hours-counter pattern, labeled "students".

## Phase 1: Deterministic palette sort

### Overview

Introduce the pure sort function, cover it with a unit test, and apply it in the palette so
the boxes render in a stable, total order.

### Changes Required:

#### 1. Pure sort function

**File**: `src/_pages/plan-detail/model/sort-groupings.ts` (new)

**Intent**: Provide a pure, deterministic, total ordering for palette groupings so the boxes
no longer appear in DB-encounter order. Sort by total students, then course count, then a
stable id tiebreaker.

**Contract**: `sortGroupingsForPalette(groupings: PlannerGrouping[]): PlannerGrouping[]` —
returns a new array (`toSorted`, no parameter mutation). Comparator ordering, mirroring the
`compute-groupings.ts` precedent:

```ts
// coverageCount desc → memberIds.length desc → id asc (stable, reload-safe)
if (b.coverageCount !== a.coverageCount) return b.coverageCount - a.coverageCount;
if (b.memberIds.length !== a.memberIds.length) return b.memberIds.length - a.memberIds.length;
return a.id.localeCompare(b.id);
```

#### 2. Co-located unit test

**File**: `src/_pages/plan-detail/model/sort-groupings.test.ts` (new)

**Intent**: Lock the ordering contract and prove determinism/immutability.

**Contract**: Vitest cases covering — primary key (higher `coverageCount` first); secondary
key (equal `coverageCount`, more `memberIds` first); tertiary key (equal students+courses →
`id` asc); input array is not mutated; empty array returns empty.

#### 3. Apply the sort in the palette

**File**: `src/_pages/plan-detail/ui/PlannerPalette.tsx`

**Intent**: Sort the incoming groupings once, before filtering, so both the filtered and
unfiltered views render in the deterministic order.

**Contract**: Wrap the sort in a `useMemo` keyed on `groupings`, then pass the sorted array
into `useLeadingFilter` (and to `GroupingFilter`, which can keep using the original prop —
its dropdown ordering is out of scope). The leading-course filter preserves order, so no
re-sort after filtering.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Linting + type-check passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Production build stays clean: `pnpm build`

#### Manual Verification:

- On a plan with several groupings, boxes render top-to-bottom by student total desc, then
  course count desc.
- The order is identical across a full page reload.
- Selecting a leading-course filter narrows the list while preserving the relative order.

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Student total in the box header

### Overview

Render the persisted `coverageCount` in each `GroupingBox` header, right-aligned, so the
ordering established in Phase 1 is legible.

### Changes Required:

#### 1. Header student counter

**File**: `src/_pages/plan-detail/ui/GroupingBox.tsx`

**Intent**: Surface the student total next to the existing "N courses" so the user can read
why a box sits where it does. The `group-dragging` change already flagged the bare "N
courses" headers as indistinguishable; this addresses that.

**Contract**: In the header (`GroupingBox.tsx:38-48`), keep `{grouping.memberIds.length}
courses` on the left and add a right-aligned `{grouping.coverageCount} students` counter
using the existing pattern (`ml-auto shrink-0 tabular-nums`, semantic tokens only). No new
prop — `grouping.coverageCount` is already in scope. Label is "students"; match the existing
header's un-pluralized style.

### Success Criteria:

#### Automated Verification:

- Linting + type-check passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Production build stays clean: `pnpm build`

#### Manual Verification:

- Each box header shows the student total, and it equals the sum of the member subjects'
  students.
- The number matches the Phase 1 ordering (higher number = higher box, ties broken by
  course count).
- Header styling follows light/dark theme tokens (no palette/literal colors) and the drag
  handle still works.

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `sort-groupings.test.ts` — primary/secondary/tertiary key ordering, immutability of the
  input array, empty-array handling.

### Integration Tests:

- None required — the change is client-only display logic over already-loaded data; no
  Supabase round-trip or action surface is touched.

### Manual Testing Steps:

1. Open a plan with multiple groupings of differing student totals; confirm the boxes are
   ordered students desc → courses desc, and headers show matching student totals.
2. Reload the page; confirm the order is identical.
3. Apply and clear the leading-course filter; confirm order is preserved.
4. Toggle dark mode; confirm the header counter uses theme tokens.

## Performance Considerations

The sort is O(n log n) over a palette-sized list, memoized on `groupings` — negligible and
well within the placement validation budget (which it does not touch).

## Migration Notes

None. No schema or data changes.

## References

- Research: `context/changes/planner-palette-group-sorting/research.md`
- Comparator precedent: `src/_pages/plan-detail/model/compute-groupings.ts:17-21`
- Sort insertion point: `src/_pages/plan-detail/ui/PlannerPalette.tsx:18-41`
- Header render point: `src/_pages/plan-detail/ui/GroupingBox.tsx:38-48`
- Counter pattern to mirror: `src/_pages/plan-detail/ui/GroupingBox.tsx:92-103`
- `coverageCount` semantics: `src/_pages/plan-detail/model/score.ts:12`,
  `src/_pages/plan-detail/model/constraints/student-conflict.ts:21`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Deterministic palette sort

#### Automated

- [x] 1.1 Unit tests pass: `pnpm test`
- [x] 1.2 Linting + type-check passes: `pnpm lint`
- [x] 1.3 FSD structure check passes: `pnpm steiger`
- [x] 1.4 Production build stays clean: `pnpm build`

#### Manual

- [x] 1.5 Boxes render by student total desc, then course count desc
- [x] 1.6 Order is identical across a full page reload
- [x] 1.7 Leading-course filter narrows the list while preserving order

### Phase 2: Student total in the box header

#### Automated

- [x] 2.1 Linting + type-check passes: `pnpm lint`
- [x] 2.2 FSD structure check passes: `pnpm steiger`
- [x] 2.3 Production build stays clean: `pnpm build`

#### Manual

- [x] 2.4 Each header shows the student total, equal to the sum of member subjects' students
- [x] 2.5 The number matches the Phase 1 ordering
- [x] 2.6 Header styling follows theme tokens and the drag handle still works
