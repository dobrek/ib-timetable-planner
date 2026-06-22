---
date: 2026-06-22T10:50:58+0200
researcher: Dobromir Kropielnicki
git_commit: cbc51d387efc2c6b2c3cbb86ae19536a06df0a32
branch: main
repository: 10xdev3
topic: "SlotCell refactor — issues & convention candidates beyond the review notes"
tags: [research, codebase, plan-detail, slot-cell, ui-conventions, accessibility, dnd-kit]
status: complete
last_updated: 2026-06-22
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Added follow-up: role/aria additions to enable role-based e2e, and a keep/replace decision for the data-* attributes"
---

# Research: SlotCell refactor — issues & convention candidates beyond the review notes

**Date**: 2026-06-22T10:50:58+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: cbc51d387efc2c6b2c3cbb86ae19536a06df0a32
**Branch**: main
**Repository**: 10xdev3

## Research Question

For `src/_pages/plan-detail/ui/SlotCell.tsx`, find any **other** issues or room for improvement **beyond** those already written in `change.md` review notes — with particular attention to anything that could be a potential adjustment to the project's **UI convention** (`context/foundation/ui-conventions.md`).

## Scope note — what the notes already cover (excluded below)

The review notes in `change.md` already cover, and these are **not** re-litigated here:
folder-split threshold, the `resolveCellTone` precedence resolver + tone table, applying `cva` to `PlacedChip`/`WeekToggle`, extracting a `stopDrag` handler, promoting `useMergedRef` to `shared/lib`, and removing the `WeekLane` `render` prop. This document reports findings **outside** that set.

## Summary

The new findings cluster into four groups, ordered by value:

1. **Accessibility (highest-value gap, entirely unaddressed by the notes).** The planner's core interaction — drag-and-drop placement — is **mouse-only**: no keyboard sensor, no focusable draggables, no accessible names on cells. Collision/warning state is communicated purely visually (rings + `data-*`), silent to assistive tech. `WeekToggle` models an exclusive A/B choice as two independent `aria-pressed` toggles (should be a radiogroup / `ToggleGroup type="single"`). Raw `<button>`s in `WeekToggle` lack `focus-visible` rings.

2. **Prop-drilling that PlannerGrid should collapse.** The 14-field cell prop type — including 5 pass-through callbacks plus `names`, `collisions`, `dropHints`, `hintMode` — is **declared verbatim three times** (Grid → PeriodRow → SlotCell) with PeriodRow adding nothing. The whole `names` map is handed to all 50 cells. Candidate convention: a `CellHandlers`/`CellWiring` bundle or a small grid context.

3. **Convention candidates the doc is silent on.** (a) **Where module-level lookup tables / constants go** — `HINT_CLASS` at file-bottom actually *matches* an unwritten slice norm (`PLUGINS`, `groupByCell`, `groupByKind` all sit at the bottom); the newspaper rule just never documents trailing constants. (b) **Week classification (`a`/`b`/`both`) is scattered across `ui/` files** and should live in `model/` per the "complexity budget lives in model/" rule. (c) The proposed **file-split threshold would retroactively flag** `CollisionDetailsDialog` (257 lines / 4 children) and `PlannerBoard` (280 lines) — the rule needs qualifying.

4. **Confirmations & negatives.** The negated-class-ladder is genuinely **isolated to SlotCell** — not a systemic smell (the rest of the repo uses `cva` and lookup tables). The `data-*` "test contract" claim is **true**: zero external references, and the e2e suite (which exists) uses role-based locators only, never `data-*`. Token compliance is **fully clean**. The button-in-`<Badge asChild>` is **valid** (Slot merges to one `<button>`).

## Detailed Findings

### A. Accessibility (not covered by notes — highest value)

The notes are silent on a11y; this is the biggest substantive gap in the file.

