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

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from ortools.sat.python import cp_model

from .model import ModelBundle, build_model
from .objective import ObjectiveModel, build_objective, build_tiers, soft_hits_terms
from .schema import COHORTS, Course, Dump, Placement, PlacementKey, deficits

# --- reports, events & configuration ---------------------------------------------------------------


@dataclass(frozen=True)
class StageReport:
    tier: int  # 1-based tier index
    name: str
    status: str
    best: int | None  # objective value at stage end (None if no solution found)
    bound: int | None  # best proven bound
    wall_clock_s: float
    # Why a non-optimal stage ended when it did. None on OPTIMAL, and on a stage with no solution to
    # attribute (UNKNOWN/INFEASIBLE) — the wire omits the key rather than nulling it. Defaulted so
    # every existing construction site stays valid.
    stopped_by: Literal["budget", "target", "cancelled"] | None = None


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


@dataclass(frozen=True)
class StageEvent:
    """One ladder stage starting or finishing — the ONE type a caller has to understand to follow a
    solve in progress.

    Every event is raised on the WORKER thread, between solves, so a handler is free to do I/O (the
    service PATCHes a database row from it). The solver's own thread only ever runs
    :class:`_StageStop`, which decides and returns.

    ``tier`` is the 1-based tier number — the same identity as :attr:`StageReport.tier`, and never an
    array position; ``position``/``total`` are the human count ("stage 4 of 10"), which differs from
    ``tier`` whenever a mode runs a sparse subset (``solve_repair`` reports tiers 1 and 4 as stages 1
    and 2 of 2).
    """

    kind: Literal["started", "completed"]
    tier: int
    name: str
    position: int
    total: int
    #: The finished stage's report. ``completed`` only.
    report: StageReport | None = None
    #: The transcript so far, this stage included — the whole run's, not this call's slice of it.
    #: ``completed`` only, and present whether or not the stage solved: a stage that found nothing
    #: still belongs in the transcript, and a consumer that stored only the checkpoint's copy would
    #: silently truncate the record every time a stage came back UNKNOWN.
    stages: tuple[StageReport, ...] = ()
    #: The incumbent board as a self-contained result, carrying the transcript so far. Present only
    #: on a ``completed`` stage that actually SOLVED — a stage that found nothing has contributed
    #: nothing, and a checkpoint claiming otherwise would be a lie the next slice acts on.
    checkpoint: SolveResult | None = None


@dataclass(frozen=True)
class SolveHooks:
    """The caller's optional seam into a running solve. All three default to absent, and absent is
    exactly today's behaviour.

    Exceptions raised by a hook are deliberately NOT caught here: the engine cannot know whether a
    caller's failure is survivable, and swallowing it would hide a broken emission path behind a
    green solve. The service wraps its own handlers instead, because THERE the answer is known — a
    dropped progress PATCH must never kill a twenty-minute solve.
    """

    #: Raised twice per stage (``started``, then ``completed``), on the worker thread.
    on_stage: Callable[[StageEvent], None] | None = None
    #: Handed the live :class:`cp_model.CpSolver` just before each solve, so a caller can hold the
    #: handle it needs to interrupt one from outside. Called at least once per stage — Mode A's
    #: clean fallback solves twice — and the latest handle is the live one.
    on_solver: Callable[[cp_model.CpSolver], None] | None = None
    #: Polled on the solver thread at every improving solution. Must be cheap and must not block:
    #: it decides, it does not act. Returning true ends the current stage and the ladder. It must
    #: also be TOTAL: the propagation rule above is for the worker-thread hooks, whereas this one
    #: runs inside OR-tools' solution callback, where a raise surfaces through the pybind layer in a
    #: way the engine does not define. Wrap it before wiring it — the service satisfies that by
    #: passing `threading.Event.is_set`, which is atomic, lock-free and total.
    should_stop: Callable[[], bool] | None = None


