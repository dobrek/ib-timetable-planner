---
date: 2026-10-29T14:21:50+0100
researcher: Claude (Opus 5.5) for Dobromir Kropielnicki
git_commit: f3789b61d0f3dd59b21803f40bb6e69aabd375f9
branch: main
repository: dobrek/ib-timetable-planner
topic: "S-404 current-plan marker (FR-420): what the codebase needs to know before planning"
tags: [research, codebase, plans, plans-list, plan-detail, generation, proposals, rls, role-matrix, supabase]
status: complete
last_updated: 2026-10-29
last_updated_by: Claude (Opus 5.5)
---

# Research: S-404 current-plan marker (FR-420)

**Date**: 2026-10-29T14:21:50+0100
**Researcher**: Claude (Opus 5.5) for Dobromir Kropielnicki
**Git Commit**: `f3789b6` (`fix(fail-closed-roles): impl-review fixes`, equal to `origin/main`)
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

Roadmap S-404 (`context/foundation/roadmap.md:176-187`): _"An author can mark one plan as the current one, and every user sees which plan is current, on the plans list and on the plan itself."_ PRD FR-420 (`context/foundation/prd.md:242-248`) adds two rules: at most one plan is current (`:328`), and no plan is current at migration time (`:287`). The roadmap leaves one unknown to the plan phase (`:184-185`): **what happens to the marker when the current plan is deleted, and whether a pending proposal can carry it.**

This research covers four things: where the marker can live, what it collides with, every surface that must show it, and the closest existing code to copy.

## Summary

