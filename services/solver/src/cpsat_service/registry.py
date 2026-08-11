"""The in-process map of running jobs: `job_id -> (thread, live CpSolver handle)`.

Two jobs, one structure.

**Today (F-302) it is the in-process idempotency guard.** A dispatch retry after a slow 202 would
otherwise start a second solve on the same row, with two workers interleaving status writes.
:meth:`JobRegistry.register` returns False for an id already present, so the second POST is accepted
(202, idempotent) but starts nothing. This is layer (a) of research R10; layer (b) — the durable one
that survives a container restart clearing this map — is the `status=eq.queued` compare-and-set in
`supabase.py`.

**Tomorrow (S-303/S-305) it is the seam.** Interrupting a running solve requires holding a reference
to the live `CpSolver`, and the engine constructs solvers internally. Carrying the slot now costs a
few lines and is what keeps "Stop & keep" from becoming a wrapper rewrite. No stop BEHAVIOUR is
built here — only the place to reach for.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any


@dataclass
class JobEntry:
    """One running job. ``solver`` is populated by the runner once the engine exposes its handle;
    it stays None for the whole of F-302, which builds no stop path."""

    job_id: str
    thread: threading.Thread | None = None
    solver: Any = field(default=None)


class JobRegistry:
    """Thread-safe. Every mutation takes the lock — the HTTP thread registers while worker threads
    complete, so the two genuinely race."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._entries: dict[str, JobEntry] = {}

    def register(self, job_id: str) -> bool:
        """Claim the id in-process. False when it is already registered — the caller must NOT start
        a second solve, and should still answer 202 (the job is running; the retry is a no-op)."""
        with self._lock:
            if job_id in self._entries:
                return False
            self._entries[job_id] = JobEntry(job_id=job_id)
            return True

    def attach_thread(self, job_id: str, thread: threading.Thread) -> None:
        """Record the worker thread. Separate from :meth:`register` because registration must
        happen BEFORE the thread is spawned — otherwise two concurrent POSTs both start one."""
        with self._lock:
            entry = self._entries.get(job_id)
            if entry is not None:
                entry.thread = thread

    def attach_solver(self, job_id: str, solver: Any) -> None:
        """The S-303/S-305 seam: hand the registry the live solver handle. Unused in F-302."""
        with self._lock:
            entry = self._entries.get(job_id)
            if entry is not None:
                entry.solver = solver

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
