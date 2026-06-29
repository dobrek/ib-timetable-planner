# Visual Breaks Between Periods — Implementation Plan

## Overview

Render a **purely visual break** after period 2 and after period 5 on the planner board, to make the day's timetable easier to scan as morning / mid / afternoon blocks. The break is a full-width gap band filled with a subtle, theme-token-driven diagonal hatch — visible enough to read as an intentional separator, but with no dominant color. Break positions are a **fixed in-code constant** (`[2, 5]`), not persisted and not user-configurable. No coordinate, constraint, persistence, or validation surface is touched.

## Current State Analysis

- The one slot grid is `PlannerGrid` (`src/_pages/plan-detail/ui/grid/PlannerGrid.tsx`). It is a single CSS Grid (`role="grid"`, `className="bg-border grid gap-px rounded-lg"`, `gridTemplateColumns: auto repeat(days, …)`) whose rows are `role="row" className="contents"` wrappers placed by **implicit row auto-flow** — there is **no `grid-template-rows` and no per-cell `grid-row`** anywhere (`PlannerGrid.tsx:83-88`). Cells are direct grid items.
- Period rows are produced by `periodList.map((period) => …)` at `PlannerGrid.tsx:125`, where `periodList = Array.from({ length: periods }, (_, i) => i + 1)` (`PlannerGrid.tsx:75`). `Fragment` is already imported (`PlannerGrid.tsx:1`).
- Gridlines are the `bg-border` container showing through `gap-px`; cells are `bg-background`. Styling is semantic-token-driven (no palette colors), per `lessons.md`.
- Drag-drop resolves by explicit dnd-kit data `{ day, period, cohort }` on each cell (`SlotCell.tsx:174`), not by DOM/row position — a non-droppable spacer cannot affect drop resolution (verified in `research.md` §A/§B).
- The constraint core keys off opaque `cellKey(day, period)`; nothing computes period adjacency or contiguity in a way a visual gap disturbs (`research.md` §B). The `<200ms` hot path never reads grid geometry.
- The slice already houses small per-device/cosmetic helpers with co-located unit tests under `lib/` (`palette-collapsed.ts` + `palette-collapsed.test.ts`, `drag-hint-mode.ts`). `PlannerGrid` already imports from `../../lib/` (`drag-hint-mode`).
- `global.css` uses Tailwind v4 `@utility` blocks (`@utility bg-cosmic` at `global.css:132`) and exposes muted tokens `--color-border`, `--color-muted-foreground`, `--color-background` (`global.css:30,103,92`). Light/dark values are set in `:root`/`.dark`.
- There is **no** existing background hatch/stripe pattern to reuse (unavailable cells use a `UserX` icon badge, not a pattern).

## Desired End State

On the board, a thin horizontal band appears between period rows 2–3 and between 5–6, framed by the existing gridlines and filled with a faint diagonal hatch that is visible-but-muted in both light and dark themes. The band spans the full grid width (including the period-label column) in both focus (single-column) and combined (DP1 | DP2) modes. On grids with fewer periods, no break ever renders below the last period row. Dragging a chip onto period 3 or period 6 still targets the correct cell; collision highlighting, layout, and validation are unchanged.

Verify by: loading a `5x10` plan (breaks after 2 and 5 visible), a `5x6` plan (break after 5 sits between rows 5 and 6; nothing trailing), toggling dark mode (hatch still legible, no dominant color), and dragging across a break (drop targets correct).

### Key Discoveries:

- Insertion point is exactly one map: `PlannerGrid.tsx:125` (`periodList.map`). Wrapping each row in a `Fragment` + conditional spacer is the whole render change (`research.md` §A).
- `display:contents` rows + auto-flow mean a `col-[1/-1]` spacer occupies its own implicit row and shifts **no** `grid-row` math (`research.md` §A).
- The break decision is a tiny pure predicate (membership + `period < periods` guard) — fits the slice's `lib/` + co-located `.test.ts` convention, and stays **out** of the constraint `model/` because it is cosmetic, not domain logic.
- Token-driven pattern: an `@utility` in `global.css` (mirroring `bg-cosmic`) using a muted token keeps the markup a single class and lets light/dark follow `:root`/`.dark` — satisfying the semantic-token lesson.

## What We're NOT Doing

