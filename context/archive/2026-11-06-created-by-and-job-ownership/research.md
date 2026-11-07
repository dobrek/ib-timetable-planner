---
date: 2026-11-06T15:41:03+01:00
researcher: Claude (Opus 5.5) for Dobromir Kropielnicki
git_commit: b0a7277db6616ca4c02a9807ed3bbea6043c7dd4
branch: s-407-created-by-on-plans-and-proposals-stop-lim
repository: dobrek/ib-timetable-planner
topic: "S-407 created-by and job ownership: feasibility, challenges, options"
tags: [research, codebase, attribution, generation-jobs, stop-and-keep, rls, triggers, role-matrix, entities-user, plans-list]
status: complete
last_updated: 2026-11-06
last_updated_by: Claude (Opus 5.5)
---

# Research: S-407 created-by and job ownership: feasibility, challenges, options

**Date**: 2026-11-06T15:41:03+01:00
**Researcher**: Claude (Opus 5.5) for Dobromir Kropielnicki
**Git Commit**: b0a7277db6616ca4c02a9807ed3bbea6043c7dd4
**Branch**: s-407-created-by-on-plans-and-proposals-stop-lim
**Repository**: dobrek/ib-timetable-planner

## Research Question

Check the feasibility of implementing S-407 (`created-by-and-job-ownership`), name the challenges we could face, and show the options we have to address them.

