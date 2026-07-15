# POC: Local Python CP-SAT Solver (Backend-Service Shape) — Implementation Plan

## Overview

Build a local, file-transport Python CP-SAT solver POC under `poc/cp-sat/` that consumes an
exported `GeneratorSnapshot` JSON, encodes the **full** hard-rule set and **all 10** lexicographic
objective tiers, warm-starts from the greedy board, and answers the decision question the
`generation-quality-tuning` follow-up left open: **can the 5–8 h unplaced residue be closed, or is
it provably infeasible?** Either answer ends the current ambiguity — a "closes it" answer
justifies the backend-service conversation; a "proves infeasible" answer redirects the work to
data/rules. The Python package is shaped as the future service core (schema → model → objective →
staged solver → CLI); only the file transport is throwaway.

Source research: `context/changes/poc-cp-sat-backend-service/research.md` (same commit as this
plan's baseline, `b55fabf` — all file:line references are current).

## Current State Analysis

- The tuned greedy engine leaves a 5–8 h unplaced residue on the golden catalog at the 20 s
  budget; teacher gap-slots stall at 217 (bar ≤ 148, expert 74) because the lexicographic search
  spends its budget on tier 1 while it is non-zero
  (`context/archive/2026-07-12-generation-quality-tuning/analysis-run-2.md`).
- An unplaced hour is currently **ambiguous** — search failure and genuine infeasibility are
  indistinguishable. CP-SAT resolves this either way (a complete board, or an INFEASIBLE proof
  plus a conflict set).
- **Everything the POC needs already exists**: the JSON-safe, PII-free wire format
  (`GeneratorSnapshot`, `src/entities/timetable/model/generation/types.ts:26-35`), the export seam
  (`bench/generation.experiment.ts:76-97`), the engine-free judge
  (`verifyGeneration`, `verify.ts:51`), the persist path (`apply_generated_placements` RPC), and
  the gold comparison (`pnpm analyze:plans`). The objective module is star-exported from the
  entity barrel (`src/entities/timetable/index.ts:23`), so bench code can compute the TS tier
  tuple with zero app changes.
- **No Python exists in the repo.** A top-level `poc/` dir is invisible to steiger (scans `src/`
  only), `pnpm build`, and `pnpm test` — but **not** to prettier: `.prettierignore` doesn't cover
  it, so `pnpm format` and the lefthook pre-commit hook (staged `*.{json,md}`) would reformat the
  committed fixture JSON and README. Phase 1 adds a `poc/` ignore entry. ESLint ignores follow
  `.gitignore` (`includeIgnoreFile`), so the gitignored `data/`/`.venv/` dirs are safe; no `.ts`
  is planned under `poc/`.
- **Golden-plan data quirk (user-reported 2026-07-15)**: the golden plan has 4 unset hours on
  Chemistry SL, a course with **zero enrolled students** — in practice the expert board is fully
  set. Left untreated this corrupts the residue gate, the expert comparison, and (worst case) an
  infeasibility memo. Handled by auto-parking at export (see Critical Implementation Details).
- The 2026-07-11 WASM spike's "no" is stale (single-threaded, unhinted, symmetric slot-min
  encoding); the one informative measurement — dp1 warm-started 90 s → 49 slots, proven bound 46 —
  says to expect best-found on slots, never proofs. Clique lower bounds were measured in the
  research follow-up: golden 46/41, seed 48/45 (dp1/dp2).

## Desired End State

A `poc/cp-sat/` uv-managed Python package whose encoding is **proven equivalent** to the TS
oracle/analyzer (exact 10-tier parity on the greedy board), a measurement campaign executed on the
golden catalog (Mode A completeness, full 10-tier staged ladder, Mode B residual repair), the best
CP-SAT board persisted and analyzed side-by-side with the expert plan, and
`context/changes/poc-cp-sat-backend-service/results.md` recording the comparison, explicit
pass/fail per decision gate, and a written **go/no-go recommendation** on the backend service.

Verification at end state:

- `uv run pytest` and `uv run ruff check .` green inside `poc/cp-sat/`.
- `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm steiger`, `pnpm build` all stay green (the POC is
  invisible to app gates; the two new bench experiments type-check and lint).
- `results.md` exists with gate verdicts; the CP-SAT board is viewable in-app on a local clone.

### Key Discoveries:

- `bench/generation.experiment.ts:58-104` — the harness flow to mirror (clone → pin → snapshot →
  run → verify → persist → analyze); the export seam is between `:76` and `:97`; `persistRegion`
  (`:180-207`) states each cell's complete final content, so pins must be passed as survivors.
- `src/entities/timetable/model/generation/types.ts:71-88` — diagnostics already anticipate this
  engine: `engine: "cp-sat"`, `provenOptimal`, `lowerBound`.
- `types.ts:16-23` — `parkedCourseIds` is a **multiset**; each entry covers one required hour;
  deficits = required − pins − parked, clamped per course (`deficits.ts:15-27`). This is the
  app-native mechanism for the Chemistry SL phantom hours.
- `vitest.experiment.config.ts:19` — include glob is `bench/**/*.experiment.ts`, so **every**
  experiment file is collected on one run; new experiments need dedicated package scripts with a
  file filter to avoid triggering `generation.experiment.ts` (which activates whenever
  `SOURCE_PLAN_ID` is set).
