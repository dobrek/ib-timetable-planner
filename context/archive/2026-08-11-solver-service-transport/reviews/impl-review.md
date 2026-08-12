<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Solver Service Transport (F-302)

- **Plan**: `context/changes/solver-service-transport/plan.md`
- **Scope**: Phases 1–5 of 5 (full plan)
- **Date**: 2026-08-11
- **Verdict**: NEEDS ATTENTION → all 10 findings fixed during triage (2026-08-11)
- **Findings**: 0 critical, 6 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

### Success criteria — re-run locally, all green

Solver lane: `uv sync --locked`, `ruff check`, `mypy` (22 files, 0 errors), `pytest` (78 passed at review time; 84 after triage added 6 regression tests), `uv audit` (0 vulnerabilities).
JS lane: `pnpm check` (0 errors / 738 files), `lint`, `steiger`, `test` (1559 passed / 177 files), `build`.
Service: boots, `GET /health` → 200 `{"status":"ok"}`, malformed body → 422 with jsonschema error paths.
`git grep poc/cp-sat` outside `context/` → empty. `git diff main...HEAD -- contracts/generation-wire.schema.json` → empty.

### Scope discipline

No guardrail crossed: schema untouched, no `formatVersion` bump, no `policy` read, no Dockerfile/container binding/hosted setup, no UI/Astro Action/result-read path, `runVerifiedGeneration` not relocated, no Mode B exposure, no budget changes, greedy/Web Worker path untouched.

## Findings

### F1 — Terminal write is unconditional and its effect is unobservable

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `services/solver/src/cpsat_service/runner.py:93`, `services/solver/src/cpsat_service/supabase.py:110-116`
- **Detail**: Two halves of one gap. (a) `claim()` sits inside the try at `runner.py:79`, so when it _raises_ (as opposed to returning False) the generic handler at `:93` calls `_write_failure`, and `finish()` carries no `status=eq.*` filter. (b) `finish()` sends no `Prefer: return=representation`, so PostgREST answers 204 whether it matched one row or zero; the runner logs "succeeded" either way.
- **Failure scenario**: worker A claims job J and solves for 12 minutes. A redispatch reaches worker B; B's claim PATCH draws one of the transient Kong 502s this repo already documents (`ci.yml:96-101`) → `SupabaseError` → `_write_failure` → unfiltered PATCH sets J to `failed` (RLS permits `running → failed`). A's later `finish` matches zero rows, returns 204, and A logs success. The board is gone and nothing records it.
- **Fix**: On a claim _exception_, log and return without writing — only run `_write_failure` after a confirmed claim. Add `Prefer: return=representation` to `finish()` (the `select=id` projection is already there) and raise when the returned array is empty.
  - Strength: Both edits are local; the CAS in `claim()` already demonstrates the representation-plus-projection idiom (`supabase.py:79-90`).
  - Tradeoff: `finish` gains a failure mode it did not have — the point — so `_write_failure` must stay best-effort.
  - Confidence: HIGH — `finish()` has no status filter and no Prefer header; RLS admits `running → failed`.
  - Blind spot: Not tested against a real concurrent redispatch; reasoning is from policy text and PostgREST defaults.
- **Decision**: FIXED — claim-exception path no longer writes; `finish` now uses `Prefer: return=representation` and raises on a zero-row write.

### F2 — A failed terminal write wedges the row in `running` forever

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `services/solver/src/cpsat_service/runner.py:134-147,159-168`
- **Detail**: The terminal write has no retry. If `finish(status="succeeded")` fails, `_write_failure` re-calls the same method against the same broken dependency and swallows the second failure (`:167`). `finally` releases the registry entry. The row stays `running`, and `claim()` filters `status=eq.queued` (`supabase.py:85`), so no redispatch can ever pick it up.
- **Failure scenario**: a full-catalog solve runs ~12.5 minutes (measured, per `change.md`), completes, and the single PATCH hits a 502. Result discarded, row permanently unreclaimable, recovery needs a manual admin UPDATE.
- **Fix A ⭐ Recommended**: Bounded retry with backoff (2–3 attempts) around the terminal `finish`, succeeded and failed alike.
  - Strength: Covers the realistic trigger without waiting on S-304; the client already holds a live token with 3000s of headroom.
  - Tradeoff: Adds a retry policy the module has nowhere else.
  - Confidence: HIGH — the wedge is unambiguous in the code.
  - Blind spot: Doesn't help if the container dies outright mid-write.
- **Fix B**: Leave it; let S-304's stale-heartbeat reclaim handle it.
  - Strength: Keeps F-302 minimal; the plan defers heartbeat renewal to S-304.
  - Tradeoff: Until S-304 ships, every such job is dead with no signal — and S-304 must then also widen the CAS to reclaim stale `running` rows, which is not currently in its scope.
  - Confidence: MEDIUM — depends on S-304's scope.
  - Blind spot: S-304's actual scope was not read for this review.
- **Decision**: FIXED via Fix A — bounded retry (3 attempts, 1s/4s backoff) on transient 5xx and transport errors only; deterministic failures (42501/23514/matched-no-row) are not retried. Three tests added.

