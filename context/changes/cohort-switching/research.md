---
date: 2026-06-22T20:59:20+0200
researcher: Dobromir Kropielnicki
git_commit: 2aa1be7243c03fbc35c2df1f8ed4f50d5eb6f62a
branch: feat/cohort-switching
repository: 10xdev3
topic: "Feasibility of S-04 (two-cohort board + cross-cohort occupancy), kept forward-compatible with S-06"
tags: [research, codebase, plan-detail, constraint-core, cross-cohort, cohort-switching]
status: complete
last_updated: 2026-06-22
last_updated_by: Dobromir Kropielnicki
---

# Research: Feasibility of S-04, kept forward-compatible with S-06

**Date**: 2026-06-22T20:59:20+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 2aa1be7243c03fbc35c2df1f8ed4f50d5eb6f62a
**Branch**: feat/cohort-switching
**Repository**: 10xdev3

## Research Question

Check the feasibility of implementing the **S-04** roadmap task (`two-cohort-board-cross-cohort`: free cohort switching + symmetric, week-aware cross-cohort teacher occupancy), keeping in mind that we eventually aim to deliver **S-06** (`combined-two-cohort-view`, the north star). S-04 must not introduce anything that blocks S-06 or makes it complex. Assess the impact on **the model, the UI, and the validation logic**.

## Summary

**S-04 is highly feasible and largely an "unlock + add one constraint" slice — not a rewrite.** The codebase was deliberately staged for it by S-02 and S-03: the data model is already two-cohort-complete, the constraint core has explicit additive seams that *name cross-cohort occupancy as the next field*, and the week primitive S-04 needs (`weeksDisjoint`) was extracted as a reusable export specifically "because S-04's cross-cohort check reuses it." There are even six `it.todo` cross-cohort parity guards already authored as the acceptance spec.

Impact by area:

- **Model / data:** **zero schema change.** Placements already carry `cohort` as a first-class column with a cohort-scoped uniqueness key; the write path (actions, hooks, Zod schema) threads `Cohort` end-to-end. The only model gap is a new derived index (teacher → occupied `{cellKey, week}` in the *other* cohort) projected into the validation context.
- **UI:** **low effort.** The single thing pinning the board to DP1 is the literal `BOARD_COHORT = "dp1"` constant in `load.ts` plus the absence of a cohort signal in the route. Cohort config (`COHORTS`, labels, Zod enum) is already switcher-ready. Cleanest switch = navigate to a cohort-scoped URL so the island remounts (no hook re-sync needed).
- **Validation:** the one genuinely new piece. Today every constraint is cohort-scoped within a single cell; the validator never sees the other cohort. S-04 adds a **board-only, symmetric, week-aware** cross-cohort teacher constraint that plugs into `BoardContext` exactly like `teacher-availability` does (no `test` fast-path, additive field, new violation `kind`).

**The single decision that governs S-06 forward-compatibility** is S-04's documented open unknown: *eager-load-both-cohorts vs fetch-other-cohort-on-demand*. Choosing **eager + symmetric + cohort-agnostic context** makes S-06 a pure assembly/render slice (reuse, not rewrite). The traps that would block S-06 are all variants of "couple validation to a single active cohort" — avoidable and called out below.

## Detailed Findings

### Area 1 — Validation / constraint core (the protected hot path)

**Two validation surfaces**, both pure and recomputed via `useMemo` on every state change (validation is advisory/visual; nothing currently *blocks* a drop on collision):

- Committed-placement validation: `deriveCellViolations(placements, catalogById, availability)` — `src/_pages/plan-detail/model/collisions.ts:42-70`, consumed at `PlannerBoard.tsx:196-199`.
- Drag what-if: `deriveDropHints` — `src/_pages/plan-detail/model/drop-hints.ts:93-131`, consumed at `PlannerBoard.tsx:205-224`.

