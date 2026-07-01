# Plan Board Zoom Implementation Plan

## Overview

Add zoom scoped to **just the planner board grid** — a continuous slider (in a new "Board settings"
gear popover) plus a one-click **Fit-to-scale** that shrinks the whole board to fit the scroll port.
Today the only way to see a partially-packed board on a small viewport is the browser's own zoom,
which scales *everything* (palette, summary bar, shelf). This scopes zoom to the
`data-slot="planner-grid"` subtree via the CSS `zoom` property, leaving all board chrome at 100%.
Zoom level persists **per device** in `localStorage`, mirroring the existing drag-hint / shelf-pinned
cosmetic prefs.

## Scope change (2026-07-01) — Fit-to-Scale removed

After the Phase-3 Fit spike was hand-verified working, the author judged **Fit-to-Scale not worth
keeping**: the auto-fitted result was consistently worse than a user picking a level by hand. **Fit is
cut entirely.** The feature is now **just the manual zoom slider** (persisted per device), surfaced from
a gear → *Board settings* popover.

Consequences (reflected in the revised Phase 3 / Phase 4 below):

- **No Fit mode, no measurement, no `fit-scale`/`use-element-size`.** The Phase-3 Fit code (both new
  `model/` files, the content/port refs, the `PlannerGrid` ref prop, and `scrollbar-none`) was never
  committed — it is reverted, and the scroll container keeps its normal scrollbar.
