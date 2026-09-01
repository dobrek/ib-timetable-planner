# CP-SAT solver service

The Python OR-Tools CP-SAT solver for IB timetable generation: a pure engine (`cpsat_engine`) plus a
thin HTTP wrapper (`cpsat_service`). The engine answers the decision question the
`generation-quality-tuning` follow-up left open — **can the 5–8 h unplaced residue on the golden
catalog be closed, or is it provably infeasible?** — and the wrapper is how the app asks it.

**The dependency runs one way.** `cpsat_service` imports `cpsat_engine`; the engine imports nothing
from the service and stays transport-agnostic and side-effect-free (`log_dir=None` writes no file
and no stdout). That is what lets the CLI, the tests, and a future queue consumer all call the same
core. The file-based `cli` transport is still the acknowledged throwaway.

## Layout

```
services/solver/
  pyproject.toml            uv-managed; ortools + fastapi + uvicorn + httpx + jsonschema
  .python-version           the interpreter CI and local dev share (see Setup)
  src/cpsat_engine/         the pure core
    schema.py               dump/contract JSON → typed model (opaque ids only)
    model.py                snapshot → CpModel (variables + hard rules; pure)
    objective.py            tier expressions 1–10 (mirrors objective.ts)
    solve.py                staged lexicographic runner + parity + Mode A/B
    wire.py                 the Python half of the canonical JSON form
    explain.py              assumptions / conflict-set path for infeasibility
    cli.py                  file in → file out (the POC transport)
  src/cpsat_service/        the HTTP wrapper
    app.py                  GET /health, POST /jobs/{jobId}/solve
    runner.py               background worker: claim → solve → write the outcome
    supabase.py             httpx job-row client (no SDK, no privileged key)
    registry.py             in-process job map: dedupe guard + the stop latch and live solver handle
    settings.py             the container's environment
  tests/
    fixtures/seed-plan-a.json   committed, PII-free (from the CSV-seeded catalog)
  data/                     gitignored: golden dumps, results, solver logs
```

## The HTTP service

