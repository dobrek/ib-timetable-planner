---
date: 2026-06-21T16:54:04+0200
researcher: Dobromir Kropielnicki
git_commit: 2880de24f2afdb02ae06d221a962def885582d7d
branch: feat/bi-weekly-week-aware-validation
repository: dobrek/ib-timetable-planner
topic: "Bi-weekly (week A/B) course data — feasibility, impact, and UI/model/logic solutions"
tags: [research, codebase, bi-weekly, constraints, placements, plan-detail, validation, grouping]
status: complete
last_updated: 2026-06-21
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Revised to the hybrid model (course eligibility flag + per-placement week) with week-aware grouping enumeration scoped to v1 (opposite-week pairs)."
---

# Research: Bi-weekly (week A/B) week-aware validation

**Date**: 2026-06-21T16:54:04+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 2880de24f2afdb02ae06d221a962def885582d7d
**Branch**: feat/bi-weekly-week-aware-validation
**Repository**: dobrek/ib-timetable-planner

## Research Question

Check feasibility, impact, and possible solutions (UI / model / logic) for extending
course data so that — while **most courses are week-agnostic** — a **few courses can run
fortnightly (only week A or only week B)**. There are exactly **two week types (A, B)** for
the whole timetable (a fortnightly / bi-weekly cycle).

## Decisive design decisions (locked this session)

1. **Where the week lives → hybrid (course flag + per-placement week).**
   - The **course** carries an eligibility flag `weekMode ∈ { agnostic, biweekly }` — two
     states. This is intrinsic course data (a course that meets every week *cannot* be a
     single-week course) and, crucially, it is the **only** week signal the grouping
     enumerator can see (enumeration runs on the catalog, not on placements).
   - The **placement** carries the actual assignment `week ∈ { both, a, b }`. Invariant: an
     `agnostic` course's placements are always `both`; a `biweekly` course's placement
     resolves to `a` or `b`.
   - Both are needed: the **course flag drives what the palette *offers*** (surfacing
     bi-weekly sharing opportunities); the **placement week drives what the board
     *validates***.
2. **What the week does → relax conflicts, on two surfaces.**
   - **Board** (`explain()` path): two placements sharing a `(day, period)` slot with
     **disjoint weeks** (one `a`, one `b`) do **not** collide. A `both` placement runs every
     week, so it still collides with anything sharing its slot.
   - **Grouping palette** (enumeration): courses that normally conflict (shared teacher /
     student) but are **both bi-weekly** are surfaced as a placeable **opposite-week**
     option, instead of being silently excluded.
3. **Enumeration scope → v1 (opposite-week pairs).** Keep today's "true parallel"
   groupings, and additionally surface **both-bi-weekly conflicting *pairs*** as a distinct,
   badged opposite-week grouping. Defer the **general mixed-set** case (one slot holding an
   agnostic course plus several bi-weekly courses, resolved by a full bipartite 2-coloring)
   to a later iteration.

