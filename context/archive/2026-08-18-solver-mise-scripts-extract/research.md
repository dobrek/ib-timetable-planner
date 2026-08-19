---
date: 2026-08-18T13:20:44+02:00
researcher: Dobromir Kropielnicki
git_commit: d7dc4f5912930d84f9e6832e31213f39cf866cfd
branch: feat/solver-mise-scripts-extract
repository: 10xdev3
topic: "solver-mise-scripts-extract — feasibility, risks and challenges"
tags: [research, codebase, mise, shell, ci, solver, tooling]
status: complete
last_updated: 2026-08-18
last_updated_by: Dobromir Kropielnicki
---

# Research: solver-mise-scripts-extract — feasibility, risks and challenges

**Date**: 2026-08-18T13:20:44+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: `d7dc4f5912930d84f9e6832e31213f39cf866cfd`
**Branch**: `feat/solver-mise-scripts-extract` (local-only, no upstream — no GitHub permalinks)
**Repository**: 10xdev3

## Research Question

Check the feasibility, risks and challenges of `solver-mise-scripts-extract`: moving the inline
POSIX-sh bodies of five `mise` tasks out of `mise.toml` into `scripts/solver/*.sh` plus a shared
`scripts/solver/lib.sh`, and adding `shellcheck` + `sh -n` as a CI gate.

Scope agreed before research: establish the mise→script behavioural facts by **empirical probe**
rather than prediction; treat the test ambition as filed (shellcheck + `sh -n`, not a bats harness);
weigh all four risk dimensions (behaviour-preservation, verification cost, doc drift, CI/tooling).

## Summary

**The change is feasible, and mechanically it is a small diff.** Every mechanism it depends on was
verified working: `dir` semantics survive, `{{config_root}}` templating in the `run` line resolves,
`_.path` still reaches the script, stdin still reaches `read -r`, exit codes propagate unchanged,
and script content is no longer Tera-rendered — so all four `{% raw %}` guards disappear outright.
The existing bodies are already POSIX-clean: **shellcheck 0.11.0 reports zero findings** across all
347 lines at default severity, so the proposed gate lands green on day one with no remediation wave.

Three findings should change how the change is planned:

1. **`mise` silently supplies `set -e` to inline bodies and *not* to script files.** Measured:
   `unix_default_inline_shell_args` is `sh -c -o errexit`, `unix_default_file_shell_args` is plain
   `sh`. An inline body runs with shell flags `ehBc`; the same body in a `.sh` file runs with `hB`.
   **`solver:dev` is the one task with no explicit `set -eu`** (`mise.toml:32-59`) — it relies
   entirely on that implicit flag. Verbatim extraction silently drops errexit.
   The worst concrete case is `solver:hosted`: modelled faithfully and probed, a Ctrl-C during the
   health wait in a body that lost `set -eu` fires the cleanup trap (restoring the local profile),
   then **continues into `pnpm build` and `pnpm preview`**, and mise reports **exit 0 — success**.
   Today that is impossible. Parity is fully restorable — a script carrying `set -eu` behaved
   byte-identically to the inline form (trap fires, exit 130) — but it is restored by a convention
   nothing enforces.

2. **The proposed gate does not catch the defect class that motivated the change.** Against a probe
   carrying the five defects this change cites as its rationale, `sh -n` caught **none** and
   shellcheck caught **one**, incidentally (`SC1090` on the `. "$profile"` sourcing, phrased as
   "can't follow non-constant source" — an analysability complaint, not a security one). The missing
   liveness guard (F2), the `$(printf '\n')` inversion, and a missing `set -eu` are all invisible to
   it. Worse, `sh -n` on macOS is close to worthless: `/bin/sh` is bash 3.2, and it **passed** a
   helper using `local`, `[[ ]]`, `+=` and `echo -e` — four constructs dash would reject on CI.
   shellcheck flagged all four. So shellcheck is the load-bearing gate and `sh -n` is close to
   decorative — and shellcheck is **not installed on this machine**.

