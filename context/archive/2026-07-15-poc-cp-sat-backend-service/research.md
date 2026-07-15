---
date: 2026-07-15T10:32:04+02:00
researcher: Claude (Fable 5)
git_commit: b55fabf7786dc4c31a2e9f787fc772249f9a583e
branch: main
repository: ib-timetable-planner
topic: "POC feasibility: a local Python CP-SAT solver for plan generation, structured for reuse as a backend service"
tags: [research, codebase, cp-sat, or-tools, generation, poc-cp-sat-backend-service, objective, verify]
status: complete
last_updated: 2026-07-15
last_updated_by: Claude (Fable 5)
last_updated_note: "Follow-up: open-questions walkthrough — clique bounds measured on both catalogs, all six questions resolved"
---

# Research: POC — local Python CP-SAT solver, structured for backend-service reuse

**Date**: 2026-07-15T10:32:04+02:00
**Researcher**: Claude (Fable 5)
**Git Commit**: b55fabf7786dc4c31a2e9f787fc772249f9a583e
**Branch**: main
**Repository**: ib-timetable-planner

Permalink base: `https://github.com/dobrek/ib-timetable-planner/blob/b55fabf7786dc4c31a2e9f787fc772249f9a583e/`

## Research Question

During `generation-quality-tuning` it became clear a POC is needed to decide whether a CP-SAT
backing service makes sense — a local Python version of the CP-SAT approach. Check feasibility,
what needs to be set up, and structure it so that it (or parts of it) can be reused later.

## Summary

**The POC is highly feasible, cheap (~1 day of work, zero app changes), and the codebase was
deliberately prepared for it.** The archived `generation-quality-tuning` change already wrote the
spec (`change.md` Follow-up §2): *"export a real snapshot to JSON, encode the model in Python
OR-Tools, warm-start from the greedy board, and measure (a) does it complete, (b) what happens to
teacher gaps, (c) how long a staged lexicographic solve takes."* Everything that spike needs
already exists:

1. **The wire format exists.** `GeneratorSnapshot` is plain, structured-clone-safe data
   (`types.ts:10-12`), carries **only opaque UUIDs** (no names — PII-safe by construction), and
   `JSON.stringify` round-trips it losslessly. The engine result type already anticipates a CP-SAT
   engine by name: `diagnostics.engine` is documented as `"e.g. cp-sat, greedy"` and
   `provenOptimal` is *"set only by engines that prove optimality (CP-SAT)"* (`types.ts:71-77`).
2. **The export seam exists.** `bench/generation.experiment.ts` holds the exact snapshot at `:76`
   and the greedy result (warm-start board + unplaced residue + clique lower bounds) at `:79-84`.
   A dump step there — or a standalone `bench/*.experiment.ts` file, auto-collected by
   `vitest.experiment.config.ts:19` — captures everything the Python side needs.
3. **The judge and the return path exist.** `verifyGeneration(snapshot, placements)` judges *any*
   placement list, engine-free (`verify.ts:51`); `persistRegion` → `apply_generated_placements`
   persists it; `pnpm analyze:plans` compares it against gold. A CP-SAT solution rides the
   identical pipeline the greedy engine uses — no new infrastructure.
4. **The Python side is a solved problem.** Current `ortools` (9.15.6755, 2026-01-14) ships macOS
   arm64 wheels for Python 3.9–3.14; warm start is `model.add_hint(var, value)`; lexicographic
   objectives are the canonical staged-solve pattern; the assumptions API extracts a conflict set
   from an infeasible model. The instance is *tiny* for native CP-SAT: ~84 courses × 50 cells ≈
   **4–9 k booleans** (the failed 2026-07-11 WASM spike modeled ~25.5 k and ran single-threaded,
   unhinted — a configuration failure, not a hardness result).

