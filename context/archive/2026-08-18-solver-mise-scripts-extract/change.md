---
change_id: solver-mise-scripts-extract
title: Extract the solver mise task bodies into tested shell scripts
status: archived
created: 2026-08-18
updated: 2026-08-19
archived_at: 2026-08-19T12:31:41Z
---

## Notes

Follow-up filed out of `solver-deploy-lane`'s implementation review (2026-08-18, `reviews/impl-review.md`).

**Why.** `mise.toml` is 425 lines, and three tasks carry 99 / 81 / 125 lines of inline POSIX sh
(`solver:image:smoke`, `solver:tier3`, `solver:hosted`) inside TOML `'''` strings with `{% raw %}` guards.
That code is untestable (no shellcheck, no `sh -n`, no unit tests, no CI gate), duplicated three ways
(env-trio guard in `solver:dev`/`image:smoke`/`hosted`; a `/health` wait loop in `image:smoke` and `hosted`;
a cleanup trap in `tier3` and `hosted`), and painful to edit and review. Three of the review's nine findings
(F2 hosted health-wait against the wrong process, F3 shell-sourcing the profile, plus a `$(printf '\n')`
newline-check bug introduced and fixed during triage) were shell-logic defects that only ad-hoc probes caught —
the missing liveness guard in `hosted` existed precisely because `image:smoke` had its own copy.

**Shape.** `mise.toml` stays the catalog — name, `description`, `dir`, one-line `run` — and each body moves to
`scripts/solver/<task>.sh` (`dev.sh`, `image-build.sh`, `image-smoke.sh`, `tier3.sh`, `hosted.sh`) with a shared
`scripts/solver/lib.sh` (`require_env`, `wait_for_health <url> <pid|container>` carrying the liveness guard,
`restore_local_profile` trap, `die`). Add `shellcheck scripts/solver/*.sh` (+ `sh -n`) as a CI step, cheap enough
for the `verify` job. `scripts/` is already home to `provision-solver-user.mjs`/`gen-seed.mjs`, so no new convention.

**Constraints.** No behaviour change — each tier must still run as documented in README (tier 1/2/3 + hosted
campaign) and the "guard belongs in the launcher" lesson (`lessons.md`) still holds; the launcher just becomes a
file. The inline comments are load-bearing (the `.dev.vars` ordering hazard, the sleep hazard, the port collision,
the dotenv quoting rule) and must move **with** the code, not be lost. `pnpm` scripts still never gain a solver step
(CLAUDE.md). Keep it a separate diff from the review-fixes commit.

## Decisions taken (2026-08-18, from `research.md`)

Settled before planning so the plan does not re-litigate them. Each cites the research section
that grounds it.

1. **Scripts self-locate.** Every `scripts/solver/*.sh` opens with `cd "$(dirname "$0")/../.." || exit 1`
   rather than inheriting cwd from mise's `dir`. Eleven sites depend on cwd today, including
   `docker build … .` — a wrong build context fails OPEN. `solver:dev` therefore gains an explicit
   `cd services/solver` (or `uv --project`), replacing the `dir` it relies on today. (§11)
2. **Every script carries `set -eu`, `solver:dev` included.** mise supplies `-o errexit` to inline
   bodies and *not* to script files, so verbatim extraction silently drops it; without it a Ctrl-C
   out of `solver:hosted` continues into `pnpm build`/`pnpm preview` and mise reports exit 0.
   `solver:dev` acquiring `set -eu` is a **named, deliberate behaviour change**, not a neutral move.
   A `set -eu` conformance assertion runs in the same CI step as shellcheck — nothing else enforces it. (§3)
3. **Gate placement mirrors the uv precedent**: extend `mise run solver:check` as the developer front
   door, plus a direct `shellcheck` step in CI's `verify` job. No ninth `/verify` step for a non-pnpm
   tool. Invocation is `shellcheck -o check-set-e-suppressed` — bare shellcheck misses the
   function-errexit hazard `lib.sh` introduces (SC2310), and `-o all` yields 54 style findings. (§4, §7)
