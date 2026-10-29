# Current-Plan Marker (S-404) Implementation Plan

## Overview

FR-420: an author can mark one plan as **current**, and every user sees which plan is current — on the plans hub and on the plan itself. At most one plan is current; none is current at migration time. This is the marker S-405 labels proposals and drafts against.

The marker is a column on `plans`, guarded by the database (one current plan, never a pending proposal), moved by one atomic INVOKER RPC, and cleared by a plain update. Authors mark and unmark from the hub's row menu. A "Current" badge shows on the hub (current row pinned first), beside the board heading, and in the sidebar plan label and breadcrumb of every single-plan page. Deleting the current plan is allowed, with a warning in the delete dialog.

## Current State Analysis

From `context/changes/current-plan-marker/research.md` (verified against `f3789b6`):

- `plans` has six columns (`id, name, slot_grid_preset, created_at, updated_at, pending_proposal`), only a primary key, and a `moddatetime` trigger (`plans_updated_at`, `20260602185012_minimal_domain_schema.sql:98-100`) that bumps `updated_at` on **every** update. The hub's "Last updated" reads that column (`plans-list/api/loader.ts:42`, `PlansHub.tsx:158`). Board edits never touch it, so today it changes only on a rename or a `pending_proposal` flip.
- Nothing marks a plan current. The old `plan_variants.is_final` was dropped in 2026-06 with the note "an additive nullable column later".
- S-403 is merged: `plans` carries the four capability policies (`20261028200630_fail_closed_policies.sql:77-93`). An author/admin UPDATE passes, a viewer's fails 42501, a role-less user's matches nothing. `defineDomainAction`'s default `requires: "edit"` refuses a viewer before the database.
- `clone_plan` (latest: `20260711174905_clone_plan_include_board.sql:26-31`) inserts an explicit `(name, slot_grid_preset)` list, so a new column is never copied — a clone or a fresh proposal always starts unmarked.
- A pending proposal must not carry the marker (research §3: no board, refused by perspective and comparison views, up to seven best-effort sweeps delete it, detach/orphan branches leave a pins-only plan). Every system delete targets a pending clone, so with that rule no automatic path ever deletes the current plan.
- Analog: `renamePlan` — `assertNotPending` → race-free `.eq("pending_proposal", false)` write → `unwrapRow` → `defineDomainAction` → `plans-client.ts` wrapper → `DropdownMenuItem` in `PlanRowActions` → toast + `refreshPage()`.
- The board route already loads the plan summary before the board (`src/pages/plans/[id]/index.astro:43`, re-read as `settled` at `:77`), so the board heading can take the flag from it without touching `loadCombinedPlannerData`.
- Postgres is 17 (`supabase/config.toml:36`), so `CREATE OR REPLACE TRIGGER … WHEN (…)` is available — the trigger can be narrowed without a `DROP`.

## Desired End State

- `plans.is_current boolean not null default false` exists on hosted with every row `false`. The database refuses a second current plan (23505) and a current pending proposal (23514).
- `public.set_current_plan(p_plan_id uuid)` moves the marker atomically: on success exactly the target is current; on a missing, hidden or pending target nothing changes.
- Moving or clearing the marker does not change "Last updated" on either plan; a rename still does.
- On `/plans`: the current plan is the first row and carries a "Current" badge next to its name. Each non-current row's menu offers **Mark as current**; the current row's offers **Unmark as current**. Marking a pending proposal is refused with the existing pending CONFLICT toast. A viewer sees the badge; their Mark/Unmark is refused with the FORBIDDEN toast (gating the affordance is S-405).
- The delete dialog for the current plan adds: *"This is the current plan. After you delete it, no plan is current until someone marks another."* Delete still proceeds.
- On every single-plan page (board, courses, students, teachers, both perspective views), the sidebar plan label and — where shown — the breadcrumb carry the badge. The board heading (`BoardHeader`) carries it in every board state.
- Role matrix: `RPCS.set_current_plan` is green — `author`/`admin` allowed, `anon`/`noRole`/`viewer` denied.

