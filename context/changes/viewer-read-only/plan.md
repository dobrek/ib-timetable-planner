# Viewer Reads Everything Read-Only (S-405) Implementation Plan

## Overview

FR-409: a viewer can read every plan and proposal, including the teacher and student perspective views, export timetables and use the comparison page, with no edit affordance anywhere, and can always tell a proposal or draft from the plan marked current.

The database already refuses every viewer write (S-403), so this change adds no security. It does three things in the app layer:

1. It stops the plan visit from **writing** under a viewer's session: no delivery, reclaim, sweep, orphan release or `notified_at` stamp.
2. It **removes every edit control** for a viewer: board, pending page, plans hub, three catalogs.
3. It **marks "Current"** on every surface that shows a plan's identity, on screen and on paper.

Open Question 1 is decided as **(a), wait for an author** (`change.md`, PRD Open Question 1). A finished, undelivered proposal shows a viewer "finished — waiting for an author", and its board appears once an author or admin opens it.

## Current State Analysis

From `context/changes/viewer-read-only/research.md` (written at `b0b9c0b`, which is still HEAD) and spot checks made while planning:

- **Enforcement is live.** RLS refuses viewer writes. `defineDomainAction` defaults to `requires: "edit"`. Only four actions declare less (`src/actions/action-capabilities.test.ts:33-38`), and one of them is `checkPlan` (`read`), although it writes.
- **The visit path is the only thing that breaks.** `src/pages/plans/[id]/index.astro:50,67` runs `checkPlan` and `releaseOrphanProposal` as direct domain calls. The pending page polls `checkPlan` every 5 s (`model/generation/use-pending-proposal.ts:60-75`), and the board strip's Refresh calls it too (`use-generation-job.ts:65`).
  - `checkPlan`'s `settle` path (`api/generation-delivery.ts:203-226`) reclaims, delivers, fails, sweeps, clears pending and stamps `notified_at`. Under a viewer each of these fails with 42501 or silently matches 0 rows.
  - What the viewer sees as a result: "status could not be read", a stale job polled forever (re-reading ~160 KB and re-verifying it on every tick), "failed" while the row is unchanged, and `INTERNAL_SERVER_ERROR` where `FORBIDDEN` was meant (`placements.ts:128`, `generation-delivery.ts:547`).
- **`GenerationJobView` carries no staleness and no deliverability.** `heartbeat_at` is read (`STATUS_COLUMNS`) but never reaches the view. A write-free reader has to compute "stalled" (`isStaleActiveJob`, `entities/timetable/model/generation/job-staleness.ts:45`) and "awaiting delivery" (`isDeliverableJob`, `job-delivery.ts:61`) on the server.
- **No island receives the caller's capability.** `allows(access, cap)` lives in the client-safe `@/shared/config`. Two places read `Astro.locals.access` today: `SidebarLayout.astro:23` and `DashboardPage.astro`. Routes mount the catalog islands directly, with no slice `.astro` wrapper (`courses.astro:39`, `teachers.astro:42`, `students.astro:39`). The hub goes through `PlansListPage.astro`, and the board through `PlanDetailPage.astro`.
- **The board's seams** (research §3):
  - `CellWiring` (`ui/grid/PlannerGrid.tsx:32-52`) is built once per column in `buildColumn` (`PlannerBoard.tsx:204-231`) and carries every cell and chip handler.
  - The draggables' `disabled` option (`PlacedChip.tsx:69`, `SlotCell.tsx:203`).
  - `resolvePaletteView` (`model/grouping/palette-view.ts:15-25`), which also drives the focus-mode early return that replaces the board with the compute prompt (`PlannerBoard.tsx:233-245`).
  - `BoardShell`'s `palette`/`shelf` nodes, and `PlanSummaryBar`'s already-optional `undoRedo` and its `trailing` slot.
- **Week A/B is visible without the toggle.** `WeekLane` renders a labelled lane ("A"/"B"), and optional placements carry `OptionalTag` (`PlacedChip.tsx:98`). Dropping `WeekToggle` and `ChipMenu` for a viewer loses no information.
- **Viewer-wrong copy:**
  - "You stopped this generation…" (`PendingProposalPage.tsx:86`, `GenerationStatusStrip.tsx:197`);
  - "Generate again when you are ready." (`GenerationStatusStrip.tsx:108`);
  - "…you can leave the page" (`PendingProposalPage.tsx:70-72`);
  - hub badges "Finished — open to deliver" and "…stalled, open plan" (`plans-list/model/plan-indicators.ts:115-131`). The stalled badge points at the source *because* opening the source reclaims, which a viewer's visit no longer does.
- **Labelling.** "Current" renders on the hub row, the sidebar label, the breadcrumb and the board heading (S-404).
  - It is missing on: the comparison page (`load-comparison.ts:65` carries `{id, name}` only), the board's print-only heading (`PlannerBoard.tsx` center block), the perspective headings (`StudentPlanPage.tsx:59`, `TeacherPlanPage.tsx:116`), tab titles, and every export file name.
  - The workbooks have **no title row**, so the file name is the only place an export can carry the marker.
  - There are four file-name builders: `exportFileName` (`plan-detail/lib/export-file-name.ts`), the batch zip (`plan-detail/lib/batch-export-workbooks.ts:75`), `studentExportFileName` (`student-plan-view/lib/export-file-name.ts`) and `buildPerspectiveWorkbook` (`entities/timetable/model/export/perspective-workbook.ts:58`, used by the teacher export).
- **Test harness.**
  - `createSignedInUser(admin, { role: "viewer" })` exists, and the role matrix already proves viewer SELECT on all 16 plan tables. It has three RPC cells (`clone_plan`, `own_app_role`, `set_current_plan`; `src/test/role-matrix-expectations.ts:61,213-215`).
  - Playwright has `setup`, `chromium`, `chromium-guard` and `chromium-no-role` (`playwright.config.ts:39-61`). The provisioner's `ACCOUNTS` array (`scripts/provision-e2e-author.mjs:31-34`) takes `{email, password, role}`.

## Desired End State

Signed in as a viewer:

- **Plans hub.**
  - Every plan and its badges are listed. Compare (row checkboxes and `ComparePlansBar`) works.
  - There is no "New plan" button (header or empty state) and no row menu.
  - A finished, undelivered job reads **"Finished — waiting for an author"**, and a stalled one **"Generating — stalled"** / **"Queued — stalled"**, each linking to the proposal.
