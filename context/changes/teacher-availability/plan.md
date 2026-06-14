# Teacher Availability Implementation Plan

## Overview

Add **teacher availability** — the planned S-03 follow-up — letting a plan author mark, per teacher, which `(day, period)` cells a teacher **cannot** teach (**strong NO**) or **prefers not to** teach (**soft NO**). Strong NO becomes a new hard violation class that flags the cell/plan invalid (the drop still lands — accept-and-flag is preserved). Soft NO introduces a non-blocking **`warn`** tier — a genuinely new concept in a validation core that is binary top-to-bottom today. Authoring lives in the teachers catalog as an optimistic per-cell day×period grid.

Availability is **plan-scoped and cohort-independent**: it reflects a teacher's real-world schedule on the plan's shared timetable grid, so it is stored once per teacher and applies to whatever cohort the board renders.

## Current State Analysis

**No availability data or feature code exists today.** The architecture, however, was explicitly built to anticipate it:

- **Persistence has a perfect template.** `slot_bundles` (`supabase/migrations/20260613123404_slot_bundles.sql`) is a plan-scoped marker table with a `cohort` enum, day/period CHECKs, per-cell uniqueness, a plan index, and an open authenticated RLS policy. The composite-FK target on teachers — `teachers_plan_id_unique unique (plan_id, id)` (`20260612090000_courses_teacher_composite_fk.sql:10`) — **already exists**, so no prerequisite migration is needed. `clone_plan` (`20260613123405_clone_plan_with_slot_bundles.sql`) already builds a `_teacher_map` (`:48-49`, dropped `:134`) and copies teachers via it (`:60-64`).

- **The constraint core is an open-closed seam built for this.** `BoardContext` (`src/_pages/plan-detail/model/constraints/types.ts:17-20`) literally names "teacher availability" as the intended additive extension (`:12-16`). A board-only constraint that **omits `test?`** (`types.ts:27-29`) is structurally excluded from grouping enumeration — confirmed: `enumerate.ts` → `hasIntersection` → `violatesAny` → `test?` only; `explain`/`BoardContext` never reach the combinatorial path. **No existing constraint reads `ctx` today** — availability is the first consumer of `BoardContext`.

- **Severity does not exist.** `CollisionViolation` (`types.ts:7-10`) is a 3-member union with no severity field. `CellCollisions` (`collisions.ts:9-14`) carries a single flat `conflictingIds: Set<string>` built by `collectCourseIds` (`collisions.ts:62-69`). `DropHint` (`drop-hints.ts:12`) is `"partial" | "blocked"`. The board runs **accept-and-flag** (PRD Q8): `handleDrop` (`PlannerBoard.tsx:69-91`) has **no validation gate** — drops always land; invalidity is a downstream reactive derivation via `useCollisions` → `deriveCellViolations`.

- **`GroupingCourse`** is `{ id, teacherKey, studentKeys, hours }` (`src/shared/lib/catalog-hash/types.ts:8`) — `teacherKey` equals the DB `teacher_id`. It carries no availability data; availability is a new board input, not a field on the occupant.

- **The board is dp1-only by data, not logic.** `BOARD_COHORT = "dp1"` (`load.ts:16`) only drives `.eq("cohort", …)` query filters. The constraint logic (`teacher-conflict.ts`, `student-conflict.ts`) is cohort-agnostic — it never reads cohort/cell. This is why cohort-independent availability "just works" when dp2 loads (S-09).

- **Theme has no `warning` token.** `global.css` defines `--destructive` (+foreground) and a single `--valid` token in three places (`:root` `:25`, `.dark` `:62`, `@theme inline` `:103`). There is no amber/`warning` token.

- **FSD blocks helper reuse.** The authoring grid wants `GRID_BOUNDS`/`parseGridPreset` (`plan-detail/model/grid.ts`) and `dayLabel`/`periodLabel` (`plan-detail/lib/slot-labels.ts`), but the teachers slice cannot import from another `_pages` slice (steiger `--fail-on-warnings`). Both helpers must be promoted to `shared/` (5 import sites to repoint, no logic change).

## Desired End State

A plan author can open **Edit availability** on any teacher and paint a tri-state day×period grid (available → soft → strong, click-cycling) with whole-day bulk via the day-column header; edits persist optimistically and survive reload and plan-clone. On the board, dropping a course whose teacher is **strong-unavailable** at the target cell flags the cell with the destructive ring + a distinguished "unavailable" badge, counts the cell/plan invalid, but the drop lands. A **soft-unavailable** placement shows an amber (`warning`) ring/chip/badge, is inspectable in the details dialog, but never blocks. While dragging, cells light up `blocked` (strong) or `warn` (soft) for the dragged course's teacher. The <200ms drag budget is unaffected (availability stays out of enumeration).

**Verification:** all of `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` pass; `pnpm exec supabase db reset` applies cleanly and `supabase gen types` reports no diff; manual board + authoring flows behave as above.

### Key Discoveries:

