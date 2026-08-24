"""The FastAPI surface: `GET /health` and `POST /jobs/{job_id}/solve`.

**The contract file IS the validator.** The body is checked against
`contracts/generation-wire.schema.json#/$defs/SolveRequest` with a validator compiled once at
import — never against a Pydantic projection of it. That is an architectural choice, not an
ergonomic one: the schema is owned by neither the TypeScript nor the Python side, and a third
projection of it would be free to drift from both, which is precisely what the contract exists to
prevent. It also means `additionalProperties: false` is enforced for free, so a body carrying a
`jobId` is rejected rather than silently ignored — the id travels in the path.

Without this the failure would be a bare `KeyError` from `parse_snapshot`, surfacing as a 500 on a
request that was simply malformed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Final
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request, status
from jsonschema import Draft202012Validator
from jsonschema.protocols import Validator

from .registry import JobRegistry, Registration
from .runner import SHUTDOWN_REASON, start_job
from .settings import Settings, settings
from .supabase import REQUIRED_ROLE, JobRowClient

log = logging.getLogger("cpsat_service.app")

# How long the shutdown waits for the worker threads to land their terminal writes. Cloudflare grants
# SIGTERM -> 15 minutes -> SIGKILL, and the worst case here is one terminal write exhausting its
# retry ladder (~40 s), so 120 s is generous inside the window and still bounded — uvicorn awaits the
# lifespan shutdown UNBOUNDED, so nothing outside this constant would ever cut a wedged join short.
SHUTDOWN_JOIN_BUDGET_S: Final = 120.0

# Uvicorn configures ONLY its own `uvicorn.*` loggers and leaves the root logger at WARNING, so
# without this every `log.info` in this package is silently dropped — including the CAS-loss line,
# which is the sole signal that a redispatch was refused. Measured on the first real run against
# the local stack: the request log appeared, the runner's did not. `basicConfig` is a no-op when
# root already has handlers, so a host that configures its own logging keeps it.
logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

# `parents[4]`, one deeper than `tests/test_contract.py`'s `parents[3]`:
#   services/solver/src/cpsat_service/app.py -> cpsat_service -> src -> solver -> services -> REPO
# It also assumes a repo CHECKOUT — `contracts/` is not in the wheel — so S-302's container image
# must COPY the directory in. Anchoring on `__file__` rather than the cwd is what makes uvicorn's
# working directory irrelevant.
REPO_ROOT: Final = Path(__file__).resolve().parents[4]
SCHEMA_PATH: Final = REPO_ROOT / "contracts" / "generation-wire.schema.json"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Announce the effective configuration and prove the credential; on the way out, stop cleanly.

    **Startup.** Both halves exist because the alternative is silence. `sign_in()` is otherwise LAZY
    — first called from the worker thread, after the handler has already answered 202 — and
    `runner._claim` swallows what it raises, so a wrong role would leave the row `queued` forever
    with one log line as its entire trace. Asserting at boot instead makes the failure visible and
    self-cleaning: uvicorn exits non-zero on a lifespan error, the port never binds,
    `startAndWaitForPorts` fails, and the dispatch error already marks the row `failed`.

    `/health` stays dependency-free on purpose — the check lives here, not in the endpoint.

    **Shutdown (S-304).** This is the ONE reliable hook the platform grants us. Cloudflare sends
    SIGTERM and waits up to 15 minutes; uvicorn's own graceful shutdown knows about ASGI connections
    and nothing at all about the `daemon=True` solve threads, so without a body here the interpreter
    finalizes and CPython kills a running solve at an arbitrary bytecode boundary — S-302 measured
    the whole sequence completing inside 100 ms. See :func:`_shutdown` for the sequence.

    **Footnote, and it inverts the obvious guess.** A second *SIGINT* sets uvicorn's `force_exit`
    and skips the lifespan entirely (`server.py:301,344-345`); a second *SIGTERM* does not.
    Cloudflare sends one SIGTERM, so production is unaffected — the hazard is a tier-1 drill where
    an impatient second Ctrl-C aborts the very write it was run to observe.
    """
    _log_startup(settings)
    _verify_credential(settings)
    yield
    await _shutdown(registry)


app = FastAPI(title="CP-SAT solver service", version="0.1.0", lifespan=lifespan)
registry = JobRegistry(capacity=settings.max_concurrent_jobs)


@app.get("/health")
def health() -> dict[str, str]:
    """Dependency-free on purpose: a platform probe hits this before secrets are wired, and a health
    endpoint that needs the database reports the database's health, not the container's."""
    return {"status": "ok"}


