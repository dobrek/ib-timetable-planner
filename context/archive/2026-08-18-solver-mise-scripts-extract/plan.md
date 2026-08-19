# Extract the solver mise task bodies into shellcheck-gated scripts — Implementation Plan

## Overview

Move the five solver task bodies (347 lines of inline POSIX sh, 82% of `mise.toml`) into
`scripts/solver/*.sh` plus a small shared `scripts/solver/common.sh`, keep every task name and every
documented behaviour, and attach a shellcheck gate (mise front door + CI step) that lands green on
day one. The change is a **behaviour-preservation exercise with a lint gate attached**, not a DRY
refactor: the one structural improvement is that the `/health` wait's liveness guard (impl-review F2)
becomes impossible to omit because it lives inside the shared helper.

## Current State Analysis

- `mise.toml` (425 lines) holds five task bodies inside `'''` strings, four wrapped in
  `{% raw %}` guards because Docker's `--format '{{.Architecture}}'` collides with Tera:
  `solver:dev` (`:32-59`, **no explicit `set -eu`**), `solver:image:build` (`:86-99`),
  `solver:image:smoke` (`:106-204`), `solver:tier3` (`:213-293`), `solver:hosted` (`:300-424`).
- mise supplies `-o errexit` to inline bodies (`sh -c -o errexit`) and **not** to script files
  (plain `sh`) — a verbatim extraction silently drops errexit; for `solver:hosted` that means a
  Ctrl-C during the health wait continues into `pnpm build`/`pnpm preview` and mise exits 0
  (research §3). Every other mechanism was probed and preserved: `dir`, `_.path`, stdin to `read -r`,
  exit-code propagation, SIGINT delivery to the trap; `{{config_root}}` renders in the `run` line;
  script content is not Tera-rendered (research §2).
- The bodies are already shellcheck-clean (0.11.0, zero findings at default severity).
  shellcheck is **not installed locally**; it is in the mise registry (`aqua:koalaman/shellcheck`,
  versions 0.9.0 / 0.10.0 / 0.11.0). Latest release is v0.11.0, linux asset
  `shellcheck-v0.11.0.linux.x86_64.tar.xz`. `ubuntu-latest` preinstalls 0.9.0.
- `scripts/` holds three `.mjs` entry points and `scripts/lib/` (shared modules); zero `.sh` files;
  no script is invoked from mise today. The `.mjs` header convention
  (`scripts/provision-solver-user.mjs:1-20`): shebang, one-line purpose, why-not-how prose, usage
  lines, closing pointer to the authoritative doc.
- `scripts/solver/*.sh` sits in every other gate's blind spot (ESLint ignores `scripts/`, prettier
  has no sh parser, steiger covers `src`, lefthook globs match no `.sh`, vitest cannot reach it) —
  the shellcheck step is the only thing that will ever look at these files (research §7).
- No CI job executes a mise task; the only *execution* the scripts get is a developer running the
  tiers by hand (research §10).
- Eleven sites depend on cwd (`docker build … .`, `.envs/local.vars`, `contracts/fixtures/…`,
  `.dev.vars`, `.envs/prod-solver.vars`, `cd services/solver`) — as files the scripts become
  directly invocable, so a wrong cwd is a new, fail-open failure mode (research §11).

## Desired End State

- `mise.toml` is a catalog: each solver task is `description` + `dir` + a one-line
  `run = "sh {{config_root}}/scripts/solver/<name>.sh"`; no `'''` bodies, no `{% raw %}`.
- `scripts/solver/` contains `common.sh`, `lint.sh`, `dev.sh`, `image-build.sh`, `image-smoke.sh`,
  `tier3.sh`, `hosted.sh`. Every script: `#!/bin/sh` header block in the `.mjs` convention,
  `set -eu` as its first non-comment line, self-locates to the repo root, sources `common.sh`.
- `mise run solver:check` runs ruff + mypy + `scripts/solver/lint.sh`; CI's `verify` job installs
  shellcheck 0.11.0 (pinned URL + sha256, version asserted) and runs the same `lint.sh`.
- `mise run solver:dev|image:build|image:smoke|tier3|hosted` behave exactly as README documents,
  including Ctrl-C (trap fires, exit 130, nothing runs afterwards) — verified by hand for tiers 1–3
  and by a local-stack rehearsal for `hosted`.
- The three live-doc lines that describe *where the logic lives* (`README.md:125`, `:184`,
  `lessons.md:86`) are reworded; `README.md:332` names `pnpm check`; the stale "stuck at `queued`"
  text is gone; `change.md` records that decision 4 was superseded.

