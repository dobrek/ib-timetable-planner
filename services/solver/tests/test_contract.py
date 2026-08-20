"""The Python half of the both-suites wire-contract gate.

Mirror of ``bench/contract-parity.test.ts``. Between them the frozen contract in ``contracts/`` is
enforced from both sides: a producer that drifts turns exactly one suite red, and which one names
the side that moved.

Path note: pytest's rootdir is the package directory (``services/solver/``), not the repo root, so a
repo-relative string would break here. Anchoring on ``__file__`` is also what carried this file
through the package's promotion out of ``poc/`` unedited — the depth to the repo root is the same.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator
from jsonschema.protocols import Validator

import builders as b
from cpsat_engine.schema import Dump, Snapshot, parse_snapshot
from cpsat_engine.solve import SolveResult, StageReport, to_generation_result
from cpsat_engine.wire import (
    canonical_json,
    canonical_result_json,
    canonical_snapshot_json,
    canonical_solve_request_json,
    snapshot_hash,
    wire_stage_report,
)

CONTRACTS = Path(__file__).resolve().parents[3] / "contracts"
SCHEMA_PATH = CONTRACTS / "generation-wire.schema.json"
SNAPSHOT_GOLDEN = CONTRACTS / "fixtures" / "generator-snapshot.json"
RESULT_GOLDEN = CONTRACTS / "fixtures" / "generation-result.json"
SOLVE_REQUEST_GOLDEN = CONTRACTS / "fixtures" / "solve-request.json"
GOLDENS = (SNAPSHOT_GOLDEN, RESULT_GOLDEN, SOLVE_REQUEST_GOLDEN)

# The recorded digest of the snapshot golden. The IDENTICAL literal is asserted in
# `bench/contract-parity.test.ts` against `computeSnapshotHash`, which is the whole point: the app
# writes `generation_jobs.snapshot_hash` from the TS side and the service binds its dispatched body
# against it from this side, so the two digests agreeing is the load-bearing property. Byte-parity of
# the canonical form is necessary but not sufficient — an encoding or hex-formatting difference would
# split the hashes while leaving both round-trip tests green.
SNAPSHOT_GOLDEN_SHA256 = "8ab77d79e1138f7ed0c054ff51429330998e32df40c4dea42c1d95ac85c8698b"


@pytest.fixture(scope="module")
def schema() -> dict[str, Any]:
    parsed: dict[str, Any] = json.loads(SCHEMA_PATH.read_text())
    return parsed


def _validator(schema: dict[str, Any], name: str) -> Validator:
    """A validator for one ``$defs`` entry that can still resolve the document's internal ``$ref``s.

    ``evolve(schema=...)`` keeps the root-anchored resolver the validator was built with, which is
    exactly how the library descends into subschemas internally.
    """
    return Draft202012Validator(schema).evolve(schema=schema["$defs"][name])


def _errors(validator: Validator, payload: Any) -> list[str]:
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


def test_result_golden_round_trips_to_identical_canonical_bytes() -> None:
    """Re-emit the golden through the Python result canonicalizer and compare BYTES.

    Runs through ``canonical_result_json``, not bare ``canonical_json``: the latter sorts keys but
    never reorders arrays, so it would pass whether or not this side implements the result-side sorts
    at all. Going through the real canonicalizer is what makes a Python sort regression red here."""
    assert canonical_result_json(json.loads(RESULT_GOLDEN.read_text())) == RESULT_GOLDEN.read_text()


def test_solve_request_golden_validates(schema: dict[str, Any]) -> None:
    payload = json.loads(SOLVE_REQUEST_GOLDEN.read_text())
    assert _errors(_validator(schema, "SolveRequest"), payload) == []


def test_solve_request_golden_round_trips_to_identical_canonical_bytes() -> None:
    """F-302's own envelope, held to the same byte-parity bar as the payloads it carries.

    Through ``canonical_solve_request_json`` rather than bare ``canonical_json`` for the same reason
    as the result golden: the bare serializer sorts keys but never reorders arrays, so it would pass
    even if this side implemented none of the declared sorts."""
    payload = json.loads(SOLVE_REQUEST_GOLDEN.read_text())
    assert canonical_solve_request_json(payload) == SOLVE_REQUEST_GOLDEN.read_text()


def test_solve_request_golden_exercises_the_optional_warm_start() -> None:
    """The golden is worth little if it only covers the required half of the envelope: ``warmStart``
    is the one optional key, so a fixture without it would leave the omit-vs-present rule ungated."""
    payload = json.loads(SOLVE_REQUEST_GOLDEN.read_text())
    assert payload["formatVersion"] == 1
    assert payload["warmStart"], "the fixture must carry a non-empty warm start"


def test_snapshot_golden_digests_to_the_recorded_cross_language_hash() -> None:
    """The `snapshot_hash` binding is only a binding if both languages compute the same digest."""
    snapshot = parse_snapshot(json.loads(SNAPSHOT_GOLDEN.read_text()))
    assert snapshot_hash(snapshot) == SNAPSHOT_GOLDEN_SHA256


def test_goldens_carry_no_nulls() -> None:
    for golden in GOLDENS:
        assert "null" not in golden.read_text(), f"{golden.name} nulls an optional instead of omitting it"


# --- the canonical form's rules -------------------------------------------------------------------


def test_canonical_form_sorts_keys_drops_nones_and_is_compact() -> None:
    assert canonical_json({"b": 1, "a": {"d": None, "c": [2, 3]}}) == '{"a":{"c":[2,3]},"b":1}'


def test_canonical_form_writes_non_ascii_raw_never_as_escapes() -> None:
    """`JSON.stringify` emits the character; `json.dumps` escapes it unless told not to. Every string
    on this wire is a UUID today, so only this test stands between the rule and a silent
    `snapshot_hash` split the first time a non-ASCII id appears."""
    assert canonical_json({"teacherKey": "Zoë"}) == '{"teacherKey":"Zoë"}'


def test_canonical_form_refuses_non_finite_numbers() -> None:
    """Python would write the bare token `NaN` — not JSON, and unreadable by `JSON.parse`, where
    JavaScript writes `null`. Raising here beats shipping bytes no parser will take back."""
    with pytest.raises(ValueError):
        canonical_json({"wallClockS": float("nan")})


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


def test_canonical_result_applies_the_declared_array_sorts() -> None:
    """The result-side mirror of the snapshot's order-invariance test: two payloads carrying the same
    board in different producer order must canonicalize to identical bytes."""
    placements = [
        {"cohort": "dp2", "courseId": "b", "day": 1, "period": 1, "week": "both"},
        {"cohort": "dp1", "courseId": "a", "day": 2, "period": 3, "week": "both"},
        {"cohort": "dp1", "courseId": "a", "day": 1, "period": 3, "week": "a"},
    ]
    unplaced = [{"courseId": "z", "missing": 1}, {"courseId": "a", "missing": 2}]

    def result(board: list[dict[str, Any]], missing: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "placements": board,
            "diagnostics": {
                "engine": "cp-sat",
                "elapsedMs": 1,
                "partial": False,
                "provenOptimal": True,
                "cohorts": {
                    "dp1": {"occupiedSlotsBefore": 0, "occupiedSlotsAfter": 1, "unplaced": missing},
                    "dp2": {"occupiedSlotsBefore": 0, "occupiedSlotsAfter": 1, "unplaced": []},
                },
            },
        }

    canonical = canonical_result_json(result(placements, unplaced))

    assert canonical == canonical_result_json(result(placements[::-1], unplaced[::-1]))
    assert '"placements":[{"cohort":"dp1","courseId":"a","day":1,"period":3,"week":"a"}' in canonical
    assert '"unplaced":[{"courseId":"a","missing":2},{"courseId":"z","missing":1}]' in canonical


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


def test_stage_report_carries_stopped_by_when_not_optimal(schema: dict[str, Any]) -> None:
    stage = StageReport(
        tier=6,
        name="studentHoles",
        status="FEASIBLE",
        best=900,
        bound=880,
        wall_clock_s=8.29,
        stopped_by="target",
    )
    wire = wire_stage_report(stage)

    assert wire["stoppedBy"] == "target"
    assert _errors(_validator(schema, "StageReport"), wire) == []


def test_stage_report_omits_stopped_by_rather_than_nulling_it(schema: dict[str, Any]) -> None:
    # The exact-dict test above is the byte gate; this one names the rule it enforces, because a
    # `"stoppedBy": null` would validate nowhere on this wire and would break canonical bytes.
    wire = wire_stage_report(
        StageReport(tier=1, name="completeness", status="OPTIMAL", best=0, bound=0, wall_clock_s=0.4)
    )

    assert "stoppedBy" not in wire
    assert "null" not in canonical_json(wire)
    assert _errors(_validator(schema, "StageReport"), wire) == []


def test_generation_result_of_a_target_stop_validates(schema: dict[str, Any]) -> None:
    dump = _dump(b.snapshot(dp1=b.cohort(courses=[b.course("a", teachers=["t1"])])))
    payload = to_generation_result(dump, _solve_result(proven_optimal=False))
    payload["diagnostics"]["stopReason"] = "target"

    assert _errors(_validator(schema, "GenerationResult"), json.loads(canonical_json(payload))) == []


def test_the_stop_reason_enum_is_exactly_the_four_the_wire_declares(schema: dict[str, Any]) -> None:
    # Pinned as data: widening it again is a contract decision, not an implementation detail, and
    # `interrupted` in particular has no producer in the engine (the app writes it, S-304).
    assert schema["$defs"]["GenerationDiagnostics"]["properties"]["stopReason"]["enum"] == [
        "budget",
        "target",
        "cancelled",
        "interrupted",
    ]