# Mode A and the full staged ladder both report TEN stages: one tier-1 stage (completeness, or
# maximal placement) followed by tiers 2-10. The app's `LADDER_TIER_COUNT` is this same number — it
# is the denominator in "stage 4 of 10" — so the two must move together if a tier is ever added.
# A policy (S-307) may PERMUTE this visit order but never shrink or grow it — `SolveConfig.ladder`
# is validated as a permutation — which is what keeps the count invariant under every policy.
_LADDER_TIER_INDICES = tuple(range(1, 10))
_FULL_LADDER_STAGES = 1 + len(_LADDER_TIER_INDICES)


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
    # Tier number -> the objective value at or below which that ladder stage stops early instead of
    # burning its budget. Empty by default, which is byte-for-byte today's behaviour. It lives HERE
    # for the same reason `clean_mode` does: `parity()` and `evaluate_board()` take no config, so no
    # target can reach the 10/10 objective-parity gate. Never move this into `build_objective` or
    # `build_model` — that would put the gate's own model inside the change.
    targets: Mapping[int, int] = field(default_factory=dict)
    # Read only through `_run_solver` and the ladder, for the same insulation reason.
    hooks: SolveHooks = field(default_factory=SolveHooks)
    # The ladder's VISIT ORDER for tiers 2-10, as 0-based indices into `objective.tiers` (S-307's
    # policy presets, `policy.py`). None is the canonical order — byte-for-byte today's transcript.
    # Read by `solve_staged` and `solve_complete` ALONE, for the same insulation reason as
    # `clean_mode`: `parity()` and `evaluate_board()` take no config, so the 10/10 objective-parity
    # gate cannot see it by construction. It permutes only the order the ladder walks; it must never
    # reorder `build_objective`'s tuple, which every positional index and the gate itself key on.
    # `solve_repair` builds its own config and passes its own sparse `(0, 3)`, so it cannot leak there.
    ladder: tuple[int, ...] | None = None

    def __post_init__(self) -> None:
        # A permutation and nothing else: a subset or a repeat would change the stage COUNT, which
        # the app's `LADDER_TIER_COUNT` and every "stage N of 10" surface hold constant.
        if self.ladder is not None and sorted(self.ladder) != list(_LADDER_TIER_INDICES):
            raise ValueError(
                f"ladder must be a permutation of {_LADDER_TIER_INDICES}, got {tuple(self.ladder)}"
            )


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
    stages, board, proven = _run_ladder(
        bundle, objective, dump, config, _ladder(config), incumbent, mode="full", preceding=(tier1,)
    )
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
    # No target is consulted here, and none is offered: this stage MAXIMISES, so a `<= target` test
    # would read backwards. `SOLVER_STAGE_TARGETS` drops tier 1 for the same reason.
    started = StageEvent(kind="started", tier=1, name="unplacedTotal", position=1, total=_FULL_LADDER_STAGES)
    _emit(config, started)
    status, solver, stopped_by = _run_solver(
        config, config.stage_budget_s, "tier-1-unplacedTotal", bundle.model
    )
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
        stopped_by=stopped_by,
    )
    _emit(
        config,
        StageEvent(
            kind="completed",
            tier=1,
            name="unplacedTotal",
            position=1,
            total=_FULL_LADDER_STAGES,
            report=report,
            stages=(report,),
            checkpoint=_checkpoint("full", incumbent, (report,)) if solved else None,
        ),
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
    started = StageEvent(kind="started", tier=1, name="completeness", position=1, total=_FULL_LADDER_STAGES)
    _emit(config, started)
    bundle, status, solver, stopped_by = _feasibility(dump, config, clean=config.clean_mode)
    # Only a PROOF of infeasibility falls back: an UNKNOWN is a budget verdict on the model, not
    # evidence that clean is unsatisfiable, and re-solving it would just burn the budget twice.
    fallback = config.clean_mode and status == cp_model.INFEASIBLE
    if fallback:
        bundle, status, solver, stopped_by = _feasibility(dump, config, clean=False)

    solved = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    feasibility = StageReport(
        tier=1,
        name="completeness",
        status=solver.status_name(status),
        best=0 if solved else None,
        bound=None,
        wall_clock_s=solver.wall_time,
        stopped_by=stopped_by,
    )
    # Internal only — `to_generation_result` never reads `notes`, so nothing here reaches the wire.
    clean_notes: dict[str, Any] = {"clean_fallback": fallback} if config.clean_mode else {}

    if solved:
        incumbent = _extract_board(bundle, solver)
        _emit(
            config,
            StageEvent(
                kind="completed",
                tier=1,
                name="completeness",
                position=1,
                total=_FULL_LADDER_STAGES,
                report=feasibility,
                stages=(feasibility,),
                checkpoint=_checkpoint("complete", incumbent, (feasibility,)),
            ),
        )
        if stopped_by == "cancelled":
            # Cancelled during the feasibility solve. The board is complete and deliverable — it just
            # never met the ladder. Starting it would be the cascade `_run_ladder` breaks out of, one
            # tier further up, so "a cancellation ends the run" stays uniform across both halves.
            return SolveResult(
                mode="complete",
                board=_generated(incumbent),
                stages=(feasibility,),
                proven_optimal=False,
                notes={"outcome": "complete", **clean_notes},
            )
        objective = build_objective(bundle)  # add the tier machinery now that completeness holds
        stages, board, proven = _run_ladder(
            bundle,
            objective,
            dump,
            config,
            _ladder(config),
            incumbent,
            mode="complete",
            preceding=(feasibility,),
        )
        return SolveResult(
            mode="complete",
            board=board,
            stages=(feasibility, *stages),
            proven_optimal=proven,
            notes={"outcome": "complete", **clean_notes},
        )

    _emit(
        config,
        StageEvent(
            kind="completed",
            tier=1,
            name="completeness",
            position=1,
            total=_FULL_LADDER_STAGES,
            report=feasibility,
            stages=(feasibility,),
        ),
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
) -> tuple[
    ModelBundle, cp_model.CpSolverStatus, cp_model.CpSolver, Literal["budget", "target", "cancelled"] | None
]:
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
    # No target: this is a SATISFIABILITY solve with no objective to compare one against. A stop
    # predicate still applies — Mode A alone can run for 300 s.
    status, solver, stopped_by = _run_solver(config, config.mode_a_budget_s, stage, bundle.model)
    return bundle, status, solver, stopped_by


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
        targets=config.targets,
        hooks=config.hooks,
    )
    stages, board, proven = _run_ladder(bundle, objective, dump, repair_config, (0, 3), greedy, mode="repair")
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
    stop_reason = _stop_reason(result.stages) if not result.proven_optimal else None
    if stop_reason is not None:
        diagnostics["stopReason"] = stop_reason
    return {
        "placements": [
            {"cohort": p.cohort, "courseId": p.course_id, "day": p.day, "period": p.period, "week": p.week}
            for p in result.board
        ],
        "diagnostics": diagnostics,
    }


