# Optional Subject in Bundle — Implementation Plan

## Overview

Add a durable per-member "optional" flag to bundle placements. Instead of removing a subject from an ungrouped bundle, the author can mark it optional — a temporary choice, visually distinct on every surface it renders, still counted as placed, later either **accepted** (flag cleared) or truly removed. Per-chip actions consolidate into a "⋯" overflow menu (Mark as optional / Accept / Remove), the inline remove "×" migrating into it. The toggle is a first-class recorded edit: undo/redo restores the flag, and it survives shelf park/unpark, whole-slot verbs, and plan cloning.

## Current State Analysis

All groundwork is mapped in `context/changes/optional-subject-in-bundle/research.md` (complete, all eight open questions decided with the author). The essentials:

- **The placement row is the universal grain.** Bundle membership lives only in `placements` (invariant stated in `supabase/migrations/20260626120001_shelve_bundle_fn.sql:7-8`); per-member state precedent is `placements.week` (`20260621130000_bi_weekly_week_columns.sql:21-22`) — the exact shape `is_optional` takes, end to end.
- **The `setWeek` chain is the verb template**: pure transitions (`placement-transitions.ts:200-210`) → writer (`board-writes.ts:320-339`) → plain column-update domain fn (`api/placements.ts:134-143`) → registered action (`api/placement-actions.ts`) → client wrapper → `rpcs.ts:26`.
- **History is operation-agnostic snapshot diffing** (`model/history/`): entries hold `{cohort, scope, target, label}`; undo diffs the live slice against the target by the placement business key `courseId|day|period|week`. That key is spelled in **two drifted places** — `placementBusinessKey` (`affected-slice.ts:37-38`, the documented "one home") and a private re-spelling in `reconcile.ts:30-31`. Without extending the key, an optional-toggle diffs to an empty plan and undo silently no-ops.
- **`PlacementSpec = PlacementKey`** (`history-entry.ts:46`): extending the key automatically extends the re-place path — `ReconcileDeps.place` forwards the spec at `use-reconcile-executor.ts:99-100` into `rpcs.placeCourse`.
- **`memberSetKey`** (`affected-slice.ts:41-45`, `${courseId}:${week}` per member) keys shelf-card diffing AND the reconcile shape recognizers via `memberWeekKey` (`reconcile-exec.ts:142-143`) — all must extend together or lift/place-back recognition breaks.
- **`CellOccupant` embeds the full `LocalPlacement`** (`entities/timetable/model/collision/cell-occupants.ts:15-23`), so once `PlannerPlacement` carries the flag, both the board chip (`PlacedChip.tsx`) and the read-only perspective chip (`ScheduleGrid.tsx:142-195`) read it directly — no view-model change.
- **`move_bundle_members` relocates rows via `UPDATE`** (`20260624120005`), so moves/merges carry the flag with zero SQL change. Only `place_course`, `shelve_bundle`, `unshelve_bundle`, `shelve_courses`, and `clone_plan` re-create rows and need replacing.
- **One shared select feeds all views**: `src/shared/api/load-placements.ts:11` loads placements for the board and both perspective pages; the shelf select is `plan-detail/api/load.ts:155`.
- **Per-chip remove today**: inline "×" gated on `!bundled` (`PlacedChip.tsx:111-126`, `data-slot="remove-placement"`). E2E `bundle-operations.spec.ts:103-113` asserts it by accessible name (`Remove <name>`) and asserts its absence while bundled.
- **Counter**: `deriveHours` counts placement rows (`entities/timetable/model/hours.ts:14-25`) — an optional member keeps its row, so the headline needs **zero** changes. The popover summary is assembled in `PlannerBoard.tsx:204-213` from per-cohort state (which includes `placements`) via `buildCoursesLeftSummary` (`ui/chrome/courses-left-summary.ts:37-45`).

## Desired End State

- An ungrouped bundle member exposes a "⋯" menu (where the remove "×" used to be) with **Mark as optional / Accept** (contextual) and **Remove**. The bundled chip surface is unchanged (name, collision badge, inline week A/B toggle).
- An optional member renders dashed + dimmed + tagged with a small "optional" cue — on the board, both perspective views, the parked-bundle card, and the group drag overlay — always composing *below* the blocking/warning collision tones.
- The toggle is undoable ("Mark optional at Mon · P3" / "Accept course at …" in the tooltip); undoing a remove of an optional member resurrects it *as optional*.
- The flag survives: move/merge, duplicate, shelf park/unpark, plan clone, page reload.
- The summary headline is unchanged; the courses-left popover gains an "Optional" section listing each course with optional placements and its count.
- Constraint validation is untouched: an optional member still collides and blocks exactly like any placement.

