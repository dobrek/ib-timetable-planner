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
poc/cp-sat/
  pyproject.toml            uv-managed; ortools + ruff + pytest
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

Requires [uv](https://docs.astral.sh/uv/) (`requires-python >= 3.12`). ortools pins protobuf/numpy
tightly, so this project owns a dedicated venv — never a shared one.

```bash
cd poc/cp-sat
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
  OUT=poc/cp-sat/tests/fixtures/seed-plan-a.json pnpm experiment:export

# Golden catalog (gitignored dump under poc/cp-sat/data/):
SOURCE_PLAN_ID=<golden-plan-id> PIN_SKELETON=1 pnpm experiment:export
```

The export auto-parks zero-student courses' uncovered hours (Chemistry SL, 4 h, on the golden plan)
and logs each loudly. The dump carries `{ snapshot, greedy baseline + per-cohort lowerBound, TS
10-tier objective tuple }`.

### 2. Parity gate (Phase 3)

```bash
cd poc/cp-sat
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
IN=poc/cp-sat/data/complete.json DUMP=poc/cp-sat/data/<golden>-dump.json pnpm experiment:import
ANALYZE_PLAN_A=<clonePlanId> ANALYZE_PLAN_B=<golden-plan-id> pnpm analyze:plans
```

Verifies the CP-SAT board against `dump.snapshot`, persists into the export's clone, and prints the
gold-side-by-side comparison. The board is then viewable at `/plans/<clonePlanId>`.

## Regenerating the committed seed fixture

The fixture is a generated artifact. Regenerate after a schema/objective change with step 1's first
command, then re-run `uv run pytest`.
