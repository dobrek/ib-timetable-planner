---
date: 2026-06-13T18:00:59+0200
researcher: Dobromir Kropielnicki
git_commit: 34eaac2325fb6887dd1b6d1ddd32a1ca3ba285ae
branch: main
repository: dobrek/ib-timetable-planner
topic: "Teacher availability — domain model, UI, and validation changes (strong NO / soft NO)"
tags: [research, codebase, teacher-availability, validation, constraints, severity, S-03]
status: complete
last_updated: 2026-06-13
last_updated_by: Dobromir Kropielnicki
---

# Research: Teacher availability — domain model, UI, and validation

**Date**: 2026-06-13T18:00:59+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: `34eaac2325fb6887dd1b6d1ddd32a1ca3ba285ae`
**Branch**: `main`
**Repository**: dobrek/ib-timetable-planner

> GitHub permalink base for any `path:line` reference below:
> `https://github.com/dobrek/ib-timetable-planner/blob/34eaac2325fb6887dd1b6d1ddd32a1ca3ba285ae/<path>#L<line>`

## Research Question

What changes are needed in the **domain model**, **UI**, and **validation mechanism** to support **teacher availability**? From the user's perspective there are two tiers:

1. **Strong NO** — on a particular day/period the teacher *cannot* teach. Behaves like a collision we have today.
2. **Soft NO** — the teacher *prefers* not to teach then; a **non-blocking warning** the plan author should see. It does not stop the plan from moving forward.

**Scope locked with the user before research:**

- Availability is **plan-scoped** — it hangs off the plan-owned teacher row (there is no global catalog; see §"Why there is no global option").
- Storage is **per `(day, period)` cell** with a severity; the authoring UI adds a **whole-day bulk-select** convenience on top of per-cell selection.
- Two severities — strong (blocking class) and soft (new non-blocking warning tier). Research **proposes** how the warning surfaces.
- Output: a **comprehensive design doc** ready to hand to `/10x-plan`.

---

## Summary

This feature is **architecturally anticipated** — the constraint core, code comments, the PRD, the roadmap, and prior change docs all name "teacher availability" as the planned S-03 follow-up. The work splits cleanly into three layers, with one layer carrying nearly all the genuinely *new* design:

- **Domain/persistence — low risk, well-templated.** Add one plan-scoped table `teacher_availability` following the exact `slot_bundles`/`placements` pattern (plan FK + composite FK to `teachers (plan_id, id)`, cohort enum, day/period checks, RLS, per-cell uniqueness). The composite-FK target on `teachers` **already exists** — no prerequisite migration. Extend the `clone_plan` RPC with one teacher-remapped insert. Regenerate DB types. Seed empty.

- **Validation — the strong NO drops in cheaply; the soft NO is the real work.** The `CellConstraint` registry + `BoardContext` were *designed* for exactly this (`types.ts:12-16` literally says "teacher availability"). A **strong-NO** constraint slots in as a board-only constraint (omit the ctx-free `test`) with **zero edits to existing evaluators**. The **soft-NO is the disruptive part**: the entire validation core today is binary (a course is conflicted or not; a drop hint is `partial | blocked`). A non-blocking **warning severity tier does not exist** and must be threaded through the violation type, the cell-collision aggregation, the drop-hint classifier, and every rendering surface.

- **UI — two surfaces, one new theme token.** (A) The board needs a distinct *warning* visual (there is no amber/`warning` token today — only `destructive` and `valid` exist) and a strong-NO visual distinguishable from a plain 2-course collision. (B) An **authoring** surface in the teachers catalog — a per-teacher day×period toggle grid with whole-day bulk select — reusing the proven `useSlotBundles` optimistic-write pattern.

**The one decision the plan must settle (and my recommendation):** "Strong NO behaves like a collision we have today" — but **today's collisions do not physically block a drop**. The repo runs an **accept-and-flag** policy (PRD Q8): drops always land, collisions paint a destructive ring and mark the cell/plan invalid, they never reject the drop (`PlannerBoard.tsx:69-91`, confirmed `collision-info/plan.md:16`). So the faithful reading of "strong NO = like current collision" is: **strong NO is a new hard *violation class* rendered exactly like today's collisions (destructive, counts as invalid, blocks marking the variant final) — the drop still lands.** It is *not* a physical drop-rejection. Soft NO is then a strictly lower, advisory tier that does not invalidate the plan. This honors both the user's intent and the settled accept-and-flag architecture. See [Open Questions Q1](#q1--strong-no-semantics-the-one-decision-to-settle).

