<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Frozen Wire Contract + `generation_jobs` Schema + Solver Credential (F-301)

- **Plan**: context/changes/solver-contract-and-jobs-schema/plan.md
- **Mode**: Deep
- **Date**: 2026-08-10
- **Verdict**: REVISE → SOUND after triage (all findings fixed)
- **Findings**: 1 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → fixed |
| Plan Completeness | FAIL → fixed |

## Grounding

14/14 paths ✓, 12/12 symbols ✓, brief↔plan ✓. Verified: vitest globs exclude `contracts/**` and include `bench/**/*.test.ts`; lefthook prettier-rewrite risk real; `.prettierignore` lists stale pre-FSD types path; Pin is 4 fields; bypass producer at `load-plan-analysis.ts:109-118` real and unifiable via `assembleGeneratorSnapshot` with empty placements; `deploy.needs` currently `[verify, integration, e2e]`, no path filters, no Python job; hook block commented at `config.toml:269-272`; `tsconfig` `include: ["**/*"]` covers `contracts/`; moddatetime extension exists (schema `extensions`), abandoned exactly at 2026-06-13 migration; seed fixture snapshot is all-integers; greedy blast radius (`stagnation`, `engine: "greedy"`) consistent with keeping TS types wider; both stale-doc citations accurate; `ajv` not yet a dependency (plan adds it).

## Findings

### F1 — Progress heading doesn't match Phase 4's body heading

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: ## Progress → ### Phase 4
- **Detail**: Body said "## Phase 4: Solver Credential (`solver_job_writer`)" while Progress said "### Phase 4: Solver Credential". /10x-implement matches headings exactly. All 17 Progress rows otherwise map 1:1 to success-criteria bullets.
- **Fix**: Dropped the parenthetical from the body heading.
- **Decision**: FIXED

### F2 — Canonical-form spec has no number-serialization rule, but the contract contains a float

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Implementation Approach §Canonical JSON form; Phase 1 #2
- **Detail**: The plan-brief listed float rules as an open risk with no backing phase task. All snapshot-side wire numbers are integers (verified — zero float literals in the seed fixture), but `StageReport.wall_clock_s` is a float (solve.py:42-49) and StageReport is in-contract. Python `json.dumps(2.0)` → `"2.0"` vs JS `"2"` breaks cross-language byte-parity. Nothing in F-301 byte-compares a StageReport, but S-303 (persists stages) would inherit the hole silently.
- **Fix**: Added a normative Numbers rule to the canonical-form spec and Phase 1 #2's README contract: byte-compared/hashed payloads are integer-only; `wallClockS` is the sole in-contract non-integer, schema-validated with no cross-language byte guarantee; any new float in a byte-compared payload bumps `formatVersion`.
- **Decision**: FIXED

### F3 — Golden-regeneration script has no declared runner

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 #4
- **Detail**: bench/ scripts run only via the vitest experiment convention (`*.experiment.ts`, env-var args, `it.runIf`); a bare `.ts` file has no runner (no tsx dep).
- **Fix**: Renamed to `bench/generate-contract-goldens.experiment.ts` with the experiment-pattern note.
- **Decision**: FIXED

### F4 — Phase 4 policy contract doesn't spell `to solver_job_writer`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 #1 (policies)
- **Detail**: Policy specs omitted the role clause; a role-less policy scopes to PUBLIC. No practical widening (authenticated already has the for-all-true house policy), but the role binding shouldn't be inferred on a security-critical migration.
- **Fix**: Both policy specs now state `to solver_job_writer` explicitly.
- **Decision**: FIXED

### F5 — README's deploy-plan link is stale

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 #1
- **Detail**: README links `context/changes/deployment/deploy-plan.md`; the file lives at `context/deployment/deploy-plan.md` (the plan's References cite the correct path).
- **Fix**: Added the link correction to Phase 5 #1's contract.
- **Decision**: FIXED