3. **The DRY case in the brief is weaker than stated.** The three cited duplications are not three
   duplications of the same code. The "env-trio guard" is three *different predicates*
   (shell vars / one var plus a file-fallback resolver / four keys present in a file). The cleanup
   traps share exactly one line (`pnpm env:local`). Only the `/health` wait loop is a genuine
   duplication — and a *third* implementation of it lives in `.github/workflows/ci.yml:84-102`,
   which this change does not absorb. The real justification is testability and reviewability, not
   DRY; planning it as a DRY exercise will produce a `lib.sh` whose helpers are thinner than their
   call sites' bespoke remediation prose.

Net: proceed, but plan it as a **behaviour-preservation exercise with a lint gate attached**, not as
a refactor. The single highest-value plan item is a `set -eu` conformance check — cheap, and it
closes the one regression the change itself introduces.

## Detailed Findings

### 1. What is actually being moved

`mise.toml` is 425 lines; **347 of them (82%) are shell inside `'''` strings**:

| Task | Body lines | Size | Explicit `set -eu`? |
|---|---|---|---|
| `solver:dev` | `mise.toml:32-59` | 28 | **No** — implicit only |
| `solver:image:build` | `mise.toml:86-99` | 14 | Yes (`mise.toml:87`) |
| `solver:image:smoke` | `mise.toml:106-204` | 99 | Yes (`mise.toml:107`) |
| `solver:tier3` | `mise.toml:213-293` | 81 | Yes (`mise.toml:214`) |
| `solver:hosted` | `mise.toml:300-424` | 125 | Yes (`mise.toml:301`) |

The brief's sizing (99 / 81 / 125) is accurate. `solver:test` and `solver:check` are one-liners and
are not in scope.

**Churn context.** `mise.toml` has only **7 commits ever**, and grew 2 → 41 → 176 → 205 → 386 → 425
lines — the last 386→425 within the two days before this change was filed, all from
`solver-deploy-lane`. So "painful to edit" is a projection from a very steep growth curve rather
than an observed history of repeated edit pain; the file is one day old at its current size. That
argues for acting *now* (before more accretes) rather than for urgency about accumulated damage.

### 2. Feasibility — the mise mechanics (all empirically verified)

Local mise is `2026.6.14 macos-arm64`. Probes ran in an isolated scratchpad config, never against
the repo's `mise.toml`.