**This matches the PRD exactly** — FR-002 ("mark a course as bi-weekly" **and** "choose
which week at placement"), FR-003 (week-aware validator), US-03 (see Historical Context).
The hybrid restores the course-level flag that a placement-only model would have dropped.

## Summary

**Feasibility: high.** The feature is PRD-specified, the constraint core was built for
additive extension, and the conflict primitive (`violatesAny`) is reused unchanged — we
*classify* its result rather than rewrite it.

**Headline impact** (hybrid model, relax conflicts, enumeration v1):

- **Schema**: two new enum columns — `courses.week_mode` (`agnostic` | `biweekly`) and
  `placements.week` (`both` | `a` | `b`); migration(s) + type regen + clone-fn update.
- **Catalog / enumeration** (now in scope): `weekMode` flows into `GroupingCourse` and
  therefore into the **catalog hash** (else stale-grouping detection breaks). Enumeration
  classifies each conflict edge **hard** (≥1 agnostic → never groupable) vs **soft** (both
  bi-weekly → opposite-week resolvable) and emits soft pairs as marked groupings.
- **Board logic**: the relaxation lands in the `explain()` path
  (`collisions.ts → teacher-conflict / student-conflict`) via an **additive** `BoardContext`
  field carrying each occupant's placement week. **No** change to the `CellConstraint`
  interface, to `duplicate-course`, or to `teacher-availability` (stays week-agnostic per
  FR-006). The pairwise `test()` primitive is unchanged.
- **UI**: courses catalog form gains a `weekMode` toggle; the board renders **vertical week
  lanes (A/B)** inside a slot whenever a bi-weekly course is present (agnostic-only cells are
  unchanged), with a per-placement A/B control; the palette shows opposite-week groupings
  with a distinguishing badge. Cohort stays a *column-level* split (FR-007), orthogonal to
  the in-cell week lanes — see §6.
- **Slot bundles stay orthogonal** — a presentation marker that never touches validation; a
  bundle may *contain* an opposite-week pair but neither implies nor validates it.

**Risk is semantic, not raw speed.** The per-pair check is O(1); the board derivation is
O(occupants²) over tiny N. The watch-items are: enumeration result-space growth (soft edges
make the graph denser — respect the existing loud caps), the drag-hint vs drop-week ordering,
the duplicate/unique-constraint interaction, and fortnightly hours/coverage math.

## Detailed Findings

### 1. Current data model — no week concept exists today

`grep` across `src/`, migrations, and fixtures confirms the only "week" token is
`hours_per_week`.

- **`courses`** (`supabase/migrations/20260602185012_minimal_domain_schema.sql:28-48`,
  re-rooted to plans in `20260611180006_plans_as_domain_root.sql:36-43`):
  `plan_id, cohort (dp1|dp2 enum), name, level, group_index, hours_per_week`. Generated
  types at `src/shared/api/database.types.ts:232-265`. → gains `week_mode`.
- **`placements`** (`20260611180006_plans_as_domain_root.sql:91-103`):
  `id, plan_id, cohort, day (1–7), period (1–12), course_id`, unique on
  `(plan_id, cohort, day, period, course_id)`. Multiple *different* courses per cell are
  already allowed — that is what enables slot-sharing. → gains `week`.
- **Runtime placement type** `PlannerPlacement = { id, courseId, day, period }`
  (`src/_pages/plan-detail/model/placement.ts:2-7`). → gains `week`.
- **Placement create/read** `src/_pages/plan-detail/api/placements.ts:9-15` (Zod input),
  `:24-31` (`PlacementRow`/`toPlannerPlacement`), `:39+` (`insertPlacement`, **idempotent on
  `placements_unique`** — re-placing the same course-hour returns the existing row, so
  *changing* a week later is an update, not an insert).
- **Catalog projection** `src/shared/api/load-cohort-courses.ts:59-80` →
  `GroupingCourse { id, teacherKeys, studentKeys, hours }`
  (`src/shared/lib/catalog-hash/types.ts:8-13`). → gains `weekMode`.
- **Catalog hash** `src/shared/lib/catalog-hash/compute-catalog-hash.ts:13-26` canonicalizes
  `{id, teacherKeys, hours, studentKeys}`. → must add `weekMode`, or grouping staleness
  detection drifts.
- **Clone** copies placements with an explicit column list
  (`20260620120002_clone_plan_with_course_teachers.sql:125-130`) and courses (`:79-83`) —
  both must add the new columns.
- **Seed** (`scripts/gen-seed.mjs`, `data/dp1`, `data/dp2`) is catalog-only and does **not**
  create placements; only the courses INSERT (`gen-seed.mjs:54-66`) needs a `week_mode`
  value (default `agnostic`). No placement seed change.

### 2. The constraint / collision core — two paths, reuse the conflict primitive

Two deliberately separate evaluation paths:

- **`explain()` — authoritative board path.** `deriveCellViolations(...)`
  (`src/_pages/plan-detail/model/collisions.ts:41-68`) buckets placements by
  `cellKey = "${day}:${period}"` (`:8`, `bucketByCell` `:76-90`) and calls
  `explainCell(occupants, ctx)` (`constraints/index.ts:17-18`), which `flatMap`s each
  constraint's `explain(occupants, ctx)` (`constraints/types.ts:29-36`). **This is where the
  board relaxation goes.**
- **`test()` — ctx-free pairwise primitive.** `violatesAny(course, others)`
  (`constraints/index.ts:24-25`) → `hasIntersection` (`collision.ts:10`), used by
  enumeration (`enumerate.ts:38,53`) and drag drop-hints (`drop-hints.ts:157`). It answers
  "do these two raw catalog courses conflict?" — **left unchanged**; enumeration *wraps* it
  with edge classification (§5).

The four constraints (`constraints/index.ts:9-14`):

| Constraint | Reads | Week-aware? |
|---|---|---|
| `teacher-conflict` (`teacher-conflict.ts:13-25`) | `occupants[].teacherKeys` | **Board: yes** — disjoint placement weeks ⇒ no conflict |
| `student-conflict` (`student-conflict.ts:11-21`) | `occupants[].studentKeys` | **Board: yes** — disjoint placement weeks ⇒ no conflict |
| `duplicate-course` (`duplicate-course.ts:7-15`) | `occupants[].id` | **No** — keep as a block |
| `teacher-availability` (`teacher-availability.ts:19-35`) | `teacherKeys` + `ctx.cell` + avail maps | **No** — week-agnostic (FR-006) |

`BoardContext` (`constraints/types.ts:19-26`) is **explicitly designed for additive
board-only fields**; teacher-availability already rides this. Placement week rides the same
pattern.

### 3. Model / schema threading

- **Migration(s)**: add enum `course_week_mode AS ('agnostic','biweekly')` → `courses.week_mode`
  (default `agnostic`); add enum `placement_week AS ('both','a','b')` → `placements.week`
  (default `both`). **Keep the placements unique key as-is** (see Open Questions on whether
  one course may occupy both weeks of a single slot).
- Regenerate `src/shared/api/database.types.ts`.
- Courses CRUD: add `weekMode` to `courseInput` Zod (`src/_pages/courses/model/schemas.ts:33-46`)
  and to the form (§4).
- Placement path: add `week` to `createPlacementInput` (default `both`) + insert
  (`placements.ts:9-15,39+`), `PlacementRow`/`toPlannerPlacement` (`:24-31`), and
  `PlannerPlacement` (`placement.ts:2-7`). A thin `updatePlacementWeek` action handles
  changing the week after placement (insert is idempotent).
- Clone SQL: add `week_mode` to the courses block and `week` to the placements block
  (`20260620120002_clone_plan_with_course_teachers.sql:79-83,125-130`).

### 4. Logic — board relaxation + enumeration v1

**Board (`explain()`):**
- `bucketByCell` (`collisions.ts:76-90`) currently discards the placement and keeps only the
  `GroupingCourse`. Thread each occupant's placement week through. Minimal-surface option:
  add an additive `weekByCourseId?: Map<string, Week>` to `BoardContext` (each course is
  unique per cell, so keying by `courseId` is safe) — **no `CellConstraint` interface change**.
- `teacher-conflict.explain()` and `student-conflict.explain()` skip any occupant pair whose
  placement weeks are disjoint. Add a pure `weeksDisjoint(a,b) = a!=='both' && b!=='both' && a!==b`
  helper (unit-tested). `both` (agnostic) overlaps everything.
- **Relax by *removing* violations, not by adding a severity** — preserves the
  `collisions.ts:94-105` invariant that everything except `teacher-unavailable` is `block`.

**Enumeration v1 (`enumerate.ts`) — the grouping value:**
- `GroupingCourse` gains `weekMode`; the conflict primitive `violatesAny` is reused. For each
  conflicting pair, **classify the edge**:
  - **Hard** = conflict AND (≥1 course `agnostic`) → cannot share a slot, ever.
  - **Soft** = conflict AND (both `biweekly`) → shareable on opposite weeks.
- Keep the existing maximal-independent-set enumeration over **hard** edges → today's true-
  parallel groupings (unchanged behaviour for agnostic-only catalogs).
- **v1 addition**: emit each **soft pair** as a distinct grouping flagged "opposite weeks
  (A/B)" — O(edges) post-processing, no traversal-cap risk. This is the author's scenario:
  course A and course B share teacher+students but, both being bi-weekly, can be stacked on
  opposite weeks; the palette now *offers* it.
- **Deferred to v2**: general mixed sets (agnostic + multiple bi-weekly in one slot) require
  the soft-edge subgraph to be bipartite (2-colorable = the A/B assignment) and would grow
  the result space the caps (`enumerate.ts:18`) guard.

**Drag-hint wrinkle:** `drop-hints.ts:157` uses the week-blind `violatesAny`; at drag time
the placement's week isn't chosen yet. v1: leave drag hints conservative (treat as `both`) —
place, then set A/B and the board `explain()` clears the false flag. A "placing week" mode
for week-aware hints is a later option.

### 5. Slot bundles & enumeration — relationship

- **Slot bundle = presentation marker, never validation.** ≥2 occupants ⇒ bundle by default;
  a `slot_bundles` row is the explicit *unbundled* opt-out (`slot-bundle.ts:23-25`,
  `20260613123404_slot_bundles.sql:3-6`), keyed per *cell*. Week is per *placement* — don't
  model week as a bundle. A bundle may legitimately contain an opposite-week pair.
- **Enumeration** (`enumerate.ts:20-60`) finds maximal sets via the conflict primitive,
  scored by `score.ts:3-23`, persisted via `replace_cohort_groupings` with `catalog_hash`
  staleness detection. v1 augments it with soft-pair classification (above). Note scoring:
  a soft (opposite-week) pair does **not** cover students *simultaneously*, so `score.ts`
  coverage/rank semantics for these entries are a decision (Open Questions).

### 6. UI surface

**Decided: in-cell visualization = vertical week lanes (A on top, B below).** The driving
constraint is that **cohort and week occupy different layout levels**:

- **Cohort = grid *column* dimension.** The combined view is "DP1 | DP2 side by side, one
  column per cohort" (`prd.md:293-294` FR-007, `roadmap.md:37` S-06), with cross-column moves
  guarded (FR-008). Cohort lives *outside* the cell and roughly *halves cell width* when it
  lands (the PRD flags compact/narrower columns + horizontal scroll, `prd.md:295-299`).
- **Week = in-*cell* dimension.** Because the cohort split consumes horizontal space, the
  in-cell week visual must spend **vertical** space → stacked A/B lanes, not a left/right
  split. A horizontal A|B split would collapse exactly when cohort columns arrive.

The two are orthogonal: in the future combined view, each cell keeps its week lanes
unchanged while DP1/DP2 become separate columns around it. No redesign needed.

**Week-lanes spec (for `/10x-plan`):**
- **Progressive disclosure.** A cell renders lanes **only when at least one occupant is a
  bi-weekly placement** (`week ∈ {a,b}`). Agnostic-only cells render exactly as today — the
  ~95% case gets zero new chrome (`SlotCell.tsx:91-181` unchanged path).
- **Lane layout.** When active, the cell body (below the existing bundle header) becomes two
  stacked lanes with a thin, muted left rail labelled `A` / `B`. Lane A holds the week-A
  chip; lane B the week-B chip; an empty lane shows a **ghost "free"** placeholder so
  remaining capacity is visible. An agnostic (`both`) occupant spans both lanes (runs every
  week). *(Detail for the plan: rendering of a mixed agnostic + bi-weekly cell — they run
  parallel on the shared week — and multi-occupant lanes.)*
- **Valid vs. collision.** An opposite-week pair carries **no destructive ring** (valid
  share); same-week overlap keeps today's destructive treatment (`SlotCell.tsx:218-226`,
  `collisions.ts:94-105`). Lanes only *position* chips by week — they don't change collision
  ink.