### Key Discoveries

- `mise.toml:44-57` — `solver:dev`'s guard block; `:54-55` is the stale pre-2026-08-18 outcome text
  contradicted by `:38-40` (fix while moving).
- `mise.toml:163-176` and `:404-419` — the two `/health` wait loops; timeouts differ (90 s vs 60 s),
  liveness predicates differ (`docker inspect …State.Running` vs `kill -0 "$SOLVER_PID"`), and the
  dead-process prose differs — the helper must take all three as parameters (research §Architecture
  Insights: the messages are the valuable part).
- `mise.toml:249` and `:365-375` — the two cleanup traps share exactly one line (`pnpm env:local`);
  they stay bespoke.
- Comment classes (research §8): eight blocks whose only home is `mise.toml` **move verbatim**
  (`:326-329` port collision, `:165-169` and `:406-412` liveness prose, `:271-274` dotenv quoting,
  `:202-203` `SMOKE_JOB_ID`, `:148-150` `--add-host`, `:124-131` key fallback, `:393-401`
  non-Darwin branch); four rationales already duplicated in living docs become **pointers**
  (credential-guard `:33-43` → README § Tier 1 / lessons.md; fails-open validator `:109-112` →
  CLAUDE.md / README § Tier 2; `.dev.vars` ordering `:216-228` → README § Tier 3 / lessons.md;
  production-write banner rationale `:337-353` → the banner itself is UX and moves verbatim, the
  README § hosted-solve campaign is the pointer for the *why*).
