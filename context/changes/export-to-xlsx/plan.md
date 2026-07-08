# Export to XLSX Implementation Plan

> **⚠️ Post-implementation supersessions (2026-07-08) — see `change.md` for the authoritative decisions.** Three grid-fidelity rules below were revised *after* this plan was written; the shipped code and its tests implement the revised model:
> - **One cell per course, vertical sub-rows** — retires "join occupants with `\n` in one cell" (§Critical Details, Phase 1 *Content cells*) and "fill only single-occupant cells" (§Critical Details, Phase 1 *Fills*). Every course now occupies its own sub-row cell and keeps its own subject-color fill; the time-range header `rowSpan`s the period's sub-rows.
> - **Hatch-filled break bands** — retires "empty cells, small height" (Phase 1 *Break bands*): the spacer rows now carry a grey `lightUp` diagonal-hatch fill.
> - **Weighted borders** — retires "thin borders" (Phase 1 *Grid styling*): a `hair` internal grid with `thin` day/period/cohort separators.
>
> Test-criteria prose at Phase 1 *Success Criteria*, *Testing Strategy*, and *Manual Testing Steps* that still says "newline+wrap / single-occupant fill / neutral bundle cell" describes the retired model — read it as historical.

## Overview

Add a client-side "Export to XLSX" feature to the plan-detail board: a download-icon dropdown button in the board toolbar lets the author export the placed grid of any view (**combined**, **dp1**, **dp2** — active focus offered first) as a styled `.xlsx` workbook, generated in the browser from the **live board state** (including unsaved optimistic edits) via `write-excel-file`. Besides the timetable sheet, the workbook carries one **subject roster sheet per exported cohort** (all catalog subjects with their assigned teachers and students, names resolved). The workbook assembly is a pair of pure, runtime-agnostic transforms in `entities/timetable`, structured for future server-side batch reuse.

This change resolves PRD Open Question #3 by superseding the historical "master-grid CSV" with a styled workbook (decision recorded in `change.md`).

## Current State Analysis

From `research.md` (all findings verified against code):

- **Data is fully available client-side.** `PlannerBoard` runs `useCombinedBoardState` unconditionally in every mode (`PlannerBoard.tsx:69`), so both cohorts' live states (`placements: LocalPlacement[]`, `courseDisplay: Record<string, CourseDisplay>`) exist regardless of the active focus — exporting DP2 while focused on DP1 needs no extra loading. Grid geometry (`days`, `periods`) and `planName` are props.
- **The toolbar has a natural slot.** The `trailing` slot of `PlanSummaryBar` currently holds `LensPicker` + `BoardSettingsMenu` (`PlannerBoard.tsx:248-260`).
- **All display helpers exist and are pure**: `groupCellOccupants` (name-sorted occupants per cell, `entities/timetable/model/collision/cell-occupants.ts:31`), `dayLabel`/`periodLabel` (`shared/lib/slot-labels`), `periodTimeRange` (`entities/timetable/lib/period-times.ts:13`), `breaksAfterPeriod` (`entities/timetable/lib/period-breaks.ts:19`), `cohortLabel` (`shared/config/cohorts.ts`).
- **No file-download precedent exists in `src/`** — this introduces the first one. No spreadsheet dependency exists yet.
- **Subject colors resolve to Tailwind classes only** (`shared/config/subject-colors.ts:52-61`); tokens map to Tailwind `<hue>-100` (bg) / `<hue>-900` (fg) in light mode (`src/app/styles/global.css:49-64`). A hex map for xlsx fills must be added.
- **`write-excel-file` API confirmed** (Context7): cell objects support `backgroundColor`, `textColor`, `fontWeight`, `align`, `wrap`, `columnSpan` (spanned cells hold `null`), per-cell borders, row `height`; options support column `width`, sheet name, sticky (frozen) rows/columns; browser entry exposes save-to-file and to-Blob outputs. **Multi-sheet workbooks** take an array of sheet descriptors — `[{ data, sheet, columns, stickyRowsCount, ... }, …]` — each with its own name, widths, and frozen panes.
- **Roster data is already hydrated in the island**: each cohort's `PlannerBoardProps.catalog` is `GroupingCourse[]` (`teacherKeys`, `studentKeys`, `hours`, `weekMode` — `model/drag.ts:63`, type from `@/shared/lib/catalog-hash`; `studentKeys` already folds overlaps/merges), with `courseDisplay` for subject names, `shared.teacherNames` and per-cohort `studentNames` for people names. A roster sheet is pure composition — no new loading.
- **Edge case**: `periodTimeRange` covers only P1–P10 but grid presets allow up to 12 periods — the time-range row header needs a fallback.

