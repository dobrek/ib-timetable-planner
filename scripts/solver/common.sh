#!/bin/sh
# Shared MECHANISM for the solver task scripts — `die` and `wait_for_health`, nothing else.
#
# Scope is deliberate and narrow. The env guards, the profile readers, the banners and the cleanup
# traps stay at their call sites, because in every one of them the shareable part is the skeleton and
# the bespoke part is the MESSAGE — and the messages are the valuable thing in these tasks (they are
# what turned three review findings into fixes). A helper that swallowed `solver:dev`'s seven-line
# remediation block would be a net loss.
#
# `wait_for_health` is the one exception, and it earns it: the two `/health` waits differ only in
# their timeout, their liveness predicate and their prose, and the liveness guard is exactly what
# `solver:hosted` was missing (solver-deploy-lane impl-review F2). Injecting the predicate makes the
# guard impossible to omit from a call site.
#
# Consumers:
#   scripts/solver/dev.sh · image-build.sh · image-smoke.sh · tier3.sh · hosted.sh
#
#   . scripts/solver/common.sh   # sourced AFTER the caller has cd'd to the repo root
#
# See README § Running the solver service (dev) for what the tasks themselves do.
set -eu

# die <line>...
#   Each argument is printed as its own stderr line, then exit 1. This is `wait_for_health`'s exit
#   path; the moved guards keep their own verbatim `echo … >&2; exit 1` blocks so their remediation
#   prose stays at the call site — do not retrofit them onto this.
die() {
  for line in "$@"; do
    echo "$line" >&2
  done
  exit 1
}

# wait_for_health <url> <timeout_s> <alive_fn> <dead_line>...
#   Polls <url> once a second until `curl -sf` succeeds. BEFORE each retry it invokes <alive_fn> (a
#   function NAME the caller defines); if that fails, the <dead_line>s go to stderr and the script
#   exits 1 — a process that died must never leave us polling until something ELSE answers on the
#   port. After <timeout_s> attempts it exits 1 with a generic message.
#
#   On success it sets WAITED_S and prints nothing: the caller owns its own success line, because
#   "the container is up" and "the solver's startup credential check passed" are different claims.
#
#   NEVER call this inside a condition (`if`, `||`, `&&`): errexit is disabled inside a function
#   invoked that way, and its `exit` would only leave a subshell. shellcheck reports it as SC2310
#   under `-o check-set-e-suppressed`, which is why `scripts/solver/lint.sh` passes that flag.
wait_for_health() {
  url=$1
  timeout_s=$2
  alive_fn=$3
  shift 3

  waited=0
  until curl -sf "$url" >/dev/null 2>&1; do
    if ! "$alive_fn"; then
      die "$@"
    fi
    waited=$((waited + 1))
    if [ "$waited" -gt "$timeout_s" ]; then
      die "nothing answered $url within ${timeout_s}s"
    fi
    sleep 1
  done

  # shellcheck disable=SC2034  # out-parameter, read by callers after wait_for_health returns
  WAITED_S=$waited
}
