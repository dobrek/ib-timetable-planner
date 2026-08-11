# Solver Service Transport (F-302) Implementation Plan

## Overview

Promote `poc/cp-sat/` to `services/solver/` and give it a thin, tested HTTP wrapper: `POST /jobs/{jobId}/solve` accepts an unmodified contract `SolveRequest`, runs the CP-SAT engine on a background thread with a pinned worker count, and writes status/results durably to `generation_jobs` as the `solver_job_writer` machine user over HTTPS. On the app side, land the env-gated `SOLVER_URL` transport seam (typed dispatch + health probe) that S-301 will consume. Along the way: wire `mypy --strict` as the solver's type gate (before the wrapper is written), bring `SolveRequest` under the both-suites contract gate, pin Python 3.13 everywhere, and graduate mise to toolchain pins + solver tasks.

## Current State Analysis

Verified in `research.md` (all file:line references there are current as of `f9f12e4`):

- **Engine is ready to wrap.** `solve_complete(dump, config) -> SolveResult` (`solve.py:188`) is transport-agnostic and side-effect-free with `log_dir=None`; `SolveConfig.workers` already maps to `num_workers`. `parse_snapshot` was made public for exactly this envelope (`schema.py:142-148`).
- **The envelope is frozen but ungated.** `$defs.SolveRequest` exists in `contracts/generation-wire.schema.json` (`formatVersion`, `snapshot`, optional `warmStart`; `additionalProperties: false`) but has no TS type, no Python canonicalizer, no golden fixture, and no test in either suite.
- **The DB surface is pre-built.** `generation_jobs` has every column the wrapper writes; `solver_job_writer` holds SELECT + an 11-column UPDATE on `queued`/`running` rows only. No migration needed. The credential flow (password grant → Custom Access Token Hook → `solver_job_writer`) is live locally and pinned by `src/test/solver-credential.integration.test.ts`.
- **Debt and inconsistencies to clear:** `mypy --strict` reports 70 errors in `src/` (46 after the one-line `Term` fix) + 38 in `tests/`; three Python versions are in play (`.python-version` 3.13, `requires-python >=3.12`, tech-stack names a 3.12 image); `mise.toml` is a 2-line PATH stub; `jsonschema` sits in the dev group with a "test-lane only" comment the wrapper invalidates.
- **Promotion blast radius:** ~20 references across 10 files; `ci.yml` hardcodes `poc/cp-sat` twice and its `solver` job gates `deploy`; `.prettierignore` covers `poc/` but not `services/`.
- **App side:** generation is 100% client-side (`generate.worker.ts` + greedy). No outbound `fetch()` exists anywhere in `src/`. workerd→localhost reachability was probed and works on the pinned wrangler.

## Desired End State

- `services/solver/` is the solver package; `poc/cp-sat/` no longer exists; CI (including `deploy.needs`) is green on the new path.
- `uv run mypy --strict` passes over `src/` **and** `tests/` and runs in the CI solver lane.
- `contracts/fixtures/solve-request.json` exists and is byte-gated by both `test_contract.py` and `bench/contract-parity.test.ts`. The schema itself is untouched — no `formatVersion` bump.
- `uv run uvicorn cpsat_service.app:app` serves `GET /health` and `POST /jobs/{jobId}/solve`; a valid request returns 202, the job row transitions `queued → running → succeeded` with a schema-conformant `result`, and invalid payloads are rejected at the boundary with jsonschema errors (never a bare `KeyError`).
- The app exposes `SOLVER_URL` via `astro:env` and a typed transport (`createSolverTransport`) with dispatch + health functions; a TS integration test observes the full `queued → running → succeeded` chain through the real service, and runs in CI's `integration` job.
- `mise.toml` pins `uv` and offers `solver:dev` / `solver:test` / `solver:check` tasks.

### Key Discoveries:

- `test_contract.py` anchors the contracts dir as `Path(__file__).resolve().parents[3]` — deliberately promotion-proof (`poc/cp-sat/tests` and `services/solver/tests` are the same depth). **No path edit needed there** (its line-7 docstring does mention `poc/cp-sat/` and gets the mechanical text update in Phase 1).
- `warmStart → Dump.greedy_placements` gives hinting for free: `solve_complete` hints from `_greedy_board(dump)`, which reads `greedy_placements`. An empty warm start degrades cleanly (hint-free Mode A measured OPTIMAL at 0.7s).
- The RLS `WITH CHECK` window permits `running → running`, so idempotency must come from the `status=eq.queued` filter on the compare-and-set, not from the policy (R10).
- The solve-request golden can be **derived from the two existing goldens** (snapshot + result placements as `warmStart`) — no new CP-SAT run, fully deterministic regeneration.
- `shared/api/supabase.ts` imports `astro:env/server` at module top — a transport module written the same way is untestable from plain vitest. The env read must live in a separate module from the fetch logic.