Verify with the Progress checklist below; the e2e spec walks the whole user flow.

### Key Discoveries:

- `src/_pages/plans-list/api/rename-plan.ts:21-36` — the guard + race-free filter + `unwrapRow` shape to copy.
- `src/shared/api/postgrest/to-domain-error.ts:15-21` — `conflict` maps 23505, `notFound` maps PGRST116, 42501 is always FORBIDDEN.
- `src/test/role-matrix-expectations.ts:58,209-212` — the hand-written `Rpc` union and `RPCS` cells; `src/test/role-matrix.integration.test.ts:510-515` — `RPC_PROBES`, one per RPC.
- `supabase/migrations/20261028140939_user_roles.sql:134-142` — the latest function-grant precedent: `revoke execute … from public, anon` then `grant execute … to authenticated`.
- `src/shared/api/load-plan-summary.ts:15-25,44-54` — the summary every plan-scoped route reads and passes as `SidebarLayout`'s `plan` prop.
- `src/app/layouts/SidebarLayout.astro:12-13,106-122,154-165` — the `plan` prop type `{ id; name }`, the sidebar label and the breadcrumb.
- `BoardHeader` renders in two places: `PlannerBoard.tsx:235` (focus-mode empty state) and `chrome/PlanSummaryBar.tsx:44` (populated board).
- `src/shared/ui/optional-tag.tsx` — precedent for a small domain-named marker component in `shared/ui`, which is the only layer the hub (`_pages/plans-list`), the board (`_pages/plan-detail`) and the layout (`app`) can all import.
- `e2e/support/planner.ts:106-114` — `deletePlan` finds the hub row by `getByRole("link", { name })`; the badge must sit **outside** the name link so that name stays exact.

## What We're NOT Doing

- **Gating the Mark/Unmark affordance by capability.** S-405 owns the viewer sweep; until then the action refuses a viewer with FORBIDDEN, like every other hub action today.
- **Refusing deletion of the current plan.** Decided: warn in the dialog, then delete; zero current is legal.
- **Mark/Unmark from the board.** Hub row menu only.
- **Showing the marker on printed perspective headers, print titles, tab titles, export file names or the comparison page.** The comparison page keeps its deliberate "no baseline" naming.
- **Freezing the current plan.** It stays fully editable (PRD Socrates note on FR-420).
- **Stale-page protection (compare-and-set).** The PRD accepts that any author can move the marker; a move from an out-of-date hub simply wins.
- **Live push of marker moves.** Another author's move shows on the next reload, like a rename.
- **Changing `clone_plan`, the seed or the generator.** The column default covers all three.
- **Fixing S-403 doc drift** (research "Doc drift to fix"). Out of scope.

## Implementation Approach

Database first, because the invariants live there and the role-matrix rule asks for the access claim to go red before the migration turns it green. Then the hub — the only place the marker can be moved — reusing `renamePlan`'s chain. Then the read-only surfaces, which all hang off `loadPlanSummary`. E2E last, because it walks hub → board → sibling page in one flow.

## Critical Implementation Details

**RPC ordering.** `set_current_plan` must lock and validate the **target** row first (`select … for update`, exists, not pending) and return no row without touching anything if that fails. Only then unset the old current row and set the target. Unsetting first would leave zero current when the target turns out to be invalid — the exact failure the RPC exists to prevent. A concurrent mover that loses the race hits the unique index with 23505, which the domain function maps to CONFLICT.

**Test isolation.** `is_current` is the first fact that spans plans, and the integration lane runs files in parallel (`--maxWorkers=2`). The role matrix's allowed probes will really mark a fresh plan current. So no integration test may assert "plan X is current right now" or "no plan is current" by reading the table after the fact. Assert on the RPC's returned row, on "at most one current", and on the target's own flag after an unmark. Provoke the unique violation in **one** statement (mark two of the test's own plans at once) so it never depends on which plan someone else marked. All marker-moving integration tests live in one new file.

