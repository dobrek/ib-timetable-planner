# Created-by and Job Ownership (S-407) Implementation Plan

## Overview

Record who created each plan (`plans.created_by`), who requested each generation job (`generation_jobs.requested_by`) and who asked it to stop (`generation_jobs.stop_requested_by`). Show the creator on the plans list and the board header, and the requester on the pending proposal page. Limit Stop to the job's requester or an admin, enforced in the database by one guard trigger. Plans and jobs from before the change show "Unknown" and stay stoppable by any author (FR-415, FR-416, FR-417; FR-413 for the label shape).

## Current State Analysis

The research (`context/changes/created-by-and-job-ownership/research.md`) mapped the ground. What this plan builds on:

- **Nothing records a person on a plan or a job.** `public.plans` has no user column. `generation_jobs` (`supabase/migrations/20260810200122_generation_jobs.sql:57-98`) has none either.
- **Every human insert runs under the user's own session.** That covers `create-plan.ts:9`, the INVOKER `clone_plan` (explicit `(name, slot_grid_preset)` list, `20260711174905_clone_plan_include_board.sql:17-31`), which serves both Duplicate and Generate, and `insertJob` (`src/_pages/plan-detail/api/generation-job.ts:181-196`). So `default auth.uid()` credits correctly without touching write code. Service-role writers (the seed, the factories) get null.
- **Names are already readable.** Any role holder reads every `profiles` row and every non-machine `user_directory` row (`20261028200630_fail_closed_policies.sql:131-133`, `20261105073614_user_directory.sql:74-76`). `profileLabel` lives in `src/shared/ui/profile-label.ts`, consumed by `SidebarLayout.astro:38` and `src/_pages/users/model/user-rows.ts`.
- **Stop has two writes**, both in `src/_pages/plan-detail/api/generation-stop.ts`:
  - `terminaliseQueued` (`:72-91`): `queued → stopped`, and it stamps `stop_requested_at`.
  - `requestStop` (`:104-115`): sets the flag on a `running` row.
  - These are the app's only writers of `stop_requested_at` (verified by grep). The solver holds SELECT on it and no UPDATE (`20260820075348_solver_progress_select_grants.sql:33`), and it selects explicit column lists (`services/solver/src/cpsat_service/supabase.py:167,207,300`).
- **Delivery, reclaim and `notified_at` UPDATE the same rows**, and must stay open to any author. RLS judges rows, not column changes. The structural catalog check (`src/test/role-matrix.integration.test.ts:234-239`) pins exactly four capability policies per plan-scoped table, so Stop cannot be a policy.
- **The Stop control renders for every editor** (`PendingProposalPage.tsx:151-155`). The copy "You stopped this generation" goes to every editor too (`PendingProposalPage.tsx:196`, `GenerationStatusStrip.tsx:236`).
- **`plans_updated_at`** skips only `is_current` changes (`20261029143936_current_plan_marker.sql:66-70`). A set-null cascade on `created_by` would bump "Last updated".
- **Teardown already deletes plans before users** (`src/test/factories/teardown.ts:29-31`).

## Desired End State

- **Every new plan, duplicate and proposal records who made it.** A proposal is credited to whoever pressed Generate; a duplicate to whoever pressed Duplicate.
- **The plans list has a "Created by" column, and the board header names the creator.** Each shows the display name with the email beneath (FR-413), "Unknown" when there is no creator, and a "Service account" badge for the campaign account.
- **The pending proposal page shows "Requested by".**
- **Every new job records its requester**, and the database refuses a stop by anyone other than the requester or an admin. A job with no requester (legacy, or its requester was deleted) stays stoppable by any author. A viewer, including a requester demoted to viewer, never stops a job.
- **A non-owner editor sees no Stop control**, only "Requested by". A refused stop that slips through a race reads FORBIDDEN, not a server error.
- **Stop copy names the stopper:** "You stopped…", "Stopped by <name> (<email>)…", or the neutral line when no stopper is recorded.
- **Deleting a user clears their credit and nothing else.** Plans and jobs stay, and "Last updated" does not move.
- **Generation keeps working end to end** (FR-417).

How to check it: the role matrix and a new attribution suite are green, `generation.spec.ts` is green with the solver up, and a local walk-through with two authors and an admin matches the copy above.

### Key Discoveries

