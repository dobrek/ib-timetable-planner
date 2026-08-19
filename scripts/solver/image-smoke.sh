#!/bin/sh
# Tier 2b — boot the built image against the local Supabase stack and POST a real golden
# `SolveRequest`, asserting 202.
#
# A `/health` probe is NOT sufficient here, and that is the whole point of this task: the contract
# validator fails OPEN, so a wrong image layout leaves `/health` green while every solve 500s. Only a
# real request body tells the two apart — see CLAUDE.md § Solver package and README § Tier 2 — the
# container image.
#
# The credential guard below is the same one `dev.sh` carries, for the same reason (the service boots
# unconfigured by design), with one extra edge: the container signs in at STARTUP, so an unset
# password makes it exit before binding :8000 rather than fail later.
#
#   SOLVER_MACHINE_PASSWORD='…' mise run solver:image:smoke     # needs Docker Desktop running
#   requires: SOLVER_MACHINE_PASSWORD; SUPABASE_KEY (falls back to .envs/local.vars)
#   optional: SMOKE_JOB_ID — a real queued row, to watch a full advance instead of "not claimable"
#
# See README § Tier 2 — the container image.
set -eu

cd "$(dirname "$0")/../.." || exit 1

. scripts/solver/common.sh

image=ib-solver:local
container=ib-solver-smoke
job_id="${SMOKE_JOB_ID:-11111111-2222-4333-8444-555555555555}"

if [ -z "${SOLVER_MACHINE_PASSWORD:-}" ]; then
  echo "SOLVER_MACHINE_PASSWORD is unset. The container signs in at STARTUP, so it would exit" >&2
  echo "before binding :8000 rather than failing later. Export the password you provisioned with" >&2
  echo "scripts/provision-solver-user.mjs — the same way 'mise run solver:dev' gets it." >&2
  exit 1
fi

supabase_key="${SUPABASE_KEY:-}"
if [ -z "$supabase_key" ] && [ -f .envs/local.vars ]; then
  supabase_key=$(sed -n 's/^SUPABASE_KEY=//p' .envs/local.vars | head -1)
fi
if [ -z "$supabase_key" ]; then
  echo "No SUPABASE_KEY in the environment and none readable from .envs/local.vars." >&2
  echo "Export the local stack's PUBLISHABLE key (never the secret key)." >&2
  exit 1
fi

docker image inspect "$image" >/dev/null 2>&1 || {
  echo "$image does not exist — run 'mise run solver:image:build' first." >&2
  exit 1
}

docker rm -f "$container" >/dev/null 2>&1 || true
cleanup() {
  echo "--- container log -----------------------------------------------------------------"
  docker logs "$container" 2>&1 || true
  echo "-----------------------------------------------------------------------------------"
  docker rm -f "$container" >/dev/null 2>&1 || true
}
# EXIT owns the cleanup; INT/TERM only `exit` so the EXIT trap runs on a signal too — dash does
# NOT run an EXIT trap when killed by an untrapped SIGINT (bash does), and without it a Ctrl-C
# during the health wait would leave the container holding :8000 with no log dump. Same split as
# tier3.sh / hosted.sh.
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# `host.docker.internal` is how the container reaches the stack on the HOST; `--add-host` makes the
# name resolve on engines that do not provide it for free. The env trio is exactly what production
# forwards through the Container class's `envVars` — no secret key, no service-role key. The
# password goes in by NAME (`-e VAR`, inherited from our environment) so it never appears in
# `docker run`'s argv, where `ps` would show it for the run's duration.
export SOLVER_MACHINE_PASSWORD
docker run -d --name "$container" \
  --platform linux/amd64 \
  --add-host host.docker.internal:host-gateway \
  -p 8000:8000 \
  -e SUPABASE_URL=http://host.docker.internal:54321 \
  -e SUPABASE_KEY="$supabase_key" \
  -e SOLVER_MACHINE_PASSWORD \
  -e SOLVER_WORKERS=4 \
  -e SOLVER_MAX_CONCURRENT_JOBS=1 \
  -e SOLVER_LOG_LEVEL=INFO \
  "$image" >/dev/null

smoke_alive() {
  [ "$(docker inspect -f '{{.State.Running}}' "$container")" = "true" ]
}

wait_for_health http://127.0.0.1:8000/health 90 smoke_alive \
  "the container exited before binding :8000 — a FAILED STARTUP CREDENTIAL CHECK looks" \
  "exactly like this. Is the local Supabase stack up, and the machine user provisioned?"
echo "/health is up after ${WAITED_S}s"

body=$(mktemp)
code=$(curl -s -o "$body" -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  --data-binary @contracts/fixtures/solve-request.json \
  "http://127.0.0.1:8000/jobs/$job_id/solve")

if [ "$code" = "500" ]; then
  echo "500 on a KNOWN-VALID golden body — this is the contracts/ layout trap." >&2
  echo "The image must preserve <root>/services/solver/src/... beside <root>/contracts/ so that" >&2
  echo "app.py's parents[4] anchor resolves. Response body:" >&2
  cat "$body" >&2
  rm -f "$body"
  exit 1
fi
if [ "$code" != "202" ]; then
  echo "expected 202 from the golden SolveRequest, got $code:" >&2
  cat "$body" >&2
  rm -f "$body"
  exit 1
fi
rm -f "$body"
echo "202 accepted for job $job_id — the wire contract resolved inside the image"
echo
echo "With a job id that has no queued row the worker logs 'not claimable' and stops: that is the"
echo "expected smoke outcome. Set SMOKE_JOB_ID to a real queued row to watch a full advance."
