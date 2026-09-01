# Review follow-ups — extract-share-polling-store

Queued from `reviews/impl-review.md` (2026-09-01). Not part of this change's PR.

## F1 — Rekey the hub poll snapshot by jobId

- **Where**: `src/_pages/plans-list/model/job-progress-store.ts` (`indexByPlan`, `sameIndicators`,
  `rememberedJobIds`) and `src/_pages/plans-list/model/row-indicators.ts` (`indicatorsForRow`).
- **Why**: the snapshot is keyed by source `planId` — at most one indicator per source plan. The
  server's uniqueness guard (`generation-job.ts:183`) only blocks concurrent *active* jobs, so a
  terminal-undelivered "Ready" job plus a newly started running job on the same source is legal
  server state; the Map keeps only the last row and the "Ready" badge is lost for the whole second
  run. Pre-dates the eviction change; replace semantics make the collapse permanent rather than
  transient (under the old union-merge it self-healed once the second job went terminal).
- **Do**: key the snapshot by `jobId` and decide the per-row display policy first — a row can then
  carry two indicators (e.g. Ready for proposal P1 + Generating for P2), and today's UI renders one
  badge per row. `indicatorsForRow` becomes the single place that policy lives. Adjust
  `sameIndicators` and the affected hub-suite cases with it.
- **Trigger**: an author regenerating a plan before opening the previous run's proposal.