**Trigger condition.** Re-declare `plans_updated_at` with `CREATE OR REPLACE TRIGGER … WHEN (old.is_current is not distinct from new.is_current)`. Both marker writes change only `is_current`, so neither bumps `updated_at`; every other update still does, including future columns. No path updates `is_current` together with another column, and the migration comment must say why that matters.

## Phase 1: Database — the marker and its move

### Overview

Add the column, its two invariants, the narrowed trigger and the RPC; state the RPC's access as a role-matrix cell (red first); regenerate types; prove the database rules.

### Changes Required:

#### 1. Role-matrix expectation (red first)

**File**: `src/test/role-matrix-expectations.ts`

**Intent**: State the new RPC's access claim before the function exists, so the matrix goes red, per CLAUDE.md.

**Contract**: `Rpc` gains `"set_current_plan"`; `RPCS.set_current_plan = { anon: "denied", noRole: "denied", viewer: "denied", author: "allowed", admin: "allowed" }`. Update the `Rpc` doc comment.

**File**: `src/test/role-matrix.integration.test.ts`

**Intent**: Add the probe the new cell runs.

**Contract**: `RPC_PROBES.set_current_plan` creates a fresh plan with the service role (registered for teardown), calls `client.rpc("set_current_plan", { p_plan_id })` as the principal, and reads `is_current` back with the service role: `true` → allowed, else denied (route it through the existing `probeWrite`/read-back helpers). A comment notes the allowed probe moves the global marker on purpose, and why that is safe (Critical Implementation Details → Test isolation).

#### 2. Migration

**File**: `supabase/migrations/<timestamp>_current_plan_marker.sql` (via `pnpm exec supabase migration new current_plan_marker`)

**Intent**: Add the marker and every database-level rule for it, additive-only and safe against live data. Header comment in the house style (`20261028200630` is the model): what changes, why a column (not a table), why the trigger is re-declared rather than dropped, and that no plan is current afterwards (FR-420 migration rule).

**Contract**:
- `alter table public.plans add column is_current boolean not null default false` + a column comment ("at most one; never a pending proposal; moved by `set_current_plan`").
- A global partial unique index allowing one `true` row (e.g. `create unique index plans_one_current on public.plans ((true)) where is_current`).
- `alter table public.plans add constraint plans_current_not_pending check (not (is_current and pending_proposal))`.
- `create or replace trigger plans_updated_at before update on public.plans for each row when (old.is_current is not distinct from new.is_current) execute function extensions.moddatetime(updated_at)`.
- `public.set_current_plan(p_plan_id uuid) returns setof public.plans`, `language plpgsql`, `security invoker`, `set search_path = ''`: lock + validate the target, return nothing if invalid, else unset any other current row, set the target, return it. No role checks in the body (CLAUDE.md: RLS decides).
- `revoke execute on function public.set_current_plan(uuid) from public, anon; grant execute … to authenticated;` (precedent `20261028140939:134-142`).

#### 3. Generated types

**File**: `src/shared/api/database.types.ts`

**Intent**: Regenerate with `pnpm db:types` (stack up, migration applied); check the diff shows `is_current` on `plans` Row/Insert/Update and a `set_current_plan` Functions entry. Never hand-edit.

#### 4. Database-rule integration tests

**File**: `src/_pages/plans-list/api/current-plan.integration.test.ts` (new; the one file allowed to move the marker outside the matrix)

**Intent**: Prove the invariants and the RPC behaviour at the database level, as service role, following the isolation rules above.