- **Bundle interaction.** An opposite-week pair is a 2-occupant cell ⇒ bundled by default;
  the existing group/ungroup + trash header (`SlotCell.tsx:123-164`) stays above the lanes,
  and the whole cell still drags as a unit.
- **Set a placement's week.** A per-placement A/B control on `PlacedChip`
  (`SlotCell.tsx:185-280`), shown only for `biweekly` courses, moves a chip between lanes
  (writes `placements.week` via `updatePlacementWeek`). Week chosen after drop in v1 (§4
  drag-hint wrinkle); a week-aware "placing mode" / drop-into-lane is a later option.
- **Tokens only.** Rail, ghost lane, and labels use semantic tokens (`bg-secondary`,
  `text-muted-foreground`, …) per the no-hardcoded-color rule; reuse `src/shared/ui/badge.tsx`,
  `src/shared/ui/select.tsx`.

**Other UI touch-points:**
- **Courses catalog form**: `weekMode` toggle (Agnostic / Bi-weekly), a `Select` or segmented
  control next to `groupIndex`/`cohort` (`src/_pages/courses/ui/CourseFormDialog.tsx` ~`:115-170`),
  schema in `src/_pages/courses/model/schemas.ts:33-46`; optional badge/column in
  `CourseTable.tsx:49-66`.