---

## Why there is no "global vs per-plan" option (resolved during scoping)

As of the `plans_as_domain_root` re-baseline (S-07), **all domain data is plan-owned — there is no global catalog**:

- The migration header: *"The catalog (teachers, courses, students, choices, dependencies) becomes plan-owned; … composite FKs make cross-plan references impossible at the DB level"* (`supabase/migrations/20260611180006_plans_as_domain_root.sql:1-6`).
- Teachers specifically moved from global to plan-scoped: the original `teachers.code text not null unique` (global) was dropped and replaced with `unique (plan_id, code)` — *"code unique per plan (global unique blocked cloning)"* (`20260611180006_plans_as_domain_root.sql:30-34`).

So availability has exactly one home: the **plan-scoped teacher row**. It clones with the plan for free.

---

## Detailed Findings

### A. Domain model & persistence

**No availability data exists today.** No table, column, or feature code. The `teachers` table is `id, code, full_name, plan_id, created_at, updated_at` (`20260602185012_minimal_domain_schema.sql:17-23` + `plan_id` from `20260611180006_plans_as_domain_root.sql:31-34`).

**The plan-scoped child-table pattern** (canonical reference: `slot_bundles`, `supabase/migrations/20260613123404_slot_bundles.sql:11-26`) — a new table must replicate:
- `plan_id uuid not null references plans(id) on delete cascade` (`:13`).
- A **composite FK back to the parent within the same plan**: `(plan_id, child_id) references parent (plan_id, id)`. The target on teachers **already exists** — `teachers_plan_id_unique unique (plan_id, id)` was added in `20260612090000_courses_teacher_composite_fk.sql:10`. **No prerequisite migration needed.**
- RLS enabled + the standard policy string `"Authenticated users have full access" … for all to authenticated using (true) with check (true)` (`20260613123404_slot_bundles.sql:25-26`).
- Per-cell uniqueness + day/period CHECKs (`day between 1 and 7`, `period between 1 and 12`) + a `(plan_id)` index (`20260613123404_slot_bundles.sql:18-23`).
- **`cohort` belongs on the availability row, not inferred from the teacher.** Teachers are deduped across both cohorts in the seed (`scripts/gen-seed.mjs:281-289`), so a teacher is plan-scoped but *not* cohort-scoped. Carry `cohort` like `slot_bundles` does (board is dp1-only today — `BOARD_COHORT = "dp1"`, `src/_pages/plan-detail/api/load.ts:16`).

**`(day, period)` still uniquely identifies a cell** — slot bundles did **not** change cell identity. A `slot_bundles` row is an *opt-out marker* (its presence means the cell is *unbundled*): `isBundled(count, overridden) = count >= 2 && !overridden` (`src/_pages/plan-detail/model/slot-bundle.ts:23-25`). Grid bounds `GRID_BOUNDS = { maxDays: 7, maxPeriods: 12 }` (`src/_pages/plan-detail/model/grid.ts:10`) mirror the DB; `slot_grid_preset` is plain text like `"5x10"` parsed by `parseGridPreset` (`grid.ts:27`), presets in `src/shared/config/grid-presets.ts:10`.

**Severity representation — use a native Postgres enum** (not `text + check`). The codebase already uses a native enum for `cohort` precisely so `supabase gen types` emits a TS union through every row type (`20260611180006_plans_as_domain_root.sql:27-28`), single-sourced in `src/shared/config/cohorts.ts:10`. A `severity` enum gets the same first-class TS union.

**Proposed migration** `supabase/migrations/<ts>_teacher_availability.sql`:

```sql
create type availability_severity as enum ('strong', 'soft');

create table teacher_availability (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references plans(id) on delete cascade,
  teacher_id uuid not null,
  cohort     cohort not null,
  day        smallint not null,
  period     smallint not null,
  severity   availability_severity not null,
  created_at timestamptz not null default now(),
  constraint teacher_availability_unique unique (plan_id, teacher_id, cohort, day, period),
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

Notes: `created_at` only (no `updated_at`/moddatetime) matches `slot_bundles` — cells are replace-by-coordinate, not edited. Cascade on the composite teacher FK means deleting a teacher (or its plan) auto-removes its availability.

**The `clone_plan` RPC** (live definition: `supabase/migrations/20260613123405_clone_plan_with_slot_bundles.sql:8`, `SECURITY INVOKER`, signature `clone_plan(p_source_plan_id uuid, p_name text) returns uuid`). It builds temp ID maps (`_teacher_map`, `_course_map`, …) and copies each table joining through the maps to remap UUIDs. Availability is teacher-keyed, so it needs the `_teacher_map` join. Add a **new** `create or replace` migration carrying the full body forward (the established convention — never edit the old file) plus, right after the teachers copy block (`…405:61-64`):

```sql
-- teacher_availability: remap teacher_id via _teacher_map; coordinate copied as-is.
insert into public.teacher_availability (plan_id, teacher_id, cohort, day, period, severity)
select v_new_plan_id, tm.new_id, a.cohort, a.day, a.period, a.severity
  from public.teacher_availability a
  join pg_temp._teacher_map tm on tm.old_id = a.teacher_id
 where a.plan_id = p_source_plan_id;
