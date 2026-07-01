---
date: 2026-07-01T11:45:09+0200
researcher: Dobromir Kropielnicki
git_commit: 5f43c11d7773bceb2403c5111197be185d674864
branch: main
repository: dobrek/ib-timetable-planner
topic: "Board-scoped zoom (Zoom-to-Scale + Fit-to-Scale) for the planner board"
tags: [research, codebase, plan-detail, planner-board, zoom, sticky-headers, dnd-kit]
status: complete
last_updated: 2026-07-01
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Added follow-up: Board settings popover UI decision (gear-nested zoom slider + relocated collision-emphasis toggle)"
---

# Research: Board-scoped zoom (Zoom-to-Scale + Fit-to-Scale) for the planner board

**Date**: 2026-07-01T11:45:09+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 5f43c11d7773bceb2403c5111197be185d674864
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

The plan board container scrolls with sticky headers, which works well — but when the plan is
partially packed or the viewport is small, there is no way to see everything at once. Users fall
back on the **browser's** zoom, which scales *everything* (grouping palette, menu, park shelf), not
just the board. Is it feasible to introduce zoom scoped **only to the planner board**, ideally with
**Zoom-to-Scale** (manual level) and **Fit-to-Scale** (one click → the whole board fits in view)?

Scope agreed before research: **feasibility + recommended approach**; zoom level persists **per
device** (localStorage, like existing prefs); the research should **recommend the best mechanism**.

## Summary

**Feasible, low-to-moderate effort, and the make-or-break risk is cleared.** Zoom can be scoped to
exactly one DOM subtree — the `data-slot="planner-grid"` wrapper — leaving the palette, summary bar,
error banners, and shelf untouched. The board grid has *no* pixel-geometry code of its own and its
drag-and-drop is handled entirely by the new experimental **dnd-kit** (`@dnd-kit/react` +
`@dnd-kit/dom` 0.5.0), which hit-tests in **viewport CSS-pixel space** using `getBoundingClientRect`
vs `clientX/clientY`. Both operands live in the same (scaled) visual viewport, so **drop targeting,
collision detection, and the <200 ms validation budget are unaffected** by scaling the grid.

**Recommended mechanism: the CSS `zoom` property** applied to the grid wrapper.

- It **reflows** (unlike `transform: scale()`), so `position: sticky` headers, the scroll-area
  extent, and the sticky `top` offset math all stay coherent for free.
- It does **not** establish a containing block, so it does **not** re-break the just-shipped frozen
  headers (`sticky-days-periods-names`) or dnd-kit's top-layer (`position: fixed`, popover-API) drag
  feedback — the two things `transform`/`filter` are documented to break here.
- It is **Web Platform Baseline (newly available, May 2024)**: Chromium/Edge, Safari, and Firefox
  126+. In modern Chromium `zoom` is a real layout-integrated property, so `getBoundingClientRect`
  returns zoom-adjusted coords that match pointer coords → dnd-kit stays accurate.

`transform: scale()` is **not recommended**: it creates a containing block that endangers the sticky
headers and the top-layer drag feedback, and would regress the `sticky-days-periods-names` work. A
third option — threading a `--zoom` multiplier through every sized utility (`7rem`, `2rem`,
`min-h-16`, `h-3`, `1px` gaps) — preserves everything too but is far more invasive; keep it only as a
fallback if a target browser proves `zoom`-inconsistent.

