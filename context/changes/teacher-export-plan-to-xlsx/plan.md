# Teacher Export Plan to XLSX — Implementation Plan

## Overview

Add a client-side **"Export to XLSX"** to the read-only teacher plan view. Clicking one Export button downloads a workbook containing:

- a **grid sheet** (`Timetable`) that mirrors the on-screen merged teacher grid — both cohorts on one day×period grid, each course line tagged `(DP1)`/`(DP2)`, styled "clean" (subject fills, week/optional tags, break bands, frozen headers) with **no** collision/availability marks; and
- **one sheet per course** the teacher conducts — a plain header block (name, cohort·level, hours placed/required, co-teachers, occurrence times) over that course's assigned-student roster.

The transform is built **persona-agnostic** in `entities/timetable/model/export/` (returns library-free `TimetableSheet` descriptors), so the sibling `student-plan-view` gets export nearly for free later. `write-excel-file` is bound only at the leaf (the teacher-view button). Only the teacher's button is wired in this change.

## Current State Analysis

Verified against `main` @ `2fc9aea` (research's line references all hold today):

- **All export inputs are already hydrated in the teacher island.** `TeacherPlanViewData` (`src/_pages/teacher-plan-view/api/loader.ts:38-52`) carries both cohorts' `placements`/`courseDisplay`/`studentNames`, `teacherNames`, `merges`, `courseInfo`, grid dims, and teacher identity — all plain serializable data. The page (`TeacherPlanPage.tsx`) already derives everything an export needs at render time.
- **Per-course rosters are already computed.** `buildPerspectiveCourseItems` (`src/entities/timetable/model/perspective-course-list.ts:35`) returns one `PerspectiveCourseItem` per real course, each with `studentKeys`, `teacherKeys`, `hours: {placed, required}`, `occurrences`, `cohort`, and **merge-children resolved to their own rosters** (`:67-90`). `TeacherPlanPage.tsx:57-91` already builds this array.
- **The pure sheet layer exists and is library-free.** `buildTimetableSheet`, `buildRosterSheet`, `sheet-types.ts` (`src/entities/timetable/model/export/`) return the `TimetableSheet` shape and import no library; all three are on the entity barrel (`index.ts:19-21`). `SUBJECT_COLOR_HEX` (`src/shared/config/subject-colors.ts:56`) supplies xlsx fills.
- **`buildTimetableSheet` is cohort-column-oriented** (`timetable-sheet.ts:13-24`): each `TimetableSheetColumn` is one cohort, laid side-by-side per day. Its `occupantLabel` (`:212-217`) emits `name + week + optional` with **no cohort suffix** — the one gap for a merged teacher grid.
- **The plan-detail glue is a reference, not reusable.** `buildExportWorkbook` / `exportFileName` / `ExportMenu` (`_pages/plan-detail/lib` + `ui`) are page-slice-trapped and cohort-shaped (`dp1`/`dp2`, `BoardSurface`). FSD forbids `_pages/teacher-plan-view` from importing another page slice. The teacher path writes its own thin glue standing on the entity transforms.
- **`CourseInfo` is a widget type** (`src/widgets/timetable-board/model/course-info.ts:9`, `level: string`). The entity assembler must **not** import it (FSD upward-import ban) — `level` is threaded in as a structural `Record<courseId, string>`.
- **The library binding is a single leaf** (`ExportMenu.tsx:2,34`): `import writeXlsxFile from "write-excel-file/browser"` → `await writeXlsxFile(sheets).toFile(fileName)`, `sonner` toast on failure. `write-excel-file@^4.1.1` already installed; no new dependency.

## Desired End State

On the teacher plan view, an Export icon button sits beside `TeacherSwitcher`. Clicking it downloads `<plan-slug>-<teacher-code>.xlsx` — a grid sheet plus one sheet per course. The grid mirrors the screen (cohort-tagged, clean). Each per-course tab is named `Name · DPx`, sanitized/deduped, and lists the roster (or "No students assigned" when empty). The button is disabled when the teacher conducts no courses. The workbook-assembly transform lives in `entities/timetable` and is persona-agnostic; the sibling student view can reuse it in a ~1-file follow-up. `pnpm check`/`lint`/`steiger`/`test`/`build` all pass.

### Key Discoveries:

- Merged grid data already exists on-screen via `mergeCohortOccupants` (`TeacherPlanPage.tsx:181-190`) tagging each occupant with `cohort`; the entity assembler reproduces this by keying a `courseId → Cohort` map off the **caller-narrowed** placements. **Critical:** `data.dpN.placements` is the FULL cohort placement set (every teacher). The on-screen grid narrows to the teacher's courses first — `perspectivePlacements(own.placements, teacherCourseIds)` where `teacherCourseIds = teacherCourses(own.courses, teacher.id)` (`TeacherPlanPage.tsx:169-171`) — before rendering. The caller MUST pass the same teacher-narrowed placements to the assembler, not the raw full-cohort array, or the grid sheet renders the whole school's timetable.
- `occupantLabel` is the single seam for the `(DP1)`/`(DP2)` tag (`timetable-sheet.ts:212`).
- `write-excel-file` **validates but does not sanitize** sheet names — throws on empty / >31 chars / illegal `[ ] / \ : * ?` (`node_modules/write-excel-file/modules/xlsx/validateSheetName.js`), and does **not** check uniqueness, while Excel requires it (case-insensitively). Sanitize + truncate + dedup is mandatory and the highest-risk detail.
- `periodTimeRange` (`src/entities/timetable/lib/period-times.ts:13`) gives P1–P10 times (else `null`) for occurrence lines; `dayLabel`/`periodLabel` (`src/shared/lib/slot-labels`) label slots; `cohortLabel` (`src/shared/config/cohorts.ts:25`) → `DP1`/`DP2`.

## What We're NOT Doing

- No student-view Export button (transform is ready for it; wiring is a deferred ~1-file follow-up).
- No server-side / Worker export route (transform stays library-free so `write-excel-file/universal` reuse remains unblocked, but no route is built).
- No reuse of `_pages/plan-detail/lib/export-workbook.ts` / `export-file-name.ts` / `ExportMenu.tsx`.
- No summary/all-subjects roster sheet (the grid is the overview; a teacher has few courses).
- No collision or availability shading in the grid sheet (mirrors the clean board-export convention).
- No subject-color fills on the per-course sheets (plain, per decision).
- No schema, no new loader/query, no new dependency, no Cloudflare/infra change.

## Implementation Approach

Two layers, split along the library boundary the codebase already enforces:

1. **A pure, library-free export core in `entities/timetable/model/export/`** — a small generalization of `buildTimetableSheet` for the cohort-tagged merged grid, a new per-course sheet builder, a sheet-name sanitize/dedup helper, and a persona-agnostic `buildPerspectiveWorkbook` assembler that returns named `TimetableSheet`s + a filename. Fully unit-testable with no browser/library.
2. **A thin teacher-view leaf** — one `ExportTeacherPlanButton` that binds `write-excel-file/browser`, maps the assembler's named sheets to library descriptors (`rows`→`data`), saves via `.toFile`, and toasts on failure — slotted into the existing page header.

## Critical Implementation Details

- **Sheet-name hygiene is caller-owned and case-insensitive.** Per-course tab = `sanitize(courseName)` truncated to fit within `31 − len(" · DPx")`, then the ` · DPx` suffix, then de-duplication with a `~2`/`~3` suffix (trimming the base further so the total stays ≤31). Excel treats sheet names case-insensitively for uniqueness, so dedup must compare case-folded. The grid sheet takes the fixed name `Timetable`. Get this wrong and `write-excel-file` throws or silently corrupts the workbook.
- **The cohort tag threads through one seam.** The merged grid is a **single** `TimetableSheetColumn` (unioned dp1+dp2 placements, merged `courseDisplay`) plus a top-level `cohortTag: ReadonlyMap<courseId, Cohort>`; `occupantLabel` appends the suffix when the occupant's `placement.courseId` is in the map. Existing multi-column callers pass no `cohortTag` and are unchanged.
- **FSD boundary.** The entity assembler must not import the widget `CourseInfo`; `level` enters as a structural `Record<courseId, string>` derived caller-side from `data.courseInfo`.

---

## Phase 1: Persona-agnostic export core

### Overview

Build the pure, library-free workbook core: the cohort-tag generalization, the per-course sheet builder, the sheet-name helper, and the `buildPerspectiveWorkbook` assembler — with co-located unit tests. No UI, no `write-excel-file` import.

### Changes Required:

#### 1. Cohort-tag generalization of the timetable sheet

**File**: `src/entities/timetable/model/export/timetable-sheet.ts`

**Intent**: Let the grid transform tag each occupant's label with its cohort, enabling a single merged teacher grid whose lines read `Mathematics HL (DP1)`. Backward-compatible: absent the tag, output is byte-identical to today (the board export passes none).

**Contract**: Add optional `cohortTag?: ReadonlyMap<string, Cohort>` to `TimetableSheetInput`; thread it through `periodRows` → `contentCell` → `occupantLabel`. `occupantLabel` gains the tag param and appends ` (${cohortLabel(cohort)})` when `cohortTag.get(occupant.placement.courseId)` resolves. Signature other phases depend on:

```ts
export type TimetableSheetInput = {
  days: number;
  periods: number;
  columns: TimetableSheetColumn[];
  /** courseId → cohort; when set, each occupant label gains a ` (DP1)`/`(DP2)` suffix. */
  cohortTag?: ReadonlyMap<string, Cohort>;
};
```

#### 2. Per-course sheet builder

**File**: `src/entities/timetable/model/export/perspective-course-sheet.ts` (new)

**Intent**: Turn one `PerspectiveCourseItem` into a plain worksheet: a header block over the course's student roster. Empty roster renders the header plus a single "No students assigned." line (never crashes, mirroring `buildRosterSheet`'s empty-catalog behavior).