| Behaviour | Inline `run = '''…'''` | `run = "sh path/script.sh"` | Verdict |
|---|---|---|---|
| Shell flags | `ehBc` | `hB` | **DIVERGES — see §3** |
| cwd honours `dir` | yes | yes | preserved |
| `_.path` (`node_modules/.bin`) reaches the process | yes | yes | preserved |
| stdin reaches `read -r` | yes | yes | preserved (`solver:hosted`'s confirm prompt is safe) |
| Non-zero exit propagates | yes | yes (`exit 7` → mise exits 7) | preserved |
| Tera templating of the body | yes (hence `{% raw %}`) | **no** | **improvement** |
| SIGINT reaches the task | yes | yes | preserved |

Two mechanics worth pinning into the plan:

- **`{{config_root}}` renders in the `run` line.** Probed with `dir` pointing at a subdirectory and
  `run = "sh {{config_root}}/scripts/whereami.sh"`: cwd was the `dir`, `$0` was the absolute script
  path, and the repo root was recoverable from `$0`. This is the shape `solver:dev` needs, since its
  `dir` is `services/solver` (`mise.toml:30`) while the script would live at the repo root. It also
  means `lib.sh` can be sourced as `. "$(dirname "$0")/lib.sh"` regardless of cwd.
- **`file = "…"` requires the executable bit** — `mise ERROR \`scripts/noexec.sh\` is not
  executable`. `run = "sh …"` does not. Given the repo has never carried a `.sh` file, `run = "sh …"`
  avoids a mode-bit failure mode that no existing gate would catch.

**mise forwards SIGINT.** The task process runs in its own process group (measured: the task shell's
pgid differs from mise's), yet a group-directed SIGINT still reached it and fired its trap. So the
`trap … EXIT INT TERM` cleanups in `solver:tier3` (`mise.toml:249`) and `solver:hosted`
(`mise.toml:365-375`) keep working after extraction. That was the sharpest a-priori worry and it is
**not** a risk.

### 3. Risk #1 (highest) — errexit is supplied by mise, and only to inline bodies

Measured directly:

```
$ mise settings get unix_default_inline_shell_args   →  "sh -c -o errexit"
$ mise settings ls --all | grep shell
    unix_default_file_shell_args        "sh"            # <- no errexit
    unix_default_inline_shell_args      "sh -c -o errexit"
    use_file_shell_for_executable_tasks false
```

Confirmed at runtime: an identical body printed `flags=ehBc` inline and `flags=hB` from a file; the
file version ran straight past a `false` and past an unset-variable expansion, and mise exited **0**.

**The Ctrl-C consequence, probed on a faithful model of `solver:hosted`:**

| | inline (today) | `.sh` **without** `set -eu` | `.sh` **with** `set -eu` |
|---|---|---|---|
| trap fires | yes | yes | yes |
| script stops at the interrupted command | **yes** | **no — continues** | yes |
| mise exit code | 130 | **0 (success)** | 130 |

The model output for the middle column, verbatim:

```
STEP: pnpm env:prod-solver  (now on the HOSTED profile)
STEP: starting solver, waiting for /health
CLEANUP: stopping solver, pnpm env:local -> back on LOCAL profile
STEP: pnpm build
STEP: pnpm preview   <-- SERVING, after cleanup already restored the profile
CLEANUP: stopping solver, pnpm env:local -> back on LOCAL profile
=== mise_exit=0
```

So a developer who Ctrl-Cs out of the hosted campaign gets a build and a preview they did not ask
for, on a profile that was already torn down, and mise calls it a success. `solver:tier3` has the
same shape (`pnpm build` then `pnpm exec wrangler dev` after the trap is installed at
`mise.toml:249`).

Both those tasks *do* carry `set -eu` today, so a verbatim copy is safe. The exposure is:

- **`solver:dev` is not safe to copy verbatim** — it is the only body with no `set -` line at all
  (the four are at `mise.toml:87, 107, 214, 301`). Its logic is explicit `if … exit 1` guards
  followed by one `exec`-shaped command, so the practical blast radius is small — but the change's
  own constraint is "no behaviour change", and this is one.
- **Every new file — including `lib.sh` and any future sibling — inherits the hazard**, and nothing
  in the proposed gate enforces the fix. shellcheck has **no** check for a missing `set -e`
  (verified against `shellcheck --list-optional`: the eleven optional checks include
  `check-set-e-suppressed`, but nothing that requires errexit be enabled).

**Recommended plan item:** a two-line conformance assertion — `head -3` of every
`scripts/solver/*.sh` must contain `set -eu` — run in the same CI step as shellcheck. It is the only
guard that closes the regression this change introduces.

### 4. Risk #2 — a `lib.sh` of *functions* introduces a second, subtler errexit hazard

Turning inline code into shell functions creates the classic errexit-suppression trap: a function
invoked in an `if` condition or on the left of `||` runs with `set -e` disabled *inside it*. That is
exactly how a guard helper wants to be called.

Prototyped the proposed `lib.sh` shape (`die`, `require_env`, `wait_for_health`) with a consumer
calling `require_env` three ways. At **default severity shellcheck said nothing (exit 0)**. Only
with the optional check enabled did it fire:

```
$ shellcheck -x -o check-set-e-suppressed lib.sh consumer.sh
consumer.sh:8  SC2310 (info): This function is invoked in an 'if' condition so set -e will be
                              disabled. Invoke separately if failures should cause the script to exit.
consumer.sh:9  SC2310 (info): This function is invoked in an || condition so set -e will be disabled.
```

So the CI invocation should be `shellcheck -o check-set-e-suppressed` (optionally also
`check-extra-masked-returns`), **not** bare `shellcheck`. Note the trade-off: `-o all` produces
**54 findings** on the current bodies (mostly `require-variable-braces` / `quote-safe-variables`
style noise), so enabling everything is not the answer — enable these one or two by name.

Good news on the sourcing idiom: `. "$(dirname "$0")/lib.sh"` produced **no** `SC1090`/`SC1091` when
both files were passed to shellcheck together, so the natural `shellcheck scripts/solver/*.sh` glob
works without `# shellcheck source=` directives.

### 5. Risk #3 — the gate does not catch what the change says it is for

The brief's rationale is that three of the nine review findings were shell defects that only ad-hoc
probes caught. I planted all of them (plus the extraction's own new hazard) in one file and ran the
proposed gate:

| Planted defect | Origin | `sh -n` | `shellcheck` (default) |
|---|---|---|---|
| `. "$profile"` — shell-sourcing a secret file | F3 | miss | **caught** — `SC1090`, as an analysability complaint |
| `rm -f $profile` — unquoted expansion (control) | generic | miss | miss (correctly: value is a known-safe literal — `SC2086` does fire when the value is non-constant) |
| `[ "$(printf '\n')" = "" ]` — inverted newline check | triage bug | miss | miss |
| `/health` wait loop with **no liveness guard** | F2 | miss | miss |
| no `set -eu` anywhere in the file | this change | miss | miss |

**1 of 5, incidentally.** That is not an argument against the gate — a lint gate that is free and
green is worth having, and it *does* catch the bashism class below. It is an argument against the
word "tested" in the change title carrying any weight: shellcheck + `sh -n` is a **lint** gate. If
the goal is that F2-class defects get caught, that needs either a real harness (out of the agreed
scope) or — cheaper and better targeted — the structural fix the brief already proposes: put the
liveness guard *inside* `wait_for_health` so no call site can omit it. **The lib.sh consolidation,
not the linter, is what closes F2.** Worth stating explicitly in the plan so the gate is not
mistaken for the safety mechanism.

### 6. What the gate *is* genuinely worth: the macOS/CI shell split

This is the strongest argument for shellcheck, and the brief does not make it. The developer's
`/bin/sh` is **bash 3.2** (`/bin/sh --version` → `GNU bash, version 3.2.57(1)-release`); CI's
`ubuntu-latest` `/bin/sh` is dash. mise runs `sh` on both. So a bashism written on macOS runs fine
locally and breaks on CI — and `sh -n`, the brief's other gate, **cannot see it**:

```
$ cat bashism.sh          # local, [[ ]], += and echo -e in a helper
$ sh -n bashism.sh        # macOS: PASSES
$ shellcheck bashism.sh   # SC3043 local · SC3010 [[ ]] · SC3024 += · SC3037 echo -e
```

Since `lib.sh` is precisely where someone will instinctively write `local`, this matters more after
the extraction than before it. It also means **`sh -n` should not be sold as a gate** — on the
machine where it would run first, it is a syntax check under a permissive shell.

### 7. CI and tooling surface

- **The step is free.** `shellcheck 0.9.0-1` is preinstalled on the `ubuntu-latest` image
  (Ubuntu 24.04) per <https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md>
  — no install action, no `needs:`/`if:` change, no path filter (which `.github/workflows/ci.yml:166-176`
  forbids and explains). It slots into `verify` as a plain `- run:` step; the natural position is
  before `pnpm astro sync` (`ci.yml:24`) so a shell error fails in ~1 s.
- **Version skew is real, not cosmetic.** `ubuntu-26.04` ships shellcheck **0.11.0**; when the
  `-latest` label migrates, checks added in 0.10/0.11 land with no repo change. Either pin
  `runs-on: ubuntu-24.04` for that job or accept a documented drift. Note this cuts against
  `mise.toml:17-21`, whose stated principle for the `uv` pin is that "a developer and the gate"
  use the same version.
- **shellcheck is not installed locally** (`which shellcheck` → not found; nor `bats`, nor
  `shunit2`). It *is* in the mise registry (`aqua:koalaman/shellcheck`), so `mise.toml`'s `[tools]`
  can pin it next to `uv = "0.12.3"` — which is what makes the local loop non-blind. Without that,
  the gate is CI-only and the developer discovers shell defects on push.
- **There is a clean precedent for where this belongs.** The `solver` CI job runs `uv run ruff` /
  `mypy` / `pytest` directly, and `/verify` (`.claude/skills/verify/SKILL.md`) deliberately mirrors
  only the eight pnpm steps — the solver gates live behind `mise run solver:check`
  (`mise.toml:67-70`) instead. A `mise run solver:check`-style front door plus a direct CI step
  reproduces that split exactly, and avoids adding a ninth step to `/verify` for a non-pnpm tool.
- **`scripts/solver/*.sh` lands in a blind spot of every other gate**, which is both the motivation
  and a caution: ESLint ignores `scripts/` (`eslint.config.js:159`), prettier has no shell parser
  (`--file-info` → `"inferredParser": null`; `pnpm format` silently skips `.sh`), `pnpm steiger`
  covers `src` only (`package.json:13`), `lefthook.yml`'s three globs match no `.sh`, and
  `vitest.config.ts` cannot pick anything up under `scripts/`. **The shellcheck step would be the
  only thing that ever looks at these files.**
- **No Docker impact.** `.dockerignore` is a positive list (`*` then `!contracts`, `!services/solver`),
  and `services/solver/Dockerfile:33-34` COPYs only those two paths, so `scripts/` cannot reach the
  image. No `.dockerignore` edit needed.
- **One lefthook caution:** if a shellcheck hook is ever added, it needs `glob: "*.sh"`. The existing
  `format` job passes `{staged_files}` to prettier explicitly, and prettier **exits 2** on an
  explicit `.sh` path; only its `.{json,css,md}` glob prevents that today.

### 8. Doc and convention drift

The good news dominates: **the proposal keeps all five task names**, so the ~40 `mise run solver:*`
citations across `README.md`, `CLAUDE.md`, `wrangler.jsonc:85`, `services/solver/README.md`,
`services/solver/Dockerfile`, `docs/runbooks/solver-credential.md` and `context/foundation/*` stay
true. Three live claims describe *where the logic lives* and must be reworded:

- `README.md:184` — "That guard is task-level on purpose."
- `README.md:125` — "`solver:hosted` reads keys with `sed`."
- `context/foundation/lessons.md:86` — "put the fail-fast guard in the launcher (**mise task**, CI
  step), not in the service".

On that last one: **moving the guard into `scripts/solver/lib.sh` still satisfies the lesson.** Its
binding contrast is launcher-vs-*service* — the guard must not migrate into `settings.py`/`app.py`,
which stay tolerant so `/health` answers on a bare container. A `.sh` invoked by a one-line mise
`run` is still the launcher, still runs before uvicorn, and still never ships in the image. But the
parenthetical is itself a mechanism citation, so under lessons.md's own "a convention that cites a
code mechanism is coupled to it" rule (`lessons.md:68-73`), amending it is part of this change's
definition of done — not a follow-up.

**The load-bearing comments split into two classes**, and the plan should treat them differently:

*Only home is `mise.toml` — these must move with the code:*

| Comment | Hazard |
|---|---|
| `mise.toml:326-329` | **the `:8000` port-collision hazard** (F2's fix rationale) — not in README, not in the runbook, not in lessons.md. The sharpest one. |
| `mise.toml:165-169` | smoke's container liveness guard ("a FAILED STARTUP CREDENTIAL CHECK looks exactly like this") |
| `mise.toml:406-412` | hosted's process liveness guard + the Custom Access Token Hook hint |
| `mise.toml:271-274` | dotenv quoting: `\n` expansion under double quotes, and that dotenv never unescapes a `'` — so such a password is unrepresentable |
| `mise.toml:202-203` | `SMOKE_JOB_ID` and the "not claimable" expected outcome — the identifier appears nowhere else in the repo |
| `mise.toml:148-150` | `--add-host host.docker.internal:host-gateway` for engines that don't provide the name |
| `mise.toml:124-131` | the `SUPABASE_KEY` fallback read from `.envs/local.vars` |
| `mise.toml:393-401` | the non-Darwin (`caffeinate`-less) fallback branch |

*Already duplicated in living docs — re-copying these creates a third drifting copy.* The
credential-guard rationale (`mise.toml:33-43`) is duplicated in `README.md:184`,
`lessons.md:82-87`, `services/solver/README.md:91-92` and `docs/runbooks/solver-credential.md`; the
fails-open validator note (`mise.toml:109-112`) in `CLAUDE.md:38`, `README.md:217` and
`services/solver/Dockerfile:11-13`; the `.dev.vars` ordering hazard (`mise.toml:216-228`) in
`README.md:121, 230, 242`, `wrangler.jsonc:82-85` and `lessons.md:84-86`; the production-write
banner (`mise.toml:337-353`) in `README.md:256-261`. These should move as **pointers**
(`# see README § …`) rather than as re-copied prose.

**Two pre-existing defects surfaced while inventorying:**

- `mise.toml:54-55` still tells the developer that starting unconfigured leaves the row "stuck at
  'queued' with an orphan proposal plan" — the pre-2026-08-18 behaviour that `mise.toml:38-40` in
  the *same body* says was changed (F1 made `solve` refuse with 503 → row `failed`, clone deleted).
  `README.md:184` has the corrected wording. Free to fix while the code moves.
- `README.md:332` describes the `verify` job without `pnpm check`, which is really `ci.yml:25`.
  Any change touching that line should correct it.

**Stale line-number citations:** eight `mise.toml:NNN` references exist, all in `context/`. Four are
*already* stale from `solver-deploy-lane`'s own review-fix commit (`reviews/impl-review.md:49, 63`;
`plan.md:16, 103`; `research.md:159` all point at moved code). Only `mise.toml:19-23` (the `[tools]`
pin) survives this change. Since these are review/plan records of a closed lane, the honest cost is
one or two lines, not eight — but it is a live illustration that line-anchored citations into
`mise.toml` do not survive, which is itself an argument for smaller files.

### 9. Verification cost — what can honestly be proven before merge

Everything needed is available on this machine **right now**: Docker daemon 29.4.3 running, local
Supabase answering on `:54321` (HTTP 200), `ib-solver:local` already built (amd64, 393 MB), and all
three profiles present in `.envs/`. `:8000` is free.

| Tier | Provable pre-merge? | Cost |
|---|---|---|
| 1 — `solver:dev` | **Yes**, fully | seconds; needs the env trio exported |
| 2 — `solver:image:build` + `:image:smoke` | **Yes**, fully | image already built; smoke is a real 202 assertion |
| 3 — `solver:tier3` | **Yes**, fully | a build + a workerd session; rewrites `.dev.vars` (gitignored, trap-restored) |
| hosted campaign | **Not honestly** | it writes to production by design |

For the hosted lane the README already documents the rehearsal path — point
`.envs/prod-solver.vars` at the local stack and run the command for its own sake. That exercises the
profile validation, the `:8000` collision guard, the banner, the confirm prompt, the `sed` reads,
the trap and the restore, without touching hosted rows. **Recommend making that rehearsal an
explicit plan step**, because `solver:hosted` is simultaneously the largest body (125 lines), the
one with the most bespoke logic, and the only one whose real failure mode costs a manual SQL
cleanup against production.

Two behaviours deserve an explicit verification step because no automated gate covers them:

- **Ctrl-C parity on `tier3` and `hosted`** — interrupt each and confirm `.dev.vars` is restored,
  the exit code is 130, and nothing runs after the trap. This is the §3 regression, and it is
  cheap to check by hand.
- **The `read -r` confirm prompt on `hosted`** — verified working through a script in probe, but
  worth one interactive run since `SOLVER_HOSTED_CONFIRM` also has a bypass path.

### 10. The scripts will have zero runtime coverage anywhere but a developer's machine

`.github/` mentions mise exactly twice, and both are comments telling you to keep the `uv` version
in sync (`ci.yml:63`, `ci.yml:195`). **No CI job ever executes a mise task** — the integration job
starts uvicorn directly (`ci.yml:84-102`). So after extraction:

- the only *automated* contact these five scripts ever get is the proposed shellcheck step, which is
  static analysis;
- the only *execution* they ever get is a developer running tiers 1–3 by hand.

That is unchanged by this change — the bodies have the same coverage today — but it becomes more
consequential once the code looks like ordinary, testable-looking files. The plan should not let
"green CI" stand in for "the tiers still work"; a manual tier-1/2/3 pass belongs in the success
criteria, and §9 shows all three are runnable right now.

### 11. Extraction creates a new failure mode: the scripts become directly invocable but are not cwd-independent

Eleven sites across the five bodies depend on cwd being the repo root (or `services/solver`), which
today mise guarantees via `dir`:

| Site | Path |
|---|---|
| `mise.toml:88` | `docker build … -f services/solver/Dockerfile … .` — **the build context is literally `.`** |
| `mise.toml:125-126` | `.envs/local.vars` (the `SUPABASE_KEY` fallback) |
| `mise.toml:182` | `contracts/fixtures/solve-request.json` |
| `mise.toml:264, 265, 280, 284` | `.dev.vars`, `.dev.vars.tier3` |
| `mise.toml:303` | `.envs/prod-solver.vars` |
| `mise.toml:394, 398` | `cd services/solver` |
| `mise.toml:30` | `solver:dev`'s `dir` is `services/solver`, not the root |

While the code lives in TOML it can only be run one way. As a file it can be run any way, and
`./scripts/solver/image-build.sh` from the wrong directory produces a **silently wrong Docker build
context** — the exact failure CLAUDE.md flags as failing OPEN (`/health` green, every solve 500s),
and the reason `mise run solver:image:smoke` exists.

**Recommendation: make each script self-locating** — `cd "$(dirname "$0")/../.." || exit 1` as the
first executable line — rather than inheriting cwd from mise's `dir`. It is one line, it deletes the
whole failure class, and it is what makes the scripts genuinely standalone, which is the point of
extracting them. Note the interaction: `solver:dev` would then need its own explicit
`cd services/solver` (or to invoke `uv --project services/solver`), because self-locating to the repo
root overrides the `dir` it relies on today. That is a behaviour change worth making deliberately
and recording, not one to discover.

## Code References

- `mise.toml:13-14` — `[env] _.path`; reaches extracted scripts unchanged (verified)
- `mise.toml:17-22` — the `[tools] uv` pin and its "developer and gate use the same version" rationale; the natural home for a `shellcheck` pin
- `mise.toml:32-59` — `solver:dev` body; **the only one without `set -eu`**
- `mise.toml:54-55` — stale "row stuck at 'queued'" text, contradicted by `mise.toml:38-40`
- `mise.toml:86-99` — `solver:image:build`; the amd64 assertion
- `mise.toml:106-204` — `solver:image:smoke`; `mise.toml:163-176` is the container-liveness wait loop
- `mise.toml:213-293` — `solver:tier3`; `:249` the trap, `:251-274` the `.dev.vars` rewrite + dotenv quoting rule
- `mise.toml:300-424` — `solver:hosted`; `:326-329` the `:8000` collision guard, `:365-375` cleanup + trap, `:385-387` `profile_value()`, `:404-419` the process-liveness wait loop
- `.github/workflows/ci.yml:19-30` — the `verify` job; where a shellcheck step slots in
- `.github/workflows/ci.yml:84-102` — a **third** `/health` wait loop the extraction does not absorb
- `.github/workflows/ci.yml:166-176` — why path filters are forbidden
- `eslint.config.js:159` — `scripts/` is ignored outright
- `.dockerignore` / `services/solver/Dockerfile:33-34` — `scripts/` cannot reach the image
- `lefthook.yml:6, 11, 15` — no glob matches `.sh`
- `.claude/skills/verify/SKILL.md` — the eight-step pnpm mirror; the solver gates deliberately sit outside it
- `context/foundation/lessons.md:68-73` — "a convention that cites a code mechanism is coupled to it"
- `context/foundation/lessons.md:82-87` — "put the fail-fast guard in the launcher (mise task, CI step)"
- `README.md:125, 184, 332` — the three lines needing a wording pass
- `scripts/provision-solver-user.mjs:1-20` — the established script header convention (shebang, purpose, `// Usage:`, why-not-how prose, closing doc pointer)
- `scripts/lib/catalog-transcode.mjs:1-19` — the `scripts/lib/` convention: no barrel, direct import, header enumerates consumers by path

## Architecture Insights

- **`scripts/` has a Node convention, not a shell one.** The brief's "no new convention" is half
  right: `scripts/` is an established home for developer tooling, but the repo has **zero `.sh`
  files**, and no script is currently invoked *from mise* — all three `.mjs` scripts are invoked
  from `package.json`, CI, README prose or a Vitest test. So this establishes two new conventions at
  once (shell in `scripts/`, and mise-invokes-script). Worth adopting the existing `.mjs` header
  convention deliberately — shebang, one-line purpose, a `# Usage:` line, why-not-how prose, and a
  closing pointer to the authoritative doc — rather than letting five files drift into five shapes.
- **The diagnostics convention would change.** `scripts/*.mjs` prefix stderr with `[script-name]`;
  the mise bodies use bare `echo … >&2` because the output is user-facing UX prose (banners,
  remediation incantations). That is a deliberate difference worth preserving, not a drift to fix.
- **`lib.sh` helpers will be thinner than their call sites.** In all three cited duplications the
  shareable part is the skeleton and the bespoke part is the *message* — and the messages are the
  most valuable thing in these tasks (they are what turned three review findings into fixes). A
  `require_env` that swallows `solver:dev`'s seven-line remediation block would be a net loss. The
  right shape is helpers that take the message as a parameter, or helpers that cover only the
  mechanism (`wait_for_health` with the liveness predicate injected) and leave prose at the call site.
- **The extraction's real prize is the `{% raw %}` removal.** Verified: script content is not Tera-
  rendered, so the four `{% raw %}`/`{% endraw %}` guard pairs — present only because Docker
  `--format '{{.Architecture}}'` collides with Tera — simply disappear. That is a genuine
  readability win the brief undersells, and it is risk-free.

## Historical Context (from prior changes)

- `context/changes/solver-deploy-lane/reviews/impl-review.md:44-70` — F2 and F3, the two shell
  defects this change is a reaction to. F2's fix added the `:8000` collision guard and the
  process-liveness bail; F3's replaced `. "$profile"` with `profile_value()` and made tier3 write
  the password single-quoted. Both were found by reading and ad-hoc probing, not by a gate.
- `context/changes/solver-deploy-lane/change.md:23` — records the `:8000` collision reasoning; the
  only place outside `mise.toml` where it exists.
- `context/changes/solver-deploy-lane/change.md:358-371` — the "the launcher is where the asymmetry
  belongs" decision, which is the origin of the lessons.md guard-placement rule and the reason the
  extraction must keep the guard out of `settings.py`.
- `context/foundation/lessons.md:82-87` — the S-302 lesson this change must not break, and whose
  parenthetical it must amend.
- Four `mise.toml:NNN` citations in that lane's `plan.md`/`research.md`/`impl-review.md` are already
  stale after its own fix commit — evidence that line-anchored references into a 425-line task file
  decay fast.

## Related Research

- `context/changes/solver-deploy-lane/research.md:295` — surveys `mise.toml:28-41` as "the natural
  home for image tasks"; the decision that produced the 347 lines now being extracted.
- `context/changes/post-poc-cp-sat-refactoring-plan/research.md:439-465` — earlier mise task survey.

## Open Questions

1. **Does `solver:dev` get `set -eu` added?** Adding it is the correct fix but is, strictly, a
   behaviour change against the change's own "no behaviour change" constraint. Recommend adding it
   and recording it as a deliberate, named exception rather than pretending extraction is neutral.
2. **Where does the shellcheck gate live** — a ninth `/verify` step, or a `mise run solver:check`
   extension plus a direct CI step (mirroring how the uv gates are handled)? The latter fits the
   existing precedent better.
3. **How is the shellcheck version reconciled** between the runner image (0.9.0 today, 0.11.0 after
   the `ubuntu-latest` migration) and a `[tools]` pin? Pin `ubuntu-24.04`, pin the tool, or accept
   documented drift — the `uv` comment at `mise.toml:17-21` sets a precedent that argues against
   just accepting it.
4. **Does `lib.sh` absorb the CI health-wait too** (`ci.yml:84-102`), or does the third copy stay?
   It cannot source a repo shell script trivially from a workflow step, but leaving it unmentioned
   means the change closes two of three duplications and silently leaves one.
5. **Do the scripts self-locate** (`cd "$(dirname "$0")/../.."`) and become standalone, or stay
   mise-only and inherit cwd from `dir`? See §11 — this is the one open question that is a genuine
   fork in the design rather than a detail.
6. **Is `scripts/solver/` the right location**, or `scripts/` flat? `scripts/lib/` is the only
   existing subdirectory and it holds shared modules, not entry points — so `scripts/solver/*.sh`
   plus `scripts/solver/lib.sh` slightly re-uses the `lib` name for a different meaning.