4. **shellcheck version is pinned on both sides**: in `mise.toml` `[tools]` (registry has
   `aqua:koalaman/shellcheck`; it is not installed locally today) *and* by pinning `runs-on: ubuntu-24.04`
   for the job that runs it — `ubuntu-latest` ships 0.9.0 now and 0.11.0 after the image migration.
   `mise.toml:17-21` already argues developer and gate should match. (§7)
   **Superseded in part (2026-08-18, planning → implementation):** the `runs-on: ubuntu-24.04` half is
   dropped. CI downloads shellcheck 0.11.0 from a pinned release URL, checks its sha256 and asserts the
   version, so the runner image's preinstalled copy is irrelevant and `runs-on` stays `ubuntu-latest`.
   Developer/gate parity now comes from two version literals — `mise.toml` `[tools]` and `ci.yml`'s
   install step — that must move together. See the planning addenda below.
5. **CI's health-wait stays a third copy.** `.github/workflows/ci.yml:84-102` is not absorbed into the
   shared helper — a workflow step cannot cleanly source a repo shell script. Recorded as a decision so
   it does not read as an oversight. (§5)
6. **Location is `scripts/solver/`**, and the shared file is **not** named `lib.sh` — `scripts/lib/`
   already means "shared modules imported by entry points", a different thing. (§ Architecture Insights)

**Verification is manual by necessity.** No CI job executes a mise task, so shellcheck is the only
automated contact these scripts ever get. A manual tier-1/2/3 pass belongs in the success criteria,
plus a Ctrl-C parity check on `tier3` and `hosted` (trap fires, exit 130, nothing runs after it).
`solver:hosted` is rehearsed with `.envs/prod-solver.vars` pointed at the local stack — it writes to
production otherwise. All of tiers 1–3 are runnable on this machine right now. (§9, §10)

**Free fixes to take while the code moves**: `mise.toml:54-55` still describes the pre-2026-08-18
"row stuck at `queued`" outcome contradicted by `mise.toml:38-40`; `README.md:332` omits `pnpm check`
from the `verify` job; `README.md:184`, `README.md:125` and `lessons.md:86` describe where the logic
lives and need a wording pass. (§8)

## Planning addenda (2026-08-18, from `plan.md`)

- **Decision 4 partly superseded.** shellcheck is pinned to **0.11.0** in `[tools]` and CI downloads
  that exact release (pinned URL + sha256, version asserted) instead of using the runner image's
  preinstalled 0.9.0 — so `runs-on` stays `ubuntu-latest`; developer/gate parity comes from the two
  version literals moving together, not from pinning the image.
- **`sh -n` is dropped from the gate** (research §6: on macOS `/bin/sh` is bash 3.2 and passes
  dash-rejected bashisms; shellcheck flags them). Gate = `shellcheck -o check-set-e-suppressed`
  + the `set -eu` conformance assertion, in `scripts/solver/lint.sh`, run by `solver:check` and CI.
- **Shared file is `scripts/solver/common.sh`, mechanism only** (`die`, `wait_for_health`); env
  guards, `profile_value`, banners and traps stay in the callers.
- **Doc reach is live docs only**; prior-lane `mise.toml:NNN` citations stay as historical records.

## Implementation addenda (2026-08-18, from `/10x-implement`)

- **A third named behaviour change: `INT`/`TERM` are split off the `EXIT` trap** in `tier3.sh` and
  `hosted.sh`. Measured in Phase 3 against both the extracted script *and* mise's own inline
  invocation of the pre-extraction body (`sh -c -o errexit "$(git show 7efc9ad:mise.toml …)"`): with a
  single `trap … EXIT INT TERM`, a Ctrl-C during `pnpm build` fired the handler, restored the
  profile — and then **continued into `pnpm exec wrangler dev`**, with mise exiting 1; it also ran
  the restore twice. The two forms behaved identically (`exit=1 trap_fired=2
  continued_into_wrangler=1` for both), so this is a pre-existing defect the extraction inherited,
  not a regression it introduced. Research §3's "inline → exit 130, stops at the interrupted
  command" was measured on a `sleep`-based model and does not hold for the real body: a shell with
  an `INT` handler *resumes* once the handler returns, and this handler's last command
  (`pnpm env:local`) succeeded, so `set -e` saw nothing wrong. Fixed rather than merely recorded:
  `trap <restore> EXIT` + `trap 'exit 130' INT` + `trap 'exit 143' TERM`. Plan criterion 3.6 now
  passes as written — exit 130, one restore, `wrangler dev` never starts.

