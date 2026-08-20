<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Solver Deploy Lane (S-302)

- **Plan**: context/changes/solver-deploy-lane/plan.md
- **Scope**: Full plan — Phases 1–7 of 7
- **Date**: 2026-08-18
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING (stale post-Phase-7 prose; no missing items) |
| Scope Discipline | PASS (extras recorded in change.md) |
| Safety & Quality | WARNING (6 findings, none critical) |
| Architecture | PASS |
| Pattern Consistency | WARNING (minor) |
| Success Criteria | PASS (all automated criteria re-run green on 2026-08-18; 1.4 smoke not re-run) |

Re-verified locally: solver ruff/mypy/pytest (109 pass); `pnpm check` 0/0; lint; steiger; vitest 1608 pass; build → `entry.mjs` exports `SolverContainer`, `dist/server/wrangler.json` carries containers/DO/migration/`enable_containers: false`; `wrangler deploy --dry-run --containers-rollout=none` lists `env.SOLVER`; `ib-solver:local` = amd64 / 394 MB; no `paths` in ci.yml; prettier clean; `containers#162` / `path-filtered` appear only in re-grounded form; `deployments list` shows `ac77c484`.

## Findings

### F1 — Unconfigured container still answers 202 and wedges the job

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: services/solver/src/cpsat_service/app.py:80 (`solve`), :148 (`_verify_credential` skips when unconfigured)
- **Detail**: The lifespan check skips itself when the trio is unset (so `/health` answers bare), but `solve` still returns 202; the worker thread fails at claim, `_claim` swallows it, the row sits `queued` with an orphan clone. Documented but not closed; one missing `wrangler secret put SOLVER_MACHINE_PASSWORD` away in production. The dispatch caller already compensates on any non-202.
- **Fix A ⭐ Recommended**: Gate `solve` with 503 when `not settings.configured`; `/health` untouched; add a test.
  - Strength: Two lines + one test; bare-container promise kept (only `/health` must answer bare); silent wedge → `failed` row on every path.
  - Tradeoff: Slightly widens the plan's "unconfigured = tolerated" boot contract.
  - Confidence: HIGH — dispatch already treats non-202 as failure.
  - Blind spot: claim failures for other reasons (hook disabled mid-life) remain silent.
- **Fix B**: Worker-side — `getSolverTransport()` returns null / binding transport refuses when `env.SOLVER_MACHINE_PASSWORD` is empty.
  - Strength: The direction change.md named; no solver change.
  - Tradeoff: Only protects the binding path; selector gains secret-awareness; hides Generate rather than reporting.
  - Confidence: MEDIUM.
  - Blind spot: tier 3 / other hosts unguarded.
- **Decision**: FIXED via Fix A — `solve` refuses with 503 when unconfigured (+ test; `client` fixture now patches configured `Settings`; README/mise/runbook prose truthed-up)

### F2 — `solver:hosted` can pass its health wait against a stale local solver

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (data safety — hosted rows)
- **Location**: mise.toml:372-383
- **Detail**: `until curl -sf :8000/health` cannot tell which process answered. If a tier-1 `solver:dev` (LOCAL stack) holds :8000, the hosted uvicorn fails to bind, the loop passes, and every Generate inserts a HOSTED row + clone dispatched to the local solver → production rows wedge at `queued`. `solver:image:smoke` guards its loop with a liveness check; this task doesn't.
- **Fix**: Refuse to start if :8000 is bound (`lsof -nP -iTCP:8000 -sTCP:LISTEN`) and bail in the loop when `kill -0 "$SOLVER_PID"` fails.
  - Strength: Mirrors the smoke task; closes the only path where the campaign writes to prod with the wrong solver.
  - Tradeoff: None material.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED — `solver:hosted` refuses when :8000 is already bound (lsof) and bails from the /health wait when the solver PID dies

### F3 — Profile is shell-sourced; password written unquoted to `.dev.vars`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (security/reliability)
- **Location**: mise.toml:355 (`. "$profile"`), mise.toml:271 (`echo "SOLVER_MACHINE_PASSWORD=$…" >> .dev.vars.tier3`), README § Environment Profiles template
- **Detail**: `.envs/prod-solver.vars` is executed as shell and the README template writes bare values; a strong password containing `$ ; & # space` or backticks is mangled or executed. dotenv (`.dev.vars`) has different quoting (` #` starts a comment); tier 3 writes the password unquoted too. Failure is loud, but the sourcing is a self-inflicted injection surface.
- **Fix**: Single-quote values in the README template; write `SOLVER_MACHINE_PASSWORD='…'` in tier3 (escape `'` → `'\''`); parse keys with `sed -n 's/^KEY=//p'` in `solver:hosted` (as the smoke task does) instead of `.`-sourcing.
  - Strength: Removes shell-eval of a secret file; one parsing idiom across tasks.
  - Tradeoff: Existing per-machine `.envs` files need re-quoting once.
  - Confidence: HIGH.
  - Blind spot: dotenv's handling of `'\''` — verify with a probe password.
- **Decision**: FIXED — `solver:hosted` reads the profile with `sed` (no shell-eval); tier3 writes the password single-quoted and refuses `'`/newline; README states the bare-literal rule

