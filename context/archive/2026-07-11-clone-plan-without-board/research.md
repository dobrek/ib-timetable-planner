---
date: 2026-07-11T20:05:00+02:00
researcher: Dobromir Kropielnicki (via Claude)
git_commit: e4b8f9ae69131453404622b3610191927532642d
branch: main
repository: ib-timetable-planner
topic: "Feasibility of a catalog-only plan clone (copy teachers/students/courses, reset board: placements, groupings, bundles)"
tags: [research, codebase, clone-plan-without-board, clone_plan, plans, catalog, board, supabase-rpc]
status: complete
last_updated: 2026-07-11
last_updated_by: Dobromir Kropielnicki (via Claude)
---

# Research: Catalog-only plan clone (skip the board)

**Date**: 2026-07-11T20:05:00+02:00
**Researcher**: Dobromir Kropielnicki (via Claude)
**Git Commit**: `e4b8f9ae69131453404622b3610191927532642d`
**Branch**: `main`
**Repository**: `dobrek/ib-timetable-planner`

## Research Question

Check the feasibility of an additional cloning option for planning, such that **teacher data, student data, and course data are cloned** while **grouping / board settings, placements, and bundles are skipped**.

### Scope decisions (confirmed with the user before research)

- **Boundary — "keep as catalog":** teacher availability, course colors, finishes-early / day-scoped rules, and bi-weekly (`week_mode`) config **travel with the copy**. Only the placement grid, enumerated groupings, and bundles/shelf reset to empty.
- **Approach — "param on existing RPC":** center the analysis on adding an `include_board boolean default true` parameter to the current `clone_plan` RPC (one code path), rather than a parallel `clone_plan_catalog_only` RPC.

## Summary

**Verdict: highly feasible, low-risk, additive — no new tables or columns, and the board-skip variant is arguably *safer* than the full clone.**

Three facts make this a small, clean change:

1. **The catalog is plan-owned.** `20260611180006_plans_as_domain_root.sql` made teachers, courses, students, choices, availability, and dependencies each carry `plan_id ... references plans(id)`, keyed by composite `(plan_id, id)` FKs. A "plan" is a complete, self-contained scenario (catalog + board), and cloning is already the primary way to start a new one. So copying just the catalog under a fresh `plan_id` is a well-defined operation.

2. **FK direction is entirely one-way: board → catalog, never catalog → board.** The only FKs pointing *at* board tables are board→board (`course_grouping_members → course_groupings`, `placements → bundles`, `shelf_bundle_courses → shelf_bundles`). No catalog table references any board table. Therefore **omitting the six board-table insert blocks from `clone_plan` leaves no dangling FK and no NOT-NULL violation.** The one NOT-NULL that could bite (`placements.bundle_id NOT NULL`) is never exercised because bundles and placements are skipped together.

3. **A catalog-only clone lands in the exact cold-start state of a freshly created blank plan.** Every board read coalesces with `?? []`; zero rows renders an empty-but-interactive board. The only post-clone step is the same one any new plan needs: click **"Compute groupings"** once per cohort. Grouping enumeration is *never* automatic — it is always an explicit user action — so a clone with no `course_groupings` rows is correct, not broken. It is functionally equivalent to "create a blank plan, then hand-re-enter the same catalog," minus the re-entry.

The implementation is: one additive migration that re-creates `clone_plan` with an `include_board` param guarding the board sections, a regenerated types file, one new Zod field, one dialog toggle, and one integration test. Estimated at a few hours of work concentrated in a single well-understood RPC plus the `plans-list` slice.

## Detailed Findings

### 1. Architecture — a plan owns catalog + board; clone is a deep copy

The `multi-variant-management` change (2026-06-11) established the model: **plans are the cloneable domain root**, absorbing the catalog. `plan_variants` and `cohorts` tables were dropped; cohort became a native enum `'dp1' | 'dp2'`. Cross-plan references are impossible because every intra-plan link uses a composite `(plan_id, id)` FK, and the clone RPC remaps UUIDs through temp maps so a missed remap fails loudly at insert.

- Header: `supabase/migrations/20260611180006_plans_as_domain_root.sql:1-8` ("The catalog … becomes plan-owned").
- `plan_id` added to teachers `:31-32`, courses `:38-39`, students `:46-47`, student_choices `:55`, course_overlaps `:68`, course_merges `:80`.
- `plan_variants` + `cohorts` dropped `:127-128`; cohort enum `:28`.

The existing clone is a **full deep copy** (catalog + board), by design "so cloned plans open warm" (`context/archive/2026-06-11-multi-variant-management/plan-brief.md`, Clone depth decision).

### 2. The current `clone_plan` RPC — the exact insert blocks to gate

