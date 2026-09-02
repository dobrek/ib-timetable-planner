"""The file transport under test — the POC's recorded lesson was that `cli.py` never got any.

One micro dump, written with the test builders, driven through `main` end to end: the sidecar echoes
the policy and the transcript follows its ladder order, which is the property `--policy` exists for
(reproducing the POC frontier without a service). The default is pinned separately because it is
the OPPOSITE of the service's, on purpose.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import builders as b
from cpsat_engine.cli import _parse_args, main
from cpsat_engine.wire import wire_snapshot


def _write_micro_dump(path: Path) -> None:
    snapshot = b.snapshot(
        dp1=b.cohort(
            courses=[
                b.course("A", teachers=["T1"], students=["s1", "s2"], hours=2),
                b.course("BB", teachers=["T2"], students=["s1"], hours=2),
            ]
        ),
        dp2=b.cohort(courses=[b.course("D", teachers=["T1"], students=["s4"], hours=2)]),
    )
    dump = {
        "formatVersion": 1,
        "meta": {},
        "snapshot": wire_snapshot(snapshot),
        "greedy": {"placements": [], "diagnostics": {}},
        "objective": [],
    }
    path.write_text(json.dumps(dump))


def test_student_first_reproduces_the_poc_order_and_the_sidecar_echoes_the_policy(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    dump = tmp_path / "dump.json"
    output = tmp_path / "out" / "result.json"
    _write_micro_dump(dump)

    code = main(
        [
            "--input",
            str(dump),
            "--output",
            str(output),
            "--mode",
            "complete",
            "--policy",
            "student-first",
            "--stage-budget",
            "2",
            "--mode-a-budget",
            "5",
            "--workers",
            "1",
        ]
    )

    assert code == 0
    sidecar = json.loads((output.parent / "result.report.json").read_text())
    assert sidecar["config"]["policy"] == "student-first"
    assert [stage["name"] for stage in sidecar["stages"]][:5] == [
        "completeness",
        "holes",
        "studentHoles",
        "totalSlots",
        "teacherHoles",
    ]
    assert sidecar["notes"]["clean_fallback"] is False, "student-first holds softHits at the floor"
    assert set(json.loads(output.read_text())) == {"placements", "diagnostics"}
    printed = capsys.readouterr().out.splitlines()
    assert "studentHoles" in printed[3] and "totalSlots" in printed[4], "the summary prints the walked order"


def test_the_cli_default_is_canonical_not_the_services_clean(tmp_path: Path) -> None:
    """Byte-for-byte what the CLI did before it had the flag, so the recorded goldens' recipe
    (`contracts/README.md` §Regeneration) still reproduces. The service defaults to clean."""
    args = _parse_args(["--input", "x", "--output", "y", "--mode", "complete"])
    assert args.policy == "canonical"

    dump = tmp_path / "dump.json"
    output = tmp_path / "result.json"
    _write_micro_dump(dump)
    main(["--input", str(dump), "--output", str(output), "--mode", "complete", "--stage-budget", "1"])

    sidecar = json.loads((tmp_path / "result.report.json").read_text())
    assert sidecar["config"]["policy"] == "canonical"
    assert "clean_fallback" not in sidecar["notes"], "canonical never requested clean mode"
    assert [stage["tier"] for stage in sidecar["stages"]] == list(range(1, 11))


def test_an_unknown_policy_is_refused_by_argparse() -> None:
    with pytest.raises(SystemExit):
        _parse_args(["--input", "x", "--output", "y", "--mode", "complete", "--policy", "fastest"])
