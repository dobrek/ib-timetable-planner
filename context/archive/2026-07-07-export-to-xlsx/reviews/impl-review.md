<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Export to XLSX

- **Plan**: context/changes/export-to-xlsx/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-07-08
- **Verdict**: NEEDS ATTENTION (all findings triaged & fixed)
- **Findings**: 0 critical · 2 warnings · 2 observations — all resolved

## Summary

Strong implementation. Every planned change is present and correct; all three
post-plan grid-fidelity supersessions (one-cell-per-course sub-rows, hatch break
bands, weighted borders) match the `change.md` 2026-07-08 decisions log and are
covered by tests. The workbook assembly is correctly extracted as a pure,
library-free module (`buildExportWorkbook`), with `write-excel-file` imported
only at the one browser call site via the workerd-safe `write-excel-file/browser`
entry. Error handling wraps the async export in `try/catch → sonner`;
spreadsheet-formula-injection is mitigated by the library's typed-string cells.

Gates re-run during review — all green: `vitest` 45/45 · `astro check` 0 errors ·
`eslint` clean · `steiger` clean · `pnpm audit --audit-level=high` clean ·
`pnpm build` (workerd) clean. `pnpm test:e2e` was **not** re-run here (needs the
local Supabase stack + workerd preview); marked done at `9abcd32`, spec verified
convention-conformant.

All four findings are documentation-hygiene / test-robustness — zero runtime
defects. Every one was fixed during triage.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — plan.md still describes the superseded grid model

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/export-to-xlsx/plan.md:55,114-117,153,266,280
- **Detail**: change.md (2026-07-08) records three supersessions (one-cell-per-course sub-rows, hatch break bands, weighted borders); shipped code + tests implement the new model, but plan.md still stated the old rules (newline-join single cell, single-occupant-only fills, empty break bands, thin borders), and its test-criteria prose described now-inverted tests. Documented drift (logged in change.md), but plan.md self-contradicted the code.
- **Fix**: Added an additive supersession banner near the top of plan.md + a section note at Critical Implementation Details (no Progress step-title rewrites).
- **Decision**: FIXED

### F2 — prd.md:380 still calls CSV export "unresolved"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/foundation/prd.md:380
- **Detail**: Phase 3 resolved Open Question #3 (prd.md:480, XLSX supersedes CSV) and ticked the manual criterion "no stale CSV wording left contradicting the shipped feature," but prd.md:380 still read "CSV export is unresolved (see Open Questions)" — a live cross-reference contradicting the resolved question. (Lines 72/178 are historical current-state audit prose, left as-is.)
- **Fix**: Rewrote prd.md:380 to reflect the shipped styled `.xlsx` export (Open Q #3 resolved), with a pointer to context/changes/export-to-xlsx/.
- **Decision**: FIXED

### F3 — Unplanned export-workbook.ts (benign, beneficial)

- **Severity**: 🔎 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/_pages/plan-detail/lib/export-workbook.ts (+ .test.ts)
- **Detail**: Not named in the plan — the plan had ExportMenu assemble sheet descriptors and call write-excel-file inline. The implementation extracted a pure, library-free `buildExportWorkbook(input) → { sheets, fileName }` into the slice's lib/ with its own test, isolating the library import to ExportMenu. Strict improvement, FSD-legal, all "NOT doing" boundaries respected. No scope creep.
- **Fix**: Added a post-implementation addendum note to the plan's Phase 2 "Changes Required" so the file inventory matches reality.
- **Decision**: FIXED

### F4 — e2e spec re-implements the slug rule

- **Severity**: 🔎 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: e2e/specs/export-xlsx.spec.ts:13-20
- **Detail**: The spec inlined a copy of slugify/exportFileName (rationale: no src/ import across the e2e boundary) and asserted the fully-reconstructed filename — a copy that could drift silently while still passing. The slug rule is already pinned by export-file-name.test.ts.
- **Fix**: Removed the inline slug helper; the assertion now matches `/^.+-combined\.xlsx$/` (plan-derived prefix + view suffix), keeping the wiring guard without duplicating the encoding. Lint clean.
- **Decision**: FIXED
