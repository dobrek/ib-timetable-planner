"""Solver pins: the ladder's hardening is monotonic, Mode A reports SAT on the seed, Mode B's 1-hop
neighbourhood matches a hand-computed conflict graph and closes a fabricated residue, and the result
JSON carries the TS import shape. Synthetic micro-instances keep the ladder tests fast and OPTIMAL;
the one seed test rides the fast completeness path.
"""

from collections.abc import Iterable
from pathlib import Path

import builders as b
from cpsat_engine.schema import BIWEEKLY, WEEK_A, WEEK_B, Dump, Placement, Snapshot, load_dump
from cpsat_engine.solve import (
    SolveConfig,
    evaluate_board,
    solve_complete,
    solve_repair,
    solve_staged,
    to_generation_result,
)

FIXTURE = Path(__file__).parent / "fixtures" / "seed-plan-a.json"

# `evaluate_board` returns the ten tiers positionally; tier 5 is softHits — the quantity clean mode
# constrains. Named because an index literal in five assertions is an off-by-one waiting to happen.
SOFT_HITS = 4

# Micro-instances throughout: the point of every clean-mode case below is which board comes back,
# not how long CP-SAT needs to prove it, so the budgets only have to be generous enough to be OPTIMAL.
CLEAN = SolveConfig(mode_a_budget_s=5.0, stage_budget_s=2.0, clean_mode=True)
DIRTY = SolveConfig(mode_a_budget_s=5.0, stage_budget_s=2.0)


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


# --- clean mode: `softHits == pinned floor`, at the feasibility stage -----------------------------
#
# The promise is NOT `softHits == 0` literally: pinned rows enter tier 5 as an irreducible constant,
# so one author pin on a soft cell would make the literal reading unsatisfiable on an otherwise
# perfectly completable plan. The shipped reading is "the solve adds no NEW soft violations", which
# collapses to `== 0` exactly when the floor is 0 — the common case.


def test_clean_mode_refuses_a_soft_cell_the_unconstrained_optimum_would_take() -> None:
    # Two teachers, one soft cell each, in a 1x2 grid. Co-locating both rows is strictly better at
    # tier 3 (totalSlots 1 vs 2) and EVERY co-located cell is soft for one of them — so the
    # unconstrained ladder hardens totalSlots first and then has to pay a soft hit for it.
    snap = b.snapshot(
        dp1=b.cohort(
            courses=[b.course("a", teachers=["T1"], hours=1), b.course("bb", teachers=["T2"], hours=1)]
        ),
        days=1,
        periods=2,
        availability=[b.soft("T1", 1, 2), b.soft("T2", 1, 1)],
    )
    dump = _dump(snap)

    assert evaluate_board(dump, solve_complete(dump, DIRTY).board)[SOFT_HITS] == 1

    clean = solve_complete(dump, CLEAN)
    assert clean.notes["outcome"] == "complete"
    assert clean.notes["clean_fallback"] is False
    assert evaluate_board(dump, clean.board)[SOFT_HITS] == 0, "clean spends a tier-3 slot to buy this"


def test_a_pin_on_a_soft_cell_solves_at_its_floor_rather_than_reading_as_infeasible() -> None:
    # The trap the floor exists for. `softHits == 0` is unsatisfiable here whatever the solver does
    # with the free hour, and the failure path would have called that "infeasible under the hard
    # rules" — a falsehood that goes on to blame innocent COURSES via `explain_infeasibility`.
    snap = b.snapshot(
        dp1=b.cohort(courses=[b.course("a", teachers=["T1"], hours=2)], pins=[b.pin("a", 1, 1)]),
        days=2,
        periods=2,
        availability=[b.soft("T1", 1, 1)],
    )
    dump = _dump(snap)

    result = solve_complete(dump, CLEAN)

    assert result.notes["outcome"] == "complete", "the hard rules are fine — only a soft cell is pinned"
    assert result.notes["clean_fallback"] is False, "the floor is satisfiable; nothing was dropped"
    assert evaluate_board(dump, result.board)[SOFT_HITS] == 1, "exactly the floor: the pin, nothing added"


def test_clean_infeasibility_falls_back_to_a_complete_board_rather_than_refusing() -> None:
    # One course, one cell, and that cell is soft: the floor is 0 (no pins) and no complete board can
    # reach it. A default that refused here would refuse a plan that completes perfectly well.
    snap = b.snapshot(
        dp1=b.cohort(courses=[b.course("a", teachers=["T1"], hours=1)]),
        days=1,
        periods=1,
        availability=[b.soft("T1", 1, 1)],
    )
    dump = _dump(snap)

    result = solve_complete(dump, CLEAN)

    assert result.notes["outcome"] == "complete"
    assert result.notes["clean_fallback"] is True, "the constraint was dropped and feasibility re-run"
    assert evaluate_board(dump, result.board)[SOFT_HITS] == 1, "above the floor — labelling is the app's job"


def test_clean_mode_holds_a_co_taught_pin_at_floor_two() -> None:
    # Floor arithmetic end to end: one pin row, two soft co-teachers. A floor of 1 here would make
    # the constraint unsatisfiable and silently divert a satisfiable plan into the fallback.
    snap = b.snapshot(
        dp1=b.cohort(courses=[b.course("a", teachers=["T1", "T2"], hours=2)], pins=[b.pin("a", 1, 1)]),
        days=2,
        periods=2,
        availability=[b.soft("T1", 1, 1), b.soft("T2", 1, 1)],
    )
    dump = _dump(snap)

    result = solve_complete(dump, CLEAN)

    assert result.notes["clean_fallback"] is False
    assert evaluate_board(dump, result.board)[SOFT_HITS] == 2


def test_clean_mode_holds_two_lane_disjoint_pins_on_one_soft_cell_at_floor_two() -> None:
    # The other undercount: opposite weeks share a cell legally, and tier 5 counts both rows.
    snap = b.snapshot(
        dp1=b.cohort(
            courses=[
                b.course("a", teachers=["T1"], hours=2, week_mode=BIWEEKLY),
                b.course("bb", teachers=["T1"], hours=2, week_mode=BIWEEKLY),
            ],
            pins=[b.pin("a", 1, 1, WEEK_A), b.pin("bb", 1, 1, WEEK_B)],
        ),
        days=2,
        periods=2,
        availability=[b.soft("T1", 1, 1)],
    )
    dump = _dump(snap)

    result = solve_complete(dump, CLEAN)

    assert result.notes["outcome"] == "complete"
    assert result.notes["clean_fallback"] is False
    assert evaluate_board(dump, result.board)[SOFT_HITS] == 2


def test_a_default_solve_carries_no_clean_note_at_all() -> None:
    """The flag defaults OFF, and its absence has to stay visible: `parity()` and `evaluate_board()`
    take no config, so nothing else in the suite would notice a default that quietly flipped."""
    result = solve_complete(_dump(_micro_snapshot()), DIRTY)

    assert "clean_fallback" not in result.notes
    assert SolveConfig().clean_mode is False


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
        assert {"occupiedSlotsBefore", "occupiedSlotsAfter", "unplaced"} <= set(entry)
        # `lowerBound` is optional and OMITTED when absent (the frozen contract forbids nulls on the
        # wire); this dump carries no greedy diagnostics, so there is no clique bound to report.
        assert "lowerBound" not in entry
        assert all({"courseId", "missing"} == set(u) for u in entry["unplaced"])
