"""Snapshot -> CpModel builder: decision variables + every hard rule, pure.

One boolean per generated row ``(cohort, course, day, period, week)`` where ``week_mode = agnostic``
admits only ``both`` and ``biweekly`` only ``{a, b}``. Pins fold in as CONSTANTS, so every constraint
and (later) every objective tier ranges over the merged board — pins + generated — exactly as the TS
scorer's ``boardRows`` does.

Per Critical Implementation Details, all rules are encoded as plain hard constraints over the merged
board (no delta semantics), and the pins-only precondition is asserted before returning — otherwise
an infeasibility report would blame the generated rows for a dirty board the author handed us.

Hard-rule inventory (research §3, oracle ``verify.ts``):

  1. per-course placement count <= deficit          (tier 1 measures the shortfall)
  2. <= 1 row per (course, cell) across lanes        (duplicate-row key ignores week)
  3. teacher AtMostOne per (teacher, cell, lane)     (pools BOTH cohorts — subsumes cross-cohort)
  4. student AtMostOne per (student, cell, lane)
  5. strong-unavailability                           (no var created at a blocked cell = fixed 0)
  6. early-finish-edge                               (flagged course not strictly interior, reified)
  7. course-day stacking                             (<= 2 periods per course-day-lane)
  8. course-day split                                (the <=2 periods must be adjacent)
  9. teacher-day-shape                               (span <= 8 and streak <= 6 per teacher-day-lane)

Lane semantics (``analysis/lanes.ts``): ``both`` fans into lanes ``a`` and ``b``; ``a``/``b`` occupy
their own lane. Two weeks conflict iff not disjoint = they share a lane or either is ``both`` — which
"AtMostOne per lane" encodes exactly.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ortools.sat.python import cp_model

from .schema import (
    AGNOSTIC,
    BOTH,
    COHORTS,
    WEEK_A,
    WEEK_B,
    Course,
    Dump,
    Snapshot,
    deficits,
)

LANES: tuple[str, ...] = (WEEK_A, WEEK_B)
TEACHER_DAY_SPAN_MAX = 8
TEACHER_STREAK_MAX = 6
DAY_CAP = 2

# A merged-board occupancy term is either a CP-SAT literal (generated) or a constant 1 (a pin).
Term = object  # cp_model.IntVar | int


class PreconditionError(Exception):
    """The pins alone already violate a hard rule — no engine result could ever pass verify."""


def _lanes_of(week: str) -> tuple[str, ...]:
    return (WEEK_A, WEEK_B) if week == BOTH else (week,)


@dataclass
class ModelBundle:
    """The built model plus the occupancy aggregates the objective tiers reuse (Phase 3)."""

    model: cp_model.CpModel
    dump: Dump
    deficits: dict[tuple[str, str], int]
    # Placement decision vars, keyed (cohort, course_id, day, period, week).
    x: dict[tuple[str, str, int, int, str], cp_model.IntVar]
    # Merged-board occupancy term lists (vars + pin constants), keyed for each rule/tier that reads them.
    by_teacher_lane: dict[tuple[str, int, int, str], list[Term]]  # (teacher, day, period, lane)
    by_student_lane: dict[tuple[str, int, int, str], list[Term]]  # (student, day, period, lane)
    # (cohort, course, day, lane) -> {period: term}
    by_course_day_lane: dict[tuple[str, str, int, str], dict[int, Term]]
    stats: dict[str, int] = field(default_factory=dict)

    @property
    def snapshot(self) -> Snapshot:
        return self.dump.snapshot


def build_model(dump: Dump) -> ModelBundle:
    """Build the full hard-constrained model from a dump. Pure; raises :class:`PreconditionError`."""
    snapshot = dump.snapshot
    model = cp_model.CpModel()
    defs = deficits(snapshot)
    strong = _strong_unavailable_index(snapshot)

    bundle = ModelBundle(
        model=model,
        dump=dump,
        deficits=defs,
        x={},
        by_teacher_lane={},
        by_student_lane={},
        by_course_day_lane={},
        stats={},
    )

    _assert_pins_precondition(snapshot, strong)
    _create_variables(bundle, strong)
    _register_occupancy(bundle)
    _add_placement_caps(bundle)
    _add_at_most_one(bundle)
    _add_course_day_rules(bundle)
    _add_teacher_day_shape(bundle)
    _add_early_finish_edge(bundle)
    return bundle


# --- variables ------------------------------------------------------------------------------------


def _create_variables(bundle: ModelBundle, strong: dict[str, set[tuple[int, int]]]) -> None:
    """One bool per (course-with-deficit, non-pinned & available cell, week option)."""
    snapshot = bundle.snapshot
    skipped_pinned = 0
    skipped_strong = 0
    for cohort in COHORTS:
        snap = snapshot.cohorts[cohort]
        pinned_cells = {(pin.course_id, pin.day, pin.period) for pin in snap.pins}
        for course in snap.courses:
            if bundle.deficits[(cohort, course.id)] == 0:
                continue
            for day in range(1, snapshot.days + 1):
                for period in range(1, snapshot.periods + 1):
                    if (course.id, day, period) in pinned_cells:
                        skipped_pinned += 1
                        continue
                    if _strong_blocked(course, day, period, strong):
                        skipped_strong += 1
                        continue
                    for week in course.week_options():
                        bundle.x[(cohort, course.id, day, period, week)] = bundle.model.new_bool_var(
                            f"x_{cohort}_{course.id}_{day}_{period}_{week}"
                        )
    bundle.stats["placement_vars"] = len(bundle.x)
    bundle.stats["cells_skipped_pinned"] = skipped_pinned
    bundle.stats["cells_skipped_strong_unavailable"] = skipped_strong


def _strong_blocked(course: Course, day: int, period: int, strong: dict[str, set[tuple[int, int]]]) -> bool:
    return any((day, period) in strong.get(teacher, frozenset()) for teacher in course.teacher_keys)


# --- occupancy registration (the merged-board term lists every rule/tier reads) --------------------


def _register_occupancy(bundle: ModelBundle) -> None:
    """Fold every generated var and every pin into the per-teacher / per-student / per-course lane
    term lists, so a rule or tier sums terms instead of re-deriving the merged board."""
    snapshot = bundle.snapshot
    course_by = {(cohort, c.id): c for cohort in COHORTS for c in snapshot.cohorts[cohort].courses}

    for (cohort, cid, day, period, week), var in bundle.x.items():
        _register_one(bundle, course_by[(cohort, cid)], cohort, day, period, week, var)
    for cohort in COHORTS:
        for pin in snapshot.cohorts[cohort].pins:
            course = course_by.get((cohort, pin.course_id))
            if course is None:  # a pinned course absent from the catalog is skipped, mirroring the oracle
                continue
            _register_one(bundle, course, cohort, pin.day, pin.period, pin.week, 1)


def _register_one(
    bundle: ModelBundle, course: Course, cohort: str, day: int, period: int, week: str, term: Term
) -> None:
    for lane in _lanes_of(week):
        for teacher in course.teacher_keys:
            bundle.by_teacher_lane.setdefault((teacher, day, period, lane), []).append(term)
        for student in course.student_keys:
            bundle.by_student_lane.setdefault((student, day, period, lane), []).append(term)
        bundle.by_course_day_lane.setdefault((cohort, course.id, day, lane), {})[period] = term


# --- rule 1: placement caps ----------------------------------------------------------------------


def _add_placement_caps(bundle: ModelBundle) -> None:
    """Generated hours per course <= its deficit; and <= 1 row per (biweekly course, cell) across lanes."""
    per_course: dict[tuple[str, str], list[cp_model.IntVar]] = {}
    per_cell: dict[tuple[str, str, int, int], list[cp_model.IntVar]] = {}
    for (cohort, cid, day, period, _week), var in bundle.x.items():
        per_course.setdefault((cohort, cid), []).append(var)
        per_cell.setdefault((cohort, cid, day, period), []).append(var)

    for key, vars_ in per_course.items():
        bundle.model.add(sum(vars_) <= bundle.deficits[key])
    caps = 0
    for vars_ in per_cell.values():
        if len(vars_) > 1:  # only biweekly courses have two week options at one cell
            bundle.model.add(sum(vars_) <= 1)
            caps += 1
    bundle.stats["deficit_caps"] = len(per_course)
    bundle.stats["one_row_per_cell_caps"] = caps


# --- rules 3 & 4: teacher / student AtMostOne per lane -------------------------------------------


def _add_at_most_one(bundle: ModelBundle) -> None:
    """Teacher (both cohorts) and student AtMostOne per (entity, cell, lane) — subsumes cross-cohort."""
    bundle.stats["teacher_at_most_one"] = _at_most_one(bundle, bundle.by_teacher_lane)
    bundle.stats["student_at_most_one"] = _at_most_one(bundle, bundle.by_student_lane)


def _at_most_one(bundle: ModelBundle, buckets: dict[tuple[str, int, int, str], list[Term]]) -> int:
    added = 0
    for terms in buckets.values():
        if _var_count(terms) >= 1 and len(terms) >= 2:  # a bucket that can only ever hold pins is a no-op
            bundle.model.add(sum(terms) <= 1)
            added += 1
    return added


# --- rules 7 & 8: course-day stacking and split --------------------------------------------------


def _add_course_day_rules(bundle: ModelBundle) -> None:
    """<= 2 periods per course-day-lane (stacking), and those periods adjacent (no split).

    An agnostic course's two lanes are identical (its ``both`` rows run in each), so its constraints
    are added once (lane ``a``); a biweekly course's lanes differ and are both constrained."""
    course_by = {(cohort, c.id): c for cohort in COHORTS for c in bundle.snapshot.cohorts[cohort].courses}
    stacking = 0
    split = 0
    for (cohort, cid, _day, lane), periods in bundle.by_course_day_lane.items():
        if course_by[(cohort, cid)].week_mode == AGNOSTIC and lane == WEEK_B:
            continue
        if not _has_var(list(periods.values())):
            continue  # pins-only lane: fixed by the precondition, nothing to constrain
        bundle.model.add(sum(periods.values()) <= DAY_CAP)
        stacking += 1
        split += _add_no_split(bundle, periods)
    bundle.stats["course_day_stacking"] = stacking
    bundle.stats["course_day_split"] = split