- **A1 — No keyboard access to drag-and-drop at all.** `SlotCell.tsx:64-83` (cell droppable/draggable), `SlotCell.tsx:264-268` (chip draggable), `SlotCell.tsx:71-75` (bundle drag). Draggables/droppables are plain `<div>`s with no `tabIndex`, `role`, or activator. dnd-kit ships a `KeyboardSensor`, but it only engages on focusable elements with an activator. As written a keyboard-only user can place/move/bundle nothing — the product's primary workflow is mouse-only. Fix is plan-sized: focusable + `aria-roledescription` draggables, register the keyboard/accessibility plugin in `PlannerBoard`'s `PLUGINS` (`PlannerBoard.tsx:278`), accessible names on cells. **Worth a dedicated change, not folded into this refactor.**
- **A2 — Collision/drop state is silent to AT.** `SlotCell.tsx:114-145`. All status (`data-collision`, `data-availability`, `data-drop-hint`, `isDropTarget`) is visual-only — no `aria-invalid`, no `role="status"`, no `aria-live`. The validation feedback that is the product's whole point is imperceptible non-visually. Cheap win: `aria-invalid={blocking}` on the chip (the Badge already styles `aria-invalid`); optional `aria-live="polite"` collision summary near the grid.
- **A3 — `WeekToggle` semantics misrepresent an exclusive choice.** `SlotCell.tsx:360-402`. A/B is mutually exclusive but modeled as `role="group"` + two `aria-pressed` buttons ("two independent toggles"). Correct pattern: `role="radiogroup"` + `role="radio"`/`aria-checked`, or shadcn/Radix `ToggleGroup type="single"` (adds arrow-key nav). **Note:** this would *contradict* the existing `aria-pressed` usage — flag as a deliberate convention decision.
- **A4 / A5 — Empty-lane "free" ghost + stranded lane.** `SlotCell.tsx:217-234`. The lane label is `aria-hidden` (`:219`) but the ghost text `free` (`:228-234`) is **not** — a screen reader hears a bare "free" with no scoping "A"/"B". Worst of both: hidden label, announced ghost. Either `aria-hidden` the ghost too (purely visual capacity cue) or give the lane `aria-label={`Week ${label}`}`.
- **E3 — `WeekToggle` buttons lack `focus-visible` rings.** `SlotCell.tsx:390-395`. Raw `<button>`s with hover-only styling, unlike shadcn `Button`/`Badge` which define `focus-visible:ring`. Keyboard focus is invisible on the A/B control. Pairs with A3.
- **A6 (verified OK)** — button-in-`<Badge asChild>` (`SlotCell.tsx:293-314`) is valid: `asChild` → `Slot.Root` merges props onto the single `<button>`, so the DOM is one button, no nested-interactive violation. The `sr-only sm:not-sr-only` label alongside `aria-label` is slightly redundant but acceptable.

### B. Prop design / drilling (PlannerGrid)

- **B1 — Triple-declared 14-field cell wiring; PeriodRow is a pure pass-through.** `PlannerGrid.tsx:34-87` (Grid), `:89-147` (PeriodRow re-declares the identical type), `:126-142` (construction). The set `{ onRemove, onSetWeek, onToggleBundle, onRemoveBundle, onInspect }` + `names, collisions, dropHints, hintMode, isOverridden` is declared **three times verbatim**; PeriodRow only re-emits. Lower-risk fix: bundle the 5 stable callbacks into one `handlers` object (a `CellHandlers` type) built once in `PlannerBoard`. Higher-leverage: a small `PlannerGridContext` for handlers + `names` + `hintMode`, shrinking SlotCell's surface to genuinely per-cell data.
- **B2 — Whole `names: Record<string,string>` map handed to every cell.** `PlannerGrid.tsx:73,107,132`; `SlotCell.tsx:20,100-101`. Each of ~50 cells receives the full map and uses only its occupants'. Stable reference (doesn't break memo) but couples every cell to global state. `groupByCell` (`PlannerGrid.tsx:154`) already has `names` and sorts by it — it could attach the resolved `name` onto each occupant, so SlotCell/PlacedChip never see the map and the `names[id] ?? id` fallback stops being duplicated across grid/chip/dialog.
- **B3 — PeriodRow prop type is a copy of Grid's.** `PlannerGrid.tsx:103-117`. Extract a shared `CellWiring` type and spread; pairs with B1.

### C. Convention candidates (no current doc rule)

