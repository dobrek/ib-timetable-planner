"""Solver entry points (Phases 3-4).

    parity          fixed-hint solve vs the dump's TS tuple — the blocking encoding-equivalence gate
    solve_staged    staged lexicographic ladder over all ten tiers (harden ``tier_k <= best_k``)
    solve_complete  Mode A: completeness feasibility + infeasibility branch
    solve_repair    Mode B: 1-hop residual repair around the greedy unplaced courses

Implemented in Phases 3 (parity) and 4 (staged/complete/repair).
"""

from __future__ import annotations

from dataclasses import dataclass

from ortools.sat.python import cp_model

from .model import build_model
from .objective import build_tiers
from .schema import Dump


class ParityError(Exception):
    """The greedy board — proven feasible in Phase 2 — could not be replayed under the tier model."""


@dataclass(frozen=True)
class TierParity:
    name: str
    computed: int
    expected: int

    @property
    def ok(self) -> bool:
        return self.computed == self.expected


@dataclass(frozen=True)
class ParityReport:
    """The per-tier comparison of the CP-SAT tiers against the dump's TS objective tuple."""

    tiers: tuple[TierParity, ...]

    @property
    def ok(self) -> bool:
        return all(t.ok for t in self.tiers)

    @property
    def computed(self) -> tuple[int, ...]:
        return tuple(t.computed for t in self.tiers)

    @property
    def expected(self) -> tuple[int, ...]:
        return tuple(t.expected for t in self.tiers)

    def mismatches(self) -> tuple[TierParity, ...]:
        return tuple(t for t in self.tiers if not t.ok)


def parity(dump: Dump) -> ParityReport:
    """Encoding-equivalence gate: pin every placement var to the greedy board, solve for the tier
    aux-vars, and compare all ten evaluated tiers to ``dump.objective`` (the TS scorer's tuple).

    The board is fixed via the hint + ``fix_variables_to_their_hinted_value``; the tier vars are left
    free and are pinned by propagation (each is functionally defined), so the completion is unique."""
    bundle = build_model(dump)
    tiers = build_tiers(bundle)

    greedy = {(p.cohort, p.course_id, p.day, p.period, p.week) for p in dump.greedy_placements}
    for key, var in bundle.x.items():
        bundle.model.add_hint(var, 1 if key in greedy else 0)

    solver = cp_model.CpSolver()
    solver.parameters.fix_variables_to_their_hinted_value = True
    solver.parameters.num_workers = 1
    solver.parameters.max_time_in_seconds = 60
    status = solver.solve(bundle.model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise ParityError(f"the greedy board did not replay under the tier model: status={status}")

    expected = tuple(dump.objective)
    return ParityReport(
        tiers=tuple(
            TierParity(name=t.name, computed=int(solver.value(t.var)), expected=expected[i])
            for i, t in enumerate(tiers)
        )
    )
