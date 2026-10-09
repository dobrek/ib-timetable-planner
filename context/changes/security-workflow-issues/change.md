---
change_id: security-workflow-issues
title: Security workflow issues
status: implemented
created: 2026-10-09
updated: 2026-10-09
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

https://github.com/dobrek/ib-timetable-planner/security/code-scanning/6
https://github.com/dobrek/ib-timetable-planner/security/code-scanning/5
https://github.com/dobrek/ib-timetable-planner/security/code-scanning/3
https://github.com/dobrek/ib-timetable-planner/security/code-scanning/2
https://github.com/dobrek/ib-timetable-planner/security/code-scanning/1

### Implementation evidence (for the Manual Progress rows)

- **PR:** https://github.com/dobrek/ib-timetable-planner/pull/136 (draft)
- **1.8, Phase 1 commit `4dc637f`, run 37915396549:** all four test jobs (`verify` 113770212837, `integration` 113770212488, `e2e` 113770212981, `solver` 113770212909) list exactly `Contents: read` + `Metadata: read` under `GITHUB_TOKEN Permissions`, and every checkout logs `persist-credentials: false`. `deploy` was skipped (PR event).
- **2.10, re-resolution at implement time (2026-10-09):** `git ls-remote` returned the same seven commits as the plan's Key Discoveries table, so no pin moved. The same run independently logged CI downloading each floating ref at the commit pinned in Phase 2: `actions/checkout@v6` (SHA `d23441a…`), `pnpm/action-setup@v6.1.0` (`ea17c68…`), `actions/setup-node@v6` (`2499707…`), `astral-sh/setup-uv@v9.0.0` (`c771a70…`), `supabase/setup-cli@v2` (`afb1b15…`).
- **2.9, Phase 2 commit `97d6b42`, run 37919261296:** all four test jobs passed, and `deploy` was skipped. Every `Download action repository` line names a 40-hex ref, with no tag refs left: `checkout@d23441a…`, `setup-node@2499707…`, `pnpm/action-setup@ea17c68…`, `setup-uv@c771a70…`, `setup-cli@afb1b15…`, `upload-artifact@cf430e0…`, plus setup-cli's own nested `oven-sh/setup-bun@0c5077e…`. The token block is again only `Contents: read` + `Metadata: read`. `wrangler-action@953926a…` runs only in `deploy`, so before merge its pin is proven by `git ls-remote` alone (2.4). GitHub's own `.github/dependabot.yml` validation check passed on the PR.
- **Phase 3 input:** `supabase/setup-cli` is a composite action that itself runs `oven-sh/setup-bun`, which it already pins by full SHA (`0c5077e…`). A nested remote action therefore should not trip `sha_pinning_required`, but the post-flip dispatch run is still the proof.

### Phase 3 outcomes (2026-10-09)

- **Merge (3.6):** PR #136 squash-merged as `6eb1569` at 11:07:38Z. The user confirmed no production solve was running before the merge.
- **Post-merge run 37921817327 (3.1, 3.7):** `success`, all five jobs, `deploy` included. Each job, `deploy` included, lists exactly `Contents: read` + `Metadata: read` under `GITHUB_TOKEN Permissions`. `deploy` downloaded `cloudflare/wrangler-action@953926a…`, the first live exercise of that pin.
- **Alerts (3.2, 3.3):** the `main` CodeQL analyses of `6eb1569` (1922697302 `actions`, 1922698592 `python`, 1922699933 `javascript-typescript`, 11:08Z) moved #1, #2, #3, #5 and #6 to `fixed` at 11:08:21Z. Zero code-scanning alerts of any rule are open, so the read-only block opened none.
- **Dependabot first run (3.8):** two `Dependabot Updates` runs (37921827927, 37921834413) succeeded at 11:07Z, with no config error, and opened one PR per pending major, from both directory sets:
  - #137 `actions/checkout` 6.1.0 → 7.0.1 (`/`)
  - #138 `astral-sh/setup-uv` 9.0.0 → 10.2.0 (`/`)
  - #139 `actions/setup-node` 6.5.0 → 7.0.0 (`/.github/actions/setup`). The plan expected 7.1.0; v7.1.0 was published 2026-10-08, a day before this run, so expect a later run to move the PR.
  - #140 `supabase/setup-cli` 2.1.2 → 3.0.1 (`/.github/actions/supabase-stack`)

  There is no minor/patch group PR: nothing below a major was pending. Titles read `chore(deps): bump …`, as configured. **Each is a separate review, and each merge deploys, so merge only with no solve running.**
- **`sha_pinning_required` (3.4):** before, `{"enabled":true,"allowed_actions":"all","sha_pinning_required":false}`. `PUT {"enabled": true, "allowed_actions": "all", "sha_pinning_required": true}` at 11:18:01Z, and the read-back is `true`.
- **Post-flip proof (3.5, 3.9). Enforcement blocked nothing, so no rollback:**
  - **CI:** `workflow_dispatch` run 37922894079 on `main` → `success`. All four test jobs passed and `deploy` was skipped. That run exercised both local composite actions and setup-cli's nested `oven-sh/setup-bun@<sha>`, so local `./.github/actions/*` refs and SHA-pinned nested actions both pass the policy.
  - **CodeQL:** default setup **skips Dependabot PRs** (the `CodeQL` check reads `skipping` on #137), and GitHub refuses to re-run its own CodeQL and Dependabot runs ("This workflow run cannot be retried"). The post-flip analysis came from close-out PR #141: analyses 1922769329 `actions` (11:22:32Z), 1922770111 `python` and 1922770266 `javascript-typescript`, all with no error. All of #141's CI also passed under enforcement.
  - **Dependabot:** `@dependabot recreate` on #140 at 11:19:18Z → `Dependabot Updates` run 37923005874 at 11:19:24Z → `success`. It force-pushed #140 to `f79a017` at 11:19:57Z.
