<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Export to XLSX Implementation Plan

- **Plan**: context/changes/export-to-xlsx/plan.md
- **Mode**: Deep
- **Date**: 2026-07-07
- **Verdict**: SOUND
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | WARNING |

## Grounding

8/8 paths ✓, 9/9 symbols ✓, brief↔plan ✓. Deep verification (inline, all confirmed):

- `groupCellOccupants` with an empty collisions `Map` yields clean flags + name-sorted occupants (`cell-occupants.ts:31-45`); `week`/`isOptional` reachable via `occupant.placement` (`placement.ts:10,16`).
- `LocalPlacement`/`CourseDisplay` live in / re-export through `entities/timetable` — the FSD placement claim holds; barrel pattern matches `index.ts`.
- Combined header structure exactly as claimed at `PlannerGrid.tsx:116-154`.
- `PlannerBoard` holds both cohorts' live states unconditionally (`PlannerBoard.tsx:69`); `trailing` slot at 248–261.
- `write-excel-file` API claims confirmed against current docs (Context7): `textColor` is the correct property, `columnSpan` needs trailing `null` placeholders, `stickyRowsCount`/`stickyColumnsCount`, per-cell `height`, `sheet` name, column `width` all exist as described.
- Blast radius minimal by construction — purely additive change (new files, barrel additions, one JSX insertion).
- Progress↔Phase contract fully consistent.

## Findings

### F1 — Type-check criterion cites bare `tsc --noEmit` instead of the mandated `pnpm check`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 Success Criteria + Progress 1.2; Phase 2 Success Criteria
- **Detail**: The lessons.md rule ("Green build/test/lint ≠ type-safe") mandates `pnpm check` (`astro check`) as the only valid type gate; it strictly dominates bare tsc. Phase 1 cited `tsc --noEmit`; Phase 2 (which adds new `.tsx`) had no type gate at all — the exact false-green pattern the lesson documents.
- **Fix**: Phase 1 SC → "`pnpm exec astro sync && pnpm check`" (Progress 1.2 updated); "Type check passes: `pnpm check`" added to Phase 2 Automated criteria with new Progress 2.2 (2.2–2.8 renumbered to 2.3–2.9).
- **Decision**: FIXED

### F2 — "The Tailwind v4 `<hue>-100` hex" doesn't exist as a copyable literal

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Subject color hex map contract
- **Detail**: Tailwind v4's default palette is defined in OKLCH, not hex — `global.css:49-64` references `var(--color-rose-100)` etc. There is no canonical v4 hex to copy; an implementer's natural shortcut is Tailwind v3 hex values, which differ subtly from the recalibrated v4 OKLCH palette.
- **Fix**: Contract amended: derive each hex by converting the v4 OKLCH value to sRGB hex (approximation acceptable, no v3 reuse) and note the derivation in the map's source comment.
- **Decision**: FIXED
