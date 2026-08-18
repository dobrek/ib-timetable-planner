# Extract the solver mise task bodies into shellcheck-gated scripts — Plan Brief

> Full plan: `context/changes/solver-mise-scripts-extract/plan.md`
> Research: `context/changes/solver-mise-scripts-extract/research.md`

## What & Why

`mise.toml` is 425 lines, 347 of them inline POSIX sh inside `'''` strings — untestable, unlinted,
and hard to review; three of `solver-deploy-lane`'s nine review findings were shell defects only
ad-hoc probes caught. We move the five solver task bodies into `scripts/solver/*.sh` (plus a small
`common.sh`), keep every task name and behaviour, and put a shellcheck gate in front of them.

## Starting Point

Five tasks (`solver:dev`, `image:build`, `image:smoke`, `tier3`, `hosted`) live as inline bodies;
mise silently supplies `set -e` to inline bodies and **not** to script files, so a naive extraction
drops errexit (research §3). The bodies are already shellcheck-clean; shellcheck is not installed
locally; no CI job executes a mise task, so the tiers are only ever proved by hand.

## Desired End State

`mise.toml` is a catalog (name, description, dir, one-line `run`). `scripts/solver/` holds seven
scripts in one shape (`#!/bin/sh` header, `set -eu` first, self-locate, source `common.sh`).
`mise run solver:check` and CI's `verify` job both run `scripts/solver/lint.sh` with shellcheck
0.11.0. Every tier runs exactly as README documents, Ctrl-C included, and the `/health` liveness
guard can no longer be omitted because it lives inside `wait_for_health`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Scripts self-locate | `cd "$(dirname "$0")/../.."` first; `dev.sh` then `cd services/solver` | Eleven cwd-dependent sites; a wrong `docker build` context fails open | change.md #1 |
| `set -eu` everywhere, incl. `solver:dev` | Named behaviour change + a conformance assertion in the gate | mise gives errexit only to inline bodies; nothing else enforces the fix | change.md #2 |
| Gate placement | Extend `solver:check` + direct CI step in `verify`; no ninth `/verify` step | Mirrors the uv precedent (same command, two callers) | change.md #3 |
| shellcheck version | Pin **0.11.0** in `[tools]` and download that exact release (URL + sha) in CI | Developer/gate parity without depending on the runner image; `ubuntu-24.04` pin superseded | Plan |
| Gate composition | `shellcheck -o check-set-e-suppressed` + `set -eu` conformance; **no `sh -n`** | shellcheck subsumes syntax; `sh -n` on macOS is bash 3.2 and passes dash-rejected bashisms | Plan |
| Helper scope | Mechanism only: `die`, `wait_for_health <url> <timeout> <alive_fn> <dead_line>…` | Only the health wait is a real duplication; the messages are the valuable part and stay at call sites | Plan |
| Shared file name / location | `scripts/solver/common.sh` (not `lib.sh`) | `scripts/lib/` already means "shared modules imported by entry points" | change.md #6 |
| CI health-wait | Stays a third copy | A workflow step cannot cleanly source a repo script | change.md #5 |
| Comment handling | Eight `mise.toml`-only blocks move verbatim; four already-duplicated rationales become pointers | Avoid a third drifting copy of prose that lives in README/lessons | Research §8 |
| Doc reach | Live docs only (README ×4 lines, lessons.md parenthetical, CLAUDE.md sentence) | Prior-lane records are dated snapshots | Plan |
| Verification | Manual tiers 1–3 + hosted rehearsal on the local stack + Ctrl-C parity | No CI job runs a mise task; `hosted` writes to production otherwise | Research §9–10 |

## Scope

**In scope:** seven scripts under `scripts/solver/`; `mise.toml` catalog rewrite; `[tools]`
shellcheck pin; `solver:check` extension; CI `verify` step (pinned install + lint); the two named
behaviour changes; stale "stuck at `queued`" text fix; README/lessons/CLAUDE.md wording; change.md
records.

**Out of scope:** bats/harness, `sh -n`, absorbing CI's health-wait, consolidating env guards /
`profile_value` / traps, `settings.py`/`app.py`, Dockerfile, lefthook hook, `/verify`,
`package.json`, prior-lane citation refresh, `runs-on` pin.

## Architecture / Approach

Gate first, extract under it, then docs. Every script: header block (`.mjs` convention) →
`set -eu` → self-locate → `. scripts/solver/common.sh` → verbatim body. `common.sh` exposes `die` and
`wait_for_health` (liveness predicate mandatory, prose passed in, never called in a condition —
SC2310). `lint.sh` is the single command both mise and CI run. mise invokes each script as
`run = "sh {{config_root}}/scripts/solver/<name>.sh"` — no exec-bit dependency, no Tera rendering,
so all `{% raw %}` guards disappear.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Gate first | shellcheck pin, `common.sh`, `lint.sh`, `solver:check`, CI step | sha/version drift between `mise.toml` and `ci.yml` |
| 2. Tiers 1–2 | `dev.sh`, `image-build.sh`, `image-smoke.sh`; tiers 1–2 re-proved | `solver:dev`'s new `set -eu`/`cd` changing an edge path |
| 3. Tier 3 + hosted | `tier3.sh`, `hosted.sh`; Ctrl-C parity; hosted rehearsal | Trap/errexit interplay after extraction; rehearsal must point at the local stack |
| 4. Docs | README/lessons/CLAUDE.md wording, change.md records | Missing a "where the logic lives" claim |

**Prerequisites:** Docker Desktop, local Supabase up, `ib-solver:local` built, the three `.envs/`
profiles present, `SOLVER_MACHINE_PASSWORD` provisioned locally (all true today per research §9).
**Estimated effort:** ~2 sessions across 4 phases; most wall clock is the manual tier 3 / hosted runs.

## Open Risks & Assumptions

- Manual verification is the only execution these scripts get — a green CI must not stand in for
  "the tiers still work".
- shellcheck 0.11.0 was verified as the latest release today; the pin lives in two places by design.
- `wait_for_health` exposing elapsed seconds (`WAITED_S`) is a plan-level contract the implementer
  may adjust as long as `image-smoke` still prints the "/health is up after Ns" line.
- The `hosted` rehearsal must use `.envs/prod-solver.vars` pointed at the **local** stack; running it
  against hosted creates real proposal plans.

## Success Criteria (Summary)

- All five `mise run solver:*` commands behave as README documents, including Ctrl-C (exit 130,
  cleanup, nothing runs after).
- `mise run solver:check` and CI both run shellcheck 0.11.0 + the `set -eu` conformance check, green.
- `mise.toml` contains no `'''` bodies or `{% raw %}` guards; live docs point at the scripts.
