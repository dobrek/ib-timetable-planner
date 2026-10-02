#!/bin/sh
# The calibration campaign runner's launcher (S-308, automated) — preflight, banner, then the Node
# runner in bench/campaign/main.ts, which owns everything after that.
#
# It writes to PRODUCTION when `.envs/campaign.vars` says CAMPAIGN_TARGET=production: it clones a real
# plan, dispatches solves that rows record, switches the container's tuning through Worker secrets,
# and deletes what it created at cleanup. The same file with CAMPAIGN_TARGET=local rehearses every
# path against the local stack and a native solver, touching nothing hosted.
#
#   mise run solver:campaign -- status                 # journal only; safe at any moment
#   mise run solver:campaign -- run                    # prompts before writing to production
#   SOLVER_CAMPAIGN_CONFIRM=yes mise run solver:campaign -- run
#   requires: .envs/campaign.vars (keys below); for production a `wrangler` login and a clean tree
#
# The profile is READ with sed, never sourced — its values are bare dotenv literals, and a password
# carrying `$`, `;` or a backtick must reach the runner intact rather than be run. The hosted
# service-role key is exported to the runner under ANALYZER_SERVICE_ROLE_KEY, which the runner hands to
# its `pnpm analyze:jobs` subprocess only; nothing writes it to `.env.test.local`, `.env.local` or
# `.dev.vars` (those feed the integration lane, which WRITES with whatever key it is given).
#
# See docs/runbooks/calibration-campaign.md for the two-day schedule and recovery.
set -eu

cd "$(dirname "$0")/../.." || exit 1

. scripts/solver/common.sh

profile=.envs/campaign.vars
command=${1:-status}

if [ ! -f "$profile" ]; then
  echo "$profile does not exist. It is gitignored and per-machine — create it with:" >&2
  echo >&2
  echo "  CAMPAIGN_TARGET=production            # or local, to rehearse against the local stack" >&2
  echo "  CAMPAIGN_BASE_URL=https://<app host>" >&2
  echo "  CAMPAIGN_EMAIL=<dedicated campaign account, no machine_role>" >&2
  echo "  CAMPAIGN_PASSWORD=<its password>" >&2
  echo "  CAMPAIGN_SOURCE_PLAN_ID=<the plan to clone, with its board>" >&2
  echo "  ANALYZER_SUPABASE_URL=https://<project-ref>.supabase.co" >&2
  echo "  ANALYZER_SERVICE_ROLE_KEY=<service-role key — reads only, analyzer subprocess only>" >&2
  echo "  CLOUDFLARE_OBSERVABILITY_TOKEN=<API token: Account → Workers Observability: Edit>   # verify-startup, drill, renewal" >&2
  echo "  CLOUDFLARE_ACCOUNT_ID=<account id>" >&2
  echo "  # CAMPAIGN_TARGET=local also needs LOCAL_SOLVER_SUPABASE_URL, LOCAL_SOLVER_SUPABASE_KEY," >&2
  echo "  # LOCAL_SOLVER_MACHINE_PASSWORD for the native solver it starts" >&2
  echo >&2
  echo "See docs/runbooks/calibration-campaign.md § One-time setup." >&2
  exit 1
fi

profile_value() {
  sed -n "s/^$1=//p" "$profile" | head -1 | tr -d '\r' | sed -e "s/^'\(.*\)'\$/\1/" -e 's/^"\(.*\)"$/\1/'
}

target=$(profile_value CAMPAIGN_TARGET)
case "$target" in
  production | local) ;;
  *)
    echo "$profile: CAMPAIGN_TARGET must be 'production' or 'local' (got '$target')." >&2
    exit 1
    ;;
esac

# A present-but-empty key fails too: the runner would sign in as nobody, or read the wrong database.
required="CAMPAIGN_BASE_URL CAMPAIGN_EMAIL CAMPAIGN_PASSWORD CAMPAIGN_SOURCE_PLAN_ID ANALYZER_SUPABASE_URL ANALYZER_SERVICE_ROLE_KEY"
if [ "$target" = "local" ]; then
  required="$required LOCAL_SOLVER_SUPABASE_URL LOCAL_SOLVER_SUPABASE_KEY LOCAL_SOLVER_MACHINE_PASSWORD"
fi
missing=""
for key in $required; do
  grep -q "^$key=.\{1,\}" "$profile" || missing="$missing $key"
done
if [ -n "$missing" ]; then
  echo "$profile is missing (or has empty):$missing" >&2
  exit 1
fi

# The target and the app it drives must agree, or a rehearsal clones real data and a production run reads
# its override back from a laptop. A first pass, before the banner: `baseUrlProblems`
# (bench/campaign/definition.ts) parses the URL properly and refuses again before any request.
base_url=$(profile_value CAMPAIGN_BASE_URL)
case "$target:$base_url" in
  local:http://localhost:* | local:http://127.0.0.1:*) ;;
  production:https://localhost* | production:https://127.0.0.1*)
    echo "$profile: CAMPAIGN_TARGET=production needs the deployed app's URL, not '$base_url'." >&2
    exit 1
    ;;
  production:https://*) ;;
  *)
    echo "$profile: CAMPAIGN_BASE_URL '$base_url' does not fit CAMPAIGN_TARGET=$target" >&2
    echo "  (local: http://localhost:<port> or http://127.0.0.1:<port>; production: the deployed https URL)." >&2
    exit 1
    ;;