## What We're NOT Doing

- **No contract schema edit.** `POST /jobs/{jobId}/solve` carries an unmodified `SolveRequest`; `jobId` travels in the path (decided, `change.md`).
- **No `policy` handling.** The wrapper never reads `generation_jobs.policy`; S-307 owns making the engine honour it (and is flagged as under-scoped there).
- **No progress emission, checkpoints, stop endpoint, heartbeat renewal, or SIGTERM handling** — S-303/S-304/S-305. We only leave the seam: the in-process `jobId → (thread, CpSolver handle)` registry.
- **No Dockerfile, no container binding, no hosted setup** — S-302. The hosted Custom Access Token Hook enablement stays manual and is not touched.
- **No UI, no Astro Action, no result-read path** — S-301 owns the user-visible slice and the relocated `runVerifiedGeneration` oracle.
- **No Mode B (`solve_repair`) exposure** — meaningless without a real warm start; later slices.
- **No budget/target calibration** — engine defaults stay; S-308 owns shipped budgets (PRD tuning-discipline rule).
- **No greedy-path changes** — the Web Worker path stays untouched until S-309.

## Implementation Approach

Five phases, strictly ordered. The promotion lands first and alone so CI proves the rename before anything stacks on it (research Risk #1). The mypy gate lands second so the new HTTP module is *born* strict (R7). The contract fixture lands third so the wrapper's tests can reuse a gated, known-valid request body. The wrapper is phase 4, hermetic (mocked httpx transport). Phase 5 wires the app seam, mise, and the end-to-end proof-of-life against the real local stack.

## Critical Implementation Details

- **Prettier exposure on the moved tree.** `.prettierignore` ignores `poc/`; without a `services/solver/` entry, lefthook's `prettier --write` starts reformatting the solver's README/JSON on the promotion commit itself. Add the ignore entry **in the same commit as the move**.
- **CAS ordering and silent-failure surface.** The handler validates + registers and returns 202; the background worker then performs sign-in → CAS (`PATCH …?id=eq.{jobId}&status=eq.queued`) → solve → final write. If sign-in fails, the worker cannot write an error to the row — the row stays `queued` with only a loud service log. This is accepted for F-302 (tier-1 dev loop); the integration test converts it into a timeout failure.
- **Env-read isolation for testability.** `createSolverTransport(url)` must be a pure factory; only a thin sibling module reads `astro:env/server`. Otherwise the integration test (plain vitest, no astro runtime) cannot import the transport. This split is also the S-302 seam: a container binding swaps the factory input, not the call sites.
- **Token discipline.** Re-run the **password grant** near expiry; never the refresh grant (runbook — a refresh that silently returned an `authenticated` token is the exact escalation the design prevents). One token covers a solve (`jwt_expiry` 3600s); guard writes with an age check (~3000s) anyway.
- **Narrow projections on every PostgREST call.** `select=id` (or the columns actually needed) on every request — a bare `select()` drags the ~124 KB TOASTed snapshot (migration header + runbook).
- **Non-exceptional failure.** A non-OPTIMAL/FEASIBLE solve does not raise — it returns `board=()` with `notes.outcome` `infeasible`/`unknown`. The worker must branch on the result, not on exceptions.

---

## Phase 1: Promotion + Python 3.13 pin

### Overview

Move `poc/cp-sat/` → `services/solver/` with every reference updated, pin Python 3.13, and get CI fully green before any new code stacks on top. This phase deliberately contains **no behaviour change**.

### Changes Required:

#### 1. The move itself

**File**: `poc/cp-sat/**` → `services/solver/**`

**Intent**: `git mv` the whole package (preserves history). The `.venv/` and `data/` dirs are untracked; developers re-run `uv sync` in the new location.

**Contract**: Package layout is unchanged inside the folder (`src/cpsat_engine/`, `tests/`, `pyproject.toml`, `uv.lock`). `tests/test_contract.py` needs **no path edit** — its `parents[3]` anchor survives by design; only its line-7 docstring (which names `poc/cp-sat/` as pytest's rootdir) gets a text update so criterion 1.3's grep comes back clean.

#### 2. CI workflow

**File**: `.github/workflows/ci.yml`

**Intent**: Update both `working-directory: poc/cp-sat` occurrences (the job default at ~line 103 and the `setup-uv` step input at ~line 116 — they are separate by design). This is the highest-risk edit: the `solver` job sits in `deploy.needs`.

**Contract**: `solver` job runs `uv sync --locked`, `uv run ruff check`, `uv run pytest` from `services/solver`.

#### 3. Ignore files and docs

**File**: `.gitignore`, `.prettierignore`, `contracts/README.md`, `bench/export-snapshot.experiment.ts`, `bench/generate-contract-goldens.experiment.ts`, `bench/contract-parity.test.ts`, `src/entities/timetable/model/generation/wire.ts`, `CLAUDE.md`, `services/solver/README.md`

**Intent**: Update the ~20 path references catalogued in research §7: `.gitignore` entries (`/poc/cp-sat/data/`, `/poc/cp-sat/.venv/` → `/services/solver/…`), a **new** `services/solver/` line in `.prettierignore` (same commit as the move), the 3× `cd poc/cp-sat` in the contracts README regen script, the `DUMP`/`OUT` defaults and doc comments in the bench files, the doc comments in `wire.ts`, CLAUDE.md's solver section header + frozen-contract paragraph (drop the "promoting to services/solver" parenthetical — it's done), the solver README's self-referential paths, and the `tests/test_contract.py:7` docstring (names `poc/cp-sat/` as pytest's rootdir).

