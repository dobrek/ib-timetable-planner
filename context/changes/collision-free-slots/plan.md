# Collision-Free Slot Hints Implementation Plan

## Overview

When the user **starts dragging** a course, a placed chip, or a whole grouping, the planner grid immediately marks which time-slot cells the drag could land in. The hint is **advisory, not a gate** — drops always land (accept-and-flag is a locked PRD decision); the hint only guides the eye.

The feature is a thin composition over machinery that already exists: the constraint registry's `violatesAny` "what-if" predicate, the `canAdd` / `moveIntent` guard semantics, and the existing `collisions`-threading pattern through the grid. No server, data-loading, or validation-core changes are required.

A cell is classified **free / partial / blocked** for the dragged course-set, and rendered under a user-selectable encoding (dim-the-blocked by default, or highlight-the-free), persisted per-device in `localStorage`.

## Current State Analysis

- **The what-if predicate exists and is unused by the drag UI.** `violatesAny(course, others)` (`src/_pages/plan-detail/model/constraints/index.ts:18`), surfaced as `hasIntersection` (`collision.ts:10`), is a pure, short-circuiting "would this course collide against these occupants?" check over the registry's `test` fast-path tier. Today only the server-side grouping enumerator consumes it. It is the same registry that powers post-drop feedback via `explainCell` — so a hint built on `violatesAny` can never drift from the detector.
- **All inputs are already client-side island props.** Catalog (`GroupingCourse[]`), placements, and groupings are passed to `PlannerBoard`. Collision validation is entirely client-side; the Astro Action only checks shape/bounds.
- **`onDragStart` is available but unwired.** `DragDropProvider` (`PlannerBoard.tsx:78`) wires only `onDragEnd`. The 0.4.0 types confirm `onDragStart?: ...` is a provider prop, and `DragStartEvent` carries `event.operation.source.data` — symmetric with the `onDragEnd` handler already in `handleDrop` (`PlannerBoard.tsx:38-56`).
- **No "valid target" visual token exists.** `SlotCell` (`SlotCell.tsx:41-45`) has only hover (`bg-accent ring-ring`) and collision (`ring-destructive`) treatments. Per the semantic-tokens lesson, a positive/valid treatment needs a new token in `global.css` (`:root` + `.dark` + `@theme inline`) — never a palette-named utility.
- **Threading pattern is established.** `collisions: Map<cellKey, CellCollisions>` flows `PlannerBoard → PlannerGrid → PeriodRow → SlotCell` (`PlannerGrid.tsx:14,45,84`). The hint map follows the identical path.
- **No memoized components in the slice.** Every placement change re-renders the full ~50-cell grid; a drag-start state change adds one more full-grid render. Accepted cost; `React.memo` on `SlotCell` is the documented first lever if ever needed.
- **Board renders only Y12 (dp1).** `BOARD_COHORT` is hardcoded (`api/load.ts:15`). All validation is single-cohort, per-cell. The hint inherits this scope.
- **Existing localStorage precedent for cosmetic prefs.** `theme` and `sidebar-collapsed` are persisted in `localStorage` (`BaseLayout.astro`, `SidebarLayout.astro`). A `planner-drag-hint-mode` key fits the same per-device pattern — no Supabase work is justified.

## Desired End State

Starting a drag instantly marks the grid:

- **Free cells** — the drag (every member, for groups) would land without collision and isn't a no-op.
- **Partial cells** (group drags only) — some but not all members would land *collision-free*; the rest land and flag (accept-and-flag is untouched), so this is an honest middle state. Note: classification is by **collision outcome** (`violatesAny`), not by what the drop physically lands — `addGroup`/`eligibleMembers` filter only duplicates, so a colliding non-duplicate member still lands. Partial/blocked therefore mean "would collide here," never "the drop is refused."
- **Blocked cells** — every member would collide, *or* the drop is a dead-end no-op (duplicate-of-existing, or the same-cell origin of a placement move). A blocked cell still accepts the drop under accept-and-flag.