- **C1 — Placement of module-level constant/lookup tables.** The newspaper rule (`ui-conventions.md`, "File ordering") stops at "private sub-components" and is silent on trailing constants. In practice the slice consistently puts constants/pure helpers at the **bottom**: `HINT_CLASS` (`SlotCell.tsx:411`), `PLUGINS` (`PlannerBoard.tsx:278`), `groupByCell`/`compareByName` (`PlannerGrid.tsx:154-163`), `groupByKind` + `ViolationsByKind` (`CollisionDetailsDialog.tsx:236-257`). So `HINT_CLASS` **follows** the unwritten norm — the convention gap is that the norm isn't documented. **Candidate rule:** "module-level constants/lookup tables and pure helpers go at the file bottom, after sub-components."
- **C2 — Week classification logic belongs in `model/`.** Per `ui-conventions.md` design-goal 2 ("the complexity budget lives in model/"). Scattered across `ui/`:
  - `SlotCell.tsx:95` — `hasBiweekly = occupants.some(week === "a" || "b")`.
  - `SlotCell.tsx:192-194` — week-lane partitioning: three inline `occupants.filter(...)` passes (`both`/`a`/`b`) re-scanning occupants each render → a pure `partitionByWeek(occupants)` in `model/` (tested, computed once).
  - `SlotCell.tsx:270` (`PlacedChip`) — `isBiweekly = week === "a" || "b"` duplicates the predicate; `CollisionDetailsDialog.tsx:222-229` has its own `sharedSingleWeek`/`otherWeek`/`weekLabel` week helpers. There is a `model/week.ts` already — the a/b/both classification should converge there. **This is the most defensible new extraction target beyond the noted tone resolver.**
  - (Not a concern: `blockingIds/warningIds/unavailable` destructuring at `SlotCell.tsx:85-89` is simple prop-shape access, allowed by the "simple prop transforms" clause.)
- **C3 — The proposed split threshold isn't consistently applicable.** "Split at 3+ sub-components OR ~250 lines" would retroactively flag existing, cohesive files: `CollisionDetailsDialog.tsx` (257 lines, **4** private children: `DetailsBody`, `CourseName`, `CourseNameList`, `SameWeekHint`) and `PlannerBoard.tsx` (280 lines, 7 private hooks). Either raise/qualify the threshold (tie it to *unrelated* concerns, not raw count — CollisionDetailsDialog's children are one cohesive "render one violation" concern), or accept 250–280-line cohesive `ui/` files as the slice norm. **Key caveat for the proposed rule.**

### D. Component-body purity (existing rule, mild violation)

- **D1 — Inline `useMemo` in the component body.** `ui-conventions.md` "Declarative components": no `useState/useEffect/useMemo` in the body. `SlotCell.tsx:77-83` (`setCellRef` memo) violates it. **Context:** the `useDraggable`/`useDroppable` calls inline in the body (`SlotCell.tsx:64-75`, `:264-268`) are **not** a SlotCell outlier — body-inline dnd-kit hooks are the slice norm (`GroupingBox.tsx:31-34`, `PlannerBoard.tsx`). And there is a **precedent** for the memo violation: `PlannerBoard.tsx:38` (`weekModeByCourseId = useMemo(...)`) is also an inline-body memo. Extracting a private `useCellDnd()` hook below the component (returning `{ setCellRef, isDropTarget, isDragging }`) would resolve both the memo and the inline-hook tension and match the newspaper rule — overlaps with the noted `useMergedRef` promotion but is broader.

### E. Correctness / subtle notes (low priority, not bugs)

- **C1(opacity) — opacity axis can stack.** `SlotCell.tsx:143` (`isDragging` → `opacity-60`) is independent of the hint opacities (`partial` 70, `blocked` 40 in `HINT_CLASS`). The precedence comment at `:126-128` reasons only about *rings*, not opacity — on a dragging origin cell these can co-apply. Not a confirmed visual bug; worth a note when building `resolveCellTone` (the opacity axis is separate from tone).
- **C2(memo) — `renderChip` inline `onInspect` arrow.** `SlotCell.tsx:108-110` builds a fresh `() => onInspect({...})` per chip per render. Harmless today, but defeats `React.memo` on `PlacedChip` if ever added for the <200ms budget — when extracting `PlacedChip` to its own file, pass `day`/`period`/`onInspect` and build the target internally.
- **C4 — single-occupant biweekly shows lanes but no header.** `SlotCell.tsx:92,95,189`. `hasHeader` (`>=2`) and `hasBiweekly` are independent: one biweekly occupant renders A/B lanes + a `free` ghost but no group toggle. Probably intended (capacity hint) — confirm the design wants lanes for a lone occupant.
- **E1 — `data-slot` collision on the badge.** `SlotCell.tsx:296` passes `data-slot="collision-badge"`/`"unavailable-badge"` onto the same element where `Badge` sets `data-slot="badge"` (`badge.tsx:38`); the caller's value wins. Intended, but any global `[data-slot="badge"]` styling/selector silently won't match here.
- **E2 — dense-cell overflow risk.** `SlotCell.tsx:125` (`min-h-16`, no max) within `PlannerGrid.tsx:57` (`minmax(7rem,1fr)`); many occupants × two lanes + header grow the row, with `overflow-auto` only at the outer container (`PlannerBoard.tsx:146`). Layout note, not a bug.

