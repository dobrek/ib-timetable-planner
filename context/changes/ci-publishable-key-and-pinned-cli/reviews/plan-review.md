<!-- PLAN-REVIEW-REPORT -->

# Plan Review: CI on the Publishable Key and a Pinned Supabase CLI (F-402)

- **Plan**: context/changes/ci-publishable-key-and-pinned-cli/plan.md
- **Mode**: Deep
- **Date**: 2026-10-14
- **Verdict**: SOUND
- **Findings**: 0 critical · 2 warnings · 5 observations

## Verdicts

| Dimension             | Verdict               |
| --------------------- | --------------------- |
| End-State Alignment   | PASS                  |
| Lean Execution        | PASS (1 observation)  |
| Architectural Fitness | PASS                  |
| Blind Spots           | PASS (2 observations) |
| Plan Completeness     | WARNING               |

## Grounding

7/7 paths ✓. 5/5 line refs ✓: README :378, :404 and :420; CLAUDE.md :53; roadmap :82.

Symbols ✓:

- CLI 2.117.0 prints its version on stdout.
- Its binary embeds postgres 17.6.1.167, postgrest v16.2 and gotrue v2.196.0.
- The overrides `auth.publishable_key` and `auth.secret_key` emit `sb_publishable_` and `sb_secret_`.

brief↔plan ✓.

Upstream checks (CLI source at v2.117.0, actions/runner source):

- Only `link` writes `postgres-version`.
- When the version files are absent, the CLI falls back to its Dockerfile defaults.
- `start` does not check an existing volume's image tag.
- `$GITHUB_ENV` reaches the next step inside a composite action.

## Findings

### F1 — The 2.117.0 CLI also prints the `[inbucket]` warning

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 Manual 1.7; What We're NOT Doing
- **Detail**: Criterion 1.7 expected the `[inbucket] is deprecated` warning to disappear. But 2.117.0 prints it too: it showed on the stderr of a local `pnpm exec supabase status`, and it comes from parsing `config.toml:99`. The NOT-doing bullet called this debt that arrives with a bump.
- **Fix**: Remove the clause from 1.7, and give the `[inbucket]` migration its own out-of-scope bullet, saying the debt exists today.
- **Decision**: FIXED

### F2 — Grep checks clash with text the plan keeps or adds

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 1.1, 1.2; Phase 2 2.1; Phase 3 3.4
- **Detail**:
  - 1.1's grep would match the comment that Phase 1 requires.
  - 1.2's grep would match the comment at `action.yml:17`.
  - Nothing checked that the "minted keys" wording was gone.
  - 3.4 ran prettier on `roadmap.md`, but `context/` is prettier-ignored, so that check could never fail.
- **Fix**: Make 1.1 and 1.2 match code, not prose. Add `grep -rnE "mints its own|minted keys" .github` to 2.1. Drop `roadmap.md` from 3.4, and add "minted" to the `description` reword.
- **Decision**: FIXED

### F3 — The legacy JWTs are still exported, under their default names

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §1
- **Detail**: `status -o env` prints every field. So `ANON_KEY` and `SERVICE_ROLE_KEY` (both HS256 JWTs), `JWT_SECRET` and the S3 keys would still reach `$GITHUB_ENV`. Nothing reads them today.
- **Fix**: Keep only the four names when exporting. Update the Desired End State and the drill to match.
- **Decision**: FIXED

### F4 — The image-drift docs name the wrong trigger for a CLI bump

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §2, §3
- **Detail**: `package.json:92` declares `^2.117.0`, so a plain `pnpm update` moves the lockfile, and CI's images with it, without any `package.json` edit.
- **Fix**: Word the CLAUDE.md, README and Desired End State text around the lockfile.
- **Decision**: FIXED

### F5 — Rolling back the local images restores the files, not the data

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §1; Migration Notes
- **Detail**: GoTrue v2.196.0 migrates the `auth` schema forward on its first boot, and `start` mounts the existing volume as it is. Moving the files back afterwards is not a guaranteed restore.
- **Fix**: State that the rollback is file-level once a boot has succeeded. Name `db reset` plus the two provision scripts as the data fallback, and ask before running it.
- **Decision**: FIXED

### F6 — Drills run a hand copy of the step, not the committed YAML

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 1.3; Phase 2 §2; Testing Strategy
- **Detail**: A hand copy can drift from what gets committed and can't catch YAML-level mistakes. The step contracts never mentioned `shell: bash`, which every composite `run:` step requires.
- **Fix**:
  - Extract each drill body from the committed action with `yq` and run it with `bash -eo pipefail`.
  - Inject cases through env vars. The mismatch case uses `SUPABASE_CLI_BINARY_OVERRIDE`.
  - Require `shell: bash` on both new steps, and add a yq check for it.
- **Decision**: FIXED

### F7 — The $GITHUB_ENV hedge and its fallback can go

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Critical Implementation Details; brief → Open Risks
- **Detail**: The runner processes file commands after every step, embedded composite steps included, and has since runner v2.272.0 (PR #557).
- **Fix**: State it as fact with the runner source references. Drop the fallback paragraph and the brief's matching risk.
- **Decision**: FIXED
