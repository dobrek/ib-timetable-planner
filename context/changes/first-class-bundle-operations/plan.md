# First-Class Bundle Operations (S-05) Implementation Plan

## Overview

Turn a "bundle" from a *derived* artifact (≥2 co-located placements, with `slot_bundles` storing inverted opt-out markers) into a **first-class entity with persistent identity**. Every placement belongs to exactly one `bundles` row; a cell with any courses *is* a bundle (including a bundle of one). This collapses the two parallel write paths (single-course vs. group) into one transactional member-set primitive, makes "ungroup" a pure presentation toggle, retires `slot_bundles` entirely, and shapes the `bundles` row so S-07 (off-board holding container) and S-08 (undo) are additive — all while leaving the constraint core and the <200ms drag budget untouched.

Scope for this slice: **move** (relocate a bundle atomically, identity-preserving into an empty cell), **remove** (delete the whole bundle), and **merge** (drop a grouping or whole bundle onto an occupied cell → members join one merged bundle). **Replace is explicitly out of scope.**

## Current State Analysis

A bundle today is purely emergent from co-location:

- **No `Bundle` type, no `bundle_id`.** `isBundled(occupantCount, overridden) = occupantCount >= 2 && !overridden` (`src/_pages/plan-detail/model/slot-bundle.ts:23`), consumed at exactly one render edge (`ui/PlannerGrid.tsx:146`). The `(day, period)` cell coordinate **is** the bundle's identity.
- **`slot_bundles` stores inverted opt-out markers only** — a row present means "this cell is UNgrouped." Keyed by `(plan_id, cohort, day, period)`, no course membership, no FK to placements (`api/slot-bundles.ts`, `supabase/migrations/20260613123404_slot_bundles.sql`). UI verbs invert against the DB op: "Ungroup" *inserts*, "Group" *deletes*.
- **Whole-slot move = delete + recreate, best-effort, no transaction, no fit-check** (`persistMoveBundle`, `model/use-placements.ts:207-227`): N parallel inserts at target → `settleMany` → N parallel deletes of source rows; cleanup failures surface a banner but do not roll back. `slot_bundles` is never touched (bundled-ness re-derives at the destination).
- **Two parallel write paths**: single-placement `addCourse`/`movePlacement`/`removePlacement` vs. batch `addGroup`/`moveBundle`/`removeBundle`, all in `use-placements.ts` over pure transitions in `placement-transitions.ts`.
- **Ungroup state is persisted** via `useSlotBundles` (`model/use-slot-bundles.ts`) — an optimistic-write hook mirroring `usePlacements`, seeded from SSR `overrides` (`api/load.ts:65,102`).
- **Validation is pure, client-side, grouping-agnostic, accept-and-flag** (`model/constraints/index.ts`, `model/collisions.ts:37` `deriveCellViolations`, `ui/PlannerBoard.tsx:87-211`). Drops always land and re-derive; nothing gates. The <200ms budget holds structurally (in-memory over ≤84 cells/cohort, zero network; context loaded once at SSR in `api/load.ts`).

## Desired End State

After this plan:

- `placements.bundle_id` is `NOT NULL`; every placement references a `bundles` row. A `bundles` row exists exactly while its membership ≥ 1 (cleanup rule: **delete a bundle when its membership reaches 0**, enforced inside the transactional op).
- Move into an **empty** cell preserves `bundle_id` (clean relocation); move/drop onto an **occupied** cell **merges** (movers join the destination bundle, source bundle deleted if emptied) and re-validates by accept-and-flag.
- Single-course operations work through the *same* member-set primitive (M = one member): a single-course move leaves its source bundle and joins/creates the destination's.
- "Ungroup" is a pure in-session UI toggle that expands a cell's merged block into individual chips and unlocks per-course actions — **no data change, no persisted state**; resets to the grouped default on reload.
- `slot_bundles` and its entire action/client/`useSlotBundles`/transitions stack are gone.
- `bundles` carries `status ('placed'|'holding', default 'placed')` and nullable `(day, period)` with a partial unique index — S-05 only ever writes `placed`, but S-07 parking is now purely additive.
- The constraint core is byte-for-byte unchanged; the <200ms budget and the single-`setPlacements`-pass no-flicker invariant are preserved.

Verify: place/move/remove/merge/ungroup all behave correctly in the UI; `clone_plan` preserves bundles; `pnpm check`/`lint`/`steiger`/`test`/`test:integration`/`test:e2e`/`build` all green; `has_table_privilege('anon', 'public.bundles', 'INSERT')` is `false`.

### Key Discoveries:

- The bundle is derived (`slot-bundle.ts:23`); the cell coordinate is its only identity — which is why a parked (slot-less) bundle is unrepresentable today and S-07 forces persistent identity.
- The single-`setPlacements`-pass invariant (`placement-transitions.ts:218` `moveManyOptimistic`) is the one place the no-flicker/<200ms property can break — preserve it.
- `course_teachers` (`supabase/migrations/20260620120000_course_teachers.sql`) is the child-table + composite-FK + anon-revoke template; `replace_course_teachers` (`20260620120001`) is the security-invoker transactional RPC template.
- `clone_plan` (`20260621130001_clone_plan_with_week.sql`) uses `_grouping_map` double-remap and must be edited as `create or replace` off the **live** body; it currently clones `slot_bundles` (section 7b, lines 131-137) — that block is removed and replaced with a `_bundle_map` remap.
- `insertPlacement` (`api/placements.ts:48`) is idempotent on `placements_unique` swallowing `UNIQUE_VIOLATION` — the bundle-aware RPC must keep this idempotency.
- No board DB op triggers a reload/refetch (verified in research) — ephemeral ungroup state is safe for the whole editing session.
- `lessons.md`: "granting a role is not excluding the others" (explicit `revoke ... from anon`); "`astro check` is the mandatory type gate" (cite `pnpm check`, never build/lint as type proof); "Port the mechanism, not the legacy type shape" (model `bundle_id` on the generated `Database` types, identity as opaque tokens).

