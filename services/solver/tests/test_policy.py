"""Pins on the preset table (S-307): every ladder is a permutation, the names are exactly the wire's
enum, and an absent key resolves to the service default."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from cpsat_engine.policy import (
    CANONICAL_LADDER,
    DEFAULT_PRESET,
    PRESETS,
    STUDENT_FIRST_LADDER,
    resolve_policy,
)
from cpsat_engine.solve import _LADDER_TIER_INDICES, SolveConfig

SCHEMA_PATH = Path(__file__).resolve().parents[3] / "contracts" / "generation-wire.schema.json"


@pytest.mark.parametrize("name", sorted(PRESETS))
def test_every_preset_ladder_is_a_permutation_of_the_canonical_one(name: str) -> None:
    assert sorted(PRESETS[name].ladder) == list(CANONICAL_LADDER)
    # And `SolveConfig` agrees — the construction-time check is the enforcement, this is the proof
    # that no preset trips it.
    assert SolveConfig(ladder=PRESETS[name].ladder).ladder == PRESETS[name].ladder


def test_the_canonical_ladder_is_the_engines_own() -> None:
    """Two spellings of one constant, on purpose (`policy` must not import `solve`). This is the
    pin that keeps them equal."""
    assert CANONICAL_LADDER == _LADDER_TIER_INDICES


def test_the_preset_names_are_exactly_the_wires_enum() -> None:
    schema = json.loads(SCHEMA_PATH.read_text())
    enum = schema["$defs"]["SolveRequest"]["properties"]["policy"]["properties"]["preset"]["enum"]
    assert sorted(PRESETS) == sorted(enum)
    assert all(PRESETS[name].preset == name for name in PRESETS)


def test_student_first_visits_student_holes_before_slots_and_teacher_holes() -> None:
    # The POC frontier's order: holes -> student -> slots -> teacher, with the rest canonical.
    assert STUDENT_FIRST_LADDER[:4] == (1, 5, 2, 3)
    assert STUDENT_FIRST_LADDER[4:] == (4, 6, 7, 8, 9)
    assert PRESETS["student-first"].clean_mode is True, "softHits is hard under student-first"


def test_clean_and_canonical_differ_only_in_clean_mode() -> None:
    assert PRESETS["clean"].ladder == PRESETS["canonical"].ladder == CANONICAL_LADDER
    assert (PRESETS["clean"].clean_mode, PRESETS["canonical"].clean_mode) == (True, False)


def test_resolve_policy_defaults_to_clean_on_an_absent_key() -> None:
    assert DEFAULT_PRESET == "clean"
    assert resolve_policy({"formatVersion": 1}) is PRESETS["clean"]


def test_resolve_policy_reads_the_named_preset() -> None:
    assert resolve_policy({"policy": {"preset": "student-first"}}) is PRESETS["student-first"]


def test_resolve_policy_refuses_an_unknown_preset_rather_than_substituting_one() -> None:
    with pytest.raises(ValueError, match="fastest"):
        resolve_policy({"policy": {"preset": "fastest"}})
