---
change_id: solver-mise-scripts-extract
title: Extract the solver mise task bodies into tested shell scripts
status: new
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