### F4 — Only `portReadyTimeoutMS` raised; instance-get phase stays at 8 s

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/entities/timetable/api/solver-binding-transport.ts:101-104
- **Detail**: `@cloudflare/containers@0.3.7` caps the get-instance phase at `TIMEOUT_TO_GET_CONTAINER_MS = 8_000` (container.js:25, :609) unless `instanceGetTimeoutMS` is passed; a cold placement after sleep/rollout can exceed 8 s → first solve after idle fails as `SolverContainerStartError` regardless of the 45 s budget (measured cold start 5.5 s — inside, thin margin).
- **Fix**: Pass `cancellationOptions: { instanceGetTimeoutMS: CONTAINER_START_TIMEOUT_MS, portReadyTimeoutMS: CONTAINER_START_TIMEOUT_MS }`; update the shape test.
- **Decision**: FIXED — both `instanceGetTimeoutMS` and `portReadyTimeoutMS` set to 45 s; test updated; comment now cites the 5.5 s measurement

### F5 — Post-Phase-7 prose left stale

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: .github/workflows/ci.yml:255-261; src/entities/timetable/api/solver-binding-transport.ts:30-32
- **Detail**: Plan 4.1 asked the deploy-job comment to carry the measured build cost after the first run — it still says "Measure the added wall-clock before optimising" while change.md records +37 s. The 45 s constant's comment still says "starting estimate … correct from Phase 7", though change.md records 5.5 s and calls it discharged.
- **Fix**: Write "+37 s measured 2026-08-18; caching not warranted" into the ci.yml comment and "measured 5.5 s cold start, 8× margin" into the transport comment.
- **Decision**: FIXED — ci.yml deploy comment carries the +37 s measurement and the no-caching decision; transport comment updated under F4

### F6 — `.dev.vars.tier3` is not gitignored

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (security)
- **Location**: .gitignore:59; mise.toml:264-272
- **Detail**: `.gitignore` matches `.dev.vars` exactly; the temp file holds the machine password between the `echo` and the `mv`, and a kill in that window leaves an untracked secret file `git add -A` would stage.
- **Fix**: Change the ignore line to `.dev.vars*` (or write the temp file under `.wrangler/tmp/`).
- **Decision**: FIXED — `.gitignore` now `.dev.vars*`

### F7 — `withTimeout` leaks a timer per call

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/entities/timetable/api/solver-binding-transport.ts:116-124
- **Detail**: The 15 s / 3 s timer is never cleared on success; it later rejects an already-settled race (no unhandled rejection, but a live timer per dispatch inside the DO's I/O context).
- **Fix**: Keep the handle and `clearTimeout` in a `finally` on the raced promise.
- **Decision**: FIXED — timer cleared in `finally` on the raced promise

### F8 — `.dockerignore` re-includes all of `services/`

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency / Plan Adherence
- **Location**: .dockerignore:16-17, 23-29
- **Detail**: Plan said `!services/solver/**`; the file uses `!services` and only carves out `.venv`, `data`, caches — a local `services/solver/node_modules`, `.astro`, `tests/` land in the context, and any future `services/<other>` ships silently. Verified it does exclude `.envs/`, `.env*`, `.dev.vars`, `.venv`.
- **Fix**: Narrow to `!services/solver` and add `services/solver/node_modules`, `.astro`, `tests` to the re-exclusions.
- **Decision**: FIXED — `!services/solver` + node_modules/.astro/tests excluded; context verified by listing; image rebuilds (amd64, 393 MB)

### F9 — `onStop` parameter retyped inline

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/solver-container.ts:47
- **Detail**: `{ exitCode: number; reason: string }` forks the package's exported `StopParams` (`reason: 'exit' | 'runtime_signal'`).
- **Fix**: `import type { StopParams } from "@cloudflare/containers"`.
- **Decision**: FIXED — `onStop` typed with the package's `StopParams`

## Triage summary (2026-08-18)

| Outcome | Findings |
|---------|----------|
| Fixed | F1 (Fix A), F2, F3, F4, F5, F6, F7, F8, F9 (9) |
| Skipped / Accepted / Rule | — |

Post-fix gate: `pnpm check` 0/0 · lint · steiger · vitest 1608 · build · prettier · solver ruff/mypy/pytest 110 — all green; `ib-solver:local` rebuilt (amd64, 393 MB) from the narrowed context. Changes are uncommitted on `main` at time of writing.
