---
change_id: fail-closed-roles
title: S-403 fail-closed roles: authors keep access, role-less users see no access
status: implementing
created: 2026-10-28
updated: 2026-10-28
archived_at: null
---

## Notes

as taks S-403 from roadmap

## Implementation decisions

- **2026-10-28 — the access model lives in `src/shared/config/`, not `src/shared/lib/access/`.** `src/shared/lib/` already holds 15 top-level modules, and steiger's `fsd/shared-lib-grouping` (threshold 15, a CI gate under `--fail-on-warnings`) fails at 16. The `extract-share-polling-store` precedent says to surface this rather than regroup drive-by, and relaxing the gate is out. `shared/config/cohorts.ts` is the precedent for a generated-enum projection with small pure helpers beside it, and `nav.ts`, which Phase 4 makes capability-aware, already lives there. So `AppRole` (Phase 1) and Phase 4's `capability.ts`, `access-state.ts`, `resolve-access.ts` and `role-gate.ts` are flat files in `shared/config/`, exported through `@/shared/config`. Only the location changes; the plan's contracts stand.
