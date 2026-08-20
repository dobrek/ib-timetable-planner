"""Solve-to-target, the stage-event seam, and the result-level ``stopReason`` derivation.

Everything here is CONFIG-GATED behaviour: with empty ``targets`` and an empty ``SolveHooks`` the
engine runs exactly as it did before, which is what ``test_observation_does_not_perturb_the_transcript``
pins. The parity gate cannot see any of it by construction — ``parity()`` and ``evaluate_board()``
take no ``SolveConfig`` — so ``test_objective.py`` stays the untouched 10/10 authority.

Stages are compared through :func:`_projected`, never by board equality: ``wall_clock_s`` differs on
every run and a time-budgeted CP-SAT search is not bit-reproducible, so only the decision-carrying
fields are stable enough to assert. The micro instance at ``workers=1`` is stable in exactly those
fields — verified by repetition, which is why it is the fixture for every neutrality claim.
"""

from collections.abc import Iterable
from dataclasses import replace

from ortools.sat.python import cp_model

import builders as b
from cpsat_engine.schema import Dump, Placement, Snapshot
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
    assert all(e.report is None and e.checkpoint is None for e in started)
    assert [e.report for e in completed] == list(result.stages)


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
