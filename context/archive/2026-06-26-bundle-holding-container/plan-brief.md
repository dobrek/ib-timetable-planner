# S-07 Bundle Holding Container ("Shelf") — Plan Brief

> Full plan: `context/changes/bundle-holding-container/plan.md`
> Research: `context/changes/bundle-holding-container/research.md`

## What & Why

Give a plan author a **server-durable, per-cohort holding container** ("shelf"): a place to park a placed bundle off the board and drag it back onto a slot later. Authors need to set a grouping aside while they work the rest of the grid without losing it — and it must survive a browser refresh (a Secondary Success Criterion in the PRD). Today there is nowhere for an off-board bundle's contents to live, so the feature can't exist without new storage.

## Starting Point

S-05 made the bundle *row* first-class but left its *membership* derived from the placements co-located at its cell — and placements can never be slot-less. So a bundle taken off the board has nothing to reconstruct its course set from. The board is already fully cohort-parameterized, the drag layer is a clean `switch (data.kind)` dispatch, and the write path is a hook (`usePlacements`) owning optimistic state over pure transition helpers. There is no `shelf_*` or `bundle_members` table anywhere yet.

## Desired End State

An author lifts a bundle off the board (a button on the bundle, or a drag to the right edge); it appears as a neutral card in a collapsible right-edge drawer, with a persistent `N parked` badge in the summary bar. The card survives a page reload. Dragging it back onto any slot places its courses there (merging into an existing bundle if one is present), and validation re-runs on the drop. Each cohort shows only its own parked bundles.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Off-board storage model | Two new tables (`shelf_bundles` + `shelf_bundle_courses`), not a `holding` state on the `bundles` row | Two clean entities beat one row living a double life; place-back reuses `place_course` and the merge-identity wrinkle disappears | Research |
| Shelf membership table shape | Relational header + child (composite-FK to `courses`, mirrors `course_teachers`) | FK integrity, trivial `clone_plan` remap, matches every other child table | Plan |
| Identity across park boundary | Fresh `bundles` id on place-back (not preserved) | Safe because S-08 undo will be snapshot/command-based, never id-reference | Research |
| Drawer placement | Collapsible right-edge 3rd grid column, reflow-once-on-expand, non-modal | Mirrors the left palette, generalizes to S-06 as one shared drawer; non-modal keeps every cell a reachable drop target | Research + Plan |
| Lift affordance | Both — button on the bundle + optional drag-to-edge | Button is discoverable + zero-drag; drag serves power users | Plan |
| Place-back onto occupied cell | Allow merge (drop onto any cell) | Reuses `place_course` find-or-create; accept-and-flag handles conflicts; fully snapshot-reversible | Plan |
| Empty / bulk semantics | Auto-delete at zero; no "clear shelf" this slice | Consistent with the existing `==0` bundle-delete rule; smallest scope | Plan |
| Drawer open/close | Auto-collapse after each action + optional pin (guarded localStorage) | Footprint ≈ 0 by default; pin serves bulk rearranging | Plan |
| E2E coverage | One durability happy-path spec (lift → reload → place-back) | Nails the headline refresh-durability criterion; full drag E2E is flaky and partly deferred | Plan |

## Scope

**In scope:** two shelf tables; `shelve_bundle` / `unshelve_bundle` RPCs; `clone_plan` revision; the `load.ts` parked read + board prop; actions + client wrappers; a `ParkedBundle` model + pure transitions + two `usePlacements` verbs; the drawer UI, lift button, parked card, summary badge, drag preview, and pin persistence; unit + integration + one E2E spec.

**Out of scope:** reusing the `bundles.status='holding'` path; nullable-`placements` rework; preserving bundle identity across park; "clear shelf" / "place all back" bulk actions; S-06 (two-cohort view) and S-08 (undo) themselves; any constraint-core change; full drag-drop E2E.

## Architecture / Approach

Bottom-up and additive. A parked bundle is a separate entity: **park** copies the cell's courses+weeks into the shelf tables, then deletes the placements and the now-empty `bundles` row (one atomic `security invoker` RPC); **place-back** loops the shelf courses through the existing `place_course` find-or-create and drops the shelf row (one atomic RPC). The board write path, constraint core, and <200 ms budget are untouched — a parked bundle has no placements, so it never participates in validation. On the client, the shelf is a new drag-target kind (never a `CellData` overload); `usePlacements` extends to own the parked store so park/place-back updates both stores atomically and rolls both back on failure.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Supabase layer | Two tables + `shelve`/`unshelve` RPCs + `clone_plan` revision, behind an integration round-trip | Park ordering (copy before delete); honoring the `==0` bundle-delete invariant |
| 2. Transport & load | Actions + Zod + client wrappers + `load.ts` parked read + board prop | Keeping the read cohort-scoped; no UI yet to validate against |
| 3. Model | `ParkedBundle` type, pure `shelf-transitions`, two `usePlacements` verbs | Two-store atomic optimistic update + rollback correctness |
| 4. UI | Drawer, lift button, parked card, drag-back wiring, badge, preview, pin, E2E | Non-modal reflow (once, on expand); drag-drop wiring + flake surface |

**Prerequisites:** local Supabase running (Docker) for `db reset` + integration tests; the S-05 bundle stack (already in `main`).
**Estimated effort:** ~3–4 sessions across the 4 phases (Phase 1 and Phase 4 are the heaviest).

## Open Risks & Assumptions

- Assumes S-08 undo will indeed be snapshot/command-based — the plan mints fresh ids on place-back on that basis. (Research argues this is safe and revises the S-05 "stable id for undo" guidance.)
- The two-store optimistic path (board + parked) is the trickiest correctness surface; mitigated by pure, unit-tested transition helpers and keeping both stores in one hook.
- Drag-drop E2E can be flaky; scoped to a single durability happy-path to limit exposure.
- Generated `Database` types must be regenerated after Phase 1 or downstream phases won't compile.

## Success Criteria (Summary)

- An author can lift a bundle off the board and it appears parked; it survives a page reload.
- Dragging a parked card back onto a slot places its courses (merging when the target is occupied), with validation re-run on drop.
- Each cohort sees only its own parked bundles, and a cloned plan carries its shelf — with the constraint core and <200 ms budget unchanged.