**Fit-to-Scale** is `scale = clamp(min(availW/naturalW, availH/naturalH), MIN, 1)` — shrink-only,
measured (not formula'd) because cell height is content-driven (`min-h-16` with no max). It needs one
new `ResizeObserver`-backed `useElementSize` hook (none exists in the codebase today). Persistence,
control wiring, and UI all have exact in-repo precedents to copy.

## Detailed Findings

### 1. The zoom boundary — what to scale, what not to

The board render path funnels the whole grid through a single scroll container that already owns the
sticky-header relationship:

```
src/pages/plans/[id]/index.astro
 └─ SidebarLayout.astro (fullWidth)                                  h-screen flex row
    └─ <main class="flex min-w-0 flex-1 flex-col overflow-hidden">   clips, does NOT scroll
       └─ PlanDetailPage.astro → PlannerBoard (client:load)
          └─ BoardShell: <div class="flex min-h-0 flex-1 flex-col">
               {PlanSummaryBar}                                       ── chrome, NOT zoomed
               <div data-slot="planner-board"
                    class="grid … lg:grid-cols-[auto_minmax(0,1fr)_auto]">   palette | center | shelf
                 {palette}                                            ── NOT zoomed (col 1, auto)
                 {center}:
                   <div class="flex min-h-0 flex-col gap-3">
                     {dp1/dp2 ErrorBanner}                            ── NOT zoomed
                     <div class="min-h-0 flex-1 overflow-auto">   ★ SCROLL CONTAINER  (PlannerBoard.tsx:218)
                       <PlannerGrid>
                         <div data-slot="planner-grid"
                              class="w-max min-w-full">           ★ ZOOM TARGET       (PlannerGrid.tsx:86)
                           <div role="grid" style={gridTemplateColumns, --day-header-h}>
                 {shelf}                                              ── NOT zoomed (col 3, auto)
```

- **Scroll container**: `PlannerBoard.tsx:218` — `min-h-0 flex-1 overflow-auto`. The *only* scroller
  in the board path; every sticky header (`sticky top-0`, `sticky left-0`) pins against it.
- **Zoom target**: `PlannerGrid.tsx:86` — `<div data-slot="planner-grid" class="w-max min-w-full">`,
  the sole child of the scroll container. Scaling here keeps the `w-max min-w-full` intrinsic-width
  wrapper *inside* the scaled subtree, so horizontal scroll still works, and leaves palette / shelf /
  summary bar / error banners (all siblings *outside* it) at 100%.
- **Why `zoom` and not `transform` here**: the scroll container stays a fixed-size viewport and only
  its content scales; because `zoom` reflows, the scroll extent auto-matches the zoomed content size
  (a `transform` would leave the scrollbars sized to the *unscaled* box).

### 2. Grid dimensions & sizing (fixed vs content-driven)

- `days`/`periods` originate from the plan's **`slot_grid_preset`** DB column, parsed by
  `parseGridPreset` (`shared/lib/grid/grid.ts:27`). All presets are `5xN`: `5x6`, `5x8`, `5x10`
  (default `5x10`); hard bounds `maxDays 7, maxPeriods 12` (`grid.ts:10`). **Days = 5 in practice;
  periods ∈ {6,8,10}.**
- Threaded plan-data → `PlannerBoard` (`PlannerBoard.tsx:220-221`) → `PlannerGrid` (`:75-77`). Fixed
  for a plan's lifetime.
- **Focus mode = 1 sub-column/day; combined mode = 2** (`PlannerGrid.tsx:78,83`;
  `PlannerBoard.tsx:175`). Combined is the default landing surface and ~2× the width.
- Hardcoded dimensions (all `PlannerGrid.tsx` unless noted): day sub-column `minmax(7rem, 1fr)`
  (`:83,93`); leading period-label column `auto` (`:93`); day-header row `--day-header-h: 2rem`
  (`:97,113`); combined sub-label row `p-1 text-xs` ~1.5rem (`:127-137`); `gap-px` = 1px (`:90`);
  period-break band `h-3` after periods 2 & 5 (`:187`, `period-breaks.ts:10,19`); **cell min-height
  `min-h-16` = 4rem with _no max_** (`SlotCell.tsx:116`).

### 3. dnd-kit under zoom — the make-or-break, cleared

- **Package**: the *new experimental* dnd-kit — `@dnd-kit/react` 0.5.0 + `@dnd-kit/dom` 0.5.0
  (`package.json:29-30`), not classic `@dnd-kit/core`. `BoardShell.tsx:72-74` uses
  `defaultPreset.plugins` with only `Feedback` reconfigured (`dropAnimation: null`); no custom
  `collisionDetector`, no modifiers.
- **Hit-testing is pointer-first, in viewport space**: default detector is
  `pointerIntersection ?? shapeIntersection`; the pointer is `event.clientX/clientY` (viewport px),
  droppable shapes are `DOMRectangle`s from `element.getBoundingClientRect()` (post-transform /
  post-zoom viewport px). **Both operands live in the same scaled visual viewport → "which cell is
  under the cursor" stays correct under scaling.** `DOMRectangle` only inverts the *measured
  element's own* transform and only walks *iframe* frames — an ancestor `zoom`/`transform` flows
  through untouched via `getBoundingClientRect`, which is exactly what keeps pointer-vs-rect
  consistent.
- **No app-side geometry**: grepping the whole slice for `getBoundingClientRect|clientX|clientY|
  pageX|offsetX|collisionDetection|measuring` returns **nothing** in app code. Cells
  (`SlotCell.tsx:174`), placed chips (`PlacedChip.tsx:48-52`), and the palette chip use
  `useDroppable`/`useDraggable` by id+data only; routing operates on `(day, period)` + course ids
  (`drag.ts`, `drop-router.ts`, `drop-dispatch.ts`).
- **Drag feedback lives OUTSIDE the zoom target**: for course/placement drags the `DragOverlay` is
  disabled (`GroupDragOverlay.tsx:36,95-98`); the `Feedback` plugin promotes the *source element* to
  the **top layer** via the Popover API (`position: fixed`, `popover="manual"`,
  `--dnd-kit-translate`). The overlay for grouping/bundle/parked drags is a sibling of the flex
  column, *outside* `data-slot="planner-board"` (`BoardShell.tsx:63`). So board zoom never scales the
  drag feedback — it follows the cursor 1:1 in viewport space.
- **<200 ms validation is coordinate-free**: `deriveDropHints`/`classifyCell`/`violatesAny`
  (`drop-hints.ts`, verified by `drop-hints.test.ts` running on pure cell-key/course-id inputs) never
  touch the DOM and fire on drag-start, not per pixel. CSS zoom/transform cannot affect the budget.

### 4. Sticky headers & the "no transform ancestor" constraint (prior art)

The recently-shipped **`sticky-days-periods-names`** change froze the day row, period column, and
corner via pure CSS `position: sticky` on the header cells, pinned to the `overflow-auto` scroll
container. Its research/plan explicitly record a load-bearing invariant:

> The entire `<body>` → cells ancestor chain must remain **transform/filter/perspective/contain-free**
> — a transform re-breaks `position: sticky` (the frozen headers) *and* dnd-kit's top-layer drag
> feedback. (`archive/2026-06-30-sticky-days-periods-names/research.md:86,97`, `plan.md:49`)

A naïve `transform: scale()` zoom is **precisely that forbidden transform** and would regress the
frozen headers and the drag feedback. **CSS `zoom` sidesteps this**: it does not create a containing
block, is transparent to sticky, and — because it scales the whole coordinate system uniformly — the
sticky `top: calc(var(--day-header-h) + 1px)` offsets (`PlannerGrid.tsx:125,133`) stay proportionally
correct at any zoom. This is the single biggest reason to prefer `zoom` over `transform` here.

### 5. Fit-to-Scale / Zoom-to-Scale math + measurement

- **Min intrinsic width** `= autoCol + days·subcols·112px + gaps`:
  - Focus (subcols=1): `48 + 5·112 + 5 ≈ 613px` (matches the documented ~600px hard-minimum,
    `archive/…/unify-navigation/research.md:68`).
  - Combined (subcols=2): `48 + 5·2·112 + 10 ≈ 1178px`.
  - Because `minmax(7rem, 1fr)` cells **stretch** when the port is wider than the min, **fit-width is
    trivially satisfied at scale 1 in focus mode**; zoom-out for *width* is only needed in
    **combined** mode on a port narrower than ~1180px.
- **Intrinsic height** is content-driven and must be **measured, not formula'd**: floor `≈ 32 +
  periods·64 + breaks·12 + gaps` (focus 5×10 ≈ 709px), but `min-h-16` has no max — a chip-dense cell
  grows with its stack (`SlotCell.tsx:145-156`, `PlacedChip.tsx`; flagged in
  `archive/…/slot-cell-refactor/research.md:83`). **Height is the usual binding constraint.**
- **Measure**: natural size = the grid wrapper's `scrollWidth`/`scrollHeight` (ref on
  `PlannerGrid.tsx:86`); available size = the scroll container's `clientWidth`/`clientHeight`
  (`PlannerBoard.tsx:218`, already net of header bar + banners + gaps). **No element-size hook exists
  anywhere** (only a jsdom `ResizeObserver` polyfill in `src/test/setup-dom.ts:23`), so a slice-local
  `useElementSize(ref)` must be added.
- **Algorithm** (pure, unit-testable, lives in `model/` or `lib/`):
  `scale = clamp(min(availW/naturalW, availH/naturalH), MIN_ZOOM, 1)` — `max = 1` for **Fit**
  (shrink-only; don't enlarge to fill). Fit-**both** (the `min`) covers focus-height and
  combined-width without special-casing. Throttle the `ResizeObserver → fit` recompute with `rAF` so
  it doesn't thrash on window resize or dnd auto-scroll (the `AutoScroller` runs on the same port).

### 6. Per-device persistence pattern (exact precedent to mirror)

Copy `lib/drag-hint-mode.ts` / `lib/shelf-pinned.ts` verbatim in shape — a new `lib/board-zoom.ts`:

- Module-private `const STORAGE_KEY = "planner-board-zoom";` — keys are **global/per-device, never
  plan-scoped** (siblings: `"planner-drag-hint-mode"`, `"planner-shelf-pinned"`). One device-wide
  zoom shared across plans; do **not** thread a plan id.
- `readZoom()` — `typeof window` guard → `try { getItem }` → parse/clamp → `catch → DEFAULT_ZOOM`.
- `writeZoom(v)` — guard → `try { setItem }` → `catch {}` → notify in-memory listeners.
- `subscribeZoom(listener)` — registers the listener + a `storage` event handler (cross-tab); returns
  an unsubscribe removing both.
- A `parseZoom(value): ZoomState` validator/clamp replaces the `isHintMode` guard (returns the
  default on `null`/NaN/out-of-range). This satisfies the lesson **"guard localStorage with try/catch,
  not just typeof window"** and **"pair with `useSyncExternalStore`, server-snapshot = default"**.
- **Design note — Fit vs a number**: store a small discriminated value, e.g. `{ mode: "fit" }` or
  `{ mode: "manual", level: 0.9 }`. In `"fit"` mode the effective scale is recomputed from the
  `ResizeObserver` on load and on resize (so "Fit" stays sticky and re-fits when the window changes);
  in `"manual"` mode the stored `level` is applied directly.
- **Consume** via a new `useZoom()` in `chrome/board-disclosure.ts` (where `useHintMode` lives):
  `useSyncExternalStore(subscribeZoom, readZoom, () => DEFAULT_ZOOM)` returning `{ zoom, setZoom }`;
  export from `chrome/index.ts`; call once in `PlannerBoard.tsx` (island singleton) and pass the
  resolved numeric scale down to `PlannerGrid` as the `zoom` style on the wrapper.

### 7. Control UI & placement

- **Home**: the `PlanSummaryBar` right-aligned trailing toolbar (`ml-auto flex items-center gap-3`),
  which already hosts `UndoRedoControls` and the `DragHintModeToggle` (`PlanSummaryBar.tsx:61-62`, fed
  from `PlannerBoard.tsx:198`'s `trailing` slot). Wrap the new `ZoomControl` alongside the hint toggle
  in a fragment, or add a dedicated `zoom?: ReactNode` prop mirroring how `undoRedo` is threaded.
- **Primitives available** (`src/shared/ui/`): `Button` (use `variant="ghost" size="icon"` for −/+/
  Fit), `ToggleGroup`, `Tabs`, `DropdownMenu`, `Popover`, `Select`, `NumberField`, `Badge`. **No
  `slider` and no `tooltip` primitive exist** — the convention is native `title` + `aria-label`
  (`UndoRedoControls.tsx:20-29`). Use `tabular-nums` for a level readout. Icons from `lucide-react`
  (`ZoomIn`, `ZoomOut`, `Maximize`/`Scan` for Fit).
- Minimal control that satisfies the ask: `[−] 90% [+] [Fit] [Reset]` — `Fit` sets `{mode:"fit"}`,
  `Reset` sets `{mode:"manual", level:1}`, `−/+` step the manual level. Give the root
  `data-slot="zoom-control"`; build purely from `Button`/`ToggleGroup` variants (already token-based)
  so the semantic-token rule holds.
- **Accessibility contract**: e2e selects by role + accessible name (`ui-conventions.md:94-100`), so
  every button needs an `aria-label`/`title`.

## Recommended Approach (feasibility + shape)

1. **Mechanism**: CSS `zoom` on `PlannerGrid.tsx:86`'s `data-slot="planner-grid"` wrapper —
   `style={{ zoom }}` where `zoom` is the resolved numeric scale (1 = 100%). No `transform`.
2. **State/persistence**: new `src/_pages/plan-detail/lib/board-zoom.ts` (read/write/subscribe +
   `parseZoom`, key `"planner-board-zoom"`, `DEFAULT_ZOOM = { mode: "fit" }` or `{manual, 1}` — pick
   in planning); new `useZoom()` in `chrome/board-disclosure.ts` via `useSyncExternalStore`.
3. **Measurement**: new slice-local `model/use-element-size.ts` (`ResizeObserver`, rAF-throttled) on
   the scroll container + grid wrapper; pure `model/fit-scale.ts`
   (`clamp(min(availW/naturalW, availH/naturalH), MIN_ZOOM, 1)`) with unit tests.
4. **Control**: new `ui/chrome/ZoomControl.tsx` (`Button`/`ToggleGroup`, lucide icons, `title` +
   `aria-label`), mounted in `PlanSummaryBar`'s trailing cluster.
5. **Effort**: moderate. One CSS property + one pref module (copy-paste shape) + one measurement hook
   + one pure fit fn + one control. No touch to the constraint core, actions, or DB.
6. **Verify empirically** (cheap, high-value — see Open Questions): drop accuracy + sticky freeze +
   feedback tracking at 0.5/0.75/1.25, and the `w-max min-w-full` scroll-extent interaction under
   `zoom`, on the actual target browsers.

## Code References

Base: `https://github.com/dobrek/ib-timetable-planner/blob/5f43c11d7773bceb2403c5111197be185d674864/`

- `src/_pages/plan-detail/ui/PlannerBoard.tsx:218` — the `overflow-auto` **scroll container** (sticky
  pin ancestor; the fit "available size" element).
- `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx:86` — `data-slot="planner-grid"` **zoom target**;
  `:83,93` grid template `auto repeat(days, minmax(7rem,1fr))`; `:97` `--day-header-h`; `:106-148`
  sticky headers; `:187` break band.
- `src/_pages/plan-detail/ui/chrome/BoardShell.tsx:56` — 3-col shell `auto|minmax(0,1fr)|auto`; `:63`
  drag overlay rendered outside the board grid; `:72-74` dnd-kit plugin preset.
- `src/_pages/plan-detail/ui/grid/slot-cell/SlotCell.tsx:116` — cell `min-h-16` (no max); `:174`
  `useDroppable`.
- `src/_pages/plan-detail/ui/overlay/GroupDragOverlay.tsx:36,95-98` — overlay disabled for
  course/placement drags (top-layer feedback instead).
- `src/_pages/plan-detail/model/drop-hints.ts` — coordinate-free <200 ms validation.
- `src/_pages/plan-detail/lib/drag-hint-mode.ts:8-53` & `lib/shelf-pinned.ts` — localStorage pref
  module template (read/write/subscribe + try/catch).
- `src/_pages/plan-detail/ui/chrome/board-disclosure.ts:18-21` — `useSyncExternalStore` consumption
  (`useHintMode`); add `useZoom` here.
- `src/_pages/plan-detail/ui/chrome/PlanSummaryBar.tsx:61-62` — trailing toolbar (control home);
  `PlannerBoard.tsx:198` — `trailing` slot wiring.
- `src/shared/lib/grid/grid.ts:10,18,27` & `src/shared/config/grid-presets.ts:10,21` — grid
  dimensions/presets (5xN).
- `src/test/setup-dom.ts:23` — the only `ResizeObserver` in the repo (jsdom polyfill); confirms a real
  size hook must be added.
- `package.json:29-30` — `@dnd-kit/react` / `@dnd-kit/dom` 0.5.0.

## Architecture Insights

- **The board is a clean zoom target by construction**: a single `overflow-auto` scroll container
  wrapping a single intrinsic-width grid, with all chrome as *siblings outside* it. Board-scoped zoom
  is a natural fit for the existing layout, not a fight against it.
- **`zoom` vs `transform` is decided by two existing invariants**, not preference: (a) the
  `sticky-days-periods-names` "no transform ancestor" rule, and (b) dnd-kit's top-layer popover
  feedback. Both are broken by `transform`'s containing block and untouched by `zoom`'s reflow.
- **dnd-kit 0.5's top-layer/popover feedback design is what makes ancestor scaling safe** — the older
  `@dnd-kit/core` translated the element in-place inside the scaled container and drifted; this repo
  is on the newer package, so that class of bug does not apply.
- **Cell height is genuinely variable** (`min-h-16`, no max), so Fit must divide *measured*
  `scrollHeight` by *measured* `clientHeight`; formulas are only for reasoning about *when* zoom-out
  is needed (width→combined, height→dense/many-period plans).
- **This slots into established conventions**: pure fit math in `model/` (unit-tested), effects in a
  named hook (not the component body), per-device cosmetic pref in `localStorage` via
  `useSyncExternalStore`, control in the shared summary bar — all with direct precedents.

## Historical Context (from prior changes)

- `archive/2026-06-30-sticky-days-periods-names/research.md:86,97`, `plan.md:49` — froze the headers
  via pure `position: sticky`; records the **transform/filter/contain-free ancestor** invariant that
  dictates using `zoom` (not `transform`) for board zoom. Most relevant prior art.
- `archive/2026-06-27-planner-palette-ui-improvments/` + `bundle-holding-container/change.md:30` — the
  board track moved `1fr` → `minmax(0,1fr)` so the timetable shrinks/scrolls inside its own
  `overflow-auto` wrapper instead of forcing the page wider — the scroll-port fit measures against.
- `archive/2026-06-12-unify-navigation/research.md:68` — documents `w-max min-w-full`, the ~600px
  hard-minimum, horizontal-scroll-via-port, and the 5×6/5×8/5×10 presets.
- `archive/2026-06-28-plan-detail-unify-views/` + `combined-two-cohort-view/` — merged paired+single
  grids into today's one `PlannerGrid`; the 1-vs-2 sub-columns/day (focus vs combined) that the fit
  width formula must handle.
- `archive/2026-06-22-slot-cell-refactor/research.md:83` — flags dense-cell overflow (`min-h-16`, no
  max) → height is content-variable, must be measured.
- **No prior zoom/scale/fit/viewport-fit work exists** — this feature is genuinely new;
  `change.md` was a bare stub.

## Related Research

- None yet under `context/changes/**/research.md`. This is the first research artifact for
  `plan-board-zoom`. Closest neighbors are the archived sticky-header and palette-UI changes listed
  above.

## Open Questions (verify empirically before/while planning)

1. **`zoom` + `w-max min-w-full`**: confirm that applying `zoom` to the `planner-grid` wrapper leaves
   the scroll container's scroll extent and the `min-w-full` stretch correct (percentages resolve in
   the zoomed coordinate system). If odd, apply `zoom` to the inner `role="grid"` node instead and
   re-test horizontal scroll.