- Composite FK target on teachers already exists — no prerequisite migration (`20260612090000_courses_teacher_composite_fk.sql:10`).
- Board-only constraint (omit `test?`) is auto-excluded from the <200ms enumeration path (`enumerate.ts`, `collision.ts:7-9`).
- Drag hints are NOT free for board-only constraints — `classifyCell` uses `violatesAny` (`test?`) only (`drop-hints.ts:114-130`); the BoardContext rewiring of `deriveDropHints` is shared by strong + soft.
- `CollisionDetailsDialog`'s `ViolationsByKind` is an exhaustive mapped type (`:163-181`) — a new union kind won't compile until a section + initializer key + switch arm are added.
- `HINT_CLASS` is a non-optional `Record<HintMode, Record<DropHint | "free", string>>` (`SlotCell.tsx:258-269`) — widening `DropHint` forces a `warn` column in both modes.
- Action registration is automatic: a new entry in `teacherActions` surfaces as `actions.<name>` (spread at `src/actions/index.ts:5,9`).

## What We're NOT Doing

- **No `cohort` column on availability** — it is cohort-independent (the user-confirmed model). Per-cohort availability differences are out of scope.
- **No dp2 authoring/validation surface** — the board is dp1-only; cohort-independent storage means dp2 rides the existing cohort-switch work later with zero schema change.
- **No cross-cohort occupancy constraint** (a teacher double-booked at the same cell across cohorts) — that is separate S-09 work, listed alongside availability in `types.ts:13`.
- **No physical drop rejection** for strong NO — accept-and-flag is preserved (flag-as-invalid, drop lands).
- **No plan-level soft-warning roll-up panel** — soft NO surfaces via cell + chip + the existing details dialog only.
- **No "both layers on one cell"** — tri-state: a cell is exactly one of available/soft/strong.
- **No availability participation in grouping enumeration** — board-only, omit `test?`.
- **No seed fixture** — the table ships empty (no `data/dp1`/`data/dp2` source; no `gen-seed.mjs` change).

## Implementation Approach

Build foundations first (migration + FSD promotion — both behavior-neutral), then the authoring UI (so availability data exists and is editable before any validator consumes it), then the cheap strong-NO board constraint (reusing the existing collision flow + the shared drag-hint rewiring), and finally the disruptive soft-NO `warn` tier (designed once, on top of the severity-aware types introduced in Phase 3). Keep two vocabularies distinct: **storage severity** (`strong`/`soft`) at the DB/authoring edge, **violation severity** (`block`/`warn`) in the validation/render core, mapped where the validator reads availability.

## Critical Implementation Details

- **Drag-hint precedence.** When threading availability into `deriveDropHints`/`classifyCell`, the per-cell hint priority must be `blocked > partial > warn > free`: soft NO is advisory and only surfaces (`warn`) on a cell that would otherwise be free; any hard non-fit (occupant collision or strong NO) dominates. This keeps soft NO from ever masking a real block.
- **Ordering in `clone_plan`.** The availability copy block must sit **after** the teachers insert (`…405:60-64`, so remapped teacher rows exist) and **before** the `_teacher_map` drop (`…405:134`). Model it on the teacher/course join blocks (teacher-keyed remap), NOT the coordinate-copy `slot_bundles` block.
- **Storage→render severity mapping happens in the constraint only.** The DB/authoring layer never knows `block`/`warn`; the board constraint maps `strong → block`, `soft → warn` when it builds violations. Phase 3 emits `block` only; Phase 4 starts emitting `warn`.

---

## Phase 1: Foundations (persistence + FSD promotion)

### Overview

Two independent, behavior-neutral workstreams that unblock everything downstream: the `teacher_availability` table (+ clone + types + seed + severity config) plus the additive `--warning` theme token, and the promotion of grid/label helpers to `shared/`. No user-visible behavior changes.

### Changes Required:

#### 1. Availability migration

**File**: `supabase/migrations/<ts>_teacher_availability.sql`

**Intent**: Create the plan-scoped, cohort-independent availability marker table and its storage-severity enum, mirroring the `slot_bundles` pattern minus the cohort column.

