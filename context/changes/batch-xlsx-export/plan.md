# Batch xlsx Export (combined plan + all teachers, one zip) Implementation Plan

## Overview

Add a **"Download all (zip)"** item to the plan-detail board's `ExportMenu` that, in one click, builds the combined-plan workbook plus one workbook per teacher (teachers with zero conducted courses skipped) from **live board state** — including unsaved optimistic edits — and downloads a single flat `<plan-slug>.zip`. Pure client-side; the Worker is not involved.

## Current State Analysis

All three shipped exports (plan / teacher / student) generate xlsx entirely in the browser with `write-excel-file@^4.1.1`; the pure, library-free builders in `src/entities/timetable/model/export/` were deliberately staged for a batch path (research: `context/changes/batch-xlsx-export/research.md`).

- **Board export**: `ExportMenu.tsx` (`src/_pages/plan-detail/ui/chrome/ExportMenu.tsx:31-38`) → `buildExportWorkbook` (`src/_pages/plan-detail/lib/export-workbook.ts:50-69`), fed live state via `exportCohort()` (`src/_pages/plan-detail/ui/PlannerBoard.tsx:163-173`).
- **Teacher export**: `ExportTeacherPlanButton.tsx:59-88` → `buildPerspectiveWorkbook` (`src/entities/timetable/model/export/perspective-workbook.ts:47-60`); the per-teacher narrowing recipe lives in `TeacherPlanPage.tsx:105-140` (`teacherCourses` → `perspectivePlacements`, `buildPerspectiveCourseItems` with merges + hours + `memberOf`).
- **What plan-detail's loader is missing** (verified in `src/_pages/plan-detail/api/load.ts`): teacher codes (only `loadTeacherNames`' display map is loaded), course merges (`loadCourseMerges` is only called by the perspective-view loaders), and course levels (`GroupingCourse` has no `level`). The teacher-view loader (`src/_pages/teacher-plan-view/api/loader.ts:137-172`) has all three patterns to port.
- `fflate@0.8.3` is already in the lockfile as `write-excel-file`'s sole dependency; `writeXlsxFile(...)` exposes `.toBlob()` alongside `.toFile()` (verified in installed v4.1.1).
- Measured scale: 1 combined + 40 teacher workbooks + zip ≈ **85 ms**, ~217 KB (research §3) — no progress UI or Web Worker needed.

## Desired End State

On any plan board (`/plans/<id>`), the export dropdown offers Combined / DP1 / DP2 (unchanged) plus **"Download all (zip)"**. Selecting it downloads `<plan-slug>.zip` containing:

- `<plan-slug>-combined.xlsx` — identical content to the existing Combined export, built from live state.
- `<plan-slug>-<teacher-code>.xlsx` per teacher who conducts ≥1 course — identical content to that teacher's single export on the teacher view, except placements/hours reflect live board state.

Failure of any workbook aborts the whole batch with the existing failure toast (no partial zip). Success is silent (parity with the shipped exports). Verify: unzip and open files in a spreadsheet app; a zero-course teacher has no file; an unsaved drag shows up in the exported grids.

### Key Discoveries:

- `buildPerspectiveWorkbook` is persona-agnostic and reusable as-is; callers pre-narrow placements (`perspective-workbook.ts:11,47-60`).
- `buildPerspectiveCourseItems` needs `hours: Map<string, HoursStat>` (`src/entities/timetable/model/perspective-course-list.ts:35-42`) — available live as `state.hours` on `CohortBoardState` (used by `paletteData`, `PlannerBoard.tsx:149-158`).
- Per-teacher course membership is derivable client-side from `GroupingCourse.teacherKeys` — no per-teacher queries.
- `fetchPlanTeachers` is private to the teacher-plan-view slice (`loader.ts:137-149`); FSD forbids cross-`_pages` imports, so it must be hoisted to `shared/api` (precedent: `loadCourseMerges`, `loadTeacherNames`).
- The skip-empty rule mirrors the single-teacher button's self-disable (`ExportTeacherPlanButton.tsx:100`, `items.length === 0`).
- Filename convention precedent: `exportFileName` (`src/_pages/plan-detail/lib/export-file-name.ts`) — `slugify` folds diacritics and falls back to `plan`.