- `clone_plan` lists its columns explicitly, so the new column takes its default inside the INVOKER RPC (`20260711174905_clone_plan_include_board.sql:17-31`). S-404 relied on the same fact for `is_current`.
- An FK cascade runs as the **referencing table's owner** (recorded in `20261105080343_role_management.sql:42-43`, and asserted by S-406's post-conditions). A guard that acts only when `current_user = 'authenticated'` therefore lets account deletion through with no depth exemption.
- `toDomainError` already maps 42501 to `FORBIDDEN` (`src/shared/api/postgrest/to-domain-error.ts:15-21`). `stopGeneration` throws `INTERNAL_SERVER_ERROR` on any error instead, and has to go through the shared mapping.
- `GenerationJobView` is built by the pure `toView` (`src/_pages/plan-detail/api/generation-read.ts:217-237`). It is called from `readPlanJob` (`:138`) and from `checkPlan`'s paths (`generation-delivery.ts:166-265`).
- `entities/timetable`'s barrel is imported by React islands and re-exports its client-safe `api` module (`src/entities/timetable/index.ts:79-89`). `entities/user` follows the same discipline.
- `account.spec.ts:35-56` renames the shared e2e author while other specs run, so every new e2e assertion matches on the **email**.
- The e2e generation fixture solves in about a second (`e2e/specs/generation.spec.ts`), so the pending page is too short-lived to assert on in e2e. "Requested by" is proven by component tests instead.

## What We're NOT Doing

- **No integrity trigger on `plans.created_by`.** It is only a label and gates nothing. No app path writes it (create and rename take explicit Zod-checked fields, and `clone_plan` takes an explicit column list), and the publishable key never reaches a browser, so nobody can write it directly. Revisit if `created_by` ever authorizes anything.
- **No distinction between "Unknown" and "Deleted user"** (user decision). A null creator or requester means either "predates S-407" or "that person was deleted", and both render "Unknown" / "any author may stop". Revisit at S-411, which introduces deletion; Phase 4 records this as an S-411 unknown.
- **The residual job gap is accepted.** The standard policies still let any author set `status = 'failed'` on, or DELETE, someone else's running job by a direct write. Closing it would mean gating every active-to-terminal change, which collides with reclaim. Only the app's server-side actions write.
- **No "Created by" on the comparison page, the teacher/student views, or the xlsx and print exports.**
- **No change to the solver, `contracts/`, or the solver's vocabulary.** "stopped by the author: …" (`generation-stop.ts:51-52`, and the solver's own strings) stays as it is: "the author" names a role, not a person.
- **No per-plan ownership.** Editing stays fully shared (FR-416); only Stop is owned.
- **No backfill.** None is possible, and the PRD says so.
- **No viewer stop path.** A demoted requester loses Stop (user decision); an admin can still stop the job.

## Implementation Approach

The database holds the truth, and the app only makes it legible.

1. **Defaults** credit the creator and the requester, so write code doesn't change.
2. **One INVOKER guard trigger on `generation_jobs`** does three things for signed-in callers:
   - it stamps the requester on insert;
   - it refuses a change to `requested_by` or `stop_requested_by`;
   - it refuses a stop write from anyone who is neither the requester nor an admin, and records the first stopper.

   It ignores every non-`authenticated` caller: service-role factories, the solver, and the FK cascade.
3. **A new admin-only capability `stop_any_job`.** Policies and helpers name capabilities, never roles. It is mirrored in `capability.ts` and handed to islands as a route-computed boolean.
4. **A new `entities/user` slice** owns how the app names a person: `profileLabel`, a batched lookup and one credit component. Every surface renders a credit the same way.

The access change follows CLAUDE.md's order: the role-matrix diff first, shown red, then the migration that turns it green.

## Critical Implementation Details

- **The order inside the guard is load-bearing:**
  1. Return early for any caller other than `authenticated`, before anything reads `auth.uid()`.
  2. On UPDATE, refuse a `requested_by` change.
  3. Then handle the stop flag, checking ownership against `OLD.requested_by`.
  4. Only then refuse a direct `stop_requested_by` change. The stamp in step 3 is what legitimately changes it.

  Compare values with `is distinct from`. A plain `UPDATE OF` column list fires whenever the column appears in the SET list, even unchanged (PostgREST only sends the columns passed).