esac

# Commands that touch the app or Cloudflare. `status`, `set-cell`, `resume` and `verify-startup` only
# read (the journal, or the logs) or append to the journal, so they skip the production checks and the
# prompt. `drill` and `renewal` also need CLOUDFLARE_OBSERVABILITY_TOKEN and CLOUDFLARE_ACCOUNT_ID —
# an API token with Account → Workers Observability: Edit; the wrangler login cannot read the logs.
case "$command" in
  setup | run | run-one | park | cleanup | drill | renewal) writes=yes ;;
  *) writes=no ;;
esac

if [ "$writes" = "yes" ] && [ "$target" = "production" ]; then
  # Fail closed: a missing tool must not read as a passed check.
  command -v git >/dev/null 2>&1 || die "git is required for the clean-tree check and was not found on PATH."
  if ! pnpm exec wrangler whoami 2>/dev/null | grep -q "You are logged in"; then
    echo "wrangler is not logged in — the cell switch is a 'wrangler secret bulk'. Run: pnpm exec wrangler login" >&2
    exit 1
  fi
  if [ -n "$(git status --porcelain)" ]; then
    echo "the working tree is not clean. The runner's cell definitions and main's constants are read from" >&2
    echo "this checkout, and Phase 5's drill deploys from it — commit or stash first:" >&2
    git status --short >&2
    exit 1
  fi

  echo "############################################################################"
  echo "#  CALIBRATION CAMPAIGN - THIS WRITES TO PRODUCTION                        #"
  echo "############################################################################"
  echo "#  On the hosted project and the deployed Worker, this will:               #"
  echo "#    * clone a real plan WITH its board, and solve on it repeatedly        #"
  echo "#    * switch the solver container's tuning through Worker secrets        #"
  echo "#      (production then runs campaign budgets until the override parks)   #"
  echo "#    * stop the container between cells to force a cold start             #"
  echo "#    * at cleanup, delete every proposal and the campaign plan            #"
  echo "#                                                                          #"
  echo "#  MERGE FREEZE: every merge to main rolls the container and kills the     #"
  echo "#  solve in flight. Do not merge while the campaign is running.            #"
  echo "#                                                                          #"
  echo "#  Ctrl-C once: finish the step, park when safe, exit. Twice: exit now.    #"
  echo "############################################################################"
  echo

  if [ "${SOLVER_CAMPAIGN_CONFIRM:-}" != "yes" ]; then
    printf "Type 'campaign' to continue: "
    read -r answer
    if [ "$answer" != "campaign" ]; then
      echo "aborted - nothing was changed." >&2
      exit 1
    fi
  fi
elif [ "$writes" = "yes" ]; then
  echo "local rehearsal against $(profile_value CAMPAIGN_BASE_URL) — nothing hosted is touched"
fi

CAMPAIGN_TARGET=$target
CAMPAIGN_BASE_URL=$(profile_value CAMPAIGN_BASE_URL)
CAMPAIGN_EMAIL=$(profile_value CAMPAIGN_EMAIL)
CAMPAIGN_PASSWORD=$(profile_value CAMPAIGN_PASSWORD)
CAMPAIGN_SOURCE_PLAN_ID=$(profile_value CAMPAIGN_SOURCE_PLAN_ID)
ANALYZER_SUPABASE_URL=$(profile_value ANALYZER_SUPABASE_URL)
ANALYZER_SERVICE_ROLE_KEY=$(profile_value ANALYZER_SERVICE_ROLE_KEY)
export CAMPAIGN_TARGET CAMPAIGN_BASE_URL CAMPAIGN_EMAIL CAMPAIGN_PASSWORD CAMPAIGN_SOURCE_PLAN_ID
export ANALYZER_SUPABASE_URL ANALYZER_SERVICE_ROLE_KEY
for key in CAMPAIGN_NAME CAMPAIGN_LEDGER_COPY LOCAL_SOLVER_URL LOCAL_SOLVER_SUPABASE_URL LOCAL_SOLVER_SUPABASE_KEY LOCAL_SOLVER_MACHINE_PASSWORD CLOUDFLARE_OBSERVABILITY_TOKEN CLOUDFLARE_ACCOUNT_ID; do
  value=$(profile_value "$key")
  if [ -n "$value" ]; then
    export "$key=$value"
  fi
done

# Node owns signal handling from here: the first Ctrl-C finishes the step and parks, the second exits.
# A shell left waiting in between would either die on the first Ctrl-C while the runner parks, or
# swallow it — so this script `exec`s the runner, and there is no shell left to trap anything. That is
# also why there are no EXIT/INT/TERM traps here, unlike hosted.sh: nothing is left to clean up.
#
# `caffeinate -i -w $$` keeps the machine awake for exactly the runner's lifetime ($$ is the runner's
# pid once `exec` replaces this shell). A background job here ignores Ctrl-C, so it lives until the
# runner exits. It cannot survive a closed lid — the journal is what survives that.
if [ "$(uname)" = "Darwin" ] && { [ "$command" = "run" ] || [ "$command" = "run-one" ] || [ "$command" = "cleanup" ] || [ "$command" = "drill" ] || [ "$command" = "renewal" ]; }; then
  caffeinate -i -w $$ &
fi
exec node bench/campaign/main.ts "$@"
