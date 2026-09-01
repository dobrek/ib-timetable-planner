"""Solve-to-target, the stage-event seam, and the result-level ``stopReason`` derivation.

Everything here is CONFIG-GATED behaviour: with empty ``targets`` and an empty ``SolveHooks`` the
engine runs exactly as it did before, which is what ``test_observation_does_not_perturb_the_transcript``
pins. The parity gate cannot see any of it by construction — ``parity()`` and ``evaluate_board()``
take no ``SolveConfig`` — so ``test_objective.py`` stays the untouched 10/10 authority.

Stages are compared through :func:`_projected`, never by board equality: ``wall_clock_s`` differs on
every run and a time-budgeted CP-SAT search is not bit-reproducible, so only the decision-carrying
fields are stable enough to assert. The micro instance at ``workers=1`` is stable in exactly those
fields — verified by repetition, which is why it is the fixture for every neutrality claim.

Section (h) is the one exception to "micro instance, no I/O, no threads": Stop & keep's immediate
half is ``CpSolver.stop_search()`` called from ANOTHER thread against a search that is genuinely
running, and no amount of faking proves that. It rides the seed fixture because the micro instance
finishes before a second thread could reach it.
"""

import threading
import time
from collections.abc import Iterable
from dataclasses import replace
from pathlib import Path

from ortools.sat.python import cp_model

import builders as b
from cpsat_engine.schema import Dump, Placement, Snapshot, load_dump
from cpsat_engine.solve import (
    SolveConfig,
    SolveHooks,
    SolveResult,
    StageEvent,
    StageReport,
    evaluate_board,
    solve_complete,
    solve_staged,
    to_generation_result,
)
from cpsat_service.registry import JobRegistry

# Tier 3 (totalSlots) is the ladder rung the micro instance reliably ends at a SOLUTION rather than a
# proof: tiers 2, 4, 5 and 6 reach 0 and prove it, so their solution callback may never fire at all.
# Every target/cancel case below therefore aims at tier 3 — a callback that is never invoked cannot
# stop anything, and a test that assumed otherwise would be flaky rather than wrong.
TOTAL_SLOTS_TIER = 3

# Any first solution satisfies this, so it stops the stage at the first improving solution it sees.
REACHABLE = 10**9
# No tier can go below zero, so this one is never satisfied and the stage runs its budget out.
UNREACHABLE = -1

MICRO = SolveConfig(mode_a_budget_s=5.0, stage_budget_s=2.0, workers=1)


def _dump(snap: Snapshot, greedy: Iterable[Placement] = ()) -> Dump:
    return Dump(
        format_version=1,
        meta={},
        snapshot=snap,
        greedy_placements=tuple(greedy),
        greedy_diagnostics={},
        objective=(),
    )


def _micro_snapshot() -> Snapshot:
    return b.snapshot(
        dp1=b.cohort(
            courses=[
                b.course("A", teachers=["T1"], students=["s1", "s2"], hours=2),
                b.course("BB", teachers=["T2"], students=["s1"], hours=2),
                b.course("CC", teachers=["T3"], students=["s3"], hours=2),
            ]
        ),
        dp2=b.cohort(courses=[b.course("D", teachers=["T1"], students=["s4"], hours=2)]),
    )


def _projected(stages: Iterable[StageReport]) -> list[tuple[int, str, str, int | None, str | None]]:
    """Every field of a stage that is stable across runs. ``wall_clock_s`` and ``bound`` are not."""
    return [(s.tier, s.name, s.status, s.best, s.stopped_by) for s in stages]


def _stage(stages: Iterable[StageReport], tier: int) -> StageReport:
    return next(s for s in stages if s.tier == tier)


# --- (a) a reachable target ends a stage early, and the board is still hardened --------------------


