---
change_id: job-aware-container-lifecycle
title: Job-aware container lifecycle
status: plan_reviewed
created: 2026-08-20
updated: 2026-08-24
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Roadmap slice **S-304** (`context/foundation/roadmap.md:152-179`), PRD **FR-311**. Prerequisites S-302 + S-303 are both `done`, so the slice is unblocked.
- Feasibility research: `research.md` (2026-08-20). Verdict **feasible**; the schema, grants, contract enum and stop seam were all pre-paid by F-301 and S-303, and the one API the design turns on (`renewActivityTimeout()`) exists in the installed SDK.
- Two roadmap/PRD claims were falsified during research and need truing up as part of this change — see research.md § "Corrections owed to in-repo prose".
