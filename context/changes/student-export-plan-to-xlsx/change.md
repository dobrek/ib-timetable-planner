---
change_id: student-export-plan-to-xlsx
title: Student export plan to xlsx
status: planned
created: 2026-07-08
updated: 2026-07-08
archived_at: null
---

## Notes

Sits at the intersection of the two shipped export changes — `2026-07-07-export-to-xlsx` (the base grid machinery) and `2026-07-08-teacher-export-plan-to-xlsx` (the persona-agnostic export core) — over the `student-plan-view` slice. Feasibility + reuse map in `research.md`. Highly feasible: no schema, no new loader/query, no new dependency (`write-excel-file@4.1.1` installed), no Cloudflare change.

## Scope Decisions 2026-07-08 (resolved with the author)

Authoritative input to `/10x-plan`; these resolve `research.md` §Open Questions.

1. **Workbook scope → plan grid only.** A single-sheet `.xlsx` containing just the student's timetable grid — no per-course sheets. (The student loader fetches no student-name records; a per-course roster would list teachers, a different shape, and is not wanted.)
2. **Cohort tag → none (clean labels).** A student belongs to ONE cohort, so every course on the grid is that cohort; labels read like the base board plan export (`Mathematics HL`), with NO `(DP1)`/`(DP2)` suffix.
3. **Filename → `<plan-slug>-<cohort>-<student-name>.xlsx`** (e.g. `ib-2027-draft-dp1-jan-kowalski.xlsx`). Students have no short `code` (unlike teachers), so the slug uses cohort + slugified full name.

### Consequence for reuse

Decisions 1 + 2 mean the student path leans on the **base** export machinery, not the teacher's additions: call `buildTimetableSheet` directly with a single `TimetableSheetColumn` and **no** `cohortTag`. `buildPerspectiveWorkbook` is unsuitable as-is because it unconditionally builds and passes a `cohortTag` (forcing `(DPx)` on every label) and its per-course-sheet machinery is unused here.

### Not doing

- No per-course / roster sheets (grid only).
- No `(DPx)` cohort tag on labels.
- No reuse of `buildPerspectiveWorkbook` as-is (cohort-tag is unconditional); no reuse of the plan-detail `_pages` glue (FSD-trapped).
- No schema, no new loader/query, no new dependency, no server-side/Worker route, no Cloudflare/infra change.
