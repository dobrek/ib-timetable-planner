# First Valid Drop with Validation (S-01) Implementation Plan

## Overview

Build the northstar slice: the first interactive UI of the timetable planner. The author opens a plan, filters the pre-seeded Year-1 groupings to those containing a **leading course** they want to schedule, and pulls **individual courses** out of a grouping "box" (a hint of co-runnable companions) onto a **10 periods × 5 days** slot grid — placing one course, then optionally its companions next to it. Each drop gets an immediate, reactive **collision** verdict per cell plus a read-only "hours placed / required" counter. Drops always land and are flagged when they collide (accept-and-flag); placements persist across reloads.

This slice exists to prove the PRD's core hypothesis: that the online validator delivers feedback well inside the **≤200 ms** budget in the workerd runtime, and that the "feel of the puzzle" holds. The validator itself already exists (`src/lib/grouping/collision.ts`); the work here is the UI, the persistence path, and wiring the validator in as a _reactive per-cell derivation_.

## Current State Analysis

- **The grouping/collision core is done.** `hasIntersection(course, list)` (`src/lib/grouping/collision.ts:3`) is pure, synchronous, edge-safe, and flags an intersection on shared `studentKeys` **or** shared `teacherKey` (S-01 reuses it verbatim and surfaces both under one generic "collision" label). `GroupingCourse` / `GroupingVariant` / `GroupingResult` types (`src/lib/grouping/types.ts:1`) are the palette's data contract.
- **The schema is ready.** `placements (variant_id, cohort_id, day, period, course_id)` with `placements_unique` (`migration:124`) enforces one course-hour per cell; `course_groupings` + `course_grouping_members` (`migration:131`) hold the palette hints. RLS grants full access to the `authenticated` role.
- **The grouping compute+persist endpoint exists.** `POST /api/grouping` (`src/pages/api/grouping.ts:17`) takes `{ planId, cohortId }`, computes, persists deduped member-sets to `course_groupings`, and returns `{ groupings, names, catalogHash, warnings }`. We reuse it verbatim for the empty-state bootstrap.
- **Island + UI conventions are established.** React islands mount via `client:load` with props from Astro frontmatter (`src/pages/auth/signin.astro:16`). UI idiom: `cn()` (`src/lib/utils.ts:4`), `cva` + Radix `Slot` + `asChild` + `data-slot` (`src/components/ui/button.tsx`), lucide icons at `size-4`.
- **The Supabase client is server-only** (`src/lib/supabase.ts:6`, `@supabase/ssr` cookie-tunneled session). Islands cannot touch the DB directly — all reads happen in Astro frontmatter, all writes go through API routes.
- **Seed gap.** `supabase/seed.sql` provides the cohorts (Y1 `5c7cce84-…`, Y2), one plan (`Seed Plan`, `b0c03e8e-…`, preset `5x8`), one variant (`Draft 1`, `9a5dccba-…`), courses, students, and choices — but **zero `course_groupings` and zero `placements`**. The palette is empty until groupings are computed.

### Key Discoveries:

- **The validator is reactive, not one-shot.** Collision state is a _derived per-cell computation_ over placement state — recomputed on every add/move/remove so a flag auto-clears when any participant leaves the cell. `onDragEnd` only mutates placement state; it does not capture a verdict (`research.md` Architecture Insights; `collision.ts:3`).
- **The course is the unit; the grouping is a hint box.** A grouping is rendered as an expandable box of co-runnable courses; the author pulls **individual courses** out of it onto cells, one course-hour per drop. There is **no whole-group bulk-drop** — the box only suggests companions, it never binds them. No grouping identity is stored on a `placements` row. The author may pull two courses from group A and others from group B; identity is the course, not the group.
- **Groupings are filtered by a leading course (membership, not seed).** Persistence dedups groupings to bare member-sets (`persist.ts:60`, `toDistinctMemberSets`) and drops the algorithm's `seedId`, so `course_groupings` has no seed column. The filter therefore shows groupings that _contain_ a chosen course — no schema or persist change.
- **Hour-grain placements.** One `placements` row = one hour of a course in a cell. A multi-hour course = N rows across N cells. Hours-placed = count of rows for a course vs `courses.hours_per_week`. Merge-children legitimately carry 0 standalone hours.
- **Two non-interchangeable dnd-kit lines.** Use `@dnd-kit/react` (current, React-19-official), **not** the legacy `@dnd-kit/core`. Pin the exact 0.x version.
- **Persisted vs returned grouping shape differ.** `POST /api/grouping` returns `GroupingResult[]` (per-seed variants) but persists _deduped member-sets_ to `course_groupings`. Rendering the palette from the DB (after a reload) keeps a single render path and avoids reconciling the two shapes.