- **Follow-up filed (not fixed here): a tier-3 container that dies is undiagnosable from the terminal.**
  When `SolverContainer`'s container exits non-zero, `wrangler dev` reports only
  `[ERROR] [solver-container] error [Error: Container exited with unexpected exit code: 3]`, and
  Cloudflare's local runtime reaps the container before `docker ps -a` can see it — so the one
  artifact that names the cause (the startup credential check's `invalid_credentials`) is gone by the
  time anyone looks. Exit 3 is uvicorn's "Application startup failed", reproducible by running the
  same image with a wrong password. Diagnosing it in Phase 3 took a `docker events` watcher plus a
  direct sign-in probe against the local stack. Pre-existing and orthogonal to this change; worth a
  `docker events`-based log capture in the tier-3 launcher, or at minimum a README § Tier 3 note
  saying where the evidence went.

- **Free fixes taken while the code moved**, as the brief planned: `mise.toml:54-55`'s stale
  "row stuck at `queued` with an orphan proposal plan" remediation text is gone — `dev.sh` now states
  the current outcome (refused with a 503, row `failed`, clone deleted), matching README § Tier 1;
  and `README.md`'s `verify` job list, which omitted `pnpm check`, now reads
  `shellcheck scripts/solver` → `astro sync` → `check` → `lint` → …
- **`sh -n` was dropped from the gate by decision** (research §6): on macOS `/bin/sh` is bash 3.2 and
  passes `local`, `[[ ]]`, `+=` and `echo -e` — all of which CI's dash rejects and shellcheck flags
  (SC3043/SC3010/SC3024/SC3037). A syntax check under a permissive shell is decoration, so the gate
  is `shellcheck -o check-set-e-suppressed` plus the `set -eu` conformance assertion.

## Implementation-review addenda (2026-08-19, from `reviews/impl-review.md`)

The review found no regression from the extraction; every warning was a defect inherited verbatim
from the old `mise.toml` bodies, now visible because the code is readable. All nine findings were
fixed in triage, which adds **five more named behaviour changes** on top of the trap split:

- `hosted.sh` refuses a profile key that is present but **empty** (`grep "^$key=.\{1,\}"`) — an
  empty `SOLVER_MACHINE_PASSWORD=` previously let the solver boot unconfigured, printed a false
  "credential check passed", and dispatched hosted jobs that 503'd on production. (F1)
- `tier3.sh` writes `.dev.vars.tier3` with `printf`, not `echo` — both target shells' `echo`
  interpret backslash escapes, silently altering a password containing one. (F2)
- `image-smoke.sh` gets the same `EXIT` + `INT`/`TERM` split as `tier3.sh`/`hosted.sh` — dash does
  not run an EXIT trap on an untrapped SIGINT, so a Linux Ctrl-C left the container on :8000. (F3)
- `hosted.sh` dies if `lsof` is absent instead of letting the `:8000` guard fail open. (F4)
- `tier3.sh` dies on a missing `.dev.vars` before the trap is installed, instead of building a
  `.dev.vars` that holds only the password. (F5)

Hardening taken with them: `wait_for_health` uses `curl --max-time 5`; the smoke passes the
password to `docker run` by name (`-e VAR`, exported) so it is not argv-visible; `profile_value`
strips a CR; ci.yml names the shellcheck version once and hands it to the assert step via
`$GITHUB_ENV`; comment fixes (port-taken liveness nuance restored, lint.sh listed as a `common.sh`
consumer, the unsourced "0.11.0 after the ubuntu-latest migration" claim softened).