- **Palette — opposite-week groupings**: badge the soft-pair grouping in `GroupingBox.tsx:26-70`
  ("these go on opposite weeks A/B").
- **Explain a same-week clash**: extend `CollisionDetailsDialog.tsx:56-163`.

## Feasibility & impact assessment

- **Effort**: medium. Adds (vs. a placement-only model) the course flag, catalog-hash
  inclusion, enumeration v1 edge classification, and the catalog-form toggle — but reuses the
  conflict primitive and leaves the `CellConstraint` interface, `duplicate-course`,
  `teacher-availability`, and the `test()` path untouched.
- **Performance / <200ms**: board check is O(1) per pair inside an O(occupants²)-over-tiny-N
  derivation — no budget risk. Enumeration v1 soft-pair pass is O(edges). Watch result-space
  growth if/when v2 mixed sets land (loud caps at `enumerate.ts:18` are the backstop).
- **Risk concentration**: semantics — enumeration result growth, drag-hint vs drop-week
  ordering, duplicate/unique-constraint interaction, fortnightly hours/coverage.

## Code References

- `supabase/migrations/20260602185012_minimal_domain_schema.sql:28-48` — `courses` (add `week_mode`)
- `supabase/migrations/20260611180006_plans_as_domain_root.sql:91-103` — `placements` (add `week`)
- `supabase/migrations/20260620120002_clone_plan_with_course_teachers.sql:79-83,125-130` — clone (courses + placements blocks)
- `scripts/gen-seed.mjs:54-66` — courses seed INSERT (default `week_mode`)
- `src/shared/api/database.types.ts:232-265` — generated types (regen)
- `src/shared/api/load-cohort-courses.ts:59-80` — catalog projection (carry `weekMode`)
- `src/shared/lib/catalog-hash/types.ts:8-13` — `GroupingCourse` (add `weekMode`)
- `src/shared/lib/catalog-hash/compute-catalog-hash.ts:13-26` — catalog hash (add `weekMode`)
- `src/_pages/plan-detail/model/placement.ts:2-7` — `PlannerPlacement` (add `week`)
- `src/_pages/plan-detail/api/placements.ts:9-15,24-31,39+` — placement create/read (+ `week`, + `updatePlacementWeek`)
- `src/_pages/plan-detail/model/collisions.ts:41-90` — board derivation + `bucketByCell` (thread week)
- `src/_pages/plan-detail/model/constraints/types.ts:19-36` — `BoardContext` (additive `weekByCourseId`)
- `src/_pages/plan-detail/model/constraints/teacher-conflict.ts:13-25` — relax (explain only)
- `src/_pages/plan-detail/model/constraints/student-conflict.ts:11-21` — relax (explain only)
- `src/_pages/plan-detail/model/constraints/duplicate-course.ts:7-15` — unchanged
- `src/_pages/plan-detail/model/constraints/teacher-availability.ts:19-35` — week-agnostic (FR-006)
- `src/_pages/plan-detail/model/collision.ts:10`, `enumerate.ts:20-60,38,53` — conflict primitive + enumeration (classify edges, emit soft pairs)
- `src/_pages/plan-detail/model/score.ts:3-23` — grouping score/coverage (opposite-week semantics TBD)
- `src/_pages/plan-detail/model/drop-hints.ts:157` — drag hints (conservative in v1)
- `src/_pages/courses/ui/CourseFormDialog.tsx` (~`:115-170`), `src/_pages/courses/model/schemas.ts:33-46` — catalog form + Zod (`weekMode`)
- `src/_pages/plan-detail/ui/SlotCell.tsx:185-280` — placed chip (A/B control + badge)
- `src/_pages/plan-detail/ui/GroupingBox.tsx:26-70` — palette grouping (opposite-week badge)
- `src/_pages/plan-detail/ui/CollisionDetailsDialog.tsx:56-163` — explain same-week clash
- `src/shared/ui/badge.tsx:7-27`, `src/shared/ui/select.tsx` — reusable primitives