2. **Drop accuracy at scale**: drag a palette chip and a placed chip across cells at zoom
   0.5 / 0.75 / 1.25 / 1.5 and confirm the highlighted `isDropTarget` cell matches the cursor and the
   drop lands correctly.
3. **Sticky freeze + feedback tracking while zoomed**: confirm day/period headers still freeze during
   scroll and the top-layer drag feedback tracks the cursor without drift at each zoom level.
4. **Target-browser matrix**: `zoom` is Baseline since May 2024 (Chrome/Edge, Safari, Firefox 126+).
   Confirm whether older Safari/Firefox are in scope; if so, keep the `--zoom` rem-multiplier approach
   as a documented fallback.
5. **Fit persistence semantics**: decide whether "Fit" persists as a mode that re-computes on resize,
   or as a frozen numeric level captured at click time (recommendation: persist the mode so Fit stays
   sticky and re-fits).
6. **Zoom granularity**: ~~discrete presets vs continuous~~ → **resolved: continuous slider** (see
   Follow-up). Remaining: the slider's `MIN_ZOOM`/`MAX_ZOOM` bounds and step (readability vs "fit a
   huge plan").

## Follow-up Research 2026-07-01T12:05:00+0200 — Board settings UI component

**Decision (with the user):** consolidate board display preferences into a single **"Board settings"
popover** opened from a gear button in the top bar; drive zoom with a **continuous slider**. This
supersedes open question #6 and refines finding §7.

