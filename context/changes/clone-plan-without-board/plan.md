# Clone Plan Without Board — Implementation Plan

## Overview

Add a catalog-only variant to the existing plan clone. Today `clone_plan` is a full deep copy (catalog **and** board); this change adds an `include_board boolean default true` parameter to that single RPC so an author can copy just the **catalog** — teachers + availability, courses (with `week_mode`/`color`/`finishes_early`), `course_teachers`, overlaps, merges, students, and choices — while the **board** (placements, groupings + members, bundles, shelf bundles + members) resets to empty. The option is surfaced as a `Switch` inside the current Clone dialog. The result lands in the exact cold-start state of a freshly created blank plan: one "Compute groupings" click per cohort away from ready.

## Current State Analysis

- `clone_plan` is the only RPC in the plans CRUD family (create-blank, clone, rename, delete). Its latest live definition is `supabase/migrations/20260711133933_clone_plan_carry_finishes_early.sql` — a full `create or replace`, `security invoker`, `set search_path = ''`, signature `clone_plan(p_source_plan_id uuid, p_name text) returns uuid`. No later migration supersedes it, so that body is live as-is.
- The RPC creates six `on commit drop` temp ID-maps, populates them from the source plan, then copies each table with INNER JOINs against the maps in parent-before-child order. Board copy lives in blocks **6b–11** (`bundles :142-145`, `placements :151-156`, `course_groupings :160-163`, `course_grouping_members :166-171`, `shelf_bundles :176-179`, `shelf_bundle_courses :186-191`).
- FK direction is entirely one-way: **board → catalog, never catalog → board**. The only FKs pointing *at* board tables are board→board. No catalog table references any board table. Skipping blocks 6b–11 therefore leaves zero dangling FK and no NOT-NULL violation (the one that could bite — `placements.bundle_id NOT NULL` — is never exercised because bundles and placements skip together).
- The board loader `loadCombinedPlannerData` coalesces every board read with `?? []` and inspects only the `.error` channel — zero rows renders an empty, interactive board (`src/_pages/plan-detail/api/load.ts`). Grouping enumeration is **explicit, never automatic**: `resolvePaletteView` returns `"empty"` when `groupingsCount === 0` and renders `ComputeGroupingsEmptyState`, whose "Compute groupings" button is the only trigger. Staleness is guarded behind `groupingsCount > 0`, so a zero-grouping plan reads as "empty", not "stale".
- App-side wiring for the flag touches four files in the `plans-list` slice: `model/schemas.ts` (Zod input), `api/clone-plan.ts` (RPC wrapper + `refreshCatalogHash`), `ui/ClonePlanDialog.tsx` (dialog), and the generated `shared/api/database.types.ts`. `api/plans-client.ts` and `api/actions.ts` need no change — the new field rides through the derived `ClonePlanInput` type.

## Desired End State

The Clone dialog shows an "Include board" toggle (default on). With it **on**, behavior is byte-for-byte identical to today — a full deep copy, author lands on the warm board. With it **off**, the clone copies only the catalog; the author lands on an empty-but-interactive board that shows the standard `ComputeGroupingsEmptyState`. A catalog-only clone is fully independent of its source and passes the same isolation guarantees as a full clone. Verified by: the extended integration test (catalog parity + all six board tables empty + no source-id leaks), a green `pnpm build`/`pnpm lint`/`pnpm steiger`, and a manual toggle-off clone that opens on the compute-groupings empty state.

### Key Discoveries:

- **The cut is structurally safe by construction** — one-way FK topology means wrapping blocks 6b–11 in `if p_include_board then … end if;` is a clean cut, not a per-table special case (`research.md` §2, §4; migration `20260711133933:142-191`).
- **Postgres overload gotcha** — `create or replace function clone_plan(uuid, text, boolean default true)` does **not** replace the 2-arg function; it creates an *overload*, making a named-param RPC call ambiguous. The migration must `drop function public.clone_plan(uuid, text);` first (`research.md` Architecture Insights).
- **Copy the latest live body, not an old one** — lessons.md rule (`optional-subject-in-bundle` regressed by copying a stale body). The new migration full-body-copies `20260711133933`, preserving `security invoker` + `set search_path = ''`, then adds the param and guard (`research.md` Architecture Insights).
- **Catalog-only is *safer* than the full clone** — it sidesteps the `catalog_hash` staleness dance entirely: no grouping rows → the palette's compute-empty-state enumerates fresh against the clone's own course UUIDs. `refreshCatalogHash` matches zero rows when board is skipped (`research.md` §4; `src/_pages/plans-list/api/clone-plan.ts:34-45`).
- **The three board temp-maps go unused when the guard is off** — harmless; no need to conditionally skip their creation (`research.md` §2).