- **The identity check inside a trigger is a new kind of rule here**, so the migration header records why (the CLAUDE.md DEFINER-exception style): RLS cannot see column transitions; the four-policy pin forbids a fifth policy; delivery and reclaim must stay shared. The header also records that skipping non-`authenticated` callers covers the deletion cascade, because the cascade runs as the table owner. That is a different mechanism from S-406's depth exemption, and the attribution suite proves it.
- **Never write `created_by` together with another `plans` column.** The narrowed `plans_updated_at` skips any UPDATE that changes `created_by`, which is S-404's `is_current` warning extended.
- **The `entities/user` barrel is imported by islands.** Its `api` module may import only types and client-safe helpers from `@/shared/api`, never `createClient`, as `entities/timetable` does.

## Phase 1: Database and Access Spec

### Overview

The access spec changes first and is run red against today's schema. Then one additive migration turns it green. An attribution suite proves the stamping, the cascade and "Last updated".

### Changes Required

#### 1. Role-matrix expectations (red first)

**File**: `src/test/role-matrix-expectations.ts`

**Intent**: State the new stop rule and the attribution pins as data, so they fail against the current schema before the migration exists.

**Contract**:
- `JOB_STOPS: Record<JobRequester, Record<StopWrite, OwnRowCell>>`.
  - `JobRequester = "own" | "others" | "legacy"`; `legacy` means `requested_by` is null. `StopWrite = "stop queued" | "stop running"`, the two writes `stopGeneration` makes.
  - `own`: anon `no-row`; noRole and viewer denied; author and admin allowed.
  - `others`: only admin allowed.
  - `legacy`: author and admin allowed.
- `JOB_ATTRIBUTION_REWRITES: Record<"requested_by" | "stop_requested_by", Cell>`: an UPDATE pointing the column at the caller is denied for every principal.
  - `JOB_ATTRIBUTION_REWRITE_EVIDENCE` holds the service role's `allowed` for each payload, in the existing `*_EVIDENCE` pattern.
- The file's docblock gains the S-407 bullet.
- `src/test/role-matrix-expectations.test.ts` checks the new cells' internal consistency, as it does `PROFILE_WRITES`.

#### 2. Role-matrix runner

**File**: `src/test/role-matrix.integration.test.ts`

**Intent**: Probe the new cells live, and declare the new private functions in the catalog pins.

**Contract**:
- Stop probes:
  - Each cell gets its own plan and a service-role job (queued, or claimed-to-running) with an explicit `requested_by`: the principal's id for `own`, the fixture owner's for `others`, null for `legacy`.
  - The attempt is the same UPDATE payload `stopGeneration` sends, and the effect is read back as the service role.
  - Anon's `own` cell is `no-row`: anon has no id.
- Rewrite probes target another user's job.
- `PRIVATE_FUNCTIONS` (`:607`) gains `private.can_stop_any_job()` and `private.guard_job_attribution()`, both `invoker`.
- The executors pin (`:289-299`) gains `private.can_stop_any_job()` → `["authenticated"]` and `private.guard_job_attribution()` → `[]`.

#### 3. The migration

**File**: `supabase/migrations/<timestamp>_created_by_and_job_ownership.sql` (via `pnpm exec supabase migration new created_by_and_job_ownership`)

**Intent**: Additive schema for attribution, the admin capability, and the stop guard. It is safe against live data on its own.

**Contract**:
- Opens with `set local lock_timeout = '5s'`, plus the ATOMIC and LOCKS header notes S-404 and S-406 carry.
- Columns, all `uuid null references auth.users (id) on delete set null`, each with its own index:
  - `plans.created_by default auth.uid()`;
  - `generation_jobs.requested_by default auth.uid()`;
  - `generation_jobs.stop_requested_by`, no default.
- A `comment on column` for each.
- `create or replace trigger plans_updated_at … when (old.is_current is not distinct from new.is_current and old.created_by is not distinct from new.created_by)`.
- `private.can_stop_any_job()`: INVOKER, `stable`, `search_path = ''`, `select private.current_app_role() = 'admin'`. Revoke from public and anon, grant to authenticated. Copy `can_manage_users`'s shape (`20261105080343_role_management.sql:80-93`).
- `private.guard_job_attribution()` and the trigger `generation_jobs_guard_attribution before insert or update of requested_by, stop_requested_at, stop_requested_by on public.generation_jobs for each row`. Its logic:

  ```sql
  if current_user is distinct from 'authenticated' then return new; end if;  -- service role, solver, FK cascade (owner)
  if tg_op = 'INSERT' then
    new.requested_by := auth.uid();
    new.stop_requested_by := case when new.stop_requested_at is null then null else auth.uid() end;
    return new;
  end if;
  if new.requested_by is distinct from old.requested_by then raise exception using errcode = '42501', …; end if;
  if new.stop_requested_at is distinct from old.stop_requested_at then
    if old.requested_by is not null and old.requested_by is distinct from auth.uid()
       and not private.can_stop_any_job() then raise exception using errcode = '42501', …; end if;
    -- first stopper wins
    new.stop_requested_by := case when old.stop_requested_at is null then auth.uid() else old.stop_requested_by end;
  elsif new.stop_requested_by is distinct from old.stop_requested_by then raise exception using errcode = '42501', …;
  end if;
  return new;
  ```
