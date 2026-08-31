---
change_id: generation-deletion-integrity
title: Deleting a plan must not corrupt its generation job's state
status: plan_reviewed
created: 2026-08-31
updated: 2026-08-31
archived_at: null
---

## Notes

Split out of `extract-share-polling-store` on 2026-08-31, where the defect was found and confirmed.
That change keeps the F6 polling-store factory and the provenance-note acknowledgement; this one
owns the deletion-aftermath defects, which share no code with either.

Two defects, same class — a plan delete leaves `generation_jobs` in a state the UI then misreports:

- **D2** (confirmed on the local stack): deleting a **delivered proposal** flips its `succeeded` job
  to `failed`, and the source plan shows a generation failure for a solve that worked.
- **The stranded orphan**: deleting a **source** whose job is stale-`running` leaves the clone
  `pending_proposal = true` with no job row — a permanent "still being generated" page.

See `research.md`. Both are unrecorded in `context/` and neither is owned by a roadmap slice.