```

(`id` omitted → fresh UUID; availability rows have no children, so no map table is needed. The composite FK makes a missed remap fail loudly at insert.)

**Generated types** `src/shared/api/database.types.ts` (teachers Row/Insert/Update at `:418-452`, `cohort` enum at `:473`, `clone_plan` at `:458-461`) must be **regenerated** via `supabase gen types` after the migration.

**Seed** — `scripts/gen-seed.mjs` has **no availability fixture source** (`data/dp1/`, `data/dp2/` contain only subjects/overlap/merge CSVs). **Seed empty** — no `gen-seed.mjs` change required; the table starts with zero rows after `db reset`.

**View-model projection** (honors `lessons.md` rule "port the mechanism, not the legacy type shape", `context/foundation/lessons.md:5-10`): the loader projects DB rows to an app-native camelCase type with opaque ids — e.g. `TeacherAvailabilityCell = { day: number; period: number; severity: "strong" | "soft" }`. Existing precedent: `TeacherRow`/`CourseAssignment` in `src/_pages/teachers/model/teacher.ts:10-28`, mapped in `src/_pages/teachers/api/loader.ts:38-50`; every mutation carries `planId` (`src/_pages/teachers/model/schemas.ts:9-26`).

### B. Validation / constraint core

**The constraint contract** (`src/_pages/plan-detail/model/constraints/types.ts:23-30`):

```ts
export type CellConstraint = {
  id: string;
  explain(occupants: GroupingCourse[], ctx: BoardContext): CollisionViolation[];
  test?(course: GroupingCourse, others: GroupingCourse[]): boolean;
};
```

- `explain` — the enumerating path (all violations, no short-circuit, takes `BoardContext`) → drives the details Dialog.
- `test?` — the **optional** ctx-free fast boolean (course vs cell-mates). **Omitting it makes the constraint "board-only"** and excludes it from grouping enumeration (`types.ts:27-29`). This is exactly the seam availability uses.

**`BoardContext`** — the extension point added by the `collision-info` change (`types.ts:17-20`):

```ts
export type BoardContext = {
  cell: { day: number; period: number };
  catalogById: Map<string, GroupingCourse>;
};
```

The doc comment at `types.ts:12-16` literally names the intent: *"future board-only constraints (cross-cohort occupancy, teacher availability) add optional fields here additively, without touching existing evaluators."*

**`CollisionViolation`** is a discriminated union with opaque ids (`types.ts:7-10`): `duplicate-course`, `teacher`, `student`. The registry is one array `CELL_CONSTRAINTS = [duplicateCourse, teacherConflict, studentConflict]` (`constraints/index.ts:8`); `explainCell` flatMaps every `explain` (`index.ts:11-12`); `violatesAny` is `.some()` over each defined `test?` (`index.ts:18-19`).

**Two derivation paths** both bucket occupants via `bucketByCell` (`collisions.ts:46-60`):
- **Path A (reactive flags + Dialog):** drop → `usePlacements` mutates optimistically → `PlannerBoard` recomputes `useCollisions` → `deriveCellViolations(placements, catalogById)` (`collisions.ts:25-38`) → `CellCollisions = { conflictingIds: Set<string>; violations: CollisionViolation[] }` (`collisions.ts:9-14`). `conflictingIds` drives chip flags; `violations` drives the Dialog.
- **Path B (drag-time hints, the hot path):** `deriveDropHints` (`drop-hints.ts:81-104`) → `classifyCell` (`drop-hints.ts:123-130`) decides fit **purely via `violatesAny`** → `DropHint = "partial" | "blocked"` (`drop-hints.ts:12`). The same fast path feeds `enumerate.ts:38,53`.

**The <200ms budget** lives in Path B — `classifyCell`/`violatesAny`/`enumerate` must stay cheap booleans. `collision-info/plan.md:57,314-315`: *never pass the enumerating `explain` into the combinatorial traversal.* `enumerate.ts` has hard caps (`EnumerationCapError`, `:18,33-46`).

**Severity today: there is none.** Two separate behaviors, neither a true severity tier:
- **Drops always land (accept-and-flag).** `handleDrop` (`PlannerBoard.tsx:69-91`) never consults collisions before accepting; a "collision" only paints `ring-destructive` (`SlotCell.tsx:107`) + a badge. Confirmed `collision-info/plan.md:16`.
- **The only hard rejections are structural and non-constraint-based** — same-course duplicate in a cell (`placement-transitions.ts:7-9`, `placement.ts:16-20`) and `moveIntent` `not-found/pending/same-cell/occupied` (`placement-transitions.ts:86-99`), gating writes in `use-placements.ts:78,97,135-136`.
- The drag hint `"blocked"` is **purely cosmetic** (`SlotCell.tsx:258-269`) — it does not prevent the drop.

So today's teacher/student collision is already a non-blocking annotation that flags the cell red.

**Where the strong NO plugs in (cheap, designed-for):**
- New `src/_pages/plan-detail/model/constraints/teacher-availability.ts` exporting a `CellConstraint`, registered in `CELL_CONSTRAINTS` (`index.ts:8`).
- It needs the occupant's teacher (`GroupingCourse.teacherKey` — already in scope, equals `teacher_id`), the target cell (already `BoardContext.cell`), and availability data added as a **new optional `BoardContext` field** (e.g. `strongUnavailableByTeacher?: Map<string, Set<cellKey>>`) exactly as `types.ts:12-16` prescribes.
- **Omit `test?`** (board-only) → correctly excluded from grouping enumeration (`collision-info/plan.md:33`).
- Add a union member `{ kind: "teacher-unavailable"; teacherKey: string; courseIds: string[] }` to `types.ts:7-10`. `collectCourseIds` (`collisions.ts:62-69`) already routes any kind carrying `courseIds` into `conflictingIds`, so it flows to chip flags automatically.
- **Caveat:** because it omits `test`, the strong NO appears in Path A (flags + Dialog) but is **invisible to Path B** (drop hints / grouping). The *"inherited for free"* comment (`drop-hints.ts:115-122`) only holds for constraints with a `test`. To also color the drag hint for the dragged course's teacher, `deriveDropHints`/`classifyCell` need explicit board-context wiring (see soft-NO list below — the wiring is shared).

**Where the soft NO requires NEW machinery** (each item is a concrete type/function that changes):
1. **Violation type** — add a `severity` to `CollisionViolation` members (or model warnings as their own kinds) (`types.ts:7-10`). `CellConstraint.explain` then carries severity.
2. **Cell aggregation** — `CellCollisions.conflictingIds` (`collisions.ts:9-14`) collapses block+warn together; split into e.g. `blockingIds` vs `warningIds` (or carry severity per id). `collectCourseIds` + `deriveCellViolations` change; the union-invariant test (`collisions.test.ts:91-113`) is rewritten.
3. **Drop-hint classifier** — `DropHint` (`drop-hints.ts:12`) gains a `"warn"` state; `classifyCell` (`:123-130`) must distinguish block-fit from warn-fit, so `violatesAny` is no longer sufficient — `deriveDropHints` (`:81-104`) needs `BoardContext`/availability passed in (it currently takes only `placements` + `catalogById`). **This same wiring is what the strong-NO drag-hint coloring needs.**
4. **Drop decision** — `handleDrop` (`PlannerBoard.tsx:69-91`) is the fork: soft NO proceeds (drop lands, warning surfaces); strong NO behaves like a collision (see Q1 — under accept-and-flag it also lands but flags as invalid).
5. **Hint render table** — `HINT_CLASS` (`SlotCell.tsx:258-269`) keyed by `HintMode × (DropHint|"free")` needs a `"warn"` row; `hintState` (`:85`) + `data-drop-hint` (`:96`) carry it.
6. **Cell/chip render** — `SlotCell` reads `conflictingIds` for the destructive ring (`:82-83,107`) and per-chip `conflicted` flag (`:160,198,201`); the warn tier needs a distinct non-destructive visual + chip state.
7. **Dialog** — `CollisionDetailsDialog` `groupByKind` is **exhaustive over the union** (`:163-181`) — a new kind is a compile error until a section is added; a warn tier needs its own section/severity treatment + availability name lookups.
8. **Data prop & loader** — both severities reach the island via new fields on `PlannerBoardProps` (`drag.ts:18-35`) and a new fetch in `load.ts` (mirroring `fetchTeacherNames` at `:106-111`, wired into the `Promise.all` at `:61-67`).

**Tests** that change: `constraints/constraints.test.ts` (ctx helper + new describe), `collisions.test.ts` (split block/warn ids + invariant), `drop-hints.test.ts` (signatures + new warn/board-only cases), `collision.test.ts` & `enumerate.test.ts` should stay green (proving availability did not leak into enumeration). New: strong-NO and soft-NO constraint unit tests; drop-decision tests; a `load.ts` integration test for the new fetch.

### C. UI layer

**Board component tree:** `PlannerBoard.tsx` → `PlannerGrid.tsx` (`gridTemplateColumns: auto repeat(${days}, …)`, `:53`; one `SlotCell` per day per `PeriodRow`, `:84-139`) → `SlotCell.tsx` (one droppable per cell) → `PlacedChip` (private sub-component, `SlotCell.tsx:172`). Details dialog `CollisionDetailsDialog.tsx` mounted once (`PlannerBoard.tsx:152`).

**How collisions render today** (`SlotCell.tsx`): cell-level `hasCollision && "ring-destructive ring-2 ring-inset"` (`:107`) with `data-collision` (`:94`); chip-level `conflicted ? "border-destructive bg-destructive/10 text-destructive" : …` (`:201`); a clickable `<Badge variant="destructive">` with `TriangleAlert` + "collision" that opens the dialog (`:208-226`). **Ring precedence is deliberately managed** — hint classes are suppressed when `hasCollision`/`isDropTarget` because every Tailwind ring sets the same custom property (`:99-108`). **Any new warning ring must slot into this same ladder.**

**Dialog keyed by violation kind:** `groupByKind` → `ViolationsByKind` is `{ [K in CollisionViolation["kind"]]: … }`, **exhaustive** (`CollisionDetailsDialog.tsx:158-181`) — a new kind won't compile until a `<section>` + `switch` arm are added (`:84,99,115,168-178`). Auto-closes when the inspected cell's violations vanish (`PlannerBoard.tsx:214`).

**Theme tokens — a `warning` token must be added.** `src/app/styles/global.css` has `destructive` (+foreground) and exactly one green `--valid` token (`:25`, dark `:62`, `--color-valid` `:103`, used for `highlight-free` drag hints at `SlotCell.tsx:264-268`). **There is NO amber/`warning` token.** Two anti-patterns to avoid: `src/shared/ui/Banner.astro:32-36` hardcodes amber hex (violates `lessons.md:12-17`), and `sonner.tsx:39` uses Sonner's own styling. **Add `--warning` + `--warning-foreground` in all three places** — `:root` (`:7-43`), `.dark` (`:45-80`), and the `@theme inline` map (`:82-121`, beside `--color-valid`) — modeled on the `--valid` precedent, then a `warning` entry in `badgeVariants` (`src/shared/ui/badge.tsx`). The board's token-clean `ErrorBanner.tsx` (`border-destructive/50 bg-destructive/10 text-destructive`) is the template for a soft-warning advisory banner (swap `destructive` → `warning`).

**Authoring home — the teachers catalog.** Plan-scoped page `src/pages/plans/[id]/teachers.astro` → `<TeacherCatalog>` (`TeacherCatalog.tsx`, thin orchestrator using `useCatalogFilters` + `useCatalogDialogs`, `:23-24`). `TeacherTable.tsx` renders rows with a per-row `DropdownMenu` (Edit `:125`, Delete `:132`). **Add a third "Edit availability" `DropdownMenuItem`** (`TeacherTable.tsx:124-139`), a parallel `availabilityTarget`/`openAvailability`/`closeAvailability` in `use-catalog-dialogs.ts:19-56`, and mount a new `<TeacherAvailabilityDialog>` in `TeacherCatalog.tsx:85-91`.

**Authoring UI shape — a per-teacher day×period toggle grid.** It can reuse the grid shape from `PlannerGrid.tsx` (`cellKey`, day columns), `parseGridPreset`/`GRID_BOUNDS` (`grid.ts`), and `dayLabel`/`periodLabel` from `src/_pages/plan-detail/lib/slot-labels.ts`. **FSD caveat:** `slot-labels.ts` and `grid.ts` live in `plan-detail`; the teachers slice **cannot import from another `_pages` slice** (`app → _pages → shared`, steiger-enforced). These helpers (and `grid-presets` consumption) must be **promoted to `shared/`** first. **Whole-day bulk select** = a clickable day-column header that sets all periods in that column to a chosen severity. Tri-state per cell (available / soft / strong) or two toggles.

**Save pattern — reuse the `useSlotBundles` optimistic path.** Two established options: (i) optimistic per-cell toggle persisted immediately, copying `use-slot-bundles.ts` (optimistic local state + `*-client.ts` + pure transitions + marker table) — the **closer fit** given per-cell + bulk-select interaction; or (ii) a single dialog "Save" via `submitForm` over an `availabilityInput` zod schema. Either way it follows the house form/action pattern: shared zod schema between action `input` and RHF resolver (`teachers/model/schemas.ts:9`, `TeacherFormDialog.tsx:98-116`), a `*-client.ts` wrapper calling `actions.*` (UI never imports `astro:actions` directly — `ui-conventions.md:149-159`), a `defineDomainAction` entry (`teachers/api/actions.ts:8`, `shared/lib/actions/index.ts:11`), registered in `src/actions/index.ts`.

**Board rendering proposal:**
- **Soft NO** — cell `ring-warning ring-2 ring-inset` (new token), inserted into the precedence ladder (`SlotCell.tsx:97-110`) gated to lose to `hasCollision`/`isDropTarget`; `data-availability="soft"`; affected chip `border-warning bg-warning/10 text-warning` + an amber `<Badge variant="warning">` with its own inspect handler. **Must NOT enter `violatesAny`** (so it never dims hints or blocks grouping) — purely advisory.
- **Strong NO** — renders like today's collision (`ring-destructive`) but with a **distinguishing badge icon/label** ("teacher unavailable" vs "collision") so the author can tell it apart from a 2-course clash, rather than a different ring color.

---

## Code References

> Permalink base: `https://github.com/dobrek/ib-timetable-planner/blob/34eaac2325fb6887dd1b6d1ddd32a1ca3ba285ae/<path>#L<line>`

