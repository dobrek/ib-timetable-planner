# Subject Colors Implementation Plan

## Overview

Add an **optional, visual-only per-course color** that paints every subject chip on the
plan-detail page. The color is stored as a **token-key enum** (e.g. `rose`) on the `courses`
table, authored via a swatch picker in the course form, and rendered through a small shared
`subjectChipClass()` resolver against paired `--color-subject-*` theme tokens. It is **provably
isolated** from the constraint/collision core: color never enters `GroupingCourse`, the catalog
hash, or any guard/transition, so the <200ms drag-drop validation budget is untouched.

## Current State Analysis

- **No color exists anywhere today.** `courses` columns are `id, plan_id, cohort, name, level,
  group_index, hours_per_week, week_mode` — no color/hex/style column in `supabase/` or
  `src/shared/api/database.types.ts`. There is no color picker and no per-identity color.
- **"Subject" = the `courses` entity.** The word "subject" survives only in CSV fixture filenames;
  the canonical entity is `course`, identity `courses.id`.
- **The board uses a side-map display pattern.** A placed tile carries an opaque `courseId`; its
  display name is resolved at the render edge from a `names` map. That map exists in **two physical
  representations**: a `Map<string,string>` (`CohortCatalog.names`, `catalog-hash/types.ts:31`, which
  also crosses the `computeGroupings` Astro Action wire) and a `Record<string,string>` (board UI,
  built via `Object.fromEntries` in `plan-detail/api/load.ts:110,120`). The `names[id] ?? id`
  fallback is **duplicated across 10 production read sites** (+ 3 test sites).
- **The catalog write path is one shared Zod schema.** `courseInput` (`courses/model/schemas.ts:33`)
  gates both the action `input` and the form resolver; `toCourseRecord` (`courses/api/course-record.ts`)
  is the single create+update payload mapper. The action layer rides these end-to-end unchanged.
- **Two independent read paths for courses.** The board (`shared/api/load-cohort-courses.ts:102`
  `fetchCourses`) and the catalog editor (`courses/api/loader.ts:21`) each select course columns
  separately — both must add `color` for the field to round-trip.
- **The theme is token-driven.** `global.css` uses `:root`/`.dark` raw vars mapped via `@theme
  inline` to `--color-*`. Tailwind v4 ships its full default palette (`--color-rose-100`, …) as
  referenceable theme variables. A `ToggleGroup` primitive already exists in `shared/ui`.
- **`grid-presets.ts` / `cohorts.ts` are the config-enum precedent**: a `VALUES` tuple + display
  list + `z.enum` gate, with the DB column staying plain `text`.

### Key Discoveries

- **The `clone_plan` RPC has an explicit column list** (`20260626120004_clone_plan_with_shelf.sql:97-98`)
  — a new `courses` column is **silently dropped on plan-clone** unless added to both the INSERT and
  the SELECT. This is the one non-obvious persistence touch-point.
- **The catalog hash hand-picks exactly 5 fields** (`compute-catalog-hash.ts:16-22`: `id, teacherKeys,
  studentKeys, hours, weekMode`) with no `...spread` — so `color` cannot affect staleness even if it
  were added to a row. The board's grouping projection (`load-cohort-courses.ts:60-84`) reads only
  those five from course rows; `color` is never read there.
- **Only 3 of the 5 chip painters hold the display map.** `PlacedChip` reads `occupant.name`
  (resolved upstream in `cell-occupants.ts:49` onto `CellOccupant`), and `PaletteCourseChip` takes a
  pre-resolved `name: string` prop. So color reaches those two via `CellOccupant.color` and a new
  `color` prop from their callers — **not** by changing the leaf props in isolation.
- **Additive nullable columns inherit grants + the column-agnostic RLS** (`for all using (true)`) —
  **no GRANT/RLS/default-privileges change is required** (precedent:
  `20260621130000_bi_weekly_week_columns.sql:4-6`).
- **Painter base backgrounds vary:** `PaletteCourseChip` and the cards use `bg-background`;
  member `<li>` rows use no explicit background (transparent). Two `bg-*` utilities cannot be layered
  (see Critical Implementation Details).

## Desired End State

A plan author opens the course form, optionally picks one of 8 swatch colors (or "none"), and saves.
On the plan-detail page that course's chip — on the **board tile, palette chip/grouping box, group
drag overlay, and parked-shelf card** — renders in the chosen color pair (light bg + contrasted
foreground, flipped in dark mode). A chip in a `blocking`/`warning` collision keeps its red/amber
tone (color is suppressed under collisions). Color survives a plan clone, round-trips through the
editor, and **never** changes constraint validation, grouping enumeration, or staleness. CRUD-page
tables (Courses/Students/Teachers) and the app shell are unchanged. Verify: set a color, see it on
all five plan-detail surfaces; clone the plan and confirm color carried; place a colored course into
a collision and confirm the red/amber tone wins; `pnpm check` + `pnpm test` + `pnpm steiger` green.

## What We're NOT Doing

- **No free-form hex / `<input type="color">`.** Representation is a fixed token-key enum only.
- **No color on the CRUD pages.** `CourseTable`, `StudentTable` `ChoiceBadges`, `TeacherTable`
  `AssignmentBadges`, and the `MultiSelect`/dialog course chips are explicitly out of scope. (The
  catalog *read path* still carries `color` so the **editor** can pre-fill the swatch — but the
  table cell is not colored.)