- Post-condition `DO` blocks, in S-406's style:
  - both functions are INVOKER;
  - `can_stop_any_job` is executable by `authenticated` only;
  - the three FKs and indexes exist.
- The header records why an identity check lives in a trigger, and the cascade argument (Critical Implementation Details).

#### 4. Generated types

**File**: `src/shared/api/database.types.ts`

**Intent**: Regenerate with `pnpm db:types` so the three columns exist in the generated types. Review the diff; never hand-edit.

#### 5. Attribution integration suite

**File**: `src/test/job-attribution.integration.test.ts` (new; siblings `last-admin-guard.integration.test.ts`, `access-changes.integration.test.ts`)

**Intent**: Prove the behaviour the matrix cannot express as allowed/denied cells, through clients signed in with the publishable key (`createSignedInUser`).

**Contract**: cases:
- **Credit on every path.** A signed-in author's new plan (`createPlan` domain function), duplicate (`clonePlan`) and Generate (`startGeneration` with the faked transport the enqueue suite uses) all carry `created_by` / `requested_by` equal to the author's id.
- **Forged credit is overwritten.** An author's job INSERT naming another user's `requested_by` lands with the author's own id.
- **Service-role writes keep explicit ids**, which the matrix's probes rely on.
- **First stopper wins.** An admin re-stamping a stop the requester made leaves `stop_requested_by` on the requester.
- **Deletion clears credit and nothing else.** Deleting a user who created a plan, and requested and stopped a job, succeeds. The plan and the job remain, all three columns are null, and `plans.updated_at` is unchanged.

### Success Criteria

#### Automated Verification

- [x] The role-matrix suite runs red on the expectations diff alone, before the migration exists: `pnpm test:integration src/test/role-matrix.integration.test.ts`. Record which cells fail.
- [x] The migration applies from scratch: `pnpm exec supabase db reset`
- [x] Types regenerate cleanly, with only the three new columns in the diff: `pnpm db:types`
- [x] The role matrix is green: `pnpm test:integration src/test/role-matrix.integration.test.ts`
- [x] The attribution suite is green: `pnpm test:integration src/test/job-attribution.integration.test.ts`
- [x] The solver and stop suites are unchanged and green: `pnpm test:integration src/test/solver-credential.integration.test.ts src/_pages/plan-detail/api/generation-stop.integration.test.ts src/test/generation-jobs.integration.test.ts`
- [x] No unindexed-FK advisory: `pnpm exec supabase db advisors`
- [x] Type check passes: `pnpm check`
- [x] Lint and unit tests pass: `pnpm lint && pnpm test`

#### Manual Verification

- [x] The migration header states the reason for an identity check in a trigger, the cascade argument, and the "never write `created_by` with another column" warning.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: `entities/user` and "Created by"

### Overview

Extract the person-naming concept into `src/entities/user/`, then show the creator on the plans list and the board header.

### Changes Required

#### 1. The user entity

**File**: `src/entities/user/` (new: `index.ts`, `model/profile-label.ts` and its test moved from `src/shared/ui/`, `model/credit.ts`, `api/load-credited-users.ts`, `ui/UserCredit.tsx`)

**Intent**: One home for "how the app names a person". S-406 deferred it to this slice as the second consumer (`context/archive/2026-11-03-users-page-roles/plan.md:114`).

**Contract**:
- **`profileLabel` / `ProfileLabel`** move unchanged; `shared/ui/index.ts` stops exporting them.
- **`CreditedUser = { id; label: ProfileLabel; isServiceAccount: boolean }`.**
- **`Credit = { kind: "user"; user: CreditedUser } | { kind: "unknown" }`.** It is a serializable island prop.
- **`creditFor(id: string | null, users: ReadonlyMap<string, CreditedUser>): Credit`** (pure). A null id, or an id missing from the directory, is `unknown`.
- **`loadCreditedUsers(supabase, ids): Promise<Map<string, CreditedUser>>`:**
  - de-duplicates, and returns an empty map without querying when there are no ids;
  - otherwise reads `user_directory` (`user_id, email, is_service_account`) and `profiles` (`user_id, display_name`) in parallel with `.in("user_id", ids)`;
  - throws through `assertNoQueryErrors`.