**Contract**: `buildPerspectiveCourseSheet(input) → TimetableSheet`, where input is `{ item: PerspectiveCourseItem; courseName: string; level: string; teacherNames: Record<string,string>; studentNames: Record<string,string>; omitTeacherKey?: string }`. (`courseName` is resolved by the assembler via `resolveCourseDisplay` — see the assembler behavior below — so a catalog-absent merge child degrades to its bare id, never `undefined`.) Header rows: course name (bold); `cohortLabel(item.cohort) · level`; hours `Placed {item.hours.placed} / Required {item.hours.required}` (omit when `hours` is null); co-teachers line = `item.teacherKeys` minus `omitTeacherKey`, resolved via `teacherNames`, sorted, comma-joined (omit line when none); occurrences = `item.occurrences` mapped to `${dayLabel(day)} ${periodLabel(period)} (${start}–${end})` via `periodTimeRange` (fall back to `periodLabel` past P10), comma-joined. Then a "Students" section: roster = `item.studentKeys` → `studentNames`, sorted `localeCompare`; empty → the note. Plain styling (no subject fills); reuse `sheet-types.ts` cells + `SHEET_BORDER_COLOR` like `roster-sheet.ts`.

#### 3. Sheet-name sanitize / truncate / dedup helper

**File**: `src/entities/timetable/model/export/sheet-name.ts` (new)

