---
date: 2026-06-29T22:51:50+0200
researcher: Dobromir Kropielnicki
git_commit: afd0f9f99b9144c38d6a82eff177a00176650efa
branch: main
repository: dobrek/ib-timetable-planner
topic: "Visual breaks between periods on the planner board — feasibility + challenging the 'customizable preset' idea"
tags: [research, codebase, plan-detail, grid, presets, planner-board]
status: complete
last_updated: 2026-06-29
last_updated_by: Dobromir Kropielnicki
---

# Research: Visual breaks between periods on the planner board

**Date**: 2026-06-29T22:51:50+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: afd0f9f99b9144c38d6a82eff177a00176650efa
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

Check the feasibility of introducing **visual breaks between periods** on the planner board (the user wants a visual gap between periods 2–3 and 5–6, purely to improve readability). Secondary question: is this the occasion to **make the grid preset more customizable**? Challenge the idea.

The user's chosen scope (from scoping Q&A):
- **Lean into the minimal, visual-only path**, but document what a future "configurable break positions" step would entail.
- If/when made configurable, breaks should be **per-plan persisted**.
- **Strong devil's-advocate** treatment of the idea.

## Summary

**The visual break is real, cheap, and safe; the "customizable preset" expansion it tempts you toward is a YAGNI trap you should refuse.** Treat these as two different proposals and only ship the first.

1. **Minimal visual-only break (recommended): a single-file, ~5-line edit.** The planner timetable is one CSS Grid whose rows are `display:contents` wrappers placed by auto-flow — there is **no `grid-template-rows` and no per-cell `grid-row` math** anywhere. Drop targets resolve from explicit dnd-kit `{day, period, cohort}` data, **not** DOM/row position. So inserting a full-width spacer element after period 2 and 5 pushes later rows down and changes **zero coordinates, zero keys, zero validation**. The change lives entirely in `PlannerGrid.tsx`. **No DB migration, no constraint change, no hot-path impact.**

2. **The constraint core is provably immune.** Every constraint keys off an opaque `cellKey(day, period)` string. A repo-wide search for `consecutive | adjacent | neighbour | period+1 | gap | break` found **zero domain hits** — nothing computes period adjacency or assumes anything a visual gap would disturb. The `<200ms` validation budget is untouched because the hot path never reads grid geometry.

3. **"Make the preset customizable" is a stated non-goal across four documents and has never been requested by a user.** Conflating the readability ask with a preset redesign would smuggle in scope the project has repeatedly and deliberately parked. The break is *render-only* and should stay decoupled from `slot_grid_preset` entirely.

4. **The genuinely hard version — a "real" break (a non-teaching slot, or renumbered periods) — is the one to avoid.** It would force a data migration of every `placements.period` integer, droppability guards, duplicate-scan changes, and a new "slot index vs. teaching-period number" mapping. The user explicitly wants none of this ("breaks play only a visual role"), so don't accidentally build it.

5. **If you later want per-plan configurable break positions** (documented here as a forward path, *not* recommended now): the minimal delta is **one new nullable column on `plans`** (`smallint[]` or text CSV) — **not** encoding breaks into the preset string — plus straightforward plumbing through the create flow and board props. FR-008 ("grid fixed for the lifetime of a plan") governs grid *dimensions*, so visual breaks could even be made editable post-creation without violating it.

---

## Detailed Findings

### A. Rendering — where a visual break goes (and why it's safe)

