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

# Three edits, all before the build:
#
#   1. drop SOLVER_URL, so `getSolverTransport()` falls through to the binding;
#   2. add SOLVER_SUPABASE_URL, because the Worker and the container need DIFFERENT Supabase URLs.
#      The Worker runs on the host and reaches the stack at 127.0.0.1; inside the container that is
#      the container's own loopback, and every request is refused;
#   3. add SOLVER_MACHINE_PASSWORD, which in production is a Worker secret set by `wrangler secret
#      put` and locally has nowhere else to come from.
#
# Keys 2 and 3 are inert in production: no such Worker secret exists there. Both are written to
# `.dev.vars` (gitignored) and dropped again by the trap's `pnpm env:local`; the build's copy under
# `dist/server/` is gitignored too and is overwritten by the next build.
#
# **The ordering is load-bearing**: `astro build` snapshots the root `.dev.vars` into
# `dist/server/.dev.vars` and the redirected `wrangler dev` reads THAT copy, so all three edits must
# land BEFORE the build or the URL transport stays quietly in charge and this task proves nothing
# while looking like it passed.
echo "rewriting .dev.vars for the binding path, then rebuilding (the build snapshots it)"
grep -v -e '^SOLVER_URL=' -e '^SOLVER_SUPABASE_URL=' -e '^SOLVER_MACHINE_PASSWORD=' .dev.vars > .dev.vars.tier3 || true
container_url=$(sed -n 's/^SUPABASE_URL=//p' .dev.vars | head -1 \
  | sed -e 's#//127\.0\.0\.1:#//host.docker.internal:#' -e 's#//localhost:#//host.docker.internal:#')
case "$container_url" in
  *host.docker.internal*) echo "SOLVER_SUPABASE_URL=$container_url" >> .dev.vars.tier3 ;;
  *) echo "note: SUPABASE_URL is not local, so the container can use it unchanged" ;;
esac
# Written single-quoted, because `.dev.vars` is dotenv: an UNQUOTED value is cut at the first `#`,
# and a double-quoted one has `\n` expanded. Single quotes are literal - except that dotenv never
# unescapes a `'` inside them, so a password containing one cannot be represented; refuse it
# (and a newline) rather than hand the Worker a truncated secret it would forward silently.
case "$SOLVER_MACHINE_PASSWORD" in *\'*) pw_unrepresentable=1 ;; *) pw_unrepresentable=0 ;; esac
if [ "$(printf '%s' "$SOLVER_MACHINE_PASSWORD" | wc -l)" -gt 0 ]; then pw_unrepresentable=1; fi
if [ "$pw_unrepresentable" -eq 1 ]; then
  echo "SOLVER_MACHINE_PASSWORD contains a single quote or a newline, which .dev.vars cannot" >&2
  echo "carry literally. Provision the local machine user with a password free of both." >&2
  rm -f .dev.vars.tier3
  exit 1
fi
echo "SOLVER_MACHINE_PASSWORD='$SOLVER_MACHINE_PASSWORD'" >> .dev.vars.tier3
mv .dev.vars.tier3 .dev.vars
pnpm build

echo
echo "starting workerd with the real container on ${TIER3_PORT:-8787}"
echo "Hit Generate on a local plan; the POST should appear in the solver container's docker logs."
echo "Ctrl-C restores .dev.vars via pnpm env:local."
echo
pnpm exec wrangler dev --enable-containers --port "${TIER3_PORT:-8787}"