**Intent**: Produce Excel-legal, ≤31-char, unique worksheet names. Isolated and unit-tested because it is the single highest-risk detail.

**Contract**: Export `SHEET_NAME_MAX = 31`; `sanitizeSheetName(raw: string): string` — replace `/[\[\]\/\\:*?]+/g` with a space, collapse `\s+`, trim; `courseSheetName(courseName: string, cohort: Cohort): string` — sanitized name sliced to `SHEET_NAME_MAX − suffix.length` (suffix `" · " + cohortLabel(cohort)`) + suffix; `dedupeSheetNames(names: string[]): string[]` — case-insensitive de-dup appending `~2`, `~3`, … while trimming the base to keep totals ≤31. (Dedup can live here or in the assembler; keep it here with its own tests.)

#### 4. Persona-agnostic workbook assembler

**File**: `src/entities/timetable/model/export/perspective-workbook.ts` (new)

**Intent**: Compose the ordered sheets + filename for one person's plan — the pure glue between the perspective data and `write-excel-file`. Library-free; returns named `TimetableSheet`s (leaf renames `rows`→`data`). Persona-agnostic: teacher or student, distinguished only by inputs.

**Contract**: `buildPerspectiveWorkbook(input) → { sheets: { name: string; sheet: TimetableSheet }[]; fileName: string }`. Input:

```ts
type PerspectiveWorkbookInput = {
  planName: string;
  fileCode: string;            // teacher code now; student code later
  days: number;
  periods: number;
  cohorts: { cohort: Cohort; placements: PlannerPlacement[]; courseDisplay: Record<string, CourseDisplay> }[]; // placements MUST be pre-narrowed to the person's own courses by the caller

  courseDisplay: Record<string, CourseDisplay>;  // merged, for per-course names
  courseLevels: Record<string, string>;          // courseId → level (structural; NOT widget CourseInfo)
  items: PerspectiveCourseItem[];
  teacherNames: Record<string, string>;
  studentNames: Record<string, string>;
  omitTeacherKey?: string;     // teacher view: exclude self from co-teachers
  gridSheetName?: string;      // default "Timetable"
};
```

Behavior: (a) build the grid sheet by unioning `cohorts[].placements` (**each already narrowed by the caller to the person's own courses** — the assembler renders exactly what it is handed and stays persona-agnostic; the persona predicate `teacherCourses`/`studentCourses` lives at the caller, not here), merging their `courseDisplay`, and constructing `cohortTag` = every placement's `courseId → cohort`; call `buildTimetableSheet({ days, periods, columns: [{ cohort: cohorts[0].cohort, placements: union, courseDisplay: merged }], cohortTag })`; name it `gridSheetName ?? "Timetable"`. (b) Resolve each item's display name via `resolveCourseDisplay(courseDisplay, item.courseId).name` (`course-display.ts:12` — **never raw `courseDisplay[id].name`**, which is `undefined` for a catalog-absent merge child and throws in `sanitizeSheetName`; the resolver falls back to the bare id). Sort `items` by `(cohort, courseName)` for deterministic tab order; for each, `buildPerspectiveCourseSheet(...)` and a `courseSheetName(...)` candidate; `dedupeSheetNames` across all course candidates. (c) `fileName = `${slugify(planName)}-${slugify(fileCode)}.xlsx`` (local slugify mirroring `export-file-name.ts:12-18`: lowercase, non-alnum→`-`, trim, fallback `plan`). Grid sheet first, then course sheets in sorted order.

#### 5. Barrel exports

**File**: `src/entities/timetable/index.ts`

**Intent**: Expose the new modules on the entity's public API next to the existing export transforms.

**Contract**: Add `export * from "./model/export/perspective-course-sheet"`, `"./model/export/sheet-name"`, `"./model/export/perspective-workbook"`.

#### 6. Unit tests

**Files**: `perspective-workbook.test.ts`, `sheet-name.test.ts`, `perspective-course-sheet.test.ts` (new, co-located); extend `timetable-sheet.test.ts`.

**Intent**: Lock the risky behaviors. `sheet-name`: illegal-char strip, >31 truncation preserving the ` · DPx` suffix, dedup `~2`, case-insensitive collision. `perspective-course-sheet`: header content, hours/co-teacher/occurrence lines, self-exclusion via `omitTeacherKey`, empty-roster note. `perspective-workbook`: grid sheet first + one sheet per item, deterministic order, unique names, filename slug, empty-roster item still yields a sheet. `timetable-sheet`: `cohortTag` produces `(DP1)`/`(DP2)` suffixes; absence leaves output unchanged.

### Success Criteria:

#### Automated Verification:

- [ ] Type gate passes: `pnpm check`
- [ ] Unit tests pass: `pnpm test`
- [ ] Linting passes: `pnpm lint`
- [ ] FSD structure passes: `pnpm steiger`
- [ ] Production build stays clean: `pnpm build`

#### Manual Verification:

- [ ] Spot-check a test fixture's produced tab names and grid labels read as intended (`Name · DPx`, `… (DP1)`), including a sanitized long/illegal name and a deduped collision.

**Implementation Note**: After Phase 1's automated verification passes, pause for confirmation before wiring the UI in Phase 2.

---

## Phase 2: Wire the teacher Export button

### Overview

Add the single `write-excel-file/browser` leaf and slot the Export button into the teacher page header, passing the already-derived data. Disabled when the teacher has no courses.

### Changes Required:

#### 1. Export button (the library leaf)

**File**: `src/_pages/teacher-plan-view/ui/ExportTeacherPlanButton.tsx` (new)

**Intent**: The only new site binding `write-excel-file`. On click it assembles the workbook via `buildPerspectiveWorkbook`, maps named sheets to library descriptors, saves the file, and toasts on failure. Disabled with no courses.

**Contract**: Props mirror the assembler input the page can supply (`planName`, `teacherCode`, `days`, `periods`, the two cohort `{ cohort, placements, courseDisplay }` — where `placements` are already teacher-narrowed by the page, see §2 — merged `courseDisplay`, `courseLevels`, `items`, `teacherNames`, `studentNames`, `viewerTeacherId`). Handler: `const { sheets, fileName } = buildPerspectiveWorkbook({ … , omitTeacherKey: viewerTeacherId })`; map each `{ name, sheet }` → `{ data: sheet.rows, sheet: name, columns: sheet.columns, stickyRowsCount: sheet.stickyRowsCount, stickyColumnsCount: sheet.stickyColumnsCount }`; `await writeXlsxFile(descriptors).toFile(fileName)`; `catch` → `toast.error("Export failed — try again.")`. Renders its own `<Toaster />` (the teacher page mounts none) + a ghost `size="icon"` `Button` with lucide `Download`, `title`/`aria-label="Export teacher plan"`, `disabled={items.length === 0}`. Model on `ExportMenu.tsx:2-3,30-55` (trigger + toast pattern) minus the dropdown.

#### 2. Slot the button into the page header

**File**: `src/_pages/teacher-plan-view/ui/TeacherPlanPage.tsx`

**Intent**: Place the button beside the switcher and hand it the data already computed in render.

**Contract**: Wrap `<TeacherSwitcher>` and `<ExportTeacherPlanButton>` in a `flex items-center gap-2` container within the existing `header` (`:102-108`). Derive `courseLevels = Object.fromEntries(Object.entries(data.courseInfo).map(([id, info]) => [id, info.level]))`. Derive the teacher-narrowed placements per cohort (mirroring `deriveCohortView`'s narrowing at `:169-171`): `const dpNCourseIds = new Set(teacherCourses(data.dpN.courses, teacher.id).map((c) => c.id))`, then `perspectivePlacements(data.dpN.placements, dpNCourseIds)`. Pass `planName`, `teacher.code`, `data.days`, `data.periods`, the two cohorts `{ cohort, placements: perspectivePlacements(data.dpN.placements, dpNCourseIds), courseDisplay: data.dpN.courseDisplay }` (**narrowed placements — NOT the full-cohort `data.dpN.placements`**, which carries every teacher), the merged `courseDisplay` and `studentNames` (already computed at `:76-77`), `courseLevels`, `items` (already computed at `:57-74`), `data.teacherNames`, and `viewerTeacherId={teacher.id}`. `teacherCourses` and `perspectivePlacements` are already imported by `TeacherPlanPage.tsx` (`:13,:15`).

### Success Criteria:

#### Automated Verification:

- [ ] Type gate passes: `pnpm check`
- [ ] Linting passes: `pnpm lint`
- [ ] FSD structure passes: `pnpm steiger`
- [ ] Production build stays clean: `pnpm build`

#### Manual Verification:

- [ ] Exporting a teacher with multiple courses downloads `<plan-slug>-<teacher-code>.xlsx`.
- [ ] The grid sheet mirrors the on-screen grid: **only the viewed teacher's courses appear** (not other teachers'), each line tagged `(DP1)`/`(DP2)`, subject fills, break bands, frozen headers, and no collision/availability marks.
- [ ] One sheet per course, tab named `Name · DPx`, deduped; a long/illegal-char course name is sanitized and does not throw.
- [ ] Each per-course sheet shows the header block + roster; a course with no students shows "No students assigned."
- [ ] The Export button is disabled for a teacher who conducts no courses.
- [ ] A forced failure surfaces the `sonner` toast (verify the catch path).

**Implementation Note**: Pause for manual confirmation after Phase 2's automated verification passes.

---

## Testing Strategy

### Unit Tests:

- `sheet-name.test.ts` — illegal-char strip, 31-char truncation preserving suffix, `~2` dedup, case-insensitive collision.
- `perspective-course-sheet.test.ts` — header lines, hours/co-teacher/occurrence formatting, `omitTeacherKey` self-exclusion, empty-roster note.
- `perspective-workbook.test.ts` — sheet order (grid first) and count, deterministic tab order, unique names, filename slug, empty-roster item still yields a sheet.
- `timetable-sheet.test.ts` (extend) — `cohortTag` suffixes present; absence leaves existing output unchanged (guards the board export).

### Integration Tests:

- None. The feature is a pure client-side transform over already-loaded props plus one UI leaf; no new query, action, or route.

### Manual Testing Steps:

1. `pnpm dev`, open a teacher plan view with several courses across both cohorts.
2. Click Export; open the `.xlsx`. Verify the grid sheet (tags, fills, break bands, frozen headers, clean) and the per-course sheets (header + roster, tab names).
3. Open a course with an empty roster; confirm "No students assigned."
4. Switch to a teacher with no courses; confirm the button is disabled.
5. Confirm the filename is `<plan-slug>-<teacher-code>.xlsx`.

## Performance Considerations

None material. Generation is a click-driven, one-teacher, few-hundred-cell operation (~3–7 sheets) run client-side; the <200ms drag-drop budget (CLAUDE.md hard rule) is untouched.

## Migration Notes

None — additive only. No schema, data, or dependency change.

## References

- Research: `context/changes/teacher-export-plan-to-xlsx/research.md`
- Scope decisions: `context/changes/teacher-export-plan-to-xlsx/change.md` (§Scope Decisions 2026-07-08)
- Reference pattern (not reused): `src/_pages/plan-detail/lib/export-workbook.ts:50-89`, `src/_pages/plan-detail/ui/chrome/ExportMenu.tsx:2,30-55`
- Reused seams: `src/entities/timetable/model/export/{timetable-sheet.ts,roster-sheet.ts,sheet-types.ts}`, `src/entities/timetable/model/perspective-course-list.ts:35`, `src/shared/config/subject-colors.ts:56`, `src/entities/timetable/lib/period-times.ts:13`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Persona-agnostic export core

#### Automated

- [x] 1.1 Type gate passes: `pnpm check`
- [x] 1.2 Unit tests pass: `pnpm test`
- [x] 1.3 Linting passes: `pnpm lint`
- [x] 1.4 FSD structure passes: `pnpm steiger`
- [x] 1.5 Production build stays clean: `pnpm build`

#### Manual

- [x] 1.6 Spot-check a test fixture's tab names and grid labels (`Name · DPx`, `… (DP1)`), including a sanitized long/illegal name and a deduped collision

### Phase 2: Wire the teacher Export button

#### Automated

- [ ] 2.1 Type gate passes: `pnpm check`
- [ ] 2.2 Linting passes: `pnpm lint`
- [ ] 2.3 FSD structure passes: `pnpm steiger`
- [ ] 2.4 Production build stays clean: `pnpm build`

#### Manual

- [ ] 2.5 Exporting a multi-course teacher downloads `<plan-slug>-<teacher-code>.xlsx`
- [ ] 2.6 Grid sheet mirrors the screen: only the viewed teacher's courses appear, cohort-tagged lines, subject fills, break bands, frozen headers, no collision/availability marks
- [ ] 2.7 One sheet per course, tab `Name · DPx`, deduped; a long/illegal name is sanitized without throwing
- [ ] 2.8 Per-course sheet shows header + roster; empty roster shows "No students assigned."
- [ ] 2.9 Export button is disabled for a teacher with no courses
- [ ] 2.10 A forced failure surfaces the `sonner` toast