- `objective.ts:27-38` + `analysis/lanes.ts:66-76` — the tier semantics carry deliberate
  week/lane asymmetries (see Critical Implementation Details); the module is engine-agnostic by
  design and star-exported from the barrel.
- `.gitignore:70-74` — the existing golden-dump pattern is `.sql`-only; a `.json` dump would NOT
  be caught. New ignore entries are required before the first golden export.
- Python OR-Tools: `ortools 9.15.6755` ships macOS arm64 wheels (Python 3.9–3.14); warm start =
  `add_hint`; lexicographic = sequential solves; assumptions API extracts conflict sets but
  requires `num_workers = 1`. Tight `protobuf`/`numpy` pins → dedicated uv venv.

## What We're NOT Doing

- **No app changes**: no UI, no engine registration, no worker-protocol changes, no new entity
  code. The app never learns this POC exists.
- **No HTTP service, no deployment, no Cloudflare Containers work** — the POC only preserves the
  package/transport split so that door stays open.
- **No `mise.toml` Python pin** — uv-only, per the recorded decision; promote only if the POC
  graduates.
- **No CI wiring for the Python package** — local-only tooling, like the rest of `bench/`.
- **No hosted-Supabase access** — the bench harness already refuses non-local hosts
  (`bench/local-supabase.ts:13-34`); everything runs against the local stack.
- **No committed golden-catalog dumps** — golden exports are production-derived and land only in
  the gitignored `poc/cp-sat/data/`. Only the seed-catalog fixture (from committed CSVs) is
  committed.
- **No greedy-engine changes** and no re-tuning; greedy is the baseline, not the subject.
- **No backend-service design doc** — the go/no-go recommendation in `results.md` is the output;
  service design gets its own frame/plan if the answer is "go".
- The Polish infeasibility memo is **conditional scope** — built only if Mode A returns
  INFEASIBLE; it is not a phase.

## Implementation Approach

Files are the transport: a TS export experiment dumps `{snapshot, greedy baseline, TS objective
tuple}` as JSON; the Python CLI reads it, solves, and writes a `GenerationResult`-shaped JSON; a
TS import experiment verifies, persists, and analyzes that result through the exact pipeline the
greedy engine uses. The Python package is transport-agnostic from day one (the CLI is a thin
wrapper over `solve.py`), matching the research §7 reuse layout.

Encoding fidelity is the plan's central risk, so it is de-risked in order: hard rules first
(pytest structural pins on the committed seed fixture), then the 10 objective tiers, then a
**blocking parity gate** — fix the greedy board via hints and demand the Python model reproduce
the TS-computed objective tuple **exactly, all 10 tiers**, before any optimization claim is made.
The export includes the TS tuple precisely so this gate has a machine-readable target.

Measurement protocol (user decisions, 2026-07-15): full 10-tier ladder is first-class with
generous per-stage budgets; Mode B always runs; single run per mode/stage with fixed seed and
captured solver config + search logs (Mode A's outcomes are self-certifying — a complete board is
re-checked by the TS oracle, INFEASIBLE is a proof); deliverable is `results.md` with gate
verdicts and a go/no-go.

Python package layout (research §7):

```
poc/cp-sat/
  pyproject.toml          # uv-managed; ortools + ruff + pytest
  README.md               # runbook: export → parity → modes → import
  src/cpsat_engine/
    schema.py             # dump JSON → typed model (mirrors types.ts, opaque IDs only)
    model.py              # snapshot → CpModel (variables + hard rules; pure)
    objective.py          # tier expressions 1–10 (mirrors objective.ts semantics)
    solve.py              # staged lexicographic runner + parity mode + Mode B
    explain.py            # assumptions/conflict-set path for infeasibility
    cli.py                # file in → file out (the POC transport)
  tests/
    fixtures/seed-plan-a.json   # committed, PII-free (from CSV-seeded catalog)
  data/                   # gitignored: golden dumps, results, solver logs
```

## Critical Implementation Details

**Week/lane asymmetries are the one encoding trap.** Tiers 2 (`holes`), 3 (`totalSlots`), and
5 (`softHits`) are **week-agnostic** (union across lanes; a `both` placement counts once); tiers
4/6/7/8/9 **fan `both` into lanes** (`analysis/lanes.ts:76`); the duplicate-row key has **no week
component** (`verify.ts:250-251`), so a course occupies at most one row per `(cohort, day,
period)` even across lanes; teacher-day-shape (R2) unions periods across **both cohorts** per
(teacher, day, lane) (`teacher-day-shape.ts:25-47`). Mirror `objective.ts`/`verify.ts` literally —
the parity gate exists to catch exactly these divergences, and pytest toy cases should pin each
asymmetry individually so a parity failure localizes.

**Delta semantics collapse on a clean pin set.** The three warn-kinds (stacking, split,
teacher-day-shape) are hard per (entity, lane) _except_ lanes the pins already breach; blocking
kinds have no pin tolerance at all (`verify.ts:111-121, 158-168, 210-226`). The POC encodes all of
them as plain hard constraints and **asserts the pins-only precondition before solving** (mirror
of `run.ts:25-26`) — otherwise infeasibility reports blame the wrong thing.

