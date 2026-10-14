<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: CI on the Publishable Key and a Pinned Supabase CLI (F-402)

- **Plan**: context/changes/ci-publishable-key-and-pinned-cli/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-10-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Evidence

- **Plan adherence.** Every contract bullet in all three phases is MATCH. The env-isolation paragraph is byte-identical to main, and `deploy` is untouched.
- **Roadmap status fields.** The plan commit and the phase-1 commit changed them, not phase 3, so the phase-3 rule held.
- **One unplanned addition, benign.** `change.md`'s "runner prints exported values in step headers" note is documentation in the change folder.
- **Re-run from the committed bytes:**
  - **Version step.** It passes from the repo root. It exits 1 naming both versions with a `0.0.0` stub, and exits 1 naming `./.github/actions/setup` when `node_modules` is absent.
  - **Assert step.** It passes on valid values. One run reports all three failures together: both keys with the wrong prefix plus the DB URL missing. It exits 1 naming all four when nothing is set.
  - **Export step against the local stack.** It writes exactly four names, and the assertion passes on them.
- **CI.** All four test jobs were green on the first attempt for 7f98451, fcbe9fd and 68a20ec. The 9698046 run was cancelled, but its successor 68a20ec contains it.
- **CI logs on HEAD.** Both lanes print `Supabase CLI 2.117.0 (lockfile)` and the four `NAME: prefix, N chars` lines. They pull `postgres:17.6.1.167`, `postgrest:v16.2` and `gotrue:v2.196.0`.
- **Local gate, all green:**
  - greps, `yq` and `prettier --check`;
  - `pnpm check`: 0 errors;
  - `lint` and `steiger`;
  - `test`: 217 files, 2078 tests;
  - `audit`: 1 high, already ignored by an earlier decision;
  - `build`.
- **Local stack.** `docker ps` shows the three CI tags, and `supabase/.temp/*-version` lists only `storage-version`.
- **Not re-run.** Item 3.3, the local integration lane, needs the solver, which was down during this review. CI's integration lane on HEAD covers it.
- **Key consumers.** Every reader of `SUPABASE_SERVICE_ROLE_KEY` goes through supabase-js `createClient`. The solver sends `SUPABASE_KEY` only as `apikey`, with the user token as Bearer. Nothing decodes either key.

## Findings

### F1 — test-plan.md still says CI writes `.dev.vars` from "minted" keys

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: context/foundation/test-plan.md:366-367
- **Detail**: "written … by the CI `e2e` job from the stack's minted keys". This is the same false claim the change removed from `ci.yml`: the keys are the CLI's fixed defaults, not minted per stack. The plan's grep covered only `.github`, so it missed this one. `test-plan.md` is a foundation doc that later `/10x-*` runs read, so the false premise can spread. That is the "a doc that cites a mechanism is coupled to it" lesson in `lessons.md`.
- **Fix**: Reword to "by the CI `e2e` job from what the `supabase-stack` action exported".
- **Decision**: FIXED — test-plan.md:366-367 now says "from what the `supabase-stack` action exported"

### F2 — No local trace of the phase-3 Generate check (3.6)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/ci-publishable-key-and-pinned-cli/plan.md:533 (Progress 3.6)
- **Detail**: The realigned stack's DB container started at 2026-10-14 12:58Z. The newest local `generation_jobs` row and the newest `plans` row are both from 2026-10-01. A UI Generate leaves a job row and a `clone_plan` proposal behind unless the source plan is deleted later (the `plan_id` FK cascades). So nothing on disk confirms 3.6. The integration suites tear down their rows, so 3.3 leaves no trace either. The risk is small: CI's e2e lane ran `generation.spec.ts` green on HEAD against the same PostgREST v16.2 / GoTrue v2.196.0 images.
- **Fix**: Before taking the PR out of draft, either run one local Generate with `mise run solver:dev` up, or note in Progress that CI's `generation.spec.ts` on the same images is the evidence for 3.6.
- **Decision**: FIXED — Progress 3.6 now records CI run 38572677708's `generation.spec.ts` on the same images as the evidence

### F3 — CLAUDE.md hard-codes the `supabase` version range

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: CLAUDE.md:53
- **Detail**: "because the range is `^2.117.0`" is correct today (`package.json:92`) but goes stale on the next bump. README:413 deliberately says only "a `^` range". The plan's contract supplied the literal.
- **Fix**: Say "because `package.json` gives `supabase` a caret (`^`) range", matching README.
- **Decision**: FIXED — CLAUDE.md:53 now says "`package.json` gives `supabase` a caret (`^`) range"

### F4 — README's check command errors under zsh on a never-linked machine

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: README.md:415
- **Detail**: zsh is macOS's default shell. Under its default `nomatch` option, `ls supabase/.temp/*-version` prints `zsh: no matches found` rather than an empty list when no file matches. That happens for exactly the never-linked reader that check 3.7 targets. It never showed on this machine because `storage-version` exists here.
- **Fix**: Add a clause: "(zsh's `no matches found` means the same)".
- **Decision**: FIXED — README.md:415 now carries the zsh clause