## Desired End State

Navigating to `/plans/<seed-plan-id>` (authenticated) renders a 10×5 grid and a palette of Y1 grouping boxes. If no groupings exist yet, an empty-state "Compute groupings" button bootstraps them via `POST /api/grouping` and reloads. The author can filter the palette to groupings containing a chosen leading course, expand a grouping box, and drag an **individual course** from it onto a cell (one course-hour per drop); placed courses can be moved cell-to-cell or removed via a "×" control on the chip. Cells with a collision are outlined and each conflicting course chip is badged with a "collision" label; the flag clears reactively when any participant is moved out. Each course in the palette shows "placed / required" hours. All placements persist across reloads. Verifiable: a colliding drop lands + flags within the ≤200 ms feel; a reload shows the same grid; `pnpm test` covers the pure derivations; `pnpm build`/`lint` pass.

## What We're NOT Doing

- **Cross-cohort classes** — S-09. S-01 is a single cohort (Y1). Because the derivation reuses `hasIntersection` verbatim, a shared-teacher pair within the cohort is also flagged — surfaced under one generic "collision" label. The dedicated teacher-collision class with its own attribution/UX is still S-03.
- **Hard completeness enforcement / finalize gate** — the hours counter is read-only here; blocking finalize on "all hours placed + zero collisions" is PRD Q9, deferred.
- **The full "Compute groupings" management UI** (re-compute on catalog change, staleness badges) — that is S-06. We ship only a single bootstrap button gated behind the empty state.
- **Keyboard / screen-reader DnD parity** — PRD Q11, deferred. We ship drag-only but keep the data model and handlers a11y-ready.
- **Multi-variant management** — S-07. We render the single seeded variant.
- **Bespoke / configurable grids** — the grid dimensions come from the plan's `slot_grid_preset`; only the `5x10` preset is exercised here.
- **A replace-style placements RPC** — per-row REST is sufficient for MVP.
- **Whole-group bulk-drop** — a grouping is a hint box you pull individual courses from; there is no gesture that places all members at once.
- **A true seed-course filter** — the leading-course filter is membership-based; retaining the algorithm's `seedId` through persistence (schema + un-dedup) is out of scope.

## Implementation Approach

Vertical bottom-up: stand up the persistence path first (library + `/api/placements`), then the route and server-side data load (including the empty-state bootstrap), then the drag-and-drop interaction, then the reactive validation/UX layer on top. Reads happen in Astro frontmatter and flow as props into one `PlannerBoard` island; writes go through API routes. The island owns placement state locally and persists optimistically. Collision and hours state are pure derivations over that local state, so they are unit-testable in isolation and trivially within the latency budget.

## Critical Implementation Details

- **Reactive derivation, not a captured verdict.** The collision flag and hours counter must be computed from current placement state on every render/change — never snapshotted inside `onDragEnd`. The known footgun (`research.md` Architecture Insights) is a stale closure over placement state inside the drop handler; read current state via the island's state/ref, not a memoized snapshot.
- **Grid dimensions come from the preset.** Nothing in `src/` parses `slot_grid_preset` today — this introduces the convention. Parse it as `<days>x<periods>` (the documented order) → `5x10` = 5 days × 10 periods → days `1..5`, periods `1..10`. Validate the match and fall back to a sane default (5×10) on a malformed/unparseable value rather than rendering a NaN grid. Do not hardcode the grid; the seed preset must be updated to `5x10`.
- **`cohortId` is required for the bootstrap compute.** Plans do not reference a cohort in the schema; cohort lives on `placements`/`course_groupings`. The page passes the Y1 cohort id explicitly to the empty-state button.
- **Optimistic-id reconciliation.** Optimistically inserted placement rows need a client-side temporary id reconciled with the server-assigned `id` on response (so a subsequent move/remove targets the right row); roll back the local row on persist error. A move/remove on a row whose server `id` has not yet reconciled must be gated (disabled or queued until the in-flight POST resolves) so DELETE never targets a temporary id.

