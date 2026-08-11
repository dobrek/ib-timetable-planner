"""The container's environment, read once at import.

Exactly the three values `docs/runbooks/solver-credential.md` says the container holds — project
URL, PUBLISHABLE key, machine password — plus two knobs with defaults. **No secret key, no
service-role key, no JWT signing secret, ever**: a secret key cannot be scoped to a table or a role,
so handing one to the solver would give a component that only ever sees UUIDs a full read of every
student and teacher name in the database.

Missing Supabase configuration does NOT prevent startup. `/health` must answer on a bare container
(that is what a platform health probe hits before secrets are wired), so absence surfaces at the
first job instead — loudly, as a `SettingsError` in the service log.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_MACHINE_EMAIL = "solver@ib-timetable-planner.dev"

# Pinned, never 0/auto. CP-SAT's search is only reproducible for a fixed worker count, and a
# container that silently solves with a different parallelism than the machine it was calibrated on
# produces a different — equally legal — board. Overridable per deployment, not per request.
DEFAULT_WORKERS = 8

# INFO, not WARNING. The database row is the only status channel a CLIENT has, but the service log
# is the only channel for everything that happens BESIDE the row — a lost compare-and-set, a
# sign-in failure that leaves the row `queued` with nothing writable. Those are documented as
# "loud", so the default level has to make them so.
DEFAULT_LOG_LEVEL = "INFO"


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
    log_level: str

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
        workers=int(os.environ.get("SOLVER_WORKERS", DEFAULT_WORKERS)),
        log_level=os.environ.get("SOLVER_LOG_LEVEL", DEFAULT_LOG_LEVEL),
    )


settings = load_settings()
