#!/bin/sh
# The hosted-solve campaign — local app + NATIVE solver against the HOSTED database.
#
# It exists to compare plan and policy variations against real current data, cheaply and without
# spending Cloudflare container time. **It writes to production**: generation inserts
# `generation_jobs` rows, calls `clone_plan`, and applies placements on delivery. The banner below is
# the UX for that fact; the reasoning behind it, and what timing measured here is and is not worth,
# is README § The hosted-solve campaign.
#
# Rehearse it by pointing `.envs/prod-solver.vars` at the LOCAL stack — that exercises every branch
# here (profile validation, the :8000 guard, the banner, the prompt, the sed reads, the trap) without
# touching a hosted row.
#
#   mise run solver:hosted                          # prompts before doing anything
#   SOLVER_HOSTED_CONFIRM=yes mise run solver:hosted # skip the prompt
#   requires: .envs/prod-solver.vars carrying all four keys; :8000 free
#
# See README § The hosted-solve campaign and docs/runbooks/solver-credential.md § Hosted enablement.
set -eu

cd "$(dirname "$0")/../.." || exit 1

. scripts/solver/common.sh

profile=.envs/prod-solver.vars

if [ ! -f "$profile" ]; then
  echo "$profile does not exist. It is gitignored and per-machine — create it with:" >&2
  echo >&2
  echo "  SUPABASE_URL=https://<project-ref>.supabase.co" >&2
  echo "  SUPABASE_KEY=<hosted PUBLISHABLE key>" >&2
  echo "  SOLVER_URL=http://127.0.0.1:8000" >&2
  echo "  SOLVER_MACHINE_PASSWORD=<hosted machine user password>" >&2
  echo >&2
  echo "See README § Environment Profiles. Hosted enablement must be done first (S-302 Phase 6)." >&2
  exit 1
fi

# A present-but-empty key must fail too: the service boots happily unconfigured (so /health can
# answer on a bare container) and its credential check skips itself, so "solver is up" below would
# be true and every hosted Generate would 503. The key must carry a value, not just exist.
missing=""
for key in SUPABASE_URL SUPABASE_KEY SOLVER_URL SOLVER_MACHINE_PASSWORD; do
  grep -q "^$key=.\{1,\}" "$profile" || missing="$missing $key"
done
if [ -n "$missing" ]; then
  echo "$profile is missing (or has empty):$missing" >&2
  exit 1
fi

# :8000 must be OURS. If a tier-1 `solver:dev` (pointed at the LOCAL stack) already holds the port,
# the hosted uvicorn fails to bind and exits, the /health wait below passes against the wrong
# process, and every Generate then inserts a HOSTED job row + clone that the local solver cannot
# claim - production rows wedged at `queued`. Refuse up front rather than discover it in the data.
# `lsof` missing would make the `if` below false (exit 127) and wave the campaign through — this guard
# must fail closed, so require the tool first.
command -v lsof >/dev/null 2>&1 || die "lsof is required for the :8000 ownership check and was not found on PATH."
if lsof -nP -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "something is already listening on :8000 (a running 'mise run solver:dev'?)." >&2
  echo "The campaign must own that port, or the app would dispatch HOSTED jobs to it. Stop it first:" >&2
  lsof -nP -iTCP:8000 -sTCP:LISTEN >&2 || true
  exit 1
fi

echo "############################################################################"
echo "#  HOSTED-SOLVE CAMPAIGN - THIS WRITES TO PRODUCTION                       #"
echo "############################################################################"
echo "#  Generation is not read-only. This run will, on the HOSTED database:     #"
echo "#    * insert generation_jobs rows                                         #"
echo "#    * call clone_plan, creating real proposal plans that accumulate       #"
echo "#    * apply placements on delivery                                        #"
echo "#                                                                          #"
echo "#  DO NOT LET THIS MACHINE SLEEP. The claim CAS filters status=eq.queued,  #"
echo "#  so a solve interrupted mid-flight leaves a PRODUCTION row stuck at      #"
echo "#  'running', unclaimable until S-304 widens it - recovery today is manual #"
echo "#  SQL against hosted. caffeinate -i is used below, but it cannot survive  #"
echo "#  a lid close or a flat battery.                                          #"
echo "#                                                                          #"
echo "#  TIMING MEASURED HERE IS INVALID (M-series, 8 workers vs the container's #"
echo "#  4). Board QUALITY and policy comparisons are legitimate.                #"
echo "############################################################################"
echo