- **Board** (combined and both focus modes).
  - The full timetable renders, including in a focus mode with no groupings (no compute prompt replaces it).
  - Nothing drags. Cells have no Duplicate / Lift to shelf / Remove all, and chips have no A/B toggle and no "⋯" menu.
  - There is no palette column, no shelf drawer, no "parked" button, no Generate and no undo/redo, and ⌘Z does nothing.
  - Group/Ungroup, the collision inspector, lens, zoom, hint mode, export and print all work.
  - The generation strip shows read-only status. Its Refresh reads and never writes.
- **Pending proposal page.** Every state shows viewer copy and no Stop & keep:
  - progress: the board appears here on its own;
  - **stalled:** an author's or admin's visit will settle it;
  - **finished, waiting for an author:** the board appears once an author or admin opens it;
  - **stopped:** neutral subject;
  - **failed:** unchanged;
  - **stranded:** an author's visit will release it.
  - While the job is active, stalled or waiting, the page keeps polling a write-free read. When an author delivers, the viewer's page reloads into the board on its own.
- **No visit writes.** After any number of viewer visits and poll ticks, the `generation_jobs` row, `plans.pending_proposal` and the proposal's placements are byte-identical, and `notified_at` stays null.
- **Catalogs** (courses, teachers, students).
  - No New buttons, no write items in row menus (teachers and students keep "View plan"), and no student selection or bulk bar.
  - The Overlap and Availability badges open **read-only** dialogs that show the same data with no write controls.
- **Every surface that shows a plan's identity marks the current plan:**
  - the comparison page (scoreboard column headers and per-plan cards);
  - the board's printed heading and both perspective headings, on screen and on paper;
  - the browser tab title of every plan-scoped page;
  - every export file name (`<plan-slug>-current-…`).
  - Anything unmarked is not current.
- **The sidebar footer shows a "View only" chip** on every page.

Signed in as an author or admin, nothing changes. The one exception is that the current plan's export file names gain `-current`.

### Key Discoveries:

- `src/shared/lib/actions/define-domain-action.ts:21,29`: `run` never sees the caller's access, so "read for viewers, deliver for editors" has to be **two actions**, and the SSR route picks between the two domain paths directly.
- `src/_pages/plan-detail/api/generation-delivery.ts:163-176` (`checkPlan`), `:203-226` (`settle`), `:215-229` (`markNotified`): the read half to extract is `latestJobBy` ×2 → `pickJob` → `toView` / `labelOf` / `planName`. All of it is already write-free.
- `src/_pages/plan-detail/model/generation/use-pending-proposal.ts:75`: `isActive` decides whether the poll continues. `afterTick` (`:79-82`) already reloads on `delivered`. `sameView` (`:121-139`) must name every field the page renders, in the same commit that adds it.
- `src/_pages/plan-detail/model/use-cohort-board-state.ts`: `useCombinedBoardState(..., generationJob)` builds the `generation` controls through `useGenerationJob`, whose `check` defaults to `checkPlan` (`use-generation-job.ts:65`). This is where a viewer's Refresh must switch to the read action.
- `src/_pages/plan-comparison/model/scoreboard.ts:10-12`, `ui/PlanComparisonPage.test.tsx:65`: the comparison page names **no baseline** and carries no deltas. The Current badge sits beside a plan's name and must not reorder, privilege or annotate the columns.
- `e2e/CLAUDE.md` "Never assert on the sidebar footer's text": the reason is the *author's* display name, which `account.spec.ts` changes. A viewer spec may assert the "View only" chip by its own accessible name. The rule's wording gains that carve-out in Phase 5.
- `src/shared/ui/current-plan-badge.tsx`: the existing `CurrentPlanBadge`, importable from every layer that renders a plan name.

## What We're NOT Doing

- **Delivering when a viewer looks.** Decided: (a). No solver-side delivery, trigger, second DEFINER RPC, cron or machine principal. An undelivered proposal's board, comparison and perspective views stay closed to a viewer until an author or admin opens it.
- **A read-only preview of an undelivered board** (option (c)).
- **Letting the hub poll deliver** to shrink the waiting window. S-303's status-only hub poll stays as it is.
- **Showing the palette or shelf read-only.** Decided: a viewer gets neither.
- **Disabled-but-visible controls.** Edit controls are absent, never greyed out.
- **A durable "this was a proposal" lineage** after delivery (no migration). A delivered proposal is "not current" like any other unmarked plan. Its "Generated from …" strip still shows while its source exists.
- **A marker inside exported workbooks.** They have no title row. Only the file name carries it.
- **Any migration, RLS change, new DEFINER function, `database.types.ts` regen or wire-contract change.**
- **Stop for viewers.** The PRD access table already says no. Requester-scoped Stop is S-407.
- **S-403's bookkeeping** (its manual Progress rows and archive). The user owns that.
- **Admin or Users-page surfaces** (S-406).

## Implementation Approach

The visit path goes first because it is the only thing that is actually broken: a viewer gets errors and a page that writes. It also introduces the `canEdit` prop the board needs anyway. The UI gate follows, one surface family per phase: board, then hub and catalogs. Labelling and the "View only" chip are independent of the gate and come next. The viewer e2e account and specs come last, because they walk every gated page and prove the decided Open Question 1 behaviour end to end.

**One capability prop, computed once per request.** Each route computes `canEdit = allows(Astro.locals.access, "edit")` and passes it down: through the slice `.astro` wrapper where one exists, straight to the island where none does. Islands never read the role.

**Absent handler means absent control.** On the board, the write handlers move into an optional `edit` sub-record of `CellWiring`. When it is missing, the leaves render no write control and enable no drag. This extends the existing `ScheduleGrid` `onInspect` idiom rather than adding a `readOnly` boolean to every leaf.

**Derived-state dispatch over inline conditions.** The palette's new `"hidden"` outcome lives in `resolvePaletteView`. The pending page's panel choice becomes a pure `resolvePendingPanel` in `model/`. The hub's viewer copy lives in `describeGenerationIndicator`. This follows the user's orchestration-over-patching preference and `ui-conventions.md`.

## Critical Implementation Details