@app.get("/jobs/active")
def active_jobs() -> dict[str, int]:
    """How many solves are in flight, from the in-process registry alone — no database touch.

    The Durable Object asks this before it lets `sleepAfter` stop the container (S-304's
    `onActivityExpired` override), so it has to be answerable on a bare container for the same
    reason `/health` is: an unconfigured container is not solving, and saying so must not require a
    credential. CP-SAT releases the GIL during search, so a busy solver genuinely does answer.
    """
    return {"active": len(registry)}


@app.post("/jobs/{job_id}/solve", status_code=status.HTTP_202_ACCEPTED)
async def solve(job_id: UUID, request: Request) -> dict[str, str]:
    """Accept a solve job: validate, register, spawn, return 202. The result arrives minutes later
    through the database row — this response only says the service took the work.

    A duplicate POST for an already-registered job is **also** 202 and starts nothing: dispatch is
    idempotent, and answering 409 would make a harmless retry look like an error to the caller.
    """
    body = await _json_body(request)
    _validate(body)

    key = str(job_id)
    if not settings.configured:
        # An unconfigured container still boots (so `/health` answers bare), but it must not TAKE
        # work: a 202 here would spawn a worker that fails at its first database call, `_claim`
        # would swallow it, and the row would sit `queued` with an orphan clone — nothing in the UI.
        # A 503 rides the dispatch caller's existing compensation path (row → failed, clone deleted).
        log.error("job %s refused: the solver is not configured, so it could never claim it", key)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="the solver is not configured — SUPABASE_URL, SUPABASE_KEY or "
            "SOLVER_MACHINE_PASSWORD is missing",
        )
    outcome = registry.register(key)

    if outcome is Registration.ALREADY_RUNNING:
        log.info("job %s is already running in this process — accepting the retry as a no-op", key)
        return {"status": outcome.value, "jobId": key}

    if outcome is Registration.AT_CAPACITY:
        # The one non-202. Accepting past the cap would not run the job sooner — it would starve the
        # solves already running and the `/health` answer that keeps this container alive.
        log.warning("job %s refused: %d solve(s) already running", key, settings.max_concurrent_jobs)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"the solver is already running {settings.max_concurrent_jobs} job(s) — retry later",
        )

    try:
        start_job(key, body, settings=settings, registry=registry)
    except Exception:
        # Release is otherwise the WORKER's `finally` — which never runs if the thread never
        # started. A stranded entry makes every later dispatch for this id a 202 no-op while the row
        # sits `queued` forever, clearable only by a restart: exactly the silent failure this
        # service is built to avoid.
        registry.release(key)
        raise
    return {"status": outcome.value, "jobId": key}


async def _shutdown(live: JobRegistry) -> None:
    """Latch every live job, then wait (bounded) for its own worker to write the terminal row.

    **The worker does the writing, not this.** `registry.stop_all` fires each job's stop latch and
    calls `stop_search()` on the live solver; the engine's ladder then unwinds, `_solve_and_write`
    reads the latch and PATCHes `interrupted` with the transcript. Routing shutdown through the
    existing writer is what keeps exactly one writer per row — a second one here would race the
    worker for the same PATCH.

    The joins run via :func:`asyncio.to_thread` because this body executes on the event loop, and a
    blocking join here would starve the rest of uvicorn's shutdown sequence.

    A job that misses the budget is logged and abandoned: its row stays `running`, and the app's
    stale-heartbeat reclaim is the net under it. That is the whole point of building both halves.
    """
    threads = live.stop_all(SHUTDOWN_REASON)
    if not threads:
        log.info("shutdown: no solve in flight")
        return
    log.warning(
        "shutdown: asked %d solve(s) to stop; waiting up to %.0fs for their terminal writes",
        len(threads),
        SHUTDOWN_JOIN_BUDGET_S,
    )
    started = time.monotonic()
    stragglers = await asyncio.to_thread(_join_within, threads, SHUTDOWN_JOIN_BUDGET_S)
    if stragglers:
        log.error(
            "shutdown: %d solve(s) did not finish within %.0fs — their rows stay `running` until the "
            "app reclaims them on the author's next visit: %s",
            len(stragglers),
            SHUTDOWN_JOIN_BUDGET_S,
            ", ".join(thread.name for thread in stragglers),
        )
        return
    log.info("shutdown: every solve wrote its terminal row in %.1fs", time.monotonic() - started)


def _join_within(threads: list[threading.Thread], budget_s: float) -> list[threading.Thread]:
    """Join each thread against one SHARED deadline, and report whoever is still alive.

    Shared rather than per-thread: `SOLVER_MAX_CONCURRENT_JOBS` can be raised, and a per-thread
    budget would multiply the wait by the job count — straight past the platform's SIGKILL.
    """
    deadline = time.monotonic() + budget_s
    for thread in threads:
        thread.join(timeout=max(0.0, deadline - time.monotonic()))
    return [thread for thread in threads if thread.is_alive()]