- **`UserCredit`** renders the label primary with the email beneath, a "Service account" badge, or muted "Unknown". It has a compact inline variant for the board header. Semantic tokens only.

#### 2. Existing consumers

**Files**: `src/app/layouts/SidebarLayout.astro`, `src/app/layouts/SidebarAccountLink.astro`, `src/_pages/users/model/user-rows.ts`

**Intent**: Import `profileLabel` / `ProfileLabel` from `@/entities/user`. The Users page keeps its own four-table loader.

#### 3. Plans list

**Files**: `src/_pages/plans-list/api/loader.ts`, `src/_pages/plans-list/ui/PlansHub.tsx` (+ `PlansHub.test.tsx`)

**Intent**: Each hub row carries its creator's credit, rendered in a "Created by" column after "Name".

**Contract**:
- `PlanRow.createdBy: Credit`.
- `fetchPlans` selects `created_by`, then makes one `loadCreditedUsers` call over the page's distinct creator ids. A failure throws, like the loader's other reads.

#### 4. Board header

**Files**: `src/shared/api/load-plan-summary.ts`, `src/pages/plans/[id]/index.astro`, `src/_pages/plan-detail/ui/PlanDetailPage.astro`, `src/_pages/plan-detail/ui/PlannerBoard.tsx`, `src/_pages/plan-detail/ui/chrome/BoardHeader.tsx`

**Intent**: The board header shows "Created by <credit>" in every board state, threaded the way S-404 threaded `isCurrent` (`PlannerBoard.tsx:262,311,339`).

**Contract**:
- `PlanSummary` gains `created_by: string | null` (added to the select).
- The route resolves `createdBy: Credit | null`. The lookup is best-effort, never fatal, like the generation check: on failure it logs and passes null, which renders no creator line.

### Success Criteria

#### Automated Verification

- [x] Unit tests pass, including `creditFor`, the moved `profileLabel` test, `UserCredit`, and the PlansHub "Created by" cell (user, unknown, service account): `pnpm test`
- [x] FSD structure is clean (no `insignificant-slice`, no upward import): `pnpm steiger`
- [x] Type check passes: `pnpm check`
- [x] Lint passes: `pnpm lint`
- [x] The production build stays clean, with no Supabase key in `dist/client`: `pnpm build`

#### Manual Verification

- [x] On `pnpm build && pnpm preview`, a plan you create shows your display name with your email beneath under "Created by". Seed plans show "Unknown".
- [x] A plan you duplicate is credited to you, not to the source's creator.
- [x] The board header shows the creator on a populated board and on an empty one.
- [x] A user flagged `is_service_account` shows the "Service account" badge.
- [x] At phone width the hub table still scrolls inside its container, with no page-level horizontal scroll.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: Stop Ownership in the App

### Overview

The app mirrors the new capability. The job view carries the requester and the stopper. Stop renders only for whoever the database will let stop. The pending page says who requested the job, and every "stopped" line names the stopper.

### Changes Required

#### 1. Capability mirror

**File**: `src/shared/config/capability.ts` (+ its test)

**Intent**: Add `stop_any_job` to `Capability`, held by `admin` only. Update the docblock to name `private.can_stop_any_job()`.

#### 2. Job view

**Files**: `src/_pages/plan-detail/api/generation-read.ts`, `src/_pages/plan-detail/api/generation-delivery.ts`

**Intent**: The view tells the island whose job it is and who stopped it, so the decision survives a degraded first read and updates on every poll tick.

**Contract**:
- `STATUS_COLUMNS` and `StatusRow` gain `requested_by, stop_requested_by`.
- `GenerationJobView` gains `requestedBy: string | null` (id) and `stoppedBy: Credit | null`.
  - `stoppedBy` is resolved only when the row is `stopped` and `stop_requested_by` is non-null, through one `loadCreditedUsers` call after `toView` in `readPlanJob` and `checkPlan`.
  - `toView` stays pure and sets it to null.
  - A lookup failure degrades to null and never fails the read.

#### 3. Stop domain function

**File**: `src/_pages/plan-detail/api/generation-stop.ts` (+ `generation-stop.integration.test.ts`)

