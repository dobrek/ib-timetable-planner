"""Snapshot -> CpModel builder: decision variables + every hard rule, pure (Phase 2).

One boolean per generated row (cohort, course, day, period, weekOption); pins fold in as constants.
Encodes the full hard-rule inventory (teacher/student AtMostOne, strong-unavailability, early-finish
edge, course-day stacking/split, teacher-day-shape span/streak) and asserts the pins-only
precondition before returning.

Implemented in Phase 2.
"""
