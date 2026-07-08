# Teacher Export Plan to XLSX — Plan Brief

> Full plan: `context/changes/teacher-export-plan-to-xlsx/plan.md`
> Research: `context/changes/teacher-export-plan-to-xlsx/research.md`

## What & Why

Give the read-only teacher plan view an **Export to XLSX** button. One click downloads a workbook: a grid sheet mirroring the teacher's on-screen timetable (both cohorts merged, each line tagged `(DP1)`/`(DP2)`) plus one sheet per course listing that course's assigned students. This replaces the "read on screen / retype into a spreadsheet" gap, and — by building the transform persona-agnostically — sets up the sibling student view to gain export nearly for free.

## Starting Point

The teacher view already hydrates every needed input (both cohorts' placements, catalogs, name maps, merges, course info) and already computes per-course rosters via `buildPerspectiveCourseItems`. The pure, library-free XLSX sheet layer (`buildTimetableSheet`, `buildRosterSheet`, `sheet-types.ts`) shipped with the board export and lives in `entities/timetable`. This change is ~80% assembly of existing parts; the board's `ExportMenu` is a near-complete template (but its glue is page-slice-trapped and cohort-shaped, so it's a reference, not a reuse).

## Desired End State

An Export icon button sits beside the teacher switcher. Clicking it downloads `<plan-slug>-<teacher-code>.xlsx` with a `Timetable` grid sheet and one `Name · DPx` sheet per course. The grid is styled "clean" (subject fills, break bands, frozen headers, no collision marks); each per-course sheet shows a plain header (name, cohort·level, hours, co-teachers, times) over the roster. The button is disabled when the teacher has no courses. The assembler is persona-agnostic in `entities/timetable`; `write-excel-file` is bound only at the button.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Transform reach | Persona-agnostic in `entities`, teacher wired now | Student export becomes a ~1-file follow-up; library bound only at the leaf | change.md |
| Grid sheet shape | One merged grid, each line cohort-tagged `(DP1)`/`(DP2)` | Mirrors the on-screen teacher grid; small generalization of `buildTimetableSheet`, not a fork | change.md |
| Per-course sheet | Rich header + roster | All inputs already in `PerspectiveCourseItem`; merge-children get their own rosters | change.md |
| Grid style | Clean (fills/tags/breaks/frozen; no collision or availability marks) | Matches the shipped board-export convention; reads clean regardless of validation state | change.md |
| Tab names | Always `Name · DPx`, sanitized + truncated ≤31 + deduped | Library throws on illegal/overlong names and ignores uniqueness | change.md / research |
| Summary sheet | None | The grid is the overview; a teacher has few courses | change.md |
| Filename | `<plan-slug>-<teacher-code>.xlsx` | Mirrors `exportFileName`'s slugging with the code appended | change.md |
| Entry point | Single Export icon button beside `TeacherSwitcher` | One export target — no dropdown needed | change.md |
| No-courses teacher | Disable the button | Avoids a near-empty file; mirrors the page's empty state | Plan |
| Empty-roster course | Still render the sheet ("No students assigned") | Header still has value; consistent with the grid and `buildRosterSheet` | Plan |
| Per-course header style | Plain (no subject fills) | Simplest, maximal legibility | Plan |

## Scope

**In scope:** persona-agnostic workbook assembler + per-course sheet builder + sheet-name sanitize/dedup helper in `entities/timetable`; a `(DP1)`/`(DP2)` cohort-tag generalization of `buildTimetableSheet`; the teacher Export button + header wiring; co-located unit tests.

**Out of scope:** student Export button; server-side/Worker route; summary/all-subjects sheet; subject-color fills on per-course sheets; any schema/loader/dependency/infra change; reuse of the plan-detail export glue.

## Architecture / Approach

Two layers, split along the existing library boundary. **(1) A pure core** in `entities/timetable/model/export/`: generalize `occupantLabel` to carry a cohort suffix (single merged column + a `courseId → cohort` tag map), add `buildPerspectiveCourseSheet` (one course → header + roster), add a `sheet-name` sanitize/truncate/dedup helper, and add `buildPerspectiveWorkbook` returning named `TimetableSheet`s + a filename — all library-free and unit-tested. **(2) A thin leaf** `ExportTeacherPlanButton` that binds `write-excel-file/browser`, renames `rows`→`data` into library sheet descriptors, `.toFile()`s, and toasts on failure — slotted into the teacher page header. The entity assembler avoids the widget `CourseInfo` type (FSD upward-import ban): `level` enters as a structural `Record<courseId, string>`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Export core (`entities`) | Cohort-tag generalization, per-course sheet builder, sheet-name helper, `buildPerspectiveWorkbook`, tests | Sheet-name sanitize/truncate/**dedup** (case-insensitive, ≤31, suffix-preserving) — the one place the library throws or silently corrupts |
| 2. Teacher button | `ExportTeacherPlanButton` (library leaf) + header wiring, disabled-when-empty | Threading the right derived props; `write-excel-file/browser` in a new island bundle |

**Prerequisites:** none — all inputs already loaded; `write-excel-file@^4.1.1` already installed.
**Estimated effort:** ~1–2 sessions across 2 phases.

## Open Risks & Assumptions

- Sheet-name collisions are rare but real (long names, or two same-cohort courses truncating identically); the dedup helper is isolated and unit-tested to de-risk this.
- `write-excel-file/browser` lands in the teacher island bundle (already precedented on the board page) — no bundle concern expected.
- Assumes `courseInfo.level` is present for every conducted course (loaded for all plan courses); a missing entry degrades to a blank level, not a crash.

## Success Criteria (Summary)

- A teacher can export their plan to a valid `.xlsx` — a clean cohort-tagged grid plus one roster sheet per course — from one button, named `<plan-slug>-<teacher-code>.xlsx`.
- Long/illegal/colliding course names never throw or corrupt the workbook; empty rosters render gracefully; the button disables with no courses.
- `pnpm check`/`lint`/`steiger`/`test`/`build` all pass; the transform stays library-free in `entities` (student/Worker reuse unblocked).
