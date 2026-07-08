# Export to XLSX — Plan Brief

> Full plan: `context/changes/export-to-xlsx/plan.md`
> Research: `context/changes/export-to-xlsx/research.md`

## What & Why

Add "Export to XLSX" to the plan-detail board: the author downloads the placed timetable grid as a styled `.xlsx` workbook for any view (combined / dp1 / dp2). This resolves PRD Open Question #3 — the historically-specified "master-grid CSV" is superseded by a styled workbook, because CSV cannot represent the enriched model (two cohorts, co-teaching, bi-weekly week tags, colors, merged headers) in one readable sheet.

## Starting Point

The board island already holds everything the export needs: both cohorts' live placements and course display maps (including unsaved optimistic edits), grid geometry, and pure display helpers (day/period labels, period times, break bands, occupant grouping). There is no file-download precedent and no spreadsheet dependency in the codebase yet — this change introduces both.

## Desired End State

A download-icon dropdown in the board toolbar offers Combined / DP1 / DP2 (active view first). Picking one saves `<plan-slug>-<view>.xlsx` that mirrors the rendered board: merged day headers over DP1|DP2 sub-columns (combined), time-range row headers, subject-color fills on single-course cells, `(A)`/`(B)`/`(optional)` tags, break bands, frozen panes. After the grid sheet, one **subject roster tab per exported cohort** lists all catalog subjects with resolved teacher/student names and weekly hours.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Format | Styled XLSX, no CSV variant | CSV can't hold the enriched two-cohort model in one readable sheet | Research |
| Source of truth | Live in-session board state, client-side generation | "Export what you see", incl. unsaved edits; bypasses all Workers limits | Research |
| Library | `write-excel-file` (~19 KB gzip) | Only candidate that is maintained, styling-capable, audit-clean, and runtime-agnostic | Research |
| Reuse constraint | Pure, runtime-agnostic transform in `entities/timetable` | Future server-side batch export imports the same module; needs domain types shared/lib can't reach | Research / Plan |
| Entry point | Dedicated download-icon toolbar button | Export is an action, not a board setting; matches the icon-button row | Plan |
| View selection | Dropdown on the button (Combined/DP1/DP2, active first) | One control covers the decided scope without dialog ceremony | Plan |
| Cell content | Course name + week `(A)`/`(B)` + `(optional)` | Exactly mirrors the board chip; no teacher codes (board doesn't show them) | Plan |
| Cell fills | Subject hue only on single-course cells | A single fill over mixed-color courses would misrepresent them | Plan |
| Period row headers | Time range only (e.g. `08:00–08:45`), `P<n>` fallback past P10 | Deliberate deviation: the artifact is read away from the app | Plan |
| Validation states | Export renders clean — no collision styling | An export is a deliverable snapshot; collision tones are live editing aids | Plan |
| Subject roster sheets | One "\<Cohort\> subjects" tab per exported cohort, all catalog subjects (placed or not), teachers/students as resolved names + hours | The assignment picture belongs with the grid; data is already island-hydrated, multi-sheet is native to the lib | change.md (2026-07-07) |

## Scope

**In scope:** hue→hex map in `shared/config`; pure `buildTimetableSheet` + `buildRosterSheet` transforms + unit tests in `entities/timetable`; `write-excel-file` dependency; `ExportMenu` in the board toolbar (multi-sheet workbook: grid + per-cohort subject rosters); filename helper; error toast; one e2e download smoke; PRD Open Q #3 closure.

**Out of scope:** CSV; per-teacher/per-student *timetable* sheets; batch export; any server-side route; shelf/parked bundles; plans-list entry point; CLAUDE.md Astro-version drift fix.

## Architecture / Approach

`PlannerBoard` (already holding both cohorts' live state + catalogs/name maps) feeds `ExportMenu` → `buildTimetableSheet` + `buildRosterSheet` (pure, framework-free, in `entities/timetable`, emitting locally-typed cell objects structurally compatible with `write-excel-file`) → the library's browser entry saves one multi-sheet file. The dependency binds only in `_pages/plan-detail`; `entities` stays dependency-free so a future Worker route can import the same transforms.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Pure transforms + hex map | `buildTimetableSheet` + `buildRosterSheet` with every fidelity rule unit-tested | Getting merged-cell `null` placeholders wrong shifts columns |
| 2. Export UI + download | Toolbar dropdown, dependency, filename, toast; manual file check | Installed lib version's exact save API differs across majors |
| 3. E2E + doc closure | Playwright download assertion; PRD Open Q #3 resolved | Download events in headless CI need the standard Playwright pattern |

**Prerequisites:** none beyond the normal dev stack (local Supabase for the e2e phase).
**Estimated effort:** ~2 sessions across 3 phases; Phase 1 is the bulk.

## Open Risks & Assumptions

- `write-excel-file`'s browser save API varies between majors (callback vs thenable) — confirmed at implementation time; only one call site is affected.
- Fidelity in third-party spreadsheet apps (Numbers/LibreOffice rendering of fills/merges) is verified manually, not automatable.
- Assumes the paid Cloudflare plan stays (irrelevant to this client-side change, but underpins the future batch path the design anticipates).

## Success Criteria (Summary)

- The author can download any of the three views as a valid `.xlsx` whose layout and markers match the rendered board, including unsaved edits.
- The pure transform's fidelity rules are all pinned by unit tests; one e2e proves the real download.
- PRD Open Question #3 is closed in the docs with the shipped decision.