The encoding obeys a board-level toggle: **dim-blocked** (default — recede blocked/partial cells, leave free cells neutral) or **highlight-free** (positively tint free cells). The choice persists per-device. Hints appear only during an active drag and clear on drop or cancel. The whole-grid sweep stays well under the <200ms budget.

**Verification**: dragging a palette course, a placed chip, and a grouping each produces correct marks; the origin cell of a moved chip reads blocked; a group with mixed eligibility shows partial cells; the toggle flips the encoding and survives a reload; `pnpm verify` (lint + steiger + test + build) stays clean.

### Key Discoveries:

- `violatesAny(course, others)` (`constraints/index.ts:18`) — the pure what-if predicate to reuse; never call `explainCell` on the hot path.
- `canAdd` / `eligibleMembers` / `moveIntent` (`placement-transitions.ts:7,34,88`) — the no-op (duplicate / same-cell) semantics the "blocked dead-end" decision depends on.
- `bucketByCell` (`collisions.ts:40-54`) is a private helper; the derivation needs the same cell→occupants bucketing (export it or add a sibling).
- For placement moves, the dragged placement must be **excluded** from the candidate cell's occupants before checking; the origin cell must additionally be forced **blocked** (same-cell no-op), since after exclusion it would otherwise compute as free.
- `DragStartEvent` exposes `event.operation.source.data as DragData` (0.4.0); clear hint state on `onDragEnd` and on `event.canceled`.
- New "valid target" token goes in `global.css` (`:root` + `.dark` + `@theme inline`), per the semantic-tokens lesson.

## What We're NOT Doing

- **No drop gate.** Hints never block a drop. Accept-and-flag stands; an "invalid" cell still accepts the drop and then flags as it does today.
- **No server / API / data-loading changes.** Validation stays fully client-side.
- **No new constraint logic.** The derivation consumes the existing registry via `violatesAny`; new constraints (e.g. cross-cohort at S-09) are inherited automatically.
- **No cross-cohort hinting.** Board is dp1-only; out of scope.
- **No conflict-matrix precompute / memoization beyond `useMemo`.** The naive per-cell sweep is far under budget; `React.memo` on `SlotCell` is deferred unless profiling demands it.
- **No Supabase-backed / per-account preference.** The toggle is per-device `localStorage`, matching `theme`/`sidebar-collapsed`.
- **No drag-over / per-hover recomputation.** The sweep is whole-grid at drag start; hover keeps its existing `isDropTarget` treatment.

## Implementation Approach

Three layers, each independently verifiable:

1. **Pure model** — `deriveDropHints(...)` returns a **sparse** `Map<cellKey, DropHint>` where `DropHint = "partial" | "blocked"`; **absent = free**. It returns `null` when no drag is active. Sparseness keeps the result small (early-planning grids have almost no blocked cells) and lets `SlotCell` treat "no entry, drag active" as free without the derivation needing grid bounds. A companion `resolveDragHintContext(data, ...)` turns a `DragData` into `{ members, excludePlacementId?, origin? }`.
2. **Wiring** — `PlannerBoard` owns a `dragContext` state set in `onDragStart`, cleared on drop/cancel; a `useDropHints` `useMemo` derivation; the resulting `Map | null` threads down the grid like `collisions`.
3. **Presentation** — a new semantic token, a ternary class branch in `SlotCell` switched by `hintMode`, and a persisted board toggle.

The derivation is **encoding-agnostic** by construction (it returns the full classification; the mode only chooses which side gets visual ink) — this is a plan invariant so the toggle never touches `model/`.

## Critical Implementation Details

