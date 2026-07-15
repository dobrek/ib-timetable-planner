"""Phase 1 smoke test: the package imports and the committed seed fixture parses as the dump shape."""

import json
from pathlib import Path

import cpsat_engine

FIXTURE = Path(__file__).parent / "fixtures" / "seed-plan-a.json"


def test_package_imports() -> None:
    assert cpsat_engine.__version__


def test_seed_fixture_header_parses() -> None:
    dump = json.loads(FIXTURE.read_text())
    assert dump["formatVersion"] == 1
    assert dump["meta"]["sourcePlanId"]
    assert dump["snapshot"]["cohorts"].keys() >= {"dp1", "dp2"}
    assert len(dump["objective"]) == 10