**Contract**: `grep -rn "poc/cp-sat" --exclude-dir=context --exclude-dir=.git .` returns only archived/narrative context docs afterward. `context/**` is historical record — do not rewrite it.

#### 4. Python version pin

**File**: `services/solver/pyproject.toml`, `services/solver/uv.lock`

**Intent**: `requires-python = ">=3.13"` (R9 — local and CI already run 3.13 via `.python-version`; the only 3.12 anywhere was aspirational). Re-lock (`uv lock`) so the lockfile records the new floor; `uv sync --locked` must still pass.

**Contract**: `.python-version` stays `3.13`. The `python:3.13-slim` image base is S-302's to write.

### Success Criteria:

#### Automated Verification:

- Solver suite green in new location: `cd services/solver && uv sync --locked && uv run ruff check && uv run pytest` (56 tests)
- JS suite untouched: `pnpm test` (contract parity included) and `pnpm check` pass
- No stale references: `grep -rn "poc/cp-sat" . --exclude-dir=.git --exclude-dir=context --exclude-dir=node_modules` is empty
- Full CI run green on the branch (including the renamed `solver` job)

#### Manual Verification:

- CI job list shows `solver` executed from `services/solver` and `deploy.needs` still references it

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: `mypy --strict` gate — src + tests

### Overview

Close the measured type debt (70 errors `src/`, 38 `tests/`) and wire `mypy --strict` into the dev group and the CI solver lane — **before** the wrapper exists, so the new HTTP module is written under the gate (R7).

### Changes Required:

#### 1. The `Term` alias

**File**: `services/solver/src/cpsat_engine/model.py`

**Intent**: Replace the placeholder `Term = object` with the measured fix (R8). One line removes 24 errors including every `operator` error.

**Contract**: `Term = cp_model.LinearExpr | int` — `LinearExpr`, not `IntVar` (IntVar subclasses LinearExpr and the tier code builds LinearExpr values). Runtime-verified on 3.13.

#### 2. Helper signatures

**File**: `services/solver/src/cpsat_engine/model.py`, `objective.py`

**Intent**: Take `Sequence[Term]` instead of `list[Term]` in the ~4 helpers (`_sum_var`, `_as_var`, and siblings) to clear the list-invariance `arg-type` errors. No `cast()`s anywhere.

**Contract**: Public behaviour unchanged; signatures widen covariantly.

#### 3. Mechanical pass

**File**: `services/solver/src/cpsat_engine/*.py`, `services/solver/tests/*.py`

**Intent**: Clear the remainder: ~20 `type-arg` (bare `tuple`/`dict`, the `dict[tuple, int]` placement key ×15), ~17 `no-untyped-def` (11 in `cli.py`, which must survive — the goldens-regen script depends on it), 4 singles including the real `CpSolverStatus`-typed-as-`int` mismatch (`solve.py:486`), and the 38 test-side errors (mostly untyped test defs). `objective.py:208` is not a latent bug — the local just needs annotating.

**Contract**: Zero behaviour change; the existing 56 tests stay green throughout.

#### 4. Tooling

