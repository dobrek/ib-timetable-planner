"""The container's environment, read once at import.

Exactly the three values `docs/runbooks/solver-credential.md` says the container holds — project
URL, PUBLISHABLE key, machine password — plus the tuning knobs, every one of them defaulted so an
unset environment is a fully working one. **No secret key, no
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
# workers for as long as the tier ladder runs (~23 minutes at the engine's default budgets — 300 s of
# Mode A plus 9 × 120 s, or ~28 when the clean-mode infeasibility fallback spends a second Mode A
# budget the tier-1 transcript never shows): a second concurrent solve does not halve the wall clock,
# it doubles both and starves `/health` — whose
# answerability under load is the whole argument for running the solve on a plain thread. Raise it
# per deployment when the container is sized for it; the cap exists so a burst of dispatches is
# REFUSED (503) rather than silently accepted and then thrashed.
DEFAULT_MAX_CONCURRENT_JOBS = 1

# INFO, not WARNING. The database row is the only status channel a CLIENT has, but the service log
# is the only channel for everything that happens BESIDE the row — a lost compare-and-set, a
# sign-in failure that leaves the row `queued` with nothing writable. Those are documented as
# "loud", so the default level has to make them so.
DEFAULT_LOG_LEVEL = "INFO"

# How often a running job renews `heartbeat_at` on its row. Fifteen seconds, because the grace the
# app reclaims a wedged row after is five minutes (`job-staleness.ts`): twenty missed beats is a
# margin wide enough that no healthy solve is ever mistaken for a dead one, while still making a
# hard-killed container detectable within seconds rather than the ~300 s a stage-only renewal takes.
# Not forwarded to the container — it is a default worth changing only in a test.
DEFAULT_HEARTBEAT_INTERVAL_S = 15.0

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
    # Seconds between the running job's `heartbeat_at` renewals (S-304). Defaulted so a test can
    # shrink it to milliseconds and assert on the timer without waiting on the real cadence.
    heartbeat_interval_s: float = DEFAULT_HEARTBEAT_INTERVAL_S
    # The ladder's time allowances, per stage and for Mode A (S-308). `None` is not "zero" and not a
    # number this module knows — it means "whatever `SolveConfig` defaults to", and `runner.py`
    # honours it by not passing the field at all. The literals stay in the engine, their single
    # source of truth; repeating them here would create a second one that drifts silently. Unlike
    # `stage_targets`, these are WALL CLOCK and therefore hardware-dependent: the values production
    # runs under are pinned on the Worker side (`src/solver-container-env.ts`) and measured there.
    stage_budget_s: float | None = None
    mode_a_budget_s: float | None = None

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
        heartbeat_interval_s=_positive_float("SOLVER_HEARTBEAT_INTERVAL_S", DEFAULT_HEARTBEAT_INTERVAL_S),
        stage_budget_s=_optional_positive_float("SOLVER_STAGE_BUDGET_S"),
        mode_a_budget_s=_optional_positive_float("SOLVER_MODE_A_BUDGET_S"),
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


def _positive_float(name: str, default: float) -> float:
    """:func:`_positive_int`'s rule for a duration: degrade, never crash, and never accept zero.

    Zero or negative would turn the heartbeat's `Event.wait(interval)` into a spin loop writing to
    PostgREST as fast as the network allows — a misconfiguration that costs a row, not a container.
    """
    parsed = _read_positive_float(name, str(default))
    return default if parsed is None else parsed


def _optional_positive_float(name: str) -> float | None:
    """The same rule where ABSENCE carries a meaning of its own: `None` says "the engine's default".

    A budget this module cannot name is a budget it cannot drift from. `runner.py` reads `None` as
    "do not pass the field", so an unconfigured container solves byte-for-byte as it did before the
    knob existed — the same neutrality guarantee `SOLVER_STAGE_TARGETS` ships under.
    """
    return _read_positive_float(name, "the engine default")


def _read_positive_float(name: str, fallback: str) -> float | None:
    """Parse a positive duration; `None` for unset, malformed, or non-positive — the latter two with
    a complaint naming `fallback`, whatever the caller is about to use instead."""
    raw = os.environ.get(name)
    if raw is None:
        return None
    try:
        value = float(raw)
    except ValueError:
        print(f"{name}={raw!r} is not a number — falling back to {fallback}", file=sys.stderr)
        return None
    if value <= 0:
        print(f"{name}={value} is not positive — falling back to {fallback}", file=sys.stderr)
        return None
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