def _log_startup(current: Settings) -> None:
    """The effective, non-secret configuration, once — never the password or the key.

    This is the line a production smoke reads to prove `SOLVER_WORKERS` is what the container config
    set rather than what `settings.py` defaults to, and the line that catches the `contracts/` trap
    at boot instead of at the first 500: a wrong image layout leaves the validator None while
    `/health` stays green.
    """
    log.info(
        "solver service starting: workers=%d max_concurrent_jobs=%d stage_targets=%s log_level=%s "
        "machine_email=%s supabase_url=%s credential_configured=%s wire_contract=%s",
        current.workers,
        current.max_concurrent_jobs,
        dict(sorted(current.stage_targets.items())) or "<none>",
        current.log_level,
        current.machine_email,
        current.supabase_url or "<unset>",
        current.configured,
        "loaded" if _SOLVE_REQUEST_VALIDATOR is not None else f"UNREADABLE at {SCHEMA_PATH}",
    )


def _verify_credential(current: Settings) -> None:
    """Sign in once and let `assert_role` refuse anything but the narrow role — fatally.

    Fatal is the point: absence of the Custom Access Token Hook fails *upward* into a token that
    reaches every table, so "don't start" is the only safe answer. An unconfigured container skips
    the check entirely and still answers `/health`, exactly as `settings.py` promises — that is what
    a platform probe hits before secrets are wired, and how the tier-2 image smoke boots.
    """
    if not current.configured:
        log.warning(
            "Supabase is not configured — skipping the startup credential check; /health will "
            "answer, and the first solve will fail loudly at its first database call"
        )
        return
    client = JobRowClient(current)
    try:
        client.sign_in()
    except Exception:
        log.exception(
            "the startup credential check failed — refusing to start. If the role claim is the "
            "cause, enable the Custom Access Token Hook and re-verify: "
            "docs/runbooks/solver-credential.md § Hosted enablement"
        )
        raise
    finally:
        client.close()
    log.info("startup credential check passed: the access token carries role=%s", REQUIRED_ROLE)


async def _json_body(request: Request) -> Any:
    """Require `application/json` before reading a byte.

    Not pedantry, and not something jsonschema can do for us: `application/json` is NOT a CORS
    *simple* content type, so demanding it is what forces a browser to preflight — and a preflight
    this service never answers is a request it never sees. Without the check, a page open in a
    developer's browser while `mise run solver:dev` is up can POST a `text/plain` body to a known
    job id with no preflight at all. See the trust-boundary note in `services/solver/README.md`.
    """
    media_type = request.headers.get("content-type", "").partition(";")[0].strip().lower()
    if media_type != "application/json":
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="body must be sent as application/json"
        )
    try:
        return json.loads(await request.body())
    except ValueError as error:
        detail = f"body is not JSON: {error}"
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail) from error


def _validate(body: Any) -> None:
    """Reject at the boundary with the schema's own error paths — a caller must be able to see WHICH
    field was wrong, which is the whole difference between this and a 500 from a `KeyError`."""
    errors = [f"{list(e.absolute_path)} {e.message}" for e in _validator().iter_errors(body)]
    if errors:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"schema": "SolveRequest", "errors": errors},
        )


def _validator() -> Validator:
    """Compiled once at import (see below); this indirection exists so the module still imports when
    the contracts directory is absent, failing at request time with a legible message instead."""
    if _SOLVE_REQUEST_VALIDATOR is None:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"the wire contract is not readable at {SCHEMA_PATH} — the image must COPY contracts/",
        )
    return _SOLVE_REQUEST_VALIDATOR


def _build_validator() -> Validator | None:
    """`evolve(schema=...)` keeps the root-anchored resolver, so the subschema's internal `$ref`s
    (`GeneratorSnapshot`, `GeneratedPlacement`, …) still resolve — the same construction the
    contract test uses."""
    try:
        schema = json.loads(SCHEMA_PATH.read_text())
    except (OSError, ValueError):
        # ValueError covers `JSONDecodeError` on a truncated or half-copied contract file. Catching
        # only OSError would let that case kill the import — defeating the `None` fallback above,
        # whose entire purpose is that `/health` still answers when `contracts/` did not make it in.
        log.exception("could not read the wire contract at %s", SCHEMA_PATH)
        return None
    return Draft202012Validator(schema).evolve(schema=schema["$defs"]["SolveRequest"])


_SOLVE_REQUEST_VALIDATOR: Final = _build_validator()