- **State sequencing in `index.astro`.** A non-editor never runs `releaseOrphanProposal`. The "stranded" panel (pending proposal, no job, read did not fail) is the viewer's version of the state an author's visit would release. `swept` can only arise on the editor path, because only `checkPlan` sweeps. Keep the existing re-read of `settled` for both paths: an author may have delivered between the two reads.
- **`sameView` must gain `stalled` and `awaitingDelivery` in the same commit that adds them to the view.** Otherwise the store never publishes the waiting → delivered transition's precursor states.
- **The `-current` file-name segment is a snapshot of the moment of export.** A file downloaded while the plan was current keeps the name after the marker moves. That is honest, because it was current when exported, and needs no handling.

## Phase 1: A Write-Free Visit Path

### Overview

Split the plan visit into a pure read for non-editors and the existing delivering path for editors. Pass `canEdit` from the route to the pending page and the board's generation controls, give the viewer correct copy for every job state, and keep the viewer's poll alive until an author delivers. This fixes every symptom S-403 handed over.

### Changes Required:

#### 1. The read module

**File**: `src/_pages/plan-detail/api/generation-read.ts` (new); `src/_pages/plan-detail/api/generation-delivery.ts`

**Intent**: Move the write-free half of `checkPlan` into its own module, whose docblock states that nothing in it writes. Add `readPlanJob` there. `checkPlan` keeps the `settle` / `markNotified` path and imports the read helpers. The separate file is what makes "never writes" checkable at a glance. The delivery file is ~600 lines and mixes the two today.

**Contract**:

- `generation-read.ts` owns `STATUS_COLUMNS`, `StatusRow`, `latestJobBy`, `pickJob`, `labelOf`, `planName`, `toView`, `GenerationJobRole` and `GenerationJobView`.
- `export const readPlanJob = (supabase, input: CheckPlanInput) => Promise<GenerationJobView | null>`: the same dual-keyed read and `pickJob` precedence as `checkPlan`. It calls no reclaim, deliver, sweep, fail, clear or stamp, and it reads the source name on the proposal role.
- `GenerationJobView` gains:
  - `stalled: boolean`, from `isStaleActiveJob(row, nowMs)`;
  - `awaitingDelivery: boolean`, from `isDeliverableJob(row)`.
  - `toView` takes `nowMs`, and both readers pass `Date.now()`. On the editor path, reclaim and delivery run first, so both flags come back false there except when a CAS was lost.
- Importers of the moved types (~20 files, mostly tests) update their import path. The `api/index.ts` barrel exports `readPlanJob` beside `checkPlan`.

#### 2. Actions and the client

**File**: `src/_pages/plan-detail/api/generation-actions.ts`, `src/_pages/plan-detail/api/generation-client.ts`, `src/actions/action-capabilities.test.ts`

**Intent**: Pin capabilities to what each action actually does. `checkPlan` writes, so it becomes `edit`. A new `readPlanJob` action is `read`.

**Contract**: `checkPlan: defineDomainAction({ input: checkPlanInput, run: checkPlan })` (the default `edit`). `readPlanJob: defineDomainAction({ input: checkPlanInput, run: readPlanJob, requires: "read" })`. The client gains a `readPlanJob(planId)` wrapper. In `NON_EDIT`, `readPlanJob: "read"` replaces `checkPlan`, so exactly four non-`edit` actions remain.

#### 3. The route

**File**: `src/pages/plans/[id]/index.astro`, `src/_pages/plan-detail/ui/PlanDetailPage.astro`

**Intent**: Pick the domain path by capability, skip the orphan release for non-editors, and pass `canEdit` down to both renderings.

**Contract**:

- `const canEdit = allows(Astro.locals.access, "edit")`. Editors call `checkPlan`, everyone else `readPlanJob`, with the same `{job, failed}` catch shape. `releaseOrphanProposal` runs only when `canEdit`.
- `PendingProposalPage` gets `canEdit` and `stranded` (`!canEdit && isPendingProposal(summary) && job === null && !failed`).
- `PlanDetailPage` → `PlannerBoard` gets `canEdit`. Phase 2 uses the same prop for gating.
- Update the route's docblock: "a visit is a write only for an editor".

#### 4. The pending page

**File**: `src/_pages/plan-detail/model/generation/pending-panel.ts` (new, pure), `src/_pages/plan-detail/ui/PendingProposalPage.tsx`, `src/_pages/plan-detail/model/generation/use-pending-proposal.ts`

**Intent**: Choose the panel through a derived-state dispatch, so the viewer's states are named rather than inline ternaries. Hide Stop & keep from non-editors. Keep a viewer's poll alive while the board is still to come.

**Contract**:

- `resolvePendingPanel(job: GenerationJobView | null, { canEdit, stranded }): PendingPanel`, where `PendingPanel` is one of `"unreadable" | "stranded" | "delivered" | "progress" | "stalled" | "awaiting-author" | "stopped" | "failed"`.
  - The viewer-only kinds are `stranded`, `stalled` and `awaiting-author`. For editors, an active stalled row stays `"progress"`, because their visit reclaims it.
- The copy is separate per kind and capability:
  - `"stopped"` for a viewer: "This generation was stopped before any stage finished — nothing was kept."
  - `"progress"` for a viewer drops "you can leave the page".
  - `"unreadable"` stays the existing neutral "could not be read just now — refresh".
- `StopAndKeep` renders only when `canEdit`.
- `createPendingProposalStore` takes `canEdit`:
  - `check` defaults to `readPlanJob` for non-editors;
  - for non-editors, `isActive` is also true while `snapshot.awaitingDelivery`;
  - `sameView` compares `stalled` and `awaitingDelivery`.

