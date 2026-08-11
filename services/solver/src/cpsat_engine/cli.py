"""File-transport CLI: ``cpsat --input dump.json --output result.json --mode …``.

The only throwaway part of the POC — a thin wrapper over ``solve``. Kept separate so the package
stays transport-agnostic: a future service wraps ``solve`` in HTTP without touching this file. It
writes three artifacts beside ``--output``: the ``GenerationResult`` JSON (the TS import contract),
a ``.report.json`` sidecar (config echo + per-stage report, for reproducibility), and per-stage
solver logs under ``<output-stem>-logs/``.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from .explain import explain_infeasibility
from .model import PreconditionError
from .schema import load_dump
from .solve import (
    SolveConfig,
    SolveResult,
    parity,
    solve_complete,
    solve_repair,
    solve_staged,
    to_generation_result,
)

_SOLVERS = {"full": solve_staged, "complete": solve_complete, "repair": solve_repair}


def main(argv: list[str] | None = None) -> int:
    """Console entry point. Returns a process exit code (0 ok, 1 on error or parity mismatch)."""
    args = _parse_args(argv)
    try:
        dump = load_dump(args.input)
    except (OSError, ValueError) as error:
        print(f"cpsat: could not read dump {args.input}: {error}", file=sys.stderr)
        return 1

    try:
        if args.mode == "parity":
            return _run_parity(dump, args)
        return _run_solve(dump, args)
    except PreconditionError as error:
        print(f"cpsat: the pinned board already violates a hard rule: {error}", file=sys.stderr)
        return 1


def _run_parity(dump, args) -> int:
    report = parity(dump)
    payload = {
        "mode": "parity",
        "ok": report.ok,
        "computed": list(report.computed),
        "expected": list(report.expected),
        "tiers": [{"name": t.name, "computed": t.computed, "expected": t.expected} for t in report.tiers],
    }
    _write_json(_sidecar_path(args.output), payload)
    status = "OK — 10/10 tiers match" if report.ok else f"MISMATCH: {[t.name for t in report.mismatches()]}"
    print(f"parity {status}")
    return 0 if report.ok else 1


def _run_solve(dump, args) -> int:
    config = _config(args)
    result: SolveResult = _SOLVERS[args.mode](dump, config)

    _write_json(Path(args.output), to_generation_result(dump, result))
    sidecar = _report(args, result)
    if result.notes.get("outcome") == "infeasible":
        sidecar["explain"] = _explain(dump, config)
    _write_json(_sidecar_path(args.output), sidecar)

    _print_summary(args, result)
    return 0


def _explain(dump, config: SolveConfig) -> dict:
    report = explain_infeasibility(dump, budget_s=config.mode_a_budget_s, seed=config.seed)
    return {
        "conflict": ["/".join(key) for key in report.conflict],
        "droppable": ["/".join(key) for key in report.droppable],
        "completableCount": len(report.completable),
    }


def _report(args, result: SolveResult) -> dict:
    return {
        "mode": result.mode,
        "config": _config_echo(args),
        "outcome": result.notes.get("outcome", result.mode),
        "provenOptimal": result.proven_optimal,
        "elapsedMs": round(result.elapsed_s * 1000),
        "notes": result.notes,
        "stages": [asdict(stage) for stage in result.stages],
    }


def _print_summary(args, result: SolveResult) -> None:
    print(f"mode={result.mode} outcome={result.notes.get('outcome', result.mode)} rows={len(result.board)}")
    for stage in result.stages:
        best = "-" if stage.best is None else stage.best
        print(
            f"  t{stage.tier:>2} {stage.name:<18} {stage.status:<10} best={best} {stage.wall_clock_s:5.1f}s"
        )
    print(f"wrote {args.output} (+ {_sidecar_path(args.output).name}, logs in {_log_dir(args.output).name}/)")


# --- config & argument plumbing -------------------------------------------------------------------


def _config(args) -> SolveConfig:
    return SolveConfig(
        stage_budget_s=args.stage_budget,
        mode_a_budget_s=args.mode_a_budget,
        repair_budget_s=args.repair_budget,
        seed=args.seed,
        workers=args.workers,
        hops=args.hops,
        log_dir=_log_dir(args.output),
    )


def _config_echo(args) -> dict:
    return {
        "mode": args.mode,
        "stageBudgetS": args.stage_budget,
        "modeABudgetS": args.mode_a_budget,
        "repairBudgetS": args.repair_budget,
        "seed": args.seed,
        "workers": args.workers,
        "hops": args.hops,
    }


def _sidecar_path(output: str) -> Path:
    path = Path(output)
    return path.with_name(f"{path.stem}.report.json")


def _log_dir(output: str) -> Path:
    path = Path(output)
    return path.with_name(f"{path.stem}-logs")


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2))


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="cpsat", description="CP-SAT timetable solver (file transport).")
    parser.add_argument("--input", required=True, help="path to the export dump JSON")
    parser.add_argument("--output", required=True, help="path to write the GenerationResult JSON")
    parser.add_argument("--mode", required=True, choices=["parity", "complete", "full", "repair"])
    parser.add_argument("--stage-budget", type=float, default=120.0, dest="stage_budget")
    parser.add_argument("--mode-a-budget", type=float, default=300.0, dest="mode_a_budget")
    parser.add_argument("--repair-budget", type=float, default=30.0, dest="repair_budget")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--workers", type=int, default=0, help="0 = auto (CP-SAT picks)")
    parser.add_argument("--hops", type=int, default=1, help="repair neighbourhood radius")
    return parser.parse_args(argv)


if __name__ == "__main__":
    raise SystemExit(main())