### Chosen shape

- **Top bar** (`PlanSummaryBar` trailing slot, `PlanSummaryBar.tsx:62`): the drag-hint toggle is
  **removed from the bar** and replaced by a single gear button labelled with the current zoom, e.g.
  `⚙ 90%` / `⚙ Fit` (`tabular-nums`, `aria-label="Board settings"`, native `title`). This is the only
  board-settings affordance in the bar.
- **Board settings popover** (`Popover` — already in `src/shared/ui/popover.tsx`), two labelled
  sections:
  - **Zoom** — a continuous `Slider` (`value={[level]}`, range ~`0.5`–`1.5`, `step` 0.05, shown as
    50–150%) + a `tabular-nums` `%` readout + `⤢ Fit` + `Reset 100%` buttons. In `fit` mode the
    slider reflects the *computed* fitted value; grabbing it switches to `manual` from there.
  - **While dragging** — the existing `DragHintModeToggle` (`[⚠ Mark collisions | ✓ Highlight free]`),
    **relocated unchanged** from the bar into this section.
- **Accepted trade-off**: "Fit" is now two clicks (open gear → Fit) rather than one. Optional
  mitigation to consider in planning: a keyboard shortcut for Fit, mirroring the existing
  `model/history/use-undo-keymap.ts` — recovers one-gesture Fit without re-crowding the bar.