#### 5. The board's generation controls

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`, `src/_pages/plan-detail/model/use-cohort-board-state.ts`, `src/_pages/plan-detail/model/generation/use-generation-job.ts`, `src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx`

**Intent**: A viewer's strip Refresh must call the read action, because `checkPlan` now answers them `FORBIDDEN`. Its copy must not tell a viewer to generate or claim they stopped anything.

**Contract**:

- `canEdit` reaches `useGenerationJob`, whose `check` becomes `readPlanJob` for non-editors.
- `GenerationStatusStrip` takes `canEdit`. For non-editors:
  - `awaitingDelivery` → "Finished — waiting for an author to open it";
  - `stalled` → "Stopped reporting progress — an author's visit will settle it";
  - the halted-nothing-kept summary uses the neutral subject and drops "Generate again when you are ready."
- The delivered-proposal provenance line is unchanged.

#### 6. Delivery errors and matrix evidence

**File**: `src/_pages/plan-detail/api/placements.ts`, `src/_pages/plan-detail/api/generation-delivery.ts`, `src/test/role-matrix-expectations.ts`, `src/test/role-matrix.integration.test.ts`

**Intent**: Defence in depth. A 42501 that reaches the delivery writes surfaces as `FORBIDDEN`, not `INTERNAL_SERVER_ERROR`. The matrix also records that a viewer cannot deliver a board or persist groupings.

**Contract**:

- The `apply_generated_placements` call (`placements.ts:128`), `clearPending` and `markDelivered` route their PostgREST errors through `toDomainError` (`src/shared/api/postgrest/to-domain-error.ts:15`).
- `Rpc` gains `apply_generated_placements` and `replace_cohort_groupings`, with cells `anon`/`noRole`/`viewer` denied and `author`/`admin` allowed, plus one `RPC_PROBES` entry each following the existing probes.
- These cells record existing behaviour, not an access-control change, so they are expected green on first run.

#### 7. Tests

**File**: `src/_pages/plan-detail/model/generation/pending-panel.test.ts` (new), `use-pending-proposal.test.ts`, `ui/PendingProposalPage.test.tsx`, `ui/chrome/GenerationStatusStrip.test.tsx`, `api/generation-read.integration.test.ts` (new)

**Intent**: Unit-test the dispatch and the store's viewer rules. Prove in an integration suite, under a real viewer session, that a viewer's read never writes and that a following author visit still delivers.

**Contract**:

- `pending-panel.test.ts`: every kind × `canEdit`, including stalled for an editor → `"progress"`.
- Store tests:
  - a viewer store keeps ticking on `awaitingDelivery`;
  - it reloads on the first `delivered` tick;
  - an editor store stops on the same snapshot;
  - `sameView` distinguishes `stalled` and `awaitingDelivery`.
- The integration suite uses `createSignedInUser(admin, { role: "viewer" })` and an author from the same factory, building jobs the way `generation-delivery.integration.test.ts` does:
  - a succeeded job with `result`, read as the viewer → `awaitingDelivery: true`. The job row, `pending_proposal` and the proposal's placements are unchanged.
  - Then `checkPlan` as the author → delivered. Then the viewer read → `delivered: true`, and `notified_at` was stamped only by the author.
  - A stale `running` row, read as the viewer → `stalled: true`, with the row still `running`.
  - A delivered proposal with `notified_at` null, read as the viewer → still null.

### Success Criteria:

#### Automated Verification:

- [ ] Type check passes: `pnpm check`
- [ ] Lint and FSD structure pass: `pnpm lint && pnpm steiger`
- [ ] Unit suite passes, including `action-capabilities.test.ts` with `readPlanJob` in `NON_EDIT`: `pnpm test`
- [ ] Viewer-read integration suite passes: `pnpm test:integration src/_pages/plan-detail/api/generation-read.integration.test.ts`
- [ ] Existing delivery and proposal suites still pass: `pnpm test:integration src/_pages/plan-detail/api/generation-delivery.integration.test.ts src/test/generation-proposal.integration.test.ts`
- [ ] Role matrix passes with the two new RPC cells: `pnpm test:integration src/test/role-matrix.integration.test.ts`
- [ ] Production build is clean: `pnpm build`

#### Manual Verification:

- [ ] As an author, Generate on a local plan, close the tab, and wait for the solve to finish. As a viewer (`node scripts/assign-role.mjs <email> viewer`), open the proposal: it shows "finished — waiting for an author". There is no Stop, and the server log is free of 42501 / `[checkPlan]` errors.
- [ ] With the viewer's tab still open, open the proposal as the author: within ~5 s the viewer's page reloads into the board.
- [ ] As a viewer, a delivered proposal's hub badge stays "Ready — open" until the author opens it.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: A Read-Only Board

### Overview

With `canEdit` false, the plan-detail board renders the full timetable and every read affordance, and no write control: nothing drags, the cells have no edit actions, and there is no palette, shelf, Generate or undo/redo.

### Changes Required:

#### 1. Cell wiring

**File**: `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx`, `src/_pages/plan-detail/ui/PlannerBoard.tsx` (`buildColumn`)

**Intent**: Group the write handlers into one optional sub-record, so a read-only column is built by leaving it out.

**Contract**:

- `CellWiring` keeps `dropHints`, `hintMode`, `isExploded`, `justDuplicated`, `lensMatched`, `onToggleBundle` and `onInspect`.
- `onRemove`, `onSetWeek`, `onSetOptional`, `onRemoveBundle`, `onDuplicateBundle` and `onLiftBundle` move into `edit?: CellEditHandlers`.
- `buildColumn` sets `edit` only when `canEdit`.
- Update `PlannerGrid.tsx`'s docblock, which lists the wiring fields (lessons: a doc that names a mechanism is coupled to it).

#### 2. Cell and chip leaves

**File**: `src/_pages/plan-detail/ui/grid/slot-cell/SlotCell.tsx`, `SlotHeader.tsx`, `PlacedChip.tsx`, `WeekLane.tsx` (wiring pass-through only)

**Intent**: Where `edit` is absent, render no write control and enable no drag.

**Contract**:

- `SlotHeader` renders Duplicate, Lift to shelf and Remove all only with `edit`. Group/Ungroup always renders.
- `PlacedChip`'s `useDraggable` `disabled` is also true without `edit`. `WeekToggle` and `ChipMenu` render only with `edit`. The `OptionalTag` and the collision/unavailable inspect badge always render.
- `SlotCell`'s bundle draggable is disabled without `edit`.

#### 3. Palette, shelf and header

**File**: `src/_pages/plan-detail/model/grouping/palette-view.ts`, `src/_pages/plan-detail/ui/PlannerBoard.tsx`, `src/_pages/plan-detail/ui/chrome/PlanSummaryBar.tsx`, `src/_pages/plan-detail/ui/history/use-undo-keymap.ts`

**Intent**: Hide the palette and shelf through the existing dispatch, which also removes the focus-mode compute dead end. Leave Generate and undo/redo unmounted.

**Contract**:

- `resolvePaletteView({ groupingsCount, stale, canEdit })` gains a `"hidden"` outcome that wins over `"empty"` and `"stale"` when `!canEdit`. The board renders no palette node for it, and the focus-mode early return (`=== "empty"`) never fires for a viewer.
- The `shelf` node is not rendered when `!canEdit`.
- `PlanSummaryBar` makes the parked-count shelf button optional (`onExpandShelf?`), and the board omits it for viewers.
- The board passes no `undoRedo` and leaves `GenerateButton` out of `trailing` for viewers. `LensPicker`, `ExportMenu`, `BoardSettingsMenu` and `PrintButton` stay.
- `useUndoKeymap` takes an `enabled` flag, false for viewers.

#### 4. Tests

**File**: `src/_pages/plan-detail/model/grouping/palette-view.test.ts`, `src/_pages/plan-detail/ui/grid/slot-cell/SlotCell.test.tsx`

**Intent**: Pin the dispatch's new precedence and the leaves' absent-handler rendering.

**Contract**:

- `palette-view`: `canEdit: false` → `"hidden"` for empty, stale and ready inputs. `canEdit: true` keeps today's three outcomes.
- `SlotCell` without `edit`: no Duplicate / Lift / Remove all buttons, no `radio` named "Week A"/"Week B", no chip menu trigger. Group/Ungroup and the inspect badge are present.

### Success Criteria:

#### Automated Verification:

- [ ] Type check passes: `pnpm check`
- [ ] Lint and FSD structure pass: `pnpm lint && pnpm steiger`
- [ ] Unit suite passes: `pnpm test`
- [ ] Existing board e2e specs stay green for the author: `pnpm test:e2e e2e/specs/combined-view.spec.ts e2e/specs/undo-redo.spec.ts e2e/specs/bundle-operations.spec.ts`
- [ ] Production build is clean: `pnpm build`

#### Manual Verification:

- [ ] As a viewer, on `pnpm build && pnpm preview`: combined, `?focus=dp1` and `?focus=dp2` render the timetable. A focus mode whose cohort has no groupings shows the board, not the compute prompt.
- [ ] As a viewer, nothing can be grabbed (no grab cursor on chips or bundled cells). There are no cell header actions, A/B toggles, chip menus, palette, shelf, parked button, Generate or undo/redo, and ⌘Z does nothing.
- [ ] As a viewer, Group/Ungroup, the collision inspector, lens, zoom, hint mode, export and print work.
- [ ] As an author, the board is unchanged, and a drag still validates within the <200 ms budget.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Read-Only Hub and Catalogs

### Overview

With `canEdit` false, the plans hub and the three catalogs render their data and read affordances only. The two catalog badges open read-only dialogs, and the hub's job badges speak to a viewer.

### Changes Required:

#### 1. Plans hub

**File**: `src/pages/plans/index.astro`, `src/_pages/plans-list/ui/PlansListPage.astro`, `src/_pages/plans-list/ui/PlansHub.tsx`, `src/_pages/plans-list/ui/PlanIndicatorsCell.tsx`, `src/_pages/plans-list/model/plan-indicators.ts`

**Intent**: Hide plan creation and every row write. Give the job badges viewer wording and destinations, because a viewer's visit to the source no longer reclaims or delivers anything.

**Contract**:

- `canEdit` goes route → `PlansListPage` → `PlansHub`.
- For a viewer:
  - "New plan" (header and empty state) and `PlanRowActions` are not rendered;
  - the empty state's copy has no call to create;
  - the row checkboxes, `ComparePlansBar` and the status poll stay.
- `describeGenerationIndicator(indicator, canEdit)`. For non-editors:
  - stale queued/running → "Queued — stalled" / "Generating — stalled", linking to the proposal;
  - undelivered terminal → "Finished — waiting for an author", linking to the proposal;
  - delivered and failed are unchanged.
- `PlanIndicatorsCell` and the poll's re-describe both pass the flag.

#### 2. Courses

**File**: `src/pages/plans/[id]/courses.astro`, `src/_pages/courses/ui/CourseCatalog.tsx`, `CourseTable.tsx`, `CourseOverlaps.tsx`

**Intent**: Hide course and merge creation and the row menu. The overlap badge opens a read-only overlap list.

**Contract**:

- `canEdit` goes route → `CourseCatalog` → `CourseTable`. Without it there is no "New merge" or "New course", and no row menu (every item writes).
- `OverlapBadge` still opens the overlaps dialog. In read-only mode the dialog lists the course's overlaps with no add or remove controls and no submit.
- `TeacherFilter` stays.

#### 3. Teachers

**File**: `src/pages/plans/[id]/teachers.astro`, `src/_pages/teachers/ui/TeacherCatalog.tsx`, `TeacherTable.tsx`, `TeacherAvailabilityDialog.tsx`

**Intent**: Hide teacher creation and row writes, keep "View plan", and show availability read-only.

**Contract**:

- `canEdit` goes route → `TeacherCatalog` → `TeacherTable`.
- Without it there is no "New teacher" (header and empty state), and the row menu holds only "View plan".
- `AvailabilityBadge` opens `TeacherAvailabilityDialog` in read-only mode: the grid renders each slot's availability as non-interactive cells (no column/row/cell toggle buttons) with an accessible label per slot, and there is no save.

#### 4. Students

**File**: `src/pages/plans/[id]/students.astro`, `src/_pages/students/ui/StudentCatalog.tsx`, `StudentTable.tsx`

**Intent**: Hide student creation, bulk selection and row writes, and keep "View plan".

**Contract**:

- `canEdit` goes route → `StudentCatalog` → `StudentTable`.
- Without it there is no "New student" (header and empty state), no selection checkboxes and no `BulkActionBar`, and the row menu holds only "View plan".
- `CourseFilter` stays.

#### 5. Tests

**File**: `src/_pages/plans-list/model/plan-indicators.test.ts`, `src/_pages/plans-list/ui/PlanIndicatorsCell.test.tsx`; co-located tests for the two dialogs' read-only modes

**Intent**: Pin the viewer badge wording and destinations, and the dialogs' read-only rendering.

**Contract**:

- `describeGenerationIndicator` for each status × `canEdit`.
- Each read-only dialog renders its data with no button that writes.

### Success Criteria:

#### Automated Verification:

- [ ] Type check passes: `pnpm check`
- [ ] Lint and FSD structure pass: `pnpm lint && pnpm steiger`
- [ ] Unit suite passes: `pnpm test`
- [ ] Existing hub and catalog e2e specs stay green for the author: `pnpm test:e2e e2e/specs/current-plan.spec.ts e2e/specs/bulk-edit-choices.spec.ts e2e/specs/co-teaching.spec.ts e2e/specs/plan-comparison.spec.ts`
- [ ] Production build is clean: `pnpm build`

#### Manual Verification:

- [ ] As a viewer, on `/plans`: no New plan and no row menus. Compare works, and the job badges read as specified.
- [ ] As a viewer, on courses, teachers and students: no New buttons, no write menu items and no bulk selection. "View plan" works. The overlap and availability dialogs show the same data an author sees, with no way to change it.
- [ ] As an author, the hub and all three catalogs are unchanged.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Labelling and the "View Only" Chip

### Overview

Mark the current plan on every surface that shows a plan's identity: the comparison page, print headings, tab titles and export file names. Then tell a viewer, on every page, that the missing controls are intentional.

### Changes Required:

#### 1. Comparison page

**File**: `src/_pages/plan-comparison/api/load-plan-analysis.ts`, `src/_pages/plan-comparison/api/load-comparison.ts`, `src/_pages/plan-comparison/ui/ScoreboardTable.tsx`, `src/_pages/plan-comparison/ui/PlanComparisonPage.tsx`

**Intent**: Carry `is_current` through the comparison and render the existing badge beside each current plan's name.

**Contract**:

- The plan read selects `is_current`.
- `ComparisonData.plans` and the column and per-plan shapes carry `isCurrent`.
- `CurrentPlanBadge` renders beside `column.planName` and in `PlanDetailCard`'s heading.
- No column order, delta or emphasis changes (the page's no-baseline rule).

#### 2. Print headings

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx` (print-only block), `src/_pages/student-plan-view/api/loader.ts`, `src/_pages/student-plan-view/ui/StudentPlanPage.tsx`, `src/_pages/teacher-plan-view/api/loader.ts`, `src/_pages/teacher-plan-view/ui/TeacherPlanPage.tsx`