## Desired End State

An author on `/plans/{id}` (any focus) clicks the Export button in the board toolbar, picks Combined / DP1 / DP2 (the active view listed first), and the browser saves `<plan-slug>-<view>.xlsx`. Opening the file in Excel/Numbers/LibreOffice shows the board as rendered on the first sheet: day columns (spanning DP1|DP2 sub-columns with a cohort sub-label row in combined), period rows headed by time ranges, subject-color fills on single-course cells, `(A)`/`(B)` and `(optional)` tags, break bands after P2/P5, frozen headers. After it, **one subject roster sheet per exported cohort** ("DP1 subjects" / "DP2 subjects" — both in combined, one in focus) lists every catalog subject with its assigned teachers and students (resolved names) and weekly hours.

Verification: unit tests pin every fidelity rule of the pure transform; one e2e asserts a real download; manual check opens the file in a spreadsheet app.

### Key Discoveries:

- `groupCellOccupants(placements, courseDisplay, collisions)` with an **empty collisions map** yields clean, name-sorted `CellOccupant[]` per cell — exactly the export's "clean snapshot" need with zero new sorting/grouping logic (`cell-occupants.ts:31-45`).
- The combined-mode header structure to mirror is precisely `PlannerGrid.tsx:116-154`: day header spans `columns.length` sub-columns; a cohort sub-label row exists only when `columns.length > 1`.
- `sonner` toast is already in `shared/ui` — the error surface for a failed export.
- The transform must live in `entities/timetable` (not `shared/lib`): it consumes `LocalPlacement`, `CourseDisplay`, `periodTimeRange`, `breaksAfterPeriod`, which live there, and `shared` cannot import upward.

## What We're NOT Doing

- **No CSV variant** (decision: xlsx supersedes it).
- **No per-teacher / per-student timetable sheets** and no batch export — only the design constraint (pure, runtime-agnostic transform) anticipates them. (The per-cohort *subject roster* sheet — a flat list, not a per-person grid — IS in scope; decision 2026-07-07 in `change.md`.)
- **No server-side export route** — client-side generation only; the Worker bundle is untouched.
- **No shelf/parked bundles in the workbook** — placed grid only.
- **No collision/warning styling in the export** — the file renders clean regardless of validation state.
- **No export from the plans-list row menu** — board toolbar only (the list row cannot see live board state).
- **No CLAUDE.md Astro-version drift fix** — side finding from research, separate housekeeping.

## Implementation Approach

Two production phases plus a closure phase:

1. **Pure transforms first** (`entities/timetable`) — `buildTimetableSheet` (the grid) and `buildRosterSheet` (per-cohort subject list) — fully unit-tested with no UI or dependency in play. They emit library-shaped data (2D cell-object rows + sheet options) as **locally declared structural types** shared via `sheet-types.ts`, so `entities` takes no dependency on `write-excel-file` — the dependency binds only at the caller, which keeps the entity importable from any runtime and any future slice.
2. **UI + download wiring** in `_pages/plan-detail`: the `write-excel-file` dependency, an `ExportMenu` in the toolbar, filename convention, error toast.
3. **E2E download smoke + PRD Open Question #3 update.**

## Critical Implementation Details