**Latest live definition:** `supabase/migrations/20260711133933_clone_plan_carry_finishes_early.sql`. It is a full `create or replace` and no migration sorts after it, so it is live as-is; all earlier `*clone_plan*` migrations are superseded (relevant to the lessons.md rule — see Architecture Insights).

- **Signature** `:8-12`: `clone_plan(p_source_plan_id uuid, p_name text) returns uuid`, `language plpgsql`, **`security invoker`**, `set search_path = ''`.
- **Mechanism:** inserts a fresh `plans` row `:18-22`; creates six `on commit drop` temp ID-maps (`_teacher_map`, `_course_map`, `_student_map`, `_grouping_map`, `_bundle_map`, `_shelf_bundle_map`) whose `new_id` DEFAULTs to `gen_random_uuid()` `:31-54`; populates them from the source plan `:56-72`; then copies each table with INNER JOINs against the maps, in parent-before-child topological order.

Every copy operation, classified:

| Block | Lines | Table | Bucket |
|---|---|---|---|
| plan container | `:18-22` | `plans` (name, `slot_grid_preset`) | **CONTAINER** (always) |
| 2 | `:75-78` | `teachers` | CATALOG |
| 2b | `:83-87` | `teacher_availability` | CATALOG |
| 3 | `:93-96` | `courses` (incl. `week_mode`, `color`, `finishes_early`) | CATALOG |
| 4 | `:99-104` | `course_overlaps` (dependency) | CATALOG |
| 4 | `:106-111` | `course_merges` (companion) | CATALOG |
| 4b | `:117-122` | `course_teachers` (co-teaching set) | CATALOG |
| 5 | `:125-128` | `students` | CATALOG |
| 6 | `:131-136` | `student_choices` | CATALOG |
| **6b** | **`:142-145`** | **`bundles`** | **BOARD** |
| **7** | **`:151-156`** | **`placements`** (incl. `week`, `is_optional`) | **BOARD** |
| **8** | **`:160-163`** | **`course_groupings`** (incl. `catalog_hash`, `opposite_week`) | **BOARD** |
| **9** | **`:166-171`** | **`course_grouping_members`** | **BOARD** |
| **10** | **`:176-179`** | **`shelf_bundles`** | **BOARD** |
| **11** | **`:186-191`** | **`shelf_bundle_courses`** (incl. `week`, `is_optional`) | **BOARD** |

**To make a catalog-only clone, wrap blocks 6b–11 (`:142-191`) in `if p_include_board then … end if;`.** The three board temp maps (`_grouping_map`, `_bundle_map`, `_shelf_bundle_map`) are consumed *only* by those blocks, so when skipped they are merely unused (harmless — no need to conditionally skip their creation).

Confirmed: no catalog block joins a board map, and no catalog FK targets a board table, so the skip is dangle-free.

### 3. Catalog vs board — the definitive keep/skip inventory

**KEEP (copy + remap)** — plan-owned, covers the "keep availability/colors/rules/week config" requirement in full:

- `teachers`, `teacher_availability`, `courses` (with `week_mode` = bi-weekly, `color` = subject-colors, `finishes_early` = day-scoped rule), `course_teachers`, `course_overlaps`, `course_merges`, `students`, `student_choices` — plus a fresh `plans` row carrying `slot_grid_preset`.

**SKIP (leave empty):**

- `placements`, `bundles`, `course_groupings`, `course_grouping_members`, `shelf_bundles`, `shelf_bundle_courses`.

**Uniqueness — no collisions on clone.** Every business UNIQUE is either plan-scoped (`teachers_plan_code_unique (plan_id, code)` `20260611180006:34`; `courses_unique (plan_id, cohort, name, level, group_index)` `:42`) or keyed on freshly-minted UUIDs. The original *global* `teachers_code_key` was dropped precisely because it blocked cloning (`20260611180006:30`). A clone always creates a new `plans` row, so nothing collides.

**Plan-level display config — mostly not in the DB.** The only DB-resident plan display setting is `plans.slot_grid_preset` (`20260602185012:91-97`), copied by the plan container insert. Everything else the user might think of as a "board setting" is **not persisted per-plan**, so it is out of scope for clone by construction:

| Setting | Persistence | Where |
|---|---|---|
| subject colors | DB (catalog) | `courses.color` — travels with catalog |
| day-scoped rule (finishes-early) | DB (catalog) | `courses.finishes_early` — travels with catalog |
| bi-weekly | DB | `courses.week_mode` (catalog, keep) + `placements.week` / `course_groupings.opposite_week` (board, skip) |
| sticky day/period headers | none (CSS only) | `position: sticky` in `PlannerGrid.tsx`; labels computed from the preset |
| breaks between periods | none | in-code constant `BREAK_AFTER = {2,5}` in `PlannerGrid.tsx` |
| board zoom | localStorage (per-device) | key `planner-board-zoom` |
| board view state (lens/highlight/inspection) | ephemeral React state | no store adopted; in-session only |

