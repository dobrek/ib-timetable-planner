"""Objective pins: the encoding-parity gate on the seed fixture, plus a micro-case per week/lane
asymmetry — the one place the ten tiers can silently drift from ``objective.ts``.

The golden-dump parity (manual check 3.3) runs here too when the gitignored dump is present, so a
local run reproduces it; CI (no dump) skips it. Every *committed* assertion is seed or micro-snapshot.
"""

from collections.abc import Collection
from pathlib import Path

import pytest
from ortools.sat.python import cp_model

import builders as b
from cpsat_engine.model import build_model
from cpsat_engine.objective import build_tiers, soft_hits_terms
from cpsat_engine.schema import BIWEEKLY, WEEK_A, WEEK_B, PlacementKey, Snapshot, load_dump
from cpsat_engine.solve import parity

FIXTURE = Path(__file__).parent / "fixtures" / "seed-plan-a.json"
GOLDEN = Path(__file__).parent.parent / "data" / "4bc9fe99-33ae-4c58-9b66-9b8477dad33f-dump.json"

# The TS scorer's tuple for the seed greedy board (export-snapshot.experiment.ts) — the parity target.
SEED_OBJECTIVE = (0, 0, 97, 223, 0, 1048, 316, 4, 38, 14)


def _tiers(snap: Snapshot, placed: Collection[PlacementKey] = frozenset()) -> dict[str, int]:
    """Build the tier model, fix the generated vars to ``placed`` (default: none placed), and read
    each tier off the unique completion. Pin-only snapshots (deficit 0) have no vars to fix."""
    bundle = build_model(b.dump(snap))
    tiers = build_tiers(bundle)
    for key, var in bundle.x.items():
        bundle.model.add(var == (1 if key in placed else 0))
    solver = cp_model.CpSolver()
    solver.parameters.num_workers = 1
    status = solver.solve(bundle.model)
    assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    return {t.name: int(solver.value(t.var)) for t in tiers}


# --- the parity gate: the CP-SAT tiers reproduce the TS tuple exactly on the greedy board ----------


def test_seed_greedy_board_parity_is_exact() -> None:
    report = parity(load_dump(FIXTURE))
    assert report.ok, f"tier mismatches: {[(t.name, t.computed, t.expected) for t in report.mismatches()]}"
    assert report.computed == SEED_OBJECTIVE


@pytest.mark.skipif(not GOLDEN.exists(), reason="golden dump is gitignored (production-derived)")
def test_golden_dump_parity_is_exact() -> None:
    # Manual check 3.3 — reproduced automatically when the local dump is present.
    report = parity(load_dump(GOLDEN))
    assert report.ok, f"tier mismatches: {[(t.name, t.computed, t.expected) for t in report.mismatches()]}"


# --- tier 1 (unplaced): deficit not covered by the fixed board ------------------------------------


def test_unplaced_counts_every_deficit_hour_left_off_the_board() -> None:
    snap = b.snapshot(dp1=b.cohort(courses=[b.course("a", teachers=["T1"], hours=2)]))
    assert _tiers(snap)["unplacedTotal"] == 2  # nothing placed -> both hours unplaced
    placed = {("dp1", "a", 1, 1, "both")}
    assert _tiers(snap, placed)["unplacedTotal"] == 1  # one hour placed -> one left


# --- tiers 2 & 3 (holes, totalSlots): WEEK-AGNOSTIC — biweekly and agnostic score identically ------


def test_holes_and_slots_are_week_agnostic() -> None:
    # Two courses at P1 and P4 of one day: cells P2,P3 are interior holes; two distinct slots.
    agnostic = b.snapshot(
        dp1=b.cohort(
            courses=[b.course("a", teachers=["T1"], hours=1), b.course("bb", teachers=["T2"], hours=1)],
            pins=[b.pin("a", 1, 1), b.pin("bb", 1, 4)],
        )
    )
    biweekly = b.snapshot(
        dp1=b.cohort(
            courses=[
                b.course("a", teachers=["T1"], hours=1, week_mode=BIWEEKLY),
                b.course("bb", teachers=["T2"], hours=1, week_mode=BIWEEKLY),
            ],
            pins=[b.pin("a", 1, 1, WEEK_A), b.pin("bb", 1, 4, WEEK_A)],
        )
    )
    for snap in (agnostic, biweekly):
        t = _tiers(snap)
        assert t["holes"] == 2, snap  # P2, P3 interior — the same in both lane regimes
        assert t["totalSlots"] == 2, snap


# --- tier 4 (teacherHoles): a `both` row fans into BOTH lanes; a biweekly row into one -------------