**Intent**: Map a guard refusal to FORBIDDEN, with "Only whoever started this generation, or an admin, can stop it.", instead of `INTERNAL_SERVER_ERROR`. Update the docblock: the only legitimate stop writer is now also the requester or an admin, enforced by `generation_jobs_guard_attribution`.

**Contract**:
- Both writes keep their CAS filters and outcomes.
- A 42501 becomes `DomainError("FORBIDDEN", …)`, through `toDomainError` or the same check.
- The integration suite gains signed-in cases: another author's stop → FORBIDDEN, row untouched; an admin's stop of an author's job → `stopping`; any author's stop of a legacy job → `stopping`.

#### 4. Pure decisions

**Files**: `src/_pages/plan-detail/model/generation/can-stop-job.ts`, `src/_pages/plan-detail/model/generation/stopped-by.ts` (+ tests)

**Intent**: Orchestration over patching. Who may stop, and how the stop is narrated, are derived in `model/`, not inline in JSX.

**Contract**:
- `canStopJob(job, { canEdit, viewerId, canStopAnyJob }): boolean` is true when all three hold:
  - `canEdit`;
  - the job is active;
  - `canStopAnyJob`, or `job.requestedBy === null`, or `job.requestedBy === viewerId`.
- `stoppedBy(job, viewerId): { kind: "you" } | { kind: "user"; user: CreditedUser } | { kind: "unknown" }` decides by the stopper's id, so a viewer also reads "Stopped by <name>".
  - The stopper's id comes from `job.stoppedBy`. "you" wins over the label when the ids match.

#### 5. Route and islands