**Contract** — named cases:
- "a new plan and a clone are not current" — `createPlan` and `clonePlan` of a current source both give `is_current = false`.
- "set_current_plan returns the target marked current, and at most one plan is current".
- "set_current_plan moves the marker: the previously marked plan is no longer current" (mark A, mark B, read A).
- "set_current_plan on a missing plan returns no row and changes nothing" (A stays marked if it still is — assert only that the call returned zero rows).
- "set_current_plan on a pending proposal returns no row".
- "the database refuses two current plans" — one `update … set is_current = true where id in (A, B)` → 23505.
- "the database refuses a current pending proposal" — set `is_current` on a pending plan → 23514.
- "moving the marker does not change updated_at on either plan; a rename still does".

### Success Criteria:

#### Automated Verification:

- Role matrix is red on the new cell before the migration: `pnpm test:integration src/test/role-matrix.integration.test.ts`
- Migration applies from scratch: `pnpm exec supabase db reset`
- Role matrix is green after the migration: `pnpm test:integration src/test/role-matrix.integration.test.ts`
- Database-rule suite passes: `pnpm test:integration src/_pages/plans-list/api/current-plan.integration.test.ts`
- Types regenerated and type-check passes: `pnpm db:types && pnpm check`
- Lint and FSD: `pnpm lint && pnpm steiger`

#### Manual Verification:

- `select count(*) from plans where is_current` is 0 on a freshly migrated local stack (FR-420 migration rule).
- `has_function_privilege('anon', 'public.set_current_plan(uuid)', 'EXECUTE')` is false and `…('authenticated', …)` is true.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Hub — mark, unmark, show

### Overview

The two actions, the hub's row flag and pinning, the shared badge, the menu items and the delete-dialog warning.

### Changes Required:

#### 1. Input schemas

**File**: `src/_pages/plans-list/model/schemas.ts` (+ `schemas.test.ts`)

**Intent**: id-only inputs for the two actions, following `deletePlanInput`.

**Contract**: `markCurrentPlanInput`, `unmarkCurrentPlanInput` (`{ id: z.uuid() }`) and their inferred types.

#### 2. Domain functions

**File**: `src/_pages/plans-list/api/mark-current-plan.ts` (new)

**Intent**: Mark a plan current, copying `renamePlan`'s shape: `assertNotPending` for the named CONFLICT message, then the RPC as the race-free write.

**Contract**: `markCurrentPlan(supabase, { id }) → PlanRecord` — `assertNotPending(supabase, id)`, then `unwrapRow(await supabase.rpc("set_current_plan", { p_plan_id: id }).single(), { notFound: "Plan not found.", conflict: "Another author just changed the current plan. Refresh and try again.", failure: "Failed to mark the plan current" })`. The docblock explains why pending is refused (research §3) and that a clone never inherits the marker.

**File**: `src/_pages/plans-list/api/unmark-current-plan.ts` (new)

**Intent**: Clear the marker from a plan that holds it. A plain update — clearing cannot break "at most one" — so no RPC is needed.

**Contract**: `unmarkCurrentPlan(supabase, { id }) → PlanRecord` — `.update({ is_current: false }).eq("id", id).eq("is_current", true).select().single()` through `unwrapRow` with `notFound: "This plan is no longer the current plan. Refresh to see which one is."`.

#### 3. Actions and client wrappers

**File**: `src/_pages/plans-list/api/actions.ts`, `src/_pages/plans-list/api/plans-client.ts`

**Intent**: Expose both as edit actions (the default `requires`) and as one-line client wrappers. `action-capabilities.test.ts` covers them automatically.

**Contract**: `planActions.markCurrentPlan`, `planActions.unmarkCurrentPlan`; `plans-client.ts` exports `markCurrentPlan` / `unmarkCurrentPlan` via `callAction`.

#### 4. Hub loader

**File**: `src/_pages/plans-list/api/loader.ts`

**Intent**: Carry the flag on every row and pin the current plan first, server-side, so the 200-row limit can never cut it off.

**Contract**: `PlanRow` gains `isCurrent: boolean`; the select adds `is_current`; the order becomes `.order("is_current", { ascending: false }).order("name")`. Update the `PlanRow` docblock.

#### 5. Shared badge

