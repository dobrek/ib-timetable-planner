# Bundle Duplication — Plan Brief

> Full plan: `context/changes/bundle-duplication/plan.md`
> Research: `context/changes/bundle-duplication/research.md`

## What & Why

Add a **"duplicate"** affordance: clicking a control on a placed cell copies all of its course-hours into the **next conflict-free empty slot**, leaving the source in place. It is the missing third whole-slot verb alongside the existing `moveBundle` / `removeBundle` — letting an author replicate a working grouping without re-dragging it course by course.

## Starting Point

The planner already has whole-slot move/remove verbs (`use-placements.ts`), a group fan-out that places a member-set at a cell via the `place_course` RPC (which find-or-creates a bundle keyed by cell), and a `deriveDropHints` oracle that classifies every cell's validity for a dragged member-set. Research verified that "duplicate" needs none of these rebuilt — only a thin search + UI affordance over them.

## Desired End State

An author clicks `Copy` on any placed cell and its course(s) appear at the next conflict-free empty slot — scrolled into view and briefly highlighted — with the source untouched and A/B weeks mirrored. The control appears on grouped bundles, on the same bundle after ungrouping, and on single-occupant cells. No empty slot → an explanatory banner.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Persistence | Reuse `place_course` fan-out | A fresh cell auto-mints an independent bundle; no server work needed | Research |
| Week (A/B) faithfulness | Copy source weeks verbatim | Re-resolving can swap A/B between members; carry an explicit per-member map | Research |
| Hours overshoot | Allow, no gate | Consistent with the advisory (display-only) hours model | Research |
| "Conflict-free" | Two-tier: strictly-free, else non-blocking | Reuses the sparse hint map; prefers a clean cell, tolerates `warn`/`opposite-week` | Research |
| Scan order | Column-major, anchored after the source (wraps) | "Next free slot down the source's day, then next day" — never jumps back to the week's top-left | Plan |
| No slot available | Reuse existing error banner | Fits the `{ kind: "message" }` error shape; no new error type | Research |
| Atomicity | Per-member fan-out (no transactional RPC) | Same as a grouping drop; partial failure → existing `groupFailure` banner | Research |
| Exploded-cell scope | Duplicate is cell-level; ungrouping has no impact | Header button shows for any ≥2 cell (not bundled-gated, unlike the trash) | Plan |
| Single-occupant control | Always-visible `Copy` icon, `SlotCell` sibling (no `PlacedChip` prop) | Discoverable; respects the research's hard no-chip-prop constraint | Plan |
| Success feedback | Scroll into view + highlight pulse | The target may be off-screen (grid scrolls); answers "where did it land?" | Plan |
| Test scope | Unit + component + integration + E2E | Cover the new search/feedback and prove the gesture + persistence end-to-end | Plan |

## Scope

**In scope:** a pure conflict-free target search; a week-faithful fan-out; a `duplicateBundle` hook verb; a header button (≥2-occupant cells) + an always-visible icon (single cells); scroll-into-view + pulse; unit, component, integration, and E2E tests.

**Out of scope:** any server / DB / RPC / Action / Zod change; a transactional `duplicate_bundle` RPC; an hours-overshoot gate; per-loose-chip duplicate semantics; companion-dropdown reconciliation; a new `PlacedChip` prop.

## Architecture / Approach

A pure `findDuplicateTarget` runs the existing `deriveDropHints` oracle once with a **copy** context (`{ members }` — no exclude/origin, so the source stays on the board) and scans empty cells column-major **starting just after the source** (wrapping the grid), two-tier. `duplicateBundle` (a new `usePlacements` verb) reads the cell's occupants + weeks, calls the search, then dispatches the week-faithful `place_course` fan-out at the target or sets a message error — publishing the target so the board scrolls + pulses it. UI threads `onDuplicateBundle` through `PlannerBoard → PlannerGrid → SlotCell`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Model | Pure search + week-faithful fan-out + `duplicateBundle` verb | Copy vs. move context (must not exclude the source) |
| 2. UI | Two affordances, threading, scroll + pulse feedback | Header button must show regardless of grouped/exploded; no `PlacedChip` prop |
| 3. Integration | RPC test: independent bundle + weeks across two cells | Asserting the real cross-cell independence, not the same-cell case |
| 4. E2E + verify | Browser duplicate-gesture spec + green `/verify` | Deterministic after-source target (next period down) in assertions |

**Prerequisites:** local Supabase running + `pnpm env:local` (for Phase 3 integration and Phase 4 E2E).
**Estimated effort:** ~2–3 sessions across 4 phases; the bulk is Phase 1 (search + verb) and Phase 2 (feedback wiring).

## Open Risks & Assumptions

- **Copy-vs-move context** is the load-bearing correctness detail — the search must judge against the full board (no `excludePlacementIds`/`origin`), or it could pick the source's own cell.
- **Highlight lifecycle** must self-clear and re-fire on a subsequent duplicate, with timer cleanup and `prefers-reduced-motion` honored.
- **Companion-dropdown drift** after a duplicate is accepted as low-risk and self-healing (research Problem F).

## Success Criteria (Summary)

- An author duplicates any placed cell into the next conflict-free slot in one click, source retained, A/B mirrored, target visibly highlighted.
- No empty slot → a clear banner, never a silent failure.
- Unit + component + integration + E2E green, and a clean `/verify`.
