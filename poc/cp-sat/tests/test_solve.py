"""Solver pins: the ladder's hardening is monotonic, Mode A reports SAT on the seed, Mode B's 1-hop
neighbourhood matches a hand-computed conflict graph and closes a fabricated residue, and the result
JSON carries the TS import shape. Synthetic micro-instances keep the ladder tests fast and OPTIMAL;
the one seed test rides the fast completeness path.
"""

from pathlib import Path

import builders as b
from cpsat_engine.schema import Dump, Placement, load_dump
from cpsat_engine.solve import (
    SolveConfig,
    evaluate_board,
    solve_complete,
    solve_repair,
    solve_staged,
    to_generation_result,
)

FIXTURE = Path(__file__).parent / "fixtures" / "seed-plan-a.json"


def _dump(snap, greedy=()) -> Dump:
    return Dump(
        format_version=1,
        meta={},
        snapshot=snap,
        greedy_placements=tuple(greedy),
        greedy_diagnostics={},
        objective=(),
    )


def _micro_snapshot():
    # A tiny two-cohort instance: T1 spans cohorts; disjoint enough to solve every tier to OPTIMAL fast.
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


# --- the staged ladder: every hardened tier holds on the final board ------------------------------


def test_full_ladder_is_monotonic_and_complete() -> None:
    dump = _dump(_micro_snapshot())
    result = solve_staged(dump, SolveConfig(stage_budget_s=3.0))
    assert len(result.stages) == 10, "the full ladder walks all ten tiers"

    scored = evaluate_board(dump, result.board)
    assert scored[0] == 0, "the micro-instance is completable — tier 1 reaches 0"
    for stage in result.stages:
        if stage.best is not None:  # a solved stage hardened tier_k <= best_k; the final board obeys it
            assert scored[stage.tier - 1] <= stage.best, (stage.name, scored[stage.tier - 1], stage.best)


# --- Mode A: completeness is SAT on the seed ------------------------------------------------------


def test_mode_a_reports_complete_on_seed() -> None:
    dump = load_dump(FIXTURE)
    result = solve_complete(dump, SolveConfig(mode_a_budget_s=20.0, stage_budget_s=0.3))
    assert result.notes["outcome"] == "complete"
    assert evaluate_board(dump, result.board)[0] == 0, "the seed residue closes — a complete board"


def test_mode_a_infeasible_names_a_conflict_and_max_completable() -> None:
    from cpsat_engine.explain import explain_infeasibility

    # Only two cells (day 1, P1-P2); one teacher owes 4 hours across A and B -> completeness is impossible.
    snap = b.snapshot(
        dp1=b.cohort(
            courses=[b.course("A", teachers=["T1"], hours=2), b.course("B", teachers=["T1"], hours=2)]
        ),
        days=1,
        periods=2,
    )
    dump = _dump(snap)
    assert solve_complete(dump, SolveConfig(mode_a_budget_s=5.0)).notes["outcome"] == "infeasible"

    report = explain_infeasibility(dump, budget_s=5.0)
    assert set(report.conflict) and set(report.conflict) <= {("dp1", "A"), ("dp1", "B")}
    assert len(report.droppable) == 1, "dropping one course's completeness restores feasibility"
    assert len(report.completable) == 1, "only one of the two can be fully seated in two cells"
    assert set(report.droppable) | set(report.completable) == {("dp1", "A"), ("dp1", "B")}


# --- Mode B: the 1-hop neighbourhood is exactly the conflict graph of the residue -----------------


def test_repair_neighbourhood_matches_hand_computed() -> None:
    from cpsat_engine.solve import _greedy_board, _neighbourhood

    snap = b.snapshot(
        dp1=b.cohort(
            courses=[
                b.course("U", teachers=["T1"], students=["s1"], hours=1),
                b.course("Pt", teachers=["T1"], students=["s2"], hours=1),  # shares teacher T1
                b.course("Ps", teachers=["T2"], students=["s1"], hours=1),  # shares student s1
                b.course("Pn", teachers=["T3"], students=["s3"], hours=1),  # shares nothing
            ]
        )
    )
    # Greedy placed everyone EXCEPT U -> U is the residue frontier.
    greedy = [Placement("dp1", cid, 1, 1, "both") for cid in ("Pt", "Ps", "Pn")]
    dump = _dump(snap, greedy)

    hop1 = _neighbourhood(dump, _greedy_board(dump), hops=1)
    assert hop1 == {("dp1", "U"), ("dp1", "Pt"), ("dp1", "Ps")}  # Pn shares nothing -> excluded
    # Pn is isolated, so even a wider radius never reaches it.
    assert ("dp1", "Pn") not in _neighbourhood(dump, _greedy_board(dump), hops=2)


def test_repair_closes_a_fabricated_residue() -> None:
    snap = _micro_snapshot()
    # Fabricate a residue: greedy placed everything except course A (2 hours short).
    greedy = [
        Placement("dp1", "BB", 1, 1, "both"),
        Placement("dp1", "CC", 1, 1, "both"),
        Placement("dp2", "D", 1, 1, "both"),
    ]
    dump = _dump(snap, greedy)
    result = solve_repair(dump, SolveConfig(repair_budget_s=3.0))
    assert result.mode == "repair"
    assert result.notes["rows_freed"] >= 1
    assert evaluate_board(dump, result.board)[0] == 0, "repair closes the residue -> complete board"


# --- result shaping: the TS import contract -------------------------------------------------------


def test_generation_result_has_import_shape() -> None:
    from cpsat_engine.schema import _placement

    dump = _dump(_micro_snapshot())
    result = solve_staged(dump, SolveConfig(stage_budget_s=2.0))
    payload = to_generation_result(dump, result)

    assert set(payload) == {"placements", "diagnostics"}
    for row in payload["placements"]:
        assert _placement(row)  # each row re-parses as a Placement (round-trips through schema.py)
    diag = payload["diagnostics"]
    assert diag["engine"] == "cp-sat"
    assert set(diag["cohorts"]) == {"dp1", "dp2"}
    for cohort in ("dp1", "dp2"):
        entry = diag["cohorts"][cohort]
        assert {"occupiedSlotsBefore", "occupiedSlotsAfter", "unplaced", "lowerBound"} <= set(entry)
        assert all({"courseId", "missing"} == set(u) for u in entry["unplaced"])
