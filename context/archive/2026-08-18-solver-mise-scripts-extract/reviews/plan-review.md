<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Extract the solver mise task bodies into shellcheck-gated scripts

- **Plan**: context/changes/solver-mise-scripts-extract/plan.md
- **Mode**: Deep
- **Date**: 2026-08-18
- **Verdict**: SOUND (all findings fixed in plan during triage)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS (1 observation, fixed) |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → PASS after F2 |
| Plan Completeness | WARNING → PASS after F1/F3 |

## Grounding

7/7 paths ✓ (`mise.toml`, `.github/workflows/ci.yml`, `README.md`, `context/foundation/lessons.md`, `CLAUDE.md`, `scripts/provision-solver-user.mjs`, `scripts/lib/catalog-transcode.mjs`; `scripts/solver/` absent as expected), 9/9 cited lines/symbols ✓ (`mise.toml:32-59/86-99/106-204/213-293/300-424`, `ci.yml:24/61-66/84-102/191-199`, `README.md:125/184/332`, `lessons.md:68-73/82-87` incl. "mise task, CI step"), brief↔plan ✓, Progress↔Phase ✓ (4/4 headings, 24/24 criteria, single `## Progress`).

Empirical check: shellcheck 0.11.0 (`mise x shellcheck@0.11.0`) run on a scratchpad prototype of the planned `common.sh` / `image-smoke.sh` / `lint.sh` shape — sourcing via `. scripts/solver/common.sh` is followed by the plain glob without `-x` (no SC1091/SC2154); a function passed by name to `wait_for_health` does not trip SC2329; `-o check-set-e-suppressed` accepted; the `WAITED_S` out-parameter trips SC2034 (F1).

## Findings

### F1 — `WAITED_S` out-parameter trips SC2034; Phase 1 gate is red on day one

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §2 (common.sh contract) / criterion 1.4
- **Detail**: shellcheck 0.11.0 checking `common.sh` as its own input reports `SC2034 (warning): WAITED_S appears unused` and exits 1 (verified on a prototype, with and without `-x`), so criteria 1.2/1.4 fail before any script is extracted.
- **Fix**: Phase 1 §2 now specifies `# shellcheck disable=SC2034  # out-parameter, read by callers after wait_for_health returns` on the assignment, with the inline-reason policy mirroring `# type: ignore`.
- **Decision**: FIXED

### F2 — README:165 `solver:check` comment goes stale in Phase 1, unfixed in Phase 4

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 §1 (README) — blast radius of Phase 1 §4
- **Detail**: Phase 1 §4 extends `solver:check` to run `lint.sh`, but `README.md:165` still reads "ruff + mypy --strict, the same two gates CI runs"; Phase 4 listed only lines 125/184/332 — the mechanism-citation drift `lessons.md:68-73` warns about.
- **Fix**: Phase 4 §1 gains (e) rewording `README.md:165`; criterion 4.2 / Progress 4.2 gain `grep -n "the same two gates CI runs" README.md` returning nothing.
- **Decision**: FIXED

### F3 — Criterion 3.4 asks `git status` to show a gitignored file

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 criterion 3.4 (+ Progress 3.4)
- **Detail**: `.gitignore:59` ignores `.dev.vars*`, so `git status` cannot show whether the trap restored it — the check could never fail.
- **Fix**: 3.4 now probes with `grep -q '^SOLVER_URL=' .dev.vars && grep -q 127.0.0.1 .env.local`.
- **Decision**: FIXED

### F4 — `die` in common.sh has no named consumer

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 1 §2
- **Detail**: Every moved guard stays verbatim `echo … >&2; exit 1`, so nothing outside `common.sh` calls `die`; the plan presented it as a signature other phases depend on.
- **Fix**: Phase 1 §2 now states `die` is `wait_for_health`'s internal exit path, that no caller uses it, and not to retrofit the guards onto it.
- **Decision**: FIXED
