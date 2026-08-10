"""The Python half of the frozen wire contract (``contracts/generation-wire.schema.json``).

One job: turn the package's internal dataclasses into the contract's **canonical JSON form**, exactly
as ``contracts/README.md`` specifies it and exactly as the TypeScript mirror
(``src/entities/timetable/model/generation/wire.ts``) implements it. The two are byte-gated against
the same committed goldens — ``tests/test_contract.py`` here, ``bench/contract-parity.test.ts``
there — so a divergence is a red build on both sides rather than a bug at the S-301 integration.

The canonical form, restated because this module IS one of its two implementations:

* compact separators, no whitespace, no trailing newline;
* object keys sorted at every depth (``sort_keys=True``; contract keys are ASCII, so Python's
  code-point order and JavaScript's code-unit order coincide);
* ``None``-valued keys dropped — this wire has no nulls, an absent optional is an absent key;
* every semantically-unordered array sorted by its declared key (see ``_wire_cohort`` /
  ``wire_snapshot``), with ``parkedCourseIds`` sorted but NEVER deduped: it is a multiset in which
  the duplicate count is semantic (one entry covers one parked hour);
* ``ensure_ascii=False`` because ``JSON.stringify`` emits raw UTF-8 rather than ``\\uXXXX`` escapes.

Numbers: every byte-compared or hash-digested payload is integer-only. ``StageReport.wall_clock_s``
is the single non-integer in the contract and therefore must never enter one —
``json.dumps(2.0)`` is ``"2.0"`` where JavaScript writes ``"2"``.

Validation lives in the test lane (``jsonschema``, dev group), never in the solve path.
"""

from __future__ import annotations

import json
from typing import Any

from .schema import COHORTS, CohortSnapshot, Snapshot
from .solve import StageReport


def canonical_json(value: Any) -> str:
    """Serialize an already-wire-shaped payload to canonical bytes, dropping ``None``-valued keys."""
    return json.dumps(_without_nones(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def canonical_snapshot_json(snapshot: Snapshot) -> str:
    """The canonical form of a snapshot — the exact bytes ``generation_jobs.snapshot_hash`` digests."""
    return canonical_json(wire_snapshot(snapshot))


def wire_snapshot(snapshot: Snapshot) -> dict[str, Any]:
    """Project a parsed :class:`Snapshot` back onto the contract's ``GeneratorSnapshot`` shape."""
    return {
        "days": snapshot.days,
        "periods": snapshot.periods,
        "availability": [
            {"teacherKey": c.teacher_key, "day": c.day, "period": c.period, "severity": c.severity}
            for c in sorted(snapshot.availability, key=lambda c: (c.teacher_key, c.day, c.period))
        ],
        "finishesEarlyByCourseId": sorted(snapshot.finishes_early_by_course_id),
        "cohorts": {cohort: _wire_cohort(snapshot.cohorts[cohort]) for cohort in COHORTS},
    }


def wire_stage_report(stage: StageReport) -> dict[str, Any]:
    """Project a :class:`StageReport` onto the contract's camelCase ``StageReport``.

    A serializer, deliberately NOT a rename of the dataclass: the internal fields and the throwaway
    ``.report.json`` sidecar stay snake_case and stay out of contract (``contracts/README.md``).
    """
    return _without_nones(
        {
            "tier": stage.tier,
            "name": stage.name,
            "status": stage.status,
            "best": stage.best,
            "bound": stage.bound,
            "wallClockS": stage.wall_clock_s,
        }
    )


def _wire_cohort(cohort: CohortSnapshot) -> dict[str, Any]:
    return {
        "courses": [
            {
                "id": c.id,
                "teacherKeys": sorted(c.teacher_keys),
                "hours": c.hours,
                "studentKeys": sorted(c.student_keys),
                "weekMode": c.week_mode,
            }
            for c in sorted(cohort.courses, key=lambda c: c.id)
        ],
        "pins": [
            {"courseId": p.course_id, "day": p.day, "period": p.period, "week": p.week}
            for p in sorted(cohort.pins, key=lambda p: (p.course_id, p.day, p.period, p.week))
        ],
        # A multiset — sorted, never deduped.
        "parkedCourseIds": sorted(cohort.parked_course_ids),
    }


def _without_nones(value: Any) -> Any:
    """Drop every ``None``-valued key, at every depth. Array elements are left alone (this wire has
    no nullable array members, and silently shrinking a list would hide a producer bug)."""
    if isinstance(value, dict):
        return {k: _without_nones(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [_without_nones(v) for v in value]
    if isinstance(value, tuple):
        return [_without_nones(v) for v in value]
    return value