### F. Confirmations & negatives (rule out, so the plan doesn't chase them)

- **Negated-class-ladder is isolated to SlotCell.** Repo-wide search found the `cond && !other && !another && "classes"` ring-precedence ladder **only** in `SlotCell.tsx:124-144`. Everywhere else uses the *good* patterns: `cva` (`shared/ui/badge.tsx`, `button.tsx`, `tabs.tsx`) and class lookup tables (`HINT_CLASS`; `teachers/ui/TeacherAvailabilityDialog.tsx:233-237`; `courses/model/merge.ts:78-85`; `courses/lib/labels.ts:22-27`). Clean ternaries (no negation, non-colliding props) at `SlotCell.tsx:279-289`, `:390-395`, `TeacherAvailabilityDialog.tsx:198-203`. **Verdict:** the ladder is a legitimate local workaround, not a systemic smell — the fix is the noted `resolveCellTone`, and it does **not** warrant a new "ban negated ladders" convention (the repo already defaults to the right patterns).
- **`data-*` "test contract" claim is TRUE.** Zero references to any SlotCell `data-*` value (`slot-cell`, `placed-chip`, `week-lane`, `data-day`, `data-collision`, `data-drop-hint`, …) in any `*.test.ts(x)`, `*.integration.test.ts`, or e2e spec. The e2e suite **does exist** (`playwright.config.ts`, `e2e/specs/*.ts`, `pnpm test:e2e`) but `e2e/CLAUDE.md:15` mandates **role-based locators, never CSS/DOM/data-attributes**, and no plan-board e2e specs exist yet. So the "freeze the attribute names before tests grow against them" note is sound — but note the e2e convention means future board tests will lean on **roles/labels**, which reinforces the a11y findings (A1–A5): better aria *is* what makes the board e2e-testable.
- **Token compliance is fully clean.** No hex, arbitrary `[#...]`, or raw palette across SlotCell, PlannerGrid, CollisionDetailsDialog, badge, button. Opacity modifiers on tokens (`/5 /10 /40 /60`) are allowed. (Satisfies the lessons.md semantic-tokens rule.)

## Code References

- `src/_pages/plan-detail/ui/SlotCell.tsx:64-83` — body-inline `useDraggable`/`useDroppable` + `setCellRef` `useMemo` (D1, A1)
- `src/_pages/plan-detail/ui/SlotCell.tsx:114-145` — cell `data-*` state attrs, visual-only status (A2), negated ring ladder (F)
- `src/_pages/plan-detail/ui/SlotCell.tsx:189-234` — `hasBiweekly` lanes, week partitioning (C2), `free` ghost a11y (A4/A5)
- `src/_pages/plan-detail/ui/SlotCell.tsx:264-353` — `PlacedChip`: chip draggable, badge button (A6), `isBiweekly` dup (C2)
- `src/_pages/plan-detail/ui/SlotCell.tsx:360-402` — `WeekToggle`: aria-pressed vs radiogroup (A3), no focus ring (E3)
- `src/_pages/plan-detail/ui/SlotCell.tsx:411-427` — `HINT_CLASS` table at file bottom (C1)
- `src/_pages/plan-detail/ui/PlannerGrid.tsx:34-147` — triple-declared cell wiring, PeriodRow pass-through (B1/B3), `names` threading (B2)
- `src/_pages/plan-detail/ui/PlannerBoard.tsx:38` — inline-body `useMemo` precedent (D1); `:278` `PLUGINS` (C1, A1 plugin hook)
- `src/_pages/plan-detail/ui/CollisionDetailsDialog.tsx:222-257` — week helpers (C2) + 4 children / 257 lines (C3)
- `src/_pages/plan-detail/model/week.ts` — existing home for week classification (C2)
- `src/shared/ui/badge.tsx`, `button.tsx`, `tabs.tsx` — `cva` reference patterns (F)
- `e2e/CLAUDE.md:15` — role-based-locators-only rule (F, reinforces A1–A5)

## Architecture Insights