> **Superseded — see the banner at the top of this file and `change.md` (2026-07-08).** The "Multi-course cell fills" rule below was retired: each course now occupies its own sub-row cell and keeps its own subject-color fill (one-cell-per-course), rather than one neutral cell per multi-occupant slot.

- **Multi-course cell fills**: a cell's fill is applied **only when the cell has exactly one occupant and that occupant has a color**. Multi-occupant cells stay neutral — a single fill over mixed-color courses would misrepresent them (decision).
- **Period row headers show only the time range** (e.g. `08:00–08:45`), not "P1" (decision — deliberate deviation from the on-screen header). When `periodTimeRange(period)` returns `null` (periods 11–12 under large presets), fall back to `periodLabel(period)`.
- **`write-excel-file` API shape**: the installed version's browser entry should be confirmed at implementation time (the docs show both `writeXlsxFile(data, { fileName })` and a thenable `.toFile()/.toBlob()` style across versions). The transform's output is version-agnostic (plain cell objects + options); only the one call site in `_pages/plan-detail` touches the real API.
- **Spanned cells**: in `write-excel-file`, a `columnSpan: n` cell must be followed by `n−1` `null` entries in the same row — the transform must emit those placeholders or columns shift.
- **Multi-sheet call shape**: the call site passes `writeXlsxFile` an **array of sheet descriptors** (`{ data, sheet, columns, stickyRowsCount, stickyColumnsCount }`) — timetable sheet first, then one roster sheet per exported cohort. Sheet names: `"Combined"` / `cohortLabel(cohort)` for the grid; `` `${cohortLabel(cohort)} subjects` `` for rosters.

## Phase 1: Pure Workbook Transform + Subject Color Hex Map

### Overview

Everything that decides *what the sheets contain* lands here as framework-free code with exhaustive unit tests: the hue→hex map in `shared/config` and the two sheet transforms (grid + subject roster) in `entities/timetable`.

### Changes Required:

#### 1. Subject color hex map

**File**: `src/shared/config/subject-colors.ts`

**Intent**: Give xlsx (and any future non-CSS consumer) concrete colors for the eight palette hues, mirroring the light-mode chip look.

**Contract**: Export `SUBJECT_COLOR_HEX: Record<SubjectColor, { fill: string; text: string }>` — one entry per `SUBJECT_COLOR_VALUES` member, `fill` = the Tailwind v4 `<hue>-100` value, `text` = the `<hue>-900` value (the light-mode pair from `global.css:49-64`). Tailwind v4's palette is defined in **OKLCH**, not hex — derive each hex by converting the v4 OKLCH value to sRGB hex (approximation acceptable; do **not** reuse Tailwind v3 hex values, which differ subtly). Static literals with a comment noting the OKLCH→hex derivation and tying them to the CSS tokens, following the file's existing "literal map per enum member" pattern (`SUBJECT_CHIP_CLASS`).

#### 2. Timetable sheet transform

**File**: `src/entities/timetable/model/export/timetable-sheet.ts` (new; plus `timetable-sheet.test.ts` beside it; exported through the entity barrel `src/entities/timetable/index.ts` like the `collision/` files). The shared structural output types (`TimetableSheetCell`, the sheet shape) live in `src/entities/timetable/model/export/sheet-types.ts` (new), imported by both this transform and the roster transform below.

**Intent**: The pure heart of the feature — turn one view's live grid data into styled sheet data. Framework-free, no browser APIs, no `write-excel-file` import: runtime-agnostic for the future server-side batch path.

**Contract**:

```ts
export type TimetableSheetColumn = {
  cohort: Cohort;
  placements: LocalPlacement[];
  courseDisplay: Record<string, CourseDisplay>;
};
export type TimetableSheetInput = {
  days: number;
  periods: number;
  /** One column in focus mode, two (dp1, dp2) in combined — same shape as PlannerGrid's columns. */
  columns: TimetableSheetColumn[];
};
/** Structurally compatible with write-excel-file cell objects / sheet options — declared locally
 *  so entities takes no dependency on the library. */
export type TimetableSheetCell = { value?: string; /* + style fields */ } | null;
export type TimetableSheet = {
  rows: TimetableSheetCell[][];
  columns: { width: number }[];
  stickyRowsCount: number;
  stickyColumnsCount: number;
};
export function buildTimetableSheet(input: TimetableSheetInput): TimetableSheet;
```

