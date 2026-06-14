<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Teacher Availability

- **Plan**: context/changes/teacher-availability/plan.md
- **Scope**: Full plan — Phases 1–4 of 4
- **Date**: 2026-06-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (2 observations) |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success criteria (re-run locally 2026-06-14)

- `pnpm test` — 345 passed (32 files) ✅ (was 342; +3 nextLineSeverity cases from the F1 fix)
- `pnpm lint` — clean ✅
- `pnpm steiger` — no problems ✅
- `pnpm build` — complete, no errors ✅
- `pnpm test:integration` — 20 passed (8 files) ✅
- `supabase gen types` — NO DIFF vs committed `database.types.ts` ✅

## Findings

### F1 — Bulk-cycle severity read diverges from rollback snapshot source

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: TeacherAvailabilityDialog.tsx:92,97 + use-teacher-availability.ts:100,116
- **Detail**: The bulk next-severity was computed from rendered `cells` (hook `severityAt` reads `cells`) while `applyLine` captured its rollback snapshot from `cellsRef.current` — two reads of "current" state on the column/row paths. `cycleCell` already reads `cellsRef` for both. Low-probability divergence (rapid header re-click between render-commit and the `useLatest` effect flush + a write failure), but a real asymmetry.
- **Fix**: Moved the next-severity decision into the hook as `cycleColumn(day)`/`cycleRow(period)`, reading `cellsRef.current` — the same source `applyLine` uses for the rollback snapshot. Extracted `nextLineSeverity` as a pure helper in `availability.ts` (+3 unit tests); the dialog now calls `availability.cycleColumn`/`cycleRow`.
- **Decision**: FIXED

### F2 — Row-axis bulk feature added beyond the planned column-only bulk

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: availability-actions.ts (setAvailabilityRow), availability.ts (rowCoords), use-teacher-availability.ts, TeacherAvailabilityDialog.tsx
- **Detail**: Plan specified whole-DAY (column) bulk and "register 3" actions. The implementation also shipped a full row axis: a 4th action `setAvailabilityRow`, `rowCoords` in the model, `cycleRow` in the hook, and clickable period-row headers. Symmetric, tested (unit + integration), a natural UX completion — but outside the plan's contract.
- **Decision**: FIXED (kept; documented as an addendum under plan.md Phase 2 item #3)

### F3 — slot-labels (and grid) live in shared/config/ instead of shared/lib/

- **Severity**: 🟡 OBSERVATION
- **Impact**: 🏃 LOW → escalated to a follow-up (blocked by a CI constraint)
- **Dimension**: Plan Adherence / Pattern Consistency
- **Location**: src/shared/config/slot-labels.ts, src/shared/config/grid.ts
- **Detail**: Plan item 1.6 targeted `shared/lib/slot-labels/`; `dayLabel`/`periodLabel` are display helpers and `parseGridPreset` is logic — both are lib-shaped. A trial move during triage failed `pnpm steiger`: `shared/lib` is at exactly the 15-module `fsd/shared-lib-grouping` cap, so adding 2 modules (→ 17) breaks the `--fail-on-warnings` gate. The `config` placement was a deliberate workaround, not an oversight. Move reverted; tree green.
- **Fix**: Larger `shared/lib` regroup required first (free ≥2 module slots), then move. Out of scope for this review.
- **Decision**: FOLLOW-UP (queued in `follow-ups/review-fixes.md`)

### F4 — Availability badge rendered in the Code cell, plan said Name cell

- **Severity**: 🟡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/_pages/teachers/ui/TeacherTable.tsx:80-84
- **Detail**: Plan item 2.9 placed `AvailabilityBadge` in the Name cell beside `row.fullName`; it sits in the Code cell beside `row.code` instead. Code is the first/most-prominent column, so visibility is arguably better. Purely cosmetic.
- **Decision**: ACCEPTED (kept in the Code cell — more visible)