**File**: `services/solver/pyproject.toml`, `.github/workflows/ci.yml`

**Intent**: Add `mypy` + `types-jsonschema` to the dev group; add a `[tool.mypy]` block (`strict = true`, files = `src` + `tests`, `mypy_path = ["src"]` so tests resolve the package). Add `uv run mypy` to the CI solver job after ruff, and correct the job's comment block, which currently says mypy "arrives with S-302".

**Contract**: `uv run mypy` (config-driven, no args) exits 0; CI runs it on every push.

### Success Criteria:

#### Automated Verification:

- `cd services/solver && uv run mypy` → 0 errors over `src/` and `tests/`
- `uv run pytest` → 56 passing (no behaviour drift)
- `uv run ruff check` clean
- CI solver job green with the new mypy step

#### Manual Verification:

- Spot-check that `Term`-touching diffs are type-only (no arithmetic/expression rewrites in `objective.py` tiers)

**Implementation Note**: Pause for manual confirmation before Phase 3. If the 38 test-side errors turn out materially pricier than measured, stop and flag — the src gate must still land in this phase either way.

---

## Phase 3: `SolveRequest` under the both-suites contract gate

### Overview

Give F-302's own envelope the discipline every other payload already has (R4): a TS type + canonicalizer, a Python canonicalizer, a committed golden, and byte-gating assertions in both suites. **The schema file is not edited** — no `formatVersion` bump, no bilateral schema change.

### Changes Required:

#### 1. TS projection

**File**: `src/entities/timetable/model/generation/types.ts`, `wire.ts`

**Intent**: Add the `SolveRequest` type and `canonicalizeSolveRequest` alongside the existing canonicalizers. Both export through the existing `entities/timetable` barrel lines (`export * from`).

**Contract**: `type SolveRequest = { formatVersion: 1; snapshot: WireSnapshot; warmStart?: GeneratedPlacement[] }`. Canonical form: snapshot via `toWireSnapshot`, `warmStart` sorted by the existing `byWirePlacement`, `canonicalStringify` on top; `warmStart` omitted when absent (never nulled).

#### 2. Python mirror

**File**: `services/solver/src/cpsat_engine/wire.py`

**Intent**: Add `canonical_solve_request_json`, mirroring the TS ordering rules exactly (this module is already the Python half of the canonical form).

**Contract**: Byte-identical output to the TS canonicalizer for the same payload — that is what the golden gates.

#### 3. The golden

**File**: `contracts/fixtures/solve-request.json`, `bench/generate-contract-goldens.experiment.ts`, `contracts/README.md`

**Intent**: Extend the regen script to also emit `solve-request.json`, **derived from the two existing goldens**: the snapshot golden as `snapshot`, the result golden's `placements` as `warmStart` (exercising the optional key). Deterministic — no new CP-SAT run. Document the third fixture in the contracts README (fixtures list + regeneration section).

**Contract**: The fixture is canonical bytes (sorted keys, declared array sorts, no nulls); `contracts/` stays prettier-ignored.

#### 4. Gating assertions, both suites, same commit

**File**: `bench/contract-parity.test.ts`, `services/solver/tests/test_contract.py`

**Intent**: Mirror the existing golden assertions for the new fixture in both suites: validates against `$defs/SolveRequest`, byte-identical to its canonical form, already in declared array order, contains no nulls.

**Contract**: A drift in either canonicalizer or a reformat of the fixture turns exactly one suite red, naming the side that moved.

### Success Criteria:

#### Automated Verification:

- `pnpm test` green (new parity assertions included); `pnpm check` green
- `cd services/solver && uv run pytest && uv run mypy` green (new contract tests included, strict-clean)
- `git diff --stat contracts/generation-wire.schema.json` is empty
- Regen determinism: running `pnpm experiment:goldens` (with the recorded RESULT input) reproduces `solve-request.json` byte-identically

#### Manual Verification:

- Fixture eyeball: `formatVersion: 1`, UUID-only content, no display text

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: The HTTP wrapper (`cpsat_service`)

### Overview

The FastAPI service: accept a solve job, validate at the boundary, run the engine on a background thread, and write status/results to `generation_jobs` via httpx as the machine user. Tested at the wrapper level with a mocked httpx transport — the untested-`cli.py` lesson applied.

### Changes Required:

#### 1. Package scaffold + dependencies

**File**: `services/solver/pyproject.toml`, `services/solver/uv.lock`, `services/solver/src/cpsat_service/__init__.py`

