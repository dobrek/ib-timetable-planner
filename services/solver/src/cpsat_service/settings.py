"""The container's environment, read once at import.

Exactly the three values `docs/runbooks/solver-credential.md` says the container holds — project
URL, PUBLISHABLE key, machine password — plus two knobs with defaults. **No secret key, no
service-role key, no JWT signing secret, ever**: a secret key cannot be scoped to a table or a role,
so handing one to the solver would give a component that only ever sees UUIDs a full read of every
student and teacher name in the database.

Missing Supabase configuration does NOT prevent startup. `/health` must answer on a bare container
(that is what a platform health probe hits before secrets are wired), so absence surfaces at the
first job instead — loudly, as a `SettingsError` in the service log.

The same rule binds the numeric and log-level knobs: a MALFORMED value degrades to its default with
a complaint on stderr rather than raising. This module is read at import, before `basicConfig` has
run, so stderr — not `logging` — is the only channel that exists here; and a container that refuses
to start over `SOLVER_WORKERS=eight` fails a health probe that would otherwise have passed.
"""

from __future__ import annotations

import logging
import os
import sys
from collections.abc import Mapping
from dataclasses import dataclass, field

DEFAULT_MACHINE_EMAIL = "solver@ib-timetable-planner.dev"

# Pinned, never 0/auto. CP-SAT's search is only reproducible for a fixed worker count, and a
# container that silently solves with a different parallelism than the machine it was calibrated on
# produces a different — equally legal — board. Overridable per deployment, not per request.
DEFAULT_WORKERS = 8

# How many solves may run at once. One, because one solve already claims `DEFAULT_WORKERS` CP-SAT
# workers for as long as the tier ladder runs (~21 minutes at the engine's default budgets): a second
# concurrent solve does not halve the wall clock, it doubles both and starves `/health` — whose
# answerability under load is the whole argument for running the solve on a plain thread. Raise it
# per deployment when the container is sized for it; the cap exists so a burst of dispatches is
# REFUSED (503) rather than silently accepted and then thrashed.
DEFAULT_MAX_CONCURRENT_JOBS = 1

# INFO, not WARNING. The database row is the only status channel a CLIENT has, but the service log
# is the only channel for everything that happens BESIDE the row — a lost compare-and-set, a
# sign-in failure that leaves the row `queued` with nothing writable. Those are documented as
# "loud", so the default level has to make them so.
DEFAULT_LOG_LEVEL = "INFO"

# Which ladder tiers `SOLVER_STAGE_TARGETS` may address. Tier 1 is excluded because it is not a
# minimisation the ladder runs: Mode A's tier 1 is a satisfiability solve with no objective at all,
# and the full ladder's MAXIMISES, so a "stop at or below" target reads backwards for both.
TARGETABLE_TIERS = range(2, 11)


class SettingsError(RuntimeError):
    """The container is missing configuration it needs to reach the database."""


@dataclass(frozen=True)
class Settings:
    """What the container was configured with. Frozen: nothing rewrites it at runtime."""

    supabase_url: str
    supabase_key: str
    machine_email: str
    machine_password: str
    workers: int
    max_concurrent_jobs: int
    log_level: str
    # Tier number -> the objective value at or below which that stage stops early. Empty by default,
    # and empty means exactly today's behaviour: every stage burns its budget. Production VALUES are
    # S-308's to measure and ship; this knob is what makes measuring them possible.
    stage_targets: Mapping[int, int] = field(default_factory=dict)

    @property
    def configured(self) -> bool:
        """Whether the database-reaching values are all present (mirrors the app's env gating)."""
        return bool(self.supabase_url and self.supabase_key and self.machine_password)

    def require_configured(self) -> None:
        """Raise naming every missing variable — one message, not one failure per lookup."""
        missing = [
            name
            for name, value in (
                ("SUPABASE_URL", self.supabase_url),
                ("SUPABASE_KEY", self.supabase_key),
                ("SOLVER_MACHINE_PASSWORD", self.machine_password),
            )
            if not value
        ]
        if missing:
            raise SettingsError(f"solver service is not configured: missing {', '.join(missing)}")