def test_teacher_holes_fan_out_by_week_lane() -> None:
    # One teacher, two courses at P1 and P4 of a day -> a 2-hole lane. Agnostic doubles it (a + b).
    def snap(mode: str, week: str) -> Snapshot:
        return b.snapshot(
            dp1=b.cohort(
                courses=[
                    b.course("a", teachers=["T1"], hours=1, week_mode=mode),
                    b.course("bb", teachers=["T1"], hours=1, week_mode=mode),
                ],
                pins=[b.pin("a", 1, 1, week), b.pin("bb", 1, 4, week)],
            )
        )

    assert _tiers(snap("agnostic", "both"))["teacherHoles"] == 4  # holes 2 in lane a + 2 in lane b
    assert _tiers(snap(BIWEEKLY, WEEK_A))["teacherHoles"] == 2  # lane a only; lane b empty


# --- tier 5 (softHits): one per (row, soft teacher), WEEK-AGNOSTIC ---------------------------------


def test_soft_hits_count_rows_on_a_soft_cell_week_agnostic() -> None:
    def snap(mode: str, week: str, day: int, period: int) -> Snapshot:
        return b.snapshot(
            dp1=b.cohort(
                courses=[b.course("a", teachers=["T1"], hours=1, week_mode=mode)],
                pins=[b.pin("a", day, period, week)],
            ),
            availability=[b.soft("T1", 1, 1)],
        )

    assert _tiers(snap("agnostic", "both", 1, 1))["softHits"] == 1  # lands on the soft cell
    assert _tiers(snap(BIWEEKLY, WEEK_A, 1, 1))["softHits"] == 1  # biweekly still hits (week-agnostic)
    assert _tiers(snap("agnostic", "both", 2, 2))["softHits"] == 0  # elsewhere -> no hit


# --- the tier-5 PINNED FLOOR: the quantity clean mode constrains against ---------------------------
#
# `soft_hits_terms` re-expresses tier 5 without the aux-vars so clean mode can constrain it before
# the objective exists. Two properties matter, and both are ways an intuitive "pins intersected with
# soft cells" formula UNDERCOUNTS — which would make `softHits == floor` infeasible by construction
# and send every such solve down the fallback with a mislabelled board.


def _floor(snap: Snapshot) -> int:
    return soft_hits_terms(build_model(b.dump(snap)))[1]


def test_soft_floor_counts_a_pin_row_once_per_soft_co_teacher() -> None:
    snap = b.snapshot(
        dp1=b.cohort(courses=[b.course("a", teachers=["T1", "T2"], hours=2)], pins=[b.pin("a", 1, 1)]),
        availability=[b.soft("T1", 1, 1), b.soft("T2", 1, 1)],
    )

    assert _floor(snap) == 2, "one pin row, two soft co-teachers — a cell intersection would say 1"
    # The floor IS what the tier reads with nothing generated: same board, same number, two formulas.
    assert _tiers(snap)["softHits"] == 2


def test_soft_floor_never_dedups_two_pin_rows_sharing_one_soft_cell() -> None:
    # Opposite weeks are lane-disjoint, so two rows legally share a cell even under one teacher.
    snap = b.snapshot(
        dp1=b.cohort(
            courses=[
                b.course("a", teachers=["T1"], hours=2, week_mode=BIWEEKLY),
                b.course("bb", teachers=["T1"], hours=2, week_mode=BIWEEKLY),
            ],
            pins=[b.pin("a", 1, 1, WEEK_A), b.pin("bb", 1, 1, WEEK_B)],
        ),
        availability=[b.soft("T1", 1, 1)],
    )

    assert _floor(snap) == 2, "two pin rows on one soft cell — a cell intersection would say 1"
    assert _tiers(snap)["softHits"] == 2


def test_soft_floor_is_zero_when_no_pin_sits_on_a_soft_cell() -> None:
    # The common case, and the one that makes clean mode literally `softHits == 0` (FR-302's spec).
    snap = b.snapshot(
        dp1=b.cohort(courses=[b.course("a", teachers=["T1"], hours=2)], pins=[b.pin("a", 2, 2)]),
        availability=[b.soft("T1", 1, 1)],
    )

    assert _floor(snap) == 0


# --- tier 6 (studentHoles): a `both` row fans into both lanes; biweekly into one -------------------


def test_student_holes_fan_out_by_week_lane() -> None:
    def snap(mode: str, week: str) -> Snapshot:
        return b.snapshot(
            dp1=b.cohort(
                courses=[
                    b.course("a", teachers=["T1"], students=["s1"], hours=1, week_mode=mode),
                    b.course("bb", teachers=["T2"], students=["s1"], hours=1, week_mode=mode),
                ],
                pins=[b.pin("a", 1, 1, week), b.pin("bb", 1, 4, week)],
            )
        )

    assert _tiers(snap("agnostic", "both"))["studentHoles"] == 4  # a shared student, both lanes
    assert _tiers(snap(BIWEEKLY, WEEK_A))["studentHoles"] == 2  # lane a only