**Tiers and cross-row constraints range over the merged board — pins included.** The TS scorer's
`boardRows` is pins + generated of both cohorts (`objective.ts:116-133`): softHits counts pinned
rows' co-teachers, teacher/student-hole spans include pinned periods. Same on the constraint side:
early-finish-edge is blocking with **no** pin tolerance, so generated rows must not sandwich a
_pinned_ flagged row (golden dp2 carries 9 flagged courses; the skeleton pins
Advisory/CAS/EE/SSSTS). Encode pins as constants _inside_ tier expressions and cross-row
constraints (day-shape span/streak, sandwich, softHits) — not merely as cell occupancy.

**Phantom-course auto-parking (user decision).** At export, any course whose expanded roster is
empty gets its uncovered hours appended to `parkedCourseIds` (one entry per hour). The export
**asserts** the zero-student fact from the loaded catalog and logs each exclusion loudly (course
id, cohort, hours parked); `results.md` records the transformation. Currently this is Chemistry SL
(4 h) on the golden plan. The greedy baseline runs on the same transformed snapshot, so all
engines are compared on identical terms and the acceptance-run numbers are re-based automatically.

**Experiment collection collision.** `vitest.experiment.config.ts` collects
`bench/**/*.experiment.ts` in one run, and `generation.experiment.ts` activates whenever
`SOURCE_PLAN_ID` is set — the very variable the export needs. New package scripts must pass an
explicit file filter: `experiment:export` / `experiment:import` = `vitest run --config
vitest.experiment.config.ts bench/<file>`. Never run the export via bare
`pnpm experiment:generation`.

**Parity mechanics.** `fix_variables_to_their_hinted_value = True` is used **exactly once** — for
the parity check — never during optimization stages. Parity expects `FEASIBLE` plus exact equality
of all 10 tier values against the dump's TS tuple. During staged solves, each stage hardens with
`model.add(tier_k <= best_k)` — **never `==`** (a later stage may improve an earlier best-found
tier for free) — then `clear_hints()` + re-hint the current incumbent.

**Assumptions require `num_workers = 1`**, and the returned conflict set is minimized but not
guaranteed minimal (run a deletion-based shrink loop only if the memo branch fires). The
alternative framing — soften completeness per course-hour, minimize relaxation literals — doubles
as "maximum completable subset" and is the fallback if the assumptions path is slow.

**Inject the clique bounds as redundant cuts.** The dump's greedy diagnostics carry per-cohort
`lowerBound`; add `totalSlots_cohort >= lowerBound` in the tier-3 stage. On seed dp1 the clique
bound (48) is stronger than the dual bound CP-SAT proved for itself in the old spike (46) — free
strength the solver demonstrably does not find alone.

**Cross-run identity.** The export's clone owns the course UUIDs the CP-SAT result references, so
the dump's `meta` must record `clonePlanId` + `sourcePlanId`, the import experiment must persist
into **that same clone**, and the local DB must not be reset between export and import.

## Phase 1: Export Seam + Repo Plumbing

### Overview

Everything needed to hand a solvable instance to Python: the export experiment (with
phantom-course auto-parking and the TS objective tuple), gitignore coverage, package scripts, the
committed seed fixture, and the uv package skeleton.

### Changes Required:

#### 1. Gitignore + prettierignore coverage for POC artifacts

**File**: `.gitignore`, `.prettierignore`

**Intent**: Golden-catalog dumps are production-derived and must never be committable; Python
tooling droppings shouldn't show up in `git status`; prettier (via `pnpm format` and the lefthook
pre-commit `*.{json,md}` hook) must not reformat the committed seed fixture or the uv README.

**Contract**: New `.gitignore` entries: `/poc/cp-sat/data/`, `/poc/cp-sat/.venv/`,
`__pycache__/`, `.pytest_cache/`, `.ruff_cache/`. New `.prettierignore` entry: `poc/`. Committed
exceptions stay implicit (the seed fixture lives under `poc/cp-sat/tests/fixtures/`, outside the
gitignored paths).

#### 2. Snapshot export experiment

**File**: `bench/export-snapshot.experiment.ts` (new)

**Intent**: Mirror the harness flow of `generation.experiment.ts` up to (not including) persist,
then write a JSON dump instead: clone catalog-only → optional `PIN_SKELETON=1` fixture copy →
load pins → assemble snapshot → **auto-park zero-student courses' uncovered hours** (assert the
roster is empty, log loudly) → run greedy on the transformed snapshot → verify → compute the TS
objective tuple for the merged greedy board via the barrel-exported scorer → write the dump.
Scorer contract: call `scoreCandidate(snapshot, generated, remaining)` **fresh** with the default
`tiers` (full 10 — a search-prefix-scored `Candidate` carries zeros in tiers 7–10,
`objective.ts:43-46, :69`), where `remaining` is built from the greedy outcome's per-cohort
unplaced deficits — tier 1 is read from that map alone, never recomputed from placements
(`objective.ts:123-139`).
Env: `SOURCE_PLAN_ID`, `PIN_SKELETON`, `BUDGET_MS`, `OUT` (default
`poc/cp-sat/data/<sourcePlanId>-dump.json`). Extract the auto-park derivation as a pure,
co-located-tested helper (`bench/*.test.ts` files are collected by `pnpm test`).

