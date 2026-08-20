"""Environment parsing, and the one rule that binds all of it: a malformed knob DEGRADES.

`settings.py` is read at import, before `logging.basicConfig` has run and before uvicorn binds a
port. A knob that raised there would kill the process ahead of `/health` — the opposite of the
bare-container promise the whole module is built around — so every parser here falls back and
complains on stderr instead. These tests are that promise, stated as behaviour.
"""

from __future__ import annotations

import pytest

from cpsat_service.settings import DEFAULT_LOG_LEVEL, DEFAULT_WORKERS, load_settings

TARGETS = "SOLVER_STAGE_TARGETS"


def test_stage_targets_are_empty_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    # Empty is not a placeholder for "not tuned yet" — it IS the shipped behaviour, and the engine
    # treats it as byte-for-byte the pre-S-303 ladder.
    monkeypatch.delenv(TARGETS, raising=False)
    assert load_settings().stage_targets == {}


def test_stage_targets_parse_a_tier_value_list(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(TARGETS, "3=95,6=900")
    assert load_settings().stage_targets == {3: 95, 6: 900}


def test_stage_targets_tolerate_whitespace_and_a_single_entry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(TARGETS, "  6 = 900 ")
    assert load_settings().stage_targets == {6: 900}


def test_a_malformed_entry_is_dropped_and_the_rest_still_load(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv(TARGETS, "3=95,six=900,10=nine,4")
    settings = load_settings()

    assert settings.stage_targets == {3: 95}
    complaints = capsys.readouterr().err
    assert "'six=900'" in complaints and "'10=nine'" in complaints and "'4'" in complaints


def test_a_tier_outside_the_ladder_is_dropped_with_a_complaint(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Tier 1 is excluded deliberately: Mode A's tier 1 has no objective at all and the full ladder's
    # MAXIMISES, so "stop at or below" reads backwards for both.
    monkeypatch.setenv(TARGETS, "1=0,11=5,0=1,6=900")
    settings = load_settings()

    assert settings.stage_targets == {6: 900}
    assert "outside 2-10" in capsys.readouterr().err


def test_an_empty_value_is_no_targets_rather_than_a_complaint(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv(TARGETS, "   ")
    assert load_settings().stage_targets == {}
    assert capsys.readouterr().err == ""


def test_a_negative_target_is_accepted_as_an_unreachable_one(monkeypatch: pytest.MonkeyPatch) -> None:
    # Not a validation hole: no tier can go below zero, so a negative target is simply never met and
    # the stage runs its budget out. Refusing it would mean encoding tier semantics in the parser.
    monkeypatch.setenv(TARGETS, "3=-1")
    assert load_settings().stage_targets == {3: -1}


# --- the pre-existing knobs, on the same degrade rule ---------------------------------------------


def test_a_non_integer_worker_count_falls_back_rather_than_killing_the_process(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("SOLVER_WORKERS", "eight")
    assert load_settings().workers == DEFAULT_WORKERS
    assert "not an integer" in capsys.readouterr().err


def test_zero_workers_is_refused_because_it_means_auto_to_cp_sat(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SOLVER_WORKERS", "0")
    assert load_settings().workers == DEFAULT_WORKERS


def test_an_unknown_log_level_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SOLVER_LOG_LEVEL", "chatty")
    assert load_settings().log_level == DEFAULT_LOG_LEVEL
