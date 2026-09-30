# Automate the Production Calibration Campaign — Implementation Plan

## Overview

`production-calibration-campaign` (S-308) shipped its two code phases. What remains is operational: lifecycle drills, twelve ledgered production runs, then shipping and cleanup. Done by hand, every run needs about eight human touches and attention through 15–35 minutes of waiting.

This plan builds the tooling that lets that campaign run unattended from a laptop, across two office days, with a human needed only for one-time setup, the attended drill, and the Cell D choice. It delivers three small code levers, analyzer extensions, a resumable runner, and dated amendments to S-308's plan where research showed its protocol cannot work.

**This plan does not run the campaign.** The runs, the ledger, the verdict and the shipped constants stay in S-308's plan and are ticked in S-308's Progress.

## Current State Analysis

From `research.md` (2026-09-29, written at `e1714f7`, still HEAD) and direct verification:

- **The row does not say what solved it.** `generation_jobs` records stages, checkpoints, heartbeats and clocks, but neither the budgets nor the worker count. `runner.py` builds `config = _with_budgets(base, settings)` immediately before `solve_complete`, and `clean_fallback` is computed in `solve.py` and dropped into internal `notes`.
- **The cell constants are literals.** `src/solver-container-env.ts` pins `CONTAINER_WORKERS`, `CONTAINER_STAGE_BUDGET_S` and `CONTAINER_MODE_A_BUDGET_S`. `SolverContainerEnv` is a four-key type. Changing a cell today means a merge to `main`.
- **`SolverContainer` has no operator surface.** `countActiveJobs()` is private and collapses every unreadable answer to 0. `stop()` and `getState()` are public on the base class in `@cloudflare/containers` 0.3.7.
- **The analyzer is a thin loader over pure formatters.** `bench/generation-jobs-report.ts` keeps `groupByTier`, `median` and `renderTable` module-private. `vitest.analyze.config.ts` has a 120 s test timeout.
- **`checkPlan` already returns what a runner needs.** `GenerationJobView` carries `jobId`, `status`, `stageIndex`, `checkpointStageIndex`, `proposalPlanId` and `delivered`.
- **`hosted.sh` is a complete launcher template:** fail-closed preflight, banner with typed confirmation, split `EXIT` / `INT` / `TERM` traps, `sed`-read profile values, `caffeinate -i`.

### Premises of S-308's plan that research disproved

| # | S-308 assumed | What is true |
|---|---|---|
| 1 | Each cell is a harmless Worker-only merge | Every CI deploy rolls the container, because the image build is not byte-reproducible on fresh runners |
| 2 | Merged means deployed | 5 of the last 8 pushes to `main` failed before the `deploy` job |
| 3 | The drill interrupts a 120 s solve | The ~16 min ladder ends before CI (~9.5 min) plus the 1200 s grace window lets the rollout land |
| 4 | Deleting the campaign plan cleans up | It cascades the job rows, which are the ledger's raw data, and leaves the proposals behind |
| 5 | The startup line is confirmed before dispatch | The cold start happens on dispatch, so it can only be confirmed after |
| 6 | The hosted service-role key goes in `.env.test.local` | That file feeds `pnpm test:integration`, whose factories write and have no local-host guard |

## Desired End State

- Every job row written by the deployed solver carries `solver_config`: the effective workers, budgets, targets, preset and seed, whether each budget was configured or fell through to the engine default, whether the clean fallback fired, and a host fingerprint.
- A cell switch is one `wrangler secret bulk` call that takes seconds, does not roll the container, and does not depend on CI.
- An allowlisted operator can ask the deployed Worker whether the container is running and stop it when idle.
- `pnpm analyze:jobs` emits a machine-readable ledger, a cross-cell matrix and an S-309 baseline block, all as ids and numbers only.
- `mise run solver:campaign` drives setup, the cell grid, the drill, the renewal observation and cleanup. It survives a closed laptop, resumes from its journal, and parks the production override when stopped.
- The whole runner has been rehearsed against the local stack, including a forced stop and resume, before it touches production.
- S-308's plan carries dated amendments that replace the six disproved premises.

**Verification:** `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` clean; `mise run solver:check` and `mise run solver:test` green; `pnpm test:integration` green for the credential and transport suites; the local rehearsal transcript recorded in `change.md`.

### Key Discoveries:

- `wrangler secret bulk` accepts a JSON file in which a `null` value deletes a key (wrangler 4.130 `--help`). Applying a cell and parking are therefore each one atomic request.
- Cloudflare documents that a secret change "creates a new version of the Worker and deploys it immediately". Whether that disturbs a *running* container is not documented.
- `status()` can only report what the Durable Object would pass at the **next** start. `envVars` is read at a real start and never re-read by a warm container (`@cloudflare/containers` `container.js:1327`).
- Node 24 runs TypeScript natively with relative `.ts` imports, and `astro/tsconfigs/base.json` already sets `allowImportingTsExtensions`. `@/` aliases and `astro:*` virtual modules do not resolve outside vitest.
- `devalue` is a transitive dependency only and is not resolvable from the repo root under pnpm's strict layout.
- ESLint ignores `scripts/` entirely, and only `scripts/solver/*.sh` is shellcheck-gated. `bench/` is linted and type-checked.
- `tier3.sh` rebuilds `.dev.vars` from a fixed key list, so a new Worker secret reaches local workerd only if that script forwards it (`lessons.md`: "A Worker forwards only what `.dev.vars` holds").
- `client.progress()` never raises and filters on `status=eq.running` (`supabase.py`). It is the only write that can fail without wedging a row or losing a board.

## What We're NOT Doing

- **Not running the campaign.** No production run, ledger row, verdict or shipped constant is produced here.
- **Not changing `sleepAfter`, the UI ceiling, `rollout_active_grace_period` or the PRD/roadmap prose.** Those are S-308 Phases 3 and 5.
- **Not choosing Cell D by rule.** The runner pauses and prints the matrix; the choice stays a judgement.
- **Not changing the wire contract.** `solver_config` is a row column outside `contracts/`; `formatVersion`, the schema and the goldens are untouched.
- **Not writing to the hosted database with the service-role key.** Hosted writes go through the app's own actions; the service-role key is used for reads only.
- **Not widening the unauthenticated allowlist** in `src/middleware.ts`.
- **Not running the runner in CI or on a cloud schedule.** Hosted credentials stay on the developer's machine.
- **Not driving production through Playwright.** `playwright.config.ts` hard-codes localhost and always builds and previews.
- **Not adding a CI integration test for the runner.** The integration lane already fails about 1 run in 5.
- **Not persisting a session to disk.** The runner signs in on every start.
- **Not adding path filters or Docker layer caching to CI.**

