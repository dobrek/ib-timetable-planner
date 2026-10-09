# Security Workflow Issues Implementation Plan

## Overview

Close the five open CodeQL `actions/missing-workflow-permissions` alerts (#1, #2, #3, #5, #6) on `.github/workflows/ci.yml` by declaring the `GITHUB_TOKEN` scope explicitly. The same change also fixes the CI supply-chain hygiene that research surfaced next to them:

- checkouts stop persisting credentials;
- a composite action stops interpolating an input into `run:`;
- every remote action is pinned to a commit SHA, with a monthly Dependabot config keeping the pins fresh;
- the pinning is then enforced by the repository's `sha_pinning_required` policy.

The analysis is in [`research.md`](research.md). This plan adds the decisions made while planning, and the SHA and Dependabot facts verified for the bundled hardening.

## Current State Analysis

- **All five alerts are open and true positives.** They share one rule, `actions/missing-workflow-permissions` (CWE-275), with one alert per job. Live `gh api` on 2026-10-09 shows #1 `verify` L18, #2 `integration` L70, #3 `e2e` L171, #6 `solver` L278 and #5 `deploy` L324. `ci.yml` is the only workflow, and it has no `permissions:` key anywhere (research §1).
- **The effective token is already read-only.** The repo default is `default_workflow_permissions: read`, so every job holds `contents: read` + `packages: read` (research §2). Every action was checked at its pinned version and every CI script was swept: nothing needs more than `contents: read`, and nothing in CI reads `GITHUB_TOKEN` (research §3–4).
- **Three hygiene gaps sit next to the alerts** (research §7):
  - All five `actions/checkout@v6` steps persist credentials (the default).
  - `supabase-stack/action.yml:50` interpolates `${{ inputs.export-anon-key }}` straight into `run:`. It is not exploitable: both callers pass the literal `"true"`.
  - Every remote action is pinned by tag or by floating major.
- **No git-sourced dependencies.** `package.json`, `pnpm-lock.yaml`, the solver's `pyproject.toml` and `uv.lock` have none, and no CI step runs a remote git operation. `persist-credentials: false` therefore cannot break an install.
- **Remote `uses:` inventory (13 refs).**
  - `ci.yml`: `actions/checkout@v6` ×5 (L21, 73, 174, 287, 329), `astral-sh/setup-uv@v9.0.0` ×3 (L101, 195, 301), `actions/upload-artifact@v7` (L249), `cloudflare/wrangler-action@v4` (L383).
  - `.github/actions/setup/action.yml`: `pnpm/action-setup@v6.1.0` (L12), `actions/setup-node@v6` (L16).
  - `.github/actions/supabase-stack/action.yml`: `supabase/setup-cli@v2` (L14).
- **No `.github/dependabot.yml` exists.** The repo's `sha_pinning_required` is `false` and `allowed_actions` is `all`.

## Desired End State

- `ci.yml` declares `permissions: contents: read` at workflow level, with a comment in the file's house style.
- Every checkout sets `persist-credentials: false`.
- No composite action interpolates `${{ }}` into a `run:` script.
- Every remote `uses:` in the workflow and both composite actions reads `owner/repo@<40-hex commit SHA> # vX.Y.Z`. Each pin is the exact commit the floating ref resolves to today, so the actions run the same code as now.
- `.github/dependabot.yml` maintains those pins:
  - `github-actions` only, covering `/` and `/.github/actions/*`;
  - monthly;
  - minor and patch bumps grouped into one PR, each major in its own PR.
- The repository enforces pinning with `sha_pinning_required: true`.
- The README "CI / CD" section documents the token scope, the pinning rule, Dependabot's cadence and the enforcement.

**How to verify:**

- After merge, every job's "Set up job" log lists only `Contents: read` and `Metadata: read` under `GITHUB_TOKEN Permissions`, and `deploy` ships.
- `gh api 'repos/dobrek/ib-timetable-planner/code-scanning/alerts?state=open'` returns no `actions/missing-workflow-permissions` rows, and #1/#2/#3/#5/#6 read `fixed`.
- A `workflow_dispatch` run on `main` passes with `sha_pinning_required` on. CodeQL default setup and Dependabot still run under it.

### Key Discoveries:

- **One workflow-level `permissions:` block covers every job.** The query checks only that a block exists: `{}`, `contents: read` and even `write-all` all silence it. A closed alert therefore does not prove least privilege. The run log does (research §1, `MissingActionsPermissions.ql`).
- **`deploy` is first exercised under the new token by the merge itself.** Its `if:` admits only push to `main` (`ci.yml:326`), and `workflow_dispatch` does not satisfy it. If it fails, the previous Worker stays live (research §6).
- **Alerts close only on the `main` analysis.** PR analyses are diff-filtered, so the PR will not show "fixes 5 alerts" (research §5).
- **The floating refs resolve to these exact releases today** (`git ls-remote`, cross-checked, 2026-10-09):

  | Ref today | Resolves to | Commit SHA to pin | Note |
  | --- | --- | --- | --- |
  | `actions/checkout@v6` | v6.1.0 | `d23441a48e516b6c34aea4fa41551a30e30af803` | lightweight tag |
  | `actions/setup-node@v6` | v6.5.0 | `249970729cb0ef3589644e2896645e5dc5ba9c38` | lightweight tag |
  | `actions/upload-artifact@v7` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` | v7 moved here 2026-10-07 |
  | `pnpm/action-setup@v6.1.0` | v6.1.0 | `ea17c68df8912ef543352723c149a84f56e3d413` | **annotated**: tag object is `d9184bf…`, pin the commit |
  | `supabase/setup-cli@v2` | v2.1.2 | `afb1b15109756ea5cf9d8985a359d9095235ca2b` | `v2` is a **branch**, not a tag; HEAD is at v2.1.2 |
  | `astral-sh/setup-uv@v9.0.0` | v9.0.0 | `c771a70e6277c0a99b617c7a806ffedaca235ff9` | lightweight tag |
  | `cloudflare/wrangler-action@v4` | v4.1.3 | `953926a2e2182532811c01a25e53647d93bf07c0` | annotated (`2ef9f39…` is the tag object) |

- **Dependabot's coverage has gaps by default** (dependabot-options-reference; dependabot-core `github_actions/file_fetcher.rb`):
  - `directory: "/"` scans only `.github/workflows/` plus a root `action.yml`. Composite actions need `directories: ["/", "/.github/actions/*"]`, and globs work only with the plural key.
  - Dependabot rewrites both the SHA and a trailing comment, but only when the comment ends in a version that a tag on the old SHA carries. Write an exact `# vX.Y.Z`: a `# v6` comment goes stale once the floating tag moves.
- **Dependabot PRs get a read-only token and no Actions secrets** (`dependabot-on-actions`). `ci.yml` reads secrets only in `deploy`, which is gated to push on `main`, so Dependabot PRs exercise the four test jobs normally.
- **Four major bumps are already pending, so Dependabot's first run will open them:** checkout v7.0.1, setup-node v7.1.0, setup-uv v10.2.0 and setup-cli v3.0.1.
- **What `sha_pinning_required` covers** (changelog 2025-08-15; REST `PUT /repos/{o}/{r}/actions/permissions`):
  - It applies to **all** actions, GitHub-authored ones included.
  - A violating job fails at "Set up job".
  - The body requires `enabled`. Send `{"enabled": true, "allowed_actions": "all", "sha_pinning_required": true}` so the current `allowed_actions` is kept.
  - The docs don't say whether local `./.github/actions/...` refs, or GitHub-managed dynamic workflows (CodeQL default setup, Dependabot updates), are exempt.
- **Workflow-level `permissions:` is not workflow-level `env:`.** The standing rule forbids promoting `SUPABASE_*` to a workflow-level `env:` (`supabase-stack/action.yml:40-45`). A `permissions:` key is unrelated and safe.

## What We're NOT Doing

- **Not bumping any action version.** Each pin is the commit its floating ref resolves to today. Upgrades are Dependabot's job, reviewed per PR.
- **Not merging the major-bump PRs Dependabot opens on its first run** (checkout v7, setup-node v7, setup-uv v10, setup-cli v3). Each one gets its own review as an ordinary Dependabot PR after this change.
- **Not switching CodeQL default setup to the security-extended suite** (user decision). It would immediately open a backlog this change does not resolve.
- **Not adding Dependabot `npm` (pnpm) or `uv` entries** (user decision). `health-check.md` Fix 6 stays open as a follow-up: Dependabot's pnpm 12 support is unverified, and solver bumps must respect ortools' tight protobuf/numpy pins.
- **Not using `permissions: {}` plus per-job blocks** (user decision). A job that ever needs a write scope gets a job-level override on top of the workflow default.
- **Not adding `deployments: write`, or any write scope.** `wrangler-action`'s GitHub Deployments feature stays unused.
- **Not pinning Docker base images by digest** (`python:3.13-slim`, `ghcr.io/astral-sh/uv:0.12.3`), and not adding a Dependabot `docker` entry. That gap stays under README "Known gaps".
- **Not adding branch protection, rulesets, actionlint, zizmor or OSSF Scorecard.**
- **Not adding an in-repo pin-format CI gate.** Enforcement is GitHub's native `sha_pinning_required` (user decision).

## Implementation Approach

Ship one PR with one commit per code phase. Every merge to `main` deploys and rolls the solver container (README "Deployment"), so one PR means one production deploy and one wait for no running solve.

- **Open the PR as a draft after Phase 1**, so CI proves the token and credential changes on their own before any pin lands on top. A red run is then attributable to one phase.
- **Phase 2 changes refs only.** Each SHA is the code the floating ref already runs, so a red run after Phase 2 means a pinning mistake, never a version change.
- **Phase 3 is post-merge and operational.** It confirms what only `main` can show (`deploy` under the new token, alert closure, Dependabot accepting its config), then turns on enforcement and proves that CI, CodeQL and Dependabot still run under it.

## Critical Implementation Details

- **Resolve and pin commits, not tag objects.** For an annotated tag, `git ls-remote --tags` prints the tag-object SHA on `refs/tags/vX.Y.Z` and the commit on `refs/tags/vX.Y.Z^{}`. Pin the `^{}` commit; `gh api repos/O/R/commits/<tag> --jq .sha` also dereferences. `supabase/setup-cli@v2` resolves through `refs/heads/v2`; pin its HEAD and comment the exact tag on that commit (`# v2.1.2`). **Re-resolve at implement time.** If a floating ref has moved since 2026-10-09, pin what it resolves to then, so the change still runs the code CI runs today.
- **Silent failure mode of `sha_pinning_required`.** If the policy blocks GitHub's own dynamic workflows, CodeQL default setup or Dependabot stops producing results without turning any of our checks red. Phase 3 therefore checks for a **new** code-scanning analysis and a completed Dependabot run after the flip. A green `ci.yml` run is not enough.
- **Merge timing.** The merge deploys and rebuilds the image. Merge only when no production solve is running (README's standing rule), and the same applies to every later Dependabot PR.

## Phase 1: Token scope and credential hygiene

### Overview

Close the five alerts at the source by declaring `contents: read` once at workflow level. Stop checkouts persisting credentials, remove the template-injection shape from the `supabase-stack` composite action, and document the token posture.

### Changes Required:

#### 1. Workflow-level token scope

**File**: `.github/workflows/ci.yml`

**Intent**: Declare the least privilege every job is verified to need, in code, so it holds even if the repo default flips to read-write or the workflow is copied. This also closes alerts #1/#2/#3/#5/#6.

**Contract**:

- A top-level `permissions:` key with `contents: read`, placed after the `concurrency:` block (L12–14) and before `jobs:`.
- No job declares its own `permissions:`.
- The rationale comment above it, in the file's voice, says:
  - every action at its pinned version needs at most `contents: read`, and caching and artifacts use the runtime token, which `permissions:` doesn't govern;
  - it is workflow-level so future jobs inherit read-only;
  - a job that needs a write scope gets a job-level override, never a wider workflow default;
  - it must not be confused with a workflow-level `env:`, which stays forbidden (cross-reference `supabase-stack/action.yml`);
  - checkouts don't persist credentials, and why (change 2).

#### 2. Checkouts stop persisting credentials

**File**: `.github/workflows/ci.yml`

**Intent**: Lifecycle scripts run by `pnpm install`, and every later step, should not be able to read a persisted token. Nothing in CI runs a remote git command, and there are no git-sourced dependencies.

**Contract**:

- Each of the five `actions/checkout` steps gains `with: persist-credentials: false`.
- The rationale lives once in the change 1 comment, not repeated five times.

#### 3. Composite-action input passed through `env:`

**File**: `.github/actions/supabase-stack/action.yml`

**Intent**: Remove the `${{ inputs.export-anon-key }}`-in-`run:` shape (L50) before a future caller passes a non-literal value. The behaviour is unchanged.

**Contract**:

- The "Export Supabase env" step gains `env: EXPORT_ANON_KEY: ${{ inputs.export-anon-key }}`, and the test becomes `[ "$EXPORT_ANON_KEY" = "true" ]`.
- Afterwards, no `run:` in either composite action contains `${{`.

#### 4. README token posture

**File**: `README.md` ("CI / CD" section, after the five-job list, around L381)

**Intent**: The section lists jobs and secrets in detail but never says what token they run with. Add the one fact it lacks.

**Contract**: One short paragraph:

- the workflow declares `permissions: contents: read`;
- no job needs more;
- a job needing a write scope gets a job-level override;
- checkouts don't persist credentials.

### Success Criteria:

#### Automated Verification:

- All edited YAML parses: `yq e '.' .github/workflows/ci.yml .github/actions/supabase-stack/action.yml > /dev/null`
- Workflow scope is exactly `contents: read` and no job overrides it: `yq '.permissions' .github/workflows/ci.yml` prints `contents: read`, and `yq '[.jobs[].permissions] | map(select(. != null)) | length' .github/workflows/ci.yml` prints `0`
- All five checkouts disable persisted credentials: `yq '[.jobs[].steps[] | select(.uses // "" | test("^actions/checkout")) | .with."persist-credentials"] | map(select(. == false)) | length' .github/workflows/ci.yml` prints `5`
- No expression interpolation inside composite `run:` scripts: `yq '.runs.steps[].run // ""' .github/actions/*/action.yml | grep -c '\${{'` prints `0`
- Formatting is clean: `pnpm exec prettier --check .github README.md`
- Local CI gate is green: `/verify`
- Draft PR opened. The CI run on the Phase 1 commit passes `verify`, `integration`, `e2e` and `solver` (`gh pr checks`)

#### Manual Verification:

- In the draft PR's run, each of the four test jobs' "Set up job" log lists only `Contents: read` and `Metadata: read` under `GITHUB_TOKEN Permissions`
- The `ci.yml` rationale comment reads in the file's house voice and names the write-scope override rule

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: SHA pinning and Dependabot

### Overview

Pin all 13 remote `uses:` refs to the commit each one runs today, rewrite the comments that pinning makes obsolete, add a monthly `github-actions` Dependabot config that keeps the pins fresh, and document the rule.

### Changes Required:

#### 1. Pin every remote action

**Files**: `.github/workflows/ci.yml`, `.github/actions/setup/action.yml`, `.github/actions/supabase-stack/action.yml`

**Intent**: A moved or compromised tag can no longer change what CI runs. Behaviour stays identical, because each SHA is what its floating ref resolves to today.

**Contract**:

- Every non-local `uses:` becomes `owner/repo@<40-hex commit SHA> # vX.Y.Z`, with the SHAs from the Key Discoveries table, re-resolved at implement time per Critical Implementation Details.
- The comment is the most specific release tag on that commit, written as an exact `vX.Y.Z` so Dependabot can maintain it.
- Local `./.github/actions/*` refs are unchanged.
- The breakdown, 13 refs in all:
  - checkout ×5, setup-uv ×3, upload-artifact and wrangler-action in `ci.yml`;
  - pnpm and setup-node in `setup`;
  - setup-cli in `supabase-stack`.

#### 2. Rewrite comments that pinning makes obsolete

**Files**: `.github/workflows/ci.yml`, `.github/actions/setup/action.yml`

**Intent**: The repo's lesson on coupled conventions applies here: these comments cite a mechanism (floating tags) that this change removes, so updating them is part of this change.

**Contract**:

- **pnpm comment** (`setup/action.yml:10-11`): keep that v6.1.0 is the first release supporting pnpm 12. Drop the "return to `@v6` once the tag moves" instruction.
- **setup-uv comments** (`ci.yml` L98–100, L192–194, L293–300):
  - drop "`@v9` does not resolve / do not tidy to a bare major" and "EXACT version pin, unlike the `@v6`/`@v2` majors elsewhere";
  - **keep** the `version: "0.12.3"` RESOLVER ↔ `mise.toml` lockstep note.
- **Pinning rule**, stated once beside the change-1 comment from Phase 1:
  - every remote `uses:` is pinned to a full commit SHA with an exact `# vX.Y.Z`;
  - Dependabot moves both;
  - never hand-edit a ref back to a tag;
  - `sha_pinning_required` rejects tag refs.
- Each composite action gets a one-line pointer to that rule.
- **Unchanged:** the `wranglerVersion` ↔ `package.json` lockstep comment stays, plus a note that Dependabot bumps the action ref but never the `wranglerVersion` input.

#### 3. Dependabot config

**File**: `.github/dependabot.yml` (new)

**Intent**: Keep the SHA pins current without hand-resolving, at a cadence that respects "every merge deploys and rolls the container".

**Contract**: The file's header comment states:

- why monthly: each merge deploys, and the README's no-solve-running merge rule applies to Dependabot PRs too;
- why majors stay out of the group: each gets its own changelog review and revert unit;
- why `github-actions` only: npm and uv are deferred (`health-check.md` Fix 6);
- that the `wranglerVersion` and setup-uv `version` inputs are never bumped by Dependabot and stay lockstep by hand.

The non-obvious keys are the plural `directories` with a glob, and a group restricted by `update-types`:

```yaml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directories: ["/", "/.github/actions/*"]
    schedule:
      interval: "monthly"
    commit-message:
      prefix: "chore"
      include: "scope" # → "chore(deps): bump …", matching the repo's commit convention
    groups:
      actions-minor-patch: # group ids must start and end with a letter
        patterns: ["*"]
        update-types: ["minor", "patch"]
```

#### 4. README pinning and Dependabot

**File**: `README.md` ("CI / CD" section, beside the Phase 1 token paragraph)

**Intent**: Record the pinning rule, its maintenance and its enforcement where CI is documented. It is written now so the docs land in the same PR (and the same deploy) as the code.

**Contract**: A short paragraph covering:

- remote actions are SHA-pinned with exact version comments;
- `.github/dependabot.yml` bumps them monthly, minor and patch grouped, majors separate;
- a Dependabot PR merge deploys like any merge, so the no-solve rule applies;
- the repository enforces pinning via `sha_pinning_required` (Settings → Actions → General), so a tag ref fails at job setup.

If Phase 3's enforcement has to be rolled back, this sentence is corrected there.

### Success Criteria:

#### Automated Verification:

- All workflow YAML parses: `yq e '.' .github/workflows/ci.yml .github/actions/setup/action.yml .github/actions/supabase-stack/action.yml .github/dependabot.yml > /dev/null`
- No remote ref lacks a SHA pin with an exact version comment: `grep -rnE '^\s*(-\s*)?uses:' .github | grep -v 'uses: \./' | grep -vE 'uses: [A-Za-z0-9._/-]+@[0-9a-f]{40} # v[0-9]+\.[0-9]+\.[0-9]+$'` prints nothing
- Exactly 13 pinned remote refs: `grep -rcE 'uses: [A-Za-z0-9._/-]+@[0-9a-f]{40} # v' .github | awk -F: '{s+=$2} END {print s}'` prints `13`
- Every pinned SHA is the commit its comment's tag points at: for each `owner/repo@sha # vX.Y.Z`, `git ls-remote --tags https://github.com/owner/repo` has a line `sha<TAB>refs/tags/vX.Y.Z` or `sha<TAB>refs/tags/vX.Y.Z^{}`
- Dependabot config has the agreed shape: `yq '.updates[0] | [.["package-ecosystem"], .schedule.interval, (.directories | join(","))] | join(" ")' .github/dependabot.yml` prints `github-actions monthly /,/.github/actions/*`
- Formatting is clean: `pnpm exec prettier --check .github README.md`
- Local CI gate is green: `/verify`
- The PR's CI run on the Phase 2 commit passes `verify`, `integration`, `e2e` and `solver` (`gh pr checks`)

#### Manual Verification:

- The PR run's "Set up job" logs show each action downloaded at its pinned SHA (`Download action repository 'owner/repo@<sha>'`), with no tag refs left
- Diff review confirms no pin upgrades a version: every `# vX.Y.Z` equals the "Resolves to" column, or a re-resolution recorded at implement time
- The rewritten setup-uv comments still carry the `version` ↔ `mise.toml` lockstep note

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Merge, verify on `main`, enforce pinning

### Overview

Operational and post-merge. Confirm what only `main` can show, then turn on `sha_pinning_required` and prove nothing that runs on this repo breaks under it. Every step touches production or repo settings, so each one needs the user's go-ahead. No commit to `main` is made here: outcomes are recorded in this change folder and land with the archive commit, because every commit to `main` deploys.

### Changes Required:

#### 1. Merge the PR

**Intent**: Ship Phases 1–2 in a single deploy.

**Contract**:

- Mark the PR ready.
- Squash-merge with the `(#NN)` suffix, only once no production solve is `running` (README "Do not merge to `main` while a production solve is running").

#### 2. Verify on `main`

**Intent**: Prove least privilege and alert closure from the post-merge evidence, not from the alerts alone.

**Contract**:

- The post-merge run's `deploy` succeeds.
- All five jobs' `GITHUB_TOKEN Permissions` show only `Contents: read` and `Metadata: read`.
- Once the `main` CodeQL analysis has run, alerts #1/#2/#3/#5/#6 read `fixed` and no new alert appears.
- Dependabot accepts the config: Insights → Dependency graph → Dependabot lists both directories with no config error.

#### 3. Turn on `sha_pinning_required`

**Intent**: Turn "every remote action is pinned" from a convention into a gate.

**Contract**:

- Read the current state with `gh api repos/dobrek/ib-timetable-planner/actions/permissions`.
- Then `PUT` the same endpoint with `{"enabled": true, "allowed_actions": "all", "sha_pinning_required": true}`, and read it back.
- Prefix `gh` with `GH_TOKEN=$(gh auth token --user dobrek)`. If that is refused, use the Settings → Actions → General toggle.

#### 4. Prove CI, CodeQL and Dependabot under enforcement

**Intent**: Close the undocumented gaps (local composite refs, GitHub-managed dynamic workflows) with evidence, and catch the silent-failure mode.

**Contract**:

- **CI:** `gh workflow run ci.yml --ref main` passes `verify`, `integration`, `e2e` and `solver`, and `deploy` is skipped. Those jobs use both local composite actions.
- **CodeQL:** a code-scanning analysis completes after the flip. Re-run the CodeQL check on an open Dependabot PR, or wait for the next PR, then confirm with `gh api 'repos/dobrek/ib-timetable-planner/code-scanning/analyses?per_page=5'` that a `created_at` later than the flip exists without error.
- **Dependabot:** an update run completes after the flip (Insights → Dependabot → "Check for updates").
- **Rollback:** if any of these fails with a "must be pinned to a full-length commit SHA" error, `PUT` `sha_pinning_required: false`, keep the pins as a convention, and record the finding plus the README correction needed as a follow-up in this change folder.

#### 5. Record outcomes

**File**: `context/changes/security-workflow-issues/change.md` (Notes)

**Intent**: Leave evidence for the archive and future security work.

**Contract**: Notes record:

- the post-merge run ID;
- the alert states;
- the `sha_pinning_required` outcome, with the dispatch run ID and the post-flip CodeQL analysis ID;
- the first-run Dependabot PRs. These are expected to be the minor/patch group (if any) plus checkout v7, setup-node v7, setup-uv v10 and setup-cli v3, each to be reviewed separately.

### Success Criteria:

#### Automated Verification:

- Post-merge `main` run is green including `deploy`: `gh run list --branch main --workflow ci.yml --limit 1 --json conclusion,headSha`
- No open `actions/missing-workflow-permissions` alerts: `gh api 'repos/dobrek/ib-timetable-planner/code-scanning/alerts?state=open&per_page=100' --jq '[.[] | select(.rule.id == "actions/missing-workflow-permissions")] | length'` prints `0`
- Alerts #1/#2/#3/#5/#6 are `fixed`: `for n in 1 2 3 5 6; do gh api repos/dobrek/ib-timetable-planner/code-scanning/alerts/$n --jq '"\(.number) \(.state)"'; done`
- Enforcement is on: `gh api repos/dobrek/ib-timetable-planner/actions/permissions --jq .sha_pinning_required` prints `true` (or `false` with the rollback recorded)
- The post-flip `workflow_dispatch` run on `main` passes all four test jobs, with `deploy` skipped

#### Manual Verification:

- Merged only while no production solve was running
- `GITHUB_TOKEN Permissions` in all five post-merge jobs, `deploy` included, list only `Contents: read` and `Metadata: read`
- Dependabot shows no config error, and its first-run PRs match expectations
- A code-scanning analysis and a Dependabot run both completed after the flip
- Outcomes recorded in `change.md` Notes

**Implementation Note**: Every step in this phase touches production or repository settings. Get the human's go-ahead before the merge and before the settings `PUT`.

---

## Testing Strategy

### Unit Tests:

- None. The change touches CI configuration and docs only, and no code path or test consumes `ci.yml` (research §4).

### Integration Tests:

- The PR's own CI runs are the integration test. The Phase 1 commit proves the four test jobs under `contents: read` with no persisted credentials. The Phase 2 commit proves the same jobs on pinned SHAs. Both include the local composite actions and the `export-anon-key: "true"` path through the new `env:` indirection, exercised by `integration` and `e2e`.

### Manual Testing Steps:

1. In a PR run, open any job's "Set up job" log and confirm the `GITHUB_TOKEN Permissions` block and the `Download action repository '…@<sha>'` lines.
2. After merge, confirm `deploy` succeeded and its token block matches.
3. After the flip, confirm one `workflow_dispatch` run, one new CodeQL analysis and one Dependabot run all completed.

## Performance Considerations

None. No step is added. Pinned refs download the same action code.

## Migration Notes

- **Rolling back Phases 1–2:** revert the squash commit. That redeploys, so the no-solve rule applies.
- **Rolling back Phase 3:** a single settings `PUT` with `sha_pinning_required: false`, with no deploy.
- Code-scanning alerts reopen automatically if the `permissions:` key is ever removed.

## References

- Research: `context/changes/security-workflow-issues/research.md`
- Alert rule: [`MissingActionsPermissions.ql` @ codeql-cli/v2.27.1](https://github.com/github/codeql/blob/codeql-cli/v2.27.1/actions/ql/src/Security/CWE-275/MissingActionsPermissions.ql)
- Env-isolation rule not to conflate with `permissions:`: `.github/actions/supabase-stack/action.yml:40-45`
- Prior deferral of SHA pinning, now taken up: `context/archive/2026-06-18-ci-piepline-cleanup/plan.md:53`
- Scheduled dependency scanning (npm/pip still deferred): `context/foundation/health-check.md` Fix 6
- Coupled-convention lesson (comment rewrites in Phase 2): `context/foundation/lessons.md` "A convention that cites a code mechanism is coupled to it"
- Docs: Dependabot options reference (`directories`, `groups.update-types`, `commit-message`); Dependabot on Actions (read-only token and no secrets on Dependabot PRs); REST "Set GitHub Actions permissions for a repository" (`enabled` required, `sha_pinning_required`); GitHub changelog 2025-08-15 (SHA-pinning policy)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Token scope and credential hygiene

#### Automated

- [x] 1.1 All edited YAML parses — 4dc637f
- [x] 1.2 Workflow scope is exactly `contents: read` and no job overrides it — 4dc637f
- [x] 1.3 All five checkouts disable persisted credentials — 4dc637f
- [x] 1.4 No expression interpolation inside composite `run:` scripts — 4dc637f
- [x] 1.5 Formatting is clean — 4dc637f
- [x] 1.6 Local CI gate is green — 4dc637f
- [x] 1.7 Draft PR opened; Phase 1 commit CI passes all four test jobs — 4dc637f

#### Manual

- [x] 1.8 Draft PR run shows only `Contents: read` + `Metadata: read` in the four test jobs
- [x] 1.9 `ci.yml` rationale comment reads in house voice and names the write-scope override rule

### Phase 2: SHA pinning and Dependabot

#### Automated

- [x] 2.1 All workflow YAML parses — 97d6b42
- [x] 2.2 No remote ref lacks a SHA pin with an exact version comment — 97d6b42
- [x] 2.3 Exactly 13 pinned remote refs — 97d6b42
- [x] 2.4 Every pinned SHA is the commit its comment's tag points at — 97d6b42
- [x] 2.5 Dependabot config has the agreed shape — 97d6b42
- [x] 2.6 Formatting is clean — 97d6b42
- [x] 2.7 Local CI gate is green — 97d6b42
- [x] 2.8 Phase 2 commit CI passes all four test jobs — 97d6b42

#### Manual

- [x] 2.9 PR run downloads every action at its pinned SHA, no tag refs left
- [x] 2.10 Diff review: no pin upgrades a version
- [x] 2.11 setup-uv comments keep the `version` ↔ `mise.toml` lockstep note

### Phase 3: Merge, verify on `main`, enforce pinning

#### Automated

- [x] 3.1 Post-merge `main` run is green including `deploy`
- [x] 3.2 No open `actions/missing-workflow-permissions` alerts
- [x] 3.3 Alerts #1/#2/#3/#5/#6 are `fixed`
- [x] 3.4 Enforcement is on (or rollback recorded)
- [ ] 3.5 Post-flip `workflow_dispatch` run on `main` passes all four test jobs

#### Manual

- [x] 3.6 Merged only while no production solve was running
- [ ] 3.7 All five post-merge jobs, `deploy` included, show only `Contents: read` + `Metadata: read`
- [ ] 3.8 Dependabot shows no config error; first-run PRs match expectations
- [ ] 3.9 A code-scanning analysis and a Dependabot run both completed after the flip
- [ ] 3.10 Outcomes recorded in `change.md` Notes