def test_a_reachable_target_stops_a_stage_early_and_records_why() -> None:
    dump = _dump(_micro_snapshot())
    result = solve_complete(dump, replace(MICRO, targets={TOTAL_SLOTS_TIER: REACHABLE}))

    stage = _stage(result.stages, TOTAL_SLOTS_TIER)
    assert stage.stopped_by == "target"
    assert stage.status == "FEASIBLE", "stopping at a solution is not a proof"
    assert stage.wall_clock_s < MICRO.stage_budget_s, "a target stop must not burn the budget"


def test_a_target_stopped_ladder_still_produces_a_fully_hardened_board() -> None:
    # The point of the whole mechanism: a stage that stops early still HARDENS `tier_k <= best_k`, so
    # every later stage is bound by it and the finished board obeys every rung it was measured on.
    dump = _dump(_micro_snapshot())
    result = solve_complete(dump, replace(MICRO, targets={TOTAL_SLOTS_TIER: REACHABLE}))

    scored = evaluate_board(dump, result.board)
    assert scored[0] == 0, "the micro instance is completable — tier 1 reaches 0"
    for stage in result.stages:
        if stage.best is not None:
            assert scored[stage.tier - 1] <= stage.best, (stage.name, scored[stage.tier - 1], stage.best)


# --- (b) an unreachable target changes nothing ----------------------------------------------------


def test_an_unreachable_target_leaves_the_stage_to_its_budget() -> None:
    dump = _dump(_micro_snapshot())
    result = solve_complete(dump, replace(MICRO, targets={TOTAL_SLOTS_TIER: UNREACHABLE}))

    stage = _stage(result.stages, TOTAL_SLOTS_TIER)
    assert stage.stopped_by in (None, "budget"), "nothing was reached, so nothing may claim a target"
    assert stage.status in ("OPTIMAL", "FEASIBLE")


def test_an_unreachable_target_is_indistinguishable_from_no_target() -> None:
    # The callback is attached, and it never fires — so the transcript and the board must be the
    # ones a plain run produces at the same seed and budget. This is the neutrality proof for the
    # TARGET path; (c) below proves it for the hook path.
    dump = _dump(_micro_snapshot())
    targeted = solve_complete(dump, replace(MICRO, targets={TOTAL_SLOTS_TIER: UNREACHABLE}))
    plain = solve_complete(dump, MICRO)

    assert _projected(targeted.stages) == _projected(plain.stages)
    assert targeted.board == plain.board


# --- (c) neutrality: observing a solve does not change it -----------------------------------------


def test_observation_does_not_perturb_the_transcript() -> None:
    dump = _dump(_micro_snapshot())
    seen: list[StageEvent] = []
    observed = solve_complete(dump, replace(MICRO, hooks=SolveHooks(on_stage=seen.append)))
    plain = solve_complete(dump, MICRO)

    assert _projected(observed.stages) == _projected(plain.stages)
    assert seen, "the observer was actually attached"


def test_an_empty_target_map_is_the_default() -> None:
    # The gate that keeps "unset behaves exactly as before" honest at the type level rather than by
    # inspection: the fields exist, and their defaults are the absence of the feature.
    assert SolveConfig().targets == {}
    assert SolveConfig().hooks == SolveHooks()
    hooks = SolveHooks()
    assert hooks.on_stage is None and hooks.on_solver is None and hooks.should_stop is None


# --- (d) the stage-event sequence -----------------------------------------------------------------


def test_stage_events_arrive_as_started_completed_pairs_in_tier_order() -> None:
    dump = _dump(_micro_snapshot())
    seen: list[StageEvent] = []
    result = solve_complete(dump, replace(MICRO, hooks=SolveHooks(on_stage=seen.append)))

    assert [e.kind for e in seen] == ["started", "completed"] * len(result.stages)
    started = [e for e in seen if e.kind == "started"]
    completed = [e for e in seen if e.kind == "completed"]
    assert [e.tier for e in started] == [s.tier for s in result.stages]
    assert [e.name for e in started] == [s.name for s in result.stages]
    assert [e.position for e in started] == list(range(1, len(result.stages) + 1))
    assert {e.total for e in seen} == {10}, "Mode A always reports ten stages, whatever it manages"
    assert all(e.report is None and e.checkpoint is None and e.stages == () for e in started)
    assert [e.report for e in completed] == list(result.stages)