## What We're NOT Doing

- **No "replace" operation or affordance** — cut from scope per author decision. Dropping a grouping onto an occupied cell *merges* (auto-joins), it does not swap.
- **No persisted ungroup state** — ungroup is ephemeral UI state, not `localStorage` and not a `bundles` column.
- **No S-07 parking behaviour** — only the `bundles` *shape* (status + nullable coords) is added now; lift-off-board, the holding shelf, and place-back are S-07.
- **No S-08 undo/redo** — only a stable `bundle_id` handle is provided; the undo stack itself is S-08.
- **No constraint-core changes** — no new constraint, no `BoardContext` field, no pre-commit fit-check. Re-validation stays accept-and-flag.
- **No new gating** — drops always land; "re-validated at the destination" is satisfied by the existing recompute.
- **No cross-cohort bundle moves** — a bundle moves only within its own cohort (already true; S-06 owns the combined view).
- **No preservation of legacy `slot_bundles` ungroup state** on migration (no production data; ungroup is now presentation-only).

## User-Visible Changes

From the author/end-user perspective, interactions are preserved (FR-010 byte-for-byte: per-chip drag/remove, whole-cell drag, group/ungroup toggle, A/B week toggle, bulk-remove trash). The only deltas:

- **Ungroup no longer survives a reload.** Today the ungrouped (exploded) view persists via `slot_bundles`; after this change it is ephemeral in-session state, so a reload returns every cell to the grouped default. Intended (research Key Decision #1) and safe (no production data), but a user *will* notice it.
- **Merge stays visually as the existing bundled chrome** — dropping a grouping onto an occupied cell merges into one bundle, shown with the same bundled styling as any bundle (no new merge cue; see Phase 4 §3). A merged cell is not visually distinguished from a pre-existing bundle.
- **No change for single-course cells.** "Everything is a bundle (incl. a bundle of one)" is a data concept; the render predicate stays "≥2 occupants and not exploded," so a single course still shows as a plain chip.
- The group/ungroup toggle is now an instant local-state flip (no server write) — it can no longer error, so the `slotBundleError` banner case disappears.

## Implementation Approach

Mirror the house **additive-first, destructive-drop-last** discipline proven in the S-02/S-03 archives. Land the schema additively (nullable `bundle_id` → backfill → `NOT NULL`), then the transactional RPCs, then rewrite the persistence + model layer to one member-set primitive, then the UI (ungroup-as-presentation), and only then drop `slot_bundles`. The "everything is a bundle" model means even a single-course drop goes through the bundle-aware path — a wash, since it's one path instead of two.

The unified primitive is: **move member-set M from cell A to cell B; create B's bundle if absent; delete A's bundle if it is now empty.** "Move one course" (M = one member), "move the whole bundle" (M = all members), "place a single course on an empty cell" (create a 1-member bundle), and "merge" (M joins an occupied B) are all the same operation.

## Critical Implementation Details

**State sequencing — the no-flicker invariant.** Every whole-cell mutation must land in a single `setPlacements` pass so the board derives only the initial and final states, never a transient duplicate-course flag (`moveManyOptimistic`, `placement-transitions.ts:218`). The new member-set transition must keep this: movers get the destination coords + a (temp) destination `bundle_id` + `pending` in one pass; mergers (a course whose twin already sits at the target) are filtered out, never moved onto their twin.

**Timing & lifecycle — ephemeral ungroup is reload-safe.** The island mounts once (`client:load`), there is no `ClientRouter`/ViewTransitions, and no board op calls `reload()`/`navigate()`/refetch. Keep board ops on the optimistic-state path — do **not** introduce `refreshPage()`/`reload()` into the editing loop; it would wipe ephemeral ungroup and is unnecessary.

**Cleanup threshold.** A `bundles` row exists exactly while membership ≥ 1; delete it when membership reaches 0, *inside* the transactional op (not a background sweep). The count is over membership (placed → its placements). The `== 0` rule has no carve-outs — the degenerate bundle-of-one and "parked except" cases vanish under this model.

---

## Phase 1: Schema & data foundation

### Overview

Introduce the `bundles` entity and `placements.bundle_id` additively, backfill one bundle per non-empty cell, tighten `bundle_id` to `NOT NULL`, carry bundles through `clone_plan`, and regenerate the typed client. No application code reads `bundle_id` yet — this phase is schema + data only.

### Changes Required:

#### 1. `bundles` table

**File**: `supabase/migrations/<ts>_bundles.sql` (new)

**Intent**: Create the first-class bundle entity shaped for both the placed (S-05) and future holding (S-07) cases, following the `course_teachers` child-table template.

**Contract**: New table `bundles`:
- `id uuid primary key default gen_random_uuid()`
- `plan_id uuid not null references plans(id) on delete cascade`
- `cohort cohort not null`
- `status text not null default 'placed'` with a check constraint limiting it to `'placed' | 'holding'` (or a dedicated enum mirroring `cohort`'s style — match the house convention; a check constraint is simplest)
- `day smallint`, `period smallint` — **nullable** (null while parked); the existing day/period range checks apply when non-null
- `created_at timestamptz not null default now()`
- Partial unique index: `unique (plan_id, cohort, day, period) where day is not null` — exactly one placed bundle per cell, DB-enforced
- `create index bundles_plan_idx on bundles (plan_id)`
- A `plan_id`-pinned unique target the composite FK can reference: `constraint bundles_plan_id_unique unique (plan_id, id)` (mirror `courses_plan_id_unique` / `teachers_plan_id_unique`)
- RLS: `enable row level security` + `for all to authenticated using (true) with check (true)`
- Explicit `revoke select, insert, update, delete on bundles from anon` (per the grant lesson — a non-grant is not an exclusion)

#### 2. `placements.bundle_id` (additive, nullable)

**File**: `supabase/migrations/<ts>_placements_bundle_id.sql` (new — or same migration as #1; keep one additive concern per file per house style)

**Intent**: Link each placement to its bundle via a composite FK pinned to the plan, fail-loudly on cross-plan.

**Contract**: `alter table placements add column bundle_id uuid` (nullable in this step); composite FK `(plan_id, bundle_id) references bundles (plan_id, id) on delete cascade` (mirror `course_teachers_*_fkey`). Add `create index placements_bundle_idx on placements (plan_id, bundle_id)`.

#### 3. Backfill + tighten to `NOT NULL`

**File**: `supabase/migrations/<ts>_backfill_bundle_id.sql` (new)

**Intent**: Create one `bundles` row per non-empty `(plan_id, cohort, day, period)` cell, assign every placement its cell's `bundle_id`, then make the column mandatory.

**Contract**: A SQL backfill — insert distinct cells from `placements` into `bundles` (status `'placed'`, carrying `day`/`period`), then `update placements set bundle_id = ...` joining on `(plan_id, cohort, day, period)`, then `alter table placements alter column bundle_id set not null`. Legacy `slot_bundles` opt-out state is intentionally not preserved (ungroup is now presentation-only). Order matters: this must run after #1 and #2.

#### 4. `clone_plan` — `_bundle_map` remap

**File**: `supabase/migrations/<ts>_clone_plan_with_bundles.sql` (new)

**Intent**: Carry bundles through clone with fresh UUIDs, and propagate the new `bundle_id` onto cloned placements; remove the old `slot_bundles` clone block.

**Contract**: `create or replace function clone_plan(...)` off the **live** body (`20260621130001`). Add a `_bundle_map (old_id, new_id)` temp table (mirror `_grouping_map`), populate it from source `bundles`, and insert the remapped `bundles` rows (new plan id, same cohort/status/day/period) **before the section-7 placements insert** — the placements' composite FK `(plan_id, bundle_id) → bundles(plan_id, id)` requires the bundle row to exist first, so the `bundles` insert must precede section 7 (unlike `course_grouping_members`, which is inserted late in section 9). Update the section-7 placements insert to **double-remap** `course_id` (via `_course_map`) and `bundle_id` (via `_bundle_map`) — INNER JOIN both so a missed remap fails loudly. **Delete** the section-7b `slot_bundles` clone block (lines 131-137). Keep `security invoker` and the signature. Drop the temp table eagerly at the end like the others. **Also update the existing clone integration test** `src/_pages/plans-list/api/clone-plan.integration.test.ts`: add the bundle-remap assertion (success criterion 1.7) and scrub the now-stale `slot_bundles` comment references at lines 242-243.

#### 5. Regenerate typed client

**File**: `src/shared/api/database.types.ts`

**Intent**: Pick up the `bundles` table and `placements.bundle_id` in the generated types.

**Contract**: Regenerate via the project's Supabase types command (the generated `placements` row gains `bundle_id: string`; a new `bundles` row type appears). No hand edits.

#### 6. Bundle-aware test arrange helper (resolve the `NOT NULL` phasing)

**File**: `src/test/factories/place-course.ts` (+ its integration consumers)

**Intent**: Once `bundle_id` is `NOT NULL`, the existing arrange helper — which drives `insertPlacement` and writes **no** `bundle_id` — violates the constraint. The bundle-aware insert RPC (`place_course`) does not exist until Phase 2, so for Phase 1 the test arrange path must supply a `bundle_id` itself. (E2E is unaffected — it arranges board state through the real UI, so placements get their `bundle_id` from the app write path.)

**Contract**: Update `src/test/factories/place-course.ts` to **find-or-create the cell's `bundles` row and insert the placement with that `bundle_id`** — a raw two-step write (upsert `bundles` on the partial unique index, then insert the placement), no RPC dependency. This keeps the Phase 1/2 boundary intact; Phase 3 §1 repoints this helper to drive the real `place_course` action so it exercises the production write path. Confirm the integration tests that arrange placements through this helper stay green against the `NOT NULL` column: `src/_pages/plan-detail/api/placements.integration.test.ts` (uses `insertPlacement` directly — repoint to the bundle-aware helper or set `bundle_id`), `src/_pages/plan-detail/api/reload-restore.integration.test.ts`, `src/_pages/plans-list/api/clone-plan.integration.test.ts`, and `src/test/factories/lifecycle.smoke.integration.test.ts`. The seed is catalog-only (no placements), so `db reset` itself is unaffected.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly from scratch: `pnpm exec supabase db reset`
- `supabase db diff` reports clean after reset
- Type checking passes: `pnpm check`
- Linting passes: `pnpm lint`
- Build stays clean (Workers runtime): `pnpm build`
- Integration test: the bundle-aware arrange helper (`place-course.ts`) seeds placements that all carry a non-null `bundle_id`, exactly one bundle per non-empty cell; the existing integration suite that arranges placements stays green against `bundle_id NOT NULL` (`placements` / `reload-restore` / `clone-plan` / `lifecycle-smoke`) — `pnpm test:integration` (via `src/test/factories/`)
- Integration test: `clone_plan` produces a plan whose placements reference cloned (remapped, non-shared) `bundle_id`s, one bundle per cloned cell

#### Manual Verification:

- After `db reset`, the planner board renders identically to before (no UI reads `bundle_id` yet)
- `has_table_privilege('anon', 'public.bundles', 'INSERT')` returns `false` (verified by query, not by reading the policy)
- The partial unique index rejects a second placed bundle on the same `(plan, cohort, day, period)` cell

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Transactional bundle RPCs

### Overview

Add the security-invoker RPCs that own bundle identity and the `== 0` cleanup rule atomically, closing the current best-effort/no-rollback gap. These are not yet called by the app (Phase 3 wires them).

### Changes Required:

#### 1. `place_course` RPC (bundle-aware insert / find-or-create)

**File**: `supabase/migrations/<ts>_place_course_fn.sql` (new)

**Intent**: Insert a single course-hour into a cell, creating the cell's bundle if absent, in one transaction with a single round-trip — same latency as today's insert.

**Contract**: `create function place_course(p_plan_id uuid, p_cohort cohort, p_course_id uuid, p_day smallint, p_period smallint, p_week placement_week)` returning the inserted/existing placement row (so the client reconciles its temp id). Body: upsert the cell's bundle (`insert into public.bundles (...) values (..., 'placed', p_day, p_period) on conflict (plan_id, cohort, day, period) where day is not null do update set status = excluded.status returning id` — capture the bundle id). Note the `do update set status = excluded.status` is a **deliberate no-op write** whose only purpose is to make the conflicting row eligible for `RETURNING` — `on conflict do nothing` returns **no** row, so you could not capture the existing bundle's id. Then insert the placement with that `bundle_id`, **idempotent on `placements_unique`** — because `on conflict do nothing` likewise returns no row, capture the existing placement with a fallback `select` (or `do update set bundle_id = excluded.bundle_id returning *`, which is also a no-op since the existing row is at the same cell ⇒ same bundle) so the function always returns a row, preserving today's `insertPlacement` idempotency. `security invoker`, `set search_path = ''` — so **every** table reference is `public.`-qualified (per the `replace_course_teachers` template). Template: `replace_course_teachers`.

#### 2. `move_bundle_members` RPC (the unified member-set move)

**File**: `supabase/migrations/<ts>_move_bundle_members_fn.sql` (new)

**Intent**: Move a set of placements from a source cell to a target cell atomically — create the destination bundle if absent, reassign the movers' `bundle_id` and coordinates, and delete the source bundle if it is now empty. Powers single-course move, whole-bundle move, and merge.

**Contract**: Inputs are the source cell (`p_plan_id`, `p_cohort`, `p_day`, `p_period`), the member set as **course ids** (`p_course_ids uuid[]`), and the target `(p_target_day, p_target_period)`. Pin the member set to course ids, **not** placement ids: `placements_unique` is `(plan_id, cohort, day, period, course_id)`, so `(source cell + course id)` already identifies each placement exactly, and the client holds course ids without round-tripping for the real placement uuids. Returns the resulting placement rows for client reconciliation. `security invoker`, `set search_path = ''` (every table `public.`-qualified). The body **branches on whether the target cell is empty** — these are two distinct mechanisms, and the empty case must preserve identity to satisfy the Desired End State (`bundle_id` is the durable S-07/S-08 handle):

- **Target empty (whole-bundle relocation — identity preserved).** Do **not** mint a destination bundle. `update bundles set day = p_target_day, period = p_target_period where id = <source bundle id>` (the source bundle's own row carries the coords), then `update placements set day/period` for the movers — their `bundle_id` is unchanged. The `(plan_id, cohort, day, period) where day is not null` partial unique index cannot conflict because the target is empty. The source bundle id survives the move. *(For a single-course move out of a multi-member source into an empty target, the mover cannot keep the source id — it `find-or-create`s a new 1-member destination bundle like `place_course`, and the source bundle stays put with its remaining members. Only a whole-bundle move into an empty cell relocates the source row.)*
- **Target occupied (merge — source consumed).** `find-or-create` the destination bundle (same upsert as `place_course`); for each mover, either reassign its placement (`bundle_id`, `day`, `period`) or, if its course already sits at the target (a *merger*), delete the source row (never create a duplicate-course collision); then delete the source bundle if its membership dropped to 0. Identity is **not** preserved across a merge (source deleted) — the S-08 note in the brief covers this.

#### 3. `remove_bundle_members` RPC

**File**: `supabase/migrations/<ts>_remove_bundle_members_fn.sql` (new)

**Intent**: Delete a set of placements (one course, or a whole bundle) and delete the bundle if emptied — atomically.

**Contract**: Inputs identify the placements (or the bundle + member set). Body: delete the placement rows, then delete the bundle if membership reached 0. `security invoker`. Whole-bundle remove (M = all members) and single-course remove (M = one) are the same call.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly: `pnpm exec supabase db reset`
- `pnpm check`, `pnpm lint`, `pnpm build` pass
- Integration test: `place_course` on an empty cell creates a 1-member bundle; a second `place_course` on the same cell reuses that bundle (no second bundle row)
- Integration test: `place_course` is idempotent on a duplicate course-hour (returns existing, no error)
- Integration test: `move_bundle_members` into an empty cell relocates all members and preserves the bundle id; the source bundle is deleted
- Integration test: `move_bundle_members` into an occupied cell merges (movers join destination bundle, source bundle deleted, duplicate-course movers dropped not duplicated)
- Integration test: `remove_bundle_members` deletes the members and deletes the bundle exactly when membership hits 0 (and not before)

#### Manual Verification:

- A merge that empties the source leaves no orphan `bundles` row (query `bundles` after)
- RLS still gates the RPCs (an anon caller is rejected — invoker semantics confirmed)

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Bundle-aware persistence + unified member-set model

### Overview

Rewrite the persistence layer to call the new RPCs and fold the two write paths (single + group) into one member-set primitive in the established 3-file split. Update SSR load to fetch bundles and stop fetching `slot_bundles` overrides. No `slot_bundles` *reads* remain after this phase (the table is dropped in Phase 5). Constraint core untouched.

### Changes Required:

#### 1. Bundle-aware placement API client + domain

**File**: `src/_pages/plan-detail/api/placements.ts`, `src/_pages/plan-detail/api/placement-client.ts`, plus the Astro Actions barrel (`src/actions/`)

**Intent**: Replace the single-row insert/delete and the best-effort move fan-out with calls to `place_course`, `move_bundle_members`, `remove_bundle_members`. Keep handlers thin (`requireSession` → `requireSupabase` → `runDomain`), per the Astro-Actions transport lesson.

**Contract**: New/changed domain functions wrapping the RPCs (Zod `input` schemas shared with the action layer), returning the placement rows (now carrying `bundle_id`) for client reconciliation. `updatePlacementWeek` is unchanged (week flip doesn't touch bundle membership). The idempotent `insertPlacement` behaviour moves into `place_course`. **Repoint the test arrange helper** `src/test/factories/place-course.ts` from its Phase-1 raw two-step write (Phase 1 §6) to drive the real `place_course` action/domain fn, so the factory exercises the production write path now that the RPC exists.

#### 2. Unified member-set transitions

**File**: `src/_pages/plan-detail/model/placement-transitions.ts`

**Intent**: Collapse `add`/`addMany`/`move`/`moveMany`/`remove`/`removeMany` into one member-set primitive (`Optimistic`/`Reconcile`/`Rollback` triad), preserving the single-`setPlacements`-pass no-flicker invariant and the mover/merger partition.

**Contract**: `LocalPlacement` gains `bundleId`, populated **from the server row** that `settleMany` already swaps in wholesale — no temp bundle id and no `settleMany` change are needed. Optimistic rows may carry `bundleId` undefined until settle; nothing in S-05 reads it (bundled-ness for render is occupant-count-derived in Phase 4; move/remove identify the bundle by cell + member set, not by `bundleId`). **Do not** mint a temp `bundle_id` in the optimistic pass or add a second temp-bundle-id reconciliation index to `settleMany` — that machinery (and its hard case: two rapid drops on one new cell sharing one temp bundle id) only pays off once an optimistic client reader exists, which is S-07 (park) / S-08 (undo), not S-05. The mover/merger split (`partitionBundleMove`) and the single-pass optimistic application (`moveManyOptimistic`) generalize to "move member-set M to cell B." Single-course add/move/remove become M-of-one. Pure functions, unit-tested. Drop the now-dead single-vs-group duplication.

#### 3. `usePlacements` orchestrator

**File**: `src/_pages/plan-detail/model/use-placements.ts`

**Intent**: Orchestrate the unified primitive over the new RPC clients — one optimistic apply, one settle, atomic server op (no more best-effort delete fan-out).

**Contract**: The public hook surface collapses toward member-set operations (place / move-members / remove-members) while keeping ergonomic call sites for the board (`addCourse`, `addGroup`, `movePlacement`/single, `moveBundle`/whole-cell, `removePlacement`, `removeBundle` can remain as thin wrappers over the primitive). `setWeek` unchanged. Errors keep the `PlacementError` shape and the shared `ErrorBanner`.

#### 4. SSR load — fetch bundles, drop overrides

**File**: `src/_pages/plan-detail/api/load.ts`, `src/_pages/plan-detail/model/drag.ts` (`PlannerBoardProps`)

**Intent**: Load `bundle_id` on placements (and bundles if needed for rendering); remove the `slot_bundles` query and the `overrides` prop.

**Contract**: `placements` select adds `bundle_id`; the `slot_bundles` select (line 65) and the `overrides` projection (line 102) and `PlannerBoardProps.overrides` are removed. `PlannerPlacement`/`LocalPlacement` gain `bundleId` — carried for forward use (S-07/S-08) and to keep the row shape stable; no S-05 code reads it (see §2). It rides in via the existing whole-row `settleMany` swap and the SSR projection; no reconciliation change.

#### 5. Retire the `slot_bundles` model/api code paths

**File**: delete `src/_pages/plan-detail/model/use-slot-bundles.ts`, `src/_pages/plan-detail/model/slot-bundle.ts`, `src/_pages/plan-detail/api/slot-bundles.ts`, `src/_pages/plan-detail/api/slot-bundle-client.ts`, the associated Astro Action (`api/slot-bundle-actions.ts`), and the **shared test fixtures that depend on them**: `src/test/factories/ungroup-slot.ts` (imports `insertOverride` from `api/slot-bundles`). Remove the barrel exports in `src/_pages/plan-detail/api/index.ts` (the `slotBundleActions` re-export) **and** `src/test/factories/index.ts` (the `ungroupSlot` re-export), and drop the `slotBundleActions` import+spread in `src/actions/index.ts`.

**Intent**: Remove the persisted-ungroup write stack. `isBundled` (the derived flag) is replaced by "a cell with ≥2 occupants is a bundle; exploded-or-not is UI state" handled in Phase 4.

**Contract**: All imports of these modules are removed or repointed. Co-located `*.test.ts` for the deleted modules are removed (incl. `api/slot-bundles.integration.test.ts`; their behaviour is subsumed by the new transitions + RPC integration tests). The cross-slice consumer `src/test/factories/lifecycle.smoke.integration.test.ts` (imports `ungroupSlot` at line 11, calls it at line 83, and queries the `slot_bundles` table at line 100) is reworked to drop the ungroup step and the `slot_bundles` query — its bundled/merge coverage now comes from the occupant set, not a `slot_bundles` row. After this section, the grep-clean criterion (3.4) must hold across **`src/` including `src/test/`**, not just `src/_pages/`.

### Success Criteria:

#### Automated Verification:

- `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm build` pass (no dangling imports, FSD direction intact)
- Unit tests pass: member-set transitions (single add, group add, single move, whole-bundle move into empty, merge into occupied, single remove, whole-bundle remove), `bundleId` populated from the server row (no temp-bundle-id reconciliation), and the `== 0` cleanup expectation: `pnpm test`
- Integration tests from Phase 2 still pass
- No reference to `slot_bundles` / `useSlotBundles` / `slot-bundle` remains in `src/` (grep clean)

#### Manual Verification:

- Place, single-course move, whole-bundle move (empty target), merge (occupied target), single remove, and whole-bundle remove all work via the UI and persist correctly across a manual reload
- Move/merge shows no transient duplicate-course flag mid-operation (no-flicker invariant holds)
- Drag latency is visually unchanged (within the <200ms budget)

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: UI integration & ungroup-as-presentation

### Overview

Replace the persisted-override hook with ephemeral exploded-view UI state, wire the unified primitive through the board/grid/cell components, and make a merge legible. After this phase no application code depends on `slot_bundles`.

### Changes Required:

#### 1. Ephemeral ungroup state

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx` (+ a small UI-state helper if warranted)

**Intent**: Replace `useSlotBundles` with in-session UI state tracking which cells are currently exploded (ungrouped view). No persistence, no server writes.

**Contract**: A `Set<cellKey>` (or equivalent) of explicitly-exploded cells in island state, with a toggle. "Bundled" for rendering = cell has ≥2 occupants **and** is not currently exploded. Resets to empty (all grouped) on mount/reload. The `banner` wiring loses the `slotBundleError` branch.

#### 2. Grid/cell wiring

**File**: `src/_pages/plan-detail/ui/PlannerGrid.tsx`, `src/_pages/plan-detail/ui/slot-cell/SlotCell.tsx`, `src/_pages/plan-detail/ui/slot-cell/PlacedChip.tsx`

**Intent**: Drive the `bundled` prop from ephemeral explode-state instead of `isOverridden`/`isBundled`; keep the group/ungroup toggle, the whole-cell drag, and the per-chip drag/remove gating exactly as today (FR-010 preserved — byte-for-byte interaction).

**Contract**: Replace `isOverridden`/`isBundled` plumbing with the explode-state predicate. The toggle now flips ephemeral state (no write). The whole-cell `BundleDrag`, per-chip `!bundled`-gated drag/remove, the A/B WeekToggle staying live while bundled, and the bulk-remove trash all behave unchanged.

#### 3. Merge legibility (verify-only — no new UI element)

**File**: `src/_pages/plan-detail/ui/slot-cell/SlotCell.tsx`

**Intent**: When a drop merges a grouping/bundle into an occupied cell, the result (one merged bundle) should read as intentional, not as an accidental overlap.

**Contract**: **Decision: no new visual element is built** — the existing bundled-cell styling carries the meaning. This section is a **verification step**: confirm the merged cell renders as bundled (the existing bundled chrome) **immediately post-drop**, with no intermediate ungrouped/overlap frame. No transient cue, no modal, no new tokens. (If post-merge review shows the merge is genuinely indistinguishable from a pre-existing bundle and that confuses authors, a transient cue is a candidate follow-up — out of scope here.)

### Success Criteria:

#### Automated Verification:

- `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm build` pass
- Unit/component tests for the explode-state predicate and toggle pass: `pnpm test`
- `pnpm test:integration` passes

#### Manual Verification:

- Group/ungroup toggle expands/collapses a cell's chips in-session; a reload returns the cell to the grouped default (ephemeral confirmed)
- After ungrouping, per-chip drag and per-chip remove are live; while grouped they are inert and the whole slot drags as one unit (FR-010 unchanged)
- Dropping a grouping onto an occupied bundle merges into one bundle that renders as bundled immediately post-drop (existing bundled chrome; no overlap frame)
- A/B week toggle stays adjustable on a bundled opposite-week pair
- No `refreshPage()`/`reload()` is reachable from any board op

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Retire `slot_bundles` & E2E coverage

### Overview

Drop the now-unused `slot_bundles` table (destructive, last — after all reads/writes are gone), and bring E2E coverage up to full for the bundle operations, refactoring the existing board suite to remove duplication.

### Changes Required:

#### 1. Drop `slot_bundles`

**File**: `supabase/migrations/<ts>_drop_slot_bundles.sql` (new)

**Intent**: Remove the legacy opt-out table now that `bundle_id` is the source of truth and nothing reads or writes it.

**Contract**: `drop table slot_bundles`. (The `clone_plan` reference was already removed in Phase 1 #4, and all app reads in Phase 3 #4/#5.) Confirm no migration ordering hazard — this lands after every `slot_bundles`-touching migration.

#### 2. E2E suite — bundle operations + dedup refactor

**File**: the Playwright board E2E specs + shared board helpers (e.g. under the existing e2e suite / `src/test/` board helpers)

**Intent**: Add full E2E coverage for move (empty target), whole-bundle remove, merge (occupied target), and ungroup/group; refactor the existing drag→feedback board specs and helpers so bundle and placement flows share setup without duplication.

**Contract**: New/extended specs driving the real board (place a grouping, move the bundle to an empty cell, merge by dropping onto an occupied cell, remove the bundle, toggle ungroup and operate on a single chip). Extract shared board-interaction helpers (drag, drop, assert-bundled, assert-occupants) so placement and bundle specs reuse them — eliminating the duplication the recently-landed drag→feedback specs would otherwise multiply.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `pnpm exec supabase db reset`; `supabase db diff` clean
- Full local CI gate passes via `/verify`: `astro sync` → `pnpm check` → `pnpm lint` → `pnpm steiger` → `pnpm audit --audit-level=high` → `pnpm test` → `pnpm build`
- `pnpm test:integration` passes (RPC + clone bundle preservation)
- `pnpm test:e2e` passes, including the new bundle move/remove/merge/ungroup specs
- No reference to `slot_bundles` remains anywhere in `src/` or `supabase/` except the historical migrations: grep clean

#### Manual Verification:

- The E2E suite shows no duplicated board-setup blocks (helpers shared between placement and bundle specs)
- A clean `db reset` followed by the full app smoke (place → group → move → merge → ungroup → remove) works end-to-end
- `clone_plan` from the UI (or via the plan-clone path) produces a plan whose bundles are intact

**Implementation Note**: Final phase — confirm the full gate is green before closing the change.

---

## Testing Strategy

### Unit Tests:

- The unified member-set transitions: single add, group add, single move, whole-bundle move into an empty cell (identity preserved), merge into an occupied cell (movers join, mergers dropped), single remove, whole-bundle remove.
- `bundleId` populated from the server row via the existing whole-row `settleMany` swap (no temp-bundle-id reconciliation index added).
- The exploded-view predicate (cell is bundled iff ≥2 occupants and not exploded) and the ephemeral toggle.
- No-flicker invariant: a move/merge produces exactly the initial and final placement arrays (no transient duplicate).

### Integration Tests (`*.integration.test.ts`, via `src/test/factories/`):

- `place_course`: empty cell creates a 1-member bundle; second call reuses it; idempotent on duplicate course-hour.
- `move_bundle_members`: empty-target relocation preserves bundle id + deletes source; occupied-target merge joins destination + deletes source + drops duplicate movers.
- `remove_bundle_members`: deletes members and deletes the bundle exactly at membership 0.
- `clone_plan`: cloned placements reference remapped (non-shared) `bundle_id`s; one bundle per cloned cell; no `slot_bundles` reference.
- Backfill (Phase 1): one bundle per non-empty cell; all placements non-null `bundle_id`.

### Manual Testing Steps:

1. Place a grouping; confirm the cell renders as a bundle.
2. Drag the whole bundle to an empty cell; confirm it relocates atomically with no transient collision flag.
3. Drop another grouping onto an occupied bundle; confirm a single merged bundle results.
4. Ungroup; drag one chip out; confirm it leaves the source bundle and lands as its own bundle.
5. Remove a whole bundle via the trash; confirm no orphan `bundles` row remains.
6. Reload; confirm exploded cells return to the grouped default.
7. Clone the plan; confirm bundles are intact in the clone.

## Performance Considerations

The <200ms drag budget is preserved: validation is unchanged (pure, in-memory, accept-and-flag), and each operation is a single transactional RPC round-trip (same latency profile as today's idempotent insert) rather than the current N-call fan-out. The single-`setPlacements`-pass invariant keeps the board deriving only initial/final states. No new constraints and no larger data set are introduced.

## Migration Notes

No production data exists (README rollback note), so the legacy `slot_bundles` ungroup state is discarded on migration — acceptable because ungroup becomes presentation-only. Sequencing is additive-first / destructive-drop-last: `bundle_id` is added nullable, backfilled, then tightened to `NOT NULL`; `slot_bundles` is dropped only in Phase 5 after every read/write is gone. `clone_plan` is edited as `create or replace` off the live body. Prefer additive migrations; a code rollback does not undo an applied migration (reset hosted state by drop-and-re-push at this stage).

## References

- Research: `context/changes/first-class-bundle-operations/research.md`
- Roadmap S-05/S-07/S-08: `context/foundation/roadmap.md:133-183`
- Child-table + composite-FK + anon-revoke template: `supabase/migrations/20260620120000_course_teachers.sql`
- Transactional security-invoker RPC template: `supabase/migrations/20260620120001_replace_course_teachers_fn.sql`
- `clone_plan` + `_grouping_map` double-remap to mirror: `supabase/migrations/20260621130001_clone_plan_with_week.sql:124-152`
- Best-effort bundle move to replace: `src/_pages/plan-detail/model/use-placements.ts:207-227`
- Single-pass no-flicker invariant: `src/_pages/plan-detail/model/placement-transitions.ts:200-237`
- Derived bundle model being retired: `src/_pages/plan-detail/model/slot-bundle.ts`, `model/use-slot-bundles.ts`, `api/slot-bundles.ts`
- SSR load to update: `src/_pages/plan-detail/api/load.ts:64-105`
- Lessons: `context/foundation/lessons.md` (anon-revoke; `astro check` type gate; port-the-mechanism; localStorage guard — N/A since ungroup is ephemeral)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema & data foundation

#### Automated

- [x] 1.1 Migrations apply cleanly from scratch: `pnpm exec supabase db reset` — f6fce30
- [x] 1.2 `supabase db diff` reports clean after reset — f6fce30
- [x] 1.3 Type checking passes: `pnpm check` — f6fce30
- [x] 1.4 Linting passes: `pnpm lint` — f6fce30
- [x] 1.5 Build stays clean: `pnpm build` — f6fce30
- [x] 1.6 Integration test: bundle-aware arrange helper (`place-course.ts`) seeds non-null `bundle_id` (one bundle per non-empty cell); existing integration suite green against `NOT NULL` (`pnpm test:integration`) — f6fce30
- [x] 1.7 Integration test: `clone_plan` remaps `bundle_id`s, one bundle per cloned cell — f6fce30

#### Manual

- [x] 1.8 Board renders identically post-reset (no UI reads `bundle_id` yet) — f6fce30
- [x] 1.9 `has_table_privilege('anon','public.bundles','INSERT')` is `false` (by query) — f6fce30
- [x] 1.10 Partial unique index rejects a second placed bundle on the same cell — f6fce30

### Phase 2: Transactional bundle RPCs

#### Automated

- [x] 2.1 Migrations apply cleanly: `pnpm exec supabase db reset` — 042f0af
- [x] 2.2 `pnpm check`, `pnpm lint`, `pnpm build` pass — 042f0af
- [x] 2.3 Integration test: `place_course` creates a 1-member bundle; second call reuses it — 042f0af
- [x] 2.4 Integration test: `place_course` idempotent on duplicate course-hour — 042f0af
- [x] 2.5 Integration test: `move_bundle_members` into empty cell relocates + preserves bundle id + deletes source — 042f0af
- [x] 2.6 Integration test: `move_bundle_members` into occupied cell merges (source deleted, duplicate movers dropped) — 042f0af
- [x] 2.7 Integration test: `remove_bundle_members` deletes bundle exactly at membership 0 — 042f0af

#### Manual

- [x] 2.8 A merge that empties the source leaves no orphan `bundles` row — 042f0af
- [x] 2.9 RLS gates the RPCs (anon rejected — invoker semantics) — 042f0af

### Phase 3: Bundle-aware persistence + unified member-set model

#### Automated

- [x] 3.1 `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm build` pass — 3f8a546
- [x] 3.2 Unit tests pass for the member-set transitions + `bundleId` populated from the server row (no temp-bundle-id reconciliation) + cleanup expectation: `pnpm test` — 3f8a546
- [x] 3.3 Phase 2 integration tests still pass — 3f8a546
- [x] 3.4 No `slot_bundles`/`useSlotBundles`/`slot-bundle` reference remains in `src/` (grep clean) — 3f8a546

#### Manual

- [x] 3.5 Place / single move / whole-bundle move (empty) / merge (occupied) / single remove / whole remove all work and persist across reload — 3f8a546
- [x] 3.6 No transient duplicate-course flag mid-operation (no-flicker invariant holds) — 3f8a546
- [x] 3.7 Drag latency visually unchanged (<200ms budget) — 3f8a546

### Phase 4: UI integration & ungroup-as-presentation

#### Automated

- [x] 4.1 `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm build` pass — 8398258
- [x] 4.2 Unit/component tests for the explode-state predicate and toggle pass: `pnpm test` — 8398258
- [x] 4.3 `pnpm test:integration` passes — 8398258

#### Manual

- [x] 4.4 Group/ungroup toggle expands/collapses in-session; reload returns to grouped default — 8398258
- [x] 4.5 Per-chip drag/remove live when ungrouped, inert when grouped (FR-010 unchanged) — 8398258
- [x] 4.6 Dropping a grouping onto an occupied bundle merges into one bundle that renders as bundled immediately post-drop (existing chrome; no overlap frame) — 8398258
- [x] 4.7 A/B week toggle stays adjustable on a bundled opposite-week pair — 8398258
- [x] 4.8 No `refreshPage()`/`reload()` reachable from any board op — 8398258

### Phase 5: Retire `slot_bundles` & E2E coverage

#### Automated

- [x] 5.1 Drop migration applies cleanly: `pnpm exec supabase db reset`; `db diff` clean
- [x] 5.2 Full local CI gate passes via `/verify`
- [x] 5.3 `pnpm test:integration` passes (RPC + clone bundle preservation)
- [x] 5.4 `pnpm test:e2e` passes, including new bundle move/remove/merge/ungroup specs
- [x] 5.5 No `slot_bundles` reference remains in `src/` or `supabase/` except historical migrations (grep clean)

#### Manual

- [x] 5.6 E2E suite shows no duplicated board-setup blocks (shared helpers)
- [x] 5.7 Clean `db reset` + full app smoke (place → group → move → merge → ungroup → remove) works end-to-end
- [x] 5.8 `clone_plan` from the UI produces a plan with bundles intact
