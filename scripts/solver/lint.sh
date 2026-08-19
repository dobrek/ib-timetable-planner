#!/bin/sh
# The only automated gate `scripts/solver/*.sh` will ever get: shellcheck, plus a `set -eu`
# conformance assertion.
#
# Two things it is worth knowing about this file.
#
# **Why the conformance check exists.** mise runs INLINE task bodies with `sh -c -o errexit` and
# script FILES with plain `sh` — measured, not assumed. So errexit that a `'''` body got for free is
# silently dropped the moment the same code becomes a file, and a Ctrl-C out of `solver:hosted` would
# continue into `pnpm build`/`pnpm preview` with mise reporting exit 0. shellcheck has no check for a
# MISSING `set -e` (there is one for set -e being suppressed; not for its absence), so nothing else
# in the repo can catch this. Hence: first non-comment, non-blank line must be exactly `set -eu`.
#
# **Why `sh -n` is not here.** On macOS `/bin/sh` is bash 3.2, and it happily parses `local`, `[[ ]]`,
# `+=` and `echo -e` — four constructs CI's dash rejects. A syntax check under a permissive shell is
# decoration; shellcheck flags all four (SC3043/SC3010/SC3024/SC3037), so shellcheck is the gate.
# `-o check-set-e-suppressed` is passed by name because bare shellcheck says nothing about a function
# invoked in a condition (SC2310) — the hazard `common.sh` introduces — while `-o all` yields 54
# style findings. Enable optional checks one at a time, never wholesale.
#
#   mise run solver:check          # the developer front door (ruff → mypy → this)
#   sh scripts/solver/lint.sh      # this gate alone; what CI's verify job runs
#
# The shellcheck version is pinned twice — `mise.toml` `[tools]` and the install step in
# `.github/workflows/ci.yml` — and the two literals must move together.
set -eu

cd "$(dirname "$0")/../.." || exit 1

. scripts/solver/common.sh

# CI puts the pinned shellcheck on PATH directly; a developer's shell usually has it only inside the
# mise environment. Prefer PATH so the CI invocation is unmediated, fall back to mise so a bare
# `sh scripts/solver/lint.sh` works from any shell on a provisioned machine.
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck -o check-set-e-suppressed scripts/solver/*.sh
elif command -v mise >/dev/null 2>&1; then
  mise x -- shellcheck -o check-set-e-suppressed scripts/solver/*.sh
else
  die "shellcheck is not installed. It is pinned in mise.toml's [tools] — run 'mise install'," \
    "or install by hand the version mise.toml pins (the same one .github/workflows/ci.yml downloads)."
fi

offenders=""
for script in scripts/solver/*.sh; do
  first=$(grep -v -e '^[[:space:]]*#' -e '^[[:space:]]*$' "$script" | head -1)
  if [ "$first" != "set -eu" ]; then
    offenders="${offenders}  ${script} — first non-comment line is \"${first}\"
"
  fi
done

if [ -n "$offenders" ]; then
  echo "these scripts do not open with 'set -eu':" >&2
  printf '%s' "$offenders" >&2
  echo >&2
  echo "mise gives errexit to inline task bodies only, never to script files, so a script without" >&2
  echo "'set -eu' runs past its own failures and past a Ctrl-C — and mise reports success." >&2
  exit 1
fi

echo "scripts/solver: shellcheck clean, set -eu conformant"