**Contract**: The dump shape is the Python package's input contract (other phases depend on it):

```jsonc
{
  "formatVersion": 1,
  "meta": {
    "sourcePlanId": "…",
    "clonePlanId": "…",
    "exportedAt": "…",
    "pinSkeleton": true,
    "autoParked": [{ "cohort": "dp2", "courseId": "…", "hoursParked": 4 }],
  },
  "snapshot": {
    /* GeneratorSnapshot, verbatim, post-transformation */
  },
  "greedy": {
    "placements": [
      /* GeneratedPlacement[] */
    ],
    "diagnostics": {
      /* incl. per-cohort lowerBound */
    },
  },
  "objective": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] /* TS 10-tuple for the merged greedy board */,
}
```

UUIDs only — names, levels, and flags never enter the dump (they aren't in the snapshot type to
begin with; keep it that way).

#### 3. Dedicated experiment scripts

**File**: `package.json`

**Intent**: Run the new experiments without triggering `generation.experiment.ts` (see Critical
Implementation Details).

**Contract**: `"experiment:export": "vitest run --config vitest.experiment.config.ts
bench/export-snapshot.experiment.ts"`; `"experiment:import"` added in Phase 5 with the same
pattern.

#### 4. Committed seed fixture

**File**: `poc/cp-sat/tests/fixtures/seed-plan-a.json` (new, generated artifact)

**Intent**: The PII-free pytest target: run the export against seed Plan A (CSV-derived catalog,
local stack) with `PIN_SKELETON=1` and commit the dump. All Python unit pins run against this
file.

**Contract**: Exactly the dump shape above; regeneration command documented in
`poc/cp-sat/README.md`.

#### 5. Python package skeleton

**File**: `poc/cp-sat/pyproject.toml`, `poc/cp-sat/README.md`, `poc/cp-sat/src/cpsat_engine/*.py`
(module stubs), `poc/cp-sat/tests/` (new)

**Intent**: A uv-managed project isolated from any shared env (ortools pins `protobuf`/`numpy`
tightly): `requires-python >= 3.12`, `ortools` pinned to the current 9.15 line, `ruff` + `pytest`
as dev dependencies, `uv.lock` committed. README documents the full runbook (export → parity →
Mode A → ladder → Mode B → import) with copy-pasteable commands.

**Contract**: `uv run pytest` and `uv run ruff check .` work from `poc/cp-sat/`; a trivial
smoke test (import the package, parse the fixture header) passes.

### Success Criteria:

#### Automated Verification:

- `pnpm check` passes (after `astro sync`) — the type gate, never build/lint as proxy
- `pnpm lint` and `pnpm test` pass (export helper unit test included)
- `SOURCE_PLAN_ID=<seed-plan-a> PIN_SKELETON=1 pnpm experiment:export` produces a dump (local stack up)
- `cd poc/cp-sat && uv run pytest && uv run ruff check .` green

#### Manual Verification:

- Golden export (`PIN_SKELETON=1`) lands under `poc/cp-sat/data/` and `git status` stays clean
- Golden export log shows Chemistry SL auto-parked (4 h) with the zero-student assertion passing
- Dump inspection: UUID-only, no name-like strings; `objective` tuple present; `lowerBound` present per cohort

**Implementation Note**: After completing this phase and all automated verification passes, pause
for manual confirmation before proceeding.

---

## Phase 2: Python Schema + Hard-Rule Encoding

### Overview

`schema.py` (dump JSON → typed model) and `model.py` (variables + all nine hard rules + pins-only
precondition), pinned by pytest against the seed fixture.

### Changes Required:

#### 1. Typed schema

**File**: `poc/cp-sat/src/cpsat_engine/schema.py`

**Intent**: Parse the dump into frozen dataclasses mirroring the snapshot's own domain shapes
(opaque IDs, no display concerns — the port-the-mechanism lesson). Derive per-course deficits
(required − pins − parked, clamped at 0 per course) and reject unknown `formatVersion`.

**Contract**: One dataclass per wire type (`Snapshot`, `CohortSnapshot`, `Course`, `Placement`,
`AvailabilityCell`, `Dump`); `load_dump(path) -> Dump`; deficits exposed as
`dict[(cohort, course_id), int]`.

#### 2. Model builder — variables and hard rules

**File**: `poc/cp-sat/src/cpsat_engine/model.py`

**Intent**: Pure snapshot → `CpModel` builder. Variables: one boolean per generated row
`(cohort, course, day, period, weekOption)` where `weekMode: "agnostic"` admits only
`week = "both"` and `"biweekly"` only `{a, b}`; pins are folded in as constants, never variables.
Encode the full hard-rule inventory from the research §3 table: per-course placement count ≤
deficit (tier 1 measures the shortfall), ≤ 1 row per (course, cell) across lanes, teacher
AtMostOne per (teacher, day, period, lane) **pooling both cohorts' literals** (this subsumes
cross-cohort-teacher), student AtMostOne per (student, day, period, lane), strong-unavailability
literals fixed to 0, early-finish-edge reification (`p ≤ min(others) ∨ p ≥ max(others)` per
flagged course × student × day × lane, per `early-finish-edge.ts:27-73`), course-day stacking
(≤ 2 periods per course-day-lane), course-day split (the 2 periods must be adjacent), and
teacher-day-shape (span ≤ 8 via min/max IntVars, streak ≤ 6 via sliding 7-window sums, periods
unioned across both cohorts). Soft unavailability is **not** a constraint — it is tier 5.
Assert the pins-only precondition (pins alone violate nothing) before returning.