## Architecture Insights

- **The palette is the product surface — week-eligibility must be visible to enumeration.**
  Enumeration runs on the catalog, so a placement-only week would hide every bi-weekly
  sharing opportunity. The course-level `weekMode` flag is what lets the palette *suggest*
  opposite-week stacks. This is the core reason for the hybrid.
- **Reuse the conflict primitive; classify, don't rewrite.** `violatesAny` stays the raw
  "do these conflict?" check. Enumeration labels each conflict edge hard/soft from the flag;
  the board path subtracts disjoint-week pairs. Both reuse, neither rewrites.
- **`BoardContext` additivity** keeps the board change off the `CellConstraint` interface.
- **Two homes for week, one invariant.** Course `weekMode` (eligibility) + placement `week`
  (assignment), with `agnostic ⇒ both`. Enforce it in the placement action and surface it in
  the UI (only `biweekly` courses get the A/B control).
- **Relax by removing violations, not by adding a "week-warning" severity.**
- **Week and cohort are different layout levels — keep them orthogonal.** Cohort is a grid
  *column* split (FR-007), week is an in-*cell* vertical split. Designing the week visual to
  spend vertical (not horizontal) space makes it survive the cohort feature with no redesign:
  cells keep their A/B lanes while DP1/DP2 become columns around them.

