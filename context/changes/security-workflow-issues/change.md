---
change_id: security-workflow-issues
title: Security workflow issues
status: implementing
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
- **Phase 3 input:** `supabase/setup-cli` is a composite action that itself runs `oven-sh/setup-bun`, which it already pins by full SHA (`0c5077e…`). A nested remote action therefore should not trip `sha_pinning_required`, but the post-flip dispatch run is still the proof.
