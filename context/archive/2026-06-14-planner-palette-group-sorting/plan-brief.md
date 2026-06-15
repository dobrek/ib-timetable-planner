# Planner Palette Group Sorting — Plan Brief

> Full plan: `context/changes/planner-palette-group-sorting/plan.md`
> Research: `context/changes/planner-palette-group-sorting/research.md`

## What & Why

The planner palette shows its grouping boxes in an accidental order (no `ORDER BY` at load;
the array is rendered verbatim), so from the user's perspective the boxes look random. This
change gives them a deterministic, meaningful order — **total students desc → course count
desc → stable id** — and shows the **student total in each box header** so the ordering is
legible at a glance.

## Starting Point

Both sort keys already live on every `PlannerGrouping` at render time: `coverageCount`
(total students) and `memberIds.length` (course count). The palette
(`PlannerPalette.tsx:18-41`) just never sorts, and the header (`GroupingBox.tsx:47`) shows
only "N courses". So the work is purely display-side over existing data.

## Desired End State

Palette boxes render ordered by student total (desc), then course count (desc), then id —
identically on every reload — with each header reading `N courses` on the left and the
student total (e.g. `6 students`) right-aligned. The leading-course filter still works and
preserves the order.

## Key Decisions Made

| Decision           | Choice                                                  | Why (1 sentence)                                                                 | Source   |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------- | -------- |
| Sort location      | Pure `model/` fn, applied in palette via `useMemo`      | Pure, unit-testable, FSD-clean; zero persistence/migration risk                 | Research |
| Student metric     | Persisted `coverageCount` (no recompute)                | Identity-consistent; staleness already handled by `catalog_hash`                | Research |
| Tiebreaker         | `id` ascending                                          | Simple, stable across reloads, guarantees a total order                         | Plan     |
| Header label       | "students" (plain)                                      | Accurate — real groups are student-disjoint, so the sum equals distinct heads   | Plan     |
| Header layout      | Right-aligned `tabular-nums` counter                    | Mirrors the existing per-course hours counter; numbers align into a scan column | Plan     |

## Scope

**In scope:**
- A pure `sortGroupingsForPalette()` in `model/` + co-located unit test.
- Apply the sort once in `PlannerPalette` (before the leading-course filter).
- Render the student total in the `GroupingBox` header.

**Out of scope:**
- Any DB/`load.ts`/SQL/migration change; new props; catalog threading.
- Recomputing student counts from the live catalog; a unique-union hook.
- `GroupingFilter` leading-course **dropdown** ordering.
- Singular/plural label logic (match existing un-pluralized "N courses").

## Architecture / Approach

Client-only. New pure comparator (`coverageCount` desc → `memberIds.length` desc → `id` asc)
mirroring the in-slice `compute-groupings.ts:17-21` precedent, applied in a `useMemo` keyed
on `groupings` before `useLeadingFilter` (which preserves order). Header gains a
right-aligned counter mirroring the `GroupingBox.tsx:92-103` hours-counter pattern, using
semantic theme tokens only.

## Phases at a Glance

| Phase                         | What it delivers                                     | Key risk                                        |
| ----------------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| 1. Deterministic palette sort | Pure sort fn + test, applied in the palette          | Sort must precede the filter to stay correct    |
| 2. Student total in header    | `coverageCount` rendered, right-aligned, "students"  | Stay on theme tokens; don't break the drag handle |

**Prerequisites:** None — both sort keys are already at the render site.
**Estimated effort:** ~1 session, 2 small phases.

## Open Risks & Assumptions

- Assumes persisted groupings are student-disjoint (enforced by the enumerator), so
  `coverageCount` equals distinct students — verified in research; makes "students" accurate.
- Assumes the leading-course filter preserves array order (it does — a plain `.filter()`),
  so a single pre-filter sort suffices.

## Success Criteria (Summary)

- Palette boxes appear ordered by student total, then course count, identically on reload.
- Each header shows the student total, matching its position in the order.
- No regression to the leading-course filter or group/course drag affordances.
