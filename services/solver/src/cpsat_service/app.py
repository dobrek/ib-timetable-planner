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

import json
import logging
from pathlib import Path
from typing import Any, Final
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request, status
from jsonschema import Draft202012Validator
from jsonschema.protocols import Validator

from .registry import JobRegistry
from .runner import start_job
from .settings import settings

log = logging.getLogger("cpsat_service.app")

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

app = FastAPI(title="CP-SAT solver service", version="0.1.0")
registry = JobRegistry()


@app.get("/health")
def health() -> dict[str, str]:
    """Dependency-free on purpose: a platform probe hits this before secrets are wired, and a health
    endpoint that needs the database reports the database's health, not the container's."""
    return {"status": "ok"}


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
    if not registry.register(key):
        log.info("job %s is already running in this process — accepting the retry as a no-op", key)
        return {"status": "already running", "jobId": key}

    start_job(key, body, settings=settings, registry=registry)
    return {"status": "accepted", "jobId": key}


async def _json_body(request: Request) -> Any:
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
    except OSError:
        log.exception("could not read the wire contract at %s", SCHEMA_PATH)
        return None
    return Draft202012Validator(schema).evolve(schema=schema["$defs"]["SolveRequest"])


_SOLVE_REQUEST_VALIDATOR: Final = _build_validator()