## Implementation Approach

The row becomes the campaign's record first, because everything else leans on it: once a row says which configuration solved it, a run on a stale container is detected rather than misfiled, and per-run log reading disappears. The Worker's control surface comes next, since both code levers end in a deploy that rolls the container and both should land while it is idle.

The analyzer and the runner are local-only work. Pure logic lives in `bench/` under unit tests. The runner is one Node TypeScript program with no `@/` imports; anything that needs the entity's readers stays in the analyzer, which the runner invokes as a subprocess. The runner talks to a `CellController` interface with a production implementation and a local one, so the same state machine is rehearsed locally and then run against production unchanged.

Lifecycle commands come last among the code phases because they depend on two facts only the live account can supply: the telemetry filter keys, and whether a secret change disturbs a running solve.

## Critical Implementation Details

**Timing & lifecycle.** Three clocks govern the container and none of them is the solve. Env is fixed at cold start. The sleep clock runs from the last request and is re-armed whenever the Durable Object is constructed. The rollout grace window runs from connection start. Consequences for the runner:

- It must never call the control route or attach `wrangler tail` while measuring the idle-sleep boundary. Either may construct the Durable Object and push the stop out by a full `sleepAfter`.
- It must read the active-job state immediately before every action that deploys: a secret change, the drill's local deploy, a park.

**State sequencing.** The `solver_config` write must sit after `_with_budgets` and before `solve_complete`, as a best-effort `progress` call. It must not go into the claim, where a rejected column is swallowed and the row wedges at `queued`. It must not go into `finish`, where a rejected column is terminal and the board is lost.

**Intent versus fact.** `status()` reports the tuning the next cold start would receive. `solver_config` reports what actually solved. The runner uses the first to decide when to dispatch and the second to decide whether a run counts. A mismatch between them is the stale-container case and excludes the run.

**Journal ordering.** The runner writes its intent before each action and the outcome after. A closed laptop between "dispatch sent" and "job id recorded" is recovered by calling `checkPlan` on the campaign plan, which returns the active job's id; at most one active job exists per source plan.

**Cleanup ordering.** Extract the ledger and copy it into S-308's change folder, deliver every proposal, delete proposals by id, delete the source plan, then remove the overrides. Deleting the source first destroys the rows the ledger is read from, and after that the committed copy is the only complete record.

## Phase 1: Self-describing job rows

### Overview