- **Placement-move origin must be forced blocked.** After excluding the dragged `placementId` from its origin cell's occupants, that cell would compute as free (its only conflicting occupant was itself), but dropping there is a same-cell no-op (`moveIntent` → `err("same-cell")`). The derivation must mark `origin` as `blocked` explicitly. This is the one case where exclusion and no-op honesty interact.
- **Per-member classification, then per-cell rollup.** A member "fits" a cell iff `!violatesAny(member, occupantsExcludingDragged)` — i.e. it would land **collision-free**. (Duplicate-of-existing is already one of the registry constraints via `duplicateCourse.test`, so `violatesAny` covers it; no separate `canAdd` check is needed for candidate cells — `canAdd`/origin only drives the same-cell move dead-end below.) Per cell: all fit → free (omit from map); some fit → `"partial"`; none fit → `"blocked"`. This classifies *collision outcome*, **not** what the drop physically lands: on drop, `addGroup`/`eligibleMembers` filter only duplicates, so colliding non-duplicate members still land and flag. Single-course/placement drags have one member, so they only ever yield free or blocked — `"partial"` is structurally group-only.
- **Reactive derivation, never snapshot.** `useDropHints` keys on `[dragContext, placements, catalogById]` so marks stay correct if a pending placement settles or rolls back mid-drag (research deemed this acceptable and cheap).
- **SSR/hydration safety for the toggle.** Drag state is always `null` at island hydration, so the hint never renders on first paint; reading `localStorage` in a lazy `useState` initializer behind a `typeof window` guard cannot cause a visible hydration mismatch.

## Phase 1: Pure derivation + drag resolution

### Overview

Add the pure classification logic and its drag-data resolver, fully unit-tested, with no UI wiring yet.

### Changes Required:

#### 1. Cell bucketing reuse

**File**: `src/_pages/plan-detail/model/collisions.ts`

**Intent**: Make the existing per-cell occupant bucketing available to the new derivation without duplicating it.

**Contract**: Export `bucketByCell` (currently private, `collisions.ts:40-54`) — or extract it to a shared sibling and re-import in both `collisions.ts` and the new `drop-hints.ts`. Signature unchanged: `(placements, catalogById) => Map<cellKey, { cell, occupants: GroupingCourse[] }>`. No behavior change to `deriveCellViolations`.

#### 2. Drag-hint context resolver

**File**: `src/_pages/plan-detail/model/drop-hints.ts` (new)

**Intent**: Translate a drag payload into the inputs the derivation needs, resolving groupings to their members and capturing the placement-move exclusion/origin.

**Contract**: `resolveDragHintContext(data: DragData, deps: { catalogById, groupings, placements }) => DragHintContext | null` where
`DragHintContext = { members: GroupingCourse[]; excludePlacementId?: string; origin?: CellData }`.
- `kind: "course"` → `members = [catalogById.get(courseId)]` (drop if absent).
- `kind: "placement"` → `members = [its course]`, `excludePlacementId = placementId`, `origin = { day, period }` looked up from `placements`.
- `kind: "grouping"` → `members =` the grouping's `memberIds` mapped through `catalogById` (same resolution as `dropGroup`, `PlannerBoard.tsx:59-62`).
Returns `null` when nothing resolves (unknown id / empty members) so the caller renders no hints.

#### 3. Per-cell hint derivation

**File**: `src/_pages/plan-detail/model/drop-hints.ts`

**Intent**: Classify every cell as free (omitted) / partial / blocked for the dragged member-set, honoring collision and no-op-dead-end semantics.

**Contract**: `deriveDropHints(context: DragHintContext | null, placements, catalogById) => Map<string, DropHint> | null`, `DropHint = "partial" | "blocked"`.
- Returns `null` when `context` is `null`.
- Buckets placements by cell (Phase 1.1 helper); for a candidate cell, the occupant set excludes any placement whose id === `excludePlacementId`.
- A member fits a cell iff `!violatesAny(member, occupantsExcludingDragged)`. Duplicate-of-existing is already covered by `violatesAny` (`duplicateCourse.test` is in the registry), so no separate `canAdd` check is needed here — `canAdd`/origin only drives the same-cell move dead-end below.
- Roll up per cell: all members fit → omit (free); some fit → `"partial"`; none fit → `"blocked"`.
- After the sweep, if `context.origin` is set, force `map.set(cellKey(origin), "blocked")` (same-cell no-op).
- Empty cells (no occupants) are free for any non-duplicate member, so they're naturally omitted.

