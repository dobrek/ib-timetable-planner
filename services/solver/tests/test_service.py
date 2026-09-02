"""Wrapper-level pins for the HTTP service — the surface FR-310 singles out.

The POC's recorded lesson was that `cli.py` never got test attention; this suite is the answer to
it. Everything here runs against the REAL app through `TestClient`, with only the outbound
Supabase HTTP swapped for an `httpx.MockTransport`. That boundary is deliberate: it is low enough
that the assertions see the ACTUAL PostgREST requests (the `status=eq.queued` CAS filter, the narrow
projections, the bearer header, the exact column payload) rather than a hand-rolled fake's idea of
them, and high enough that no database is needed — so the solver CI lane stays DB-free and fast.

Real RLS/grant/hook fidelity is not this suite's job and cannot be faked here; that is what the TS
`solver-transport.integration.test.ts` proof-of-life covers against the live stack.

Snapshots are tiny in-code builders so a whole solve finishes in milliseconds, with one test riding
the committed `contracts/fixtures/solve-request.json` so the known-valid body is actually exercised.
"""

from __future__ import annotations

import asyncio
import base64
import json
import threading
import time
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

import builders as b
from cpsat_engine.schema import Dump, parse_snapshot
from cpsat_engine.solve import SolveConfig, SolveResult, StageReport, solve_complete
from cpsat_engine.wire import snapshot_hash, wire_snapshot
from cpsat_service import app as app_module
from cpsat_service.registry import JobRegistry, Registration
from cpsat_service.runner import run_job, start_job
from cpsat_service.settings import Settings
from cpsat_service.supabase import (
    REQUIRED_ROLE,
    TOKEN_MAX_AGE_S,
    JobRowClient,
    RoleClaimError,
    SupabaseError,
)

SOLVE_REQUEST_GOLDEN = Path(__file__).resolve().parents[3] / "contracts" / "fixtures" / "solve-request.json"

JOB_ID = "3f1a8c22-0b7e-4c8e-9a1d-2f6b5e4d3c21"


def _jwt(claims: dict[str, Any]) -> str:
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


ACCESS_TOKEN = _jwt({"role": REQUIRED_ROLE, "sub": "machine-user"})

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

    ``snapshot_hash`` is the digest the claimed ROW carries. Left None, :func:`_run` fills it with the
    request's own digest so the binding passes — a test that wants a mismatch states one explicitly
    rather than every other test drifting through a hole in the guard.

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
        #: How many `running -> running` writes answer a null `stop_requested_at` before the column
        #: comes back set — the author pressing Stop & keep mid-solve, seen from the wire. None
        #: leaves it null forever, which is every other test in this file.
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


# --- fixtures ---------------------------------------------------------------------------------------


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """A fresh registry per test: it is module state on the app, and a leaked entry would make the
    next test's POST a silent no-op. Capacity mirrors production so the cap is under test, not
    bypassed by an uncapped fixture. The app also sees a CONFIGURED `Settings`: the process env is
    bare under pytest, and `solve` refuses work on a bare service — a test that wants that answer
    swaps in a bare `Settings` explicitly."""
    monkeypatch.setattr(app_module, "settings", SETTINGS)
    app_module.registry = JobRegistry(capacity=SETTINGS.max_concurrent_jobs)
    return TestClient(app_module.app)


def _micro_request(*, warm_start: bool = False) -> dict[str, Any]:
    """A two-course, one-teacher snapshot: complete-able, and solved in milliseconds."""
    snapshot = b.snapshot(
        dp1=b.cohort(courses=[b.course("a", teachers=["T1"], students=["s1"], hours=1)]),
        dp2=b.cohort(courses=[b.course("d", teachers=["T2"], students=["s2"], hours=1)]),
    )
    request: dict[str, Any] = {"formatVersion": 1, "snapshot": wire_snapshot(snapshot)}
    if warm_start:
        request["warmStart"] = [{"cohort": "dp1", "courseId": "a", "day": 1, "period": 1, "week": "both"}]
    return request


def _infeasible_request() -> dict[str, Any]:
    """One teacher owing more hours than the grid has cells — provably no complete board."""
    snapshot = b.snapshot(
        dp1=b.cohort(courses=[b.course("a", teachers=["T1"], students=["s1"], hours=3)]),
        days=1,
        periods=2,
    )
    return {"formatVersion": 1, "snapshot": wire_snapshot(snapshot)}


def _run(request: dict[str, Any], fake: FakeSupabase) -> JobRegistry:
    """Run the worker SYNCHRONOUSLY (no thread) so a test asserts on a finished state rather than
    on a sleep."""
    registry = JobRegistry()
    registry.register(JOB_ID)
    _run_registered(request, fake, registry)
    return registry


def _run_registered(
    request: dict[str, Any],
    fake: FakeSupabase,
    registry: JobRegistry,
    *,
    settings: Settings = SETTINGS,
) -> None:
    """:func:`_run` against a registry the test still holds — so it can fire the stop latch.

    The row's `snapshot_hash` defaults to this request's own digest, matching the app's enqueue: the
    binding is under test in its own two cases, not incidentally in every other one.
    """
    if fake.snapshot_hash is None:
        fake.snapshot_hash = snapshot_hash(parse_snapshot(request["snapshot"]))
    run_job(JOB_ID, request, settings=settings, registry=registry, client_factory=fake.client_factory)


def _registered() -> JobRegistry:
    registry = JobRegistry()
    registry.register(JOB_ID)
    return registry


# --- the HTTP surface -------------------------------------------------------------------------------


