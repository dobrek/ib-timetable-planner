"""The job-row client: httpx against Auth and PostgREST, with exactly three operations.

No Supabase SDK. `docs/runbooks/solver-credential.md` settles that httpx alone is enough, and it
matters here beyond taste: the SDK would drag a second dependency resolution across the ortools
protobuf/numpy pins this venv exists to hold still.

Two operational rules from the runbook are encoded here rather than merely documented:

* **Password grant only, never refresh.** `jwt_expiry` is 3600s so one token covers a solve, but a
  long run can still cross it. Near expiry this re-runs the PASSWORD grant. The password grant
  demonstrably fires the Custom Access Token Hook; whether the refresh grant does was never
  verified, and a refresh that silently returned an `authenticated` token would be the exact
  privilege escalation the whole credential design exists to prevent.
* **Narrow column projections on every request.** `snapshot` is ~124 KB and TOASTed; PostgREST's
  bare `select` returns every column, so an unprojected request would drag it across the wire each
  time. Every call below names its columns.

Known failure codes, surfaced verbatim in the raised message so a log line is diagnosable:
`42501` = wrote outside the 11-column grant, `23514` = a status the CHECK constraint rejects.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any

import httpx

from .settings import Settings

# Re-sign-in this long after the last grant. Comfortably inside the 3600s `jwt_expiry`, so a write
# never races the boundary: the alternative is discovering expiry as a 401 mid-solve, after the
# result exists but before it is durable.
TOKEN_MAX_AGE_S = 3000.0

JOBS = "/rest/v1/generation_jobs"


class SupabaseError(RuntimeError):
    """A non-2xx from Auth or PostgREST. The message carries the status and the body verbatim."""


class JobRowClient:
    """Sign in as the machine user and advance one job row. Not thread-safe by design — the runner
    owns one instance per job, on the thread that solves it."""

    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        settings.require_configured()
        self._settings = settings
        self._client = client or httpx.Client(base_url=settings.supabase_url, timeout=30.0)
        self._token: str | None = None
        self._token_minted_at = 0.0

    def sign_in(self) -> str:
        """Return a live access token, re-running the PASSWORD grant when the current one is aged
        out (or absent). Never the refresh grant — see the module docstring."""
        if self._token is not None and time.monotonic() - self._token_minted_at < TOKEN_MAX_AGE_S:
            return self._token
        response = self._client.post(
            "/auth/v1/token",
            params={"grant_type": "password"},
            headers={"apikey": self._settings.supabase_key, "Content-Type": "application/json"},
            json={"email": self._settings.machine_email, "password": self._settings.machine_password},
        )
        _raise_for_status(response, "sign in as the machine user")
        self._token = str(response.json()["access_token"])
        self._token_minted_at = time.monotonic()
        return self._token

    def claim(self, job_id: str) -> bool:
        """Compare-and-set `queued -> running`. True iff THIS call is the one that claimed it.

        The `status=eq.queued` filter is the durable half of the idempotency guard (research R10):
        the in-process registry cannot survive a container restart, and RLS cannot help here because
        its `with check` window permits `running -> running`. So the filter — not the policy, and
        not the registry — is what stops a retried dispatch from starting a second solve.

        `return=representation` with a `select=id` projection is what makes the affected-row count
        observable at all: an empty array means another worker already had it.
        """
        now = _utc_now()
        response = self._client.patch(
            JOBS,
            params={"id": f"eq.{job_id}", "status": "eq.queued", "select": "id"},
            headers={**self._headers(), "Prefer": "return=representation"},
            json={"status": "running", "started_at": now, "heartbeat_at": now},
        )
        _raise_for_status(response, f"claim job {job_id}")
        return len(response.json()) > 0

    def finish(
        self,
        job_id: str,
        *,
        status: str,
        result: dict[str, Any] | None = None,
        error: str | None = None,
        stages: list[dict[str, Any]] | None = None,
    ) -> None:
        """Write the terminal state. Only the granted columns; absent fields are simply not sent, so
        a failure never blanks a column it has nothing to say about."""
        payload: dict[str, Any] = {"status": status, "finished_at": _utc_now()}
        if result is not None:
            payload["result"] = result
        if error is not None:
            payload["error"] = error
        if stages is not None:
            payload["stages"] = stages
        response = self._client.patch(
            JOBS,
            params={"id": f"eq.{job_id}", "select": "id"},
            headers=self._headers(),
            json=payload,
        )
        _raise_for_status(response, f"finish job {job_id} as {status}")

    def close(self) -> None:
        self._client.close()

    def _headers(self) -> dict[str, str]:
        return {
            "apikey": self._settings.supabase_key,
            "Authorization": f"Bearer {self.sign_in()}",
            "Content-Type": "application/json",
        }


def _raise_for_status(response: httpx.Response, action: str) -> None:
    """PostgREST puts the diagnosable part (`code`, `message`, `hint`) in the BODY, not the status —
    a bare `raise_for_status()` would throw away exactly what makes `42501` vs `23514` legible."""
    if response.is_success:
        return
    raise SupabaseError(f"could not {action}: HTTP {response.status_code} {response.text}")


def _utc_now() -> str:
    """An ISO-8601 UTC instant for a `timestamptz` column."""
    return datetime.now(UTC).isoformat()