- `.github/workflows/ci.yml:24` — first `run:` step of `verify`; the shell gate slots before it so a
  shell defect fails in ~1 s. `ci.yml:61-66` / `:191-199` — the uv pin comment style ("must move with
  `mise.toml`") to mirror for the shellcheck pin.
- shellcheck's `-o check-set-e-suppressed` (SC2310) is what catches function-in-condition errexit
  suppression; bare shellcheck says nothing; `-o all` yields 54 style findings (research §4).
- `sh -n` on macOS is bash 3.2 and passes dash-rejected bashisms; shellcheck flags them (SC3043,
  SC3010, SC3024, SC3037) — the gate is shellcheck alone (research §6).

## What We're NOT Doing

- No behaviour change beyond the two **named** ones: `solver:dev` gains `set -eu`, and every script
  self-locates (so `solver:dev` gets an explicit `cd services/solver`).
- No `bats`/`shunit2` harness; no `sh -n` step (decorative on macOS — recorded, not forgotten).
- Not absorbing the third `/health` wait in `.github/workflows/ci.yml:84-102` (change.md decision 5).
- Not consolidating the env guards, `profile_value`, or the cleanup traps into `common.sh`
  (helper scope = mechanism only; the guards are three different predicates whose remediation prose
  belongs at the call site).
- Not touching `solver:test`/`solver:check`'s uv commands, `settings.py`/`app.py`, the Dockerfile,
  `.dockerignore`, `lefthook.yml`, `/verify`, or `package.json`.
- Not repointing the `mise.toml:NNN` citations inside `context/changes/solver-deploy-lane/*` —
  historical records of a closed lane stay as written.
- Not pinning `runs-on: ubuntu-24.04` (decision 4 superseded: the pinned download makes the runner's
  preinstalled shellcheck irrelevant).
- Not adding a lefthook shellcheck hook.

## Implementation Approach

Gate first, then extract under it, then docs. Phase 1 lands `[tools] shellcheck`, `common.sh`,
`lint.sh`, the `solver:check` extension and the CI step on two files, so every script written in
phases 2–3 is linted as it is written and the SC2310 hazard `common.sh` introduces is visible from
the start. Phases 2 and 3 split the extraction along the manual-verification boundary: tiers 1–2
are cheap to prove (seconds; image already built), tier 3 + hosted cost a build and a workerd/preview
session each and carry the Ctrl-C parity check. Phase 4 is the doc pass required by lessons.md's
"a convention that cites a mechanism is coupled to it" rule.

Every script follows one shape, in this order:

1. `#!/bin/sh` + header block (purpose · why-not-how prose · `# Usage: mise run solver:<name>` and
   the env it reads · `# See README § <section>`).
2. `set -eu` — first non-comment, non-blank line (what `lint.sh` asserts).
3. `cd "$(dirname "$0")/../.." || exit 1` — self-locate to the repo root.
4. `. scripts/solver/common.sh`.
5. The body, verbatim from `mise.toml` except for the deliberate deltas named per phase.

Diagnostics stay bare `echo … >&2` (user-facing UX prose), **not** the `.mjs` `[script-name]`
prefix — a deliberate difference (research §Architecture Insights).

## Critical Implementation Details

- **Timing & lifecycle** — `set -eu` must be present in every file: mise runs script files with plain
  `sh`, so a file without it runs past failures and Ctrl-C (research §3). `common.sh` is sourced
  after `set -eu`, so its own `set -eu` line is redundant at runtime but required by the conformance
  rule (one rule, no exceptions). Traps: install them exactly where the bodies do today
  (`tier3.sh` after the password guard and before the `.dev.vars` rewrite; `hosted.sh` after the
  confirm prompt and before `pnpm env:prod-solver`).
- **`wait_for_health` must never be called inside a condition** (`if`, `||`, `&&`) — that would
  disable errexit inside it and shellcheck reports it as SC2310. It exits the script itself on
  liveness failure or timeout; callers call it as a plain statement and echo their own success line
  afterwards. The `alive_fn` argument is a function *name*, invoked inside the helper as
  `"$alive_fn"` — a variable expansion, which shellcheck does not treat as a function-in-condition.
- **Debug & observability** — after each extraction phase, `mise run solver:check` and
  `sh scripts/solver/lint.sh` are the only automated contact; the tiers themselves must be run by hand
  (Manual Verification below). Do not let a green CI stand in for "the tiers still work".

## Phase 1: Gate first — tool pin, `common.sh`, `lint.sh`, `solver:check`, CI step

### Overview

Land the shellcheck gate on the two files that exist without any extraction (`common.sh`,
`lint.sh`) so phases 2–3 are written under it. Pins shellcheck 0.11.0 on both sides.

### Changes Required:

#### 1. shellcheck tool pin

**File**: `mise.toml` (`[tools]`)

**Intent**: Make the local loop non-blind — `mise install` gives every developer the same shellcheck
CI runs. Add `shellcheck = "0.11.0"` under `uv`, with a comment mirroring the `uv` pin's rationale:
this literal must equal the version `ci.yml`'s install step downloads; move the two together.

**Contract**: `mise x -- shellcheck --version` prints `version: 0.11.0`. Update the header comment
of `mise.toml` (lines 1-11) with one sentence: task bodies live in `scripts/solver/*.sh`, `mise.toml`
is the catalog, and shellcheck (via `solver:check` / CI) is the gate on them.

#### 2. Shared helpers

**File**: `scripts/solver/common.sh` (new)

**Intent**: Mechanism-only helpers sourced by every task script: `die`, `wait_for_health`. Nothing
else — env guards, banners, `profile_value`, cleanup traps stay in the callers. Header block states
this scope explicitly (and names the consumers by path, mirroring `scripts/lib/catalog-transcode.mjs`).

**Contract**: sourced with `. scripts/solver/common.sh` after the caller has `cd`'d to the repo
root. Carries `set -eu` first (conformance rule). `die` is `wait_for_health`'s internal exit path
(the `dead_line`s and the timeout message) — no caller in phases 2–3 uses it, because every moved
guard keeps its verbatim `echo … >&2; exit 1` with the remediation prose at the call site; do not
retrofit the guards onto it. The one signature other phases depend on is `wait_for_health`:

```sh
# die <line>...        — each argument printed as its own stderr line, then exit 1
die() { for line in "$@"; do echo "$line" >&2; done; exit 1; }

# wait_for_health <url> <timeout_s> <alive_fn> <dead_line>...
#   Polls <url> once a second until curl -sf succeeds. BEFORE each retry it invokes <alive_fn>
#   (a function name defined by the caller); if that fails, prints the <dead_line>s to stderr and
#   exits 1 — a process that died must never leave us polling until something ELSE answers on the
#   port. Exits 1 with a generic message after <timeout_s>. Never call this inside a condition
#   (errexit is disabled inside a function called from `if`/`||` — SC2310).
```

Success prints nothing; the caller echoes its own line (`/health is up after …` /
`solver is up and its startup credential check passed`) — so `wait_for_health` must expose the
elapsed seconds by setting `WAITED_S` before returning, since `image-smoke` prints it. That
assignment is an out-parameter with no reader inside `common.sh`, so shellcheck 0.11.0 reports
`SC2034 (warning): WAITED_S appears unused` and exits 1 when it checks the file (verified on a
prototype during plan review, with and without `-x`). Write it with an inline directive that carries
its reason — the same policy as `# type: ignore` in the solver package:

```sh
# shellcheck disable=SC2034  # out-parameter, read by callers after wait_for_health returns
WAITED_S=$waited
```

No other directive is expected in the tree; a second one should be a review question.

#### 3. The lint script

**File**: `scripts/solver/lint.sh` (new)

**Intent**: One command run by both the mise front door and CI (the uv precedent: same underlying
command, two callers): `shellcheck -o check-set-e-suppressed scripts/solver/*.sh`, then the
`set -eu` conformance assertion — for each `scripts/solver/*.sh`, the first non-blank, non-comment
line must be exactly `set -eu`; print each offender and exit 1. Header explains *why* the
conformance check exists (mise supplies errexit only to inline bodies) and why `sh -n` is absent.

**Contract**: exit 0 on the current tree; exit non-zero with the offending path when a script lacks
`set -eu` in position (verify by temporarily commenting it out in `common.sh`). Self-locates like
every other script; itself passes both checks (it is matched by its own glob).

#### 4. mise front door

**File**: `mise.toml` (`[tasks."solver:check"]`)

**Intent**: Extend `run` with a third element `"sh {{config_root}}/scripts/solver/lint.sh"` and
update `description` ("Lint and type-check the solver, and shellcheck its task scripts — the same
gates CI's solver and verify jobs run"). `dir` stays `services/solver` for the uv commands; the lint
script self-locates.

**Contract**: `mise run solver:check` runs ruff → mypy → lint.sh and fails on the first red.

#### 5. CI step

**File**: `.github/workflows/ci.yml` (`verify` job)

**Intent**: Before `pnpm astro sync`, add two steps: install shellcheck **0.11.0** from the pinned
GitHub release URL (`shellcheck-v0.11.0.linux.x86_64.tar.xz`) with a sha256 check of the tarball,
placing the binary ahead of the image's preinstalled 0.9.0 on `PATH` (e.g. `$HOME/.local/bin` via
`$GITHUB_PATH`, or `/usr/local/bin`), and asserting `shellcheck --version` reports 0.11.0; then
`run: sh scripts/solver/lint.sh`. Comment mirrors `ci.yml:191-199`: the version literal must equal
`mise.toml`'s `shellcheck = "…"`; bump both together. `runs-on` stays `ubuntu-latest`.

**Contract**: the step is a plain `- run:` inside `verify` — no `needs:`/`if:`/path filter changes
(`ci.yml:166-176` forbids filters). Failure output names the file:line from shellcheck.

#### 6. Record the superseded decision

**File**: `context/changes/solver-mise-scripts-extract/change.md`

**Intent**: Under "Decisions taken", append that decision 4's `runs-on: ubuntu-24.04` half is
superseded (2026-08-18, planning): the developer/gate parity is achieved by pinning the download to
the same version as `[tools]`, not by pinning the runner image. Set `status: planned`.

### Success Criteria:

#### Automated Verification:

- `mise install` provisions shellcheck 0.11.0 (`mise x -- shellcheck --version`)
- `mise run solver:check` passes (ruff, mypy, lint.sh)
- `sh scripts/solver/lint.sh` exits 0; with `set -eu` commented out of `common.sh` it exits non-zero naming the file
- `shellcheck -o check-set-e-suppressed scripts/solver/*.sh` reports zero findings
- CI `verify` job green on the branch, with the shellcheck step logging `version: 0.11.0`

#### Manual Verification:

- The pinned tarball sha256 in `ci.yml` was computed from the downloaded artifact, not typed from memory

---

## Phase 2: Extract tiers 1–2 — `dev.sh`, `image-build.sh`, `image-smoke.sh`

### Overview

Move the three cheap-to-prove bodies. `solver:dev` acquires `set -eu` and an explicit
`cd services/solver` (both named behaviour changes); `image-smoke` is the first consumer of
`wait_for_health`. Tier 1 and 2 are re-run by hand.

### Changes Required:

#### 1. `solver:dev`

**File**: `scripts/solver/dev.sh` (new); `mise.toml` (`[tasks."solver:dev"]`)

**Intent**: Move `mise.toml:44-58` verbatim, with three deltas: `set -eu` (named exception to
"no behaviour change" — change.md decision 2); after self-locating, `cd services/solver` before
`uv run uvicorn …` (replaces the `dir` it relied on); and the stale remediation text at
`mise.toml:54-55` ("stuck at 'queued' with an orphan proposal plan") is replaced by the current
outcome already worded at `README.md:184` (refused with a 503, row `failed`, clone deleted). The
credential-guard rationale (`:33-43`) becomes a two-line pointer to README § Tier 1 and the
lessons.md guard-placement rule — it is duplicated in four living docs already. The mise task
becomes `dir = "{{config_root}}"`, `run = "sh {{config_root}}/scripts/solver/dev.sh"`.

**Contract**: identical stdout/stderr text on the missing-trio path (except the corrected two lines)
and identical uvicorn invocation (`--port 8000`, cwd `services/solver`).

#### 2. `solver:image:build`

**File**: `scripts/solver/image-build.sh` (new); `mise.toml`

**Intent**: Move `mise.toml:87-98` verbatim; the amd64 assertion comment (`:90-91`) moves with it.
The `{% raw %}` guard disappears — the script is not Tera-rendered, so `--format '{{.Architecture}}'`
needs no escaping. Self-location makes `docker build … .` safe from any cwd (research §11).

**Contract**: prints `ib-solver:local  arch=amd64  size=… MB`; exits 1 with the same message on a
non-amd64 image.

#### 3. `solver:image:smoke`

**File**: `scripts/solver/image-smoke.sh` (new); `mise.toml`

**Intent**: Move `mise.toml:107-203` with one structural change: the wait loop `:163-176` becomes a
`wait_for_health http://127.0.0.1:8000/health 90 smoke_alive "<the two :166-167 lines>"` call, with
`smoke_alive() { [ "$(docker inspect -f '{{.State.Running}}' "$container")" = "true" ]; }` defined
beside it, followed by the caller's own `echo "/health is up after ${WAITED_S}s"`. Comments that
move verbatim: `:124-131` key fallback, `:148-150` `--add-host`, `:165-169` liveness prose (now the
`dead_line`s), `:202-203` `SMOKE_JOB_ID`. The fails-open validator rationale (`:109-112`) becomes a
pointer to CLAUDE.md / README § Tier 2 with its one-sentence core kept (a `/health` probe is not
sufficient — that is the point of this task).

**Contract**: 202 on the golden body; the container-log `cleanup` trap unchanged; refuses without
`SOLVER_MACHINE_PASSWORD` with the same text.

#### 4. Catalog cleanup

**File**: `mise.toml`

**Intent**: The three tasks are now `description` + `dir = "{{config_root}}"` + one-line `run`. Keep
the section banners (`# --- solver …`, `# --- local fidelity tier 2 …`) — they are catalog-level
orientation, not body comments — but trim any sentence that now duplicates a script header.

### Success Criteria:

#### Automated Verification:

- `mise run solver:check` passes (lint.sh covers the three new scripts)
- `mise tasks ls` still lists `solver:dev`, `solver:image:build`, `solver:image:smoke` with their descriptions
- `grep -c '{% raw %}' mise.toml` shows only the two remaining tasks (tier3, hosted) — none after Phase 3
- `mise run solver:dev` with the trio unset exits 1 with the remediation block (automatable: run under `env -u`)

#### Manual Verification:

- Tier 1: `set -a; . .envs/local.vars; set +a; export SOLVER_MACHINE_PASSWORD=…; mise run solver:dev` logs `credential_configured=True` and `startup credential check passed`
- Tier 2: `mise run solver:image:build` prints `arch=amd64`; `SOLVER_MACHINE_PASSWORD=… mise run solver:image:smoke` prints `202 accepted for job …` and the container log block on exit
- Smoke without the password refuses with the same message; smoke with a stopped stack hits the liveness bail (`the container exited before binding :8000 …`), not the 90 s timeout
- `sh scripts/solver/image-build.sh` invoked from `services/solver/` (wrong cwd) still builds with the repo-root context

**Implementation Note**: After completing this phase and all automated verification passes, pause
for manual confirmation before Phase 3.

---

## Phase 3: Extract tier 3 + the hosted campaign — `tier3.sh`, `hosted.sh`

### Overview

Move the two largest bodies, both trap-carrying; `hosted.sh` is the second `wait_for_health`
consumer. Prove Ctrl-C parity (the §3 regression) and rehearse the hosted campaign against the local
stack — it writes to production otherwise.

### Changes Required:

#### 1. `solver:tier3`

**File**: `scripts/solver/tier3.sh` (new); `mise.toml`

**Intent**: Move `mise.toml:214-292` verbatim, `{% raw %}` gone. Trap installed exactly where it is
today (`:249`, after the password guard, before the rewrite). Comments moving verbatim: `:234-239`
(why the password must be *written*, not exported), `:251-262` (the three edits), `:271-274` (dotenv
quoting / unrepresentable `'`). The `.dev.vars` ordering rationale (`:216-228`) becomes a pointer to
README § Tier 3 + lessons.md ("A Worker forwards only what `.dev.vars` holds"), keeping the one bold
sentence "the ordering below is load-bearing" in place.

**Contract**: rewrites `.dev.vars` → `pnpm build` → `wrangler dev --enable-containers --port
${TIER3_PORT:-8787}`; the EXIT/INT/TERM trap runs `pnpm env:local`.

#### 2. `solver:hosted`

**File**: `scripts/solver/hosted.sh` (new); `mise.toml`

**Intent**: Move `mise.toml:301-423` with one structural change: the wait loop `:404-419` becomes
`wait_for_health http://127.0.0.1:8000/health 60 solver_alive "<the :409-410 lines>"` with
`solver_alive() { kill -0 "$SOLVER_PID" 2>/dev/null; }`, followed by the caller's
`echo "solver is up and its startup credential check passed"`. Everything else — profile existence
and four-key checks, the `:8000` collision guard **and its comment `:326-329`** (the sharpest
comment in the file; its only other home is `solver-deploy-lane/change.md:23`), the banner, the
confirm prompt, `cleanup`/trap, `profile_value` and its READ-not-sourced comment (`:379-384`), the
Darwin/`caffeinate` fork with its comment (`:393-401`) — moves verbatim. The banner's *why* is
pointed at README § The hosted-solve campaign.

**Contract**: identical prompt/bypass behaviour (`SOLVER_HOSTED_CONFIRM=yes`), identical
`pnpm env:prod-solver` → solver → build → preview sequence, cleanup on EXIT/INT/TERM.

#### 3. Catalog cleanup

**File**: `mise.toml`

**Intent**: Both tasks become one-liners; no `'''` strings and no `{% raw %}` remain anywhere in
the file. `mise.toml` should end up well under 100 lines.

### Success Criteria:

#### Automated Verification:

- `mise run solver:check` passes on all seven scripts
- `grep -c "'''" mise.toml` and `grep -c '{% raw %}' mise.toml` are both 0
- `mise tasks ls` lists all five solver tasks with unchanged names and descriptions
- `pnpm build` still clean (nothing here should touch it, but tier 3 rewrites `.dev.vars` — confirm the trap restored it: `.dev.vars*` is gitignored so `git status` cannot show it; probe with `grep -q '^SOLVER_URL=' .dev.vars && grep -q 127.0.0.1 .env.local`)

#### Manual Verification:

- Tier 3: `export SOLVER_MACHINE_PASSWORD=…; mise run solver:tier3` — refuses without Docker / without the password with the same text; with both, rewrites `.dev.vars`, builds, starts workerd; Generate on a local plan shows the POST in the container's `docker logs`
- **Ctrl-C parity on tier 3**: interrupt during `pnpm build` — the trap message prints, `.dev.vars` is back to the local profile, mise's exit code is 130, and `wrangler dev` never starts
- Hosted rehearsal: point `.envs/prod-solver.vars` at the local stack; `mise run solver:hosted` — profile-missing and missing-key paths refuse; with `solver:dev` holding `:8000` the collision guard refuses and lists the listener; banner prints; typing anything but `hosted` aborts with "nothing was changed"; `SOLVER_HOSTED_CONFIRM=yes` bypasses; the solver comes up (`solver is up …`), build + preview run
- **Ctrl-C parity on hosted**: interrupt during the health wait — cleanup prints, the solver process is gone (`lsof -iTCP:8000` empty), profile back on local (`grep SUPABASE_URL .env.local` is `127.0.0.1`), exit code 130, and `pnpm build`/`pnpm preview` never ran
- Hosted liveness bail: with a wrong `SOLVER_MACHINE_PASSWORD` in the (local-pointed) profile the run stops with "the solver process exited before answering /health …", not the 60 s timeout
- After all runs `pnpm env:local` state is confirmed and `.dev.vars` carries `SOLVER_URL` again

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Docs and records

### Overview

Update the live docs that describe where the logic lives (lessons.md's coupling rule makes this part
of the definition of done), plus the free fixes noted in `change.md`.

### Changes Required:

#### 1. README

**File**: `README.md`

**Intent**: (a) `:125` — "`solver:hosted` reads keys with `sed`" → name the script
(`scripts/solver/hosted.sh` reads keys with `sed`); (b) `:184` — "That guard is task-level on
purpose" → "That guard lives in the launcher script (`scripts/solver/dev.sh`), not the service, on
purpose"; (c) `:332` — the `verify` job list gains `pnpm check` and the shellcheck step
(`shellcheck scripts/solver` → `astro sync` → `check` → …); (d) one sentence in
"Running the solver service (dev)" after the tier table: task bodies live in `scripts/solver/*.sh`,
`mise.toml` is the catalog, and `mise run solver:check` shellchecks them (0.11.0, pinned in
`mise.toml` and CI); (e) `:165` — the `solver:check` comment "ruff + mypy --strict, the same two
gates CI runs" → "ruff + mypy --strict + shellcheck on `scripts/solver` — the same gates CI's solver
and verify jobs run" (Phase 1 §4 changes what the task does; this line cites it). Keep every
`mise run solver:*` command unchanged.

**Contract**: prose only; no command in README changes.

#### 2. lessons.md

**File**: `context/foundation/lessons.md` (last section, "A Worker forwards only what `.dev.vars` holds")

**Intent**: Amend the parenthetical "(mise task, CI step)" → "(the launcher script a mise task
invokes — `scripts/solver/*.sh` — or a CI step)". Register is append-only in spirit; this is the
mechanism-citation fix the register's own rule (`:68-73`) demands, so edit in place with a dated
note rather than appending a new lesson.