The derivation must use `violatesAny` over the registry (not a bespoke check) so future constraints are inherited — state this as a code comment invariant.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Type checking / lint passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`

Tests must cover: empty grid (all free → empty map), single-course collision (blocked), placement move excludes self (candidate free), placement-move origin forced blocked, duplicate-of-existing course (blocked, via the `duplicateCourse` registry constraint), group all-fit (free), group some-fit (`"partial"`), group none-fit (`"blocked"`), and `null` context → `null`.

#### Manual Verification:

- None for this phase (pure logic; verified by tests).

**Implementation Note**: After automated verification passes, proceed to Phase 2.

---

## Phase 2: Drag-start wiring + grid threading

### Overview

Capture drag identity at `onDragStart`, derive the hint map reactively, and thread it to every cell — without any visual treatment yet (cells can carry a temporary `data-` attribute to confirm wiring).

### Changes Required:

#### 1. Drag context state + lifecycle

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Own the active-drag identity so the hint derivation has an input, and clear it precisely when the drag ends.

**Contract**: Add `onDragStart` to `DragDropProvider` (`PlannerBoard.tsx:78`) reading `event.operation.source.data as DragData`, resolving it via `resolveDragHintContext`, and storing the result in a `useState<DragHintContext | null>`. Clear to `null` at the top of `handleDrop` (covers both successful drop and `event.canceled`). The context lives alongside `usePlacements` (the natural owner of placement state).

#### 2. Reactive hint derivation hook

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Recompute the hint map from live state so it stays correct if placements settle/roll back mid-drag.

**Contract**: `useDropHints(dragContext, placements, catalog)` → `useMemo(() => deriveDropHints(dragContext, placements, catalogById), [dragContext, placements, catalogById])`, reusing the same `catalogById` map already built in `useCollisions` (lift it or share it). Returns `Map<cellKey, DropHint> | null`.

#### 3. Thread the map through the grid

**Files**: `src/_pages/plan-detail/ui/PlannerGrid.tsx`, `src/_pages/plan-detail/ui/SlotCell.tsx`

**Intent**: Pass the hint map to each cell exactly like `collisions`, and have each cell resolve its own state.

**Contract**: Add `dropHints: Map<string, DropHint> | null` to `PlannerGrid` Props and `PeriodRow`, mirroring the `collisions` prop (`PlannerGrid.tsx:14,45,84`). `SlotCell` receives `dropHint: DropHint | undefined` and a `hintActive: boolean` (true when the map is non-null) — or, equivalently, receive the map and look up `cellKey(day, period)`. A cell's hint state is: `hintActive ? (dropHints.get(key) ?? "free") : null`. For this phase, surface it as a `data-drop-hint` attribute only (no styling) to verify wiring.

#### 4. `onDragStart` resolution test

**File**: `src/_pages/plan-detail/model/drop-hints.test.ts` (extend) or a focused test

**Intent**: Guard that each `DragData` kind resolves to the correct member-set and exclusion/origin.

**Contract**: Test `resolveDragHintContext` for `course` (1 member), `placement` (1 member + `excludePlacementId` + `origin`), and `grouping` (N members), plus unknown-id → `null`. (Pure resolver test; no dnd-kit event simulation needed.)

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Lint passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Production build is clean: `pnpm build`

#### Manual Verification:

- Starting a drag populates `data-drop-hint` on the expected cells (inspect via devtools); origin cell of a moved chip reads `blocked`; dropping or pressing Escape clears all `data-drop-hint` attributes.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Encoding, toggle & persistence

### Overview

Give the three hint states visual form under a user-selectable, persisted encoding.

### Changes Required:

#### 1. Valid-target semantic token

**File**: `src/app/styles/global.css`

**Intent**: Provide a token-driven positive/valid treatment for highlight-free mode (and a basis for the partial state), since no success token exists.

**Contract**: Add a `--valid` (and `--valid-foreground` if a tinted background needs readable content) variable to `:root` and `.dark`, plus the `--color-valid` mapping in `@theme inline` (mirroring how `--destructive` / `--color-destructive` are defined at `global.css:23,99`). Choose light/dark oklch values consistent with the existing palette. No palette-named or arbitrary color utilities anywhere.

#### 2. Ternary rendering in `SlotCell`

**File**: `src/_pages/plan-detail/ui/SlotCell.tsx`

**Intent**: Render free / partial / blocked per the active mode, coexisting with the existing hover and collision treatments.

**Contract**: Extend the `cn(...)` at `SlotCell.tsx:41-45` with a branch keyed on `(hintMode, hintState)`:
- **dim-blocked mode** — `blocked` → muted/receded (e.g. reduced opacity + `bg-muted`); `partial` → an intermediate dim; `free` → neutral.
- **highlight-free mode** — `free` → `--valid`-based tint/ring; `partial` → an intermediate using `--valid` + muting; `blocked` → neutral.
Hover (`isDropTarget`) and collision (`ring-destructive`) treatments must continue to win where they apply (hover is the strong positive cue in both modes). **Don't rely on `cn(...)` string order to achieve this** — Tailwind ring utilities all set `--tw-ring-color`, so when a hint ring and the hover/collision ring co-occur on one cell the winner is decided by compiled-CSS source order, not className order. **Gate the hint classes off explicitly** instead: emit no hint treatment when `isDropTarget || hasCollision` (e.g. `!isDropTarget && !hasCollision && hintClass`). Add `data-drop-hint` for testability. `SlotCell` receives `hintMode` and its resolved `hintState`.

#### 3. Board toggle + persistence

**Files**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`, a new small control (e.g. `src/_pages/plan-detail/ui/DragHintModeToggle.tsx`), and a tiny persistence helper (e.g. `src/_pages/plan-detail/lib/drag-hint-mode.ts`)

