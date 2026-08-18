---
change_id: solver-mise-scripts-extract
title: Extract the solver mise task bodies into tested shell scripts
status: implementing
created: 2026-08-18
updated: 2026-08-18
archived_at: null
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