## What We're NOT Doing

- **Not** forking a second `clone_plan_catalog_only` RPC — one parameterized code path (deliberate, to avoid doubling the clone-amendment maintenance tax).
- **Not** adding a separate "Clone catalog only" menu item — the capability lives behind the dialog toggle.
- **Not** changing the name prefill — it stays `"{name} (copy)"` for both modes.
- **Not** adding any first-load hint/toast/banner or changing post-clone navigation — the author lands on the board and the existing `ComputeGroupingsEmptyState` is the guide (same as a blank plan).
- **Not** adding new tables or columns — no schema shape change beyond the RPC signature.
- **Not** adding a dialog component/unit test — coverage is the RPC integration test.
- **Not** touching perspective (teacher/student) views — they already tolerate zero placements via the same `?? []` coalescing.

## Implementation Approach

Thread one boolean from the dialog toggle to the RPC. The RPC is the load-bearing change: a new additive migration re-creates `clone_plan` with the guard and is verified in isolation by the integration test — no UI required to prove correctness. The app layer then threads the flag through the existing typed seam (`ClonePlanInput`), which the client wrapper and action already carry unchanged. Default `true` everywhere keeps the change additive: existing callers and the default dialog state produce the current full-clone behavior.

## Critical Implementation Details

- **Migration ordering** — the new migration must `drop function public.clone_plan(uuid, text);` **before** creating the 3-arg version, or the RPC becomes an ambiguous overload. This is a hard requirement, not a cleanup.
- **Guard placement** — only blocks 6b–11 go inside `if p_include_board then … end if;`. The `plans` insert, all catalog blocks (2–6), the temp-map creation, and the eager `drop table` cleanup stay unconditional. The guard opens after block 6 (`student_choices`) and closes before the temp-table drops.

## Phase 1: Database — guard the board in `clone_plan`

### Overview

Add the `include_board` parameter and its guard to `clone_plan` via a new migration, regenerate the database types, and prove the guard with an integration test. This phase is fully self-verifiable against local Supabase without any UI.

### Changes Required:

#### 1. New migration re-creating `clone_plan` with the board guard

**File**: `supabase/migrations/<timestamp>_clone_plan_include_board.sql` (new; timestamp via `pnpm exec supabase migration new clone_plan_include_board`)

**Intent**: Make the board copy optional so an author can clone the catalog alone. Full-body-copy the latest live `clone_plan` definition, add a third parameter, and gate the six board-copy blocks behind it — leaving full-clone behavior unchanged when the flag defaults true.

**Contract**: Drop the existing 2-arg function first, then create `clone_plan(p_source_plan_id uuid, p_name text, p_include_board boolean default true) returns uuid`, preserving `language plpgsql`, `security invoker`, `set search_path = ''`. Body is copied verbatim from `20260711133933_clone_plan_carry_finishes_early.sql` with exactly one structural change: wrap the six board INSERT blocks (`bundles`, `placements`, `course_groupings`, `course_grouping_members`, `shelf_bundles`, `shelf_bundle_courses` — sections 6b–11) in `if p_include_board then … end if;`. Catalog blocks, `plans` insert, temp-map creation, and the eager temp-table drops stay unconditional.

```sql
-- required first, or the 3-arg create becomes an overload (ambiguous named-param RPC):
drop function public.clone_plan(uuid, text);

create or replace function clone_plan(p_source_plan_id uuid, p_name text, p_include_board boolean default true)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
  -- …catalog blocks 1–6 unchanged…
  if p_include_board then
    -- …blocks 6b–11: bundles, placements, course_groupings,
    --    course_grouping_members, shelf_bundles, shelf_bundle_courses…
  end if;
  -- …temp-table drops + return unchanged…
$$;
```

#### 2. Regenerate the database types

**File**: `src/shared/api/database.types.ts`

**Intent**: Reflect the new RPC signature so the wrapper can pass `p_include_board` type-safely.