**Contract**: the rule's binding contrast (launcher vs *service*) is unchanged.

#### 3. CLAUDE.md

**File**: `CLAUDE.md` (Solver package section, last bullet)

**Intent**: Extend "Cross-ecosystem tasks run through **mise**…" with: task bodies live in
`scripts/solver/*.sh` (POSIX sh, `set -eu` first, self-locating, sourcing `common.sh`) and are
shellcheck-gated by `mise run solver:check` and CI — new solver task = new script + one-line `run`.

**Contract**: one sentence; no new hard rule beyond the existing "never add solver steps to
`package.json`".

#### 4. change.md

**File**: `context/changes/solver-mise-scripts-extract/change.md`

**Intent**: Note the free fixes taken (stale `queued` text, `README.md:332`) and that `sh -n` was
dropped from the gate by decision (research §6). Status stays `planned` until `/10x-implement`
flips it.

### Success Criteria:

#### Automated Verification:

- `pnpm format` (prettier on README/CLAUDE.md/lessons.md) clean; `pnpm lint` unaffected
- `grep -n "task-level\|reads keys with \`sed\`" README.md` shows the reworded lines; `grep -n "the same two gates CI runs" README.md` returns nothing
- `grep -n "mise task, CI step" context/foundation/lessons.md` returns nothing
- `/verify` PASS

