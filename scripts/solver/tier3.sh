#!/bin/sh
# Tier 3 — run the REAL solver container inside local workerd. Opt-in, not the daily loop.
#
# It exists to exercise the one path the other tiers cannot: `getSolverTransport()` choosing the
# BINDING, `SolverContainer` starting a real container, and `containerFetch` crossing Workers RPC.
# Tiers 1 and 2 both dispatch over a URL, so neither touches any of that.
#
# Why the `.dev.vars` rewrite has to happen before the build, and why `wrangler dev` picks up the
# generated container config without any edit to `wrangler.jsonc`: README § Tier 3 — the real
# container inside workerd, and context/foundation/lessons.md, "A Worker forwards only what
# `.dev.vars` holds". Both edits this makes are undone by the exit trap.
#
#   export SOLVER_MACHINE_PASSWORD='…'; mise run solver:tier3
#   requires: Docker Desktop running · SOLVER_MACHINE_PASSWORD
#   optional: TIER3_PORT (default 8787)
#   optional: CALIBRATION_WORKERS, CALIBRATION_STAGE_BUDGET_S, CALIBRATION_MODE_A_BUDGET_S,
#             SOLVER_OPS_ALLOWED_EMAILS — forwarded into .dev.vars when set, to rehearse the
#             campaign's control surface (the overrides and /api/solver/container) locally
#
# See README § Tier 3 — the real container inside workerd.
set -eu

cd "$(dirname "$0")/../.." || exit 1

. scripts/solver/common.sh

if ! docker version >/dev/null 2>&1; then
  echo "Docker Desktop is not running — tier 3 starts a real container." >&2
  exit 1
fi

# `wrangler dev` builds the Worker's `env` from `.dev.vars` — NOT from this shell. So exporting the
# password is not enough: it has to be written into the file the Worker reads, or `SolverContainer`
# forwards an empty string and the container boots UNCONFIGURED (the service must answer `/health`
# on a bare container, so the startup check skips itself when the trio is absent): the container
# comes up and refuses every dispatch with a 503, so tier 3 proves nothing. Checked before the
# build, which costs a minute.
if [ -z "${SOLVER_MACHINE_PASSWORD:-}" ]; then
  echo "SOLVER_MACHINE_PASSWORD is unset, and tier 3 needs it in .dev.vars for the WORKER to" >&2
  echo "forward into the container. Without it the container boots unconfigured and refuses" >&2
  echo "every dispatch with a 503." >&2
  echo >&2
  echo "  export SOLVER_MACHINE_PASSWORD='...'   # what you gave provision-solver-user.mjs" >&2
  exit 1
fi
# The rewrite below edits .dev.vars in place; with no file the `grep -v … || true` would quietly
# produce an empty base, the "not local" branch would fire, and the build would ship a .dev.vars
# holding only the password. Refuse before anything is touched.
[ -f .dev.vars ] || die "no .dev.vars to rewrite — run 'pnpm env:local' first (README § Environment Profiles)."

