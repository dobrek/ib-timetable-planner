---
date: 2026-07-08T22:23:11+02:00
researcher: Claude (Opus 4.8)
git_commit: 94d216da25ea47f5ba5381730275a19499c2378a
branch: main
repository: 10xdev3 (ib-timetable-planner)
topic: "Feasibility of exporting the student plan view to XLSX — the plan grid only (single sheet, single cohort, no per-course sheets), reusing the shipped base + teacher export machinery"
tags: [research, codebase, export, xlsx, student-plan-view, entities-timetable, write-excel-file, fsd]
status: complete
last_updated: 2026-07-08
last_updated_by: Claude (Opus 4.8)
---

# Research: Export student plan view to XLSX — feasibility

**Date**: 2026-07-08T22:23:11+02:00
**Researcher**: Claude (Opus 4.8)
**Git Commit**: `94d216da25ea47f5ba5381730275a19499c2378a`
**Branch**: `main`
**Repository**: 10xdev3 (ib-timetable-planner)

## Research Question

Check the feasibility of an **Export to XLSX** feature on the **student plan view** page. Scope (confirmed with the author): export **only the plan** (the student's timetable grid) as a single-sheet workbook — no additional per-course/roster sheets. Reuse the elements built in the two prior shipped changes: the base plan export (`2026-07-07-export-to-xlsx`) and the teacher-perspective export (`2026-07-08-teacher-export-plan-to-xlsx`).

## Summary

**Highly feasible — the smallest of the three export changes.** Every input is already hydrated in the student island, every derivation the export needs is already computed at render time, and the pure grid transform (`buildTimetableSheet`) already produces exactly the single-cohort, tag-free sheet this feature wants. No schema, no new loader/query, no new dependency (`write-excel-file@4.1.1` is installed), no Cloudflare/infra change. The genuinely new code is **one button component (the `write-excel-file/browser` leaf)** plus a header-slot edit, and one small decision about where the filename slugifier lives.

Five findings shape the design:

1. **The student view already renders exactly the grid the export needs.** `StudentPlanPage` (`src/_pages/student-plan-view/ui/StudentPlanPage.tsx:22-49`) is a `client:load` island (`src/pages/plans/[id]/students/[studentId].astro:35`) that at render time computes the student's own course ids (`mineIds`, `:25`), the **student-narrowed placements** (`perspectivePlacements(data.placements, mineIds)`, `:28`), and the display map (`data.courseDisplay`). That is the entire input to a grid sheet. All props are plain serializable data (`loader.ts:29-47`).

2. **The student view is single-cohort — the simplest grid shape.** The loader fetches only `student.cohort` data (`loader.ts:86-89`); `StudentSummary.cohort` is typed `Cohort` (`loader.ts:23`). There is no dp1/dp2 merge (unlike the teacher grid), so the export is one `TimetableSheetColumn`, no cohort disambiguation, no `(DPx)` tag — matching the author's "clean labels" decision.

3. **The reusable seam is `buildTimetableSheet` called *directly* (no `cohortTag`), not `buildPerspectiveWorkbook`.** With `cohortTag` omitted, `occupantLabel` appends no cohort suffix (`timetable-sheet.ts:224-231`), and with a single column the cohort sub-label row is not rendered and `stickyRowsCount` is `1` (`timetable-sheet.ts:40,48,54-59`). Subject fills, break bands, weighted borders and frozen panes all come for free. `buildPerspectiveWorkbook` is **unsuitable as-is** because it *unconditionally* builds and passes a `cohortTag` from all placements (`perspective-workbook.ts:73-85`), which would force `(DP1)`/`(DP2)` onto every label — the exact thing the author asked to omit.

4. **The button is a near-copy of the shipped teacher button.** `ExportTeacherPlanButton.tsx` is the single `write-excel-file/browser` binding: it maps `TimetableSheet` → the library's descriptor (`rows`→`data`, plus `columns`/`stickyRowsCount`/`stickyColumnsCount`, `:75-81`), calls `.toFile(fileName)` (`:82`), toasts on failure via `sonner` + its own `<Toaster/>` (`:84,92`), and disables itself when there is nothing to export (`:100`). The student button copies this leaf, dropping the per-course/`omitTeacherKey` machinery, and building a single grid sheet.

5. **One real gap vs. the teacher mirror: students have no short `code`.** `StudentSummary` is `{ id, fullName, cohort }` (`loader.ts:23`) — no `code`. The filename therefore derives from `cohort` + slugified `fullName` → `<plan-slug>-<cohort>-<student-name>.xlsx` (author's choice). The slugifier is currently a **private, duplicated** helper (in `export-file-name.ts:12-18` and `perspective-workbook.ts:122-126`); the plan must pick between extracting a shared `slugify` or inlining a small local one (see §6).

**Bottom line:** feasible with high confidence; effort is small (roughly a 1–2 file change plus tests). The design is settled by the author's three scope decisions (grid-only, no tag, filename); the only remaining implementation judgment is the slugify-placement question.

## Detailed Findings

### 1. The student plan view — data, render path, and where the button lands

**Route + island.** `src/pages/plans/[id]/students/[studentId].astro` SSR-loads via `loadStudentPlanView` (`:6`) and mounts `<StudentPlanPage data={data} client:load />` (`:4,35`) only on the success branch (`:24`). `client:load` means the handler is fully client-side over props — identical hydration model to the teacher and board exports.

**Island data shape** — `StudentPlanViewData` (`src/_pages/student-plan-view/api/loader.ts:29-47`), all plain serializable (no Maps):

```ts
type StudentSummary = { id: string; fullName: string; cohort: Cohort };   // loader.ts:23 — NO `code`
type StudentPlanViewData = {                                              // loader.ts:29-47
  planId; planName; days; periods;
  student: StudentSummary;                 // the viewed student (single cohort)
  students: StudentSummary[];              // both cohorts, for the switcher
  cohortLeads: Record<Cohort, StudentSummary | undefined>;
  courses: GroupingCourse[];               // FULL cohort catalog (merge children resolve through it)
  courseDisplay: Record<string, CourseDisplay>;
  placements: PlannerPlacement[];          // FULL cohort placements
  teacherNames: Record<string, string>;
  courseInfo: Record<string, CourseInfo>;
  merges: CourseMerge[];
};
```

Note the loader is **schedule-only and single-cohort**: it loads `loadCohortCourses/loadPlacements/fetchCourseInfo` for `student.cohort` alone (`loader.ts:86-89`), and deliberately loads **no student-name records** — "the card rosters list teachers" (`loader.ts:56-57`). This is why a per-course roster sheet was ruled out: a student has no roster to show (the on-page card roster is *teachers*, `StudentPlanPage.tsx:44-48`).

**Header slot.** `StudentPlanPage.tsx:53-64` is a `justify-between` header with the title block on the left and `<StudentSwitcher>` (`:58-63`) as a **direct child** of `<header>` (no wrapping flex `div`, unlike the teacher header). To mirror the teacher layout, wrap `<StudentSwitcher>` + a new `<ExportStudentPlanButton>` in a `flex items-center gap-2` container (the teacher does this at `TeacherPlanPage.tsx:117`).

### 2. The grid render path is already computed — the export reuses it verbatim

`StudentPlanPage` already derives everything a grid sheet needs (`:25-29`):

```ts
const mineIds = new Set(studentCourses(data.courses, student.id).map((c) => c.id));   // :25
const placements = perspectivePlacements(data.placements, mineIds);                    // :28 — student-narrowed
const occupantsByCell = groupCellOccupants(placements, data.courseDisplay, new Map()); // :29 — feeds the on-screen grid
```

`placements` here is exactly what `buildTimetableSheet`'s single column takes (`TimetableSheetColumn = { cohort, placements, courseDisplay }`). The export button can recompute this trio (or the page can compute once and pass it down) and hand it straight to the transform. No new narrowing logic — `studentCourses` and `perspectivePlacements` are both on the entity barrel and already imported by the page (`StudentPlanPage.tsx:1-7`).

### 3. The reusable export core — `buildTimetableSheet` produces the exact sheet

`src/entities/timetable/model/export/timetable-sheet.ts` is pure, library-free, and on the public barrel (`index.ts:20`). Its shape fits the student case precisely:

- **Input** (`:13-26`): `columns: TimetableSheetColumn[]` (one column = focus/single-cohort mode) + optional `cohortTag?: ReadonlyMap<string, Cohort>` (`:25`).
- **No tag when `cohortTag` is omitted** (`occupantLabel`, `:224-231`): `cohortSuffix` is `""` unless `cohortTag.get(courseId)` resolves. Omitting it yields clean `Mathematics HL` labels (author's decision #2).
- **Single-column behavior** (`:40,48`): `const multi = columns.length > 1`; the cohort sub-label row (`cohortLabelRow`) only renders when `multi`, and `column.cohort` is otherwise never read — so a single student column passes any placeholder cohort and gets a clean one-header-row grid. `stickyRowsCount` is `1` for a single column (`:54-59`).
- **Styling for free**: subject fills via `SUBJECT_COLOR_HEX` (`subject-colors.ts:56`, consumed at `timetable-sheet.ts:215,234-235`), P2/P5 break bands (hatched), weighted borders (`SEPARATOR_COLOR #4B5563` over the `#D1D5DB` grid), and frozen panes — mirroring the board's focus-view export.
- **Output** `TimetableSheet` (`sheet-types.ts:64-69`): `{ rows, columns: {width}[], stickyRowsCount, stickyColumnsCount }` — the shape the `write-excel-file` leaf renames `rows`→`data`.

Sheet naming: the single sheet is named `"Timetable"` via `sanitizeSheetName(...) || "Timetable"` (`sheet-name.ts:12,17-21`) — same as `perspective-workbook.ts:62-65`. `courseSheetName`/`dedupeSheetNames` are cohort/multi-sheet specific and **not needed** for a one-sheet workbook.

### 4. Why NOT reuse `buildPerspectiveWorkbook` as-is

`buildPerspectiveWorkbook` (`perspective-workbook.ts:46-59`) is persona-agnostic and its `PerspectiveWorkbookInput` even documents `fileCode` as "the teacher code now, **a student code later**" (`:19`), with `omitTeacherKey`/`gridSheetName` optional (`:32-33`). But two properties make it the wrong tool for the *grid-only, no-tag* student export:

1. **It always builds and passes a `cohortTag`** (`buildGridSheet`, `:73-85`) constructed from every placement's `courseId → cohort` — so **every** occupant label would get a `(DP1)`/`(DP2)` suffix. There is no flag to suppress it.
2. Its value-add over `buildTimetableSheet` is precisely the parts the student doesn't want: per-course sheets from `items` (`:90-105`) and cross-sheet dedup. Passing `items: []` removes the course sheets but leaves the tagged grid and still requires a `fileCode`.

Reusing it would therefore require a generalization (e.g. a `tagCohorts?: boolean`) — more churn than calling `buildTimetableSheet` directly. **Recommendation:** call `buildTimetableSheet` directly (the base-export path), matching author decisions #1 + #2. This is genuinely reusing "exporting plan" (the base machinery) rather than the teacher's additions.

### 5. The button leaf — a trimmed copy of `ExportTeacherPlanButton`

`src/_pages/teacher-plan-view/ui/ExportTeacherPlanButton.tsx` is the single site binding the library and is the exact pattern to mirror:

- `import writeXlsxFile from "write-excel-file/browser";` (`:4`), `Download` from lucide (`:2`), `toast` from `sonner` (`:3`), `Button`/`Toaster` from `@/shared/ui` (`:6`).
- Descriptor mapping (`:75-81`): `sheets.map(({name, sheet}) => ({ data: sheet.rows, sheet: name, columns: sheet.columns, stickyRowsCount: sheet.stickyRowsCount, stickyColumnsCount: sheet.stickyColumnsCount }))`.
- `await writeXlsxFile(descriptors).toFile(fileName);` (`:82`); `catch → toast.error("Export failed — try again.")` (`:84`).
- Renders its own `<Toaster/>` (`:92`, the perspective pages mount none) + a ghost `size="icon"` `Button` with `title`/`aria-label` (`:94-99`) and `disabled={exporting || items.length === 0}` (`:100`).

**Student button diffs from the teacher's:** builds **one** grid sheet via `buildTimetableSheet` (not the multi-sheet assembler), so its `disabled` guard is "no placed courses" (`mineIds.size === 0` or `placements.length === 0`) rather than `items.length === 0`; drops `omitTeacherKey`, `studentNames`, `courseLevels`, per-course `items`; and computes the filename from cohort + student name (§6).

**Test pattern** (`ExportTeacherPlanButton.test.tsx`) is directly copyable: `vi.hoisted` mocks for `write-excel-file/browser` (`{ default: writeXlsxMock }` where `writeXlsxMock` returns `{ toFile, toBlob }`), `sonner` (`{ toast: { error } }`), and `@/shared/ui` (`Button`→plain `<button>`, `Toaster`→`() => null`). Assertions: accessible trigger by name, disabled-when-empty, click → `toFile` called with the expected filename and the sheet-name list, and a rejected `toFile` surfaces the toast. The pure transform runs for real (unmocked).

### 6. Filename + the slugify duplication decision

Author's choice: `<plan-slug>-<cohort>-<student-name>.xlsx` (e.g. `ib-2027-draft-dp1-jan-kowalski.xlsx`). Inputs are all on the page: `planName`, `student.cohort`, `student.fullName`.

There are **two identical private `slugify` implementations**, neither exported, and none in `@/shared` (grep-confirmed):

- `src/_pages/plan-detail/lib/export-file-name.ts:12-18` — `exportFileName(planName, view)` → `${slugify(planName)}-${view}.xlsx` (`:10`).
- `src/entities/timetable/model/export/perspective-workbook.ts:122-126` — used only for `buildPerspectiveWorkbook`'s filename (`:57`).

Both are `value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "plan"`. Two clean options for the plan:

- **(a) Extract a shared `slugify`** to `@/shared/lib` and route all three call sites through it (kills the duplication; the student path calls `slugify(planName)`, `slugify(student.cohort)` — already slug-safe — and `slugify(student.fullName)`).
- **(b) Inline a tiny local slugifier** in the student button (mirrors the existing precedent of two private copies; least reach but a third duplicate).

Recommendation to settle in planning: (a) is the DRY choice and aligns with the "barrel + concept-file" shared-lib convention; (b) is faster but adds a third copy. Either satisfies the filename requirement.

### 7. Dependency, FSD, perf — all clear

- **Dependency:** `write-excel-file@^4.1.1` declared (`package.json:53`), installed `4.1.1`. Client entry `write-excel-file/browser` (`.toFile()`); no new dependency.
- **FSD:** `src/_pages/student-plan-view` may import `@/entities/timetable` and `@/shared/*` (downward), and must **not** import another `_pages/*` slice (CLAUDE.md layer rule: `app → _pages → widgets → entities → shared`). This is why the plan-detail glue (`export-workbook.ts`, `export-file-name.ts`, `ExportMenu.tsx`) is not reusable and the student writes its own thin leaf on the entity transform — the same constraint the teacher export honored.
- **Performance:** a click-driven, one-student, single-sheet, few-hundred-cell client-side generation. The <200ms drag-drop budget (CLAUDE.md hard rule) is untouched.
- **No schema / loader / route change:** all inputs already loaded; no server-side/Worker export route is built (the transform stays library-free, so `write-excel-file/universal` reuse remains open for a future batch path — but out of scope here).

## Code References

- `src/pages/plans/[id]/students/[studentId].astro:4,6,35` — route, `loadStudentPlanView`, `<StudentPlanPage client:load>`
- `src/_pages/student-plan-view/api/loader.ts:23,29-47,56-57,86-89` — `StudentSummary` (no `code`), `StudentPlanViewData`, no student-names note, single-cohort loads
- `src/_pages/student-plan-view/ui/StudentPlanPage.tsx:25-29,34-49,53-64` — `mineIds`/narrowed `placements`/`occupantsByCell`; teacher-roster cards; header + `StudentSwitcher` slot
- `src/entities/timetable/model/export/timetable-sheet.ts:13-26,40,48,54-59,215,224-231,234-235` — input/column types, `multi` guard, output shape, subject fill, `occupantLabel` (no-tag path)
- `src/entities/timetable/model/export/sheet-types.ts:29-60,64-69` — `TimetableSheetCell` / `TimetableSheet` (the leaf's descriptor source)
- `src/entities/timetable/model/export/sheet-name.ts:12,17-21` — `SHEET_NAME_MAX`, `sanitizeSheetName` (for the `"Timetable"` sheet name)
- `src/entities/timetable/model/export/perspective-workbook.ts:19,57,62-65,73-85,122-126` — persona-agnostic assembler; unconditional `cohortTag` (why it's unsuitable); private `slugify`; filename format
- `src/entities/timetable/index.ts:14,17,18,19,20,22,23,24` — public barrel (`buildTimetableSheet`, sheet types/name helpers, `perspectivePlacements`, `studentCourses`, `groupCellOccupants`, etc.)
- `src/shared/config/subject-colors.ts:56` — `SUBJECT_COLOR_HEX` for xlsx fills
- `src/_pages/teacher-plan-view/ui/ExportTeacherPlanButton.tsx:2-6,21-34,75-82,84,92,94-100` — the `write-excel-file/browser` leaf to mirror (import, props, descriptor map, `.toFile`, toast, `Toaster`, button attrs, disabled)
- `src/_pages/teacher-plan-view/ui/ExportTeacherPlanButton.test.tsx` — copyable mock + assertion pattern
- `src/_pages/teacher-plan-view/ui/TeacherPlanPage.tsx:104-106,112-142,117` — `courseLevels` derivation; header flex container hosting switcher + export button
- `src/_pages/plan-detail/lib/export-file-name.ts:10,12-18` — `exportFileName` + private `slugify` (duplication #1)
- `src/_pages/plan-detail/lib/export-workbook.ts:83-89` — board's `TimetableSheet`→descriptor mapping (same shape the student leaf uses)
- `package.json:53` — `write-excel-file@^4.1.1` (installed 4.1.1)
- `src/middleware.ts:18` — deny-by-default (a future export route would stay auth-gated for free; not in scope)

## Architecture Insights

- **The student export is the base export re-applied, not the teacher export re-run.** Author decisions (grid-only, no cohort tag) collapse the student path onto `buildTimetableSheet` with a single, untagged column — precisely the base board export's focus-view (dp1/dp2) case (`2026-07-07-export-to-xlsx`). The teacher change's `buildPerspectiveWorkbook` is a *superset* (cohort-tagged merged grid + per-course sheets) whose extra behavior is unwanted here; reusing the lower-level transform both personas already share is the cleaner fit than bending the teacher assembler.
- **The reusable seam is the entity + shared config, not `_pages` glue** — the same conclusion the teacher change reached. `entities/timetable` transforms + `SUBJECT_COLOR_HEX` are the durable, dependency-free core; the `write-excel-file` binding, filename, and toast are thin per-slice leaves.
- **Runtime-agnosticism is preserved by construction.** Calling `buildTimetableSheet` (library-free) and binding `write-excel-file/browser` only at the button keeps the transform importable by a future Worker route (`/universal`) — the "don't block server-side reuse" invariant carried through both prior changes stays intact even though no route is built.
- **The one genuine new decision is cosmetic plumbing (slugify placement), not architecture.** Everything domain-level already exists; the plan's only real choice is DRY-extract vs. inline for the filename slug.

## Historical Context (from prior changes)

- `context/archive/2026-07-08-teacher-export-plan-to-xlsx/{change.md,plan.md,research.md}` — built the persona-agnostic core in `entities/timetable/model/export/` **explicitly so "the sibling `student-plan-view` gets export nearly for free later"** and listed student export as a deferred "~1-file follow-up" (`change.md` §Scope Decisions #1; `plan.md` "What We're NOT Doing"). This change is that follow-up — but the author's grid-only/no-tag scope means it reuses `buildTimetableSheet` directly rather than `buildPerspectiveWorkbook`.
- `context/archive/2026-07-07-export-to-xlsx/{change.md,plan-brief.md}` — built the base xlsx machinery. Key priors: the export mirrors the board **focus modes** where **dp1/dp2 is the single-sub-column (single-cohort) variant** (`change.md` 2026-07-07 "Workbook scope"/"Fidelity principle") — structurally identical to the student grid; **client-side generation** ("export what you see"); and **per-teacher/per-student sheets were explicitly out of scope there**, deferred to exactly this line of work. Grid fidelity rules (one cell per course with its own fill, rowSpanned time header, weighted borders, hatched break bands) all live in `buildTimetableSheet` and apply unchanged.
- `context/foundation/prd.md` Open Question #3 (master grid export) was resolved by the base xlsx change; a per-student grid is a natural extension of that resolution, not a new product question. Print/PDF remains a PRD non-goal — xlsx is the sanctioned medium.
- `context/foundation/lessons.md` — relevant priors: "Green build/test/lint ≠ type-safe — `pnpm check` is the mandatory type gate" (success criteria must cite `pnpm check`); "A convention that cites a code mechanism is coupled to it — verify the symbol" (all line refs above were re-verified against `main` @ `94d216d`); "Prefer declarative pipelines over imperative accumulator loops" (any new slug/derivation helper).

## Related Research

- `context/archive/2026-07-08-teacher-export-plan-to-xlsx/research.md` — the persona-agnostic reuse map, sheet-name sanitization risk analysis, server-side batch feasibility
- `context/archive/2026-07-07-export-to-xlsx/research.md` — library comparison (why `write-excel-file`), client-vs-server analysis, Cloudflare limits

## Open Questions

The three design forks unique to the student case were **resolved with the author** (recorded in `change.md` §Scope Decisions):

1. **Workbook scope** → plan grid only (single sheet, no per-course/roster sheets). ✔ resolved
2. **Cohort tag on labels** → none / clean labels (single-cohort student). ✔ resolved
3. **Filename** → `<plan-slug>-<cohort>-<student-name>.xlsx`. ✔ resolved

Remaining judgment for `/10x-plan` (implementation-level, not product):

- **Slugify placement (§6):** extract a shared `@/shared/lib` `slugify` used by all three call sites (DRY, recommended) vs. inline a small local slugifier in the student button (a third private copy). Either meets the filename requirement.
- **Where to compute the grid inputs:** recompute `mineIds`/narrowed `placements` inside the button, or lift them in `StudentPlanPage` and pass down as props (the teacher page computes narrowing in the page and passes cohort objects to the button — mirroring that keeps the button a pure leaf).
- **`disabled` predicate wording:** "no placed courses for this student" — confirm the exact source (`mineIds.size === 0` vs. narrowed `placements.length === 0`); both are cheap and available at render.