The slice, as the roadmap states it ([`context/foundation/roadmap.md:217`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/foundation/roadmap.md#L217)):

> Any user can see who created each plan and proposal — a proposal is credited to whoever pressed Generate, and plans that predate the change show "unknown" — and a running generation job can be stopped only by the person who requested it or an admin; jobs that predate the change stay stoppable by any author.

Its PRD refs are FR-415, FR-416 and FR-417 ([`context/foundation/prd.md:236`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/foundation/prd.md#L236), `:252-260`), plus FR-413's rule that the email always shows beside the display name (`:230`).

## Summary

**Feasible, with no blocker and no unknown that needs a probe.** It needs no secret key, no new SECURITY DEFINER function, no solver change and no wire-contract change. Most of the groundwork exists already:

- **Reading names is already allowed.** Any author or viewer can read every human user's display name (`profiles`) and email (`user_directory`). S-403 and S-406 built it that way for this slice ([`supabase/migrations/20261028200630_fail_closed_policies.sql:131-133`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261028200630_fail_closed_policies.sql#L131-L133), [`supabase/migrations/20261105073614_user_directory.sql:74-76`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261105073614_user_directory.sql#L74-L76)). No read policy changes.
- **The creator fills itself in.** Every plan row a human creates goes through one of two inserts, and both list their columns explicitly. Those are `create-plan.ts` and the INVOKER `clone_plan`, which the Generate flow also calls under the presser's session. A column `created_by uuid default auth.uid()` therefore credits a new plan, a duplicate and a proposal correctly, with no change to `clone_plan`. Service-role writers (the seed and test factories) get null, which shows as "unknown".
- **The requester also fills itself in.** The job row is a plain insert under the same cookie-bound session ([`src/_pages/plan-detail/api/generation-job.ts:181-196`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/api/generation-job.ts#L181-L196)), so `requested_by default auth.uid()` fills it too.
- **Teardown is ready.** Integration teardown already deletes plans before users, because S-407's `created_by` will be set to null ([`src/test/factories/teardown.ts:29-31`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/test/factories/teardown.ts#L29-L31)).

**The real work is three design decisions, not technology.**

1. **How "only the requester or an admin may stop" is enforced** (Challenge 1). Stop is two plain UPDATEs on `generation_jobs`. The same UPDATE policy also governs delivery, stale-job reclaim and `notified_at`, and those must stay open to any author. RLS cannot tell "this UPDATE sets the stop flag" from any other UPDATE, so a policy cannot express the rule without breaking delivery. The candidates are a guard trigger (recommended) or an app-only check.
2. **What null means** (Challenge 3). With `on delete set null`, a null creator or requester means either "predates the change" or "that person was deleted". The PRD gives those cases different meanings, and a single nullable column cannot keep them apart.
3. **How strongly to protect the attribution columns themselves** (Challenge 4). Any author can write any column today. That is cosmetic for `plans.created_by`, but for `generation_jobs.requested_by` it decides who may stop a job.

Smaller issues:

- Deleting a person would change "Last updated" on every plan they created (Challenge 5).
- The pending page's "You stopped this generation" copy becomes wrong with several authors (Challenge 6).
- The deferred `entities/user` extraction becomes due (Challenge 7).
- The usual migration care applies (Challenge 9).

Estimated size: a medium slice, three to four phases. One is a migration with its role-matrix cells written red first. One is stop enforcement and the Stop UI. One is the `entities/user` extraction plus "Created by" on the plans list, the plan header and the pending page. The last is tests.

## Detailed Findings

### 1. What already exists and can be reused

**Read access to other people's names and emails is already in place.**

- `profiles`: `user_id = auth.uid() or private.can_read()` ([`supabase/migrations/20261028200630_fail_closed_policies.sql:131-133`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261028200630_fail_closed_policies.sql#L131-L133)).
- `user_directory`: `not is_machine and (user_id = auth.uid() or private.can_read())` ([`supabase/migrations/20261105073614_user_directory.sql:74-76`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261105073614_user_directory.sql#L74-L76)).
- `private.can_read()` means "holds any role", so viewers are included ([`supabase/migrations/20261028140939_user_roles.sql:104-111`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261028140939_user_roles.sql#L104-L111)).
- The role matrix already pins "others' rows readable" for viewer and author ([`src/test/role-matrix-expectations.ts:147-154`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/test/role-matrix-expectations.ts#L147-L154)).
- S-406 chose this so that S-407's non-admin readers could see who created what ([`context/archive/2026-11-03-users-page-roles/research.md:85`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/archive/2026-11-03-users-page-roles/research.md#L85)). Machine users stay hidden from everyone.

**The label helper and the lookup pattern exist.**

- `profileLabel` was moved to [`src/shared/ui/profile-label.ts:12-14`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/shared/ui/profile-label.ts#L12-L14) by S-406 for this slice to reuse ([`context/archive/2026-11-03-users-page-roles/research.md:278`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/archive/2026-11-03-users-page-roles/research.md#L278)).
- The Users page loads `user_directory` and `profiles` in parallel and joins them in code ([`src/_pages/users/api/loader.ts:20-24`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/users/api/loader.ts#L20-L24)). It renders the display name with the email beneath ([`src/_pages/users/ui/UserTable.tsx:62-73`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/users/ui/UserTable.tsx#L62-L73)). That is the FR-413 shape "Created by" needs.

**`clone_plan` copies no columns generically.**

- It is INVOKER and inserts an explicit `(name, slot_grid_preset)` list ([`supabase/migrations/20260711174905_clone_plan_include_board.sql:17-31`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20260711174905_clone_plan_include_board.sql#L17-L31)).
- S-404 relied on the same fact to add `is_current` without touching it ([`context/archive/2026-10-29-current-plan-marker/plan.md:16`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/archive/2026-10-29-current-plan-marker/plan.md#L16)).

**Teardown order is already right.** [`src/test/factories/teardown.ts:29-31`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/test/factories/teardown.ts#L29-L31).

### 2. Recording the creator: `plans.created_by`

- **The table is `public.plans`.**
  - `plan_variants` was dropped in June.
  - Today the table has no user column and no foreign key to `auth.users`.
  - Its policies are the four standard capability policies ([`supabase/migrations/20261028200630_fail_closed_policies.sql:72-91`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261028200630_fail_closed_policies.sql#L72-L91)).
  - Its one non-FK trigger is `plans_updated_at`, which S-404 narrowed with `WHEN (old.is_current is not distinct from new.is_current)` ([`supabase/migrations/20261029143936_current_plan_marker.sql:66-70`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261029143936_current_plan_marker.sql#L66-L70)).
- **Creation paths.** Only two inserts exist, both under the signed-in user's cookie session:
  - **New plan:** [`src/_pages/plans-list/api/create-plan.ts:9`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plans-list/api/create-plan.ts#L9).
  - **Duplicate:** `clone-plan-guarded.ts` → `src/shared/api/clone-plan.ts` → the `clone_plan` RPC.
  - **Generate:** calls the same `clonePlan` ([`src/_pages/plan-detail/api/generation-job.ts:153`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/api/generation-job.ts#L153)), then `markPending` updates that row (`:163-168`).
  - **Delivery inserts nothing.** It clears `pending_proposal` on the same row, so the proposal keeps its creator after delivery. The solver's role holds no privilege on `plans`.
- **Proposed column.** `created_by uuid null default auth.uid() references auth.users (id) on delete set null`, plus an index.
  - The milestone research already proposed exactly this ([`context/changes/user-managment-research/research.md:545-547`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/changes/user-managment-research/research.md#L545-L547)).
  - The precedent is `profiles.user_id default auth.uid()` ([`supabase/migrations/20261017170524_profiles.sql:27`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261017170524_profiles.sql#L27)), chosen because it also works inside INVOKER RPCs ([`context/archive/2026-10-16-account-self-service/plan.md:551`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/archive/2026-10-16-account-self-service/plan.md#L551)).
  - It cannot be NOT NULL: hosted rows, the seed and service-role factories have no user.
- **Who gets credited:**
  - A proposal is credited to whoever pressed Generate, whoever later delivers it (FR-417).
  - A duplicate is credited to whoever duplicated it, not to the source plan's creator. The PRD does not address duplicates; this is the default and needs recording (Open Questions).

### 3. Recording the requester: `generation_jobs.requested_by`

- **Schema.** [`supabase/migrations/20260810200122_generation_jobs.sql:57-98`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20260810200122_generation_jobs.sql#L57-L98).
  - `plan_id` cascades on delete; `proposal_plan_id` and `delivered_plan_id` are set to null.
  - At most one active job per plan.
  - A `moddatetime` trigger maintains `updated_at` (`:112-114`). The app does not read `updated_at`; staleness uses `heartbeat_at`.
- **The insert.** `insertJob` is a plain `.insert` under the user's session ([`src/_pages/plan-detail/api/generation-job.ts:181-196`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/api/generation-job.ts#L181-L196)), so `requested_by default auth.uid()` fills itself. The proposal clone and the job are written by the same session, so the proposal's `created_by` and the job's `requested_by` are always the same person.
- **The solver is unaffected.**
  - `solver_job_writer` reads and writes only the columns it has an explicit grant for ([`supabase/migrations/20260810200931_solver_job_writer_role.sql:62-74`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20260810200931_solver_job_writer_role.sql#L62-L74)).
  - A new column with no grant is neither readable nor writable by it, and the exact-list column pins stay as they are. The stop-and-keep research also requires the solver never to update `stop_requested_at` ([`context/archive/2026-09-01-stop-and-keep/research.md:110-121`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/archive/2026-09-01-stop-and-keep/research.md#L110-L121)).
  - The wire request is `{formatVersion, snapshot, policy}`, so `contracts/` is untouched.
- **Alternative considered: derive the requester from the proposal's `created_by`** through `proposal_plan_id`, instead of adding a column.
  - It works for live jobs: a plan with a live job cannot be deleted ([`pending-guards.ts:74-91`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plans-list/api/pending-guards.ts#L74-L91)), so a live job always has its proposal.
  - Legacy jobs' proposals have a null creator, so they fall out as "any author", as the PRD wants.
  - Rejected: it couples job ownership to a plan label. The guard check would need a lookup. And S-310 wants the requester as a first-class fact. The PRD also says "a job has to record who requested it" ([`context/foundation/prd.md:255`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/foundation/prd.md#L255)).

### 4. The Stop path, and why plain RLS cannot gate it

**How Stop works today (S-305).**

- **Button:** `StopAndKeep` on the pending proposal page only, rendered when `canEdit` ([`src/_pages/plan-detail/ui/PendingProposalPage.tsx:151-155`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/ui/PendingProposalPage.tsx#L151-L155)). The source plan's status strip shows progress but has no Stop ([`src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx:53-54`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx#L53-L54)).
- **Action:** default `requires: edit` ([`src/_pages/plan-detail/api/generation-actions.ts:38`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/api/generation-actions.ts#L38)).
- **Domain function:** `stopGeneration` ([`src/_pages/plan-detail/api/generation-stop.ts:54-60`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/api/generation-stop.ts#L54-L60)) makes two writes:
  - `terminaliseQueued` is a compare-and-set from `queued` to `stopped` that also stamps `stop_requested_at` (`:72-91`).
  - `requestStop` sets only `stop_requested_at` on a `running` row (`:104-115`). The solver sees it on its next heartbeat.
  - Zero matched rows is read as "already finished".

**Other human writes to the same rows, which must stay open to any author.**

- Stale-job reclaim to `interrupted` ([`src/_pages/plan-detail/api/generation-reclaim.ts:49-69`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/api/generation-reclaim.ts#L49-L69)), from `checkPlan` and from a Generate conflict.
- Delivery: `markNotified`, `markDelivered` and `failJob` ([`src/_pages/plan-detail/api/generation-delivery.ts:130-133`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/api/generation-delivery.ts#L130-L133), `:422-447`).
- Marking a failed dispatch, which only touches the caller's own new row.
- If any of these were limited to the requester, a requester who walked away would leave the job wedged. Delivery deliberately stays with any author or admin (PRD Open Question 1, decided 2026-10-30, [`context/foundation/prd.md:396-403`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/foundation/prd.md#L396-L403)).

**The policy posture.**

- After S-403 every plan-scoped table has exactly four policies. UPDATE reaches a row by `can_read` and checks it by `can_edit` ([`src/test/role-matrix-expectations.ts:368-373`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/test/role-matrix-expectations.ts#L368-L373)).
- The structural catalog test fails if any plan-scoped table has a fifth policy or a changed one ([`src/test/role-matrix.integration.test.ts:234-239`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/test/role-matrix.integration.test.ts#L234-L239)).
- RLS checks rows, not columns, and it cannot see the old row. So it cannot express "this UPDATE sets `stop_requested_at`".

### 5. Displaying "Created by"

Every page loads its data in Astro frontmatter with the server client, so one more batched lookup fits everywhere.

| Surface | Data today | Render today |
| --- | --- | --- |
| Plans list | [`src/_pages/plans-list/api/loader.ts:47-55`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plans-list/api/loader.ts#L47-L55) (type `:18-29`) | [`src/_pages/plans-list/ui/PlansHub.tsx:151-180`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plans-list/ui/PlansHub.tsx#L151-L180); S-404's current marker sits in the name cell |
| Plan detail header | `loadPlanSummary` ([`src/shared/api/load-plan-summary.ts:50-52`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/shared/api/load-plan-summary.ts#L50-L52)), used by [`src/pages/plans/[id]/index.astro:52`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/pages/plans/[id]/index.astro#L52) | [`BoardHeader.tsx:24-25`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/ui/chrome/BoardHeader.tsx#L24-L25); S-404 passed `isCurrent` down [`PlannerBoard.tsx:262,311,339`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/ui/PlannerBoard.tsx#L262), and the same route works for a creator |
| Pending proposal page | Route props at [`src/pages/plans/[id]/index.astro:143-150`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/pages/plans/[id]/index.astro#L143-L150) | [`PendingProposalPage.tsx:55-56`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/ui/PendingProposalPage.tsx#L55-L56); the creator here is the requester |
| Comparison page | [`load-plan-analysis.ts:140`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-comparison/api/load-plan-analysis.ts#L140) | [`PlanComparisonPage.tsx:129-131`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-comparison/ui/PlanComparisonPage.tsx#L129-L131) |
| Teacher/student views, xlsx and print exports | loaders at [`teacher-plan-view/api/loader.ts:93`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/teacher-plan-view/api/loader.ts#L93), [`student-plan-view/api/loader.ts:84`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/student-plan-view/api/loader.ts#L84) | Out of scope: exports carry plan metadata only in the file name |

PostgREST cannot embed `auth.users`. So the lookup is a batched `.in("user_id", ids)` over `user_directory` and `profiles`, joined in code, as the Users page already does.

### 6. Tests that exist and what they cover

- **Role matrix.** `generation_jobs` UPDATE is allowed for author and admin ([`src/test/role-matrix-expectations.ts:195-199`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/test/role-matrix-expectations.ts#L195-L199)). The probe edits `error` on a finished job created by the service role ([`src/test/role-matrix.integration.test.ts:757-764`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/test/role-matrix.integration.test.ts#L757-L764)), so that job has no requester. The matrix can already express "own row vs someone else's" through `RowOwner` ([`src/test/role-matrix-expectations.ts:207`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/test/role-matrix-expectations.ts#L207)).
- **Catalog pins** fail on any new private helper or trigger function until it is declared: `PRIVATE_FUNCTIONS` and the executors list ([`src/test/role-matrix-expectations.ts:288-300`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/test/role-matrix-expectations.ts#L288-L300), `:607-615`).
- **Stop integration suite** runs as the service role ([`generation-stop.integration.test.ts:30-31`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/api/generation-stop.integration.test.ts#L30-L31)), so it proves behaviour, not ownership.
- **E2E.** The only Stop check is that a viewer does not see the button ([`e2e/specs/generation.viewer.spec.ts:113-114`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/e2e/specs/generation.viewer.spec.ts#L113-L114)). There is one author account, one viewer and one admin.
- **Display e2e.** The plans-list and viewer specs match rows by link or by regex, so adding a "Created by" cell breaks none of them. [`account.spec.ts:35-56`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/e2e/specs/account.spec.ts#L35-L56) renames the shared author while other specs run, so any new assertion must match on the email, not the display name.

## Challenges and Options

### Challenge 1: enforcing "only the requester or an admin may stop"

**Problem.** Stop is an UPDATE of `stop_requested_at` (plus `status` for a queued job). Delivery, reclaim and notification are UPDATEs on the same rows by any editor. RLS sees rows, not column changes, and the four-policy pin forbids a fifth policy.

| Option | How | For | Against |
| --- | --- | --- | --- |
| **A. App-only** | Hide Stop for non-owners; check ownership in `stopGeneration` | Smallest; no migration logic | The database still lets any author stop any job; nothing in the role matrix can pin the rule, against S-403's "RLS is the enforcement" posture. The domain function gets only `(supabase, input)` ([`define-domain-action.ts:22`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/shared/lib/actions/define-domain-action.ts#L22)), so it needs the user id plumbed in or a read of `auth.uid()` |
| **B. Guard trigger** (recommended) | `BEFORE UPDATE OF stop_requested_at, requested_by` on `generation_jobs`, INVOKER, in `private`. It refuses with 42501 when `current_user = 'authenticated'` and the stop flag changes, unless `old.requested_by is null`, `old.requested_by = auth.uid()` or the caller holds the new admin capability. It also pins `requested_by` (Challenge 4) | Real enforcement, testable as role-matrix cells; keeps the four policies; cannot touch delivery or reclaim, because the app's only `stop_requested_at` writes are the two stop updates; zero cost to solver writes (the column list never matches them, and the solver has no grant on those columns) | An identity check inside a trigger is a new kind of rule here (S-406's `guard_last_admin` checks data, not identity, [`supabase/migrations/20261105080343_role_management.sql:139-185`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261105080343_role_management.sql#L139-L185)), so the migration needs a recorded reason, as CLAUDE.md asks for the DEFINER exception. It must skip non-`authenticated` callers, which have no `auth.uid()` (the reason CLAUDE.md forbids gating in RPC bodies) |
| C. Restrictive RLS policy | `with check (stop_requested_at is null or requested_by …)` | Pure RLS | **Breaks delivery.** After a requester stops and keeps a board, another author's delivery UPDATE carries a non-null flag and is refused. It also breaks the four-policy pin. Rejected |
| D. Column grants | Revoke table-wide UPDATE; grant every column except `stop_requested_at`; stop through an RPC | Grant-layer enforcement | An INVOKER RPC still needs the privilege, so this forces a second DEFINER function (a recorded exception). Every future column needs its own grant, and it changes the `GRANTS` pin. Rejected |
| E. Separate stop-request table | `INSERT` into `generation_job_stops` with a policy checking ownership; a trigger mirrors it to the job | Pure RLS on a new table | New table, four-policy question, and a mirror to keep in step; heavier than B for the same result |

**Residual gap, whichever option is chosen.** The standard policies still let any author set `status = 'failed'` on, or delete, someone else's running job. Closing that would mean gating every active-to-terminal change, which collides with reclaim, so it is not worth it. In practice only the app's server-side actions write: the publishable key never reaches the browser. **Recommendation:** B, plus the UI gating in Challenge 6, with this gap written down in the plan as an accepted risk.

**Error mapping.** Under B a refusal comes back as a loud 42501, not zero rows. `stopGeneration` must map it to `FORBIDDEN` (as `clearPending` already does) instead of today's `INTERNAL_SERVER_ERROR`. No new action plumbing is needed.

### Challenge 2: which capability lets an admin stop any job

Policies and helpers name capabilities, never roles. The app map has `session`, `read`, `edit` and `manage_users` ([`src/shared/config/capability.ts:9-21`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/shared/config/capability.ts#L9-L21)).

- **(a) Reuse `can_manage_users()`.** It works today, but it means the wrong thing, and it would couple job control to user administration forever.
- **(b) New INVOKER `private.can_stop_any_job()`, admin only** (recommended). Mirror it as `stop_any_job` in `capability.ts`, and declare it in the role matrix's `PRIVATE_FUNCTIONS` and executors pins, red first. The role → capability map stays in one place.
- **(c) A role check in the trigger.** This violates "policies name capabilities". Rejected.

### Challenge 3: null means two things

With `on delete set null`, null means either "predates S-407" or "the person was deleted". The PRD gives each case a different meaning ([`context/foundation/prd.md:285-286`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/foundation/prd.md#L285-L286), `:327`). S-406 met the same problem for `access_changes` with an `actor_kind` enum beside a nullable `actor_id`, and renders "Deleted user" ([`supabase/migrations/20261105080343_role_management.sql:192-203`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261105080343_role_management.sql#L192-L203)).

**Jobs.** A job whose requester was deleted becomes stoppable by any author.

- **(a) Accept it** (recommended). It is the safe direction: otherwise only an admin could stop an orphaned job, and S-310 has nobody to email anyway. Account deletion arrives only with S-411.
- **(b) A `requester_kind` column.** More schema for no user-visible gain.

**Plans.** Pre-change plans and plans whose creator was deleted both show "Unknown".

- **(a) Accept it now** (recommended) and revisit at S-411, which is the slice that introduces deletion.
- **(b) A `creator_kind` enum** (`'recorded'`, or null for legacy) that lets the UI say "Deleted user". It copies S-406's pattern, but every service-role insert must then decide a kind.
- **(c) A cut-off timestamp** (`created_at` before the deploy → "Unknown", otherwise "Deleted user"). Needs no schema, but plans the service role creates after the cut-off would be mislabelled. Fragile; rejected.

### Challenge 4: protecting the attribution columns

Any author can write any column of `plans` and `generation_jobs` today. Two threats:

- **Insert:** an author writes a false `created_by` or `requested_by`.
- **Update:** an author rewrites `requested_by` to themselves, then stops the job. This one defeats Challenge 1's rule, so for jobs it is not cosmetic.

| Option | For | Against |
| --- | --- | --- |
| **Trigger: stamp on insert, pin on update** (recommended for `generation_jobs`) | On insert, set `new.requested_by := auth.uid()` when the caller is `authenticated`, so service-role factories can still pass explicit ids. On update, refuse a change. It is the same trigger function as Challenge 1 | The pin must let the FK's set-null cascade through. Per CLAUDE.md: a BEFORE trigger, `pg_trigger_depth() > 1` and the `auth.users` row already gone, checked in a nested `IF`, as S-406 does ([`supabase/migrations/20261105080343_role_management.sql:151`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261105080343_role_management.sql#L151)). Without the exemption, deleting a user who requested a job fails |
| `WITH CHECK created_by is not distinct from auth.uid()` on insert, as `access_changes` does ([`supabase/migrations/20261105080343_role_management.sql:223-229`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261105080343_role_management.sql#L223-L229)) | Pure RLS | Breaks the plan-scoped four-policy pin, and `clone_plan`'s insert would also need it to hold (it does, since `auth.uid()` is the caller). Needs a recorded exception in the catalog check |
| Column grants | Grant-layer | Same cost as Challenge 1 option D |
| Accept the risk | Free | Fine for `plans.created_by`, which is a label only and has no app path that writes it. Not acceptable for `requested_by` |

**Recommendation:**

- Enforce on `generation_jobs.requested_by` with the trigger.
- For `plans.created_by`, either accept the risk and record why (cheapest; the label is cosmetic and no app path can write it) or reuse the same stamp-and-pin trigger for symmetry. This is a plan-phase decision.

### Challenge 5: deleting a person would change "Last updated" on their plans

Postgres applies `on delete set null` as an UPDATE on `plans`. That fires `plans_updated_at`, whose `WHEN` clause skips only `is_current` changes ([`supabase/migrations/20261029143936_current_plan_marker.sql:66-70`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261029143936_current_plan_marker.sql#L66-L70)), and the plans list shows `updated_at`.

**Fix:** re-declare the trigger with `create or replace trigger … when (old.is_current is not distinct from new.is_current and old.created_by is not distinct from new.created_by)`, as S-404 did. S-404's warning then extends to `created_by`: never write it together with another column.

`generation_jobs.updated_at` would bump too, but nothing in the app reads it, so it is harmless there.

### Challenge 6: the Stop UI and its copy

**Who sees Stop.**

- The control must be absent, never disabled, for a non-owner (`CLAUDE.md` UI rule), and islands never read the role.
- Today's poll view `GenerationJobView` carries no requester ([`src/_pages/plan-detail/api/generation-read.ts:94-95`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/api/generation-read.ts#L94-L95), `toView` at `:217-237`).
- **Options:**
  - **(a) Route-computed `canStop` boolean.** Simple, because `requested_by` never changes after insert. But if the first job read fails and degrades, it stays false.
  - **(b) Pass the job's `requestedBy` in the view.** The route passes the viewer's id (`Astro.locals.user`, [`src/middleware.ts:48`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/middleware.ts#L48)) and an `allows(access, "stop_any_job")` boolean. A pure function in `model/` then decides from the polled job. Recommended: it follows the orchestration-over-patching convention and survives a degraded first read.

**Copy.**

- "You stopped this generation" is shown to any editor ([`src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx:231-240`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx#L231-L240), [`src/_pages/plan-detail/ui/PendingProposalPage.tsx:196`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/ui/PendingProposalPage.tsx#L196)).
- S-305 left it alone as "moot in a single-author deployment" ([`context/archive/2026-09-01-stop-and-keep/reviews/impl-review.md:92`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/archive/2026-09-01-stop-and-keep/reviews/impl-review.md#L92)). With several authors it is now wrong, and an admin can stop a job for its requester.
- **Options:**
  - **(a) Neutral copy** ("This generation was stopped").
  - **(b) A `stop_requested_by` column**, stamped by the same guard trigger, rendering "Stopped by <name> (<email>)". Recommended if the cost of one more column is acceptable: it also answers "who stopped my job?" when an admin did it.

### Challenge 7: where the name lookup lives (FSD), and what the foreign key points at

**Slice.**

- Page slices may not import each other, and the Users page holds the only lookup today.
- S-406 deferred `entities/user` to this slice as its second consumer ([`context/archive/2026-11-03-users-page-roles/plan.md:114`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/archive/2026-11-03-users-page-roles/plan.md#L114)).
- **Recommended contents** for `src/entities/user/`:
  - `api/load-user-labels.ts`: ids → `Map<id, ProfileLabel>`, from `user_directory` and `profiles`.
  - `model/profile-label.ts`: moved from `shared/ui`.
  - `ui/UserLabel.tsx`: name with email beneath, or "Unknown".
  - `index.ts` as the public API.
- With the users, plans-list, plan-detail and comparison slices consuming it, steiger's `insignificant-slice` rule is satisfied.

**FK target.**

- **`auth.users`** (recommended). Same as `access_changes`. The set-null comes directly from account deletion.
- **`public.user_directory`.** PostgREST could then embed the email, but not the display name (`profiles` references `auth.users`). Plan creation would also fail if the directory mirror ever missed a user.
- **`profiles`.** Impossible: users who never set a name have no row.

### Challenge 8: which surfaces show "Created by"

FR-415 says only "see who created a plan or proposal", and the roadmap lists no unknowns.

- **Minimum** (recommended): the plans list, the plan detail header, and the pending proposal page. On the pending page it reads as "Requested by" and tells other authors whom to ask about stopping.
- **Optional:** the comparison page.
- **Out of scope:** teacher and student views, xlsx and print exports.

The calibration-campaign account shows up as a creator when the campaign runs Generate through the app's actions. The label should use S-406's service-account marker, not look like a person.

### Challenge 9: migration safety and deploy

- **Additive only:** two nullable columns, FKs, indexes, a re-declared trigger, a helper and a guard trigger. Nothing is dropped.
- **Locks.**
  - Adding an FK to `auth.users` takes a SHARE ROW EXCLUSIVE lock on it, which blocks auth writes such as `last_sign_in_at` for the duration.
  - Validation is trivial because every new value is null.
  - Copy S-404's and S-406's `set local lock_timeout = '5s'` ([`supabase/migrations/20261029143936_current_plan_marker.sql:48-52`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261029143936_current_plan_marker.sql#L48-L52)).
- **Indexes.** Index `plans(created_by)` and `generation_jobs(requested_by)` so the set-null cascade does no scan. The project treats the Supabase unindexed-FK advisor as a gate.
- **Order.** CI runs `db push` before `wrangler deploy`. For the gap between them, the old Worker's inserts get the default, so it is safe.
- **Jobs running across the deploy** have a null requester and stay stoppable by any author. That is exactly the PRD's legacy rule.
- **No merge mid-solve.** The standing rule applies (README).
- **Types.** Run `pnpm db:types` after the migration. Explicit column lists that need the new column: [`plans-list/api/loader.ts:48`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plans-list/api/loader.ts#L48), [`load-plan-summary.ts:50`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/shared/api/load-plan-summary.ts#L50), `generation-read.ts` `STATUS_COLUMNS`.

### Challenge 10: proving it

- **Role matrix first, red.** Per CLAUDE.md, the access change starts as a diff to `src/test/role-matrix-expectations.ts`.
  - Add a `JOB_STOPS` table: own job, another's job and a legacy job, for each principal (viewer, author, admin), run through `createSignedInUser`.
  - Add a `requested_by` rewrite cell.
  - Declare the new helper and trigger function in the catalog pins.
- **Integration.**
  - A signed-in author creates, duplicates and generates, and `created_by` / `requested_by` equal their id.
  - Deleting that user nulls the credit, keeps the plan and leaves `updated_at` unchanged (Challenge 5).
  - A second author's stop is refused with FORBIDDEN.
- **E2E.**
  - With a single author account, "another author cannot stop" stays at integration level.
  - In e2e, the admin may stop the author's job. The viewer spec gains one assertion: "Created by" shows the author's email.
- **FR-417 guardrail.** The roadmap names "generation works end to end" as the one to re-prove ([`context/foundation/roadmap.md:224`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/foundation/roadmap.md#L224)). `e2e/specs/generation.spec.ts` covers it once the solver is up.

## Code References

- [`supabase/migrations/20261028200630_fail_closed_policies.sql:131-133`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261028200630_fail_closed_policies.sql#L131-L133): `profiles` read policy (own or `can_read`).
- [`supabase/migrations/20261105073614_user_directory.sql:74-76`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261105073614_user_directory.sql#L74-L76): `user_directory` read policy (not machine; own or `can_read`).
- [`supabase/migrations/20261029143936_current_plan_marker.sql:48-52`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261029143936_current_plan_marker.sql#L48-L52): `lock_timeout` precedent.
- [`supabase/migrations/20261029143936_current_plan_marker.sql:61-70`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261029143936_current_plan_marker.sql#L61-L70): current-plan index, CHECK, and the narrowed `plans_updated_at` trigger.
- [`supabase/migrations/20260711174905_clone_plan_include_board.sql:17-31`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20260711174905_clone_plan_include_board.sql#L17-L31): latest `clone_plan`, INVOKER, explicit column list.
- [`supabase/migrations/20261017170524_profiles.sql:27`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261017170524_profiles.sql#L27): `default auth.uid()` precedent.
- [`supabase/migrations/20260810200122_generation_jobs.sql:57-114`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20260810200122_generation_jobs.sql#L57-L114): job table, status values, FKs, `updated_at` trigger.
- [`supabase/migrations/20261105080343_role_management.sql:139-185`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261105080343_role_management.sql#L139-L185): `guard_last_admin`, the trigger precedent with the cascade exemption (`:151`).
- [`supabase/migrations/20261105080343_role_management.sql:192-203`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261105080343_role_management.sql#L192-L203): `access_changes` with `actor_kind` and a nullable `actor_id … on delete set null`.
- [`supabase/migrations/20261105080343_role_management.sql:223-229`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/supabase/migrations/20261105080343_role_management.sql#L223-L229): identity-checking INSERT policy precedent.
- [`src/_pages/plan-detail/api/generation-job.ts:153-196`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/api/generation-job.ts#L153-L196): proposal clone, `markPending`, `insertJob`.
- [`src/_pages/plan-detail/api/generation-stop.ts:54-115`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/api/generation-stop.ts#L54-L115): `stopGeneration`, `terminaliseQueued`, `requestStop`.
- [`src/_pages/plan-detail/api/generation-reclaim.ts:49-69`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/api/generation-reclaim.ts#L49-L69): stale-job reclaim, which must stay open to any author.
- [`src/_pages/plan-detail/api/generation-delivery.ts:130-133`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/api/generation-delivery.ts#L130-L133), `:422-447`: delivery writes, which must stay open to any author.
- [`src/_pages/plan-detail/api/generation-read.ts:94-95`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/api/generation-read.ts#L94-L95), `:217-237`: `STATUS_COLUMNS` and `toView`.
- [`src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx:231-240`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx#L231-L240): "You stopped this generation" copy.
- [`src/_pages/plan-detail/ui/PendingProposalPage.tsx:151-155`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plan-detail/ui/PendingProposalPage.tsx#L151-L155), `:196`: Stop gating and copy.
- [`src/pages/plans/[id]/index.astro:27`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/pages/plans/[id]/index.astro#L27), `:143-150`: route-computed `canEdit`, pending page props.
- [`src/middleware.ts:48-49`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/middleware.ts#L48-L49): `locals.user` and `locals.access`.
- [`src/shared/config/capability.ts:9-21`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/shared/config/capability.ts#L9-L21): app capability map.
- [`src/shared/ui/profile-label.ts:12-14`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/shared/ui/profile-label.ts#L12-L14): label helper to move into `entities/user`.
- [`src/_pages/users/api/loader.ts:20-24`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/users/api/loader.ts#L20-L24): directory and profiles lookup pattern.
- [`src/_pages/plans-list/api/loader.ts:47-55`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plans-list/api/loader.ts#L47-L55): plans list query.
- [`src/_pages/plans-list/ui/PlansHub.tsx:151-180`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/_pages/plans-list/ui/PlansHub.tsx#L151-L180): plans table header and name cell.
- [`src/shared/api/load-plan-summary.ts:50-52`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/shared/api/load-plan-summary.ts#L50-L52): plan summary query.
- [`src/test/role-matrix-expectations.ts:147-154`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/test/role-matrix-expectations.ts#L147-L154): others' profile and directory rows readable.
- [`src/test/role-matrix-expectations.ts:195-199`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/test/role-matrix-expectations.ts#L195-L199): job UPDATE cells.
- [`src/test/role-matrix-expectations.ts:368-373`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/test/role-matrix-expectations.ts#L368-L373): `CAPABILITY_POLICIES`.
- [`src/test/role-matrix.integration.test.ts:234-239`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/test/role-matrix.integration.test.ts#L234-L239): four-policy structural check.
- [`src/test/factories/teardown.ts:29-31`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/src/test/factories/teardown.ts#L29-L31): plans-before-users teardown, already written for S-407.

## Architecture Insights

- **Defaults beat parameters for attribution.**
  - A `default auth.uid()` column keeps the domain functions' `(supabase, input)` shape, and works inside INVOKER RPCs.
  - Service-role writers get null instead of a wrong id.
  - Because of this, the slice touches almost no write code.
- **RLS gates rows; triggers gate transitions.** The repo's capability posture (exactly four policies per plan-scoped table, pinned by a catalog test) leaves no room for column-specific rules in policies. A row-level rule on a table that several actors legitimately update breaks the actors you did not mean to restrict. S-407 is the first time a rule depends on who owns a row in a shared table.
- **Ownership here is narrow on purpose.** Editing stays fully shared (FR-416). Only Stop is owned, so this is not per-plan ownership. That model is parked in the roadmap, and nothing here should grow toward it.
- **A nullable FK records a link, not a fact.** As soon as "unknown" and "deleted" must render differently, a kind column is needed (S-406's `actor_kind`).

## Historical Context (from prior changes)

- [`context/changes/user-managment-research/research.md:545-549`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/changes/user-managment-research/research.md#L545-L549): the original column design for `created_by` (`default auth.uid()`, set null, the presser credited via INVOKER `clone_plan`). `requested_by` is "the same pattern" but "not decided"; FR-416 later made it required.
- [`context/archive/2026-10-16-account-self-service/plan.md:551`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/archive/2026-10-16-account-self-service/plan.md#L551): `profiles.user_id default auth.uid()` is named as the precedent for `created_by`.
- [`context/archive/2026-11-03-users-page-roles/research.md:85`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/archive/2026-11-03-users-page-roles/research.md#L85), `:275-279`, [`context/archive/2026-11-03-users-page-roles/plan.md:114`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/archive/2026-11-03-users-page-roles/plan.md#L114): `user_directory` built so S-407's non-admin readers can show emails; `profileLabel` moved to `shared/ui`; `entities/user` deferred to S-407.
- [`context/archive/2026-10-12-give-integration-lane-a-signed-in-client-per-role/plan.md:188-191`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/archive/2026-10-12-give-integration-lane-a-signed-in-client-per-role/plan.md#L188-L191): teardown order designed around S-407's set-null.
- [`context/archive/2026-10-28-fail-closed-roles/plan.md:76`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/archive/2026-10-28-fail-closed-roles/plan.md#L76), [`context/archive/2026-10-30-viewer-read-only/plan.md:100`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/archive/2026-10-30-viewer-read-only/plan.md#L100): requester-scoped Stop explicitly deferred to S-407.
- [`context/archive/2026-09-01-stop-and-keep/plan-brief.md:84-85`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/archive/2026-09-01-stop-and-keep/plan-brief.md#L84-L85), [`context/archive/2026-09-01-stop-and-keep/reviews/impl-review.md:92`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/archive/2026-09-01-stop-and-keep/reviews/impl-review.md#L92): S-305's "no per-author ownership" non-goal, and the "You stopped" copy skipped as moot for one author.
- [`context/archive/2026-10-29-current-plan-marker/plan.md:16`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/archive/2026-10-29-current-plan-marker/plan.md#L16), `:68`, `:107`: how S-404 added a plans column, with `clone_plan` untouched and the `updated_at` trigger narrowed.
- [`context/archive/2026-10-30-viewer-read-only/research.md:405`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/archive/2026-10-30-viewer-read-only/research.md#L405): delivery is by any author or admin, never only the requester.
- [`context/foundation/roadmap.md:283-288`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/foundation/roadmap.md#L283-L288): S-310 needs the job's requester as its email recipient.

## Related Research

- `context/changes/user-managment-research/research.md`: the milestone research (attribution design notes).
- `context/archive/2026-11-03-users-page-roles/research.md`: `user_directory`, readers and labels.
- `context/archive/2026-10-30-viewer-read-only/research.md`: who writes on page load, and delivery ownership.
- `context/archive/2026-09-01-stop-and-keep/research.md`: Stop semantics and the solver's column pins.

## Open Questions

Decisions for the plan phase, and the user where marked:

1. **How Stop is enforced** (Challenge 1). Recommended: the guard trigger (B), with the "any author can still fail or delete a job directly" gap recorded as accepted. The lighter option is app-only (A). — Owner: user.
2. **A new `stop_any_job` capability, or reuse `manage_users`?** (Challenge 2). Recommended: a new capability. — Owner: plan.
3. **"Unknown" for both legacy and deleted creators, and "any author" for both legacy and deleted requesters?** (Challenge 3). Recommended: accept now, revisit at S-411. — Owner: user.
4. **How hard to protect `plans.created_by`** (Challenge 4). Accept the risk (cosmetic) or use the same stamp-and-pin trigger as `requested_by`. — Owner: plan.
5. **Stop copy: neutral text, or a `stop_requested_by` column for "Stopped by …"?** (Challenge 6). — Owner: user.
6. **Surfaces.** Is the minimum set (plans list, plan header, pending page) enough, or should the comparison page show the creator too? (Challenge 8). — Owner: user.
7. **Duplicates are credited to the duplicator, not the source's creator.** Confirm, and record the decision in the plan. — Owner: user.
8. **A requester demoted to viewer loses Stop on their own job.** This follows the PRD access table ([`context/foundation/prd.md:353`](https://github.com/dobrek/ib-timetable-planner/blob/b0a7277db6616ca4c02a9807ed3bbea6043c7dd4/context/foundation/prd.md#L353)) but is not stated anywhere. Confirm it is intended. — Owner: user.