## Phase 1: Foundations — library + placements API

### Overview

Install the drag-and-drop library and create the write path for placements before any UI exists, so the interaction phase has a working persistence target.

### Changes Required:

#### 1. Install the drag-and-drop library

**File**: `package.json` / `pnpm-lock.yaml`

**Intent**: Add `@dnd-kit/react` (the current, maintainer-supported line) as the DnD primitive for the planner island. Pin the exact 0.x version in the lockfile to insulate against pre-1.0 API churn.

**Contract**: `@dnd-kit/react` at a pinned exact version (e.g. `0.4.0`, no `^`). Sortable is a separate entry and is **not** added. Installed via `pnpm add`.

#### 2. Placements API route

**File**: `src/pages/api/placements.ts` (new)

**Intent**: Provide the create/move/remove write path for placement rows. Mirrors the auth/503/JSON-parse/typed-query/`json()` shape of `src/pages/api/grouping.ts`. Per-row REST — every drop is a single course-hour, so no bulk fan-out is needed.

**Contract**:

- `POST /api/placements` — body is a single placement: `{ variantId, cohortId, courseId, day, period }`. Validates UUIDs (reuse the `UUID_RE` pattern from `grouping.ts`), `day ∈ 1..5`, `period ∈ 1..10`. Inserts via typed `supabase.from("placements").insert(...).select()` and returns the created row (with server `id`) so the client can reconcile its optimistic id. Relies on `placements_unique` for idempotency; surface a unique-violation as a benign no-op/conflict rather than a 500.
- `DELETE /api/placements` — body `{ id }` (the placement row id); deletes that one row. "Move" is expressed by the client as **POST-new → then DELETE-old** (insert-before-delete: the new cell differs in `(day, period)` so it cannot hit `placements_unique`; if the POST fails nothing is lost, and the worst case is a transient visible duplicate rather than a silently dropped row). No PATCH needed for MVP.
- Returns `503` when Supabase is unconfigured; `400` on malformed body; `json(...)` helper identical to `grouping.ts`. Auth is handled by the deny-by-default middleware (no allowlist entry needed).

#### 3. Placement payload validation helper

**File**: `src/lib/placements/validate.ts` (new)

**Intent**: Extract the pure request-shape validation (UUID/day/period) so it is unit-testable without spinning up the route or DB.

**Contract**: A pure function that takes `unknown` and returns a discriminated result (`{ ok: true, row }` | `{ ok: false, error }`). No Supabase or `Request` dependency. The route calls it after `request.json()`.

### Success Criteria:

#### Automated Verification:

- Dependency installs and lockfile pins exact version: `pnpm install --frozen-lockfile`
- Astro env/types regenerate cleanly: `pnpm exec astro sync`
- Unit tests for the payload validator pass: `pnpm test`
- Linting passes: `pnpm lint`
- Build passes: `pnpm build`

#### Manual Verification:

- `POST /api/placements` with a valid body inserts a row (verify in Supabase Studio).
- `DELETE /api/placements` removes the targeted row.
- Malformed body returns `400`; unconfigured Supabase returns `503`.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Planner route + data load + empty-state bootstrap

### Overview

Create the page that loads everything the island needs server-side and mounts the (initially static) board, plus the empty-state "Compute groupings" button that bootstraps the palette when no groupings exist.

### Changes Required:

#### 1. Planner dynamic route

**File**: `src/pages/plans/[id].astro` (new)

**Intent**: Server-side, load the plan (by `id` param), its single variant, the Y1 cohort, the persisted `placements`, the `course_groupings` + `course_grouping_members` (palette hints), and the validation catalog (`GroupingCourse[]` + names) via `loadCohortCourses`. Parse `slot_grid_preset` into grid dimensions. Pass all of it as props to `<PlannerBoard client:load />`. 404 on unknown plan id.

**Contract**:

- Route param `id` (the plan UUID); validate and `Astro.redirect`/404 on miss.
- Uses `createClient(Astro.request.headers, Astro.cookies)`; 503-equivalent fallback if unconfigured.
- Derives `{ days, periods }` from `slot_grid_preset` (`5x10` → 5×10).
- Assembles props: `{ planId, variantId, cohortId, days, periods, groupings, names, placements, catalog }` where `catalog` is the `GroupingCourse[]` used for validation and `groupings` are the palette member-sets read from `course_groupings`/`course_grouping_members`.
- Wrapped in the existing `Layout.astro`.

#### 2. Empty-state compute-groupings bootstrap

**File**: `src/components/planner/ComputeGroupingsEmptyState.tsx` (new) — or folded into `PlannerBoard`

**Intent**: When `groupings` is empty, render an empty-state with a "Compute groupings" button that POSTs `{ planId, cohortId }` to the existing `/api/grouping`, then reloads the page so the palette renders from freshly-persisted `course_groupings` (single render path). Scoped strictly to the empty state — no re-compute or staleness UI.

**Contract**: A small client component (or island branch) with a `Button` (reuse `ui/button.tsx`), loading + error states (surface the `422`/`503`/`500` messages the route already returns), and `location.reload()` on success. Receives `planId` + `cohortId` as props.

#### 3. Seed preset update

**File**: `scripts/gen-seed.mjs` and/or `supabase/seed.sql`

**Intent**: Change the seed plan's `slot_grid_preset` from `5x8` to `5x10` so the grid renders 10 periods. Regenerate `seed.sql` if the value is produced by the generator.

**Contract**: Seed plan row `slot_grid_preset = '5x10'`. No `course_groupings`/`placements` are added to the seed — those are bootstrapped via the button (groupings) and created by dropping (placements).

### Success Criteria:

#### Automated Verification:

- Astro types/route compile: `pnpm exec astro sync` then `pnpm build`
- Linting passes: `pnpm lint`

#### Manual Verification:

- `supabase db reset` then visiting `/plans/<seed-plan-id>` (authenticated) renders the page with an empty palette + "Compute groupings" button.
- Clicking the button computes, persists, reloads, and the palette now shows Y1 grouping boxes.
- Visiting an unknown plan id returns 404 / redirect.
- The grid shows 10 periods × 5 days.

**Implementation Note**: Pause for manual confirmation after automated checks pass before proceeding.

---

## Phase 3: Drag-and-drop interaction (the drop)

### Overview

The northstar interaction: a `PlannerBoard` island with a filterable palette of expandable grouping boxes, a droppable 10×5 grid, draggable individual courses (from a box) and placed-course chips (for moves), accept-and-flag drop handling, and optimistic persistence. Every drop is a single course-hour — there is no whole-group bulk-drop.

### Changes Required:

#### 1. PlannerBoard island

**File**: `src/components/planner/PlannerBoard.tsx` (new)

**Intent**: Host `<DragDropProvider onDragEnd={handleDrop}>`, own local placement state (seeded from props) and the palette filter state, render palette + grid, and persist changes optimistically. Branches to the empty-state when no groupings.

**Contract**: Default-exported React component typed with a local `type Props` (the props assembled in Phase 2). Local state = the list of placement rows (each with an `id`, possibly a temporary client id pending reconcile) and the selected leading-course filter. Styling via `cn()`/`cva`, `data-slot` markers, matching the auth-component idiom.

#### 2. Leading-course filter

**File**: `src/components/planner/GroupingFilter.tsx` (new)

**Intent**: Let the author pick a leading course; the palette then shows only groupings whose `member_ids` _contain_ that course (membership filter — no seed data needed). Clearing the filter shows all groupings.