#### Manual Verification:

- README § Tier 1/2/3 and § hosted campaign read correctly against the extracted scripts (a reader following them lands in the right file)

---

## Testing Strategy

### Unit Tests:

- None (no bats harness by scope). `lint.sh` is the only automated check: shellcheck
  `-o check-set-e-suppressed` + the `set -eu` conformance assertion.

### Integration Tests:

- Unchanged: CI's `integration` job starts uvicorn directly and does not run mise; the extracted
  scripts have no CI execution.

### Manual Testing Steps:

1. Phase 2: tier 1 refused-then-started; tier 2 build + smoke 202; smoke refused without password;
   liveness bail with the stack down; wrong-cwd build still correct.
2. Phase 3: tier 3 full run + Ctrl-C parity (exit 130, `.dev.vars` restored, wrangler never
   started); hosted rehearsal on the local stack through every branch (missing profile, missing key,
   `:8000` collision, banner, abort, bypass, up, Ctrl-C parity, liveness bail).
3. Phase 4: docs read-through.

## Performance Considerations

None at runtime. The CI step adds ~5 s (download + shellcheck on seven small files).

## Migration Notes

No data or deploy impact: `scripts/` cannot reach the container image (`.dockerignore` positive
list; Dockerfile COPYs only `contracts` and `services/solver`), and no `wrangler.jsonc` change.
`mise install` is needed once per machine to pick up shellcheck.