**What the POC must answer** (the decision it exists to make): the tuned greedy engine leaves a
**5–8 hour unplaced residue** on the real catalog at the 20 s budget, and that residue rations
every quality tier below it (teacher gaps stall at 217 vs the ≤ 148 bar vs the expert's 74).
Worse, an unplaced hour is currently **ambiguous** — we cannot tell a search failure from a
genuinely infeasible instance. CP-SAT either closes the residue or *proves* it cannot be closed
and names the minimal conflict set. Either answer ends the ambiguity; a "closes it" answer
justifies the backend service, a "proves infeasible" answer redirects the work to data/rules.

**Reuse is structural, not aspirational**: the snapshot JSON is the future service's request
body, the placements JSON its response body, `GeneratePlan` (`types.ts:104-108`) the port it
plugs into (`run.ts:7-9` explicitly names "a possible HTTP/CLI runner later"), and the Python
package (schema → model → staged solver → CLI) becomes the service core by wrapping it in HTTP.
The only thing the POC throws away is the file-based transport.

## Detailed Findings

### 1. Why now — the residue rations everything below it

From the acceptance run (`context/archive/2026-07-12-generation-quality-tuning/analysis-run-2.md`):

| Metric | Expert (gold) | Untuned engine | Tuned engine (run #2) |
|---|---|---|---|
| Unplaced residue | 0 (by hand) | 0/1 † | **6 h** (range 5–8 across runs) |
| Teacher gap-slots | 74 | 345 | **217** (bar: ≤ 148) |
| Occupied slots dp1/dp2 | 48/47 | 47/47 | 49/47 |
| Same-day splits | 0 | 67 | 0 |

† run #1 was measured against a catalog missing 4 real Chemistry hours — not comparable.

The objective is lexicographic and the search honours it: while tier 1 (`unplacedTotal`) is
non-zero, the LNS spends its budget there and the lower tiers inherit leftovers
(`analysis-run-2.md` §3). Both acceptance misses (teacher gaps, dp1's long Friday) are the same
miss. The archived follow-up (`generation-quality-tuning/change.md` §Follow-up 1–2) therefore
ranks "close the residue" as the highest-value target and names two routes: a deeper greedy
repair, or CP-SAT — and explicitly warns that the old WASM spike verdict *"does not settle this,
and should not be cited as if it did."*

The follow-up also names the strongest structural argument for a solver (§3): in the greedy
engine **a tier is inert unless a destroy operator reaches its improving moves** — a lesson paid
for three times (teacher tier needed a `teacher` operator; completeness needed `deficit`; doubles
had to be bought in the placement heuristic). The still-missing course-day *spread* term
(multi-day courses 31/33 vs gold's 19/22) would need a fourth operator and a re-tuned, fragile
cadence in greedy — in CP-SAT it is one linear term over "course uses day d" indicators.

### 2. The data surface — the snapshot is already the wire format

**Canonical type is `GeneratorSnapshot`** (not "GenerationSnapshot"), exported from
`@/entities/timetable` (`src/entities/timetable/index.ts:18-25`):

- `src/entities/timetable/model/generation/types.ts:26-35` — `days`, `periods` (1-based grid;
  default preset 5×10, `src/shared/config/grid-presets.ts:20-21`), `availability:
  BoardAvailabilityCell[]` (`{teacherKey, day, period, severity: "strong"|"soft"}`,
  `availability-index.ts:10-15`), `finishesEarlyByCourseId: string[]`, `cohorts: Record<"dp1"|"dp2",
  GeneratorCohortSnapshot>`.
- `GeneratorCohortSnapshot` (`types.ts:16-23`): `courses: GroupingCourse[]`, `pins:
  PlannerPlacement[]` (**pins are immovable, fill-the-gaps**), `parkedCourseIds: string[]` (a
  multiset; each entry covers one required hour — deficits = required − placed − parked, clamped
  per course, `deficits.ts:15-27`).
- `GroupingCourse` (`src/shared/lib/catalog-hash/types.ts:30-37`): `{id, teacherKeys[],
  studentKeys[], hours, weekMode: "agnostic"|"biweekly"}`. **Names, levels, and flags never enter
  the snapshot** — display/identity live in side-maps the export must exclude.
- Result: `GeneratedPlacement = {cohort, courseId, day, period, week: "a"|"b"|"both"}`
  (`types.ts:43-49`); `GenerationResult = {placements, diagnostics}` with per-cohort `unplaced:
  CourseDeficit[]` and `lowerBound` (the exact max-weight conflict-clique bound, computed for
  **both** cohorts at runtime — `engines/greedy/problem.ts:43-44, 85-87`).
- **JSON-safety**: all fields are plain arrays/records of primitives — *"structured-clone-safe
  plain data"* by stated design (`types.ts:10-12`).
- **Breaks are cosmetic only** (`src/entities/timetable/lib/period-breaks.ts:1-10`) — bands after
  P2/P5 are visual; no rule references them. The CP-SAT model ignores breaks entirely.

**Export seam** — `bench/generation.experiment.ts` flow (docstring `:19-36`): load →
`clonePlanCatalogOnly` → optional `PIN_SKELETON=1` fixture copy (`bench/fixture-courses.ts:43-71`,
roster `["Advisory","CAS","EE","SSSTS"]`) → `loadPins` → `toSnapshot` (`:76` — the exact
`assembleGeneratorSnapshot` the app runs at Generate-click) → `runVerifiedGeneration` (`:79`) →
persist (`:97`) → analyze (`:98-100`). Between `:76` and `:97` you hold everything to dump:
`{ snapshot, greedy: outcome.result, verdict }`. Node `fs` is fine here — *"Dev tooling — the
Workers-runtime constraints do not apply"* (`generation.experiment.ts:35`). A standalone
`bench/export-snapshot.experiment.ts` is auto-collected by the include glob
`bench/**/*.experiment.ts` (`vitest.experiment.config.ts:19`) with zero runner changes.

**Return path** — map CP-SAT placements onto the harness's persist shape and reuse:
`verifyGeneration(snapshot, placements)` gate → `persistRegion` (`generation.experiment.ts:180-207`,
`apply_generated_placements` RPC, `supabase/migrations/20260711202237_apply_generated_placements.sql:22-26`)
→ `ANALYZE_PLAN_A/B pnpm analyze:plans` for the gold-side-by-side report.

**PII/gitignore constraints**: the snapshot+result dump is UUID-only (no names), but a dump of
the *golden* catalog is still a production-derived artifact under the no-prod-data rule — and the
existing ignore pattern `/data/golden-plan*.sql` (`.gitignore:70-74`) would **not** catch a
`.json` sibling. The export must land in a gitignored location (new pattern or a dedicated
ignored `poc/cp-sat/data/` dir). A **seed-catalog** snapshot (bench Plan A, from committed CSV
fixtures) carries no PII and can be committed as a test fixture. Local-only posture is enforced
anyway: bench runners refuse non-local Supabase hosts (`bench/local-supabase.ts:13-34`).

### 3. The model to encode — complete hard-rule and objective inventory

**Decision variables.** The structural rules dictate the shape: one boolean per
`(course, day, period, weekOption)`, where `weekMode: "agnostic"` forces `week = "both"` and
`"biweekly"` forces `week ∈ {a, b}` (`verify.ts:237-238`) — and the duplicate-row key has **no
week component** (`verify.ts:250-251`), so a course occupies at most one row per `(cohort, day,
period)` even across lanes. Lane fan-out: `both → [a, b]` (`analysis/lanes.ts:76`). Envelope:
dp1 39 courses/116 h/26 students, dp2 45 courses/137 h/35 students, 50 cells per cohort → **≈ 4–9 k
booleans** — tiny for native CP-SAT (the WASM spike's 25.5 k encoding was per course × slot ×
week-variant, joint).

**Hard rules** (oracle: `verify.ts` + registry `collision/constraints/index.ts:14-24`):

| Rule | Exact semantics | CP-SAT shape |
|---|---|---|
| structural | catalog membership; 1-based bounds; week-mode consistency; ≤ 1 row per (course, cell) | variable design |
| `duplicate-course` — block | same course twice in a cell | free by design |
| `teacher` conflict — block | per cell+teacher, occupants with pairwise-overlapping weeks | AddAtMostOne per (teacher, day, period, lane) |
| `student` conflict — block | per cell, occupant pair sharing ≥ 1 student, weeks not disjoint | AddAtMostOne per (student, day, period, lane) |
| `teacher-unavailable` strong — block | placement on a strong-blocked (teacher, cell) | fix literals to 0 |
| `teacher-unavailable` soft — warn | permitted, counted (`softWarnCount`) | tier-5 objective term, NOT a constraint |
| `cross-cohort-teacher` — block | same teacher, same cell, other cohort, weeks overlap | merge with teacher conflict: pool BOTH cohorts' literals in one AtMostOne per (teacher, day, period, lane) |
| `early-finish-edge` — block | flagged course at (d,p,lane) must not be strictly interior to any enrolled student's *other*-course periods that day-lane: violation iff min(O) < p < max(O) (`early-finish-edge.ts:27-73`); per lane, never unioned | reified `p ≤ min(others) ∨ p ≥ max(others)` per (flagged course, student, day, lane) |
| `course-day-stacking` — warn, generator-hard | > 2 distinct periods per (course, day, lane) | Σ course-day-lane literals ≤ 2 |
| `course-day-split` — warn, generator-hard (R1) | ≥ 2 periods in a (course, day, lane) non-consecutive; lunch = any break | given cap 2: if 2 periods in a day-lane they must be adjacent (reified adjacency) |
| `teacher-day-shape` — warn, generator-hard (R2) | per (teacher, day, lane), periods **unioned across BOTH cohorts**: span (last−first+1) ≤ 8 AND max consecutive run ≤ 6 (`teacher-day-shape.ts:25-47`) | span via min/max IntVars (max−min ≤ 7); streak via each sliding 7-window sum ≤ 6 |

**Delta semantics (the one subtlety)**: blocking kinds have **no** pin tolerance — verify fails on
pin-pin violations too, which is why `runVerifiedGeneration` pre-judges the pins-only board
(`run.ts:25-26`). The three warn-kinds are hard **per (entity, lane) delta**: a lane the pins
already breach is exempt; every other lane is hard (`verify.ts:111-121, 158-168, 210-226`). For a
POC starting from a clean, precondition-passing pin set (the fixture skeleton is clean), encode
all three as plain hard constraints and assert the pins-only precondition before solving.

**Objective tiers** (`objective.ts:27-38`, all minimize, lexicographic; full table with counting
semantics in the agent inventory — key asymmetries that will silently diverge if missed):

1. `unplacedTotal` — Σ per-course missing hours, both cohorts.
2. `holes` — cohort interior holes, **week-AGNOSTIC** (union across lanes per (cohort, day)).
3. `totalSlots` — distinct occupied (day, period) cells per cohort, week-agnostic (a `both`
   placement counts once — do not double-count lanes).
4. `teacherHoles` — Σ span−count per (teacher, day, **lane**), rows of BOTH cohorts.
5. `softHits` — one per (row, co-teacher) on a soft cell, **week-agnostic** (no lane fan).
6. `studentHoles` — Σ span−count per (student, day, lane), per cohort.
7. `doublesDeficit` — per (course, lane): `max(0, singles − (hours mod 2))`.
8. `lateStarts` — per (cohort, day, lane): first occupied period − 1.
9. `fridayTail` — per (cohort, last day, lane): last occupied period.
10. `goldenBandDistance` — per golden cell (≥ 90 % roster coverage in **every** lane,
    `GOLDEN_MISS_SHARE = 0.1`), distance to band P4–P7; **count-neutral**.

**Critical framing from the tuning change** (plan.md amendment): the 10-tuple is greedy's
*filter*, not its gradient — greedy searches on tiers 1–6 (`SEARCH_TIERS = 6`, `objective.ts:69`)
and polishes on the rest; doubles are actually bought by a placement-heuristic bonus. **A CP-SAT
engine optimizes the tuple directly** (staged solves), which is precisely why a second engine
will produce a materially different board — the stated reason to build one. The POC does not need
all 10 tiers to answer its question: tiers 1–4 (completeness, holes, slots, teacherHoles) cover
both decision measurements; tiers 5–10 are a stretch goal to time the full staged ladder.

**Golden sets** are construction hints for greedy (`golden-sets.ts:47-63`); CP-SAT needs them only
if tier 10 is modeled (it re-detects goldenness from the board — reified coverage booleans).

### 4. Python OR-Tools — current facts (verified against 2026 docs)

- **Package**: `ortools 9.15.6755` (2026-01-14), Python ≥ 3.9 (wheels cp39–cp314),
  **macOS arm64 wheels published** — plain `uv add ortools` works. Pitfall: very tight
  `protobuf>=6.33.1,<6.34` pin plus hard `numpy>=2`/`pandas` deps → use a dedicated uv
  project/venv, never a shared env.
- **API is snake_case now** (CamelCase survives as legacy proxies): `new_bool_var`,
  `add_exactly_one`, `add_at_most_one`, `add_bool_or`, `add_implication`,
  `model.add(expr).only_enforce_if(lit)` (accepts negation `~b`), `add_max_equality` /
  `add_min_equality` for span constraints.
- **Warm start**: `model.add_hint(var, value)` per variable; hints are not constraints — a
  complete feasible hint becomes the first incumbent (immediate upper bound). `clear_hints()`
  between staged solves; `fix_variables_to_their_hinted_value = True` pins the hint outright —
  the cheap way to **validate encoding parity** (fix the greedy board, expect FEASIBLE, compare
  the model's tier counts against the TS analyzer's numbers).
- **Parallelism**: `num_workers` (the old `num_search_workers` is deprecated), default 0 = all
  cores; 8 workers = base portfolio, 16+ adds probing/dual/LNS subsolvers. `max_time_in_seconds`,
  `log_search_progress = True`, `random_seed`.
- **Lexicographic**: no native multi-objective (open since or-tools#1344). Canonical pattern =
  sequential solves: minimize tier k → `model.add(tier_k_expr <= best_k)` (or `==` for strict) →
  `clear_objective()` → next tier, re-hinting the previous solution each stage. Official
  template: `examples/python/bus_driver_scheduling_sat.py`; domain template:
  `examples/python/shift_scheduling_sat.py`.
- **Infeasibility explanation**: enforcement literals on suspect constraints →
  `model.add_assumptions([...])` → on INFEASIBLE,
  `solver.sufficient_assumptions_for_infeasibility()` returns a conflicting subset. Two caveats
  from the current troubleshooting doc: the set is minimized but **not guaranteed minimal** (run
  a deletion-based shrink loop for a true MUS), and **assumption solves require
  `num_workers = 1`**. Alternative: soften completeness per course-hour and minimize relaxation
  literals — which doubles as "maximum completable subset".
- **Reproducibility**: `model.export_to_file(path)` (text if `.txt`, else binary proto);
  `CpModel(model_proto=...)` re-imports; solution callbacks via `CpSolverSolutionCallback`
  subclass with `stop_search()`, `objective_value`, `best_objective_bound`.

### 5. Prior CP-SAT history — why the old "no" does not bind

The 2026-07-11 spike (`context/archive/2026-07-11-plan-generation/change.md:70-116`):
`or-tools-wasm@0.9.1`, **single-threaded only** (no pthread artifacts exist in that package — COOP/COEP
buys nothing, `:80-82`), naive joint two-cohort encoding (~25.5 k booleans), no hints, no
availability rows. Result: no feasible solution in 60 s on default search; 50/49 slots with
`PARTIAL_FIXED_SEARCH` and zero improvement 30 → 60 s. All four ship-bars failed (no progress
streaming, no cancel-keep-best). The analyzer research
(`plan-quality-analyzer/research.md:478-493`) already declared this verdict **stale**: the failed
spike attacked open-ended slot minimization — maximally symmetric, weak propagation, *"close to
CP-SAT's worst case"* — whereas the current problem is completeness-first over a much harder-ruled
(= better-propagating) model, warm-started, on native multi-worker CP-SAT.

The one genuinely informative old measurement: **dp1 solo, warm-started from the greedy board,
90 s → 49 slots, proven lower bound 46**, clique floor 48; relaxing the 2/day cap did not unlock
48 (`plan-generation/change.md:108-113`, re-cited in `bench/generation.bench.ts:14-21`). So on
*slots*, expect improvement, not proofs — the POC's primary metric is **completeness**, not the
48-slot frontier.

The hybrid recommendation (same research, `:487-489`): keep greedy for interactive generation, add
**CP-SAT as an exact residual-repair operator** — freeze ~95 % of the greedy board, hand CP-SAT
only the unplaced hours plus a small neighbourhood of movable rows; the residual model is tiny
(ms–s solves). This is "Mode B" below and the cheapest integration payoff if the full solve
disappoints.

### 6. Repo placement and tooling — where the POC lives

- **Zero Python exists** in the repo (thorough search: no `*.py`, `pyproject.toml`,
  `requirements*.txt`, `uv.lock`, `.python-version`). `mise.toml` pins no tools (only a PATH
  entry), `.node-version` = 24.15.0.
- **A top-level dir (e.g. `poc/cp-sat/`) is invisible to every gate**: steiger scans `src/` only
  (`package.json:13`, confirmed by `eslint.config.js:83`), eslint's flat config matches only
  JS/TS/astro globs (no Python parser), and `pnpm build`/`pnpm test` don't touch it. Avoid
  putting Python *inside* `bench/` — that dir carries TS import-fencing conventions
  (`eslint.config.js:93-140`); a sibling top-level dir is cleaner.
- The TS export/import steps belong in `bench/` as `*.experiment.ts` files (auto-collected,
  service-role local-only client, `load-test-env` setup, 180 s timeout —
  `vitest.experiment.config.ts:15-30`).
- Gitignore additions needed: the POC's exported golden snapshots/results (e.g.
  `/poc/cp-sat/data/`), mirroring the `/data/golden-plan*.sql` posture. Note impl-review F5 from
  the analyzer change already flagged the `.sql`-only glob as too narrow.

### 7. Reuse path — the POC is the service's first draft

Structure the Python side as a package from day one, transport-agnostic:

```
poc/cp-sat/
  pyproject.toml          # uv-managed; ortools pinned
  src/cpsat_engine/
    schema.py             # parse GeneratorSnapshot JSON → typed model (mirrors types.ts)
    model.py              # snapshot → CpModel (variables + hard rules; pure)
    objective.py          # tier expressions 1–10 (mirrors objective.ts semantics)
    solve.py              # staged lexicographic runner: hints, budgets, callbacks, diagnostics
    explain.py            # assumptions/MUS path for infeasibility
    cli.py                # file in → file out (the POC transport)
  data/                   # gitignored: exported snapshots + results
```

What carries over unchanged into a future backend service:

- **The contract**: snapshot JSON = request body; `GeneratedPlacement[]` + diagnostics = response
  body. `GeneratePlan` (`types.ts:104-108`) is the port; `run.ts:7-9` already names "a possible
  HTTP/CLI runner later" as a supported caller; `diagnostics.engine = "cp-sat"` and
  `provenOptimal` are pre-modeled.
- **The whole Python package** — a service adds a FastAPI (or similar) wrapper + job queue around
  `solve.py`; nothing in schema/model/objective changes.
- **The TS ends**: the export step becomes the service's payload builder; the import/judge step
  (verify → persist → analyze) becomes the response handler. `verifyGeneration` stays the oracle
  for whatever any engine returns — portability invariant 2 of the tuning plan.
- **Deployment reality** (from `context/foundation/infrastructure.md` + archived research): CP-SAT
  **cannot run in workerd** (no threads/SharedArrayBuffer — `plan-generation/research.md:113,132`);
  the future shape is a container service (Cloudflare Containers are GA with scale-to-zero,
  `plan-generation/research.md:115`; the account is on the Workers paid plan), called as an async
  job with polling, with the TS greedy engine kept as the interactive/fallback path
  (`generation-quality-tuning/change.md` §Follow-up 2). None of that is POC scope — the POC only
  needs to keep the package/transport split so the door stays open.

### 8. Recommended POC protocol (the measurements that decide)

1. **Export** (TS, `bench/export-snapshot.experiment.ts`): dump `{snapshot, greedy result,
   verdict}` for (a) the seed catalog (committable fixture) and (b) the golden catalog with
   `PIN_SKELETON=1` (gitignored).
2. **Encoding-parity check** (Python): build the model, hint the greedy board,
   `fix_variables_to_their_hinted_value = True` → expect FEASIBLE; compare the model's tier
   counts against the TS analyzer's numbers for the same board. This validates the encoding
   before any optimization claim.
3. **Mode A — completeness** (the headline): hard all-hours placement, minutes budget,
   `num_workers = 0`. Outcome is binary and decisive: a complete board (residue 0) or INFEASIBLE
   + conflict set via assumptions (`num_workers = 1` rerun). Either answer resolves the
   §Follow-up 1 ambiguity.
4. **Staged tiers**: optimize tiers 1→3, fix, then tier 4 (`teacherHoles`) — measure teacher
   gaps against 217 (greedy) / 148 (bar) / 74 (expert) and wall-clock per stage. Stretch: run the
   full 10-tier ladder to time it.
5. **Mode B — residual repair**: freeze the greedy board minus the unplaced courses'
   neighbourhood; solve the residual (expect ms–s). This is the cheapest integration payoff and
   tests the hybrid architecture.
6. **Re-judge in TS**: feed the CP-SAT placements back through verify → persist → analyzer;
   record an `analysis-run-3`-style comparison in this change folder.

Decision gates: Mode A completes (or proves infeasibility) → the backend service conversation is
justified with data; staged tier 4 reaches ≤ 148 teacher gaps → the quality case compounds it;
both fail → the conversation ends, per the follow-up's framing, "with data instead of vibes."

## Code References

- `src/entities/timetable/model/generation/types.ts:26-35` — `GeneratorSnapshot` (the wire format); `:16-23` pins/parked semantics; `:43-49` `GeneratedPlacement`; `:71-88` diagnostics (anticipates `cp-sat`, `provenOptimal`, `lowerBound`); `:104-108` the `GeneratePlan` port
- `src/entities/timetable/model/generation/assemble-snapshot.ts:33-60` — assembly; strips caller-local fields
- `src/entities/timetable/model/generation/verify.ts:51-129` — the oracle: structural pass, merged-board judgment, warn-kind delta escalation (`:111-121, 158-168, 210-226`), duplicate-row key without week (`:250-251`)
- `src/entities/timetable/model/generation/run.ts:7-31` — `runVerifiedGeneration`: precondition, engine injection, "HTTP/CLI runner later"
- `src/entities/timetable/model/collision/constraints/index.ts:14-24` — hard-rule registry; individual rules: `early-finish-edge.ts:27-73`, `course-day-split.ts:40-43`, `course-day-stacking.ts:37-39`, `teacher-day-shape.ts:25-69`, `teacher-conflict.ts:19-45`, `student-conflict.ts:13-25`, `cross-cohort-teacher.ts:20-36`, `teacher-availability.ts:20-36`
- `src/entities/timetable/model/generation/objective.ts:27-38, 69, 81-86, 98-154` — the 10-tier tuple, `SEARCH_TIERS = 6`, `compareObjectives`, `scoreCandidate`
- `src/entities/timetable/model/generation/golden-sets.ts:17-63` — cover-set detection, `GOLDEN_MISS_SHARE = 0.1`, band P4–P7
- `src/entities/timetable/model/generation/engines/greedy/problem.ts:43-44, 85-87, 131-156` — per-cohort exact clique lower bounds (dp1 = 48 documented; dp2 computed at runtime)
- `src/entities/timetable/model/analysis/lanes.ts:66-76` — lane fan-out and span/holes/streak math
- `src/shared/api/load-cohort-courses.ts:66-98` — roster expansion (overlap fold, merge parents): snapshot rosters are fully expanded; Python re-derives nothing
- `bench/generation.experiment.ts:58-104` — the harness flow; the export seam is `:76-97`; `persistRegion :180-207`
- `bench/fixture-courses.ts:17, 43-90` — fixture skeleton copy by natural key
- `bench/local-supabase.ts:13-34` — local-only enforcement
- `vitest.experiment.config.ts:15-30` — `bench/**/*.experiment.ts` auto-collection
- `supabase/migrations/20260711202237_apply_generated_placements.sql:22-26` — atomic region-replace RPC
- `.gitignore:70-74` — `/pii-scrub/`, `/data/golden-plan*.sql` (a `.json` sibling would NOT be caught)
- `bench/generation.bench.ts:14-21, 33` — recorded spike numbers and slot bars
- `eslint.config.js:83, 93-140, 160-162` + `steiger.config.ts` + `package.json:13` — why a top-level `poc/` dir is invisible to every gate

## Architecture Insights

- **The engine seam was kept open on purpose.** The tuning plan's three portability invariants
  (quality only in engine-agnostic modules; rules single-sourced in the verify oracle with
  `fitsAt` as greedy's mirror, never the definition; shared derivations outside `engines/greedy/`)
  were enforced through implementation review. A CP-SAT engine plugs into `runVerifiedGeneration`
  and is judged by the same oracle — by construction, not by convention.
- **The tuple is a filter for greedy but a gradient for CP-SAT.** Greedy searches tiers 1–6 and
  buys doubles in a heuristic; CP-SAT optimizes the tiers directly via staged solves. A second
  engine *will* produce a different board — that asymmetry is the argument for building it, and
  also why POC results must be compared through the analyzer, not eyeballed.
- **Completeness is CP-SAT's home turf here.** The failed spike attacked slot minimization
  (symmetric, weak propagation); the current question is "place all hours under many hard rules"
  — more constraints prune more, the greedy board is a warm-start incumbent, and infeasibility
  comes back with a certificate. The lexicographic caveat: tier 3 (slots) history says expect
  best-found, never proofs (dp1: bound 46, clique floor 48, best known 49).
- **Delta semantics are the one encoding trap.** Warn-kind rules are hard per (entity, lane)
  *except* lanes the pins already breach; blocking rules have no tolerance at all (hence the
  pins-only precondition). A POC on a clean skeleton can treat everything as hard — but must
  assert the precondition, or infeasibility reports will blame the wrong thing.
- **Week-lane asymmetries are deliberate**: tiers 2/3/5 are week-agnostic while 4/6/7/8/9 fan
  `both` into lanes, and the duplicate-row key ignores week. Mirroring `objective.ts` exactly —
  and validating with the fixed-hint parity check — is what makes Python numbers comparable to
  analyzer numbers.

## Historical Context (from prior changes)

- `context/archive/2026-07-12-generation-quality-tuning/change.md` §Follow-up 1–3 — the POC's
  charter: the residue rations everything; "kill the unknown with a standalone spike, not an
  integration"; the spread-term asymmetry argument.
- `context/archive/2026-07-12-generation-quality-tuning/analysis-run-2.md` — acceptance baseline:
  residue 6 h, teacher gaps 217, verdict ACCEPT with the two budget-bound misses.
- `context/archive/2026-07-11-plan-generation/change.md:70-116` — the WASM spike record
  (or-tools-wasm@0.9.1, single-threaded, four bars failed) and the dp1 warm-started 90 s → 49 /
  bound 46 measurement.
- `context/archive/2026-07-12-plan-quality-analyzer/research.md:462-493` — "the archived 'no' is
  stale" analysis and the hybrid residual-repair recommendation.
- `context/archive/2026-07-12-generation-engine-refactor/change.md:65-67` — the original deferral
  ("prize ~1–2 dp1 slots") — superseded: the prize is now completeness + freed budget for the
  people tiers, not slots.
- `context/foundation/infrastructure.md:15, 52, 108` — Cloudflare Workers deployment, 10 MB paid
  size limit, "Workers doesn't use containers" (out of scope then; Containers GA noted in
  `plan-generation/research.md:115` as the held-in-reserve heavy option).

## Related Research

- `context/archive/2026-07-12-generation-quality-tuning/research.md` — the expert elicitation
  (rules R1–R21, G1–G4) whose encodings this POC ports to CP-SAT.
- `context/archive/2026-07-12-plan-quality-analyzer/research.md` — the analyzer metric taxonomy
  the POC's parity check reuses.
- `context/archive/2026-07-11-plan-generation/research.md:107-145, 254` — the original CP-SAT
  viability research incl. the early-finish-edge reification sketch.

## Open Questions

All six were resolved in the 2026-07-15 follow-up below — none block planning.

- ~~dp2's clique lower bound is undocumented~~ — **measured**: Golden 46/41, Seed A 48/45 (see
  follow-up).
- ~~Residual neighbourhood definition for Mode B~~ — **decided**: 1-hop conflict-graph
  neighbourhood, pins frozen; 2-hop only on infeasibility.
- ~~Staged-ladder cost~~ — **scoped**: tiers 1–4 decision scope at 60–120 s/stage; tiers 5–10
  stretch at 10–30 s/stage; harden stages with `≤ best`, never `==`.
- ~~Hint quality across stages~~ — **closed from docs**: `clear_hints()` + re-hint the incumbent
  per stage is the canonical pattern.
- ~~Python version/tooling pin~~ — **user decision**: both, staged — uv-only in
  `poc/cp-sat/pyproject.toml` now; promote to `mise.toml` only if the POC graduates.
- ~~Infeasibility evidence format~~ — **proposed and accepted as conditional scope**: conflict
  set → `naturalKeys` → short Polish memo in the `expert-questions.pl.md` style, built only if
  Mode A returns INFEASIBLE.

## Follow-up Research 2026-07-15T10:45+02:00 — open-questions walkthrough

### Clique lower bounds measured (Q1)

Measured with a throwaway `bench/*.analyze.ts` script (deleted after the run):
`loadPlanAnalysis` → `buildProblem` → `lowerBound` — the exact max-weight-clique B&B
(`engines/greedy/problem.ts:136`), against the live local stack:

| Catalog | dp1 bound | dp2 bound | Catalog shape (dp1 · dp2) |
|---|---|---|---|
| Golden Plan (`4bc9fe99`) | **46** | **41** | 40 courses/113 h/5 biweekly/0 flagged · 45/135 h/7 biweekly/**9 flagged** |
| Seed Plan A (`c43c5f07`) | **48** | **45** | 39/116 h/4 biweekly/0 flagged · 42/134 h/3 biweekly/0 flagged |

Findings:

- **The archive's "dp1 = 48" is the seed catalog's bound.** The golden catalog's bounds are
  materially looser (46/41) because clique nodes exclude flagged and biweekly courses
  (`problem.ts:163-176`) and golden dp2 carries 9 flagged + 7 biweekly courses.
- The expert board (48/47 occupied) sits **above** the golden bounds — CP-SAT cannot certify the
  expert's slot counts by bound-matching on the golden catalog. The "expect best-found, not
  proofs" framing is confirmed, now with numbers.
- **Encoding tip**: inject the clique bound as a redundant cut (`totalSlots ≥ bound`) in the
  tier-3 stage. On seed dp1 the clique bound (48) is *stronger* than the dual bound CP-SAT proved
  for itself in the 2026-07-11 spike (46) — the cut is free strength the solver demonstrably does
  not find alone.
- The POC's decision instance (golden catalog, pinned skeleton) is completeness-bound, not
  slot-bound; the bounds are interpretive context, not targets.

### Decisions recorded (Q2, Q3, Q5, Q6)

- **Mode B neighbourhood** (Q2): free the unplaced courses plus all placed rows of any course
  sharing ≥ 1 student or ≥ 1 teacher with an unplaced course — 1-hop in the conflict graph, the
  same edge definition `problem.ts:163-176` uses; fixture pins stay frozen always. Escalate to
  2-hop only if the 1-hop residual is infeasible. This is greedy's `deficit` destroy operator,
  made exact.
- **Staged ladder** (Q3): tiers 1–4 are the decision scope at generous budgets (60–120 s/stage);
  tiers 5–10 run as a stretch pass at capped budgets (10–30 s/stage), best-found accepted;
  per-stage wall clock recorded (= measurement (c)). Harden each stage with `tier_k ≤ best_k`,
  not `==` — if stage k stopped at best-found rather than proven-optimal, later stages may then
  improve higher tiers for free, which lexicographic ordering welcomes.
- **Python toolchain** (Q5, user decision 2026-07-15): **both, staged** — the POC is uv-only
  (`poc/cp-sat/pyproject.toml`: `requires-python`, ortools pin, `uv.lock`); a `mise.toml` python
  pin is added only if the POC graduates to a real service in this repo.
- **Infeasibility evidence** (Q6): if Mode A returns INFEASIBLE, map the conflict set through
  `naturalKeys` locally (names never leave the machine) into a short Polish memo naming the
  courses/teachers/rules involved, mirroring the `expert-questions.pl.md` format that already
  worked for elicitation. Conditional scope — built only if that branch fires.

### Closed from documentation (Q4)

- **Stage hinting**: `clear_hints()` + `add_hint(...)` with the current incumbent at every stage
  is the canonical pattern (the official `bus_driver_scheduling_sat.py` two-phase example does
  exactly this); a complete feasible hint becomes the first incumbent immediately.
  `fix_variables_to_their_hinted_value = True` is used exactly once — for the encoding-parity
  check — never during optimization stages.