**Schema / persistence**
- `supabase/migrations/20260611180006_plans_as_domain_root.sql:1-34` — plan-owned re-baseline; teachers `unique (plan_id, code)`.
- `supabase/migrations/20260612090000_courses_teacher_composite_fk.sql:10-16` — `teachers_plan_id_unique (plan_id, id)` (the composite-FK target — already exists).
- `supabase/migrations/20260613123404_slot_bundles.sql:11-26` — the plan-scoped child-table template.
- `supabase/migrations/20260613123405_clone_plan_with_slot_bundles.sql:8,61-64,113-116` — live `clone_plan`; teacher copy block; coordinate copy block.
- `supabase/migrations/20260602185012_minimal_domain_schema.sql:17-23,125-127` — teachers columns; placements day/period checks.
- `scripts/gen-seed.mjs:277-408,281-289` — per-plan seed emission; teacher dedup.
- `src/shared/api/database.types.ts:418-473` — generated teachers/cohort/clone_plan types (regenerate).
- `src/shared/config/cohorts.ts:10` — enum single-sourcing precedent for a `severity` config.

**Validation core** (`src/_pages/plan-detail/model/`)
- `constraints/types.ts:7-30` — `CollisionViolation` union, `BoardContext` (+the "teacher availability" comment at `:12-16`), `CellConstraint`.
- `constraints/index.ts:8,11-19` — registry, `explainCell`, `violatesAny`.
- `constraints/teacher-conflict.ts:8-17` — closest existing constraint to mirror.
- `collisions.ts:9-14,25-38,46-69` — `CellCollisions`, `deriveCellViolations`, bucketing, `collectCourseIds`.
- `drop-hints.ts:12,81-130` — `DropHint`, `deriveDropHints`, `classifyCell` (+the "inherited for free" comment `:115-122`).
- `enumerate.ts:18,33-53` — enumeration caps + fast-path usage.
- `placement-transitions.ts:7-9,86-99` / `placement.ts:16-20` — the only structural drop rejections.
- `grid.ts:10,27` / `slot-bundle.ts:23-25` / `use-slot-bundles.ts` — grid bounds/preset; bundle semantics; optimistic-write template.