def _add_no_split(bundle: ModelBundle, periods: dict[int, Term]) -> int:
    """With a cap of 2, a split is two occupied periods that are not adjacent. Forbid every
    non-adjacent occupied pair: ``occ[p] + occ[q] <= 1`` for all ``q > p + 1``."""
    slots = sorted(periods.keys())
    added = 0
    for i, p in enumerate(slots):
        for q in slots[i + 1 :]:
            if q > p + 1:
                bundle.model.add(periods[p] + periods[q] <= 1)
                added += 1
    return added


# --- rule 9: teacher-day-shape (span <= 8, streak <= 6) ------------------------------------------


def _add_teacher_day_shape(bundle: ModelBundle) -> None:
    """Per (teacher, day, lane): span (last - first + 1) <= 8 and no run of > 6 consecutive periods.

    Streak is the local rule: forbid every window of 7 consecutive periods being fully occupied.
    Span is the global one: any two occupied periods must be within 7 of each other, expressed as
    ``occ[p] + occ[q] <= 1`` for ``q - p >= 8``."""
    periods = bundle.snapshot.periods
    by_teacher_day_lane: dict[tuple[str, int, str], dict[int, list[Term]]] = {}
    for (teacher, day, period, lane), terms in bundle.by_teacher_lane.items():
        by_teacher_day_lane.setdefault((teacher, day, lane), {})[period] = terms

    span_pairs = 0
    streak_windows = 0
    for occ in by_teacher_day_lane.values():
        if not any(_has_var(terms) for terms in occ.values()):
            continue  # pins-only teacher-day-lane: fixed by the precondition
        # Span: two occupied periods more than 8 apart cannot both be occupied.
        slots = sorted(occ)
        for i, p in enumerate(slots):
            for q in slots[i + 1 :]:
                if q - p + 1 > TEACHER_DAY_SPAN_MAX:
                    bundle.model.add(sum(occ[p]) + sum(occ[q]) <= 1)
                    span_pairs += 1
        # Streak: no window of STREAK_MAX+1 consecutive periods fully occupied.
        window = TEACHER_STREAK_MAX + 1
        for start in range(1, periods - window + 2):
            covered = [occ[p] for p in range(start, start + window) if p in occ]
            if len(covered) == window:  # every period in the window can be occupied
                bundle.model.add(sum(term for terms in covered for term in terms) <= window - 1)
                streak_windows += 1
    bundle.stats["teacher_day_span_pairs"] = span_pairs
    bundle.stats["teacher_day_streak_windows"] = streak_windows