**Intent**: New sibling package `cpsat_service` (keeps `cpsat_engine` pure — engine imports nothing from the service; the service imports the engine). Add runtime deps `fastapi`, `uvicorn[standard]`, `httpx` (R1 — verified to co-resolve with ortools, 78 packages), and **move `jsonschema` from the dev group to runtime** — updating its "TEST-LANE concern only" comment, which this change deliberately invalidates (R3). Add the package to `[tool.hatch.build.targets.wheel] packages`.

**Contract**: `uv sync --locked` builds one venv serving both packages; `uv audit` re-run against the grown surface.

#### 2. Settings

**File**: `services/solver/src/cpsat_service/settings.py`

**Intent**: Read the container's env exactly as the runbook specifies: `SUPABASE_URL`, `SUPABASE_KEY` (publishable), `SOLVER_MACHINE_PASSWORD`, plus `SOLVER_MACHINE_EMAIL` (default `solver@ib-timetable-planner.dev`) and `SOLVER_WORKERS` (default `8` — the roadmap's "pinned worker count"; never 0/auto, for reproducibility). Missing Supabase env does not prevent startup (`/health` must work bare); it fails the first job loudly.

**Contract**: A frozen dataclass; no secret key, no service-role key, ever.

#### 3. Supabase job-row client

**File**: `services/solver/src/cpsat_service/supabase.py`

**Intent**: An httpx-based client (no SDK) with exactly three operations: `sign_in()` (password grant `POST /auth/v1/token?grant_type=password`; re-run the **password** grant when the token is older than ~3000s — never refresh), `claim(job_id)` (the CAS: `PATCH /rest/v1/generation_jobs?id=eq.{id}&status=eq.queued` setting `status='running'`, `started_at`, `heartbeat_at`; `Prefer: return=representation` with a `select=id` projection so an empty array means "not claimed"), and `finish(job_id, …)` (`PATCH …?id=eq.{id}` writing `status`, `result`/`error`, `stages`, `finished_at`; narrow projection).

**Contract**: Writes touch only the 11 granted columns. Failure modes are known: `42501` outside the grant, `23514` on a bad status string — surface both in logs verbatim.

#### 4. Job registry

**File**: `services/solver/src/cpsat_service/registry.py`

**Intent**: The in-process `jobId → (thread, solver-handle)` map (R5/R10 layer a): duplicate registration returns the existing entry so a retried POST never starts a second solve; entries are removed on completion. Holding the live `CpSolver` reference is the seam S-303/S-305 inherit — no stop behaviour is built now.

**Contract**: Thread-safe (a lock around the dict); the handle slot is populated by the runner when the engine exposes it — at minimum the registry holds the thread and a stop-callable seam.

#### 5. The runner

**File**: `services/solver/src/cpsat_service/runner.py`

**Intent**: The background worker: sign in → CAS-claim (unclaimed ⇒ unregister and exit silently — layer b of R10) → build the `Dump` (`format_version=body["formatVersion"]` — a required field with no default, `parse_snapshot(body["snapshot"])`, `greedy_placements` from `warmStart` if present else empty, `meta={}`, `greedy_diagnostics={}`, `objective=()`) → `solve_complete(dump, SolveConfig(workers=settings.workers, log_dir=None))` → map the outcome to the final write. `warmStart` parsing may need a small public placement parser in `schema.py` (mirror of how `parse_snapshot` was made public) — add it there, not inline.