### 4. A skipped board opens clean — same as a blank plan

The single board loader `loadCombinedPlannerData` (`src/_pages/plan-detail/api/load.ts:50`) reads groupings, placements, and shelf in one `Promise.all` and coalesces each with `?? []` (`:118-119`, `:128/138`, `:133/143`). `assertNoQueryErrors` (`:98-106`) inspects only the `.error` channel — never row counts. The route sets 404/503 only for a missing plan or unconfigured Supabase, never for empty data (`src/pages/plans/[id]/index.astro:15-16`). Zero rows → an empty, interactive board.

- **Grouping enumeration is explicit, never automatic.** `resolvePaletteView` returns `"empty"` when `groupingsCount === 0` (`src/_pages/plan-detail/model/grouping/palette-view.ts:15-25`), and the palette renders `ComputeGroupingsEmptyState` whose "Compute groupings" button is the only trigger (`ComputeGroupingsEmptyState.tsx:33,49-59`). There is no on-mount auto-compute anywhere in `PlannerBoard.tsx` / `use-cohort-board-state.ts`.
- **Staleness never fires on an empty plan.** The loader guards `isGroupingStale` behind `groupingsCount > 0` (`load.ts:189-196`), so a zero-grouping plan is "empty", not "stale". Compute then enumerates fresh against the *cloned* course UUIDs and stores a matching `catalog_hash` (`grouping-compute.ts:46`).
- **Perspective (teacher/student) views tolerate zero placements** — same `?? []` coalescing (`src/_pages/teacher-plan-view/api/loader.ts:131,138`).

**This is safer than the full clone.** The full clone copies `course_groupings.catalog_hash` verbatim (`20260711133933:160-161`) — a hash of the *source's* course UUIDs — and relies on the app wrapper's `refreshCatalogHash` to patch it afterward (`clone-plan.ts:22-45`). The catalog-only clone sidesteps that entirely: no grouping rows → the palette's "no groupings → compute" path enumerates cleanly against whatever UUIDs the copy carries.

### 5. App-side wiring — every insertion point for `include_board`

The feature lives in the `plans-list` slice. Threading the flag touches four layers (client wrapper needs no structural change):

1. **RPC wrapper** — `src/_pages/plans-list/api/clone-plan.ts:16`: add `p_include_board: input.includeBoard` to the `.rpc("clone_plan", { … })` args. The post-clone `refreshCatalogHash` loop (`:22-45`) becomes a no-op when board is skipped (its `UPDATE course_groupings … WHERE plan_id = <clone>` matches zero rows); optionally early-return it when `!includeBoard` to save two queries.
2. **Action input schema** — `src/_pages/plans-list/model/schemas.ts:14-17`: add `includeBoard: z.boolean().default(true)` to `clonePlanInput`. `ClonePlanFormValues`/`ClonePlanInput` derive automatically; the action wiring (`api/actions.ts:10`) is untouched.
3. **Client wrapper** — `src/_pages/plans-list/api/plans-client.ts:10`: no change; `values: ClonePlanInput` carries the new field.
4. **Dialog** — `src/_pages/plans-list/ui/ClonePlanDialog.tsx`: add `includeBoard: true` to `defaultValues` (`:66`) and a `Switch` `FormField` between the name field (`:100`) and the footer (`:102`). A `Switch` is already exported at `src/shared/ui/index.ts:86`. Reword the DialogDescription to state that placements/groupings/bundles are omitted when the toggle is off. Post-clone navigation into the new plan is unchanged (`:81`, `navigate('/plans/<id>')`).
5. **Types** — regenerate `src/shared/api/database.types.ts:651-654` (RPC `Args` gains `p_include_board`) via `supabase gen types` after the migration.

The clone is the only member of the plans CRUD family (create-blank, clone, rename, delete) that goes through an RPC; create and clone are the two that navigate into the resulting plan.

## Code References