**Intent**: Let the user switch encoding and remember the choice per-device.

**Contract**:
- `HintMode = "dim-blocked" | "highlight-free"`; default `"dim-blocked"`.
- Persistence helper: `readHintMode()` / `writeHintMode(mode)` over `localStorage` key `planner-drag-hint-mode`, guarded by `typeof window !== "undefined"`, defaulting to `"dim-blocked"` on miss/invalid value (same shape as the existing `theme`/`sidebar-collapsed` reads).
- `PlannerBoard` holds `const [hintMode, setHintMode] = useState(readHintMode)` (lazy initializer) and writes on change. Thread `hintMode` to the grid alongside `dropHints`.
- A small segmented/icon control rendered near `PlanSummaryBar` (`PlannerBoard.tsx:80`), labeled to make clear it affects drag feedback (e.g. "While dragging: highlight free / mark collisions"). Token-based styling only; prefer existing shared UI primitives.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Lint passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Production build is clean: `pnpm build`

#### Manual Verification:

- Default mode dims blocked/partial cells; free cells stay neutral and the empty early grid isn't flooded with ink.
- Toggling to highlight-free positively tints free cells; partial cells read as an intermediate; blocked cells stay neutral.
- A group drag with mixed eligibility shows free / partial / blocked correctly in both modes.
- The chosen mode survives a full page reload.
- Hover (`isDropTarget`) and post-drop collision outline still render correctly during/after a drag.
- Light and dark themes both render the new token legibly.

**Implementation Note**: Final phase — after automated + manual verification, the change is ready to commit.

---

## Testing Strategy

### Unit Tests (`drop-hints.test.ts`, co-located):