- **No persistence.** No new `plans` column, no migration, no `database.types` change. Break positions live only in code.
- **No configurability.** No create-plan form control, no per-plan/per-user setting. (The cheap future path — one nullable column — is documented in `research.md` §C and deliberately deferred.)
- **No change to `slot_grid_preset` / the preset enum / `parseGridPreset`.** Customizable presets remain a project non-goal.
- **No "real" break.** The break is not a slot, not an occupiable cell, and consumes no period index. `placements.period` integers and the `1..periods` numbering are unchanged.
- **No constraint / model / API changes.** The `model/`, `api/`, and DB layers are untouched.
- **No mirroring into the teacher-availability dialog grid.** Scope is the board (`PlannerGrid`) only (locked in `change.md`). This stays a separate, independent decision if ever wanted.
- **No full PlannerGrid render-test harness.** The only logic (the guard) is unit-tested directly; the visual wiring is verified manually (rationale under Testing Strategy).

## Implementation Approach

Three small, additive changes, all render/style-only:

1. A pure helper module `lib/period-breaks.ts` owns the fixed break set and the guard predicate, with a co-located unit test. This is the single place to change break positions later.
2. A token-driven `@utility bg-period-break` in `global.css` paints the faint diagonal hatch over a `bg-background` base, so the band's color follows the theme.
3. `PlannerGrid` consumes the predicate and renders a presentational spacer after each break period.

Order: helper (+test) → utility → render. Each step is independently verifiable.

## Phase 1: Visual period breaks on the board

### Overview

Add the break predicate + test, the hatch utility, and the spacer render in `PlannerGrid`.

### Changes Required:

#### 1. Break-position helper (pure logic)

**File**: `src/_pages/plan-detail/lib/period-breaks.ts` (new)

**Intent**: Own the fixed, easy-to-change break positions and the rule for when a break row should render, as framework-free pure logic — the single source of truth a future maintainer edits to move the breaks. Kept in `lib/` (cosmetic helper), not `model/` (constraint core).

**Contract**: Export `BREAK_AFTER_PERIODS: readonly number[]` = `[2, 5]` and a predicate `breaksAfterPeriod(period: number, totalPeriods: number): boolean` that returns `true` only when `period` is in `BREAK_AFTER_PERIODS` **and** `period < totalPeriods` (the guard that suppresses any trailing break below the last row). Declarative, no mutation; exported symbol first, per house style.

#### 2. Helper unit test

**File**: `src/_pages/plan-detail/lib/period-breaks.test.ts` (new)

**Intent**: Lock the guard behavior — the only logic in this change — co-located with the helper, matching `palette-collapsed.test.ts`.

**Contract**: Vitest cases asserting: breaks after 2 and 5 on a 10-period grid; no break after 1/3/4/6; the guard suppresses "after 5" when `totalPeriods === 5` (`5 < 5` is false) while still allowing "after 5" when `totalPeriods === 6` (between rows 5 and 6); "after 2" suppressed only when `totalPeriods <= 2`.

#### 3. Hatch utility (theme-token-driven)

**File**: `src/app/styles/global.css`

**Intent**: Provide a single reusable class that fills an element with a faint diagonal hatch whose ink comes from a muted theme token, so the band reads as textured (more contrast than a plain gap) without a dominant color and follows light/dark automatically.

**Contract**: Add an `@utility bg-period-break { … }` block (sibling of `@utility bg-cosmic` at `global.css:132`) that sets `background-image` to a `repeating-linear-gradient` drawing thin (~1px) diagonal lines spaced ~6px, using a muted token (`var(--color-muted-foreground)` at low alpha, or `var(--color-border)`) as the line color over transparent gaps. The component pairs this with `bg-background` so the band base is the page background and the hatch sits on top. Exact line spacing/alpha is a visual-tuning detail confirmed in manual verification; the contract is "token-driven diagonal hatch, no literal/palette colors."

#### 4. Render the spacer in PlannerGrid

**File**: `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx`

**Intent**: After each period row whose `breaksAfterPeriod(period, periods)` is true, render a full-width presentational spacer that auto-flows onto its own grid row, creating the visual break. Cosmetic only — not a droppable, not in the accessibility grid tree.

