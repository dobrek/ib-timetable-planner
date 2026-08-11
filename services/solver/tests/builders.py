"""In-code snapshot builders for the schema/model/objective micro-tests (no fixture files)."""

from __future__ import annotations

from cpsat_engine.schema import (
    AGNOSTIC,
    BOTH,
    AvailabilityCell,
    CohortSnapshot,
    Course,
    Dump,
    Pin,
    Snapshot,
)


def course(cid: str, teachers=(), students=(), hours: int = 4, week_mode: str = AGNOSTIC) -> Course:
    return Course(
        id=cid,
        teacher_keys=tuple(teachers),
        student_keys=tuple(students),
        hours=hours,
        week_mode=week_mode,
    )


def pin(course_id: str, day: int, period: int, week: str = BOTH) -> Pin:
    return Pin(course_id, day, period, week)


def cohort(courses=(), pins=(), parked=()) -> CohortSnapshot:
    return CohortSnapshot(courses=tuple(courses), pins=tuple(pins), parked_course_ids=tuple(parked))


def strong(teacher: str, day: int, period: int) -> AvailabilityCell:
    return AvailabilityCell(teacher, day, period, "strong")


def soft(teacher: str, day: int, period: int) -> AvailabilityCell:
    return AvailabilityCell(teacher, day, period, "soft")


def snapshot(
    dp1: CohortSnapshot | None = None,
    dp2: CohortSnapshot | None = None,
    *,
    days=5,
    periods=10,
    availability=(),
    flagged=(),
) -> Snapshot:
    return Snapshot(
        days=days,
        periods=periods,
        availability=tuple(availability),
        finishes_early_by_course_id=frozenset(flagged),
        cohorts={"dp1": dp1 or cohort(), "dp2": dp2 or cohort()},
    )


def dump(snap: Snapshot) -> Dump:
    """A minimal Dump wrapper — ``build_model`` reads only the snapshot."""
    return Dump(
        format_version=1,
        meta={},
        snapshot=snap,
        greedy_placements=(),
        greedy_diagnostics={},
        objective=(),
    )
