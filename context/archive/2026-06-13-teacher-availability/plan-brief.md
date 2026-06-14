# Teacher Availability — Plan Brief

> Full plan: `context/changes/teacher-availability/plan.md`
> Research: `context/changes/teacher-availability/research.md`

## What & Why

Add **teacher availability** (the planned S-03 follow-up): let a plan author mark, per teacher, which `(day, period)` cells a teacher **cannot** teach (**strong NO**) or **prefers not to** teach (**soft NO**), with live validation feedback on the board. Strong NO enforces real scheduling constraints; soft NO surfaces preferences without blocking the plan.

## Starting Point

No availability data or feature code exists, but the architecture was built to anticipate it: `BoardContext` literally names "teacher availability" as its intended additive extension (`constraints/types.ts:12-16`), `slot_bundles` is a near-exact persistence template, and the composite teacher FK target already exists. The whole validation core, however, is **binary** today — there is no severity/`warn` concept anywhere, and the board runs accept-and-flag (drops always land, violations are flagged).

## Desired End State

A teacher's **Edit availability** dialog shows a tri-state day×period grid (available → soft → strong, click-cycling, with whole-day bulk via the column header); edits persist optimistically and survive reload and clone. On the board, a **strong-unavailable** placement flags the cell invalid with the destructive ring + a distinguished "unavailable" badge (the drop still lands); a **soft-unavailable** placement shows an amber ring/chip/badge that is inspectable but never blocks. Dragging lights cells `blocked` (strong) or `warn` (soft) for the dragged course's teacher — all within the <200ms budget.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Strong-NO semantics | Flag-as-invalid, drop lands | Faithful to "like a collision we have now"; reuses the existing flow, no new drop-rejection machinery | Plan |
| Severity model | Tri-state (one severity per cell) | Simplest schema/UI; strong already supersedes soft, so no fidelity lost | Plan |
| Cohort handling | **Cohort-independent (no cohort column)** | Availability is a property of the teacher's real-world schedule on the shared grid; "just works" when dp2 loads, zero schema change | Plan |
| Soft-NO surfacing | Cell + chip cue + dialog section | Consistent with how collisions surface; smallest new surface, discoverable via the existing inspect flow | Plan |
| Drag-time hints | Color hints for both tiers (shared one-time wiring) | Guides placement before dropping; both tiers need the same `BoardContext` rewiring of `deriveDropHints`, so do it once | Plan |
| Authoring persistence | Optimistic per-cell (copy `useSlotBundles`) | Closest fit for a toggle grid + bulk select; proven pattern with rollback | Plan |
| Grid interaction | Click-cycle per cell + clickable day header | Fast, no mode state; header click maps to whole-day bulk | Plan |
| Delivery | One change, phased internally | Severity model designed once up front → no rework when soft lands | Plan |

> Refinement vs. research: the research proposed copying `slot_bundles` verbatim **with** a `cohort` column. The cohort-independent decision **drops that column** — availability is authored once per teacher and the cohort-agnostic constraint logic applies it to whatever cohort the board renders.

## Scope

**In scope:** plan-scoped `teacher_availability` table (+ enum, clone, types, empty seed); FSD promotion of grid/label helpers to `shared/`; per-teacher authoring dialog with optimistic writes; a clickable teacher-row indicator badge (who has constraints, opens the dialog); strong-NO board-only constraint (flag-as-invalid + distinguished badge); soft-NO `warn` tier (new `warning` token, aggregation split, `warn` drop hint, amber render); drag-time hints for both tiers.

**Out of scope:** a `cohort` column / per-cohort availability; dp2 authoring/validation surface; cross-cohort occupancy (separate S-09); physical drop rejection; a plan-level soft-warning roll-up panel; both severities coexisting on one cell; availability in grouping enumeration; a seed fixture.

## Architecture / Approach

Two **storage vocabularies** stay separate: `strong`/`soft` at the DB+authoring edge; `block`/`warn` in the validation+render core (mapped where the board constraint reads availability). The strong-NO constraint is **board-only** (omits `test?`), so it is structurally excluded from the <200ms enumeration path. The soft-NO `warn` tier is the cross-cutting work: it threads severity through the violation union → `CellCollisions` (split `blockingIds`/`warningIds`) → `classifyCell`/`DropHint` → `SlotCell`/`HINT_CLASS` → the exhaustive details dialog. The drag-hint `BoardContext` rewiring of `deriveDropHints` is the shared seam both tiers need.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Foundations | Migration + enum + clone + types + empty seed; `--warning` token; FSD promotion of grid/label helpers (5 imports repointed) | Two unrelated workstreams in one phase; clone remap ordering |
| 2. Authoring UI | Teacher availability dialog (tri-state grid + bulk), optimistic hook/client/transitions/actions, loader | Adapting the binary `slot_bundles` pattern to tri-state (upsert overwrites severity) |
| 3. Strong-NO validation + render | Board-only constraint, new union kind, distinguished badge, shared drag-hint rewiring | First consumer of `BoardContext`; drag-hint precedence; staying under 200ms |
| 4. Soft-NO severity tier | block/warn aggregation split, `warn` drop hint, amber render, dialog section (token from Phase 1) | Cross-cutting binary→severity change; test churn on the union/aggregation invariants |

**Prerequisites:** none beyond the current `main` (composite teacher FK already exists). Phases 2/3 need Phase 1; Phase 4 needs Phase 3.
**Estimated effort:** ~4 sessions, one per phase (Phase 4 is the heaviest).

## Open Risks & Assumptions

- The binary→severity change touches several pinned invariant tests (`collisions.test.ts` union invariant, `constraints.test.ts`/`drop-hints.test.ts` `toEqual`s) — expected churn, but the rewrites must preserve intent, not just pass.
- Drag-hint precedence (`blocked > partial > warn > free`) must keep soft NO from ever masking a real block.
- Assumes the plan's grid preset is available (or cheaply surfaced) to size the authoring grid to actual slots, not the absolute `GRID_BOUNDS` max.
- The `warning` token lands in Phase 1 (behavior-neutral foundation), so both the Phase 2 authoring dialog and the Phase 4 board render consume one amber source — no neutral-soft placeholder.

## Success Criteria (Summary)

- An author can set/clear/bulk a teacher's availability; it persists, reloads, and clones.
- A strong-unavailable placement flags the cell/plan invalid (drop still lands) and is distinguishable from a 2-course collision.
- A soft-unavailable placement shows amber, never blocks, and is inspectable; drag hints reflect both tiers — all under the 200ms budget, with enumeration provably availability-free.
