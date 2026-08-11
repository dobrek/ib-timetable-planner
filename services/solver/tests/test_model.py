"""Model pins: hard rules accept the greedy board, per-rule stats, precondition, and rule micro-cases.

Golden-dump tests are excluded on purpose — the golden dump is gitignored (production-derived), so
every committed test runs against the seed fixture or an in-code micro-snapshot.
"""

from pathlib import Path

import pytest
from ortools.sat.python import cp_model

import builders as b
from cpsat_engine.model import PreconditionError, build_model
from cpsat_engine.schema import BIWEEKLY, Snapshot, load_dump

FIXTURE = Path(__file__).parent / "fixtures" / "seed-plan-a.json"


def _solve(model: cp_model.CpModel) -> cp_model.CpSolverStatus:
    solver = cp_model.CpSolver()
    solver.parameters.num_workers = 1
    solver.parameters.max_time_in_seconds = 20
    return solver.solve(model)


def _feasible(model: cp_model.CpModel) -> bool:
    return _solve(model) in (cp_model.OPTIMAL, cp_model.FEASIBLE)


# --- the greedy board is a valid solution of the hard model (the parity pre-check) ----------------


def test_greedy_board_is_feasible_on_seed() -> None:
    dump = load_dump(FIXTURE)
    bundle = build_model(dump)
    greedy = {(p.cohort, p.course_id, p.day, p.period, p.week) for p in dump.greedy_placements}
    assert all(row in bundle.x for row in greedy), "every greedy row must be a model variable"
    for key, var in bundle.x.items():
        bundle.model.add(var == (1 if key in greedy else 0))
    assert _feasible(bundle.model), "the hard rules must accept the greedy board"


def test_seed_stats_are_stable_and_sane() -> None:
    bundle = build_model(load_dump(FIXTURE))
    stats = bundle.stats
    # The snapshot (catalog + skeleton pins) is deterministic, so the variable count is a firm pin.
    assert stats["placement_vars"] == 3500
    for group in ("deficit_caps", "teacher_at_most_one", "student_at_most_one", "course_day_stacking"):
        assert stats[group] > 0, group


# --- pins-only precondition (mirror of verifyGeneration(snapshot, [])) -----------------------------


def test_precondition_flags_teacher_double_booked_by_pins() -> None:
    snap = b.snapshot(
        dp1=b.cohort(
            courses=[b.course("a", teachers=["T1"]), b.course("bb", teachers=["T1"])],
            pins=[b.pin("a", 1, 1), b.pin("bb", 1, 1)],
        )
    )
    with pytest.raises(PreconditionError, match="double-book"):
        build_model(b.dump(snap))


def test_precondition_flags_duplicate_pin_row() -> None:
    snap = b.snapshot(
        dp1=b.cohort(courses=[b.course("a", teachers=["T1"])], pins=[b.pin("a", 1, 1), b.pin("a", 1, 1)])
    )
    with pytest.raises(PreconditionError, match="duplicate"):
        build_model(b.dump(snap))


def test_precondition_flags_pin_on_strong_unavailable_cell() -> None:
    snap = b.snapshot(
        dp1=b.cohort(courses=[b.course("a", teachers=["T1"])], pins=[b.pin("a", 2, 3)]),
        availability=[b.strong("T1", 2, 3)],
    )
    with pytest.raises(PreconditionError, match="strong-unavailable"):
        build_model(b.dump(snap))


# --- variable creation: parked / strong-unavailable / biweekly ------------------------------------


def test_fully_parked_course_gets_no_variables() -> None:
    snap = b.snapshot(dp1=b.cohort(courses=[b.course("chem", hours=4)], parked=["chem"] * 4))
    bundle = build_model(b.dump(snap))
    assert not any(cid == "chem" for (_c, cid, *_r) in bundle.x)


def test_strong_unavailable_cell_gets_no_variable() -> None:
    snap = b.snapshot(
        dp1=b.cohort(courses=[b.course("a", teachers=["T1"], hours=4)]),
        availability=[b.strong("T1", 1, 1)],
    )
    bundle = build_model(b.dump(snap))
    assert ("dp1", "a", 1, 1, "both") not in bundle.x  # blocked cell excluded
    assert ("dp1", "a", 1, 2, "both") in bundle.x  # a free cell keeps its variable
    assert bundle.stats["cells_skipped_strong_unavailable"] > 0


