---
date: 2026-10-09T10:30:09+02:00
researcher: Claude Code (Opus 5.5)
git_commit: bd4ad6e4ca51385178080d7cd2d7ff6668b08590
branch: main
repository: dobrek/ib-timetable-planner
topic: "Validate the open CodeQL code-scanning alerts #1, #2, #3, #5, #6 on .github/workflows/ci.yml and assess the feasibility of fixing them"
tags: [research, ci, github-actions, codeql, code-scanning, security, github-token, least-privilege]
status: complete
last_updated: 2026-10-09
last_updated_by: Claude Code (Opus 5.5)
---

# Research: Security workflow issues — CodeQL `actions/missing-workflow-permissions`

**Date**: 2026-10-09T10:30:09+02:00
**Researcher**: Claude Code (Opus 5.5)
**Git Commit**: `bd4ad6e4ca51385178080d7cd2d7ff6668b08590`
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

Validate each reported code-scanning alert linked in `change.md` (#6, #5, #3, #2, #1) and check the feasibility of fixing them.

## Summary

- **All five alerts are the same rule**: `actions/missing-workflow-permissions` (CWE-275; CodeQL security severity "medium"), one per job in `.github/workflows/ci.yml`. They are all **true positives**: the workflow has no `permissions:` key at workflow level or on any job.
- **The real-world exposure today is low.** The repository's Actions default is already `default_workflow_permissions: "read"` (public repo, created 2026-05-22, user-owned). Every job therefore already runs with read-only `contents` + `packages`. The alerts protect against drift (that setting being flipped to read-write, or the workflow being copied elsewhere) and ask that the intended scope be written down in code.
- **No job needs more than `contents: read`.** This was verified for every action at its exact pinned version, and for every script CI runs. Nothing in the repo uses `GITHUB_TOKEN`. `deploy` authenticates with Cloudflare and Supabase secrets only.
- **The fix is trivial and low-risk.** One two-line workflow-level block, `permissions: contents: read`, closes all five alerts. Compared with today's effective token, it only drops `packages: read`, which nothing uses. **Feasibility: high (~10 min edit + one PR cycle).**
- **Four caveats for the plan:**
  - The alerts close only when the post-merge `main` analysis runs. PR analyses are diff-filtered.
  - `deploy` is first exercised under the new block **by the merge itself**, because its `if:` admits only `push` to `main`.
  - CodeQL is satisfied by *any* `permissions:` key, including `write-all`. So "alert closed" is not proof of least privilege; the run log's `GITHUB_TOKEN Permissions` section is.
  - **Alert #4 was never fixed.** It rotated into #6 when the `solver` job's opening lines were edited.

## Detailed Findings

### 1. Per-alert validation

All five alerts carry the same message: *"Actions job or workflow does not limit the permissions of the GITHUB_TOKEN. Consider setting an explicit permissions block, using the following as a minimal starting point: {{contents: read}}"*. They come from CodeQL 2.27.1, default setup, analysing commit `bd4ad6e` on `refs/heads/main`.

| Alert | Job (`name:`) | CodeQL span | Steps that read `GITHUB_TOKEN` | Minimum scope | Verdict |
| --- | --- | --- | --- | --- | --- |
| [#1](https://github.com/dobrek/ib-timetable-planner/security/code-scanning/1) | `verify` — "Lint, audit, unit & build" | [L18–69](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L18-L69) | `actions/checkout`; `setup-node` (Node manifest fetch, public) | `contents: read` | True positive |
| [#2](https://github.com/dobrek/ib-timetable-planner/security/code-scanning/2) | `integration` | [L70–170](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L70-L170) | checkout; setup-node; `setup-uv` (public release download, fallback only) | `contents: read` | True positive |
| [#3](https://github.com/dobrek/ib-timetable-planner/security/code-scanning/3) | `e2e` | [L171–277](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L171-L277) | checkout; setup-node; setup-uv (`upload-artifact` uses the runtime token, not `GITHUB_TOKEN`) | `contents: read` | True positive |
| [#6](https://github.com/dobrek/ib-timetable-planner/security/code-scanning/6) | `solver` — "Solver tests (Python)" | [L278–323](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L278-L323) | checkout; setup-uv | `contents: read` | True positive (successor of #4, see §5) |
| [#5](https://github.com/dobrek/ib-timetable-planner/security/code-scanning/5) | `deploy` | [L324–388](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L324-L388) | checkout; setup-node (`wrangler-action` is not given a GitHub token) | `contents: read` | True positive |

The span starts at the job body's first key (col 5, the `name:` line) and runs to the line before the next job, so it includes the next job's leading comment block.

**What the rule checks.** Source: [`MissingActionsPermissions.ql` @ codeql-cli/v2.27.1](https://github.com/github/codeql/blob/codeql-cli/v2.27.1/actions/ql/src/Security/CWE-275/MissingActionsPermissions.ql).

```ql
predicate jobHasPermissions(Job job) {
  exists(job.getPermissions())
  or
  exists(job.getEnclosingWorkflow().getPermissions())
  or ... // reusable-workflow callers
}
where not jobHasPermissions(job) and
  exists(Event e | e = job.getATriggerEvent() and not e.getName() = "workflow_call")
```

- **A single workflow-level `permissions:` block satisfies the rule for every job.**
- The check is **existence only**: `{}`, `read-all`, `contents: read` and also `write-all` all silence it. Closing the alert therefore does not prove least privilege.
- The query does **not** descend into composite or local actions. The `{contents: read}` suggestion comes only from the direct `uses: actions/checkout` step.
- **Exclusions.** The only ones are jobs triggered solely by `workflow_call`, and reusable workflows whose callers set permissions. There is no "known-safe actions" exclusion in any version of the file's history. Job-level `if:` is ignored, which is why `deploy` is flagged even though it only runs on push to `main`.

### 2. The effective token today, and why to fix it anyway

Live repo settings (`gh api`, 2026-10-09):

- `actions/permissions/workflow` returns `{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}`.
- `actions/permissions` returns `{"enabled":true,"allowed_actions":"all","sha_pinning_required":false}`.
- The repo itself: `visibility: public`, `created_at: 2026-05-22`, `owner.type: User`.
- `code-scanning/default-setup` reports `state: configured`; `query_suite: default`; languages `actions`, `javascript-typescript` and `python`; weekly schedule.

GitHub's restricted ("read") default grants *"read access for the `contents` and `packages` permissions"*. On fork PRs, write scopes are already downgraded to read (`pull_request` events, with "send write tokens" off). So **every job today holds `contents: read` + `packages: read`**, and the alerts describe a latent risk rather than a current one.

Reasons to fix rather than dismiss:

- **Survives a settings flip or a copy.** This is the rule's own rationale ([help text](https://github.com/github/codeql/blob/codeql-cli/v2.27.1/actions/ql/src/Security/CWE-275/MissingActionsPermissions.md)): an explicit block keeps the token restricted if the repo default changes or the workflow moves to another repo or org.
- **Caps the supply-chain blast radius.** Every job runs `pnpm install`, which executes dependency lifecycle scripts, plus third-party actions (`pnpm/action-setup`, `astral-sh/setup-uv`, `supabase/setup-cli`, `cloudflare/wrangler-action`). Under a permissive default, a compromised dependency on a push to `main` would hold a **write** token on a branch that is unprotected and auto-deploys. The block caps that whatever the settings say.
- **Dismissal does not stick** (see §5).

The block narrows today's token by exactly one scope: `packages: read`. Nothing needs it:

- No step logs in to GHCR.
- The Dockerfile's `COPY --from=ghcr.io/astral-sh/uv:0.12.3` is an anonymous pull of a public image.
- The solver image is pushed to Cloudflare's registry, not GHCR.

### 3. Per-action token needs (at the exact pinned versions)

Each `action.yml` was read at its tag, and the source where needed.

| Action @ pin | Where used | `GITHUB_TOKEN` use | Minimum scope |
| --- | --- | --- | --- |
| `actions/checkout@v6` | all 5 jobs | `token` defaults to `github.token`; `persist-credentials` defaults to `true` | `contents: read` (its README's "Recommended permissions") |
| `pnpm/action-setup@v6.1.0` | composite `setup` | none (no token input; only `ACTIONS_RUNTIME_TOKEN` for its own cache, off by default) | none |
| `actions/setup-node@v6` + `cache: pnpm` | composite `setup` | `token` defaults to `github.token`, sent only when fetching Node builds from the public `actions/node-versions` repo (rate limits). Caching goes through `@actions/cache` → `ACTIONS_RUNTIME_TOKEN` | `contents: read` |
| `astral-sh/setup-uv@v9.0.0` | integration, e2e, solver | `github-token` defaults to `github.token`, attached only when the download URL is on `github.com`. The default source is the `releases.astral.sh` mirror, with GitHub as fallback; public assets | none (`contents: read` is fine) |
| `supabase/setup-cli@v2` | composite `supabase-stack` | `github-token` has **no default** and is not passed; it is used only to resolve `latest` | none |
| `actions/upload-artifact@v7` | e2e (on failure) | none — uploads use `ACTIONS_RUNTIME_TOKEN` | none |
| `cloudflare/wrangler-action@v4` | deploy | `gitHubToken` has **no default** and is not passed. It is used only to create GitHub Deployments, which would need `deployments: write` | none |

**Conclusion:** `permissions: contents: read` at workflow level is sufficient for all five jobs. Caching (setup-node, setup-uv) and artifacts use the runtime token and are not governed by `permissions:`. Should the GitHub Deployments feature of `wrangler-action` ever be wanted, `deploy` alone would need `deployments: write` added as a job-level override.

**About checkout v6 credentials.** The v6 README says *"`persist-credentials` now stores credentials in a separate file under `$RUNNER_TEMP` instead of directly in `.git/config`"* (CHANGELOG v6.0.0: "Persist creds to a separate file (#2286)"). The post-job step removes them.

### 4. Repo-side token usage: none

A full sweep covered `package.json` scripts (incl. `pretest:e2e` → `scripts/provision-e2e-author.mjs`), `playwright.config.ts`, the vitest configs, `scripts/**`, `e2e/**`, `lefthook.yml` and `.github/**`. It found:

- **No** reference to `GITHUB_TOKEN`, `github.token`, `GH_TOKEN`, `octokit`, `api.github.com`, `id-token` or OIDC in anything CI executes.
- **No** `git push`, commit, tag or `gh` call in any CI path. The only `curl` calls are the anonymous shellcheck release download ([ci.yml:43-44](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L43-L44)) and localhost `/health` polls.
- **Expression contexts used:** only `github.workflow` and `github.ref` ([L13-14](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L13-L14)), `github.event_name` ([L326](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L326)) and `github.sha` ([L387](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L387)).
- **Repo secrets:** read only in `deploy` ([L342-343](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L342-L343), [L385-386](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L385-L386)). None of them is the GitHub token.
- **No test or script parses `ci.yml`** or the composite actions. The version-lockstep pairs (`mise.toml` ↔ uv `0.12.3` and shellcheck `0.11.0`; `wranglerVersion` ↔ `package.json`) are kept by hand-maintained comments. The only in-workflow assert is the shellcheck version check ([L57-58](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L57-L58)), which a `permissions:` key cannot affect.

### 5. Alert tracking: why #4 became #6, and when alerts close

**#4 was not fixed; it rotated.**

- #4 (solver job, L276–318 at `b9d70b1`) was marked `fixed` at 2026-10-08T18:27:18Z. That is the exact timestamp #6 (solver job, L278–323) was created, in the `main` analysis of `dea64f5`.
- Code scanning matches alerts across analyses by `partialFingerprints.primaryLocationLineHash`. That hash covers the first 100 non-whitespace characters starting at the alert's line ([codeql-action `fingerprints.ts`](https://github.com/github/codeql-action/blob/main/src/fingerprints.ts)). It depends on content, not on the line number.
- Commits `4303e72`/`02c9257` (greedy-retirement) inserted a comment plus `timeout-minutes: 15` as the solver job's third line, inside that window. The hash changed (`24fb7268ab066216` → `a8d6dccc5a1cf42`), so the old alert closed and a new one opened.
- `deploy` moved L319 → L324 in the same push but kept hash `1e598d1e6d272513:1`, and with it alert #5.

**Implication:** dismissing these alerts is fragile. Any edit near the head of a job body re-keys that job's alert, and the dismissal does not carry over. This is another reason to fix rather than dismiss.

**Closure timing.**

- An alert's state reflects the **default-branch** analysis only. #4's `fixed_at` equals the `refs/heads/main` analysis timestamp.
- PR analyses run diff-filtered: the `codeql-action/pr-diff-range` pack and `filterAlertsByDiffRange` keep only results whose start line falls inside the PR diff. PR #135's three actions-language analyses all report `results_count: 0`.
- So a fixing PR will not reliably show "fixes 5 alerts". The confirmation is the post-merge state: `gh api 'repos/dobrek/ib-timetable-planner/code-scanning/alerts?state=open'` returns no `actions/missing-workflow-permissions` rows.

**No new alerts expected from the fix** (reasoned from the query library, not test-run). Permissions feed `Job.isPrivileged()` only through **write** scopes, so a read-only block cannot make any job a candidate for the injection, untrusted-checkout or cache-poisoning queries in the default suite.

### 6. Fix options and feasibility

**Option A — workflow-level `contents: read` (recommended).** Insert after the `concurrency:` block ([L12-14](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L12-L14)), before `jobs:`, with a rationale comment in the file's house style:

```yaml
permissions:
  contents: read
```

- One edit closes all five alerts, and future jobs inherit read-only automatically.
- No job body is touched, so there is no fingerprint churn and no diff noise in the five jobs.
- A workflow-level `permissions:` is safe. The project's standing rule forbids a workflow-level **`env:`** (production `SUPABASE_*` must never reach the e2e preview — [supabase-stack/action.yml:40-45](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/actions/supabase-stack/action.yml#L40-L45)). The two keys must not be conflated.

**Option B — `permissions: {}` at workflow level + `contents: read` on each job.**

- Stricter by default: a new job starts with nothing, and each job documents its own needs.
- It costs five identical edits.
- Whether `actions/checkout` works with `{}` on a public repo is **UNVERIFIED**, so a forgotten per-job block could fail in a surprising way.
- With five jobs that all need the same single scope, the extra structure buys little. Revisit if a job ever needs a write scope; that job would then get a job-level override on top of Option A anyway.

**Option C — dismiss as "won't fix" (repo default is read). Rejected:**

- It does not record the intended scope in code.
- It does not survive a settings flip or a copy.
- Dismissals are lost on fingerprint rotation (§5).

**Option D — change the repo setting. Not applicable:**

- The setting is already "read".
- The query cannot see repo settings, so this would not clear the alerts.

**Risk and verification for Option A**

- **Local.** Neither `actionlint` nor `zizmor` is installed, so a YAML parse is the local gate (precedent: `ci-piepline-cleanup` plan, "`actionlint` if available … otherwise a plain YAML parse"). The PostToolUse prettier hook formats the edited file.
- **PR CI.** A green run proves `verify`, `integration`, `e2e` and `solver` under the new token. `upload-artifact` runs only on failure, but it never uses `GITHUB_TOKEN`.
- **`deploy` cannot be exercised before merge.** Its `if:` requires `github.event_name == 'push'` on `main` ([L326](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L326)), and `workflow_dispatch` does not satisfy it. By analysis no deploy step touches `GITHUB_TOKEN`: the migrations use `SUPABASE_ACCESS_TOKEN`, and `wrangler-action` uses the Cloudflare `apiToken`. A failure would be fail-safe: the previous Worker stays live.
- **Merge timing.** The standing README rule still binds: merge only when no production solve is running, because every merge deploys and rebuilds the image.
- **Post-merge evidence.** Each job's "Set up job" log prints a `GITHUB_TOKEN Permissions` section; expect only `Contents: read` and `Metadata: read`. The code-scanning alerts #1, #2, #3, #5 and #6 should then show `state: fixed`. Do not use alert closure alone as the least-privilege proof (§1).
- **Docs (optional).** The README "CI / CD" section ([README.md:373](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/README.md#L373)) enumerates jobs and secrets but says nothing about token scope. One sentence there would document the posture. No other doc enumerates anything a `permissions:` key would invalidate.

### 7. Adjacent observations (not reported by the default suite)

These are outside the five alerts. They are listed so the plan can decide scope deliberately; none blocks the fix.

1. **Third-party actions are pinned by tag, not SHA.**
   - `actions/unpinned-tag` runs only in the **security-extended** suite, which is not enabled. It trusts only the `actions`, `github` and `advanced-security` owners and checks composite actions too.
   - It would flag six uses: `pnpm/action-setup@v6.1.0`, `supabase/setup-cli@v2`, `astral-sh/setup-uv@v9.0.0` ×3 and `cloudflare/wrangler-action@v4`.
   - Prior decision: **deferred as out of scope** (`ci-piepline-cleanup` plan.md:53). The repo's `sha_pinning_required` is `false`.
   - If ever taken up, it pairs with a Dependabot `github-actions` ecosystem entry to keep SHAs fresh. `health-check.md` Fix 6 already recommends Dependabot for npm and pip, as optional.
2. **`persist-credentials` defaults to `true` on all five checkouts** ([L21](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L21), [73](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L73), [174](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L174), [287](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L287), [329](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L329)).
   - Lifecycle scripts run after checkout could read the persisted token.
   - Once the token is `contents: read` on a public repo, it is worth almost nothing.
   - `persist-credentials: false` is a harmless optional extra: nothing in CI does remote git operations, and the uploaded artifact is `playwright-report/` only, not the workspace.
3. **A template-injection shape in the composite action:** `${{ inputs.export-anon-key }}` is interpolated straight into `run:` ([supabase-stack/action.yml:50](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/actions/supabase-stack/action.yml#L50)).
   - It is not exploitable: both callers pass the literal `"true"` ([ci.yml:80](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L80), [178](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L178)), so it is not an untrusted source and the default suite stays silent.
   - Hygiene fix: pass it through `env:` and reference `"$EXPORT_ANON_KEY"`.
4. **`main` has no branch protection and no rulesets**, and every push to `main` deploys. This is recorded repeatedly in prior changes and unrelated to these alerts. Noted only because it is what turns "a compromised dependency holds a write token" from theoretical into deployable.

## Code References

- [`.github/workflows/ci.yml:1-14`](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L1-L14) — triggers (`push`/`pull_request` on `main`, `workflow_dispatch`) and `concurrency:`. A workflow-level `permissions:` goes after L14.
- [`.github/workflows/ci.yml:17-67`](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L17-L67) — `verify` job (alert #1).
- [`.github/workflows/ci.yml:69-154`](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L69-L154) — `integration` job (alert #2).
- [`.github/workflows/ci.yml:170-253`](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L170-L253) — `e2e` job (alert #3); `upload-artifact@v7` at L249.
- [`.github/workflows/ci.yml:277-321`](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L277-L321) — `solver` job (alert #6, formerly #4); `timeout-minutes: 15` at L282 is what re-keyed it.
- [`.github/workflows/ci.yml:323-388`](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/workflows/ci.yml#L323-L388) — `deploy` job (alert #5). `if:` push-to-main only (L326); secrets L342-343 and L385-386; `wrangler-action@v4` with no GitHub token (L383-388).
- [`.github/actions/setup/action.yml`](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/actions/setup/action.yml) — `pnpm/action-setup@v6.1.0` and `actions/setup-node@v6` with `cache: pnpm`.
- [`.github/actions/supabase-stack/action.yml:14`](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/actions/supabase-stack/action.yml#L14) — `supabase/setup-cli@v2`.
- [`.github/actions/supabase-stack/action.yml:40-50`](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/.github/actions/supabase-stack/action.yml#L40-L50) — the env-isolation rule ("never promote `SUPABASE_*` to a workflow-level `env:`") and the input interpolation (§7.3).
- [`README.md:373-396`](https://github.com/dobrek/ib-timetable-planner/blob/bd4ad6e4ca51385178080d7cd2d7ff6668b08590/README.md#L373-L396) — "CI / CD" section: job list and repo-secrets table.

## Architecture Insights

- **One workflow, comment-dense house style.**
  - Every non-obvious choice in `ci.yml` is explained inline, including what *not* to do: "never path filters", "do not 'tidy' to a bare major".
  - Pins carry named lockstep partners: the uv resolver ↔ `mise.toml`, shellcheck ↔ `mise.toml`, `wranglerVersion` ↔ the `package.json` devDependency.
  - The `permissions:` block should carry a short rationale comment in the same voice: why `contents: read`, why workflow-level, and that a job needing a write scope gets a job-level override rather than a widened workflow default.
- **The CI security stance on record is secret and environment isolation, not token scope.**
  - Ephemeral per-job Supabase keys, a per-run solver password, repo secrets confined to `deploy`, and no workflow-level `env:`.
  - Token scope was simply never addressed, and nothing depends on it.
  - The fix extends the existing stance rather than changing it.
- **`deploy` is the only privileged job**, through its secrets. CodeQL's default-suite injection and checkout queries already evaluate it as privileged and report nothing: there is no PR-head checkout and no `github.event.*` interpolation.

## Historical Context (from prior changes)

- `context/archive/2026-06-18-ci-piepline-cleanup/plan.md:53` — "**Not** pinning actions to full commit SHAs (supply-chain hardening — out of scope)."
- `context/archive/2026-06-18-ci-piepline-cleanup/research.md:285` — "Floating-major pinning is fine to keep; if the project later wants supply-chain hardening, pin actions to full commit SHAs (optional, out of scope here)."
- `context/archive/2026-06-18-ci-piepline-cleanup/research.md:294` — `main` has no branch protection. If protection is ever added, required checks reference job names and ids, so rename jobs before configuring it.
- `context/archive/2026-08-15-solver-deploy-lane/research.md:231` — re-verified: no branch protection and no rulesets ("a fact about repo settings, which can change without a commit"). The same reasoning applies to `default_workflow_permissions`, which is exactly why the explicit block is worth having.
- `context/foundation/health-check.md:120-122, 264-272` — no scheduled dependency scanning, "acceptable at this scale". Fix 6 (optional, low severity) proposes `.github/dependabot.yml` for npm and pip; it does not mention `github-actions`.
- `context/foundation/infrastructure.md:71` — the Cloudflare deploy token is scoped narrowly (`Workers Scripts: Edit`, later + `Containers: Edit`). This is least privilege already applied to the *Cloudflare* token, but never to the GitHub one.
- No prior change recorded any decision on workflow `permissions`, `GITHUB_TOKEN` scope, `persist-credentials`, zizmor, OSSF Scorecard or CodeQL. Code scanning default setup was enabled on 2026-10-08 (its `updated_at` is 12:42Z; the first analysis ran at 12:40Z), and these alerts are its first output.

## Related Research

- `context/archive/2026-06-18-ci-piepline-cleanup/research.md` — the CI pipeline restructure; action-version and pinning survey.
- `context/archive/2026-08-15-solver-deploy-lane/research.md` — the deploy lane, Cloudflare token scopes, repo-settings verification.
- `context/foundation/health-check.md` — the dependency audit and the Dependabot recommendation.

## Open Questions

1. **Option A vs B.** The recommendation is A (a single workflow-level `contents: read`). B is only worth it if the project wants new jobs to start with zero scopes.
2. **Bundle adjacent hardening or not?** Candidates:
   - §7.2 `persist-credentials: false`
   - §7.3 passing the input through `env:`
   - §7.1 SHA pinning with Dependabot `github-actions`, which a prior change explicitly deferred.

   Suggested: fix the five alerts, and optionally fold in §7.3 (one line, pure hygiene). Leave §7.1 deferred unless the security-extended suite is turned on.
3. **Turn on the security-extended suite?** It would immediately surface `actions/unpinned-tag` ×6, and medium-severity variants of the injection queries for `actions`, `javascript-typescript` and `python`. That is a scope decision, not part of this fix.
4. **UNVERIFIED** (none of these changes the recommendation):
   - The exact per-scope table of the restricted default; current GitHub docs no longer show the old table.
   - Whether `metadata: read` is always granted.
   - Whether `actions/checkout` works under `permissions: {}` on a public repo.
   - Whether an alert page's "Development" section links a fixing PR when PR analysis is diff-filtered.
