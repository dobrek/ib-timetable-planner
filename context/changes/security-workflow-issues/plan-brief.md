# Security Workflow Issues — Plan Brief

> Full plan: `context/changes/security-workflow-issues/plan.md`
> Research: `context/changes/security-workflow-issues/research.md`

## What & Why

CodeQL raised five `actions/missing-workflow-permissions` alerts (#1, #2, #3, #5, #6), one per job in `.github/workflows/ci.yml`. None of the jobs declares a `GITHUB_TOKEN` scope. Today's real exposure is low, because the repo default is already read-only. The point is to write the least privilege into code, where it survives a settings flip or a copy.

Research also found adjacent supply-chain gaps. The user chose to fix them in the same change, ending with pinning enforced by the repo itself:

- persisted checkout credentials;
- an input interpolated into a composite action's `run:` script;
- tag-pinned actions.

## Starting Point

`ci.yml` has no `permissions:` key anywhere. Every remote action (13 refs across the workflow and two composite actions) is pinned by tag or by floating major. There is no Dependabot config, and `sha_pinning_required` is off. Every action and CI script has been checked, and none needs more than `contents: read`.

## Desired End State

- A single workflow-level `permissions: contents: read` closes all five alerts. The run logs prove least privilege: only `Contents: read` and `Metadata: read`.
- Checkouts don't persist credentials.
- Every remote `uses:` is pinned to the commit it runs today, as `@<sha> # vX.Y.Z`.
- A monthly Dependabot config keeps those pins fresh.
- The repo rejects any unpinned action at job setup.
- The README documents all of it.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Token-scope structure | Workflow-level `contents: read`, write scopes only as job-level overrides | One edit closes all 5 alerts, and every job is verified to need exactly this. | Research / Plan |
| Close vs dismiss | Fix in code | A dismissal is lost whenever a job's first lines are edited (alert #4 rotated into #6). | Research |
| Composite input | Pass through `env:` | Removes the template-injection shape at no cost. | Plan |
| `persist-credentials: false` | On all 5 checkouts | Nothing does remote git and there are no git dependencies, so install scripts get no token for free. | Plan |
| SHA-pin scope | All remote actions, GitHub's own included | One rule for every ref, and enforcement covers `actions/*` anyway. | Plan |
| Pin target | Exactly what each floating ref resolves to today | Runs the same code; upgrades are Dependabot's job. | Plan |
| Enforcement | Repo `sha_pinning_required: true`, proven post-merge | Native gate with no CI script to maintain; rolled back if it blocks local or GitHub-managed workflows. | Plan |
| Dependabot cadence | Monthly; minor+patch grouped, each major separate | Every merge deploys and rolls the container, and each major needs its own review. | Plan |
| Dependabot ecosystems | `github-actions` only | npm (pnpm 12 support unverified) and uv (ortools pins) stay a follow-up (health-check Fix 6). | Plan |
| CodeQL suite | Keep default, not security-extended | Avoids opening a backlog this change doesn't resolve. | Plan |
| Docs | Inline `ci.yml` rationale plus README "CI / CD" paragraphs | Matches the file's comment-dense house style, and fills the README's missing token fact. | Plan |
| Delivery | One PR, one commit per code phase | One merge means one production deploy and one wait for no running solve. | Plan |

## Scope

**In scope:**

- `permissions: contents: read` and its rationale.
- `persist-credentials: false` on all five checkouts.
- `env:` indirection in `supabase-stack`.
- 13 SHA pins and rewrites of the comments that pinning makes obsolete.
- `.github/dependabot.yml`.
- README paragraphs.
- The `sha_pinning_required` flip and the proof that CI, CodeQL and Dependabot still run under it.

**Out of scope:**

- Any action version bump, including merging Dependabot's first-run majors (checkout v7, setup-node v7, setup-uv v10, setup-cli v3).
- The security-extended suite.
- Dependabot npm/uv entries.
- Docker base image digest pinning.
- Branch protection, actionlint, zizmor, Scorecard.
- Write scopes.

## Architecture / Approach

1. **Phase 1:** token and credential changes, pushed as a draft PR so CI proves them on their own.
2. **Phase 2:** refs-only pinning plus the Dependabot config. A red run here means a pinning mistake, never a version change.
3. **Phase 3:** post-merge only. The things only `main` can show are checked there: `deploy` under the new token, alert closure, Dependabot accepting its config. Then enforcement is turned on and verified with a `workflow_dispatch` run, a new CodeQL analysis and a Dependabot run.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Token scope & credential hygiene | `contents: read`, no persisted creds, `env:` input, README token line | `deploy` can't run before merge (fail-safe: the old Worker stays live) |
| 2. SHA pinning & Dependabot | 13 commit-pinned refs, monthly Dependabot, README pinning text | Pinning a tag object instead of its commit; `supabase/setup-cli@v2` is a branch |
| 3. Merge, verify, enforce | Alerts fixed, least privilege proven, `sha_pinning_required` on | The policy may silently block CodeQL or Dependabot, so a new analysis and a new run are required as proof |

**Prerequisites:** `gh` authenticated as `dobrek` with `repo` scope; no production solve running at merge time.
**Estimated effort:** about one session for Phases 1–2 (two CI cycles), plus a short post-merge session for Phase 3.

## Open Risks & Assumptions

- The docs don't say whether `sha_pinning_required` exempts local composite refs or GitHub-managed dynamic workflows. Phase 3 proves it with evidence and rolls back with one settings change if needed.
- Floating refs may move before implementation, so the pins are re-resolved at implement time and still match what CI runs then.
- Dependabot's first run will open four major-bump PRs. Each merge deploys, so they need their own reviews and their own no-solve windows.

## Success Criteria (Summary)

- No open `actions/missing-workflow-permissions` alerts, and every job's run log, `deploy` included, shows only `Contents: read` and `Metadata: read`.
- Every remote action is commit-pinned, Dependabot maintains the pins monthly, and an unpinned ref fails at job setup.
- CI, CodeQL and Dependabot all keep running under the enforcement.
