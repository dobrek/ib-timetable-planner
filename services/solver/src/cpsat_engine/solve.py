"""Solver entry points.

    parity          fixed-hint solve vs the dump's TS tuple — the encoding-equivalence gate (Phase 3)
    solve_staged    staged lexicographic ladder over all ten tiers (harden ``tier_k <= best_k``)
    solve_complete  Mode A: completeness feasibility, then the ladder from tier 2 (SAT) or explain
    solve_repair    Mode B: 1-hop residual repair around the greedy unplaced courses

The ladder is the shared spine: each stage sets the objective to one tier, warm-starts from the
incumbent, solves under the per-stage budget, and hardens ``tier_k <= best_k`` so no later stage can
undo it — the lexicographic order the expert elicited (``objective.ts``). The per-cohort clique cut
(``cohort_slots >= lowerBound``) is injected at the tier-3 stage, and only for a cohort the incumbent
already completes (the bound is a *complete*-cohort property; ``types.ts:64-68``).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ortools.sat.python import cp_model

from .model import ModelBundle, build_model
from .objective import ObjectiveModel, build_objective, build_tiers, soft_hits_terms
from .schema import COHORTS, Course, Dump, Placement, PlacementKey, deficits

# --- configuration & reports ----------------------------------------------------------------------


@dataclass(frozen=True)
class SolveConfig:
    """Stage budgets, determinism knobs, and the repair neighbourhood radius — CLI-fed."""

    stage_budget_s: float = 120.0  # user decision: all tiers first-class at generous budgets
    mode_a_budget_s: float = 300.0
    repair_budget_s: float = 30.0
    seed: int = 1
    workers: int = 0  # 0 = let CP-SAT pick (num_search_workers auto)
    hops: int = 1
    log_dir: Path | None = None
    # Read by `solve_complete` ALONE, and defaulted off. That placement is load-bearing: `parity()`
    # and `evaluate_board()` take no config, so the 10/10 objective-parity gate cannot see this flag
    # by construction. Implementing the same semantics as variable pruning inside `build_model`
    # would be mathematically equivalent and would put the gate's own model inside the change.
    clean_mode: bool = False


@dataclass(frozen=True)
class StageReport:
    tier: int  # 1-based tier index
    name: str
    status: str
    best: int | None  # objective value at stage end (None if no solution found)
    bound: int | None  # best proven bound
    wall_clock_s: float


@dataclass(frozen=True)
class SolveResult:
    """A solved board plus its per-stage report — the measurement-(c) artifact and CLI input."""

    mode: str
    board: tuple[Placement, ...]  # generated placements only (pins stay pins)
    stages: tuple[StageReport, ...]
    proven_optimal: bool
    # Mode-specific: neighbourhood size, mode-A outcome. `notes["outcome"]` is the field a wrapper
    # branches on — a non-optimal solve is NOT an exception (see `solve_complete`).
    notes: dict[str, Any] = field(default_factory=dict)

    @property
    def elapsed_s(self) -> float:
        return sum(s.wall_clock_s for s in self.stages)


# --- Phase 3: encoding-parity gate ----------------------------------------------------------------


class ParityError(Exception):
    """The greedy board — proven feasible in Phase 2 — could not be replayed under the tier model."""


@dataclass(frozen=True)
class TierParity:
    name: str
    computed: int
    expected: int

    @property
    def ok(self) -> bool:
        return self.computed == self.expected


@dataclass(frozen=True)
class ParityReport:
    tiers: tuple[TierParity, ...]

    @property
    def ok(self) -> bool:
        return all(t.ok for t in self.tiers)

    @property
    def computed(self) -> tuple[int, ...]:
        return tuple(t.computed for t in self.tiers)

    @property
    def expected(self) -> tuple[int, ...]:
        return tuple(t.expected for t in self.tiers)

    def mismatches(self) -> tuple[TierParity, ...]:
        return tuple(t for t in self.tiers if not t.ok)


def parity(dump: Dump) -> ParityReport:
    """Pin every placement var to the greedy board, solve for the tier aux-vars, and compare all ten
    evaluated tiers to ``dump.objective`` (the TS scorer's tuple). The completion is unique."""
    bundle = build_model(dump)
    tiers = build_tiers(bundle)
    _hint_board(bundle, _greedy_board(dump))
    solver = cp_model.CpSolver()
    solver.parameters.fix_variables_to_their_hinted_value = True
    solver.parameters.num_workers = 1
    solver.parameters.max_time_in_seconds = 60
    status = solver.solve(bundle.model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise ParityError(f"the greedy board did not replay under the tier model: status={status}")
    expected = tuple(dump.objective)
    return ParityReport(
        tiers=tuple(
            TierParity(name=t.name, computed=int(solver.value(t.var)), expected=expected[i])
            for i, t in enumerate(tiers)
        )
    )


def evaluate_board(dump: Dump, board: tuple[Placement, ...]) -> tuple[int, ...]:
    """Fix a generated board and read the ten tier values off it (parity-style, for an arbitrary
    board) — the re-score the ladder's monotonicity check compares against the per-stage bests."""
    bundle = build_model(dump)
    tiers = build_tiers(bundle)
    placed = {(p.cohort, p.course_id, p.day, p.period, p.week): 1 for p in board}
    for key, var in bundle.x.items():
        bundle.model.add(var == placed.get(key, 0))
    solver = cp_model.CpSolver()
    solver.parameters.num_workers = 1
    status = solver.solve(bundle.model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise ParityError(f"board is not feasible under the hard rules: status={status}")
    return tuple(int(solver.value(t.var)) for t in tiers)


# --- full staged ladder (all ten tiers) -----------------------------------------------------------


def solve_staged(dump: Dump, config: SolveConfig) -> SolveResult:
    """Walk all ten tiers in order, hardening each. Tier 1 runs on the light model (no tier aux-vars)
    to get a concrete warm-start; the objective is built for tiers 2-10, mirroring Mode A's shape."""
    bundle = build_model(dump)
    tier1, incumbent = _place_maximally(bundle, config, _greedy_board(dump))
    objective = build_objective(bundle)
    stages, board, proven = _run_ladder(bundle, objective, dump, config, range(1, 10), incumbent)
    return SolveResult(
        mode="full", board=board, stages=(tier1, *stages), proven_optimal=proven and tier1.status == "OPTIMAL"
    )


def _place_maximally(
    bundle: ModelBundle, config: SolveConfig, warm_start: dict[PlacementKey, int]
) -> tuple[StageReport, dict[PlacementKey, int]]:
    """Tier 1 on the hard-rules-only model: maximise placed hours (= minimise unplaced), warm-started
    from the greedy board, harden the best, and return the concrete board as the ladder's warm-start."""
    placed = sum(bundle.x.values())
    total_deficit = sum(bundle.deficits.values())
    _hint_board(bundle, warm_start)
    bundle.model.maximize(placed)
    status, solver = _run_solver(config, config.stage_budget_s, "tier-1-unplacedTotal", bundle.model)
    solved = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    best_placed = int(round(solver.objective_value)) if solved else 0
    incumbent = _extract_board(bundle, solver) if solved else {}
    if solved:
        bundle.model.add(placed >= best_placed)  # harden completeness at its best
    report = StageReport(
        tier=1,
        name="unplacedTotal",
        status=solver.status_name(status),
        best=total_deficit - best_placed if solved else None,
        bound=None,
        wall_clock_s=solver.wall_time,
    )
    return report, incumbent


# --- Mode A: completeness ------------------------------------------------------------------------


def solve_complete(dump: Dump, config: SolveConfig) -> SolveResult:
    """Constrain every deficit fully placed and feasibility-solve. On SAT, chain the ladder from
    tier 2 (unplaced is already 0). On INFEASIBLE, hand off to ``explain``. On timeout, report unknown.

    Under ``config.clean_mode`` the feasibility model additionally carries ``softHits == floor`` —
    the solve may not add a soft-availability hit the author's own pins did not already own. If THAT
    is infeasible, the constraint is dropped and feasibility re-runs once (:func:`_feasibility`), so
    a clean-infeasible snapshot still yields a board — labelled by the caller, never refused."""
    bundle, status, solver = _feasibility(dump, config, clean=config.clean_mode)
    # Only a PROOF of infeasibility falls back: an UNKNOWN is a budget verdict on the model, not
    # evidence that clean is unsatisfiable, and re-solving it would just burn the budget twice.
    fallback = config.clean_mode and status == cp_model.INFEASIBLE
    if fallback:
        bundle, status, solver = _feasibility(dump, config, clean=False)

    feasibility = StageReport(
        tier=1,
        name="completeness",
        status=solver.status_name(status),
        best=0 if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None,
        bound=None,
        wall_clock_s=solver.wall_time,
    )
    # Internal only — `to_generation_result` never reads `notes`, so nothing here reaches the wire.
    clean_notes: dict[str, Any] = {"clean_fallback": fallback} if config.clean_mode else {}

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        incumbent = _extract_board(bundle, solver)
        objective = build_objective(bundle)  # add the tier machinery now that completeness holds
        stages, board, proven = _run_ladder(bundle, objective, dump, config, range(1, 10), incumbent)
        return SolveResult(
            mode="complete",
            board=board,
            stages=(feasibility, *stages),
            proven_optimal=proven,
            notes={"outcome": "complete", **clean_notes},
        )

    outcome = "infeasible" if status == cp_model.INFEASIBLE else "unknown"
    return SolveResult(
        mode="complete",
        board=(),
        stages=(feasibility,),
        proven_optimal=False,
        notes={"outcome": outcome, **clean_notes},
    )


def _feasibility(
    dump: Dump, config: SolveConfig, *, clean: bool
) -> tuple[ModelBundle, cp_model.CpSolverStatus, cp_model.CpSolver]:
    """Build the hard-rules model, force completeness (plus the clean floor when asked), and solve.

    The completeness feasibility solve carries the hard rules only — the tier aux-vars would bloat
    it for no gain. They are built after SAT, when the ladder actually needs them. Clean mode is no
    exception: :func:`soft_hits_terms` is a plain linear form over ``bundle.x`` and the pin
    constants, so the constraint needs no aux-var either.

    It has to go HERE, and it has to STAY. Here, because adding it next to ``build_objective`` after
    Mode A would leave a later ladder stage that returns neither OPTIMAL nor FEASIBLE returning the
    PRE-clean incumbent behind a green `succeeded`. Stay, because CP-SAT cannot drop a constraint
    and because tiers 2-4 hardening could otherwise push ``softHits`` back above the floor; tier 5
    then lands on the floor trivially.

    Which is also why the fallback REBUILDS rather than relaxes: dropping the constraint from a
    built model is not a thing CP-SAT offers, and ``build_model`` is cheap enough that ``parity()``
    already rebuilds per call.
    """
    bundle = build_model(dump)
    _add_completeness(bundle, bundle.deficits)
    if clean:
        soft_hits, floor = soft_hits_terms(bundle)
        bundle.model.add(soft_hits == floor)
    _hint_board(bundle, _greedy_board(dump))
    stage = "mode-a-clean" if clean else "mode-a"
    status, solver = _run_solver(config, config.mode_a_budget_s, stage, bundle.model)
    return bundle, status, solver


# --- Mode B: 1-hop residual repair ----------------------------------------------------------------


def solve_repair(dump: Dump, config: SolveConfig) -> SolveResult:
    """Free only the greedy unplaced courses and their conflict-graph neighbourhood; freeze the rest
    of the greedy board; close the residue and minimise teacherHoles on that small window."""
    bundle = build_model(dump)
    objective = build_objective(bundle)
    greedy = _greedy_board(dump)

    freed = _neighbourhood(dump, greedy, config.hops)
    frozen_rows, freed_courses = _freeze_outside(bundle, greedy, freed)
    _add_completeness(bundle, {key: d for key, d in bundle.deficits.items() if key in freed})

    # A tiny 2-tier ladder on the residual: close the residue (tier 1), then teacherHoles (tier 4).
    repair_config = SolveConfig(
        stage_budget_s=config.repair_budget_s,
        seed=config.seed,
        workers=config.workers,
        log_dir=config.log_dir,
    )
    stages, board, proven = _run_ladder(bundle, objective, dump, repair_config, (0, 3), greedy)
    return SolveResult(
        mode="repair",
        board=board,
        stages=stages,
        proven_optimal=proven,
        notes={
            "hops": config.hops,
            "rows_freed": len(freed),
            "rows_frozen": frozen_rows,
            "courses_freed": freed_courses,
        },
    )


# --- GenerationResult shaping (the TS import contract) --------------------------------------------


def to_generation_result(dump: Dump, result: SolveResult, engine: str = "cp-sat") -> dict[str, Any]:
    """Shape a solved board into the ``GenerationResult`` wire dict the TS side consumes verbatim:
    generated placements + per-cohort diagnostics.

    The shape is frozen in ``contracts/generation-wire.schema.json``. In particular an absent optional
    is an ABSENT KEY, never ``None`` — ``"lowerBound": null`` is not assignable to the TS type and is
    rejected by the schema, so a cohort with no clique bound simply omits it."""
    board = {(p.cohort, p.course_id, p.day, p.period, p.week): 1 for p in result.board}
    placed = _placed_by_course(board)
    defs = deficits(dump.snapshot)
    cohorts: dict[str, dict[str, Any]] = {}
    for cohort in COHORTS:
        snap = dump.snapshot.cohorts[cohort]
        pins = [(pin.day, pin.period) for pin in snap.pins]
        generated = [(p.day, p.period) for p in result.board if p.cohort == cohort]
        unplaced = [
            {"courseId": c.id, "missing": defs[(cohort, c.id)] - placed.get((cohort, c.id), 0)}
            for c in snap.courses
            if defs[(cohort, c.id)] - placed.get((cohort, c.id), 0) > 0
        ]
        lower_bound = dump.lower_bound(cohort)
        cohorts[cohort] = {
            "occupiedSlotsBefore": len(set(pins)),
            "occupiedSlotsAfter": len(set(pins + generated)),
            "unplaced": unplaced,
            **({"lowerBound": lower_bound} if lower_bound is not None else {}),
        }
    diagnostics: dict[str, Any] = {
        "engine": engine,
        "elapsedMs": round(result.elapsed_s * 1000),
        "partial": not result.proven_optimal,
        "provenOptimal": result.proven_optimal,
        "cohorts": cohorts,
    }
    if not result.proven_optimal:
        diagnostics["stopReason"] = "budget"
    return {
        "placements": [
            {"cohort": p.cohort, "courseId": p.course_id, "day": p.day, "period": p.period, "week": p.week}
            for p in result.board
        ],
        "diagnostics": diagnostics,
    }


# --- the shared ladder ----------------------------------------------------------------------------


def _run_ladder(
    bundle: ModelBundle,
    objective: ObjectiveModel,
    dump: Dump,
    config: SolveConfig,
    tier_indices: Iterable[int],
    incumbent: dict[PlacementKey, int],
) -> tuple[tuple[StageReport, ...], tuple[Placement, ...], bool]:
    """Optimise the given 0-based tier indices in order; harden each; return (stages, board, proven)."""
    stages: list[StageReport] = []
    proven = True
    for idx in tier_indices:
        tier = objective.tiers[idx]
        if idx == 2:  # about to minimise totalSlots — inject the clique cut for completed cohorts
            _add_clique_cuts(bundle, objective, dump, incumbent)

        # ortools declares `CpModel.clear_hints(self)` with no annotations at all, so `--strict`
        # reads the call as untyped. Upstream gap, not ours.
        bundle.model.clear_hints()  # type: ignore[no-untyped-call]
        _hint_board(bundle, incumbent)
        bundle.model.minimize(tier.var)
        status, solver = _run_solver(
            config, config.stage_budget_s, f"tier-{idx + 1}-{tier.name}", bundle.model
        )

        solved = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        best = int(round(solver.objective_value)) if solved else None
        stages.append(
            StageReport(
                tier=idx + 1,
                name=tier.name,
                status=solver.status_name(status),
                best=best,
                bound=int(round(solver.best_objective_bound)) if solved else None,
                wall_clock_s=solver.wall_time,
            )
        )
        if solved:
            incumbent = _extract_board(bundle, solver)
            bundle.model.add(tier.var <= best)  # harden: no later stage may worsen this tier
        proven = proven and status == cp_model.OPTIMAL
    return tuple(stages), _generated(incumbent), proven


def _add_clique_cuts(
    bundle: ModelBundle, objective: ObjectiveModel, dump: Dump, incumbent: dict[PlacementKey, int]
) -> None:
    """``cohort_slots >= lowerBound`` — a redundant tier-3 cut, added only for a cohort the incumbent
    already completes (the clique bound holds only for a fully-placed cohort)."""
    residue = _residue(bundle, incumbent)
    for cohort in COHORTS:
        bound = dump.lower_bound(cohort)
        if bound is not None and residue[cohort] == 0:
            bundle.model.add(objective.cohort_slots[cohort] >= bound)


# --- completeness, freezing, neighbourhood --------------------------------------------------------


def _add_completeness(bundle: ModelBundle, targets: dict[tuple[str, str], int]) -> None:
    """Force every targeted (cohort, course) fully placed: ``sum(vars) >= deficit`` (the <= cap is
    already in the model, so this pins it to exactly the deficit)."""
    by_course: dict[tuple[str, str], list[cp_model.IntVar]] = {}
    for (cohort, cid, _d, _p, _w), var in bundle.x.items():
        by_course.setdefault((cohort, cid), []).append(var)
    for key, need in targets.items():
        if need > 0 and key in by_course:
            bundle.model.add(sum(by_course[key]) >= need)


def _freeze_outside(
    bundle: ModelBundle, greedy: dict[PlacementKey, int], freed: set[tuple[str, str]]
) -> tuple[int, int]:
    """Fix every var of a course OUTSIDE the freed set to its greedy value; leave freed vars open."""
    frozen = 0
    for key, var in bundle.x.items():
        cohort, cid = key[0], key[1]
        if (cohort, cid) not in freed:
            bundle.model.add(var == greedy.get(key, 0))
            frozen += 1
    return frozen, len(freed)


def _neighbourhood(dump: Dump, greedy: dict[PlacementKey, int], hops: int) -> set[tuple[str, str]]:
    """The greedy unplaced courses plus their k-hop conflict-graph neighbourhood (shares a teacher or
    a student — the ``problem.ts`` edge). Placed courses in the window are freed for rearrangement."""
    courses = {(co, c.id): c for co in COHORTS for c in dump.snapshot.cohorts[co].courses}
    residue = _residue_from_deficits(dump, greedy)
    frontier = {key for key, left in residue.items() if left > 0}
    reached = set(frontier)
    for _hop in range(max(1, hops)):
        nxt: set[tuple[str, str]] = set()
        for key in frontier:
            for other, course in courses.items():
                if other not in reached and _conflicts(courses[key], course):
                    nxt.add(other)
        reached |= nxt
        frontier = nxt
        if not frontier:
            break
    return reached


def _conflicts(a: Course, b: Course) -> bool:
    """Two courses cannot share a cell iff they share a teacher or a student (``problem.ts:170-171``)."""
    return bool(set(a.teacher_keys) & set(b.teacher_keys)) or bool(set(a.student_keys) & set(b.student_keys))


# --- board helpers --------------------------------------------------------------------------------


def _greedy_board(dump: Dump) -> dict[PlacementKey, int]:
    """The greedy warm-start as a var-value map keyed like ``bundle.x``."""
    return {(p.cohort, p.course_id, p.day, p.period, p.week): 1 for p in dump.greedy_placements}


def _hint_board(bundle: ModelBundle, board: dict[PlacementKey, int]) -> None:
    for key, var in bundle.x.items():
        bundle.model.add_hint(var, board.get(key, 0))


def _extract_board(bundle: ModelBundle, solver: cp_model.CpSolver) -> dict[PlacementKey, int]:
    return {key: int(solver.value(var)) for key, var in bundle.x.items()}


def _generated(board: dict[PlacementKey, int]) -> tuple[Placement, ...]:
    return tuple(Placement(*key) for key, value in board.items() if value == 1)


def _residue(bundle: ModelBundle, board: dict[PlacementKey, int]) -> dict[str, int]:
    """Per-cohort unplaced hours = sum over courses of ``deficit - placed`` on this board."""
    placed = _placed_by_course(board)
    out = {cohort: 0 for cohort in COHORTS}
    for (cohort, cid), need in bundle.deficits.items():
        out[cohort] += max(0, need - placed.get((cohort, cid), 0))
    return out


def _residue_from_deficits(dump: Dump, board: dict[PlacementKey, int]) -> dict[tuple[str, str], int]:
    placed = _placed_by_course(board)
    defs = deficits(dump.snapshot)
    return {key: max(0, need - placed.get(key, 0)) for key, need in defs.items()}


def _placed_by_course(board: dict[PlacementKey, int]) -> dict[tuple[str, str], int]:
    out: dict[tuple[str, str], int] = {}
    for (cohort, cid, _d, _p, _w), value in board.items():
        if value == 1:
            out[(cohort, cid)] = out.get((cohort, cid), 0) + 1
    return out


# --- solver plumbing ------------------------------------------------------------------------------


def _run_solver(
    config: SolveConfig, budget_s: float, stage: str, model: cp_model.CpModel
) -> tuple[cp_model.CpSolverStatus, cp_model.CpSolver]:
    """Configure a solver (budget, workers, seed), solve, and tee the search log to a per-stage file."""
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = budget_s
    solver.parameters.num_workers = config.workers
    solver.parameters.random_seed = config.seed
    path = _log_path(config, stage)
    lines: list[str] = []
    if path is not None:
        solver.parameters.log_search_progress = True
        solver.parameters.log_to_stdout = False  # tee to the file only; keep the CLI's stdout clean
        solver.log_callback = lines.append
    status = solver.solve(model)
    if path is not None:
        path.write_text("\n".join(lines))
    return status, solver


def _log_path(config: SolveConfig, stage: str) -> Path | None:
    if config.log_dir is None:
        return None
    config.log_dir.mkdir(parents=True, exist_ok=True)
    return config.log_dir / f"{stage}.log"
