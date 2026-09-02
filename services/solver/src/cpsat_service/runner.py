"""The background worker: sign in -> claim -> solve -> write the outcome.

Runs on a plain thread. That is sound because CP-SAT releases the GIL during solve (measured: 56
main-thread ticks through a live solve), so `/health` keeps answering while this blocks for minutes.

**The outcome mapping is the load-bearing part, and it is not exception-driven.** A non-optimal
solve does not raise: `solve_complete` returns `board=()` with `notes["outcome"]` reading
`infeasible` or `unknown`. Branching on exceptions here would silently write `succeeded` over an
empty board. The five shapes:

    stop latch fired        -> interrupted (S-304's SIGTERM) or stopped (S-305's author request),
                               keyed by the reason the producer recorded; `error` naming the cause
                               and the last stage, `stages` written, NO `result` — the board lives in
                               the already-durable `checkpoint` columns. Checked FIRST: it outranks
                               the transcript
    outcome == "complete"   -> succeeded, `result` + `stages`
    infeasible / unknown    -> failed, `error` naming the outcome, `stages` STILL written
    PreconditionError       -> failed — a client-data failure (the pins already violate a hard
                               rule), not a solver failure, so the message goes to the author
    snapshot mismatch       -> failed BEFORE any solve, `error` naming both digests: the body is
                               not the snapshot this job id was enqueued with (S-301's binding)

**The policy comes off the wire (S-307).** `SolveRequest.policy` names a preset, `policy.py`
resolves it to `(clean_mode, ladder)`, and that is the whole of the runner's `SolveConfig` decision;
an absent key is the FR-302 shipped default, clean. The service never reads `generation_jobs.policy`
— the app writes that column and the body from one validated value, so the two cannot disagree.

**Accepted silent-failure surface (F-302).** If sign-in fails the worker cannot write anything to
the row: the row stays `queued` and the only signal is a loud service log. That is tolerable for a
tier-1 dev loop where a human is watching the console, and Phase 5's integration test converts it
into a poll timeout rather than a green run. S-304's heartbeat is what turns it into a detectable
state in production.

**Progress is emitted, not polled (S-303); the heartbeat is timed (S-304).** The engine raises a
`StageEvent` on either side of every ladder stage and this module turns each into one
`running -> running` PATCH. That alone is coarse — Mode A can run 300 s between renewals — so a
dedicated timer thread now renews `heartbeat_at` every `settings.heartbeat_interval_s`, on a SECOND
`JobRowClient` (`JobRowClient` is not thread-safe by design). Death is therefore detectable in
seconds, which is what makes the app's five-minute reclaim grace safe rather than a guess.

**And the beat is the stop poll (S-305).** `progress` reads its own matched row back, so widening
that projection by `stop_requested_at` turned every beat into an observation of the author's stop
request at no extra cost. The timer only ever fires the latch; the worker thread still owns the
terminal write, so "the latch is the signal, never the transcript" holds for both producers.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Final

from cpsat_engine.model import PreconditionError
from cpsat_engine.policy import Policy, resolve_policy
from cpsat_engine.schema import Dump, parse_placements, parse_snapshot
from cpsat_engine.solve import (
    SolveConfig,
    SolveHooks,
    SolveResult,
    StageEvent,
    solve_complete,
    to_generation_result,
)
from cpsat_engine.wire import snapshot_hash, wire_result, wire_stage_report

from .registry import JobEntry, JobRegistry
from .settings import Settings
from .supabase import JobRowClient

log = logging.getLogger("cpsat_service.runner")


@dataclass(frozen=True)
class StopOutcome:
    """What a latched stop means on the row: the terminal status, and the cause named in `error`."""

    status: str
    cause: str


# The reason the lifespan's SIGTERM path records (S-304), and the vocabulary lives HERE rather than
# in `app.py` so the producer and the status it maps to cannot drift.
SHUTDOWN_REASON: Final = "shutdown"

# The reason the heartbeat's `stop_requested_at` poll records (S-305). Same latch, same runner path;
# the only thing a second producer adds is a second key in the map below.
REQUESTED_REASON: Final = "requested"

# Keyed by the reason the producer recorded on the registry entry. Two producers, two rows: the
# platform taking the container away (`interrupted`) and the author asking for the run to end
# (`stopped`). An UNRECOGNISED reason falls back to `interrupted` rather than to the success branch:
# whatever stopped the solve, it was not the ladder finishing.
STOP_OUTCOMES: Final[dict[str, StopOutcome]] = {
    SHUTDOWN_REASON: StopOutcome(status="interrupted", cause="container shutdown"),
    REQUESTED_REASON: StopOutcome(status="stopped", cause="the author"),
}
FALLBACK_STOP_STATUS: Final = "interrupted"

# How long the worker waits for its own heartbeat thread before giving up on it. Comfortably past
# the client's 30 s HTTP timeout, so a beat in flight lands rather than being abandoned — and
# bounded, because a wedged timer must never hold the terminal write hostage.
HEARTBEAT_JOIN_TIMEOUT_S: Final = 35.0


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
    heartbeat: _Heartbeat | None = None
    try:
        client = client_factory(settings)
        claimed = _claim(client, job_id)
        if claimed is None:
            return
        # Only AFTER the claim: a row this worker does not own must never have its heartbeat
        # renewed — that is precisely the write `progress`'s `status=eq.running` filter exists to
        # drop, and starting the timer earlier would make the drop the only thing standing between
        # a lost CAS and a resurrected row. The same argument covers the stop poll it now carries:
        # a flag on somebody else's row is not this worker's to act on.
        heartbeat = _Heartbeat(
            job_id,
            client_factory(settings),
            settings.heartbeat_interval_s,
            request_stop=lambda: registry.request_stop(job_id, REQUESTED_REASON),
        )
        heartbeat.start()
        dump = build_dump(request)
        mismatch = _snapshot_mismatch(claimed, dump)
        if mismatch is not None:
            # The row is already `running` and RLS forbids returning it to `queued`, so `failed`
            # with a diagnostic is the only truthful terminal state available here.
            log.error("job %s: %s", job_id, mismatch)
            client.finish(job_id, status="failed", error=mismatch)
            return
        _solve_and_write(
            job_id, dump, resolve_policy(request), client=client, settings=settings, registry=registry
        )
    except PreconditionError as error:
        # The author's pinned board already violates a hard rule — no engine result could ever pass
        # verify. Their data, their message.
        _write_failure(client, job_id, f"precondition: {error}")
    except Exception as error:  # noqa: BLE001 — a worker thread must never die with a silent trace
        log.exception("job %s failed", job_id)
        _write_failure(client, job_id, f"solver error: {error}")
    finally:
        # The heartbeat stops FIRST. It owns its own client, so the ordering that matters is not
        # against `client.close()` below but against the terminal write already having landed: a
        # beat racing past `finish` would match nothing (`status=eq.running`) and merely log.
        if heartbeat is not None:
            heartbeat.stop()
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


def _solve_and_write(
    job_id: str,
    dump: Dump,
    policy: Policy,
    *,
    client: JobRowClient,
    settings: Settings,
    registry: JobRegistry,
) -> None:
    log.info("job %s solving with %d workers under the %s policy", job_id, settings.workers, policy.preset)
    entry = registry.get(job_id)
    # The request's policy IS the configuration (S-307): `clean_mode` and the ladder's visit order
    # both come from the one preset the app validated, and nothing here overrides either. Clean is
    # what an absent key resolves to (`policy.DEFAULT_PRESET`) — the FR-302 shipped default.
    config = SolveConfig(
        workers=settings.workers,
        log_dir=None,
        clean_mode=policy.clean_mode,
        ladder=policy.ladder,
        targets=settings.stage_targets,
        hooks=SolveHooks(
            on_stage=_progress_reporter(job_id, dump, client),
            on_solver=lambda solver: registry.attach_solver(job_id, solver),
            # The latch, read straight off the entry — one predicate, and today one producer (the
            # lifespan's SIGTERM path). `Event.is_set()` is atomic and takes no lock, which is what
            # `SolveHooks.should_stop` asks for: it is polled on the SOLVER's thread at every
            # improving solution, and taking the registry lock there would contend with the very
            # shutdown that is trying to fire it.
            should_stop=None if entry is None else entry.stop.is_set,
        ),
    )
    result = solve_complete(dump, config)
    stages = [wire_stage_report(stage) for stage in result.stages]
    outcome = result.notes.get("outcome")

    stop = _stop_outcome(entry)
    if stop is not None:
        # The LATCH is the signal, not the transcript. `stoppedBy: "cancelled"` is recorded only
        # when `should_stop` fires at an improving solution, so an external `stop_search()` reads
        # back as `"budget"` (FEASIBLE) or nothing at all (UNKNOWN) — a stage scan would write
        # `succeeded` over a stop during the last stage and `failed` over a stop before the first
        # feasible solution. No `result`: an interrupted run's board is whatever the last completed
        # stage already put in the `checkpoint` columns, and `result` stays the succeeded-only one.
        client.finish(
            job_id,
            status=stop.status,
            error=_stop_error(stop, result),
            # `or None` rather than `[]`: a run latched before its first stage completed has no
            # transcript, and a write must never blank a column it has nothing to say about.
            stages=stages or None,
        )
        log.warning("job %s %s: outcome=%s after %d stage(s)", job_id, stop.status, outcome, len(stages))
        return

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


def _progress_reporter(job_id: str, dump: Dump, client: JobRowClient) -> Callable[[StageEvent], None]:
    """Turn stage events into durable row writes — the app's only view of a solve in flight.

    Two payloads, and the split is what makes the row readable at any instant. A `started` says which
    tier is being worked, so the indicator can name it before there is anything to report about it. A
    `completed` says what came of it: the transcript so far, and — only when the stage actually
    solved — the incumbent board. An UNKNOWN stage advances the transcript and the heartbeat but
    leaves the checkpoint columns untouched, because a stage that found nothing contributed nothing
    and the row must not claim otherwise.

    The whole body is wrapped: a hook that raises would propagate through the engine (which
    deliberately does not catch, see `SolveHooks`) and kill a solve that was going fine. Here the
    answer IS known — progress is never worth a board — so this is where the net goes.
    """

    def report(event: StageEvent) -> None:
        try:
            client.progress(job_id, _progress_payload(dump, event))
        except Exception:  # noqa: BLE001 — reporting progress must never cost a solve
            log.exception("job %s: could not build the progress payload for tier %d", job_id, event.tier)

    return report


def _progress_payload(dump: Dump, event: StageEvent) -> dict[str, Any]:
    """The columns one stage event has something to say about, and no others.

    `stage_index` and `checkpoint_stage_index` are ladder POSITIONS — `StageEvent.position`, the
    human count the app's "stage N of 10" surfaces print — never tier numbers. Under the canonical
    ladder the two coincide; under a permuted one (S-307's student-first) only the position counts
    upward, and a counter that ran 2, 6, 3, 4 … would read as the solve going backwards. Tier
    IDENTITY stays where identity is read: `stages[].tier`, which the clean label keys on. The
    checkpoint goes onto the wire through `wire_result(to_generation_result(...))`, the SAME path the
    terminal write uses, so a mid-ladder board and a final one are byte-shaped alike.
    """
    if event.kind == "started":
        return {"stage_index": event.position, "stage_name": event.name}
    payload: dict[str, Any] = {"stages": [wire_stage_report(stage) for stage in event.stages]}
    if event.checkpoint is not None:
        payload["checkpoint"] = wire_result(to_generation_result(dump, event.checkpoint))
        payload["checkpoint_stage_index"] = event.position
    return payload


def _stop_outcome(entry: JobEntry | None) -> StopOutcome | None:
    """What the latch says this run's terminal status is, or None when nobody asked it to stop.

    Read once, after `solve_complete` returns — the entry is the runner's own, and the reason was
    written before the event was set, so seeing the latch means the reason is already visible.
    """
    if entry is None or not entry.stop.is_set():
        return None
    reason = entry.stop_reason
    if reason is None or reason not in STOP_OUTCOMES:
        log.warning(
            "job %s: stop reason %r has no mapping — writing %s", entry.job_id, reason, FALLBACK_STOP_STATUS
        )
        return StopOutcome(status=FALLBACK_STOP_STATUS, cause=reason or "an unrecorded stop")
    return STOP_OUTCOMES[reason]


def _stop_error(stop: StopOutcome, result: SolveResult) -> str:
    """Name the cause, the stage the stop landed in, and — when it differs — the stage whose checkpoint
    was kept. The transcript's one remaining job here.

    Which stage matters to the author, because it is the stage whose checkpoint they are about to be
    delivered: `checkpoint_stage_index` and this sentence must tell the same story. Every number here
    is a ladder POSITION (an index into the transcript), the same count that column carries, and the
    name in brackets is what identifies the tier. The two can differ: `_run_ladder` reports a stage
    that ended UNKNOWN (a stop landing mid-stage with no incumbent) as well, but only a stage with a
    solution writes `checkpoint_stage_index` — so the sentence names the kept stage separately rather
    than letting the transcript's length impersonate it.

    **The leading word is DERIVED from the status, never hardcoded.** This string reaches the author
    verbatim through `GenerationJobView.error`, and `stopped` and `interrupted` are sibling statuses
    with different meanings — a `stopped` row opening with "interrupted by" would tell the author the
    platform took their solve away when in fact they asked for it. Deriving it also keeps S-304's
    rendering byte-identical: `interrupted` + "container shutdown" still reads
    "interrupted by container shutdown: …".
    """
    ended = len(result.stages)
    solved = (position for position, stage in enumerate(result.stages, 1) if stage.best is not None)
    kept = max(solved, default=0)
    if ended == 0:
        story = "before any stage finished — nothing was kept"
    elif kept == ended:
        story = f"after stage {ended} ({result.stages[-1].name}) — the board kept is that stage's checkpoint"
    elif kept == 0:
        story = (
            f"during stage {ended} ({result.stages[-1].name}) — no board had been found, so nothing was kept"
        )
    else:
        story = (
            f"during stage {ended} ({result.stages[-1].name}) — the board kept is stage {kept} "
            f"({result.stages[kept - 1].name})'s checkpoint"
        )
    finished = ", not a finished ladder" if kept else ""
    return f"{stop.status} by {stop.cause}: the solve was stopped {story}{finished}"


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


class _Heartbeat:
    """A timer thread that renews `heartbeat_at` while a solve is in flight — and, since S-305, the
    cadence at which `stop_requested_at` is observed.

    An EMPTY progress payload is a pure heartbeat: :meth:`JobRowClient.progress` adds `heartbeat_at`
    to whatever it is handed, is filtered `status=eq.running`, and never raises — so a beat cannot
    resurrect a row the app has already reclaimed, and cannot cost a solve.

    **The stop poll is the beat's RETURN VALUE, not a second request.** `progress` already reads the
    matched row back (`return=representation`), so widening its projection by one scalar column made
    every beat a stop poll for free: no extra request, no extra thread, no extra grant. When a beat
    comes back carrying a non-null `stop_requested_at`, this thread fires the latch through the
    callback it was constructed with — and never writes a status itself. The worker thread owns the
    terminal write, which is what keeps exactly one writer per job.

    **It fires at most once.** The row stays `running` until the worker's terminal write lands, so
    the flag keeps coming back on every subsequent beat while the ladder winds down.
    `JobRegistry.request_stop` is idempotent, but re-invoking `stop_search()` every 15 s on a solve
    that is already ending is noise, so the thread remembers that it has fired.

    It holds its OWN client, from the same factory. `JobRowClient` is documented not thread-safe
    (its token cache is an unlocked check-then-act), and the alternative — sharing the worker's —
    would put two threads through that cache at token-refresh time. The second client signs in
    lazily, so a solve that finishes inside one interval never mints a second token at all.
    """

    def __init__(
        self,
        job_id: str,
        client: JobRowClient,
        interval_s: float,
        request_stop: Callable[[], bool] | None = None,
    ) -> None:
        self._job_id = job_id
        self._client = client
        self._interval_s = interval_s
        # A callback rather than the registry itself: the timer needs exactly one verb, and closing
        # over it at the construction site keeps `_Heartbeat` free of any knowledge of `JobRegistry`.
        # Optional so a test can build a pure heartbeat.
        self._request_stop = request_stop
        self._stop_fired = False
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._beat, name=f"heartbeat-{job_id}", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        """Ask the timer to finish, wait for it, then close its client — in that order.

        Closing first would make an in-flight beat raise inside httpx on the other thread. If the
        join times out the client is deliberately LEAKED rather than closed under a live request:
        one abandoned connection until the process exits is cheaper than a mystery traceback, and
        the thread is a daemon so it can never hold the container open.
        """
        self._stop.set()
        self._thread.join(timeout=HEARTBEAT_JOIN_TIMEOUT_S)
        if self._thread.is_alive():
            log.warning(
                "job %s: the heartbeat thread did not stop in time; leaving its client open", self._job_id
            )
            return
        self._client.close()

    def _beat(self) -> None:
        """`wait` rather than `sleep`: it returns True the moment the stop is set, so shutdown is
        immediate instead of costing up to a full interval."""
        while not self._stop.wait(self._interval_s):
            try:
                self._observe(self._client.progress(self._job_id, {}))
            except Exception:  # noqa: BLE001 — the watchdog must never be what kills the solve
                log.exception("job %s: heartbeat write failed", self._job_id)

    def _observe(self, row: dict[str, Any] | None) -> None:
        """Fire the latch the first time a beat comes back with the author's stop request on it.

        `None` is every uninteresting case at once — the write failed, or matched no row because the
        job is already terminal — and none of them is something to stop.
        """
        if self._stop_fired or self._request_stop is None:
            return
        if row is None or row.get("stop_requested_at") is None:
            return
        self._stop_fired = True
        log.info(
            "job %s: the author asked for a stop — latching; the worker writes the outcome", self._job_id
        )
        self._request_stop()
