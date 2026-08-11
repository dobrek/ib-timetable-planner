# Solver Service Transport (F-302) — Plan Brief

> Full plan: `context/changes/solver-service-transport/plan.md`
> Research: `context/changes/solver-service-transport/research.md`

## What & Why

Promote the CP-SAT solver from `poc/cp-sat/` to `services/solver/` and give it a thin, tested HTTP wrapper: it accepts a solve job over HTTP, runs the engine on a background thread, and writes status/results durably to `generation_jobs` as the least-privilege machine user. This is the minimal enabler for every job slice — without a service that accepts a job and records its outcome, no vertical slice (S-301 onward) exists.

## Starting Point

F-301 pre-paid the foundation: the `SolveRequest` envelope is frozen in the contract, the engine's dict entry point is public, every DB column the wrapper writes exists behind an 11-column grant, and the credential flow (password grant → token hook → `solver_job_writer`) is live locally and guard-tested. The engine itself is transport-agnostic and side-effect-free. What's missing: the HTTP surface, the promotion, the `mypy --strict` gate CLAUDE.md mandates (70+38 measured errors), and any app-side transport.

## Desired End State

A developer runs the service natively (`mise run solver:dev`), the app dispatches through the env-gated `SOLVER_URL` transport, and a queued job row transitions `queued → running → succeeded` with a schema-conformant result — observed end-to-end by an integration test that runs in CI. The solver package is strict-typed, its envelope is golden-gated in both suites, and S-301/S-302 inherit clean seams (the transport factory, the job registry holding live solver handles).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Envelope & job identity | `POST /jobs/{jobId}/solve`, unmodified `SolveRequest`, jobId in path | Zero schema edit, no `formatVersion` bump; body is `additionalProperties: false` | Research |
| `policy` handling | F-302 ignores it entirely | One authoritative home (`generation_jobs.policy`); S-307 owns honouring it — engine can't accept one today anyway | Research |
| mypy --strict | Lands in F-302, early phase, `src/` **and** `tests/` | New HTTP module born under the gate; debt is measured and mechanical (`Term` fix alone removes 24/70) | Research + Plan |
| Boundary validation | jsonschema against the contract file, no Pydantic | A Pydantic model would be a third projection of a schema "owned by neither side" | Research |
| Execution model | 202 + background thread + DB as status channel | GIL release measured (solve + serve in one process); registry keeps the S-303/S-305 seam | Research |
| Idempotency | Registry guard + CAS `WHERE status='queued'` | Both free; CAS survives container restart — RLS alone permits `running → running` | Research |
| Supabase access | `httpx` only, password grant only, narrow projections | Runbook-settled; refresh grant was never verified to fire the hook | Research |
| HTTP framework | FastAPI (+ uvicorn) | Tech-stack named it; TestClient is the wrapper-level test surface FR-310 demands | Research |
| App-side cut | `SOLVER_URL` env + typed transport factory + health probe, nothing more | S-301 gets a working transport without F-302 swallowing the proving slice | Plan |
| Wrapper tests | Mocked httpx transport, DB-free solver lane | Grant/RLS behaviour is already pinned by TS integration suites; fidelity comes from the proof-of-life | Plan |
| Proof-of-life | TS integration test, wired into CI's integration job | Proves the exact chain S-301 consumes; scripts that "run when someone remembers" are the recorded POC lesson | Plan |
| mise | Pin `uv` + `solver:dev/test/check` tasks | The roadmap outcome verbatim; pnpm scripts stay JS-only per CLAUDE.md | Plan |
| Python version | 3.13 everywhere | Local and CI already run 3.13; shipping 3.12 would mean testing one thing and deploying another | Research |

## Scope

**In scope:** package promotion + all ~20 reference updates (CI is the sharp edge); Python 3.13 pin; `mypy --strict` over src+tests wired into CI; `solve-request.json` golden gated by both suites; `cpsat_service` (FastAPI: `POST /jobs/{jobId}/solve`, `GET /health`, httpx Supabase client, job registry); wrapper test suite; `SOLVER_URL` astro:env field; `createSolverTransport` factory in `entities/timetable/api`; mise pins + tasks; TS proof-of-life integration test in CI.

**Out of scope:** contract schema edits; `policy` reading; progress/checkpoints/stop/heartbeat/SIGTERM (S-303/304/305); Dockerfile & container binding (S-302); hosted hook enablement (S-302, manual by design); UI/Action/result-read (S-301); Mode B repair; budget calibration (S-308); any greedy-path change (S-309).

## Architecture / Approach

App (workerd) → `createSolverTransport(SOLVER_URL)` → `POST /jobs/{jobId}/solve` (202) → background thread: password-grant sign-in → CAS-claim the row (`status='queued'` filter) → `solve_complete` with pinned workers, `log_dir=None` → final PATCH (`succeeded`+`result`+`stages`, or `failed`+`error`). The DB row is the only status channel. The transport is a factory over a URL now, a container binding at S-302 — a deploy detail, not an architecture fork.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Promotion + 3.13 pin | `services/solver/`, CI green on new path | `ci.yml` hardcodes the path twice and gates `deploy` |
| 2. mypy --strict gate | 108 errors → 0, gate in CI before the wrapper exists | Test-side debt pricier than measured (flagged stop-point) |
| 3. SolveRequest contract gate | Golden fixture + assertions in both suites, schema untouched | Canonicalizer byte-parity across TS/Python |
| 4. HTTP wrapper | Tested FastAPI service writing real job rows | Silent no-write when sign-in fails (row stays `queued`; caught by phase 5's test) |
| 5. App seam + proof-of-life | `SOLVER_URL` transport, mise tasks, e2e test in CI | Spawning the Python service inside the pnpm-side integration job |

**Prerequisites:** F-301 merged (done); local Supabase stack with the token hook (already in `config.toml`); no hosted setup needed.
**Estimated effort:** ~3–4 sessions across 5 phases; phases 1–3 are mechanical, 4–5 carry the new code.

## Open Risks & Assumptions

- `uv audit` may surface findings in the ~78-package FastAPI stack — triage, don't skip (recorded as a criterion).
- The integration job grows a uv setup + background service; if it destabilizes the lane, the proof-of-life can temporarily gate on local runs while CI wiring is fixed (it must not be silently dropped).
- Assumes `astral-sh/setup-uv@v9.0.0` exact-pin behaviour carries to the second usage (documented caveat in `ci.yml`).

## Success Criteria (Summary)

- A queued job row transitions `queued → running → succeeded` through the real service, observed by a CI-run integration test using the same transport S-301 will call.
- The solver lane gates ruff + mypy --strict + pytest (incl. the wrapper suite) + uv audit on every push, from `services/solver/`.
- The contract directory gains one golden and zero schema edits; both parity suites stay green in the same commit.