**Contract**: Regenerate via `supabase gen types` (the project's existing type-gen path). The `clone_plan` `Args` entry (`:651-654`) gains `p_include_board?: boolean`; `Returns` unchanged. No hand edits — regenerate and commit the diff.

#### 3. Extend the clone integration test with a catalog-only case

**File**: `src/_pages/plans-list/api/clone-plan.integration.test.ts`

**Intent**: Prove the guard: a catalog-only clone copies the catalog in full and leaves every board table empty, with no source-id leaks. This test is the standing guard against a future board-table amendment being added *outside* the `if p_include_board` block.

**Contract**: Add one `it(...)` that clones the existing `sourcePlanId` (which already carries a dp2 placement + dp2 groupings from `beforeAll`) with `p_include_board: false`, then asserts: (a) catalog tables (`teachers`, `teacher_availability`, `courses`, `course_teachers`, `students`, `student_choices`, `course_overlaps`, `course_merges`) have row counts matching the source; (b) all six board tables (`bundles`, `placements`, `course_groupings`, `course_grouping_members`, `shelf_bundles`, `shelf_bundle_courses`) return zero rows for the clone; (c) catalog root-table ids (`teachers`/`courses`/`students`) don't leak from the source. Reuse the file's existing `countRows`/`idsOf` helpers and `registerPlan(...)` for teardown; extend the local `clonePlan` helper (or add a variant) to pass the third RPC arg.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly from scratch: `pnpm exec supabase db reset`
- Types regenerate with no hand edits and typecheck passes: `pnpm lint`
- Existing full-clone integration tests still pass (behavior unchanged): `pnpm test:integration`
- New catalog-only integration test passes: `pnpm test:integration`
- Build stays clean: `pnpm build`

#### Manual Verification:

- `pnpm exec supabase db diff` reports clean after reset (migration is the sole source of the definition)
- Calling `clone_plan(<src>, 'x', false)` in Studio produces a plan with a full catalog and zero board rows
- A named-param RPC call is unambiguous (no "function is not unique" error) — confirms the 2-arg drop landed

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 2. Phase blocks use plain bullets — the `- [ ]` checkboxes live in the `## Progress` section.

---

## Phase 2: App layer — thread the flag to the dialog

### Overview

Expose the flag as a `Switch` in the Clone dialog and thread it through the Zod input and RPC wrapper. Default on preserves the current full-clone flow; off produces a catalog-only clone that lands on the compute-groupings empty state.

### Changes Required:

#### 1. Add the `includeBoard` field to the clone input schema

**File**: `src/_pages/plans-list/model/schemas.ts`

**Intent**: Carry the toggle value through the single validation source of truth so the action, client, and RHF form all agree on the shape.

**Contract**: Add `includeBoard: z.boolean().default(true)` to `clonePlanInput` (`:14-17`). `ClonePlanFormValues`/`ClonePlanInput` derive automatically; `api/actions.ts` and `api/plans-client.ts` need no change.

#### 2. Pass the flag through the RPC wrapper and short-circuit the hash refresh

**File**: `src/_pages/plans-list/api/clone-plan.ts`

**Intent**: Forward the flag to the RPC and skip the now-pointless `catalog_hash` refresh when there are no grouping rows to refresh.

**Contract**: Add `p_include_board: input.includeBoard` to the `.rpc("clone_plan", { … })` args (`:16`). Guard the `refreshCatalogHash` loop (`:22-29`) with an early return / conditional when `!input.includeBoard` — a catalog-only clone has zero `course_groupings` rows, so the per-cohort `UPDATE` would match nothing; skipping it saves two queries and keeps intent explicit. Update the function's leading doc comment to note the board-skip path.

#### 3. Add the toggle and reword the dialog description

**File**: `src/_pages/plans-list/ui/ClonePlanDialog.tsx`

**Intent**: Give the author a discoverable control to choose catalog-only, and make the dialog copy state what travels vs. resets.

**Contract**: Add `includeBoard: true` to `defaultValues` (`:66`). Insert a `Switch` `FormField` (named `includeBoard`, labelled e.g. "Include board (placements & groupings)") between the name `FormField` (`:100`) and the `DialogFooter` (`:102`); `Switch` is already exported from `@/shared/ui`. Reword the `DialogDescription` (`:49-52`) so it states that placements, groupings, and bundles are omitted when the toggle is off (catalog — students, teachers, courses, availability, colors, rules — always travels). Name prefill (`:66`) and post-clone `navigate('/plans/<id>')` (`:81`) are unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking + lint pass: `pnpm lint`
- FSD boundaries intact: `pnpm steiger`
- Unit suite passes: `pnpm test`
- Build stays clean: `pnpm build`

#### Manual Verification:

- Clone dialog shows the "Include board" toggle, default on
- Toggle **on** → cloned plan opens on a warm board (placements/groupings present) — unchanged from today
- Toggle **off** → cloned plan opens on an empty board showing `ComputeGroupingsEmptyState`; clicking "Compute groupings" per cohort enumerates cleanly
- Catalog is fully present in the catalog-only clone (courses with colors/rules, teachers + availability, students + choices)
- Dialog description accurately reflects what's omitted when the toggle is off

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation from the human that the toggle-on and toggle-off flows both behave as described.

---

## Testing Strategy

### Unit Tests:

- No new unit tests. The dialog is thin react-hook-form wiring; the schema default is exercised transitively by the integration path and the RHF resolver.

### Integration Tests:

- Extend `clone-plan.integration.test.ts` with the catalog-only case (Phase 1 #3): catalog parity, all six board tables empty, no source-id leaks. Runs via `pnpm test:integration` against local Supabase.
- The existing full-clone cases stand as the regression guard that `p_include_board` default-true leaves current behavior untouched.

### Manual Testing Steps:

1. In the plans hub, open Clone on a plan that has placements + computed groupings.
2. Leave "Include board" on, clone → confirm the new plan opens warm (board populated). This is the unchanged path.
3. Open Clone again, turn "Include board" off, clone → confirm the new plan opens on the compute-groupings empty state.
4. In the catalog-only clone, verify courses (with colors + finishes-early rules), teachers + availability, and students + choices are all present.
5. Click "Compute groupings" for each cohort → confirm enumeration produces groupings against the clone's own courses.
6. Rename/delete the catalog-only clone → confirm the source is untouched (isolation).

## Performance Considerations

Catalog-only clone is strictly less work than the full clone (six fewer INSERT blocks) and skips two per-cohort `catalog_hash` update queries. No new hot path; the <200ms drag-drop budget is unaffected (this is a plan-creation action, not a board interaction).

## Migration Notes

Additive and non-breaking. The 3-arg `clone_plan` defaults `p_include_board` to true, so any existing 2-arg-style call (there are none in the app after Phase 2, but external/manual callers) produces the current full-clone result. The migration drops the old 2-arg function first to avoid an ambiguous overload. No data migration; no rollback concern (prefer additive per the project's no-prod-data stance — a code rollback wouldn't need to unwind an applied migration since the default preserves prior behavior).

## References

- Research: `context/changes/clone-plan-without-board/research.md`
- Current live RPC: `supabase/migrations/20260711133933_clone_plan_carry_finishes_early.sql` (board blocks to gate at `:142-191`)
- Catalog-as-plan-owned + composite FKs: `supabase/migrations/20260611180006_plans_as_domain_root.sql`
- RPC wrapper + `refreshCatalogHash`: `src/_pages/plans-list/api/clone-plan.ts:16,22-45`
- Clone input schema: `src/_pages/plans-list/model/schemas.ts:14-17`
- Dialog insertion points: `src/_pages/plans-list/ui/ClonePlanDialog.tsx:49-52,66,100-102`
- Board cold-start behavior: `src/_pages/plan-detail/api/load.ts`; `src/_pages/plan-detail/model/grouping/palette-view.ts:15-25`
- Existing clone integration test (pattern to extend): `src/_pages/plans-list/api/clone-plan.integration.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database — guard the board in `clone_plan`

#### Automated

- [x] 1.1 Migration applies cleanly from scratch: `pnpm exec supabase db reset` — 2346be5
- [x] 1.2 Types regenerate with no hand edits and typecheck passes: `pnpm lint` — 2346be5
- [x] 1.3 Existing full-clone integration tests still pass: `pnpm test:integration` — 2346be5
- [x] 1.4 New catalog-only integration test passes: `pnpm test:integration` — 2346be5
- [x] 1.5 Build stays clean: `pnpm build` — 2346be5

#### Manual

- [x] 1.6 `pnpm exec supabase db diff` reports clean after reset — 2346be5
- [x] 1.7 `clone_plan(<src>, 'x', false)` in Studio yields a full catalog and zero board rows — 2346be5
- [x] 1.8 Named-param RPC call is unambiguous (no "function is not unique" error) — 2346be5

### Phase 2: App layer — thread the flag to the dialog

#### Automated

- [x] 2.1 Type checking + lint pass: `pnpm lint` — 7fb0420
- [x] 2.2 FSD boundaries intact: `pnpm steiger` — 7fb0420
- [x] 2.3 Unit suite passes: `pnpm test` — 7fb0420
- [x] 2.4 Build stays clean: `pnpm build` — 7fb0420

#### Manual

- [x] 2.5 Clone dialog shows the "Include board" toggle, default on — 7fb0420
- [x] 2.6 Toggle on → cloned plan opens on a warm board (unchanged) — 7fb0420
- [x] 2.7 Toggle off → cloned plan opens on `ComputeGroupingsEmptyState`; compute per cohort enumerates cleanly — 7fb0420
- [x] 2.8 Catalog fully present in the catalog-only clone (courses/colors/rules, teachers + availability, students + choices) — 7fb0420
- [x] 2.9 Dialog description accurately reflects what's omitted when the toggle is off — 7fb0420