**Files**: `src/pages/plans/[id]/index.astro`, `src/_pages/plan-detail/ui/PendingProposalPage.tsx` (+ test), `src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx` (+ test), `src/_pages/plan-detail/ui/PlanDetailPage.astro`, `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: The route computes `viewerId` (`Astro.locals.user?.id`) and `canStopAnyJob` (`allows(Astro.locals.access, "stop_any_job")`) and passes them down with the `createdBy` credit. Islands never read the role.

**Contract**:
- **Pending page header:** it shows "Requested by <UserCredit>" from the proposal's creator credit. That is the requester: the same session writes both rows.
- **Stop control:** StopAndKeep renders only when `canStopJob(...)`. A non-owner editor sees the "Requested by" line and no control (absent, never disabled).
- **`stopped` panel** (`PendingProposalPage.tsx:186-200`) uses `stoppedBy`:
  - "You stopped this generation before any stage finished — nothing was kept.";
  - "Stopped by <name> (<email>) before any stage finished — nothing was kept.";
  - otherwise the existing neutral line.
- **Status strip:** `haltedSummary` (`GenerationStatusStrip.tsx:226-241`) names the stopper the same way on both the no-checkpoint line and "Stopped early — kept the board from stage N of 10". The inline label is "name (email)", or the email alone.

### Success Criteria

#### Automated Verification

- [x] Unit tests pass, including `canStopJob` (requester, other author, admin, legacy, viewer, demoted requester, terminal job), `stoppedBy`, the capability map, PendingProposalPage (Stop absent for a non-owner editor, "Requested by" rendered, stopper copy), and GenerationStatusStrip copy: `pnpm test`
- [x] The stop suite with signed-in cases is green: `pnpm test:integration src/_pages/plan-detail/api/generation-stop.integration.test.ts`
- [x] The generation suites are green: `pnpm test:integration src/test/generation-lifecycle.integration.test.ts src/_pages/plan-detail/api/generation-enqueue.integration.test.ts`
- [x] Type check passes: `pnpm check`
- [x] Lint and FSD checks pass: `pnpm lint && pnpm steiger`
- [x] The build is clean: `pnpm build`

#### Manual Verification

- [x] Locally, with author A, author B and an admin, `SOLVER_STAGE_BUDGET_S=5 mise run solver:dev`, and `pnpm build && pnpm preview`, A generates. B's pending page shows "Requested by A (email)" and no Stop. The admin's shows Stop.
- [x] The admin stops A's job. A then sees "Stopped by <admin> (email)…", and the admin sees "You stopped…".
- [x] A job started before the migration is stopped by B, and its copy is neutral. Simulate it by nulling `requested_by` in Studio.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 4: E2E, FR-417 Guardrail and Docs

### Overview

Pin the visible attribution in the browser, re-prove generation end to end, and bring the docs in line.

### Changes Required

#### 1. E2E specs

**Files**: `e2e/specs/created-by.spec.ts` (new, author), `e2e/specs/read-only.viewer.spec.ts`, `e2e/specs/generation.spec.ts`

**Intent**: Prove "Created by" as an author and as a viewer meet it, and FR-417's one deliberate difference.

**Contract**:
- Every match is on the author's email from `e2e/author-credentials.mjs`, never on the display name.
- **New spec:** the hub row of a plan the author just created shows the author's email under "Created by"; the plan's header shows it; a seed plan shows "Unknown".
- **Viewer spec:** one assertion, that a viewer sees a plan's creator.
- **Generation spec:** the delivered proposal's header credits the author.

#### 2. Docs

**Files**: `CLAUDE.md`, `README.md`, `context/foundation/roadmap.md`

**Intent**: Keep the conventions true.

**Contract**:
- **`CLAUDE.md` § Database & auth:**
  - add `private.can_stop_any_job()` to the INVOKER wrappers and the capability list;
  - add one bullet saying an identity check in a trigger acts only on `authenticated` callers, because service-role callers and FK cascades carry no `auth.uid()` (S-407's `generation_jobs_guard_attribution`).
- **`README.md`:** after the viewer paragraph in Auth routes, one sentence: only a job's requester or an admin can stop it, and jobs from before S-407 stay stoppable by any author.
- **Roadmap S-411:** an Unknowns line. A deleted creator or requester reads "Unknown" or "any author may stop" (S-407), and S-411 decides whether to add a kind column for "Deleted user".

### Success Criteria

#### Automated Verification

- [x] The new and changed specs pass with the solver up: `pnpm test:e2e e2e/specs/created-by.spec.ts e2e/specs/read-only.viewer.spec.ts e2e/specs/generation.spec.ts`
- [x] The full E2E suite passes: `pnpm test:e2e`
- [x] The full integration lane passes, with `SOLVER_MAX_CONCURRENT_JOBS=2`: `pnpm test:integration`
- [x] The local CI gate passes: `/verify`

#### Manual Verification

- [x] The CLAUDE.md, README and roadmap edits read correctly.

**Implementation Note**: After this phase passes, the change is ready for `/10x-impl-review`. The merge deploys, so the no-solve-running rule applies.

---

## Testing Strategy

### Unit Tests

- `creditFor`: null id, id absent from the directory, a service account.
- `profileLabel` (moved).
- `canStopJob`: every branch, including a viewer requester and a terminal job.
- `stoppedBy`: "you" wins over a label.
- The capability map.
- Component tests: `UserCredit`, the PlansHub column, PendingProposalPage (control absent for a non-owner, "Requested by", stopper copy), GenerationStatusStrip copy.

### Integration Tests

- **Role-matrix cells** (red first): `JOB_STOPS` across own, another's and legacy jobs, both stop writes and every principal; the attribution rewrites; the catalog pins.
- **`job-attribution.integration.test.ts`:** credit on create, duplicate and Generate; the forged insert overwritten; service-role ids kept; first stopper wins; deletion nulls the credit, keeps the rows, and leaves `updated_at` unchanged.
- **`generation-stop.integration.test.ts`:** signed-in FORBIDDEN for another author; admin and legacy allowed.

### Manual Testing Steps

1. Create, duplicate and generate as author A; check the hub, the header and the pending page credits.
2. As author B, open A's running proposal: "Requested by A", and no Stop.
3. As the admin, stop A's job; check the copy from A's, the admin's and a viewer's point of view.
4. Null `requested_by` on a running job in Studio; B can stop it, and the copy is neutral.
5. Delete a throwaway user who created a plan; the plan remains, shows "Unknown", and its "Last updated" is unchanged.

## Performance Considerations

- **The hub** adds one batched lookup (two parallel queries) per page, whatever the plan count.
- **The plan route** adds one lookup for the creator.
- **The job read** adds one lookup only for `stopped` rows that have a stopper.
- **The guard trigger** does no work for the solver's writes: its column list never matches them, and it returns at the first line for non-`authenticated` callers.
- **Nothing touches the drag-drop path**, so the <200 ms budget is unaffected.

## Migration Notes

- Additive only: three nullable columns, FKs, indexes, a re-declared trigger, two functions and a trigger. Nothing is dropped.
- Adding an FK to `auth.users` briefly takes a SHARE ROW EXCLUSIVE lock on it. `lock_timeout = '5s'` turns a busy moment into a re-runnable deploy failure.
- CI runs `db push` before `wrangler deploy`. In the gap between them, the old Worker's inserts take the defaults, which is correct.
- Jobs running across the deploy have a null requester, so any author may stop them: exactly the PRD's legacy rule.
- Do not merge mid-solve (README).

## References

- Research: `context/changes/created-by-and-job-ownership/research.md`
- PRD: `context/foundation/prd.md` (FR-413, FR-415 to FR-417, the access table)
- Roadmap: `context/foundation/roadmap.md` § S-407
- Trigger precedent: `supabase/migrations/20261105080343_role_management.sql:139-185`
- Column-add precedent: `supabase/migrations/20261029143936_current_plan_marker.sql:48-70`, `context/archive/2026-10-29-current-plan-marker/plan.md`
- Stop semantics: `context/archive/2026-09-01-stop-and-keep/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database and Access Spec