- [`supabase/migrations/20260711133933_clone_plan_carry_finishes_early.sql`](https://github.com/dobrek/ib-timetable-planner/blob/e4b8f9ae69131453404622b3610191927532642d/supabase/migrations/20260711133933_clone_plan_carry_finishes_early.sql) — current live `clone_plan`; board blocks to gate at `:142-191`
- [`supabase/migrations/20260611180006_plans_as_domain_root.sql`](https://github.com/dobrek/ib-timetable-planner/blob/e4b8f9ae69131453404622b3610191927532642d/supabase/migrations/20260611180006_plans_as_domain_root.sql) — catalog becomes plan-owned; composite `(plan_id, id)` FKs; plan-scoped uniques
- [`src/_pages/plans-list/api/clone-plan.ts`](https://github.com/dobrek/ib-timetable-planner/blob/e4b8f9ae69131453404622b3610191927532642d/src/_pages/plans-list/api/clone-plan.ts) — RPC wrapper (`:16`) + `refreshCatalogHash` (`:22-45`)
- [`src/_pages/plans-list/model/schemas.ts`](https://github.com/dobrek/ib-timetable-planner/blob/e4b8f9ae69131453404622b3610191927532642d/src/_pages/plans-list/model/schemas.ts) — `clonePlanInput` (`:14-17`)
- [`src/_pages/plans-list/ui/ClonePlanDialog.tsx`](https://github.com/dobrek/ib-timetable-planner/blob/e4b8f9ae69131453404622b3610191927532642d/src/_pages/plans-list/ui/ClonePlanDialog.tsx) — dialog + toggle insertion point (`:66`, `:100-102`)
- [`src/_pages/plan-detail/api/load.ts`](https://github.com/dobrek/ib-timetable-planner/blob/e4b8f9ae69131453404622b3610191927532642d/src/_pages/plan-detail/api/load.ts) — board loader; `?? []` coalescing; staleness guard (`:189-196`)
- [`src/_pages/plan-detail/model/grouping/palette-view.ts`](https://github.com/dobrek/ib-timetable-planner/blob/e4b8f9ae69131453404622b3610191927532642d/src/_pages/plan-detail/model/grouping/palette-view.ts) — `groupingsCount === 0 → "empty"` (`:15-25`)
- [`src/shared/api/database.types.ts`](https://github.com/dobrek/ib-timetable-planner/blob/e4b8f9ae69131453404622b3610191927532642d/src/shared/api/database.types.ts) — `clone_plan` generated `Args`/`Returns` (`:651-654`), regenerate after migration

## Architecture Insights

- **One-way FK topology is the enabling invariant.** Because no catalog table depends on any board table, "clone catalog, skip board" is a structurally safe cut — not a special case that has to be reasoned about per-table. Any future *catalog* table added under the plan root inherits the same property automatically; any future *board* table must be added *inside* the `if p_include_board` guard.
- **`course_groupings` is a derived artifact, not authored state.** It is palette enumeration cached by `catalog_hash`. Resetting it to empty is self-healing (recomputed on demand), which is why skipping it is preferable to copying-then-patching a stale hash.
- **Re-create the RPC from the latest live definition, not the original migration** — lessons.md rule (`optional-subject-in-bundle` regressed by copying an old body). The new migration must full-body copy `20260711133933`'s definition, preserve `security invoker` + `set search_path = ''`, then add the param and guard.
- **Postgres overload gotcha.** `create or replace function clone_plan(uuid, text, boolean default true)` does **not** replace the existing 2-arg function — it creates an overload, and a named-param RPC call would then be ambiguous. The migration must `drop function public.clone_plan(uuid, text);` first, then create the 3-arg version. (Additive at the app layer via the default; not a breaking change for existing callers.)
- **The clone RPC re-amendment chain is a known maintenance tax.** Nearly every schema change ships a `clone_plan_*` migration (the `supabase/migrations` list shows ~11). Adding an `include_board` guard adds one branch point future board-table amendments must land inside — which is exactly why the user chose to parameterize the *single* RPC rather than fork a second `clone_plan_catalog_only` that would double that tax.

## Historical Context (from prior changes)

- `context/archive/2026-06-11-multi-variant-management/` — established plans-as-cloneable-root, the `clone_plan` RPC, and "clone is the primary creation path." Decisions table: "Clone depth: full deep copy … cloned plans open warm." This change adds the *shallow* (catalog-only) alternative to that full copy.
- `context/archive/2026-06-24-first-class-bundle-operations/` & `2026-06-26-bundle-holding-container/` — introduced `bundles` / `shelf_bundles` (board tables) and their `clone_plan_with_*` amendments; both are in the skip set.
- `context/archive/2026-07-11-day-scoped-course-rules/` — `courses.finishes_early` (the "day-scoped rule"); confirmed catalog, travels with the copy.

## Related Research

- `context/archive/2026-06-11-multi-variant-management/research.md` — the original clone/versioning design study this builds on.

## Open Questions

All are product/UX decisions for the `/10x-plan` step, not feasibility blockers:

1. **UX surface** — a `Switch` toggle inside the existing Clone dialog (recommended; matches the chosen "one code path" approach) vs. a distinct "Clone catalog only" menu item. A toggle is the smallest change; a second menu item advertises the capability more visibly.
2. **Default name suffix** — full clone prefills `"{name} (copy)"`; should a catalog-only clone prefill something distinguishing (e.g. `"{name} (catalog)"`) so the two are tellable apart in the hub list?
3. **`refreshCatalogHash` short-circuit** — leave it as a harmless no-op when board is skipped, or early-return to save the two per-cohort queries (trivial optimization).
4. **Temp-map creation** — leave the three unused board maps created (simplest, harmless) or conditionally skip them for cleanliness (no correctness impact).