- **Nothing marks a plan as current today.** The `plans` row has six columns: `id, name, slot_grid_preset, created_at, updated_at, pending_proposal`. There is no lineage column, and no table enforces "at most one" across plans. The old `plan_variants.is_final` was dead code. It was dropped with its table in 2026-06, and that decision already said: _"If a human 'adopted/published' marker returns as a product need, it's an additive nullable column later."_ FR-420 is that marker returning.
- **S-403 is merged** (PR #167, 2026-10-29), so S-404 lands under fail-closed rules:
  - A **column on `plans`** is already covered by the four capability policies. Authors and admins may update it; viewers get 42501. The role matrix needs no new obligation.
  - A **new table** needs the four `CAPABILITY_POLICIES`, `READS` and `GRANTS` cells (a compile-time obligation), a fixture row, and the 8-privilege `anon` revoke.
  - The marker write keeps `defineDomainAction`'s default `requires: "edit"`, so the PRD's access table (`prd.md:352`) holds without further work.
- **A pending proposal must not carry the marker**, on the evidence. A pending plan:
  - shows a progress panel instead of a board;
  - is refused by the perspective views and the comparison page (which defeats FR-409 for viewers);
  - gets its board replaced by delivery;
  - can be deleted by up to seven best-effort system sweeps that bypass `deletePlan`;
  - can end up as an ordinary plan holding only its pins (the detach and orphan branches).

  `assertNotPending` plus the race-free `.eq("pending_proposal", false)` write filter already exist to copy. With a column design, an in-row `CHECK (not (is_current and pending_proposal))` would make this a database rule. `clone_plan` never copies a new column, so a fresh clone can never trip it.

- **Deleting the current plan is a normal author act.** The documented "adopt a proposal" workflow is _delete the source, rename the proposal_ (`20260828093000_…:39-45`). "At most one" allows zero current, so a plain delete that takes the marker with it is legal. It is also silent: viewers would lose "the current plan" with no notice. The two candidate behaviours are refusing ("mark another plan current first", copying `assertNoActiveJob`'s CONFLICT toast) or warning in `DeletePlanDialog`.
- **Where the marker can be stored.** Three designs have code precedent (see [Storage design options](#storage-design-options)):
  - (A) an `is_current` column with a global partial unique index;
  - (B) a singleton settings table with `on delete set null`;
  - (C) a one-row marker table keyed by `plan_id` with `on delete cascade`.

  (A) fits the matrix, the pending-proposal CHECK and every earlier doc that assumed "a column". Its costs are a two-step flip (Postgres checks non-deferrable unique indexes row by row) and the `moddatetime` trigger bumping "Last updated" on both plans. (C) gives an atomic single-statement upsert and no timestamp bump, in exchange for the new-table obligations.

- **Surfaces.** The hub (`PlansHub.tsx`) and the plan pages (through `loadPlanSummary` → `SidebarLayout`'s `plan` prop) are the two the roadmap names. The board loads its own plan row (`plan-detail/api/load.ts:58-59` → `BoardHeader` h1), so it needs separate plumbing. Perspective headers, the comparison page and print titles also name the plan.
- **Analog to copy:** `renamePlan`. Its chain is Zod input → domain function with the pending guard and `unwrapRow` → `defineDomainAction` (default `edit`) → `plans-client.ts` wrapper → a `DropdownMenuItem` in `PlanRowActions` → `refreshPage()`. That last step is the norm for plan-level metadata; the polling store reads job columns only.
- **New test hazard:** this is the first invariant that spans plans. Integration suites run `--maxWorkers=2`, and e2e is `fullyParallel` locally (`playwright.config` `:28`, workers 1 in CI). Any two tests that mark plans current will take the marker from each other.

## Detailed Findings

### 1. The `plans` table today

- **Columns:**
  - `id, name, slot_grid_preset, created_at, updated_at` come from `supabase/migrations/20260602185012_minimal_domain_schema.sql:91-97`.
  - `pending_proposal boolean not null default false` comes from `20260828093000_proposal_pending_and_delivery_vocabulary.sql:64-65`. Its column comment (`:67-68`) reads: "listed and openable read-only, refused by every edit path".
  - The generated Row type matches: `src/shared/api/database.types.ts:490-515`. It has `Relationships: []`, so `plans` has no outgoing FKs.
- **Constraints:** only the primary key. There are no CHECKs and no unique constraint on `name`. `pending_proposal` deliberately has no index (`20260828093000:30-31`). No multi-column CHECK exists on `plans` yet.
- **Trigger:** `plans_updated_at`, a `moddatetime(updated_at)` that runs before **every** update (`20260602185012:98-100`). The hub shows this value as "Last updated" (`plans-list/api/loader.ts:42`, `PlansHub.tsx:158`). Today a `pending_proposal` flip or a rename already bumps it.
- **FKs that point at `plans.id`:**
  - All plan-scoped tables cascade on delete.
  - The `generation_jobs` FKs differ:
    - `plan_id` (the source) cascades (`20260810200122_generation_jobs.sql:60`).
    - `proposal_plan_id` and `delivered_plan_id` are `on delete set null` (`:62`, `:95`). The rationale is at `:36-41`: "the job must outlive the plans it produced".
- **How a proposal is stored.** A proposal is an ordinary `plans` row named `Proposal — <source>` (`plan-detail/api/generation-job.ts:155`), with `pending_proposal = true` until delivery. Everything else lives on `generation_jobs`. After delivery the row is indistinguishable from a hand-made plan; only `generation_jobs.delivered_plan_id`/`delivery` remember it.
- **`clone_plan` latest definition.** It lives at `20260711174905_clone_plan_include_board.sql`; no later migration re-creates it. It inserts an explicit column list, `(name, slot_grid_preset)` (`:26-31`), so **a new `plans` column is never copied to a clone or a proposal**. That matches the existing rule that `pending_proposal` is "NEVER set by `clone_plan` itself" (`20260828093000:27-28`). Any future re-create must start from `20260711174905` (lessons.md, "Re-create SQL functions from the latest live definition").
- **Every place that lists `plans` columns explicitly**, and so would need a new column added:
  - `clone_plan`;
  - `scripts/gen-seed.mjs:37-43` / `supabase/seed.sql:5,848`;
  - the app selects at `plans-list/api/loader.ts:42`, `shared/api/load-plan-summary.ts:48-50`, `plan-detail/api/load.ts:58-60`, `plan-comparison/api/load-plan-analysis.ts:136-138`, `student-plan-view/api/loader.ts:81-83`, `teacher-plan-view/api/loader.ts:90-92`, and `plans-list/api/pending-guards.ts:155`.
  - No views or other functions reference `public.plans`.

### 2. Access control after S-403

- **Policies on `plans`.** `20261028200630_fail_closed_policies.sql:77-93` rewrote all 16 plan-scoped tables to the same four policies:

  | Policy                   | Command | Rule                                       |
  | ------------------------ | ------- | ------------------------------------------ |
  | `Readers read every row` | SELECT  | `using ((select private.can_read()))`      |
  | `Editors insert rows`    | INSERT  | `with check ((select private.can_edit()))` |
  | `Editors update rows`    | UPDATE  | `using (can_read) with check (can_edit)`   |
  | `Editors delete rows`    | DELETE  | `using (can_edit)`                         |

  A viewer's UPDATE therefore fails loudly with 42501. The helpers are at `20261028140939_user_roles.sql:104-120`.

- **The policies are row-level only.** Any author UPDATE may write any column. Column grants cannot tell an author from a viewer, because app roles are rows, not Postgres roles (`role-matrix.integration.test.ts:72-73`).
- **Role matrix** (`src/test/role-matrix-expectations.ts`):
  - `READS.plans` is at `:100`, and `WRITES.plans` (insert/update/delete allowed for author and admin only) at `:126-130`.
  - `CAPABILITY_POLICIES` is at `:238-243`, and `GRANTS.plans` (`anon: ANON_AUTO_GRANT_RESIDUE`) at `:271`.
  - The structural check (`role-matrix.integration.test.ts:211-216`) requires every plan-scoped RLS table to hold exactly the four policies.
  - `fixtureKey` (`src/test/access-probe.ts:169-175`) finds `plans` by `id`, user-keyed tables by `user_id`, and **every other table by a `plan_id` column**.
- **A new column on `plans`:** no `Record` key changes and no check looks at columns, so nothing is forced. The `WRITES.plans.update` probe writes `name` (`:535`). Marking current is not an access-control change, because the existing UPDATE capability already decides it. A new INVOKER RPC would not be forced into the hand-written `RPCS` union (`:58`, `:209-212`), but CLAUDE.md asks for the claim to be stated as a cell. A SECURITY DEFINER function would fail the "only `current_app_role` is DEFINER" check (`:235-247`) and is ruled out by CLAUDE.md anyway.
- **A new table:**
  - It becomes a **compile-time** obligation in `READS` and `GRANTS`.
  - It must hold exactly the four policies, which gives authors INSERT and DELETE on it.
  - It needs a fixture row in `buildFixture` (`:845-866`) and an 8-privilege `anon` revoke, as `generation_jobs` (`20260810200122:128-129`) and `user_roles` (`:72`) do. `GRANTS` would then read `anon: NONE`.
  - A table without a `plan_id` column breaks `fixtureKey`'s default branch.
- **Action layer:** `defineDomainAction({ input, run, requires = "edit" })` (`src/shared/lib/actions/define-domain-action.ts:19-35`). The chain is `requireSession` → `requireCapability` (FORBIDDEN / SERVICE_UNAVAILABLE) → `requireSupabase` → `runDomain`. `src/actions/action-capabilities.test.ts:69-80` walks every action, so a new `edit` action is covered automatically; only non-edit actions need a `NON_EDIT` entry (`:33-38`).

### 3. Proposal lifecycle, and where a marker would collide

The state machine (`generation-job.ts`, `generation-delivery.ts`, `entities/timetable/model/generation/job-delivery.ts`):

| State                     | `plans` row                              | Job                                        | Entered via                                                                          |
| ------------------------- | ---------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| Clone (milliseconds)      | `pending_proposal=false`, pins only      | none                                       | `createProposalPlan` → `clonePlan` (`generation-job.ts:148-160`)                     |
| Pending                   | `pending_proposal=true`                  | none → queued → running → terminal         | `markPending` (`:164-169`), `insertJob` (`:171-210`)                                 |
| Delivered = ordinary plan | `pending_proposal=false`, board replaced | `delivered_plan_id`, `delivery='proposal'` | `deliver()` (`generation-delivery.ts:289-369`)                                       |
| Swept                     | row deleted                              | survives, `proposal_plan_id` nulled        | failed or empty result or failing verdict (`:260, :311, :326`)                       |
| Detached                  | alive, un-pended, pins only              | `failed`, `proposal_plan_id=null`          | translation mismatch (`:351-355`)                                                    |
| Orphan released           | alive, un-pended, pins only              | gone (cascaded with source)                | `releaseOrphanProposal` (`release-orphan-proposal.ts:38-58`), after a 5-minute grace |

**Delivery's writes on the proposal, in order:**

1. `applyToProposal` calls the INVOKER RPC `apply_generated_placements`, a region replace with no pending check.
2. `clearPending`.
3. `markDelivered` (`generation-delivery.ts:357-363`).

Delivery never writes to the source (`20260828093000:39-45`). It runs on a server-side visit to either plan, or from the pending page's poll. The hub's poll never delivers (`plans-list/api/generation-status.ts:8-12`).

**If a pending proposal could carry the marker**, it would collide with:

1. **Delivery replacing its board under the marker.** That is delivery's whole purpose.
2. **Up to seven automatic deletes** (`generation-job.ts:106, :115, :167, :236`; `generation-delivery.ts:260, :311, :326`). All are best-effort and bypass `deletePlan`, so the current plan could vanish with no author acting.
3. **The detach and orphan branches**, which leave a "current" plan holding only its pins.
4. **The pending render.** It shows a progress panel instead of a board, and the perspective views (`student-plan-view/api/loader.ts:87`, `teacher-plan-view/api/loader.ts:96`) and the comparison page (`load-plan-analysis.ts:157`) refuse it. Viewers could not read the plan they are told is current, which defeats FR-409.
5. **The column's documented rule**, "refused by every edit path" (`20260828093000:68`).

**Precedents for refusing it:**

- `assertNotPending` (`plans-list/api/pending-guards.ts:39-57`, CONFLICT) for the check.
- `renamePlan`'s write filter `.eq("pending_proposal", false)` (`rename-plan.ts:22-28`), which closes the check-then-write race and reports "Plan not found."

**Residual gap that exists today:** `clearPending` runs before `markDelivered`. A crash between them leaves a non-pending plan whose job is still deliverable, and the next visit re-applies the region replace (`generation-delivery.ts:357-363`). If such a plan were marked current in that window, its board would still change once. The window is narrow, and the marker only raises the stakes of a gap that is already there.

**Generate from the current plan.** It is allowed and harmless: the source is never written, and only one active job is allowed per plan (`generation_jobs_active_per_plan`, `20260810200122:103-104`). The new proposal starts unmarked because `clone_plan` doesn't copy the column.

### 4. Deletion paths

- **User delete:** `deletePlan` (`plans-list/api/delete-plan.ts:22-26`) runs two guards, both throwing `DomainError("CONFLICT")`, which `useConfirmAction` shows as an error toast:
  - `assertNotPending(…, { allowTerminal: true })`;
  - `assertNoActiveJob` (`pending-guards.ts:74-93`).
- **Its confirm dialog** (`plans-list/ui/DeletePlanDialog.tsx:40-44`) lists student, course and placement counts. It has no notion of a special plan.
- **System deletes:** the seven sweeps listed in §3. Every one targets a **pending, never-delivered** clone. So if pending plans cannot be current, no system delete can ever remove the current plan.
- **Tests:** `src/test/factories/teardown.ts:46-50` deletes plans directly as service role and relies on cascades. E2E deletes through the UI (`e2e/support/planner.ts:106`), and the campaign runner through the action (`bench/campaign/runner.ts:150-151`).
- **The documented workflow deletes the plan most likely to be current.** "Merging into the source is exactly equal to deleting the source and renaming the proposal" (`20260828093000:42-44`; `rename-plan.ts:12-14`).

### 5. Every surface that identifies a plan

| Surface                         | Where                                                                                                                                  | Proposal status shown today                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Hub row: Name link              | `src/_pages/plans-list/ui/PlansHub.tsx:152-156`                                                                                        | only via the `Proposal — …` name                              |
| Hub row: Activity badge         | `PlansHub.tsx:159-161`, `ui/PlanIndicatorsCell.tsx:25-89`                                                                              | yes, while the job is active, undelivered or not yet notified |
| Hub row: actions menu           | `PlanRowActions`, `PlansHub.tsx:233-280` (Clone `:252`, Rename `:260`, Delete `:268`)                                                  | —                                                             |
| Board h1                        | `plan-detail/ui/chrome/BoardHeader.tsx:16` (via `PlanSummaryBar.tsx:44`, `PlannerBoard.tsx:235`)                                       | no                                                            |
| Board provenance strip          | `plan-detail/ui/chrome/GenerationStatusStrip.tsx:129-152`                                                                              | yes, for a delivered proposal                                 |
| Board print title / grid label  | `PlannerBoard.tsx:353-358, :369`                                                                                                       | no                                                            |
| Pending proposal page           | `plan-detail/ui/PendingProposalPage.tsx:43-44`                                                                                         | yes ("Proposal" eyebrow)                                      |
| Sidebar plan label / breadcrumb | `src/app/layouts/SidebarLayout.astro:106-122` / `:154-165` (breadcrumb not on the board, which is `fullWidth`)                         | no                                                            |
| Tab titles                      | `src/pages/plans/[id]/index.astro:119,124`, `courses.astro:28`, `students.astro:28`, `teachers.astro:31`, perspective routes `:32`     | pending page only                                             |
| Perspective headers (printed)   | `student-plan-view/ui/StudentPlanPage.tsx:59`, `teacher-plan-view/ui/TeacherPlanPage.tsx:116`                                          | no (pending → notice)                                         |
| Comparison                      | `plan-comparison/ui/PlanComparisonPage.tsx:32,127`, `ScoreboardTable.tsx:40`, `VerdictBlock.tsx:25`, `DriftBanner.tsx:59`              | no (pending excluded)                                         |
| Export file names               | `plan-detail/lib/export-file-name.ts:12`, `batch-export-workbooks.ts:75`, `entities/timetable/model/export/perspective-workbook.ts:58` | no                                                            |
| Dashboard / global nav          | `_pages/dashboard/ui/DashboardPage.astro`, `shared/config/nav.ts:18-21`                                                                | plans are not named                                           |

**Plumbing:**

- The hub loader selects `id, name, slot_grid_preset, updated_at` (`loader.ts:42`) into `PlanRow` (`:15-24`). It doesn't even select `pending_proposal`.
- `loadPlanSummary` (`shared/api/load-plan-summary.ts:15-25, :44-54`) feeds every plan-scoped route, and through the `plan` prop (`SidebarLayout.astro:13`, type `{ id; name }`) it feeds the sidebar. Adding the marker there reaches all of those routes at once.
- The board's own loader (`plan-detail/api/load.ts:58-59` → `planName` `:160`) and the comparison's `fetchPlan` each need the column separately. `bench/` depends on `fetchPlan`'s signature (`load-plan-analysis.ts:153-156`).
- `PlanIndicator` is a one-member union "held open" for another kind (`plans-list/model/plan-indicators.ts:13-24`). A Current marker is not _activity_, though; a badge in the Name cell matches the column's meaning better.

### 6. Nearest analog: `renamePlan`

1. **Input:** `renamePlanInput` (`plans-list/model/schemas.ts:21-24`). The closest id-only shape is `deletePlanInput` (`:26-28`).
2. **Domain function:** `plans-list/api/rename-plan.ts:21-36`. It runs `assertNotPending`, then `.update({…}).eq("id").eq("pending_proposal", false).select().single()`, then `unwrapRow(…, { notFound, failure })`.
3. **Action:** `plans-list/api/actions.ts:19`, `renamePlan: defineDomainAction({ input, run })`, with the default `edit`. It is spread into `server` at `src/actions/index.ts:28`.
4. **Client wrapper:** `plans-list/api/plans-client.ts:19`, via `callAction` (`shared/lib/forms/call-action.ts:15-21`). UI must not import `astro:actions` directly (`ui-conventions.md:191-215`).
5. **Call site:**
   - A form uses `submitForm` → toast → `refreshPage()` (`shared/lib/forms/submit-form.ts:26-37`, `refresh-page.ts:4-6`).
   - A one-click or confirm action uses `useConfirmAction(call, { successMessage, onDone })` (`shared/lib/forms/use-confirm-action.ts:12-49`), as `DeletePlanDialog.tsx:25-29` does.
   - There is no optimistic update. `ui-conventions.md:257` says other mutations `navigate()` to re-run the server loader.
6. **Tests:**
   - `plans-list/api/plan-actions.integration.test.ts:53-74` (round trip) and `:152-200` (pending guards);
   - `api/action-boundary.integration.test.ts:79-93` (handler-level NOT_FOUND);
   - `model/schemas.test.ts`;
   - automatic coverage in `action-capabilities.test.ts`.

### 7. How the UI learns the caller's capability

No island receives a `canEdit` or capability prop yet (`roadmap.md:91`: "no `canEdit` gating anywhere"). `Astro.locals.access` is set by the middleware (`src/middleware.ts:49`). `allows(access, capability)` lives at `shared/config/access-state.ts:12-15`. Only `.astro` files read it today: `SidebarLayout.astro:19,31` and `DashboardPage.astro:5,9`, both for nav visibility.

For S-404 there are two choices:

- Show "Mark as current" to everyone and let the action refuse a viewer with FORBIDDEN, surfaced as an error toast.
- Thread `allows(Astro.locals.access, "edit")` from `src/pages/plans/index.astro` into `PlansHub`. That would be the first such island prop, which S-405 otherwise introduces.

## Storage design options

The research found code precedent for each design. All three satisfy "no plan current at migration" without a backfill.

|                           | **A. `plans.is_current` + global partial unique index**                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **B. Singleton settings table, `current_plan_id … on delete set null`**                                                                                                     | **C. One-row marker table keyed by `plan_id`, `on delete cascade`**                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Precedent                 | `pending_proposal` boolean flag; partial unique indexes `generation_jobs_active_per_plan` (`20260810200122:103-104`), `bundles_cell_unique` (`20260624120000:33-36`). Neither is global; a global one would be `create unique index … on plans (is_current) where is_current`.                                                                                                                                                                                                                                       | Set-null FKs on `generation_jobs` (`:62, :95`). **No singleton or settings table exists.**                                                                                  | Cascading `plan_id` FK, as every plan-scoped table has.                                                                                                      |
| At most one               | Database-enforced                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | By construction (one row)                                                                                                                                                   | One-row constraint, e.g. a `boolean primary key default true check (…)`                                                                                      |
| Pending proposal excluded | In-row `CHECK (not (is_current and pending_proposal))`, enforced by the database                                                                                                                                                                                                                                                                                                                                                                                                                                     | App guard (or a trigger) only                                                                                                                                               | App guard (or a trigger) only                                                                                                                                |
| Moving the marker         | Two writes: unset the old, then set the new. **Postgres checks a non-deferrable unique index per row, not per statement** (Postgres docs, CREATE TABLE compatibility note), so a one-statement `set is_current = (id = $1)` can fail 23505 depending on row order. Options: two ordered PostgREST updates (a crash in between leaves zero current, which is legal) or one INVOKER RPC (CLAUDE.md wants an `RPCS` cell for it). Two concurrent movers: one gets 23505, mapped to CONFLICT by `to-domain-error.ts:16`. | One `update`                                                                                                                                                                | One upsert `on conflict (…) do update`; authors already hold INSERT and UPDATE under the four policies                                                       |
| Deleting the current plan | The marker leaves with the row: zero current                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | The FK nulls it: zero current                                                                                                                                               | The cascade removes the row: zero current                                                                                                                    |
| "Last updated" on the hub | **Bumped on both plans** by `plans_updated_at` (`20260602185012:98-100`). Avoiding that means re-creating the trigger with `before update of <cols>`, a drop-and-create that sits awkwardly with the additive-only rule.                                                                                                                                                                                                                                                                                             | Untouched                                                                                                                                                                   | Untouched                                                                                                                                                    |
| Role-matrix work          | None forced; existing `WRITES.plans.update` governs it                                                                                                                                                                                                                                                                                                                                                                                                                                                               | New table: four policies, `READS`/`GRANTS` cells, fixture row, `anon` revoke, migration-seeded row on hosted. Has no `plan_id`, so it breaks `fixtureKey`'s default branch. | New table: four policies, `READS`/`GRANTS` cells, fixture row (which marks the fixture plan current, a global effect inside the matrix suite), `anon` revoke |
| Reads                     | Same row, so the marker comes "for free" in every existing select once the column is added                                                                                                                                                                                                                                                                                                                                                                                                                           | Extra query or join per surface                                                                                                                                             | Extra query or embed per surface                                                                                                                             |
| Fit with earlier docs     | Matches 2026-06 "additive nullable column later", `stack-assessment.md:115` and `health-check.md:405` ("current plan" columns)                                                                                                                                                                                                                                                                                                                                                                                       | —                                                                                                                                                                           | —                                                                                                                                                            |

## Evidence for the roadmap's two unknowns (not decisions)

**(b) Can a pending proposal carry the marker?** The evidence says no: see the five collisions in §3. Refusing it is cheap:

- an `assertNotPending`-style guard plus `.eq("pending_proposal", false)` on the write;
- under design A, also the in-row CHECK.

`markPending` cannot trip such a CHECK, because a fresh clone always gets the column default. A delivered proposal is an ordinary plan and may be marked; that is the adopt step.

**(a) What happens when the current plan is deleted?** "At most one" permits zero, so every design can clear the marker with the row. The choice is about how loud that is:

- **Clear silently.** This is the cheapest option and fits every delete path, including teardown. The risk is that viewers quietly lose "the current plan", the very confusion FR-409 exists to prevent.
- **Clear with a warning.** Pass "is current" to `DeletePlanDialog` and add a line such as "This is the current plan; no plan will be current after you delete it."
- **Refuse:** "Mark another plan current first." This copies `assertNoActiveJob`'s CONFLICT message and toast. It turns the adopt workflow into "mark the proposal current, then delete the source", which is arguably the right order. If pending plans cannot be current, no system sweep ever hits this guard. Do it **only** as an app guard: a database `on delete restrict` would break `teardown.ts:48` and the cascade assumption.
- **Hand the marker to a successor.** Not viable: `plans` has no lineage, and the lineage on `generation_jobs` cascades away with the source.

## Code References

Permalinks are at commit `f3789b6`.

- [`supabase/migrations/20260602185012_minimal_domain_schema.sql:91-100`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/supabase/migrations/20260602185012_minimal_domain_schema.sql#L91-L100): `plans` table and the `moddatetime` trigger
- [`supabase/migrations/20260602185012_minimal_domain_schema.sql:103-110`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/supabase/migrations/20260602185012_minimal_domain_schema.sql#L103-L110): the old `plan_variants.is_final`
- [`supabase/migrations/20260611180006_plans_as_domain_root.sql:127`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/supabase/migrations/20260611180006_plans_as_domain_root.sql#L127): `drop table plan_variants`
- [`supabase/migrations/20260711174905_clone_plan_include_board.sql:26-31`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/supabase/migrations/20260711174905_clone_plan_include_board.sql#L26-L31): `clone_plan` copies only `(name, slot_grid_preset)`
- [`supabase/migrations/20260810200122_generation_jobs.sql:36-41,60-62,95,103-104`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/supabase/migrations/20260810200122_generation_jobs.sql#L36-L41): job FKs (cascade / set null) and the per-plan partial unique index
- [`supabase/migrations/20260828093000_proposal_pending_and_delivery_vocabulary.sql:25-45,64-72`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/supabase/migrations/20260828093000_proposal_pending_and_delivery_vocabulary.sql#L25-L45): `pending_proposal` rules, "delete the source and rename the proposal"
- [`supabase/migrations/20261028200630_fail_closed_policies.sql:75-94`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/supabase/migrations/20261028200630_fail_closed_policies.sql#L75-L94): the four capability policies
- [`src/test/role-matrix-expectations.ts:100,125-131,238-243,271`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/src/test/role-matrix-expectations.ts#L125-L131): `READS`/`WRITES`/`CAPABILITY_POLICIES`/`GRANTS` for `plans`
- [`src/test/access-probe.ts:169-175`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/src/test/access-probe.ts#L169-L175): `fixtureKey` assumes `plan_id`
- [`src/test/role-matrix.integration.test.ts:211-216`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/src/test/role-matrix.integration.test.ts#L211-L216): structural catalog check
- [`src/_pages/plans-list/api/loader.ts:15-24,40-44`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/src/_pages/plans-list/api/loader.ts#L40-L44): hub query and `PlanRow`
- [`src/_pages/plans-list/ui/PlansHub.tsx:131-172,233-280`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/src/_pages/plans-list/ui/PlansHub.tsx#L131-L172): hub table and `PlanRowActions`
- [`src/_pages/plans-list/api/rename-plan.ts:21-36`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/src/_pages/plans-list/api/rename-plan.ts#L21-L36): analog domain function, race-free pending filter
- [`src/_pages/plans-list/api/pending-guards.ts:39-57,74-93`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/src/_pages/plans-list/api/pending-guards.ts#L39-L57): `assertNotPending`, `assertNoActiveJob`
- [`src/_pages/plans-list/api/delete-plan.ts:22-26`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/src/_pages/plans-list/api/delete-plan.ts#L22-L26): user delete with guards
- [`src/_pages/plans-list/ui/DeletePlanDialog.tsx:25-44`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/src/_pages/plans-list/ui/DeletePlanDialog.tsx#L25-L44): confirm dialog, `useConfirmAction`
- [`src/_pages/plans-list/api/actions.ts:15-30`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/src/_pages/plans-list/api/actions.ts#L15-L30): plan actions
- [`src/shared/lib/actions/define-domain-action.ts:19-35`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/src/shared/lib/actions/define-domain-action.ts#L19-L35): `requires` default `edit`
- [`src/shared/api/load-plan-summary.ts:15-25,44-54`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/src/shared/api/load-plan-summary.ts#L44-L54): the plan context every plan-scoped page reads
- [`src/app/layouts/SidebarLayout.astro:12-18,106-122,154-165`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/src/app/layouts/SidebarLayout.astro#L106-L122): `plan` prop, sidebar label, breadcrumb
- [`src/_pages/plan-detail/api/load.ts:58-60,160`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/src/_pages/plan-detail/api/load.ts#L58-L60): the board's own plan read
- [`src/_pages/plan-detail/ui/chrome/BoardHeader.tsx:16`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/src/_pages/plan-detail/ui/chrome/BoardHeader.tsx#L16): board h1
- [`src/_pages/plan-detail/api/generation-job.ts:148-169,265-269`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/src/_pages/plan-detail/api/generation-job.ts#L148-L169): proposal creation, `markPending`, the enqueue sweep
- [`src/_pages/plan-detail/api/generation-delivery.ts:289-369,544-586`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/src/_pages/plan-detail/api/generation-delivery.ts#L289-L369): delivery, `clearPending`, `markDelivered`, the delivery sweep
- [`src/_pages/plan-detail/api/release-orphan-proposal.ts:38-58`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/src/_pages/plan-detail/api/release-orphan-proposal.ts#L38-L58): orphan release
- [`src/test/factories/teardown.ts:46-50`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/src/test/factories/teardown.ts#L46-L50): direct deletes relying on cascades
- [`playwright.config.ts:28-31`](https://github.com/dobrek/ib-timetable-planner/blob/f3789b61d0f3dd59b21803f40bb6e69aabd375f9/playwright.config.ts#L28-L31): `fullyParallel: true`, 1 worker in CI

## Architecture Insights

- **The first cross-plan invariant.** Every table today is keyed by a plan or a user. "At most one current" is the first fact about the set of plans, so it changes three things:
  - The role matrix's two-kind table model (plan-scoped / user-keyed) has no slot for a global table (design B).
  - The test-isolation assumption breaks. Factories and teardown assume each test owns its plans (`create-plan.ts:12-16`, `teardown.ts:3-7`), so concurrent suites or specs that mark plans current interfere. The plan should confine marker-moving tests to one file, or assert only the plan's own marked state right after marking.
  - The hub stops being a list of peers. That reverses the 2026-06 "plans are peers" decision on purpose, and the comparison page's deliberate "no baseline" naming (`archive/2026-07-14-comparing-plans/change.md:30-36`) should not be undone by treating "current" as a baseline there.
- **Pending is the existing read-only state.** The marker should stay out of it, and the codebase already has the guards to do that. Board mutations are deliberately unguarded (`pending-guards.ts:19-21`); metadata actions (rename, clone, delete) are guarded. A mark-current action belongs with the metadata actions.
- **Plan-level metadata changes go through `refreshPage()`.** No live push exists. Another author's move shows up on the next reload, the same as a rename. The polling store (`shared/lib/polling-store/`) reads job columns only and needs no change.
- **FR-420 says nothing about freezing.** The Socrates notes raised "should marking freeze it?" and resolved "stands as written" (`prd.md:246-248`). The current plan stays fully editable, and a plan must not invent a freeze.

## Historical Context (from prior changes)

- `context/archive/2026-06-01-minimal-domain-schema/plan.md:178,392` introduced `plan_variants.is_final`, and nothing enforced its uniqueness. It traced to the original FR-014 "mark exactly one variant per plan as final" (`context/foundation/archive/2026-06-18-shape-notes.md:146`).
- `context/archive/2026-06-11-multi-variant-management/` dropped it:
  - `research.md:60` and `:226`: "dead — never read/written by app code"; plans became peers.
  - `research.md:231`: "an additive nullable column later … records a social fact metrics can't derive".
  - `plan-brief.md:27-28` and `plan.md:44` record the same; `plan.md:45` also rejected an ambient "active-plan" cookie.
  - The archived PRD has FR-014 removed (`context/foundation/archive/2026-06-18-prd.md:122-123`).
- `context/foundation/shape-notes.md:42-43, 292-298, 462` added FR-420 during shaping to resolve FR-409's labelling. It names `plans.pending_proposal` as today's only marker.
- `context/archive/2026-08-25-drift-decided-delivery/` decided:
  - proposal-as-plan, and the `pending_proposal` flag (`plan.md:119`);
  - `assertNotPending` for rename, clone and delete (`plan.md:440-459`);
  - the delete-refusal rules (`plan-brief.md:41-42`);
  - "no retention policy … Delete is the act" (`plan.md:107-108`).
- `context/archive/2026-08-31-generation-deletion-integrity/` explains why `delivery` is the durable fact while `delivered_plan_id` can be nulled by its FK.
- `context/archive/2026-08-19-staged-progress-and-checkpoints/plan.md:605-611` is the precedent for the hub's `Badge`-based `PlanIndicatorsCell` with `role="status"` and semantic tokens.
- `context/archive/2026-10-16-account-self-service/research.md:459` names "feedback that survives a reload" as a missing primitive and expects S-404 to hit it.
- `context/changes/fail-closed-roles/` (S-403) never mentions S-404. The rules that bind it are the general ones written into CLAUDE.md (`plan.md:612-613`).

## Related Research

- `context/archive/2026-06-11-multi-variant-management/research.md`: the decision that removed the old marker
- `context/archive/2026-08-25-drift-decided-delivery/` (plan, plan-brief): the proposal-as-plan model this marker must coexist with
- `context/changes/fail-closed-roles/research.md`: the policy and matrix model S-404 now lands under
- `context/changes/user-managment-research/research.md`: M-02 research; it says nothing about the marker beyond "a viewer reads all plans, including proposals" (`:500`)

## Open Questions

For the plan phase, and the user where noted:

1. **Storage design:** A (column), B (settings table) or C (marker table). On the evidence, A has the least new machinery and the only database-level pending exclusion. Its two costs need an explicit decision:
   - How to flip: ordered two-step PostgREST updates or an INVOKER RPC with an `RPCS` cell.
   - Whether "Last updated" bumping on both plans is acceptable, or the trigger is narrowed to content columns.
2. **Deleting the current plan:** clear silently, clear with a dialog warning, or refuse with "mark another plan current first". This is a product call (owner: user). It shapes the adopt workflow's order.
3. **Can the marker be cleared without moving it?** "At most one" permits zero. Should there be an explicit "Unmark", or only "Mark another"?
4. **Hub presentation:**
   - Use a "Current" badge in the Name cell, not the Activity column (which is for jobs).
   - Should the current plan sort first (today `order("name")`)?
   - Is the "Mark as current" item hidden on the current row or on pending rows, or shown disabled?
5. **Which plan-level surfaces show it:** the board h1 (the board has its own loader), the sidebar label (via `loadPlanSummary` → `plan` prop), perspective headers (they print), the comparison page (without "baseline" semantics), and tab titles. The roadmap requires only "the plans list and the plan itself".
6. **Capability gating now or in S-405:** show the control to everyone and rely on FORBIDDEN, or thread `allows(access, "edit")` into `PlansHub` as the first island capability prop.
7. **Test isolation:** confine marker-moving integration and e2e tests to one file each. E2E is `fullyParallel` locally, and integration runs `--maxWorkers=2`.

**Doc drift to fix (not S-404 scope, found on the way):**

- S-403's docs still read "not merged":
  - `fail-closed-roles/change.md` says `status: impl_reviewed`;
  - the Progress rows 5.5–5.8 are unchecked;
  - `reviews/impl-review.md:5` says "PR 2 #167 open";
  - the roadmap still says `in-progress`.

  Yet PR #167 merged on 2026-10-29.

- Roadmap `:186` and issue #145 still describe S-404 landing _before_ S-403; that branch is gone.
- Roadmap `:303` says "any order with S-401", and S-401 is done.