def test_every_completed_event_carries_the_whole_transcript_so_far() -> None:
    # Independent of the checkpoint on purpose: a stage that solved nothing still belongs in the
    # transcript, and the service writes `stages` from THIS field rather than the checkpoint's copy.
    dump = _dump(_micro_snapshot())
    seen: list[StageEvent] = []
    result = solve_complete(dump, replace(MICRO, hooks=SolveHooks(on_stage=seen.append)))
    completed = [e for e in seen if e.kind == "completed"]

    assert [len(e.stages) for e in completed] == list(range(1, len(result.stages) + 1))
    assert all(e.stages[-1] is e.report for e in completed), "the last entry is this stage"
    assert _projected(completed[-1].stages) == _projected(result.stages)


def test_a_checkpoint_accompanies_exactly_the_stages_that_solved() -> None:
    dump = _dump(_micro_snapshot())
    seen: list[StageEvent] = []
    solve_complete(dump, replace(MICRO, hooks=SolveHooks(on_stage=seen.append)))

    for event in (e for e in seen if e.kind == "completed"):
        solved = event.report is not None and event.report.status in ("OPTIMAL", "FEASIBLE")
        assert (event.checkpoint is not None) is solved, (event.tier, event.report)


def test_each_checkpoint_carries_the_whole_transcript_so_far() -> None:
    dump = _dump(_micro_snapshot())
    seen: list[StageEvent] = []
    result = solve_complete(dump, replace(MICRO, hooks=SolveHooks(on_stage=seen.append)))
    checkpoints = [e.checkpoint for e in seen if e.kind == "completed" and e.checkpoint is not None]

    lengths = [len(c.stages) for c in checkpoints]
    assert lengths == sorted(lengths), "a transcript only ever grows"
    assert all(c.proven_optimal is False for c in checkpoints), "mid-ladder is never a proof"
    assert all(c.mode == "complete" for c in checkpoints)
    last = checkpoints[-1]
    assert _projected(last.stages) == _projected(result.stages), "the final checkpoint IS the run"
    assert last.board, "a checkpoint carries the incumbent board, not an empty one"


def test_a_checkpoint_shapes_into_a_valid_generation_result_through_the_terminal_path() -> None:
    # The property the service depends on: a mid-ladder checkpoint needs no second shaping function.
    dump = _dump(_micro_snapshot())
    seen: list[StageEvent] = []
    solve_complete(dump, replace(MICRO, hooks=SolveHooks(on_stage=seen.append)))
    checkpoint = next(e.checkpoint for e in seen if e.kind == "completed" and e.checkpoint is not None)
    assert checkpoint is not None

    payload = to_generation_result(dump, checkpoint)
    assert set(payload) == {"placements", "diagnostics"}
    assert payload["diagnostics"]["partial"] is True
    # `stopReason` says why a run ENDED, so a checkpoint carries it only once some stage has fallen
    # short of optimality; until then the key is honestly absent.
    fell_short = any(stage.status != "OPTIMAL" for stage in checkpoint.stages)
    assert ("stopReason" in payload["diagnostics"]) is fell_short
    if fell_short:
        assert payload["diagnostics"]["stopReason"] in ("budget", "target", "cancelled")


def test_the_full_staged_ladder_reports_its_tier_one_stage_too() -> None:
    dump = _dump(_micro_snapshot())
    seen: list[StageEvent] = []
    result = solve_staged(dump, replace(MICRO, hooks=SolveHooks(on_stage=seen.append)))

    assert [e.tier for e in seen if e.kind == "started"] == [s.tier for s in result.stages]
    assert seen[0].tier == 1 and seen[0].position == 1 and seen[0].total == 10
    assert all(e.checkpoint is None or e.checkpoint.mode == "full" for e in seen)