Fidelity rules (each is a test case):

- **Row 1 — day headers**: blank corner cell, then per day a bold centered `dayLabel(day)` cell with `columnSpan: columns.length` when multi (followed by the required `null` placeholders); no span when single-column.
- **Row 2 — cohort sub-labels, combined only**: blank corner, then `cohortLabel(column.cohort)` per sub-column under each day. Omitted entirely for single-column input.
- **Period rows**: row header = `"${start}–${end}"` from `periodTimeRange(period)`, falling back to `periodLabel(period)` when `null`; then per day × per column one content cell.
- **Content cells**: occupants via `groupCellOccupants(column.placements, column.courseDisplay, EMPTY_COLLISIONS)` (empty `Map` → clean flags, name-sorted). Each occupant renders one line: `name` + `" (A)"`/`" (B)"` when `week` is `a`/`b` (nothing for `both`) + `" (optional)"` when `isOptional`. Multi-occupant cells join lines with `\n` and set `wrap: true`.
- **Fills**: exactly one occupant with a non-null `color` → `backgroundColor`/`textColor` from `SUBJECT_COLOR_HEX`; zero or 2+ occupants, or colorless course → no fill.
- **Break bands**: after each period where `breaksAfterPeriod(period, periods)` is true, one spacer row (empty cells, small `height`) mirroring the board's break band.
- **Grid styling**: thin borders on header and content cells; column widths — narrow first column (time labels), uniform wider course columns.
- **Frozen panes**: `stickyColumnsCount: 1`; `stickyRowsCount: 2` in combined (day + cohort rows), `1` in focus mode.

#### 3. Subject roster sheet transform

**File**: `src/entities/timetable/model/export/roster-sheet.ts` (new; plus `roster-sheet.test.ts` beside it; exported through the entity barrel)

**Intent**: One cohort's full subject list — every catalog subject with its assigned teachers and students as resolved names — as a second, per-cohort worksheet. Same purity constraints as the timetable transform.

**Contract**:

```ts
export type RosterSheetInput = {
  /** The cohort's validation catalog — ALL subjects, placed or not (decision). */
  catalog: GroupingCourse[]; // from @/shared/lib/catalog-hash
  courseDisplay: Record<string, CourseDisplay>;
  teacherNames: Record<string, string>;
  studentNames: Record<string, string>;
};
export function buildRosterSheet(input: RosterSheetInput): TimetableSheet; // same structural sheet shape from sheet-types.ts
```

Fidelity rules (each is a test case):