- **`ZoomState` collapses to a plain number.** With Fit gone the discriminated union is pointless;
  `board-zoom.ts` now persists a single `number` (1 = 100%). A primitive `getSnapshot` is also inherently
  referentially stable, so the Phase-2 snapshot-cache workaround (React #185) is no longer needed.
- **Phase 3 is repurposed** from "Fit-to-Scale" to "Remove Fit + simplify zoom state"; **Phase 4** keeps
  the gear popover but drops the Fit button / `fitScale` prop (slider + `%` readout + Reset only).

## Current State Analysis

The board render path funnels the entire grid through a single scroll container that already owns the
sticky-header relationship, with every other surface as a sibling *outside* it:

```
PlannerBoard.tsx
 └─ BoardShell 3-col grid: auto | minmax(0,1fr) | auto
     ├─ palette            ── chrome, NOT zoomed
     ├─ center:
     │    ├─ ErrorBanner(s) ── NOT zoomed
     │    └─ <div class="min-h-0 flex-1 overflow-auto">   ★ SCROLL CONTAINER (PlannerBoard.tsx:218)
     │         └─ PlannerGrid
     │              └─ <div data-slot="planner-grid" class="w-max min-w-full">  ★ ZOOM TARGET (PlannerGrid.tsx:86)
     │                   └─ <div role="grid" style={gridTemplateColumns, --day-header-h}>
     └─ shelf              ── chrome, NOT zoomed
   PlanSummaryBar (header, trailing slot hosts DragHintModeToggle)  ── NOT zoomed
```

- **Scroll container** (`PlannerBoard.tsx:218`, `min-h-0 flex-1 overflow-auto`) — the only scroller in
  the board path; every sticky header pins against it. This is the fit "available size" element.
- **Zoom target** (`PlannerGrid.tsx:86`, `data-slot="planner-grid" class="w-max min-w-full"`) — the
  sole child of the scroll container. Scaling here keeps horizontal scroll working and leaves palette
  / shelf / summary bar / banners (all outside it) at 100%.
- **No app-side geometry**: grepping the slice for `getBoundingClientRect|clientX|clientY|collision`
  returns nothing in app code — cells and chips use `useDroppable`/`useDraggable` by id+data only; the
  <200ms validation (`model/drop-hints.ts`) is coordinate-free and fires on drag-start.
- **dnd-kit is the new experimental package** (`@dnd-kit/react` + `@dnd-kit/dom` 0.5.0), which
  hit-tests in scaled viewport space (`getBoundingClientRect` vs `clientX/clientY`, both post-zoom) and
  renders course/placement drag feedback on the **top layer** via the Popover API (`position: fixed`),
  a sibling *outside* the zoom target (`BoardShell.tsx:63`). Both facts are why ancestor scaling is
  safe here.
- **Precedents to mirror**: `lib/drag-hint-mode.ts` (localStorage read/write/subscribe + try/catch +
  cross-tab `storage` listener) and `board-disclosure.ts:18` (`useHintMode` via `useSyncExternalStore`).
  The control home is `PlanSummaryBar`'s trailing slot (`PlannerBoard.tsx:198`), currently rendering
  `DragHintModeToggle`.
- **Gaps with no precedent**: there is **no element-size hook** anywhere (only a jsdom `ResizeObserver`
  polyfill in `src/test/setup-dom.ts:23`), and **no `slider` primitive** in `src/shared/ui/`.

## Desired End State

A user on the plan board sees a gear button (`⚙`) in the top bar. Opening it reveals a **Board
settings** popover with two sections: **Zoom** (a 25–150% slider + `%` readout + Fit + Reset 100%) and
**While dragging** (the relocated collision-emphasis toggle). Dragging the slider scales only the
timetable grid — palette, shelf, banners, and the bar stay at 100%. Drag-and-drop, sticky headers, and
the drag feedback all remain pixel-accurate at every zoom level. **Fit** shrinks the board so the whole
grid fits the visible port; it stays sticky and re-fits when the window resizes. The chosen zoom
persists per device across reloads and plans. On a fresh device the board renders at **100%**.

Verify: at 25% / 50% / 75% / 100% / 125% / 150%, drop a palette chip and a placed chip across cells and
confirm the highlighted target cell matches the cursor and the drop lands correctly; confirm day/period
headers stay frozen while scrolling and the drag feedback tracks the cursor without drift; confirm the
slider value persists across a reload; confirm chrome is never scaled.

### Key Discoveries:

- CSS `zoom` reflows (unlike `transform: scale()`), so sticky headers, scroll extent, and the sticky
  `top: calc(var(--day-header-h)+1px)` offsets (`PlannerGrid.tsx:125,133`) stay coherent for free, and
  it does **not** create a containing block — so it does not re-break the frozen headers
  (`sticky-days-periods-names`) or dnd-kit's top-layer drag feedback. `transform` would break both.
  (`archive/2026-06-30-sticky-days-periods-names/research.md:86,97`, `plan.md:49`.)
- CSS `zoom` is Web Platform Baseline (May 2024): Chrome/Edge, Safari, Firefox 126+. In modern
  Chromium it is layout-integrated, so `getBoundingClientRect`/`scrollWidth` return zoom-adjusted
  coords that match pointer coords → dnd-kit stays accurate.
- Cell height is **content-driven** (`SlotCell.tsx:116` `min-h-16`, no max), so Fit must divide
  *measured* content size by *measured* available size — height is the usual binding constraint;
  formulas only reason about *when* zoom-out is needed.
- shadcn CLI ships literal colors on the `slider` primitive (`bg-secondary`/`bg-muted` track,
  `bg-primary` range, `border-primary` thumb) — must be detokenized on add (lessons.md
  "Detokenize shadcn primitives on add"). The install target is `src/shared/ui/` (per `components.json`
  `aliases.ui = @/shared/ui`).

## What We're NOT Doing

- **No `transform: scale()`** — it creates a containing block that regresses the frozen sticky headers
  and the top-layer drag feedback.
- **No `--zoom` rem-multiplier fallback** for browsers lacking Baseline CSS `zoom` (pre-126 Firefox /
  old Safari). Documented here as the future fallback if a target browser proves `zoom`-inconsistent;
  those browsers keep using the native browser zoom for now.
- **No Fit keyboard shortcut** in this change (deferred). Fit is reachable via the gear → Fit only.
- **No live zoom label on the gear** — the gear shows a plain `⚙` icon; the current level is shown only
  inside the popover.
- **No server/DB/action changes** — zoom is a per-device cosmetic pref in `localStorage`, never
  plan-scoped, never persisted to Supabase.
- **No touch to the constraint core, drop router, or `model/drop-hints.ts`** — validation is
  coordinate-free and unaffected by scaling.
- **No default Fit-on-load** — the default is 100% manual; Fit is opt-in.

## Implementation Approach

Four incremental phases, spike-first to retire the one empirical risk before investing in UI:

1. **Spike** proves CSS `zoom` on the grid keeps dnd-kit, sticky headers, and scroll accurate — driven
   by a throwaway control. The `zoom` application code (a `zoom` prop on `PlannerGrid`) is the permanent
   contract; the temporary control is scaffolding removed in Phase 4.
2. **State + persistence** adds the `board-zoom.ts` pref module (copy-shape of `drag-hint-mode.ts`) and
   the `useZoom` hook, and wires the effective numeric scale from `PlannerBoard` into the `PlannerGrid`
   `zoom` prop. Manual mode works end-to-end; fit mode resolves to a placeholder until Phase 3.
3. **Fit-to-scale** adds the measurement hook (`useElementSize`) and the pure fit math (`fit-scale.ts`),
   then resolves fit mode to the measured scale and re-fits on resize.
4. **Popover UI** adds the `slider` primitive and the two chrome components, relocates the drag-hint
   toggle into the popover, mounts the gear, and removes the temporary control.

The temporary control (Phase 1) is carried through Phases 2–3 as the driver so each phase is
hand-verifiable, and is deleted in Phase 4 when the real UI lands.

## Critical Implementation Details

- **Fit measurement must divide out the currently-applied zoom.** CSS `zoom` in modern Chromium is
  layout-integrated, so the grid wrapper's `scrollWidth`/`scrollHeight` report **post-zoom** values.
  Computing fit from those directly while zoom ≠ 1 creates a feedback loop (apply zoom → content
  re-measures larger/smaller → recompute → …). Fit must be computed from the **natural** (zoom-1)
  content size: `naturalW = renderedScrollWidth / appliedZoom`. The available size comes from the
  scroll container's `clientWidth`/`clientHeight`, which is *outside* the zoom target and therefore
  unaffected. This makes fit a stable fixed point that converges in one step. Encode this in the pure
  `fit-scale.ts` signature so it's unit-testable. **The divide-out is only correct if the measured
  content size is genuinely post-zoom** — if a pre-zoom (natural) value were fed in, the division would
  double-correct and fit would run away / oscillate instead of converging. Two guards: (a) the
  measurement is pinned to reading `scrollWidth`/`scrollHeight` off the DOM, not `ResizeObserver`'s
  `contentRect` (Phase 3 §1); (b) the post-zoom reporting of `scrollWidth` on the chosen zoom target is
  **verified empirically in the Phase 1 spike** (criterion 1.10) before `fit-scale.ts` is written.
- **Throttle the `ResizeObserver → fit` recompute with `requestAnimationFrame`.** The observer fires on
  window resize, palette/shelf toggles, and content growth; without rAF coalescing it can fire in bursts.
  (Scroll — including dnd `AutoScroller` — changes `scrollTop`, not `scrollWidth/clientWidth`, so it does
  not trigger the observer; no special mid-drag freeze is needed.)
- **Which node carries `zoom` is resolved empirically in Phase 1.** Default target is the
  `data-slot="planner-grid"` wrapper (`PlannerGrid.tsx:86`). If the spike shows `zoom` + `min-w-full`
  mis-sizes the scroll extent (open question #1), fall back to applying `zoom` to the inner `role="grid"`
  node instead and re-verify horizontal scroll. Downstream phases consume whichever node Phase 1 fixes on.

---

## Phase 1: Zoom Spike (make-or-break gate)

### Overview

Prove that CSS `zoom` on the grid keeps drop targeting, sticky freeze, drag feedback, and scroll
extent correct across the full 25–150% range, before building any persistence or UI. Keep the
`zoom`-application code; throw away the driver.

### Changes Required:

#### 1. `PlannerGrid` accepts and applies a `zoom` prop

**File**: `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx`

**Intent**: Give the grid a single numeric `zoom` control point so the board can scale only the grid
subtree. This prop is the permanent contract every later phase feeds.

**Contract**: Add `zoom: number` to `Props` (1 = 100%). Apply it as `style={{ zoom }}` on the
`data-slot="planner-grid"` wrapper (`:86`) — or, if Phase 1 verification fails, on the inner
`role="grid"` node (`:87`). Default target is the wrapper. No other markup changes.

#### 2. Temporary driver control (throwaway)

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Drive the `zoom` prop with the crudest possible control so the spike can be exercised by
hand at arbitrary levels. This is scaffolding — Phase 4 deletes it.

**Contract**: A local `useState<number>(1)` for the spike level, passed to `PlannerGrid`'s `zoom` prop,
driven by a temporary `<input type="range" min={0.25} max={1.5} step={0.05}>` (or −/+ buttons) rendered
in the `PlanSummaryBar` `trailing` slot alongside the existing `DragHintModeToggle`. Mark the block with
a `// TEMP: zoom spike — removed in Phase 4` comment. No persistence, no popover.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm check`
- Linting passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Build stays clean: `pnpm build`

#### Manual Verification:

- **Drop accuracy**: at zoom 0.25 / 0.5 / 0.75 / 1.0 / 1.25 / 1.5, drag a palette chip and a placed
  chip across cells; the highlighted `isDropTarget` cell matches the cursor and the drop lands on the
  correct `(day, period)`.
- **Sticky freeze**: day-header row and period-label column stay frozen while scrolling at each zoom
  level (both focus and combined modes; combined has the extra cohort sub-label row).
- **Feedback tracking**: the top-layer drag feedback follows the cursor 1:1 without drift at each level.
- **Scroll extent / `min-w-full`**: horizontal + vertical scroll reach the full grid at each level with
  no clipped or unreachable content; the `w-max min-w-full` wrapper still stretches to fill a wide port
  at zoom 1 (resolves open question #1). If broken on the wrapper, re-test with `zoom` on `role="grid"`.
- **Chrome unaffected**: palette, shelf, summary bar, and error banners stay at 100% at every level.
- **Measurement direction (de-risks Phase 3)**: log the chosen zoom target's `scrollWidth`/`scrollHeight`
  at zoom 1 and at 0.5; confirm they scale with the applied zoom (i.e. report **post-zoom** values). This
  is the assumption `fit-scale.ts`'s divide-out depends on — if `scrollWidth` were zoom-invariant,
  Phase 3's `naturalW = scrollWidth / appliedZoom` would be wrong.

**Implementation Note**: After Phase 1 automated verification passes, **pause for human confirmation**
that the manual zoom-level checks are green (this is the make-or-break gate) and that the chosen `zoom`
target node is recorded, before proceeding to Phase 2.

---

## Phase 2: Persistence + State + Manual Wiring

### Overview

Add the per-device zoom preference module and hook, and route the resolved numeric scale from
`PlannerBoard` into the `PlannerGrid` `zoom` prop. Manual zoom works end-to-end and persists; fit mode
resolves to a placeholder scale (1) until Phase 3. Still driven by the temporary control.

### Changes Required:

#### 1. Zoom preference module

**File**: `src/_pages/plan-detail/lib/board-zoom.ts` (new)

**Intent**: A localStorage-backed, cross-tab, per-device zoom preference — copy the *shape* of
`drag-hint-mode.ts` (read/write/subscribe + try/catch + `storage` listener + in-memory listener set),
substituting a discriminated zoom state and a clamp validator.

**Contract**:
- `export type ZoomState = { mode: "manual"; level: number } | { mode: "fit" };`
- `export const MIN_ZOOM = 0.25;` `export const MAX_ZOOM = 1.5;` `export const ZOOM_STEP = 0.05;`
- `export const DEFAULT_ZOOM: ZoomState = { mode: "manual", level: 1 };`
- module-private `const STORAGE_KEY = "planner-board-zoom";`
- `readZoom(): ZoomState` — `typeof window` guard → `try { getItem }` → `parseZoom` → `catch → DEFAULT_ZOOM`.
- `writeZoom(state: ZoomState): void` — guard → `try { setItem(JSON.stringify) }` → `catch {}` → notify listeners.
- `subscribeZoom(listener): () => void` — registers listener + a `storage` handler keyed on `STORAGE_KEY`; returns an unsubscribe removing both.
- `parseZoom(raw: string | null): ZoomState` — JSON-parse; accept `{mode:"fit"}`; accept `{mode:"manual", level}` only when `level` is a finite number, **clamping** to `[MIN_ZOOM, MAX_ZOOM]`; return `DEFAULT_ZOOM` on null / parse error / any other shape. This satisfies the lesson "guard localStorage with try/catch, not just typeof window".

#### 2. `useZoom` hook

**File**: `src/_pages/plan-detail/ui/chrome/board-disclosure.ts`

**Intent**: Expose the persisted zoom to the island via `useSyncExternalStore` (server snapshot =
`DEFAULT_ZOOM`, so hydration can't mismatch), mirroring `useHintMode`.

**Contract**: `export function useZoom(): { zoom: ZoomState; setZoom: (next: ZoomState) => void }` —
`useSyncExternalStore(subscribeZoom, readZoom, () => DEFAULT_ZOOM)` returning the state and `writeZoom`.
Export `useZoom` from `chrome/index.ts` next to `useHintMode`.

#### 3. Effective-scale resolution + wiring

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Convert the discriminated `ZoomState` into a single numeric scale for the grid and replace
the spike's local state with the real hook. Fit is a placeholder here (resolves to 1) and becomes real
in Phase 3.

**Contract**: Call `useZoom()` once (island singleton). Compute `effectiveZoom: number` — `manual` →
`level`; `fit` → `1` (placeholder, `// resolved in Phase 3`). Pass `effectiveZoom` to `PlannerGrid`'s
`zoom` prop. Keep the temporary control but point it at `setZoom({ mode: "manual", level })` so manual
zoom now persists across reloads.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test` (new `board-zoom.test.ts`)
- Type checking passes: `pnpm check`
- Linting passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Build stays clean: `pnpm build`

#### Manual Verification:

- Setting a manual zoom via the temporary control persists across a page reload.
- Opening the same plan in a second tab reflects a zoom change made in the first (cross-tab `storage`).
- With storage blocked (Safari private mode / disabled), the board still renders at the default and
  does not crash (try/catch degrade).

**Implementation Note**: After Phase 2 automated verification passes, pause for human confirmation of
the persistence + cross-tab manual checks before proceeding to Phase 3.

### Tests:

- `src/_pages/plan-detail/lib/board-zoom.test.ts` — `parseZoom` returns `DEFAULT_ZOOM` on `null` /
  invalid JSON / wrong shape / non-finite `level`; clamps out-of-range `level` into `[0.25, 1.5]`;
  round-trips `{mode:"fit"}` and a valid `{mode:"manual", level}`.

---

## Phase 3: Remove Fit + Simplify Zoom State

> **Superseded by the Scope change above.** The original Phase 3 built Fit-to-Scale (an
> `use-element-size` hook, a pure `fit-scale` function, and a measured fit-mode resolution with a
> `scrollbar-none` stabilizer). That code was spike-verified working but judged not worth keeping, so
> it was **reverted before commit**. Phase 3 now *removes* the Fit surface and collapses the zoom state
> to a plain number.

### Overview

Drop every trace of Fit and reduce the persisted zoom to a single `number`. Manual zoom keeps working
end-to-end (still driven by the temporary slider); the scroll container keeps its normal scrollbar.

### Changes Required:

#### 1. Delete the Fit model files

**Files**: `src/_pages/plan-detail/model/fit-scale.ts`, `.../fit-scale.test.ts`,
`.../use-element-size.ts` (all removed).

**Intent**: No measurement, no fit math — nothing consumes them once Fit is gone.

#### 2. Collapse `ZoomState` to a `number`

**File**: `src/_pages/plan-detail/lib/board-zoom.ts` (+ `board-zoom.test.ts`)

**Contract**: `DEFAULT_ZOOM = 1` (a `number`); `readZoom(): number` / `writeZoom(level: number)`;
`parseZoom(raw): number` returns `DEFAULT_ZOOM` on null/empty/non-finite and clamps into
`[MIN_ZOOM, MAX_ZOOM]`. Keep `MIN_ZOOM`/`MAX_ZOOM`/`ZOOM_STEP`. Because a primitive `getSnapshot` is
inherently referentially stable, **drop the Phase-2 snapshot cache** (its only job was to keep an object
return from looping — React #185). `board-zoom.test.ts` becomes pure `parseZoom` number tests (no jsdom,
no snapshot-stability test).

#### 3. Simplify the board wiring

**Files**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`, `.../ui/grid/PlannerGrid.tsx`

**Contract**: `useZoom()` now returns `{ zoom: number; setZoom: (level: number) => void }`. Pass `zoom`
straight to `PlannerGrid`'s `zoom` prop. Remove the content/port refs, the `useElementSize`/`fitScale`
imports and effects, and the `scrollbar-none` class (restore the plain `min-h-0 flex-1 overflow-auto`
container). Remove the `ref` prop re-added to `PlannerGrid` for measurement. The temporary control stays
a plain-number slider (`value={zoom}`, `onChange={(e) => setZoom(Number(e.target.value))}`); its Fit
button is removed.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test` (`board-zoom.test.ts`, now number-based)
- Type checking passes: `pnpm check`
- Linting passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Build stays clean: `pnpm build`

#### Manual Verification:

- The manual zoom slider still scales only the grid and persists across reload / syncs across tabs.
- The scroll container shows its normal scrollbar again and scrolls on both axes.
- No Fit affordance remains anywhere.

**Implementation Note**: After Phase 3 automated verification passes, pause for human confirmation of the
manual checks before proceeding to Phase 4.

### Tests:

- `src/_pages/plan-detail/lib/board-zoom.test.ts` — `parseZoom` returns `DEFAULT_ZOOM` on
  null/empty/non-numeric; clamps out-of-range into `[MIN_ZOOM, MAX_ZOOM]`; round-trips a valid level.

---

## Phase 4: Board Settings Popover + Cleanup

### Overview

Replace the temporary control with the real UI: a gear button opening a **Board settings** popover
containing the Zoom section (slider + readout + Fit + Reset) and the relocated **While dragging**
toggle. Add the `slider` primitive. Remove all Phase-1 scaffolding.

### Changes Required:

#### 1. Slider primitive (detokenized)

**File**: `src/shared/ui/slider.tsx` (new) + `src/shared/ui/index.ts`

**Intent**: Add the shadcn `slider` (Radix-based, controlled `value: number[]` / `onValueChange`) as a
cross-slice primitive, then detokenize the CLI's literal colors.

**Contract**: Run `pnpm dlx shadcn@latest add slider` (lands in `src/shared/ui/` per `components.json`).
**Detokenize on add** — replace literal color classes with semantic tokens: track `bg-secondary` /
`bg-muted` → `bg-secondary`/`bg-muted` are already tokens but audit the generated output and map any
`bg-primary`/`border-primary`/`ring-ring` literals per the semantic-token rule; add missing tokens to
`global.css` first if needed. Export `Slider` from the `src/shared/ui/index.ts` barrel. (Lessons.md
"Detokenize shadcn primitives on add"; "Use semantic theme tokens".)

#### 2. Zoom control

**File**: `src/_pages/plan-detail/ui/chrome/ZoomControl.tsx` (new)

**Intent**: The Zoom section of the popover — a continuous slider bound to the level, a `%` readout, and
a Reset button. (Fit removed per the Scope change.)

**Contract**: Props `{ zoom: number; setZoom: (level: number) => void }`. Slider `value={[zoom]}`,
`min={MIN_ZOOM}`, `max={MAX_ZOOM}`, `step={ZOOM_STEP}`, `onValueChange={([level]) => setZoom(level)}`. A
`tabular-nums` `%` readout of the current level (`Math.round(zoom * 100)%`). `Reset` button →
`setZoom(1)` (lucide `RotateCcw`). Root `data-slot="zoom-control"`; slider `aria-label="Zoom level"`;
the Reset button gets `aria-label` + native `title` (role+name e2e contract, `ui-conventions.md:94-100`).
Build only from `Button`/`Slider` token-based variants.

#### 3. Board settings menu (gear + popover)

**File**: `src/_pages/plan-detail/ui/chrome/BoardSettingsMenu.tsx` (new) + `chrome/index.ts`

**Intent**: The single board-settings affordance in the top bar — a gear `Button` opening a `Popover`
that hosts the Zoom section and the relocated drag-hint toggle under two labelled sections.

**Contract**: Props `{ zoom, setZoom, hintMode, setHintMode }`. Gear `Button`
(`variant="ghost" size="icon"`, lucide `Settings`/gear, `aria-label="Board settings"`, native `title`)
as `PopoverTrigger`; `PopoverContent` with a **Zoom** section (`<ZoomControl … />`) and a **While
dragging** section (`<DragHintModeToggle mode={hintMode} onChange={setHintMode} />`). Popover keeps the
default dismiss behavior (stays open during slider drag; closes on outside click / Escape). Export from
`chrome/index.ts`.

#### 4. Mount the gear; relocate the toggle; remove scaffolding

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Wire the real control into the bar and delete the Phase-1 temporary control.

**Contract**: Replace the `PlanSummaryBar` `trailing={<DragHintModeToggle … />}` with
`trailing={<BoardSettingsMenu zoom={zoom} setZoom={setZoom} hintMode={hintMode} setHintMode={setHintMode}
/>}`. Remove the `// TEMP: zoom spike` control. Keep the `zoom` → `PlannerGrid` wiring.
`DragHintModeToggle` is no longer rendered directly by the board (now nested in the menu) but is still
exported for the menu's use.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Type checking passes: `pnpm check`
- Linting passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Build stays clean: `pnpm build`
- `pnpm audit --audit-level=high` clean (new dep surface from `slider`, if any)
- E2E drop-accuracy tripwire passes: `pnpm test:e2e` — a chip dropped at ~50% zoom lands on the expected
  `(day, period)` cell (coarse identity assertion, not pixel coordinates)

#### Manual Verification:

- The gear button (`⚙`, `aria-label="Board settings"`) appears in the top bar; the old inline drag-hint
  toggle no longer sits directly in the bar.
- Opening the popover shows the Zoom slider (25–150%, 5% steps) with a live `%` readout and a Reset
  button, plus the **While dragging** collision-emphasis toggle unchanged in behavior.
- Dragging the slider scales only the grid; Reset returns to 100%; the collision toggle still changes
  drag-hint encoding.
- The popover stays open during a slider drag and closes on outside-click / Escape.
- Slider, Reset, and gear are all reachable by keyboard and expose accessible names.
- No literal/palette colors in the slider render (light + dark themes both correct).

**Implementation Note**: After Phase 4 automated verification passes, pause for human confirmation of
the full popover UX + theming before closing the change.

---

## Testing Strategy

### Unit Tests:

- `board-zoom.test.ts` — `parseZoom` default/clamp/round-trip behavior on a plain number level
  (Phase 2, simplified in Phase 3). (Fit-to-Scale and its `fit-scale.test.ts` were cut — see the Scope
  change.)

### Integration Tests:

- None. No server/DB/action surface changes; zoom is a client-only cosmetic pref.

### E2E Tests:

- **One coarse drop-accuracy tripwire** (Phase 4, Playwright via `pnpm test:e2e`): with the grid at a
  non-100% zoom (~50%, set via the popover slider), drag a palette chip onto a target cell and assert it
  lands on the expected `(day, period)`. This is deliberately *coarse* — assert the resulting placement /
  target cell identity, **not** pixel coordinates (exact-coordinate hit-testing under `zoom` is flaky,
  which is why the full matrix stays manual). Its only job is to turn a silent regression (a dnd-kit bump,
  a Chromium `zoom` change, or a grid CSS edit that breaks drop mapping under scale) into a red CI.

### Manual Testing Steps (the load-bearing coverage — dnd + layout under `zoom` is DOM-geometry-heavy):

1. **Drop accuracy at scale** — at 0.25 / 0.5 / 0.75 / 1.0 / 1.25 / 1.5, drag palette and placed chips;
   highlighted target matches cursor; drop lands on the correct cell (focus **and** combined modes).
2. **Sticky + feedback** — headers stay frozen while scrolling; top-layer feedback tracks the cursor
   without drift, at each level.
3. **Scroll extent** — full grid reachable by scroll at each level; `min-w-full` stretch correct at 1.
4. **Persistence** — a set level survives reload and syncs across tabs; storage-blocked degrades to
   default without crashing.
5. **Fit** — fits both dimensions; re-fits on resize / panel toggle; never enlarges past 100%; bottoms
   out at 25% for a very tall plan.
6. **Popover UX + a11y + theming** — slider/Fit/Reset/toggle all work, keyboard-reachable with
   accessible names, no literal colors in light/dark.

## Performance Considerations

- The <200ms drag-drop validation budget is **coordinate-free** (`model/drop-hints.ts`, fires on
  drag-start) and cannot be affected by CSS scaling — confirmed by research grep of the slice.
- The fit `ResizeObserver` recompute is rAF-throttled so window-resize / panel-toggle bursts coalesce
  into one layout pass; scroll and dnd auto-scroll do not trigger it (they change `scrollTop`, not
  observed dimensions).
- CSS `zoom` reflows the grid subtree only; chrome is untouched, so there is no full-page relayout on
  zoom change.

## Migration Notes

- New `localStorage` key `"planner-board-zoom"`; absent on existing devices → `readZoom` returns
  `DEFAULT_ZOOM` (`{mode:"manual", level:1}`). No data migration, no server state, no rollback concern —
  clearing the key restores the default.

## References

- Research: `context/changes/plan-board-zoom/research.md`
- Zoom target: `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx:86`
- Scroll container: `src/_pages/plan-detail/ui/PlannerBoard.tsx:218`
- Control home: `src/_pages/plan-detail/ui/chrome/PlanSummaryBar.tsx:61-62`,
  `PlannerBoard.tsx:198` (`trailing` slot)
- Pref module template: `src/_pages/plan-detail/lib/drag-hint-mode.ts`
- Hook template: `src/_pages/plan-detail/ui/chrome/board-disclosure.ts:18-21`
- Toggle to relocate: `src/_pages/plan-detail/ui/chrome/DragHintModeToggle.tsx`
- Sticky "no transform ancestor" invariant:
  `context/foundation/archive/2026-06-30-sticky-days-periods-names/` (research.md:86,97, plan.md:49)
- shadcn config: `components.json` (`aliases.ui = @/shared/ui`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename
> step titles. See `references/progress-format.md`.

### Phase 1: Zoom Spike (make-or-break gate)

#### Automated

- [x] 1.1 Type checking passes: `pnpm check` — d5f349e
- [x] 1.2 Linting passes: `pnpm lint` — d5f349e
- [x] 1.3 FSD structure check passes: `pnpm steiger` — d5f349e
- [x] 1.4 Build stays clean: `pnpm build` — d5f349e

#### Manual

- [x] 1.5 Drop accuracy correct at 0.25/0.5/0.75/1.0/1.25/1.5 (focus + combined) — d5f349e
- [x] 1.6 Sticky day/period headers stay frozen while scrolling at each level — d5f349e
- [x] 1.7 Top-layer drag feedback tracks the cursor without drift at each level — d5f349e
- [x] 1.8 Scroll extent / `min-w-full` correct at each level (open question #1 resolved; zoom target = `data-slot="planner-grid"` wrapper) — d5f349e
- [x] 1.9 Chrome (palette/shelf/summary bar/banners) stays at 100% at every level — d5f349e
- [x] 1.10 Zoom target's `scrollWidth`/`scrollHeight` scale with applied zoom (post-zoom — de-risks Phase 3 divide-out) — d5f349e

### Phase 2: Persistence + State + Manual Wiring

#### Automated

- [x] 2.1 Unit tests pass: `pnpm test` (`board-zoom.test.ts`) — eaf3b6b
- [x] 2.2 Type checking passes: `pnpm check` — eaf3b6b
- [x] 2.3 Linting passes: `pnpm lint` — eaf3b6b
- [x] 2.4 FSD structure check passes: `pnpm steiger` — eaf3b6b
- [x] 2.5 Build stays clean: `pnpm build` — eaf3b6b

#### Manual

- [x] 2.6 A manual zoom persists across a page reload — eaf3b6b
- [x] 2.7 A zoom change syncs across tabs (cross-tab `storage`) — eaf3b6b
- [x] 2.8 Storage-blocked (private mode) degrades to default without crashing — eaf3b6b

### Phase 3: Remove Fit + Simplify Zoom State

#### Automated

- [x] 3.1 Unit tests pass: `pnpm test` (`board-zoom.test.ts`, number-based)
- [x] 3.2 Type checking passes: `pnpm check`
- [x] 3.3 Linting passes: `pnpm lint`
- [x] 3.4 FSD structure check passes: `pnpm steiger`
- [x] 3.5 Build stays clean: `pnpm build`

#### Manual

- [x] 3.6 Manual slider still scales only the grid; persists across reload / syncs across tabs
- [x] 3.7 Scroll container shows its normal scrollbar again; scrolls on both axes
- [x] 3.8 No Fit affordance remains anywhere (fit code fully reverted)

### Phase 4: Board Settings Popover + Cleanup

#### Automated

- [ ] 4.1 Unit tests pass: `pnpm test`
- [ ] 4.2 Type checking passes: `pnpm check`
- [ ] 4.3 Linting passes: `pnpm lint`
- [ ] 4.4 FSD structure check passes: `pnpm steiger`
- [ ] 4.5 Build stays clean: `pnpm build`
- [ ] 4.6 `pnpm audit --audit-level=high` clean

#### Manual

- [ ] 4.7 Gear button appears; old inline drag-hint toggle removed from the bar
- [ ] 4.8 Popover shows Zoom slider (25–150%, 5% step) + `%` readout + Reset + relocated toggle
- [ ] 4.9 Slider scales only the grid; Reset → 100%; collision toggle still works
- [ ] 4.10 Popover stays open during slider drag; closes on outside-click / Escape
- [ ] 4.11 Slider/Reset/gear keyboard-reachable with accessible names
- [ ] 4.12 No literal/palette colors in the slider render (light + dark correct)

#### E2E

- [ ] 4.13 `pnpm test:e2e`: a chip dropped at ~50% zoom lands on the expected `(day, period)` cell (coarse regression tripwire)
