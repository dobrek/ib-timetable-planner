# The CP-SAT solver service image. Built by `wrangler deploy` (production) and by
# `mise run solver:image:build` (tier-2 local fidelity).
#
# **The build context is the REPO ROOT, not this directory** (`image_build_context: "."` in
# `wrangler.jsonc`), and that is load-bearing rather than convenient: `cpsat_service/app.py:45`
# anchors the wire contract at `Path(__file__).resolve().parents[4]`, i.e. four levels above
# `src/cpsat_service/`, so the image must reproduce the repo-relative layout —
# `/app/services/solver/src/cpsat_service/app.py` beside `/app/contracts/`. Flattening
# `services/solver` to `/app` would make `parents[4]` clamp at `/` and look in `/contracts/`.
#
# That failure mode FAILS OPEN: `_build_validator()` swallows the OSError, the module still imports,
# `/health` still answers 200, and every solve 500s. `mise run solver:image:smoke` exists because of
# it — it POSTs a real golden `SolveRequest` and asserts 202, which probing `/health` cannot do.
#
# Base image pinned by TAG, not digest (recorded gap: this repo has no image vulnerability scanner
# to pair with `pnpm audit` / `uv audit`).
FROM python:3.13-slim

# The same uv the developer and the CI `solver` job build the venv with — `mise.toml`'s `uv = "..."`
# and both `astral-sh/setup-uv` `version:` inputs in `.github/workflows/ci.yml`. Move all four
# together; the point of the pin is one resolver across every path that produces this venv.
COPY --from=ghcr.io/astral-sh/uv:0.12.3 /uv /uvx /bin/

# `never` + an explicit interpreter path stops uv from downloading a SECOND Python 3.13 next to the
# base image's own (uv's default `python-preference` is `managed`, which prefers a download).
ENV UV_PYTHON_DOWNLOADS=never \
    UV_PYTHON=/usr/local/bin/python3.13

WORKDIR /app

# `contracts/` first: it changes far less often than solver sources, so it keeps the more expensive
# layer below out of the churn.
COPY contracts /app/contracts
COPY services/solver /app/services/solver

# `--locked` fails on a stale lockfile rather than resolving something `uv.lock` never recorded;
# `--no-dev` drops the dev group (mypy alone is ~55 MB of mypyc artefacts) — neither is a default.
#
# The sync happens AT THE FINAL PATH on purpose. `uv sync` installs the project editable, and the
# generated `_editable_impl_cpsat_engine.pth` records an ABSOLUTE path, so a multi-stage build that
# built the venv elsewhere and copied it in would import nothing.
WORKDIR /app/services/solver
RUN uv sync --locked --no-dev

# Non-root at runtime. Everything above is owned by root and world-readable, which is what we want:
# the process needs to read the venv and the contract, never to write either.
RUN useradd --create-home --uid 10001 solver
USER solver

# Runtime configuration (`SOLVER_WORKERS`, `SOLVER_MAX_CONCURRENT_JOBS`, `SOLVER_LOG_LEVEL`, and the
# credential trio) is deliberately NOT baked here: in production it arrives through the Container
# class's `envVars` (`src/solver-container.ts`), which is the only channel a Cloudflare container
# has — there is no `containers[].configuration.secrets`. Baking a default here would be a second,
# invisible source of truth for the values S-308 calibrates against.

# Needed for local port access under `wrangler dev` (tier 3). Production does not require it.
EXPOSE 8000

# `--host 0.0.0.0`, which neither `mise run solver:dev` nor the CI launcher passes and both are right
# not to: uvicorn's loopback default is correct for a process on the developer's machine, and fatal
# here — the container would be unreachable from the Worker while `/health` stayed green *inside* it.
#
# The venv's own entry point rather than `uv run`, so the runtime needs no uv, no lockfile check and
# no writable cache directory for the non-root user.
CMD ["/app/services/solver/.venv/bin/uvicorn", "cpsat_service.app:app", "--host", "0.0.0.0", "--port", "8000"]