- **Header row**: bold `Subject | Teachers | Students | Hours/week`, thin bottom border; `stickyRowsCount: 1`, `stickyColumnsCount: 0`.
- **One row per catalog subject**, sorted by resolved display name (then `id` for stability) — placed and unplaced alike.
- **Subject cell**: `resolveCourseDisplay(courseDisplay, course.id).name`. No color fills — the roster is a plain list.
- **Teachers / Students cells**: keys mapped through `teacherNames` / `studentNames` (fallback: the raw key when unmapped), sorted by resolved name, joined `", "`, `wrap: true`.
- **Hours/week cell**: `course.hours`, right-aligned.
- **Column widths**: subject ~28, teachers ~30, students ~60, hours ~10.
- **Empty catalog** → header row only (valid sheet, no crash).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test` (timetable transform covers: combined vs focus header structure incl. `null` span placeholders, week/optional suffixes, multi-occupant newline+wrap, single-occupant fill rule, colorless/multi-occupant no-fill, time-range fallback past P10, break-band rows, sticky counts, occupant ordering; roster transform covers: header row, all-catalog inclusion + name-sorted ordering, teacher/student name resolution + raw-key fallback, joined+wrapped people cells, hours column, empty catalog)
- Type check passes: `pnpm exec astro sync && pnpm check` (`astro check` — the repo's mandated type gate; never substitute build/lint/bare tsc)
- Lint + FSD structure pass: `pnpm lint && pnpm steiger`

#### Manual Verification:

- None — this phase is pure logic; manual verification happens with the UI in Phase 2.

---

## Phase 2: Export UI + Download Wiring

### Overview

Add the `write-excel-file` dependency and the user-facing affordance: an `ExportMenu` (download-icon dropdown) in the board toolbar that builds `TimetableSheetInput` from live state, calls the transform, and saves the file.

### Changes Required:

> **Addendum (post-implementation):** the sheet-descriptor assembly the plan describes inside `ExportMenu` (item #3) shipped as a separate pure module — `src/_pages/plan-detail/lib/export-workbook.ts` (`buildExportWorkbook(input) → { sheets, fileName }`, with `export-workbook.test.ts`). This keeps `ExportMenu` thin and makes the glue unit-testable without React; `write-excel-file` is imported only at the `ExportMenu` call site. FSD-legal (slice `lib/`, downward imports only).

#### 1. Dependency

**File**: `package.json`

**Intent**: Add `write-excel-file` (~19 KB gzip, sole dep `fflate`) — the only maintained, styling-capable, audit-clean candidate per research. Client-side usage only; no `wrangler.jsonc` or worker-bundle impact.

**Contract**: `pnpm add write-excel-file`; `pnpm audit --audit-level=high` stays clean (CI gate). Static import in the island (no dynamic-import precedent exists and the size doesn't justify creating one).

#### 2. Export file name helper

**File**: `src/_pages/plan-detail/lib/export-file-name.ts` (new, with test beside it)

**Intent**: Deterministic, filesystem-safe download name from plan name + view.

**Contract**: `exportFileName(planName: string, view: BoardSurface): string` → `<slug>-<view>.xlsx` (lowercased, non-alphanumerics collapsed to `-`, e.g. `IB 2027 draft` + `combined` → `ib-2027-draft-combined.xlsx`; empty slug falls back to `plan`).

#### 3. ExportMenu component

**File**: `src/_pages/plan-detail/ui/chrome/ExportMenu.tsx` (new; exported from the `chrome` barrel)

**Intent**: The toolbar affordance: a ghost icon button (lucide `Download`, `size-8`, `title`/`aria-label` "Export plan" — matching `BoardSettingsMenu`'s trigger pattern) opening a `DropdownMenu` (`shared/ui/dropdown-menu.tsx`, same as `PlansHub`) with three items — Combined, DP1, DP2 — the **currently active focus listed first** and marked as current.

**Contract**: Props carry `planName`, `focus: BoardSurface`, `teacherNames`, and the pieces to build per-view inputs: `days`, `periods`, plus both cohorts' `{ placements, courseDisplay, catalog, studentNames }`. On item select: build `TimetableSheetInput` (combined = `[dp1, dp2]` columns; focus = one) and one `RosterSheetInput` per included cohort; call the transforms; hand `write-excel-file`'s browser entry the **sheet-descriptor array** (timetable sheet first — named "Combined" / `cohortLabel(cohort)` — then `` `${cohortLabel(cohort)} subjects` `` roster sheet(s)) with `exportFileName(...)`; `await` it, and surface any thrown error via a `sonner` toast ("Export failed — try again.").

#### 4. Toolbar wiring

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Mount `ExportMenu` in the `trailing` slot between `LensPicker` and `BoardSettingsMenu` (`PlannerBoard.tsx:248-260`), fed from the already-present `dp1`/`dp2` states, `dp1Props`/`dp2Props` (`catalog`, `studentNames`), `shared.days/periods/teacherNames`, `planName`, and `focus`.

**Contract**: Live state for the grid — `state.placements` / `state.courseDisplay` from `CohortBoardState`, so unsaved optimistic edits are exported; roster inputs from the server-seeded props (`catalog`, `studentNames`, `teacherNames` — the catalog has no in-session edit surface on this page). No new hooks or state; the menu is stateless apart from its open/close.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test` (file-name helper; ExportMenu test with the xlsx lib mocked asserting the active focus is listed first and select builds the right input)
- Type check passes: `pnpm check`
- Build stays clean on workerd: `pnpm build`
- Audit gate stays clean: `pnpm audit --audit-level=high`
- Lint + steiger pass: `pnpm lint && pnpm steiger`