- **The slice's de-facto file shape is already consistent**: component → private hooks → private sub-components → trailing constants/helpers. SlotCell follows it; the convention doc just under-specifies the tail. Codifying C1 documents reality rather than changing it.
- **dnd-kit hooks live inline in the body across the slice** — this is the established answer, so the "declarative template" rule has a standing exception for dnd integration. The honest convention update is to *name that exception* (dnd hooks may stay in the body; non-dnd memos/state must extract), which both legitimizes SlotCell/GroupingBox and flags the `setCellRef`/`weekModeByCourseId` memos for extraction.
- **Accessibility is the slice's true debt**, and it's coupled to testability: the e2e convention forbids `data-*`/CSS selectors, so the board can only become e2e-testable once chips/cells/toggles carry proper roles and names. A1–A5 are therefore not just a11y polish — they unblock the board's e2e coverage.
- **The proposed split rule should be reframed** from a raw count to a cohesion test ("split when sub-components serve *unrelated* concerns"), since count alone flags two healthy files.

## Historical Context (from prior changes)

- `context/foundation/lessons.md` — "Use semantic theme tokens, never hardcoded color/value Tailwind classes" (SlotCell passes — finding F); "Port the mechanism, not the legacy type shape" (relevant to keeping `resolveCellTone` modeled on app domain types).
- `context/foundation/ui-conventions.md` "Applicability to plan-detail" — three listed remaining deltas remain **open** but are **outside SlotCell**: `grouping-client.ts` ad-hoc `{ error }` (confirmed `api/grouping-client.ts:3-10`), `location.reload()` vs `refreshPage()` (confirmed `ComputeGroupingsEmptyState.tsx:53`), and unused `warnings` (S-06). Note for the plan: don't scope-creep these into the SlotCell refactor.

## Related Research

- `context/changes/slot-cell-refactor/change.md` — the originating review notes (items deliberately excluded above).

## Open Questions

1. **Is keyboard DnD (A1) in scope for this refactor or a follow-up change?** It's the highest-value gap but plan-sized and orthogonal to the structural cleanup. Recommendation: separate change.
2. **A3 — adopt radiogroup/`ToggleGroup` semantics for `WeekToggle`?** This reverses the existing `aria-pressed` convention; needs an explicit decision.
3. **C3 — reframe the split threshold to a cohesion test**, or accept ~280-line cohesive files? Affects whether CollisionDetailsDialog/PlannerBoard get retroactively flagged.
4. **C2 — converge week classification into `model/week.ts`** now (alongside the tone resolver) or defer? It touches `CollisionDetailsDialog` too.

## Follow-up Research 2026-06-22T11:05:00+0200 — roles for e2e + data-* keep/replace

**Decision adopted:** keep the e2e "role-based locators, never CSS/data-*" rule (`e2e/CLAUDE.md:15`) intact. Instead, add the missing roles/accessible names so the planner board is locatable by role, and **keep `data-*` only where it genuinely earns its place**. This both unblocks board e2e coverage and discharges the A1–A5 accessibility debt in one pass.

### Grounding finding — no `data-*` is load-bearing today

Verified at commit `cbc51d3`: none of SlotCell's `data-*` attributes are referenced in CSS (`src/app/styles/`) or queried at runtime (no `querySelector`/`closest`/`getAttribute`/`[data-...]` reads anywhere in `src`). They are pure markers. So "essential for the current implementation" is, functionally, the **empty set** — nothing breaks if any are removed. The decision below is therefore about *house convention* and *test contract*, not runtime behavior.

### Roles & accessible names to add (the e2e enabler)

Render the board with genuine tabular/interactive semantics (a timetable *is* a grid). Target shape:

| Element | Current | Add | Enables e2e locator |
| --- | --- | --- | --- |
| Grid container (`PlannerGrid.tsx`) | `<div>` CSS grid | `role="grid"` + `aria-label="<cohort> timetable"`; rows `role="row"` | `getByRole("grid", { name: "DP1 timetable" })` |
| Day/period headers (`PlannerGrid.tsx:120,138`) | plain `<div>` | `role="columnheader"` / `role="rowheader"` | scope/readability |
| Cell (`SlotCell.tsx:114`) | `<div data-slot="slot-cell">` | `role="gridcell"` + `aria-label={`${dayLabel}, ${periodLabel}`}` (empty cells named too, e.g. `…, empty` — solves the drop-target-with-no-content case) | `getByRole("gridcell", { name: "Monday, period 1" })` |
| Placed chip (`SlotCell.tsx:273`) | `<div data-slot="placed-chip">` | accessible name = course name (already rendered) + `aria-roledescription="placement"`; `aria-invalid={blocking}` (A2) | `cell.getByText("Mathematics HL")`; collision asserted via `aria-invalid` |
| Week toggle (`SlotCell.tsx:360-402`) | `role="group"` + `aria-pressed` | convert to `role="radiogroup"` + `role="radio"`/`aria-checked` (A3); add `focus-visible` ring (E3) | `cell.getByRole("radio", { name: "Week A" })` with `{ checked }` |
| Empty-lane ghost (`SlotCell.tsx:228`) | announced text `free` | `aria-hidden="true"` (A4) — purely visual capacity cue | n/a (de-noised) |
| Lane (`SlotCell.tsx:217`) | label `aria-hidden` | `aria-label={`Week ${label}`}` on the lane (A5) | optional grouping anchor |
| Collision/unavailable badge (`SlotCell.tsx:299`) | `<button aria-label="Show collision details">` (already role-ready) | keep | `cell.getByRole("button", { name: /collision/i })` |