#### Automated

- [x] 1.1 The role-matrix suite runs red on the expectations diff alone, before the migration exists (failing cells recorded) — ddeab46
- [x] 1.2 The migration applies from scratch: `pnpm exec supabase db reset` — ddeab46
- [x] 1.3 Types regenerate cleanly, with only the three new columns in the diff: `pnpm db:types` — ddeab46
- [x] 1.4 The role matrix is green: `pnpm test:integration src/test/role-matrix.integration.test.ts` — ddeab46
- [x] 1.5 The attribution suite is green: `pnpm test:integration src/test/job-attribution.integration.test.ts` — ddeab46
- [x] 1.6 The solver and stop suites are unchanged and green — ddeab46
- [x] 1.7 No unindexed-FK advisory: `pnpm exec supabase db advisors` — ddeab46
- [x] 1.8 Type check passes: `pnpm check` — ddeab46
- [x] 1.9 Lint and unit tests pass: `pnpm lint && pnpm test` — ddeab46

#### Manual

- [x] 1.10 The migration header states the reason for an identity check in a trigger, the cascade argument, and the `created_by` write warning — ddeab46

### Phase 2: `entities/user` and "Created by"

#### Automated

- [x] 2.1 Unit tests pass (`creditFor`, `profileLabel`, `UserCredit`, the PlansHub cell): `pnpm test` — 846f227
- [x] 2.2 FSD structure is clean: `pnpm steiger` — 846f227
- [x] 2.3 Type check passes: `pnpm check` — 846f227
- [x] 2.4 Lint passes: `pnpm lint` — 846f227
- [x] 2.5 The production build stays clean: `pnpm build` — 846f227

#### Manual

- [x] 2.6 A new plan is credited to you (name and email); seed plans show "Unknown" — 846f227
- [x] 2.7 A duplicate is credited to the duplicator — 846f227
- [x] 2.8 The board header shows the creator on a populated board and on an empty one — 846f227
- [x] 2.9 A service account shows its badge — 846f227
- [x] 2.10 No page-level horizontal scroll at phone width — 846f227

### Phase 3: Stop Ownership in the App

#### Automated

- [x] 3.1 Unit tests pass (`canStopJob`, `stoppedBy`, capability, PendingProposalPage, GenerationStatusStrip): `pnpm test` — c06fbaba
- [x] 3.2 The stop suite with signed-in cases is green — c06fbaba
- [x] 3.3 The generation suites are green — c06fbaba
- [x] 3.4 Type check passes: `pnpm check` — c06fbaba
- [x] 3.5 Lint and FSD checks pass: `pnpm lint && pnpm steiger` — c06fbaba
- [x] 3.6 The build is clean: `pnpm build` — c06fbaba

#### Manual

- [x] 3.7 Author B sees "Requested by A" and no Stop; the admin sees Stop — c06fbaba
- [x] 3.8 After the admin stops A's job, A sees "Stopped by <admin>" and the admin sees "You stopped" — c06fbaba
- [x] 3.9 A legacy job (null requester) is stoppable by B, with neutral copy — c06fbaba

### Phase 4: E2E, FR-417 Guardrail and Docs

#### Automated

- [x] 4.1 The new and changed specs pass with the solver up — c03de1c0
- [x] 4.2 The full E2E suite passes: `pnpm test:e2e` — c03de1c0
- [x] 4.3 The full integration lane passes: `pnpm test:integration` — c03de1c0
- [x] 4.4 The local CI gate passes: `/verify` — c03de1c0

#### Manual

- [x] 4.5 The CLAUDE.md, README and roadmap edits read correctly — c03de1c0