#### Manual Verification:

- On `/plans/{id}` in each focus (combined, dp1, dp2): Export → each of the three menu items downloads a file with the expected name
- Downloaded combined workbook opens in a spreadsheet app and mirrors the board: merged day headers over DP1|DP2, cohort sub-label row, time-range row headers, subject fills on single-course cells, `(A)`/`(B)`/`(optional)` tags, break bands, frozen header/label panes
- An unsaved in-session edit (e.g. drag a bundle, don't wait/refresh) appears in the exported file
- Export of a plan with an empty board produces a valid file with an empty grid (no crash)
- Combined workbook carries "DP1 subjects" + "DP2 subjects" roster tabs (focus export: its one cohort's tab) listing every catalog subject with resolved teacher/student names and hours

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation from the human that the manual testing was successful before proceeding to Phase 3.

---

## Phase 3: E2E Download Smoke + Doc Closure

### Overview

One browser-level assertion that the download really happens, plus the documentation follow-up recorded in `change.md`.

### Changes Required:

#### 1. E2E download spec

**File**: `e2e/specs/export-xlsx.spec.ts` (new, following the existing spec conventions in `e2e/specs/`)

**Intent**: Guard the wiring end-to-end: authenticated author opens a seeded plan, triggers Export → Combined, and a `.xlsx` download event fires.

**Contract**: Playwright `page.waitForEvent("download")` around the menu-item click; assert the suggested filename matches `exportFileName` output for the seeded plan and the download stream is non-empty. No spreadsheet parsing — content fidelity is Phase 1's unit-test territory.

#### 2. PRD Open Question #3 closure

**File**: `context/foundation/prd.md` (Open Questions section, ~line 480; touch `roadmap.md:203` only if its conditional phrasing needs the same one-line resolution)

**Intent**: Record the resolution the change ships: export is in scope, as a styled XLSX workbook superseding the "master-grid CSV" phrasing; content requirement (both cohorts distinguishable, co-teaching, bi-weekly weeks) unchanged. This is the follow-up explicitly noted in `change.md`.

**Contract**: Prose edit marking Open Question #3 resolved with a pointer to `context/changes/export-to-xlsx/`.

### Success Criteria:

#### Automated Verification:

- E2E suite passes: `pnpm test:e2e` (with local stack + preview running, as in CI)
- Full local gate passes: `/verify`

#### Manual Verification:

- `prd.md` Open Questions reads correctly (no stale CSV wording left contradicting the shipped feature)

---

## Testing Strategy

### Unit Tests:

- `timetable-sheet.test.ts` — the fidelity contract, one test per rule listed in Phase 1 (header spans + `null` placeholders, cohort sub-label row presence, suffix formatting, fill rule, wrap/newline joins, time-range fallback, break rows, sticky counts, occupant ordering, empty board)
- `roster-sheet.test.ts` — one test per roster rule (header, all-catalog + ordering, name resolution + fallback, joined/wrapped people cells, hours, empty catalog)
- `export-file-name.test.ts` — slugging, view suffix, degenerate names
- `ExportMenu` component test — menu ordering (active focus first), sheet-descriptor assembly per item (timetable + per-cohort rosters), lib mocked

### Integration Tests:

- None — no server or DB surface changes.

### Manual Testing Steps:

1. Open a seeded plan in combined view; export all three views; open each file in a spreadsheet app and compare against the board.
2. Make an optimistic edit (drag a placement) and export immediately — the edit must appear.
3. Toggle a placement to week A and optional; confirm `(A) (optional)` in the cell.
4. Check a bundle cell (2+ courses): newline-separated lines, neutral fill.
5. Open the roster tab(s): every catalog subject listed (including unplaced ones) with full teacher/student names; spot-check one co-taught course and one merged-enrollment course.

## Performance Considerations

Generation is client-side and event-driven (button click) — the <200 ms drag-drop budget is untouched. A full 7×12 two-cohort grid is a few hundred cells; `write-excel-file` handles this in milliseconds (browser entry offloads to a Web Worker where available). Island bundle grows ~19 KB gzip — acceptable statically.

## Migration Notes

None — no schema, no persisted state, no server code. Rollback = revert the commits.

## References

- Related research: `context/changes/export-to-xlsx/research.md`
- Decisions log: `context/changes/export-to-xlsx/change.md`
- Layout to mirror: `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx:98-204`
- Occupant grouping to reuse: `src/entities/timetable/model/collision/cell-occupants.ts:31-45`
- Toolbar slot: `src/_pages/plan-detail/ui/PlannerBoard.tsx:248-260`
- Palette tokens: `src/app/styles/global.css:49-64`, `src/shared/config/subject-colors.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Pure Workbook Transform + Subject Color Hex Map

#### Automated

- [x] 1.1 Unit tests pass: `pnpm test` (all transform fidelity rules covered) — 5fafa14
- [x] 1.2 Type check passes: `pnpm exec astro sync && pnpm check` — 5fafa14
- [x] 1.3 Lint + FSD structure pass: `pnpm lint && pnpm steiger` — 5fafa14

### Phase 2: Export UI + Download Wiring

#### Automated

- [x] 2.1 Unit tests pass: `pnpm test` (file-name helper + ExportMenu) — 18169a5
- [x] 2.2 Type check passes: `pnpm check` — 18169a5
- [x] 2.3 Build stays clean on workerd: `pnpm build` — 18169a5
- [x] 2.4 Audit gate stays clean: `pnpm audit --audit-level=high` — 18169a5
- [x] 2.5 Lint + steiger pass — 18169a5

#### Manual

- [x] 2.6 All three views export with expected filenames from every focus — combined verified end-to-end via the Playwright preview download (real filename + PK-signed .xlsx); all three views' filenames + sheet sets pinned in `export-workbook.test`
- [x] 2.7 Combined workbook mirrors the board (headers, fills, tags, breaks, frozen panes) — verified against real write-excel-file@4.1.1 output (mergeCell B1:C1 day span + A4:C4 break band, sky fill #DFF2FE/#024A70, "Math (A) (optional)" tag, "08:00–08:45" time header, frozen pane ySplit=2 xSplit=1)
- [x] 2.8 Unsaved in-session edit appears in the export — by construction: `ExportMenu` reads `state.placements`/`state.courseDisplay` (the live optimistic store `PlannerGrid` renders from), never a server re-read (`PlannerBoard.exportCohort`)
- [x] 2.9 Empty board exports a valid empty grid — brand-new plan exported a valid non-empty .xlsx in the Playwright preview run; `buildTimetableSheet` empty-board unit test covers the structure
- [x] 2.10 Roster tab(s) present per exported cohort, listing every catalog subject with resolved teacher/student names and hours — "DP1 subjects"/"DP2 subjects" sheets verified (real output + export-workbook.test)

### Phase 3: E2E Download Smoke + Doc Closure

#### Automated

- [x] 3.1 E2E suite passes: `pnpm test:e2e` — 9abcd32
- [x] 3.2 Full local gate passes: `/verify` — 9abcd32

#### Manual

- [x] 3.3 `prd.md` Open Question #3 reads as resolved, no stale CSV wording — Open Q #3 marked resolved (XLSX supersedes CSV); matching resolutions in `roadmap.md` (#3 + the parked PDF aside)