## References

- Change brief and settled decisions: `context/changes/solver-mise-scripts-extract/change.md`
- Research: `context/changes/solver-mise-scripts-extract/research.md` (§2 mechanics, §3 errexit,
  §4 SC2310, §6 macOS `sh -n`, §8 comment classes, §9 verification, §11 cwd)
- Origin: `context/changes/solver-deploy-lane/reviews/impl-review.md:44-70` (F2, F3)
- Bodies being moved: `mise.toml:32-59, 86-99, 106-204, 213-293, 300-424`
- Header convention: `scripts/provision-solver-user.mjs:1-20`; consumers-by-path convention:
  `scripts/lib/catalog-transcode.mjs:1-19`
- CI pin comment style: `.github/workflows/ci.yml:191-199`
- lessons.md: `:68-73` (mechanism-citation coupling), `:82-87` (guard in the launcher)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Gate first — tool pin, `common.sh`, `lint.sh`, `solver:check`, CI step

#### Automated

- [x] 1.1 `mise install` provisions shellcheck 0.11.0 (`mise x -- shellcheck --version`) — 5e40ed7
- [x] 1.2 `mise run solver:check` passes (ruff, mypy, lint.sh) — 5e40ed7
- [x] 1.3 `sh scripts/solver/lint.sh` exits 0; with `set -eu` commented out of `common.sh` it exits non-zero naming the file — 5e40ed7
- [x] 1.4 `shellcheck -o check-set-e-suppressed scripts/solver/*.sh` reports zero findings — 5e40ed7
- [x] 1.5 CI `verify` job green on the branch, with the shellcheck step logging `version: 0.11.0` — 5e40ed7