| Route                      | Behaviour                                                                                                                                                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`              | `200 {"status":"ok"}`. Dependency-free — it reports the container's health, never the database's.                                                                                                                                                     |
| `POST /jobs/{jobId}/solve` | Body is an unmodified contract `SolveRequest`, sent as `application/json`. **202** on accept; **415** on any other content type; **422** with schema error paths on a bad body; **503** when `SOLVER_MAX_CONCURRENT_JOBS` solves are already running. |

The job id travels in the **path**: `SolveRequest` is `additionalProperties: false`, so it cannot
ride in the body. The body is validated against `contracts/generation-wire.schema.json` itself —
never a Pydantic projection of it, which would be a third projection of a document owned by neither
side and free to drift from both. (That anchor assumes a repo checkout: `contracts/` is not in the
wheel, so S-302's image must `COPY` it.)

A 202 means _accepted_, not _solved_. The worker runs on a background thread — sound because CP-SAT
releases the GIL, so `/health` keeps answering through a multi-minute solve — and reports by
advancing the `generation_jobs` row: `queued → running → succeeded | failed`. **The database row is
the only status channel.** A duplicate POST is idempotent: 202, and no second solve.

Since S-303 the row advances **per ladder stage**, not just at the two ends. Each stage produces two
`running → running` writes:

| When | Columns written |
| --- | --- |
| a stage starts | `stage_index` (the TIER number now running), `stage_name`, `heartbeat_at` |
| a stage completes | `stages` (the transcript so far), `heartbeat_at`, and — only when the stage actually solved — `checkpoint` (the incumbent board as a full `GenerationResult`) and `checkpoint_stage_index` |

These writes are **best-effort**: filtered `status=eq.running` so a late one can never resurrect a row
something else has moved on, and every failure is logged and swallowed rather than costing a solve
that is otherwise going fine. A stage that found nothing advances `stages` and the heartbeat but
leaves the checkpoint columns alone — an under-budgeted stage contributed nothing and the row must not
claim it did. `heartbeat_at` therefore renews per stage event, which is coarse (Mode A alone can run
300 s between renewals); finer resolution and reclaiming a stale row are S-304's.

### Trust boundary — read before exposing this service

`POST /jobs/{jobId}/solve` **takes no credential**, and the solve is **not bound to the row**: the
engine runs the snapshot in the _body_ and writes the board onto the job named in the _path_, without
ever reading that row's `snapshot` or `snapshot_hash`. Anything that can reach the port and knows a
live job UUID can therefore plant a result on it — and because the row's hash still describes the
input the board was never derived from, the substitution reads as internally consistent downstream.

This is deliberate for F-302 and matches the posture the credential migration already takes one layer
down (`Solver reads any job … using (true)` — "nothing yet binds a container to a job id; S-301
introduces that binding and is where this predicate can narrow"). What holds it safe is **where the
port is**, not what the handler checks:

- **Local dev** — bound to loopback, reached only by the developer's own stack. The one browser-side
  path is closed here: the handler requires `Content-Type: application/json` (415 otherwise), which
  is not a CORS _simple_ type, so a cross-origin page must preflight — and no preflight is answered.
- **Production** — S-302 reaches the container through a Cloudflare container binding, not a public
  URL. **That binding is the authentication.** If the service is ever given a routable address, it
  needs a real caller credential first; do not treat the current handler as safe on the open internet.
- **The snapshot binding is S-301's**, alongside the result-read path and its drift check: after a
  successful claim, compare the row's `snapshot_hash` against `canonical_snapshot_json` of the body's
  snapshot (`cpsat_engine/wire.py`) and refuse the dispatch on a mismatch.

### Environment

| Variable                     | Default                           | Notes                                                                                             |
| ---------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`               | —                                 | Project URL.                                                                                      |
| `SUPABASE_KEY`               | —                                 | The **publishable** key. Never a secret/service key.                                              |
| `SOLVER_MACHINE_PASSWORD`    | —                                 | The machine Auth user's password.                                                                 |
| `SOLVER_MACHINE_EMAIL`       | `solver@ib-timetable-planner.dev` |                                                                                                   |
| `SOLVER_WORKERS`             | `8`                               | Pinned for reproducibility — never `0`/auto.                                                      |
| `SOLVER_MAX_CONCURRENT_JOBS` | `1`                               | Solves allowed at once; further dispatches get a 503. Raise only with the container sized for it. |
| `SOLVER_LOG_LEVEL`           | `INFO`                            | Below INFO hides the lost-claim line, which the row does not record.                              |
| `SOLVER_STAGE_TARGETS`       | _empty_                           | `tier=value[,tier=value]`, e.g. `3=95,6=900`. Stops those ladder stages once the objective reaches the value instead of burning the budget; tiers outside 2–10 and malformed entries are dropped with a stderr complaint. Empty = pre-S-303 behaviour exactly. Shipping production values is S-308's. |

Missing Supabase values do not block startup (`/health` must answer on a bare container); the first
job fails loudly instead. Full credential story: `docs/runbooks/solver-credential.md`.

```bash
mise run solver:dev     # uvicorn on :8000
mise run solver:test    # pytest
mise run solver:check   # ruff + mypy --strict
```

## Setup