# --- (e) the live solver handle -------------------------------------------------------------------


def test_the_live_solver_is_offered_at_least_once_per_stage() -> None:
    # "At least", not "exactly": Mode A's clean fallback solves the feasibility model twice, and the
    # LATEST handle is the live one — `attach_solver` overwrites for exactly that reason.
    dump = _dump(_micro_snapshot())
    solvers: list[cp_model.CpSolver] = []
    stages: list[StageEvent] = []
    result = solve_complete(
        dump,
        replace(MICRO, hooks=SolveHooks(on_solver=solvers.append, on_stage=stages.append)),
    )

    assert len(solvers) >= len(result.stages)
    assert all(isinstance(s, cp_model.CpSolver) for s in solvers)


# --- (f) a stop predicate ends the stage AND the ladder -------------------------------------------


def test_a_stop_predicate_cancels_one_stage_and_ends_the_ladder() -> None:
    dump = _dump(_micro_snapshot())
    reached_tier_3 = False

    def on_stage(event: StageEvent) -> None:
        nonlocal reached_tier_3
        if event.kind == "started" and event.tier == TOTAL_SLOTS_TIER:
            reached_tier_3 = True

    hooks = SolveHooks(on_stage=on_stage, should_stop=lambda: reached_tier_3)
    result = solve_complete(dump, replace(MICRO, hooks=hooks))

    cancelled = [s for s in result.stages if s.stopped_by == "cancelled"]
    assert [s.tier for s in cancelled] == [TOTAL_SLOTS_TIER], "exactly one stage may carry the cancellation"
    assert result.stages[-1].tier == TOTAL_SLOTS_TIER, "the ladder stops there rather than cascading"
    assert len(result.stages) < 10
    assert to_generation_result(dump, result)["diagnostics"]["stopReason"] == "cancelled"


def test_a_cancelled_run_still_returns_the_incumbent_board() -> None:
    dump = _dump(_micro_snapshot())
    hooks = SolveHooks(should_stop=lambda: True)
    result = solve_complete(dump, replace(MICRO, hooks=hooks))

    assert result.proven_optimal is False
    assert result.board, "Stop & keep is only possible if a cancelled run keeps its board"


# --- (g) the result-level derivation matrix -------------------------------------------------------


def _result(*stages: StageReport, proven: bool = False) -> SolveResult:
    return SolveResult(mode="complete", board=(), stages=stages, proven_optimal=proven)


def _report(tier: int, status: str, stopped_by: str | None) -> StageReport:
    return StageReport(
        tier=tier,
        name=f"tier{tier}",
        status=status,
        best=1,
        bound=1,
        wall_clock_s=1.0,
        stopped_by=stopped_by,  # type: ignore[arg-type]  # the matrix deliberately drives it as data
    )


def test_stop_reason_is_omitted_entirely_when_the_solve_proved_optimality() -> None:
    dump = _dump(_micro_snapshot())
    payload = to_generation_result(dump, _result(_report(2, "OPTIMAL", None), proven=True))
    assert "stopReason" not in payload["diagnostics"]


def test_a_checkpoint_whose_stages_all_proved_optimal_claims_no_stop_reason() -> None:
    # A checkpoint is ``proven_optimal=False`` by construction (the ladder is still running), but if
    # nothing has fallen short yet there is nothing to attribute — "budget" would be a stored lie.
    dump = _dump(_micro_snapshot())
    payload = to_generation_result(dump, _result(_report(2, "OPTIMAL", None), _report(3, "OPTIMAL", None)))
    assert payload["diagnostics"]["partial"] is True
    assert "stopReason" not in payload["diagnostics"]


def test_one_cancelled_stage_makes_the_whole_run_cancelled() -> None:
    dump = _dump(_micro_snapshot())
    stages = (_report(2, "FEASIBLE", "target"), _report(3, "FEASIBLE", "cancelled"))
    assert to_generation_result(dump, _result(*stages))["diagnostics"]["stopReason"] == "cancelled"