- **No shell/legend work.** There is no subject chip in the app shell today; we add none.
- **No coloring of prose / text-only consumers.** `CollisionDetailsDialog`, placement error banners,
  and the palette-filter option labels read `.name` only and stay uncolored.
- **No auto-assignment.** Color is author-chosen per course; there is no derive-color-from-group rule.
- **No seed colors.** Dev fixtures stay uncolored (NULL); the CSV/transcode/gen-seed pipeline is
  untouched.
- **Not renaming `studentNames` / `teacherNames`.** They share the `Record<string,string>` shape but
  are a different concern — leave them exactly as-is.
- **Not adding `color` to `GroupingCourse`, the catalog hash, or the constraint contract.**

## Implementation Approach

Four phases, ordered by dependency. Each is independently green; the **visible feature only appears
in Phase 4**.

1. **Palette foundation** (pure additive): the config enum + resolver + theme tokens. Nothing consumes
   it yet, so it lands trivially.
2. **Display-map consolidation refactor** (no behavior change): introduce `CourseDisplay` +
   `resolveCourseDisplay()`, rename the board's `names` → `courseDisplay` across all ~24 carriers,
   collapse the 10 duplicated `?? id` fallbacks, and carry the single `CourseDisplay` representation
   through the `computeGroupings` wire. `color` is `null` everywhere (no column yet), so rendering is
   byte-identical.
3. **Data + write/read path**: the nullable column + migration + `clone_plan` + regenerated types;
   the swatch picker + `color` in the write schema/record; both read selects + the assembly that
   fills the **real** color into `courseDisplay`. Color now round-trips and is held on the board — but
   nothing paints yet.
4. **Paint the chips**: render `subjectChipClass(color)` on the 5 plan-detail painters; the subject
   pair **replaces** the `neutral` tone, `blocking`/`warning` keep precedence.

## Critical Implementation Details

- **Tailwind: never layer two `bg-*` utilities.** When a color is present, the subject background
  pair must **replace** the chip's base background (`bg-secondary` on `PlacedChip`'s neutral tone,
  `bg-background` on the palette chip/cards), not be appended after it. Two `bg-*` classes in the
  same element resolve by CSS-cascade order (which utility Tailwind emits later), which is
  non-deterministic from the markup — so resolve the background to a **single** value: e.g. for
  `PlacedChip`, compute the tone class as a 4-way choice
  `blocking ? … : warning ? … : color ? subjectChipClass(color) : "bg-secondary text-secondary-foreground"`
  so exactly one bg/text pair is ever emitted. Member `<li>` rows that have no base background may
  simply add `subjectChipClass(color)` (single bg, safe).
- **Static class strings only.** Tailwind generates a utility only when it sees the literal string,
  so `SUBJECT_CHIP_CLASS` must map each key to a full literal (`"bg-subject-rose
  text-subject-rose-foreground"`) — never a constructed `` `bg-subject-${key}` ``.
- **Isolation invariant (load-bearing).** `color` enters only the display side map
  (`courseDisplay`/`CourseDisplay`). It must **not** be added to `GroupingCourse`
  (`catalog-hash/types.ts:10`), the hand-picked projection in `compute-catalog-hash.ts:16-22`, the
  `load-cohort-courses.ts:60-84` grouping `.map()`, or any `model/collision/**` type. The board's
  grouping projection and the hash read course rows independently of the display map, so adding
  `color` to the `fetchCourses` select is safe **as long as it is consumed only into the `colors`
  half of `courseDisplay`**, never into a `GroupingCourse`.
- **The `clone_plan` column-list trap.** Adding `color` to the table without adding it to
  `clone_plan`'s INSERT **and** SELECT (`…:97-98`) silently drops it on clone. The clone must carry
  the color (Phase 3).

## Phase 1: Palette Foundation

### Overview

Add the color config enum + class resolver and the paired theme tokens. Pure additive — no consumer
yet, so CI is green by construction. This makes `SubjectColor` available to Phase 2's `CourseDisplay`
type and the `bg-subject-*` utilities available to Phase 4's painters.

### Changes Required

#### 1. Subject-color config (the enum + gate + resolver)

**File**: `src/shared/config/subject-colors.ts` (new)

**Intent**: Single-source the fixed 8-hue palette as the codebase's standard config enum, mirroring
`grid-presets.ts`/`cohorts.ts`: a `VALUES` tuple, a `SubjectColor` type, a display list (value +
human label) for the picker, a shared Zod gate, a defensive coercion from a stored `string | null`,
and the static class lookup that resolves a key to its paired chip classes.