# --- rule 6: early-finish-edge -------------------------------------------------------------------


def _add_early_finish_edge(bundle: ModelBundle) -> None:
    """A flagged course placed at (day, period) in a lane must not be strictly interior to the periods
    its enrolled students occupy via OTHER courses that day-lane (mirrors ``early-finish-edge.ts``).

    Only cells where the flagged course can actually land carry a constraint (a pinned flagged row
    contributes a constant 1, so it still forbids generated rows from sandwiching it)."""
    snapshot = bundle.snapshot
    flagged = snapshot.finishes_early_by_course_id
    course_by = {(cohort, c.id): c for cohort in COHORTS for c in snapshot.cohorts[cohort].courses}
    added = 0
    for cohort in COHORTS:
        for fid in {c.id for c in snapshot.cohorts[cohort].courses} & flagged:
            course = course_by[(cohort, fid)]
            for lane in LANES:
                for day in range(1, snapshot.days + 1):
                    f_periods = bundle.by_course_day_lane.get((cohort, fid, day, lane), {})
                    for period, f_term in f_periods.items():
                        for student in course.student_keys:
                            added += _add_edge_constraint(
                                bundle, cohort, fid, student, day, lane, period, f_term
                            )
    bundle.stats["early_finish_constraints"] = added


def _add_edge_constraint(
    bundle: ModelBundle, cohort: str, fid: str, student: str, day: int, lane: str, period: int, f_term: Term
) -> int:
    """Forbid f_term(period) AND (some other-course occupancy below) AND (some above)."""
    periods = bundle.snapshot.periods
    below = _other_occupancy(bundle, cohort, fid, student, day, lane, range(1, period))
    above = _other_occupancy(bundle, cohort, fid, student, day, lane, range(period + 1, periods + 1))
    if not below or not above:
        return 0  # a day edge on one side is impossible to sandwich — nothing to forbid
    below_bool = _reify_any(bundle, below, f"efe_below_{cohort}_{fid}_{student}_{day}_{lane}_{period}")
    above_bool = _reify_any(bundle, above, f"efe_above_{cohort}_{fid}_{student}_{day}_{lane}_{period}")
    bundle.model.add(f_term + below_bool + above_bool <= 2)
    return 1