**File**: `src/shared/ui/current-plan-badge.tsx` (new) + export from `src/shared/ui/index.ts`

**Intent**: One "Current" badge for all three layers that show it, built on `Badge` with semantic tokens only (lessons: semantic theme tokens). Renders as static SSR markup from `.astro` too.

**Contract**: `CurrentPlanBadge({ className? })` → a `Badge` reading "Current" with an accessible "Current plan" name (e.g. `title` + visually-hidden text, or `aria-label`).

#### 6. Hub UI

**File**: `src/_pages/plans-list/ui/PlansHub.tsx`

**Intent**: Badge in the Name cell, **outside** the name link; Mark/Unmark in `PlanRowActions`.

**Contract**:
- Name cell: `<a>{plan.name}</a>` then `{plan.isCurrent && <CurrentPlanBadge />}`.
- `PlanRowActions` gets a fourth item before Delete: "Mark as current" when `!plan.isCurrent`, "Unmark as current" when `plan.isCurrent`. One click, no dialog: busy-guarded call → error toast on failure → success toast ("'<name>' is now the current plan" / "'<name>' is no longer the current plan") → `refreshPage()`. Reuse `useConfirmAction`'s flow if it fits a menu item cleanly, otherwise a small hook beside it with the same behaviour.
- Update the `PlansHub` docblock: the hub is no longer a list of strict peers — the current plan is pinned.

**File**: `src/_pages/plans-list/ui/DeletePlanDialog.tsx`

**Intent**: Warn, don't refuse, when the plan is current.

**Contract**: When `plan.isCurrent`, the description adds: *"This is the current plan. After you delete it, no plan is current until someone marks another."* `deletePlan` (domain) is unchanged.

#### 7. Action-level integration tests

**File**: `src/_pages/plans-list/api/current-plan.integration.test.ts` (same file as Phase 1)

