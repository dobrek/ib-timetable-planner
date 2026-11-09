#!/bin/sh
# The only gate `supabase/functions/**` will ever get: `deno check`, `deno lint` and `deno test`.
#
# Why it exists. The Edge Function is Deno code with `npm:` imports. tsconfig.json, ESLint and
# lefthook exclude `supabase/functions` on purpose (Node tooling must never see it), so without this
# script nothing in the repo would type-check, lint or test those files. `pnpm check` / `pnpm lint`
# staying green says NOTHING about them.
#
# One run per function directory (each has its own `deno.json` with its own pinned imports and
# `"lock": false` — no lockfile, exact pins plus Dependabot instead), because Deno discovers its
# config from the working directory.
#
#   mise run functions:check       # the developer front door
#   sh scripts/functions/check.sh  # what CI's verify job runs, with `deno` already on PATH
#
# Deno is pinned in `mise.toml` and in `.github/workflows/ci.yml`; the two literals move together.
set -eu

cd "$(dirname "$0")/../.." || exit 1

. scripts/solver/common.sh

# CI puts the pinned Deno on PATH directly; a developer's shell usually has it only inside the mise
# environment. Same preference order as scripts/solver/lint.sh.
if command -v deno >/dev/null 2>&1; then
  run_deno() { deno "$@"; }
elif command -v mise >/dev/null 2>&1; then
  run_deno() { mise x -- deno "$@"; }
else
  die "deno is not installed. It is pinned in mise.toml's [tools] — run 'mise install'," \
    "or install by hand the version mise.toml pins (the same one .github/workflows/ci.yml installs)."
fi

found=0
for config in supabase/functions/*/deno.json; do
  # An unmatched glob stays literal; `-f` makes that a no-op rather than a failure to check.
  [ -f "$config" ] || continue
  found=1
  dir=$(dirname "$config")
  echo "== $dir"
  (
    cd "$dir"
    run_deno check .
    run_deno lint
    # `--permit-no-files`: a function with no test files yet is not a failure.
    run_deno test --permit-no-files
  )
done

if [ "$found" -eq 0 ]; then
  die "no supabase/functions/*/deno.json found — nothing was checked."
fi

echo "supabase/functions: deno check, lint and test clean"