def test_health_needs_no_configuration(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_solve_accepts_a_valid_request_with_202(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    started: list[str] = []
    monkeypatch.setattr(app_module, "start_job", lambda job_id, body, **_: started.append(job_id))

    response = client.post(f"/jobs/{JOB_ID}/solve", json=_micro_request())

    assert response.status_code == 202
    assert response.json() == {"status": "accepted", "jobId": JOB_ID}
    assert started == [JOB_ID]


def test_an_unconfigured_service_refuses_work_with_503_instead_of_taking_it(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A bare container answers `/health`, but a 202 from it would wedge the job: the worker fails at
    its first database call, `_claim` swallows it, and the row sits `queued`. The dispatch caller
    compensates on any non-202, so refusing is what keeps the failure visible."""
    bare = replace(SETTINGS, supabase_url="", supabase_key="", machine_password="")

    def explode(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("an unconfigured service must not spawn a worker")

    monkeypatch.setattr(app_module, "settings", bare)
    monkeypatch.setattr(app_module, "start_job", explode)

    response = client.post(f"/jobs/{JOB_ID}/solve", json=_micro_request())

    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]
    assert app_module.registry.register(JOB_ID) is Registration.ACCEPTED, (
        "the refused id must not be left registered"
    )


def test_duplicate_post_is_accepted_but_starts_no_second_solve(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Layer (a) of the idempotency guard: a dispatch retry after a slow 202 must not interleave a
    second worker's status writes onto the same row."""
    started: list[str] = []
    monkeypatch.setattr(app_module, "start_job", lambda job_id, body, **_: started.append(job_id))

    first = client.post(f"/jobs/{JOB_ID}/solve", json=_micro_request())
    second = client.post(f"/jobs/{JOB_ID}/solve", json=_micro_request())

    assert (first.status_code, second.status_code) == (202, 202)
    assert second.json()["status"] == "already running"
    assert started == [JOB_ID], "the retry must not spawn a second solve"


def test_a_second_distinct_job_past_capacity_is_refused_with_503(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Distinct from the duplicate-POST case: that one is idempotent and answers 202. This is a
    DIFFERENT job arriving while the container is full — accepting it would not run it sooner, it
    would starve the solve already running and the `/health` answer keeping the container alive."""
    monkeypatch.setattr(app_module, "start_job", lambda *_args, **_kwargs: None)
    other = "9c2e7f10-4a3b-4d5e-8f61-0b7c9d2e3a44"

    first = client.post(f"/jobs/{JOB_ID}/solve", json=_micro_request())
    second = client.post(f"/jobs/{other}/solve", json=_micro_request())

    assert first.status_code == 202
    assert second.status_code == 503


def test_a_failed_spawn_does_not_strand_the_registry_entry(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Release lives in the worker's `finally`, which never runs if the thread never started. A
    stranded entry would make every later dispatch for this id a 202 no-op forever."""

    def explode(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("can't start new thread")

    monkeypatch.setattr(app_module, "start_job", explode)
    with pytest.raises(RuntimeError):
        client.post(f"/jobs/{JOB_ID}/solve", json=_micro_request())

    monkeypatch.setattr(app_module, "start_job", lambda *_args, **_kwargs: None)
    assert client.post(f"/jobs/{JOB_ID}/solve", json=_micro_request()).json()["status"] == "accepted"


def test_malformed_body_is_a_422_naming_the_field_not_a_keyerror(client: TestClient) -> None:
    """The engine does raw dict access, so without boundary validation this would be a bare
    `KeyError` surfacing as a 500 on a request that was merely malformed."""
    request = _micro_request()
    del request["snapshot"]["days"]

    response = client.post(f"/jobs/{JOB_ID}/solve", json=request)

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["schema"] == "SolveRequest"
    assert any("days" in error for error in detail["errors"])


def test_body_carrying_a_job_id_is_rejected(client: TestClient) -> None:
    """`additionalProperties: false` is why the id travels in the path. A body that smuggles one
    must fail loudly rather than be silently ignored."""
    response = client.post(f"/jobs/{JOB_ID}/solve", json={**_micro_request(), "jobId": JOB_ID})

    assert response.status_code == 422
    assert any("jobId" in error for error in response.json()["detail"]["errors"])


def test_wrong_format_version_is_rejected(client: TestClient) -> None:
    response = client.post(f"/jobs/{JOB_ID}/solve", json={**_micro_request(), "formatVersion": 2})
    assert response.status_code == 422


def test_an_unknown_policy_preset_is_rejected_at_the_boundary(client: TestClient) -> None:
    """S-307: the schema's enum is the gate, so a preset the engine has no table entry for never
    reaches `resolve_policy` — the 422 names the path rather than a 500 naming a `KeyError`."""
    request = {**_micro_request(), "policy": {"preset": "fastest"}}

    response = client.post(f"/jobs/{JOB_ID}/solve", json=request)

    assert response.status_code == 422
    assert any("preset" in error for error in response.json()["detail"]["errors"])


def test_non_uuid_job_id_never_reaches_the_handler(client: TestClient) -> None:
    assert client.post("/jobs/not-a-uuid/solve", json=_micro_request()).status_code == 422


def test_a_non_json_content_type_is_refused_before_the_body_is_read(client: TestClient) -> None:
    """`text/plain` is a CORS *simple* content type: accepting it would let a page in a developer's
    browser dispatch to a known job id with no preflight. Demanding `application/json` is what makes
    the browser ask first — and this service never answers a preflight. See the README's
    trust-boundary note."""
    response = client.post(
        f"/jobs/{JOB_ID}/solve",
        content=json.dumps(_micro_request()),
        headers={"Content-Type": "text/plain"},
    )

    assert response.status_code == 415


def test_the_committed_golden_is_accepted_as_a_body(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The gated fixture is the known-valid body; if the service rejected it, the contract gate and
    the wrapper would disagree about what `SolveRequest` means."""
    monkeypatch.setattr(app_module, "start_job", lambda *_args, **_kwargs: None)
    golden = json.loads(SOLVE_REQUEST_GOLDEN.read_text())

    assert client.post(f"/jobs/{JOB_ID}/solve", json=golden).status_code == 202


# --- the worker's database conversation -------------------------------------------------------------


def test_successful_solve_claims_then_writes_the_result() -> None:
    fake = FakeSupabase()

    _run(_micro_request(), fake)

    claim, finish = fake.claim_patch(), fake.finish_patch()
    assert claim.params["status"] == "eq.queued", "the CAS filter is the durable idempotency guard"
    assert claim.params["id"] == f"eq.{JOB_ID}"
    assert claim.params["select"] == "id,snapshot_hash", (
        "the binding digest rides the claim's own round trip; a BARE select would drag the ~124 KB "
        "TOASTed snapshot along with it"
    )
    assert claim.headers["prefer"] == "return=representation"
    assert claim.headers["authorization"] == f"Bearer {ACCESS_TOKEN}"
    assert claim.headers["apikey"] == SETTINGS.supabase_key
    assert claim.body["status"] == "running"
    assert claim.body["started_at"] and claim.body["heartbeat_at"]

    assert "status" not in finish.params, "the terminal write is not conditional on queued"
    assert finish.params["select"] == "id"
    assert finish.body["status"] == "succeeded"
    assert finish.body["finished_at"]
    assert finish.body["result"]["placements"]
    assert finish.body["stages"]
    assert "error" not in finish.body, "a success must not blank-write a column it has nothing to say about"


def test_every_written_column_is_inside_the_grant() -> None:
    """The role holds UPDATE on exactly 11 columns; anything else is a `42501` at runtime. Cheaper
    to pin the payload here than to discover it against the live stack."""
    granted = {
        "status",
        "result",
        "error",
        "started_at",
        "finished_at",
        "heartbeat_at",
        "stage_index",
        "stage_name",
        "stages",
        "checkpoint",
        "checkpoint_stage_index",
    }
    fake = FakeSupabase()

    _run(_micro_request(), fake)

    for patch in fake.patches():
        assert set(patch.body) <= granted, f"writes outside the grant: {set(patch.body) - granted}"


def test_the_written_result_is_in_declared_array_order() -> None:
    """Through `wire_result`, not raw producer output: `to_generation_result` emits placements in
    BOARD order, and a non-canonical `result` would mismatch every later canonical comparison."""
    fake = FakeSupabase()

    _run(_micro_request(), fake)

    placements = fake.finish_patch().body["result"]["placements"]
    keys = [(p["cohort"], p["courseId"], p["day"], p["period"], p["week"]) for p in placements]
    assert keys == sorted(keys)


def test_a_warm_start_is_carried_into_the_solve() -> None:
    """`warmStart -> Dump.greedy_placements` is what makes hinting free: `solve_complete` hints from
    exactly that field."""
    fake = FakeSupabase()

    _run(_micro_request(warm_start=True), fake)

    assert fake.finish_patch().body["status"] == "succeeded"


def test_losing_the_claim_writes_nothing_further(caplog: pytest.LogCaptureFixture) -> None:
    """Layer (b): the container restarted, the registry is empty, and a redispatch arrives — the CAS
    must stop it, because RLS alone permits `running -> running`.

    The log assertion is not decoration. Nothing about this outcome reaches the row (the caller got
    its 202; the row is untouched), so the log line is the ENTIRE trace — and it has to clear
    WARNING, because uvicorn leaves the root logger there and would drop anything quieter."""
    fake = FakeSupabase(claimable=False)

    with caplog.at_level("WARNING", logger="cpsat_service.runner"):
        _run(_micro_request(), fake)

    assert len(fake.patches()) == 1, "only the failed claim; a lost CAS must not trample a live solve"
    assert any("not claimable" in record.message for record in caplog.records)


def test_every_solve_requests_clean_mode() -> None:
    """FR-302's shipped default, and it can only be asserted HERE: `SolveRequest` has nowhere to
    carry a policy and the service deliberately never reads `generation_jobs.policy`, so the runner's
    own `SolveConfig` is the entire decision."""
    configs: list[SolveConfig] = []

    def record(dump: Dump, config: SolveConfig) -> SolveResult:
        configs.append(config)
        return solve_complete(dump, config)

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr("cpsat_service.runner.solve_complete", record)
        _run(_micro_request(), FakeSupabase())

    assert [config.clean_mode for config in configs] == [True]


def test_the_row_advances_stage_by_stage_between_the_claim_and_the_finish() -> None:
    """The whole point of S-303: the row IS the status channel, so a solve in flight has to be
    legible from it alone. Two writes per stage — which tier is now running, then what came of it."""
    fake = FakeSupabase()

    _run(_micro_request(), fake)

    assert [p.params.get("status") for p in fake.patches()] == [
        "eq.queued",
        *["eq.running"] * len(fake.progress_patches()),
        None,
    ], "claim, then the progress conversation, then exactly one terminal write"

    starts = [p for p in fake.progress_patches() if "stage_index" in p.body]
    completions = [p for p in fake.progress_patches() if "stages" in p.body]
    assert len(starts) == len(completions) == 10, "Mode A reports ten stages"
    assert [p.body["stage_index"] for p in starts] == list(range(1, 11)), "TIER numbers, in order"
    assert [p.body["stage_name"] for p in starts][0] == "completeness"
    assert [len(p.body["stages"]) for p in completions] == list(range(1, 11)), "the transcript grows"


def test_every_progress_write_is_filtered_projected_and_heartbeats() -> None:
    fake = FakeSupabase()

    _run(_micro_request(), fake)

    for patch in fake.progress_patches():
        assert patch.params["id"] == f"eq.{JOB_ID}"
        assert patch.params["status"] == "eq.running", (
            "without this filter a late write could resurrect a row S-304/S-305 has already moved on"
        )
        assert patch.params["select"] == "id,stop_requested_at", (
            "never a bare select — `snapshot` is ~124 KB and TOASTed — and the stop flag rides this "
            "projection rather than costing a second request (S-305)"
        )
        assert patch.headers["prefer"] == "return=representation", (
            "so a matched-nothing is observable, and so the stop flag comes back at all"
        )
        assert patch.body["heartbeat_at"], "every stage event renews the heartbeat"


def test_a_started_write_says_only_which_tier_is_running() -> None:
    fake = FakeSupabase()

    _run(_micro_request(), fake)

    first = fake.progress_patches()[0]
    assert set(first.body) == {"stage_index", "stage_name", "heartbeat_at"}, (
        "a write must never blank a column it has nothing to say about"
    )


def test_a_completed_stage_that_solved_carries_the_incumbent_checkpoint() -> None:
    fake = FakeSupabase()

    _run(_micro_request(), fake)

    completed = [p for p in fake.progress_patches() if "stages" in p.body]
    with_checkpoint = [p for p in completed if "checkpoint" in p.body]
    assert with_checkpoint, "the micro instance solves, so its stages checkpoint"
    for patch in with_checkpoint:
        assert set(patch.body["checkpoint"]) == {"placements", "diagnostics"}
        assert patch.body["checkpoint"]["diagnostics"]["engine"] == "cp-sat"
        assert patch.body["checkpoint"]["diagnostics"]["partial"] is True, "mid-ladder is never a proof"
        assert patch.body["checkpoint_stage_index"] == patch.body["stages"][-1]["tier"]


def test_a_stage_that_solved_nothing_advances_the_transcript_but_not_the_checkpoint() -> None:
    """An under-budgeted stage contributed nothing, so the row must not claim it did — `stages` and
    `heartbeat_at` move, the checkpoint columns are left exactly as the last solved stage set them."""
    fake = FakeSupabase()

    _run(_infeasible_request(), fake)

    completed = [p for p in fake.progress_patches() if "stages" in p.body]
    assert completed, "even a failed run reports its one completeness stage"
    for patch in completed:
        assert patch.body["stages"][-1]["status"] not in ("OPTIMAL", "FEASIBLE")
        assert "checkpoint" not in patch.body and "checkpoint_stage_index" not in patch.body


def test_a_failing_progress_write_is_logged_and_the_solve_still_succeeds(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Progress is never worth a board. A 503 from the edge is logged and swallowed, with no retry:
    the next stage sends a fresher payload than a retry of this one would."""
    fake = FakeSupabase(progress_response=httpx.Response(503, json={"message": "edge unavailable"}))

    with caplog.at_level("WARNING", logger="cpsat_service.supabase"):
        _run(_micro_request(), fake)

    assert fake.finish_patch().body["status"] == "succeeded"
    assert any("progress write failed" in record.message for record in caplog.records)


def test_a_transport_error_on_a_progress_write_does_not_kill_the_solve() -> None:
    fake = FakeSupabase(progress_response=httpx.ConnectError("the connection never landed"))

    _run(_micro_request(), fake)

    assert fake.finish_patch().body["status"] == "succeeded"


def test_a_progress_write_that_matches_no_row_is_a_warning_not_a_failure(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The filter doing its job: the row was moved out of `running` by someone else, so this write
    was correctly dropped. Answering "0 rows" must never raise and must never overwrite."""
    fake = FakeSupabase(progress_response=httpx.Response(200, json=[]))

    with caplog.at_level("WARNING", logger="cpsat_service.supabase"):
        _run(_micro_request(), fake)

    assert fake.finish_patch().body["status"] == "succeeded"
    assert any("matched no row" in record.message for record in caplog.records)


def test_the_live_solver_handle_reaches_the_registry() -> None:
    """The stop seam: interrupting a live search needs a reference to the solver that is actually
    searching, and the engine builds its solvers internally. Both producers reach it through the
    registry — SIGTERM (S-304) and the author's stop request (S-305)."""
    fake = FakeSupabase()
    seen: list[Any] = []
    registry = JobRegistry()
    registry.register(JOB_ID)
    original = registry.attach_solver

    def record(job_id: str, solver: Any) -> None:
        seen.append(solver)
        original(job_id, solver)

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(registry, "attach_solver", record)
        fake.snapshot_hash = snapshot_hash(parse_snapshot(_micro_request()["snapshot"]))
        run_job(
            JOB_ID, _micro_request(), settings=SETTINGS, registry=registry, client_factory=fake.client_factory
        )

    assert seen, "the registry was never handed a solver"
    assert all(hasattr(solver, "solve") for solver in seen)


def test_configured_stage_targets_reach_the_engine() -> None:
    """The knob's whole path in one assertion: env -> `Settings.stage_targets` -> `SolveConfig`.
    Values are S-308's to ship; what S-303 owes is that a configured one actually arrives."""
    configs: list[SolveConfig] = []

    def record(dump: Dump, config: SolveConfig) -> SolveResult:
        configs.append(config)
        return solve_complete(dump, config)

    targeted = replace(SETTINGS, stage_targets={3: 95, 6: 900})
    fake = FakeSupabase()
    fake.snapshot_hash = snapshot_hash(parse_snapshot(_micro_request()["snapshot"]))
    registry = JobRegistry()
    registry.register(JOB_ID)

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr("cpsat_service.runner.solve_complete", record)
        run_job(
            JOB_ID, _micro_request(), settings=targeted, registry=registry, client_factory=fake.client_factory
        )

    assert [config.targets for config in configs] == [{3: 95, 6: 900}]


def test_an_unconfigured_service_leaves_the_engine_exactly_as_it_was() -> None:
    """The neutrality guarantee at the service boundary: no targets set means no targets passed."""
    configs: list[SolveConfig] = []

    def record(dump: Dump, config: SolveConfig) -> SolveResult:
        configs.append(config)
        return solve_complete(dump, config)

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr("cpsat_service.runner.solve_complete", record)
        _run(_micro_request(), FakeSupabase())

    assert [config.targets for config in configs] == [{}]


def test_a_snapshot_that_is_not_the_enqueued_one_fails_before_solving() -> None:
    """Dispatch is unauthenticated and body-trusting, so the row's digest is what binds a body to the
    job id in its URL. `failed` rather than back to `queued`: the claim already moved the row to
    `running` and RLS admits no way back."""
    fake = FakeSupabase(snapshot_hash="0" * 64)

    _run(_micro_request(), fake)

    claim, finish = fake.claim_patch(), fake.finish_patch()
    assert claim.body["status"] == "running"
    assert finish.body["status"] == "failed"
    assert "snapshot mismatch" in finish.body["error"]
    assert "result" not in finish.body
    assert "stages" not in finish.body, "nothing was solved, so there is no ladder transcript to write"


def test_a_matching_snapshot_binds_and_proceeds_to_the_solve() -> None:
    """The other half of the guard: the digest the app recorded is exactly what dispatch carries, so
    the same fixture that fails above must sail through when the row agrees."""
    fake = FakeSupabase(snapshot_hash=snapshot_hash(parse_snapshot(_micro_request()["snapshot"])))

    _run(_micro_request(), fake)

    assert fake.finish_patch().body["status"] == "succeeded"


def test_infeasible_outcome_fails_the_job_and_still_writes_stages() -> None:
    """A non-OPTIMAL solve does NOT raise — it returns an empty board with `notes["outcome"]`. A
    wrapper that branched on exceptions would write `succeeded` over nothing."""
    fake = FakeSupabase()

    _run(_infeasible_request(), fake)

    finish = fake.finish_patch()
    assert finish.body["status"] == "failed"
    assert "infeasible" in finish.body["error"]
    assert finish.body["stages"], "the ladder transcript survives a failure — it is the diagnosis"
    assert "result" not in finish.body


def test_precondition_error_fails_the_job_with_the_authors_message() -> None:
    """A dirty pinned board is a CLIENT-data failure: the message must reach the author, not read as
    a solver crash."""
    snapshot = b.snapshot(
        dp1=b.cohort(
            courses=[b.course("a", teachers=["T1"], hours=2), b.course("bb", teachers=["T1"], hours=2)],
            # Both courses share T1 and are pinned into the same cell — the pins alone are illegal.
            pins=[b.pin("a", 1, 1), b.pin("bb", 1, 1)],
        )
    )
    fake = FakeSupabase()

    _run({"formatVersion": 1, "snapshot": wire_snapshot(snapshot)}, fake)

    finish = fake.finish_patch()
    assert finish.body["status"] == "failed"
    assert finish.body["error"].startswith("precondition:")
    assert "double-book" in finish.body["error"]


def test_the_registry_releases_the_job_even_when_the_solve_fails() -> None:
    """Otherwise a failed job could never be redispatched without restarting the container."""
    fake = FakeSupabase()

    registry = _run(_infeasible_request(), fake)

    assert len(registry) == 0


# --- S-304: the stop latch, the interrupted terminal write, and the heartbeat timer ------------------


def _unknown_result(stages: tuple[StageReport, ...] = ()) -> SolveResult:
    """What Mode A returns when the completeness solve found nothing: an empty board and an
    `unknown` outcome — the shape the failure branch turns into `failed`."""
    return SolveResult(
        mode="complete", board=(), stages=stages, proven_optimal=False, notes={"outcome": "unknown"}
    )


def _unknown_stage() -> StageReport:
    return StageReport(tier=1, name="completeness", status="UNKNOWN", best=None, bound=None, wall_clock_s=0.4)


def test_a_latch_fired_before_the_solve_writes_interrupted_rather_than_succeeded() -> None:
    """The mis-write S-304 fixes. A cancelled Mode-A run still returns `notes["outcome"] ==
    "complete"`, so the outcome branch alone would durably record a stopped solve as a finished one —
    with a `result` the ladder never actually produced."""
    fake = FakeSupabase()
    registry = _registered()
    assert registry.request_stop(JOB_ID, "shutdown") is True

    _run_registered(_micro_request(), fake, registry)

    finish = fake.finish_patch()
    assert finish.body["status"] == "interrupted"
    assert "container shutdown" in finish.body["error"]
    assert "result" not in finish.body, "an interrupted board lives in the checkpoint columns"
    assert finish.body["stages"], "the transcript survives — it names the last stage that finished"


def test_a_stop_during_the_last_stage_is_interrupted_even_though_no_stage_reads_cancelled() -> None:
    """The first hole a stage scan would fall into. `stoppedBy: "cancelled"` is recorded only when
    `should_stop` fires at an IMPROVING SOLUTION; a stop landing between stages leaves every report
    reading `"budget"` or nothing, and a scan would write `succeeded` over an interrupted solve."""
    fake = FakeSupabase()
    registry = _registered()

    def solve_then_latch(dump: Dump, config: SolveConfig) -> SolveResult:
        result = solve_complete(dump, config)
        registry.request_stop(JOB_ID, "shutdown")  # SIGTERM arriving as the ladder finishes
        return result

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr("cpsat_service.runner.solve_complete", solve_then_latch)
        _run_registered(_micro_request(), fake, registry)

    finish = fake.finish_patch()
    assert finish.body["status"] == "interrupted"
    assert not any(stage.get("stoppedBy") == "cancelled" for stage in finish.body["stages"]), (
        "no stage was attributed to a cancellation — the latch alone is what decided this"
    )


def test_a_stop_before_the_first_feasible_solution_is_interrupted_rather_than_failed() -> None:
    """The second hole. No solution means `outcome == "unknown"`, which the failure branch turns
    into `failed` — sweeping the clone and telling the author their snapshot was unsolvable, when in
    fact the container was being replaced."""
    fake = FakeSupabase()
    registry = _registered()

    def latch_then_give_up(_dump: Dump, _config: SolveConfig) -> SolveResult:
        registry.request_stop(JOB_ID, "shutdown")
        return _unknown_result((_unknown_stage(),))

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr("cpsat_service.runner.solve_complete", latch_then_give_up)
        _run_registered(_micro_request(), fake, registry)

    finish = fake.finish_patch()
    assert finish.body["status"] == "interrupted"
    assert "unknown" not in finish.body["error"], "the author must not be told their board is unsolvable"
    assert "stage 1 (completeness)" in finish.body["error"]
    assert finish.body["stages"]


def test_a_latched_run_with_no_transcript_still_writes_interrupted_and_blanks_nothing() -> None:
    """The no-checkpoint shape: SIGTERM before the first stage finished. It is still `interrupted`
    (the app sweeps it exactly like `failed`), and the empty transcript is simply not sent."""
    fake = FakeSupabase()
    registry = _registered()

    def latch_immediately(_dump: Dump, _config: SolveConfig) -> SolveResult:
        registry.request_stop(JOB_ID, "shutdown")
        return _unknown_result()

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr("cpsat_service.runner.solve_complete", latch_immediately)
        _run_registered(_micro_request(), fake, registry)

    finish = fake.finish_patch()
    assert finish.body["status"] == "interrupted"
    assert "before any stage finished" in finish.body["error"]
    assert set(finish.body) == {"status", "finished_at", "error"}, (
        "a write must never blank a column it has nothing to say about"
    )


def test_an_unregistered_run_is_unlatchable_and_takes_todays_path() -> None:
    """The predicate is wired off the registry ENTRY, so the neutrality guarantee is worth stating:
    with no entry there is no latch, `should_stop` stays absent, and the solve is byte-for-byte the
    pre-S-304 one."""
    fake = FakeSupabase()

    _run_registered(_micro_request(), fake, JobRegistry())

    assert fake.finish_patch().body["status"] == "succeeded"


def test_the_stop_latch_reaches_the_engines_should_stop_hook() -> None:
    """The seam itself, asserted where it is wired rather than inferred from an outcome — the
    predicate the engine polls has to be the very latch the registry fires."""
    configs: list[SolveConfig] = []
    registry = _registered()
    entry = registry.get(JOB_ID)
    assert entry is not None

    def record(dump: Dump, config: SolveConfig) -> SolveResult:
        configs.append(config)
        return solve_complete(dump, config)

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr("cpsat_service.runner.solve_complete", record)
        _run_registered(_micro_request(), FakeSupabase(), registry)

    predicate = configs[0].hooks.should_stop
    assert predicate is not None and predicate() is False
    entry.stop.set()
    assert predicate() is True


def test_the_first_recorded_stop_reason_wins() -> None:
    """One latch, two producers — SIGTERM (S-304) and the author's stop request (S-305). A second
    request arriving mid-shutdown must not rewrite the story of why the solve ended: the row lands
    `interrupted`, because that is what actually ended it."""
    registry = _registered()

    registry.request_stop(JOB_ID, "shutdown")
    registry.request_stop(JOB_ID, "requested")

    entry = registry.get(JOB_ID)
    assert entry is not None
    assert entry.stop.is_set() and entry.stop_reason == "shutdown"


def test_stop_all_latches_every_live_job_and_hands_back_their_threads() -> None:
    other = "9c2e7f10-4a3b-4d5e-8f61-0b7c9d2e3a44"
    registry = _registered()
    registry.register(other)
    thread = threading.Thread(target=lambda: None)
    registry.attach_thread(other, thread)

    threads = registry.stop_all("shutdown")

    assert threads == [thread], "only jobs whose worker thread was attached can be joined"
    for job_id in (JOB_ID, other):
        entry = registry.get(job_id)
        assert entry is not None and entry.stop.is_set()


def test_a_solve_that_outlives_the_interval_renews_its_own_heartbeat() -> None:
    """S-303 renewed `heartbeat_at` per stage event — up to 300 s apart in Mode A. A five-minute
    reclaim grace is only safe against a cadence measured in seconds, so the timer is the mechanic
    that makes the app's staleness threshold a fact rather than a guess."""
    fake = FakeSupabase()
    registry = _registered()

    def dawdle(dump: Dump, config: SolveConfig) -> SolveResult:
        time.sleep(0.3)
        return solve_complete(dump, config)

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr("cpsat_service.runner.solve_complete", dawdle)
        _run_registered(
            _micro_request(), fake, registry, settings=replace(SETTINGS, heartbeat_interval_s=0.02)
        )

    beats = [patch_call for patch_call in fake.progress_patches() if set(patch_call.body) == {"heartbeat_at"}]
    assert beats, "a solve outliving the interval must renew its own heartbeat"
    for beat in beats:
        assert beat.params["id"] == f"eq.{JOB_ID}"
        assert beat.params["status"] == "eq.running", "a beat must not resurrect a reclaimed row"
        assert beat.params["select"] == "id,stop_requested_at", "the beat is also the stop poll"
    assert fake.finish_patch().body["status"] == "succeeded", "the timer is invisible to the outcome"


def test_the_heartbeat_never_beats_before_the_claim_is_won() -> None:
    """A row this worker does not own must never have its heartbeat renewed — the timer starts after
    the CAS, not before it."""
    fake = FakeSupabase(claimable=False)
    registry = _registered()

    _run_registered(_micro_request(), fake, registry, settings=replace(SETTINGS, heartbeat_interval_s=0.01))

    assert len(fake.patches()) == 1, "only the failed claim"


# --- S-305: the author's stop request, observed on the heartbeat's own round trip --------------------


def test_a_stop_request_observed_by_the_heartbeat_ends_the_job_as_stopped() -> None:
    """The producer, end to end at the wrapper level.

    The flag rides the beat's OWN `return=representation` projection — no second request, no second
    thread, no second grant — the timer fires the latch, and the WORKER writes the terminal row. The
    timer never writes a status itself, which is what keeps exactly one writer per job.
    """
    fake = FakeSupabase(stop_requested_after=0)
    registry = _registered()
    reasons: list[str | None] = []

    def solve_until_latched(_dump: Dump, _config: SolveConfig) -> SolveResult:
        entry = registry.get(JOB_ID)
        assert entry is not None
        assert entry.stop.wait(5.0), "the heartbeat never observed the flag"
        reasons.append(entry.stop_reason)
        return _unknown_result((_unknown_stage(),))

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr("cpsat_service.runner.solve_complete", solve_until_latched)
        _run_registered(
            _micro_request(), fake, registry, settings=replace(SETTINGS, heartbeat_interval_s=0.02)
        )

    assert reasons == ["requested"], "the reason recorded is what keys the terminal status"
    finish = fake.finish_patch()
    assert finish.body["status"] == "stopped"
    assert finish.body["error"].startswith("stopped by the author:"), (
        "a `stopped` row must not open with `interrupted by` — they are sibling statuses with "
        "different meanings, and this string reaches the author verbatim"
    )
    assert "stage 1 (completeness)" in finish.body["error"], "the author is told which stage is kept"
    assert "result" not in finish.body, "a stopped board lives in the checkpoint columns"
    assert finish.body["stages"], "the transcript survives — it names the last stage that finished"


def test_the_heartbeat_latches_at_most_once_however_many_beats_see_the_flag() -> None:
    """The row stays `running` until the worker's terminal write, so every beat after the first sees
    the same flag. `request_stop` is idempotent, but re-interrupting a solver that is already winding
    down is noise — the timer remembers that it has fired."""
    fake = FakeSupabase(stop_requested_after=0)
    registry = _registered()
    asked: list[str] = []
    original = registry.request_stop

    def record(job_id: str, reason: str) -> bool:
        asked.append(reason)
        return original(job_id, reason)

    def solve_through_several_beats(_dump: Dump, _config: SolveConfig) -> SolveResult:
        time.sleep(0.25)
        return _unknown_result((_unknown_stage(),))

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(registry, "request_stop", record)
        patch.setattr("cpsat_service.runner.solve_complete", solve_through_several_beats)
        _run_registered(
            _micro_request(), fake, registry, settings=replace(SETTINGS, heartbeat_interval_s=0.02)
        )

    beats = [call for call in fake.progress_patches() if set(call.body) == {"heartbeat_at"}]
    assert len(beats) > 1, "the solve outlived several intervals, so several beats saw the same flag"
    assert asked == ["requested"], "fired once, not once per beat"


def test_a_null_stop_flag_is_simply_a_heartbeat() -> None:
    """The neutrality half: every other test in this file leaves the column null, and none of them
    latches. Stated once explicitly so the poll cannot start firing on absence."""
    fake = FakeSupabase()
    registry = _registered()

    def dawdle(dump: Dump, config: SolveConfig) -> SolveResult:
        time.sleep(0.15)
        return solve_complete(dump, config)

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr("cpsat_service.runner.solve_complete", dawdle)
        _run_registered(
            _micro_request(), fake, registry, settings=replace(SETTINGS, heartbeat_interval_s=0.02)
        )

    assert fake.finish_patch().body["status"] == "succeeded"


def test_the_solver_never_writes_the_stop_flag_it_only_observes_it() -> None:
    """The grant-layer asymmetry, restated where it is cheap to check: `stop_requested_at` is
    SELECT-granted and deliberately NOT UPDATE-granted, so a solver that could clear its own stop
    flag would be able to ignore Stop & keep. No write this worker makes may name the column."""
    fake = FakeSupabase(stop_requested_after=0)

    _run(_micro_request(), fake)

    for patch_call in fake.patches():
        assert "stop_requested_at" not in patch_call.body


def test_a_progress_write_with_an_unexpected_body_shape_answers_none_rather_than_raising() -> None:
    """The widened return value must not widen the ways `progress` can escape: it is called from the
    solving thread, so a malformed 2xx has to degrade to "nothing to observe"."""
    fake = FakeSupabase(progress_response=httpx.Response(200, json={"message": "not an array"}))

    _run(_micro_request(), fake)

    assert fake.finish_patch().body["status"] == "succeeded", "a bad body cannot cost a solve"


def test_stop_search_reaches_the_attached_handle_when_the_flag_is_observed() -> None:
    """The registry's half of the latch, pinned on a recording handle rather than inferred: the
    immediate interrupt is `stop_search()` on the solver that is searching right now, and the
    live-solve proof of it is `test_stage_stop.py`'s."""

    class RecordingSolver:
        def __init__(self) -> None:
            self.stopped = 0

        def stop_search(self) -> None:
            self.stopped += 1

    registry = _registered()
    solver = RecordingSolver()
    registry.attach_solver(JOB_ID, solver)

    assert registry.request_stop(JOB_ID, "requested") is True

    entry = registry.get(JOB_ID)
    assert entry is not None and entry.stop_reason == "requested"
    assert solver.stopped == 1


# --- credential discipline --------------------------------------------------------------------------


def test_one_short_solve_signs_in_once() -> None:
    """The heartbeat's second client (S-304) signs in LAZILY, so a solve that finishes inside one
    interval still mints exactly one token — see the companion test below for the other half."""
    fake = FakeSupabase()

    _run(_micro_request(), fake)

    assert fake.sign_in_count == 1, "the token is cached for the whole solve"


def test_the_heartbeat_signs_in_on_its_own_client_rather_than_sharing_the_workers() -> None:
    """`JobRowClient` is deliberately not thread-safe — its token cache is an unlocked
    check-then-act — so the timer takes a SECOND client from the same factory. Two clients, two
    lazy password grants, and neither cache is ever touched by two threads."""
    fake = FakeSupabase()
    registry = _registered()

    def dawdle(dump: Dump, config: SolveConfig) -> SolveResult:
        time.sleep(0.15)
        return solve_complete(dump, config)

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr("cpsat_service.runner.solve_complete", dawdle)
        _run_registered(
            _micro_request(), fake, registry, settings=replace(SETTINGS, heartbeat_interval_s=0.02)
        )

    assert fake.sign_in_count == 2, "one grant for the worker's client, one for the heartbeat's"


def test_an_aged_token_is_re_minted_with_the_password_grant_never_a_refresh() -> None:
    """The runbook's sharpest rule: the password grant demonstrably fires the Custom Access Token
    Hook, while a refresh that silently returned an `authenticated` token would be the exact
    escalation the credential design exists to prevent."""
    fake = FakeSupabase()
    client = fake.client_factory(SETTINGS)

    client.sign_in()
    client._token_minted_at -= TOKEN_MAX_AGE_S + 1  # pretend the token aged past the threshold
    client.sign_in()

    grants = [call for call in fake.calls if call.path == "/auth/v1/token"]
    assert len(grants) == 2
    assert all(grant.params["grant_type"] == "password" for grant in grants)
    assert not any("refresh_token" in (grant.body or {}) for grant in grants)


def test_a_postgrest_error_surfaces_its_body_verbatim() -> None:
    """`42501` (outside the grant) and `23514` (bad status) live in the BODY, not the status line —
    a bare `raise_for_status()` would throw away exactly what makes a log entry diagnosable."""

    def deny(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/auth/v1/token":
            return httpx.Response(200, json={"access_token": ACCESS_TOKEN})
        return httpx.Response(403, json={"code": "42501", "message": "permission denied for table"})

    http = httpx.Client(base_url=SETTINGS.supabase_url, transport=httpx.MockTransport(deny))
    client = JobRowClient(SETTINGS, client=http)

    with pytest.raises(SupabaseError, match="42501"):
        client.claim(JOB_ID)


def test_the_terminal_write_retries_a_transient_5xx(monkeypatch: pytest.MonkeyPatch) -> None:
    """The one call that retries. A row left `running` can never be reclaimed (`claim` filters on
    `status=eq.queued`), so a 502 at minute twelve would discard the board permanently."""
    monkeypatch.setattr("cpsat_service.supabase.time.sleep", lambda _seconds: None)
    attempts = 0

    def flaky(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        if request.url.path == "/auth/v1/token":
            return httpx.Response(200, json={"access_token": ACCESS_TOKEN})
        attempts += 1
        if attempts == 1:
            return httpx.Response(502, text="invalid response from upstream server")
        return httpx.Response(200, json=[{"id": JOB_ID}])

    http = httpx.Client(base_url=SETTINGS.supabase_url, transport=httpx.MockTransport(flaky))
    JobRowClient(SETTINGS, client=http).finish(JOB_ID, status="succeeded", result={})

    assert attempts == 2


def test_a_terminal_write_that_matched_no_row_raises() -> None:
    """PostgREST answers 200 with an EMPTY array when the row has already left the RLS window. That
    is a LOST write, not a successful one — silence here would log a board as stored that is gone."""

    def matched_nothing(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/auth/v1/token":
            return httpx.Response(200, json={"access_token": ACCESS_TOKEN})
        return httpx.Response(200, json=[])

    http = httpx.Client(base_url=SETTINGS.supabase_url, transport=httpx.MockTransport(matched_nothing))
    client = JobRowClient(SETTINGS, client=http)

    with pytest.raises(SupabaseError, match="matched no row"):
        client.finish(JOB_ID, status="succeeded", result={})


def test_a_deterministic_failure_is_not_retried() -> None:
    """`42501` is a rule the database enforced, not a blip: a second attempt just delays the log
    line that matters."""
    attempts = 0

    def deny(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        if request.url.path == "/auth/v1/token":
            return httpx.Response(200, json={"access_token": ACCESS_TOKEN})
        attempts += 1
        return httpx.Response(403, json={"code": "42501", "message": "permission denied for table"})

    http = httpx.Client(base_url=SETTINGS.supabase_url, transport=httpx.MockTransport(deny))
    client = JobRowClient(SETTINGS, client=http)

    with pytest.raises(SupabaseError, match="42501"):
        client.finish(JOB_ID, status="failed", error="whatever")
    assert attempts == 1


# --- the role assertion: fail-closed against a hook that is off ---------------------------------------


def test_a_token_carrying_the_narrow_role_is_accepted() -> None:
    """The happy path, stated once explicitly — every other test in this file rides on it."""
    client = FakeSupabase().client_factory(SETTINGS)

    assert client.sign_in() == ACCESS_TOKEN


@pytest.mark.parametrize(
    ("token", "why"),
    [
        (_jwt({"role": "authenticated"}), "the hook is off and GoTrue fell back"),
        (_jwt({"role": "service_role"}), "a wider role is still the wrong role"),
        (_jwt({"sub": "machine-user"}), "the claim is absent entirely"),
        ("not-a-jwt", "one segment, not three"),
        ("aaa.bbbb.ccc", "the payload segment decodes to bytes that are not JSON"),
        (f"aaa.{base64.urlsafe_b64encode(b'[1,2]').decode().rstrip('=')}.ccc", "JSON, but not an object"),
    ],
)
def test_a_token_that_is_not_the_narrow_role_is_refused(token: str, why: str) -> None:
    """Absence of the hook is the one misconfiguration that fails UPWARD — `authenticated` reaches
    every public table through `alter default privileges`, and nothing about it looks broken. So the
    token is refused before it is ever cached, and the message names the runbook."""
    client = FakeSupabase(access_token=token).client_factory(SETTINGS)

    with pytest.raises(RoleClaimError):
        client.sign_in()


def test_a_re_mint_that_lost_the_role_is_refused_mid_life() -> None:
    """Tokens are re-minted roughly hourly, so the check cannot be a startup-only affair: a hook
    disabled while the container is alive must fail closed on the very next grant."""
    fake = FakeSupabase()
    client = fake.client_factory(SETTINGS)
    client.sign_in()

    fake.access_token = _jwt({"role": "authenticated"})
    client._token_minted_at -= TOKEN_MAX_AGE_S + 1  # pretend the token aged past the threshold

    with pytest.raises(RoleClaimError, match=REQUIRED_ROLE):
        client.sign_in()


# --- the startup credential check ---------------------------------------------------------------------


def test_startup_refuses_to_serve_with_a_token_that_is_not_the_narrow_role(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The VISIBLE half of the assertion. `sign_in` is otherwise lazy — first called on the worker
    thread after the handler answered 202, where `runner._claim` swallows the exception and the row
    sits `queued` forever. Failing in the lifespan instead exits uvicorn non-zero, so the port never
    binds, the container start fails, and the dispatch error path already marks the row `failed`."""
    fake = FakeSupabase(access_token=_jwt({"role": "authenticated"}))
    monkeypatch.setattr(app_module, "settings", SETTINGS)
    monkeypatch.setattr(app_module, "JobRowClient", fake.client_factory)

    with pytest.raises(RoleClaimError), TestClient(app_module.app):
        pass  # pragma: no cover — the lifespan raises before the body runs


def test_startup_signs_in_exactly_once_and_then_serves(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeSupabase()
    monkeypatch.setattr(app_module, "settings", SETTINGS)
    monkeypatch.setattr(app_module, "JobRowClient", fake.client_factory)

    with TestClient(app_module.app) as client:
        assert client.get("/health").status_code == 200

    assert fake.sign_in_count == 1


def test_startup_skips_the_check_when_the_credential_trio_is_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`/health` must answer on a bare container — that is what a platform probe hits before secrets
    are wired, and it is how the tier-2 image is smoked before anything is provisioned. The startup
    check must not quietly take that promise away."""
    bare = replace(SETTINGS, supabase_url="", supabase_key="", machine_password="")

    def explode(_settings: Settings) -> JobRowClient:
        raise AssertionError("an unconfigured container must not attempt to sign in")

    monkeypatch.setattr(app_module, "settings", bare)
    monkeypatch.setattr(app_module, "JobRowClient", explode)

    with TestClient(app_module.app) as client:
        assert client.get("/health").status_code == 200


def test_startup_logs_the_effective_non_secret_settings(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The line a production smoke reads to prove `SOLVER_WORKERS=4` is in effect — and the line
    that surfaces the `contracts/` fail-open trap at boot rather than at the first 500."""
    fake = FakeSupabase()
    monkeypatch.setattr(app_module, "settings", SETTINGS)
    monkeypatch.setattr(app_module, "JobRowClient", fake.client_factory)

    with caplog.at_level("INFO", logger="cpsat_service.app"), TestClient(app_module.app):
        pass

    startup = next(
        record.getMessage() for record in caplog.records if "solver service starting" in record.message
    )
    assert f"workers={SETTINGS.workers}" in startup
    assert "wire_contract=loaded" in startup
    assert SETTINGS.machine_password not in startup, "the password must never reach a log line"
    assert SETTINGS.supabase_key not in startup, "nor the key"


# --- S-304: the lifespan shutdown, and the question the Durable Object asks ---------------------------


def _wait_for(predicate: Callable[[], bool], *, timeout_s: float = 10.0) -> None:
    """Poll until true. Cheaper and far less flaky than sleeping for a guessed duration."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError(f"the condition was still false after {timeout_s}s")


def _stalled_stage() -> StageReport:
    """A stage that ran out of budget — NOT one attributed to a cancellation. That is the realistic
    transcript for a `stop_search()` arriving from outside, and the reason the latch is the signal."""
    return StageReport(
        tier=4, name="softHits", status="FEASIBLE", best=12, bound=0, wall_clock_s=1.2, stopped_by="budget"
    )


def _solve_until_stopped(_dump: Dump, config: SolveConfig) -> SolveResult:
    """A stand-in for a long ladder: it does nothing but watch the latch a shutdown fires."""
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        if config.hooks.should_stop is not None and config.hooks.should_stop():
            return SolveResult(
                mode="complete",
                board=(),
                stages=(_stalled_stage(),),
                proven_optimal=False,
                notes={"outcome": "complete"},
            )
        time.sleep(0.01)
    raise AssertionError("the shutdown never fired the stop latch")  # pragma: no cover


def _threaded_app(monkeypatch: pytest.MonkeyPatch, fake: FakeSupabase) -> None:
    """Wire the real app so a POST spawns a REAL worker thread against `fake`.

    `start_job`'s `client_factory` default is bound at definition time, so patching the module
    attribute would not reach it — the handler's own lookup of `start_job` is the seam that does.
    """
    fake.snapshot_hash = snapshot_hash(parse_snapshot(_micro_request()["snapshot"]))
    monkeypatch.setattr(app_module, "settings", SETTINGS)
    monkeypatch.setattr(app_module, "JobRowClient", fake.client_factory)
    monkeypatch.setattr(app_module, "registry", JobRegistry(capacity=SETTINGS.max_concurrent_jobs))
    monkeypatch.setattr(
        app_module,
        "start_job",
        lambda job_id, body, **kwargs: start_job(
            job_id, body, client_factory=fake.client_factory, **kwargs
        ),
    )


def test_the_lifespan_shutdown_interrupts_a_live_solve_through_its_own_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The whole SIGTERM chain without a container: a registered job on a real thread, the lifespan's
    shutdown half, and the row reaching `interrupted` — written by the WORKER, so there is still
    exactly one writer per row."""
    fake = FakeSupabase()
    _threaded_app(monkeypatch, fake)
    monkeypatch.setattr("cpsat_service.runner.solve_complete", _solve_until_stopped)

    with TestClient(app_module.app) as client:
        assert client.post(f"/jobs/{JOB_ID}/solve", json=_micro_request()).status_code == 202
        _wait_for(lambda: any(call.params.get("status") == "eq.queued" for call in fake.patches()))
        assert client.get("/jobs/active").json() == {"active": 1}
    # leaving the context manager runs the lifespan's shutdown half

    finish = fake.finish_patch()
    assert finish.body["status"] == "interrupted"
    assert "container shutdown" in finish.body["error"]
    assert "result" not in finish.body
    assert finish.body["stages"][-1]["stoppedBy"] == "budget", (
        "no stage reads `cancelled` — the latch, not the transcript, is what decided this"
    )
    assert len(app_module.registry) == 0, "the worker released the job on its way out"


def test_a_shutdown_with_nothing_in_flight_touches_no_row(monkeypatch: pytest.MonkeyPatch) -> None:
    """The common case — a deploy while the container is idle — must write nothing at all."""
    fake = FakeSupabase()
    _threaded_app(monkeypatch, fake)

    with TestClient(app_module.app) as client:
        assert client.get("/health").status_code == 200

    assert fake.patches() == []


def test_the_shutdown_join_is_bounded_so_a_wedged_worker_cannot_hold_the_container(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A worker that will never finish must cost the budget and no more — the platform's SIGKILL is
    not something to be discovered. Its row simply stays `running` for the app to reclaim."""
    registry = JobRegistry()
    registry.register(JOB_ID)
    never = threading.Event()
    thread = threading.Thread(target=never.wait, name=f"solve-{JOB_ID}", daemon=True)
    thread.start()
    registry.attach_thread(JOB_ID, thread)
    monkeypatch.setattr(app_module, "SHUTDOWN_JOIN_BUDGET_S", 0.05)

    started = time.monotonic()
    with caplog.at_level("ERROR", logger="cpsat_service.app"):
        asyncio.run(app_module._shutdown(registry))
    elapsed = time.monotonic() - started
    never.set()

    assert elapsed < 2.0, "the shutdown must not wait on a worker that will never finish"
    assert any("did not finish" in record.message for record in caplog.records)


def test_jobs_active_reports_the_live_job_count(client: TestClient) -> None:
    """What the Durable Object's `onActivityExpired` override asks before it lets the sleep proceed."""
    assert client.get("/jobs/active").json() == {"active": 0}

    app_module.registry.register(JOB_ID)

    assert client.get("/jobs/active").json() == {"active": 1}


def test_jobs_active_answers_on_a_bare_container(monkeypatch: pytest.MonkeyPatch) -> None:
    """Same posture as `/health`, and for a sharper reason: an unconfigured container is definitively
    not solving, so answering that must never require a credential it does not have."""
    bare = replace(SETTINGS, supabase_url="", supabase_key="", machine_password="")
    monkeypatch.setattr(app_module, "settings", bare)
    monkeypatch.setattr(app_module, "registry", JobRegistry(capacity=1))

    assert TestClient(app_module.app).get("/jobs/active").json() == {"active": 0}
