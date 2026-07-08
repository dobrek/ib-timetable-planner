<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Teacher Export Plan to XLSX

- **Plan**: context/changes/teacher-export-plan-to-xlsx/plan.md
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-07-08
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations (all fixed during triage)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated success criteria re-run at review time (post-fix): `pnpm check` 0 errors · `pnpm test` 1065 passed · `pnpm lint` clean · `pnpm steiger` clean · `pnpm build` complete.

Verified beyond the criteria: the critical teacher-narrowed-placements path (`TeacherPlanPage.tsx:126,131` passes `perspectivePlacements(...)`, not the raw full-cohort array); `resolveCourseDisplay` used for names (never raw `courseDisplay[id].name`); `cohortTag` threading is purely additive (board export byte-identical); FSD clean (entity imports only `@/shared/*` + within-entity; `level` enters as structural `Record<courseId,string>`, not the widget `CourseInfo`).

## Findings

### F1 — Grid sheet name skips the case-insensitive dedup pass

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/entities/timetable/model/export/perspective-workbook.ts:70, 76-78
- **Detail**: The grid name (`gridSheetName ?? "Timetable"`) was added to the workbook outside the `dedupeSheetNames` pass and was never sanitized or uniqueness-checked. `write-excel-file` does not enforce Excel's cross-sheet uniqueness, so a future caller (student view) passing a `gridSheetName` colliding with a course tab would get a silently corrupt workbook — no throw, no toast. Unreachable in today's teacher path (course tabs always carry a ` · DPx` suffix).
- **Fix**: Fold the grid name into the same `dedupeSheetNames` pass (grid first, so it wins ties) and route it through `sanitizeSheetName` + length cap via a new `gridSheetName` helper; the single sort now happens once in the top function. Added a collision test.
- **Decision**: FIXED

### F2 — Unguarded `cohorts[0]` access in the grid builder

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/entities/timetable/model/export/perspective-workbook.ts:67
- **Detail**: `buildGridSheet` read `input.cohorts[0].cohort` with no non-empty guard; an empty `cohorts` array would throw a TypeError. The button always passes `[dp1, dp2]`, so latent robustness for the reusable core. The column's `cohort` is only read by the multi-column cohort-label row; the single-column perspective grid never consumes it.
- **Fix**: `input.cohorts[0]?.cohort ?? "dp1"` with a comment noting the field is unused for a single-column grid (visible tag comes from `cohortTag`).
- **Decision**: FIXED

### F3 — No in-flight guard against double-click export

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/_pages/teacher-plan-view/ui/ExportTeacherPlanButton.tsx:56, 95-97
- **Detail**: `exportPlan` had no disabled-during-export state, so a rapid double-click triggered two workbook builds/downloads. Benign (pure over immutable props) and consistent with the reference `ExportMenu.tsx`.
- **Fix**: Added a `useState` `exporting` flag — set true at start, reset in `finally`; button `disabled={exporting || items.length === 0}`.
- **Decision**: FIXED

### F4 — Sheet-name sanitizer misses two Excel edge cases

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Correctness)
- **Location**: src/entities/timetable/model/export/sheet-name.ts:13-16, 19-25
- **Detail**: (a) A name beginning/ending with an apostrophe `'` is rejected by Excel but was passed through; (b) an all-punctuation name (e.g. `"///"`) sanitized to `""` → `courseSheetName` returned `" · DP1"` (leading space). Both near-impossible with real IB data (`resolveCourseDisplay` falls back to alphanumeric course ids).
- **Fix**: `sanitizeSheetName` now trims leading/trailing spaces **and** apostrophes; `courseSheetName` degrades to the bare cohort label (`"DP1"`) when the name sanitizes to nothing. Updated the module docstring and added tests for both cases.
- **Decision**: FIXED
