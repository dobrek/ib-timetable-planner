# Planner Board Highlight/Discovery Lens — Plan Brief

> Full plan: `context/changes/planner-board-search-discovery/plan.md`
> Research: `context/changes/planner-board-search-discovery/research.md`

## What & Why

The planner board gets densely packed — a dozen bundles hosting many subjects — making it hard to answer "where are all the math courses", "what does teacher KK's week look like", or "how does the plan look for student ABC". We're adding a **highlight lens**: an OR-union of course/teacher/student criteria that keeps matching placed chips vivid and dims the rest, preserving the spatial context that makes the answer meaningful (unlike filter/hide).

## Starting Point

All three lens kinds run on data already in browser memory (`teacherKeys`/`studentKeys` power the conflict constraints; "subject = course" matches on `courseId`) — no schema change, no new fetch. The board already has the exact templates: independent opacity/ring visual axes (`dimmed`, `justDuplicated`), a derivation pipeline (`toCohortState` → `CellWiring` spread), and the Command/Popover selector idiom. The architecture is normatively pinned by `ui-conventions.md`'s worked example: derived `Set` in `model/`, threaded via the wiring spread — no Context, no store.

## Desired End State

A plan author clicks the search-lookalike trigger (or ⌘K), checks a few courses and a teacher in a grouped multi-select picker — watching the board respond live, even while arrowing — then closes it and keeps an active-lens bar showing each criterion with its match count, a union total, `×`-remove and Clear all. The lens survives DP1/DP2/Combined switches and reloads within the tab, and a second Esc clears it.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Interaction model | Persistent dim-the-rest + ring on matches | Hiding destroys the spatial context comparative discovery needs | Research |
| Subject definition | Subject = course (`courseId` match) | Cheapest of all options; matches what planners see on chips | Research |
| Combination semantics | OR-union multi-select from v1 | "All math HL" is only expressible as a union; no AND anywhere | Research |
| Scope | Board-only (no shelf/palette) | Keeps v1 inside the wiring path; count reads as placed chips | Research |
| Entry + picker | Fake-input trigger + ⌘K, anchored popover, live preview | Self-teaching trigger; popover keeps the board visible for preview | Research |
| Architecture | `deriveLensMatches` Set via derivation pipeline + wiring spread | Convention's worked-example verdict — no Context, no store | Research |
| Persistence | sessionStorage, plan-keyed, post-mount rehydrate | Survives focus-switch remounts without URL codec or CohortSwitcher changes | Plan |
| Combined view | One lens across all visible columns; picker lists visible cohorts; off-screen criteria show `·0` | Shell-level state; the "teacher's week" question answers itself | Plan |
| Lens × drag | Compose naturally (axes stack) | The lens should keep guiding while the user fixes what it revealed | Plan |
| A11y | Ring + counts + ARIA controls + one polite live region | Non-chromatic signals for low-vision; aggregate story for SR users | Plan |
| Testing | Full unit coverage + one role-based e2e spec | Pins the trigger→picker→bar contract without asserting coloring | Plan |
| Visual restraint | Zero new hues — token ring + opacity only | Keeps the monochrome design readable; collision reds/ambers stay visible when dimmed | Plan |

## Scope

**In scope:** pure lens model + derivation memo + wiring threading + chip visuals; trigger, ⌘K, grouped multi-select picker with live preview; Esc layering; active-lens bar with per-criterion counts, zero-match message, aria-live status; plan-keyed sessionStorage bridge with stale-criteria pruning; unit suite + one e2e spec.

**Out of scope:** URL `?lens=` sync / shareable links; chip-anchored "highlight all like this" (first fast-follow); shelf/palette highlighting; AND mode; per-criterion ring colors; localStorage or any new `lib/` micro-store; store/seam consolidation (deferred until after this lens per the archived state-store change); schema changes.

## Architecture / Approach

`useLens` (shell) holds the criteria list → `useCombinedBoardState(..., lensCriteria)` → per-cohort `useLensMatches` memo over pure `deriveLensMatches(placements, catalogById, criteria)` → `toCohortState.lensMatches` → `buildColumn` puts `lensMatched: Set | null` on `CellWiring` → spread to `SlotCell` → `ChipWiring` → `PlacedChip` resolves its own membership (ring matched, `opacity-40` the rest). The picker/bar read the same shell state; counts aggregate across visible cohorts in pure `combineLensCounts`. Nothing touches the constraint engine, persistence path, or history.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Lens Engine | Pure model + full threading + chip visuals (dark until criteria exist) | State-shape churn in `use-cohort-board-state` tests |
| 2. Trigger + Picker | Usable lens: trigger, ⌘K, grouped picker, live preview, Esc layering | Esc-clear fighting Radix overlay Esc handling |
| 3. Active-Lens Bar | Criteria visibility, per-criterion + total counts, a11y live region | Count aggregation across cohorts on combined view |
| 4. Persistence + E2E | sessionStorage bridge + one role-based e2e spec | Hydration-safe rehydrate; e2e board seeding cost |

**Prerequisites:** none beyond the standard local stack (Supabase + `pnpm env:local`) for tests; all data already reaches the client.
**Estimated effort:** ~2–3 sessions across 4 phases; ~6–7 wiring-file touches + ~8 new files.

## Open Risks & Assumptions

- Esc layering against Radix overlays is empirically fiddly — guarded design in the plan, verified manually per overlay in Phase 2.
- cmdk item identity vs. label search with duplicate names across cohorts — contract specified; implementer verifies filtering feel.
- Assumption: opacity-stacked worst case during drag (dim × recede) is acceptable — accepted explicitly, revisit only if manual check fails.

## Success Criteria (Summary)

- A packed board answers "where is X / teacher Y / student Z (or any union)" in two interactions, without losing grid context.
- Criteria stay visible and editable after the picker closes; the lens survives focus switches and reloads within the tab.
- Full local gate + one e2e spec green; matched/dimmed board remains readable on the monochrome design in both themes.
