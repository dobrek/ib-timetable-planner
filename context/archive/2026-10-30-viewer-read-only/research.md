---
date: 2026-10-30T09:17:17+0100
researcher: Claude (Opus 5.5) for Dobromir Kropielnicki
git_commit: b0b9c0bc39945635854cb4869391fc3a85519f04
branch: main
repository: dobrek/ib-timetable-planner
topic: "S-405 viewer-read-only (FR-409): is it feasible, how big is it, and what does Open Question 1 cost each way?"
tags: [research, codebase, viewer, roles, plan-detail, plans-list, catalog, generation, delivery, proposals, labelling, e2e, role-matrix]
status: complete
last_updated: 2026-10-30
last_updated_by: Claude (Opus 5.5)
last_updated_note: "Added follow-up research on what option (a), wait for an author, means in practice; recorded the user's choice of (a)"
---

# Research: S-405 viewer-read-only: feasibility

**Date**: 2026-10-30T09:17:17+0100
**Researcher**: Claude (Opus 5.5) for Dobromir Kropielnicki
**Git Commit**: `b0b9c0b` (`chore(archive): close current-plan-marker`, equal to `origin/main`)
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

How feasible is roadmap slice S-405 (`context/foundation/roadmap.md:189-200`; PRD FR-409, `context/foundation/prd.md:209-212`)?

> A viewer can read every plan and proposal, including the teacher and student perspective views, export timetables and use the comparison page, with no edit affordance anywhere, and can always tell a proposal or draft from the plan marked current.

The roadmap marks it `blocked` on Open Roadmap Question 1 (`roadmap.md:315`; PRD Open Question 1, `prd.md:394-397`): a finished proposal is delivered under the visitor's session, and a viewer cannot write.

## Summary

**Verdict: feasible, and smaller than it looks if Open Question 1 is answered "wait for an author".** In that case it is a UI sweep plus one small backend split. It needs no migration and no access-control change, and it bends no CLAUDE.md rule. Answering "deliver regardless of who looks" turns it into a much larger change that bends at least one recorded rule.