**Contract**: `build_model(dump) -> ModelBundle` where the bundle carries the `CpModel`, the
variable index, and named constraint-group handles (needed later for assumptions in `explain.py`).
Expose structural stats (variable count, constraints per rule group) for tests and logs.

#### 3. Encoding pins

**File**: `poc/cp-sat/tests/test_schema.py`, `poc/cp-sat/tests/test_model.py`

**Intent**: Localize future parity failures. Pin on the seed fixture: schema round-trip (parse →
re-serialize → deep-equal), deficit derivation (including parked coverage), variable count within
the expected envelope, per-rule constraint-group counts, precondition detection (mutate a pin to
collide → assertion fires), zero-student parking respected (no variables for parked hours).

**Contract**: Plain pytest, no solver invocations (model _construction_ only — fast).

### Success Criteria:

#### Automated Verification:

- `cd poc/cp-sat && uv run pytest` green (schema + model pins)
- `uv run ruff check .` clean

#### Manual Verification:

- Model stats on the **golden** dump print sane numbers (~4–9 k booleans per the research envelope; both cohorts present)

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Objective Tiers 1–10 + Encoding-Parity Gate

### Overview

All ten tier expressions mirroring `objective.ts` exactly, then the blocking gate: the fixed-hint
parity check must reproduce the TS tuple for the greedy board — exact, 10/10 — on both the seed
fixture and the golden dump.

### Changes Required:

#### 1. Tier expressions

**File**: `poc/cp-sat/src/cpsat_engine/objective.py`

**Intent**: One linear expression (over auxiliary reified variables where needed) per tier,
mirroring `objective.ts:27-38` semantics literally: `unplacedTotal` (Σ deficits − placed),
`holes` (cohort interior holes, week-agnostic union), `totalSlots` (distinct occupied cells,
week-agnostic), `teacherHoles` (span − count per teacher-day-**lane**, both cohorts),
`softHits` (per row × co-teacher on a soft cell, week-agnostic), `studentHoles` (span − count per
student-day-lane), `doublesDeficit` (`max(0, singles − hours mod 2)` per course-lane),
`lateStarts` (first occupied period − 1 per cohort-day-lane), `fridayTail` (last occupied period
on the last day per cohort-lane), `goldenBandDistance` (re-detect golden cells — ≥ 90 % roster
coverage in every lane, `GOLDEN_MISS_SHARE = 0.1` — distance to band P4–P7, count-neutral).

**Contract**: `build_tiers(bundle) -> list[TierExpr]` ordered 1–10, each carrying a name and its
linear expression; tier semantics documented against their `objective.ts` line refs.

#### 2. Parity mode

**File**: `poc/cp-sat/src/cpsat_engine/solve.py` (first slice)

**Intent**: `parity(dump)` — hint every variable to the greedy board,
`fix_variables_to_their_hinted_value = True`, solve, require `FEASIBLE`/`OPTIMAL`, evaluate all
ten tier expressions on the fixed solution, compare to `dump.objective` element-wise. Any mismatch
reports the tier name and both values. This is the **gate** for everything downstream.

**Contract**: `parity(dump) -> ParityReport` (pass/fail + per-tier pairs); exposed via
`cli.py --mode parity` in Phase 4 but callable from pytest now.

#### 3. Tier pins and toy cases

**File**: `poc/cp-sat/tests/test_objective.py`

**Intent**: The parity check on the seed fixture **is** a pytest test (exact tuple match). Plus
hand-built micro-snapshots pinning each asymmetry individually: a `both`-lane placement counted
once in tiers 2/3/5 but fanned in 4/6, the duplicate-row key ignoring week, `doublesDeficit`'s
`hours mod 2` handling, golden-band count-neutrality, teacher-day-shape's cross-cohort union, and
a pinned-row case (a pin contributing to spans/softHits and sandwich-protected for early-finish).

**Contract**: Plain pytest; the micro-snapshots are constructed in-code (no fixture files).

### Success Criteria:

#### Automated Verification:

- `cd poc/cp-sat && uv run pytest` green — including the seed-fixture parity test (10/10 exact)
- `uv run ruff check .` clean

#### Manual Verification:

- Parity run on the **golden** dump: 10/10 tiers match the TS tuple exactly

**Implementation Note**: This gate **blocks** Phase 4+ — do not proceed with any optimization work
while parity mismatches exist. Pause for manual confirmation.

---

## Phase 4: Staged Lexicographic Solver + CLI (Modes A & B)

### Overview

The staged ladder over all ten tiers, Mode A (completeness feasibility + infeasibility
explanation), Mode B (1-hop residual repair), and the file-transport CLI emitting
`GenerationResult`-shaped JSON.

### Changes Required:

#### 1. Staged runner

**File**: `poc/cp-sat/src/cpsat_engine/solve.py`