def _stop_reason(stages: tuple[StageReport, ...]) -> Literal["budget", "target", "cancelled"] | None:
    """Why the RUN ended, read off the stages that did not prove optimality.

    Cancellation wins outright — one cancelled stage makes the whole run cancelled, whatever the rest
    did. Otherwise the run only counts as target-stopped when EVERY stage that fell short reached its
    target; a single stage the ceiling ended, or one that found nothing at all (no attribution, so
    the ceiling is what ended it), makes the run budget-stopped. ``interrupted`` is not derivable
    here by construction: it labels a job that never came back, which only the app can observe.

    Never called on a proven-optimal result — ``stopReason`` is then an omitted key, not a value. It
    IS called on a mid-ladder checkpoint (``proven_optimal=False`` by construction), and when every
    stage so far proved optimal there is nothing to attribute: ``None``, so the key is omitted rather
    than claiming a ceiling ended a run that nothing has ended yet."""
    if any(stage.stopped_by == "cancelled" for stage in stages):
        return "cancelled"
    fell_short = [stage for stage in stages if stage.status != "OPTIMAL"]
    if not fell_short:
        return None
    if all(stage.stopped_by == "target" for stage in fell_short):
        return "target"
    return "budget"


# --- the shared ladder ----------------------------------------------------------------------------