def test_a_run_is_target_stopped_only_when_every_shortfall_reached_its_target() -> None:
    dump = _dump(_micro_snapshot())
    stages = (_report(2, "OPTIMAL", None), _report(3, "FEASIBLE", "target"))
    assert to_generation_result(dump, _result(*stages))["diagnostics"]["stopReason"] == "target"


def test_one_budget_stopped_stage_makes_the_whole_run_budget_stopped() -> None:
    dump = _dump(_micro_snapshot())
    stages = (_report(2, "FEASIBLE", "target"), _report(3, "FEASIBLE", "budget"))
    assert to_generation_result(dump, _result(*stages))["diagnostics"]["stopReason"] == "budget"


def test_a_stage_with_nothing_to_attribute_counts_as_budget() -> None:
    # UNKNOWN found no solution, so nothing attributed the stop — but the ceiling is what ended it,
    # and calling that run "target" would overclaim on the one stage that reached nothing at all.
    dump = _dump(_micro_snapshot())
    stages = (_report(2, "FEASIBLE", "target"), _report(3, "UNKNOWN", None))
    assert to_generation_result(dump, _result(*stages))["diagnostics"]["stopReason"] == "budget"


# --- (h) the live stop: `request_stop` fired from another thread against a real solve --------------
#
# The C3 hole this closes. Every stop test above (and every SIGTERM test in `test_service.py`) latches
# around a FAKE solve: the latch is read after the fact, so `stop_search()` — the half that actually
# interrupts a search in flight — was wired and never exercised. This is the only test in the repo
# that fires it against live CP-SAT.

SEED_FIXTURE = Path(__file__).parent / "fixtures" / "seed-plan-a.json"
LIVE_JOB_ID = "7b3c1d90-5e42-4a18-9f06-1c8d7e2b4a35"

# Deliberately generous: the assertion is that the stop lands in a small fraction of it. The seed's
# tier-3 stage burns a budget this size without proving anything, so an un-stopped run of this same
# config could not possibly finish inside the ceiling below — that gap IS the assertion.
LIVE_STAGE_BUDGET_S = 60.0
LIVE_CEILING_S = 25.0

# Tier 3 (totalSlots) is the first ladder rung the seed reliably ends at a SOLUTION rather than a
# proof, so the solver is genuinely searching when the stop arrives. Same reasoning as TOTAL_SLOTS_TIER
# above, applied to a real instance.
LIVE_STOP_TIER = TOTAL_SLOTS_TIER

# Long enough that the stop lands inside `solver.solve()` rather than in the microseconds before it —
# `on_solver` fires immediately BEFORE the call, so without this the test could pass by latching a
# handle that had not started.
LIVE_SETTLE_S = 0.5


