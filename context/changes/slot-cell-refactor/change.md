---
change_id: slot-cell-refactor
title: Slot cell refactor
status: implemented
created: 2026-06-22
updated: 2026-06-22
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Review findings (2026-06-22) — `src/_pages/plan-detail/ui/SlotCell.tsx`

Critical review of `SlotCell.tsx` (428 lines / 16.5KB — largest file in the slice). Source of these notes for research + planning.

#### 1. Folder split — DO IT, but for the right reason

By the letter of `ui-conventions.md` §"One exported component per file", the private children (`PlacedChip`, `WeekLane`, `WeekToggle`) are tightly coupled (shared `LocalPlacement` type, threaded `renderChip`, collision flags) → in-file is "correct." The reason to override is **not** the rule — it's that this file crossed a complexity threshold the convention didn't anticipate: 3 sub-components + a styling lookup table + two `dnd-kit` integrations. The newspaper rule ("scroll down for detail") stops paying off when "detail" is ~280 lines.

**Reusable rule to codify in `ui-conventions.md`:**
> A `ui/` component graduates from single-file to a folder when it has **3+ private sub-components** _or_ exceeds **~250 lines**. The folder keeps one public surface; `index.ts` is a pure barrel re-exporting only the default.

Consistent with existing `model/constraints/` folder-with-barrel — not a new idiom.

Proposed shape:
```
ui/slot-cell/
  index.ts            // export { default } from "./SlotCell"
  SlotCell.tsx        // public orchestrator only
  PlacedChip.tsx      // imports WeekToggle as sibling
  WeekLane.tsx        // imports PlacedChip directly → kills the `render` prop threading
  WeekToggle.tsx
  cell-tone.ts        // styling tables + pure resolver (see #2)
  cell-tone.test.ts   // the payoff
```

**Safety note:** `PlannerGrid.tsx` imports `./SlotCell`; the `data-slot`/`data-*` attributes are the test contract. Nothing references them outside this file yet (no e2e selectors) → move is low-risk *now*. Freeze the attribute names as the public contract before more tests grow against them.

#### 2. HIGHEST-VALUE FIX — the conditional-class ring ladder (reliability)

The cell `className` (lines 124–144) is a **priority cascade encoded as negation chains**:
```tsx
hintState && !isDropTarget && !hasBlocking && HINT_CLASS[hintMode][hintState],
hasWarning && !hasBlocking && !isDropTarget && !hintState && "ring-warning …",
bundled && !hasBlocking && !hasWarning && !isDropTarget && "bg-accent/40 …",
hasBlocking && "ring-destructive …",
isDropTarget && "bg-accent ring-ring …",
```
Each new state must exclude every higher-priority state → O(n²) guard terms; failure mode is silent (forget one `!`, two rings fight over `--tw-ring-color`). The in-code comment admits the root cause: *"every Tailwind ring sets the same custom property, co-occurrence can't be resolved by className order."* This is a **precedence** problem, not a duplicate-class problem — `twMerge` (cn = clsx + twMerge) cannot fix it. The cell has **one** visual tone, not five overlapping booleans.

**Fix:** resolve to a single tone enum in a pure `model/` function, then map enum → class via a table (extends the existing `HINT_CLASS` pattern to own the whole cell).
```ts
// cell-tone.ts — pure, no React, unit-testable
export type CellTone =
  | "blocking" | "drop-target" | "warning"
  | { hint: DropHint | "free" } | "bundled" | "base";

export function resolveCellTone(s: {
  hasBlocking: boolean; isDropTarget: boolean; hasWarning: boolean;
  hintState: DropHint | "free" | undefined; bundled: boolean;
}): CellTone {
  if (s.hasBlocking) return "blocking";       // precedence lives HERE, once
  if (s.isDropTarget) return "drop-target";
  if (s.hintState) return { hint: s.hintState };
  if (s.hasWarning) return "warning";
  if (s.bundled) return "bundled";
  return "base";
}
```
Component collapses to one call + one lookup:
```tsx
const tone = resolveCellTone({ hasBlocking, isDropTarget, hasWarning, hintState, bundled });
className={cn("bg-background flex min-h-16 …", toneClass(tone, hintMode), isDragging && "opacity-60")}
```
Wins: precedence declared once/ordered/exhaustive (reliability); `resolveCellTone` pure → testable (currently this precedence logic is **untestable**, tangled in JSX); idiomatic Tailwind conditional-class handling (variant lookup tables, not stacked negated conditionals — same philosophy as existing `cva` usage in `shared/ui`).

#### 3. Smaller improvements

- **`PlacedChip` tone → `cva`.** The `blocking ? … : warning ? … : neutral` ternary (lines 281–285) + two `data-*` flags is a 3-state variant. Use `cva({ variants: { tone: {...} } })` — typed, consistent with `badge.tsx`/`button.tsx`. Same for `WeekToggle` pressed/unpressed.
- **Extract a drag-inert handler.** `onPointerDown={(e) => e.stopPropagation()}` (+ paired `onClick` stop) repeats **5×** (toggle, trash, badge, week-option, remove). The repetition *is* the bug surface — one omission re-enables drag-on-click. Extract `stopDrag` const or `<DragInertButton>` wrapper. Hardens the dnd interaction the in-code comments work to protect.
- **`useMergedRef` reusable pattern.** `setCellRef` `useMemo` (lines 77–83) merging two `dnd-kit` refs is generic. Promote to `shared/lib/use-merged-ref.ts` per the "promote on second consumer" rule — flag now, move when the next merged-ref appears. Also restores `ui-conventions.md` "no `useMemo` in component body" compliance.
- **`WeekLane`'s `render` prop disappears for free** once in a folder: import `PlacedChip` as a sibling instead of threading a render callback. One fewer prop, cleaner data flow.

#### 4. Suggested sequence (each diff independently reviewable)

1. Extract `resolveCellTone` + tone table to `cell-tone.ts` with tests — reliability fix, least merge risk. (Independent of folder split.)
2. Extract `stopDrag` — interaction-safety fix.
3. Mechanical folder split, applying `cva` to chip/toggle as each moves.
