"""Parse the export dump JSON into typed, frozen dataclasses.

Mirrors the TS wire types (``GeneratorSnapshot`` / ``GeneratedPlacement``) with OPAQUE ids only — no
names, levels, or flags (port the mechanism, not the legacy shape). Derives per-course deficits
(``required - pins - parked``, clamped at 0 per course) and rejects an unknown ``formatVersion``.

The dump is produced by ``bench/export-snapshot.experiment.ts``; its shape is the contract between
the TS export and this package. See that file for the authoritative schema.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

FORMAT_VERSION = 1
COHORTS: tuple[str, ...] = ("dp1", "dp2")

# The identity of one board row: (cohort, course_id, day, period, week). It keys every decision var,
# hint map, and extracted board in the engine; ``Placement(*key)`` rebuilds the dataclass from it.
PlacementKey = tuple[str, str, int, int, str]

# Week vocabulary — mirrors PlacementWeek / WeekMode.
BOTH = "both"
WEEK_A = "a"
WEEK_B = "b"
AGNOSTIC = "agnostic"
BIWEEKLY = "biweekly"


@dataclass(frozen=True)
class Course:
    """A GroupingCourse projection: opaque id, teacher/student key sets, required hours, week mode."""

    id: str
    teacher_keys: tuple[str, ...]
    student_keys: tuple[str, ...]
    hours: int
    week_mode: str  # AGNOSTIC | BIWEEKLY

    def week_options(self) -> tuple[str, ...]:
        """The concrete placement weeks a row of this course may take."""
        return (WEEK_A, WEEK_B) if self.week_mode == BIWEEKLY else (BOTH,)


@dataclass(frozen=True)
class Placement:
    """One placed course-hour — a pin or a generated row (a pin omits cohort; see ``Pin``)."""

    cohort: str
    course_id: str
    day: int
    period: int
    week: str  # BOTH | WEEK_A | WEEK_B


@dataclass(frozen=True)
class Pin:
    """An immovable placement within a cohort (fill-the-gaps): folded into the model as a constant."""

    course_id: str
    day: int
    period: int
    week: str


@dataclass(frozen=True)
class AvailabilityCell:
    teacher_key: str
    day: int
    period: int
    severity: str  # "strong" (block) | "soft" (tier-5 objective term, never a constraint)


@dataclass(frozen=True)
class CohortSnapshot:
    courses: tuple[Course, ...]
    pins: tuple[Pin, ...]
    parked_course_ids: tuple[str, ...]

    def course_by_id(self) -> dict[str, Course]:
        return {course.id: course for course in self.courses}


@dataclass(frozen=True)
class Snapshot:
    days: int
    periods: int
    availability: tuple[AvailabilityCell, ...]
    finishes_early_by_course_id: frozenset[str]
    cohorts: dict[str, CohortSnapshot]


@dataclass(frozen=True)
class Dump:
    """The whole export: transformed snapshot, greedy warm-start board, and the TS objective tuple."""

    format_version: int
    meta: dict[str, Any]
    snapshot: Snapshot
    greedy_placements: tuple[Placement, ...]
    greedy_diagnostics: dict[str, Any]
    objective: tuple[int, ...]

    def lower_bound(self, cohort: str) -> int | None:
        """The per-cohort clique lower bound the greedy engine computed (redundant tier-3 cut)."""
        value = self.greedy_diagnostics.get("cohorts", {}).get(cohort, {}).get("lowerBound")
        return int(value) if value is not None else None


def load_dump(path: str | Path) -> Dump:
    """Parse the dump JSON at ``path`` into a :class:`Dump`, rejecting an unknown ``formatVersion``."""
    raw = json.loads(Path(path).read_text())
    version = raw.get("formatVersion")
    if version != FORMAT_VERSION:
        raise ValueError(f"Unsupported dump formatVersion {version!r} (understood: {FORMAT_VERSION}).")
    snapshot = parse_snapshot(raw["snapshot"])
    return Dump(
        format_version=version,
        meta=raw["meta"],
        snapshot=snapshot,
        greedy_placements=tuple(_placement(p) for p in raw["greedy"]["placements"]),
        greedy_diagnostics=raw["greedy"]["diagnostics"],
        objective=tuple(int(v) for v in raw["objective"]),
    )


def deficits(snapshot: Snapshot) -> dict[tuple[str, str], int]:
    """Per-course hours the model must place: ``required - pins - parked``, clamped at 0 per course.

    Mirrors ``deriveGenerationDeficits`` — never netted across courses; an over-parked course drops
    to 0. Keyed ``(cohort, course_id)`` over every course (0 for the fully-covered ones)."""
    result: dict[tuple[str, str], int] = {}
    for cohort in COHORTS:
        snap = snapshot.cohorts[cohort]
        pinned = Counter(pin.course_id for pin in snap.pins)
        parked = Counter(snap.parked_course_ids)
        for course in snap.courses:
            result[(cohort, course.id)] = max(0, course.hours - pinned[course.id] - parked[course.id])
    return result


def parse_snapshot(raw: dict[str, Any]) -> Snapshot:
    """Parse a bare ``GeneratorSnapshot`` payload (the contract's, or a dump's ``snapshot`` key).

    Public because the snapshot is a contract payload in its own right — the F-302 ``SolveRequest``
    carries one without a dump envelope around it, and the contract round-trip test parses the
    committed golden through exactly this path before re-emitting it via ``wire.py``.
    """
    return Snapshot(
        days=raw["days"],
        periods=raw["periods"],
        availability=tuple(
            AvailabilityCell(cell["teacherKey"], cell["day"], cell["period"], cell["severity"])
            for cell in raw["availability"]
        ),
        finishes_early_by_course_id=frozenset(raw["finishesEarlyByCourseId"]),
        cohorts={cohort: _cohort(raw["cohorts"][cohort]) for cohort in COHORTS},
    )


def _cohort(raw: dict[str, Any]) -> CohortSnapshot:
    return CohortSnapshot(
        courses=tuple(
            Course(
                id=c["id"],
                teacher_keys=tuple(c["teacherKeys"]),
                student_keys=tuple(c["studentKeys"]),
                hours=c["hours"],
                week_mode=c["weekMode"],
            )
            for c in raw["courses"]
        ),
        pins=tuple(Pin(p["courseId"], p["day"], p["period"], p["week"]) for p in raw["pins"]),
        parked_course_ids=tuple(raw["parkedCourseIds"]),
    )


def _placement(raw: dict[str, Any]) -> Placement:
    return Placement(raw["cohort"], raw["courseId"], raw["day"], raw["period"], raw["week"])