**Contract**: Import `breaksAfterPeriod` from `../../lib/period-breaks`. In the `periodList.map` (`PlannerGrid.tsx:125`), wrap the existing `<div role="row" className="contents">` and the new spacer in a `<Fragment key={period}>`. The spacer is a single `<div role="presentation" aria-hidden className="bg-background bg-period-break col-[1/-1] h-3" />` rendered only when `breaksAfterPeriod(period, periods)`. `col-[1/-1]` spans the rowheader track + every day/cohort sub-column (works in both focus and combined modes); `role="presentation"`/`aria-hidden` keeps it out of the ARIA row/grid tree (matching the empty-corner cell at `PlannerGrid.tsx:92`). No other cell or prop changes.

### Success Criteria:

#### Automated Verification:

- Type check passes: `pnpm check`
- Unit tests pass (incl. new `period-breaks.test.ts`): `pnpm test`
- Lint passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Production build is clean: `pnpm build`

#### Manual Verification:

- On a `5x10` plan, a hatched break band renders between period rows 2–3 and 5–6, framed by gridlines.
- On a `5x6` plan, the break renders between rows 5–6 and nothing renders below row 6 (no trailing break).
- The hatch is visible but muted in **both** light and dark themes; no dominant/palette color.
- Drag-drop still works across a break: dropping a chip onto period 3 and period 6 targets the correct cell; collision highlighting and layout are unchanged.
- Combined (DP1 | DP2) mode: the band spans the full width across both cohort sub-columns.

**Implementation Note**: After this phase and all automated verification pass, pause for manual confirmation that the visual testing (light/dark, small grid, drag-across) succeeded before considering the change done.

---

## Testing Strategy

### Unit Tests:

- `period-breaks.test.ts` — the `breaksAfterPeriod` guard across in-set / out-of-set periods and the `period < totalPeriods` boundary (the only logic in the change).

### Manual Testing Steps:

1. Open a `5x10` plan; confirm hatched bands between rows 2–3 and 5–6.
2. Open a `5x6` plan; confirm a band between rows 5–6 and nothing below row 6.
3. Toggle dark mode; confirm the hatch stays legible and muted.
4. Drag a chip onto period 3 and period 6; confirm correct drop targets and unchanged collision highlighting.
5. Switch to combined view; confirm the band spans both cohort columns full width.

### Why no PlannerGrid render test:

The sole logic (the guard) is unit-tested directly. A full `PlannerGrid` render test would require constructing the heavy `CellWiring`/`PairedColumn` prop surface to assert a presentational, visual-only element — disproportionate for a cosmetic change. The render wiring is verified manually (this is a visual feature). This is an intentional, documented choice, not a deferred gap.

## Performance Considerations

None. The spacer is a static element added at most twice per grid; it does not participate in the per-drag `dropHints` churn or the `<200ms` validation path (which never reads grid geometry — `research.md` §B). No re-render impact beyond the constant rows themselves.

## Migration Notes

None — no schema, data, or persisted-state changes.

## References

- Research: `context/changes/breaks-between-periods/research.md` (feasibility, safety proof, deferred persistence path)
- Decision (locked scope): `context/changes/breaks-between-periods/change.md` → "Decision — scope locked (2026-06-29)"
- Render seam: `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx:125`
- Helper + co-located test precedent: `src/_pages/plan-detail/lib/palette-collapsed.ts` / `palette-collapsed.test.ts`
- Custom utility precedent: `src/app/styles/global.css:132` (`@utility bg-cosmic`); muted tokens at `global.css:30,103`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Visual period breaks on the board

#### Automated

- [ ] 1.1 Type check passes: `pnpm check`
- [ ] 1.2 Unit tests pass (incl. new `period-breaks.test.ts`): `pnpm test`
- [ ] 1.3 Lint passes: `pnpm lint`
- [ ] 1.4 FSD structure check passes: `pnpm steiger`
- [ ] 1.5 Production build is clean: `pnpm build`

#### Manual

- [ ] 1.6 `5x10` plan: hatched bands render between rows 2–3 and 5–6
- [ ] 1.7 `5x6` plan: band between rows 5–6, nothing trailing below row 6
- [ ] 1.8 Hatch is visible but muted in both light and dark themes
- [ ] 1.9 Drag-drop across a break targets correctly; collisions/layout unchanged
- [ ] 1.10 Combined (DP1 | DP2) mode: band spans full width across both cohort sub-columns
