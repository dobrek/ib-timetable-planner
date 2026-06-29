# Grouping Refresh (Stale Version) — Plan Brief

> Full plan: `context/changes/grouping-refresh-stale-version/plan.md`
> Research: `context/changes/grouping-refresh-stale-version/research.md`

## What & Why

When the author edits courses, students, or teacher assignments after a cohort's groupings were computed, the board keeps showing the old suggestion palette with **no indication it's out of date and no way to regroup**. This change detects per-cohort staleness and, when stale, **replaces the palette with a recompute panel** (the whole palette is stale-derived) — finishing a feature (historically "S-06") whose detection primitive and recompute engine already ship and are tested, but were never wired to the UI.

## Starting Point

`isGroupingStale` (catalog-hash comparison) and the idempotent `computeGroupings` Action both exist and are tested, but `isGroupingStale` is called by no loader/UI and isn't even exported. `loadPlannerData` already loads the live catalog but computes no `stale` flag; the only compute entry point is the empty state, gated behind `groupings.length === 0`. Placements have **no FK to groupings**, so recompute provably cannot touch the board.

## Desired End State

When the active cohort's catalog has changed since its groupings were computed, the palette column is replaced by a `warning`-toned recompute panel; the board/grid stays visible and interactive. Clicking **Recompute** runs the existing Action, then on success re-runs the loader so the normal palette returns; on failure it shows an inline `role="alert"` error in the panel (the board mounts no `<Toaster>`, so no toast — mirrors the sibling `ComputeGroupingsEmptyState`). Placements are untouched; dp1/dp2 staleness is independent.

## Key Decisions Made

| Decision                      | Choice                                                                  | Why (1 sentence)                                                                                                                                     | Source                     |
| ----------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Placement policy on recompute | Keep placements, refresh palette only (Option A)                        | No FK from placements to groupings — the board survives recompute; validation already re-runs live.                                                  | Research                   |
| Indicator + control surface   | **Replace** the palette with a recompute panel when stale (board stays) | The whole palette is downstream of the stale groupings — none of it is trustworthy, so hide it rather than annotate it; the timetable is unaffected. | Research → refined in Plan |
| Trigger                       | Manual only                                                             | Avoids overwriting the ranked palette mid-edit; matches the one-shot/off-hot-path design.                                                            | Research                   |
| Catalog load                  | Reuse the already-loaded catalog                                        | Refactor `isGroupingStale` to take the catalog — no double `loadCohortCourses`.                                                                      | Research                   |
| "Last computed" timestamp     | Omit                                                                    | The binary stale/fresh signal is the actionable info; less plumbing/noise.                                                                           | Plan                       |
| Confirm before recompute      | Run immediately (no dialog)                                             | Recompute is non-destructive to the board, so friction isn't warranted.                                                                              | Plan                       |
| Progress/error feedback       | Busy button + inline `role="alert"` error, then `refreshPage()`         | Board mounts no `<Toaster>`, so mirror the sibling `ComputeGroupingsEmptyState` (inline error) rather than the sonner-toast idiom.                    | Plan → refined in Review   |
| Recompute availability        | Stale-only                                                              | Tightest scope; avoids nudging needless recomputes that overwrite a good palette.                                                                    | Plan                       |
| Left-column view selection    | One derived view (`resolvePaletteView`) the board dispatches on         | Orchestration over patching — model the empty/stale/ready state machine once instead of accreting inline conditions; removes the existing gate too.  | Plan                       |

## Scope

**In scope:**

- Refactor `isGroupingStale` to accept the loaded catalog; export it.
- Compute a per-cohort `stale` flag in `loadPlannerData`; add `stale` to `PlannerBoardProps`.
- New `GroupingStalePanel` that **replaces** the palette column when stale (board branch lives in `PlannerBoard`; `PlannerPalette` untouched); reuse the existing compute Action.
- One Playwright spec covering the stale → recompute round-trip on real workerd, with an over-staleness guard.

**Out of scope:**

- Touching placements (no board-clear, no migration).
- Cohort-move orphaned-placement bug (pre-existing; separate change candidate).
- Auto-recompute, confirm dialog, timestamp, persistent control, any schema/RPC/Action change, any new view/route.

## Architecture / Approach

Server-then-client-then-E2E, three phases. Phase 1: the load path emits `stale: boolean` by hashing the already-loaded catalog and comparing to the stored `course_groupings.catalog_hash` (guarded behind `groupings.length > 0`, sequential after the existing parallel load). Phase 2: the board's left column becomes **one derived view** — a pure `resolvePaletteView({ groupingsCount, stale }) → "empty"|"stale"|"ready"` that `PlannerBoard` dispatches on (mirroring its existing `switch(data.kind)`), so the new stale case and the _existing_ `groupings.length === 0` guard live in one tested decision instead of scattered conditions; the stale view renders a `warning` recompute panel in place of `PlannerPalette` (keeping the grid), reusing `computeGroupings` + the sibling `ComputeGroupingsEmptyState`'s busy → inline-error-on-failure → `refreshPage()`-on-success idiom (no `<Toaster>` on this board). Phase 3: one Playwright spec drives the round-trip on real workerd. Cohort switch already remounts the island, so staleness re-evaluates per cohort for free.

## Phases at a Glance

| Phase                         | What it delivers                                                                      | Key risk                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Load-path wiring           | Per-cohort `stale` flag on `PlannerBoardProps`, no catalog double-fetch               | Integration test must move to the new `isGroupingStale` signature                                                                                          |
| 2. Palette-view orchestration | `resolvePaletteView` dispatch + `GroupingStalePanel` replacing the palette when stale | The refactor must _remove_ the `groupings.length === 0` gate (not add a branch); panel holds the column (no layout shift), `warning` tokens, inline-error + refresh |
| 3. E2E coverage               | `grouping-staleness.spec.ts`: compute → edit → panel → recompute → restored           | Drag/compute timing on workerd; the over-staleness guard must actually fail if the two hash sites drift                                                    |

**Prerequisites:** Local Supabase up + `pnpm env:local` (integration + E2E); the E2E author is auto-provisioned by `pretest:e2e`. No new access or migrations.
**Estimated effort:** ~1–2 sessions across 3 phases (small, pattern-following wiring + one Playwright spec on the existing harness).

## Open Risks & Assumptions

- Assumes the catalog hash stays deterministic (code-point sort, Web Crypto) — do not reintroduce locale-sensitive sorting in any hashing path.
- The extra per-load hash + single-column read is off the per-drop `<200ms` budget; acceptable on page load.
- Replacing (not annotating) the palette means a **failed recompute leaves no palette fallback** until a retry succeeds — accepted: the board stays, the old rows survive the atomic replace, and recompute on a previously-groupable catalog is reliable.
- The cohort-move orphan gap is knowingly left for a separate change; this plan does not close it.

## Success Criteria (Summary)

- A stale cohort shows the recompute panel in place of the palette (grid still visible); Recompute restores the palette with placements unchanged.
- A fresh (unchanged) catalog shows the normal palette; dp1/dp2 reflect staleness independently.
- The Playwright spec proves the round-trip end-to-end and guards against false-stale on a freshly computed palette.
- `pnpm exec astro check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, and `pnpm build` all pass.
