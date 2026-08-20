#!/bin/sh
# Tier 1 — run the CP-SAT solver service natively on :8000. The daily development loop, and what
# CI's integration lane runs (directly, not through mise).
#
# Everything here beyond `uv run uvicorn` is one fail-fast credential guard, and it lives in this
# LAUNCHER rather than in `settings.py` deliberately: the service must boot unconfigured so `/health`
# answers on a bare container before secrets are wired. That tolerance is right in a container and a
# trap on a developer's machine, so the asymmetry belongs here — see README § Tier 1 — native (the
# default) and context/foundation/lessons.md, "put the fail-fast guard in the launcher, not in the
# service". `image-smoke.sh` carries the same guard for the same reason.
#
#   mise run solver:dev
#   requires: SUPABASE_URL · SUPABASE_KEY · SOLVER_MACHINE_PASSWORD  (refuses without all three)
#   optional: SOLVER_WORKERS · SOLVER_MAX_CONCURRENT_JOBS · SOLVER_LOG_LEVEL (read by the service)
#             SOLVER_STAGE_TARGETS=tier=value[,tier=value] (e.g. 3=95,6=900) — stop those ladder
#             stages once they reach the value instead of burning the budget. Unset = today's
#             behaviour; shipping VALUES is S-308's, this is the knob that lets you measure them.
#
# See README § Running the solver service (dev) and docs/runbooks/solver-credential.md.
set -eu

cd "$(dirname "$0")/../.." || exit 1

. scripts/solver/common.sh

missing=""
if [ -z "${SUPABASE_URL:-}" ]; then missing="$missing SUPABASE_URL"; fi
if [ -z "${SUPABASE_KEY:-}" ]; then missing="$missing SUPABASE_KEY"; fi
if [ -z "${SOLVER_MACHINE_PASSWORD:-}" ]; then missing="$missing SOLVER_MACHINE_PASSWORD"; fi
if [ -n "$missing" ]; then
  echo "solver:dev is missing:$missing" >&2
  echo >&2
  echo "  set -a; . .envs/local.vars; set +a      # SUPABASE_URL + SUPABASE_KEY" >&2
  echo "  export SOLVER_MACHINE_PASSWORD='...'   # what you gave provision-solver-user.mjs" >&2
  echo >&2
  echo "Starting without these would look healthy and then refuse every dispatch with a 503: the" >&2
  echo "job row marked 'failed' and its clone deleted. See README § Running the solver service." >&2
  exit 1
fi

# The package owns a dedicated venv (ortools pins protobuf/numpy tightly), so uv must run from the
# package directory. This replaces the `dir` the mise task used to supply — the script self-locates
# to the repo root first, which is what makes it correct from any cwd.
cd services/solver || exit 1
uv run uvicorn cpsat_service.app:app --port 8000