**Intent**: A printed board or perspective page of the current plan says so on paper.

**Contract**:

- Both perspective loaders' plan select (`loader.ts:82` / `:137`) adds `is_current`, and their data carries `isCurrent`.
- The `{planName} — student/teacher schedule` line and the board's print-only `<h1>` render `CurrentPlanBadge` when current, visible both on screen and in print.

#### 3. Tab titles

**File**: `src/app/layouts/SidebarLayout.astro`

**Intent**: The browser tab of any page about the current plan says so, in one place.

**Contract**: When the `plan` prop is current, the document title is `${title} · Current`. Routes are unchanged, because every plan-scoped route already passes `plan` with `is_current`.

#### 4. Export file names

**File**: `src/shared/lib/plan-file-stem/` (new: barrel plus concept file, per the barrel convention), `src/_pages/plan-detail/lib/export-file-name.ts`, `src/_pages/plan-detail/lib/batch-export-workbooks.ts`, `src/_pages/student-plan-view/lib/export-file-name.ts`, `src/entities/timetable/model/export/perspective-workbook.ts`, and their callers (`ExportMenu.tsx`, `StudentPlanPage.tsx`, `ExportTeacherPlanButton.tsx`)

**Intent**: One stem helper, so every export of the current plan is named consistently.

**Contract**:

- `planFileStem(planName: string, isCurrent: boolean): string` → `slugify(planName)`, plus `-current` when current.
- All four builders take `isCurrent` and use it, so the board gives `<stem>-<view>.xlsx`, the batch `<stem>.zip`, the student export `<stem>-<cohort>-<student>.xlsx` and the teacher export `<stem>-<code>.xlsx`.
- Existing file-name tests gain the current case.

#### 5. "View only" chip

**File**: `src/app/layouts/SidebarLayout.astro`, `src/shared/ui/view-only-badge.tsx` (new, exported from `src/shared/ui/index.ts`)

**Intent**: One global marker that this account reads but does not edit, so a user whose role was changed knows the controls are gone on purpose.

**Contract**:

- It renders in the sidebar footer beside the account label when `allows(access, "read") && !allows(access, "edit")`.
- Its accessible name is "View only".
- Its styling is distinct from `CurrentPlanBadge`: muted or outline, with an eye icon, using semantic tokens only.
- On the collapsed rail it shows the icon alone, keeping its accessible name.
- It is `print:hidden` like the rest of the sidebar.

#### 6. Tests

**File**: co-located tests for `plan-file-stem`, the four file-name builders, `ScoreboardTable` / `PlanComparisonPage` (badge present for the current plan only, no other cell changes) and `view-only-badge`

**Intent**: Pin the naming rule and the marker placement.

**Contract**: As listed. The `PlanComparisonPage.test.tsx` no-baseline assertions stay green unchanged.

### Success Criteria:

#### Automated Verification:

- [ ] Type check passes: `pnpm check`
- [ ] Lint and FSD structure pass: `pnpm lint && pnpm steiger`
- [ ] Unit suite passes: `pnpm test`
- [ ] Existing label and export e2e specs stay green: `pnpm test:e2e e2e/specs/current-plan.spec.ts e2e/specs/export-xlsx.spec.ts e2e/specs/printable-version.spec.ts e2e/specs/plan-comparison.spec.ts`
- [ ] Production build is clean: `pnpm build`

#### Manual Verification:

- [ ] Mark a plan current. Compare it with a non-current plan: only the current one carries the badge, and nothing else on the page changed.
- [ ] Print preview the current plan's board, a student view and a teacher view: each heading carries "Current". A non-current plan's prints carry nothing.
- [ ] Tab titles of the current plan's pages end with "· Current". Exports of the current plan download as `<plan>-current-….xlsx` / `.zip`.
- [ ] As a viewer, "View only" shows in the sidebar footer, expanded and collapsed. As an author or admin, it does not.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Viewer E2E and Docs

### Overview

Add a viewer e2e account and project, a tripwire spec that fails if any gated page regains an edit control, and a generation spec that proves the decided Open Question 1 behaviour in a browser. Then record the rules that keep new controls gated.

### Changes Required:

#### 1. The viewer account and project

**File**: `e2e/viewer-credentials.mjs` (new), `scripts/provision-e2e-author.mjs`, `e2e/viewer.setup.ts` (new), `playwright.config.ts`, `.github/workflows/ci.yml` (comment at `:276`)

**Intent**: A fixed viewer account provisioned like the no-role one, signed in once, and a project that runs only viewer specs.

**Contract**:

- `viewerEmail = "e2e-viewer@example.test"`, with a fixed password of at least 15 characters and no env override.
- One `ACCOUNTS` entry with `role: "viewer"`. The provisioner re-asserts the role on every run.
- `viewer.setup.ts` writes `e2e/.auth/viewer.json` through `signInThroughUi`.
- Project `chromium-viewer` matches `*.viewer.spec.ts` and depends on `setup`. `chromium`'s `testIgnore` gains `/.*\.viewer\.spec\.ts/`.

#### 2. Tripwire spec

**File**: `e2e/specs/read-only.viewer.spec.ts` (new)

**Intent**: Walk every gated page as a viewer and assert that the read controls are present and the edit controls absent. This is the cheap guard against a future ungated control.

**Contract**:

- Data is arranged in a second context on the author's storage state (`browser.newContext({ storageState: "e2e/.auth/user.json" })`): a plan with at least one placement, through the existing `e2e/support/planner.ts` helpers. Teardown deletes it through the author context.
- As the viewer, assert:
  - **hub:** no "New plan" and no row menu, and the Compare checkbox is present;
  - **board** (combined and one focus mode): grid cells present; no Generate, Undo, chip menu, "Week A" radio, palette or shelf;
  - **courses, teachers and students:** no New buttons; teachers and students keep "View plan" as their only row-menu item; no student selection checkboxes;
  - **overlap and availability dialogs:** open, with no write controls;
  - **comparison and both perspective views:** render;
  - the "View only" chip is present by its accessible name.
- Locators are role-based only, following `e2e/CLAUDE.md`.

#### 3. Generation spec

**File**: `e2e/specs/generation.viewer.spec.ts` (new)

**Intent**: Prove the decided Open Question 1 behaviour end to end, with the native solver CI already runs for `generation.spec.ts`.

**Contract**:

1. The author context creates a plan, presses Generate, reads the proposal's URL, and closes its page.
2. The viewer opens the proposal and waits for "finished — waiting for an author". It asserts there is no Stop.
3. The author context opens the proposal, which delivers it.
4. The viewer page, untouched, reloads into the board within the poll interval plus margin, and shows no edit controls.
5. Teardown deletes both plans through the author context.

#### 4. Docs

**File**: `e2e/CLAUDE.md`, `CLAUDE.md` (§ Roles), `README.md` (§ Auth routes)

**Intent**: Record the viewer account's rules and the gating rule, so future controls stay gated and future visit paths stay write-free.

**Contract**:

- `e2e/CLAUDE.md`:
  - the `chromium-viewer` project and its `*.viewer.spec.ts` naming;
  - "the viewer account's role, password and session are never changed";
  - the footer-text rule's carve-out for the "View only" chip, asserted by accessible name.
- `CLAUDE.md` § Roles gains one bullet: edit controls render only when the route-computed `canEdit` (`allows(access, "edit")`) is true, and a page-load or poll path writes only for an editor (`readPlanJob` vs `checkPlan`).
- `README.md`: one line noting that a viewer reads everything, and that a finished proposal waits for an author or admin to open it.

### Success Criteria:

#### Automated Verification:

- [ ] Viewer specs pass: `pnpm test:e2e --project=chromium-viewer`
- [ ] The full e2e suite passes (the solver up per README): `pnpm test:e2e`
- [ ] Lint passes on the new specs and config: `pnpm lint`
- [ ] Full local CI gate passes: `/verify`

#### Manual Verification:

- [ ] Temporarily un-gate one control (e.g. render Generate for viewers): the tripwire spec fails, naming that control. Then revert.
- [ ] Docs read correctly in `e2e/CLAUDE.md`, `CLAUDE.md` and `README.md`.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `resolvePendingPanel`: every kind × capability. Stalled for an editor is `"progress"`, and a null job with `stranded` is `"stranded"`.
- The pending store: viewer keep-alive on `awaitingDelivery`, the reload on `delivered`, the editor stop, and `sameView` covering both new fields.
- `resolvePaletteView`: `"hidden"` wins for read-only, and editors get today's outcomes.
- `SlotCell` / `PlacedChip` without `edit`: no write controls, and drag disabled.
- `describeGenerationIndicator` × `canEdit`.
- The read-only dialogs.
- `planFileStem` and the four builders.
- The comparison badge, without disturbing the no-baseline assertions.
- `action-capabilities.test.ts`: `readPlanJob` is `read`. `checkPlan` falls under the `edit` sweep, so a viewer gets `FORBIDDEN`.

### Integration Tests:

- `generation-read.integration.test.ts`, under a real viewer session: a deliverable job is read without writes and then delivered by an author; a stale job is read without a reclaim; a delivered proposal is read without `notified_at`.
- The role matrix: viewer denied `apply_generated_placements` and `replace_cohort_groupings`.
- The existing delivery, proposal and lifecycle suites stay green. The integration lane flakes about 1 in 5 under `--maxWorkers=2` on `main` already, so re-run before blaming the diff.

### Manual Testing Steps:

1. Give a local account the viewer role: `node scripts/assign-role.mjs <email> viewer`. Keep a second, author account.
2. `pnpm build && pnpm preview` (restart the preview after every build).
3. As the author, generate on a plan and close the tab. As the viewer, open the proposal and watch "finished — waiting for an author". As the author, open it, and watch the viewer's tab flip into the board.
4. As the viewer, walk the hub, the board (combined and focus), the three catalogs and both dialogs, comparison, and both perspective views, and print one of them: no edit control anywhere, "View only" in the footer, "Current" on the current plan.
5. As the author, repeat the walk: nothing changed except the `-current` file names.

## Performance Considerations

- A viewer's poll runs `readPlanJob`: two indexed narrow reads (one round trip), plus a name read on the proposal role. That is the hub poll's weight, and it never touches `snapshot`, `result` or `checkpoint` while the job is undelivered. It runs only while the tab is visible and stops at delivered or terminal.
- The board's drag hot path is unchanged for editors. For viewers there is no drag, so the <200 ms validation budget does not apply.

