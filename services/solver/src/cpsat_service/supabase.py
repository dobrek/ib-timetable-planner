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

import base64
import json
import logging
import time
from datetime import UTC, datetime
from typing import Any, Final

import httpx

from .settings import Settings

log = logging.getLogger("cpsat_service.supabase")

# Re-sign-in this long after the last grant. Comfortably inside the 3600s `jwt_expiry`, so a write
# never races the boundary: the alternative is discovering expiry as a 401 mid-solve, after the
# result exists but before it is durable.
TOKEN_MAX_AGE_S = 3000.0

JOBS = "/rest/v1/generation_jobs"

# The TERMINAL write is the only durable record a solve produces, and it is the one call whose
# failure is unrecoverable: `claim`'s `status=eq.queued` filter means a row left `running` can never
# be reclaimed, so a transient 502 at minute twelve discards the board permanently. Hence a retry
# here and nowhere else — `claim` failing is safe (the row is untouched and a redispatch works) and
# `sign_in` failing is reported by whichever call needed it.
FINISH_ATTEMPTS = 3
FINISH_BACKOFF_S = (1.0, 4.0)

# Only failures a second attempt could plausibly survive. A `42501` (wrote outside the grant), a
# `23514` (status the CHECK rejects) and a matched-no-row write are all deterministic: retrying them
# just delays the log line that matters.
RETRYABLE_STATUS = frozenset({500, 502, 503, 504})

# The narrow Postgres role the Custom Access Token Hook mints for the machine user. Asserted on
# every grant because this is the one misconfiguration that fails *upward*: with the hook disabled,
# GoTrue quietly issues `role: authenticated`, which `alter default privileges` has granted DML on
# every current and future public table. Nothing looks broken — the container connects, claims its
# row and solves — while holding a full read of every student and teacher name in the database.
REQUIRED_ROLE: Final = "solver_job_writer"


class SupabaseError(RuntimeError):
    """A non-2xx from Auth or PostgREST. The message carries the status and the body verbatim.

    `status_code` is None when the failure was not an HTTP status at all — the matched-no-row case
    in :meth:`JobRowClient.finish` — which is also what makes it non-retryable.
    """

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class RoleClaimError(SupabaseError):
    """The access token does not carry :data:`REQUIRED_ROLE`, so this container refuses to use it.

    A `SupabaseError` subclass so the existing handling applies unchanged: `status_code` stays None,
    which is exactly what makes it non-retryable — a wrong role is a rule about configuration, not a
    blip a second attempt could survive.
    """


