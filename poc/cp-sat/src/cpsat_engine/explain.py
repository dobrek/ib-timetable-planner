"""Explain an infeasible Mode-A completeness solve.

Two framings, both over per-course completeness requirements (``sum(placed_c) >= deficit_c``):

  conflict set   each requirement carries an enforcement literal; assume them all and read back
                 ``sufficient_assumptions_for_infeasibility`` — a subset of courses that cannot all
                 be completed together. Minimised by the solver, not guaranteed minimal (a true MUS
                 needs the deletion-shrink loop; deferred to the memo branch if it fires).
  max completable  maximise the number of requirements that can hold — its complement is the minimum
                 set to drop for feasibility, i.e. the courses the instance structurally cannot seat.

Assumptions are incompatible with parallelism, so the conflict solve runs ``num_workers = 1``.
"""

from __future__ import annotations

from dataclasses import dataclass

from ortools.sat.python import cp_model

from .model import ModelBundle, build_model
from .schema import Dump


@dataclass(frozen=True)
class InfeasibilityReport:
    """Named by (cohort, course_id) — the CLI/memo maps the ids to names locally (never in-repo)."""

    conflict: tuple[tuple[str, str], ...]  # a sufficient (not necessarily minimal) conflict set
    droppable: tuple[tuple[str, str], ...]  # minimum set to drop for a feasible completion
    completable: tuple[tuple[str, str], ...]  # the maximum completable subset (its complement)


def explain_infeasibility(dump: Dump, *, budget_s: float = 120.0, seed: int = 1) -> InfeasibilityReport:
    """Run both framings and return the combined report. Assumes Mode A already proved INFEASIBLE."""
    conflict = _conflict_set(dump, budget_s, seed)
    droppable, completable = _max_completable(dump, budget_s, seed)
    return InfeasibilityReport(conflict=conflict, droppable=droppable, completable=completable)


def _conflict_set(dump: Dump, budget_s: float, seed: int) -> tuple[tuple[str, str], ...]:
    bundle = build_model(dump)
    requires = _completeness_literals(bundle)
    bundle.model.add_assumptions(list(requires.values()))
    solver = cp_model.CpSolver()
    solver.parameters.num_workers = 1  # assumptions are incompatible with parallelism
    solver.parameters.max_time_in_seconds = budget_s
    solver.parameters.random_seed = seed
    status = solver.solve(bundle.model)
    if status != cp_model.INFEASIBLE:
        return ()  # feasible (or unknown) under assumptions — no conflict to name
    by_index = {literal.index: key for key, literal in requires.items()}
    return tuple(
        by_index[index] for index in solver.sufficient_assumptions_for_infeasibility() if index in by_index
    )


def _max_completable(
    dump: Dump, budget_s: float, seed: int
) -> tuple[tuple[tuple[str, str], ...], tuple[tuple[str, str], ...]]:
    bundle = build_model(dump)
    requires = _completeness_literals(bundle)
    bundle.model.maximize(sum(requires.values()))  # complete as many courses as possible
    solver = cp_model.CpSolver()
    solver.parameters.num_workers = 0
    solver.parameters.max_time_in_seconds = budget_s
    solver.parameters.random_seed = seed
    status = solver.solve(bundle.model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return (), ()
    droppable = tuple(key for key, literal in requires.items() if solver.value(literal) == 0)
    completable = tuple(key for key, literal in requires.items() if solver.value(literal) == 1)
    return droppable, completable


def _completeness_literals(bundle: ModelBundle) -> dict[tuple[str, str], cp_model.IntVar]:
    """One enforcement bool per deficit course: ``require_c -> sum(placed_c) >= deficit_c``."""
    by_course: dict[tuple[str, str], list[cp_model.IntVar]] = {}
    for (cohort, cid, _d, _p, _w), var in bundle.x.items():
        by_course.setdefault((cohort, cid), []).append(var)
    literals: dict[tuple[str, str], cp_model.IntVar] = {}
    for key, need in bundle.deficits.items():
        if need > 0 and key in by_course:
            literal = bundle.model.new_bool_var(f"require_{key[0]}_{key[1]}")
            bundle.model.add(sum(by_course[key]) >= need).only_enforce_if(literal)
            literals[key] = literal
    return literals
