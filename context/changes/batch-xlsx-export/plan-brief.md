# Batch xlsx Export — Plan Brief

> Full plan: `context/changes/batch-xlsx-export/plan.md`
> Research: `context/changes/batch-xlsx-export/research.md`

## What & Why

One click on the plan board exports everything the school office needs: the combined-plan workbook plus one workbook per teacher, packaged as a single `<plan-slug>.zip`. Today the author must visit each teacher's page and export one file at a time (~34 clicks per plan); the export stack was deliberately pre-staged (pure, library-free builders) for exactly this batch path.

## Starting Point

All three shipped exports already run entirely in the browser: the board's `ExportMenu` builds the combined workbook from live state, and the teacher view builds a per-teacher workbook via the persona-agnostic `buildPerspectiveWorkbook`. The research verified the batch needs no new builders and no server involvement (measured ~85 ms for 41 workbooks + zip) — only three small SSR reads the board loader doesn't do yet (teacher codes, course merges, course levels), a pure assembly loop, and zip glue.

## Desired End State

The board's export dropdown gains a "Download all (zip)" item. Selecting it downloads `<plan-slug>.zip` containing `<plan-slug>-combined.xlsx` plus `<plan-slug>-<teacher-code>.xlsx` for every teacher who conducts at least one course — all reflecting the live board, including unsaved edits. Any failure aborts the whole batch with the standard failure toast; success is silent, like every existing export.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Where generation runs | Pure client-side | All exports already run in-browser; scale is ~85 ms, so the Worker/30 s limit is irrelevant | Research |
| UI placement | Board `ExportMenu` item "Download all (zip)" | The menu already models multi-variant export; live state is right there | Research |
| Zero-course teachers | Skipped | Archive holds only meaningful files, mirroring the single-export button's self-disable | Research |
| State semantics | Live board state (incl. unsaved edits) | Identical to the existing board export — what you see is what you export | Research |
| Zip layout & naming | Flat `<plan-slug>.zip`; `-combined` + `-<teacher-code>` files, numeric-suffix dedupe | Follows the shipped filename conventions | Research |
| Packaging | `fflate.zipSync` at compression level 0 | Already in the lockfile; xlsx is pre-deflated so recompression is wasted CPU | Research |
| Mid-batch failure | Fail the whole batch, one toast, no zip | A throw at this scale means a real data bug; no silently incomplete archives | Plan |
| Success feedback | Silent (failure toast only) | Parity with all three shipped exports; nothing to wait for at ~85 ms | Plan |
| Test coverage | Unit (pure assembly + menu leaf) + manual zip check | The pure core carries all logic; download-capture e2e is brittle for glue that rarely regresses | Plan |
| Teacher query reuse | Hoist `fetchPlanTeachers` to `shared/api` | FSD forbids cross-page-slice imports; matches `loadCourseMerges` precedent | Plan |

## Scope

**In scope:** loader additions (teacher codes, merges, course levels), pure batch-assembly function in `plan-detail/lib/`, `fflate` zip glue + menu item at the `ExportMenu` leaf, unit + integration test coverage.

**Out of scope:** student workbooks in the batch, any server-side export path (R2/Queues/Workflows), progress UI or success toasts, skip-and-report partial archives, changes to `entities/timetable` builders, Playwright e2e for the download.

## Architecture / Approach

Everything lands in the `plan-detail` slice along existing seams: the SSR loader gains three parallel reads and returns them as one `batchExport` prop (kept out of `SharedBoardProps`, which feeds the drag hooks); a pure `buildBatchExportWorkbooks` in `lib/` loops teachers → derives each teacher's courses from catalog `teacherKeys` + merges → narrows live placements → reuses `buildPerspectiveWorkbook`, plus one `buildExportWorkbook("combined")`; `ExportMenu` stays the sole library-binding leaf, now for both `write-excel-file` (`.toBlob()`) and `fflate` (`zipSync`, level 0).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Loader & prop plumbing | The three missing reads threaded to the island; no visible change | Fixture churn if data leaks into `SharedBoardProps` (kept separate) |
| 2. Pure batch assembly | Fully unit-tested workbook list + zip filename from live state | Per-teacher narrowing subtleties (merges, live hours) — mirrored from `TeacherPlanPage` |
| 3. Zip glue + menu item | The working "Download all (zip)" flow | Browser glue (`toBlob`/object URL) only manually verified |

**Prerequisites:** local Supabase running for the integration suite; nothing else.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- Assumes `write-excel-file@4.1.1`'s `.toBlob()` behaves like `.toFile()` minus the download (verified in the installed package, not yet in our code).
- Teacher codes are assumed unique-enough per plan; the numeric-suffix dedupe covers collisions defensively.
- Manual-only coverage of the final download step — a regression there would surface in manual checks, not CI.

## Success Criteria (Summary)

- One click produces one zip with a correct combined workbook plus one workbook per conducting teacher, matching live board state.
- Zero-course teachers produce no file; failures abort cleanly with a toast and no partial archive.
- Existing exports, the drag-drop budget, and CI gates (`test`, `test:integration`, `lint`, `steiger`, `build`) stay green.
