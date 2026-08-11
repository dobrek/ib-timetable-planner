"""Schema pins: format-version gate, lossless parse, and deficit derivation."""

import json
from pathlib import Path

import pytest

import builders as b
from cpsat_engine.schema import BIWEEKLY, Snapshot, deficits, load_dump

FIXTURE = Path(__file__).parent / "fixtures" / "seed-plan-a.json"


def _wire(snapshot: Snapshot) -> dict:
    """Re-serialize a parsed snapshot back to the dump's wire shape (for the round-trip check)."""
    return {
        "days": snapshot.days,
        "periods": snapshot.periods,
        "availability": [
            {"teacherKey": c.teacher_key, "day": c.day, "period": c.period, "severity": c.severity}
            for c in snapshot.availability
        ],
        "finishesEarlyByCourseId": sorted(snapshot.finishes_early_by_course_id),
        "cohorts": {
            cohort: {
                "courses": [
                    {
                        "id": c.id,
                        "teacherKeys": list(c.teacher_keys),
                        "studentKeys": list(c.student_keys),
                        "hours": c.hours,
                        "weekMode": c.week_mode,
                    }
                    for c in snapshot.cohorts[cohort].courses
                ],
                "pins": [
                    {"courseId": p.course_id, "day": p.day, "period": p.period, "week": p.week}
                    for p in snapshot.cohorts[cohort].pins
                ],
                "parkedCourseIds": list(snapshot.cohorts[cohort].parked_course_ids),
            }
            for cohort in ("dp1", "dp2")
        },
    }


def test_rejects_unknown_format_version(tmp_path) -> None:
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"formatVersion": 99, "meta": {}, "snapshot": {}, "greedy": {}}))
    with pytest.raises(ValueError, match="formatVersion"):
        load_dump(bad)


def test_seed_fixture_round_trips_on_the_constraint_relevant_projection() -> None:
    # The pin's `id` / `isOptional` (PlannerPlacement metadata) are deliberately NOT modelled — they
    # never reach a constraint (port the mechanism, no unused identity). Everything else round-trips.
    raw = json.loads(FIXTURE.read_text())
    dump = load_dump(FIXTURE)
    rebuilt = _wire(dump.snapshot)
    expected = dict(raw["snapshot"])
    expected["finishesEarlyByCourseId"] = sorted(expected["finishesEarlyByCourseId"])
    for cohort in ("dp1", "dp2"):
        expected["cohorts"][cohort] = dict(expected["cohorts"][cohort])
        expected["cohorts"][cohort]["pins"] = [
            {"courseId": p["courseId"], "day": p["day"], "period": p["period"], "week": p["week"]}
            for p in expected["cohorts"][cohort]["pins"]
        ]
    assert rebuilt == expected


def test_seed_deficits_equal_placed_plus_residue() -> None:
    dump = load_dump(FIXTURE)
    residue = sum(
        d["missing"]
        for cohort in ("dp1", "dp2")
        for d in dump.greedy_diagnostics["cohorts"][cohort]["unplaced"]
    )
    assert sum(deficits(dump.snapshot).values()) == len(dump.greedy_placements) + residue


def test_deficit_is_required_minus_pins_minus_parked_clamped() -> None:
    snap = b.snapshot(
        dp1=b.cohort(
            courses=[b.course("chem", hours=4), b.course("bio", hours=6)],
            pins=[b.pin("bio", 1, 1), b.pin("bio", 1, 2)],
            parked=["chem", "chem"],
        )
    )
    defs = deficits(snap)
    assert defs[("dp1", "chem")] == 2  # 4 required - 0 pinned - 2 parked
    assert defs[("dp1", "bio")] == 4  # 6 required - 2 pinned - 0 parked


def test_over_parked_course_clamps_to_zero() -> None:
    snap = b.snapshot(dp1=b.cohort(courses=[b.course("x", hours=2)], parked=["x", "x", "x"]))
    assert deficits(snap)[("dp1", "x")] == 0


def test_week_options_by_mode() -> None:
    assert b.course("a").week_options() == ("both",)
    assert b.course("a", week_mode=BIWEEKLY).week_options() == ("a", "b")