**Contract**: New native enum `availability_severity('strong','soft')`; table `teacher_availability` with `id`, `plan_id` (FK→`plans` cascade), `teacher_id`, `day`, `period`, `severity`, `created_at`; composite FK `(plan_id, teacher_id) → teachers(plan_id, id)` cascade; unique `(plan_id, teacher_id, day, period)`; day/period range CHECKs; plan + `(plan_id, teacher_id)` indexes; RLS enabled with the standard `"Authenticated users have full access"` policy. No `updated_at` (replace-by-coordinate). DDL (non-obvious because it omits the template's cohort column and uses a composite teacher FK):

```sql
create type availability_severity as enum ('strong', 'soft');

create table teacher_availability (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references plans(id) on delete cascade,
  teacher_id uuid not null,
  day        smallint not null,
  period     smallint not null,
  severity   availability_severity not null,
  created_at timestamptz not null default now(),
  constraint teacher_availability_unique unique (plan_id, teacher_id, day, period),
  constraint teacher_availability_teacher_fkey
    foreign key (plan_id, teacher_id) references teachers (plan_id, id) on delete cascade,
  constraint teacher_availability_day_range    check (day between 1 and 7),
  constraint teacher_availability_period_range check (period between 1 and 12)
);

create index teacher_availability_plan_idx on teacher_availability (plan_id);
create index teacher_availability_plan_teacher_idx on teacher_availability (plan_id, teacher_id);

alter table teacher_availability enable row level security;
create policy "Authenticated users have full access" on teacher_availability
  for all to authenticated using (true) with check (true);
```

#### 2. Extend `clone_plan` with the availability copy

**File**: `supabase/migrations/<ts>_clone_plan_with_teacher_availability.sql`

**Intent**: Carry availability across plan clones, remapping `teacher_id` through the existing `_teacher_map`.

**Contract**: New `create or replace function clone_plan(...)` migration copying the current body forward verbatim (the established never-edit-the-old-file convention) plus one teacher-keyed insert placed after the teachers block and before the map drops. Insert: `teacher_availability (plan_id, teacher_id, day, period, severity)` selecting `v_new_plan_id, tm.new_id, a.day, a.period, a.severity` joined `pg_temp._teacher_map tm on tm.old_id = a.teacher_id` where `a.plan_id = p_source_plan_id`. (`id` omitted → fresh UUID; composite FK makes a missed remap fail loudly.)

#### 3. Regenerate DB types

**File**: `src/shared/api/database.types.ts`

**Intent**: Emit the `teacher_availability` Row/Insert/Update types and the `availability_severity` enum union via `supabase gen types`.

**Contract**: Regenerated artifact (do not hand-edit) — must include the new table and enum; `clone_plan` signature unchanged.

#### 4. Storage-severity config single-source

**File**: `src/shared/config/availability-severity.ts` (+ barrel export in `src/shared/config/index.ts`)

**Intent**: Single-source the `strong`/`soft` values + a zod schema, mirroring the cohort enum precedent (`src/shared/config/cohorts.ts:10`).

**Contract**: Exported `AVAILABILITY_SEVERITY_VALUES` tuple, `AvailabilitySeverity` type, and `availabilitySeveritySchema` (zod enum). Reused by the authoring schema (Phase 2) and the validator's storage→render mapping (Phase 3).

#### 5. Promote grid helpers to `shared/`

**File**: move `src/_pages/plan-detail/model/grid.ts` → `src/shared/lib/grid/` (or `src/shared/config/grid`, pairing with `grid-presets.ts`), add barrel export.

**Intent**: Make `GRID_BOUNDS`, `parseGridPreset`, `GridDimensions`, `DEFAULT_GRID` importable by the teachers slice without crossing `_pages` slices.

**Contract**: Same exports, new `@/shared/...` path. Repoint 3 importers: `plan-detail/api/load.ts:8`, `plan-detail/api/placements.ts:2`, `plan-detail/api/slot-bundles.ts:2`. (`grid.ts` already imports only from `@/shared/config`, so the move is dependency-clean.)

#### 6. Promote slot-label helpers to `shared/`

**File**: move `src/_pages/plan-detail/lib/slot-labels.ts` → `src/shared/lib/slot-labels/` (folder+index, mirroring `shared/lib/course-label`).

**Intent**: Make `dayLabel`/`periodLabel` importable by the authoring grid headers.

**Contract**: Same exports, new path. Repoint 2 importers: `plan-detail/ui/CollisionDetailsDialog.tsx:4`, `plan-detail/ui/PlannerGrid.tsx:3`. (Zero dependencies — trivial move.)

#### 7. `warning` theme token + badge variant

**File**: `src/app/styles/global.css`, `src/shared/ui/badge.tsx`

**Intent**: Land the missing amber token here in foundations (a pure, behavior-neutral theme addition like the rest of this phase) so both the Phase 2 authoring dialog and the Phase 4 board render consume one source — no neutral-soft placeholder, no fork.

**Contract**: Add `--warning` + `--warning-foreground` in all three locations modeled on `--valid`/`--destructive` (`:root` ~`:25`, `.dark` ~`:62`, `@theme inline` ~`:103`). Add a `warning` key to `badgeVariants` (`badge.tsx:11-19`) modeled on `destructive`. Semantic tokens only — no palette-named or arbitrary color utilities (per `lessons.md`). No component consumes it yet in this phase; `pnpm lint`/`pnpm build` cover it.

### Success Criteria:

#### Automated Verification:

- [ ] Migration applies cleanly: `pnpm exec supabase db reset`
- [ ] Generated types are in sync: `supabase gen types` produces no diff vs committed `database.types.ts`
- [ ] FSD structure passes: `pnpm steiger`
- [ ] Linting passes: `pnpm lint`
- [ ] Existing unit suite stays green: `pnpm test`
- [ ] Production build is clean: `pnpm build`
- [ ] Clone integration test passes: `pnpm test:integration` — availability rows copy with remapped `teacher_id` via `clone_plan` (extend the `slot-bundles.integration.test.ts` harness: insert availability rows directly, clone, assert remap)

#### Manual Verification:

- [ ] Clone a plan that has availability rows (inserted by hand in Studio) and confirm rows copy with remapped `teacher_id`
- [ ] Deleting a teacher cascades its availability rows away

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Authoring UI (teachers catalog)

### Overview

Add a per-teacher **Edit availability** dialog — a tri-state day×period grid with whole-day bulk select — persisting each edit optimistically via the proven `useSlotBundles` pattern, adapted from binary marker to tri-state (`available`/`soft`/`strong`).

### Changes Required:

#### 1. Availability view-model + loader

**File**: `src/_pages/teachers/model/teacher.ts`, `src/_pages/teachers/api/loader.ts`

**Intent**: Project availability rows into an app-native type and attach them to each `TeacherRow`.

**Contract**: New `TeacherAvailabilityCell = { day: number; period: number; severity: AvailabilitySeverity }`; `TeacherRow` gains `availability: TeacherAvailabilityCell[]`. `fetchTeacherCatalog` adds a third `Promise.all` query (`teacher_availability` for the plan), groups by `teacher_id` (`groupBy`), and populates the field in the row map (`loader.ts:38-50`). The teachers page (`src/pages/plans/[id]/teachers.astro`) needs no change (flows through `catalog.teachers`).

#### 2. Surface the plan's grid dimensions to the dialog

**File**: `src/pages/plans/[id]/teachers.astro`, `src/_pages/teachers/ui/TeacherCatalog.tsx`

**Intent**: Size the authoring grid to the plan's actual grid, not the absolute `GRID_BOUNDS` max.

**Contract**: Extend `loadPlanSummary` (`src/shared/api/load-plan-summary.ts`) — it currently selects only `"id, name"` and returns `PlanSummary = { id; name }`, so add `slot_grid_preset` to both the select and the `PlanSummary` type (additive; the loader is also used by `courses.astro`/`students.astro`, so the added field is harmless there). The teachers page then computes `days`/`periods` via `parseGridPreset` (now importable from `shared/`) on the returned preset and passes them to `TeacherCatalog` → the dialog.

#### 3. Availability persistence: schema + domain + actions

**File**: `src/_pages/teachers/api/teacher-availability.ts`, `src/_pages/teachers/api/availability-actions.ts`, `src/_pages/teachers/api/actions.ts`

**Intent**: Persist tri-state edits — set a cell's severity (upsert) and clear a cell (delete) — plus a whole-column bulk op, following the slot-bundles domain/action split.

**Contract**: Zod inputs carrying `planId: z.uuid()`, `teacherId: z.uuid()`, `day`/`period` bounded by `GRID_BOUNDS` (from `shared/`), and `severity: availabilitySeveritySchema`. Domain fns `(supabase, input) => Promise<void>` throwing `DomainError`:
- `setCell` — upsert on the unique constraint `(plan_id, teacher_id, day, period)` writing `severity`;
- `clearCell` — delete by coordinate (no-op if absent);
- `setColumn` (bulk) — for a `(teacher, day)`, upsert all `periods` to a severity, or delete the column when clearing (one round-trip).

Register the three as `defineDomainAction` entries in the `teacherActions` object (`teachers/api/actions.ts`) — auto-exposed as `actions.*` (no `src/actions/index.ts` edit).

> **Addendum (impl-review, 2026-06-14):** shipped a fourth, symmetric op — `setRow` (bulk a whole period across days), registered as a fourth action `setAvailabilityRow`, with `rowCoords` in the model and clickable period-row headers in the dialog. The authoring grid now bulk-cycles by both axes (column *and* row), not column-only. Net-additive, covered by unit + integration tests.

#### 4. Client wrapper

**File**: `src/_pages/teachers/api/teacher-client.ts` (extend)

**Intent**: Give the UI a `callAction`-wrapped seam (UI never imports `astro:actions` directly).

**Contract**: Add `setAvailabilityCell`, `clearAvailabilityCell`, `setAvailabilityColumn` one-liners calling `callAction(actions.*, values)`.

#### 5. Pure tri-state transitions

**File**: `src/_pages/teachers/model/availability.ts`

**Intent**: Pure, coordinate-keyed optimistic transitions adapted from `slot-bundle.ts` for a tri-state cell (severity-bearing, not binary).

**Contract**: `LocalAvailabilityCell = TeacherAvailabilityCell & { pending?: boolean }`; functions `severityAt(cells, day, period)`, and optimistic/reconcile/rollback transitions for set-or-update (a cell may already exist with a different severity) and clear, plus a column variant. All return new arrays, never mutate, keyed via a `(day,period)` cell key.

#### 6. Optimistic authoring hook

**File**: `src/_pages/teachers/model/use-teacher-availability.ts`

**Intent**: Hold local availability state seeded from `TeacherRow.availability`, apply optimistic updates with rollback on failure, reusing the `useSlotBundles` shape (`useLatest` ref guard, try/await-client/catch-rollback).

**Contract**: `useTeacherAvailability(initial, { planId, teacherId })` → `{ cells, severityAt(day,period), cycleCell(day,period), setColumn(day, severity|null), error, clearError }`. `cycleCell` advances available → soft → strong → available, dispatching the right client call. Reuse the existing `PlacementError`/`ErrorBanner` channel for failures.

#### 7. Availability dialog

**File**: `src/_pages/teachers/ui/TeacherAvailabilityDialog.tsx`

**Intent**: Render the tri-state grid with day-column headers for bulk select; wire interactions to the hook.

**Contract**: Props `{ teacher: TeacherRow | null; planId: string; days: number; periods: number; onClose }` (target-driven open, like `DeleteTeacherDialog`). Reuses `dayLabel`/`periodLabel` (from `shared/`) for headers; cells show distinct per-severity visuals (available / soft `warning` / strong `destructive`) — the `--warning` token lands in Phase 1, so soft cells render real amber from the start (no neutral placeholder). Clicking a cell calls `cycleCell`; clicking a day header bulk-sets that column.

#### 8. Dialog-state + table entry

**File**: `src/_pages/teachers/model/use-catalog-dialogs.ts`, `src/_pages/teachers/ui/TeacherTable.tsx`, `src/_pages/teachers/ui/TeacherCatalog.tsx`

**Intent**: Wire the dialog into the catalog: a target slice in the dialog hook, an "Edit availability" dropdown item, and the dialog mount.

**Contract**: Add `availabilityTarget`/`openAvailability`/`closeAvailability` to `useCatalogDialogs` (mirror the delete target-only shape). Add an `onEditAvailability` prop threaded through `TeacherTable` → `TeacherRowActions` and a third `DropdownMenuItem` (`TeacherTable.tsx:124-139`). Mount `<TeacherAvailabilityDialog>` in `TeacherCatalog.tsx:85-92` next to the existing dialogs.

#### 9. Availability indicator badge in the teacher row

**File**: `src/_pages/teachers/ui/TeacherTable.tsx`

**Intent**: Give the author an at-a-glance signal of which teachers carry availability constraints — without opening each dialog — mirroring the courses table's badges. Make it a shortcut, not just an indicator.

**Contract**: An `AvailabilityBadge` rendered in the Name cell (`TeacherTable.tsx:72`, beside `row.fullName`), shown only when `row.availability.length > 0`. Modeled on the clickable `OverlapBadge` (`courses/ui/CourseTable.tsx:81-111`) rather than the static `Merged` badge (`:52`): clicking it calls `onEditAvailability(row)` to open the dialog (reuses the prop from item #8 — no new wiring). Token-clean, palette-free styling (`variant="outline"`/`"secondary"`); a `lucide-react` icon (e.g. `CalendarOff`) plus the constrained-cell count for quick scanning. Keep the badge deliberately neutral (no `destructive`/`warning` coloring) — it is a presence/shortcut affordance, not a severity signal; the strong/soft breakdown lives in the dialog.

### Success Criteria:

#### Automated Verification:

- [ ] Transition unit tests pass: `pnpm test` (new `availability.test.ts`)
- [ ] Availability action integration tests pass: `pnpm test:integration` (set/clear/bulk round-trips, upsert-overwrites-severity, unique-constraint idempotency)
- [ ] Linting + FSD pass: `pnpm lint` and `pnpm steiger`
- [ ] Build is clean: `pnpm build`

#### Manual Verification:

- [ ] Open Edit availability on a teacher; click-cycle a cell available → soft → strong → available; state persists across reload
- [ ] Whole-day header click bulk-sets a column to a chosen severity and persists
- [ ] Optimistic feedback is instant; a forced failure rolls back and surfaces the error banner
- [ ] Cloning the plan carries the teacher's availability into the new plan
- [ ] Teacher rows with availability show the indicator badge (with count); clicking it opens the dialog; rows with none show no badge

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Strong-NO validation + board render

### Overview

Add the cheap, designed-for board-only constraint for strong NO: it flags placements whose teacher is strong-unavailable at the cell exactly like today's collisions (destructive, counts invalid, blocks marking the variant final) while the drop still lands. Includes the shared `deriveDropHints` BoardContext rewiring so strong NO colors drag hints `blocked`.

### Changes Required:

#### 1. Board loader fetches availability

**File**: `src/_pages/plan-detail/api/load.ts`, `src/_pages/plan-detail/model/drag.ts`

**Intent**: Load the plan's availability (all teachers, no cohort filter — it's cohort-independent) and pass it to the island as board props.

**Contract**: Add a `teacher_availability` query (by `plan_id` only) to the `Promise.all` and `assertNoQueryErrors`; project to a teacher-keyed lookup. New `PlannerBoardProps` field (e.g. `availability: { strongByTeacher: Map<string, Set<cellKey>>; softByTeacher: Map<string, Set<cellKey>> }`, or the raw cells projected in the model). Soft is loaded now but only consumed for render in Phase 4.

#### 2. New `BoardContext` field

**File**: `src/_pages/plan-detail/model/constraints/types.ts`

**Intent**: Add availability to `BoardContext` additively, as the doc comment (`:12-16`) prescribes — the first real consumer of `ctx`.

**Contract**: `BoardContext` gains an optional availability field (e.g. `strongUnavailableByTeacher?: Map<string, Set<cellKey>>`, plus `softUnavailableByTeacher?` reserved for Phase 4). Existing evaluators are untouched (they ignore `ctx`).

#### 3. New union member with severity

**File**: `src/_pages/plan-detail/model/constraints/types.ts`

**Intent**: Represent an availability violation, severity-tagged from the start so Phase 4 only adds rendering.

**Contract**: Add `{ kind: "teacher-unavailable"; teacherKey: string; courseIds: string[]; severity: "block" | "warn" }` to `CollisionViolation`. This is a compile-forcing change: `collectCourseIds` (`collisions.ts:62-69`), `groupByKind`/`ViolationsByKind` (`CollisionDetailsDialog.tsx:163-181`), and the `constraints.test.ts`/`collisions.test.ts` `toEqual` assertions must all account for it.

#### 4. The availability constraint

**File**: `src/_pages/plan-detail/model/constraints/teacher-availability.ts`, register in `constraints/index.ts:8`

**Intent**: For each occupant whose teacher is strong-unavailable at `ctx.cell`, emit a `block`-severity `teacher-unavailable` violation. Board-only — **omit `test?`** so it stays out of enumeration.

**Contract**: `CellConstraint` exporting only `explain(occupants, ctx)`: looks up `ctx.cell` in `ctx.strongUnavailableByTeacher` per occupant `teacherKey`, returns one violation per affected occupant (mapping storage `strong → block`). Registered in `CELL_CONSTRAINTS`. This phase reads strong only; soft is added in Phase 4.

#### 5. Drag-hint BoardContext rewiring (shared seam)

**File**: `src/_pages/plan-detail/model/drop-hints.ts`, `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Make availability visible to drag hints — the wiring board-only constraints don't get for free. Strong-unavailable cells for the dragged course's teacher should hint `blocked`.

**Contract**: `deriveDropHints` gains an availability param; the per-cell loop (`:94-97`) constructs per-cell context and `classifyCell` treats a dragged member whose teacher is strong-unavailable at the cell as a non-fit (feeding the existing `partial`/`blocked` outcome). `PlannerBoard` passes availability into the `dropHints` memo (`:183-186`). Precedence remains `blocked > partial > … > free`. (The `warn` outcome is added in Phase 4 — see Critical Implementation Details.)

#### 6. Board + dialog render for strong NO

**File**: `src/_pages/plan-detail/ui/SlotCell.tsx`, `src/_pages/plan-detail/ui/CollisionDetailsDialog.tsx`

**Intent**: Render strong NO like a collision but distinguishable from a 2-course clash, and give it a dialog section.

**Contract**: Strong-NO ids flow into `conflictingIds` (so the existing `ring-destructive` + invalid flagging applies unchanged). Add a distinguished badge (e.g. a `UserX`/"unavailable" label vs the collision `TriangleAlert`/"collision") gated on the cell carrying a `teacher-unavailable` block violation. Add the new exhaustive `<section>` + `groupByKind` initializer key + switch arm in the dialog, resolving `teacherKey` → name via the already-threaded `teacherNames`.

### Success Criteria:

#### Automated Verification:

- [ ] Constraint + aggregation unit tests pass: `pnpm test` (new strong-NO constraint tests; updated `constraints.test.ts`, `collisions.test.ts`, `drop-hints.test.ts`)
- [ ] Enumeration stays availability-free: `enumerate.test.ts` green (proves no `test?` leak)
- [ ] Board loader integration test passes: `pnpm test:integration` (availability fetch shape)
- [ ] Lint, FSD, build clean: `pnpm lint`, `pnpm steiger`, `pnpm build`

#### Manual Verification:

- [ ] Dropping a course whose teacher is strong-unavailable at the cell: the drop lands, the cell shows the destructive ring + a distinguished "unavailable" badge, and the cell/plan reads invalid
- [ ] The details dialog shows a distinct "unavailable" section naming the teacher
- [ ] Dragging that course highlights strong-unavailable cells as `blocked`
- [ ] Drag interactions stay well under the 200ms budget on a full board

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Soft-NO severity tier

### Overview

Introduce the non-blocking **`warn`** tier — the genuinely new cross-cutting concept — threaded through the theme, the violation aggregation, the drag-hint classifier, and every render surface. Soft NO shows amber, is inspectable, and never blocks or dims a real fit.

### Changes Required:

#### 1. `warning` token + badge variant — already landed in Phase 1

**File**: (none — `src/app/styles/global.css` and `src/shared/ui/badge.tsx` were updated in Phase 1, item #7)

**Intent**: The amber `--warning`/`--warning-foreground` tokens and the `warning` `badgeVariants` key are added in Phase 1 foundations (behavior-neutral). Phase 4 only *consumes* them on the board render surfaces below.

**Contract**: No new token work here. Confirm the Phase 1 tokens exist and are semantic (no palette-named/arbitrary utilities); all amber render in items #4–#6 references these tokens.

#### 2. Constraint emits `warn` for soft cells

**File**: `src/_pages/plan-detail/model/constraints/teacher-availability.ts`, `constraints/types.ts`

**Intent**: Extend the constraint to also flag soft-unavailable occupants, mapping storage `soft → warn`.

**Contract**: `explain` now also reads `ctx.softUnavailableByTeacher` and emits `teacher-unavailable` violations with `severity: "warn"`. Populate the `softUnavailableByTeacher` `BoardContext` field (board loader already loads soft from Phase 3).

#### 3. Block/warn aggregation split

**File**: `src/_pages/plan-detail/model/collisions.ts`

**Intent**: Stop collapsing block and warn into one id set so the board can render them distinctly and warn never counts as "invalid".

**Contract**: `CellCollisions` splits `conflictingIds` into `blockingIds` (existing kinds + `teacher-unavailable` `block`) and `warningIds` (`teacher-unavailable` `warn`). `collectCourseIds` becomes severity-aware. The union-invariant test (`collisions.test.ts:91-113`) is rewritten to assert `blockingIds ∪ warningIds` equals the violation-id union and that warn ids are excluded from blocking.

#### 4. `warn` drop-hint state

**File**: `src/_pages/plan-detail/model/drop-hints.ts`, `src/_pages/plan-detail/ui/SlotCell.tsx`

**Intent**: Add the advisory drag-hint outcome and its render.

**Contract**: Widen `DropHint` to `"partial" | "blocked" | "warn"`. `classifyCell` returns `"warn"` only when the cell is otherwise free but a dragged member's teacher is soft-unavailable there (precedence `blocked > partial > warn > free`). Add the `warn` column to both modes of `HINT_CLASS` (`SlotCell.tsx:258-269`) — a `warning`-tinted, non-destructive style.

#### 5. Soft-NO cell/chip render

**File**: `src/_pages/plan-detail/ui/SlotCell.tsx`

**Intent**: Render the soft tier as amber, slotted into the ring precedence ladder so it loses to real collisions and drop targets.

**Contract**: `hasWarning = (collisions?.warningIds.size ?? 0) > 0`; a `ring-warning ring-2 ring-inset` arm inserted in the ladder (`:97-110`) gated `!hasCollision && !isDropTarget`; `data-availability="soft"`; affected chip `border-warning bg-warning/10 text-warning`; an amber `<Badge variant="warning">` with its own inspect handler. Soft ids must **not** enter `blockingIds`/`violatesAny` (never dims hints or blocks grouping).

#### 6. Dialog warn section

**File**: `src/_pages/plan-detail/ui/CollisionDetailsDialog.tsx`

**Intent**: Give soft violations a visually distinct (warn-styled) section within the existing dialog.

**Contract**: Render `teacher-unavailable` violations grouped by severity — a `warning`-styled subsection for `warn` vs the destructive treatment for `block` — reusing `teacherNames`. The `ErrorBanner` token-swap (`destructive → warning`) is the styling template.

### Success Criteria:

#### Automated Verification:

- [ ] Updated core tests pass: `pnpm test` (`collisions.test.ts` block/warn split + invariant, `drop-hints.test.ts` warn cases, `constraints.test.ts` soft emission)
- [ ] Enumeration still availability-free: `enumerate.test.ts` green
- [ ] Lint, FSD, build clean: `pnpm lint`, `pnpm steiger`, `pnpm build`

#### Manual Verification:

- [ ] A soft-unavailable placement shows an amber ring/chip/badge, the cell/plan stays valid, and the variant can still be marked final
- [ ] The badge opens a dialog warn section naming the teacher, visually distinct from the block section
- [ ] Dragging a soft-affected course shows `warn` hints only on otherwise-free cells; blocked/partial cells are unaffected
- [ ] Light/dark themes both render the amber tier correctly (driven from `global.css`)

**Implementation Note**: Final phase — confirm the full flow end-to-end after automated verification.

---

## Testing Strategy

### Unit Tests:

- Tri-state transitions (`teachers/model/availability.test.ts`): set/update/clear/column optimistic+reconcile+rollback, severity overwrite.
- Strong-NO constraint: emits one `block` violation per strong-unavailable occupant; none when available; board-only (no `test?`).
- Soft-NO constraint: emits `warn`; soft never enters `violatesAny`/`blockingIds`.
- `collisions` aggregation: `blockingIds`/`warningIds` split + rewritten union invariant.
- `drop-hints`: `warn` only on otherwise-free cells; `blocked > partial > warn > free` precedence; strong → blocked.
- Regression guard: `enumerate.test.ts` stays green (availability never enters the combinatorial path).

### Integration Tests:

- Availability actions (`teachers/api/*.integration.test.ts`): set/clear/bulk round-trips, upsert overwrites severity, unique-constraint idempotency, RLS reachability — implemented in the harness per `lessons.md` (catalog CRUD integration tests belong in the harness).
- Board loader: availability fetch shape (no cohort filter).
- `clone_plan`: availability rows copy with remapped `teacher_id`.

### Manual Testing Steps:

1. Author availability (cycle + bulk), reload, confirm persistence and clone.
2. Place a strong-unavailable course → drop lands, cell invalid, distinguished badge, dialog section.
3. Place a soft-unavailable course → amber, non-blocking, inspectable, variant still finalizable.
4. Drag both → `blocked` vs `warn` hints; verify <200ms responsiveness on a full board.
5. Light/dark theme check for the amber tier.

## Performance Considerations

The drag hot path (`classifyCell`/`violatesAny`/`enumerate`) must stay cheap. Availability is a board-only constraint (omits `test?`) so it never enters enumeration. Drag-hint availability checks are O(1) `Map`/`Set` membership per cell per dragged member — safe within the <200ms budget. Never pass the enumerating `explain` into the combinatorial traversal.

## Migration Notes

Additive only — new table, new enum, `create or replace` clone function (old migration files never edited). No production data to preserve; the table ships empty. Hosted gets migrations only (no seed). After `supabase db push`, verify table reachability (grants) per the README runbook.

## References

- Research: `context/changes/teacher-availability/research.md`
- Persistence template: `supabase/migrations/20260613123404_slot_bundles.sql`, `…123405_clone_plan_with_slot_bundles.sql`; `src/_pages/plan-detail/model/use-slot-bundles.ts`
- Constraint seam: `src/_pages/plan-detail/model/constraints/types.ts:12-30`; `collisions.ts:9-69`; `drop-hints.ts:12,81-130`; `enumerate.ts`
- Render surfaces: `src/_pages/plan-detail/ui/SlotCell.tsx:97-110,258-269`; `CollisionDetailsDialog.tsx:163-181`; `PlannerBoard.tsx:69-91`; `src/app/styles/global.css:25,62,103`; `src/shared/ui/badge.tsx`
- Lessons: `context/foundation/lessons.md` (semantic tokens; port the mechanism; Actions as single transport; catalog CRUD integration tests)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundations (persistence + FSD promotion)

#### Automated

- [x] 1.1 Migration applies cleanly: `pnpm exec supabase db reset` — 24e77a8
- [x] 1.2 Generated types in sync: `supabase gen types` no diff — 24e77a8
- [x] 1.3 FSD structure passes: `pnpm steiger` — 24e77a8
- [x] 1.4 Linting passes: `pnpm lint` — 24e77a8
- [x] 1.5 Existing unit suite green: `pnpm test` — 24e77a8
- [x] 1.6 Production build clean: `pnpm build` — 24e77a8
- [x] 1.7 Clone integration test: availability rows copy with remapped teacher_id (`pnpm test:integration`) — 24e77a8

#### Manual

- [x] 1.8 Clone carries availability rows with remapped teacher_id — 24e77a8
- [x] 1.9 Deleting a teacher cascades its availability away — 24e77a8

### Phase 2: Authoring UI (teachers catalog)

#### Automated

- [x] 2.1 Transition unit tests pass: `pnpm test` — 72180e6
- [x] 2.2 Availability action integration tests pass: `pnpm test:integration` — 72180e6
- [x] 2.3 Linting + FSD pass: `pnpm lint`, `pnpm steiger` — 72180e6
- [x] 2.4 Build clean: `pnpm build` — 72180e6

#### Manual

- [x] 2.5 Click-cycle a cell available → soft → strong → available; persists across reload — 72180e6
- [x] 2.6 Day-header bulk-sets a column and persists — 72180e6
- [x] 2.7 Optimistic feedback instant; forced failure rolls back + shows error banner — 72180e6
- [x] 2.8 Cloning the plan carries availability — 72180e6
- [x] 2.9 Teacher rows with availability show the indicator badge (with count); clicking it opens the dialog; rows with none show no badge — 72180e6

### Phase 3: Strong-NO validation + board render

#### Automated

- [x] 3.1 Constraint + aggregation unit tests pass: `pnpm test` — 91be14d
- [x] 3.2 Enumeration stays availability-free: `enumerate.test.ts` green — 91be14d
- [x] 3.3 Board loader integration test passes: `pnpm test:integration` — 91be14d
- [x] 3.4 Lint, FSD, build clean: `pnpm lint`, `pnpm steiger`, `pnpm build` — 91be14d

#### Manual

- [x] 3.5 Strong-unavailable drop lands, cell shows destructive ring + distinguished badge, plan reads invalid — 91be14d
- [x] 3.6 Dialog shows a distinct "unavailable" section naming the teacher — 91be14d
- [x] 3.7 Dragging highlights strong-unavailable cells as blocked — 91be14d
- [x] 3.8 Drag stays under the 200ms budget on a full board — 91be14d

### Phase 4: Soft-NO severity tier

#### Automated

- [x] 4.1 Updated core tests pass: `pnpm test` (block/warn split, warn hints, soft emission) — 26d0b59
- [x] 4.2 Enumeration still availability-free: `enumerate.test.ts` green — 26d0b59
- [x] 4.3 Lint, FSD, build clean: `pnpm lint`, `pnpm steiger`, `pnpm build` — 26d0b59

#### Manual

- [x] 4.4 Soft placement shows amber ring/chip/badge; cell/plan stays valid and finalizable — 26d0b59
- [x] 4.5 Badge opens a visually distinct dialog warn section naming the teacher — 26d0b59
- [x] 4.6 Soft drag shows warn only on otherwise-free cells; blocked/partial unaffected — 26d0b59
- [x] 4.7 Light/dark both render the amber tier correctly — 26d0b59
