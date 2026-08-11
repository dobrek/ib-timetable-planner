# CP-SAT solver POC (backend-service shape)

A local, file-transport Python OR-Tools CP-SAT solver that consumes an exported
`GeneratorSnapshot` and answers the decision question the `generation-quality-tuning` follow-up
left open: **can the 5–8 h unplaced residue on the golden catalog be closed, or is it provably
infeasible?**

The package is shaped as the future service core (`schema → model → objective → solve → explain`);
only the file-based transport (`cli`) is throwaway. Full context:
`context/changes/poc-cp-sat-backend-service/{plan.md,research.md}`.

## Layout

```
services/solver/
  pyproject.toml            uv-managed; ortools + ruff + pytest + jsonschema
  .python-version           the interpreter CI and local dev share (see Setup)
  src/cpsat_engine/
    schema.py               dump JSON → typed model (opaque ids only)
    model.py                snapshot → CpModel (variables + hard rules; pure)
    objective.py            tier expressions 1–10 (mirrors objective.ts)
    solve.py                staged lexicographic runner + parity + Mode A/B
    explain.py              assumptions / conflict-set path for infeasibility
    cli.py                  file in → file out (the POC transport)
  tests/
    fixtures/seed-plan-a.json   committed, PII-free (from the CSV-seeded catalog)
  data/                     gitignored: golden dumps, results, solver logs
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