**Contract**: Outcome mapping — `notes["outcome"] == "complete"` ⇒ `status='succeeded'`, `result=wire_result(to_generation_result(dump, result))` (the declared array sorts are applied at the consumer by design — `wire.py`'s own docstring; raw producer output is board-ordered and would store non-canonical bytes), `stages` from `wire_stage_report`; `infeasible`/`unknown` ⇒ `status='failed'`, `error` naming the outcome, `stages` still written; `PreconditionError` ⇒ `status='failed'`, `error=str(e)` (client-data failure); any other exception ⇒ `status='failed'` + logged traceback. Never rely on exceptions for non-optimal statuses.

#### 6. The FastAPI app

**File**: `services/solver/src/cpsat_service/app.py`

**Intent**: Two routes. `GET /health` → 200 `{"status": "ok"}`, dependency-free. `POST /jobs/{job_id}/solve` (path-typed UUID) → validate the body against `$defs/SolveRequest` with a `Draft202012Validator` compiled once at startup from `contracts/generation-wire.schema.json` (anchored promotion-proof in the `test_contract.py` style — but `app.py` sits one level deeper, so the repo root is `parents[4]`, not `parents[3]`; the anchor also assumes a repo checkout, since `contracts/` is not in the wheel — S-302's container image must COPY it) → register + spawn the worker thread → **202**. Schema-invalid body ⇒ 422 with the jsonschema error paths. Duplicate POST for a registered job ⇒ 202 (idempotent accept, no second solve).

**Contract**: The contract file is the validator (R3) — no Pydantic projection of the snapshot, ever. The request body is the unmodified `SolveRequest`; `jobId` exists only in the path.

#### 7. Wrapper-level tests

**File**: `services/solver/tests/test_service.py`

**Intent**: `TestClient`-driven suite with the Supabase client mocked at the httpx-transport layer (`httpx.MockTransport` injected into the client), written strict-clean under the Phase 2 gate. Cover: health; 202 + full write sequence on a valid golden-derived request (assert the exact PostgREST calls — the `status=eq.queued` CAS filter, the narrow projections, the auth header, the 11-column payload, and that the written `result` is in declared array order, i.e. `wire_result`-shaped); 422 on malformed body with jsonschema errors (not `KeyError`); idempotent duplicate POST (one solve); unclaimed CAS ⇒ no further writes; infeasible outcome ⇒ `failed` + `stages`; `PreconditionError` ⇒ `failed` with the message; password re-grant on token age. Use a tiny builder-based snapshot so tests run in milliseconds, plus one test reusing `contracts/fixtures/solve-request.json` as the known-valid body.

**Contract**: The solver CI lane stays DB-free and fast; real-RLS fidelity is Phase 5's integration test.

#### 8. CI audit step

**File**: `.github/workflows/ci.yml`

**Intent**: Add `uv audit` to the solver job — the dependency surface just grew from 1 to ~78 packages (health-check.md flagged this exact moment).

**Contract**: Mirrors `pnpm audit --audit-level=high` in the verify job.

### Success Criteria:

#### Automated Verification:

- `cd services/solver && uv sync --locked && uv run ruff check && uv run mypy && uv run pytest` — all green, new suite included
- `uv audit` clean (or findings triaged and recorded)
- `uv run uvicorn cpsat_service.app:app` boots; `curl localhost:8000/health` → 200 (smoke, scriptable)

#### Manual Verification:

- Against the running local stack (machine user provisioned, service env set): POST the golden `solve-request.json` to a real queued job's URL; watch the row go `queued → running → succeeded` in Studio and eyeball the `result` jsonb
- Confirm a second POST for the same job changes nothing

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: App seam, mise graduation, proof-of-life

### Overview

The app-side transport (`SOLVER_URL` + typed dispatch + health probe), mise pins/tasks, and the TS integration test that observes the full chain through the real service — wired into CI's `integration` job so the proof-of-life runs on every push.

### Changes Required:

#### 1. `SOLVER_URL` env field

**File**: `astro.config.mjs`, `.env.example`, `.envs/local.vars`, `.envs/prod.vars`

**Intent**: Declare `SOLVER_URL` in the `astro:env` schema (`context: "server"`, `access: "secret"`, `optional: true` — mirroring `SUPABASE_URL`). Add `SOLVER_URL=http://127.0.0.1:8000` to `local.vars` and `.env.example` (commented); `prod.vars` gets a comment stating it stays unset — production transport is S-302's container binding, not a URL.

**Contract**: `pnpm env:local` propagates it to both `.env.local` and `.dev.vars` unchanged (the script copies the file wholesale).

#### 2. Typed transport

**File**: `src/entities/timetable/api/solver-transport.ts` (new `api` segment), `src/entities/timetable/api/solver-config.ts`, `src/entities/timetable/index.ts`

**Intent**: `createSolverTransport(url)` — a pure factory over `fetch`, returning `{ dispatchSolveJob(jobId, request), checkHealth() }`. `dispatchSolveJob` POSTs `canonicalizeSolveRequest(request)` (deterministic bytes for free) to `/jobs/{jobId}/solve` and resolves on 202, throwing a typed error otherwise; `checkHealth` GETs `/health`. The **separate** `solver-config.ts` reads `astro:env/server` and exposes `getSolverTransport(): SolverTransport | null` (null when unset — the `supabase.ts`/`config-status.ts` gating precedent). The factory module must not import `astro:env` (testability + the S-302 binding seam). Export both through the barrel.

**Contract**: Lives in `entities/timetable` because it consumes `SolveRequest` from the slice's wire types (FSD forbids the upward reach from `shared`). `pnpm steiger` must accept the new segment.

#### 3. mise graduation

**File**: `mise.toml`

**Intent**: Pin `uv` under `[tools]` (exact version, matching what CI's `setup-uv` installs) and add the solver task set with `dir = "services/solver"`: `solver:dev` (`uv run uvicorn cpsat_service.app:app --port 8000`), `solver:test` (`uv run pytest`), `solver:check` (`uv run ruff check && uv run mypy`). The existing `node_modules/.bin` PATH shim stays.

**Contract**: pnpm scripts remain the JS-side canon; no solver step enters `package.json` (CLAUDE.md rule). CI keeps calling `uv` directly — mise tasks are the developer front door, and drift between the two is caught by both running the same underlying commands.

#### 4. Proof-of-life integration test

**File**: `src/test/solver-transport.integration.test.ts`

**Intent**: The end-to-end guard: skipped unless `SOLVER_URL` (plus the standard stack env) is set, mirroring the `solver-credential` suite's gating (including its fail-loudly-in-CI check for a missing `SOLVER_URL` once the CI step exists). Flow: create a plan via factories → assemble a small snapshot (`assembleGeneratorSnapshot` + the `course`/`placement` builders already used by the parity test) → insert a `queued` job row as admin (`snapshot`, `snapshot_hash` via `computeSnapshotHash`, `policy`) → `createSolverTransport(process.env.SOLVER_URL).dispatchSolveJob(...)` → poll the row (narrow projection) to `succeeded` within a generous timeout → assert `result` parses as a `GenerationResult`, `started_at`/`finished_at` set → teardown.

**Contract**: This is the roadmap's proof-of-life: `queued → running → succeeded` observed through the real service, driven through the same transport function S-301 will call.

#### 5. CI wiring

**File**: `.github/workflows/ci.yml` (integration job)

**Intent**: After the supabase-stack step: provision the machine user (`SOLVER_MACHINE_PASSWORD` minted per-run, e.g. from `openssl rand`; `scripts/provision-solver-user.mjs` reads the stack's exported service-role key), set up uv (`astral-sh/setup-uv@v9.0.0` with `working-directory: services/solver` — same exact-pin caveat as the solver job), `uv sync --locked`, launch uvicorn in the background with the container env trio + the minted password (stdout/stderr redirected to a log file, with an `if: failure()` step that cats it — a background service dying mid-suite must not reduce to a bare vitest poll timeout), wait for `/health`, and export `SOLVER_URL` to `$GITHUB_ENV`. The env-isolation rule holds: everything comes from the job's own ephemeral stack, never from repo secrets.

**Contract**: `pnpm test:integration --maxWorkers=2` now includes the proof-of-life. The service must be up before vitest starts (health-poll with a timeout, not a sleep).

#### 6. Docs

**File**: `README.md`, `docs/runbooks/solver-credential.md`, `services/solver/README.md`

**Intent**: README gains a short "Running the solver service (dev)" note (provision → `mise run solver:dev` → `SOLVER_URL` in env profiles). The runbook's F-302 checklist items can now cite the implementing modules. The solver README documents the service endpoints and env.

**Contract**: Keep the S-302 checklist untouched — hosted enablement remains manual and out of scope.

### Success Criteria:

#### Automated Verification:

- `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` all green (new entity segment + env field)
- Local: with stack + service up, `pnpm test:integration src/test/solver-transport.integration.test.ts` green
- CI: full pipeline green, integration job running the proof-of-life against the spawned service
- `mise run solver:test` and `mise run solver:check` succeed from the repo root

#### Manual Verification:

- Fresh-clone dev loop: `pnpm env:local`, provision machine user, `mise run solver:dev`, trigger the integration test locally — the tier-1 story works end to end
- `pnpm env:prod` leaves `SOLVER_URL` unset (no accidental prod dispatch surface)

---

## Testing Strategy

### Unit Tests (solver lane — DB-free, every push):

- Existing 56 engine tests, unchanged, on the promoted path
- New `test_service.py`: boundary validation (jsonschema errors, never `KeyError`), 202/422 semantics, idempotent duplicate POST, CAS claim filter + narrow projections asserted at the httpx-transport layer, outcome mapping (succeeded / infeasible→failed / `PreconditionError`→failed), password re-grant on token age
- New contract assertions: `solve-request.json` gated in `test_contract.py`

### Integration Tests (stack required):

- `solver-transport.integration.test.ts`: the full `queued → running → succeeded` chain through the real service with real RLS/hook/grants — the proof-of-life, in CI
- Existing `solver-credential` and `generation-jobs` suites continue to pin the grant/RLS posture (unchanged)

### Manual Testing Steps:

1. Phase 1: confirm CI green and the `solver` job ran from `services/solver`
2. Phase 4: POST the golden request to a real queued job against the local stack; watch the row in Studio; repeat the POST and confirm no second solve
3. Phase 5: fresh dev-loop walkthrough (`env:local` → provision → `mise run solver:dev` → integration test)

## Performance Considerations

- The GIL is released during solve (measured: 56 main-thread ticks) — one uvicorn process serves `/health` during a running solve; no queue, no multiprocessing.
- Hint-free Mode A measured OPTIMAL in 0.7s on the golden catalog — feasibility probe only; **no number here becomes a budget** (S-308 owns calibration).
- Workers pinned (default 8) for reproducibility, env-overridable; never 0/auto in the service.
- Narrow projections on every job-row request avoid dragging the ~124 KB snapshot.

## Migration Notes

- No database migration. No contract schema change. No `formatVersion` bump.
- The promotion is history-preserving (`git mv`); developers re-run `uv sync` in `services/solver/`.
- Rollback of any phase is a plain revert — no persistent state is created by this change (job rows written during testing are test-owned and torn down).

## References

- Related research: `context/changes/solver-service-transport/research.md` (R1–R10 all decided; §1–§9)
- Decisions log: `context/changes/solver-service-transport/change.md`
- Credential runbook: `docs/runbooks/solver-credential.md` (F-302 checklist)
- Contract: `contracts/generation-wire.schema.json` `$defs.SolveRequest`; `contracts/README.md` (canonical form, regeneration)
- Engine seam: `services/solver/src/cpsat_engine/solve.py` (`solve_complete`, `SolveConfig`, `to_generation_result`)
- App seam precedents: `src/shared/api/supabase.ts:7-9`, `src/app/config/config-status.ts:11-19`, `astro.config.mjs:75-80`
- Roadmap item: `context/foundation/roadmap.md:95-107` (F-302)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Promotion + Python 3.13 pin

#### Automated

- [x] 1.1 Solver suite green in new location (`uv sync --locked`, `ruff check`, `pytest`)
- [x] 1.2 JS suite untouched (`pnpm test`, `pnpm check`)
- [x] 1.3 No stale `poc/cp-sat` references outside `context/`
- [ ] 1.4 Full CI run green on the branch

#### Manual

- [ ] 1.5 CI shows `solver` job from `services/solver`, still in `deploy.needs`

### Phase 2: `mypy --strict` gate — src + tests

#### Automated

- [ ] 2.1 `uv run mypy` → 0 errors over src/ and tests/
- [ ] 2.2 `uv run pytest` → 56 passing
- [ ] 2.3 `uv run ruff check` clean
- [ ] 2.4 CI solver job green with the mypy step

#### Manual

- [ ] 2.5 `Term`-touching diffs are type-only

### Phase 3: `SolveRequest` under the both-suites contract gate

#### Automated

- [ ] 3.1 `pnpm test` + `pnpm check` green with new parity assertions
- [ ] 3.2 Solver suite + mypy green with new contract tests
- [ ] 3.3 `contracts/generation-wire.schema.json` untouched
- [ ] 3.4 Golden regeneration reproduces `solve-request.json` byte-identically

#### Manual

- [ ] 3.5 Fixture eyeball: UUID-only, no display text

### Phase 4: The HTTP wrapper (`cpsat_service`)

#### Automated

- [ ] 4.1 Solver lane fully green (`ruff`, `mypy`, `pytest` incl. `test_service.py`)
- [ ] 4.2 `uv audit` clean or triaged
- [ ] 4.3 Service boots; `/health` → 200

#### Manual

- [ ] 4.4 Real local-stack solve: row observed `queued → running → succeeded`, result eyeballed
- [ ] 4.5 Duplicate POST is a no-op

### Phase 5: App seam, mise graduation, proof-of-life

#### Automated

- [ ] 5.1 `pnpm check` / `lint` / `steiger` / `test` / `build` green
- [ ] 5.2 Proof-of-life integration test green locally
- [ ] 5.3 Full CI green with the proof-of-life in the integration job
- [ ] 5.4 `mise run solver:test` and `solver:check` succeed

#### Manual

- [ ] 5.5 Fresh dev-loop walkthrough (env:local → provision → solver:dev → test)
- [ ] 5.6 `pnpm env:prod` leaves `SOLVER_URL` unset