- **The enforcement is already live.** S-403 PR 2 merged on 2026-10-29 (#167), and S-404 merged the same day (#168). RLS refuses every viewer write. Every action except four defaults to `requires: "edit"` and answers a viewer with `FORBIDDEN`. The role matrix already proves viewer SELECT on all 16 plan-scoped tables. **S-405 adds no security. It removes affordances and stops one page-load path from trying to write.**
  - Roadmap bookkeeping is behind: S-403's row still says `in-progress`, its change folder is `impl_reviewed` and not archived, and several manual Progress rows are unchecked.
- **Nothing on a read path breaks except one chain.** Every page loads data in frontmatter with plain SELECTs. Export is client-side. Comparison and the perspective views are pure reads, and no read-shaped action defaults to `edit`.
  - **The single cause of breakage** is that a visit to `/plans/[id]` runs `checkPlan` and `releaseOrphanProposal` as direct domain calls (`src/pages/plans/[id]/index.astro:50,67`). The pending page also polls `checkPlan` every 5 s (it is declared `read` but writes).
  - Under a viewer, that chain tries to deliver, reclaim, fail or sweep, and RLS refuses. The visible results: "status could not be read" on a finished proposal, a stale job polled forever (about 124–160 KB re-read and re-verified on every tick), "failed" shown while the database says otherwise, and `INTERNAL_SERVER_ERROR` where `FORBIDDEN` was meant.
- **Edit affordances.** About 6 islands need a capability prop: `PlansHub`, `PlannerBoard`, `PendingProposalPage`, `CourseCatalog`, `TeacherCatalog` and `StudentCatalog`. About 25–30 files gate controls.
  - No island receives `access` today (`rg canEdit` finds nothing).
  - The plan-detail board has four usable seams: the `CellWiring` record, the five draggables' `disabled` option, the palette's derived-state dispatch `resolvePaletteView`, and the header's `trailing` / `undoRedo` slots. With those seams it is a gate, not a rebuild.
  - The roadmap's hint to reuse `widgets/timetable-board` for a viewer board does not hold: that grid shows one person, with days as columns, and cannot stand in for the two-cohort `PlannerGrid`.
- **Open Question 1.** **Option (a), wait for the next author or admin, is the recommendation.**
  - Split `checkPlan` into a pure read (a new `read` action plus an SSR branch on `allows(access, "edit")`) and the existing delivering path, which becomes `edit`.
  - That fixes all four symptoms S-403 handed over, keeps FR-417 exactly, and needs no schema change.
  - **Its cost:** an undelivered proposal stays unreadable for a viewer (a "finished — waiting for an author" panel; perspective views and comparison already refuse a pending plan) until an author or admin opens it. That conflicts with FR-409's literal "read every … proposal", so it needs your decision.
  - Option (b) needs a write identity outside the visitor's session. Every candidate (solver-side delivery, a trigger, a second SECURITY DEFINER RPC, the secret key, the machine password) bends a recorded rule or the FR-313 oracle guarantee, and earlier changes rejected each one by name.
  - Option (c) shows an in-memory, read-only preview of the undelivered board. It is possible and touches no rule, but it is medium to large and builds a third rendering path.
- **Labelling gaps.** "Current" shows on the hub row, the sidebar, the breadcrumb and the board heading. It is missing from the comparison page, exports, the printed perspective views and tab titles. A delivered proposal is labelled only by the board's "Generated from …" strip, and only while its source plan exists.
- **Test harness:** mostly ready.
  - The matrix and `createSignedInUser({ role: "viewer" })` exist.
  - A viewer e2e account takes about six mechanical edits.
  - The real cost is data setup: every e2e spec builds its data through the author's UI, which a viewer cannot use, so viewer specs need a second browser context on the author's storage state.

## Detailed Findings

### 1. Prerequisites: done in code, behind on paper

- **S-403 shipped as two PRs:** #166 (roles, backfill; merged 2026-10-28) and #167 (fail-closed policies plus the app following the role; merged 2026-10-29). The migrations `20261028140939_user_roles.sql` and `20261028200630_fail_closed_policies.sql` are on `main`.
- **S-403's paperwork is incomplete:**
  - `context/changes/fail-closed-roles/change.md` says `status: impl_reviewed`.
  - Progress rows 2.11, 3.7–3.8, 4.7–4.10 and 5.4–5.8 are unchecked (`context/changes/fail-closed-roles/plan.md:740-811`).
  - Browser evidence for 4.7–4.10, including "viewer edits refused and rolled back", is recorded in `change.md` but awaits human sign-off.
  - The roadmap row still says `in-progress` (`roadmap.md:50`). Archiving S-403 flips it.
- **S-404** is archived and `done` (`roadmap.md:51`; `context/archive/2026-10-29-current-plan-marker/`).
- So the only real blocker left is the answer to Open Question 1.

### 2. The role plumbing S-405 builds on

- **The middleware** sets `Astro.locals.access` (`src/middleware.ts:49`, typed at `src/env.d.ts:8`). The type is `AccessState = {status:"granted"; role} | {status:"none"} | {status:"unavailable"}` (`src/shared/config/access-state.ts:9`).
- **`allows(access, cap)`** (`access-state.ts:12`) and `grants` (`capability.ts:11`) live in the client-safe `@/shared/config` barrel. A viewer gets `["session", "read"]` (`capability.ts:19`).
- **Today only two places read `access`:**
  - `src/app/layouts/SidebarLayout.astro:23,35`, for nav filtering;
  - `src/_pages/dashboard/ui/DashboardPage.astro:5`, a slice-level `.astro` component reading `Astro.locals` directly. That is the precedent for the per-page wrappers S-405 would use.
- **Nav needs nothing new.**
  - `NavItem.requires` plus `visibleNavItems` (`src/shared/config/nav.ts:31-36`) is the seam S-403 left for S-405 (`fail-closed-roles/plan.md:501`).
  - Plan sub-nav items carry no `requires` (`nav.ts:24-29`), but every one of those pages is read-capable.
- **Actions.**
  - `defineDomainAction`'s `run` receives `(supabase, input)` only, never the caller's access (`src/shared/lib/actions/define-domain-action.ts:21,29`). So one action cannot branch on role. A read/write split has to be two actions.
  - Only four actions declare less than `edit`: `updatePassword` and `updateDisplayName` (`session`), and `readGenerationJobStatuses` and `checkPlan` (`read`). This is pinned in `src/actions/action-capabilities.test.ts:33-38`, which walks every action in the composition root.

### 3. Edit affordances a viewer sees today

No island receives an access prop. Every write control below is visible to a viewer, and each is refused server-side.

**plans-list** (`src/pages/plans/index.astro:14` → `PlansListPage.astro:16` → `PlansHub`, `client:load`):

- "New plan", in the header (`PlansHub.tsx:103`) and in the empty state (`:119`) → `createPlan`.
- The row kebab `PlanRowActions` (`PlansHub.tsx:271-313`): Clone → `clonePlan`, Rename → `renamePlan`, Mark/Unmark current (S-404, `:294-302`) → `markCurrentPlan`/`unmarkCurrentPlan`, and Delete → `deletePlan`.
- **Keep:** the row checkboxes and `ComparePlansBar`, which drive Compare (`:130,151`), and the hub poll `readGenerationJobStatuses`.

**plan-detail** (`src/pages/plans/[id]/index.astro:131` → `PlanDetailPage.astro:39` → `PlannerBoard`, or `PendingProposalPage` for a pending proposal):

- **Drag and drop.** There is one `DragDropProvider` (`ui/chrome/BoardShell.tsx:50`) and one drop dispatch, `applyDropAction` (`model/cross-cohort/drop-dispatch.ts:33-85`).
  - The draggables are the placed chip (`slot-cell/PlacedChip.tsx:66-70`), the bundled cell (`SlotCell.tsx:200-204`), the palette course (`palette/PaletteBody.tsx:97`), the grouping box (`GroupingBox.tsx:35`) and the parked card (`shelf/ParkedBundleCard.tsx:31`).
  - The droppables are each cell and the shelf.
- **Cell header** (`SlotHeader.tsx`): Duplicate (`:52`), Lift to shelf (`:61`) and Remove all (`:71`). The Group/Ungroup toggle (`:39`) is local state and harmless.
- **Chip:** the A/B `WeekToggle` (`PlacedChip.tsx:125`) → `updatePlacementWeek`, and the `ChipMenu` (`ChipMenu.tsx:59-87`) with optional/accept and remove.
- **Shelf:** discard (`ParkedBundleCard.tsx:59-72`) → `deleteShelfBundle`.
- **Palette:** "Compute groupings" (`ComputeGroupingsEmptyState.tsx:33`) and "Recompute" (`GroupingStalePanel.tsx:42`) → `computeGroupings` (compute plus persist through `replace_cohort_groupings`).
  - **This is a viewer dead end in focus mode.** With `?focus=dp1|dp2` and no groupings for that cohort, the board is *replaced* by the compute prompt (`PlannerBoard.tsx:233-245`), so a viewer sees no timetable.
  - The default `combined` focus (`index.astro:20-22`) puts the prompt inside the palette panel instead (`CombinedPalettePanel.tsx:108-110`), and the board still renders.
- **Generate:** the trigger, the solve-policy `ToggleGroup` and the confirm (`chrome/GenerateButton.tsx:95,123,151`) → `startGeneration`.
- **Stop & keep:** only on the pending page (`PendingProposalPage.tsx:75`; `StopAndKeep.tsx:90,114`) → `stopGeneration`. Viewers may not stop a job (PRD access table, `prd.md:351`).
- **Undo/redo:** the buttons (`UndoRedoControls.tsx:32-55`) and ⌘Z. They are inert for a viewer, because history records only after a successful write (`placement/write-context.ts:30`), but they still render, disabled.
- **Fine as they are:** export (`ExportMenu.tsx`, client-side), lens, zoom, hint mode, print and shelf pin.

**courses** (`courses.astro:39` → `CourseCatalog`): "New merge" and "New course" (`CourseCatalog.tsx:43,47`), and the row kebab Edit, Manage overlaps, Manage merge and Delete (`CourseTable.tsx:150-191`).

- The `OverlapBadge` (`CourseTable.tsx:111-142`) is **both** the only place overlaps are shown and the button that opens the editing dialog.

**teachers** (`teachers.astro:42` → `TeacherCatalog`): New teacher (`TeacherCatalog.tsx:43`; `TeacherTable.tsx:49`), and a kebab that mixes "View plan" (keep, `:166`) with Edit, Edit availability and Delete (`:158-193`).

- The `AvailabilityBadge` (`:202-226`) opens `TeacherAvailabilityDialog`, whose grid is made entirely of write buttons (column, row and cell, `:135,149,161`).

**students** (`students.astro:39` → `StudentCatalog`): New student (`StudentCatalog.tsx:54`; `StudentTable.tsx:49`), the selection checkboxes plus `BulkActionBar` → `bulkEditChoices` (`StudentCatalog.tsx:78`; `BulkChoiceDialog.tsx:244`), and a kebab with "View plan" (keep), Edit and Delete (`StudentTable.tsx:149-177`).

**No write controls:** `plan-comparison`, `teacher-plan-view`, `student-plan-view`, `widgets/timetable-board` and `entities`. None of them imports `astro:actions`. `account` writes only the caller's own rows, which a viewer may do.

**Seams on the board.** No single switch hides everything. Four seams cover it:

1. **`CellWiring`** (`ui/grid/PlannerGrid.tsx:32-52`). It is built once per column in `buildColumn` (`PlannerBoard.tsx:204-231`) and already carries all eight cell and chip handlers. A read-only flag here reaches `SlotCell`, `SlotHeader`, `PlacedChip`, `WeekToggle` and `ChipMenu` in one pass. The house idiom already exists: an absent handler means the control is not rendered (`widgets/timetable-board/ui/ScheduleGrid.tsx:28,187`, where an absent `onInspect` means no badge).
2. **The draggables' `disabled:` option**, in five files. A guard in `applyDropAction` alone would stop writes, but the grab cursor and drag feedback would stay.
3. **`resolvePaletteView`** (`model/grouping/palette-view.ts:15-25`). This is the established derived-state dispatch, and the right place for a read-only branch, in line with the "orchestration over patching" preference. It also removes the focus-mode early return.
4. **The header slots** `trailing` / `undoRedo` (`PlannerBoard.tsx:296-299`): Generate and Undo/Redo are simply not rendered.

The per-cohort `actions` record (`model/use-cohort-board-state.ts:330-344`) is the single write surface. Turning it into a no-op would block writes but hide nothing, so it is not a UI seam.

**Sizing.**

- About 6 island roots get one new prop, fed from 5 routes or the slice `.astro` wrappers.
- About 25–30 files gate controls: plan-detail ≈ 14, plans-list 1, courses 2–3, teachers 3–4, students 2.
- No write control is shared across slices. The repeated pattern is the row-kebab `DropdownMenu` in four tables and the `useConfirmAction` / `submitForm` flows.

### 4. Writes that run without an edit click: the only thing that breaks

**Why a viewer's write fails the way it does:**

- UPDATE policies are `using can_read with check can_edit`, so a viewer's UPDATE reaches the row and fails loudly with 42501.
- INSERT fails with 42501.
- DELETE's USING is `can_edit`, so it silently matches 0 rows.
- Sources: `supabase/migrations/20261028200630_fail_closed_policies.sql:20-22,85-91`.

**Three triggers reach the chain:**

- the SSR visit to `/plans/[id]`, on the source or the proposal (`index.astro:50,67`);
- the pending page poll every 5 s (`model/generation/use-pending-proposal.ts:60,74`; `DEFAULT_POLL_INTERVAL_MS = 5000`);
- the board strip's Refresh (`use-generation-job.ts:65`; `GenerationStatusStrip.tsx:77,95`).

The `/plans` SSR loader and its poll only read (`plans-list/api/generation-status.ts:8-12,37-103`), so they never deliver.

| Write | Where | Table / RPC | What a viewer gets today |
|---|---|---|---|
| Reclaim a stale job | `generation-reclaim.ts:49-76` | `generation_jobs` UPDATE → interrupted | 42501 is logged and returns null, which reads as a lost CAS. The job stays "active", and the pending page polls it forever. |
| Deliver | `generation-delivery.ts:357,412-424` → `placements.ts:116` | `apply_generated_placements` (INVOKER) → placements, bundles | Before failing, it loads about 160 KB (`:53-58,304`), runs the verifier (`:319`) and makes 4 catalog reads. Then the INSERT gets 42501, and `placements.ts:128` throws a raw `DomainError("INTERNAL_SERVER_ERROR")`. |
| `clearPending` | `generation-delivery.ts:544-548` | `plans.pending_proposal` | Throws a raw `DomainError` (`:547`). |
| `markNotified` | `generation-delivery.ts:215-229` | `generation_jobs.notified_at` | 42501, logged on every visit to a delivered proposal. It leaves the author's "Ready" badge alone, which is arguably right. |
| `failJob` | `generation-delivery.ts:563-580` | `generation_jobs` | 42501 is swallowed (`:579`). The view says `failed` while the row is unchanged (`:301,312,327,355`). |
| `deleteOrphanClone` | `generation-delivery.ts:582-586` | `plans` DELETE | 0 rows, silently. The view claims the clone is gone. |
| `releaseOrphanProposal` | `release-orphan-proposal.ts:49-57` | `plans` UPDATE | 42501 is thrown, then caught at `index.astro:67-70`. A stranded proposal stays "still being generated". |

**What the viewer sees:**

- **Page load.** A throw is caught as `{job: null, failed: true}` (`index.astro:48-57`).
  - On the proposal: "This proposal is still being generated. Its status could not be read just now — refresh to try again." (`PendingProposalPage.tsx:46-51`). Refreshing never fixes it until an author visits.
  - On the source: the generation strip silently disappears.
- **Poll tick.** `runDomain` turns the error into an `INTERNAL_SERVER_ERROR` ActionError. The polling store keeps the last snapshot and retries, so the screen freezes on "Generating — stage N" and repeats the full load and verification every 5 s for as long as the tab is visible.
- **Copy that is wrong for a viewer:**
  - "**You** stopped this generation…" (`PendingProposalPage.tsx:86`);
  - the hub badge "Finished — open to deliver" (`plans-list/model/plan-indicators.ts:129`), which sends the viewer straight into the dead end.

All four symptoms S-403's plan handed over (`fail-closed-roles/plan.md:69-74`) are confirmed. One line has drifted: `placements.ts:129` is now `:128`.

### 5. Delivery and Open Question 1

**How delivery works today:**

- **The solver** (as `solver_job_writer`, with column-scoped UPDATE, `20260810200931_solver_job_writer_role.sql:62-74`) writes claim, progress and terminal state, plus `checkpoint` and `result`. It is denied the delivery columns on purpose: "None of those are the solver's to write; the Worker owns them" (`:48-53`).
- **Delivery** (`generation-delivery.ts:289-369`), run by the Worker:
  1. loads the snapshot and the result (or the checkpoint);
  2. runs the server-side oracle `runVerifiedGeneration` (FR-313: an unverified board never lands);
  3. translates course ids onto the clone's catalog by natural key;
  4. region-replaces onto the proposal through `apply_generated_placements`;
  5. clears `pending_proposal`;
  6. CAS-marks the job delivered.
- **Who can trigger it:** any `can_edit` session that reaches `checkPlan`. There is no requester column yet (that is S-407). There is no cron, `pg_cron` or webhook, and "a `scheduled` handler has no database identity here" (`generation-delivery.ts:68`).
- **Nothing on a timer deletes an undelivered result.** A deliverable proposal and its source are delete-guarded (`plans-list/api/pending-guards.ts:65-68,103-118`).

**What a viewer sees by job state, today:**

| State | Viewer today |
|---|---|
| queued / running, healthy | Correct progress. Stop is shown and refused. |
| active but stale (dead container) | "Generating…" forever, with a failing UPDATE every 5 s. |
| succeeded, or interrupted/stopped with a checkpoint, and not delivered | "Status could not be read". A poll that was already running freezes and reloads about 160 KB every tick. |
| delivered | The board renders, with edit affordances. `markNotified` logs an error on every visit. |
| failed | Correct panel. The clone silently survives. |
| stopped, no checkpoint | "**You** stopped…", which is the wrong subject. |

**The options.**

| Option | Mechanism | Size | Rules it bends | Viewer experience of a finished, undelivered proposal |
|---|---|---|---|---|
| **(a) Wait for an author** *(recommended)* | Split `checkPlan` into a pure, write-free read and the delivering path. Non-editors get the read. | Small to medium. No migration. | None | "Finished — the board appears once an author opens it". Perspective views and comparison stay closed to it, because they already refuse a pending plan. |
| (b1) Solver delivers | New grants for `solver_job_writer` on placements, bundles and plans, and the oracle ported to Python or skipped | Large | The narrow solver role (`20260810200931:48-53`), FR-313's independent oracle, the frozen wire contract (the solver never learns the proposal id) | Delivered as soon as the job finishes |
| (b2) DB trigger on `succeeded` | SECURITY DEFINER trigger. The TS oracle cannot run in plpgsql. A failing trigger fails the solver's terminal write and wedges the row. | Large | One-DEFINER rule, FR-313 | Same as (b1) |
| (b3) Second DEFINER delivery RPC callable under `can_read` | The Worker verifies, then the RPC re-derives placements from `result` in SQL rather than trust a payload. The RPC must gate inside its body. | Medium to large | One-DEFINER rule (needs a recorded reason, plus a red-first matrix cell), "no gating inside RPC bodies" | Delivered on the viewer's visit |
| (b4) Worker with the secret key, or with the machine password it carries | — | — | The decision of record (`deploy-plan.md:141`); README's "the Worker is a courier and never uses it itself"; and a widened solver role anyway | — |
| (b5) Cron, `scheduled()` or a DO alarm with a new machine principal | `drift-decided-delivery` option B: "priced, not forbidden" | Large | A new principal, plus a narrow DEFINER RPC | Delivered within the cron interval |
| (c) Read-only preview | In the read path: verify, translate and overlay onto the clone's pins in memory, then render read-only as "Preview — not yet delivered" | Medium to large: a new in-memory planner projection, because generated rows have no ids or bundles until the RPC runs | None | Sees the board, labelled as a preview |

**What option (a) consists of:**

- **Extract a pure `planJobView`.** It does the dual-key read, `pickJob` and labelling, and reports:
  - "awaiting delivery" when `isDeliverableJob` holds;
  - "stalled" when `isStaleActiveJob` holds (`src/entities/timetable/model/generation/job-staleness.ts:45`).
- **Actions.**
  - A new `readPlanJob` action with `requires: "read"`.
  - `checkPlan` becomes `requires: "edit"`, so `action-capabilities.test.ts` still pins exactly four non-`edit` actions, with `readPlanJob` in place of `checkPlan`.
- **`index.astro`** branches on `allows(Astro.locals.access, "edit")`: non-editors get the pure read, and `releaseOrphanProposal` is skipped for them.
- **SSR passes `canEdit` down.** The pending page and the strip then call the right action, and the poll stops on "awaiting delivery" and "stalled" (`use-pending-proposal.ts:75`).
- **Viewer copy:**
  - the pending page: finished and waiting for an author, stalled, and a neutral "stopped";
  - the source strip;
  - the hub badge.
- **Defence in depth:** route `placements.ts:128` and `generation-delivery.ts:547` through `toDomainError`, so a 42501 surfaces as `FORBIDDEN`.
- **Tests:**
  - unit tests for the pure view;
  - an integration suite under `createSignedInUser(admin, { role: "viewer" })`: a deliverable job, a stale job and an orphan all mean no error, an unchanged row and the right view, and a following author visit delivers;
  - a viewer e2e spec.

**How often a viewer would arrive first.** Delivery happens on the first editor session to reach `checkPlan`: the requester's pending page (if it is still open when the solve ends), any author's visit to the source or the proposal, or Refresh. But the pending page tells authors "you can leave the page" (`PendingProposalPage.tsx:70-72`), and a solve runs for 22–38 minutes. So "author starts a solve and leaves, then leadership opens it from the hub" is a realistic sequence, not a corner case. S-310's completion email (`roadmap.md:280-288`) is the planned prompt that brings an author back. It depends on S-402 and S-407.

**Shrinking the window under (a): possible but not recommended.** An author's *hub* poll could also deliver. Concurrency is already safe: CAS plus an idempotent region-replace (`generation-delivery.ts:48-51`). But it reverses S-303's recorded separation, under which the hub poll stays a cheap six-column read (`generation-status.ts:8-12`), and it still needs an author's tab.

### 6. Read paths: what already works for a viewer

- **Every page loads in frontmatter** under the user's own session (`createClient(Astro.request.headers, Astro.cookies)`). No read path uses an API route: `src/pages/api/` holds only the auth endpoints and `solver/container`.
- **The loaders are pure SELECTs:**
  - `loadPlans` (`plans-list/api/loader.ts:45-115`);
  - `loadPlanSummary` and `loadCombinedPlannerData` (`plan-detail/api/load.ts:57-160`);
  - `loadCatalog`, `loadStudentCatalog` and `loadTeacherCatalog`;
  - the perspective-view loaders;
  - `loadComparison`.
  - There is no get-or-create pattern, and no RPC on a read path except `own_app_role` in the middleware and `apply_generated_placements` inside delivery.
- **No read-shaped action defaults to `edit`.** Every viewer-reachable `edit` action is a user-initiated mutation, so it is an affordance to hide, not a break. No island effect calls an action on mount.
- **Export is client-side:** xlsx through `write-excel-file/browser` and zip through `fflate`, built from SSR props (`ExportMenu.tsx:44-73`; the perspective export buttons too). A viewer needs nothing it lacks.
- **Comparison** runs `loadPlanAnalysis` (SELECTs only, and it refuses a pending plan, `load-plan-analysis.ts:137,157`), then the pure `analyzePlan` / `verifyGeneration` on the server (`load-comparison.ts:22-82,125`). The selection travels in the URL from the hub's checkboxes. Nothing writes.
- **Perspective views and catalog pages** render `PendingProposalNotice` for a pending plan (`student-plan-view/api/loader.ts:87`, `teacher-plan-view/api/loader.ts:96`).
- **The role matrix** already allows a viewer to read all 16 plan-scoped tables, including `generation_jobs` (`snapshot`, `result`, `checkpoint`), `course_groupings` and `teacher_availability`, plus own and others' `profiles` (`src/test/role-matrix-expectations.ts:87-121`).

### 7. Labelling: "tell a proposal or draft from the plan marked current"

- **The data model.**
  - `plans.is_current` has a global partial unique index and `check (not (is_current and pending_proposal))` (`20261029143936_current_plan_marker.sql:54-64`). No plan was marked at migration time (`:135`).
  - `plans.pending_proposal` is true only until delivery (`generation-delivery.ts:545`).
  - A delivered proposal becomes an ordinary plan. Its provenance survives only in `generation_jobs.proposal_plan_id` / `delivered_plan_id` / `delivery = 'proposal'`, and `generation_jobs.plan_id` cascades, so deleting the source erases it (`current-plan-marker/research.md:71`).
- **Where "Current" renders.** It is shown only on the current plan; a draft carries no label of its own.
  - the hub row (`PlansHub.tsx:165`);
  - the sidebar plan label on every plan-scoped page (`SidebarLayout.astro:122`);
  - the breadcrumb (`:173`);
  - the board heading (`BoardHeader.tsx:25`).
- **Where "Proposal" renders:**
  - while pending: the pending page's eyebrow (`PendingProposalPage.tsx:43`), `PendingProposalNotice`, and the hub Activity badges (`plan-indicators.ts:115-131`);
  - once delivered: only the board's `ProposalStrip`, "Generated from …" (`GenerationStatusStrip.tsx:56,134`). It depends on `checkPlan` succeeding and disappears once the source is deleted. The hub badge disappears once `notified_at` is stamped.
- **Surfaces with no indication at all.** S-404 deferred these explicitly (`current-plan-marker/plan.md:51`).
  - **The comparison page.** It carries only `{id, name}` (`load-comparison.ts:65`), and neither `ScoreboardTable.tsx:40` nor `PlanComparisonPage.tsx:127` shows a marker. **Cheap to fix:** select `is_current` and render the existing badge.
  - **Exports.** The file name is the slugged plan name (`export-file-name.ts:12`), and nothing in the workbook carries status.
  - **Printed perspective views.** The sidebar and breadcrumb are `print:hidden` (`SidebarLayout.astro:83,165`), and the in-page heading `{planName} — student/teacher schedule` has no marker (`StudentPlanPage.tsx:59`, `TeacherPlanPage.tsx:116`).
  - Tab titles.
  - Delivered proposals, everywhere except the board strip.

One reading of FR-409: "Current" shown wherever a plan's identity is shown is enough, because anything unmarked is not current. Under that reading, the comparison page is the one must-fix, and print and export are the judgement calls. A stricter reading also requires "this was a proposal" to stay visible after delivery. That needs a job lookup, or a lineage column (an additive migration).

### 8. Test harness

**What exists:**

- **Matrix:** viewer reads on all plan tables. Viewer writes are denied on 5 representative tables, including `generation_jobs`. RPC cells exist for `clone_plan` and `set_current_plan` (denied) and `own_app_role` (allowed).
- **Factory:** `createSignedInUser(admin, { role: "viewer" })` (`src/test/factories/create-signed-in-user.ts`).
- **Unit tests:**
  - `action-capabilities.test.ts` asserts a viewer gets `FORBIDDEN` on every `edit` action;
  - `capability.test.ts`;
  - `nav.test.ts`, which already has viewer cases.
- **Playwright projects** (`playwright.config.ts:39-61`): `setup`, `chromium` (author), `chromium-guard` and `chromium-no-role`.
- **Provisioner** (`scripts/provision-e2e-author.mjs`): an `ACCOUNTS` array of `{email, password, role}`, idempotent, with a loopback guard. It runs from `pretest:e2e` (`package.json:26`), so CI needs no new step.

**What a viewer e2e account takes:**

1. `e2e/viewer-credentials.mjs`: fixed, with no env override, like `no-role-credentials.mjs`.
2. One `ACCOUNTS` entry with `role: "viewer"`.
3. `e2e/viewer.setup.ts`, writing `.auth/viewer.json`.
4. A `chromium-viewer` project matching `*.viewer.spec.ts`, plus that pattern in `chromium`'s `testIgnore`.
5. Rules in `e2e/CLAUDE.md`: never change the viewer's role, password or session.
6. An update to the comment at `ci.yml:276`.

**The real cost is data.** Every spec creates its data through the author's UI (`e2e/support/planner.ts` `createPlan`). The seed plans have catalogs but no placements. So viewer specs need a second context on the author's storage state, `browser.newContext({ storageState: "e2e/.auth/user.json" })`, to arrange the data, then assert as the viewer. Service-role plan creation is not sanctioned by `e2e/CLAUDE.md`.

**Templates to copy:**

- `student-plan-view`, `teacher-plan-view`, `plan-comparison`, `export-xlsx`, `printable-version`, `current-plan` and `combined-view`;
- `generation.spec.ts`, which needs the solver, for the Open Question 1 scenario;
- `no-access.no-role.spec.ts` and `action-unauth.spec.ts`, for `FORBIDDEN` over HTTP.

**Gaps worth closing:**

- Nothing exercises `checkPlan`, delivery, reclaim, `markNotified` or `releaseOrphanProposal` under a viewer session; every generation-delivery suite runs as service role.
- The matrix has no viewer cells for `apply_generated_placements` or `replace_cohort_groupings`. Adding them is cheap evidence that a viewer cannot deliver or persist groupings, though it is not strictly an access-control change.

## Feasibility and sizing

| Area | Size under option (a) | Notes |
|---|---|---|
| Read/deliver split for `checkPlan`, plus viewer copy | S–M (~8 files + tests) | Fixes every inherited S-403 symptom. Independent of the UI sweep, so it can land first. |
| Access prop plumbing to ~6 islands | S | `allows(Astro.locals.access, "edit")` in the 5 routes or slice wrappers. `DashboardPage.astro` is the precedent. |
| Plan-detail gating through the four seams | M (~14 files) | The biggest piece. The palette needs a read-only branch in `resolvePaletteView`, and the focus-mode dead end goes with it. |
| Hub and catalog gating | M (~8–10 files) | The two badges (overlap, availability) need read-only dialog variants or non-clickable badges. |
| Labelling gaps | S (comparison) to M (print, export, delivered provenance) | The scope is your decision. |
| Viewer e2e account and specs | M | The account is mechanical. The specs need author-context data setup. |
| Matrix cells for the two RPCs | XS | Optional hardening. |

There is no migration, no RLS change, no new SECURITY DEFINER function and no wire-contract change. Answering Open Question 1 with (b) adds a large, rule-bending backend piece. (c) adds a medium-to-large rendering piece.

**Risk:** future drift. A new edit control added later without the gate leaks only an affordance, because RLS and the action guard still refuse the write. A viewer e2e spec that asserts edit controls are absent on each page is the cheap tripwire.

## Code References

Permalinks at `b0b9c0b`:

- [`src/pages/plans/[id]/index.astro:42-71`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/pages/plans/%5Bid%5D/index.astro#L42-L71): the page-load `checkPlan` and `releaseOrphanProposal`, the single source of viewer breakage
- [`src/_pages/plan-detail/api/generation-actions.ts:30`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/_pages/plan-detail/api/generation-actions.ts#L30): `checkPlan` declared `requires: "read"` although it writes
- [`src/_pages/plan-detail/api/generation-delivery.ts`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/_pages/plan-detail/api/generation-delivery.ts#L289-L369): delivery (`:289-369`), `markNotified` (`:215-229`), `clearPending` (`:544-548`), `failJob` (`:563-580`), `deleteOrphanClone` (`:582-586`)
- [`src/_pages/plan-detail/api/generation-reclaim.ts:49-76`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/_pages/plan-detail/api/generation-reclaim.ts#L49-L76): reclaim, where 42501 reads as a lost CAS
- [`src/_pages/plan-detail/api/release-orphan-proposal.ts:49-57`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/_pages/plan-detail/api/release-orphan-proposal.ts#L49-L57): the orphan release UPDATE
- [`src/_pages/plan-detail/api/placements.ts:128`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/_pages/plan-detail/api/placements.ts#L128): the raw `DomainError` that bypasses `toDomainError`
- [`src/_pages/plan-detail/model/generation/use-pending-proposal.ts:60-75`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/_pages/plan-detail/model/generation/use-pending-proposal.ts#L60-L75): the 5 s poll of `checkPlan`
- [`src/_pages/plan-detail/ui/PendingProposalPage.tsx:36-95`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/_pages/plan-detail/ui/PendingProposalPage.tsx#L36-L95): the pending states, StopAndKeep and the "You stopped" copy
- [`src/_pages/plan-detail/ui/PlannerBoard.tsx:204-245`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/_pages/plan-detail/ui/PlannerBoard.tsx#L204-L245): `buildColumn`, the `CellWiring` assembly and the focus-mode compute early return
- [`src/_pages/plan-detail/ui/grid/PlannerGrid.tsx:32-52`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/_pages/plan-detail/ui/grid/PlannerGrid.tsx#L32-L52): `CellWiring`, the grid seam
- [`src/_pages/plan-detail/model/grouping/palette-view.ts:15-25`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/_pages/plan-detail/model/grouping/palette-view.ts#L15-L25): `resolvePaletteView`, the derived-state dispatch for a read-only branch
- [`src/_pages/plan-detail/model/cross-cohort/drop-dispatch.ts:33-85`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/_pages/plan-detail/model/cross-cohort/drop-dispatch.ts#L33-L85): the single drop dispatch
- [`src/_pages/plans-list/ui/PlansHub.tsx:271-313`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/_pages/plans-list/ui/PlansHub.tsx#L271-L313): the hub row kebab (clone, rename, mark current, delete)
- [`src/_pages/plans-list/model/plan-indicators.ts:115-131`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/_pages/plans-list/model/plan-indicators.ts#L115-L131): the hub job badges ("Finished — open to deliver")
- [`src/shared/lib/actions/define-domain-action.ts:19-35`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/shared/lib/actions/define-domain-action.ts#L19-L35): `run` never sees the caller's access
- [`src/shared/config/access-state.ts:9-12`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/shared/config/access-state.ts#L9-L12): `AccessState` and `allows`
- [`src/shared/config/nav.ts:24-36`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/shared/config/nav.ts#L24-L36): `NavItem.requires` and `visibleNavItems`
- [`src/actions/action-capabilities.test.ts:33-38`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/actions/action-capabilities.test.ts#L33-L38): the pinned list of non-`edit` actions
- [`src/_pages/plan-comparison/api/load-comparison.ts:65`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/_pages/plan-comparison/api/load-comparison.ts#L65): comparison carries `{id, name}` only, with no current marker
- [`supabase/migrations/20261028200630_fail_closed_policies.sql:20-22`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/supabase/migrations/20261028200630_fail_closed_policies.sql#L20-L22): the UPDATE policy shape behind the loud 42501
- [`supabase/migrations/20260810200931_solver_job_writer_role.sql:48-74`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/supabase/migrations/20260810200931_solver_job_writer_role.sql#L48-L74): the solver denied the delivery columns on purpose
- [`src/test/role-matrix-expectations.ts:87-121`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/src/test/role-matrix-expectations.ts#L87-L121): viewer read cells
- [`playwright.config.ts:39-61`](https://github.com/dobrek/ib-timetable-planner/blob/b0b9c0bc39945635854cb4869391fc3a85519f04/playwright.config.ts#L39-L61): the e2e projects a `chromium-viewer` project joins

## Architecture Insights

- **Two layers, one source of truth.** RLS is the enforcement, and the app layer only makes denials legible (CLAUDE.md § Roles; `fail-closed-roles/plan.md:89-97`). S-405 lives entirely in the second layer under option (a). The PRD's role → capability map is mirrored once in SQL (`private.can_read` / `can_edit`) and once in `src/shared/config/capability.ts`, so gating UI on `allows(access, "edit")` reuses that map rather than inventing role checks.
- **"Run on visit" is the house pattern for lifecycle work** (delivery, reclaim, orphan release), chosen deliberately over sweepers and crons because nothing session-free holds a write identity (`drift-decided-delivery/research.md:173-188`; `job-aware-container-lifecycle/plan.md:105-108`). S-405 is the first slice where the visitor may lack write rights. The honest fix is to make the visit path's writes conditional on the capability, not to give the visit a different identity.
- **An action's capability is fixed per action.** `run` cannot see access, so "read for viewers, deliver for editors" means two actions. The SSR page, which can see `Astro.locals.access`, picks between the two domain paths directly.
- **Absent handler means absent control.** That idiom already exists in `ScheduleGrid` (`onInspect`) and in `PlanSummaryBar`'s optional `undoRedo`. It fits a read-only board better than a `readOnly` flag threaded through every leaf: build the `CellWiring` without write handlers, and the leaves stop rendering the controls.
- **Derived-state dispatch over inline conditions.** `resolvePaletteView` and the ranked `disabledReason` in `use-cohort-board-state.ts:129-136` are where a read-only mode belongs (`ui-conventions.md:9,35-42`; user preference "orchestration over patching").

## Historical Context (from prior changes)

- `context/changes/user-managment-research/research.md:350-358`: the M-02 research's P3 recommends `canEdit` gating across plan-detail, catalog and plans-list. It says delivery-on-visit and interrupted marking "must be skipped for viewers, or RLS will reject them" (`:352`); that leans toward option (a) but is not an author decision. It also asks for a second e2e account (`:358`). The viewer's scope ("reads all plans, including proposals, and edits nothing") is an author decision (`:500`; `shape-notes.md:21`).
- `context/changes/fail-closed-roles/research.md:311,317-326,551`: `checkPlan` was declared `read` "because its writes are author behaviour that S-405 settles". §3.4 predicted silent no-ops for a viewer, which the shipped UPDATE policy turned into loud 42501s. "S-405 changes only UI" is the stated premise, and it holds only under option (a).
- `context/changes/fail-closed-roles/plan.md:67-75,85,501`: the four inherited symptoms, "S-405 and S-406 add" viewer and admin e2e accounts, and the nav seam "S-405 extends".
- `context/archive/2026-10-29-current-plan-marker/plan-brief.md:8,31,68` and `research.md:201-202`: the marker exists "so S-405's viewers can always tell a draft or a proposal from the plan the school is actually using". Viewers see Mark/Unmark "until S-405 hides it", and passing `allows(access, "edit")` into `PlansHub` would be "the first such island prop, which S-405 otherwise introduces". `plan.md:51` defers marker display on comparison, print and export.
- `context/archive/2026-08-12-first-verified-proposal/plan-brief.md:37`: on-visit delivery was chosen as the "honest minimum", with headless delivery deferred.
- `context/archive/2026-08-25-drift-decided-delivery/research.md:173-230` and `frame.md:37`: the solver delivering was "definitively ruled out", a `scheduled` handler has no database identity, five alternatives were costed (hub poll, cron plus a machine principal with a narrow DEFINER RPC, DO alarm, solver callback, solver-driven), and the session-free write identity was "refused twice by name".
- `context/archive/2026-08-20-job-aware-container-lifecycle/plan.md:105-108` and `research.md:255-266`: reclaim runs on visit rather than in a sweeper, and the Worker must never use the machine password itself.
- `context/foundation/roadmap.md:280-288`: S-310's notifier needs "its own narrow read identity — never the secret key in the Worker", which is the planned way to bring an author back to deliver.

## Related Research

- `context/changes/user-managment-research/research.md`: the M-02 umbrella research (phasing P0–P6, the viewer's scope)
- `context/changes/fail-closed-roles/research.md`: the S-403 database design and silent-denial survey
- `context/archive/2026-10-29-current-plan-marker/research.md`: the S-404 marker and every surface that shows plan identity
- `context/archive/2026-08-25-drift-decided-delivery/research.md`: the delivery-trigger alternatives, costed

## Open Questions

1. **Open Question 1. Decided (user, 2026-10-30): (a), wait for an author.** When a viewer is the first to open a finished proposal:
   - **(a) Wait for an author.** Recommended: no migration, no rule bent.
   - **(b) Deliver regardless of who looks.** Every mechanism bends a recorded rule (§5).
   - **(a) plus (c).** A read-only preview of the undelivered board.
2. **Does FR-409's "read every … proposal" cover an *undelivered* proposal? Decided with (a) (user, 2026-10-30): no, and the gap is accepted.** Under (a), a viewer cannot read, compare or open the perspective views of a finished-but-undelivered proposal until an author opens it. Choosing (a) means accepting that, and recording it as the resolution of PRD Open Question 1 / an FR-409 note. Choosing (c) closes it.
3. **How much labelling (owner: plan)?** The comparison page is the clear gap and cheap. Printed perspective views, export file names or contents, tab titles, and "this was a proposal" after delivery are judgement calls. The last one needs a job lookup or an additive lineage column.
4. **The palette and shelf for a viewer (owner: plan):** hide them, or show them read-only? They are informational ("what's left to place", "what's parked"), but they are drag sources. The focus-mode dead end (`PlannerBoard.tsx:233-245`) has to go either way.
5. **The catalog badges (owner: plan).** `OverlapBadge` and `AvailabilityBadge` are both display and edit trigger: read-only dialog variants, or plain badges?
6. **Housekeeping (owner: user).** S-403's manual Progress rows and its archive are still open, so the roadmap still shows S-405's prerequisite as `in-progress`. That is not a technical blocker.

## Follow-up Research 2026-10-30T11:05:20+0100: what "wait for an author" means

**Question:** What does option (a), "wait for an author", mean in practice?

### Why delivery needs an editor at all

- A finished solve does not put a board on the proposal. The solver writes only the job row: status, `result`, `checkpoint`. The board lands when *delivery* runs (§5: verify → translate → apply → clear pending → mark delivered).
- Delivery runs inside a web request, under the session of whoever made it. No background process does it:
  - the Worker holds no secret key;
  - a `scheduled` handler has no database identity (`generation-delivery.ts:68`);
  - the hub's poll is deliberately status-only and never delivers (`plans-list/api/generation-status.ts:5-12`).
- Delivery writes `placements`, `bundles`, `plans` and `generation_jobs`. Since S-403 those writes need `can_edit`, so only an author's or admin's request can carry it.
- **Who:** any author or admin, not necessarily the one who pressed Generate. There is no requester column until S-407.
- **What triggers it:**
  - opening the source plan or the proposal (`checkPlan` is dual-keyed since S-306);
  - the strip's Refresh;
  - the requester's pending page, if it is still open and visible when the solve ends (`use-pending-proposal.ts:75-82`).
- An author's visit to `/plans` does **not** deliver.

### A worked timeline under (a)

| Time | Event | State | What the viewer sees |
|---|---|---|---|
| 10:00 | An author presses Generate on Plan A, then closes the tab (the page says they may) | Proposal clone with `pending_proposal = true`, holding only Plan A's pins. The job is queued. | Hub: a progress badge. Proposal: "Generating — stage N". Both are correct today. |
| 10:32 | The solve ends | The job is `succeeded`, with `result` on the row. Nothing else changes, because no process wakes up. | Hub: "Finished — waiting for an author" (today: "Finished — open to deliver"). Proposal: "This proposal has finished. Its board appears once an author or admin opens it." (today: "status could not be read"). |
| 14:00 | Any author opens Plan A or its proposal | Delivery runs inside that request. The proposal now holds the generated board, `pending_proposal = false`, and the job is delivered. | (unchanged) |
| after 14:00 | The viewer reloads, or the page flips by itself (see the refinement below) | (unchanged) | The board, read-only |

Nothing is lost while waiting. Nothing on a timer deletes an undelivered result, and both the proposal and its source are delete-guarded (`pending-guards.ts:65-68,103-118`).

### The same rule covers two quieter cases

- **A stalled job** (its container died). The row says `running` until an editor's visit reclaims it, delivering the checkpoint if there is one. The viewer sees "stalled, an author's visit will settle it" instead of an endless "Generating…".
- **An orphaned proposal** (its source was deleted mid-solve). It stays pending until an editor's visit runs `releaseOrphanProposal` (`release-orphan-proposal.ts:38-58`).

### What the viewer cannot do during the gap

For that one proposal, the viewer cannot read the board, compare it or open its perspective views. The source plan, every delivered proposal and the catalog stay readable. This is the FR-409 conflict in Open Question 2.

### A refinement to §5: keep the viewer's poll alive while waiting

§5 said the poll stops on "awaiting delivery". It can instead keep ticking while the tab is visible, using the write-free read. That read is the same weight as the hub's poll and never loads the ~160 KB payload. When an author delivers, the read reports `delivered: true`, and the existing `afterTick` reloads the page into the board (`use-pending-proposal.ts:79-82`). A viewer who keeps the page open then sees the board appear without reloading. The cost is one extra condition in `isActive` (`:75`). Recommended; the plan decides.