Requires [uv](https://docs.astral.sh/uv/). ortools pins protobuf/numpy tightly, so this project owns
a dedicated venv — never a shared one.

Two version knobs, and they now say the same thing: `requires-python = ">=3.13"` in `pyproject.toml`
is the compatibility floor and `.python-version` pins the interpreter this package is actually
developed and tested on. Without the pin, uv takes whatever Python the host happens to offer — CI's
`solver` job silently used the runner's system CPython 3.12 while local dev ran 3.13. Nothing broke,
but a solver package whose entire premise is a tightly pinned dedicated venv should not leave its
interpreter to chance — and a floor one minor below the pin would mean testing on 3.13 while the
production image is free to ship 3.12. The image base is `python:3.13-slim` when S-302 writes it.

What the pin does **not** control is the patch level: uv resolves the newest available 3.13, so CI
may sit on a later patch than your machine. That is why the pytest run can report a couple of
dependency-internal `DeprecationWarning`s (currently `Bitwise inversion '~' on bool`, raised at
import time inside ortools' loader) in CI and not locally — the deprecation was backported into
recent CPython patch releases, so its presence tracks the interpreter build, not our code. It is a
forward-compat notice, it does not affect any result, and the fix is upstream.

```bash
cd services/solver
uv sync            # creates .venv (gitignored), writes uv.lock (committed)
uv run pytest      # unit pins
uv run ruff check .
```

## Runbook

All commands assume the local Supabase stack is up (`pnpm exec supabase start`; `pnpm env:local`)
and are run from the repo root unless noted. The golden export clone **must survive** until import —
never `supabase db reset` mid-campaign (the dump records its `clonePlanId`).

### 1. Export (TS → dump JSON)

```bash
# Committed seed fixture (PII-free, from CSV-seeded catalog):
SOURCE_PLAN_ID=c43c5f07-9448-5ab2-ad54-358f59403585 PIN_SKELETON=1 \
  OUT=services/solver/tests/fixtures/seed-plan-a.json pnpm experiment:export

# Golden catalog (gitignored dump under services/solver/data/):
SOURCE_PLAN_ID=<golden-plan-id> PIN_SKELETON=1 pnpm experiment:export
```

The export auto-parks any zero-student course's uncovered hours (a phantom-course guard) and logs
each loudly. On the golden plan **as currently configured this is a no-op** — Chemistry SL was
re-attributed to its real roster during Phase 1, so no course has an empty roster and the dump
records `meta.autoParked: []`. The dump carries `{ snapshot, greedy baseline + per-cohort
lowerBound, TS 10-tier objective tuple }`.

### 2. Parity gate (Phase 3)

```bash
cd services/solver
uv run cpsat --input data/<golden>-dump.json --output data/parity.json --mode parity   # expect 10/10
```

Fixed-hint solve reproducing the dump's TS tuple exactly, all ten tiers. **Blocks** optimization
work while any mismatch exists.

### 3. Mode A — completeness (Phase 4, the headline)

```bash
uv run cpsat --input data/<golden>-dump.json --output data/complete.json --mode complete
```

SAT → the residue is closable; the run chains into the staged ladder from tier 2 (this is the G2
measurement and the import board). INFEASIBLE → `explain.py` reports the conflict set. UNKNOWN
(budget timeout) → extend the budget, then fall back to `--mode full`.

### 4. Full staged ladder (Phase 4, fallback only on Mode A UNKNOWN)

```bash
uv run cpsat --input data/<golden>-dump.json --output data/full.json --mode full
```

### 5. Mode B — residual repair (Phase 4)

```bash
uv run cpsat --input data/<golden>-dump.json --output data/repair.json --mode repair
```

1-hop conflict-graph neighbourhood of the greedy unplaced courses, pins frozen; `--hops 2` to
escalate an infeasible residual.

### 6. Import (dump + result → verify → persist → analyze) (Phase 5)

```bash
IN=services/solver/data/complete.json DUMP=services/solver/data/<golden>-dump.json pnpm experiment:import
ANALYZE_PLAN_A=<clonePlanId> ANALYZE_PLAN_B=<golden-plan-id> pnpm analyze:plans
```

Verifies the CP-SAT board against `dump.snapshot`, persists into the export's clone, and prints the
gold-side-by-side comparison. The board is then viewable at `/plans/<clonePlanId>`.

## Regenerating the committed seed fixture

The fixture is a generated artifact. Regenerate after a schema/objective change with step 1's first
command, then re-run `uv run pytest`.