def test_a_stop_from_another_thread_ends_a_live_solve_well_inside_its_budget() -> None:
    registry = JobRegistry()
    registry.register(LIVE_JOB_ID)
    entry = registry.get(LIVE_JOB_ID)
    assert entry is not None

    dump = load_dump(SEED_FIXTURE)
    searching = threading.Event()
    tier = {"current": 0}

    def on_stage(event: StageEvent) -> None:
        if event.kind == "started":
            tier["current"] = event.tier

    def on_solver(solver: cp_model.CpSolver) -> None:
        registry.attach_solver(LIVE_JOB_ID, solver)
        if tier["current"] == LIVE_STOP_TIER:
            searching.set()

    def stop_it() -> None:
        if not searching.wait(LIVE_CEILING_S):
            return
        time.sleep(LIVE_SETTLE_S)
        registry.request_stop(LIVE_JOB_ID, "requested")

    stopper = threading.Thread(target=stop_it, name="stopper", daemon=True)
    stopper.start()

    config = SolveConfig(
        mode_a_budget_s=LIVE_STAGE_BUDGET_S,
        stage_budget_s=LIVE_STAGE_BUDGET_S,
        # The shipped default. `workers=1` makes every seed ladder stage UNKNOWN, which would make
        # this a test of a solve that finds nothing rather than one that is interrupted.
        workers=8,
        hooks=SolveHooks(on_stage=on_stage, on_solver=on_solver, should_stop=entry.stop.is_set),
    )
    started_at = time.monotonic()
    result = solve_complete(dump, config)
    elapsed = time.monotonic() - started_at
    stopper.join(timeout=LIVE_CEILING_S)

    assert searching.is_set(), "the stop was never fired — tier 3 never attached a solver"
    assert entry.stop.is_set() and entry.stop_reason == "requested"
    assert elapsed < LIVE_CEILING_S, (
        f"a stop must end a live solve promptly; took {elapsed:.1f}s against a "
        f"{LIVE_STAGE_BUDGET_S}s per-stage budget"
    )
    stage = _stage(result.stages, LIVE_STOP_TIER)
    assert stage.wall_clock_s < LIVE_STAGE_BUDGET_S, "the interrupted stage did not burn its budget"
    # At most ONE stage past the stop, which is exactly what `_run_ladder` documents: `stop_search()`
    # ends the live search without any attribution (no improving solution followed the interrupt), so
    # the ladder's `cancelled` break is taken by the NEXT stage's first hinted solution instead. That
    # extra solve is short — it is hinted with the incumbent — and it is the whole cost of not polling
    # the predicate between stages.
    assert result.stages[-1].tier <= LIVE_STOP_TIER + 1, "the ladder ends where the stop landed"
    assert len(result.stages) < 10


def test_the_board_a_live_stop_leaves_behind_is_the_one_that_gets_kept() -> None:
    """The "keep" half. `stop_search()` ending a search mid-flight must not cost the incumbent: the
    board `solve_complete` returns is the last hardened one, and the checkpoint the service already
    wrote for the previous stage is that same board."""
    registry = JobRegistry()
    registry.register(LIVE_JOB_ID)
    entry = registry.get(LIVE_JOB_ID)
    assert entry is not None

    dump = load_dump(SEED_FIXTURE)
    checkpoints: list[SolveResult] = []
    searching = threading.Event()
    tier = {"current": 0}

    def on_stage(event: StageEvent) -> None:
        if event.kind == "started":
            tier["current"] = event.tier
        elif event.checkpoint is not None:
            checkpoints.append(event.checkpoint)

    def on_solver(solver: cp_model.CpSolver) -> None:
        registry.attach_solver(LIVE_JOB_ID, solver)
        if tier["current"] == LIVE_STOP_TIER:
            searching.set()

    def stop_it() -> None:
        if not searching.wait(LIVE_CEILING_S):
            return
        time.sleep(LIVE_SETTLE_S)
        registry.request_stop(LIVE_JOB_ID, "requested")

    stopper = threading.Thread(target=stop_it, name="stopper", daemon=True)
    stopper.start()

    result = solve_complete(
        dump,
        SolveConfig(
            mode_a_budget_s=LIVE_STAGE_BUDGET_S,
            stage_budget_s=LIVE_STAGE_BUDGET_S,
            workers=8,
            hooks=SolveHooks(on_stage=on_stage, on_solver=on_solver, should_stop=entry.stop.is_set),
        ),
    )
    stopper.join(timeout=LIVE_CEILING_S)

    assert searching.is_set(), "the stop was never fired — tier 3 never attached a solver"
    assert result.board, "Stop & keep is only Stop & keep if the incumbent survives the interrupt"
    assert checkpoints, "at least one stage completed before the stop, so there is something to keep"
    assert checkpoints[-1].board, "the checkpoint the service wrote carries a board, not an empty one"
    payload = to_generation_result(dump, checkpoints[-1])
    assert payload["placements"], "and it shapes into a deliverable result through the terminal path"