# --- tier 7 (doublesDeficit): agnostic counts in BOTH lanes; biweekly in its own lane -------------


def test_doubles_deficit_doubles_for_agnostic_but_not_biweekly() -> None:
    # Two singles on different days: singles=2, hours=2, 2%2=0 -> deficit 2 per lane.
    agnostic = b.snapshot(
        dp1=b.cohort(
            courses=[b.course("a", teachers=["T1"], hours=2)],
            pins=[b.pin("a", 1, 1), b.pin("a", 2, 1)],
        )
    )
    biweekly = b.snapshot(
        dp1=b.cohort(
            courses=[b.course("a", teachers=["T1"], hours=2, week_mode=BIWEEKLY)],
            pins=[b.pin("a", 1, 1, WEEK_A), b.pin("a", 2, 1, WEEK_A)],
        )
    )
    assert _tiers(agnostic)["doublesDeficit"] == 4  # deficit 2 in lane a + 2 in lane b
    assert _tiers(biweekly)["doublesDeficit"] == 2  # lane a only


def test_doubles_deficit_forgives_the_odd_hour() -> None:
    # One single: singles=1, hours=1, 1%2=1 -> deficit max(0, 1-1) = 0 (the free odd hour).
    snap = b.snapshot(
        dp1=b.cohort(courses=[b.course("a", teachers=["T1"], hours=1)], pins=[b.pin("a", 1, 1)])
    )
    assert _tiers(snap)["doublesDeficit"] == 0


# --- tiers 8 & 9 (lateStarts, fridayTail): per cohort-day-lane; a `both` row counts in both --------


def test_late_starts_fan_out_by_lane() -> None:
    # A cohort's only lesson at day 1 P3 -> lateStart (3 - 1) = 2 per occupied lane.
    def snap(mode: str, week: str) -> Snapshot:
        return b.snapshot(
            dp1=b.cohort(
                courses=[b.course("a", teachers=["T1"], hours=1, week_mode=mode)],
                pins=[b.pin("a", 1, 3, week)],
            )
        )

    assert _tiers(snap("agnostic", "both"))["lateStarts"] == 4  # 2 in lane a + 2 in lane b
    assert _tiers(snap(BIWEEKLY, WEEK_A))["lateStarts"] == 2  # lane a only


def test_friday_tail_fan_out_by_lane() -> None:
    # A lesson on the LAST day (5) at P6 -> fridayTail = last occupied period 6 per occupied lane.
    def snap(mode: str, week: str) -> Snapshot:
        return b.snapshot(
            dp1=b.cohort(
                courses=[b.course("a", teachers=["T1"], hours=1, week_mode=mode)],
                pins=[b.pin("a", 5, 6, week)],
            )
        )

    assert _tiers(snap("agnostic", "both"))["fridayTail"] == 12  # last=6 in lane a + lane b
    assert _tiers(snap(BIWEEKLY, WEEK_A))["fridayTail"] == 6  # lane a only


# --- tier 10 (goldenBandDistance): golden needs full coverage in BOTH lanes ------------------------


def test_golden_requires_coverage_in_both_lanes() -> None:
    # roster 2, bar = ceil(2 * 0.9) = 2. An agnostic full-roster cell is golden in both lanes.
    agnostic = b.snapshot(
        dp1=b.cohort(
            courses=[b.course("a", teachers=["T1"], students=["s1", "s2"], hours=1)],
            pins=[b.pin("a", 1, 1)],
        )
    )
    assert _tiers(agnostic)["goldenBandDistance"] == 3  # golden at P1 -> bandDistance max(0,4-1)=3

    # The same course biweekly (week a) covers lane a only -> lane b is empty -> never golden.
    biweekly = b.snapshot(
        dp1=b.cohort(
            courses=[b.course("a", teachers=["T1"], students=["s1", "s2"], hours=1, week_mode=BIWEEKLY)],
            pins=[b.pin("a", 1, 1, WEEK_A)],
        )
    )
    assert _tiers(biweekly)["goldenBandDistance"] == 0


def test_golden_is_count_neutral_inside_the_band() -> None:
    # A golden cell already inside the band (P4-P7) contributes 0 — the tier only pulls outliers in.
    snap = b.snapshot(
        dp1=b.cohort(
            courses=[b.course("a", teachers=["T1"], students=["s1", "s2"], hours=1)],
            pins=[b.pin("a", 1, 5)],
        )
    )
    assert _tiers(snap)["goldenBandDistance"] == 0
