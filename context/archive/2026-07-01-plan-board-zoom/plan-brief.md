# Plan Board Zoom — Plan Brief

> Full plan: `context/changes/plan-board-zoom/plan.md`
> Research: `context/changes/plan-board-zoom/research.md`

## What & Why

Add zoom scoped to **just the planner board grid** — a continuous slider plus one-click Fit-to-scale —
so a user can see a partially-packed or oversized board on a small viewport. Today the only option is
the browser's own zoom, which scales *everything* (palette, summary bar, shelf); this scopes zoom to the
timetable subtree alone.

## Starting Point

The board already funnels the whole grid through a single `overflow-auto` scroll container
(`PlannerBoard.tsx:218`) wrapping a single intrinsic-width grid (`PlannerGrid.tsx:86`), with palette /
shelf / summary bar / banners all as siblings *outside* it. Drag-and-drop is the new experimental
dnd-kit 0.5 (viewport-space hit-testing, top-layer popover feedback) and the <200ms validation is
coordinate-free — so scaling the grid subtree touches none of it. There is no element-size hook and no
`slider` primitive in the repo yet.

## Desired End State

A gear button (`⚙`) in the top bar opens a **Board settings** popover with a **Zoom** section (25–150%
slider + `%` readout + Fit + Reset) and a **While dragging** section (the relocated collision-emphasis
toggle). The slider scales only the grid; chrome stays at 100%. Drag-drop, sticky headers, and drag
feedback stay pixel-accurate at every level. Fit shrinks the board to fit the port and re-fits on
resize. Zoom persists per device; a fresh device renders at 100%.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Scaling mechanism | CSS `zoom` on the grid wrapper | Reflows (keeps sticky + scroll coherent) and creates no containing block, so it doesn't re-break frozen headers or dnd-kit feedback like `transform` would. | Research |
| Risk phasing | Spike first, then UI | dnd-kit-under-zoom is cleared only analytically; a thin spike retires the make-or-break before investing in the popover. | Plan |
| Default on fresh device | 100% manual | Predictable, matches today's behavior; Fit is opt-in. | Plan |
| Slider range / step | 25%–150%, step 5% | Low floor lets Fit shrink even very tall combined plans into one view. | Plan |
| Browser scope | Baseline `zoom` only | App targets modern evergreen; rem-multiplier fallback is far more invasive and deferred. | Plan |
| Fit keyboard shortcut | Deferred | Keep scope minimal; add later if users ask. | Plan |
| Gear label | Plain `⚙` icon | Calmest bar; level shown inside the popover. | Plan |
| Persistence | `localStorage`, per device | Cosmetic pref; mirrors `drag-hint-mode` / `shelf-pinned` — never plan-scoped, never server-side. | Research |

## Scope

**In scope:** CSS-`zoom` grid scaling; a discriminated `{manual,level} | {fit}` per-device pref; a
`useZoom` hook; a measurement hook + pure fit math; a `slider` primitive; a Board settings popover
hosting Zoom + the relocated drag-hint toggle.

**Out of scope:** `transform: scale()`; the `--zoom` rem-multiplier fallback (older browsers); a Fit
keyboard shortcut; a live zoom label on the gear; any server/DB/action change; touching the constraint
core / drop router / drop-hints.

## Architecture / Approach

`PlannerGrid` gains a numeric `zoom` prop applied as `style={{ zoom }}` on the `planner-grid` wrapper.
`PlannerBoard` (island singleton) resolves the persisted `ZoomState` into that number: `manual → level`;
`fit → fitScale(measured content ÷ applied zoom, measured port)`. State lives in a `board-zoom.ts` pref
module (localStorage + try/catch + cross-tab) consumed via `useZoom` (`useSyncExternalStore`). The
control is a gear-triggered `Popover` in the summary bar's trailing slot.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Zoom spike | `zoom` prop on `PlannerGrid` + throwaway control; empirical verification | dnd-kit / sticky / scroll misbehaving under `zoom` on a real browser |
| 2. State + persistence | `board-zoom.ts` + `useZoom` + manual-zoom wiring | localStorage hydration / cross-tab edge cases |
| 3. Fit-to-scale | `useElementSize` + pure `fit-scale.ts` + live fit mode | measurement feedback loop if applied-zoom isn't divided out |
| 4. Popover UI + cleanup | `slider` primitive + `ZoomControl` + `BoardSettingsMenu`; remove scaffolding | shadcn slider literal colors (detokenize); a11y names |

**Prerequisites:** none — no new backend, no migration; the risky path is validated in Phase 1.
**Estimated effort:** ~2–3 sessions across 4 phases (mostly UI + one pure fn + one hook).

## Open Risks & Assumptions

- CSS `zoom` behaves consistently on the actual target browsers (validated empirically in Phase 1; if
  the wrapper mis-sizes with `min-w-full`, fall back to applying `zoom` to the inner `role="grid"` node).
- Fit measurement must divide out the currently-applied zoom to avoid a ResizeObserver feedback loop
  (captured as a Critical Implementation Detail).
- Baseline-`zoom` browsers only; pre-126 Firefox / old Safari keep using native browser zoom.

## Success Criteria (Summary)

- The slider scales only the grid — palette, shelf, and bar stay at 100% — with drop targeting, sticky
  headers, and drag feedback accurate at 25–150%.
- Fit fits the whole board in one view and re-fits on resize; the chosen level persists across reloads.
- The Board settings popover is keyboard-accessible, theme-token-clean, and hosts both the Zoom controls
  and the unchanged collision-emphasis toggle.