## What We're NOT Doing

- No student workbooks in the batch (deliberately deferred).
- No server-side export route, R2, Queues, Workflows, or `waitUntil` — measured scale makes them overkill (research §4).
- No progress UI, spinner, or success toast — silent success, parity with shipped exports.
- No skip-and-report partial archives — fail-fast on any workbook error.
- No changes to `entities/timetable` builders — the skip-empty rule keeps their "≥1 course" assumption intact.
- No Playwright e2e for the download — the pure core carries the logic and is unit-tested; the zip glue is verified manually.

## Implementation Approach

Three additive phases along the pre-staged path: (1) extend the plan-detail SSR loader with the three missing reads and thread them to the island as one new prop; (2) a pure, framework-free batch-assembly function in `plan-detail/lib/` (fully unit-tested); (3) bind `fflate` + `.toBlob()` at the `ExportMenu` leaf and add the menu item. Library bindings stay at the UI leaf; pure logic stays in `lib/` — the recorded slice convention.

## Critical Implementation Details

- **fflate input & mode**: collect each workbook via `writeXlsxFile(sheets).toBlob()`, convert with `new Uint8Array(await blob.arrayBuffer())`, and zip with **`zipSync(entries, { level: 0 })`** — xlsx files are already deflate-compressed zip containers, so recompression wastes CPU for ~0 gain; the *async* `zip` API spawns Web Workers and must not be used (unnecessary here, unavailable on workerd if code ever moves server-side).
- **Live hours, not recomputed**: `buildPerspectiveCourseItems` must receive the board's live `state.hours` (same live semantics as `state.placements`) so per-course occurrence/hours rows reflect unsaved edits. Do not re-derive from the server-seeded props.
- **FSD boundary**: plan-detail must not import from `teacher-plan-view`. Hoist the plan-teachers query to `shared/api` and refactor the teacher-view loader onto it.
- **Keep the new data out of `SharedBoardProps`**: that type feeds the drag/board hooks and their test fixtures (`use-cohort-board-state.test.tsx:72`); thread the batch-export sources as a separate prop instead.
- **jsdom gap in the leaf test**: `URL.createObjectURL`/`revokeObjectURL` are undefined in jsdom — stub them in `ExportMenu.test.tsx` for the batch-item test.

## Phase 1: Loader & Prop Plumbing

### Overview

Extend the plan-detail SSR load with the three missing reads (plan teachers with codes, course merges, course levels) and thread them to `PlannerBoard` as one `batchExport` prop. No user-visible change.

### Changes Required:

#### 1. Shared plan-teachers fetcher

**File**: `src/shared/api/load-plan-teachers.ts` (new) + `src/shared/api/index.ts` (barrel)

**Intent**: Hoist the teacher-enumeration query so both the teacher view and the board loader share it, honoring the no-cross-`_pages`-imports rule.

**Contract**: `export type PlanTeacher = { id: string; code: string; fullName: string | null }`; `loadPlanTeachers(supabase, planId): Promise<PlanTeacher[]>` — `teachers` select `id, code, full_name`, `eq plan_id`, ordered by `full_name` (nulls last) then `code`, `.limit(500)`, unwrapped via `unwrapMany` — byte-for-byte the semantics of `fetchPlanTeachers` (`src/_pages/teacher-plan-view/api/loader.ts:137-149`).

#### 2. Teacher-view loader refactor

**File**: `src/_pages/teacher-plan-view/api/loader.ts`

**Intent**: Replace the private `fetchPlanTeachers` with the shared fetcher; keep the exported `TeacherSummary` name stable for the slice's consumers (alias it to `PlanTeacher`).

**Contract**: `loadTeacherPlanView`'s returned shape and behavior are unchanged.

#### 3. Batch-export source type