Add a nullable `solver_config` column and have the solver record, best-effort, the configuration it actually solved under. This is an image-changing deploy and must land while the container is idle.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_generation_jobs_solver_config.sql` (new)

**Intent**: Give the row a place to record its own configuration, and let the solver's narrow role write it without widening what that role can read.

**Contract**: `generation_jobs.solver_config jsonb`, nullable, no default. `grant update (solver_config)` to `solver_job_writer`; no `select` grant for that role. The header carries a dated amendment to the claim in `20260810200122_generation_jobs.sql:5-7` that slices ship behaviour and not migrations. Applied migration files are not edited.

#### 2. Generated types

**File**: `src/shared/api/database.types.ts`

**Intent**: Keep the generated types in step with the schema so the analyzer's projection type-checks.

**Contract**: Regenerated from the local stack after the migration applies; never hand-edited. Confirm the Supabase CLI invocation against current docs before running it.

#### 3. Credential pin

**File**: `src/test/solver-credential.integration.test.ts`

**Intent**: The exact-list pin is the write boundary's proof, so the new column has to appear in it deliberately.

**Contract**: The `UPDATE` list grows from 11 to 12 columns, with `solver_config` in alphabetical position. The `SELECT` list is unchanged, and the test's "writable and not readable" assertion gains `solver_config`.

#### 4. The run record

**File**: `services/solver/src/cpsat_service/runner.py`

**Intent**: Record the effective configuration before the solve starts, and whether the clean fallback fired once it ends, so attribution is a fact on the row.

**Contract**: A pure helper builds the record from the built `SolveConfig`, the `Settings` and the `Policy`. Two best-effort `client.progress` writes: one immediately after `_with_budgets`, one after `solve_complete` returns and before any `client.finish`. The second rewrites the whole object with `cleanFallback` added. Neither write may raise, and neither may block the solve.

Record shape, camelCase to match `stages`:

| Key | Meaning |
|---|---|
| `version` | `1`; lets a reader reject a shape it does not know |
| `workers`, `stageBudgetS`, `modeABudgetS`, `seed` | Effective values read from the built `SolveConfig` |
| `budgetSource` | Per budget, `configured` or `engine-default`, from whether `Settings` held a value |
| `targets` | Tier to value, empty when none |
| `preset`, `cleanMode` | From the request's policy |
| `host` | `machine`, `cpuCount` and the ortools version |
| `cleanFallback` | Present only in the second write, and only under `cleanMode` |

`settings.py` must not repeat an engine literal: the effective number comes from the dataclass, the source flag from `Settings`.

> **Addendum (impl-review, 2026-09-30):** the second write happens only when the solve reports a fallback fact (`result.clean_fallback is not None`, i.e. under `cleanMode`). A policy without clean mode gets one write, because the second would be byte-identical. Pinned by `test_a_policy_without_clean_mode_records_once_and_never_names_the_fallback`.

#### 5. Engine surface for the fallback

**File**: `services/solver/src/cpsat_engine/solve.py`

**Intent**: The runner needs to read whether the fallback fired without reaching into an internal dict by string key.

**Contract**: `clean_fallback` stays in `notes` as today; the runner reads it through a small typed accessor. No modelling or objective code changes, so the objective-parity suite must stay at exactly 10/10.

#### 6. Client docstrings

**File**: `services/solver/src/cpsat_service/supabase.py`

**Intent**: The module documents the grant's width in two places and both go stale with this change.

**Contract**: "11-column grant" becomes 12 wherever it appears. Prose only.

#### 7. Service tests

**File**: `services/solver/tests/test_service.py`

**Intent**: Pin the record at the wrapper level, through the HTTP surface, using the existing `FakeSupabase.progress_patches` seam.

**Contract**: The first progress write carries `solver_config` with the effective values; a configured budget reads `configured` and an unset one reads `engine-default`; the last progress write before the terminal write carries `cleanFallback`; a rejected `solver_config` write leaves the solve succeeding. Existing tests that index `progress_patches()` by position are updated to select by payload key instead.

#### 8. Stored-record reader

**File**: `src/entities/timetable/model/generation/stored-solver-config.ts` (new), its test, and the entity barrel

**Intent**: One tolerant reader for the column, beside `parseStoredStages`, so the analyzer never re-declares the shape.

**Contract**: `parseStoredSolverConfig(value: unknown): StoredSolverConfig | null`. Null for a legacy row, an unknown `version`, or a malformed object. Never throws.

#### 9. Transport integration assertion

**File**: `src/test/solver-transport.integration.test.ts`

**Intent**: Only a real database proves that the grant permits the write.

**Contract**: After the job reaches `succeeded`, the row's `solver_config` is non-null and parses.

### Success Criteria:

#### Automated Verification:

- [ ] `pnpm exec supabase db reset` applies every migration cleanly
- [ ] `mise run solver:check` and `mise run solver:test` green, objective parity at exactly 10/10
- [ ] `pnpm test:integration` green for `solver-credential` and `solver-transport` with the solver running
- [ ] `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` clean
- [ ] `mise run solver:image:build` and `mise run solver:image:smoke` pass

#### Manual Verification:

- [ ] A local Generate through the built preview leaves a row whose `solver_config` names the local solver's workers and budgets, with `host.machine` showing the developer's architecture
- [ ] With `SOLVER_STAGE_BUDGET_S` unset, `budgetSource.stage` reads `engine-default`; with it set to `5`, it reads `configured` and `stageBudgetS` is 5
- [ ] Merged to `main` with no job active on production, and the `Deploy` job finished green

**Implementation Note**: Pause after this phase for manual confirmation. The production confirmation of the column happens at the campaign's first run, where the runner halts if the row carries no `solver_config`.

---

## Phase 2: Worker control surface

### Overview

Let a campaign override the three tuning constants through Worker secrets, and give an allowlisted operator a way to read the container's state and stop it when idle. This also ends in a deploy that rolls the container.

### Changes Required:

#### 1. Override in the forwarding rule

**File**: `src/solver-container-env.ts`, `src/solver-container-env.test.ts`

**Intent**: A campaign cell becomes a secret change rather than a merge, while the pinned constants stay the visible production default.

**Contract**: `SolverContainerEnv` gains optional `CALIBRATION_WORKERS`, `CALIBRATION_STAGE_BUDGET_S` and `CALIBRATION_MODE_A_BUDGET_S`. A pure `effectiveTuning(env)` returns the four tuning values plus the list of keys currently overridden; `solverContainerEnvVars` forwards its result. An override applies only when it is a well-formed positive number inside named bounds (workers an integer). An empty string, a malformed value or an out-of-range value falls back to the constant. `CONTAINER_STAGE_TARGETS` is not overridable.

The "nothing beyond the nine documented keys" pin stays at nine: overrides change values, never keys. New tests cover override wins, empty means unset, malformed falls back, out-of-range falls back.

#### 2. Runtime types

**File**: `src/cloudflare-env.d.ts`

**Intent**: Declare the new secrets by hand, since `wrangler types` must never run.

**Contract**: Four optional string keys on `Cloudflare.Env`: the three `CALIBRATION_*` overrides and `SOLVER_OPS_ALLOWED_EMAILS`. `pnpm check` stays at 0 errors.

#### 3. Operator decisions as pure functions

**File**: `src/solver-container-ops.ts` (new), its test; `src/solver-container-active.ts`

**Intent**: Keep the stop decision testable without the Durable Object runtime, and make it stricter than the sleep path's decision.

**Contract**: The existing probe reader treats an unreadable answer as zero, which is right for letting an idle container sleep and wrong for an operator stop. A second reader returns `number | null`, where null means "could not tell". The decision function maps `(running, activeJobs)` to one of `not-running`, `busy`, `unknown`, `stop`.

#### 4. Durable Object methods

**File**: `src/solver-container.ts`

**Intent**: Expose state and an idle-only stop over RPC.

**Contract**: `status()` returns `running`, the SDK state's `status` and `lastChange`, `effectiveTuning`, and the class's `sleepAfter` (so the renewal command can check the deployed value). It must not call `containerFetch`, which would start a stopped container and renew activity. It returns tuning values only, never a credential. `stopIfIdle()` returns the decision's outcome and calls `stop()` only on `stop`. Both log one `[solver-container]` line naming the outcome.

#### 5. Binding access

**File**: `src/entities/timetable/api/solver-container-control.ts` (new)

**Intent**: Resolve the Durable Object stub in the one place allowed to read `cloudflare:workers`.

**Contract**: Returns a control object, or null when no binding is usable. Not exported from the entity barrel, for the reason `solver-config.ts` is not.

#### 6. Operator allowlist

**File**: `src/shared/lib/ops-allowlist/` (new folder: `index.ts` barrel, `ops-allowlist.ts`, test)

**Intent**: Decide who may operate the container, deny-by-default.

**Contract**: A pure predicate over an email and the raw secret value. An unset or empty secret allows nobody. Comparison is case-insensitive on the trimmed address.

> **Addendum (impl-review, 2026-09-30):** shipped at the top level as `src/solver-container-allowlist.ts` (+ test), not in `src/shared/lib/ops-allowlist/`. Its only consumer is the top-level route handler (§7), so it joins the rest of the container wiring rather than opening a `shared/lib` folder with no FSD consumer. The predicate became a three-way `checkOpsAccess(email, allowlist) → "closed" | "denied" | "allowed"`, because the route answers an unset list (404) and an unlisted account (403) differently. Semantics are unchanged: empty allows nobody, and addresses are compared trimmed and case-insensitively. The secret is read by `getSolverOpsAllowlist()` in `src/entities/timetable/api/solver-container-control.ts`, beside the binding access (§5), because that is the module allowed to read `cloudflare:workers`. Trade-off accepted: the top-level `solver-container-*` family is not structure-checked by `steiger`.

#### 7. The route

**File**: `src/pages/api/solver/container.ts` (new), plus the framework-free handler `src/solver-container-route.ts` (new, beside the ops decisions; top-level like the other container wiring, which `steiger` does not inspect) and its test

**Intent**: The runner is a non-Astro consumer, which is what `lessons.md` reserves API routes for. The deny-by-default middleware covers the path without any allowlist change.

**Contract**:

| Request | Answer |
|---|---|
| `GET` | The `status()` result |
| `POST` with JSON `{ "action": "stop-if-idle" }` | The `stopIfIdle()` outcome |
| Secret unset or empty | 404 for every signed-in account, so the route is invisible (unauthenticated requests already get the middleware's 302, since `/api/solver/` is not a public prefix) |
| Signed in but not allowlisted | 403 |
| No container binding | 409 |

The Astro route stays thin; the decision logic lives in the handler, which takes its dependencies as parameters.

#### 8. Tier 3 forwarding

**File**: `scripts/solver/tier3.sh`

**Intent**: Make the control surface rehearsable against a real container in local workerd.

**Contract**: When set in the invoking shell, the three `CALIBRATION_*` keys and `SOLVER_OPS_ALLOWED_EMAILS` are written into `.dev.vars` before the build, with the same quoting rule as the password. The exit trap drops them again.

#### 9. Deploy message

**File**: `.github/workflows/ci.yml`

**Intent**: Map every live Worker version to a commit, given the evidence of an out-of-band deploy.

**Contract**: The deploy command passes `--message` with the commit SHA. No other change to the job, and no path filters.

#### 10. Docs

**File**: `README.md` (§ Deployment secrets table), `src/solver-container-env.ts` docblock

**Intent**: State that the overrides exist, that production may diverge from `main` while one is set, and how to see it.

**Contract**: Prose only.

### Success Criteria:

#### Automated Verification:

- [ ] `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` clean
- [ ] `mise run solver:check` green, including shellcheck on the edited `tier3.sh`
- [ ] The nine-key pin test still lists exactly nine keys

#### Manual Verification:

- [ ] Under `mise run solver:tier3` with `CALIBRATION_STAGE_BUDGET_S=5`, the container's startup line shows `stage_budget_s=5` and the job row's `solver_config` agrees
- [ ] `GET` on the route reports `running: false` before a Generate and `running: true` during one
- [ ] `stop-if-idle` answers `busy` during a solve, and after the solve it stops the container
- [ ] With `SOLVER_OPS_ALLOWED_EMAILS` unset the route answers 404, and a signed-in account outside the list gets 403
- [ ] Merged to `main` with no job active on production, and the `Deploy` job finished green

**Implementation Note**: Pause after this phase for manual confirmation.

---

## Phase 3: Analyzer extensions

### Overview

Turn `pnpm analyze:jobs` into the campaign's extractor of record: a JSON ledger the runner can read, and three tables a human can paste. All output is ids and numbers.

### Changes Required:

#### 1. Shared table helpers

**File**: `bench/generation-jobs-report.ts`

**Intent**: The new formatters need the same grouping, median and alignment logic, and a second copy would drift.

**Contract**: `groupByTier`, `median` and `renderTable` become exported. When a row carries `solver_config.cleanFallback`, the report states that fact and suppresses the `unaccounted` heuristic flag; legacy rows keep the heuristic.

#### 2. Ledger rows

**File**: `bench/campaign-ledger.ts` (new), its test

**Intent**: One row per job, complete enough that the source rows can be deleted afterwards.

**Contract**: A pure mapper from a loaded row to a ledger row, a merge keyed by job id, and a markdown renderer.

| Field group | Contents |
|---|---|
| Identity | job id, proposal plan id, cell key, run number, preset, status |
| Validity | `excluded` and its reason |
| Clocks | created, started, finished, queue-to-claim seconds, end-to-end, stage sum, `unaccounted` |
| Configuration | the parsed `solver_config`, including `cleanFallback` and `host` |
| Stages | per tier: status, best, bound, wall clock, stopped-by |
| Board | the exact delivered 10-tuple, or null |

The cell key is derived from `solver_config`. Legacy rows take it from an explicit job-to-cell mapping supplied in the environment.

#### 3. Cross-cell matrix and baseline

**File**: `bench/campaign-matrix.ts`, `bench/campaign-baseline.ts` (new), their tests

**Intent**: The matrix is what the Cell D choice is read from; the baseline is what S-309's test will assert.

**Contract**: The matrix is tier by cell: min, median and max of `best`, counts of `OPTIMAL` and budget-stopped, median seconds, plus per-cell clock statistics. Excluded runs are left out and counted. The baseline takes one cell and prints dated per-tier min, median and max, the delivered tuples, and the job ids. Neither judges.

#### 4. Analyzer modes

**File**: `bench/generation-jobs.analyze.ts`

**Intent**: Expose the new outputs without turning the analyzer into an orchestrator.

**Contract**: The projection adds `solver_config`, `error` and `proposal_plan_id`. New environment switches:

| Switch | Effect |
|---|---|
| Ledger output path | Writes the merged ledger as JSON and prints the markdown rows |
| Active guard | Reads `queued` and `running` rows across all plans and classifies each with `isStaleActiveJob` |
| Delivered tuple | Reads `snapshot` and `result` for succeeded jobs and scores them with `scoreCandidate` |
| Job id prefix | Resolves a prefix to a full id from an id-only read, for pending check 2.4 |
| Remaining hours | For one plan id, prints the count of unplaced hours and nothing else |

Every mode is a `select`. Hosted access still requires `ANALYZE_ALLOW_REMOTE=1`. Remaining hours are computed the way `bench/experiment-harness.ts` already assembles a snapshot from rows: `loadPlanAnalysis` from `@/_pages/plan-comparison/api` (the one `_pages` import the bench boundary allows), then the entity's `assembleGeneratorSnapshot` and `deriveCompleteness`. Generate's own loader (`assembleSource` in `_pages/plan-detail/api/generation-job.ts`) is not importable from `bench/`, so the two paths share the entity primitive rather than the loader.

### Success Criteria:

#### Automated Verification:

- [ ] `pnpm test` green, including the ledger, matrix and baseline tests
- [ ] `pnpm check`, `pnpm lint`, `pnpm steiger` clean

#### Manual Verification:

- [ ] Against the local stack, the ledger mode writes a JSON file whose row for a fresh job carries a cell key and a 10-tuple
- [ ] Running the ledger mode twice on the same job produces one row, not two
- [ ] The active guard reports a live local job as blocking and reports nothing once it is terminal
- [ ] No output line contains a course, student or teacher name

---

## Phase 4: Campaign runner

### Overview

A resumable Node program that drives the campaign through the app's own actions, launched by a mise task, and rehearsable against the local stack.

**Runtime rule for `bench/campaign/`.** The runner executes under Node 24's native type stripping, while its unit tests execute under vitest with the `@/` alias resolved, so a runtime error in the runner is invisible to `pnpm test`. Every file under `bench/campaign/` therefore uses `import type` for every type (a value import of a type from `bench/campaign-ledger.ts` would load `@/entities` at runtime and fail), erasable syntax only (no `enum`, `namespace` or parameter properties), and `.ts` extensions on relative imports. Criterion 4.7 runs `status` through bare `node`, which is the check that catches a slip.

### Changes Required:

#### 1. Dependency

**File**: `package.json`, `pnpm-lock.yaml`

**Intent**: Action responses are encoded with `devalue`, which is not resolvable today.

**Contract**: `devalue` as a direct devDependency, version-aligned with the copy Astro bundles.

#### 2. Campaign definition and next-step logic

**File**: `bench/campaign/definition.ts`, `bench/campaign/next-step.ts` (new), their tests

**Intent**: Keep every decision the runner makes pure, so it is unit-tested and identical in rehearsal and production.

**Contract**: Cells A (120 s), B (60 s), C (240 s) at 4 workers, three valid runs each; Mode A stays at 300 s. Cell D is supplied by the human after the pause through the `set-cell` command (§6), which the journal records as its own entry. `nextStep` maps the journal's derived state to exactly one step or to a named pause, and its tests cover the pause, the `set-cell` entry that lifts it, and the first Cell D dispatch that follows.

Failure policy, from the planning decision:

| Outcome of a run | Action |
|---|---|
| `succeeded`, delivered, `solver_config` matches the cell | Counts as valid |
| `failed`, unexpectedly `interrupted`, wrong cell, missing `solver_config`, or a host the controller's `expectedHost` predicate rejects | Recorded as excluded with its reason, then repeated once |
| A second bad outcome for the same run slot | Halt, state saved |

#### 3. Journal

**File**: `bench/campaign/journal.ts` (new), its test

**Intent**: Survive a closed laptop at any instant.

**Contract**: An append-only JSON-lines file. Each action writes an intent entry before it starts and an outcome entry after. State is always derived by replaying the file. A trailing intent with no outcome is reconciled on start rather than repeated blindly.

#### 4. HTTP client

**File**: `bench/campaign/http-client.ts` (new), its test for the pure parts

**Intent**: Drive the deployed app without a browser.

**Contract**:

- Signs in through `/api/auth/signin` as a form POST with a matching `Origin` header and manual redirect handling. Success is judged from the `Location` header, not the status.
- Keeps cookies in memory only. Applies every `Set-Cookie`, including chunked cookies and `Max-Age=0` deletions.
- Calls actions as JSON POSTs to `/_actions/<name>`. Decodes 200 responses (`application/json+devalue`) with `devalue`, treats 204 as empty, and maps the error JSON to a typed error by `code`.
- Treats an action error with code `UNAUTHORIZED` (401) as "session lost" and signs in again once. Actions never redirect: `/_` is a public prefix in `src/middleware.ts`, so the 302 to the sign-in page never reaches `/_actions/*`; `requireSession` throws instead. The redirect handling above applies to the sign-in POST only. The error-mapping tests cover the 401 path.
- Allows at least 90 s for `startGeneration`, which covers a cold start.

#### 5. Cell controller

**File**: `bench/campaign/cell-controller.ts` (new), its test for the pure parts

**Intent**: One interface, two implementations, so rehearsal exercises the same state machine.

**Contract**: The interface offers: read effective tuning, apply a cell, park, stop if idle, wait until not running, `liveVersion()`, and an `expectedHost` predicate over `solver_config.host`. Every production-only fact the runner reasons from lives behind this interface, so the local implementation can answer it too: `liveVersion()` is `wrangler deployments list --json` in production and a fixed string locally; `expectedHost` is the container fingerprint (`machine` and `cpuCount` as observed at the first production run) in production and accepts anything locally.

| Implementation | Apply a cell | Stop |
|---|---|---|
| Production | `wrangler secret bulk` with a JSON file of the three keys; poll `status()` until its tuning equals the cell; then `stop-if-idle`; then poll `status()` until `running` is false | The control route |
| Local | Restart the native solver with the cell's env | Stop the process |

**Applying a cell is one sequence, and the stop is not optional.** `envVars` is read only at a real container start, and the SDK constructor re-arms the sleep timer on every Durable Object reset, which a secret change causes. So after a secret change a warm container keeps solving under the *old* cell for up to a full `sleepAfter`. The sequence is therefore: secret bulk → `status()` reports the cell → `stop-if-idle` → `status()` reports `running: false` → the first dispatch. `nextStep` emits the stop and the wait as their own steps, and its tests pin the order. The "wrong cell" retry branch (§2) runs the same stop before it re-dispatches, since the retry would otherwise land on the same warm container. `run-one` and the drill's first dispatch use the same sequence.

Parking is `wrangler secret bulk` with the three keys set to `null`, followed by a `status()` check that no key is overridden. If `status()` does not reflect a change within a bounded wait, or `stop-if-idle` answers `busy` or `unknown`, the controller halts rather than dispatching.

#### 6. Commands

**File**: `bench/campaign/main.ts` (new)

**Intent**: The human-facing surface.

**Contract**:

| Command | What it does |
|---|---|
| `setup` | Signs in, clones the source plan **with its board** as `Calibration — <name>`, records the id, prints remaining hours, and refuses when they are zero |
| `run` | Executes steps until a pause, a halt, or a graceful stop |
| `set-cell D <workers> <stageS> <modeAS>` | Supplies Cell D after the pause: validates against the same bounds as `effectiveTuning`, appends a journal entry, and prints the resulting grid. `run` resumes from that entry |
| `run-one` | One run under `main`'s constants with no override, for S-308's final check: park, `stop-if-idle`, wait for `running: false`, then dispatch |
| `status` | Position, valid and excluded runs per cell, time remaining, whether an override is live and for how long. Reads only |
| `park` | Removes the override and verifies it |
| `cleanup` | The strict cleanup order, after a typed confirmation |

Guards on every `run` step: no active job on any plan before a cell change; no active job on the campaign plan before a dispatch; `status()` reporting `running: false` before the first dispatch under a newly applied cell (§5); the controller's `liveVersion()` recorded at dispatch and at terminal, so a stray deploy shows in the ledger.

Stop behaviour: the first interrupt finishes the current step, leaves any in-flight solve running, parks, saves state and exits. Parking with a solve in flight happens only when the journal records that a secret change was observed not to disturb a running solve (Phase 5); otherwise the runner leaves the override in place and says so. A second interrupt exits at once without parking, and the next `status` reports the live override.

`cleanup` refuses when the ledger holds fewer jobs than the journal dispatched, and when the merged ledger JSON has not yet been copied to `context/changes/production-calibration-campaign/ledger.json`. That copy is the campaign's record of record once the rows are gone: it is ids and numbers only (Phase 3 §2), so it is committed with S-308, unlike everything else under `.campaign/`.

#### 7. Launcher and task

**File**: `scripts/solver/campaign.sh` (new), `mise.toml`

**Intent**: Follow the `hosted.sh` conventions so the launcher is shellcheck-gated and fails closed.

**Contract**: POSIX sh, `set -eu` as the first non-comment line, self-locating, sourcing `common.sh`. It reads `.envs/campaign.vars` with `sed`, never by sourcing. Preflight fails closed on a missing or empty key, a missing `wrangler` login, and an unclean tree. It prints a boxed writes-to-production banner and requires a typed confirmation unless `SOLVER_CAMPAIGN_CONFIRM=yes`. It uses split `EXIT` / `INT` / `TERM` traps and `caffeinate -i` on Darwin. The mise task is a description, a `dir` and a one-line `run`.

The hosted service-role key is exported to the analyzer subprocess only. It is never written to `.env.test.local`, `.env.local` or `.dev.vars`.

#### 8. State directory

**File**: `.gitignore`

**Intent**: Journal, working ledger JSON and raw telemetry stay on the machine. The one exception is the merged ledger, which `cleanup` requires to have been copied into S-308's change folder first (§6), because deleting the source plan cascades the rows it was read from.

**Contract**: A `/.campaign/` entry with a never-commit comment in the style of `/pii-scrub/`, naming the committed ledger copy as the deliberate exception.

### Success Criteria:

#### Automated Verification:

- [ ] `pnpm install --frozen-lockfile` succeeds with `devalue` as a direct devDependency
- [ ] `pnpm test` green, including the definition, next-step, journal and client tests
- [ ] `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm build` clean
- [ ] `mise run solver:check` green, including shellcheck and the `set -eu` check on `campaign.sh`

#### Manual Verification:

- [ ] With `.envs/campaign.vars` missing a key, the launcher refuses before printing the banner
- [ ] Against the local stack, `setup` creates the campaign plan and prints its remaining hours
- [ ] `status` on a fresh journal, run through bare `node bench/campaign/main.ts` rather than vitest, prints the full grid as pending with a time estimate
- [ ] No file under `.campaign/` appears in `git status`

**Implementation Note**: Pause after this phase. The full rehearsal is Phase 6; this phase only proves the pieces start.

---

## Phase 5: Lifecycle commands

### Overview

The commands for S-308's Phase 3: the attended drill, the renewal and idle-sleep observation, and the five production numbers. It opens with a short spike against the live account, because two platform facts cannot be learned anywhere else.

### Changes Required:

#### 1. Telemetry spike

**File**: `context/changes/automate-production-calibration-campaign/change.md` (findings)

**Intent**: Replace three unverified assumptions with observed facts before any code depends on them.

**Contract**: Fetch the current Cloudflare Workers Observability docs first; nothing here is written from memory. Against the live account, record: the filter keys that select container stdout and Durable Object lines, the token permission the query endpoint needs, the ingestion latency, and whether `[solver-container]` lines arrive reliably. This step needs the developer's Cloudflare credentials.

#### 2. Telemetry client and line parsers

**File**: `bench/campaign/telemetry.ts`, `bench/campaign/telemetry-lines.ts` (new), a test for the parsers

**Intent**: Turn log lines into timestamps the runner can compute with.

**Contract**: The client queries by time window and needle, using the keys the spike recorded. The parsers are pure and recognise: the container's startup line with its values, `job <id> solving with N workers`, `job <id> succeeded`, the shutdown pair, and the Durable Object's `sleep declined`, `idle at sleepAfter` and `stopped:` lines. Raw responses are stored under `.campaign/` only.

#### 3. Startup verification

**File**: `bench/campaign/main.ts`

**Intent**: Close S-308's pending check 1.5 without the dashboard.

**Contract**: A `verify-startup` command prints the most recent startup line's values and its timestamp.

#### 4. The drill

**File**: `bench/campaign/main.ts`, `bench/campaign/drill.ts` (new), a test for its pure sequencing

**Intent**: Execute the deploy-during-solve drill so that it can actually interrupt a solve, with the human watching.

**Contract**: An attended `drill` command. It refuses to start unless Docker is running, the tree is clean at `origin/main`, the image has been pre-built, and no job is active.

Sequence:

1. Apply the 240 s cell through the controller's full sequence (secret, `stop-if-idle`, wait for `running: false` — Phase 4 §5) and dispatch on the campaign plan.
2. Poll `checkPlan` until a checkpoint exists at ladder position 3 or later.
3. Prepare an image-changing commit (a comment under `services/solver/`), build, and run a local `wrangler deploy`.
4. Poll the row to `interrupted` and confirm the checkpoint survived.
5. Read the shutdown pair from telemetry for the SIGTERM-to-`interrupted` latency.
6. Call `checkPlan` on the proposal and confirm `delivered` with the checkpoint position.
7. Fetch the proposal page and confirm it contains the halted-board label for that position.
8. Dispatch again, still under the 240 s cell, and confirm a fresh job starts. This job is journaled as Cell C run 1: it counts when it completes with a `solver_config` matching Cell C, and is recorded as excluded otherwise. It is a full ladder, about 45 minutes, and change.md's Phase 3 budget carries it.
9. While that job runs, apply Cell A through `wrangler secret bulk` (the secret only; no stop) and record whether the solve is disturbed. The journal stores the result as the flag the stop behaviour reads. Cell A is chosen because the renewal command that follows runs Cell A run 1, so no further switch is needed; the controller's stop-and-wait still runs before that dispatch (Phase 4 §5).
10. Print the push command for the drill commit. Pushing to `main` is left to the human, and only once no job is active.

The label text is read from `GenerationStatusStrip.tsx` by the implementer at build time and asserted as a pattern on the position, not copied into the plan.

#### 5. Renewal and idle-sleep observation

**File**: `bench/campaign/main.ts`, `bench/campaign/lifecycle-numbers.ts` (new), its test

**Intent**: Prove renewal at `sleepAfter = "10m"` and compute the five numbers from timestamps.

**Contract**: A `renewal` command that refuses unless `status()` reports a deployed `sleepAfter` of 10 minutes; that change belongs to S-308. It runs one Cell A solve, which is also Cell A run 1. It then waits without calling the control route. It requires at least one `sleep declined` line during the solve, a `succeeded` row, and an `idle at sleepAfter` and `stopped:` pair afterwards.

The five numbers are computed by a pure function and printed as a dated markdown block for S-308's `change.md`:

| Number | Source |
|---|---|
| Cold start | `started_at` minus `created_at`, cross-checked against the startup line's timestamp |
| Renewal cadence | Gaps between `sleep declined` lines |
| Idle-sleep boundary | The `stopped:` timestamp minus the last request |
| SIGTERM to `interrupted` | The shutdown pair, against `finished_at` |
| Drill duration and stage reached | The drill's row |

It also prints the observed `unaccounted` values, which S-308's follow-up needs in order to revise `OVERHEAD_ALLOWANCE_S`.

### Success Criteria:

#### Automated Verification:

- [ ] `pnpm test` green, including the line parsers, drill sequencing and lifecycle-number tests
- [ ] `pnpm check`, `pnpm lint`, `pnpm steiger` clean

#### Manual Verification:

- [ ] The spike's four findings are recorded in `change.md` with the date
- [ ] `verify-startup` prints the deployed container's most recent startup line, closing S-308's check 1.5
- [ ] The line parsers' fixtures are real lines captured from the account, containing job ids and no names

**Implementation Note**: Pause after this phase. The drill and renewal commands are exercised on production during S-308's Phase 3, not here.

---

## Phase 6: Rehearsal and handoff

### Overview

Prove the runner end to end on the local stack, write the runbook, and amend S-308's plan so that anyone following it uses the protocol that works.

### Changes Required:

#### 1. Local rehearsal

**File**: `context/changes/automate-production-calibration-campaign/change.md` (transcript summary)

**Intent**: The first resume, retry and cleanup the runner ever executes must not be on production.

**Contract**: A full grid against the local stack with short budgets, covering every path below. The summary records ids and numbers only.

| Path | How it is forced |
|---|---|
| Resume after a hard stop | Kill the runner mid-solve, then start it again |
| Graceful stop and park | One interrupt during a wait |
| Excluded run and retry | Send SIGTERM to the local solver mid-solve |
| Halt after a second failure | Repeat the SIGTERM on the retry |
| Pause for Cell D, then resume | Let A, B and C complete; supply Cell D with `set-cell`; confirm `run` continues |
| Cleanup order | Run `cleanup` and confirm the proposals go before the source |

#### 2. Runbook

**File**: `docs/runbooks/calibration-campaign.md` (new)

**Intent**: One place that tells the operator what to do on each of the two days.

**Contract**: One-time setup (the dedicated campaign account without a `machine_role`, `.envs/campaign.vars`, the Cloudflare token, the operator allowlist secret); the two-day schedule; the merge freeze; what each command does; how to recover from a halt; what to remove afterwards, including the allowlist secret.

#### 3. README

**File**: `README.md`

**Intent**: The mise task and its profile file need to be discoverable where the other solver tasks are.

**Contract**: A short subsection under "Running the solver service (dev)" that links to the runbook, plus a row for `.envs/campaign.vars` under "Environment Profiles" stating that no `pnpm env:*` script copies it.

#### 4. Amendments to S-308

**File**: `context/changes/production-calibration-campaign/plan.md`, `plan-brief.md`, `follow-ups/review-fixes.md`

**Intent**: Replace the six disproved premises where they are stated, without rewriting history.

**Contract**: Dated inline notes, per the repo's archive convention. Progress step titles are not renamed.

| Site | Amendment |
|---|---|
| Critical Implementation Details, timing | Cells switch by secret override; the startup line is confirmed after dispatch |
| Phase 3, campaign plan | Cloned with its board, so the campaign measures a fill-the-gaps solve and is not comparable with S-302's full-catalog run |
| Phase 3, drill | 240 s vehicle, local deploy trigger |
| Phase 4, cell protocol | Runner-driven; attribution from `solver_config` |
| Phase 4, automated criteria | "CI green on every cell merge" no longer applies, since cells are not merges |
| Phase 5, cleanup | The strict order, and why; the merged ledger JSON is committed to the change folder before the rows are deleted |
| Plan brief, prerequisites | The service-role key must never go in `.env.test.local` |
| Follow-ups | Point at the `unaccounted` values the renewal command prints |

#### 5. Change status

**File**: `context/changes/automate-production-calibration-campaign/change.md`

**Intent**: Record the decisions of this planning session and the rehearsal's outcome.

**Contract**: Dated Notes entries.

### Success Criteria:

#### Automated Verification:

- [ ] `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` clean
- [ ] `mise run solver:check` and `mise run solver:test` green

#### Manual Verification:

- [ ] The local rehearsal completed every path in the table, and its summary is in `change.md`
- [ ] After the rehearsal's `cleanup`, the local database holds no calibration plan, proposal or job row
- [ ] The runbook's setup section was followed once from a clean state and produced a working `status`
- [ ] Every amendment to S-308 is dated and leaves the original text readable

---

## Testing Strategy

### Unit Tests:

- **Python:** the run record's effective values and source flags; `cleanFallback` in the final progress write; a rejected `solver_config` write leaves the solve succeeding.
- **Worker:** override precedence, empty as unset, malformed and out-of-range fallbacks, the nine-key pin; the operator decision for each of its four outcomes; the allowlist predicate; the route handler's five answers.
- **Entity:** the stored-record reader on a valid record, a legacy null, an unknown version and a malformed object.
- **Analyzer:** ledger mapping and merge idempotence; matrix statistics with excluded runs; baseline rendering.
- **Runner:** `nextStep` for every state including the pause and both failure branches; journal replay with a trailing intent; cookie handling; action error mapping; telemetry line parsers; lifecycle arithmetic.

### Integration Tests:

- `solver-credential`: the 12-column `UPDATE` list, and `solver_config` not readable by the role.
- `solver-transport`: `solver_config` non-null and parseable on a succeeded job.

### Manual Testing Steps:

1. Phase 1: a local Generate with and without `SOLVER_STAGE_BUDGET_S`, then read the row.
2. Phase 2: tier 3 with an override and the allowlist set; exercise the route before, during and after a solve.
3. Phase 3: each analyzer mode against a local job.
4. Phase 4: launcher preflight, `setup`, `status`.
5. Phase 5: the telemetry spike, then `verify-startup`.
6. Phase 6: the full local rehearsal.

## Performance Considerations

The drag-drop validation path is untouched. The solver gains two small best-effort writes per job, each reusing the existing progress request. `status()` must stay free of `containerFetch`, since a probe would start a stopped container and cost a cold start. The runner polls every 30 to 60 seconds, which is negligible load on the Worker.

## Migration Notes

One additive, nullable column; existing rows stay null and read as legacy. Phases 1 and 2 each end in a deploy that rolls the container, so each merge happens with no job active. Roll-forward only, as README § Rollback states. The `CALIBRATION_*` secrets and `SOLVER_OPS_ALLOWED_EMAILS` persist across deploys until deleted; the runner's `cleanup` removes the former and the runbook covers the latter.

## References

- Research: `context/changes/automate-production-calibration-campaign/research.md`
- The plan this automates: `context/changes/production-calibration-campaign/plan.md`
- Launcher conventions: `scripts/solver/hosted.sh`, `scripts/solver/tier3.sh`, `scripts/solver/common.sh`
- Run-record seam: `services/solver/src/cpsat_service/runner.py` (`_solve_and_write`, `_with_budgets`)
- Best-effort write: `services/solver/src/cpsat_service/supabase.py` (`JobRowClient.progress`)
- Forwarding rule: `src/solver-container-env.ts`
- Job view: `src/_pages/plan-detail/api/generation-delivery.ts` (`GenerationJobView`)
- Rules applied: `context/foundation/lessons.md` — "Astro Actions are the single transport", "A Worker forwards only what `.dev.vars` holds", "Granting a role is not excluding the others"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Self-describing job rows

#### Automated

- [x] 1.1 `pnpm exec supabase db reset` applies every migration cleanly — 8876160
- [x] 1.2 `mise run solver:check` and `mise run solver:test` green, objective parity at exactly 10/10 — 8876160
- [x] 1.3 `pnpm test:integration` green for `solver-credential` and `solver-transport` with the solver running — 8876160
- [x] 1.4 `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` clean — 8876160
- [x] 1.5 `mise run solver:image:build` and `mise run solver:image:smoke` pass — 8876160

#### Manual

- [x] 1.6 A local Generate leaves a row whose `solver_config` names the local solver's workers, budgets and host — 8876160
- [x] 1.7 `budgetSource.stage` reads `engine-default` when unset and `configured` when set to 5 — 8876160
- [ ] 1.8 Merged to `main` with no job active on production, and the `Deploy` job finished green

### Phase 2: Worker control surface

#### Automated

- [x] 2.1 `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` clean — 27d9cb9
- [x] 2.2 `mise run solver:check` green, including shellcheck on the edited `tier3.sh` — 27d9cb9
- [x] 2.3 The nine-key pin test still lists exactly nine keys — 27d9cb9

#### Manual

- [x] 2.4 Under tier 3 with `CALIBRATION_STAGE_BUDGET_S=5`, the startup line and the row's `solver_config` both show 5 — 27d9cb9
- [x] 2.5 `GET` on the route reports `running: false` before a Generate and `running: true` during one — 27d9cb9
- [x] 2.6 `stop-if-idle` answers `busy` during a solve and stops the container after it — 27d9cb9
- [x] 2.7 The route answers 404 with the allowlist unset, and 403 for an account outside it — 27d9cb9
- [ ] 2.8 Merged to `main` with no job active on production, and the `Deploy` job finished green

### Phase 3: Analyzer extensions

#### Automated

- [ ] 3.1 `pnpm test` green, including the ledger, matrix and baseline tests
- [ ] 3.2 `pnpm check`, `pnpm lint`, `pnpm steiger` clean

#### Manual

- [ ] 3.3 The ledger mode writes a JSON row with a cell key and a 10-tuple for a fresh local job
- [ ] 3.4 Running the ledger mode twice on the same job produces one row
- [ ] 3.5 The active guard blocks on a live local job and reports nothing once it is terminal
- [ ] 3.6 No output line contains a course, student or teacher name

### Phase 4: Campaign runner

#### Automated

- [ ] 4.1 `pnpm install --frozen-lockfile` succeeds with `devalue` as a direct devDependency
- [ ] 4.2 `pnpm test` green, including the definition, next-step, journal and client tests
- [ ] 4.3 `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm build` clean
- [ ] 4.4 `mise run solver:check` green, including shellcheck and the `set -eu` check on `campaign.sh`

#### Manual

- [ ] 4.5 With `.envs/campaign.vars` missing a key, the launcher refuses before printing the banner
- [ ] 4.6 Against the local stack, `setup` creates the campaign plan and prints its remaining hours
- [ ] 4.7 `status` on a fresh journal, run through bare `node bench/campaign/main.ts` rather than vitest, prints the full grid as pending with a time estimate
- [ ] 4.8 No file under `.campaign/` appears in `git status`

### Phase 5: Lifecycle commands

#### Automated

- [ ] 5.1 `pnpm test` green, including the line parsers, drill sequencing and lifecycle-number tests
- [ ] 5.2 `pnpm check`, `pnpm lint`, `pnpm steiger` clean

#### Manual

- [ ] 5.3 The spike's four findings are recorded in `change.md` with the date
- [ ] 5.4 `verify-startup` prints the deployed container's most recent startup line
- [ ] 5.5 The line parsers' fixtures are real captured lines containing job ids and no names

### Phase 6: Rehearsal and handoff

#### Automated

- [ ] 6.1 `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` clean
- [ ] 6.2 `mise run solver:check` and `mise run solver:test` green

#### Manual

- [ ] 6.3 The local rehearsal completed every path in the table, and its summary is in `change.md`
- [ ] 6.4 After the rehearsal's `cleanup`, the local database holds no calibration plan, proposal or job row
- [ ] 6.5 The runbook's setup section was followed once from a clean state and produced a working `status`
- [ ] 6.6 Every amendment to S-308 is dated and leaves the original text readable