### F3 — Dispatch is unauthenticated and unbound to the row, undocumented

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: `services/solver/src/cpsat_service/app.py:59-84`, `services/solver/src/cpsat_service/runner.py:114-121`
- **Detail**: `POST /jobs/{job_id}/solve` takes no credential, and `build_dump` solves the _body's_ snapshot while writing the result onto the _path's_ job row — `snapshot_hash` is never read or compared (no occurrence anywhere in `cpsat_service/`). `_json_body` also reads the raw body with no `Content-Type` check and no size cap, so a cross-origin CORS-_simple_ POST (`text/plain`) reaches the handler with no preflight.
- **Failure scenario**: anything that can reach the port and knows a live job UUID can plant a board on that row — including a page open in the developer's browser while `mise run solver:dev` is up. S-301's drift check compares against the row's `snapshot_hash`, which still describes the input the board was never derived from, so the substitution reads as consistent.
- **Context**: exposure today is small — `SOLVER_URL` is local-only and prod has no binding yet. The migration already names the row-scope half as deliberate (`20260810200931_solver_job_writer_role.sql:76-78`: "nothing yet binds a container to a job id; S-301 introduces that binding"). What is missing is any record of the _endpoint_ half: plan, research, `change.md`, both READMEs and the runbook say nothing about unauthenticated dispatch. S-302 inherits the assumption blind.
- **Fix A ⭐ Recommended**: Document the trust boundary now — a section in `services/solver/README.md` plus a `change.md` decision entry stating dispatch is unauthenticated and body-trusting, bounded by the container binding S-302 introduces, with S-301 owning the snapshot binding. Add the `Content-Type: application/json` check to `_json_body` as the one cheap hardening.
  - Strength: Matches how the migration handled the identical gap one layer down ("the honest name is the whole mitigation"), and puts the assumption where S-302 will read it. The content-type check is three lines and closes the no-preflight path.
  - Tradeoff: The gap stays open; only its visibility changes.
  - Confidence: HIGH — the precedent is in this repo.
  - Blind spot: Assumes S-302's binding really is a private container network; that hasn't been designed yet.
- **Fix B**: Bind now — after a successful claim, select `snapshot_hash` and reject the dispatch unless it matches `canonical_snapshot_json` of the body's snapshot.
  - Strength: Closes it properly; `cpsat_engine/wire.py:52` already computes the exact bytes the column digests.
  - Tradeoff: Adds a DB read the plan explicitly designed out; S-301 is the slice that owns this binding.
  - Confidence: MEDIUM — the comparison is straightforward, but whether the row's hash is populated on every dispatch path is S-301's to establish.
  - Blind spot: Interaction with warm-start-only redispatches unexamined.
- **Decision**: FIXED via Fix A — trust boundary documented in `services/solver/README.md` + a `change.md` decision entry; handler now requires `Content-Type: application/json` (415 otherwise). Snapshot binding remains S-301's.

### F4 — Unbounded thread spawn; no concurrency cap on solves

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `services/solver/src/cpsat_service/app.py:71-76`, `services/solver/src/cpsat_service/runner.py:54-63`
- **Detail**: Every accepted POST spawns an OS thread, each pinning `settings.workers` (default 8) CP-SAT workers. No semaphore, no queue, no rejection path.
- **Failure scenario**: 20 distinct queued jobs dispatched in a burst → 20 threads × 8 workers = 160 search threads, each holding up to ~21 minutes under engine defaults. `/health` — guaranteed answerable because CP-SAT releases the GIL — starts timing out under CPU starvation, so the platform probe kills a container mid-solve on 20 jobs.
- **Fix**: Gate `start_job` with a `threading.Semaphore`, or return 503 once `len(registry)` exceeds a configured max-concurrent-solves.
  - Strength: The registry already tracks exactly the live set needed.
  - Tradeoff: Introduces a rejection status the app-side transport must distinguish from a hard failure.
  - Confidence: HIGH — no cap exists anywhere in the path.
  - Blind spot: Realistic burst size depends on S-301's dispatch UX, which doesn't exist yet.
- **Decision**: FIXED — `SOLVER_MAX_CONCURRENT_JOBS` (default 1) enforced atomically inside `JobRegistry.register`; 503 past the cap. `register` now returns a `Registration` enum.

### F5 — No timeout on either app-side `fetch`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/entities/timetable/api/solver-transport.ts:47,59`
- **Detail**: `checkHealth`'s type comment promises "never throws — an unreachable solver is a state to render". A bare `fetch` with no `AbortSignal` delivers that for connection-refused but not for a wedged connection: the container accepts TCP and never answers (the containers#162 sleep behaviour CLAUDE.md flags), so `checkHealth()` never settles and the awaiting render hangs to the Worker's invocation limit — a 500 instead of the unreachable state.
- **Fix**: `signal: AbortSignal.timeout(3_000)` on `checkHealth`, a longer one on `dispatchSolveJob`.
- **Decision**: FIXED — `AbortSignal.timeout` on both fetches (3s health, 15s dispatch); `encodeURIComponent(jobId)` added on the same line.