- `deriveDropHints`: empty grid → empty map; single-course collision → blocked; placement move excludes self → candidate free; placement-move origin → forced blocked; duplicate course → blocked (via `duplicateCourse` registry constraint); group all-fit → free; group some-fit → partial; group none-fit → blocked; `null` context → `null`.
- `resolveDragHintContext`: course / placement (with `excludePlacementId` + `origin`) / grouping / unknown-id → `null`.

### Integration Tests:

- None — feature is client-only and server-untouched; covered by unit + manual.

### Manual Testing Steps:

1. Drag a palette course over a mostly-empty grid (default mode) — confirm only true dead-ends dim, free cells stay neutral.
2. Place two courses that share a teacher; drag a third conflicting course — confirm colliding cells read blocked.
3. Move a placed chip — confirm its origin cell reads blocked and other valid cells read free.
4. Drag a grouping where some members already sit in a cell — confirm that cell reads partial.
5. Toggle to highlight-free and repeat 1–4; confirm encoding inverts and partial is a distinct intermediate.
6. Reload — confirm the toggle persists.
7. Switch light/dark — confirm token legibility.

## Performance Considerations

Whole-grid sweep at drag start: ≤84 cells × ≤~10 group members × single-digit occupants × short-circuiting `violatesAny` ≈ tens of thousands of primitive ops — single-digit ms, far under the <200ms p95 budget (FR-012 / NFR, `prd.md:129`). No precompute needed. One extra full-grid render per drag start; accepted at ≤84 cells, with `React.memo` on `SlotCell` as the documented first lever if profiling ever demands it.

## Migration Notes

None — no schema, no data, no server changes. The `localStorage` key is additive and defaults safely when absent.

## References

- Research: `context/changes/collision-free-slots/research.md`
- What-if predicate: `src/_pages/plan-detail/model/constraints/index.ts:18` (`violatesAny`), `model/collision.ts:10`
- No-op guard semantics: `src/_pages/plan-detail/model/placement-transitions.ts:7,34,88`
- Threading pattern to mirror: `src/_pages/plan-detail/ui/PlannerGrid.tsx:14,45,84`
- Drag lifecycle: `src/_pages/plan-detail/ui/PlannerBoard.tsx:38-62,78`
- Token precedent: `src/app/styles/global.css:23,99` (`--destructive` / `--color-destructive`)
- localStorage pref precedent: `src/app/layouts/SidebarLayout.astro` (`sidebar-collapsed`), `BaseLayout.astro` (`theme`)
- Lessons: semantic theme tokens; port the mechanism (opaque ids, display at the edge)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pure derivation + drag resolution

#### Automated

- [x] 1.1 Unit tests pass: `pnpm test` — 8515cb8
- [x] 1.2 Type checking / lint passes: `pnpm lint` — 8515cb8
- [x] 1.3 FSD structure check passes: `pnpm steiger` — 8515cb8

### Phase 2: Drag-start wiring + grid threading

#### Automated

- [x] 2.1 Unit tests pass: `pnpm test`
- [x] 2.2 Lint passes: `pnpm lint`
- [x] 2.3 FSD structure check passes: `pnpm steiger`
- [x] 2.4 Production build is clean: `pnpm build`

#### Manual

- [x] 2.5 `data-drop-hint` populates on expected cells; origin reads blocked; drop/Escape clears it

### Phase 3: Encoding, toggle & persistence

#### Automated

- [ ] 3.1 Unit tests pass: `pnpm test`
- [ ] 3.2 Lint passes: `pnpm lint`
- [ ] 3.3 FSD structure check passes: `pnpm steiger`
- [ ] 3.4 Production build is clean: `pnpm build`

#### Manual

- [ ] 3.5 Default dim-blocked mode dims dead-ends; empty grid not flooded
- [ ] 3.6 Highlight-free mode tints free cells; partial is a distinct intermediate
- [ ] 3.7 Group drag shows free / partial / blocked correctly in both modes
- [ ] 3.8 Chosen mode survives a page reload
- [ ] 3.9 Hover + post-drop collision treatments still render correctly
- [ ] 3.10 Light and dark themes both render the new token legibly