**UI**
- `ui/PlannerBoard.tsx:53-67,69-91,152-159,183-226` — board root, drag/drop handlers, dialog mount, hint/collision memos.
- `ui/PlannerGrid.tsx:45-139` — days×periods rendering.
- `ui/SlotCell.tsx:82-111,160,198-226,258-269` — collision/chip visuals, badge, hint precedence/table.
- `ui/CollisionDetailsDialog.tsx:8,36,84-181` — exhaustive kind grouping.
- `src/app/styles/global.css:7-121` — theme tokens (`destructive`, `valid`; **no `warning`**).
- `src/shared/ui/badge.tsx`, `Banner.astro:32-36` (anti-pattern), `ErrorBanner.tsx` (template).
- Teachers slice: `ui/TeacherCatalog.tsx:23-91`, `ui/TeacherTable.tsx:108-143`, `ui/TeacherFormDialog.tsx:98-116`, `model/{schemas,teacher,use-catalog-dialogs}.ts`, `api/{actions,teacher-client,create-teacher,loader}.ts`, `src/pages/plans/[id]/teachers.astro`.
- Forms/actions infra: `src/shared/lib/{forms.ts,call-action.ts,actions/index.ts}`, `src/actions/index.ts`.
- FSD-promotion candidates: `src/_pages/plan-detail/lib/slot-labels.ts`, `src/_pages/plan-detail/model/grid.ts`.

