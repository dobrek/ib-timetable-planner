<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: use-placements.ts Cleanup

- **Plan**: context/changes/use-placements-cleanup/plan.md
- **Scope**: All 5 phases (full plan review)
- **Date**: 2026-06-29
- **Verdict**: APPROVED (2 minor warnings; both triaged & fixed in code)
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Automated re-verification (all green): `pnpm check` 0 errors · `pnpm lint` clean · `pnpm steiger` clean · `pnpm test` 799 passed (93 files, after fixes) · `pnpm build` clean (workerd) · Phase 4.6 grep — only `useReconcileExecutor` imported. Plan drift: 17/17 planned changes MATCH; the safety-critical Phase 3.3 clear-before-`groupFailure` ordering is correct in all 3 batch paths.

## Findings

### F1 — Executor success path never clears the error banner

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/_pages/plan-detail/model/history/use-reconcile-executor.ts:109-113
- **Detail**: Phase 3.3's contract said to clear the error on "the executor's success path once split in Phase 4". Phase 3 (288bf71) added `setError(null)` to all 9 `persist*` success paths but NOT to the then-inline `applyReconcile` (verified: 288bf71's `applyReconcile` returned `{ ok: true }` with no clear). Phase 4 lifted that gap into the executor verbatim. Net effect: a forward edit fails (banner shows) → a successful undo/redo settles → the stale banner stays up. The safety reviewer judged not-clearing "arguably correct"; the plan author's explicit intent was to clear.
- **Fix A ⭐ Recommended**: Add `setError(null)` before `return { ok: true }`.
  - Strength: Honors the explicit plan contract; matches the 9 forward paths — a successful settle dismisses a stale banner.
  - Tradeoff: One added line; undo/redo now also clears the forward-write banner (intended).
  - Confidence: HIGH — identical one-line pattern proven in all 9 persist* paths; no ordering subtlety (executor has no groupFailure branch).
  - Blind spot: None significant.
- **Fix B**: Amend plan.md to record the executor intentionally does NOT clear.
  - Strength: Keeps undo/redo banner-handling separate if that's the desired semantics.
  - Tradeoff: Leaves forward/undo inconsistent; contradicts the plan's stated decision.
  - Confidence: MED.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `setError(null)` added at use-reconcile-executor.ts:113 (`// a fully-successful reconcile dismisses any stale banner, like the forward persist* paths`). Verified: `use-placements-history.test.tsx` green, full suite 799 passed.

### F2 — eslint-plugin-react-compiler left at RC; transform on stable 1.0.0

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: package.json:71 (`eslint-plugin-react-compiler` ^19.1.0-rc.2) / package.json:64 (`babel-plugin-react-compiler` 1.0.0, exact)
- **Detail**: Phase 5.1 asked to bump the linter to a stable line, gated on a stable target existing. Verified outcome: no stable standalone plugin release exists and react-hooks@7 has no single react-compiler rule, so the RC linter stays (documented in c184229). The hard requirement is met — `react-compiler/react-compiler` is still `"error"` (eslint.config.js:62,68) and the transform is exact stable 1.0.0 with no `react-compiler-runtime`. Residual is a version-alignment nicety.
- **Fix**: Track eslint-plugin-react-hooks' stable react-compiler rule and migrate when it ships; no action now.
- **Decision**: SKIPPED (acknowledged — documented, justified deviation; enforcement intact).

### F3 — New files (rpcs.ts, use-reconcile-executor.ts) lack co-located tests

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/api/rpcs.ts, src/_pages/plan-detail/model/history/use-reconcile-executor.ts
- **Detail**: Every other file in model/history/ has a `*.test.ts` sibling; these two new files have none. Not a plan miss (Testing Strategy didn't call for a makeRpcs test) and coverage is inherited via the mocked client modules + reconcile suites. But the planId/cohort/deleteShelfBundle binding contract — which both review agents had to verify by hand — is exactly what a tiny unit test locks in cheaply.
- **Fix**: Add a focused rpcs binding test (each method forwards bound planId/cohort; updatePlacementWeek pass-through; deleteShelfBundle planId-only).
- **Decision**: FIXED — added `src/_pages/plan-detail/api/rpcs.test.ts` (9 tests covering all 8 bindings + a dp2-cohort case), following the slice's `vi.mock` convention. Lint + check clean; 9/9 pass. (Executor still relies on inherited coverage — judged sufficient.)

### F4 — React Compiler is repo-wide; non-slice islands rely on safe-bailout

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: astro.config.mjs:41-45
- **Detail**: The babel plugin transforms every React island, not just the render-pure plan-detail slice the comments describe — which the plan explicitly intended ("app-wide"). Other islands rely on the compiler's safe-bailout rather than being verified render-pure. Manual criterion 5.9 (course/teacher/student RHF dialogs + sign-in smoke) covers the highest-risk islands and is checked off; React 19.2.7 ships the runtime in-package.
- **Fix**: None required — covered by 5.9.
- **Decision**: SKIPPED (acknowledged — blast radius is intended and covered).