#### Manual

- [x] 1.6 The pinned tarball sha256 in `ci.yml` was computed from the downloaded artifact, not typed from memory — 5e40ed7

### Phase 2: Extract tiers 1–2 — `dev.sh`, `image-build.sh`, `image-smoke.sh`

#### Automated

- [x] 2.1 `mise run solver:check` passes (lint.sh covers the three new scripts) — 161c0d7
- [x] 2.2 `mise tasks ls` still lists `solver:dev`, `solver:image:build`, `solver:image:smoke` with their descriptions — 161c0d7
- [x] 2.3 `grep -c '{% raw %}' mise.toml` shows only the two remaining tasks (tier3, hosted) — 161c0d7
- [x] 2.4 `mise run solver:dev` with the trio unset exits 1 with the remediation block — 161c0d7

#### Manual

- [x] 2.5 Tier 1: `mise run solver:dev` with the trio logs `credential_configured=True` and `startup credential check passed` — 161c0d7
- [x] 2.6 Tier 2: `mise run solver:image:build` prints `arch=amd64`; `mise run solver:image:smoke` prints `202 accepted for job …` and the container log block on exit — 161c0d7
- [x] 2.7 Smoke without the password refuses with the same message; smoke with a stopped stack hits the liveness bail, not the 90 s timeout — 161c0d7
- [x] 2.8 `sh scripts/solver/image-build.sh` invoked from `services/solver/` still builds with the repo-root context — 161c0d7