**Contract**: A control (select/combobox over the cohort's course names from `names`) that sets the filter state in `PlannerBoard`. The palette derives its visible groupings as `groupings.filter(g => !leadingCourseId || g.memberIds.includes(leadingCourseId))`. Pure, client-side.

#### 3. Palette grouping boxes (pull individual courses)

**File**: `src/components/planner/GroupingBox.tsx` (new)

**Intent**: Render each (filtered) grouping as an expandable box listing its member courses; each **course** inside is individually draggable onto the grid. The box is a hint of co-runnable companions — it never drops as a unit. Resolve display names at the edge from `names` (per the "port the mechanism, not the type shape" lesson). Placed courses are also draggable (for cell-to-cell moves) via the same draggable primitive.

**Contract**: For each member course, `useDraggable({ id: `palette:${groupingId}:${courseId}`, data: { kind: 'course', courseId } })`; spread the returned ref. A placed-course chip uses `useDraggable({ id: placementId, data: { kind: 'placement', courseId, placementId } })` and additionally renders a small "×" remove control (lucide icon at `size-4`) — see §6. Each member course also shows its "placed / required" hours (Phase 4). `cva` styling like `button.tsx`. No draggable on the box header itself.

#### 4. Grid + cells

**File**: `src/components/planner/PlannerGrid.tsx` + `SlotCell.tsx` (new)

**Intent**: Render `days × periods` cells. Each cell is a droppable keyed by `(day, period)` and renders the course chips currently placed in it (multi-occupancy). Use the library's drop-target hover state for affordance styling.

**Contract**: `useDroppable({ id: `${day}:${period}`, data: { day, period } })` per cell; spread ref; use `isDropTarget` for hover styling. Cells render all occupant chips.

#### 5. Drop handler (accept-and-flag state mutation)

**File**: within `PlannerBoard.tsx`

**Intent**: On drop, mutate local placement state and persist. Never reject a drop. Every drop places or moves exactly one course-hour: a `course` source (pulled from a grouping box) appends one new row at the target cell; a `placement` source moves that one row to the target cell. Persist optimistically.

**Contract**: `handleDrop(event)` — guard `if (event.canceled) return`; read `event.operation.source` / `event.operation.target`. `course` → append one optimistic row for `courseId` at the target `(day, period)`, then `POST /api/placements` and reconcile the returned `id`; `placement` → update that row's `(day, period)` locally, then `POST` the new cell, reconcile the returned `id`, and only then `DELETE` the old id (insert-before-delete); on persist error, roll back the local change. Gate the move if the source row's id has not yet reconciled. Respect `placements_unique` (dropping a course already in the target cell is a no-op). **Removal is not a drag gesture** — a drag dropped outside any cell is `event.canceled` and a no-op (no accidental delete); see §6.

#### 6. Remove control on placed chips

**File**: within `SlotCell.tsx` / chip rendering + a handler in `PlannerBoard.tsx`

**Intent**: Give the author an explicit, discoverable way to take a course off the grid (the inverse of a drop) without dragging. A small "×" control on each placed chip removes that one course-hour. Chosen over drag-off-grid for discoverability and because it works without pointer-drag (keeps the path a11y-ready per the deferred-keyboard decision).

**Contract**: Each placed chip renders a "×" button (lucide icon at `size-4`, `data-slot` marker, `cn()`/`cva` styling). Clicking it removes the row optimistically from local state and `DELETE`s `{ id }` via `/api/placements`; on persist error, roll back the local removal. Gated identically to move — disabled/queued until the row's server `id` has reconciled (so DELETE never targets a temporary id). `stopPropagation` so the click does not start a drag. The collision and hours derivations recompute reactively after removal (a removal can clear a flag — Phase 4).

### Success Criteria:

#### Automated Verification:

- Island compiles and builds: `pnpm build`
- Linting passes: `pnpm lint`
- Existing unit suite still green: `pnpm test`

#### Manual Verification:

- Filtering by a leading course narrows the palette to groupings containing that course; clearing restores all.
- Expanding a grouping box and dragging one course onto a cell places a single chip there.
- Pulling a second course from the same box into the same cell places it alongside the first.
- Dragging a placed chip to another cell moves it (and persists).
- Clicking the "×" on a placed chip removes it (and persists; the chip click does not start a drag).
- Reloading the page shows the same placements (persistence round-trips).
- Dropping always lands — no snap-back or block.
- The drop feels immediate (well under the ≤200 ms perceived budget).

**Implementation Note**: Pause for manual confirmation after automated checks pass before proceeding.

---

## Phase 4: Reactive validation + hours counter + collision UX

### Overview

Layer the reactive student-collision derivation and the read-only hours counter on top of the interaction, with the cell-highlight + per-course-badge UX.

### Changes Required:

#### 1. Per-cell collision derivation

**File**: `src/lib/planner/collisions.ts` (new)

**Intent**: Pure function deriving, from current placement state + the validation catalog, which courses in each cell collide — the class `hasIntersection` detects within the cohort (shared students or shared teacher). Built on `hasIntersection` evaluated pairwise across each cell's occupants. Returns attribution (which course ids conflict), not just a boolean, so the UI can badge participants and so resolution can move any participant.

**Contract**: A pure function `(placements, catalogById) → Map<cellKey, Set<conflictingCourseId>>` (or equivalent). Uses `hasIntersection` (`collision.ts:3`) across a cell's occupant `GroupingCourse[]`. No React, no Supabase — unit-testable. O(occupants²) per cell, trivially within budget.

#### 2. Hours-placed counter derivation

**File**: `src/lib/planner/hours.ts` (new)

**Intent**: Pure derivation of placed-vs-required hours per course (count of placement rows for a course vs `courses.hours_per_week`), special-casing 0-hour merge-children. Read-only — no enforcement.

**Contract**: A pure function `(placements, catalog) → Map<courseId, { placed, required }>`. Surfaced next to each member course inside the grouping box as "placed / required" (e.g. "Math 1/5"). No completeness blocking.

#### 3. Collision + counter UI surfacing

**File**: `SlotCell.tsx`, `GroupingBox.tsx`, chip rendering (edits)

**Intent**: Render the cell-highlight + per-course badge UX: a conflicted cell gets a conflict outline; each conflicting chip is badged with a generic "collision" label; the flag clears reactively when any participant moves or is removed. Show the hours counter on palette cards.

**Contract**: Cell outline driven by the collision map for its `(day, period)`; per-chip badge (lucide icon at `size-4` + label) when the chip's course id is in the cell's conflict set; tooltip/label naming the collision generically (teacher/student split is S-03). Derivations recompute on every placement change (reactive) — no captured verdict.

### Success Criteria:

#### Automated Verification:

- Unit tests for the collision derivation pass (per-cell, multi-occupancy, attribution, auto-clear semantics): `pnpm test`
- Unit tests for the hours counter pass (including 0-hour merge-children): `pnpm test`
- Linting passes: `pnpm lint`
- Build passes: `pnpm build`

#### Manual Verification:

- Dropping two of a student's courses into the same cell flags both chips with the "collision" label.
- Moving or removing one conflicting course clears the flag reactively (no reload).
- A collision-free multi-occupancy cell shows no flag.
- Each course in the palette box shows the correct "placed / required" hours, updating as placements change.
- Validation feedback is perceptibly immediate (≤200 ms feel) for a populated cell.

**Implementation Note**: Pause for final manual confirmation after automated checks pass.

---

## Testing Strategy

### Unit Tests (Vitest, pure — CI gate):

- **Placement payload validation** (`src/lib/placements/validate.ts`): valid body, bad UUIDs, out-of-range day/period, non-record input.
- **Per-cell collision derivation** (`src/lib/planner/collisions.ts`): no-collision multi-occupancy cell; two courses sharing a student flagged; two sharing a teacher flagged (same `hasIntersection` path); attribution names both participants; moving a participant out clears the flag; cross-cohort N/A (single cohort).
- **Hours counter** (`src/lib/planner/hours.ts`): placed < / = / > required; 0-hour merge-child special-case; multiple rows across cells counted once per row.
- **Membership filter** (logic extracted from the palette if practical): a leading course returns only groupings whose `memberIds` contain it; empty filter returns all.

Follow the existing `src/lib/grouping/__tests__/` pattern.

### Manual Testing Steps:

1. `supabase db reset`; sign in; open `/plans/<seed-plan-id>` → empty palette + button.
2. Click "Compute groupings" → palette populates after reload.
3. Filter by a leading course → palette narrows to groupings containing it.
4. Expand a box, drag one course onto a cell → one chip appears; reload → still there.
5. Pull a second course from the box into the same cell → both occupy it.
6. Create a collision in one cell (two courses sharing a student or teacher) → both chips flagged with the "collision" label.
7. Move one course out → flag clears reactively.
8. Watch a course's "placed / required" update as you place/remove.

## Performance Considerations

The validator is pure and per-cell (O(occupants²) over a handful of courses), recomputed client-side on each change — far inside the ≤200 ms budget (FR-012 / NFR). No network call is on the validation path; persistence is optimistic and off the critical path. dnd-kit's bundle (~32 kB gz upper bound) is a non-issue for an internal laptop tool.

## Migration Notes

- No schema migration. The only DB-side change is the seed value `slot_grid_preset = '5x10'`.
- `course_groupings`/`placements` rows are created at runtime (bootstrap button / drops), not seeded.

## References

- Research: `context/changes/first-valid-drop-with-validation/research.md`
- Roadmap S-01: `context/foundation/roadmap.md:119`
- Validator: `src/lib/grouping/collision.ts:3`
- Grouping types (palette contract): `src/lib/grouping/types.ts:1`
- API route pattern to mirror: `src/pages/api/grouping.ts:17`
- Island mount pattern: `src/pages/auth/signin.astro:16`, `src/components/auth/SignInForm.tsx:8`
- UI conventions: `src/components/ui/button.tsx:7`, `src/lib/utils.ts:4`
- Placements schema: `src/lib/database.types.ts:256`, `supabase/migrations/20260602185012_minimal_domain_schema.sql:116`
- Validation catalog loader: `src/lib/grouping/adapters/supabase.ts:24`
- Lesson "port the mechanism, not the legacy type shape": `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundations — library + placements API

#### Automated

- [x] 1.1 Dependency installs and lockfile pins exact version: `pnpm install --frozen-lockfile` — a7c4d52
- [x] 1.2 Astro env/types regenerate cleanly: `pnpm exec astro sync` — a7c4d52
- [x] 1.3 Unit tests for the payload validator pass: `pnpm test` — a7c4d52
- [x] 1.4 Linting passes: `pnpm lint` — a7c4d52
- [x] 1.5 Build passes: `pnpm build` — a7c4d52

#### Manual

- [x] 1.6 `POST /api/placements` with a valid body inserts a row — a7c4d52
- [x] 1.7 `DELETE /api/placements` removes the targeted row — a7c4d52
- [x] 1.8 Malformed body returns `400`; unconfigured Supabase returns `503` — a7c4d52

### Phase 2: Planner route + data load + empty-state bootstrap

#### Automated

- [x] 2.1 Astro types/route compile: `pnpm exec astro sync` then `pnpm build`
- [x] 2.2 Linting passes: `pnpm lint`

#### Manual

- [x] 2.3 `db reset` then `/plans/<seed-plan-id>` renders empty palette + "Compute groupings" button
- [x] 2.4 Clicking the button computes, persists, reloads, palette shows Y1 grouping boxes
- [x] 2.5 Unknown plan id returns 404 / redirect
- [x] 2.6 Grid shows 10 periods × 5 days

### Phase 3: Drag-and-drop interaction (the drop)

#### Automated

- [ ] 3.1 Island compiles and builds: `pnpm build`
- [ ] 3.2 Linting passes: `pnpm lint`
- [ ] 3.3 Existing unit suite still green: `pnpm test`

#### Manual

- [ ] 3.4 Filtering by a leading course narrows the palette; clearing restores all
- [ ] 3.5 Expanding a box and dragging one course onto a cell places a single chip
- [ ] 3.6 Pulling a second course from the same box into the same cell places it alongside
- [ ] 3.7 Dragging a placed chip to another cell moves it (and persists)
- [ ] 3.8 Clicking the "×" on a placed chip removes it (and persists; click does not start a drag)
- [ ] 3.9 Reloading shows the same placements (persistence round-trips)
- [ ] 3.10 Dropping always lands — no snap-back or block
- [ ] 3.11 The drop feels immediate (well under ≤200 ms perceived budget)

### Phase 4: Reactive validation + hours counter + collision UX

#### Automated

- [ ] 4.1 Unit tests for the collision derivation pass: `pnpm test`
- [ ] 4.2 Unit tests for the hours counter pass (incl. 0-hour merge-children): `pnpm test`
- [ ] 4.3 Linting passes: `pnpm lint`
- [ ] 4.4 Build passes: `pnpm build`

#### Manual

- [ ] 4.5 Two courses sharing a student (or teacher) in one cell flags both chips with the "collision" label
- [ ] 4.6 Moving or removing one conflicting course clears the flag reactively (no reload)
- [ ] 4.7 A collision-free multi-occupancy cell shows no flag
- [ ] 4.8 Each course in the palette box shows correct "placed / required" hours, updating live
- [ ] 4.9 Validation feedback is perceptibly immediate (≤200 ms feel)
