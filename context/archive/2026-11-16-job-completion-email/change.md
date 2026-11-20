---
change_id: job-completion-email
title: Job-completion email (S-310)
status: archived
created: 2026-11-16
updated: 2026-11-20
archived_at: 2026-11-20T22:10:05Z
---

## Notes

Roadmap slice **S-310** (`context/foundation/roadmap.md`, M-02, carried from M-01), issue [#107](https://github.com/dobrek/ib-timetable-planner/issues/107). Traces to FR-309 of the archived CP-SAT PRD (`context/foundation/archive/2026-10-10-prd.md`) and the PRD's §NFG (no student data). Prerequisites S-402 (sending provider and domain) and S-407 (`generation_jobs.requested_by` as the recipient) are both done.

Outcome: an author is notified of job completion with the result information by email as well as in-app, so "kick it off and walk away" works for a long solve; the email carries no student data.

Open unknown carried from the roadmap: nothing today notices a completed job without a browser tab open, and the Worker's only database client is bound to a request's cookies. Under fail-closed roles the notifier also needs its own narrow read identity, never the secret key in the Worker.