def _other_occupancy(
    bundle: ModelBundle, cohort: str, fid: str, student: str, day: int, lane: str, span: range
) -> list[Term]:
    """The student's occupancy in this day-lane at the given periods, via courses OTHER than the
    flagged one: ``studentOcc(period) - flaggedOcc(period)`` (a 0/1 term by the student AtMostOne)."""
    f_periods = bundle.by_course_day_lane.get((cohort, fid, day, lane), {})
    terms: list[Term] = []
    for q in span:
        student_terms = bundle.by_student_lane.get((student, day, q, lane), [])
        if not student_terms:
            continue
        f_at_q = f_periods.get(q, 0)
        terms.append(sum(student_terms) - (f_at_q if not (isinstance(f_at_q, int) and f_at_q == 0) else 0))
    return terms


def _reify_any(bundle: ModelBundle, terms: list[Term], name: str) -> cp_model.IntVar:
    """A bool that is 1 iff the sum of the (0/1) terms is >= 1."""
    b = bundle.model.new_bool_var(name)
    total = sum(terms)
    bundle.model.add(total >= 1).only_enforce_if(b)
    bundle.model.add(total == 0).only_enforce_if(~b)
    return b


# --- precondition & indexes ----------------------------------------------------------------------


def _strong_unavailable_index(snapshot: Snapshot) -> dict[str, set[tuple[int, int]]]:
    index: dict[str, set[tuple[int, int]]] = {}
    for cell in snapshot.availability:
        if cell.severity == "strong":
            index.setdefault(cell.teacher_key, set()).add((cell.day, cell.period))
    return index


