<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Solve-policy choice (S-307)

- **Plan**: context/changes/solve-policy-choice/plan.md
- **Scope**: Full plan (Phases 1–5 of 5)
- **Date**: 2026-09-02
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 3 observations
- **Triage**: 2026-09-02 — F1–F5 all FIXED in the working tree (uncommitted)

Verified in-session: `pnpm check` 0 errors; `pnpm lint`, `pnpm steiger` clean; `pnpm test` 1833/1833; `pnpm build` clean; `mise run solver:test` 214/214; `mise run solver:check` clean; `git diff --stat main...HEAD -- contracts/fixtures` = only `solve-request.json`; `grep -rn "nowhere to carry\|zero-config" services src` empty; `generation-enqueue.integration.test.ts` 7/7. Not re-run (no solver on :8000): 2.4, 3.2, 4.2 — evidenced by their Progress shas only.

All 24 "Changes Required" items MATCH; "What We're NOT Doing" respected (no dominance code, no migration/grant change, `solve_repair`/`parity`/`evaluate_board`/`build_objective`/objective goldens untouched, no numbers in copy, policy shown only on the proposal strip, no service echo onto the row).

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Stop sentence and `checkpoint_stage_index` can disagree

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (correctness)
- **Location**: services/solver/src/cpsat_service/runner.py:404
- **Detail**: Plan Phase 2 §3 requires the stop sentence and `checkpoint_stage_index` to "tell the same story", and the new docstring claims the number is "the same count that column carries". `_run_ladder` appends a `StageReport` even for an UNKNOWN stage (solve.py:620-631) while `_progress_payload` writes `checkpoint_stage_index` only when a checkpoint exists (runner.py:365-367). A cancel landing mid-stage with no incumbent says "stopped after stage N" on a row whose checkpoint is N-1. Pre-existing under the tier version; no test covers the path.
- **Fix**: Derive `where` from the last stage with `best is not None` (position = index + 1 in `result.stages`); add a unit test of `_stop_error` on a transcript whose last stage is UNKNOWN.
- **Decision**: FIXED — `_stop_error` now names the stage the stop landed in and, when it differs, the stage whose checkpoint was kept (kept = last stage with a solution); the lone-UNKNOWN pin at test_service.py:878 kept its "stage 1 (completeness)" wording; 4-case parametrised unit test added.

### F2 — Roadmap issue-table row still says "trade-off dial"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence (partial DRIFT, Phase 5 §2)
- **Location**: context/foundation/roadmap.md:290
- **Detail**: Phase 5 §2 reworded the slice table (line 40 → "student-first order") but the S-307 row in the issue-tracking table kept "canonical order + trade-off dial".
- **Fix**: Reword roadmap.md:290 to match line 40.
- **Decision**: FIXED — row now reads "canonical order + student-first order".

### F3 — `checkpoint_stage_index` still documented as a tier

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency (lessons: a doc that names a mechanism is coupled to it)
- **Location**: src/entities/timetable/model/generation/job-delivery.ts:42
- **Detail**: "The tier whose checkpoint a halted job kept." Every sibling surface was re-worded to "ladder position"; this one was missed.
- **Fix**: "The ladder position whose checkpoint a halted job kept."
- **Decision**: FIXED

### F4 — Post-close-out copy commit not recorded in the plan

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/_pages/plan-detail/ui/chrome/GenerateButton.tsx:172-179
- **Detail**: bd047a4 rewrote the three consequence sentences after 0ce6e10 marked the change implemented. Copy honours the discipline (test-enforced), so no drift, but Progress is one commit behind on a tested contract. 3.4 is attributed to 059af53 (the dialog commit), so the "still one-click button" check was done through the dialog's default. `plan-indicators.ts` doc-only change is an unlisted but justified extra.
- **Fix**: Add a one-line epilogue note under Progress (or change.md) naming bd047a4 and clarifying 3.4.
- **Decision**: FIXED — epilogue appended to plan.md Progress.

### F5 — `DEFAULT_SOLVE_POLICY` is a shared mutable reference

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency (reliability)
- **Location**: src/entities/timetable/model/generation/policy.ts:28
- **Detail**: Zod `.default()` returns the same object and `parseStoredPolicy` returns it for every legacy row; one mutating caller would poison the process-wide default. No such caller exists today.
- **Fix**: `{ preset: "clean" } as const satisfies SolvePolicy`.
- **Decision**: FIXED