---

## Architecture Insights

- **The registry + `BoardContext` is an open-closed seam built for this.** Strong NO = +1 array entry + 1 optional `BoardContext` field + 1 union member, with **zero edits to existing evaluators** (`types.ts:12-16`, `index.ts:8`). The architecture's most expensive decision (the second `explain` parameter being a "bag") was made precisely so availability arrives additively (`collision-info/plan.md:271`).
- **Severity is the real new concept.** The whole core is binary (block/no-block, `partial|blocked`). Introducing a `warn` tier is a cross-cutting type change (violation → aggregation → hints → render → dialog). This is where almost all the validation-layer risk and test churn lives.
- **Board-only ≠ free in the hint path.** Constraints with a `test` are inherited by drop-hints/enumeration for free; an availability constraint (no `test`) is *not* — coloring drag hints requires threading `BoardContext` into `deriveDropHints`. Strong-NO drag-hint coloring and soft-NO both need this same wiring, so do it once.
- **Identity stays opaque; names at the edge.** Availability violations carry teacher uuids; resolve to `full_name ?? code` only in the Dialog (`collision-info/plan.md:58,189`; `lessons.md:5-10`).
- **Persistence has a perfect template.** `slot_bundles` (marker table + optimistic `useSlotBundles` hook + pure transitions + clone-RPC line) is a near-exact precedent for `teacher_availability`.
- **One FSD gotcha:** sharing grid/label helpers with the teachers slice requires promoting them to `shared/` (steiger CI gate).

---

## Historical Context (from prior changes)

