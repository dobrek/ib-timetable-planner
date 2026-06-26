# S-07 Bundle Holding Container ("Shelf") Implementation Plan

## Overview

Give an author a **server-durable, per-cohort holding container** ("shelf") for placed bundles: lift a bundle off the board into a parked state, see it as a card in a collapsible right-edge drawer, and drag it back onto any slot later. A parked bundle survives a browser refresh and a cohort switch because it lives in Supabase, not `localStorage`.

The change is deliberately **additive**. The off-board unit gets its own representation — two new tables (`shelf_bundles` + `shelf_bundle_courses`) — rather than reusing the on-board `bundles` row. Park **tears down** the board representation and **builds** a shelf one; place-back does the reverse by reusing the existing `place_course` find-or-create. The constraint core, the <200 ms drag-drop budget, and the S-05 board write path (`place_course` / `move_bundle_members` / `remove_bundle_members`) are all untouched.

## Current State Analysis

- **The off-board state has no home for its contents.** Bundle membership lives only in `placements`, reconstructed at RPC time from the placements co-located at a bundle's cell (`move_bundle_members_fn.sql:63-69`, `remove_bundle_members_fn.sql:31-33`). `placements.day`/`.period` are `smallint NOT NULL` (`20260602185012_minimal_domain_schema.sql:120-121`), so a placement can never be slot-less. A parked bundle holds no slot → no placements → nothing to reconstruct from. There is **no `bundle_members` / `shelf_*` table** today (grep-confirmed). The S-05 `bundles.status` CHECK (`'placed'|'holding'`) is representable but `'holding'` is written nowhere.
- **The board is fully cohort-parameterized.** `?cohort=` → `loadPlannerData(supabase, id, cohort)` → `PlannerBoardProps.cohort` → every write. `bundles.cohort` is `cohort not null` (enum `'dp1'|'dp2'`) and immutable. A cohort switch is a full SSR remount (`CohortSwitcher.tsx`).
- **The drag layer is a discriminated-union dispatch.** One island-wide `<DragDropProvider>` with a `switch (data.kind)` over `CourseDrag | PlacementDrag | GroupDrag | BundleDrag` (`PlannerBoard.tsx:105-118`). The drop handler casts the target unconditionally as `CellData` (`PlannerBoard.tsx:104`). A whole bundle is already one draggable (`SlotCell.tsx:161-165`); cells are droppables carrying `{day,period}` (`SlotCell.tsx:154`).
- **The write path is a hook owning optimistic state.** `usePlacements` (`use-placements.ts`) owns `placements` + the optimistic add/move/remove/setWeek path over pure helpers in `placement-transitions.ts`. Verbs (`moveBundle`, `removeBundle`, `duplicateBundle`) are thin wrappers. Each mutation is one transactional RPC.
- **Transport is Astro Actions.** `defineDomainAction({ input, run })` centralizes `requireSession → requireSupabase → runDomain` (`shared/lib/actions/define-domain-action.ts`). Slice actions declare a Zod `input` + a framework-free domain fn that calls `supabase.rpc(...)` and throws `DomainError` (`api/placements.ts`, `api/placement-actions.ts`). Client wrappers call `actions.<name>` and unwrap `{ data, error }` (`api/placement-client.ts`).

## Desired End State

An author working a cohort's board can:

1. Click a **"lift to shelf"** button on a placed bundle (or drag the bundle to the right edge) → the bundle leaves the board and appears as a neutral, flag-free card in the right-edge drawer; the `N parked` badge in the summary bar increments.
2. **Reload the page** → the parked card is still there (server-durable).
3. **Drag the parked card back onto any slot** → its courses are placed at the target (merging into an existing bundle there if present), and the shelf card disappears. Validation re-runs naturally on drop.
4. Switch cohorts → each cohort shows only its own parked bundles.

Verified by: integration round-trip + clone + cohort-scope + merge tests (Phase 1), unit tests on the optimistic transitions (Phase 3), one Playwright durability happy-path + manual UI checks (Phase 4), and a clean `pnpm check` / `pnpm steiger` / `pnpm build`.

### Key Discoveries:

- **`place_course` is the unshelve primitive.** `place_course(p_plan_id uuid, p_cohort public.cohort, p_course_id uuid, p_day smallint, p_period smallint, p_week public.placement_week default 'both')` returns one `public.placements` row, auto-creating the cell bundle via `on conflict … where day is not null` (`place_course_fn.sql:13-49`). `unshelve_bundle` loops it per shelf course, passing `week` explicitly. Onto-empty and onto-occupied are the *same* path.
- **The `==0` bundle-delete invariant.** A `bundles` row exists exactly while its membership ≥ 1 (`remove_bundle_members_fn.sql:33-38`). Because shelving removes *all* a cell's placements, `shelve_bundle` must delete the now-empty `bundles` row itself (copy-to-shelf **before** the deletes).
- **`course_teachers` is the table template** (`20260620120000_course_teachers.sql`): surrogate `id` PK, `plan_id` FK `on delete cascade`, plan-pinned composite FKs `(plan_id, x) → parent(plan_id, id)`, one `for all to authenticated` RLS policy, and an explicit per-table `revoke … from anon`. Schema-wide `alter default privileges` already carry the `authenticated`/`service_role` grants forward — **do not add new grant statements**, only the `revoke … from anon`.
- **`clone_plan` is a `_*_map` remap pipeline** (`clone_plan_with_bundles.sql`): one `on commit drop` temp map per remapped parent, parents inserted before children, junctions double-remapped via INNER JOIN (`course_grouping_members` block, `:159-165`). The shelf adds a `_shelf_bundle_map` + a parent block (modeled on `6b bundles`) + a junction block (modeled on `course_grouping_members`).
- **`load.ts` has a 6-way `Promise.all` parallel seam** (`load.ts:50-68`) and a `PlannerBoardProps` assembly (`:114-131`); the placements read filters `plan_id`+`cohort`, and `course_groupings` already shows the nested-relation select (`course_grouping_members(course_id)`) the shelf read mirrors.
- **Enums:** `public.cohort` = `('dp1','dp2')`, `public.placement_week` = `('both','a','b')`.

