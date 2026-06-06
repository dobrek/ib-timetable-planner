# First Valid Drop with Validation (S-01) — Plan Brief

> Full plan: `context/changes/first-valid-drop-with-validation/plan.md`
> Research: `context/changes/first-valid-drop-with-validation/research.md`

## What & Why

Build the planner's first interactive UI — the northstar slice. The author filters pre-seeded Year-1 groupings by a leading course, pulls individual courses out of a grouping "hint box" onto a 10×5 slot grid, and gets an immediate, reactive student-collision verdict plus a read-only hours counter, with placements persisted. This is the moment the PRD's core hypothesis stands or falls: that the online validator delivers feedback inside ≤200 ms in the workerd runtime and the "feel of the puzzle" holds.

## Starting Point

The grouping/collision core (`hasIntersection`), the schema (`placements`, `course_groupings`), and the compute+persist endpoint (`POST /api/grouping`) all exist. No interactive UI exists yet, and the seed has the cohort/plan/variant/catalog but **no groupings or placements**.

## Desired End State

`/plans/<id>` renders the palette + 10×5 grid. An empty-state button bootstraps groupings when none exist. The author filters groupings by a leading course, expands a grouping box, and drags individual courses onto cells (one course-hour per drop); placed courses move cell-to-cell. Colliding cells outline and badge the conflicting chips with the named "student collision" class, clearing reactively when a participant moves. Each course shows placed/required hours. Everything persists across reloads.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| DnD library | `@dnd-kit/react` 0.4.0 (pinned) | Supported React-19 line; legacy `@dnd-kit/core` is debt on a fresh UI | Research |
| Drop UX | Accept-and-flag | Preserves the puzzle feel; resolve by moving any participant | Research |
| Collision scope | Per-cell, whatever `hasIntersection` detects within the cohort (shared students or teacher), one generic "collision" label | Reusing the primitive verbatim is simplest and still proves the budget; dedicated teacher class/UX is S-03, cross-cohort is S-09 | Research + Plan |
| Unit of placement | Course-hour (one row); grouping = expandable hint box, pull courses individually (no bulk-drop) | Course is the unit; cells multi-occupancy | Research + Plan |
| Palette filter | Filter groupings by a leading course (membership, no backend change) | Author scopes the palette to what they're scheduling | Plan |
| Grouping seeding | Empty-state "Compute groupings" button reusing `/api/grouping` + reload | Self-contained, reproducible via `db reset`, no seed-generator coupling | Plan |
| Placements persistence | Per-row REST, optimistic | Keeps the drop feel client-side; simplest row mapping | Plan |
| Route | `/plans/[id].astro` dynamic | Real shape S-07 builds on; no throwaway | Plan |
| Keyboard a11y | Deferred, data model kept ready | Keeps the northstar focused; PRD allows drag-only MVP | Plan |
| Collision surfacing | Cell highlight + per-course badges + named class | Attributes which courses conflict | Plan |
| Grid size | 10 periods × 5 days (preset `5x10`) | Author's call | Plan |
| Testing | Vitest on pure logic; manual UI | Locks the validator without brittle DnD-sim tests | Plan |

## Scope

**In scope:** planner route + data load, empty-state grouping bootstrap, `/api/placements` (create/move/remove), drag-and-drop board (filterable palette of expandable grouping boxes + 10×5 grid + chips, pull individual courses), reactive student-collision flags, read-only hours counter, persistence, unit tests for pure logic.

**Out of scope:** teacher/cross-cohort collisions (S-03/S-09), completeness enforcement / finalize gate (Q9), full compute-groupings UI (S-06), keyboard a11y (Q11), multi-variant (S-07), bespoke grids, replace-style RPC, whole-group bulk-drop, true seed-course filter.

## Architecture / Approach

Reads happen in Astro frontmatter (`/plans/[id].astro`) and flow as props into one `PlannerBoard` island (`client:load`). The island owns placement state locally, persists optimistically through `/api/placements`, and derives collision + hours state as pure functions over that state (reactive — no captured verdict). The Supabase client stays server-only; all writes route through API endpoints.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Foundations | `@dnd-kit/react` pinned + `/api/placements` (create/move/remove) | Unique-constraint handling; optimistic-id reconcile |
| 2. Route + bootstrap | `/plans/[id].astro` data load + empty-state compute button + `5x10` seed | Plan→cohort mapping for the compute call |
| 3. DnD interaction | Filterable palette of expandable grouping boxes + 10×5 grid + pull-individual-course drop + optimistic persist | dnd-kit 0.x API; stale-closure footgun in `onDragEnd` |
| 4. Validation + UX | Reactive per-cell collision flags + hours counter + cell/badge UX | Reactive auto-clear correctness; multi-occupancy attribution |

**Prerequisites:** F-01/F-02/F-03 (done — schema, grouping engine, endpoint); authenticated session; local Supabase stack for manual checks.
**Estimated effort:** ~2–4 sessions across 4 phases.

## Open Risks & Assumptions

- dnd-kit `@dnd-kit/react` is pre-1.0; mitigated by a tiny API surface + pinned version. Fallback is Pragmatic DnD.
- The stale-closure-over-placement-state footgun in the drop handler must be avoided (read current state via ref/state, not a memoized snapshot).
- Assumes one seeded variant; multi-variant addressing is S-07.

## Success Criteria (Summary)

- A colliding drop lands and flags within the ≤200 ms feel; clears reactively when a participant moves.
- Placements survive a reload.
- `pnpm test` covers the collision derivation, hours counter, and payload validation; `pnpm lint`/`build` pass.