### F6 — Registry entry leaks permanently if `start_job` throws

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `services/solver/src/cpsat_service/app.py:71-75`, `services/solver/src/cpsat_service/runner.py:96-97`
- **Detail**: `registry.register(key)` succeeds at `app.py:71`; release happens only in the _worker's_ `finally`. If `start_job` raises before the thread runs — `Thread.start()` raising `RuntimeError: can't start new thread` under the pressure of F4 — the handler 500s and the entry is stranded.
- **Failure scenario**: every later dispatch for that job returns `202 {"status": "already running"}` and starts nothing, while the row stays `queued` forever — the silent-failure class the module docstrings say they avoid. Only a restart clears it.
- **Fix**: Wrap `start_job` in try/except, `registry.release(key)`, re-raise.
- **Decision**: FIXED — `start_job` wrapped; the registry entry is released before the exception propagates. Test added.

### F7 — Import-time crash paths defeat the bare-`/health` guarantee

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `services/solver/src/cpsat_service/settings.py:75`, `services/solver/src/cpsat_service/app.py:38,115`
- **Detail**: `settings.py`'s docstring: "`/health` must answer on a bare container". Three import-time paths kill the process instead — `int()` on a non-numeric `SOLVER_WORKERS`, `basicConfig(level=...)` on an unknown `SOLVER_LOG_LEVEL`, and `_build_validator` catching only `OSError` so a truncated schema file raises `JSONDecodeError` and defeats the deliberate `None` fallback at `app.py:101-105`. Separately, `SOLVER_WORKERS=0` passes silently despite the "never 0/auto" rule at `settings.py:21-24`.
- **Fix**: Catch `(OSError, ValueError)` in `_build_validator`; soft-default the two env knobs and floor `workers` at 1.
- **Decision**: FIXED — `_positive_int` / `_log_level` degrade to defaults with a stderr complaint; `_build_validator` now catches `(OSError, ValueError)`.

### F8 — `client_factory: type[JobRowClient] | Any` opts out of `--strict`

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `services/solver/src/cpsat_service/runner.py:47,72`
- **Detail**: A union with `Any` collapses to `Any`, so the parameter and every call through it are unchecked. Phase 2 exists to make this package born strict, and this is the one place that steps out of the gate — in the seam the whole test suite drives. `cpsat_engine` uses concrete types throughout with a single documented `# type: ignore` (`solve.py:337`).
- **Fix**: `client_factory: Callable[[Settings], JobRowClient] = JobRowClient`.
- **Decision**: FIXED — `client_factory: Callable[[Settings], JobRowClient]`.

### F9 — Two minor plan deviations, one unrecorded

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/entities/timetable/model/generation/wire.ts:47-61`, `mise.toml:19-23`
- **Detail**: (a) Phase 3.1 planned `SolveRequest` in `types.ts`; it landed in `wire.ts` (justified inline — it carries a `WireSnapshot` defined there — and `types.ts` was left untouched). Sound, but `change.md`'s "Found during implementation" records the other three deviations and not this one. (b) Phase 5.3's contract was an exact `uv` pin "matching what CI's setup-uv installs". `mise.toml` pins `0.12.3`, but `ci.yml:66,169` use `astral-sh/setup-uv@v9.0.0` with no `version:` input, so CI resolves latest. The mise comment is honest about this; the plan's invariant is simply not enforced.
- **Fix**: Add (a) to `change.md`'s deviation list; for (b) either add `version: 0.12.3` to both setup-uv steps or drop the "same resolver" claim from the mise comment.
- **Decision**: FIXED — (a) recorded in `change.md`; (b) `version: "0.12.3"` pinned on both `setup-uv` steps to match `mise.toml`.

### F10 — Four in-repo claims that no longer hold

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `CLAUDE.md:34-35`, `src/entities/timetable/api/solver-config.ts:18-19,23-24`
- **Detail**: The class `context/foundation/lessons.md` warns about — prose coupled to a mechanism, not updated when the mechanism moved.
  - `CLAUDE.md:34` still says `mypy --strict` "ships with the PRD FR-315 solver CI lane — if you touch solver tooling before then, wire it up". Phase 2 shipped it; the equivalent `ci.yml` comment _was_ corrected, this one was missed. CLAUDE.md loads into every agent context.
  - `CLAUDE.md:35` says the TS projection is `types.ts` — `SolveRequest` lives in `wire.ts` (see F9).
  - `solver-config.ts:18-19` justifies deep-import-only access as "exactly as `createClient` in `shared/api` is reached" — but `createClient` _is_ barrel-exported (`src/shared/api/index.ts:4`). The placement is right and build-enforced; the cited precedent is not.
  - `isSolverConfigured` (`:24`) is exported, referenced nowhere, and its docstring calls it "the `config-status.ts` gating shape" — `configStatuses` was never given a Solver entry.
- **Fix**: Update the two CLAUDE.md sentences; correct the solver-config comment; drop `isSolverConfigured` until S-301 needs it, or add the Solver entry to `configStatuses`.
- **Decision**: FIXED — both CLAUDE.md sentences corrected; `solver-config.ts` comment corrected; `isSolverConfigured` removed.