def _assert_pins_precondition(snapshot: Snapshot, strong: dict[str, set[tuple[int, int]]]) -> None:
    """Mirror of ``verifyGeneration(snapshot, [])``: the pins ALONE must violate no hard rule."""
    for cohort in COHORTS:
        snap = snapshot.cohorts[cohort]
        course_by = snap.course_by_id()
        _check_pin_duplicates(cohort, snap.pins)
        _check_pin_lane_conflicts(cohort, snap.pins, course_by)
        _check_pin_strong(cohort, snap.pins, course_by, strong)
        _check_pin_course_days(cohort, snap.pins, course_by)
    _check_pin_teacher_days(snapshot)


def _check_pin_duplicates(cohort: str, pins) -> None:
    seen: set[tuple[str, int, int]] = set()
    for pin in pins:
        key = (pin.course_id, pin.day, pin.period)
        if key in seen:
            raise PreconditionError(f"{cohort}: duplicate pinned row {key}")
        seen.add(key)


def _check_pin_lane_conflicts(cohort: str, pins, course_by: dict[str, Course]) -> None:
    teacher: dict[tuple[str, int, int, str], int] = {}
    student: dict[tuple[str, int, int, str], int] = {}
    for pin in pins:
        course = course_by.get(pin.course_id)
        if course is None:
            continue
        for lane in _lanes_of(pin.week):
            for t in course.teacher_keys:
                teacher[(t, pin.day, pin.period, lane)] = teacher.get((t, pin.day, pin.period, lane), 0) + 1
            for s in course.student_keys:
                student[(s, pin.day, pin.period, lane)] = student.get((s, pin.day, pin.period, lane), 0) + 1
    for key, n in {**teacher, **student}.items():
        if n > 1:
            raise PreconditionError(f"{cohort}: pins already double-book {key} ({n} occupants)")


def _check_pin_strong(cohort: str, pins, course_by: dict[str, Course], strong) -> None:
    for pin in pins:
        course = course_by.get(pin.course_id)
        if course and _strong_blocked(course, pin.day, pin.period, strong):
            cell = (pin.day, pin.period)
            raise PreconditionError(f"{cohort}: pin {pin.course_id} on a strong-unavailable cell {cell}")


def _check_pin_course_days(cohort: str, pins, course_by: dict[str, Course]) -> None:
    by_course_day_lane: dict[tuple[str, int, str], list[int]] = {}
    for pin in pins:
        if pin.course_id not in course_by:
            continue
        for lane in _lanes_of(pin.week):
            by_course_day_lane.setdefault((pin.course_id, pin.day, lane), []).append(pin.period)
    for key, periods in by_course_day_lane.items():
        distinct = sorted(set(periods))
        if len(distinct) > DAY_CAP:
            raise PreconditionError(f"{cohort}: pins stack course {key} ({len(distinct)} periods)")
        if len(distinct) >= 2 and distinct[-1] - distinct[0] + 1 > len(distinct):
            raise PreconditionError(f"{cohort}: pins split course {key} ({distinct})")


def _check_pin_teacher_days(snapshot: Snapshot) -> None:
    by_teacher_day_lane: dict[tuple[str, int, str], set[int]] = {}
    for cohort in COHORTS:
        snap = snapshot.cohorts[cohort]
        course_by = snap.course_by_id()
        for pin in snap.pins:
            course = course_by.get(pin.course_id)
            if course is None:
                continue
            for lane in _lanes_of(pin.week):
                for t in course.teacher_keys:
                    by_teacher_day_lane.setdefault((t, pin.day, lane), set()).add(pin.period)
    for key, periods in by_teacher_day_lane.items():
        ordered = sorted(periods)
        span = ordered[-1] - ordered[0] + 1
        streak = _max_streak(ordered)
        if span > TEACHER_DAY_SPAN_MAX or streak > TEACHER_STREAK_MAX:
            raise PreconditionError(f"pins over-shape teacher day {key} (span {span}, streak {streak})")


def _max_streak(sorted_periods: list[int]) -> int:
    longest = running = 0
    prev = None
    for period in sorted_periods:
        running = running + 1 if prev is not None and period == prev + 1 else 1
        longest = max(longest, running)
        prev = period
    return longest


def _var_count(terms: list[Term]) -> int:
    return sum(1 for term in terms if not isinstance(term, int))


def _has_var(terms: list[Term]) -> bool:
    return any(not isinstance(term, int) for term in terms)
