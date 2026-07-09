# Student Export Plan to XLSX — Plan Brief

> Full plan: `context/changes/student-export-plan-to-xlsx/plan.md`
> Research: `context/changes/student-export-plan-to-xlsx/research.md`

## What & Why

Add an **Export to XLSX** button to the student plan view so an author viewing a student's schedule can download it as a single-sheet workbook. This is the deferred sibling of the shipped teacher export — the base export core was built explicitly so the student view "gets export nearly for free."

## Starting Point

The student island (`StudentPlanPage.tsx`) already computes, at render time, the student-narrowed placements and cohort/display data that a grid sheet needs. The pure `buildTimetableSheet` transform already produces the exact single-cohort, tag-free sheet this feature wants. `write-excel-file@4.1.1` is installed. What's missing is the button leaf, a filename helper, and a shared `slugify` (currently duplicated privately in two places).

## Desired End State

An Export icon sits beside the student switcher. Clicking it downloads `<plan-slug>-<cohort>-<student-name>.xlsx` — one "Timetable" sheet reproducing the on-screen grid (placed courses, clean subject-colored labels, break bands, frozen panes). Diacritic names render legibly in the filename (`Paweł Głąb` → `pawel-glab`). The button disables when the student has no placed courses; failures toast. Board/teacher exports are unchanged for ASCII inputs.

## Key Decisions Made

| Decision                     | Choice                                                        | Why (1 sentence)                                                                                     | Source   |
| ---------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | -------- |
| Workbook scope               | Plan grid only, single sheet                                 | A student has no roster to export (on-page roster is teachers).                                      | Research |
| Cohort tag on labels         | None (clean labels)                                          | A student is single-cohort, so `(DPx)` is redundant noise.                                           | Research |
| Filename format              | `<plan-slug>-<cohort>-<student-name>.xlsx`                    | Students have no short `code` like teachers; cohort + slugified name is stable and readable.         | Research |
| Reuse seam                   | `buildTimetableSheet` directly (no `cohortTag`)              | `buildPerspectiveWorkbook` unconditionally tags every label and adds unused course sheets.           | Research |
| Slugify placement            | Extract shared `@/shared/lib/slugify`, route all 3 sites     | DRY — retires two private copies; matches the barrel/concept-file convention.                        | Plan     |
| Diacritics in filenames      | Transliterate (NFD fold + `ł→l`) before slugifying           | Polish student names degrade to unreadable stubs otherwise; monotonic (ASCII unaffected).            | Plan     |
| Button data flow             | Page computes narrowing, button is a pure leaf (props)       | Mirrors `ExportTeacherPlanButton`; button trivially testable, no duplicated narrowing.               | Plan     |

## Scope

**In scope:** shared `slugify` (diacritic-folding) + re-route two existing copies; student filename helper; `ExportStudentPlanButton` leaf + unit test; header wiring.

**Out of scope:** per-course/roster sheets; `(DPx)` labels; reuse of `buildPerspectiveWorkbook`; any schema/loader/query/dependency/route/infra change; filename-collision handling; behavior change to board/teacher exports beyond the monotonic slug improvement.

## Architecture / Approach

Bottom-up: (1) shared `slugify` becomes the single DRY home for filename slugs; (2) a pure slice-local filename helper + a thin `write-excel-file/browser` button that calls the library-free `buildTimetableSheet` on one untagged column and names the sheet `"Timetable"`; (3) the page composes the button beside the switcher, passing its already-narrowed placements. The pure transform stays library-free (server-side reuse remains open); only the button binds the browser writer.

## Phases at a Glance

| Phase                                   | What it delivers                                              | Key risk                                                              |
| --------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| 1. Shared `slugify` foundation          | `@/shared/lib/slugify` + two re-routed call sites            | `ł` doesn't NFD-decompose (needs explicit map); don't shift ASCII output |
| 2. Filename helper + export button      | `studentExportFileName` + `ExportStudentPlanButton` + tests  | Naming the unnamed single sheet; correct disabled predicate          |
| 3. Wire into header                     | Button mounted beside the switcher                           | Passing the page-narrowed placements (not re-deriving)               |

**Prerequisites:** none — all inputs already hydrated; `write-excel-file` installed.
**Estimated effort:** ~1 session across 3 small phases (roughly a 4-file change plus tests).

## Open Risks & Assumptions

- Transliteration is assumed monotonic — verified by the absence of diacritic fixtures in the two re-routed sites; existing ASCII filename tests must stay byte-identical (treated as a regression gate in Phase 1).
- Two students with names that slugify identically in the same cohort collide on filename — accepted as out of scope.
- The diacritic map is minimal (Polish `ł`); other stroke letters (`ø`, `đ`) are not covered and can be added later.

## Success Criteria (Summary)

- Author can export any student's grid to a correctly-named single-sheet `.xlsx` that matches the on-screen grid.
- Diacritic student names produce legible filenames; the button disables when there's nothing to export.
- `pnpm check` / `lint` / `steiger` / `test` / `build` all clean; board and teacher exports unaffected.
