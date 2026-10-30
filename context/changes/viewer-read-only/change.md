---
change_id: viewer-read-only
title: S-405 viewer role: read every plan and proposal, no edit affordances
status: planned
created: 2026-10-30
updated: 2026-10-30
archived_at: null
---

## Notes

as S-405 from @context/foundation/roadmap.md

## Decisions

- **2026-10-30: Open Question 1 is (a), wait for an author.** A viewer's visit never delivers or writes. A finished, undelivered proposal shows as finished and waiting for an author, and its board appears once an author or admin opens it. Accepted cost: until then, that proposal's board, comparison and perspective views are closed to a viewer, so FR-409's "every proposal" means every delivered one. No migration, no RLS change, no new DEFINER function. Recorded in PRD Open Question 1 and the roadmap (S-405 is no longer blocked). Research: `research.md` §5 and its follow-up.