Plus the keyboard-DnD enablement (A1) — focusable draggables + the dnd-kit keyboard/accessibility plugin in `PlannerBoard`'s `PLUGINS` (`PlannerBoard.tsx:278`) — which is what makes the role-located elements actually operable in an e2e drag.

### e2e assertion split (so roles are sufficient)

- **Coordinate / identity / selection** → role + accessible name (`gridcell` by name, chip by text, `radio` checked).
- **User-perceivable state** → ARIA, asserted on the role-located element: collision via `aria-invalid`, week via `aria-checked`, pending via `disabled`. These carry to assistive tech *and* to Playwright.
- **Visual-only logic** (tone precedence, `data-drop-hint` encoding, ring colors) → **not e2e-asserted at all**; covered by the model unit tests (`resolveCellTone`, `drop-hints`, `partitionByWeek`). E2e asserts the *outcome* (placement landed / rejected), not the intermediate hint coloring.

### data-* keep / replace decision

Three buckets, by what each attribute is *for*:

1. **Component identity — KEEP as house convention, but NOT as the test contract.** `data-slot` is the repo-wide shadcn idiom (117 values across 26 files). Keep it on structural nodes (`slot-cell`, `placed-chip`, `week-lane`, `week-toggle`, the buttons) for component-identity consistency. It costs nothing and documents the tree — but e2e selects by **role**, not `data-slot`.
2. **Reactive state — REPLACE with ARIA.** `data-collision`, `data-availability`, `data-conflicted`, `data-warning`, `data-bundled`, `data-drop-hint` duplicate state that should be expressed semantically. Move to `aria-invalid` (collision/conflict on the chip), `aria-checked` (week), and drop the rest (drop-hint is visual-only → unit-tested). These aren't read anywhere, so removal is safe. *(`data-bundled`/`data-drop-hint` may stay transiently if a CSS attribute-selector ever wants them, but none exists today and the tone table drives styling instead.)*
3. **Coordinate / lookup — REPLACE with accessible names.** `data-day`, `data-period`, `data-course-id`, `data-week` become redundant once cells carry `aria-label="Monday, period 1"` and chips carry their name + `aria-roledescription`. Drop them; the accessible name is the stable, by-the-book anchor (and also handles the empty-cell drop target).

**Net:** after this work, `data-slot` survives as identity documentation; the stateful/coordinate `data-*` are replaced by ARIA + accessible names; no `data-*` is the e2e contract. The originating note's "freeze the attribute names before tests grow against them" (`change.md:39`) is satisfied differently — the frozen contract becomes **roles + accessible names**, not attributes.

### Optional, reserved (not adopted now)

If a future locator is genuinely impossible by role (none identified for this board), the narrow, defensible relaxation is `getByTestId` against a **frozen `data-testid`** for structural anchors with no accessible-name equivalent — explicitly *not* a loosening to positional/CSS/XPath selectors. Reserved, not used: every board case above resolves by role + name.

### Convention deltas this implies

- **`e2e/CLAUDE.md`** — no change to the rule; add a one-line rationale that board cells/chips/controls are reached by role + accessible name, and that visual-state logic is unit-tested rather than selected on.
- **`ui-conventions.md`** — candidate addition: interactive/grid components must carry roles + accessible names sufficient for role-based e2e (state via ARIA: `aria-invalid`/`aria-checked`/`disabled`), and `data-*` is for component identity only, never the test contract.

### Open question added

5. **Scope of A1 (keyboard DnD) vs the rest of the role/aria work.** The role/name/ARIA additions (A2–A5) are in-scope for this refactor and are what e2e needs to *locate* and *assert*. Full keyboard *operation* of drag-drop (A1) is heavier (sensor + activators) — decide whether board e2e drives drags via pointer (Playwright `dragTo`) on role-located elements now, with keyboard operability deferred to a dedicated change.
