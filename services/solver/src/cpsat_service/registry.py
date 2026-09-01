"""The in-process map of running jobs: `job_id -> (thread, live CpSolver handle)`.

Two jobs, one structure.

**Today (F-302) it is the in-process idempotency guard.** A dispatch retry after a slow 202 would
otherwise start a second solve on the same row, with two workers interleaving status writes.
:meth:`JobRegistry.register` returns False for an id already present, so the second POST is accepted
(202, idempotent) but starts nothing. This is layer (a) of research R10; layer (b) — the durable one
that survives a container restart clearing this map — is the `status=eq.queued` compare-and-set in
`supabase.py`.

**Since S-304 it is also the stop seam, with behaviour.** Interrupting a running solve requires
holding a reference to the live `CpSolver` (S-303 wired `SolveHooks.on_solver` for exactly that), and
it requires a LATCH the ladder can see between stages — `stop_search()` alone interrupts one solve
and the ladder marches into the next tier. :meth:`JobRegistry.request_stop` sets both, under the
lock, and :meth:`JobRegistry.stop_all` does it for every live job and hands back the threads to join.

One latch, two producers: the lifespan's SIGTERM path fires it with reason `"shutdown"` (S-304), and
the heartbeat's `stop_requested_at` poll fires it with `"requested"` (S-305). The runner maps the
reason to the terminal status — `interrupted` and `stopped` respectively — so the second producer
cost a key in `STOP_OUTCOMES` and no second stop mechanism.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

log = logging.getLogger("cpsat_service.registry")


class Registration(Enum):
    """What :meth:`JobRegistry.register` did — three outcomes, three HTTP answers.

    ``AT_CAPACITY`` is the only one that is not a 202: a solve holds `SOLVER_WORKERS` CP-SAT workers
    for as long as the tier ladder runs, so an uncapped registry turns a burst of dispatches into a
    container that starves its own `/health` and gets killed mid-solve on every job at once.
    """

    ACCEPTED = "accepted"
    ALREADY_RUNNING = "already running"
    AT_CAPACITY = "at capacity"


@dataclass
class JobEntry:
    """One running job. ``solver`` holds the CP-SAT solver currently searching, handed over by the
    runner through the engine's ``on_solver`` hook and overwritten per stage — the latest handle is
    the live one. It is None before the first stage and after the last.

    ``stop`` is the latch the engine polls through ``SolveHooks.should_stop``; ``stop_reason`` says
    who fired it, and is what the runner maps to a terminal status. First writer wins — a second
    producer arriving mid-shutdown must not rewrite the story of why the solve ended.
    """

    job_id: str
    thread: threading.Thread | None = None
    solver: Any = field(default=None)
    stop: threading.Event = field(default_factory=threading.Event)
    stop_reason: str | None = None


class JobRegistry:
    """Thread-safe. Every mutation takes the lock — the HTTP thread registers while worker threads
    complete, so the two genuinely race."""

    def __init__(self, capacity: int | None = None) -> None:
        self._lock = threading.Lock()
        self._entries: dict[str, JobEntry] = {}
        self._capacity = capacity

    def register(self, job_id: str) -> Registration:
        """Claim the id in-process, under the lock, so the capacity check and the insert cannot be
        interleaved — a `len()` read outside the lock would let two concurrent POSTs both pass it.

        ``ALREADY_RUNNING`` means the caller must NOT start a second solve and should still answer
        202: the job is running and the retry is a no-op.
        """
        with self._lock:
            if job_id in self._entries:
                return Registration.ALREADY_RUNNING
            if self._capacity is not None and len(self._entries) >= self._capacity:
                return Registration.AT_CAPACITY
            self._entries[job_id] = JobEntry(job_id=job_id)
            return Registration.ACCEPTED

    def attach_thread(self, job_id: str, thread: threading.Thread) -> None:
        """Record the worker thread. Separate from :meth:`register` because registration must
        happen BEFORE the thread is spawned — otherwise two concurrent POSTs both start one."""
        with self._lock:
            entry = self._entries.get(job_id)
            if entry is not None:
                entry.thread = thread

    def attach_solver(self, job_id: str, solver: Any) -> None:
        """Record the solver that is searching right now — called once per stage, latest wins.

        Overwriting rather than accumulating is the correct semantics: only one solver is live at a
        time, and it is the one a stop would have to interrupt. Mode A's clean fallback solves twice
        for a single stage, so this genuinely fires more than once per stage report."""
        with self._lock:
            entry = self._entries.get(job_id)
            if entry is not None:
                entry.solver = solver

    def request_stop(self, job_id: str, reason: str) -> bool:
        """Ask one job to stop, recording why. True iff the job was live to be asked.

        The caller does NOT write the row: the worker thread owns the terminal write, and routing
        every outcome through it is what keeps exactly one writer per job (B12's one-way dependency).
        """
        with self._lock:
            entry = self._entries.get(job_id)
            if entry is None:
                return False
            _latch(entry, reason)
            return True

    def stop_all(self, reason: str) -> list[threading.Thread]:
        """Latch every live job and return their worker threads, for the caller to join.

        Joining happens OUTSIDE the lock — deliberately. A worker's `finally` calls
        :meth:`release`, which takes this same lock, so joining while holding it would deadlock the
        shutdown against the very threads it is waiting for.
        """
        with self._lock:
            entries = list(self._entries.values())
            for entry in entries:
                _latch(entry, reason)
            return [entry.thread for entry in entries if entry.thread is not None]

    def get(self, job_id: str) -> JobEntry | None:
        with self._lock:
            return self._entries.get(job_id)

    def release(self, job_id: str) -> None:
        """Drop the entry. Called from the worker's `finally`, so a crashed solve does not leave the
        job permanently un-redispatchable."""
        with self._lock:
            self._entries.pop(job_id, None)

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)


def _latch(entry: JobEntry, reason: str) -> None:
    """Record the reason, fire the latch, then interrupt the live solver — in that order.

    Order matters. A reader that sees ``stop.is_set()`` must already be able to see the reason, so
    the reason is written first; the event is what publishes it. ``stop_search()`` comes last and is
    only a *speed-up* — it ends the current solve immediately instead of at the next improving
    solution — so a solver handle that refuses to be interrupted must not stop the latch from having
    been set.
    """
    if entry.stop_reason is None:
        entry.stop_reason = reason
    entry.stop.set()
    solver = entry.solver
    if solver is None:
        return
    try:
        solver.stop_search()
    except Exception:  # noqa: BLE001 — one uncooperative handle must not strand the other jobs
        log.exception(
            "job %s: could not interrupt the live solver; the latch is set regardless", entry.job_id
        )