def _run_ladder(
    bundle: ModelBundle,
    objective: ObjectiveModel,
    dump: Dump,
    config: SolveConfig,
    tier_indices: Iterable[int],
    incumbent: dict[PlacementKey, int],
    *,
    mode: str,
    preceding: tuple[StageReport, ...] = (),
) -> tuple[tuple[StageReport, ...], tuple[Placement, ...], bool]:
    """Optimise the given 0-based tier indices in order; harden each; return (stages, board, proven).

    ``preceding`` is the transcript the caller already holds — Mode A's completeness stage, the full
    ladder's maximal-placement stage — and it is what makes ``position``/``total`` and each
    checkpoint's ``stages`` describe the WHOLE run rather than this call's slice of it.

    A stage that ends ``cancelled`` ends the ladder, and the predicate is asked again before each
    stage starts. The break alone is not enough: without the loop-top check a stop would cascade
    (every remaining tier starting and burning a solve for a decision already taken) whenever the
    interrupted stage ended without a ``cancelled`` attribution — ``stop_search()`` records nothing
    when no improving solution follows it, so an UNKNOWN stage would hand the stop to the next
    stage's budget.
    """
    indices = tuple(tier_indices)
    total = len(preceding) + len(indices)
    stages: list[StageReport] = []
    proven = True
    for offset, idx in enumerate(indices):
        # The latch may have fired without a `cancelled` attribution — `stop_search()` interrupting
        # a stage that then reports `budget` or nothing (no improving solution followed it). Ask the
        # predicate before starting another stage rather than spending a solve to find out. The
        # tiers a stop skips were never proved, whatever the stages that did run managed.
        if config.hooks.should_stop is not None and config.hooks.should_stop():
            proven = False
            break
        tier = objective.tiers[idx]
        position = len(preceding) + offset + 1
        if idx == 2:  # about to minimise totalSlots — inject the clique cut for completed cohorts
            _add_clique_cuts(bundle, objective, dump, incumbent)

        _emit(
            config,
            StageEvent(kind="started", tier=idx + 1, name=tier.name, position=position, total=total),
        )

        # ortools declares `CpModel.clear_hints(self)` with no annotations at all, so `--strict`
        # reads the call as untyped. Upstream gap, not ours.
        bundle.model.clear_hints()  # type: ignore[no-untyped-call]
        _hint_board(bundle, incumbent)
        bundle.model.minimize(tier.var)
        status, solver, stopped_by = _run_solver(
            config,
            config.stage_budget_s,
            f"tier-{idx + 1}-{tier.name}",
            bundle.model,
            target=config.targets.get(idx + 1),
        )

        solved = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        best = int(round(solver.objective_value)) if solved else None
        report = StageReport(
            tier=idx + 1,
            name=tier.name,
            status=solver.status_name(status),
            best=best,
            bound=int(round(solver.best_objective_bound)) if solved else None,
            wall_clock_s=solver.wall_time,
            stopped_by=stopped_by,
        )
        stages.append(report)
        if solved:
            incumbent = _extract_board(bundle, solver)
            bundle.model.add(tier.var <= best)  # harden: no later stage may worsen this tier
        proven = proven and status == cp_model.OPTIMAL

        transcript = (*preceding, *stages)
        _emit(
            config,
            StageEvent(
                kind="completed",
                tier=idx + 1,
                name=tier.name,
                position=position,
                total=total,
                report=report,
                stages=transcript,
                checkpoint=_checkpoint(mode, incumbent, transcript) if solved else None,
            ),
        )
        if stopped_by == "cancelled":
            break
    return tuple(stages), _generated(incumbent), proven


def _ladder(config: SolveConfig) -> tuple[int, ...]:
    """The visit order the two staged solvers walk: the policy's, or canonical when none was set."""
    return _LADDER_TIER_INDICES if config.ladder is None else config.ladder


def _emit(config: SolveConfig, event: StageEvent) -> None:
    """Raise a stage event, if anyone is listening. Exceptions propagate — see :class:`SolveHooks`."""
    if config.hooks.on_stage is not None:
        config.hooks.on_stage(event)