## Forward-compatibility with the next change (S-04: cross-cohort)

**Decision: cross-cohort week-aware teacher occupancy (FR-005 / FR-006, roadmap S-04
`two-cohort-board-cross-cohort`) is out of scope here and lands in the next change.** This
change is a clean *enabler* — the per-placement `week` is exactly the dimension FR-006 needs
— so it must add **no** cross-cohort scaffolding. Guardrails so we neither block nor
complicate S-04:

- **Week is first-class on the placement.** `placements.week` + `PlannerPlacement.week` are
  the single source; the within-cell relaxation (now) and S-04's cross-cohort teacher→week
  index (later) each derive from it independently → the two changes stay decoupled.
- **Make week a reusable primitive, not inline logic.** A `Week`/`PlacementWeek` type and a
  `weeksDisjoint` helper (+ an occupant→week accessor) S-04 can reuse for the symmetric
  cross-cohort check — don't bury the comparison inside `teacher-conflict.explain`.
- **Add zero cross-cohort scaffolding now (YAGNI).** `BoardContext` grows additively
  (`roadmap.md:68` — it currently only *comments* about future cross-cohort fields). Our
  `weekByCourseId` stays single-cohort / within-cell; S-04 adds its own field. No speculative
  half-wiring to untangle later.
- **Leave availability alone** — FR-006 keeps it week-agnostic *and* cohort-independent;
  making it week-aware now would just be undone in S-04. (Already the plan, §2.)