def assert_role(token: str) -> None:
    """Refuse an access token whose `role` claim is not :data:`REQUIRED_ROLE`.

    The payload segment is base64url-decoded and read; the **signature is deliberately not
    verified**. This guards against MISCONFIGURATION (a hook that is off), not forgery — the token
    was just minted by Auth over the wire this client owns, and verifying it would mean holding the
    JWT signing secret, which `settings.py` documents as the one thing this container must never
    have.
    """
    claims = _decode_claims(token)
    role = claims.get("role")
    if role != REQUIRED_ROLE:
        raise RoleClaimError(
            f"the access token carries role={role!r}, not {REQUIRED_ROLE!r} — the Custom Access "
            "Token Hook is not enabled on this project, so Auth fell back to a role that reaches "
            "every table. Enable it and re-verify the claim before pointing this container at the "
            "database: docs/runbooks/solver-credential.md § Hosted enablement."
        )


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
        out (or absent). Never the refresh grant — see the module docstring.

        Every freshly minted token is role-asserted BEFORE it is cached, so a hook switched off
        mid-life fails closed on the next re-mint rather than silently widening the container's
        reach. `app.py`'s lifespan runs the same assertion once at boot, which is the *visible*
        half: a failure there stops the container from ever binding its port.
        """
        if self._token is not None and time.monotonic() - self._token_minted_at < TOKEN_MAX_AGE_S:
            return self._token
        response = self._client.post(
            "/auth/v1/token",
            params={"grant_type": "password"},
            headers={"apikey": self._settings.supabase_key, "Content-Type": "application/json"},
            json={"email": self._settings.machine_email, "password": self._settings.machine_password},
        )
        _raise_for_status(response, "sign in as the machine user")
        token = str(response.json()["access_token"])
        assert_role(token)
        self._token = token
        self._token_minted_at = time.monotonic()
        return token

    def claim(self, job_id: str) -> dict[str, Any] | None:
        """Compare-and-set `queued -> running`. The claimed row iff THIS call claimed it, else None.

        The `status=eq.queued` filter is the durable half of the idempotency guard (research R10):
        the in-process registry cannot survive a container restart, and RLS cannot help here because
        its `with check` window permits `running -> running`. So the filter — not the policy, and
        not the registry — is what stops a retried dispatch from starting a second solve.

        `return=representation` with a narrow projection is what makes the affected-row count
        observable at all: an empty array means another worker already had it.

        `snapshot_hash` rides along in that same projection rather than costing a second round trip
        — the role's SELECT is column-scoped to exactly `id, status, snapshot_hash` (migration
        20260812141459), so this projection names precisely what the grant allows, and the column is
        a 64-char digest, not one of the TOASTed payloads kept off the wire. The runner binds the
        dispatched body to it before solving.
        """
        now = _utc_now()
        response = self._client.patch(
            JOBS,
            params={"id": f"eq.{job_id}", "status": "eq.queued", "select": "id,snapshot_hash"},
            headers={**self._headers(), "Prefer": "return=representation"},
            json={"status": "running", "started_at": now, "heartbeat_at": now},
        )
        _raise_for_status(response, f"claim job {job_id}")
        rows: list[dict[str, Any]] = response.json()
        return rows[0] if rows else None

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
        a failure never blanks a column it has nothing to say about.

        Retried on transient failures — see :data:`FINISH_ATTEMPTS`.
        """
        payload: dict[str, Any] = {"status": status, "finished_at": _utc_now()}
        if result is not None:
            payload["result"] = result
        if error is not None:
            payload["error"] = error
        if stages is not None:
            payload["stages"] = stages
        self._finish_with_retry(job_id, status, payload)

    def close(self) -> None:
        self._client.close()

    def _headers(self) -> dict[str, str]:
        return {
            "apikey": self._settings.supabase_key,
            "Authorization": f"Bearer {self.sign_in()}",
            "Content-Type": "application/json",
        }

    def _finish_with_retry(self, job_id: str, status: str, payload: dict[str, Any]) -> None:
        """Attempt the terminal write until it lands, the failure proves deterministic, or attempts
        run out. The last failure propagates unchanged — the caller logs it and the row is stuck."""
        for attempt in range(1, FINISH_ATTEMPTS + 1):
            try:
                self._finish_once(job_id, status, payload)
            except (SupabaseError, httpx.TransportError) as error:
                if attempt == FINISH_ATTEMPTS or not _is_retryable(error):
                    raise
                delay = FINISH_BACKOFF_S[attempt - 1]
                log.warning(
                    "job %s: terminal write attempt %d/%d failed, retrying in %.0fs: %s",
                    job_id,
                    attempt,
                    FINISH_ATTEMPTS,
                    delay,
                    error,
                )
                time.sleep(delay)
            else:
                return

    def _finish_once(self, job_id: str, status: str, payload: dict[str, Any]) -> None:
        """`return=representation` for the same reason `claim` uses it, and it matters more here:
        this PATCH carries no status filter, so PostgREST's default `return=minimal` answers 204
        whether it matched the row or nothing at all. A terminal write that matched NOTHING — the
        row was moved out of the RLS `using (status in ('queued','running'))` window by someone else
        — would otherwise be indistinguishable from success, and a twelve-minute board would be
        logged as stored while never reaching the column."""
        response = self._client.patch(
            JOBS,
            params={"id": f"eq.{job_id}", "select": "id"},
            headers={**self._headers(), "Prefer": "return=representation"},
            json=payload,
        )
        _raise_for_status(response, f"finish job {job_id} as {status}")
        if not response.json():
            raise SupabaseError(
                f"could not finish job {job_id} as {status}: the write matched no row — it is no "
                "longer in a state this role may update"
            )


def _decode_claims(token: str) -> dict[str, Any]:
    """The JWT's middle segment as a claims mapping.

    Padding is re-added by hand because Auth strips it: base64url in a JWT is unpadded, and
    `b64decode` insists on a multiple of four.
    """
    segments = token.split(".")
    if len(segments) != 3:
        raise RoleClaimError(f"the access token is not a JWT — {len(segments)} segment(s), expected 3")
    payload = segments[1]
    try:
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except ValueError as error:
        # `binascii.Error` (bad base64) and `JSONDecodeError` are both ValueError subclasses.
        raise RoleClaimError(f"the access token's payload segment is not decodable JSON: {error}") from error
    if not isinstance(claims, dict):
        raise RoleClaimError(f"the access token's payload decoded to {type(claims).__name__}, not an object")
    return claims


def _raise_for_status(response: httpx.Response, action: str) -> None:
    """PostgREST puts the diagnosable part (`code`, `message`, `hint`) in the BODY, not the status —
    a bare `raise_for_status()` would throw away exactly what makes `42501` vs `23514` legible."""
    if response.is_success:
        return
    raise SupabaseError(
        f"could not {action}: HTTP {response.status_code} {response.text}",
        status_code=response.status_code,
    )


def _is_retryable(error: SupabaseError | httpx.TransportError) -> bool:
    """A connection that never landed, or a 5xx from the edge — not a rule the database enforced."""
    if isinstance(error, httpx.TransportError):
        return True
    return error.status_code in RETRYABLE_STATUS


def _utc_now() -> str:
    """An ISO-8601 UTC instant for a `timestamptz` column."""
    return datetime.now(UTC).isoformat()
