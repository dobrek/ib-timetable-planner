# First-Class Bundle Operations (S-05) — Plan Brief

> Full plan: `context/changes/first-class-bundle-operations/plan.md`
> Research: `context/changes/first-class-bundle-operations/research.md`

## What & Why

Today a "bundle" is *derived* — ≥2 placements that happen to share a `(day, period)` cell, with a `slot_bundles` table storing inverted "this cell is ungrouped" opt-out markers. The cell coordinate *is* the identity. That works on-board but cannot represent an **off-board** unit, which blocks S-07 (the holding container, where a parked bundle holds no slot). This slice gives a bundle a **persistent identity** so move/remove/merge become atomic and identity-bearing, and S-07/S-08 become additive rather than schema rewrites.

## Starting Point

No `Bundle` type and no `bundle_id` exist. Whole-slot move is delete+recreate, best-effort, with no transaction and no fit-check (`use-placements.ts:207`). Two parallel write paths (single-course vs. group) run over pure transitions, and ungroup state is persisted via `useSlotBundles`. Validation is pure, client-side, accept-and-flag, and grouping-agnostic — so the constraint core and <200ms budget are not at risk here.

## Desired End State

Every placement belongs to exactly one `bundles` row (`bundle_id NOT NULL`); a cell with any courses *is* a bundle (including a bundle of one). One transactional member-set primitive powers single-course move, whole-bundle move, merge, and remove. Moving into an empty cell preserves identity; dropping onto an occupied cell merges. "Ungroup" is a pure in-session view toggle (no persistence). `slot_bundles` is gone. `bundles` already carries `status` + nullable coords so S-07 parking needs no schema change.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Bundle identity | "Everything is a bundle" — `bundle_id NOT NULL`, delete `slot_bundles` | Collapses two code paths into one primitive; clean `==0` cleanup; uniform S-07 park, simpler S-08 undo | Research |
| Replace operation | **Cut from scope** — drop-onto-occupied *merges*, no swap | Author decision; merge covers the needed behaviour, de-risks the core identity change | Plan |
| Ungroup persistence | Ephemeral in-session UI state | Simplest; bundled is the point of the change; reload-safe (no board op refetches) | Plan |
| Occupied-cell move | Merge (movers join destination, source bundle deleted), accept-and-flag | Consistent with every op + the no-flicker invariant; matches today's behaviour | Plan |
| Persistence transport | Transactional security-invoker RPCs | Atomic — closes the best-effort/no-rollback gap; single round-trip keeps the budget | Plan |
| S-07 shaping | Add `status` + nullable `(day,period)` + partial-unique index now | Makes S-07 purely additive; the partial index is what makes find-or-create clean | Plan |
| Test coverage | Unit + integration + **full E2E**, refactored to dedup | Author wants full browser coverage and a chance to remove board-spec duplication | Plan |

## Scope

**In scope:** persistent `bundles` entity + `bundle_id`; transactional `place_course` / `move_bundle_members` / `remove_bundle_members` RPCs; one unified member-set write primitive; ephemeral ungroup; `clone_plan` bundle remap; retiring `slot_bundles`; full unit/integration/E2E coverage.

**Out of scope:** replace operation; S-07 parking behaviour; S-08 undo/redo; any constraint-core change; new gating; cross-cohort bundle moves; preserving legacy `slot_bundles` ungroup state.

## Architecture / Approach

Additive-first, destructive-drop-last (per the S-02/S-03 archives). Schema lands nullable → backfilled → `NOT NULL`; then security-invoker RPCs own identity and the `==0` cleanup atomically; then the persistence/model layer folds to one member-set primitive (preserving the single-`setPlacements`-pass no-flicker invariant); then the UI makes ungroup presentation-only; then `slot_bundles` is dropped. The unified primitive: *move member-set M from cell A to cell B; create B's bundle if absent; delete A's if emptied* — single move, whole-bundle move, merge, and single place are all instances of it.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema & data foundation | `bundles` table + `bundle_id` (backfilled, `NOT NULL`), `clone_plan` remap, regenerated types | Backfill correctness; nullable→NOT NULL ordering |
| 2. Transactional bundle RPCs | `place_course` / `move_bundle_members` / `remove_bundle_members` | Getting the `==0` cleanup and merge/duplicate-mover rules right atomically |
| 3. Persistence + unified model | Bundle-aware clients, one member-set primitive, load.ts loads bundles | Preserving the no-flicker single-pass invariant while folding two paths |
| 4. UI & ungroup-as-presentation | Ephemeral exploded-view state, merge legibility, FR-010 unchanged | FR-010 interaction must not regress byte-for-byte |
| 5. Retire `slot_bundles` & E2E | Drop the table; full E2E + dedup refactor | E2E refactor surface; ensuring no `slot_bundles` reference remains |

**Prerequisites:** none — independent of the constraint-core chain (different files); runs parallel to S-02→S-04. Needs local Supabase for integration/E2E.
**Estimated effort:** ~4–5 sessions across 5 phases (schema + RPCs are 2 focused sessions; the model/UI fold + E2E refactor are the bulk).

## Open Risks & Assumptions

- Assumes **no production data**, so discarding legacy `slot_bundles` ungroup state on migration is acceptable (per README rollback note).
- The unified member-set fold touches the hot write path; the single-`setPlacements`-pass no-flicker invariant must be preserved or move/merge will flicker a transient collision.
- Identity is **not** preserved across an occupied-cell move (source bundle deleted on merge) — a note carried forward for S-08 undo.
- Ephemeral ungroup relies on the verified fact that no board op triggers a reload/refetch; introducing `refreshPage()`/`reload()` into the editing loop would silently break it.

## Success Criteria (Summary)

- Place / single-move / whole-bundle move / merge / remove / ungroup all work in the UI, persist correctly, and survive a manual reload (returning to the grouped default).
- `clone_plan` preserves bundles; no orphan `bundles` rows after a merge; `slot_bundles` fully retired.
- Full local CI gate green (`/verify`) plus `pnpm test:integration` and `pnpm test:e2e`, with the E2E board suite refactored to share helpers and the <200ms drag budget visually intact.
