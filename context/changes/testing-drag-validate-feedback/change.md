---
change_id: testing-drag-validate-feedback
title: Test the drag → validate → feedback loop and persistence reload-restore
status: planned
created: 2026-06-23
updated: 2026-06-23
archived_at: null
---

## Notes

Open a change folder for rollout Phase 3 of context/foundation/test-plan.md: "Drag → validate → feedback loop + persistence reload-restore".
Risks covered: #2 (the drag → action → grid feedback loop renders the wrong verdict — optimistic UI keeps showing "valid" after the server returns invalid), #4 (placed work is lost — a placement does not survive reload/crash).
Test types planned: component / integration (planner island); persistence integration; ≤1 e2e.
Risk response intent:
- Risk #2: prove a server "invalid" verdict visibly renders as invalid in the grid (and an accepted drop renders valid), with optimistic UI state reconciling to the server response — "the API returned invalid" is not the same as "the user saw invalid".
- Risk #4: prove that after a reload the grid restores exactly the placed state — "the write returned 200" is not the same as "the work is durable".
After creating the folder, follow the downstream continuation rule.
