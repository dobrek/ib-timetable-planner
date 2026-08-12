"""The background worker: sign in -> claim -> solve -> write the outcome.

Runs on a plain thread. That is sound because CP-SAT releases the GIL during solve (measured: 56
main-thread ticks through a live solve), so `/health` keeps answering while this blocks for minutes.

**The outcome mapping is the load-bearing part, and it is not exception-driven.** A non-optimal
solve does not raise: `solve_complete` returns `board=()` with `notes["outcome"]` reading
`infeasible` or `unknown`. Branching on exceptions here would silently write `succeeded` over an
empty board. The four shapes:

    outcome == "complete"   -> succeeded, `result` + `stages`
    infeasible / unknown    -> failed, `error` naming the outcome, `stages` STILL written
    PreconditionError       -> failed — a client-data failure (the pins already violate a hard
                               rule), not a solver failure, so the message goes to the author
    snapshot mismatch       -> failed BEFORE any solve, `error` naming both digests: the body is
                               not the snapshot this job id was enqueued with (S-301's binding)

Every solve requests CLEAN mode — the FR-302 shipped default, solver-side because the frozen
`SolveRequest` has nowhere to carry a policy.

**Accepted silent-failure surface (F-302).** If sign-in fails the worker cannot write anything to
the row: the row stays `queued` and the only signal is a loud service log. That is tolerable for a
tier-1 dev loop where a human is watching the console, and Phase 5's integration test converts it
into a poll timeout rather than a green run. S-304's heartbeat is what turns it into a detectable
state in production.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from typing import Any

from cpsat_engine.model import PreconditionError
from cpsat_engine.schema import Dump, parse_placements, parse_snapshot
from cpsat_engine.solve import SolveConfig, SolveResult, solve_complete, to_generation_result
from cpsat_engine.wire import snapshot_hash, wire_result, wire_stage_report

from .registry import JobRegistry
from .settings import Settings
from .supabase import JobRowClient

log = logging.getLogger("cpsat_service.runner")


def start_job(
    job_id: str,
    request: dict[str, Any],
    *,
    settings: Settings,
    registry: JobRegistry,
    client_factory: Callable[[Settings], JobRowClient] = JobRowClient,
) -> threading.Thread:
    """Spawn the worker for an ALREADY-REGISTERED job and return its thread.

    Registration happens in the handler, before this is called: doing it here would leave a window
    in which two concurrent POSTs both pass the guard and both spawn.
    """
    thread = threading.Thread(
        target=run_job,
        args=(job_id, request),
        kwargs={"settings": settings, "registry": registry, "client_factory": client_factory},
        name=f"solve-{job_id}",
        daemon=True,
    )
    registry.attach_thread(job_id, thread)
    thread.start()
    return thread


def run_job(
    job_id: str,
    request: dict[str, Any],
    *,
    settings: Settings,
    registry: JobRegistry,
    client_factory: Callable[[Settings], JobRowClient] = JobRowClient,
) -> None:
    """The whole worker body, synchronous. Called on a thread by :func:`start_job`; called directly
    by the tests, which is why it takes its collaborators rather than reaching for globals."""
    client: JobRowClient | None = None
    try:
        client = client_factory(settings)
        claimed = _claim(client, job_id)
        if claimed is None:
            return
        dump = build_dump(request)
        mismatch = _snapshot_mismatch(claimed, dump)
        if mismatch is not None:
            # The row is already `running` and RLS forbids returning it to `queued`, so `failed`
            # with a diagnostic is the only truthful terminal state available here.
            log.error("job %s: %s", job_id, mismatch)
            client.finish(job_id, status="failed", error=mismatch)
            return
        _solve_and_write(job_id, dump, client=client, settings=settings)
    except PreconditionError as error:
        # The author's pinned board already violates a hard rule — no engine result could ever pass
        # verify. Their data, their message.
        _write_failure(client, job_id, f"precondition: {error}")
    except Exception as error:  # noqa: BLE001 — a worker thread must never die with a silent trace
        log.exception("job %s failed", job_id)
        _write_failure(client, job_id, f"solver error: {error}")
    finally:
        registry.release(job_id)
        if client is not None:
            client.close()


def build_dump(request: dict[str, Any]) -> Dump:
    """Turn a validated `SolveRequest` into the `Dump` the engine takes.

    The envelope is narrower than a dump by design, so the absent parts get empty stand-ins —
    verified safe on the solve path: `lower_bound` returns None on empty diagnostics, and an empty
    hint board is a no-op. The cost is that a wrapper-driven solve runs hint-free and without the
    clique cut; hint-free Mode A was measured OPTIMAL on the golden catalog, so that cost is real
    but small.

    `warmStart`, when present, becomes `greedy_placements` — which is exactly what
    `solve_complete` hints from, so a warm start works with no extra plumbing.
    """
    return Dump(
        format_version=request["formatVersion"],
        meta={},
        snapshot=parse_snapshot(request["snapshot"]),
        greedy_placements=parse_placements(request.get("warmStart", ())),
        greedy_diagnostics={},
        objective=(),
    )


def _claim(client: JobRowClient, job_id: str) -> dict[str, Any] | None:
    """The claimed row iff THIS worker now owns it — and the only place a claim failure is handled.

    A claim that FAILED is not a claim that was LOST, but neither may write: `finish` carries no
    status filter and RLS admits `running -> failed`, so a terminal write from here would trample a
    row a different worker is legitimately solving. Both outcomes therefore exit through the log.

    WARNING, not INFO: the row itself records nothing about either case — the caller got its 202 and
    the row is untouched — so these lines are the entire trace that a dispatch was refused. Routine
    when a retry is the cause, worth noticing when it is not.
    """
    try:
        claimed = client.claim(job_id)
    except Exception:  # noqa: BLE001 — see above: an unclaimed row must not be written to
        log.exception("job %s: the claim itself failed — leaving the row untouched", job_id)
        return None
    if claimed is None:
        log.warning("job %s was not claimable (already running or terminal) — nothing to do", job_id)
    return claimed


def _snapshot_mismatch(claimed: dict[str, Any], dump: Dump) -> str | None:
    """The diagnostic when the dispatched body is not the snapshot this job was enqueued with.

    Dispatch is unauthenticated and body-trusting (`services/solver/README.md`), so the row's
    `snapshot_hash` is what binds a request to the job id in its URL. Without this check a caller
    who knows a job id could have any board solved and durably written under it — and, more likely
    in practice, a snapshot re-assembled between enqueue and dispatch would be solved against a
    different input than the one the app will later verify the result against.

    A missing digest is a mismatch, not a pass: the column is `not null`, so the only way to see one
    absent is a projection that stopped asking for it.
    """
    recorded = claimed.get("snapshot_hash")
    actual = snapshot_hash(dump.snapshot)
    if recorded == actual:
        return None
    return (
        f"snapshot mismatch: the dispatched body digests to {actual} but the job row records "
        f"{recorded!r} — this request is not the snapshot the job was enqueued with"
    )


def _solve_and_write(job_id: str, dump: Dump, *, client: JobRowClient, settings: Settings) -> None:
    log.info("job %s solving with %d workers", job_id, settings.workers)
    # Clean is the SHIPPED default (FR-302), and it is necessarily solver-side: `SolveRequest` is
    # `additionalProperties: false` and the service deliberately does not read `generation_jobs.policy`,
    # so there is nowhere on the wire for a caller to ask for it. S-307 is where alternatives arrive.
    result = solve_complete(dump, SolveConfig(workers=settings.workers, log_dir=None, clean_mode=True))
    stages = [wire_stage_report(stage) for stage in result.stages]
    outcome = result.notes.get("outcome")

    if outcome == "complete":
        client.finish(
            job_id,
            status="succeeded",
            # Through `wire_result`, NOT raw `to_generation_result`: the producer emits placements in
            # board order and the declared array sorts are applied at the consumer by design
            # (`wire.py`'s own docstring). Storing raw output would put non-canonical bytes in the
            # column that S-301's oracle and any later hashing read back.
            result=wire_result(to_generation_result(dump, result)),
            stages=stages,
        )
        log.info("job %s succeeded with %d placements", job_id, len(result.board))
        return

    client.finish(job_id, status="failed", error=_outcome_error(result), stages=stages)
    log.warning("job %s failed: outcome=%s", job_id, outcome)


def _outcome_error(result: SolveResult) -> str:
    """A non-OPTIMAL/FEASIBLE solve is a legitimate answer, not a crash — say which one it was."""
    outcome = result.notes.get("outcome", "unknown")
    if outcome == "infeasible":
        return "infeasible: the snapshot admits no complete board under the hard rules"
    return f"unknown: the completeness solve did not finish within its budget (outcome={outcome})"


def _write_failure(client: JobRowClient | None, job_id: str, error: str) -> None:
    """Best-effort terminal write. If the client never came up (sign-in failed) there is nothing to
    write WITH — the row stays `queued` and the log is the only trace. See the module docstring."""
    if client is None:
        log.error("job %s failed before a client existed; the row stays queued: %s", job_id, error)
        return
    try:
        client.finish(job_id, status="failed", error=error)
    except Exception:  # noqa: BLE001 — the original failure is the story; this one must not mask it
        log.exception("job %s: could not write the failure to the row", job_id)
