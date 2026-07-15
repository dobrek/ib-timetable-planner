"""The ten lexicographic tier expressions, mirroring ``objective.ts`` semantics literally.

Each tier is an IntVar (its value on the merged board — pins + generated), so the parity check reads
``solver.value(tier)`` and the staged solver minimises / hardens it. Week/lane asymmetries are the one
trap and are pinned individually by the micro-tests:

  1  unplacedTotal   Sigma (deficit - placed)                                       — count
  2  holes           cohort interior holes, WEEK-AGNOSTIC (distinct cells)          — span - count
  3  totalSlots      distinct occupied (day, period) cells per cohort, week-agnostic
  4  teacherHoles    span - count per (teacher, day, LANE), both cohorts
  5  softHits        one per (row, co-teacher) on a soft cell, WEEK-AGNOSTIC (no fan)
  6  studentHoles    span - count per (student, day, lane)
  7  doublesDeficit  per (course, LANE): max(0, singles - hours%2)  (agnostic counts in both lanes)
  8  lateStarts      per (cohort, day, lane): first occupied period - 1
  9  fridayTail      per (cohort, LAST day, lane): last occupied period
  10 goldenBandDist  golden cells (>=90% roster each lane) distance to band P4-P7; count-neutral
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from ortools.sat.python import cp_model

from .model import LANES, ModelBundle, Term, _lanes_of
from .schema import COHORTS, AvailabilityCell

# golden-sets.ts: derive the miss share (1 - 0.1 is exact 0.9 in IEEE-754; 1 - 0.9 is not).
GOLDEN_MISS_SHARE = 0.1
GOLDEN_COVERAGE = 1 - GOLDEN_MISS_SHARE
GOLDEN_BAND_FIRST = 4
GOLDEN_BAND_LAST = 7


@dataclass(frozen=True)
class Tier:
    name: str
    var: cp_model.IntVar


def build_tiers(bundle: ModelBundle) -> list[Tier]:
    """The ordered tier tuple 1..10. Idempotent per bundle is NOT assumed — call once per model."""
    occ = _Occupancy(bundle)
    return [
        Tier("unplacedTotal", _tier_unplaced(bundle)),
        Tier("holes", _tier_holes(bundle, occ)),
        Tier("totalSlots", _tier_total_slots(bundle, occ)),
        Tier("teacherHoles", _lane_holes_tier(bundle, bundle.by_teacher_lane, "teacherHoles")),
        Tier("softHits", _tier_soft_hits(bundle, occ)),
        Tier("studentHoles", _lane_holes_tier(bundle, bundle.by_student_lane, "studentHoles")),
        Tier("doublesDeficit", _tier_doubles(bundle)),
        Tier("lateStarts", _tier_late_starts(bundle, occ)),
        Tier("fridayTail", _tier_friday_tail(bundle, occ)),
        Tier("goldenBandDistance", _tier_golden(bundle, occ)),
    ]


# --- occupancy views (built once, from the merged board) ------------------------------------------


class _Occupancy:
    """Merged-board occupancy the tiers read: week-agnostic cohort cells, per-lane cohort cells,
    week-agnostic per-course cells (softHits), and per-lane coverage weights (golden)."""

    def __init__(self, bundle: ModelBundle) -> None:
        snapshot = bundle.snapshot
        course_by = {(co, c.id): c for co in COHORTS for c in snapshot.cohorts[co].courses}
        self.cohort_cell: dict[tuple[str, int, int], list[Term]] = {}
        self.cohort_lane: dict[tuple[str, int, int, str], list[Term]] = {}
        self.course_cell: dict[tuple[str, str, int, int], list[Term]] = {}
        self.coverage: dict[tuple[str, int, int, str], list[tuple[int, Term]]] = {}

        def register(cohort: str, course, day: int, period: int, week: str, term: Term) -> None:
            self.cohort_cell.setdefault((cohort, day, period), []).append(term)
            self.course_cell.setdefault((cohort, course.id, day, period), []).append(term)
            for lane in _lanes_of(week):
                self.cohort_lane.setdefault((cohort, day, period, lane), []).append(term)
                if course.student_keys:
                    self.coverage.setdefault((cohort, day, period, lane), []).append(
                        (len(course.student_keys), term)
                    )

        for (cohort, cid, day, period, week), var in bundle.x.items():
            register(cohort, course_by[(cohort, cid)], day, period, week, var)
        for cohort in COHORTS:
            for pin in snapshot.cohorts[cohort].pins:
                course = course_by.get((cohort, pin.course_id))
                if course is not None:
                    register(cohort, course, pin.day, pin.period, pin.week, 1)


# --- tier 1: unplaced -----------------------------------------------------------------------------


def _tier_unplaced(bundle: ModelBundle) -> cp_model.IntVar:
    placed_by_course: dict[tuple[str, str], list[cp_model.IntVar]] = {}
    for (cohort, cid, _d, _p, _w), var in bundle.x.items():
        placed_by_course.setdefault((cohort, cid), []).append(var)
    total_deficit = sum(bundle.deficits.values())
    placed = sum(sum(vs) for vs in placed_by_course.values())
    return _as_var(bundle, total_deficit - placed, 0, total_deficit, "tier_unplaced")


# --- tiers 2 & 3: cohort holes and total slots (week-agnostic distinct cells) ----------------------


def _tier_holes(bundle: ModelBundle, occ: _Occupancy) -> cp_model.IntVar:
    snapshot = bundle.snapshot
    holes: list[cp_model.IntVar] = []
    for cohort in COHORTS:
        for day in range(1, snapshot.days + 1):
            occupied = {
                p: _bool_occ(bundle, occ.cohort_cell.get((cohort, day, p), []), f"cell_{cohort}_{day}_{p}")
                for p in range(1, snapshot.periods + 1)
            }
            holes.append(_holes_var(bundle, occupied, f"holes_{cohort}_{day}"))
    return _sum_var(bundle, holes, "tier_holes")


def _tier_total_slots(bundle: ModelBundle, occ: _Occupancy) -> cp_model.IntVar:
    used = [
        _bool_occ(bundle, terms, f"slot_{cohort}_{day}_{period}")
        for (cohort, day, period), terms in occ.cohort_cell.items()
    ]
    return _sum_var(bundle, used, "tier_total_slots")


# --- tiers 4 & 6: teacher / student lane holes ----------------------------------------------------


def _lane_holes_tier(
    bundle: ModelBundle, buckets: dict[tuple[str, int, int, str], list[Term]], name: str
) -> cp_model.IntVar:
    # Group the per-(entity, day, period, lane) terms into per-(entity, day, lane) period maps.
    by_lane: dict[tuple[str, int, str], dict[int, list[Term]]] = {}
    for (entity, day, period, lane), terms in buckets.items():
        by_lane.setdefault((entity, day, lane), {})[period] = terms
    holes: list[cp_model.IntVar] = []
    for (entity, day, lane), periods in by_lane.items():
        occupied = {
            p: _bool_occ(bundle, terms, f"{name}_{entity}_{day}_{lane}_{p}") for p, terms in periods.items()
        }
        holes.append(_holes_var(bundle, occupied, f"{name}_{entity}_{day}_{lane}"))
    return _sum_var(bundle, holes, f"tier_{name}")


# --- tier 5: soft-availability hits (week-agnostic, one per row x soft co-teacher) -----------------


def _tier_soft_hits(bundle: ModelBundle, occ: _Occupancy) -> cp_model.IntVar:
    soft = _soft_index(bundle.snapshot.availability)
    course_by = {(co, c.id): c for co in COHORTS for c in bundle.snapshot.cohorts[co].courses}
    terms: list[Term] = []
    for (cohort, cid, day, period), cell_terms in occ.course_cell.items():
        weight = sum(
            1 for t in course_by[(cohort, cid)].teacher_keys if (day, period) in soft.get(t, frozenset())
        )
        if weight:
            terms.extend(weight * t for t in cell_terms)
    return _as_var(bundle, sum(terms), 0, _max_soft(bundle, occ, soft, course_by), "tier_soft_hits")


# --- tier 7: doubles deficit (per course x lane; agnostic counts in both lanes) --------------------


def _tier_doubles(bundle: ModelBundle) -> cp_model.IntVar:
    snapshot = bundle.snapshot
    course_by = {(co, c.id): c for co in COHORTS for c in snapshot.cohorts[co].courses}
    deficits: list[cp_model.IntVar] = []
    # Every (course, lane) — a lane with no rows contributes 0, so iterating both lanes is safe.
    keys = {(cohort, cid, lane) for (cohort, cid, _d, lane) in bundle.by_course_day_lane}
    for cohort, cid, lane in keys:
        course = course_by[(cohort, cid)]
        singles: list[cp_model.IntVar] = []
        period_counts: list[Term] = []
        for day in range(1, snapshot.days + 1):
            terms = list(bundle.by_course_day_lane.get((cohort, cid, day, lane), {}).values())
            if not terms:
                continue
            count = sum(terms)
            period_counts.append(count)
            is_single = bundle.model.new_bool_var(f"single_{cohort}_{cid}_{day}_{lane}")
            bundle.model.add(count == 1).only_enforce_if(is_single)
            bundle.model.add(count != 1).only_enforce_if(~is_single)
            singles.append(is_single)
        deficits.append(_doubles_deficit(bundle, course, lane, singles, period_counts))
    return _sum_var(bundle, [d for d in deficits if d is not None], "tier_doubles")


def _doubles_deficit(
    bundle: ModelBundle, course, lane: str, singles, period_counts
) -> cp_model.IntVar | None:
    if not period_counts:
        return None
    hours = sum(period_counts)
    parity = bundle.model.new_bool_var(f"parity_{course.id}_{lane}")
    half = bundle.model.new_int_var(0, course.hours, f"half_{course.id}_{lane}")
    bundle.model.add(hours == 2 * half + parity)
    deficit = bundle.model.new_int_var(0, course.hours, f"doubles_{course.id}_{lane}")
    bundle.model.add_max_equality(deficit, [0, sum(singles) - parity])
    return deficit


# --- tiers 8 & 9: late starts and Friday tail (per cohort-day-lane) --------------------------------


def _tier_late_starts(bundle: ModelBundle, occ: _Occupancy) -> cp_model.IntVar:
    snapshot = bundle.snapshot
    starts: list[cp_model.IntVar] = []
    for cohort in COHORTS:
        for day in range(1, snapshot.days + 1):
            for lane in LANES:
                lv = _lane_vars(
                    bundle, _lane_occ(bundle, occ, cohort, day, lane), f"late_{cohort}_{day}_{lane}"
                )
                start = bundle.model.new_int_var(0, snapshot.periods, f"latestart_{cohort}_{day}_{lane}")
                bundle.model.add(start == lv.first - 1).only_enforce_if(lv.any)
                bundle.model.add(start == 0).only_enforce_if(~lv.any)
                starts.append(start)
    return _sum_var(bundle, starts, "tier_late_starts")


def _tier_friday_tail(bundle: ModelBundle, occ: _Occupancy) -> cp_model.IntVar:
    snapshot = bundle.snapshot
    last_day = snapshot.days
    tails = [
        _lane_vars(bundle, _lane_occ(bundle, occ, cohort, last_day, lane), f"friday_{cohort}_{lane}").last
        for cohort in COHORTS
        for lane in LANES
    ]
    return _sum_var(bundle, tails, "tier_friday_tail")


def _lane_occ(bundle: ModelBundle, occ: _Occupancy, cohort: str, day: int, lane: str) -> dict[int, Term]:
    return {
        p: _bool_occ(
            bundle, occ.cohort_lane.get((cohort, day, p, lane), []), f"cohlane_{cohort}_{day}_{p}_{lane}"
        )
        for p in range(1, bundle.snapshot.periods + 1)
    }


# --- tier 10: golden band distance ----------------------------------------------------------------


def _tier_golden(bundle: ModelBundle, occ: _Occupancy) -> cp_model.IntVar:
    snapshot = bundle.snapshot
    terms: list[Term] = []
    for cohort in COHORTS:
        roster = len({s for c in snapshot.cohorts[cohort].courses for s in c.student_keys})
        if roster == 0:
            continue
        bar = math.ceil(roster * GOLDEN_COVERAGE)  # integer threshold matching `coverage >= roster*0.9`
        for day in range(1, snapshot.days + 1):
            for period in range(1, snapshot.periods + 1):
                dist = _band_distance(period)
                if dist == 0:
                    continue  # a cell inside the band contributes 0 whether or not it is golden
                golden = _golden_cell(bundle, occ, cohort, day, period, bar)
                if golden is not None:
                    terms.append(dist * golden)
    return _as_var(bundle, sum(terms), 0, _max_golden(bundle, snapshot), "tier_golden")


def _golden_cell(bundle: ModelBundle, occ: _Occupancy, cohort: str, day: int, period: int, bar: int):
    """A bool: the cell reaches the coverage bar in EVERY lane. None if it can never (no coverage)."""
    lane_bools = []
    for lane in LANES:
        weighted = occ.coverage.get((cohort, day, period, lane), [])
        if not weighted:
            return None  # a lane with no possible coverage can never be golden
        reached = bundle.model.new_bool_var(f"cover_{cohort}_{day}_{period}_{lane}")
        total = sum(weight * term for weight, term in weighted)
        bundle.model.add(total >= bar).only_enforce_if(reached)
        bundle.model.add(total <= bar - 1).only_enforce_if(~reached)
        lane_bools.append(reached)
    golden = bundle.model.new_bool_var(f"golden_{cohort}_{day}_{period}")
    bundle.model.add_bool_and(lane_bools).only_enforce_if(golden)
    bundle.model.add_bool_or([~b for b in lane_bools]).only_enforce_if(~golden)
    return golden


def _band_distance(period: int) -> int:
    return max(0, GOLDEN_BAND_FIRST - period, period - GOLDEN_BAND_LAST)


# --- shared reification helpers -------------------------------------------------------------------


@dataclass
class _LaneVars:
    count: Term
    first: cp_model.IntVar
    last: cp_model.IntVar
    any: cp_model.IntVar


def _lane_vars(bundle: ModelBundle, occ: dict[int, Term], name: str) -> _LaneVars:
    periods = bundle.snapshot.periods
    bools = {p: occ.get(p, 0) for p in range(1, periods + 1)}
    count = sum(bools.values())
    any_b = bundle.model.new_bool_var(f"{name}_any")
    bundle.model.add(count >= 1).only_enforce_if(any_b)
    bundle.model.add(count == 0).only_enforce_if(~any_b)
    last = bundle.model.new_int_var(0, periods, f"{name}_last")
    bundle.model.add_max_equality(last, [p * bools[p] for p in range(1, periods + 1)])
    first = bundle.model.new_int_var(0, periods + 1, f"{name}_first")
    bundle.model.add_min_equality(
        first, [p * bools[p] + (periods + 1) * (1 - bools[p]) for p in range(1, periods + 1)]
    )
    return _LaneVars(count, first, last, any_b)


def _holes_var(bundle: ModelBundle, occ: dict[int, Term], name: str) -> cp_model.IntVar:
    lv = _lane_vars(bundle, occ, name)
    holes = bundle.model.new_int_var(0, bundle.snapshot.periods, f"{name}_holes")
    bundle.model.add(holes == lv.last - lv.first + 1 - lv.count).only_enforce_if(lv.any)
    bundle.model.add(holes == 0).only_enforce_if(~lv.any)
    return holes


def _bool_occ(bundle: ModelBundle, terms: list[Term], name: str) -> Term:
    """A 0/1 value for 'occupied' = sum(terms) >= 1. Constant-folds when the terms are all pins."""
    if not terms:
        return 0
    if all(isinstance(t, int) for t in terms):
        return 1 if sum(terms) >= 1 else 0
    b = bundle.model.new_bool_var(name)
    total = sum(terms)
    bundle.model.add(total >= 1).only_enforce_if(b)
    bundle.model.add(total == 0).only_enforce_if(~b)
    return b


def _as_var(bundle: ModelBundle, expr: Term, lo: int, hi: int, name: str) -> cp_model.IntVar:
    var = bundle.model.new_int_var(lo, hi, name)
    bundle.model.add(var == expr)
    return var


def _sum_var(bundle: ModelBundle, parts: list[Term], name: str) -> cp_model.IntVar:
    hi = bundle.snapshot.days * bundle.snapshot.periods * 200 + 1  # generous safe upper bound
    return _as_var(bundle, sum(parts) if parts else 0, 0, hi, name)


def _soft_index(availability: tuple[AvailabilityCell, ...]) -> dict[str, set[tuple[int, int]]]:
    index: dict[str, set[tuple[int, int]]] = {}
    for cell in availability:
        if cell.severity == "soft":
            index.setdefault(cell.teacher_key, set()).add((cell.day, cell.period))
    return index


def _max_soft(bundle: ModelBundle, occ: _Occupancy, soft, course_by) -> int:
    return (
        sum(
            sum(1 for t in course_by[(cohort, cid)].teacher_keys if (day, period) in soft.get(t, frozenset()))
            for (cohort, cid, day, period) in occ.course_cell
        )
        + 1
    )


def _max_golden(bundle: ModelBundle, snapshot) -> int:
    return snapshot.days * snapshot.periods * (GOLDEN_BAND_FIRST + snapshot.periods) * len(COHORTS) + 1