**Intent**: `solve_staged(dump, config)`: for each tier k in 1..10 — set the objective to tier
k's expression, hint the current incumbent (`clear_hints()` + `add_hint(...)`), solve with the
per-stage budget, record `{status, best, bound, wall_clock}`, harden `tier_k ≤ best_k`, continue.
Inject the per-cohort clique cuts (`totalSlots_cohort ≥ diagnostics.lowerBound`) at the tier-3
stage. Defaults: `num_workers = 0`, fixed `random_seed`, `log_search_progress = True` teed to a
log file per stage. Config (stage budgets, seed, workers) is a dataclass fed by CLI flags;
defaults 120 s/stage (user decision: all tiers first-class at generous budgets).

**Contract**: Returns the final board + a per-stage report (the measurement-(c) artifact). The
incumbent after stage 10 is the result board.

#### 2. Mode A — completeness

**File**: `poc/cp-sat/src/cpsat_engine/solve.py`, `poc/cp-sat/src/cpsat_engine/explain.py`

**Intent**: `solve_complete(dump, config)`: constrain every deficit fully placed (no objective),
feasibility solve at the Mode A budget (default 300 s, `num_workers = 0`). Three outcomes:
**SAT** → completeness is proven closable; fix `unplacedTotal = 0` and hand the incumbent to the
staged ladder (which then starts at tier 2). **INFEASIBLE** → `explain.py` path: re-solve with
enforcement literals on named constraint groups as assumptions, `num_workers = 1`, report the
conflict set (deletion-shrink loop only if the memo branch fires); also run the relaxation
framing (soften per-course-hour completeness, minimize relaxations) to name the maximum
completable subset. **Budget timeout** → report ambiguity honestly (best residue found, no
proof); this outcome triggers the investigate-with-longer-budget path, not a protocol change.

**Contract**: `solve_complete` returns a tagged outcome (`complete | infeasible | unknown`) with
its evidence; the CLI maps it into diagnostics (`provenOptimal` semantics per `types.ts:77`).

#### 3. Mode B — residual repair

**File**: `poc/cp-sat/src/cpsat_engine/solve.py`

**Intent**: `solve_repair(dump, config)`: compute the 1-hop conflict-graph neighbourhood of the
greedy result's unplaced courses (any placed course sharing ≥ 1 student or ≥ 1 teacher — the same
edge definition as `problem.ts:163-176`); freeze every other greedy row as a constant (fixture
pins always frozen); solve the residual for completeness then teacherHoles at a short budget.
`--hops 2` escalation flag for the infeasible-residual case.

**Contract**: Same result shape as the full solve; the report labels the mode and neighbourhood
size (rows freed / rows frozen).

#### 4. CLI

**File**: `poc/cp-sat/src/cpsat_engine/cli.py`

**Intent**: `uv run cpsat --input <dump.json> --output <result.json> --mode
parity|complete|full|repair [--stage-budget N] [--mode-a-budget N] [--seed N] [--workers N]
[--hops N]`. Writes the result JSON plus a sidecar per-stage report and solver log paths under
the same directory as `--output`.

**Contract**: Result JSON is `GenerationResult`-shaped (`placements: GeneratedPlacement[]`,
`diagnostics` with `engine: "cp-sat"`, `elapsedMs`, `provenOptimal`, per-cohort
`unplaced`/`occupiedSlotsBefore/After`) so the TS import experiment consumes it without
adaptation. Solver config echoed into the sidecar for reproducibility (single-run protocol).

#### 5. Solver tests

**File**: `poc/cp-sat/tests/test_solve.py`

**Intent**: Fast smoke pins on the seed fixture with tiny budgets: staged ladder completes and
tier values are monotonically consistent (no stage worsens a hardened tier); Mode A on the seed
fixture (expected SAT); Mode B neighbourhood extraction pinned on a fabricated residue (drop a
few greedy rows to manufacture unplaced hours, assert the 1-hop set matches the hand-computed
expectation); result JSON round-trips through `schema.py` types.

**Contract**: Budgets in tests ≤ a few seconds per solve; the suite stays fast enough to run on
every change.

### Success Criteria:

#### Automated Verification:

- `cd poc/cp-sat && uv run pytest` green (solver smoke + Mode B extraction + result-shape tests)
- `uv run ruff check .` clean
- `uv run cpsat --input tests/fixtures/seed-plan-a.json --output data/seed-result.json --mode full` exits 0 and writes result + sidecar + logs

#### Manual Verification:

- Full-mode run on the seed fixture: per-stage report is plausible (tier 1 hits 0, stages within budget)
- Repair-mode run on a fabricated seed residue returns a complete residual board in seconds

**Implementation Note**: Pause for manual confirmation before the campaign.

---

## Phase 5: Measurement Campaign + Verdict

### Overview

The import experiment (result → verify → persist → analyze), the golden-catalog campaign, and
`results.md` with gate verdicts and the go/no-go recommendation.

### Changes Required:

#### 1. Import experiment

**File**: `bench/import-generated.experiment.ts` (new), `package.json` (`experiment:import`
script)