def load_settings() -> Settings:
    """Read the environment. Called once at import by :data:`settings`; call again in a test."""
    return Settings(
        supabase_url=os.environ.get("SUPABASE_URL", "").rstrip("/"),
        supabase_key=os.environ.get("SUPABASE_KEY", ""),
        machine_email=os.environ.get("SOLVER_MACHINE_EMAIL", DEFAULT_MACHINE_EMAIL),
        machine_password=os.environ.get("SOLVER_MACHINE_PASSWORD", ""),
        workers=_positive_int("SOLVER_WORKERS", DEFAULT_WORKERS),
        max_concurrent_jobs=_positive_int("SOLVER_MAX_CONCURRENT_JOBS", DEFAULT_MAX_CONCURRENT_JOBS),
        log_level=_log_level(),
        stage_targets=_stage_targets(),
    )


def _stage_targets() -> dict[int, int]:
    """Parse ``SOLVER_STAGE_TARGETS`` — ``tier=value[,tier=value...]``, e.g. ``3=95,6=900``.

    Degrades entry by entry, per this module's rule: one malformed pair is dropped with a complaint
    on stderr and the rest of the map still loads. A target is a TUNING knob, and losing one tuning
    value is never worth refusing to start a container whose `/health` would otherwise answer.
    """
    raw = os.environ.get("SOLVER_STAGE_TARGETS", "").strip()
    if not raw:
        return {}
    targets: dict[int, int] = {}
    for entry in raw.split(","):
        parsed = _stage_target_entry(entry.strip())
        if parsed is not None:
            targets[parsed[0]] = parsed[1]
    return targets


def _stage_target_entry(entry: str) -> tuple[int, int] | None:
    """One ``tier=value`` pair, or None with a complaint naming what was wrong with it."""
    if not entry:
        return None
    tier_text, sep, value_text = entry.partition("=")
    if not sep:
        print(f"SOLVER_STAGE_TARGETS entry {entry!r} is not tier=value — ignoring it", file=sys.stderr)
        return None
    try:
        tier, value = int(tier_text), int(value_text)
    except ValueError:
        message = f"SOLVER_STAGE_TARGETS entry {entry!r} is not a pair of integers — ignoring it"
        print(message, file=sys.stderr)
        return None
    if tier not in TARGETABLE_TIERS:
        print(
            f"SOLVER_STAGE_TARGETS tier {tier} is outside {TARGETABLE_TIERS.start}-"
            f"{TARGETABLE_TIERS.stop - 1} — ignoring it",
            file=sys.stderr,
        )
        return None
    return tier, value


def _positive_int(name: str, default: int) -> int:
    """Read a knob, and DEGRADE rather than crash on a bad one.

    These are read at import, so a raw `int()` on `SOLVER_WORKERS=eight` would kill the process
    before `/health` ever binds — the opposite of this module's whole promise. Values below 1 are
    floored for the same reason `DEFAULT_WORKERS` exists: `0` means "auto" to CP-SAT, which is the
    one thing the reproducibility rule forbids.
    """
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        print(f"{name}={raw!r} is not an integer — falling back to {default}", file=sys.stderr)
        return default
    if value < 1:
        print(f"{name}={value} is below 1 — falling back to {default}", file=sys.stderr)
        return default
    return value


def _log_level() -> str:
    """An unknown level would make `logging.basicConfig` raise at import, for a cosmetic knob."""
    level = os.environ.get("SOLVER_LOG_LEVEL", DEFAULT_LOG_LEVEL).upper()
    if level not in logging.getLevelNamesMapping():
        message = f"SOLVER_LOG_LEVEL={level!r} is not a level — falling back to {DEFAULT_LOG_LEVEL}"
        print(message, file=sys.stderr)
        return DEFAULT_LOG_LEVEL
    return level


settings = load_settings()
