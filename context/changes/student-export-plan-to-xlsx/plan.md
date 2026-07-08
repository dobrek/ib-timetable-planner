# Student Export Plan to XLSX — Implementation Plan

## Overview

Add an **Export to XLSX** button to the student plan view (`/plans/[id]/students/[studentId]`) so an author viewing a student's schedule can download it as a single-sheet workbook. Scope is fixed by the author's decisions in `change.md`: the plan grid only (no per-course sheets), clean labels (no `(DPx)` cohort tag), filename `<plan-slug>-<cohort>-<student-name>.xlsx`.

Because a student is single-cohort and wants tag-free labels, the export reuses the **base** grid transform `buildTimetableSheet` **directly** — one column, no `cohortTag` — rather than the teacher's `buildPerspectiveWorkbook` (which unconditionally tags every label and adds unused course sheets). The genuinely new code is a shared `slugify` (extracted from two private copies and taught to fold diacritics), a slice-local filename helper, and one thin `write-excel-file/browser` button leaf wired into the page header.

## Current State Analysis

- **The student island already computes the export input.** `StudentPlanPage.tsx:25-28` derives `mineIds` and the student-narrowed `placements = perspectivePlacements(data.placements, mineIds)`. That, with `student.cohort` and `data.courseDisplay`, is exactly one `TimetableSheetColumn` (`timetable-sheet.ts:13-17`). All props are plain serializable data (`loader.ts:29-47`).
- **Single-cohort ⇒ simplest grid.** The loader fetches only `student.cohort` data (`loader.ts:86-89`); `StudentSummary` is `{ id, fullName, cohort }` — **no `code`** (`loader.ts:23`). No dp1/dp2 merge, so one column, no disambiguation.
- **`buildTimetableSheet` with `cohortTag` omitted yields the exact sheet.** With one column: `multi === false` ⇒ no cohort sub-label row, `stickyRowsCount: 1` (`timetable-sheet.ts:40,48,57`); `occupantLabel` appends no cohort suffix (`timetable-sheet.ts:224-231`). Subject fills, break bands, weighted borders, frozen panes come for free. It returns an **unnamed** `TimetableSheet` (`{ rows, columns, stickyRowsCount, stickyColumnsCount }`) — the caller names the sheet.
- **The teacher button is the pattern to mirror.** `ExportTeacherPlanButton.tsx` binds `write-excel-file/browser`, maps `sheet.rows`→`data`, calls `.toFile(fileName)`, toasts via `sonner` with its own `<Toaster/>`, and is a ghost `size="icon"` `Button` disabled when there's nothing to export. Its test (`ExportTeacherPlanButton.test.tsx`) — `vi.hoisted` mocks for the library, `sonner`, and `@/shared/ui`, pure transform unmocked — is directly copyable.
- **Two duplicated private `slugify` copies, none shared.** Identical bodies at `plan-detail/lib/export-file-name.ts:12-18` and `entities/timetable/model/export/perspective-workbook.ts:122-126`. `@/shared/lib` is folder-per-concept (`<concept>/index.ts` barrel + `<concept>.ts` + `<concept>.test.ts`, e.g. `course-label/`, `slot-labels/`), imported as `@/shared/lib/<concept>`; there is no top-level `shared/lib/index.ts`.
- **No diacritic fixtures exist** in either re-routed site's tests, so folding diacritics is a monotonic change (ASCII inputs slug identically).

## Desired End State