def test_biweekly_course_gets_a_and_b_vars_with_one_row_cap() -> None:
    snap = b.snapshot(dp1=b.cohort(courses=[b.course("lang", teachers=["T1"], hours=2, week_mode=BIWEEKLY)]))
    bundle = build_model(b.dump(snap))
    assert ("dp1", "lang", 1, 1, "a") in bundle.x
    assert ("dp1", "lang", 1, 1, "b") in bundle.x
    assert bundle.stats["one_row_per_cell_caps"] > 0


# --- conflict rules fire (fix a violating assignment -> infeasible) --------------------------------


def test_teacher_conflict_forbids_two_of_a_teachers_courses_in_one_cell() -> None:
    snap = b.snapshot(
        dp1=b.cohort(
            courses=[b.course("a", teachers=["T1"], hours=4), b.course("bb", teachers=["T1"], hours=4)]
        )
    )
    bundle = build_model(b.dump(snap))
    bundle.model.add(bundle.x[("dp1", "a", 1, 1, "both")] == 1)
    bundle.model.add(bundle.x[("dp1", "bb", 1, 1, "both")] == 1)
    assert not _feasible(bundle.model)


def test_student_conflict_forbids_two_shared_student_courses_in_one_cell() -> None:
    snap = b.snapshot(
        dp1=b.cohort(
            courses=[
                b.course("a", teachers=["T1"], students=["s1"], hours=4),
                b.course("bb", teachers=["T2"], students=["s1"], hours=4),
            ]
        )
    )
    bundle = build_model(b.dump(snap))
    bundle.model.add(bundle.x[("dp1", "a", 1, 1, "both")] == 1)
    bundle.model.add(bundle.x[("dp1", "bb", 1, 1, "both")] == 1)
    assert not _feasible(bundle.model)


def test_course_day_split_forbids_non_adjacent_pair() -> None:
    snap = b.snapshot(dp1=b.cohort(courses=[b.course("a", teachers=["T1"], hours=4)]))
    bundle = build_model(b.dump(snap))
    bundle.model.add(bundle.x[("dp1", "a", 1, 2, "both")] == 1)
    bundle.model.add(bundle.x[("dp1", "a", 1, 5, "both")] == 1)  # gap → split
    assert not _feasible(bundle.model)


# --- early-finish-edge: a flagged course may not be strictly interior to a student's other courses -


def _edge_snapshot() -> Snapshot:
    # F (flagged) shares student s1 with G and H; distinct teachers so no teacher conflict.
    return b.snapshot(
        dp1=b.cohort(
            courses=[
                b.course("F", teachers=["T1"], students=["s1"], hours=1),
                b.course("G", teachers=["T2"], students=["s1"], hours=1),
                b.course("H", teachers=["T3"], students=["s1"], hours=1),
            ]
        ),
        flagged=["F"],
    )


def test_flagged_course_interior_to_other_courses_is_infeasible() -> None:
    bundle = build_model(b.dump(_edge_snapshot()))
    bundle.model.add(bundle.x[("dp1", "G", 1, 2, "both")] == 1)
    bundle.model.add(bundle.x[("dp1", "F", 1, 3, "both")] == 1)  # sandwiched between 2 and 4
    bundle.model.add(bundle.x[("dp1", "H", 1, 4, "both")] == 1)
    assert not _feasible(bundle.model)


def test_flagged_course_at_the_day_edge_is_feasible() -> None:
    bundle = build_model(b.dump(_edge_snapshot()))
    bundle.model.add(bundle.x[("dp1", "G", 1, 2, "both")] == 1)
    bundle.model.add(bundle.x[("dp1", "F", 1, 1, "both")] == 1)  # below both others → an edge
    bundle.model.add(bundle.x[("dp1", "H", 1, 4, "both")] == 1)
    assert _feasible(bundle.model)