## What We're NOT Doing

- **Not** reusing the `bundles` row's `'holding'` status / nullable coords (the "freezer" model) — they stay as benign vestigial no-ops. Dropping them would ripple into `place_course`'s `on conflict … where day is not null` and the partial index (the hot path), so we leave them.
- **Not** reworking `placements` to be slot-less (rejected — non-additive, broad blast radius).
- **Not** preserving bundle identity across the park boundary — a fresh `bundles` id is minted on place-back. Safe because S-08 undo will be snapshot/command-based.
- **Not** touching the constraint core, `deriveCellViolations`, `BoardContext`, or the <200 ms budget.
- **Not** adding a "clear shelf" / "place all back" bulk action this slice (auto-delete-at-zero only). No `localStorage` source-of-truth for the parked set (server-owned); the *only* `localStorage` use is the cosmetic drawer-pin flag.
- **Not** building S-06 (two-cohort view) or S-08 (undo) — only keeping them additive.
- **Not** full drag-drop E2E coverage — one durability happy-path spec only (merge / cohort-scope / drawer covered by integration + manual).

## Implementation Approach

Build bottom-up in four phases, each independently verifiable. Phase 1 lands the entire Supabase layer (tables + two RPCs + clone revision) behind an integration round-trip. Phase 2 wires transport and the server read so the island *receives* parked bundles. Phase 3 adds the client-side model: a `ParkedBundle` type, pure optimistic transitions, and the two verbs on `usePlacements` (which already owns the board's optimistic store — keeping the cross-store park/place-back atomic in one place). Phase 4 builds the drawer UI and drag wiring on top.

The shelf is a **new drag-target kind**, never an overload of the cell `CellData` — this keeps the cell droppable cohort-agnostic (the S-06 prerequisite) and the `handleDrop` dispatch a clean discriminated union.

## Critical Implementation Details

- **Copy before delete (park ordering).** `shelve_bundle` must insert `shelf_bundle_courses` from the cell's placements *before* deleting those placements; then delete the emptied `bundles` row. Reverse the order and the course set is lost.
- **All shelf RPCs match the existing posture:** `security invoker`, `set search_path = ''`, every table reference `public.`-qualified — so the new tables' `authenticated` RLS policies gate the writes. Never switch to `definer`.
- **Park/place-back is a two-store atomic optimistic update.** Shelving removes board placements *and* adds a parked card in one optimistic pass; a failed RPC must roll back *both*. Place-back is the inverse. This is why the verbs live on `usePlacements` (which owns `placements`) and the hook also owns `parkedBundles` — not split across two uncoordinated hooks.
- **Grid reflow happens once, on explicit expand — never mid-drag.** The drawer is non-modal so a parked card can be dragged *out of* it onto a visible slot; a mid-drag reflow would move the drop target under the cursor.

---

## Phase 1: Supabase layer — shelf tables, RPCs, clone

### Overview

Add the two shelf tables, the `shelve_bundle` / `unshelve_bundle` RPCs, and the `clone_plan` revision. This is the whole durability story; everything above it is plumbing.

### Changes Required:

#### 1. Shelf tables migration

**File**: `supabase/migrations/20260626120000_shelf_bundles.sql` (new; timestamp must sort after `20260624120007`)

**Intent**: Create the parked unit's own representation — a header table for identity and a child table for its course set + A/B week, so a parked bundle is fully described off-board. Mirror the `course_teachers` least-privilege template exactly.

**Contract**:
- `shelf_bundles`: `id uuid pk default gen_random_uuid()`, `plan_id uuid not null references plans(id) on delete cascade`, `cohort cohort not null`, `created_at timestamptz not null default now()`, and `constraint shelf_bundles_plan_id_unique unique (plan_id, id)` (the composite-FK target). No `day`/`period` — a shelf bundle is always off-board.
- `shelf_bundle_courses`: `id uuid pk`, `plan_id uuid not null references plans(id) on delete cascade`, `shelf_bundle_id uuid not null`, `course_id uuid not null`, `week public.placement_week not null default 'both'`, `created_at`; composite FKs `(plan_id, shelf_bundle_id) → shelf_bundles(plan_id, id) on delete cascade` and `(plan_id, course_id) → courses(plan_id, id) on delete cascade`; `unique (plan_id, shelf_bundle_id, course_id)`; indexes on `(plan_id)` and `(plan_id, shelf_bundle_id)`.
- Both tables: `enable row level security` + one `policy "Authenticated users have full access" … for all to authenticated using (true) with check (true)` + `revoke select, insert, update, delete on <table> from anon`. **No `grant` statements** — the schema-wide default privileges already carry `authenticated`/`service_role`.

#### 2. `shelve_bundle` RPC

**File**: `supabase/migrations/20260626120001_shelve_bundle_fn.sql` (new)

**Intent**: Atomically move a placed bundle off the board: capture its courses+weeks into the shelf, then tear down the board representation. Returns the new shelf header so the client can reconcile its optimistic card's id.

**Contract**: `shelve_bundle(p_plan_id uuid, p_cohort public.cohort, p_day smallint, p_period smallint) returns public.shelf_bundles`, `security invoker`, `set search_path = ''`. Ordering is load-bearing (copy → delete placements → delete emptied bundle):

```sql
-- 1. mint the shelf header
insert into public.shelf_bundles (plan_id, cohort)
values (p_plan_id, p_cohort) returning * into v_shelf;

-- 2. COPY membership (course + week) off the placements at this cell — BEFORE deleting them
insert into public.shelf_bundle_courses (plan_id, shelf_bundle_id, course_id, week)
select p_plan_id, v_shelf.id, pl.course_id, pl.week
  from public.placements pl
 where pl.plan_id = p_plan_id and pl.cohort = p_cohort and pl.day = p_day and pl.period = p_period;

-- 3. tear down the board representation (placements, then the now-empty bundle row)
delete from public.placements
 where plan_id = p_plan_id and cohort = p_cohort and day = p_day and period = p_period;
delete from public.bundles
 where plan_id = p_plan_id and cohort = p_cohort and day = p_day and period = p_period;

return v_shelf;
```

(An empty-source cell mints an empty shelf header with no courses; the model layer guards against shelving an empty cell, so this is defensive only.)

#### 3. `unshelve_bundle` RPC

**File**: `supabase/migrations/20260626120002_unshelve_bundle_fn.sql` (new)

**Intent**: Atomically place a parked bundle's courses back at a target cell (reusing `place_course`'s find-or-create, so onto-empty and onto-occupied-merge are one path), then drop the shelf row. Returns the resulting placements for optimistic temp-id reconciliation.

