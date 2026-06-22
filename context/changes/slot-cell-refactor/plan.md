# SlotCell Refactor Implementation Plan

## Overview

`src/_pages/plan-detail/ui/SlotCell.tsx` is 428 lines — the largest file in the plan-detail slice — and carries four kinds of debt at once: a fragile reliability hazard (the negated-class ring ladder), a structural one (3 sub-components + a styling table + two dnd-kit integrations in one file), an accessibility gap (the board's core drag-drop is visually-only, silent to assistive tech and unlocatable by role-based e2e), and a set of undocumented slice conventions. This plan addresses all four in five independently-reviewable phases, deferring only full keyboard drag-drop operation (A1) and the orthogonal PlannerGrid prop-drilling cleanup (research group B) to separate changes.

The two upstream artifacts — `change.md` (the originating critical review) and `research.md` (a thorough follow-up that surfaced the accessibility/e2e axis the review missed) — are authoritative inputs. This plan does not re-litigate their findings; it sequences and grounds them into actionable phases.

## Current State Analysis

`SlotCell.tsx` today (commit `cbc51d3`):

- **Cell tone is a priority cascade encoded as negation chains** (`SlotCell.tsx:124–144`). Each visual state (hint / warning / bundled / blocking / drop-target) must exclude every higher-priority state with `!` guards, because every Tailwind ring writes the same `--tw-ring-color` custom property — so co-occurrence can't be resolved by class order. Failure mode is silent: forget one `!` and two rings fight. The precedence logic is untestable, tangled in JSX. The in-code comment (`:126–128`) admits the root cause.
- **Three private sub-components** (`PlacedChip`, `WeekLane`, `WeekToggle`) + the `HINT_CLASS` lookup table live in-file. `WeekLane` threads a `render` callback prop to avoid importing `PlacedChip`.
- **Week classification (`a`/`b`/`both`) is scattered**: `hasBiweekly` (`:95`), three inline `occupants.filter(...)` lane passes (`:192–194`), `isBiweekly` in `PlacedChip` (`:270`), and a separate set of week helpers in `CollisionDetailsDialog.tsx:222–229` (`sharedSingleWeek`, `weekLabel`, `otherWeek`). `model/week.ts` already exists as the home for week logic but holds only `weeksDisjoint`.
- **`setCellRef = useMemo(...)`** (`:77–83`) merges two dnd-kit refs in the component body — a real violation of the "no `useMemo` in component body" rule (`ui-conventions.md` "Declarative components"). The `useDroppable`/`useDraggable` calls (`:64–75`) are inline too, but that is the slice norm (`GroupingBox`, `PlannerBoard`).
- **`onPointerDown={(e) => e.stopPropagation()}`** (paired with an `onClick` stop) repeats **5×** (toggle, trash, badge button, week-option, remove). One omission re-enables drag-on-click — the repetition is the bug surface.
- **Accessibility is the slice's true debt.** All cell/chip status is visual-only (`data-collision`, `data-availability`, `data-drop-hint`, ring colors) — no `role`, `aria-invalid`, or accessible names. `WeekToggle` models an exclusive A/B choice as two independent `aria-pressed` buttons (`:360–402`) and its raw `<button>`s lack focus-visible rings. The empty-lane `free` ghost is announced without scoping (`:228–234`) while its lane label is `aria-hidden`.
- **No `data-*` attribute is load-bearing.** Verified at `cbc51d3`: zero references in CSS (`src/app/styles/`), zero runtime reads (`querySelector`/`closest`/`getAttribute`/`[data-...]`), zero references in any unit or e2e spec. The e2e suite exists and mandates role-based locators only (`e2e/CLAUDE.md:15`). So `data-*` can be replaced freely; the test contract becomes roles + accessible names.

### Key Discoveries

- **Folder-with-barrel is an existing idiom**, not a new one: `model/constraints/` is a folder with `index.ts` as a pure barrel (`model/constraints/index.ts`). The proposed `ui/slot-cell/` folder mirrors it.
- **`cva` + class-lookup-tables are the repo's established conditional-class patterns** (`shared/ui/badge.tsx`, `button.tsx`, `tabs.tsx`; `HINT_CLASS`). The negated ladder is **isolated to SlotCell** (repo-wide search confirmed) — a legitimate local workaround, not a systemic smell. Fix is local; no "ban negated ladders" rule needed.
- **No `ToggleGroup` primitive exists** in `shared/ui/`, and there is **no `@radix-ui/react-toggle-group` dependency**. Adopting ToggleGroup means adding the dep + scaffolding `shared/ui/toggle-group.tsx` (shadcn pattern), then exporting it from `shared/ui/index.ts`.
- **The e2e convention reinforces the a11y work**: because board e2e can only select by role + accessible name (never `data-*`/CSS), adding roles/names is precisely what makes the board e2e-testable. A11y and testability are the same work.
- **`PlannerGrid.tsx` imports `./SlotCell`** and is the only consumer; `PeriodRow` and `groupByCell` already hold `names`. The barrel must keep `import SlotCell from "./slot-cell"` resolving to the default export so the grid import is a one-line change (or unchanged if the folder is named to match).

## Desired End State

After this plan:

- `SlotCell`'s cell tone is computed by a single pure, unit-tested `resolveCellTone(...)` returning a `CellTone` enum; the component emits one `toneClass(tone, hintMode)` lookup. Precedence is declared once, ordered, exhaustive. The opacity axis (`isDragging`, hint opacities) stays separate from tone.
- Week classification lives in `model/week.ts` (tested): `partitionByWeek`, `isBiweekly`, `hasBiweekly`, `sharedSingleWeek`, `weekLabel`, `otherWeek`. `SlotCell`, `PlacedChip`, and `CollisionDetailsDialog` consume them; no inline week predicates remain.
- `SlotCell.tsx` is a `ui/slot-cell/` folder: a pure-barrel `index.ts`, the orchestrator, `PlacedChip`/`WeekLane`/`WeekToggle` as sibling files (no `render` prop), a `tone-class.ts` table, and a private `useCellDnd()` hook. No raw `useMemo` in any component body.
- The A/B control is a Radix `ToggleGroup type="single"` with proper `radio`/`radiogroup` semantics and focus-visible rings.
- The board renders genuine tabular/interactive semantics: `role="grid"` + cohort-labelled name, rows, column/row headers, `gridcell`s with accessible names (empty cells named too), chips with `aria-roledescription="placement"` + `aria-invalid` on blocking. Stateful and coordinate `data-*` are gone; `data-slot` survives as identity-only.
- Four convention deltas are codified in `ui-conventions.md` and one rationale line in `e2e/CLAUDE.md`.

**Verification**: `pnpm test` (new model tests pass), `pnpm lint`, `pnpm steiger --fail-on-warnings`, `pnpm build` all clean; manual board interaction unchanged; screen-reader/role inspection shows grid + named cells + radio week control.

## What We're NOT Doing

- **Keyboard drag-drop operation (A1).** Focusable draggables + the dnd-kit keyboard/accessibility plugin in `PlannerBoard`'s `PLUGINS` is plan-sized, orthogonal, and risky to the dnd interaction. Deferred to a dedicated change. (This plan adds the roles/names that *locate* elements; it does not make drag keyboard-*operable*.)
- **PlannerGrid prop-drilling cleanup (research group B).** The triple-declared 14-field cell wiring, the `CellHandlers`/`CellWiring` bundle, and `names`-threading collapse are a separate prop-architecture concern. PlannerGrid is touched here only to add grid roles — the sole prop-surface change permitted is the one new `gridLabel` prop the grid `aria-label` needs (Phase 4 §3); no other prop restructuring.
- **The three open `plan-detail` deltas** unrelated to SlotCell (`grouping-client.ts` `{ error }` shape, `location.reload()` → `refreshPage()`, unused `warnings`) — out of scope; do not scope-creep.
- **Retroactively splitting `CollisionDetailsDialog`/`PlannerBoard`** to satisfy the new folder threshold — the codified rule's cohesion caveat explicitly exempts them.
- **An `aria-live` collision summary** near the grid (research A2 "optional") — not adopted now; chip `aria-invalid` is the in-scope a11y win.

## Implementation Approach

Sequence from lowest-risk/highest-certainty to highest-churn, so each phase is independently reviewable and revertible:

1. **Pure model first** — extract and test the precedence resolver and week classifiers, then rewire consumers. This lands the reliability fix and convergence with full unit coverage before any file moves, and is independent of the folder split.
2. **Interaction-safety + dnd hook** — extract `stopDrag` and `useCellDnd` while still single-file, so the dnd hardening is a small focused diff.
3. **Mechanical folder split** — now that logic is extracted, the split is largely moving code; apply `cva` to `PlacedChip` as it moves and drop the `WeekLane` `render` prop.
4. **Accessibility layer** — the largest behavioral change (new primitive, roles, ARIA, `data-*` removal) lands last on a clean structure, where the test contract change is easiest to reason about.
5. **Docs** — codify the conventions the now-landed code demonstrates, referencing real files.

### A note on where `cell-tone` lives

The review note (`change.md:36`) sketches `ui/slot-cell/cell-tone.ts`, but also calls for "a pure `model/` function." We split the two concerns by purity:

- **`model/cell-tone.ts`** — the pure `resolveCellTone(...)` + the `CellTone` type. Framework-free, unit-tested beside source (`model/cell-tone.test.ts`). This is the reliability centerpiece and belongs where tested domain logic lives ("the complexity budget lives in `model/`").
- **`ui/slot-cell/tone-class.ts`** — the `CellTone → Tailwind` lookup (`toneClass`, absorbing `HINT_CLASS`). Presentation strings stay in `ui/`.

This honors both the "pure model function" intent and the "tone table owns the whole cell" intent, while keeping Tailwind out of `model/`.

## Phase 1: Pure model core (reliability + week convergence)

### Overview

Extract the tone-precedence resolver and the converged week classifiers as pure, tested `model/` functions, then rewire `SlotCell` and `CollisionDetailsDialog` to consume them. The negated ring ladder collapses to one call + one lookup; scattered week predicates disappear. No file moves, no a11y changes.

### Changes Required:

#### 1. Tone precedence resolver

**File**: `src/_pages/plan-detail/model/cell-tone.ts` (new)

**Intent**: Own the cell's visual-tone precedence in one ordered, exhaustive, pure function so the negated-class ladder's silent failure mode is eliminated and the precedence becomes unit-testable.

**Contract**: Export `type CellTone` and `resolveCellTone(s)` where `s` carries the booleans/state currently driving the ladder (`hasBlocking`, `isDropTarget`, `hasWarning`, `hintState: DropHint | "free" | undefined`, `bundled`). Precedence order is fixed: blocking → drop-target → hint → warning → bundled → base. The hint case must preserve the `DropHint | "free"` value so the class table can pick `HINT_CLASS[hintMode][hintState]`. The opacity axis (`isDragging`, hint opacities) is **not** part of tone — it composes separately in the component.

```ts
export type CellTone =
  | "blocking" | "drop-target"
  | { hint: DropHint | "free" }
  | "warning" | "bundled" | "base";

export function resolveCellTone(s: {
  hasBlocking: boolean; isDropTarget: boolean; hasWarning: boolean;
  hintState: DropHint | "free" | undefined; bundled: boolean;
}): CellTone {
  if (s.hasBlocking) return "blocking";   // precedence lives HERE, once
  if (s.isDropTarget) return "drop-target";
  if (s.hintState) return { hint: s.hintState };
  if (s.hasWarning) return "warning";
  if (s.bundled) return "bundled";
  return "base";
}
```

#### 2. Tone resolver tests

**File**: `src/_pages/plan-detail/model/cell-tone.test.ts` (new)

**Intent**: Lock the precedence contract that was previously untestable — every higher-priority state must win over every lower one.

**Contract**: Cover each precedence pair (blocking beats drop-target/hint/warning/bundled; drop-target beats hint/warning/bundled; hint beats warning/bundled; warning beats bundled; base when all false) and the hint-value pass-through (`free`, `warn`, `opposite-week`, `partial`, `blocked`).

#### 3. Converged week classifiers

**File**: `src/_pages/plan-detail/model/week.ts`

**Intent**: Make `model/week.ts` the single home for `a`/`b`/`both` classification, replacing four scattered call sites and the duplicate predicate, per the "complexity budget lives in `model/`" rule.

**Contract**: Add (alongside the existing `weeksDisjoint`):
- `isBiweekly(week: PlacementWeek): boolean` — `week === "a" || week === "b"`.
- `hasBiweekly(occupants: { week: PlacementWeek }[]): boolean` — any occupant biweekly.
- `partitionByWeek(occupants: LocalPlacement[]): { both; a; b }` — one pass replacing the three inline `.filter()` re-scans (`SlotCell.tsx:192–194`). Returns occupants grouped, preserving input order within each group.
- `sharedSingleWeek(courseIds, weekByCourseId): "a" | "b" | null`, `weekLabel(week: "a" | "b"): string`, `otherWeek(week: "a" | "b"): "a" | "b"` — moved verbatim from `CollisionDetailsDialog.tsx:222–229`.

Keep `LocalPlacement` imported type-only to avoid a layer/cycle issue; if `partitionByWeek`'s `LocalPlacement` dependency creates an undesirable model-internal import, accept a structural `{ week }`-shaped generic instead.

#### 4. Week classifier tests

**File**: `src/_pages/plan-detail/model/week.test.ts`

**Intent**: Cover the new classifiers, especially `partitionByWeek` order preservation and `sharedSingleWeek`'s null cases.

**Contract**: `partitionByWeek` groups + preserves order; `hasBiweekly`/`isBiweekly` truth table; `sharedSingleWeek` returns null when any id is `both`/differs/absent, the shared week otherwise; `weekLabel`/`otherWeek` mappings.

#### 5. Rewire SlotCell to the resolver + classifiers

**File**: `src/_pages/plan-detail/ui/SlotCell.tsx`

**Intent**: Collapse the negated ring ladder to `resolveCellTone(...)` + a tone lookup, and replace inline week predicates with the model classifiers — without yet moving the file or the `HINT_CLASS` table.

**Contract**: Replace the `className` ladder (`:124–144`) with `cn("bg-background flex min-h-16 …", toneClass(tone, hintMode), isDragging && "opacity-60")` where `tone = resolveCellTone({ hasBlocking, isDropTarget, hasWarning, hintState, bundled })`. For this phase `toneClass` may be a local function/table still in-file (absorbing `HINT_CLASS`); it moves to `tone-class.ts` in Phase 3. Replace `hasBiweekly` (`:95`) with `hasBiweekly(occupants)`, the three lane `.filter()`s (`:192–194`) with `partitionByWeek(occupants)`, and `PlacedChip`'s `isBiweekly` (`:270`) with `isBiweekly(placement.week)`. The opacity-stacking note (research E/C1): `isDragging`'s `opacity-60` stays a separate `cn` term, intentionally independent of tone.

#### 6. Rewire CollisionDetailsDialog to model/week

**File**: `src/_pages/plan-detail/ui/CollisionDetailsDialog.tsx`

**Intent**: Remove the local week helpers now that they live in `model/week.ts` (the "converge everything" decision).

**Contract**: Delete `sharedSingleWeek`/`weekLabel`/`otherWeek` (`:222–229`); import them from `../model/week`. `SameWeekHint` behavior unchanged.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- New model tests exist and pass: `pnpm test -- cell-tone week`
- Type checking passes: `pnpm exec astro check` (or `pnpm build`)
- Linting passes: `pnpm lint`
- FSD structure clean: `pnpm steiger`

#### Manual Verification:

- Cell tones render identically to before for each state (blocking, drop-target, each hint, warning, bundled, base) — visual diff on the board.
- Bi-weekly lanes still partition correctly; `free` ghost still shows for an empty lane.
- `CollisionDetailsDialog` "Both run on week A — move one to week B" hint unchanged.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that board tones and lanes render unchanged before proceeding.

---

## Phase 2: Interaction-safety + dnd hook

### Overview

Extract the repeated drag-inert handler and the dnd integration into a private `useCellDnd()` hook, eliminating the `setCellRef` `useMemo` and the 5× `onPointerDown` repetition. Still single-file (the move happens in Phase 3).

### Changes Required:

#### 1. Drag-inert handler

**File**: `src/_pages/plan-detail/ui/SlotCell.tsx`

**Intent**: Replace the 5 hand-repeated `onPointerDown`/`onClick` `stopPropagation` pairs with one shared affordance, so a future button can't silently re-enable drag-on-click.

**Contract**: Introduce a `stopDrag` helper (a `const` returning the paired handlers, or a small `<DragInertButton>` wrapper around `Button`). Each interactive child (toggle, trash, badge button, week-option, remove) uses it. Behavior identical — `onPointerDown` stops propagation; explicit `onClick` business logic still runs after its own `stopPropagation`. Note dnd-kit already auto-excludes `<button>`s from activation; this is the documented belt-and-braces.

#### 2. Private `useCellDnd` hook

**File**: `src/_pages/plan-detail/ui/SlotCell.tsx`

**Intent**: Treat the cell's dnd integration as a named behavioral flow (design-goal 1), removing the raw `useMemo` from the component body and giving the body a single declarative call — the Option-B resolution of D1.

**Contract**: A private `useCellDnd(day, period, bundled)` declared below the component (newspaper order), returning `{ setCellRef, isDropTarget, isDragging }`. It owns the `useDroppable<CellData>` + `useDraggable<BundleDrag>` calls and the merged-ref closure (replacing the `useMemo` at `:77–83`). The merge logic can inline a small `mergeRefs(dropRef, dragRef)`; promoting a generic `shared/lib/use-merged-ref.ts` is **deferred** until a second consumer appears (per "promote on second consumer") — `useCellDnd` is the single consumer today, so keep the merge local.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Type checking passes: `pnpm exec astro check`
- Linting passes: `pnpm lint` (no `useMemo`-in-body lint/convention flag remains)
- FSD structure clean: `pnpm steiger`

#### Manual Verification:

- Clicking the group/ungroup toggle, bundle-trash, collision badge, week option, and remove button never starts a drag.
- Grabbing a bundled cell body still drags the whole slot; loose chips still drag individually.
- Drop-target highlight and dragging opacity behave as before.

**Implementation Note**: Pause for manual confirmation that all five interactive controls remain drag-inert and bundle/chip drags still work before proceeding.

---

## Phase 3: Folder split + cva

### Overview

Convert `SlotCell.tsx` into a `ui/slot-cell/` folder-with-barrel, splitting the sub-components into sibling files, moving the tone table to `tone-class.ts`, dropping `WeekLane`'s `render` prop, and applying `cva` to `PlacedChip`. Largely mechanical now that logic is extracted.

### Changes Required:

#### 1. Folder + barrel

**File**: `src/_pages/plan-detail/ui/slot-cell/index.ts` (new), `…/slot-cell/SlotCell.tsx` (moved)

**Intent**: Graduate the file to a folder with one public surface, mirroring `model/constraints/`'s pure-barrel idiom.

**Contract**: `index.ts` is a pure barrel: `export { default } from "./SlotCell";` (default-only; no other re-exports). `SlotCell.tsx` becomes the orchestrator only. Update `PlannerGrid.tsx:3` import to `./slot-cell` (resolves to the barrel default). Preserve `data-slot="slot-cell"` and the other `data-slot` identity markers for now (stateful/coordinate `data-*` removal is Phase 4).

#### 2. Sub-component files

**File**: `…/slot-cell/PlacedChip.tsx`, `…/slot-cell/WeekLane.tsx`, `…/slot-cell/WeekToggle.tsx` (new)

**Intent**: Each tightly-coupled child becomes its own file; `WeekLane` imports `PlacedChip` directly instead of receiving a render callback.

**Contract**: `WeekLane`'s prop type drops `render`; it imports and renders `PlacedChip` as a sibling, building each chip's `onInspect` target internally from `day`/`period` (so it also fixes the per-chip inline-arrow memo hazard noted in research C2-memo). `SlotCell` passes `WeekLane` the data it needs (`partitionByWeek` output + the per-chip wiring), no `renderChip` threading. `PlacedChip`/`WeekLane`/`WeekToggle` stay unexported from the barrel (folder-internal).

#### 3. Tone class table

**File**: `…/slot-cell/tone-class.ts` (new)

**Intent**: House the `CellTone → Tailwind` lookup (absorbing `HINT_CLASS`) in `ui/`, keeping Tailwind strings out of `model/`.

**Contract**: Export `toneClass(tone: CellTone, hintMode: HintMode): string`. The `hint` tone case indexes the existing `HINT_CLASS[hintMode][hintState]` table (moved here, unchanged); `blocking`/`drop-target`/`warning`/`bundled`/`base` map to the ring/bg classes previously inline in the ladder. Module-level table sits at file bottom (the C1 trailing-constants norm).

#### 5. Tone-class mapping test

**File**: `…/slot-cell/tone-class.test.ts` (new)

**Intent**: Close the one gap the manual visual diff can miss — the precedence *order* is unit-tested in `model/cell-tone.test.ts`, but the enum→Tailwind *string* mapping is otherwise asserted only by eye. A typo in the hint branch is exactly the silent-ring failure this refactor exists to kill, yet it would pass every other automated gate.

**Contract**: Table-driven test asserting `toneClass` returns the expected class string for each non-hint tone (`blocking`/`drop-target`/`warning`/`bundled`/`base`) and for every `hint` combination — all five `DropHint | "free"` values × both `hintMode`s — pinned to the pre-refactor strings captured from `SlotCell.tsx:124–144` + `HINT_CLASS`.

#### 4. `cva` for PlacedChip tone

**File**: `…/slot-cell/PlacedChip.tsx`

**Intent**: Replace the `blocking ? … : warning ? … : neutral` ternary (`SlotCell.tsx:281–285`) with a typed `cva` variant, consistent with `badge.tsx`/`button.tsx`.

**Contract**: `cva({ variants: { tone: { blocking, warning, neutral } } })` driving the chip border/bg/text. Pending/dragging opacity stays a separate composed term (not a tone variant). `WeekToggle`'s pressed/unpressed styling is handled in Phase 4 by ToggleGroup, not here.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Type checking passes: `pnpm exec astro check`
- Linting passes: `pnpm lint`
- FSD structure clean: `pnpm steiger --fail-on-warnings` (folder + barrel respects layer rules)
- Build clean: `pnpm build`

#### Manual Verification:

- Board renders identically — chips, lanes, headers, tones all unchanged.
- `PlannerGrid` import resolves; no console/runtime errors.
- `WeekLane` shows chips and the `free` ghost as before with no `render` prop.

**Implementation Note**: Pause for manual confirmation that the board is visually and behaviorally identical post-split before proceeding.

---

## Phase 4: Accessibility — ToggleGroup, roles/ARIA, data-* swap

### Overview

Add a reusable `ToggleGroup` primitive and convert `WeekToggle`; give the board genuine grid/interactive semantics with accessible names; replace stateful and coordinate `data-*` with ARIA; keep `data-slot` as identity. This is the phase that unblocks role-based board e2e and discharges the A2–A5 accessibility debt. Keyboard *operation* of drag (A1) remains out of scope.

### Changes Required:

#### 1. Radix ToggleGroup primitive

**File**: `src/shared/ui/toggle-group.tsx` (new), `src/shared/ui/index.ts`

**Intent**: Add the shadcn ToggleGroup primitive so the A/B control has correct `radiogroup`/`radio` semantics, keyboard arrow-nav, and focus-visible rings for free.

**Contract**: **No new dependency** — `ToggleGroup` is already exported by the `radix-ui` umbrella package (`radix-ui@^1.6.0`, verified at `cbc51d3`); import it the same way every other primitive does (`import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";`), not via an individual `@radix-ui/react-toggle-group` package. Scaffold `shared/ui/toggle-group.tsx` following the existing shadcn primitive pattern (`tabs.tsx` as the closest reference): `cva`-styled `ToggleGroup` + `ToggleGroupItem`, `data-slot` markers, `focus-visible:ring`. Export both from `shared/ui/index.ts`. **Detokenize on add** (per `lessons.md` "Detokenize shadcn primitives on add"): audit the scaffolded output for literal/palette colors (`text-white`, `bg-black/50`, `*-gray-/slate-/red-*`, `bg-[#…]`) and replace with semantic tokens before commit; if a needed token is missing, add it to `global.css` first.

#### 2. Convert WeekToggle to ToggleGroup

**File**: `src/_pages/plan-detail/ui/slot-cell/WeekToggle.tsx`

**Intent**: Replace the two hand-rolled `aria-pressed` buttons with `ToggleGroup type="single"`, fixing the exclusive-choice semantics (A3) and the missing focus rings (E3).

**Contract**: `<ToggleGroup type="single" value={week} onValueChange={…}>` with two `ToggleGroupItem`s (`a`, `b`), each carrying an accessible name (`Week A` / `Week B`). `type="single"` yields `radiogroup`/`radio` + `aria-checked`. Preserve the pointer-down drag-inert behavior (`stopDrag`) and `pending`→`disabled`. e2e can now locate `cell.getByRole("radio", { name: "Week A" })` with `{ checked }`.

#### 3. Grid + cell roles and accessible names

**File**: `src/_pages/plan-detail/ui/PlannerGrid.tsx`, `…/slot-cell/SlotCell.tsx`

**Intent**: Render the timetable as a real grid so cells/chips/controls are locatable by role + name — the e2e enabler and the core a11y fix.

**Contract**:
- `PlannerGrid` grid container → `role="grid"` + `aria-label`. The cohort is **not** in PlannerGrid's props today — it lives on `PlannerBoard` (`PlannerBoard.tsx:36`). Add a single new prop to PlannerGrid (`gridLabel: string`, the already-formatted accessible name) and thread it from PlannerBoard, formatting the string at the board level (e.g. `` `${cohortLabel(cohort)} timetable` ``) so the raw cohort enum never leaks into the label. This one prop addition is the only sanctioned change to PlannerGrid's prop surface (see "What We're NOT Doing"). Each `PeriodRow` wrapper → `role="row"`; day headers → `role="columnheader"`, period header → `role="rowheader"`.
- `SlotCell` root → `role="gridcell"` + `aria-label={`${dayLabel(day)}, ${periodLabel(period)}`}` — **named even when empty** (solves the empty drop-target locator case). `dayLabel`/`periodLabel` already imported in `PlannerGrid`; thread the labels to the cell or import in the cell.

#### 4. Chip + lane ARIA

**File**: `src/_pages/plan-detail/ui/slot-cell/PlacedChip.tsx`, `…/WeekLane.tsx`

**Intent**: Make collision state and placement identity perceivable to AT and assertable by e2e; de-noise the empty-lane ghost.

**Contract**: `PlacedChip` carries `aria-roledescription="placement"`, its accessible name is the course name (already rendered), and `aria-invalid={blocking}` (the Badge already styles `aria-invalid`). `WeekLane`'s `free` ghost gets `aria-hidden="true"` (A4 — purely visual capacity cue); optionally the lane gets `aria-label={`Week ${label}`}` (A5).

#### 5. Drop stateful + coordinate `data-*`; keep `data-slot`

**File**: `…/slot-cell/SlotCell.tsx`, `…/PlacedChip.tsx`, `…/WeekLane.tsx`, `…/WeekToggle.tsx`

**Intent**: Remove the now-redundant `data-*` markers whose meaning ARIA + accessible names now carry, keeping a single source of truth for state.

**Contract**: Remove `data-collision`, `data-availability`, `data-bundled`, `data-drop-hint` (stateful) and `data-day`, `data-period`, `data-course-id`, `data-week` (coordinate). Keep all `data-slot="…"` identity markers (`slot-cell`, `placed-chip`, `week-lane`, `week-toggle`, the buttons) — house convention, never the test contract. Verified safe: no CSS/JS/test reads any of the removed attributes.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Type checking passes: `pnpm exec astro check`
- Linting passes: `pnpm lint`
- FSD structure clean: `pnpm steiger --fail-on-warnings`
- Build clean: `pnpm build`
- New `shared/ui` export present: `grep -q "toggle-group" src/shared/ui/index.ts`

#### Manual Verification:

- Accessibility tree (browser devtools / screen reader) shows `grid` "… timetable", `gridcell`s named "Monday, period 1" (including empty cells), chips named by course with `aria-roledescription="placement"`, blocking chips `aria-invalid`.
- A/B control is a `radiogroup` with two `radio`s, the active week `checked`, focus-visible ring on keyboard focus, arrow keys move selection; selecting still writes placement week.
- Collision badge still opens the details dialog; week switch still moves the chip between lanes.
- Playwright can locate a cell via `getByRole("gridcell", { name: … })` and a week control via `getByRole("radio", …)` (spot-check in a REPL/run; no new spec required by this plan).

**Implementation Note**: Pause for manual confirmation that the accessibility tree and the A/B radio control behave as specified, and that no board interaction regressed, before proceeding.

---

## Phase 5: Convention docs

### Overview

Codify the four conventions the landed code now demonstrates, plus one e2e rationale line. Documentation-only; no code.

### Changes Required:

#### 1. Folder-split threshold (with cohesion caveat)

**File**: `context/foundation/ui-conventions.md`

**Intent**: Document when a `ui/` component graduates to a folder, with the caveat that prevents it retroactively flagging healthy cohesive files.

**Contract**: Add a rule near "One exported component per file": a `ui/` component graduates to a folder-with-pure-barrel when it has **3+ private sub-components serving *unrelated* concerns** *or* exceeds ~250 lines **and** its children are not one cohesive concern. Explicitly note `CollisionDetailsDialog` (4 children, one "render one violation" concern) and `PlannerBoard` (private hooks) are **not** flagged. Reference `model/constraints/` and `ui/slot-cell/` as the barrel idiom.

#### 2. Role + ARIA e2e contract

**File**: `context/foundation/ui-conventions.md`, `e2e/CLAUDE.md`

**Intent**: Lock in the locatability decision so future board work stays role-addressable.

**Contract**: In `ui-conventions.md`: interactive/grid components must carry roles + accessible names sufficient for role-based e2e; user-perceivable state is expressed via ARIA (`aria-invalid`/`aria-checked`/`disabled`); `data-*` is for component identity (`data-slot`) only — never the test contract; visual-only logic (tone precedence, hint encoding) is unit-tested, not e2e-asserted. In `e2e/CLAUDE.md`: one line — board cells/chips/controls are reached by role + accessible name; visual-state logic is unit-tested rather than selected on (no rule change to the role-based-locators mandate).

#### 3. Trailing constants placement (C1)

**File**: `context/foundation/ui-conventions.md`

**Intent**: Document the existing-but-unwritten norm that lookup tables/pure helpers sit at file bottom.

**Contract**: Extend the "File ordering (newspaper rule)" list with a 6th item: module-level constants/lookup tables and pure helpers go at the file **bottom**, after private sub-components. Cite `HINT_CLASS`/`tone-class.ts`, `PLUGINS`, `groupByCell`.

#### 4. D1 — dnd hooks extract to a named private hook (Option B)

**File**: `context/foundation/ui-conventions.md`

**Intent**: Resolve the standing tension between the declarative-component rule and inline dnd-kit hooks, in favor of extraction.

**Contract**: Under "Declarative components": dnd-kit integration extracts to a named private hook below the component (like any behavioral flow), e.g. `useCellDnd`; the component body holds no raw `useState`/`useEffect`/`useMemo`. Note `GroupingBox`/`PlannerBoard` inline dnd hooks and the `weekModeByCourseId` memo are flagged for the same treatment when next touched (not forced by this change).

### Success Criteria:

#### Automated Verification:

- Markdown is well-formed: `pnpm format` leaves docs clean (or `pnpm lint` if md-linted).
- No broken intra-repo references in the edited docs (manual grep of cited paths).

#### Manual Verification:

- Each codified rule matches what the landed code actually does (folder shape, ARIA, trailing constants, `useCellDnd`).
- The cohesion caveat reads clearly enough that `CollisionDetailsDialog`/`PlannerBoard` are unambiguously exempt.

**Implementation Note**: Final phase — confirm the four deltas read coherently against the shipped code; then this change is ready to archive.

---

## Testing Strategy

### Unit Tests:

- `model/cell-tone.test.ts` — full precedence matrix (each higher state beats each lower; base fallback; hint-value pass-through for all five `DropHint | "free"` values).
- `model/week.test.ts` — `partitionByWeek` grouping + order preservation; `isBiweekly`/`hasBiweekly` truth table; `sharedSingleWeek` null cases (`both`/differs/absent) and shared-week case; `weekLabel`/`otherWeek`.
- `ui/slot-cell/tone-class.test.ts` (Phase 3) — `toneClass` string mapping for every tone, including all five `hint` values × both `hintMode`s, pinned to the pre-refactor class strings (the parity guard the visual diff can't catch).

### Integration Tests:

- None required — this is a UI/model refactor with no Supabase/data-flow change. The existing slice unit + integration suites must stay green (`pnpm test`, and `pnpm test:integration` unaffected).

### Manual Testing Steps:

1. Load a plan with agnostic-only cells, bi-weekly cells (A/B lanes + `free` ghost), bundled cells, and a collision — confirm every tone renders as before (Phase 1/3).
2. Click each interactive control (toggle, trash, badge, week option, remove) — none starts a drag; bundle/chip drags still work (Phase 2).
3. Inspect the accessibility tree: `grid` named, `gridcell`s named (incl. empty), chips named + `aria-roledescription` + `aria-invalid` on blocking, A/B as `radiogroup`/`radio` with `checked` + focus ring + arrow nav (Phase 4).
4. Spot-check Playwright role locators resolve cells/chips/week controls (Phase 4).

## Performance Considerations

- The <200ms drag-drop budget is unaffected: `resolveCellTone` and `partitionByWeek` are O(occupants) pure functions replacing equivalent inline work (and `partitionByWeek` replaces *three* `.filter()` passes with one). The tone resolver removes per-render negated-boolean churn.
- Extracting `PlacedChip` to its own file with internally-built `onInspect` (Phase 3) removes the per-chip inline-arrow allocation, keeping the door open for `React.memo` on `PlacedChip` if the budget ever needs it (research C2-memo) — not added now.

## Migration Notes

- No data/schema migration. `data-*` removal is safe (verified zero consumers at `cbc51d3`). The only external touch-point is `PlannerGrid.tsx`'s `./SlotCell` import, which becomes `./slot-cell` (barrel default).
- **No new runtime dependency.** `ToggleGroup` ships in the already-installed `radix-ui` umbrella (`^1.6.0`) — same package every `shared/ui` primitive imports — so there is no workerd build-compat risk to clear.

## References

- Originating review: `context/changes/slot-cell-refactor/change.md`
- Research (a11y/e2e axis, convention candidates, negatives): `context/changes/slot-cell-refactor/research.md`
- Folder-with-barrel idiom: `src/_pages/plan-detail/model/constraints/index.ts`
- `cva` reference primitives: `src/shared/ui/badge.tsx`, `button.tsx`, `tabs.tsx`
- Week home: `src/_pages/plan-detail/model/week.ts`
- e2e locator rule: `e2e/CLAUDE.md:15`
- Conventions: `context/foundation/ui-conventions.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pure model core (reliability + week convergence)

#### Automated

- [x] 1.1 Unit tests pass: `pnpm test` — 3ad8231
- [x] 1.2 New model tests exist and pass: `pnpm test -- cell-tone week` — 3ad8231
- [x] 1.3 Type checking passes: `pnpm exec astro check` — 3ad8231
- [x] 1.4 Linting passes: `pnpm lint` — 3ad8231
- [x] 1.5 FSD structure clean: `pnpm steiger` — 3ad8231

#### Manual

- [x] 1.6 Cell tones render identically for each state (visual diff)
- [x] 1.7 Bi-weekly lanes partition correctly; `free` ghost shows
- [x] 1.8 `CollisionDetailsDialog` same-week hint unchanged

### Phase 2: Interaction-safety + dnd hook

#### Automated

- [x] 2.1 Unit tests pass: `pnpm test` — bdd6081
- [x] 2.2 Type checking passes: `pnpm exec astro check` — bdd6081
- [x] 2.3 Linting passes: `pnpm lint` (no useMemo-in-body flag) — bdd6081
- [x] 2.4 FSD structure clean: `pnpm steiger` — bdd6081

#### Manual

- [x] 2.5 All five interactive controls remain drag-inert
- [x] 2.6 Bundle body drag + loose chip drag still work
- [x] 2.7 Drop-target highlight + dragging opacity unchanged

### Phase 3: Folder split + cva

#### Automated

- [x] 3.1 Unit tests pass: `pnpm test` — e2b6b4e
- [x] 3.2 Type checking passes: `pnpm exec astro check` — e2b6b4e
- [x] 3.3 Linting passes: `pnpm lint` — e2b6b4e
- [x] 3.4 FSD structure clean: `pnpm steiger --fail-on-warnings` — e2b6b4e
- [x] 3.5 Build clean: `pnpm build` — e2b6b4e

#### Manual

- [x] 3.6 Board renders identically post-split
- [x] 3.7 `PlannerGrid` import resolves; no runtime errors
- [x] 3.8 `WeekLane` shows chips + `free` ghost with no `render` prop

### Phase 4: Accessibility — ToggleGroup, roles/ARIA, data-* swap

#### Automated

- [x] 4.1 Unit tests pass: `pnpm test` — b27f4f3
- [x] 4.2 Type checking passes: `pnpm exec astro check` — b27f4f3
- [x] 4.3 Linting passes: `pnpm lint` — b27f4f3
- [x] 4.4 FSD structure clean: `pnpm steiger --fail-on-warnings` — b27f4f3
- [x] 4.5 Build clean: `pnpm build` — b27f4f3
- [x] 4.6 New `shared/ui` export present: `grep -q "toggle-group" src/shared/ui/index.ts` — b27f4f3

#### Manual

- [x] 4.7 Accessibility tree shows grid + named cells (incl. empty) + chip ARIA
- [x] 4.8 A/B control is radiogroup/radio, checked + focus ring + arrow nav; write still works
- [x] 4.9 Collision badge + week switch still function
- [x] 4.10 Playwright role locators resolve cells/chips/week controls

### Phase 5: Convention docs

#### Automated

- [x] 5.1 Docs format clean: `pnpm format`
- [x] 5.2 Cited intra-repo paths exist (manual grep)

#### Manual

- [x] 5.3 Each codified rule matches landed code
- [x] 5.4 Cohesion caveat unambiguously exempts CollisionDetailsDialog/PlannerBoard
