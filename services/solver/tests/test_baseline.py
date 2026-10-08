"""The CP-SAT regression baseline (S-309) — FR-314's "pinned and executable" precondition.

Both tests drive `run_job` against `FakeSupabase`: the production entry point, so the `SolveConfig`
they solve under is built exactly the way a dispatched job's is (`build_dump` → `resolve_policy` →
`_with_budgets`), with the stop hook a registered job carries. Nothing here hands the engine a
shortcut the HTTP path does not take — no warm start, no clique cut, no hand-built config.

**C — descent capability, deterministic by proof.** A crafted catalog whose slot optimum is pinned by
a conflict clique, so the assertion is a fact about the instance rather than about this machine.

**A — production-path tripwire, bounded.** The committed seed catalog at production's worker count.
Completeness, holes and soft hits are asserted exactly; `totalSlots` and `teacherHoles` against
bounds calibrated on the GitHub runner, never on M-series (see the constants below).

What this is NOT: a reproduction of S-308's production numbers. Those came from a deleted,
uncommittable production instance through a ~28-minute nondeterministic solve, and they stay the
documented, non-asserted reference (`bench/campaign-baseline.ts`).

Every test prints one `baseline:` line before it asserts anything, so a red sample still reports what
it saw — read it with `-s` (`uv run pytest -m baseline -s`).
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import pytest

import builders as b
from cpsat_engine.schema import Dump
from cpsat_engine.solve import SolveConfig, SolveResult, evaluate_board, solve_complete
from cpsat_engine.wire import wire_snapshot
from cpsat_service.registry import JobRegistry
from cpsat_service.settings import Settings
from fakes import JOB_ID, SETTINGS, FakeSupabase, run_sync_registered

SOLVE_REQUEST_GOLDEN = Path(__file__).resolve().parents[3] / "contracts" / "fixtures" / "solve-request.json"

# Positions in `evaluate_board`'s tuple — `build_objective`'s fixed tier order (`objective.py`).
UNPLACED, HOLES, TOTAL_SLOTS, TEACHER_HOLES, SOFT_HITS = range(5)

# The descent catalog's slot floor: its heaviest conflict clique is 14 hours (see test C).
DESCENT_OPTIMAL_SLOTS = 14

# Production's worker count (`CONTAINER_WORKERS`). Stage budgets are modest rather than generous:
# CP-SAT stops early only on OPTIMAL, so a later tier that cannot prove on this catalog burns its whole
# budget on every CI run — and C asserts tier 3 alone. Tier 10 is exactly that tier here (golden-band
# distance finds 1 against a bound of 0 and never closes the gap), so it stops at its first solution
# through the same `stage_targets` knob production carries; tier 3, which C asserts, has no target and
# keeps the full budget as proof headroom (it proved in ~0.45 s on M-series).
ANY_SOLUTION = 10**9
DESCENT_SETTINGS = replace(
    SETTINGS, workers=4, stage_budget_s=15.0, mode_a_budget_s=15.0, stage_targets={10: ANY_SOLUTION}
)

# Mode A at production's 60 s; ten-second stages keep the whole test inside ~90 s on the runner.
PRODUCTION_PATH_SETTINGS = replace(SETTINGS, workers=4, stage_budget_s=10.0, mode_a_budget_s=60.0)

# A's two budget-shaped bounds. Calibrated 2026-10-08 on GitHub's `ubuntu-latest` (4 vCPU; AMD EPYC
# 7763 x3, AMD EPYC 9V74, Intel Xeon 8370C), CI run 37755541849: 5 jobs x 2 runs = 10 samples, all
# green on every exact assertion. Observed min / median / max:
#   totalSlots     96 / 97.5 / 99      (97, 99, 99, 97, 97, 96, 97, 99, 99, 98)
#   teacherHoles  172 / 208.5 / 239    (172, 185, 222, 222, 211, 205, 191, 206, 239, 234)
#   wall clock   67.6 / 72.6 / 76.8 s  (C: 2.4-3.3 s)
# Each bound is `worst observed + max(2, ceil(0.10 * worst observed))`. Re-calibrate ONLY on the
# runner — M-series is 3-5x faster and would set bounds a loaded runner cannot meet (the same machine
# gave teacherHoles 105 here). S-308's ledger (`bench/campaign-baseline.ts`) stays the production
# reference; these numbers describe a committed instance at ten-second stages, not production.
TOTAL_SLOTS_BOUND = 109
TEACHER_HOLES_BOUND = 263

# (id, teacher, students, hours) — ported from greedy's quality bar (`descent-catalog.ts`), dp1 only,
# on a 5 x 6 grid. Conflicts are teacher- and student-driven; no pins, no availability.
DESCENT_COURSES: tuple[tuple[str, str, tuple[str, ...], int], ...] = (
    ("c0", "t0", ("s2", "s7"), 2),
    ("c1", "t3", ("s3",), 2),
    ("c2", "t0", ("s5", "s6"), 3),
    ("c3", "t0", ("s0", "s3", "s6", "s7"), 2),
    ("c4", "t0", ("s2", "s3", "s6"), 2),
    ("c5", "t1", ("s6", "s7", "s1"), 3),
    ("c6", "t1", ("s5", "s1", "s7", "s2"), 2),
    ("c7", "t4", ("s3", "s5"), 3),
    ("c8", "t2", ("s3", "s0"), 3),
    ("c9", "t1", ("s4", "s0", "s1"), 2),
    ("c10", "t2", ("s4", "s3"), 2),
    ("c11", "t0", ("s0", "s6", "s4"), 2),
)


@pytest.mark.baseline
def test_descent_catalog_proves_the_clique_optimum(monkeypatch: pytest.MonkeyPatch) -> None:
    """CP-SAT's slot descent reaches — and PROVES — the instance's floor of 14 occupied cells.

    The floor is the heaviest conflict clique, {c0, c2, c3, c4, c11, c5}: the first five share teacher
    t0, and c5 shares a student with each of them (s7 with c0, s6 with the rest). Every hour of a
    clique needs its own cell, so 2 + 3 + 2 + 2 + 2 + 3 = 14 cells is a hard lower bound, and a tier-3
    stage that ends OPTIMAL at 14 has proved the descent works. A FEASIBLE 14 would not be a proof.
    """
    run = _solve(_descent_request(), DESCENT_SETTINGS, monkeypatch)
    print(f"baseline: descent {run.summary()}")

    assert run.status == "succeeded"
    tier3 = next(stage for stage in run.result.stages if stage.tier == TOTAL_SLOTS + 1)
    assert (tier3.status, tier3.best) == ("OPTIMAL", DESCENT_OPTIMAL_SLOTS), (
        "tier 3 must PROVE the clique floor, not merely reach it"
    )
    assert run.tiers[TOTAL_SLOTS] == DESCENT_OPTIMAL_SLOTS
    assert run.tiers[UNPLACED] == 0


@pytest.mark.baseline
def test_production_path_baseline_on_the_seed_catalog(monkeypatch: pytest.MonkeyPatch) -> None:
    """The committed seed catalog through the HTTP path, minus `warmStart` — the app never sends one.

    Exact where the answer is structural (a complete, hole-free, clean board, without the clean
    fallback firing); bounded where it is budget-shaped (`totalSlots`, `teacherHoles`).
    """
    golden = json.loads(SOLVE_REQUEST_GOLDEN.read_text())
    request = {key: value for key, value in golden.items() if key != "warmStart"}
    run = _solve(request, PRODUCTION_PATH_SETTINGS, monkeypatch)
    print(f"baseline: production-path {run.summary()}")

    assert run.status == "succeeded"
    assert run.result.clean_fallback is False, "the seed catalog is clean-satisfiable"
    assert run.tiers[UNPLACED] == 0
    assert run.tiers[HOLES] == 0
    assert run.tiers[SOFT_HITS] == 0
    assert run.tiers[TOTAL_SLOTS] <= TOTAL_SLOTS_BOUND
    assert run.tiers[TEACHER_HOLES] <= TEACHER_HOLES_BOUND


# --- driving the wrapper ------------------------------------------------------------------------------


@dataclass(frozen=True)
class _Run:
    """One job through `run_job`: what the row was told, and what the engine actually returned."""

    status: str | None
    result: SolveResult
    tiers: tuple[int, ...]
    wall_clock_s: float

    def summary(self) -> str:
        stages = " ".join(f"{stage.tier}:{stage.status}" for stage in self.result.stages)
        return (
            f"status={self.status} tuple={self.tiers} wall_clock_s={self.wall_clock_s:.1f} "
            f"clean_fallback={self.result.clean_fallback} stages=[{stages}]"
        )


def _solve(request: dict[str, Any], settings: Settings, monkeypatch: pytest.MonkeyPatch) -> _Run:
    """Run the job synchronously, capturing the `(dump, result)` pair with a delegating recorder.

    The job is REGISTERED, as a dispatched one is, so the engine carries the same stop hook — and the
    same solution callback on every stage — that production's does.
    """
    solved: list[tuple[Dump, SolveResult]] = []

    def record(dump: Dump, config: SolveConfig) -> SolveResult:
        result = solve_complete(dump, config)
        solved.append((dump, result))
        return result

    monkeypatch.setattr("cpsat_service.runner.solve_complete", record)
    fake = FakeSupabase()
    registry = JobRegistry()
    registry.register(JOB_ID)
    started = time.monotonic()
    run_sync_registered(request, fake, registry, settings=settings)
    wall_clock_s = time.monotonic() - started

    assert len(solved) == 1, "the wrapper must reach the engine exactly once"
    dump, result = solved[0]
    finishes = [call for call in fake.patches() if "status" not in call.params]
    status = finishes[0].body["status"] if len(finishes) == 1 else None
    return _Run(status, result, evaluate_board(dump, result.board), wall_clock_s)


def _descent_request() -> dict[str, Any]:
    """The descent catalog as a `SolveRequest`: no policy key (the clean default), dp2 empty."""
    courses = [
        b.course(cid, teachers=[teacher], students=students, hours=hours)
        for cid, teacher, students, hours in DESCENT_COURSES
    ]
    snapshot = b.snapshot(dp1=b.cohort(courses=courses), days=5, periods=6)
    return {"formatVersion": 1, "snapshot": wire_snapshot(snapshot)}