# Two traps, not one, and the split is the point. EXIT owns the restore — it runs on every exit path,
# including the signal ones below. INT/TERM only `exit`, which is what makes the script STOP.
#
# Measured 2026-08-18, against the pre-extraction inline body as well as this file: with a single
# `trap … EXIT INT TERM`, a Ctrl-C during `pnpm build` fired the handler, restored the profile — and
# then CARRIED ON into `pnpm exec wrangler dev`, with mise reporting exit 1. A shell with an INT
# handler resumes after that handler returns, and this one ended in a successful `pnpm env:local`,
# so `set -e` saw nothing wrong. The old form also ran the restore twice (INT handler, then EXIT).
restore_local_profile() {
  echo
  echo "restoring .dev.vars (SOLVER_URL back in charge, injected secrets dropped)"
  pnpm env:local >/dev/null
}
trap restore_local_profile EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Four edits, all before the build:
#
#   1. drop SOLVER_URL, so `getSolverTransport()` falls through to the binding;
#   2. add SOLVER_SUPABASE_URL, because the Worker and the container need DIFFERENT Supabase URLs.
#      The Worker runs on the host and reaches the stack at 127.0.0.1; inside the container that is
#      the container's own loopback, and every request is refused;
#   3. add SOLVER_MACHINE_PASSWORD, which in production is a Worker secret set by `wrangler secret
#      put` and locally has nowhere else to come from;
#   4. add whichever of the campaign's control-surface keys this shell sets (see the header). In
#      production they are Worker secrets the campaign runner sets and removes; here, as with the
#      password, `.dev.vars` is the only way the Worker can see them.
#
# Keys 2-4 are inert in production unless the campaign sets them there on purpose. All are written
# to `.dev.vars` (gitignored) and dropped again by the trap's `pnpm env:local`; the build's copy under
# `dist/server/` is gitignored too and is overwritten by the next build.
#
# **The ordering is load-bearing**: `astro build` snapshots the root `.dev.vars` into
# `dist/server/.dev.vars` and the redirected `wrangler dev` reads THAT copy, so every edit must land
# BEFORE the build or the URL transport stays quietly in charge and this task proves nothing while
# looking like it passed.
optional_keys="CALIBRATION_WORKERS CALIBRATION_STAGE_BUDGET_S CALIBRATION_MODE_A_BUDGET_S SOLVER_OPS_ALLOWED_EMAILS"
echo "rewriting .dev.vars for the binding path, then rebuilding (the build snapshots it)"
grep -v -e '^SOLVER_URL=' -e '^SOLVER_SUPABASE_URL=' -e '^SOLVER_MACHINE_PASSWORD=' \
  -e '^CALIBRATION_WORKERS=' -e '^CALIBRATION_STAGE_BUDGET_S=' -e '^CALIBRATION_MODE_A_BUDGET_S=' \
  -e '^SOLVER_OPS_ALLOWED_EMAILS=' .dev.vars > .dev.vars.tier3 || true
container_url=$(sed -n 's/^SUPABASE_URL=//p' .dev.vars | head -1 \
  | sed -e 's#//127\.0\.0\.1:#//host.docker.internal:#' -e 's#//localhost:#//host.docker.internal:#')
case "$container_url" in
  *host.docker.internal*) printf 'SOLVER_SUPABASE_URL=%s\n' "$container_url" >> .dev.vars.tier3 ;;
  *) echo "note: SUPABASE_URL is not local, so the container can use it unchanged" ;;
esac
# Written single-quoted, because `.dev.vars` is dotenv: an UNQUOTED value is cut at the first `#`,
# and a double-quoted one has `\n` expanded. Single quotes are literal - except that dotenv never
# unescapes a `'` inside them, so a value containing one cannot be represented; refuse it (and a
# newline) rather than hand the Worker a truncated secret it would forward silently.
#
# printf, not echo: both target shells' echo interpret backslash escapes, which would silently
# alter a value containing one — the very corruption the guard exists to refuse.
#
# The helper refuses by exiting rather than by returning a status, so no caller can invoke it in a
# condition and quietly switch `set -e` off inside it.
append_literal() { # KEY VALUE [HINT]
  refused=0
  case "$2" in *\'*) refused=1 ;; esac
  if [ "$(printf '%s' "$2" | wc -l)" -gt 0 ]; then refused=1; fi
  if [ "$refused" -eq 1 ]; then
    rm -f .dev.vars.tier3
    die "$1 contains a single quote or a newline, which .dev.vars cannot carry literally." ${3:+"$3"}
  fi
  printf "%s='%s'\n" "$1" "$2" >> .dev.vars.tier3
}
append_literal SOLVER_MACHINE_PASSWORD "$SOLVER_MACHINE_PASSWORD" \
  "Provision the local machine user with a password free of both."
for key in $optional_keys; do
  value=
  eval "value=\${$key:-}"
  [ -n "$value" ] || continue
  append_literal "$key" "$value"
  echo "forwarding $key into .dev.vars"
done
mv .dev.vars.tier3 .dev.vars
pnpm build

echo
echo "starting workerd with the real container on ${TIER3_PORT:-8787}"
echo "Hit Generate on a local plan; the POST should appear in the solver container's docker logs."
echo "Ctrl-C restores .dev.vars via pnpm env:local."
echo
pnpm exec wrangler dev --enable-containers --port "${TIER3_PORT:-8787}"