An author on the student plan view sees an Export icon beside the student switcher. Clicking it downloads `<plan-slug>-<cohort>-<student-name>.xlsx` — a single "Timetable" sheet reproducing the on-screen grid (student's placed courses, clean subject-colored labels, break bands, frozen header/day column), with diacritic names rendered legibly in the filename (`Paweł Głąb` → `pawel-glab`). The button is disabled when the student has no placed courses. A failed export surfaces a toast, not a crash. The board and teacher exports are unchanged for all ASCII inputs.

**Verification:** `pnpm check` + `pnpm lint` + `pnpm steiger` clean; new unit tests pass; `pnpm build` clean; manual export from the running app opens in Excel/Numbers matching the on-screen grid.

### Key Discoveries:

- Reuse seam is `buildTimetableSheet` **directly**, not `buildPerspectiveWorkbook` — `timetable-sheet.ts:40,48,57,224-231`.
- `buildTimetableSheet` returns an **unnamed** sheet — the button names the single sheet `"Timetable"` itself (unlike the teacher path where `buildPerspectiveWorkbook` returns named sheets). `sheet-types.ts:64-69`.
- `ł` (and other stroke letters) do **not** decompose under Unicode NFD — an explicit map is required in addition to combining-mark stripping.
- FSD: `_pages/student-plan-view` → `@/entities/timetable` + `@/shared/*` is legal downward; `entities/.../perspective-workbook.ts` → `@/shared/lib/slugify` is legal downward.

## What We're NOT Doing

- No per-course / roster sheets (grid only) — a student has no roster to export (the on-page card roster is *teachers*).
- No `(DPx)` cohort tag on labels; no reuse of `buildPerspectiveWorkbook` (its `cohortTag` is unconditional).
- No schema, loader, query, new dependency (`write-excel-file@4.1.1` is installed), server-side/Worker route, or Cloudflare/infra change.
- No change to board/teacher export **behavior** beyond the monotonic slug improvement (diacritic folding); ASCII filenames stay byte-identical.
- No filename collision handling: two students whose names slugify identically within the same cohort produce the same filename. Acceptable — export is a user-driven per-student download.
- No transliteration coverage beyond what the student population needs (Polish); the diacritic map is minimal (`ł→l`) plus NFD folding, and is extensible later.

## Implementation Approach

Bottom-up in dependency order: (1) establish the shared `slugify` and retire the two private copies, so the filename helper has a single DRY home; (2) build the pure filename helper and the `write-excel-file` button leaf with unit tests, verifying wiring in isolation; (3) compose the button into the page header, passing the already-computed narrowed placements so the button stays a pure leaf mirroring `ExportTeacherPlanButton`.

## Critical Implementation Details

- **Diacritic folding is monotonic but `ł` is special.** `String.prototype.normalize("NFD")` + stripping `̀-ͯ` folds `ą/ć/ę/ń/ó/ś/ź/ż`, but **not** `ł` (U+0142 is atomic, not base+combining). Add an explicit `ł→l` map step. ASCII inputs are unaffected, so re-routing the two shipped filename sites through this `slugify` cannot change their existing (ASCII) outputs — the existing filename tests must still pass unchanged; treat any diff there as a regression.
- **The button names the sheet.** `buildTimetableSheet` returns an unnamed `TimetableSheet`; the descriptor must supply `sheet: "Timetable"` (a constant literal — already Excel-safe, no `sanitizeSheetName` needed). Do **not** pass `cohortTag` — omitting it is what produces the clean labels.
- **Disabled predicate.** Use the narrowed `placements.length === 0` (an empty grid = nothing to export), not `mineIds.size` — a student could hold course ids that have no placements.

## Phase 1: Shared `slugify` foundation

### Overview

Extract a single diacritic-folding `slugify` into `@/shared/lib/slugify` and route the two existing private copies through it, killing the duplication research flagged.

### Changes Required:

#### 1. New shared concept folder

**File**: `src/shared/lib/slugify/slugify.ts` (+ `index.ts` barrel, + `slugify.test.ts`)

**Intent**: One filesystem/URL-safe slug helper for the whole app: lowercase, fold diacritics to ASCII, collapse non-alphanumeric runs to `-`, trim, and fall back to `plan` when empty. Mirrors the existing folder convention (`course-label/`, `slot-labels/`).

**Contract**: `export const slugify = (value: string): string`. Pipeline: `value.toLowerCase()` → private `foldDiacritics` (`.normalize("NFD").replace(/[̀-ͯ]/g, "")` then `.replace(/ł/g, "l")`) → `.replace(/[^a-z0-9]+/g, "-")` → `.replace(/^-+|-+$/g, "")` → `|| "plan"`. Public `slugify` first, private `foldDiacritics` below (newspaper order). `index.ts`: `export { slugify } from "./slugify";`. No parameter mutation; declarative pipeline (no accumulator loop).

#### 2. Re-route `plan-detail` filename helper

**File**: `src/_pages/plan-detail/lib/export-file-name.ts`

**Intent**: Consume the shared `slugify`; delete the local copy.

**Contract**: `import { slugify } from "@/shared/lib/slugify";`, remove the private `slugify` (lines 12-18). `exportFileName` body unchanged. Legal downward import.

#### 3. Re-route perspective-workbook filename

**File**: `src/entities/timetable/model/export/perspective-workbook.ts`

**Intent**: Consume the shared `slugify`; delete the local copy.

**Contract**: `import { slugify } from "@/shared/lib/slugify";`, remove the private `slugify` (lines 122-126). The two `slugify(...)` call sites (`:57`) unchanged. Legal downward import (`entities` → `shared`).

**Fold coverage at the call site**: `slugify.test.ts` is the single source of truth for the diacritic-fold behavior; the reroute is byte-identical for ASCII but *does* change output for diacritic **plan names** (e.g. `Wrocław 2027` → `wroclaw-…`, previously `wroc-aw-…`). Add **one** diacritic case to `perspective-workbook.test.ts` (a plan name with `ł`/`ą`) so the fold is locked where the workbook filename is actually assembled, not only in the shared unit — this is the intended, documented behavior change (see *What We're NOT Doing*), pinned so a later slugify edit can't silently regress it.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `pnpm check`
- [ ] Linting passes: `pnpm lint`
- [ ] FSD structure passes: `pnpm steiger`
- [ ] New `slugify` unit tests pass (incl. `Paweł Głąb → pawel-glab`, `Kraków → krakow`, empty/symbol-only → `plan`, ASCII unchanged): `pnpm test`
- [ ] Existing `export-file-name` / `perspective-workbook` filename tests still pass unchanged (ASCII outputs byte-identical): `pnpm test`
- [ ] One diacritic case pins the fold at the rerouted call site (`Wrocław 2027` → `wroclaw-…` in `perspective-workbook.test.ts`): `pnpm test`
- [ ] Build stays clean: `pnpm build`

#### Manual Verification:

- [ ] Confirm no other `slugify` definition remains in the tree (`grep -rn "slugify" src/` shows only the shared def + imports).

**Implementation Note**: After this phase and automated verification passes, pause for confirmation before Phase 2.

---

## Phase 2: Student filename helper + export button

### Overview

Build the pure filename helper and the `write-excel-file/browser` button leaf, with unit tests, verifiable before the button touches the page.

### Changes Required:

#### 1. Slice-local filename helper

**File**: `src/_pages/student-plan-view/lib/export-file-name.ts` (+ co-located `export-file-name.test.ts`)

**Intent**: Deterministic student download name from the page-available inputs. Mirrors `plan-detail/lib/export-file-name.ts` (flat file, not a concept folder — matching the `_pages` lib convention).

**Contract**: `export const studentExportFileName = (planName: string, cohort: Cohort, fullName: string): string` → `` `${slugify(planName)}-${cohort}-${slugify(fullName)}.xlsx` ``. `cohort` is the `Cohort` literal (`"dp1"`/`"dp2"`) — already slug-safe, interpolated directly (mirrors `exportFileName` interpolating `view`). Imports `slugify` from `@/shared/lib/slugify`, `Cohort` from `@/shared/config`.

#### 2. Export button leaf

**File**: `src/_pages/student-plan-view/ui/ExportStudentPlanButton.tsx`

**Intent**: The student plan view's export affordance and sole site binding `write-excel-file`. On click, build one grid sheet from the page-narrowed placements and save it; disabled when there's nothing to export; failures toast. A trimmed copy of `ExportTeacherPlanButton.tsx`.

**Contract**: Props `{ fileName: string; days: number; periods: number; cohort: Cohort; placements: PlannerPlacement[]; courseDisplay: Record<string, CourseDisplay> }` (`placements` already student-narrowed by the page). Click handler:

```ts
const sheet = buildTimetableSheet({ days, periods, columns: [{ cohort, placements, courseDisplay }] });
await writeXlsxFile(
  [{ data: sheet.rows, sheet: "Timetable", columns: sheet.columns,
     stickyRowsCount: sheet.stickyRowsCount, stickyColumnsCount: sheet.stickyColumnsCount }],
).toFile(fileName);
```

No `cohortTag` passed. `useState` `exporting` flag; `try/catch → toast.error("Export failed — try again.")`; `finally` resets. Renders `<Toaster/>` + ghost `size="icon"` `Button className="size-8"` with `title`/`aria-label="Export student plan"`, `disabled={exporting || placements.length === 0}`, `<Download/>` icon. Imports: `writeXlsxFile` from `write-excel-file/browser`, `Download` (lucide), `toast` (sonner), `Button`/`Toaster` (`@/shared/ui`), `buildTimetableSheet`/`PlannerPlacement`/`CourseDisplay` (`@/entities/timetable`), `Cohort` (`@/shared/config`).

#### 3. Button unit test

**File**: `src/_pages/student-plan-view/ui/ExportStudentPlanButton.test.tsx`

**Intent**: Pin the button's own wiring; the pure `buildTimetableSheet` runs for real.

**Contract**: Copy `ExportTeacherPlanButton.test.tsx`'s `vi.hoisted` mocks (`write-excel-file/browser`, `sonner`, `@/shared/ui`). Assertions: accessible trigger by name `"Export student plan"`; disabled when `placements: []`; click with a placement → `toFile` called with the expected filename and the descriptor sheet list `["Timetable"]`; rejected `toFile` → `toast.error("Export failed — try again.")`. Build placements via the `@/entities/timetable` fixture builders (barrel).

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `pnpm check`
- [ ] Linting passes: `pnpm lint`
- [ ] FSD structure passes: `pnpm steiger`
- [ ] `studentExportFileName` + `ExportStudentPlanButton` unit tests pass: `pnpm test`
- [ ] Build stays clean: `pnpm build`

#### Manual Verification:

- [ ] (Deferred to Phase 3 — button not yet mounted.)

**Implementation Note**: After this phase and automated verification passes, pause for confirmation before Phase 3.

---

## Phase 3: Wire into the student page header

### Overview

Compose the button beside `<StudentSwitcher>` in the page header, passing the already-computed narrowed placements and the derived filename — completing the feature.

### Changes Required:

#### 1. Header composition

**File**: `src/_pages/student-plan-view/ui/StudentPlanPage.tsx`

**Intent**: Mount `<ExportStudentPlanButton>` next to the switcher, mirroring the teacher header's flex container. Reuse the page's existing narrowed `placements` (no recomputation).

**Contract**: Wrap `<StudentSwitcher>` and the new `<ExportStudentPlanButton>` in a `<div className="flex items-center gap-2">` inside the existing `<header>` (`:53-64`). Pass `fileName={studentExportFileName(planName, student.cohort, student.fullName)}`, `days={data.days}`, `periods={data.periods}`, `cohort={student.cohort}`, `placements={placements}` (the render-time narrowed value, `:28`), `courseDisplay={data.courseDisplay}`. Import the button (relative `./ExportStudentPlanButton`) and `studentExportFileName` (relative `../lib/export-file-name`).

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `pnpm check`
- [ ] Linting passes: `pnpm lint`
- [ ] FSD structure passes: `pnpm steiger`
- [ ] Full unit suite passes: `pnpm test`
- [ ] Build stays clean: `pnpm build`

#### Manual Verification:

- [ ] Export icon appears beside the switcher on `/plans/[id]/students/[studentId]`; disabled for a student with no placed courses.
- [ ] Clicking downloads `<plan-slug>-<cohort>-<student-name>.xlsx`; a diacritic name (e.g. a `ł`/`ą` student) yields a legible slug.
- [ ] The workbook opens in Excel/Numbers as a single "Timetable" sheet matching the on-screen grid: clean labels (no `(DPx)`), subject colors, break bands after P2/P5, frozen header row + day column.
- [ ] Switching students then exporting produces a file for the newly-selected student.

**Implementation Note**: Final phase — after manual verification, the change is ready to close.

---

## Testing Strategy

### Unit Tests:

- **`slugify`**: diacritic folding (`Paweł Głąb`→`pawel-glab`, `Kraków`→`krakow`, `José`→`jose`), symbol/space collapse, empty & symbol-only → `plan`, ASCII pass-through parity with the old private copies. This is the source of truth for fold behavior.
- **`perspective-workbook` filename (reroute lock)**: one diacritic plan-name case (`Wrocław 2027`→`wroclaw-…`) pins the fold where the workbook filename is assembled — guarding the intended, documented behavior change against a later slugify regression.
- **`studentExportFileName`**: format assembly incl. cohort literal and both slug segments.
- **`ExportStudentPlanButton`**: accessible trigger, disabled-when-empty, click → `toFile(fileName)` + sheet list `["Timetable"]`, rejected export → toast (mirrors the teacher test).

### Integration Tests:

- None required — no loader/query/schema change. The existing `student-plan-view.integration.test.ts` must remain green.

### Manual Testing Steps:

1. `pnpm dev`, sign in, open a plan's student view.
2. Confirm the Export icon renders beside the switcher; hover shows the tooltip.
3. Click Export; open the downloaded `.xlsx`; verify single "Timetable" sheet fidelity vs. the on-screen grid.
4. Switch to a student with diacritics in their name; export; confirm the filename slug is legible.
5. If reachable, view a student with no placed courses; confirm the button is disabled.

## Performance Considerations

Click-driven, one-student, single-sheet, few-hundred-cell client-side generation. The <200ms drag-drop budget is untouched (this path never runs during a drag).

## Migration Notes

None. No schema or data migration. Extracting `slugify` is behavior-preserving for all existing (ASCII) inputs.

## References

- Research: `context/changes/student-export-plan-to-xlsx/research.md`
- Scope decisions: `context/changes/student-export-plan-to-xlsx/change.md`
- Pattern to mirror: `src/_pages/teacher-plan-view/ui/ExportTeacherPlanButton.tsx` + `.test.tsx`
- Grid transform: `src/entities/timetable/model/export/timetable-sheet.ts:38-60,224-231`
- Filename precedent: `src/_pages/plan-detail/lib/export-file-name.ts:10`
- Slugify duplication: `perspective-workbook.ts:122-126`
- Prior changes: `context/archive/2026-07-08-teacher-export-plan-to-xlsx/`, `context/archive/2026-07-07-export-to-xlsx/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared `slugify` foundation

#### Automated

- [ ] 1.1 Type checking passes: `pnpm check`
- [ ] 1.2 Linting passes: `pnpm lint`
- [ ] 1.3 FSD structure passes: `pnpm steiger`
- [ ] 1.4 New `slugify` unit tests pass (diacritics, empty/symbol-only, ASCII unchanged): `pnpm test`
- [ ] 1.5 Existing filename tests still pass unchanged (ASCII byte-identical): `pnpm test`
- [ ] 1.6 Build stays clean: `pnpm build`
- [ ] 1.8 One diacritic case pins the fold at the rerouted call site (`perspective-workbook.test.ts`): `pnpm test`

#### Manual

- [ ] 1.7 No other `slugify` definition remains (`grep -rn "slugify" src/`)

### Phase 2: Student filename helper + export button

#### Automated

- [ ] 2.1 Type checking passes: `pnpm check`
- [ ] 2.2 Linting passes: `pnpm lint`
- [ ] 2.3 FSD structure passes: `pnpm steiger`
- [ ] 2.4 `studentExportFileName` + `ExportStudentPlanButton` unit tests pass: `pnpm test`
- [ ] 2.5 Build stays clean: `pnpm build`

### Phase 3: Wire into the student page header

#### Automated

- [ ] 3.1 Type checking passes: `pnpm check`
- [ ] 3.2 Linting passes: `pnpm lint`
- [ ] 3.3 FSD structure passes: `pnpm steiger`
- [ ] 3.4 Full unit suite passes: `pnpm test`
- [ ] 3.5 Build stays clean: `pnpm build`

#### Manual

- [ ] 3.6 Export icon appears beside switcher; disabled when no placed courses
- [ ] 3.7 Click downloads `<plan-slug>-<cohort>-<student-name>.xlsx`; diacritic name yields legible slug
- [ ] 3.8 Workbook opens as single "Timetable" sheet matching the grid (clean labels, colors, breaks, frozen panes)
- [ ] 3.9 Switching students then exporting produces the newly-selected student's file