- **Keep `SlotCell` cohort-unaware** — it takes only `day/period/occupants`; the week lanes
  must add no cohort coupling, so the cell drops unchanged into a DP1 or DP2 column later.
- **Keep the violation union + constraint registry additive** — S-04 adds a new cross-cohort
  violation `kind`; don't over-specialize current handling against it.
- **Don't touch the dp1 cohort lock or cohort switching** — FR-005 is S-04's job.

## Historical Context (from prior changes)

- **The PRD specifies this feature** (`context/foundation/prd.md`):
  - **FR-002** (`:244-250`): mark a course bi-weekly **and choose the week (A/B) at
    placement**; a weekly course occupies both weeks. Exactly the hybrid. Resolved *against*
    a whole-grid fortnight axis.
  - **FR-003** (`:251-257`): validator permits opposite-week sharing, flags any week overlap.
  - **FR-006** (`:279-289`): teacher **occupancy** is week-aware (and cross-cohort
    symmetric); teacher **availability** stays week-agnostic.
  - **US-03** (`:215-224`): two opposite-week courses with no shared student/teacher accepted
    in one slot; a third sharing a week is flagged.
  - `:70-71`: grid stays `(day, period)` only — week is an attribute, not a grid axis.
- `context/archive/2026-06-20-co-teaching-teacher-sets/` — most recent constraint work (this
  branch was cut from it); generalized `teacherKey` → teacher *set*. The exact additive-
  refinement pattern week-awareness follows.
- `context/archive/2026-06-12-collision-info/plan.md` — the explainable discriminated-union
  constraint registry behind `explain()`.
- `context/archive/2026-06-13-collision-free-slots/plan.md` — drop-hint map from `violatesAny`
  (relevant to the drag-time wrinkle, §4).
- `context/archive/2026-06-13-slot-as-a-group/{plan,research}.md` — slot-bundle opt-out model;
  confirms bundles never affect validation (§5).
- `context/archive/2026-06-04-port-grouping-algorithm/plan.md` — enumeration + `catalog_hash`;
  the machinery v1 now extends (edge classification, soft pairs).
- `context/archive/2026-06-18-test-plan-refresh-2026-06-18/{research,change}.md` — frames this
  change (S-03) as the "unified collision rule for opposite-week overlaps."

## Open Questions (decisions for /10x-plan)

1. **Enumeration v2 (general mixed sets)** — out of scope for v1; confirm we defer the
   agnostic-plus-multiple-bi-weekly / full bipartite 2-coloring case until there's demand.
2. **Grouping representation for soft pairs** — does the persisted grouping carry the A/B
   coloring per member (new column on `course_grouping_members`,
   `20260602185012_minimal_domain_schema.sql:142-147`), or is the opposite-week split
   computed at drop time? (Trivial for v1 pairs; matters more for v2.)
3. **Scoring/coverage of opposite-week groupings** — a soft pair doesn't cover students
   simultaneously; decide whether `score.ts` coverage/rank treats it differently from a
   true-parallel grouping.
4. **Same course in both weeks of one slot?** — the unique key includes `course_id`, so a
   course can't be placed twice in a cell today. Recommendation: keep the key (disallow) —
   the capacity case is two *different* courses; revisit only if splitting one course across
   weeks is ever desired.
5. **Fortnightly hours/coverage** — a week-A/B placement is half the contact time, but
   `hours.ts:14-25` counts one placement row = one hour. Decide whether completeness math
   becomes week-aware or is out of scope for v1.
6. **Drag-time hints** — confirm v1 keeps hints conservative (week chosen after drop) vs.
   investing in a "placing week" mode.
7. **Cross-cohort week-aware occupancy (FR-006)** — *resolved: out of scope* (next change,
   S-04). See "Forward-compatibility with the next change" above for the enabler guardrails
   that keep this change from blocking or complicating S-04.

## Related Research

- `context/foundation/prd.md` (FR-002/003/006, US-03) — canonical spec.
- `context/archive/2026-06-18-test-plan-refresh-2026-06-18/research.md` — prior framing of S-03.