Verify: `/verify` green (check → lint → steiger → test → build), `pnpm test:integration`, `pnpm test:e2e`, plus the manual checks per phase.

### Key Discoveries:

- `PlacementKey` extension auto-threads the undo re-place path (`history-entry.ts:43-46` + `use-reconcile-executor.ts:99-100`)
- Required (non-optional) `isOptional` on `PlannerPlacement`/`ParkedMember` lets `pnpm check` mechanically find every construction site — the compiler enforces the threading
- `move_bundle_members` needs no change (UPDATE-based); `place_course` signature change needs DROP + CREATE (adding a parameter is a new overload, not a replacement)
- E2E realignment must land in the same phase as the menu migration or CI breaks between phases

## What We're NOT Doing

- **No constraint relaxation.** Optional members keep raising blocking violations; `src/entities/timetable/` collision core, `BoardContext`, drop hints — all untouched.
- **No counting change.** `hours.ts` and the headline "N hours left · M over" stay as-is; the popover section is additive UI.
- **No three-state enum.** `accepted` is just `is_optional = false` (today's normal state); boolean per the "let types encode invariants" lesson.
- **No same-cell attribute-flip reconcile recognizer.** Undoing a flag flip decomposes to remove+place at the same cell with id churn — precedented and accepted for `setWeek` (`history-entry.ts:42`); a single-update recognizer is a separable future improvement.
- **No optional affordance while bundled.** The menu gates on `!bundled` exactly like remove today (author decision #8).
- **No moving the week A/B toggle into the menu** — it must stay adjustable while bundled (`PlacedChip.tsx:98-110`).
- **No seed/fixture changes** — the seed carries no placements.

## Implementation Approach

Replicate the `week` column's end-to-end path for `is_optional`, in strict dependency order: schema + SQL functions first (behavior-neutral, default `false`), then thread the flag through every type/projection/key so the history and shelf machinery is *correct before the verb exists*, then ship the verb + menu UI + e2e realignment as one user-visible increment, and finish with the review surfaces (popover section, perspectives, shelf card, overlay). Phases 1–2 are deliberately invisible: every suite must stay green with the flag permanently `false`, proving neutrality before behavior lands.

## Critical Implementation Details

- **Ordering — key before verb.** The business-key extension (Phase 2) must land before `recordEdit` ever fires for an optional toggle (Phase 3); otherwise history accumulates dead entries that no-op on undo. Unify the drifted duplicate (`reconcile.ts:30-31` → import from `affected-slice.ts`) in the same commit as the extension — extending two copies independently is exactly how they'd silently disagree.
- **`place_course` signature.** `CREATE OR REPLACE` cannot add a parameter — it would create a second overload. The migration must `DROP FUNCTION place_course(uuid, public.cohort, uuid, smallint, smallint, public.placement_week)` and re-create with `p_is_optional boolean default false`. `unshelve_bundle`'s internal 6-arg call then resolves via the default; replace `unshelve_bundle` in the same migration so it passes the stored flag explicitly. Same drop-and-recreate applies to `shelve_courses` (new `p_optionals boolean[]`).
- **Chip visual composition.** The tone ladder resolves to exactly ONE bg/text class (`chipToneClass`, `PlacedChip.tsx:142-157`) and must stay on top. The optional axis composes beside it: `border-dashed` restyles the tone's border without recoloring it. Beware the opacity axis — `pending` (60), dragging (50), and lens-dim (40) already stack multiplicatively; keep any optional dimming light (or avoid opacity entirely) so a dimmed optional blocking chip still reads red. Semantic tokens only.
- **E2E coupling.** `bundle-operations.spec.ts:103-113` targets the inline remove by accessible name and asserts its absence while bundled. The menu migration and this realignment ship in the same phase (same PR/commit range) — there is no green intermediate state.

## Phase 1: Schema & SQL Functions

### Overview

Add the `is_optional` columns and update every SQL function that re-creates placement or shelf-member rows. Purely additive, default `false` — no client change, all suites stay green.

### Changes Required:

#### 1. Columns migration

**File**: `supabase/migrations/<ts>_optional_placement_columns.sql` (new)

**Intent**: Add the per-member flag to both homes of member state — board rows and parked twins.

**Contract**: `alter table public.placements add column is_optional boolean not null default false;` and the same on `public.shelf_bundle_courses`. Mirror the grant note from `20260621130000_bi_weekly_week_columns.sql` (additive columns inherit table grants).

#### 2. `place_course` + `unshelve_bundle` replacement

**File**: `supabase/migrations/<ts>_place_course_optional.sql` (new)

**Intent**: `place_course` accepts and persists the flag so group-add, duplicate, unshelve, and undo-replay can restore it; `unshelve_bundle` passes each parked member's stored flag through.

**Contract**: DROP the 6-parameter `place_course` and re-create with trailing `p_is_optional boolean default false`; the placements INSERT carries it, and the idempotent `on conflict … do update` also sets `is_optional = excluded.is_optional` so a replay converges on the requested state (the existing `bundle_id` no-op-update RETURNING trick already establishes the pattern). Re-create `unshelve_bundle` (current definition: `20260626120007`) selecting `is_optional` from `shelf_bundle_courses` and passing it as the 7th argument. Both stay SECURITY INVOKER + `set search_path = ''`.

#### 3. `shelve_bundle` replacement

**File**: `supabase/migrations/<ts>_shelve_bundle_optional.sql` (new)

**Intent**: Parking a bundle copies each member's flag into its shelf twin (decision #5: the flag survives park/unpark).

**Contract**: `CREATE OR REPLACE` (signature unchanged) of `shelve_bundle` (`20260626120001`); the step-2 membership copy adds `is_optional` to the column list and SELECT.

#### 4. `shelve_courses` replacement

**File**: `supabase/migrations/<ts>_shelve_courses_optional.sql` (new)

**Intent**: The direct park-a-course-set path (`parkMembers` verb) carries the flag too.

**Contract**: DROP the 4-parameter `shelve_courses` (`20260626120005`) and re-create with a third parallel array `p_optionals boolean[] default null`, coalesced per element to `false` (`unnest … with ordinality` + `coalesce(p_optionals[i], false)`) into `shelf_bundle_courses.is_optional`. The `default null` is load-bearing for Phase 1 neutrality: without it, regenerated types mark the arg required (`pnpm check` breaks) and PostgREST can no longer resolve the existing 4-arg RPC call (PGRST202) until the Phase 2 client change lands. Phase 2 #4 then always passes the array explicitly.

#### 5. `clone_plan` replacement

**File**: `supabase/migrations/<ts>_clone_plan_carry_optional.sql` (new)

**Intent**: A cloned plan preserves optional state — every prior placements-column addition shipped this paired carry migration (definition of done per repo history).

**Contract**: Full re-create mirroring `20260630162149_clone_plan_carry_color.sql`; sections 7 (placements INSERT, `:147-148`) and 11 (shelf_bundle_courses INSERT, `:181-182`) add `is_optional` to column list + SELECT.

#### 6. Regenerated database types

**File**: `src/shared/api/database.types.ts`

**Intent**: Surface the new columns and function signatures to TypeScript.

**Contract**: Regenerate against the reset local stack (`pnpm exec supabase gen types typescript --local`, matching the existing file's format); `placements.Row`/`Insert`/`Update`, `shelf_bundle_courses`, and the `place_course`/`shelve_courses` function arg types gain `is_optional`/`p_is_optional`/`p_optionals`.

### Success Criteria:

#### Automated Verification:

- Migrations apply from scratch: `pnpm exec supabase db reset` completes cleanly
- Type check passes after types regen: `pnpm check`
- Unit suite green (untouched): `pnpm test`
- Integration suite green with default-false flag: `pnpm test:integration`
- Build clean: `pnpm build`

#### Manual Verification:

- Smoke: place, group, move, shelve/unshelve, duplicate, and clone a plan — all behave exactly as before

---

## Phase 2: Flag Threading & History-Key Integrity

### Overview

Carry `isOptional` through every type, projection, select, place-path, and — critically — the placement business key and member-set keys, unifying the key's duplicated spelling. Still behavior-neutral: the flag is always `false`, every suite stays green, but undo/shelf machinery is now flag-correct.

### Changes Required:

#### 1. Domain types (compiler-enforced sweep)

**File**: `src/entities/timetable/model/placement.ts`, `src/_pages/plan-detail/model/placement/parked.ts`

**Intent**: `PlannerPlacement` and `ParkedMember` gain a **required** `isOptional: boolean`, so `pnpm check` finds every construction site — nothing threads silently.

**Contract**: `PlannerPlacement.isOptional: boolean` (doc comment: durable "temporary choice" marker; render-only for validation). `ParkedMember` gains the same field beside `week`.

#### 2. Row projection & inputs

**File**: `src/_pages/plan-detail/api/placements.ts`, `src/_pages/plan-detail/api/placement-client.ts`

**Intent**: The server row projection and the place input carry the flag.

**Contract**: `PlacementRow.is_optional: boolean`; `toPlannerPlacement` maps it; `placeCourseInput` gains `isOptional: z.boolean().default(false)`; `placeCourse` passes `p_is_optional`; the `placeCourse` client wrapper's inline args type (`placement-client.ts:7-16`) gains `isOptional`. (`updatePlacementWeek` untouched.)

#### 3. Selects & loaders

**File**: `src/shared/api/load-placements.ts`, `src/_pages/plan-detail/api/load.ts`, `src/_pages/student-plan-view/api/loader.ts`, `src/_pages/teacher-plan-view/api/loader.ts`

**Intent**: Both the shared placements select (board + both perspectives) and the shelf select load the flag — and every row→`PlannerPlacement` mapper carries it.

**Contract**: `load-placements.ts:11` select list adds `is_optional`; `load.ts:155` shelf select becomes `shelf_bundle_courses(course_id, week, is_optional)` with the row type at `:194` and member mapping at `:198` extended. The perspective loaders carry **private duplicate** `toPlannerPlacement` mappers (`student-plan-view/api/loader.ts:206-220`, `teacher-plan-view/api/loader.ts:174-188`) — both must map `isOptional: row.is_optional`, NOT a `false` default silencing the compile error; Phase 4 #2's "data already flows" claim depends on it.

#### 4. Shelf client zip

**File**: `src/_pages/plan-detail/api/shelf.ts`, `src/_pages/plan-detail/api/shelf-client.ts` (and the shelf action input as applicable)

**Intent**: `shelveCourses` zips the third parallel array from `ParkedMember[]`.

**Contract**: The domain fn/input carries `p_optionals boolean[]` alongside `p_course_ids`/`p_weeks`, derived from `members[].isOptional`. `rpcs.ts` needs no signature change (it already passes `members`).

#### 5. Optimistic construction sites & place fan-outs

**File**: `src/_pages/plan-detail/model/placement/placement-transitions.ts`, `src/_pages/plan-detail/model/placement/board-writes.ts`, `src/_pages/plan-detail/api/rpcs.ts`

**Intent**: New optimistic rows default `isOptional: false`; batch entries carry it; duplicate mirrors the source flags the same way it mirrors weeks.

**Contract**: `addOptimistic`/`addManyOptimistic` set `isOptional` on created rows; `BatchEntry` gains `isOptional`; `persistAddGroup` resolves it per member (explicit map from `duplicateBundle` — built beside `weekByMember` at `board-writes.ts:132` — else `false`) and `persistMember`/`rpcs.placeCourse` args forward it. Whole-slot move/remove paths spread existing rows and need no change.

#### 6. Business key extension + unification (the load-bearing step)

**File**: `src/_pages/plan-detail/model/history/history-entry.ts`, `affected-slice.ts`, `reconcile.ts`, `reconcile-exec.ts`

**Intent**: The placement business key and member-set keys include the flag, spelled in exactly one home — otherwise an optional toggle diffs to an empty plan and undo no-ops, and shelf/lift recognition desyncs.

**Contract**:
- `PlacementKey` (`history-entry.ts:43`) gains `isOptional: boolean` (this auto-extends `PlacementSpec`).
- `placementBusinessKey` (`affected-slice.ts:37-38`) becomes `${courseId}|${day}|${period}|${week}|${isOptional}`.
- `reconcile.ts` **deletes** its private `placementKey` re-spelling (`:30-31`) and imports `placementBusinessKey`; `toPlacementKey` (`:33-38`) carries `isOptional`.
- `sliceAt`'s local `toPlannerPlacement` (`affected-slice.ts:23-30`) carries `isOptional` so before/forward snapshots capture it.
- `memberSetKey` (`affected-slice.ts:41-45`) encodes `${courseId}:${week}:${isOptional}`; `memberWeekKey` (`reconcile-exec.ts:142-143`) maps rows including `isOptional` so relocation/lift/place-back recognizers keep matching.
- `use-reconcile-executor.ts:99-100`: `place` forwards `isOptional: spec.isOptional`.

#### 7. Test factory & suites

**File**: `src/test/factories/place-course.ts`, `src/entities/timetable/model/__fixtures__/builders.ts`, existing unit/integration tests across `model/history/`, `model/placement/`, `ui/chrome/`

**Intent**: The factory accepts an optional `isOptional` (default `false`); test fixtures updated mechanically where the required field now demands it.

**Contract**: The shared `placement()` fixture builder (`builders.ts:46-52`) defaults `isOptional: false`. No behavioral assertions change in this phase; new key-shape assertions (flag flips produce non-empty reconcile plans; flag included in `memberSetKey`) are added to `affected-slice`/`reconcile` unit tests. Note: `reconcile.test.ts:22` and `api/reconcile.integration.test.ts:35` re-spell the 4-part business key inline and will fail when the key gains the flag — realigning them is planned work in this phase, not a regression.

### Success Criteria:

#### Automated Verification:

- Type check passes (the sweep is complete): `pnpm check`
- Unit suite green incl. extended key tests: `pnpm test`
- Integration suite green: `pnpm test:integration`
- Lint + FSD boundaries: `pnpm lint && pnpm steiger`
- Build clean: `pnpm build`

#### Manual Verification:

- Smoke: undo/redo of move/remove/shelve flows works exactly as before (key extension caused no regressions)

---

## Phase 3: The Verb + Board Chip UI + E2E Realignment

### Overview

Ship the user-visible feature: the `setOptional` verb (setWeek-isomorphic, undoable with `markOptional`/`acceptOptional` labels), the per-chip "⋯" overflow menu absorbing the remove action, the optional visual axis on the board chip, and the realigned `bundle-operations` e2e.

### Changes Required:

#### 1. Pure transitions

**File**: `src/_pages/plan-detail/model/placement/placement-transitions.ts`

**Intent**: The optimistic trio for the flag flip, mirroring `setWeek*` (`:200-210`).

**Contract**: `setOptionalOptimistic(prev, id, isOptional)` / `setOptionalReconcile(prev, id, updated)` / `setOptionalRollback(prev, id, prevValue)`.

#### 2. Domain fn + action + client

**File**: `src/_pages/plan-detail/api/placements.ts`, `placement-actions.ts`, `placement-client.ts`, `rpcs.ts`

**Intent**: A plain column update, `updatePlacementWeek`-shaped, registered as a new Astro Action.

**Contract**: `updatePlacementOptionalInput = { id: z.uuid(), isOptional: z.boolean() }`; `updatePlacementOptional` updates `is_optional` by id via `unwrapRow` and returns the projected row; registered in `placementActions`; client wrapper + `rpcs.updatePlacementOptional(id, isOptional)`.

#### 3. History labels

**File**: `src/_pages/plan-detail/model/history/history-label.ts`

**Intent**: Two edit kinds so the undo tooltip names the direction (decision #7).

**Contract**: `EditKind` gains `"markOptional" | "acceptOptional"`; labels `Mark optional${where}` / `Accept course${where}`.

#### 4. Writer

**File**: `src/_pages/plan-detail/model/placement/board-writes.ts`

**Intent**: `persistSetOptional` mirrors `persistSetWeek` (`:320-339`): guard (missing/pending/no-op), snapshot scope, optimistic set, RPC, reconcile, `recordEdit` with the direction-appropriate kind, rollback on failure.

**Contract**: `BoardWrites.setOptional(placementId, isOptional)`; records `markOptional` when setting `true`, `acceptOptional` when clearing.

#### 5. Board-state + wiring

**File**: `src/_pages/plan-detail/model/use-cohort-board-state.ts`, `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Expose the verb as a cohort action and thread it into the chip wiring.

**Contract**: `actions.setOptional` beside `setWeek` (`use-cohort-board-state.ts:261`); `buildColumn` wiring gains `onSetOptional: state.actions.setOptional` (`PlannerBoard.tsx:157-182`); `ChipWiring` (`PlacedChip.tsx:17-30`) gains `onSetOptional`.

#### 6. Chip overflow menu

**File**: `src/_pages/plan-detail/ui/grid/slot-cell/ChipMenu.tsx` (new), `PlacedChip.tsx`

**Intent**: Consolidate per-member verbs into one "⋯" trigger (author's design, decision #7): **Mark as optional / Accept** (contextual on `placement.isOptional`) and **Remove** — the inline "×" is removed. Gated `!bundled` like remove today; disabled while `pending`. Week A/B toggle stays inline untouched.

**Contract**: Uses the shared `DropdownMenu` primitives (`src/shared/ui/dropdown-menu.tsx`, catalog row-actions "⋯" precedent in `CourseTable`/`TeacherTable`/`StudentTable`). Trigger carries a stable `data-slot="chip-menu"` and accessible name including the course (e.g. `Actions for ${name}`); the Remove item keeps the accessible name `Remove ${name}`. All interactive elements wrapped drag-inert (`stopDrag`, as the current "×" does), **and the chip's `useDraggable` is disabled while the menu is open** (menu open-state lives in the chip) — this is a first-in-codebase combination (a portal-rendered Radix menu inside a dnd-kit draggable; the catalog "⋯" precedents are static tables outside the dnd tree), and `stopDrag` on the trigger alone does not guard against dragging the chip while its menu is open (orphaned anchored menu, flaky e2e). The retired `data-slot="remove-placement"` button is deleted.

#### 7. Optional visual axis on the board chip

**File**: `src/_pages/plan-detail/ui/grid/slot-cell/PlacedChip.tsx`

**Intent**: Decision: dashed + dim + badge. The chip reads "not quite real" at a glance without ever masking collision state.

**Contract**: When `placement.isOptional`: `border-dashed` (composes with the tone's border color), a light dim that does not fight the pending/drag/lens opacity stack (see Critical Implementation Details), and a small "optional" text cue (badge-style, token-based, ghost grammar precedent `WeekLane.tsx:22-28`). Root element exposes `data-optional` for tests. Tone ladder (`chipToneClass`) untouched and always on top.

#### 8. E2E realignment

**File**: `e2e/specs/bundle-operations.spec.ts`, `e2e/support/board.ts`

**Intent**: The per-chip remove flow now goes through the menu; the bundled-gate assertion moves to the menu trigger.

**Contract**: A `board.ts` helper opens a chip's menu and clicks an item; the `:103-113` assertions become: bundled → menu trigger absent/count 0; ungrouped → open menu → `Remove <name>` visible and clickable. No other spec targets the inline remove.

#### 9. Tests

**File**: `placement-transitions.test.ts`, `board-writes.test.ts`, `api/placements.integration.test.ts`, `api/reconcile.integration.test.ts` (extend each in place)

**Intent**: The trio, the writer (optimistic → RPC → recordEdit kind by direction → rollback), the column update round-trip, and the two undo guarantees: undoing a mark restores `false`; undoing a **remove** of an optional member re-places it *as optional*.

**Contract**: Mirror the existing `setWeek` test blocks; the reconcile integration test builds state via `src/test/factories/`.

### Success Criteria:

#### Automated Verification:

- Type check: `pnpm check`
- Unit suite incl. new trio/writer tests: `pnpm test`
- Integration suite incl. optional round-trip + undo-restores-flag: `pnpm test:integration`
- E2E suite green with realigned bundle-operations: `pnpm test:e2e`
- Lint + steiger + build: `pnpm lint && pnpm steiger && pnpm build`

#### Manual Verification:

- Ungroup a bundle → "⋯" on each chip → Mark as optional: chip turns dashed/dimmed/tagged; Accept restores it; Remove still works from the menu
- While bundled: no "⋯" trigger; week A/B toggle still adjustable on bi-weekly chips
- Undo/redo walks the mark → accept → remove sequence correctly (tooltip labels name each step); undo of a remove resurrects the chip as optional
- A collision on an optional chip still reads red/amber (dashes don't mask it); drag still works — and the chip does not drag while its menu is open; reload preserves the flag
- Headline counter unchanged when marking optional (still counted as placed)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 4.

---

## Phase 4: Review Surfaces + New E2E Scenario

### Overview

Surface the flag everywhere the author reviews pending decisions: the popover "Optional" section, the read-only perspective chips, the parked-bundle card, and the drag overlay — plus one new browser-level scenario protecting the core flow.

### Changes Required:

#### 1. Summary derivation + popover section

**File**: `src/_pages/plan-detail/ui/chrome/courses-left-summary.ts`, `CoursesLeftPopover.tsx`, `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Decision #2 + popover shape decision: headline untouched; the popover gains an "Optional" section — one row per course having optional placements, name + count — a review checklist of pending decisions.

**Contract**: `CohortInput` gains the cohort's `placements` (already on state, `PlannerBoard.tsx:204-213` passes it); the summary derives per-cohort `optional` rows `{courseId, name, color, count}` as a declarative filter/group over `isOptional` placements (display-resolved and sorted at the UI edge like the existing sections — count desc, name asc). `CoursesLeftSummary` gains an `optionalCount` total for the section subtitle. The popover renders the section (existing `Section` grammar; rows show `name · N optional` — no `HoursCounter`) only when count > 0. `hours.ts` untouched.

#### 2. Perspective chip mirror

**File**: `src/widgets/timetable-board/ui/ScheduleGrid.tsx`

**Intent**: Decision #6: students/teachers see the same optional treatment (data already flows — the shared select and `CellOccupant.placement` carry the flag from Phase 2).

**Contract**: The presentational `Chip` (`:142-195`) applies the same composable axis — dashed border + dim + small "optional" cue (inline text like the existing week label at `:171-173` is acceptable) — below its tone ladder; `data-optional` attribute mirrors the board chip.

#### 3. Parked-bundle card cue

**File**: `src/_pages/plan-detail/ui/shelf/ParkedBundleCard.tsx`

**Intent**: The flag survives parking (Phase 1), so the shelf shows it — no invisible state where temporary choices accumulate.

**Contract**: Per-member row gains an optional cue following the `WeekTag` pattern (`:96-101`) — dashed/dimmed member row styling plus a small "optional" tag; tokens only.

#### 4. Drag overlay cue

**File**: `src/_pages/plan-detail/ui/overlay/GroupDragOverlay.tsx`

**Intent**: A dragged bundle keeps its optional cues (surfaces decision: all member-rendering surfaces).

**Contract**: `OverlayCard` member items accept `{courseId, isOptional}` instead of bare ids — the `bundle` branch derives from cell placements (`:47-50`), the `parked` branch from members (`:53-55`), the `grouping` branch passes `false`; optional rows get the dashed+dim treatment.

#### 5. New e2e scenario

**File**: `e2e/specs/optional-subject.spec.ts` (new)

**Intent**: One browser-level guard for the flagship flow (test-scope decision: realign + 1 scenario).

**Contract**: Place a grouping → ungroup → mark one member optional via the menu → assert `data-optional` on the chip and the popover "Optional" section row/count → accept via the menu → assert both clear. Reuses `e2e/support/board.ts` helpers incl. the Phase-3 menu helper.

#### 6. Unit tests

**File**: `src/_pages/plan-detail/ui/chrome/courses-left-summary.test.ts` (extend)

**Intent**: The derivation: filtering, grouping, counting, sorting, and the zero-state (no section data when nothing is optional).

**Contract**: Pure-function tests beside the existing summary tests.

### Success Criteria:

#### Automated Verification:

- Type check: `pnpm check`
- Unit suite incl. summary derivation tests: `pnpm test`
- Integration suite: `pnpm test:integration`
- E2E incl. the new optional-subject scenario: `pnpm test:e2e`
- Full local CI gate: `/verify` (or `pnpm lint && pnpm steiger && pnpm test && pnpm build`)

#### Manual Verification:

- Popover shows "Optional" section with correct per-course counts; disappears when all accepted/removed
- Student and teacher perspective views render optional chips visually distinct
- Park a bundle containing an optional member → card shows the cue → unpark → chip returns as optional
- Drag a bundle with an optional member → overlay shows the cue
- Duplicate a bundle with an optional member → the copy carries the flag; clone the plan → clone carries it

---

## Testing Strategy

### Unit Tests:

- `placement-transitions`: `setOptional` trio (optimistic/reconcile/rollback), `BatchEntry.isOptional` defaults
- `board-writes`: `persistSetOptional` sequencing, `markOptional`/`acceptOptional` recorded by direction, duplicate mirrors source flags
- `history`: extended `placementBusinessKey` (flag flip ⇒ non-empty reconcile plan), unified single spelling, `memberSetKey`/`memberWeekKey` include the flag, recognizers still match relocation/lift/place-back
- `courses-left-summary`: optional rows derivation + zero-state

### Integration Tests:

- `updatePlacementOptional` round-trip (place → mark → reload projection shows flag)
- Undo/redo: mark is undoable; undoing a remove of an optional member restores `is_optional = true`
- Shelf: shelve → shelf twin carries flag → unshelve → placement carries flag (`shelve_courses` path too)
- `clone_plan` carries `is_optional` on placements + shelf members

### Manual Testing Steps:

1. Ungroup a 3-member bundle; mark one optional via "⋯"; verify dashed/dim/badge and that the cell still drags as a unit when regrouped
2. Force a teacher conflict on the optional chip; verify red tone dominates the optional treatment
3. Walk undo history backwards through remove → accept → mark; verify each tooltip label and the flag state at every step
4. Park, reload, unpark; verify flag survives; check the shelf card cue mid-way
5. Open student + teacher views for an affected course; verify the distinct rendering and unchanged layout/print viability

## Performance Considerations

None expected. A flag flip is a new placements array — memoized derivations recompute exactly as an add/remove does today; the perf guard (`collisions.perf.test.ts:52-75`, ≤200ms p95 budget) is untouched and must stay green.

## Migration Notes

All schema changes are additive (`boolean not null default false`) — no backfill, no `DROP` of columns; existing rows read as non-optional. Function signature changes (`place_course`, `shelve_courses`) use DROP + CREATE inside their migrations, and both new parameters carry defaults (`p_is_optional boolean default false`, `p_optionals boolean[] default null`) so pre-Phase-2 clients keep resolving; `shelve_bundle`/`unshelve_bundle`/`clone_plan` are same-signature re-creates. Hosted rollout is the normal CI path (`supabase db push` on merge); a code rollback without the migrations is safe because clients never read `is_optional` until Phase 2 ships.

## References

- Related research: `context/changes/optional-subject-in-bundle/research.md` (incl. two decision follow-ups, 2026-07-07)
- Verb template: `src/_pages/plan-detail/model/placement/board-writes.ts:320-339` (`persistSetWeek`)
- Column precedent: `supabase/migrations/20260621130000_bi_weekly_week_columns.sql`
- Clone-carry precedent: `supabase/migrations/20260630162149_clone_plan_carry_color.sql`
- Business key home: `src/_pages/plan-detail/model/history/affected-slice.ts:37-38`
- Bundle model history: `context/archive/2026-06-23-first-class-bundle-operations/`
- Counter invariant: `context/archive/2026-07-01-courses-left-info/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schema & SQL Functions

#### Automated

- [x] 1.1 Migrations apply from scratch: `pnpm exec supabase db reset` completes cleanly — cd5cf6d
- [x] 1.2 Type check passes after types regen: `pnpm check` — cd5cf6d
- [x] 1.3 Unit suite green (untouched): `pnpm test` — cd5cf6d
- [x] 1.4 Integration suite green with default-false flag: `pnpm test:integration` — cd5cf6d
- [x] 1.5 Build clean: `pnpm build` — cd5cf6d

#### Manual

- [x] 1.6 Smoke: place, group, move, shelve/unshelve, duplicate, clone — all behave exactly as before (verified via full Playwright e2e suite, 27 specs green, + clone integration test) — cd5cf6d

### Phase 2: Flag Threading & History-Key Integrity

#### Automated

- [x] 2.1 Type check passes (the sweep is complete): `pnpm check` — 8c839a4
- [x] 2.2 Unit suite green incl. extended key tests: `pnpm test` — 8c839a4
- [x] 2.3 Integration suite green: `pnpm test:integration` — 8c839a4
- [x] 2.4 Lint + FSD boundaries: `pnpm lint && pnpm steiger` — 8c839a4
- [x] 2.5 Build clean: `pnpm build` — 8c839a4

#### Manual

- [x] 2.6 Smoke: undo/redo of move/remove/shelve flows works exactly as before (verified via full Playwright e2e suite, 27 specs green incl. undo-redo + shelf-durability) — 8c839a4

### Phase 3: The Verb + Board Chip UI + E2E Realignment

#### Automated

- [x] 3.1 Type check: `pnpm check`
- [x] 3.2 Unit suite incl. new trio/writer tests: `pnpm test`
- [x] 3.3 Integration suite incl. optional round-trip + undo-restores-flag: `pnpm test:integration`
- [x] 3.4 E2E suite green with realigned bundle-operations: `pnpm test:e2e`
- [x] 3.5 Lint + steiger + build: `pnpm lint && pnpm steiger && pnpm build`

#### Manual

- [x] 3.6 Mark/Accept/Remove via "⋯" menu work; optional chip reads dashed/dimmed/tagged (verified live via Playwright MCP on workerd preview)
- [x] 3.7 Bundled: no menu trigger; week toggle still inline-adjustable (verified live: 0 triggers while bundled; WeekToggle path untouched)
- [x] 3.8 Undo/redo walks mark → accept → remove with correct labels; undo of remove resurrects as optional (labels + undo-of-accept verified live; remove-resurrects pinned by reconcile integration test)
- [x] 3.9 Collision tone dominates optional treatment; drag works (chip inert while menu open); reload preserves flag (tone ladder untouched + on top; reload verified live)
- [x] 3.10 Headline counter unchanged when marking optional (verified live: "3 hours left to place" before/after)

### Phase 4: Review Surfaces + New E2E Scenario

#### Automated

- [ ] 4.1 Type check: `pnpm check`
- [ ] 4.2 Unit suite incl. summary derivation tests: `pnpm test`
- [ ] 4.3 Integration suite: `pnpm test:integration`
- [ ] 4.4 E2E incl. the new optional-subject scenario: `pnpm test:e2e`
- [ ] 4.5 Full local CI gate: `/verify`

#### Manual

- [ ] 4.6 Popover "Optional" section shows correct counts; disappears when none
- [ ] 4.7 Student + teacher perspectives render optional chips distinctly
- [ ] 4.8 Park → card cue → unpark → flag survives
- [ ] 4.9 Drag overlay shows optional cue
- [ ] 4.10 Duplicate + clone carry the flag