**Intent**: Read a CP-SAT result JSON (`IN` env) and its dump (`DUMP` env): load the dump's
`clonePlanId`, gate the placements through `verifyGeneration` **against `dump.snapshot`** — the
exact instance Python solved; no re-assembly, no re-applied auto-park (optionally re-assemble
from the clone only as an equality assert, a drift check) — persist via the region-replace pattern
(pins passed as survivors, mirroring `generation.experiment.ts:180-207`), and print the
side-by-side reports (`buildReport`/`printPlanReports`) for source vs clone. Fail loudly if the
verdict rejects — the board that failed stays inspectable, per the harness convention.

**Contract**: After a successful run the CP-SAT board is viewable at `/plans/<clonePlanId>` and
`ANALYZE_PLAN_A/B pnpm analyze:plans` compares it against the gold plan. Requires the export's
clone to still exist (no `db reset` between export and import).

#### 2. Campaign execution (runbook, not code)

**File**: `poc/cp-sat/README.md` (runbook section); artifacts under `poc/cp-sat/data/`

**Intent**: Execute the single-run protocol on the golden catalog, capturing config + logs at
every step: export (`PIN_SKELETON=1`) → parity (gate: 10/10) → Mode A (headline; on SAT it chains
into the ladder from tier 2) → Mode B → import + analyze for the best board. Mode branching,
stated once: **Mode A SAT → the complete-mode ladder output is the G2 measurement and the import
board; `--mode full` is the fallback path only when Mode A times out (UNKNOWN)** — never run both
ladders on a SAT instance. Record per-stage wall-clock (measurement c), teacher gap-slots after
the ladder (vs 217 greedy / 148 bar / 74 expert), and the Mode A outcome. If Mode A times out
without an answer, extend the budget before concluding anything.

**Contract**: Every artifact (dump, results, sidecars, logs) lands in the gitignored
`poc/cp-sat/data/`; nothing production-derived is committed.

#### 3. Verdict document

**File**: `context/changes/poc-cp-sat-backend-service/results.md` (new)

**Intent**: The change's deliverable (user decision): an `analysis-run-2`-style comparison table
(expert / greedy same-instance baseline / CP-SAT, via the analyzer), explicit pass/fail per
decision gate, per-stage timing table, Mode B result, the auto-park transformation record, the
single-run protocol caveat, and a written **go/no-go recommendation** on the backend service.

**Contract**: Decision gates, stated up front: **G1** — Mode A closes the residue (complete
board, oracle-verified) **or** proves infeasibility with a named conflict set; **G2** —
`teacherHoles` after the ladder ≤ 148 (the acceptance bar); **G3** — Mode B repairs a fabricated **seed**
residue in interactive time (seconds) — the gate evidence (Phase 4.5, a controlled mechanism
test); the campaign's golden 1-hop repair is recorded alongside it as the hybrid-architecture
data point (it may legitimately fail if the real residue is 1-hop-infeasible). G1 alone decides
the service conversation; G2 compounds it; G3 informs the hybrid architecture. Both-fail on G1+G2 ends the conversation "with data
instead of vibes."

#### 4. Conditional: infeasibility memo (only if Mode A is INFEASIBLE)

**File**: `context/changes/poc-cp-sat-backend-service/infeasibility-memo.pl.md` (conditional)

**Intent**: Map the conflict set's UUIDs to names **locally** (small throwaway query against the
local stack; names never leave the machine, memo names courses/teachers/rules in the
`expert-questions.pl.md` style). Built only if this branch fires.

**Contract**: Short Polish memo; the conflict set it cites must be the deletion-shrunk (true MUS)
version.

#### 5. Close out the change

**File**: `context/changes/poc-cp-sat-backend-service/change.md`

**Intent**: Record the outcome pointer in Notes and set status per the 10x flow when the campaign
concludes.

**Contract**: `status` updated, `updated` stamped; Notes link `results.md`.

### Success Criteria:

#### Automated Verification:

- `pnpm check`, `pnpm lint`, `pnpm test` pass with the import experiment added
- `IN=… DUMP=… pnpm experiment:import` verifies and persists a seed-fixture CP-SAT result (local stack up)

#### Manual Verification:

- Golden campaign executed end-to-end; all artifacts in `poc/cp-sat/data/`; `git status` clean
- CP-SAT board viewable in-app on the export clone; analyzer comparison runs
- `results.md` written: comparison table + G1/G2/G3 verdicts + go/no-go recommendation
- If (and only if) Mode A was INFEASIBLE: `infeasibility-memo.pl.md` exists with a shrunk conflict set

---

## Testing Strategy

### Unit Tests:

- **TS** (`bench/*.test.ts`, collected by `pnpm test`): the export's auto-park derivation
  (zero-student detection, parked-multiset construction) as a pure helper test.
- **Python** (`poc/cp-sat/tests/`): schema round-trip; deficit derivation incl. parked coverage;
  per-rule constraint-group counts; pins-only precondition detection; per-tier micro-cases for
  every week/lane asymmetry; the seed-fixture parity test (exact 10-tuple); staged-runner smoke
  (monotone hardened tiers); Mode B 1-hop neighbourhood extraction; result-JSON shape round-trip.

### Integration Tests:

- None added to `pnpm test:integration` — the experiments _are_ the integration surface
  (deliberately on-demand, DB-touching, excluded from CI like their `bench/` siblings). This plan
  explicitly defers CI integration tests as out of scope (POC tooling).