**Contract**: Exports — `SUBJECT_COLOR_VALUES = ["rose","amber","emerald","sky","violet","teal",
"orange","indigo"] as const`; `type SubjectColor = (typeof SUBJECT_COLOR_VALUES)[number]`;
`SUBJECT_COLORS: readonly { value: SubjectColor; label: string }[]`; `subjectColorSchema =
z.enum(SUBJECT_COLOR_VALUES)`; `toSubjectColor(value: string | null): SubjectColor | null` (returns
the key if it's a member, else `null` — defensive against manual DB edits, mirrors `toGroupIndex`);
and the resolver:

```ts
const SUBJECT_CHIP_CLASS: Record<SubjectColor, string> = {
  rose: "bg-subject-rose text-subject-rose-foreground",
  amber: "bg-subject-amber text-subject-amber-foreground",
  // …one literal entry per value
};
/** Paired chip classes for a color key; "" when no color (caller keeps its default background). */
export const subjectChipClass = (color: SubjectColor | null): string => (color ? SUBJECT_CHIP_CLASS[color] : "");
```

Re-export `subjectColorSchema`, `SubjectColor`, `SUBJECT_COLORS`, `subjectChipClass`, `toSubjectColor`
from the `src/shared/config` barrel alongside the existing config exports.

#### 2. Paired theme tokens

**File**: `src/app/styles/global.css`

**Intent**: Define, for each of the 8 hues, a background/foreground token pair that flips per
light/dark, sourced from Tailwind v4's built-in OKLCH palette variables, then map them into the
`@theme inline` block so Tailwind generates `bg-subject-<hue>` / `text-subject-<hue>-foreground`
utilities.

**Contract**: For each hue add three declarations — light shade bg + dark shade fg in `:root`, the
flip in `.dark`, and the `--color-*` map entries in `@theme inline`:

```css
/* :root */         --subject-rose: var(--color-rose-100); --subject-rose-foreground: var(--color-rose-900);
/* .dark */         --subject-rose: var(--color-rose-900); --subject-rose-foreground: var(--color-rose-100);
/* @theme inline */ --color-subject-rose: var(--subject-rose); --color-subject-rose-foreground: var(--subject-rose-foreground);
```

Repeat for all 8. Contrast is designed-in (light-100 bg vs same-hue-900 fg, flipped in dark) → AA by
construction, no luminance helper needed. (`indigo` uses the same `indigo-100/900` pattern. Note: a
desaturated-gray hue such as `slate` is deliberately **avoided** — it reads almost identically to the
uncolored `bg-secondary` chip, defeating at-a-glance distinction.)

#### 3. Config test

**File**: `src/shared/config/subject-colors.test.ts` (new)

**Intent**: Pin the enum membership, the `subjectColorSchema` accept/reject behavior, `toSubjectColor`
coercion (valid key → key, unknown/`null` → `null`), and that `subjectChipClass` returns a non-empty
literal for every value and `""` for `null`.

**Contract**: Vitest unit cases; assert `SUBJECT_CHIP_CLASS` has an entry for every
`SUBJECT_COLOR_VALUES` member (no missing/extra keys).

### Success Criteria

#### Automated Verification

- [ ] Type-check passes: `pnpm check`
- [ ] Config unit tests pass: `pnpm test -- subject-colors`
- [ ] Lint + structure pass: `pnpm lint && pnpm steiger`
- [ ] Build is clean: `pnpm build`

#### Manual Verification

- [ ] In dev, a throwaway element with `class="bg-subject-rose text-subject-rose-foreground"` renders
      a legible rose chip in **both** light and dark themes (confirms tokens + Tailwind generation).

---

## Phase 2: Display-Map Consolidation Refactor

### Overview

Replace the board's bare-string display map with a richer per-course display object and a canonical
resolver, with **no behavior change**. `color` is structurally present but `null` everywhere (no
column yet), so every chip renders exactly as before. This is the safe, isolated refactor the
research mandates before color is wired in. Land it green on its own.

> **Execute this as a whole-file rename, not a line-targeted sed.** The footprint below enumerates the
> type-annotation **carriers** and the dedupable **`?? id` reads** only (~24 + 10). `names` actually
> appears on ~60–70 production lines once destructures, prop-passes, and call args are counted (e.g.
> `PlannerBoard.tsx:126,136,210,213,229,242,255`; the `CollisionDetailsDialog` prop-passes;
> `PaletteBody.tsx:31,40,47,56,58,73,106`) — all inside the files already listed, so renaming every
> `names` occurrence in each listed file is the right unit of work. `pnpm check` (2.1) is the backstop
> for any straggler.

### Changes Required

#### 1. The display value type + resolver

**File**: `src/_pages/plan-detail/model/course-display.ts` (new)

**Intent**: Define the per-course display object and the single resolver that collapses the 10
duplicated `names[id] ?? id` fallbacks.

**Contract**:

```ts
export type CourseDisplay = { name: string; color: SubjectColor | null };
/** Canonical edge resolver — replaces the scattered `names[id] ?? id`. Missing id → name = id, no color. */
export const resolveCourseDisplay = (map: Record<string, CourseDisplay>, id: string): CourseDisplay =>
  map[id] ?? { name: id, color: null };
```

#### 2. Root map type + assembly (Map form)

**File**: `src/shared/lib/catalog-hash/types.ts`, `src/shared/api/load-cohort-courses.ts`

**Intent**: Rename `CohortCatalog.names: Map<string,string>` → `courseDisplay: Map<string,
CourseDisplay>` and build it at the assembly point with `name` (via `compositeName`) and `color: null`
(real color arrives in Phase 3).

**Contract**: `types.ts:31` field rename + type change. `load-cohort-courses.ts:87` becomes
`new Map(courses.map((c) => [c.id, { name: compositeName(courseById.get(c.id)), color: null }]))`; the
returned object key renames `names` → `courseDisplay`. **Do not** touch the `GroupingCourse`
projection (`:60-84`) or the `fetchCourses` select — color stays out of the constraint half.

#### 3. Record conversion + board prop threading

**File**: `src/_pages/plan-detail/api/load.ts`, `src/_pages/plan-detail/model/drag.ts`,
`src/_pages/plan-detail/model/cross-cohort/assemble-combined-props.ts`,
`src/_pages/plan-detail/ui/PlannerBoard.tsx`, `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx`,
`src/_pages/plan-detail/model/use-cohort-board-state.ts`

**Intent**: Rename the `Record<string,string>` carrier to `courseDisplay: Record<string,
CourseDisplay>` across the ~22 typed annotations and the structural `CohortBoardState`, and the
`overlayNames` merge. Pure rename + type widen; no logic change.

**Contract**: `load.ts:110,120` → `courseDisplay: Object.fromEntries(dpNCatalog.courseDisplay)`;
`PlannerBoard.tsx:76` `overlayNames` → `overlayCourseDisplay = useMemo(() => ({ ...dp1.courseDisplay,
...dp2.courseDisplay }), …)`. Rename every `names:` prop/field annotation listed in the footprint
(drag.ts:55; assemble-combined-props.ts:15; PlannerGrid.tsx:47; CombinedPalettePanel.tsx:21;
PaletteBody.tsx:17,77,102; GroupingBox.tsx:13; GroupingFilter.tsx:22; ShelfDrawer.tsx:13;
ParkedBundleCard.tsx:12; GroupDragOverlay.tsx:11,55; CollisionDetailsDialog.tsx:17,77,197,207;
companion-course-options.ts:18; leading-course-options.ts:18; cell-occupants.ts:29,45;
placement-transitions.ts:139; use-cohort-board-state.ts:223). **Leave `studentNames`/`teacherNames`
untouched.**

#### 4. Collapse the 10 production read sites through the resolver

**File**: `cell-occupants.ts`, `placement-transitions.ts`, `leading-course-options.ts`,
`GroupingBox.tsx`, `PaletteBody.tsx`, `GroupDragOverlay.tsx`, `ParkedBundleCard.tsx`,
`CollisionDetailsDialog.tsx`

**Intent**: Replace each `names[id] ?? id` with `resolveCourseDisplay(courseDisplay, id).name` (text
sites) — Phase 2 reads only `.name`, so behavior is identical. `cell-occupants.ts` `toOccupant`
resolves via the helper and stores `.name` on `CellOccupant` (the `.color` field on `CellOccupant`
is added in Phase 4, where it's painted). Occupant sort by `name` (`cell-occupants.ts:55-57`) is
unchanged.

**Contract**: 10 production sites (cell-occupants.ts:49; placement-transitions.ts:141;
leading-course-options.ts:26; GroupingBox.tsx:41,72; PaletteBody.tsx:87; GroupDragOverlay.tsx:65;
ParkedBundleCard.tsx:76; CollisionDetailsDialog.tsx:94,198) now route through `resolveCourseDisplay`.

#### 5. Compute-wire single representation + tests

**File**: `src/_pages/plan-detail/api/grouping-compute.ts`,
`src/_pages/plan-detail/api/endpoint.integration.test.ts`,
`src/_pages/plan-detail/api/adapter-parity.integration.test.ts`, and the unit-test fixtures that
build `names` literals

**Intent**: Carry the single `CourseDisplay` representation across the `computeGroupings` Action
boundary (no second name-only shape), and update the tests that assert on the wire map.

**Contract**: `grouping-compute.ts:34,49` destructure/return `courseDisplay` (the
`Map<string,CourseDisplay>`); `ComputeGroupingsResult` carries `courseDisplay`. Integration tests:
`endpoint.integration.test.ts:130` → `…courseDisplay.get(id)?.name ?? id`, and `:131` `.startsWith`
operates on the resolved names; `adapter-parity.integration.test.ts:58,60` → `…get(course.id)?.name`.
Update unit fixtures that pass `names` literal maps (`assemble-combined-props.test.ts:19,71,72`;
`use-cohort-board-state.test.tsx:80,142`; `companion-course-options.test.ts:13`;
`cell-occupants.test.ts:18,28,53`; `CombinedPalettePanel.test.tsx:149`;
`leading-course-options.test.ts:30`; `placement-transitions.test.ts:218,223,231`) to `{ name, color: null }`
values under the renamed key. The last two pass a bare `Record<string,string>` literal **positionally** into
`leadingCourseOptions` / `placementErrorMessage` (whose `names` param is retyped here), so they break gates
2.1/2.2 until updated — they are easy to miss because they hold no `names:` key.

### Success Criteria

#### Automated Verification

- [ ] Type-check passes: `pnpm check`
- [ ] Unit tests pass: `pnpm test`
- [ ] Integration tests pass (wire-map assertions updated): `pnpm test:integration`
- [ ] Lint + structure pass: `pnpm lint && pnpm steiger`
- [ ] Build is clean: `pnpm build`

#### Manual Verification

- [ ] Plan-detail board, palette, grouping boxes, drag overlay, and parked shelf render **identically**
      to before (names unchanged, ordering unchanged) — this phase is invisible to the user.
- [ ] A grouping drag still shows correct member names in the overlay; collision dialog still lists
      course names; placement-error banners still name the offending courses.

---

## Phase 3: Data + Write/Read Path

### Overview

Add the nullable `color` column and persistence (migration, `clone_plan`, regenerated types), the
swatch picker + write path, and both read paths so `color` round-trips end-to-end and the board's
`courseDisplay` carries the **real** color. Nothing paints yet (Phase 4), but the editor shows and
saves the swatch and the data is present on the board map.

### Changes Required

#### 1. Schema migration (additive, nullable)

**File**: `supabase/migrations/<timestamp>_courses_color.sql` (new — via `pnpm exec supabase
migration new courses_color`)

**Intent**: Add a nullable `color text` column to `courses`. No GRANT/RLS/default-privilege change
(additive nullable column inherits them).

**Contract**: `alter table public.courses add column color text;` (stores the enum key or NULL). No
DB-level check constraint — the enum is app-gated via Zod (consistent with `level`/`week_mode` being
plain text gated in app code).

#### 2. `clone_plan` carries color

**File**: `supabase/migrations/<timestamp>_clone_plan_carry_color.sql` (new)

**Intent**: Re-define `clone_plan` so a cloned plan preserves each course's color (the explicit
column list otherwise drops it).

**Contract**: Copy the current `clone_plan` body, adding `color` to **both** the courses INSERT column
list and the SELECT (`…:97-98` equivalent: `insert into public.courses (…, week_mode, color) select
…, c.week_mode, c.color …`).

#### 3. Regenerate generated types

**File**: `src/shared/api/database.types.ts`

**Intent**: Regenerate so `courses.Row/Insert/Update` include `color: string | null`.

**Contract**: Run `pnpm exec supabase gen types typescript --local > src/shared/api/database.types.ts`
(after `supabase db reset` applies the new migrations locally); commit the regenerated artifact.

#### 4. Write schema + record

**File**: `src/_pages/courses/model/schemas.ts`, `src/_pages/courses/api/course-record.ts`

**Intent**: Add an optional/nullable `color` to the shared `courseInput`; map it onto the row in
`toCourseRecord` (covers create + update; the action layer is unchanged).

**Contract**: `courseInput` gains `color: subjectColorSchema.nullable().default(null)` (so "none" =
`null`). `toCourseRecord` adds `color: input.color`. `CourseFormValues`/`CourseInput`/
`updateCourseInput` inherit it.

#### 5. Swatch picker in the form

**File**: `src/_pages/courses/ui/CourseFormDialog.tsx`, and the two default-value helpers within it

**Intent**: Add an optional swatch picker `FormField` bound to `color`, built on the existing
`ToggleGroup` primitive — a row of swatches (one per `SUBJECT_COLORS` entry, each previewing
`bg-subject-<hue>`) plus a "None" option; selecting "None" sets `color: null`. Pre-fill from the
edited course.

**Contract**: New `FormField name="color"` rendering a single-select `ToggleGroup` (value =
`field.value ?? "none"`, `onValueChange` maps `"none"` → `null`). `courseFormValues` (`:269`) adds
`color: course.color`; `emptyCourseFormValues` (`:280`) adds `color: null`. Add `color` to the form's
shared-UI imports as needed.

**Accessibility (required, not optional)**: each swatch is an icon-only control, so it MUST carry an
accessible name — `aria-label` from `SUBJECT_COLORS[i].label` ("Rose", "Amber", …) plus the "None"
option labeled "No color" — and expose its selected/pressed state (`ToggleGroupItem` does this via
`data-state`/`aria-pressed`). This is required for screen-reader users **and** is the only way a
role-based test or the form itself can locate a swatch (the e2e suite forbids CSS/DOM selectors). Color
is decorative, so do **not** encode the hue into any chip's accessible name elsewhere — only the picker
controls are named.

#### 6. Catalog read path (editor pre-fill only — no table cell)

**File**: `src/_pages/courses/model/course.ts`, `src/_pages/courses/api/loader.ts`

**Intent**: Carry `color` into `CourseRow` so the editor pre-fills the swatch. The table is **not**
colored (out of scope).

**Contract**: `CourseRow` gains `color: SubjectColor | null`. `loader.ts:21` select adds `color`; row
mapping adds `color: toSubjectColor(c.color)`.

#### 7. Board read path + fill the real color into `courseDisplay`

**File**: `src/shared/api/load-cohort-courses.ts`

**Intent**: Select `color` in the board's `fetchCourses` and build the real color into the
`courseDisplay` assembly — into the **display half only**, never the `GroupingCourse` projection.

**Contract**: `fetchCourses` select (`:106`) adds `color`; the local `CourseRow` type (`:93`) adds
`color: string | null`; the assembly (`:87`) becomes `{ name: compositeName(c), color:
toSubjectColor(courseById.get(c.id)?.color ?? null) }`. The `GroupingCourse` `.map()` (`:60-84`) is
**unchanged**.

#### 8. Write-path tests

**File**: `src/_pages/courses/model/schemas.test.ts`, `src/_pages/courses/api/update-course.test.ts`

**Intent**: Extend validation cases (valid color key accepted, unknown rejected, absent → `null`) and
the update fixture to carry `color`.

**Contract**: Add `color` to the `validCourse` fixture and an invalid-color case; assert
`toCourseRecord` emits `color`.

#### 9. Integration tests — persistence round-trip, clone carry, isolation

**File**: the integration harness (`*.integration.test.ts`) — extend the existing course/clone
suites where present, else add focused files

**Intent**: Cover the three cross-layer behaviors that pass type-check + unit tests but break only at
the DB/SQL/SSR seam — so they are **never** left to manual sign-off (per `lessons.md:33-37`).

**Contract**: Three integration cases, each building state via `src/test/factories/` and tearing down
via `teardown`:
1. **Round-trip** — create/update a course with a color key, then read it back through **both** read
   paths (`loadCohortCourses` board map carries it on `courseDisplay`; the catalog `loadCatalog`
   `CourseRow.color` carries it). Proves column + both selects + assembly.
2. **Clone carry** — clone a plan whose course has a color; assert the cloned course's color matches
   (guards the `clone_plan` explicit-column-list silent-drop trap).
3. **Isolation (behavioral)** — compute groupings (stores `catalog_hash`), edit **only** a course's
   color, re-evaluate staleness; assert **not stale**. This is the writable form of the isolation
   invariant (color can't be varied inside a `GroupingCourse`, so a "color doesn't change the hash"
   unit test isn't expressible — this proves it end-to-end through the real hash compare instead).

### Success Criteria

#### Automated Verification

- [ ] Local DB applies cleanly: `pnpm exec supabase db reset` (migrations + seed)
- [ ] Generated types include `color`: `pnpm check` passes against `toCourseRecord` + both loaders
- [ ] Unit tests pass: `pnpm test`
- [ ] Integration: color round-trips through both loaders: `pnpm test:integration`
- [ ] Integration: `clone_plan` carries color (silent-drop guard): `pnpm test:integration`
- [ ] Integration: a color-only edit leaves groupings **non-stale** (isolation): `pnpm test:integration`
- [ ] Lint + structure pass: `pnpm lint && pnpm steiger`
- [ ] Build is clean: `pnpm build`

#### Manual Verification

- [ ] Editing a course shows the swatch picker; picking a color and saving persists it (re-open the
      editor → swatch pre-selected). Picking "None" clears it. (Persistence itself is covered by the
      round-trip integration test; this confirms the *UI* feel.)
- [ ] The Courses **table** is visually unchanged (no color cell) — confirms scope.
- [ ] No color appears on the board yet (painting is Phase 4) — confirms data/visual separation.
- [ ] Swatches are keyboard-reachable and screen-reader-named ("Rose", …, "No color").

---

## Phase 4: Paint the Chips

### Overview

Render the subject color on the 5 plan-detail painters. The subject pair **replaces** the `neutral`
tone; `blocking`/`warning` collision tones keep precedence (color suppressed under collisions for
legibility). This is the phase the user sees.

### Changes Required

#### 1. `CellOccupant` carries color; `PlacedChip` paints the neutral tone

**File**: `src/_pages/plan-detail/model/collision/cell-occupants.ts`,
`src/_pages/plan-detail/ui/grid/slot-cell/PlacedChip.tsx`

**Intent**: Add `color` to `CellOccupant` (resolved in `toOccupant` via `resolveCourseDisplay`), and
in `PlacedChip` choose the chip background as a single value so the subject pair replaces the neutral
`bg-secondary` without layering a second `bg-*`. Collision tones override.

**Contract**: `CellOccupant` gains `color: SubjectColor | null`; `toOccupant` sets `color:
resolveCourseDisplay(courseDisplay, placement.courseId).color`. In `PlacedChip`, replace the
`chipTone({ tone })` call with a tone resolution that yields exactly one bg/text pair:

```ts
const toneClass = blocking
  ? "border-destructive bg-destructive/10 text-destructive"
  : warning
    ? "border-warning bg-warning/10 text-warning"
    : color
      ? subjectChipClass(color)        // colored neutral
      : "bg-secondary text-secondary-foreground"; // plain neutral
```

(keep the shared layout part of `chipTone` — `flex items-center gap-1 rounded-md border px-1.5 py-1
text-xs shadow-xs` — and compose `toneClass` after it). Border/foreground come from the subject pair
for colored neutral; collisions keep their border/bg/text.

#### 2. `PaletteCourseChip` + `GroupingBox.MemberRow` take a `color` prop

**File**: `src/_pages/plan-detail/ui/palette/PaletteCourseChip.tsx`,
`src/_pages/plan-detail/ui/palette/GroupingBox.tsx`, `src/_pages/plan-detail/ui/palette/PaletteBody.tsx`

**Intent**: Thread `color` to the two pre-resolved leaf painters and apply the subject pair,
replacing `bg-background` when a color is set.

**Contract**: `PaletteCourseChip` Props gain `color?: SubjectColor | null`; when set, substitute the
base `bg-background` with `subjectChipClass(color)` (single bg — do not keep both). `GroupingBox`
passes `color` from `resolveCourseDisplay(courseDisplay, memberId).color` at its singleton chip
(`:41`) and `MemberRow` (`:72`, add a `color` prop on `MemberRow`); `PaletteBody`'s
`PromotedCourseChip` (`:87`) passes `color` likewise.

#### 3. Group drag overlay + parked shelf member rows

**File**: `src/_pages/plan-detail/ui/overlay/GroupDragOverlay.tsx`,
`src/_pages/plan-detail/ui/shelf/ParkedBundleCard.tsx`

**Intent**: Color the member `<li>` rows in the overlay and the parked card. These rows have no base
background, so adding `subjectChipClass(color)` is a single-bg, safe add.

**Contract**: `OverlayCard` resolves `resolveCourseDisplay(courseDisplay, courseId)` for both `.name`
and `.color`, applying `subjectChipClass(color)` to the `<li>` (`:64`). `ParkedBundleCard` likewise on
its member `<li>` (`:75-76`).

#### 4. Painter visual tests

**File**: co-located `*.test.tsx` for `PlacedChip` (and/or `cell-occupants.test.ts`)

**Intent**: Assert the color→class mapping: a colored neutral occupant yields the subject classes; a
`blocking`/`warning` occupant yields the collision classes **regardless of color** (precedence); a
null-color neutral yields `bg-secondary`.

**Contract**: Unit assertions on the resolved `className` / `toOccupant` output for the
color×tone matrix.

#### 5. Isolation E2E (browser-level capstone)

**File**: `e2e/specs/subject-color-isolation.spec.ts` (new), reusing `support/planner.ts` +
`support/catalog.ts`

**Intent**: The one browser-level proof that color is out of the staleness path **through real
workerd SSR** — the dimension neither unit nor integration covers (the SSR load-path hash). Mirror
`e2e/specs/grouping-staleness.spec.ts`, but assert the **negative**: a color-only edit does **not**
make the palette stale. Per `e2e/CLAUDE.md:42-43`, chip color itself is unit-tested and **never
selected on** — this spec asserts a business outcome via roles (Recompute panel absent, palette chip
present), not pixels.

**Contract**: Authenticated `chromium` project; spec owns a uniquely-named plan and tears it down by
deleting it. Steps: create a placeable DP1 course → `computeGroupings` (palette chip lands, Recompute
absent) → edit **only** the course's color via the swatch picker → `gotoStable` reload the board →
assert `recomputeButton` has count 0 and the palette chip is still visible. (Add an `editCourseColor`
helper local to the spec; promote to `support/catalog.ts` only if a second spec needs it.) Color is
not asserted (it's not in the a11y tree); the staleness *absence* is the assertion.

### Success Criteria

#### Automated Verification

- [ ] Type-check passes: `pnpm check`
- [ ] Unit tests pass (incl. color×tone precedence): `pnpm test`
- [ ] Integration tests pass: `pnpm test:integration`
- [ ] Isolation E2E passes (color edit ⇏ stale): `pnpm test:e2e -- subject-color-isolation`
- [ ] Lint + structure pass: `pnpm lint && pnpm steiger`
- [ ] Build is clean: `pnpm build`

#### Manual Verification

- [ ] A colored course shows its color on the **board tile, palette chip, grouping-box member rows,
      group drag overlay, and parked-shelf card** — all five surfaces — in both light and dark themes.
- [ ] A colored chip placed into a **collision** shows the red/amber tone (color suppressed); removing
      the collision restores the subject color.
- [ ] An uncolored course renders exactly as today (neutral `bg-secondary`).
- [ ] Drag a single colored course and a colored grouping — the drag preview/overlay shows the color.
- [ ] No regression in chip ordering, collision badges, A/B toggles, or remove buttons.
- [ ] Drag-drop validation still feels instant (<200ms) — color did not enter the constraint core.

---

## Testing Strategy

### Unit Tests

- `subject-colors.test.ts`: enum membership, schema accept/reject, `toSubjectColor` coercion,
  `SUBJECT_CHIP_CLASS` completeness, `subjectChipClass(null) === ""`.
- `course-display.test.ts`: `resolveCourseDisplay` returns the entry when present and `{ name: id,
  color: null }` when absent.
- `cell-occupants.test.ts` / `PlacedChip` test: color×tone matrix — colored neutral → subject pair;
  blocking/warning → collision tone regardless of color; null neutral → `bg-secondary`.
- `schemas.test.ts` / `update-course.test.ts`: `color` validation + `toCourseRecord` emission.

### Integration Tests (mandatory — not deferred to manual, per `lessons.md:33-37`)

- Existing `endpoint.integration.test.ts` + `adapter-parity.integration.test.ts` updated to the
  single `courseDisplay` wire representation (`get(id)?.name`).
- **Round-trip**: a colored course read back through both loaders (board + catalog).
- **Clone carry**: `clone_plan` preserves color (the silent-drop guard).
- **Isolation (behavioral)**: a color-only edit leaves groupings non-stale — the writable form of
  "color is out of the hash" (a direct unit test isn't expressible, since `color` is never a field on
  `GroupingCourse`). `compute-catalog-hash.test.ts` still pins the digest as a belt-and-suspenders
  guard against anyone adding a field to the hashed projection.

### E2E Tests

- **One spec only**: `subject-color-isolation.spec.ts` — a color-only edit does **not** make the
  palette go stale (Recompute panel absent through real SSR). This is the sole browser-level test;
  chip color correctness is unit-tested and deliberately **not** asserted in the browser
  (`e2e/CLAUDE.md:42-43`: visual-state/tone is unit-tested, never selected on). No color-painting E2E.

### Manual Testing Steps

1. Open a course in the editor → pick a swatch → save → re-open → swatch pre-selected.
2. View the plan-detail board → the course's chip shows the color across all 5 surfaces, light + dark.
3. Place the course into a collision → red/amber tone wins; clear the collision → color returns.
4. Pick "None" → chip reverts to neutral.
5. Clone the plan → colors carried.
6. Confirm the Courses/Students/Teachers tables are uncolored (scope).

## Performance Considerations

Color is display-only and resolved at the render edge from a static class lookup — no runtime color
computation, no new queries beyond one extra selected column on two existing reads. It never enters
the constraint/collision core, the catalog hash, or grouping enumeration, so the <200ms drag-drop
validation budget is provably untouched (the hash hand-picks 5 fields; `color` is not among them).

## Migration Notes

- The `color` column is additive + nullable → no data backfill, no GRANT/RLS change. Existing rows
  read as `NULL` (uncolored), preserving today's behavior.
- `clone_plan` is re-defined (not altered) in a new migration to carry `color`; a code rollback does
  not undo an applied migration, but the column is nullable and unused by older code, so it is
  forward/backward compatible.
- Regenerated `database.types.ts` is a committed artifact — re-commit after `gen types`.

## References

- Research: `context/changes/subject-colors/research.md` (decisions RESOLVED 2026-06-30; footprint
  inventory of the `names` carrier)
- Config-enum precedent: `src/shared/config/grid-presets.ts`, `src/shared/config/cohorts.ts`
- Side-map display pattern: `src/_pages/plan-detail/model/collision/cell-occupants.ts:13-49`
- Token mechanism + `color-mix` precedent: `src/app/styles/global.css:8-147`
- Clone RPC column-list trap: `supabase/migrations/20260626120004_clone_plan_with_shelf.sql:97-98`
- Isolation guarantee: `src/shared/lib/catalog-hash/compute-catalog-hash.ts:13-27`
- Lessons: semantic tokens (`lessons.md:12-16`), detokenize-on-add (`:26-30`), single transport
  (`:19-24`), `astro check` gate (`:54-59`), identity-opaque/display-at-edges (`:5-10`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Palette Foundation

#### Automated

- [x] 1.1 Type-check passes: `pnpm check` — 527a5c4
- [x] 1.2 Config unit tests pass: `pnpm test -- subject-colors` — 527a5c4
- [x] 1.3 Lint + structure pass: `pnpm lint && pnpm steiger` — 527a5c4
- [x] 1.4 Build is clean: `pnpm build` — 527a5c4

#### Manual

- [x] 1.5 A `bg-subject-rose text-subject-rose-foreground` element is legible in light + dark — 527a5c4

### Phase 2: Display-Map Consolidation Refactor

#### Automated

- [x] 2.1 Type-check passes: `pnpm check` — aa83014
- [x] 2.2 Unit tests pass: `pnpm test` — aa83014
- [x] 2.3 Integration tests pass (wire-map assertions updated): `pnpm test:integration` — aa83014
- [x] 2.4 Lint + structure pass: `pnpm lint && pnpm steiger` — aa83014
- [x] 2.5 Build is clean: `pnpm build` — aa83014

#### Manual

- [x] 2.6 Plan-detail board/palette/overlay/shelf render identically to before (invisible refactor) — aa83014
- [x] 2.7 Grouping overlay names, collision dialog, and error banners still name courses correctly — aa83014

### Phase 3: Data + Write/Read Path

#### Automated

- [x] 3.1 Local DB applies cleanly: `pnpm exec supabase db reset`
- [x] 3.2 Generated types include `color`; `pnpm check` passes against record + loaders
- [x] 3.3 Unit tests pass: `pnpm test`
- [x] 3.4 Integration: color round-trips through both loaders: `pnpm test:integration`
- [x] 3.5 Integration: `clone_plan` carries color (silent-drop guard): `pnpm test:integration`
- [x] 3.6 Integration: color-only edit leaves groupings non-stale (isolation): `pnpm test:integration`
- [x] 3.7 Lint + structure pass: `pnpm lint && pnpm steiger`
- [x] 3.8 Build is clean: `pnpm build`

#### Manual

- [x] 3.9 Editor swatch UI feel: pick a color/"None", confirm it round-trips on re-open
- [x] 3.10 Courses table unchanged (no color cell); board not yet painted
- [x] 3.11 Swatches keyboard-reachable + screen-reader-named ("Rose", …, "No color")

### Phase 4: Paint the Chips

#### Automated

- [ ] 4.1 Type-check passes: `pnpm check`
- [ ] 4.2 Unit tests pass (incl. color×tone precedence): `pnpm test`
- [ ] 4.3 Integration tests pass: `pnpm test:integration`
- [ ] 4.4 Isolation E2E passes (color edit ⇏ stale): `pnpm test:e2e -- subject-color-isolation`
- [ ] 4.5 Lint + structure pass: `pnpm lint && pnpm steiger`
- [ ] 4.6 Build is clean: `pnpm build`

#### Manual

- [ ] 4.7 Colored course shows on all 5 plan-detail surfaces, light + dark
- [ ] 4.8 Collision tone overrides color; clearing the collision restores it
- [ ] 4.9 Uncolored course renders neutral as today; drag previews show color
- [ ] 4.10 No regression in ordering/badges/toggles; drag-drop still <200ms