**Firmly decided / committed:**
- Availability table **deferred to S-03** — `context/archive/2026-06-01-minimal-domain-schema/plan.md:84`; `context/changes/teachers-catalog/research.md:58`.
- **Accept-and-flag** is the settled validation policy (PRD Q8) — drops land, violations are flagged, never blocked — `context/changes/collision-info/research.md:217`; `collision-info/plan.md:16`. *(This is the basis for [Q1](#q1--strong-no-semantics-the-one-decision-to-settle).)*
- **Constraint registry + optional `BoardContext`** is the extension contract; board-only constraints **omit `test`** and stay out of grouping enumeration — `collision-info/plan.md:33,52,92-94`.
- Availability is a **validator concern, not a grouping-algorithm concern** — `context/archive/2026-06-04-port-grouping-algorithm/plan.md:42`, `research.md:40`.
- Teacher view-model **reserved an `availabilityRules?` placeholder** — `teachers-catalog/research.md:171`.
- `BoardContext` ships **minimal** (no speculative availability fields pre-plumbed) — availability *adds* the field — `collision-info/plan.md:271`.
- Names resolved at the render edge (`full_name ?? code`); ids opaque in the model — `collision-info/plan.md:58,189`.

**Explicitly left open (this change decides):**
- **Table shape** — exclusion-grid vs named-rules was left open (`teachers-catalog/research.md:169-171`). *This research recommends the per-cell exclusion-grid shape with a `severity` enum (§A).*
- **Severity tiers** — the PRD lists availability as a violation **class** alongside student/teacher (`context/foundation/prd.md:148`) and the roadmap S-03 says the *"online validator extends to cover two new collision classes"* (`context/foundation/roadmap.md:145-157`), but **the soft/strong (warning vs hard) split the user wants is not pre-decided** — it is new with this change.
- Whether the strong tier physically blocks the drop vs flags-as-invalid — unspecified historically; see Q1.

---

## Related Research

- `context/changes/teachers-catalog/research.md` — the CRUD slice that deferred availability and reserved the architecture (esp. `:58,169-171,179`).
- `context/changes/collision-info/plan.md` & `research.md` — the constraint registry, `BoardContext`, accept-and-flag.
- `context/archive/2026-06-04-port-grouping-algorithm/{plan,research}.md` — collision-class scope (availability belongs to the validator).
- `context/archive/2026-06-01-minimal-domain-schema/plan.md` — the original deferral.

---

## Open Questions

### Q1 — Strong-NO semantics (the one decision to settle)

The user said strong NO "is like a collision we have right now." But **today's collisions do not physically block a drop** — the repo is accept-and-flag (`PlannerBoard.tsx:69-91`, `collision-info/plan.md:16`). Two readings:

- **(Recommended) Flag-as-invalid, drop still lands.** Strong NO is a new hard *violation class* rendered like today's collisions (destructive, counts toward the cell/plan being invalid, blocks marking the variant final), but the optimistic drop lands like every other drop. Most faithful to "like a collision we have now" and requires no new drop-rejection machinery — it reuses the existing collision flow with a new union kind.
- **(Alternative) Physically reject the drop.** `handleDrop` consults availability and reverts the optimistic add for a strong NO. This *introduces* a behavior the codebase deliberately avoided (the only hard rejections today are structural same-course/occupied cases) and breaks the accept-and-flag invariant.

Recommendation: go with flag-as-invalid. Confirm during `/10x-frame` or `/10x-plan`.

### Q2 — How should the soft-NO warning surface? (research proposes; user to pick)
- **(a) Cell + chip amber ring/badge only** — lightweight, consistent with how collisions surface; discoverable via the same inspect-dialog (add a warn section).
- **(b) Plan-level advisory panel** — a dismissible summary of all soft warnings in the variant (copy `ErrorBanner.tsx` with the new `warning` token), good for "see all preferences at a glance."
- **(c) Both** — cell/chip cue + a roll-up panel. Most complete; most work.

### Q3 — Tri-state authoring vs two layers
Is a cell exactly one of {available, soft, strong}, or can a teacher carry both a soft preference and a hard block expressed separately? The proposed schema (one row per `(teacher, cohort, day, period)` with a single `severity`) assumes **tri-state** (one severity per cell). Confirm.

### Q4 — dp2 / cross-cohort scope
The board is dp1-only today (`load.ts:16`). The schema carries `cohort` for dp2-readiness, but should the *authoring UI and validator* handle dp2 now, or ship dp1-only and let dp2 ride the existing cohort-switch work later?

### Q5 — Does availability participate in grouping at all?
Confirmed it should **not** (board-only, omit `test`; `collision-info/plan.md:33`). Flagging here only to make the non-decision explicit for the plan.