**Contract**: `unshelve_bundle(p_plan_id uuid, p_cohort public.cohort, p_shelf_bundle_id uuid, p_target_day smallint, p_target_period smallint) returns setof public.placements`, `security invoker`, `set search_path = ''`. Loop the shelf courses through `place_course`, collect rows, then cascade-delete the shelf header:

```sql
for v_course in
  select course_id, week from public.shelf_bundle_courses
   where plan_id = p_plan_id and shelf_bundle_id = p_shelf_bundle_id
loop
  return query
    select * from public.place_course(
      p_plan_id, p_cohort, v_course.course_id, p_target_day, p_target_period, v_course.week);
end loop;

delete from public.shelf_bundles where plan_id = p_plan_id and id = p_shelf_bundle_id;  -- courses cascade
```

#### 4. `delete_shelf_bundle` RPC

**File**: `supabase/migrations/20260626120003_delete_shelf_bundle_fn.sql` (new)

**Intent**: Discard a parked bundle outright (the parked card's "×"), without placing it back. Backs the Phase 4 §4 remove control — otherwise that affordance dead-ends with no RPC.

**Contract**: `delete_shelf_bundle(p_plan_id uuid, p_shelf_bundle_id uuid) returns void`, `security invoker`, `set search_path = ''`. One statement — `delete from public.shelf_bundles where plan_id = p_plan_id and id = p_shelf_bundle_id;` — the `shelf_bundle_courses` rows cascade via their `on delete cascade` composite FK; the `authenticated` RLS policy gates the delete. Identity is pinned by `(plan_id, shelf_bundle_id)`, so no cohort arg is needed (nothing else references a shelf id). This is a single-card discard, **not** the "clear shelf" bulk action that stays out of scope.

#### 5. `clone_plan` revision

**File**: `supabase/migrations/20260626120004_clone_plan_with_shelf.sql` (new; `create or replace function clone_plan(...)` — copy the current body and extend)

**Intent**: Carry parked bundles into a cloned plan with fresh, internally-consistent ids — otherwise duplicating a plan silently drops its shelf.

**Contract**: Add to the existing pipeline (`clone_plan_with_bundles.sql`): (a) a `_shelf_bundle_map (old_id, new_id default gen_random_uuid()) on commit drop` temp table seeded from `public.shelf_bundles where plan_id = p_source_plan_id`; (b) a parent insert modeled on `6b bundles` (`shelf_bundles (id, plan_id, cohort) select sm.new_id, v_new_plan_id, s.cohort …`); (c) a junction insert modeled on `course_grouping_members`, double-remapping both ids via INNER JOIN so a stale id fails loudly:

```sql
insert into public.shelf_bundle_courses (plan_id, shelf_bundle_id, course_id, week)
select v_new_plan_id, sm.new_id, cm.new_id, sc.week
  from public.shelf_bundle_courses sc
  join pg_temp._shelf_bundle_map sm on sm.old_id = sc.shelf_bundle_id
  join pg_temp._course_map cm        on cm.old_id = sc.course_id
 where sc.plan_id = p_source_plan_id;
```

(d) Add `drop table pg_temp._shelf_bundle_map` to the eager-drop block.

#### 6. Integration tests

**File**: `src/_pages/plan-detail/api/shelf.integration.test.ts` (new) + any needed additions to `src/test/factories/`

**Intent**: Prove the RPC round-trip and its invariants against a real local Supabase, building state through the existing factories and tearing down via the harness (not asserting on raw seed rows).

**Contract**: Cases — (1) **round-trip**: place a multi-course bundle → `shelve_bundle` → assert `shelf_bundles` + `shelf_bundle_courses` rows exist with correct courses/weeks AND the placements + the `bundles` row are gone → `unshelve_bundle` onto an empty cell → assert placements restored at the target (fresh `bundle_id`) and the shelf row gone; (2) **merge**: `unshelve_bundle` onto an occupied cell → courses join the destination bundle, no error; (3) **cohort-scope**: a DP1 shelf row is not returned by a DP2-filtered read; (4) **clone**: `clone_plan` of a plan with a parked bundle yields a shelf row + courses under fresh ids; (5) **week fidelity**: an A/B course round-trips its `week`; (6) **discard**: `delete_shelf_bundle` removes the shelf header and its `shelf_bundle_courses` (cascade), and is cohort-/plan-scoped (a sibling cohort's shelf row is untouched).

#### 7. Regenerate the committed Supabase types

**File**: `src/shared/api/database.types.ts` (regenerate + commit)

**Intent**: The generated `Database` type is a **committed artifact with no package script** — it must be regenerated by hand or every downstream `supabase.rpc("shelve_bundle"|"unshelve_bundle"|"delete_shelf_bundle", …)` and `supabase.from("shelf_bundles")` call is untyped and fails `pnpm check` in this phase (1.3) and in Phases 2–3 (2.1, 3.2). This is **not** done by `astro sync` (which only writes `.astro/types.d.ts`).

**Contract**: Right after `pnpm exec supabase db reset`, run `pnpm exec supabase gen types typescript --local > src/shared/api/database.types.ts` and commit the result. Confirm `shelf_bundles` + `shelf_bundle_courses` appear under `Tables` and the three new functions under `Functions`.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly: `pnpm exec supabase db reset`
- Generated types include the new tables + functions: `pnpm exec supabase gen types typescript --local > src/shared/api/database.types.ts` regenerates `Database` (committed artifact; no package script — see Changes Required §7). `astro sync` does **not** do this.
- Type checking passes: `pnpm check`
- Integration tests pass: `pnpm test:integration`
- Linting passes: `pnpm lint`

#### Manual Verification:

- `pnpm exec supabase db advisors` reports no new grant/RLS issues on the shelf tables; `has_table_privilege('anon','public.shelf_bundles','INSERT')` is `false`.
- A manual `shelve_bundle` then `unshelve_bundle` in Studio behaves as expected for a hand-built bundle.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Transport & load — actions, client, server read

### Overview

Expose the two RPCs as Astro Actions, add client wrappers, and read parked bundles in `load.ts` so the island receives them as a prop. No UI yet.

### Changes Required:

#### 1. Domain fns + Zod inputs

**File**: `src/_pages/plan-detail/api/shelf.ts` (new — keeps the placement file focused; mirrors `placements.ts`)

**Intent**: Framework-free domain functions that call the new RPCs and map rows to DTOs, plus the authoritative Zod input gates.

**Contract**:
- `shelveBundleInput = z.object({ planId: z.uuid(), cohort: cohortSchema, day: dayField, period: periodField })`; `shelveBundle(supabase, input): Promise<ParkedBundle>` → `supabase.rpc("shelve_bundle", { p_plan_id, p_cohort, p_day, p_period })`, throw `DomainError("INTERNAL_SERVER_ERROR", …)` on error. (Return shape: the new shelf header projected to `{ id, members: [] }` — members are known client-side; see Phase 3.)
- `unshelveBundleInput = z.object({ planId: z.uuid(), cohort: cohortSchema, shelfBundleId: z.uuid(), targetDay: dayField, targetPeriod: periodField })`; `unshelveBundle(supabase, input): Promise<PlannerPlacement[]>` → `supabase.rpc("unshelve_bundle", …)`, `data.map(toPlannerPlacement)`.
- `deleteShelfBundleInput = z.object({ planId: z.uuid(), shelfBundleId: z.uuid() })`; `deleteShelfBundle(supabase, input): Promise<void>` → `supabase.rpc("delete_shelf_bundle", { p_plan_id, p_shelf_bundle_id })`, throw `DomainError("INTERNAL_SERVER_ERROR", …)` on error.
- Reuse `dayField`/`periodField`/`cohortSchema` patterns from `placements.ts:10-11`.

#### 2. Action routing

**File**: `src/_pages/plan-detail/api/placement-actions.ts` (extend) or `src/_pages/plan-detail/api/shelf-actions.ts` (new, re-exported via `api/index.ts`)

**Intent**: Wire the domain fns into `defineDomainAction` so they surface as `actions.shelveBundle` / `actions.unshelveBundle`.

**Contract**: Add `shelveBundle: defineDomainAction({ input: shelveBundleInput, run: shelveBundle })`, the `unshelveBundle` analogue, and `deleteShelfBundle: defineDomainAction({ input: deleteShelfBundleInput, run: deleteShelfBundle })`. If a new `shelfActions` group is used, spread it into `src/actions/index.ts`'s `server` alongside `...placementActions`.

#### 3. Client wrappers

**File**: `src/_pages/plan-detail/api/shelf-client.ts` (new) or extend `placement-client.ts`

**Intent**: Thin `astro:actions` callers mirroring `placement-client.ts`.

**Contract**: `shelveBundle(args: { planId; cohort; day; period }): Promise<ParkedBundle>`, `unshelveBundle(args: { planId; cohort; shelfBundleId; targetDay; targetPeriod }): Promise<PlannerPlacement[]>`, and `deleteShelfBundle(args: { planId; shelfBundleId }): Promise<void>` — call the matching `actions.*`, unwrap `{ data, error }`, throw `new Error(error.message)`.

#### 4. Server read

**File**: `src/_pages/plan-detail/api/load.ts`

**Intent**: Fetch each cohort's parked bundles alongside the existing reads and project them into a new board prop.

**Contract**: Add a 7th element to the `Promise.all` (`:50-68`): `supabase.from("shelf_bundles").select("id, shelf_bundle_courses(course_id, week)").eq("plan_id", id).eq("cohort", cohort)`. Add its result to `assertNoQueryErrors`. Project into `parkedBundles: ParkedBundle[]` (map each row's `shelf_bundle_courses` → `members: [{ courseId, week }]`) and add `parkedBundles` to the returned `props` object (`:114-131`).

#### 5. Parked-bundle types + board prop

**Files**: `src/_pages/plan-detail/model/parked.ts` (new); `src/_pages/plan-detail/model/drag.ts`

**Intent**: Define the serializable parked-bundle shape the loader projects and the board prop carries. Created **here in Phase 2** (not Phase 3) because the domain DTO (§1), client wrapper (§3), `load.ts` projection (§4), and the prop (below) all reference `ParkedBundle` — so Phase 2's own `pnpm check` (2.1) / `pnpm build` (2.3) need the type to exist.

**Contract**:
- `model/parked.ts`: `ParkedMember = { courseId: string; week: PlacementWeek }`; `ParkedBundle = { id: string; members: ParkedMember[] }`. (The optimistic `LocalParkedBundle` variant + transitions stay in Phase 3.)
- `model/drag.ts`: add `PlannerBoardProps.parkedBundles: ParkedBundle[]`, importing `ParkedBundle` from `./parked`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm check`
- Linting + FSD structure pass: `pnpm lint` && `pnpm steiger`
- Build is clean (Workers runtime): `pnpm build`
- Unit suite still green: `pnpm test`

#### Manual Verification:

- With a hand-shelved bundle in the DB, loading the plan page returns `parkedBundles` in the island props (verified via a temporary log or React devtools) for the right cohort only.

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Model — types, transitions, hook verbs

### Overview

Add the client-side parked-bundle model and the two optimistic verbs on `usePlacements`, which extends to own `parkedBundles` so park/place-back stays atomic across both stores.

### Changes Required:

#### 1. Parked-bundle optimistic type

**File**: `src/_pages/plan-detail/model/parked.ts` (extend — `ParkedMember`/`ParkedBundle` were created in Phase 2 §5)

**Intent**: The optimistic variant of the parked bundle (the base types already exist from Phase 2).

**Contract**: `LocalParkedBundle = ParkedBundle & { pending?: boolean }`. (`pending` gates place-back/discard of a not-yet-reconciled card, mirroring `LocalPlacement.pending`.)

#### 2. Optimistic shelf transitions

**File**: `src/_pages/plan-detail/model/shelf-transitions.ts` (new) + `shelf-transitions.test.ts`

**Intent**: Pure, immutable helpers for the parked-list side of park/place-back, mirroring the `placement-transitions.ts` triads. Keeping them pure makes the two-store update unit-testable without React.

**Contract** (all `LocalParkedBundle[] → LocalParkedBundle[]` unless noted):
- `parkAddOptimistic(prev, tempId, members): LocalParkedBundle[]` — append a pending parked card.
- `parkReconcile(prev, tempId, serverId): LocalParkedBundle[]` — swap tempId → server id, clear `pending`.
- `parkRollback(prev, tempId): LocalParkedBundle[]` — drop the pending card on failure.
- `unparkOptimistic(prev, shelfBundleId): LocalParkedBundle[]` — remove the card being placed back (also reused by `removeParked` discard — same "drop the card by id" shape).
- `unparkRollback(prev, removed: LocalParkedBundle): LocalParkedBundle[]` — restore it on failure (place-back or discard).
- `membersAtCell(placements, day, period): ParkedMember[]` — read a cell's `{courseId, week}` set (the park source), reusing the existing occupant filter.

#### 3. Hook verbs

**File**: `src/_pages/plan-detail/model/use-placements.ts`

**Intent**: Add `shelveBundle(day, period)` and `placeBack(shelfBundleId, target)` as verbs that update the board store *and* the parked store together, persist via one RPC each, and roll back both stores on failure. Seed parked state from a new `initialParked` arg.

**Contract**:
- New args: `initialParked: ParkedBundle[]`; new state `parkedBundles: LocalParkedBundle[]`; expose `parkedBundles`, `shelveBundle`, `placeBack`, `removeParked` in the returned object.
- `shelveBundle(day, period)`: read occupants (guard empty / pending) → optimistic `removeManyOptimistic(placements)` + `parkAddOptimistic(tempId, members)` → `await shelveBundle(client)` → `parkReconcile(tempId, serverId)`; on error `removeManyRollback` + `parkRollback`.
- `placeBack(shelfBundleId, target)`: read the card's members (guard pending) → **filter the members through `eligibleMembers(placements, memberIds, target)` first**, so a course already present at an occupied target is dropped from the optimistic add (the merge case — without this, `addManyOptimistic` adds a duplicate chip the idempotent `place_course` can't reconcile by temp id, since it returns the *existing* placement). Then optimistic `unparkOptimistic` + `addManyOptimistic(eligible placements at target, weeks carried)` → `await unshelveBundle(client)` → reconcile by matching server rows to temp ids **by `courseId`** (as `persistMoveMembers` does) via `settleMany`; on error `unparkRollback` + drop the temp placements (`settleMany` with null results). Note `unshelve_bundle` still places *all* shelf courses server-side (idempotent on the already-present one); the filter only governs the optimistic overlay.
- `removeParked(shelfBundleId)`: discard a parked card outright (the card's "×") — a parked-store-only mutation (no board placements involved). Read the card (guard pending) → optimistic `unparkOptimistic` → `await deleteShelfBundle(client)`; on error `unparkRollback`. No `placements` touch, so no two-store coordination needed.
- Mirror the existing verb ergonomics and the `void persistX(...)` pattern; reuse `errorOf` / `setError`.

#### 4. Board wiring of the new state

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Feed `props.parkedBundles` into the hook and destructure the new verbs/state (UI consumes them in Phase 4).

**Contract**: Pass `initialParked: props.parkedBundles` into `usePlacements(...)`; destructure `parkedBundles`, `shelveBundle`, `placeBack`. (Drag wiring + drawer come in Phase 4.)

### Success Criteria:

#### Automated Verification:

- Unit tests pass (new `shelf-transitions.test.ts` + existing suite): `pnpm test`
- Type checking passes: `pnpm check`
- Linting + FSD pass: `pnpm lint` && `pnpm steiger`

#### Manual Verification:

- N/A (no user-visible change yet) — covered by unit tests.

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: UI — drawer, lift button, drag wiring

### Overview

Build the visible feature: the lift affordance, the collapsible right-edge drawer with parked cards, drag-back-onto-a-slot, the summary-bar badge, the drag preview, and pin persistence.

### Changes Required:

#### 1. Drag/drop kinds

**File**: `src/_pages/plan-detail/model/drag.ts`

**Intent**: Add the parked draggable and the shelf drop target as first-class union members (never an overload of `CellData`).

**Contract**: `ParkedDrag = { kind: "parked"; shelfBundleId: string }` added to `DragData`; `ShelfData = { kind: "shelf" }` as the shelf droppable's data; the drop-target type the handler reads becomes `CellData | ShelfData`.

#### 2. Drop dispatch

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Discriminate the drop target and handle the two new gestures: drag-bundle-to-shelf (lift) and drag-parked-card-to-cell (place-back).

**Contract**: Replace the unconditional `target.data as CellData` (`:104`) with a discriminated read of `CellData | ShelfData` — resolve a `cell` **only** when the target is `CellData`. The shelf droppable is island-wide, so dnd-kit will route *any* draggable onto it; the dispatch must therefore guard the target kind, not just the source kind:

- `case "bundle"`: target is the shelf → `shelveBundle(data.day, data.period)`; target is a cell → `moveBundle(...)`.
- `case "parked"`: target is a cell → `placeBack(data.shelfBundleId, cell)`; target is the shelf → **no-op**.
- `case "course" / "placement" / "grouping"`: target is a cell → the existing behavior; target is the shelf → **explicit no-op** (never cast `ShelfData` as `CellData` — that would place a course at `undefined`/`undefined`).

Thread an `onLiftBundle(day, period)` handler down to the grid for the button affordance.

#### 3. Lift button

**File**: `src/_pages/plan-detail/ui/slot-cell/SlotHeader.tsx` (+ thread `onLiftBundle` through `SlotCell.tsx` → `PlannerGrid` → board, mirroring `onDuplicateBundle`)

**Intent**: A discoverable, zero-drag lift path beside the existing duplicate/trash controls, shown only when the cell is a bundle.

**Contract**: Add a `SlotHeaderButton` (e.g. `Inbox`/`PackageOpen` lucide icon, `dataSlot="lift-to-shelf"`, `label="Lift to shelf"`) inside the `ml-auto` group (`SlotHeader.tsx:49`), `onClick={() => onLiftBundle(day, period)}` via the existing `stopDrag` wrapper. Match the ghost-icon token classes.

#### 4. Shelf drawer + parked card + droppable

**File**: `src/_pages/plan-detail/ui/shelf/ShelfDrawer.tsx`, `ParkedBundleCard.tsx` (new); mount in `PlannerBoard.tsx`

**Intent**: The collapsible right-edge drawer (3rd grid column) holding neutral, flag-free parked cards, each draggable back onto the board; a shelf-wide droppable for drag-to-park.

**Contract**:
- Layout: extend the board grid to `lg:grid-cols-[18rem_1fr_auto]` (`PlannerBoard.tsx:148`); the drawer column is `auto`-width, collapsing to a thin right-edge tab when idle and reflowing to ~15rem **once on explicit expand** (never mid-drag). Mirror `PlannerPalette`'s `<aside> … shrink-0 header / min-h-0 flex-1 overflow-y-auto` structure.
- **State ownership**: `PlannerBoard` owns the runtime `expanded` boolean (initialized from the persisted pin, #7) and passes `expanded` + an `onExpandedChange` setter to `ShelfDrawer` **and** an `onExpand` to `PlanSummaryBar` (§5) — both the drawer's own tab and the summary-bar badge drive the same state, so it can't live inside `ShelfDrawer`.
- `ShelfDrawer`: receives `expanded` / `onExpandedChange` (above); registers `useDroppable({ id: "shelf", data: { kind: "shelf" } })`; renders the parked list (`space-y-2`); auto-collapses after each park/place-back **unless pinned** (#7).
- `ParkedBundleCard`: reuse the `GroupingBox` shell (header "N courses" + member rows), **neutral tone, no collision flag / no A/B toggle / no `aria-invalid`** (a parked bundle isn't validated); a `useDraggable({ id: 'parked:<id>', data: { kind: 'parked', shelfBundleId } })`; a ghost "×" remove control modeled on `PlacedChip`'s remove button → calls `removeParked(shelfBundleId)` to **discard the whole parked card** (it is gone, not placed back — the only non-place-back exit from the shelf this slice; backed by `delete_shelf_bundle`, Phase 1 §4). This is a single-card discard, not the out-of-scope "clear shelf" bulk action. Semantic tokens only.

#### 5. Summary-bar badge

**File**: `src/_pages/plan-detail/ui/PlanSummaryBar.tsx`

**Intent**: A persistent, always-visible `N parked` cue (the durability signal) + the expand affordance.

**Contract**: Add a `Badge` (`variant="secondary"`) showing the parked count beside the "N left to place" counter; clicking it calls the `onExpand` handler threaded from `PlannerBoard` (which owns the `expanded` state — see §4 State ownership). Hidden (or `0`) when nothing is parked. Reuse the shared `Badge`.

#### 6. Drag preview

**File**: `src/_pages/plan-detail/ui/GroupDragOverlay.tsx`

**Intent**: Render a preview when dragging a parked card.

**Contract**: Add a `data.kind === "parked"` branch resolving the card's members (from `parkedBundles`) → `<OverlayCard memberIds={…} names={names} />`; include `"parked"` in `isOverlayKind`.

#### 7. Pin persistence

**File**: `src/_pages/plan-detail/lib/shelf-pinned.ts` (new) — model on `lib/drag-hint-mode.ts`

**Intent**: Remember "keep the drawer pinned open" per device without risking hydration mismatch or `localStorage` throws.

**Contract**: `readShelfPinned` / `writeShelfPinned` / `subscribeShelfPinned` with `try/catch` around every `getItem`/`setItem` (degrade to the default), consumed via `useSyncExternalStore` (server snapshot = default `false`). Per the lessons register: guard `localStorage`, never `typeof window` alone.

#### 8. Durability E2E

**File**: `e2e/specs/shelf-durability.spec.ts` (new — specs live under `e2e/specs/`, alongside `bundle-operations.spec.ts`, `duplicate-bundle.spec.ts`, …)

**Intent**: Prove the headline Secondary Success Criterion end-to-end.

**Contract**: One spec — sign in, open a plan with a placed bundle, lift it to the shelf (assert the parked card + badge), **reload the page** (assert the card persists), drag the parked card onto an empty slot (assert it lands and the shelf empties).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm check`
- Linting + FSD structure pass: `pnpm lint` && `pnpm steiger`
- Build is clean: `pnpm build`
- Unit suite green: `pnpm test`
- Durability E2E passes: `pnpm test:e2e`

#### Manual Verification:

- Lift via the button and via drag-to-edge both park the bundle; the badge increments.
- The drawer expands on badge-click / drag-to-edge, reflows the grid once (no mid-drag shift), and every cell stays a reachable drop target.
- Drag-back onto an empty cell places the bundle; drag-back onto an occupied cell merges (validation flags any conflict, accept-and-flag).
- Reload preserves parked bundles; switching cohorts shows only that cohort's parked set.
- Pinned drawer stays open across actions; in Safari private mode the pin degrades silently (no crash).
- Parked card uses neutral tokens (no validity styling); light/dark both look right.

**Implementation Note**: After automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests (`pnpm test`):

- `shelf-transitions.test.ts` — every helper: park add/reconcile/rollback, unpark remove/rollback, `membersAtCell` (including A/B week capture), empty/pending guards.
- Extend `use-placements` coverage if the existing hook is unit-tested, for the two-store atomic rollback paths.

### Integration Tests (`pnpm test:integration`, local Supabase):

- `shelf.integration.test.ts` — round-trip (shelve tears down placements + empties the bundle row; unshelve restores with a fresh `bundle_id`), merge-onto-occupied, cohort-scope isolation, `clone_plan` carries the shelf under fresh ids, A/B week fidelity. Built via `src/test/factories/`, torn down via the harness.

### E2E (`pnpm test:e2e`, Playwright):

- `shelf-durability.spec.ts` — lift → reload → card persists → drag back onto a slot. (Merge / cohort-scope / drawer-collapse remain covered by integration + manual.)

### Manual Testing Steps:

1. Place a multi-course bundle; click "lift to shelf" → it leaves the board, the drawer shows the card, the badge reads `1 parked`.
2. Reload → the card is still there.
3. Expand the drawer; drag the card onto an empty slot → it places; drawer empties; badge clears.
4. Park two bundles; drag one onto a cell already holding a bundle → courses merge; any conflict shows the collision flag.
5. Switch DP1↔DP2 → each cohort shows only its own parked bundles.
6. Pin the drawer; perform a park → it stays open. Repeat in Safari private mode → no crash.

## Performance Considerations

No impact on the <200 ms drag-drop budget. A parked bundle has no placements, so it is absent from `deriveCellViolations`; place-back recreates placements and re-validates via the existing accept-and-flag recompute. The extra `load.ts` query runs in parallel with the existing six. No new constraints, no larger validation data.

## Migration Notes

Five additive migrations (shelf tables, `shelve_bundle`, `unshelve_bundle`, `delete_shelf_bundle`, `clone_plan` revision), all sorting after `20260624120007`. No `DROP`s, no backfill — there is no production shelf data. The S-05 `bundles.status` / nullable-coord columns are intentionally left in place as vestigial no-ops. `clone_plan` is replaced (`create or replace`) additively. Local: `pnpm exec supabase db reset`; hosted: applied by CI `deploy` on merge.

## References

- Research: `context/changes/bundle-holding-container/research.md`
- Table template: `supabase/migrations/20260620120000_course_teachers.sql`
- Unshelve primitive: `supabase/migrations/20260624120004_place_course_fn.sql:13-49`
- `==0` invariant: `supabase/migrations/20260624120006_remove_bundle_members_fn.sql:33-38`
- Clone pipeline: `supabase/migrations/20260624120003_clone_plan_with_bundles.sql`
- Loader seam: `src/_pages/plan-detail/api/load.ts:50-68,114-131`
- Action pattern: `src/_pages/plan-detail/api/placements.ts`, `placement-actions.ts`, `shared/lib/actions/define-domain-action.ts`
- Optimistic helpers: `src/_pages/plan-detail/model/placement-transitions.ts`, `use-placements.ts`
- Drag dispatch: `src/_pages/plan-detail/ui/PlannerBoard.tsx:97-119`
- UI seams: `SlotHeader.tsx`, `GroupingBox.tsx`, `PlannerPalette.tsx`, `PlanSummaryBar.tsx`, `GroupDragOverlay.tsx`, `lib/drag-hint-mode.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Supabase layer — shelf tables, RPCs, clone

#### Automated

- [x] 1.1 Migrations apply cleanly: `pnpm exec supabase db reset` — 57de00f
- [x] 1.2 Generated `Database` types include the new tables — 57de00f
- [x] 1.3 Type checking passes: `pnpm check` — 57de00f
- [x] 1.4 Integration tests pass: `pnpm test:integration` — 57de00f
- [x] 1.5 Linting passes: `pnpm lint` — 57de00f

#### Manual

- [x] 1.6 `db advisors` clean + `has_table_privilege('anon', …)` is false on shelf tables — 57de00f
- [x] 1.7 Manual `shelve_bundle` / `unshelve_bundle` in Studio behaves correctly — 57de00f

### Phase 2: Transport & load — actions, client, server read

#### Automated

- [x] 2.1 Type checking passes: `pnpm check` — bfac89e
- [x] 2.2 Linting + FSD pass: `pnpm lint` && `pnpm steiger` — bfac89e
- [x] 2.3 Build is clean: `pnpm build` — bfac89e
- [x] 2.4 Unit suite green: `pnpm test` — bfac89e

#### Manual

- [x] 2.5 Loading the plan returns `parkedBundles` in island props for the right cohort only — bfac89e

### Phase 3: Model — types, transitions, hook verbs

#### Automated

- [x] 3.1 Unit tests pass (`shelf-transitions.test.ts` + suite): `pnpm test` — b775960
- [x] 3.2 Type checking passes: `pnpm check` — b775960
- [x] 3.3 Linting + FSD pass: `pnpm lint` && `pnpm steiger` — b775960

### Phase 4: UI — drawer, lift button, drag wiring

#### Automated

- [x] 4.1 Type checking passes: `pnpm check`
- [x] 4.2 Linting + FSD structure pass: `pnpm lint` && `pnpm steiger`
- [x] 4.3 Build is clean: `pnpm build`
- [x] 4.4 Unit suite green: `pnpm test`
- [x] 4.5 Durability E2E passes: `pnpm test:e2e`

#### Manual

- [x] 4.6 Lift via button and via drag-to-edge both park; badge increments
- [x] 4.7 Drawer expands and reflows the grid once (no mid-drag shift); all cells reachable
- [x] 4.8 Drag-back onto empty places; onto occupied merges with accept-and-flag
- [x] 4.9 Reload preserves parked bundles; cohort switch shows only that cohort's set
- [x] 4.10 Pinned drawer persists across actions; Safari private mode degrades silently
- [x] 4.11 Parked card uses neutral tokens; light/dark both correct