if [ "${SOLVER_HOSTED_CONFIRM:-}" != "yes" ]; then
  printf "Type 'hosted' to continue: "
  read -r answer
  if [ "$answer" != "hosted" ]; then
    echo "aborted - nothing was changed." >&2
    exit 1
  fi
fi

cleanup() {
  echo
  echo "stopping the solver and restoring the local profile"
  if [ -n "${SOLVER_PID:-}" ]; then
    pkill -P "$SOLVER_PID" 2>/dev/null || true
    kill "$SOLVER_PID" 2>/dev/null || true
  fi
  pnpm env:local >/dev/null
  echo "back on .envs/local.vars - rebuild before the next pnpm preview"
}
# Two traps, not one — see the same split in tier3.sh for the measurement behind it. EXIT owns the
# cleanup (it runs on every exit path, signals included); INT/TERM only `exit`, which is what makes
# the script STOP rather than resume into `pnpm build` / `pnpm preview` after cleanup has already
# torn the profile down. That resume is exactly what the single-trap form did, in the inline body
# too, and it is the sharpest version of the bug here: the campaign would serve a preview against a
# profile that had just been restored to local.
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

pnpm env:prod-solver

# The solver reads the trio from ITS OWN environment, so the profile is read here rather than
# relying on the .env.local copy - `astro:env` feeds the app, never this process. READ, not
# sourced: the file is dotenv (bare literal values, as `.dev.vars` and `.env.local` will parse
# it), and executing it as shell would make a password carrying `$`, `;` or a backtick either
# mangled or run. `image-smoke.sh` reads its keys the same way. `caffeinate -i` keeps the
# machine awake for the whole solve; a sleeping laptop is the sharpest risk of this mode.
profile_value() {
  sed -n "s/^$1=//p" "$profile" | head -1 | tr -d '\r' | sed -e "s/^'\(.*\)'\$/\1/" -e 's/^"\(.*\)"$/\1/'
}
solver_supabase_url=$(profile_value SUPABASE_URL)
solver_supabase_key=$(profile_value SUPABASE_KEY)
solver_machine_password=$(profile_value SOLVER_MACHINE_PASSWORD)

echo "starting the native solver against HOSTED Supabase"
if [ "$(uname)" = "Darwin" ]; then
  ( cd services/solver && SUPABASE_URL="$solver_supabase_url" SUPABASE_KEY="$solver_supabase_key" \
      SOLVER_MACHINE_PASSWORD="$solver_machine_password" \
      caffeinate -i uv run uvicorn cpsat_service.app:app --port 8000 ) &
else
  ( cd services/solver && SUPABASE_URL="$solver_supabase_url" SUPABASE_KEY="$solver_supabase_key" \
      SOLVER_MACHINE_PASSWORD="$solver_machine_password" \
      uv run uvicorn cpsat_service.app:app --port 8000 ) &
fi
SOLVER_PID=$!

# Liveness first: a solver that died (failed startup credential check, port taken after our
# check) must not leave us polling until something ELSE answers on :8000 — wait_for_health checks
# this predicate before every retry.
solver_alive() {
  kill -0 "$SOLVER_PID" 2>/dev/null
}

wait_for_health http://127.0.0.1:8000/health 60 solver_alive \
  "the solver process exited before answering /health - a failed startup credential check" \
  "looks like this. Is the hosted Custom Access Token Hook enabled and the machine user provisioned?"
echo "solver is up and its startup credential check passed"

pnpm build
pnpm preview
