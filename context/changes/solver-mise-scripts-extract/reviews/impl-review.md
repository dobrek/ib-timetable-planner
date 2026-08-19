<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Extract the solver mise task bodies into shellcheck-gated scripts

- **Plan**: context/changes/solver-mise-scripts-extract/plan.md
- **Scope**: Full plan (Phases 1–4 of 4)
- **Date**: 2026-08-19
- **Verdict**: NEEDS ATTENTION → all 9 findings fixed in triage (2026-08-19)
- **Findings**: 0 critical, 5 warnings, 4 observations

Every planned file exists, nothing is MISSING, all automated success criteria re-ran green (lint.sh + negative test, shellcheck 0/7, `solver:check`, `mise tasks ls`, `dev.sh` guard path, 0 `'''` / 0 `{% raw %}`, 90-line `mise.toml`, README/lessons greps, prettier, local profile intact), CI `verify` logged `version: 0.11.0`, and the ci.yml sha256 was re-derived from the live tarball and matches. **None of the warnings is a regression the extraction introduced** — all five are defects inherited verbatim from the old `mise.toml` bodies, now visible because the code is readable. The plan's "no behaviour change" rule is why they were carried.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — hosted profile validation accepts empty values

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: scripts/solver/hosted.sh:40-42 (pre-existing)
- **Detail**: `grep -q "^$key="` passes an empty `SOLVER_MACHINE_PASSWORD=`. The solver boots unconfigured, its credential check skips itself, `/health` answers, and :141 prints a false "credential check passed"; build+preview then dispatch HOSTED jobs that 503 (row `failed`, clone deleted) on production. tier3.sh:80 has the same shape for `SUPABASE_URL`.
- **Fix A ⭐ Recommended**: require a non-empty value (`grep -q "^$key=.\{1,\}"`) and record it in change.md as a named behaviour change.
  - Strength: closes a fail-open path onto production data; matches the lessons.md "guard in the launcher" rule.
  - Tradeoff: breaks the plan's "no behaviour change" letter (already done once for the trap split).
  - Confidence: HIGH.
  - Blind spot: whitespace-only values still pass.
- **Fix B**: file as a follow-up in change.md.
  - Strength: keeps this PR a pure move.
  - Tradeoff: the false "credential check passed" line stays live for the campaign.
  - Confidence: MED.
  - Blind spot: none significant.
- **Decision**: FIXED via Fix A — `hosted.sh` requires non-empty values; recorded in change.md as a named behaviour change

### F2 — tier3 password write uses `echo`, which mangles backslashes

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/solver/tier3.sh:98 (pre-existing)
- **Detail**: both target shells' `echo` interpret `\n`, `\t`, `\\`, `\c` — a password containing a backslash is silently altered on write, the exact "truncated secret forwarded silently" the guard at :90-97 exists to refuse (it covers only `'` and newline).
- **Fix**: `printf "SOLVER_MACHINE_PASSWORD='%s'\n" "$SOLVER_MACHINE_PASSWORD" >> .dev.vars.tier3` (and :83).
- **Decision**: FIXED — both `.dev.vars.tier3` writes use `printf`

### F3 — image-smoke keeps a single EXIT trap; dash skips it on Ctrl-C

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/solver/image-smoke.sh:58 (pre-existing)
- **Detail**: `trap cleanup EXIT` only; dash does not run EXIT on an untrapped SIGINT (bash/macOS sh do). On Linux, Ctrl-C during the 90 s wait leaves `ib-solver-smoke` holding :8000 with no log dump. tier3.sh/hosted.sh got the INT/TERM split; this one didn't.
- **Fix**: add `trap 'exit 130' INT` / `trap 'exit 143' TERM` beside :58.
- **Decision**: FIXED — `image-smoke.sh` gained the INT/TERM split

### F4 — hosted `:8000` guard fails open when `lsof` is absent

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/solver/hosted.sh:52 (pre-existing)
- **Detail**: `if lsof …; then` — missing `lsof` exits 127, condition false, guard passes silently; the comment above names the cost (production rows wedged at `queued`).
- **Fix**: `command -v lsof >/dev/null || die "lsof is required for the :8000 ownership check"` before the guard.
- **Decision**: FIXED — `hosted.sh` requires `lsof` (die) before the :8000 guard

### F5 — tier3 masks a missing `.dev.vars` and builds anyway

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/solver/tier3.sh:79-85 (pre-existing)
- **Detail**: `grep -v … .dev.vars > .dev.vars.tier3 || true` swallows a missing file; the sed pipeline yields "", the `*)` branch prints the misleading "not local" note, and the build proceeds with a `.dev.vars` holding only the password.
- **Fix**: `[ -f .dev.vars ] || die "no .dev.vars — run pnpm env:local first"` before :79.
- **Decision**: FIXED — `tier3.sh` dies on a missing `.dev.vars` before installing the trap

### F6 — Two comments did not move as the plan classified them

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: scripts/solver/hosted.sh:134-141; tier3.sh:74-77; common.sh:16
- **Detail**: (a) the old `:406-407` "port taken after our check" liveness nuance was listed as a verbatim move but is gone (only the generic common.sh:35-38 remains); (b) tier3.sh:74-77 keeps the full ordering rationale instead of pointer + one bold sentence; (c) common.sh's Consumers list omits lint.sh (the only `die` caller).
- **Fix**: restore the one-line port nuance above `solver_alive`; add lint.sh to the consumer list; leave tier3's duplicated rationale.
- **Decision**: FIXED — port-taken nuance restored above `solver_alive`; lint.sh added to common.sh consumers; tier3 rationale left in place

### F7 — "pinned twice" is really pinned in five places

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: mise.toml:35, .github/workflows/ci.yml:35/38/55, scripts/solver/lint.sh:41
- **Detail**: `0.11.0` is hard-coded in mise.toml, three spots in ci.yml (the assert step can't see the install step's shell var), and lint.sh's die message; the prose says "the two literals must move together".
- **Fix**: export `SHELLCHECK_VERSION` to `$GITHUB_ENV` in the install step and assert against it; drop the literal from lint.sh's message.
- **Decision**: FIXED — ci.yml names the version once (`version=`), hands it to the assert step via `$GITHUB_ENV`; lint.sh message generic

### F8 — Unplanned extras: lint.sh mise fallback + an unsourced claim

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: scripts/solver/lint.sh:32-42; mise.toml:32-33; .github/workflows/ci.yml:29-30
- **Detail**: lint.sh gained a PATH → `mise x` → `die` fallback the plan didn't specify (sensible, verified working from /tmp). Both pin comments assert the runner ships "0.11.0 after the ubuntu-latest migration (24.10+)" — not established anywhere in research/plan.
- **Fix**: keep the fallback; soften the comment to what research established (`ubuntu-latest` preinstalls 0.9.0).
- **Decision**: FIXED — fallback kept; runner-version claim softened in mise.toml and ci.yml

### F9 — Inherited hardening nits (bundle)

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/solver/common.sh:53; image-smoke.sh:69; hosted.sh:116
- **Detail**: (a) `curl -sf` without `--max-time` — `waited` counts attempts, not seconds, on a black-holed port; (b) image-smoke passes the password as `-e NAME=value` (argv-visible; name-only `-e` inherits from env); (c) `profile_value` keeps a CRLF `\r`.
- **Fix**: `curl -sf --max-time 5`; `-e SOLVER_MACHINE_PASSWORD`; `| tr -d '\r'` — or file as a follow-up.
- **Decision**: FIXED — `curl --max-time 5`; password passed to docker by name (`-e VAR`, exported); `profile_value` strips CR
