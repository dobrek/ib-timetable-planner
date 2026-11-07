# Created-by and Job Ownership (S-407) — Plan Brief

> Full plan: `context/changes/created-by-and-job-ownership/plan.md`
> Research: `context/changes/created-by-and-job-ownership/research.md`

## What & Why

With several authors and an admin, people need to see who made each plan and proposal (FR-415). The other half is Stop: one author can stop another's long solve, up to 38 minutes of compute, so Stop must belong to the person who pressed Generate, or an admin (FR-416). Plans and jobs from before the change show "Unknown", and those jobs stay stoppable by any author. Generation itself must keep working end to end (FR-417).

## Starting Point

- **No person is recorded on a plan or a job.** Every editor sees Stop, and the copy says "You stopped this generation" to all of them.
- **The groundwork exists:**
  - names and emails are readable to every role holder (S-403, S-406);
  - `profileLabel` was parked in `shared/ui` for this slice;
  - every human insert (new plan, `clone_plan`, the job insert) runs under the user's own session.

## Desired End State

- The plans list has a "Created by" column, and the board header names the plan's creator. Each shows the name with the email beneath, "Unknown", or a service-account badge.
- The pending proposal page shows "Requested by".
- Only the requester or an admin sees Stop, and the database refuses anyone else.
- Stop copy reads "You stopped…", "Stopped by <name> (<email>)…", or a neutral line.
- Deleting a user clears their credit and nothing else.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Stop enforcement | INVOKER guard trigger on `generation_jobs` | RLS can't see column transitions, and a policy would break delivery or the four-policy pin; a trigger gives real, matrix-testable enforcement | Research → Plan (user) |
| Admin's power to stop | New `stop_any_job` capability (`private.can_stop_any_job()`), admin only | Policies name capabilities, never roles; reusing `manage_users` would tie job control to user admin | Research → Plan |
| Null meaning | One null: "Unknown" and "any author may stop", for both legacy and deleted users; revisit at S-411 | No extra schema, and an orphaned job stays stoppable (the safe direction) | Plan (user) |
| Stop copy | Record `stop_requested_by` (first stopper wins) and name the stopper | Answers "who stopped my job?" once an admin can stop others' jobs | Plan (user) |
| Surfaces | Plans list, board header, pending page ("Requested by") | Every place a plan is identified; the pending line makes the Stop rule legible | Plan (user) |
| Duplicates | Credited to whoever duplicated | `default auth.uid()`, so no `clone_plan` change, and one rule: who made this row | Plan (user) |
| Demoted requester | Loses Stop; an admin can still stop | Follows the PRD table and the existing RLS UPDATE policy | Plan (user) |
| `plans.created_by` integrity | No trigger, accepted risk recorded | Only a label; no app path writes it; no browser reaches PostgREST | Plan |
| Guard scope | Acts only on `current_user = 'authenticated'` | Service role keeps explicit ids; the solver is untouched; the FK cascade runs as the owner and passes | Plan |

## Scope

**In scope:**
- three nullable FK columns, with defaults and indexes;
- the re-declared `plans_updated_at`;
- the guard trigger and the capability helper;
- role-matrix cells written red first, and an attribution integration suite;
- the `entities/user` slice;
- the three display surfaces;
- the `canStopJob` gating and the stopper copy;
- the e2e assertions;
- CLAUDE.md, README and roadmap notes.

**Out of scope:**
- the comparison page, perspective views and exports;
- a "Deleted user" label;
- a backfill;
- per-plan ownership;
- any viewer stop path;
- any solver or contract change;
- closing the direct fail/delete gap on others' jobs (accepted).

## Architecture / Approach

The database holds the truth.

- **Defaults** (`created_by`, `requested_by` = `auth.uid()`) credit the creator and the requester, with no write-code changes.
- **One guard trigger** acts for signed-in callers only. It stamps the requester on insert, pins `requested_by` and `stop_requested_by`, and refuses a stop write unless the caller is the requester or holds `stop_any_job`, or the job has no requester. It records the first stopper.
- **The app:**
  - mirrors the capability;
  - carries `requestedBy` and `stoppedBy` on the job view;
  - decides Stop visibility and stop copy in pure `model/` functions, fed by the route's `viewerId` and `canStopAnyJob`;
  - names people through `entities/user` (a batched directory and profile lookup, plus one `UserCredit` component).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database and access spec | Red-first role-matrix cells; the migration; types; the attribution suite | The guard's check order, or the cascade path; proven by tests, not assumed |
| 2. `entities/user` and "Created by" | The slice extraction; the hub column and the board header | Island-safe barrel; steiger import rules |
| 3. Stop ownership in the app | The capability mirror; view fields; gated Stop; "Requested by"; stopper copy; FORBIDDEN mapping | Copy drift between the pending page and the status strip |
| 4. E2E, FR-417 and docs | Email-based e2e assertions; generation re-proven; docs in line | E2E needs the solver up; the shared author is renamed mid-run |

**Prerequisites:** S-406 done (it is). The local Supabase stack, and `mise run solver:dev` for Phases 3 and 4.
**Estimated effort:** about 3 to 4 sessions across 4 phases.

## Open Risks & Assumptions

- **Cascade identity is assumed.** An FK set-null running as the table owner is recorded in S-406's migration; the attribution suite re-proves it for `generation_jobs` and `plans`.
- **The direct-write gap is accepted.** Any author can still fail or delete another's job by a direct write; only server actions write.
- **"Unknown" conflates legacy and deleted users** until S-411 decides otherwise.

## Success Criteria (Summary)

- Every user sees who created each plan and proposal, with the email beside the name.
- Only the requester or an admin can stop a running job. Legacy jobs stay stoppable by any author, and nobody is told "You stopped" for someone else's act.
- Generate → solve → proposal → delivery still works end to end, and deleting a person never touches a timetable.