**The `BoardContext`** (the roadmap's "BoardContext") is `constraints/types.ts:20-30` and its header comment is the literal S-04 seam:

> *"board-only constraints (cross-cohort occupancy, teacher availability) add optional fields here additively, without touching existing evaluators."* — `constraints/types.ts:14-19`

**Two-tier budget.** The combinatorial/drag path uses a short-circuiting `test()` fast path (`violatesAny`, `constraints/index.ts:24-25`); **board-only constraints omit `test`** and never enter it (`types.ts:37-39`) — this is how `teacher-availability` stays off the hot combinatorial path, and is the template for the cross-cohort rule. The enumerating `explain` path runs only on committed cells, O(occupants²) over tiny N.

**Registered constraints** (`constraints/index.ts:9-14`): `duplicateCourse`, `teacherConflict`, `studentConflict`, `teacherAvailability`.

| Constraint | File | Scope | Cohort awareness today |
| --- | --- | --- | --- |
| duplicate-course | `duplicate-course.ts` | within cell | cohort-scoped |
| teacher-conflict | `teacher-conflict.ts:17-48` | within cell, multi-course, week-aware | **cohort-scoped** (sees only this cell's occupants) |
| student-conflict | `student-conflict.ts:11-27` | within cell, pairwise, week-aware | cohort-scoped (students are single-cohort anyway) |
| teacher-availability | `teacher-availability.ts:17-36` | board-only, single occupant | **cohort-independent already** |

**Teacher = symmetric set (post S-02).** `GroupingCourse.teacherKeys: string[]` (`shared/lib/catalog-hash/types.ts:10-17`); `teacherKey === DB teacher_id`. No lead/primary role — nothing asymmetric to undo.

**Week dimension (post S-03).** Week lives on the placement (`PlannerPlacement.week: "a" | "b" | "both"`, `placement.ts:4-11`). The unified collision rule is `weeksDisjoint` (`week.ts:19`): `a !== "both" && b !== "both" && a !== b`. Collide iff *share student/teacher AND NOT weeksDisjoint*. The primitive was kept a named export on purpose:

> *"Kept a named export here — not inlined into `teacher-conflict.explain` — because S-04's cross-cohort occupancy check reuses it."* — `week.ts:5-9`

**The gap S-04 fills:** `teacherConflict.explain` only sees the occupants of *one* cell within *one* cohort (`collisions.ts:50-53`). The same teacher placed in the other cohort's same slot is invisible. `cellKey = "${day}:${period}"` (`collisions.ts:9`) — cohort-free.

**Where the cross-cohort signal plugs in (the five seams):**
1. **Data:** widen `load.ts` to also load the sibling cohort's placements.
2. **Index:** build `Map<teacherKey, Map<cellKey, PlacementWeek>>` for the other cohort (analogous to `availability-index.ts`).
3. **Context:** add one optional field to `BoardContext` (`types.ts:20-30`) — additive, per its own contract.
4. **Constraint:** new file in `constraints/`, registered in `index.ts:9-14`, **board-only (omit `test`)**, reusing `weeksDisjoint`, emitting a new violation `kind`.
5. **Drag hints:** mirror into `drop-hints.ts` `classifyCell` (`:156-176`) the way availability is wired (`:167-171`), since board-only rules are invisible to `violatesAny`.

**Pre-authored acceptance spec:** `collision-parity.test.ts:240-250` already holds six `it.todo` cross-cohort guards (symmetric same-week blocks both directions; opposite-week accepted; `both` overlaps every week; different-slot no collision; param-off regression; availability orthogonal) plus an S-06 combined-view todo.

### Area 2 — Board loading & cohort UI

**The hardcode** is a single module constant: `const BOARD_COHORT: Cohort = "dp1"` — `src/_pages/plan-detail/api/load.ts:14-15`, with the comment *"The second cohort (dp2) arrives with S-04."* It scopes four of five loads (`load.ts:53-58`): groupings, placements, slot_bundles, and the validation catalog. **Availability is deliberately NOT cohort-filtered** (`load.ts:56-57`, *"it just works for dp2 later"*). The chosen cohort is baked into returned props at `load.ts:99` (`cohort: BOARD_COHORT`).

**No cohort switcher exists anywhere.** Cohort is a static SSR prop threaded into the island (`PlannerBoard.tsx:36`), used only for the grid label, `usePlacements`/`useSlotBundles`, and the empty state. The route identifies the plan by `[id]` UUID path segment (`plans/[id]/index.astro:9`); **cohort is not in the URL at all** — a query param (`?cohort=dp2`) is the natural addition.

**Config is switcher-ready:** `src/shared/config/cohorts.ts` — `COHORT_VALUES = ["dp1","dp2"]` (`:15`), `COHORTS = [{dp1,"DP1"},{dp2,"DP2"}]` purpose-built for tabs/selects (`:17-20`), `cohortSchema = z.enum(...)` (`:23`).

**Persistence needs no change:** placements schema (`20260611180006_plans_as_domain_root.sql:95-99`) has `cohort cohort not null` with `unique (plan_id, cohort, day, period, course_id)` — dp1/dp2 place independently. `week` column added by `20260621130000_bi_weekly_week_columns.sql:21-22`. No `teacher` column on placements — teacher is reached via `course_id → course_teachers`. The whole write path (`placements.ts`, `placement-actions.ts`, `placement-client.ts`) already requires `cohort`.

**State hooks initialize-once from props** (`use-placements.ts:63`, no `useEffect` re-sync). Implication: switch via **navigation/remount** is cleanest; a client-side tab swap would need a `key={cohort}` reset or the placements state would not update on prop change (the main client-switch gotcha).

### Area 3 — S-06 forward constraints

**PRD requirements (quoted):**
- FR-005 free switching (`prd.md:271-278`): open either cohort, switch freely, no fixed start order.
- FR-006 cross-cohort occupancy (`prd.md:279-289`, `409-413`): teacher occupancy enforced **symmetrically** and **week-aware** across cohorts; *"replaces the never-implemented one-way 'Year 1 fixes Year 2' model with a symmetric one."* Availability stays week-agnostic + cohort-independent.
- FR-007/FR-008 (`prd.md:293-307`): combined DP1|DP2 side-by-side, editable per column, cross-column moves guarded.
- US-01 + Success Criterion 6 (`prd.md:151-153`): validate every placement against students, teachers **within and across cohorts**, week-aware, availability — **within sub-200ms while validating both cohorts at once.**

**The S-06-critical fact:** S-06 is *not* new validation logic — it is the **first time the existing validator runs against both cohorts' placements simultaneously** (`roadmap.md:157`). S-06's feasibility therefore rests entirely on S-04 authoring the cross-cohort rule as a function of *both cohorts' placements*, symmetric and cohort-agnostic — not bolted to a single active cohort.

**S-03 prepared the seam (archive quotes):** `2026-06-21-bi-weekly-week-aware-validation/research.md:324-348` + `plan.md:117-121` — week is first-class on the placement so "the two changes stay decoupled"; `weeksDisjoint` kept a named export for S-04; `BoardContext` additive with cross-cohort named in the doc comment; *"No speculative half-wiring"*; `SlotCell` kept cohort-unaware so it "drops unchanged into a DP1 or DP2 column later"; violation union kept additive for "a new cross-cohort violation kind." S-02 made the teacher model a symmetric set with no primary role.

## Architecture Insights

- **Progressive disclosure paid off.** Each enriching dimension (teacher-set, week, soon cross-cohort) was folded into the slice that made it user-visible, with the *next* slice's seam pre-named but not pre-wired. S-04 is the third pull on the same additive thread.
- **Board-only constraint pattern is the contract.** Cross-cohort teacher occupancy is structurally identical to `teacher-availability`: a single-occupant check against a pre-built index, no `test` fast-path, additive `BoardContext` field, mirrored into drop-hints. Following this pattern keeps the hot combinatorial path untouched and the <200ms budget intact.
- **Symmetry is what makes S-06 a reuse.** A symmetric rule has no "primary" cohort, so validating both columns at once is the same operation applied both ways — no directional asymmetry to generalize later.
- **Keep student/duplicate checks per-cohort; only the teacher check spans cohorts.** Students are single-cohort (`prd.md:412`); flattening both cohorts into one `(day,period)` bucket would wrongly flag a DP1 student vs a DP2 student. The cross-cohort teacher signal must arrive as a *separate context index*, not by merging placement lists.

## Code References

- `src/_pages/plan-detail/api/load.ts:14-15` — `BOARD_COHORT = "dp1"` hardcode (the one thing pinning the board).
- `src/_pages/plan-detail/api/load.ts:53-58` — cohort-scoped loads; availability deliberately unfiltered.
- `src/_pages/plan-detail/model/collisions.ts:9,42-70` — `deriveCellViolations`, cohort-free `cellKey`.
- `src/_pages/plan-detail/model/constraints/types.ts:14-30` — `BoardContext` + the comment naming cross-cohort as the next additive field.
- `src/_pages/plan-detail/model/constraints/index.ts:9-14,24-25` — registry + `violatesAny` fast path.
- `src/_pages/plan-detail/model/constraints/teacher-conflict.ts:17-48` — within-cell, week-aware teacher rule (cohort-scoped today).
- `src/_pages/plan-detail/model/constraints/teacher-availability.ts:17-36` — board-only constraint pattern to mirror.
- `src/_pages/plan-detail/model/week.ts:5-9,19` — `weeksDisjoint`, kept exported for S-04.
- `src/_pages/plan-detail/model/availability-index.ts:6-9,32-40` — index-building pattern for the new cross-cohort index.
- `src/_pages/plan-detail/model/collision-parity.test.ts:240-250` — six pre-authored `it.todo` cross-cohort guards (S-04 acceptance spec) + S-06 todo.
- `src/_pages/plan-detail/model/use-placements.ts:63,105` — init-once state; cohort baked into writes.
- `src/_pages/plan-detail/ui/PlannerBoard.tsx:36-57` — cohort consumed as static prop; no switcher.
- `src/pages/plans/[id]/index.astro:9` — plan by UUID; no cohort in route.
- `src/shared/config/cohorts.ts:15-25` — switcher-ready cohort config + Zod enum.
- `supabase/migrations/20260611180006_plans_as_domain_root.sql:95-99` — cohort-scoped placements schema + uniqueness key.
- `supabase/migrations/20260621130000_bi_weekly_week_columns.sql:21-22` — placement `week` column.

## Historical Context (from prior changes)

- `context/archive/2026-06-21-bi-weekly-week-aware-validation/research.md:324-348` + `plan.md:117-121` — S-03's explicit "Forward-compatibility with S-04" notes: first-class placement week, reusable `weeksDisjoint`, additive `BoardContext`, cohort-unaware `SlotCell`, additive violation union, no speculative half-wiring.
- `context/archive/2026-06-20-co-teaching-teacher-sets/research.md` — symmetric teacher set, no lead/primary role (the shape the cross-cohort rule consumes).
- `context/foundation/lessons.md` — relevant priors: "Port the mechanism, not the legacy type shape" (model on app domain types); "Astro Actions are the single transport"; "`astro check` is the mandatory type gate."

## Open Questions

1. **Eager-load-both vs fetch-other-cohort-on-demand** (roadmap S-04 unknown, `roadmap.md:128-129`). **DECIDED 2026-06-22 → eager-load-both** (symmetric + cohort-agnostic `BoardContext` index; see `change.md` Decisions). Rationale: per-drag validation stays an in-memory lookup (preserves <200ms — an on-demand round-trip in the drag loop cannot meet it), and S-06 becomes a reuse rather than a rewrite. Carry the index-shape watch-items (week-rich index, co-teacher expansion, server-side projection, remount switching) into `/10x-plan`.
2. **Switch mechanism — navigate/remount vs client tab.** Remount (cohort in URL query) requires no hook changes and matches the init-once state; a client tab needs a `key={cohort}` reset. Remount is the low-risk default for S-04; S-06's combined view sidesteps it by rendering both.
3. **Could S-04 be split** (cross-cohort constraint vs switcher UI)? Roadmap allows it (`roadmap.md:130`). The constraint is the correctness core; the switcher is a thin UI/route change — splittable if scope proves large.
4. **Drag-hint parity:** confirm the cross-cohort rule is mirrored into `drop-hints.ts` so what-if hints and committed validation agree (the parity harness at `collision-parity.test.ts` guards exactly this class of divergence).

## Traps that WOULD block/complicate S-06 (flag in `/10x-plan` and `/10x-plan-review`)

1. Coupling validation to a single "active cohort" (directional "active vs fetched other") → S-06 becomes a rewrite. Fix: symmetric, additive, cohort-agnostic index.
2. Flattening both cohorts into one `(day,period)` bucket → false-positive student collisions across cohorts. Fix: keep student/duplicate per-cohort; cross-cohort teacher arrives as separate context.
3. Switcher that tears down one cohort's context to load the other → S-06 (both at once) must undo it. Fix: load/hold both; switcher only picks focus.
4. Making `SlotCell`/the drop path globally cohort-aware → breaks S-06's two-column render. Fix: preserve S-03's cohort-unaware cell.
</content>
</invoke>