### Phase 3: Extract tier 3 + the hosted campaign — `tier3.sh`, `hosted.sh`

#### Automated

- [x] 3.1 `mise run solver:check` passes on all seven scripts — d2213eb
- [x] 3.2 `grep -c "'''" mise.toml` and `grep -c '{% raw %}' mise.toml` are both 0 — d2213eb
- [x] 3.3 `mise tasks ls` lists all five solver tasks with unchanged names and descriptions — d2213eb
- [x] 3.4 `pnpm build` still clean and the trap restored `.dev.vars` (`grep -q '^SOLVER_URL=' .dev.vars && grep -q 127.0.0.1 .env.local` — gitignored, so not via `git status`) — d2213eb

#### Manual

- [x] 3.5 Tier 3: refuses without Docker / without the password; with both, rewrites `.dev.vars`, builds, starts workerd; Generate shows the POST in the container's `docker logs` — d2213eb
- [x] 3.6 Ctrl-C parity on tier 3: trap message, `.dev.vars` restored, exit 130, `wrangler dev` never starts — d2213eb
- [x] 3.7 Hosted rehearsal on the local stack: missing profile / missing key refuse; `:8000` collision refuses; banner; abort on wrong answer; `SOLVER_HOSTED_CONFIRM=yes` bypass; solver up; build + preview run — d2213eb
- [x] 3.8 Ctrl-C parity on hosted: cleanup prints, solver gone, profile back on local, exit 130, build/preview never ran — d2213eb
- [x] 3.9 Hosted liveness bail with a wrong password stops on "the solver process exited before answering /health …", not the 60 s timeout — d2213eb
- [x] 3.10 After all runs `pnpm env:local` state is confirmed and `.dev.vars` carries `SOLVER_URL` again — d2213eb

### Phase 4: Docs and records

#### Automated

- [x] 4.1 `pnpm format` clean; `pnpm lint` unaffected — f8efef2
- [x] 4.2 `grep -n "task-level\|reads keys with \`sed\`" README.md` shows the reworded lines; `grep -n "the same two gates CI runs" README.md` returns nothing — f8efef2
- [x] 4.3 `grep -n "mise task, CI step" context/foundation/lessons.md` returns nothing — f8efef2
- [x] 4.4 `/verify` PASS — f8efef2

#### Manual

- [x] 4.5 README § Tier 1/2/3 and § hosted campaign read correctly against the extracted scripts — f8efef2
