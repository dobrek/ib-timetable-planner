"""The fake Supabase the wrapper-level suites drive `run_job` against — shared, not owned by one suite.

Only the outbound Supabase HTTP is swapped, for an `httpx.MockTransport`: low enough that assertions
see the ACTUAL PostgREST requests, high enough that no database is needed. `test_service.py` pins the
wrapper's database conversation through it; `test_baseline.py` rides the same production entry point
(S-309) so the regression baseline solves exactly the way a dispatched job does.
"""

from __future__ import annotations

import base64
import json
import threading
from typing import Any

import httpx

from cpsat_engine.schema import parse_snapshot
from cpsat_engine.wire import snapshot_hash
from cpsat_service.registry import JobRegistry
from cpsat_service.runner import run_job
from cpsat_service.settings import Settings
from cpsat_service.supabase import REQUIRED_ROLE, JobRowClient

JOB_ID = "3f1a8c22-0b7e-4c8e-9a1d-2f6b5e4d3c21"


def unsigned_jwt(claims: dict[str, Any]) -> str:
    """A JWT-SHAPED token: header.payload.signature, unsigned.

    `assert_role` reads the payload and deliberately does not verify the signature — it guards
    against a hook that is switched off, not against forgery — so an unsigned token is a faithful
    stand-in for what Auth returns, and the suite never needs a signing secret the container is
    forbidden to hold.
    """

    def segment(part: dict[str, Any]) -> str:
        raw = json.dumps(part, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    return f"{segment({'alg': 'HS256', 'typ': 'JWT'})}.{segment(claims)}.signature-not-verified"


ACCESS_TOKEN = unsigned_jwt({"role": REQUIRED_ROLE, "sub": "machine-user"})

SETTINGS = Settings(
    supabase_url="https://stack.test",
    supabase_key="publishable-test-key",
    machine_email="solver@ib-timetable-planner.dev",
    machine_password="test-password",
    workers=1,
    max_concurrent_jobs=1,
    log_level="INFO",
)


# --- the recording transport ----------------------------------------------------------------------


class RecordedCall:
    """One outbound request, kept in a form the assertions can read without re-parsing httpx."""

    def __init__(self, request: httpx.Request) -> None:
        self.method = request.method
        self.path = request.url.path
        self.params = dict(request.url.params)
        self.headers = dict(request.headers)
        self.body: Any = json.loads(request.content) if request.content else None


class FakeSupabase:
    """An `httpx.MockTransport` standing in for Auth + PostgREST, recording every call.

    **Locked, because since S-304 two threads reach it**: the worker's client and the heartbeat
    timer's own. Without the lock `sign_in_count` is a lost-update race and the recorded call list
    interleaves non-deterministically — a flake that would look like a heartbeat bug.

    ``claimable`` False models the CAS losing: PostgREST answers 200 with an EMPTY array, which is
    exactly how "no row matched `status=eq.queued`" looks on the wire.

    ``snapshot_hash`` is the digest the claimed ROW carries. Left None, :func:`run_sync` fills it with
    the request's own digest so the binding passes — a test that wants a mismatch states one
    explicitly rather than every other test drifting through a hole in the guard.

    ``access_token`` is what the Auth grant answers with; it is mutable so a test can model the hook
    being switched off *between* two grants.
    """

    def __init__(
        self,
        *,
        claimable: bool = True,
        snapshot_hash: str | None = None,
        access_token: str = ACCESS_TOKEN,
        progress_response: httpx.Response | Exception | None = None,
        solver_config_response: httpx.Response | None = None,
        stop_requested_after: int | None = None,
    ) -> None:
        self._lock = threading.Lock()
        self.calls: list[RecordedCall] = []
        self.claimable = claimable
        self.snapshot_hash = snapshot_hash
        self.access_token = access_token
        self.sign_in_count = 0
        #: What a `running -> running` write answers with. A response models the edge failing or the
        #: row having moved on; an exception models the connection never landing.
        self.progress_response = progress_response
        #: What a `running -> running` write CARRYING `solver_config` answers with — the column
        #: rejected (a missing grant, a schema without the column) while every other write lands.
        self.solver_config_response = solver_config_response
        #: How many `running -> running` writes answer a null `stop_requested_at` before the column
        #: comes back set — the author pressing Stop & keep mid-solve, seen from the wire. None
        #: leaves it null forever, which is every test that does not model a stop request.
        self.stop_requested_after = stop_requested_after
        self.progress_count = 0

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def client_factory(self, settings: Settings) -> JobRowClient:
        http = httpx.Client(base_url=settings.supabase_url, transport=self.transport())
        return JobRowClient(settings, client=http)

    def patches(self) -> list[RecordedCall]:
        return [call for call in self.calls if call.method == "PATCH"]

    def claim_patch(self) -> RecordedCall:
        """The CAS. Read by ROLE — its `status=eq.queued` filter — not by position: since S-303 a
        run interleaves two progress PATCHes per ladder stage between the claim and the finish, so
        `patches()[0]`/`[1]` would silently start asserting about a different write."""
        return self._by_role("eq.queued")

    def progress_patches(self) -> list[RecordedCall]:
        """The `running -> running` writes, in order."""
        return [call for call in self.patches() if call.params.get("status") == "eq.running"]

    def config_patches(self) -> list[RecordedCall]:
        """The progress writes that record the run's configuration, in order."""
        return [call for call in self.progress_patches() if "solver_config" in call.body]

    def finish_patch(self) -> RecordedCall:
        """The terminal write — the only PATCH that carries no status filter at all, because RLS,
        not a filter, is what bounds which transitions it may make."""
        return self._by_role(None)

    def _by_role(self, status_filter: str | None) -> RecordedCall:
        matched = [call for call in self.patches() if call.params.get("status") == status_filter]
        assert len(matched) == 1, (
            f"expected exactly one PATCH with status={status_filter!r}, got {len(matched)}"
        )
        return matched[0]

    def _handle(self, request: httpx.Request) -> httpx.Response:
        with self._lock:
            call = RecordedCall(request)
            self.calls.append(call)
            if call.path == "/auth/v1/token":
                self.sign_in_count += 1
                return httpx.Response(200, json={"access_token": self.access_token, "token_type": "bearer"})
            if call.path == "/rest/v1/generation_jobs":
                carries_config = isinstance(call.body, dict) and "solver_config" in call.body
                if carries_config and self.solver_config_response is not None:
                    return self.solver_config_response
                if call.params.get("status") == "eq.running" and self.progress_response is not None:
                    if isinstance(self.progress_response, Exception):
                        raise self.progress_response
                    return self.progress_response
                claiming = call.params.get("status") == "eq.queued"
                claimed = {"id": JOB_ID, "snapshot_hash": self.snapshot_hash}
                row = claimed if claiming else self._progress_row()
                rows = [row] if (self.claimable or not claiming) else []
                return httpx.Response(200, json=rows)
            return httpx.Response(404, json={"message": f"unexpected path {call.path}"})

    def _progress_row(self) -> dict[str, Any]:
        """What a `running -> running` write reads back: the widened projection, with the stop flag
        appearing once the configured number of writes has gone by. Called under `_handle`'s lock,
        which is what makes the counter safe against the heartbeat thread."""
        self.progress_count += 1
        requested = self.stop_requested_after is not None and self.progress_count > self.stop_requested_after
        return {"id": JOB_ID, "stop_requested_at": "2026-09-01T12:00:00+00:00" if requested else None}


# --- running the worker -----------------------------------------------------------------------------


def run_sync(request: dict[str, Any], fake: FakeSupabase) -> JobRegistry:
    """Run the worker SYNCHRONOUSLY (no thread) so a test asserts on a finished state rather than
    on a sleep."""
    registry = JobRegistry()
    registry.register(JOB_ID)
    run_sync_registered(request, fake, registry)
    return registry


def run_sync_registered(
    request: dict[str, Any],
    fake: FakeSupabase,
    registry: JobRegistry,
    *,
    settings: Settings = SETTINGS,
) -> None:
    """:func:`run_sync` against a registry the test still holds — so it can fire the stop latch.

    The row's `snapshot_hash` defaults to this request's own digest, matching the app's enqueue: the
    binding is under test in its own two cases, not incidentally in every other one.
    """
    if fake.snapshot_hash is None:
        fake.snapshot_hash = snapshot_hash(parse_snapshot(request["snapshot"]))
    run_job(JOB_ID, request, settings=settings, registry=registry, client_factory=fake.client_factory)