**Contract** — named cases:
- "markCurrentPlan returns the plan marked current".
- "markCurrentPlan on a pending proposal throws CONFLICT with the pending message".
- "markCurrentPlan on a missing plan throws NOT_FOUND 'Plan not found.'".
- "unmarkCurrentPlan clears the marker on the plan that holds it".
- "unmarkCurrentPlan on a plan that is not current throws NOT_FOUND".
- "deletePlan deletes the current plan (no refusal)".
- "the hub loader returns isCurrent for each row" (assert the flag on the test's own plan right after marking it via the returned row path — not the ordering, which e2e covers).

### Success Criteria:

#### Automated Verification:

- Unit tests pass (schemas, action capabilities): `pnpm test`
- Marker suite passes: `pnpm test:integration src/_pages/plans-list/api/current-plan.integration.test.ts`
- Existing hub suites still pass: `pnpm test:integration src/_pages/plans-list`
- Type-check: `pnpm check`
- Lint and FSD: `pnpm lint && pnpm steiger`
- Build stays clean: `pnpm build`

#### Manual Verification:

- On `pnpm build && pnpm preview` as an author: Mark a plan → toast, row jumps to the top with the badge; mark another → the badge moves; Unmark → no badge; "Last updated" unchanged on both.
- Mark a pending proposal → the pending CONFLICT toast; nothing moves.
- Delete dialog of the current plan shows the warning; deleting works and leaves no badge.
- As a viewer: badge visible; Mark is refused with the FORBIDDEN toast.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: The plan itself — board heading, sidebar, breadcrumb

### Overview

Carry the flag through `loadPlanSummary` to the sidebar and breadcrumb on every single-plan page, and from the board route's summary to `BoardHeader`.

### Changes Required:

#### 1. Plan summary

**File**: `src/shared/api/load-plan-summary.ts`

**Intent**: Every plan-scoped route gets the flag with no extra query.

**Contract**: `PlanSummary` gains `is_current: boolean` (row-shaped, like its siblings); the select adds `is_current`.

#### 2. Sidebar and breadcrumb

**File**: `src/app/layouts/SidebarLayout.astro`

**Intent**: Badge next to the plan name in the sidebar label (hidden when the sidebar is collapsed, like the label) and in the breadcrumb.

**Contract**: The `plan` prop becomes `{ id: string; name: string; is_current?: boolean }` — matching `PlanSummary`, so the routes that pass the summary (`courses`, `students`, `teachers`, both perspective routes) need no edit. The `role="group"` `aria-label` stays `Plan: <name>`.

#### 3. Board route and heading

**File**: `src/pages/plans/[id]/index.astro`

**Intent**: Pass the flag from `settled` (already loaded) to the layout and the board; the board's own loader stays untouched.

**Contract**: The board branch passes `plan={{ id, name, is_current: settled.is_current }}` and `isCurrent={settled.is_current}` to `PlanDetailPage`. The pending branch needs nothing (a pending plan is never current).

**File**: `src/_pages/plan-detail/ui/PlanDetailPage.astro`, `PlannerBoard.tsx`, `chrome/PlanSummaryBar.tsx`, `chrome/BoardHeader.tsx`

**Intent**: Thread `isCurrent` to both `BoardHeader` render sites (`PlannerBoard.tsx:235`, `PlanSummaryBar.tsx:44`) so the heading is identical across the empty → populated transition.

**Contract**: `BoardHeader` gains `isCurrent: boolean` and renders `<CurrentPlanBadge />` after the `h1` when true.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Type-check: `pnpm check`
- Lint and FSD: `pnpm lint && pnpm steiger`
- Build stays clean: `pnpm build`

#### Manual Verification:

- With a plan marked current: the board heading shows the badge in combined, dp1 and dp2 focus, and in the empty compute-groupings state.
- Sidebar plan label shows it on the board, courses, students, teachers and both perspective pages; the breadcrumb shows it on every non-board page.
- A non-current plan shows no badge anywhere; the collapsed sidebar shows none.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: End-to-end coverage and docs

### Overview

One Playwright spec walks the user flow; the roadmap records the decided unknowns.

### Changes Required:

#### 1. E2E spec

**File**: `e2e/specs/current-plan.spec.ts` (new); helpers in `e2e/support/planner.ts` only if they are reused

**Intent**: The only spec that moves the marker, so `fullyParallel` locally cannot race it. Serial within the file. Assert only relative to the spec's own plans — a developer's local stack may already have a current plan.

**Contract** — one serial flow:
1. Create plans A and B (`createPlan`).
2. Mark A from its row menu → A's row is the first table row and shows "Current".
3. Mark B → B is first with the badge; A has none.
4. Open B's board → the heading shows the badge; the sidebar plan label shows it. Open B's courses page → the breadcrumb shows it.
5. Back on the hub, Unmark B → no badge on A or B.
6. Mark B again, open Delete on B → the dialog shows the current-plan warning; confirm → B is gone. Clean up A.

#### 2. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: Record the two unknowns as decided, the way S-402's entry does.

**Contract**: S-404's Unknowns bullet reads "**decided (plan, 2026-10-29):** deleting the current plan is allowed and warned in the delete dialog (zero current is legal); a pending proposal can never carry the marker (database CHECK + `assertNotPending`)". Status changes stay with `/10x-implement` and `/10x-archive`.

### Success Criteria:

#### Automated Verification:

- The new spec passes: `pnpm test:e2e e2e/specs/current-plan.spec.ts`
- The full e2e suite still passes: `pnpm test:e2e`
- The full local CI gate passes: `/verify`

#### Manual Verification:

- The roadmap's S-404 entry reads correctly and nothing else in it changed.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `schemas.test.ts`: the two id-only inputs accept a uuid and reject garbage.
- `action-capabilities.test.ts`: both new actions are `edit` (automatic).

### Integration Tests:

- One new file, `src/_pages/plans-list/api/current-plan.integration.test.ts`, holds every marker-moving case (Phases 1 and 2), written to the isolation rules: assert on returned rows, on "at most one", and on single-statement violations.
- Role matrix: the `RPCS.set_current_plan` row, red before the migration, green after.
- Existing `WRITES.plans.update` already proves a viewer cannot write `plans`, which covers unmark.

### Manual Testing Steps:

1. As an author on `pnpm build && pnpm preview`: mark, move, unmark; check pinning, badges and that "Last updated" doesn't change.
2. Try to mark a pending proposal (start a Generate and use the proposal row) → pending CONFLICT toast.
3. Open board, courses and a perspective view of the current plan → badge in the heading, sidebar and breadcrumb.
4. Delete the current plan → warning shown, delete succeeds, no current plan remains.
5. As a viewer (`node scripts/assign-role.mjs <email> viewer`): badge visible, Mark refused with FORBIDDEN.

## Performance Considerations

No new queries: the flag rides on selects that already run (hub list, plan summary). The partial unique index holds at most one entry. Drag-drop validation is untouched.

## Migration Notes

Additive only: a `not null default false` column (every existing row becomes not-current, which is the FR-420 migration state), a partial unique index, a CHECK that every existing row satisfies, a `CREATE OR REPLACE` of an existing trigger (no `DROP`), and a new function. Applying it on hosted needs no data step. Rolling back means rolling forward; with the column unused, the app keeps working.

## References

- Research: `context/changes/current-plan-marker/research.md`
- Roadmap: `context/foundation/roadmap.md` (S-404); PRD: `context/foundation/prd.md` FR-420
- Analog: `src/_pages/plans-list/api/rename-plan.ts:21-36`
- Pending guards: `src/_pages/plans-list/api/pending-guards.ts:39-57`
- Grant precedent: `supabase/migrations/20261028140939_user_roles.sql:134-142`
- Trigger: `supabase/migrations/20260602185012_minimal_domain_schema.sql:98-100`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database — the marker and its move

#### Automated

- [ ] 1.1 Role matrix is red on the new cell before the migration
- [ ] 1.2 Migration applies from scratch
- [ ] 1.3 Role matrix is green after the migration
- [ ] 1.4 Database-rule suite passes
- [ ] 1.5 Types regenerated and type-check passes
- [ ] 1.6 Lint and FSD

#### Manual

- [ ] 1.7 No plan is current on a freshly migrated local stack
- [ ] 1.8 `set_current_plan` EXECUTE: anon false, authenticated true

### Phase 2: Hub — mark, unmark, show

#### Automated

- [ ] 2.1 Unit tests pass (schemas, action capabilities)
- [ ] 2.2 Marker suite passes
- [ ] 2.3 Existing hub suites still pass
- [ ] 2.4 Type-check
- [ ] 2.5 Lint and FSD
- [ ] 2.6 Build stays clean

#### Manual

- [ ] 2.7 Mark, move and unmark on the hub; pinning and badge; "Last updated" unchanged
- [ ] 2.8 Marking a pending proposal shows the pending CONFLICT toast
- [ ] 2.9 Delete dialog warns for the current plan; delete succeeds
- [ ] 2.10 Viewer sees the badge; Mark refused with FORBIDDEN

### Phase 3: The plan itself — board heading, sidebar, breadcrumb

#### Automated

- [ ] 3.1 Unit tests pass
- [ ] 3.2 Type-check
- [ ] 3.3 Lint and FSD
- [ ] 3.4 Build stays clean

#### Manual

- [ ] 3.5 Board heading shows the badge in every focus and the empty state
- [ ] 3.6 Sidebar label and breadcrumb show it on every single-plan page
- [ ] 3.7 Non-current plans and the collapsed sidebar show no badge

### Phase 4: End-to-end coverage and docs

#### Automated

- [ ] 4.1 The new spec passes
- [ ] 4.2 The full e2e suite still passes
- [ ] 4.3 The full local CI gate passes

#### Manual

- [ ] 4.4 Roadmap S-404 entry reads correctly