## Migration Notes

None. No schema, policy, function or wire change, and no data touched. Rollback is a plain revert. Merging still deploys and rolls the container, so the README's no-merge-mid-solve rule applies as usual.

## References

- Research: `context/changes/viewer-read-only/research.md` (§3 affordances, §4 visit-path writes, §5 and follow-up: Open Question 1, §7 labelling, §8 harness)
- Decision: `context/changes/viewer-read-only/change.md`; PRD Open Question 1 (`context/foundation/prd.md:394-403`)
- S-403 handover: `context/changes/fail-closed-roles/plan.md:67-75,501`
- S-404 deferrals: `context/archive/2026-10-29-current-plan-marker/plan.md:51`
- The visit path: `src/pages/plans/[id]/index.astro:42-71`; `src/_pages/plan-detail/api/generation-delivery.ts:163-226`
- The board seams: `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx:32-52`, `src/_pages/plan-detail/ui/PlannerBoard.tsx:204-245`, `src/_pages/plan-detail/model/grouping/palette-view.ts:15-25`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: A Write-Free Visit Path

#### Automated

- [x] 1.1 Type check passes: `pnpm check` — b94bb77
- [x] 1.2 Lint and FSD structure pass: `pnpm lint && pnpm steiger` — b94bb77
- [x] 1.3 Unit suite passes, including `action-capabilities.test.ts` with `readPlanJob` in `NON_EDIT`: `pnpm test` — b94bb77
- [x] 1.4 Viewer-read integration suite passes: `pnpm test:integration src/_pages/plan-detail/api/generation-read.integration.test.ts` — b94bb77
- [x] 1.5 Existing delivery and proposal suites still pass: `pnpm test:integration src/_pages/plan-detail/api/generation-delivery.integration.test.ts src/test/generation-proposal.integration.test.ts` — b94bb77
- [x] 1.6 Role matrix passes with the two new RPC cells: `pnpm test:integration src/test/role-matrix.integration.test.ts` — b94bb77
- [x] 1.7 Production build is clean: `pnpm build` — b94bb77

#### Manual

- [ ] 1.8 As a viewer, a finished undelivered proposal shows "finished — waiting for an author", no Stop, and no 42501 / `[checkPlan]` errors in the server log
- [ ] 1.9 With the viewer's tab open, the author opening the proposal flips the viewer's page into the board within ~5 s
- [ ] 1.10 As a viewer, a delivered proposal's hub badge stays "Ready — open" until the author opens it

### Phase 2: A Read-Only Board

#### Automated

- [x] 2.1 Type check passes: `pnpm check`
- [x] 2.2 Lint and FSD structure pass: `pnpm lint && pnpm steiger`
- [x] 2.3 Unit suite passes: `pnpm test`
- [x] 2.4 Existing board e2e specs stay green for the author: `pnpm test:e2e e2e/specs/combined-view.spec.ts e2e/specs/undo-redo.spec.ts e2e/specs/bundle-operations.spec.ts`
- [x] 2.5 Production build is clean: `pnpm build`

#### Manual

- [ ] 2.6 As a viewer, combined and both focus modes render the timetable, including a focus mode with no groupings
- [ ] 2.7 As a viewer, nothing drags, and no cell action, A/B toggle, chip menu, palette, shelf, parked button, Generate or undo/redo appears; ⌘Z does nothing
- [ ] 2.8 As a viewer, Group/Ungroup, collision inspector, lens, zoom, hint mode, export and print work
- [ ] 2.9 As an author, the board is unchanged and a drag validates within budget

### Phase 3: Read-Only Hub and Catalogs

#### Automated

- [ ] 3.1 Type check passes: `pnpm check`
- [ ] 3.2 Lint and FSD structure pass: `pnpm lint && pnpm steiger`
- [ ] 3.3 Unit suite passes: `pnpm test`
- [ ] 3.4 Existing hub and catalog e2e specs stay green for the author: `pnpm test:e2e e2e/specs/current-plan.spec.ts e2e/specs/bulk-edit-choices.spec.ts e2e/specs/co-teaching.spec.ts e2e/specs/plan-comparison.spec.ts`
- [ ] 3.5 Production build is clean: `pnpm build`

#### Manual

- [ ] 3.6 As a viewer, `/plans` has no New plan or row menus, Compare works, and job badges read as specified
- [ ] 3.7 As a viewer, the catalogs show no write controls, "View plan" works, and the overlap and availability dialogs are read-only
- [ ] 3.8 As an author, the hub and all three catalogs are unchanged

### Phase 4: Labelling and the "View Only" Chip

#### Automated

- [ ] 4.1 Type check passes: `pnpm check`
- [ ] 4.2 Lint and FSD structure pass: `pnpm lint && pnpm steiger`
- [ ] 4.3 Unit suite passes: `pnpm test`
- [ ] 4.4 Existing label and export e2e specs stay green: `pnpm test:e2e e2e/specs/current-plan.spec.ts e2e/specs/export-xlsx.spec.ts e2e/specs/printable-version.spec.ts e2e/specs/plan-comparison.spec.ts`
- [ ] 4.5 Production build is clean: `pnpm build`

#### Manual

- [ ] 4.6 The comparison page badges only the current plan and changes nothing else
- [ ] 4.7 Printed board, student and teacher headings of the current plan carry "Current"; a non-current plan's do not
- [ ] 4.8 The current plan's tab titles end with "· Current" and its exports are named `<plan>-current-…`
- [ ] 4.9 "View only" shows in the sidebar footer for a viewer, expanded and collapsed, and never for an author or admin

### Phase 5: Viewer E2E and Docs

#### Automated

- [ ] 5.1 Viewer specs pass: `pnpm test:e2e --project=chromium-viewer`
- [ ] 5.2 The full e2e suite passes (the solver up per README): `pnpm test:e2e`
- [ ] 5.3 Lint passes on the new specs and config: `pnpm lint`
- [ ] 5.4 Full local CI gate passes: `/verify`

#### Manual

- [ ] 5.5 Temporarily un-gating one control makes the tripwire spec fail naming it, then revert
- [ ] 5.6 Docs read correctly in `e2e/CLAUDE.md`, `CLAUDE.md` and `README.md`