def _checkpoint(
    mode: str, incumbent: dict[PlacementKey, int], stages: tuple[StageReport, ...]
) -> SolveResult:
    """The incumbent board as a self-contained, deliverable :class:`SolveResult`.

    ``proven_optimal=False`` unconditionally: a checkpoint is by definition mid-ladder, and a later
    stage can only tighten it. That is exactly what makes it usable — ``to_generation_result`` reads
    ``board``, ``stages`` and ``proven_optimal`` and nothing else, so a checkpoint goes onto the wire
    through the SAME path the terminal write uses, with no second shaping function to drift."""
    return SolveResult(mode=mode, board=_generated(incumbent), stages=stages, proven_optimal=False)


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


class _StageStop(cp_model.CpSolverSolutionCallback):
    """Ends a stage early, at a solution, for a reason worth recording.

    **It decides; it never acts.** CP-SAT runs this on the SOLVER's own thread while search is live,
    so the body compares two integers and calls ``stop_search()`` — no I/O, no locks, no allocation
    worth the name. Everything durable happens between stages, on the worker thread, from
    :class:`StageEvent`.

    It also only ever runs at an IMPROVING SOLUTION, which is why it is a backstop rather than a stop
    button: a stage that finds nothing is never asked. Stop & keep's immediate half is the live
    solver handle from :attr:`SolveHooks.on_solver` — the service's registry calls ``stop_search()``
    on it — and this predicate is what then ends the LADDER rather than just the current stage.
    """

    def __init__(self, target: int | None, should_stop: Callable[[], bool] | None) -> None:
        super().__init__()
        self._target = target
        self._should_stop = should_stop
        self.fired: Literal["target", "cancelled"] | None = None

    def on_solution_callback(self) -> None:
        # Cancellation is checked first and wins a tie: a caller that asked to stop gets `cancelled`
        # recorded even when this same solution happens to sit at the target, because the ladder
        # breaks out on `cancelled` and would otherwise march on to the next tier.
        if self._should_stop is not None and self._should_stop():
            self.fired = "cancelled"
            self.stop_search()
            return
        if self._target is not None and self.objective_value <= self._target:
            self.fired = "target"
            self.stop_search()


def _run_solver(
    config: SolveConfig,
    budget_s: float,
    stage: str,
    model: cp_model.CpModel,
    *,
    target: int | None = None,
) -> tuple[cp_model.CpSolverStatus, cp_model.CpSolver, Literal["budget", "target", "cancelled"] | None]:
    """Configure a solver (budget, workers, seed), solve, and tee the search log to a per-stage file.

    Returns the status, the solver, and why the stage ended when it did not prove optimality. The
    callback is attached ONLY when there is something for it to decide, so an unconfigured solve
    takes exactly today's ``solver.solve(model)`` path."""
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
    if config.hooks.on_solver is not None:
        config.hooks.on_solver(solver)
    decides = target is not None or config.hooks.should_stop is not None
    stop = _StageStop(target, config.hooks.should_stop) if decides else None
    status = solver.solve(model) if stop is None else solver.solve(model, stop)
    if path is not None:
        path.write_text("\n".join(lines))
    return status, solver, _stopped_by(status, stop)


def _stopped_by(
    status: cp_model.CpSolverStatus, stop: _StageStop | None
) -> Literal["budget", "target", "cancelled"] | None:
    """Why a stage ended, or ``None`` when there is nothing to attribute.

    OPTIMAL is ``None`` because nothing ended it early — it finished. INFEASIBLE and UNKNOWN are also
    ``None``: neither has a solution, so neither has a stop to explain, and the result-level
    derivation reads a missing attribution on a non-optimal stage as the ceiling having ended it."""
    if status == cp_model.OPTIMAL:
        return None
    if stop is not None and stop.fired is not None:
        return stop.fired
    return "budget" if status == cp_model.FEASIBLE else None


def _log_path(config: SolveConfig, stage: str) -> Path | None:
    if config.log_dir is None:
        return None
    config.log_dir.mkdir(parents=True, exist_ok=True)
    return config.log_dir / f"{stage}.log"
