"""The Python half of the both-suites wire-contract gate.

Mirror of ``bench/contract-parity.test.ts``. Between them the frozen contract in ``contracts/`` is
enforced from both sides: a producer that drifts turns exactly one suite red, and which one names
the side that moved.

Path note: pytest's rootdir is the package directory (``poc/cp-sat/``), not the repo root, so a
repo-relative string would break here. Anchoring on ``__file__`` also survives the planned
``services/solver/`` promotion verbatim — the depth to the repo root is the same.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator

import builders as b
from cpsat_engine.schema import Dump, Snapshot, parse_snapshot
from cpsat_engine.solve import SolveResult, StageReport, to_generation_result
from cpsat_engine.wire import canonical_json, canonical_snapshot_json, wire_stage_report

CONTRACTS = Path(__file__).resolve().parents[3] / "contracts"
SCHEMA_PATH = CONTRACTS / "generation-wire.schema.json"
SNAPSHOT_GOLDEN = CONTRACTS / "fixtures" / "generator-snapshot.json"
RESULT_GOLDEN = CONTRACTS / "fixtures" / "generation-result.json"


@pytest.fixture(scope="module")
def schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text())


def _validator(schema: dict[str, Any], name: str) -> Draft202012Validator:
    """A validator for one ``$defs`` entry that can still resolve the document's internal ``$ref``s.

    ``evolve(schema=...)`` keeps the root-anchored resolver the validator was built with, which is
    exactly how the library descends into subschemas internally.
    """
    return Draft202012Validator(schema).evolve(schema=schema["$defs"][name])


def _errors(validator: Draft202012Validator, payload: object) -> list[str]:
    return [f"{list(e.absolute_path)} {e.message}" for e in validator.iter_errors(payload)]


# --- the committed goldens ------------------------------------------------------------------------


def test_snapshot_golden_validates(schema: dict[str, Any]) -> None:
    payload = json.loads(SNAPSHOT_GOLDEN.read_text())
    assert _errors(_validator(schema, "GeneratorSnapshot"), payload) == []


def test_result_golden_validates(schema: dict[str, Any]) -> None:
    payload = json.loads(RESULT_GOLDEN.read_text())
    assert _errors(_validator(schema, "GenerationResult"), payload) == []


def test_snapshot_golden_round_trips_to_identical_canonical_bytes() -> None:
    """Parse the golden through the real parse path, re-emit through the real canonicalizer, and
    compare BYTES — the cross-language property the TS suite asserts from its own side."""
    snapshot = parse_snapshot(json.loads(SNAPSHOT_GOLDEN.read_text()))
    assert canonical_snapshot_json(snapshot) == SNAPSHOT_GOLDEN.read_text()


def test_result_golden_is_already_canonical() -> None:
    """``canonical_json`` sorts keys but never reorders arrays, so this passes only if the committed
    bytes already carry the declared array sorts."""
    assert canonical_json(json.loads(RESULT_GOLDEN.read_text())) == RESULT_GOLDEN.read_text()


def test_goldens_carry_no_nulls() -> None:
    for golden in (SNAPSHOT_GOLDEN, RESULT_GOLDEN):
        assert "null" not in golden.read_text(), f"{golden.name} nulls an optional instead of omitting it"


# --- the canonical form's rules -------------------------------------------------------------------


def test_canonical_form_sorts_keys_drops_nones_and_is_compact() -> None:
    assert canonical_json({"b": 1, "a": {"d": None, "c": [2, 3]}}) == '{"a":{"c":[2,3]},"b":1}'


def test_canonical_snapshot_is_invariant_to_input_order() -> None:
    one = b.snapshot(
        dp1=b.cohort(
            courses=[b.course("m", teachers=["t2"], students=["s2", "s1"]), b.course("a", teachers=["t1"])],
            pins=[b.pin("m", 3, 2), b.pin("a", 1, 1)],
            parked=["m", "a", "m"],
        ),
        availability=[b.soft("t2", 1, 3), b.strong("t1", 2, 1)],
        flagged=["z", "y"],
    )
    other = b.snapshot(
        dp1=b.cohort(
            courses=[b.course("a", teachers=["t1"]), b.course("m", teachers=["t2"], students=["s1", "s2"])],
            pins=[b.pin("a", 1, 1), b.pin("m", 3, 2)],
            parked=["m", "m", "a"],
        ),
        availability=[b.strong("t1", 2, 1), b.soft("t2", 1, 3)],
        flagged=["y", "z"],
    )
    assert canonical_snapshot_json(one) == canonical_snapshot_json(other)


def test_canonical_snapshot_keeps_parked_ids_a_multiset() -> None:
    snapshot = b.snapshot(dp1=b.cohort(parked=["b", "a", "b"]))
    assert '"parkedCourseIds":["a","b","b"]' in canonical_snapshot_json(snapshot)


def test_canonical_snapshot_matches_the_schema(schema: dict[str, Any]) -> None:
    snapshot = b.snapshot(dp1=b.cohort(courses=[b.course("a", teachers=["t1"])], pins=[b.pin("a", 1, 1)]))
    payload = json.loads(canonical_snapshot_json(snapshot))
    assert _errors(_validator(schema, "GeneratorSnapshot"), payload) == []


# --- the emit side --------------------------------------------------------------------------------


def _dump(snapshot: Snapshot) -> Dump:
    return Dump(
        format_version=1,
        meta={},
        snapshot=snapshot,
        greedy_placements=(),
        greedy_diagnostics={},
        objective=(),
    )


def _solve_result(*, proven_optimal: bool) -> SolveResult:
    return SolveResult(mode="full", board=(), stages=(), proven_optimal=proven_optimal)


def test_generation_result_omits_lower_bound_instead_of_nulling_it(schema: dict[str, Any]) -> None:
    # No greedy diagnostics -> no clique bound. The old emitter wrote `"lowerBound": null` here,
    # which is not assignable to the TS type and is rejected by the frozen schema.
    dump = _dump(b.snapshot(dp1=b.cohort(courses=[b.course("a", teachers=["t1"])])))
    payload = to_generation_result(dump, _solve_result(proven_optimal=True))

    for cohort in ("dp1", "dp2"):
        assert "lowerBound" not in payload["diagnostics"]["cohorts"][cohort]
    assert "null" not in canonical_json(payload)
    assert _errors(_validator(schema, "GenerationResult"), json.loads(canonical_json(payload))) == []


def test_generation_result_of_a_budget_stop_validates(schema: dict[str, Any]) -> None:
    dump = _dump(b.snapshot(dp1=b.cohort(courses=[b.course("a", teachers=["t1"])])))
    payload = to_generation_result(dump, _solve_result(proven_optimal=False))

    assert payload["diagnostics"]["partial"] is True
    assert payload["diagnostics"]["stopReason"] == "budget"
    assert _errors(_validator(schema, "GenerationResult"), json.loads(canonical_json(payload))) == []


def test_stage_report_serializes_to_the_camel_case_contract(schema: dict[str, Any]) -> None:
    stage = StageReport(tier=4, name="teacherHoles", status="OPTIMAL", best=97, bound=97, wall_clock_s=1.5)
    wire = wire_stage_report(stage)

    assert wire == {
        "tier": 4,
        "name": "teacherHoles",
        "status": "OPTIMAL",
        "best": 97,
        "bound": 97,
        "wallClockS": 1.5,
    }
    assert _errors(_validator(schema, "StageReport"), wire) == []


def test_stage_report_omits_best_and_bound_when_no_solution_was_found(schema: dict[str, Any]) -> None:
    stage = StageReport(tier=2, name="holes", status="UNKNOWN", best=None, bound=None, wall_clock_s=10.0)
    wire = wire_stage_report(stage)

    assert "best" not in wire and "bound" not in wire
    assert _errors(_validator(schema, "StageReport"), wire) == []