### Components to add / change

- **New shared primitive**: `src/shared/ui/slider.tsx` via `npx shadcn@latest add slider` (Radix-based,
  controlled `value: number[]` / `onValueChange`). **Detokenize on add** — the CLI ships literal colors
  (track/range/thumb → `bg-secondary`/`bg-muted` track, `bg-primary` range, `border-primary` thumb,
  `ring-ring` focus); export from the `src/shared/ui/index.ts` barrel. (Lesson: "Detokenize shadcn
  primitives on add".)
- **New slice chrome**: `src/_pages/plan-detail/ui/chrome/BoardSettingsMenu.tsx` (gear `Button` +
  `Popover`, hosts both sections) and `ZoomControl.tsx` (the Zoom section: slider + readout +
  Fit/Reset; lucide `Maximize`/`Scan` for Fit, `RotateCcw` for Reset).
- **Relocate**: `DragHintModeToggle` render moves from `PlanSummaryBar`'s `trailing` slot into
  `BoardSettingsMenu` (the component itself is unchanged).
- **Wiring** (unchanged from §6/§7 plan): `useZoom()` in `board-disclosure.ts` (backed by
  `lib/board-zoom.ts`, `useSyncExternalStore`, discriminated `{mode:"fit"} | {mode:"manual", level}`);
  `PlannerBoard.tsx` computes the effective scale (fit → measured via the new `useElementSize`;
  manual → `level`) and passes `style={{ zoom }}` to the `PlannerGrid` wrapper; the `trailing` slot
  now renders `<BoardSettingsMenu … />` fed `{hintMode, setHintMode, zoom, setZoom, fitScale}`.

### FSD / convention notes

- Layer direction holds: `Slider` is a cross-slice primitive → `shared/ui`; `BoardSettingsMenu` /
  `ZoomControl` are plan-detail chrome → `_pages/plan-detail/ui/chrome`.
- All controls build from `Button`/`Slider`/`Popover` variants (token-based) — no literal colors;
  accessible names on the gear trigger and the slider (`aria-label="Zoom level"`) for the role+name
  e2e contract (`ui-conventions.md:94-100`).

### New open questions from this decision

- Slider bounds/step (`MIN_ZOOM`, `MAX_ZOOM`, step) and whether the % readout snaps.
- Gear label content: live `%` vs a static gear icon with the `%`/`Fit` as a small adjacent readout.
- Whether to add the optional Fit keyboard shortcut now or defer.
- Popover dismiss behavior while interacting with the board (should stay open during slider drag;
  close on outside click / Escape per the `Popover` default).
</content>
</invoke>