**File**: `src/_pages/plan-detail/lib/batch-export-workbooks.ts` (new, type-only in this phase)

**Intent**: Home for the batch-export data contract so the loader (api), the island (ui), and the phase-2 assembly all import it from `lib/` — no ui→api type dependency.

**Contract**: `export type BatchExportSources = { teachers: PlanTeacher[]; merges: CourseMerge[]; courseLevels: Record<string, string> }`.

#### 4. Loader extension

**File**: `src/_pages/plan-detail/api/load.ts`

**Intent**: Load the three sources alongside the existing parallel fetches and return them on `CombinedPlannerData`.

**Contract**: `CombinedPlannerData` gains `batchExport: BatchExportSources`. `loadPlanTeachers` and `loadCourseMerges` join the existing `Promise.all`; a private `fetchCourseLevels` selects `id, level` from `courses` (`eq plan_id`, `.limit(2000)` — the slim projection of the teacher view's `fetchCourseInfo`, `loader.ts:151-172`) and maps to `Record<courseId, level>`.

#### 5. Prop threading

**File**: `src/pages/plans/[id]/index.astro`, `src/_pages/plan-detail/ui/PlanDetailPage.astro`, `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Pass `batchExport` from the loader result down to `PlannerBoard` (held there until phase 3 wires it into `ExportMenu`). Keep it OFF `SharedBoardProps`.

**Contract**: New `batchExport: BatchExportSources` prop on `PlanDetailPage` and `PlannerBoard`.

#### 6. Loader integration test

**File**: `src/_pages/plan-detail/api/load.integration.test.ts`

**Intent**: Assert the new fields arrive — teachers carry codes, merges present, `courseLevels` maps course ids to levels — using the existing factory-built state.

**Contract**: Extends the existing suite; no fixture-shape changes beyond the new assertions.

### Success Criteria:

#### Automated Verification:

- Unit suite passes: `pnpm test`
- Integration suite passes (local Supabase running): `pnpm test:integration`
- Lint + FSD boundaries clean: `pnpm lint` && `pnpm steiger`
- Production build clean: `pnpm build`

#### Manual Verification:

- Plan board page renders and drags exactly as before (no regression from the loader additions)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Pure Batch Assembly

### Overview

The framework-free heart: one function that turns live board data + batch sources into an ordered list of ready-to-serialize workbooks plus the zip filename. All batch logic (iteration, skip-empty, narrowing, dedupe) lands here, fully unit-tested.

### Changes Required:

#### 1. Batch assembly function

**File**: `src/_pages/plan-detail/lib/batch-export-workbooks.ts`

**Intent**: Assemble the combined-plan workbook plus one perspective workbook per conducting teacher, from live state, in one pure call. Reuses `buildExportWorkbook` and the `entities/timetable` barrel exports (`buildPerspectiveWorkbook`, `buildPerspectiveCourseItems`, `teacherCourses`, `perspectivePlacements`) — no new builders.

**Contract**:

- Input: `{ planName, days, periods, teacherNames, dp1, dp2, batch: BatchExportSources }` where each cohort slice is the existing `ExportCohortData` **extended with `hours: Map<string, HoursStat>`** (live `state.hours`; see phase-3 change to `exportCohort`).
- Output: `{ zipFileName: string; files: { fileName: string; sheets: WorkbookSheet[] }[] }` — every file already in the `write-excel-file` descriptor shape (`WorkbookSheet`, `export-workbook.ts:34-40`); the `NamedSheet` → descriptor mapping used at `ExportTeacherPlanButton.tsx:75-81` moves inside as a pure helper so the leaf serializes uniformly.
- Order: combined file first (via `buildExportWorkbook` with `view: "combined"`), then teachers in loader order.
- Per teacher: items from `buildPerspectiveCourseItems` over both cohorts (live placements, live hours, `merges`, `memberOf` = `teacherKeys.includes(teacher.id)`); **skip when items are empty**; grid placements narrowed via `teacherCourses` → `perspectivePlacements`; `buildPerspectiveWorkbook` with `fileCode: teacher.code`, `omitTeacherKey: teacher.id`, merged `courseDisplay`/`studentNames`, `courseLevels` from `batch`.
- Filenames: `<plan-slug>-combined.xlsx` / `<plan-slug>-<teacher-code-slug>.xlsx` (per the builders' own naming); in-archive collisions deduped **case-insensitively** with a numeric suffix before the extension (`…-2.xlsx`, `…-3.xlsx`) — mirroring the sheet-name dedupe convention. `zipFileName` = `` `${slugify(planName)}.zip` ``.

#### 2. Unit tests

**File**: `src/_pages/plan-detail/lib/batch-export-workbooks.test.ts`

**Intent**: Pin the batch contract: combined-first ordering; skip-empty teachers; per-teacher grid contains only that teacher's placements; merge children resolve to rows; live placements/hours pass through untouched; `omitTeacherKey` set; case-insensitive filename dedupe; zip filename slugging (incl. the empty-slug `plan` fallback).

**Contract**: Co-located Vitest suite following the `export-workbook`/`perspective-workbook` test styles.

### Success Criteria:

#### Automated Verification:

- New suite + full unit suite pass: `pnpm test`
- Lint + FSD boundaries clean: `pnpm lint` && `pnpm steiger`
- Production build clean: `pnpm build`

#### Manual Verification:

- None — pure-logic phase; behavior is exercised end-to-end in Phase 3.

---

## Phase 3: Zip Glue + Menu Item

### Overview

Bind the libraries at the leaf: `fflate` becomes a direct dependency, `ExportMenu` gains the "Download all (zip)" item that runs the pure assembly, serializes each workbook to a Blob, zips at level 0, and triggers one download. Fail-fast toast on any error.

### Changes Required:

#### 1. Direct dependency

**File**: `package.json`

**Intent**: Promote `fflate` from transitive to direct dependency (already `0.8.3` in the lockfile via `write-excel-file` — ~zero bundle cost).

**Contract**: `"fflate": "^0.8.3"` in `dependencies`.

#### 2. Live-state hours on the export slice

**File**: `src/_pages/plan-detail/lib/export-workbook.ts`, `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Extend `ExportCohortData` with `hours: Map<string, HoursStat>` and have `exportCohort()` populate it from `state.hours`, so one coherent "live cohort export slice" feeds both the existing view exports (which ignore it) and the batch.

**Contract**: `ExportCohortData` gains `hours`; `buildExportWorkbook` is otherwise untouched. `PlannerBoard` also passes `batchExport` through to `ExportMenu`.

#### 3. Menu item + download glue

**File**: `src/_pages/plan-detail/ui/chrome/ExportMenu.tsx`

**Intent**: Add "Download all (zip)" below the three view items (separated by the DS `DropdownMenuSeparator`). On select: `buildBatchExportWorkbooks` → per file `writeXlsxFile(sheets).toBlob()` → `Uint8Array` → `zipSync(entries, { level: 0 })` → `application/zip` Blob → object-URL anchor click (revoked after). One try/catch around the whole batch reusing the existing "Export failed — try again." toast; silent success.

**Contract**: `ExportMenu` props gain `batchExport: BatchExportSources`; this component remains the sole binding site for `write-excel-file/browser` and becomes the sole binding site for `fflate`.

#### 4. Leaf test update

**File**: `src/_pages/plan-detail/ui/chrome/ExportMenu.test.tsx`

**Intent**: Extend the fixture (hours + `batchExport`) and pin the new contract: item renders last after the three views; selecting it serializes one Blob per workbook and triggers a single download; a rejected `.toBlob()` surfaces the failure toast and no download.

**Contract**: Follows the existing hoisted-mock style (`ExportMenu.test.tsx:9-33`); stubs `URL.createObjectURL`/`revokeObjectURL` (absent in jsdom).

### Success Criteria:

#### Automated Verification:

- Unit suite passes: `pnpm test`
- Lint + FSD boundaries clean: `pnpm lint` && `pnpm steiger`
- Production build clean: `pnpm build`

#### Manual Verification:

- On a seeded plan board, "Download all (zip)" downloads `<plan-slug>.zip`; unzipped, it contains `<plan-slug>-combined.xlsx` plus one `<plan-slug>-<teacher-code>.xlsx` per conducting teacher, all opening cleanly in a spreadsheet app
- A teacher with zero conducted courses has no file in the archive
- An unsaved optimistic edit (drag a group, don't wait for save) appears in the exported grids
- The three existing single-view exports still work unchanged

**Implementation Note**: After this phase passes automated verification, pause for manual confirmation of the download flow before closing the change.

---

## Testing Strategy

### Unit Tests:

- `batch-export-workbooks.test.ts` (phase 2): ordering, skip-empty, per-teacher narrowing, merge resolution, live-state pass-through, `omitTeacherKey`, case-insensitive filename dedupe, zip naming + `plan` fallback.
- `ExportMenu.test.tsx` (phase 3): item presence/order, one-Blob-per-workbook serialization, single download trigger, fail-fast toast.

### Integration Tests:

- `load.integration.test.ts` (phase 1): the three new loader fields materialize from factory-built state.

### Manual Testing Steps:

1. `pnpm dev`, open a seeded plan board, export "Download all (zip)", unzip, and open a sample of files (combined + 2–3 teachers) in a spreadsheet app.
2. Confirm a zero-course teacher (add one via Studio if the seed has none) produces no file.
3. Drag a grouping onto the grid and immediately export — the new placement appears in the combined grid and the affected teachers' grids.
4. Re-run the existing Combined / DP1 / DP2 exports — unchanged.

## Performance Considerations

Measured ~85 ms for 1 combined + 40 teacher workbooks + zip (research §3) — synchronous on the main thread is fine; no progress UI. The three loader additions run inside the existing SSR `Promise.all` and never touch the <200 ms drag-drop path (export is click-driven).

## Migration Notes

None — purely additive; no schema changes, no data migration.

## References

- Related research: `context/changes/batch-xlsx-export/research.md` (incl. resolved author decisions table)
- Batch loop core: `src/entities/timetable/model/export/perspective-workbook.ts:47-60`
- Narrowing recipe to mirror: `src/_pages/teacher-plan-view/ui/TeacherPlanPage.tsx:105-140`
- Loader patterns to port: `src/_pages/teacher-plan-view/api/loader.ts:137-172`
- Prior art: `context/archive/2026-07-08-teacher-export-plan-to-xlsx/` (perspective export), `context/archive/2026-07-07-export-to-xlsx/` (library choice, client-side decision)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Loader & Prop Plumbing

#### Automated

- [x] 1.1 Unit suite passes: `pnpm test` — ec6b183
- [x] 1.2 Integration suite passes: `pnpm test:integration` — ec6b183
- [x] 1.3 Lint + FSD boundaries clean: `pnpm lint` && `pnpm steiger` — ec6b183
- [x] 1.4 Production build clean: `pnpm build` — ec6b183

#### Manual

- [ ] 1.5 Plan board renders and drags exactly as before

### Phase 2: Pure Batch Assembly

#### Automated

- [x] 2.1 New suite + full unit suite pass: `pnpm test`
- [x] 2.2 Lint + FSD boundaries clean: `pnpm lint` && `pnpm steiger`
- [x] 2.3 Production build clean: `pnpm build`

### Phase 3: Zip Glue + Menu Item

#### Automated

- [ ] 3.1 Unit suite passes: `pnpm test`
- [ ] 3.2 Lint + FSD boundaries clean: `pnpm lint` && `pnpm steiger`
- [ ] 3.3 Production build clean: `pnpm build`

#### Manual

- [ ] 3.4 Zip downloads with combined + per-teacher files, all opening cleanly
- [ ] 3.5 Zero-course teacher absent from the archive
- [ ] 3.6 Unsaved optimistic edit appears in exported grids
- [ ] 3.7 Existing single-view exports unchanged