**The timetable is one CSS Grid with auto-flow rows.** [`PlannerGrid.tsx:83-88`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/ui/grid/PlannerGrid.tsx#L83-L88) declares `role="grid" className="bg-border grid gap-px rounded-lg"` with `gridTemplateColumns: auto repeat(${days}, minmax(7rem,1fr))`. Columns are explicit; **rows are not** — each `role="row"` is a `className="contents"` div ([`PlannerGrid.tsx:91,107,126`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/ui/grid/PlannerGrid.tsx#L91)), so every cell is a direct grid item placed by implicit row auto-flow. A grep for `grid-row`/`gridRow` returns **zero matches** in the slice.

**Consequence:** inserting a full-width spanning spacer between two period rows just pushes subsequent rows down. It shifts no `grid-row` value because none exist.

**The insertion locus is one map.** [`PlannerGrid.tsx:125`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/ui/grid/PlannerGrid.tsx#L125) is `periodList.map((period) => (<div role="row" className="contents" key={period}>…)`, where `periodList = Array.from({ length: periods }, (_, i) => i + 1)` ([`PlannerGrid.tsx:75`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/ui/grid/PlannerGrid.tsx#L75)). A minimal break wraps each row in a `Fragment` and conditionally appends after the chosen periods:

```tsx
{periodList.map((period) => (
  <Fragment key={period}>
    <div role="row" className="contents"> … existing row … </div>
    {BREAK_AFTER.has(period) && (
      <div role="presentation" aria-hidden className="bg-background col-[1/-1] h-3" />
    )}
  </Fragment>
))}
```

- `col-[1/-1]` spans the rowheader track + every day/cohort column, so auto-flow forces it onto its own row.
- `role="presentation"` / `aria-hidden` keeps it out of the ARIA grid tree — matching the existing empty-corner cell convention at [`PlannerGrid.tsx:92`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/ui/grid/PlannerGrid.tsx#L92). **This directly answers the one historical risk flag** (ui-conventions mandates strict ARIA grid semantics; a presentation spacer doesn't add a phantom `row`/`gridcell`).

**Drag-drop is data-keyed, not position-keyed.** Each cell registers `useDroppable({ id, data: { day, period, cohort } })` at [`SlotCell.tsx:174`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/ui/grid/SlotCell.tsx#L174); the drop router reads only those coords (`model/drag.ts:25-26,34`). Grep for `getBoundingClientRect`/`clientX`/`rowIndex`/`offsetTop`/`nth-child` across the slice = **zero**. A non-droppable spacer registers nothing, so drop resolution is inert to it.

**Styling.** Gridlines are the `bg-border` container showing through `gap-px` (cells are `bg-background`) — semantic tokens throughout, per the [no-hardcoded-color lesson](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/context/foundation/lessons.md). The break band should be `bg-background` (reads as a wider light gap) or a thin `bg-border` rule. Because CSS `gap` can't be widened per-row, the band must be its own element — which is exactly the spacer above.

**Minimal-implementation footprint: one file** — [`src/_pages/plan-detail/ui/grid/PlannerGrid.tsx`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/ui/grid/PlannerGrid.tsx) (plus an optional `BREAK_AFTER` constant). If visual consistency in the teacher dialog is wanted, [`TeacherAvailabilityDialog.tsx:84`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/teachers/ui/TeacherAvailabilityDialog.tsx#L84) renders its own period grid and would take the same render-only treatment independently.

### B. Constraint / placement coupling — the safety proof

**Opaque cell identity is the linchpin.** [`collision/cell-key.ts:10`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/model/collision/cell-key.ts#L10) is `cellKey(day, period) => \`${day}:${period}\`` — pure string interpolation, no ordering, no arithmetic. Every constraint judges only the occupants *of that exact cell*:

- `deriveCellViolations` / `bucketByCell` bucket by `cellKey` ([`collisions.ts:86,94`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/model/collision/collisions.ts#L86)).
- duplicate-course, teacher-conflict, student-conflict, `teacher-availability.ts:24`, `cross-cohort-teacher.ts:23` — all cell-local, all `cellKey`-keyed.
- `BoardContext` (`constraints/types.ts:21-35`) carries only `cell: {day, period}` + `cellKey`-keyed maps. **No period-range, period-count, or neighbor field exists.**

**No adjacency anywhere.** Full-tree search for `consecutive | adjacent | neighbour | period+1 | gap | break | lunch | free period` → only CSS `gap-*` class hits. Nothing assumes contiguity in a way a visual gap disturbs.

**Placements are opaque integer coordinates.** `PlannerPlacement = { day: number, period: number, … }` ([`placement.ts:4-19`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/model/placement/placement.ts#L4)); validated `1..GRID_BOUNDS.max*` ([`placements.ts:10-11`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/api/placements.ts#L10)); DB columns `day/period smallint` with `placements_day_range`/`placements_period_range` CHECKs ([`20260602185012_minimal_domain_schema.sql:120-126`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/supabase/migrations/20260602185012_minimal_domain_schema.sql#L120-L126)). A visual break changes none of these.

**Hot path never sees geometry.** The `<200ms` work is `deriveCellViolations` ([`collisions.ts:33`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/model/collision/collisions.ts#L33)) and `deriveDropHints` ([`drop-hints.ts:91`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/model/drop-hints.ts#L91)); the hints map is sparse and bounds-agnostic ("absent = free", `drop-hints.ts:88-90`). Perf test asserts `<50ms` for both cohorts (`collisions.perf.test.ts:71`); real cost is sub-millisecond. A static spacer adds nothing.

**The one period-count dependency is contiguity-safe.** `rotatedColumnMajor(days, periods, source)` ([`duplicate-target.ts:63-69`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/model/placement/duplicate-target.ts#L63-L69)) maps `(day,period)` to a linear index over `days*periods` to find the next empty cell when duplicating. It assumes periods `1..N` contiguous — which the **pure-visual** approach preserves exactly. (This is the function that would break under a "real" break — see §D.)

**Teacher availability** keys by `(plan_id, teacher_id, day, period)` and folds into a `cellKey`-keyed index ([`teacher-availability.ts`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/teachers/api/teacher-availability.ts), `availability-index.ts:37`). It uses period *count* only as a bulk-authoring convenience (`setColumn`/`setRow` iterate `1..periods`) — not domain logic. Unaffected.

### C. Preset / persistence model (for the *future* configurable step)

**`plans` is a thin row.** [`20260602185012_minimal_domain_schema.sql:91-100`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/supabase/migrations/20260602185012_minimal_domain_schema.sql#L91-L100): `id, name, slot_grid_preset text not null, created_at, updated_at`. **No JSON/JSONB, no other config column.** The DB does **not** enforce the preset enum — the enum gate lives only in app code ([`grid-presets.ts`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/shared/config/grid-presets.ts), `gridPresetSchema = z.enum(["5x6","5x8","5x10"])`). A per-plan "break positions" value is genuinely new data with nowhere to live today.

**Create flow = 5 hops:** form ([`PlanFormDialog.tsx:72-136`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plans-list/ui/PlanFormDialog.tsx#L72-L136)) → Zod `createPlanInput` ([`schemas.ts:9-12`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plans-list/model/schemas.ts#L9-L12)) → action (`api/actions.ts`) → insert ([`create-plan.ts:7-11`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plans-list/api/create-plan.ts#L7-L11)). Read path: [`load.ts:54`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/api/load.ts#L54) parses preset → `{days, periods}` into `SharedBoardProps` ([`drag.ts:37-46`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/model/drag.ts#L37-L46)); the UI never sees the raw preset string, only the two integers.

**Do NOT encode breaks in the preset string.** The parser `PRESET_RE = /^(\d+)x(\d+)$/` ([`grid.ts:12`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/shared/lib/grid/grid.ts#L12)) silently falls back to `DEFAULT_GRID` on anything else, and `GRID_PRESET_VALUES` is a closed 3-value enum — folding break-sets in would explode it combinatorially. Breaks (visual) and the preset (validation-relevant grid shape) are orthogonal; keep them apart.

**Minimal future delta = one new nullable column.** `alter table plans add column break_after_periods smallint[]` (or text CSV `"2,5"`), nullable, additive — no CHECK strictly needed (visual-only), validate `1..periods-1` in Zod. Then plumb through: regenerate `database.types.ts`, add field to `createPlanInput` + form control + the `.insert({…})`, extend the `clone_plan` SQL function so clones copy breaks, add to `select`/`SharedBoardProps`/`PlannerBoard` → `PlannerGrid` prop, and an optional `breakAfterPeriods` in [`test/factories/create-plan.ts`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/test/factories/create-plan.ts). Existing integration tests stay green if the column is nullable with a default.

### D. The "real break" anti-pattern — what to NOT accidentally build

If a break were ever a *real* slot (consuming a period index) or periods were renumbered around breaks, it would ripple widely — this is the contrast that makes "purely visual" the right call:

1. **Data migration of every `placements.period`** integer (absolute slot indices shift meaning) — plus `teacher_availability.period`, `bundles.period`, and their `*_period_range` CHECKs.
2. **`rotatedColumnMajor`** ([`duplicate-target.ts:63-69`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/model/placement/duplicate-target.ts#L63-L69)) would scan into break slots and offer them as duplicate targets — needs a break-aware predicate that doesn't exist.
3. **Droppability** — today *every* in-bounds `(day,period)` is a functional drop target; a real break needs an "un-placeable slot" guard in the grid, drop-hints, and the server `place_course` RPC.
4. **Teacher-availability bulk ops** (`setColumn`/`setRow`) would author rows for break slots.
5. **Preset/label semantics** — `parseGridPreset` would need to decide whether the count includes breaks, introducing a "slot index vs. teaching-period number" divergence that currently does not exist (today `period` is both).

The user's ask explicitly forecloses all of this. The risk is *scope creep*, not implementation.

---

## Devil's Advocate — challenging the idea

You asked me to push back. Here it is, in priority order.

**1. Is a break even the right readability fix — or just the first one proposed?** The break is a *fixed-position horizontal rule*. Cheaper alternatives that improve scanability without any new concept:
- **Zebra striping / period-band shading** (alternate row tint) — orientation help on *every* row, not just two, and zero new domain ideas.
- **Heavier rule every Nth period** (e.g. a thicker `bg-border` line after each period) — generic structure, no "where exactly" decision.
- **Better period labels** — `P3` is terse; the deferred "per-period-label editing" (shape-notes) hints labels were always the weak spot.

The break wins only if users specifically read the board as *blocks* (morning = P1–2, mid = P3–5, afternoon = P6+). That's plausible for a school timetable — but it's an assumption worth confirming with the requesting users before building, because striping/labels are even cheaper and help more rows. **Recommendation: still ship the break (it's nearly free), but treat it as a readability experiment, not a settled requirement.**

**2. "Maybe make the preset customizable" — no. This is the trap.** Customizable grids are a **stated non-goal in four documents** with **zero recorded user demand**:
- Live PRD Non-Goals: "Custom slot-grid editor (presets only)." ([`prd.md:461`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/context/foundation/prd.md#L461))
- Roadmap → Parked: "Custom slot-grid editor (presets only) — Why parked: PRD §Non-Goals." ([`roadmap.md:213`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/context/foundation/roadmap.md#L213)) — no slice, not sequenced.
- Archived PRD FR-008: "Bespoke day-count and per-period-label editing is deferred." ([`archive/2026-06-18-prd.md:178`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/context/foundation/archive/2026-06-18-prd.md#L178))
- The single "demand" note in the whole repo concluded the opposite: presets suffice for the one target IB school ([`archive/2026-06-18-prd.md:109`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/context/foundation/archive/2026-06-18-prd.md#L109)).

The readability request does **not** require touching the preset at all. Letting "breaks" become the Trojan horse for a grid editor would re-open a deliberately-closed scope decision on the back of a cosmetic ask. **Keep them decoupled.**

**3. Even the *configurable break positions* step is probably premature.** The user wants breaks after P2 and P5 — concrete, fixed, shared across the one school's plans. A `BREAK_AFTER = new Set([2, 5])` constant satisfies the actual request today with no schema, no form field, no migration, no test churn. Per-plan persistence is only worth it once a *second* break pattern actually exists (a different school, or a plan that genuinely wants different breaks). Building the column now is speculative generality:
- It adds a create-form control to a dialog whose copy currently emphasizes simplicity ("The grid is fixed for the lifetime of the plan").
- It needs `clone_plan` SQL changes, type regen, and new integration assertions — real cost for a value nobody has asked to vary.
- **Recommendation: ship the hardcoded constant. Promote to a per-plan column only when a concrete second pattern appears.** §C is the receipt for how cheap that promotion stays (one nullable column) — which is *itself* the argument for deferring it: it won't get harder later.

**4. The hardcoded constant's one weakness: it assumes ≥6 periods.** Breaks after P2 and P5 are meaningful for `5x10` and `5x8` but a break "after P5" is a no-op on a `5x6` grid (fine) and weird if someone runs a tiny grid. Guard the spacer with `period < periods` so it never renders a trailing break below the last row. Trivial, but worth stating so it isn't missed.

**Net position:** Build #1 (hardcoded visual break, one file). Document #C as the cheap, deferred next step. Refuse the preset-customization framing outright.

---

## Code References

- [`src/_pages/plan-detail/ui/grid/PlannerGrid.tsx:75,125`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/ui/grid/PlannerGrid.tsx#L125) — `periodList` build + the `periodList.map` row loop: the **only** place a visual break belongs.
- [`src/_pages/plan-detail/ui/grid/SlotCell.tsx:174`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/ui/grid/SlotCell.tsx#L174) — `useDroppable({ data: { day, period, cohort } })`: drop identity is data, not position.
- [`src/_pages/plan-detail/model/collision/cell-key.ts:10`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/model/collision/cell-key.ts#L10) — opaque `cellKey(day, period)`: the constraint-safety anchor.
- [`src/_pages/plan-detail/model/collision/collisions.ts:33,86`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/model/collision/collisions.ts#L33) — hot-path validation, `cellKey`-bucketed.
- [`src/_pages/plan-detail/model/drop-hints.ts:88-91`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/model/drop-hints.ts#L88-L91) — sparse, bounds-agnostic drag what-if.
- [`src/_pages/plan-detail/model/placement/duplicate-target.ts:63-69`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/model/placement/duplicate-target.ts#L63-L69) — the lone period-count/contiguity dependency (safe under pure-visual).
- [`src/shared/lib/grid/grid.ts:10,12,27`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/shared/lib/grid/grid.ts#L10) — `GRID_BOUNDS`, `PRESET_RE`, `parseGridPreset` (the single preset interpreter).
- [`src/shared/config/grid-presets.ts`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/shared/config/grid-presets.ts) — the closed `["5x6","5x8","5x10"]` enum + Zod gate.
- [`supabase/migrations/20260602185012_minimal_domain_schema.sql:91-100,120-126`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/supabase/migrations/20260602185012_minimal_domain_schema.sql#L91-L100) — `plans` table (text preset, no JSON) + `placements` day/period CHECKs.
- [`src/_pages/plans-list/ui/PlanFormDialog.tsx:72-136`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plans-list/ui/PlanFormDialog.tsx#L72-L136) + [`create-plan.ts:7-11`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plans-list/api/create-plan.ts#L7-L11) — create flow (where a future break field would thread).
- [`src/_pages/plan-detail/api/load.ts:54,128-134`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/api/load.ts#L54) + [`model/drag.ts:37-46`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/plan-detail/model/drag.ts#L37-L46) — preset read → `{days, periods}` → board props.
- [`src/shared/lib/slot-labels/period-label.ts:2`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/shared/lib/slot-labels/period-label.ts#L2) — `periodLabel = (period) => \`P${period}\``.

## Architecture Insights

- **Opaque-coordinate discipline pays off here.** Because `(day, period)` is treated as an identity token end to end — `cellKey` strings, data-keyed droppables, integer DB columns with range CHECKs — a presentational change (a gap between rows) is *provably* decoupled from logic. This mirrors the repo's lesson [*"keep identity as opaque tokens, keep display concerns at the edges"*](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/context/foundation/lessons.md). A visual break is the display edge; it should never reach the token.
- **`display:contents` rows are why this is a one-liner.** Had the grid used explicit `grid-template-rows` / per-cell `grid-row`, every insertion would shift row math and the change would be invasive. The current rendering choice makes spacer injection free.
- **The preset is app-layer policy, not data-layer law.** The DB column is free text; only `gridPresetSchema` gates it. Expanding presets needs *zero* migration — which cuts both ways: it's cheap, but its cheapness is also why deferring it costs nothing.
- **ARIA grid contract is the real (small) constraint.** ui-conventions mandates strict `role="grid"`/`row`/`gridcell` semantics; the safe break is a `role="presentation"`/`aria-hidden` spacer, consistent with the existing empty-corner cell.
- **Semantic theme tokens only.** Per the standing lesson, the break band uses `bg-background`/`bg-border`, never palette colors.

## Historical Context (from prior changes)

- [`context/foundation/archive/2026-06-18-prd.md:108-109`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/context/foundation/archive/2026-06-18-prd.md#L108-L109) — **original FR-008**: preset selected at creation from a small enumerated set, "fixed for the lifetime of the plan in MVP; bespoke editing is deferred." Rationale explicitly judged presets sufficient for the one target school. (The live PRD reuses the *number* FR-008 for an unrelated combined-view rule — cite the archive for the grid semantics.)
- [`context/foundation/prd.md:88-89`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/context/foundation/prd.md#L88-L89) — "Slot grid = `(day, period)` only … No week / fortnight dimension." The project repeatedly protects grid simplicity.
- [`context/archive/2026-06-07-app-shell/research.md:89`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/context/archive/2026-06-07-app-shell/research.md#L89) — preset is "set once at plan creation, fixed for life … a property of the plan, **not** a live selector."
- [`context/archive/2026-06-11-multi-variant-management`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/context/foundation/prd.md) (plan-review F3) — where the canonical `grid-presets.ts` enum was introduced; before that the DB column was plain text with no app-side list.
- [`context/foundation/roadmap.md:213`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/context/foundation/roadmap.md#L213) — "Custom slot-grid editor (presets only)" sits in **Parked**, unsequenced.
- **Breaks are a greenfield concept.** An exhaustive grep for `break|lunch|recess|spacer|divider|morning|afternoon` across all of `context/` found only this change's `change.md`. No prior domain discussion of breaks exists — there is no precedent to contradict, and no precedent demanding more.

## Related Research

None yet — this is the first research artifact under `context/changes/breaks-between-periods/`. The closest analog is the recurring "board readability" thread, historically about the two-cohort *combined view* ([`prd.md:457`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/context/foundation/prd.md#L457), Open Question on column density), not within-day period structure.

## Open Questions

1. **Do the requesting users actually read the board as morning/mid/afternoon blocks?** If yes, the break is well-targeted. If they just want "easier to scan," zebra striping or a heavier rule every Nth period helps more rows for the same cost. Worth a one-line confirmation before committing to *fixed* positions.
2. **Hardcoded `{2, 5}` vs. configurable now?** Recommendation is hardcoded (§ Devil's Advocate #3). Confirm there's no near-term second school/plan that needs different breaks; if there is, the per-plan column (§C) is the cheap promotion path.
3. **Mirror breaks into the teacher-availability dialog grid?** ([`TeacherAvailabilityDialog.tsx:84`](https://github.com/dobrek/ib-timetable-planner/blob/afd0f9f99b9144c38d6a82eff177a00176650efa/src/_pages/teachers/ui/TeacherAvailabilityDialog.tsx#L84)) Same render-only treatment, independent decision — only if the visual inconsistency bothers users.
4. **Print/export.** If the board is ever printed/exported (CSV export is an open PRD question), confirm the spacer degrades gracefully — `aria-hidden` presentational rows are usually correct to drop from data exports.