### Manual Testing Steps:

1. `pnpm exec supabase start`; `pnpm env:local`.
2. Export seed Plan A (`PIN_SKELETON=1`) → commit fixture; export golden plan → stays untracked.
3. Confirm the golden export log shows Chemistry SL parked (4 h, zero students asserted).
4. `uv run cpsat --mode parity` on the golden dump → 10/10.
5. `--mode complete` (Mode A) → record outcome + per-stage report (SAT chains into the ladder);
   `--mode full` only if Mode A returned UNKNOWN; `--mode repair` → record residual timing.
6. `pnpm experiment:import` for the chosen board → view at `/plans/<cloneId>` → `ANALYZE_PLAN_A/B
pnpm analyze:plans`.
7. Write `results.md`; verify gates against the recorded numbers.

## Performance Considerations

The instance is small for native CP-SAT (~4–9 k booleans); the heavy budgets are a choice, not a
need — defaults are 300 s (Mode A) + 120 s × 10 stages ≈ 25 min worst case for the full campaign
solve, all configurable via CLI flags. Multi-worker nondeterminism means stage timings are
indicative single samples (recorded protocol caveat). The `<200 ms` app budget is untouched — the
POC never runs in the app.

## Migration Notes

No schema or app migrations. The POC reads and writes only local-stack clones through existing
RPCs. The one cross-run invariant: the export clone must survive until import (no `supabase db
reset` mid-campaign) — the dump records its `clonePlanId`.

## References

- Research: `context/changes/poc-cp-sat-backend-service/research.md` (incl. the 2026-07-15
  follow-up with measured clique bounds and recorded decisions)
- Charter: `context/archive/2026-07-12-generation-quality-tuning/change.md` §Follow-up 1–3
- Acceptance baseline: `context/archive/2026-07-12-generation-quality-tuning/analysis-run-2.md`
- Harness to mirror: `bench/generation.experiment.ts:58-104`
- Wire format: `src/entities/timetable/model/generation/types.ts`
- Oracle: `src/entities/timetable/model/generation/verify.ts:51-129`
- Objective semantics: `src/entities/timetable/model/generation/objective.ts:27-38`
- Stale-spike analysis: `context/archive/2026-07-12-plan-quality-analyzer/research.md:462-493`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Export Seam + Repo Plumbing

#### Automated

- [x] 1.1 `pnpm check` passes (after `astro sync`) — e327a00
- [x] 1.2 `pnpm lint` and `pnpm test` pass (export helper unit test included) — e327a00
- [x] 1.3 `SOURCE_PLAN_ID=<seed-plan-a> PIN_SKELETON=1 pnpm experiment:export` produces a dump — e327a00
- [x] 1.4 `cd poc/cp-sat && uv run pytest && uv run ruff check .` green — e327a00

#### Manual

- [x] 1.5 Golden export lands under `poc/cp-sat/data/`; `git status` stays clean — e327a00
- [x] 1.6 Golden export log shows Chemistry SL auto-parked (4 h) with zero-student assertion — e327a00
- [x] 1.7 Dump inspected: UUID-only; `objective` tuple and per-cohort `lowerBound` present — e327a00

### Phase 2: Python Schema + Hard-Rule Encoding

#### Automated

- [x] 2.1 `uv run pytest` green (schema + model pins) — 8fcf6c8
- [x] 2.2 `uv run ruff check .` clean — 8fcf6c8

#### Manual

- [x] 2.3 Model stats on the golden dump within the ~4–9 k boolean envelope, both cohorts present — 8fcf6c8

### Phase 3: Objective Tiers 1–10 + Encoding-Parity Gate

#### Automated

- [x] 3.1 `uv run pytest` green — including the seed-fixture parity test (10/10 exact)
- [x] 3.2 `uv run ruff check .` clean

#### Manual

- [x] 3.3 Parity on the golden dump: 10/10 tiers match the TS tuple exactly

### Phase 4: Staged Lexicographic Solver + CLI (Modes A & B)

#### Automated

- [ ] 4.1 `uv run pytest` green (solver smoke + Mode B extraction + result-shape tests)
- [ ] 4.2 `uv run ruff check .` clean
- [ ] 4.3 `uv run cpsat … --mode full` on the seed fixture exits 0, writes result + sidecar + logs

#### Manual

- [ ] 4.4 Seed full-mode per-stage report plausible (tier 1 → 0, stages within budget)
- [ ] 4.5 Repair mode on a fabricated seed residue completes in seconds

### Phase 5: Measurement Campaign + Verdict

#### Automated

- [ ] 5.1 `pnpm check`, `pnpm lint`, `pnpm test` pass with the import experiment added
- [ ] 5.2 `pnpm experiment:import` verifies and persists a seed-fixture CP-SAT result

#### Manual

- [ ] 5.3 Golden campaign executed; artifacts in `poc/cp-sat/data/`; `git status` clean
- [ ] 5.4 CP-SAT board viewable in-app; analyzer comparison recorded
- [ ] 5.5 `results.md` written: comparison + G1/G2/G3 verdicts + go/no-go
- [ ] 5.6 Conditional: infeasibility memo exists iff Mode A returned INFEASIBLE
