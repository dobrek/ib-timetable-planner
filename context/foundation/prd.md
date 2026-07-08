---
project: ib-timetable-planner
version: 1
status: draft
created: 2026-06-18
context_type: brownfield
product_type: web-app
target_scale:
  users: small
timeline_budget:
  delivery_weeks: 6
  hard_deadline: null
  after_hours_only: true
---

# PRD — IB Timetable Planner (post-demo feedback change)

> Brownfield change PRD, generated from `context/foundation/shape-notes.md`
> (shaped from end-user feedback after the first demo,
> `docs/users-feedback/19-06-26.md`). The greenfield product PRD that defined
> the shipped system is archived at
> `context/foundation/archive/prd-2026-06-18-1646.md`.

## Current System Overview

> Baseline this change is described against. Names real technologies — it
> describes reality, not a stack choice. Grounded in the live codebase
> (2026-06-18).

**Purpose.** An interactive IB timetable editor: a plan author drags compatible
course groupings onto a two-cohort slot grid with live, sub-200 ms constraint
validation — replacing the prior "algorithm output + manual Excel" workflow.

**Architecture & stack.** Astro 6 + React 19 islands on Cloudflare Workers
(workerd), Supabase (Postgres) for persistence, Tailwind v4, TypeScript v6. The
two-cohort constraint/validation core lives in `src/_pages/plan-detail/model/`.

**Users.** A few plan authors at one IB-offering liceum. Email + password auth;
single `Author` role.

**Core functionality today.**

- **Domain root is `Plan`.** The earlier "multiple variants per plan" concept
  was retired — `plan_variants` was dropped (migration
  `20260611180006_plans_as_domain_root.sql`); a Plan now owns its catalog
  (teachers, courses, students, choices, overlaps, merges, placements,
  groupings, availability) directly.
- **Two cohorts, values `dp1` / `dp2`.** Display labels are currently
  **"Year 1" / "Year 2"** (`src/shared/config/cohorts.ts`).
- **Single-cohort board.** The planner loads one cohort at a time —
  `BOARD_COHORT = "dp1"` is hardcoded (`src/_pages/plan-detail/api/load.ts`).
  There is **no combined two-cohort view** and **no cross-cohort
  teacher-occupancy constraint** — the Y1→Y2 fixed-order model described in the
  original PRD was never actually implemented.
- **Course → single teacher.** A course carries one nullable `teacher_id` (one
  teacher per course).
- **Placement = one course in one cell.** Placements are keyed
  `(plan_id, cohort, day, period, course_id)`; a placed grouping is decomposed
  into independent per-course placements, not stored as a unit.
- **"Bundle" is a state flag, not an entity.** `isBundled = occupantCount ≥ 2
  && !overridden` (`slot-bundle.ts`); a `slot_bundles` table records explicit
  opt-outs. A whole-slot move deletes + recreates individual placements — the
  bundle is **not** a movable, persistent object, and there is **no temporary
  holding container**.
- **Constraint core (within-cell).** Registered cell constraints:
  `duplicate-course`, `teacher-conflict`, `student-conflict`,
  `teacher-availability` (`constraints/index.ts`). Drag-drop validation
  (`drop-hints.ts`) classifies each cell free / partial / blocked / warn under
  the sub-200 ms budget.
- **Slot grid = `(day, period)` only.** Each slot is a single weekly period
  (e.g. `5×10` = Mon–Fri × 10 periods). **No week / fortnight dimension.**
- **CSV export.** Specified in the original PRD but **not yet implemented** in
  the codebase (no export endpoint found). CSV files under `data/dp1`,
  `data/dp2` are inbound seed fixtures only.

## Problem Statement & Motivation

> Delta-framed: what's changing and why.

**The gap.** The product was demoed to its end users. Design and core
functionality were well received, but the demo surfaced six places where the
tool's model diverges from how authors actually work and how the IB domain
actually behaves. Left unaddressed, these force authors back toward
spreadsheet-style workarounds for the exact cases the tool exists to remove.

**Why now.** This is the first real-user feedback after the build. Aligning the
tool with the authors' mental model and domain reality *before* further
development is cheaper than layering more features on a diverging foundation.

**The six asks** (full detail resolved in Scope of Change and Business Logic
Changes):

1. **Co-teaching** — a single course can be run by two teachers (rare but
   real); both teachers must count as occupied for collision purposes.
2. **Bi-weekly (fortnightly) courses** — a course runs some hours in week A,
   nothing in week B, then resumes; two fortnightly courses of opposite weeks
   can legitimately share one slot.
3. **DP1 / DP2 naming** — authors call the cohorts "DP1" / "DP2", not
   "Year 1" / "Year 2".
4. **No fixed cohort start order + free switching** — authors want to begin
   with either cohort and move between them freely while planning (today the
   board is locked to one cohort).
5. **Combined two-cohort view** — a new view showing both cohorts at once, one
   column per cohort (DP1 | DP2), as the final assembly stage.
6. **Bundles as first-class + a holding container** — authors perceive a placed
   grouping as a "bundle" and operate on it as a unit (move / remove / replace);
   they want to lift a bundle into a temporary external container to free the
   board while preparing a new location for it.

**Insight.** The demo confirmed authors reason in *bundles*, name cohorts
*DP1/DP2*, occasionally *co-teach*, run *fortnightly* courses, and reject a
forced cohort order. This change is domain-fidelity and mental-model alignment,
not capability-for-its-own-sake.

## User & Persona

**Primary persona — Plan Author (unchanged).** A teacher/admin at one IB liceum
responsible for producing the year's timetable; a few such authors at the
school. No new persona and no scale change are introduced by this work.

What changes for them is the *experience*: they gain a final two-cohort assembly
stage (the combined view), bundle-centric manipulation with a holding area, the
freedom to start from and switch between cohorts, and a domain model that can
express co-teaching and fortnightly courses.

## Success Criteria

> Delta-framed; guardrails name existing behaviour that must not regress.
> Non-functional properties from shaping are folded into Guardrails below.

### Primary

A plan author can produce a complete, collision-free timetable across **both
cohorts (DP1 and DP2)** using the enriched domain model, and assemble/review
both cohorts together in a new combined view. The change has succeeded when,
working from an existing plan:

1. Cohorts read as **DP1 / DP2** throughout the UI.
2. The author can open the board on **either** cohort and **switch between DP1
   and DP2 freely** while planning — no forced start order.
3. A course can be **co-taught by two teachers**, and the collision checks treat
   **both** teachers as occupied.
4. A course can be **bi-weekly** (week A / week B): two opposite-week courses may
   share one slot without a false collision, while same-week courses still
   collide.
5. The author manipulates a placed grouping as a **bundle** — move / remove /
   replace as a unit — and can lift a bundle into a **temporary holding
   container** to free the board, then place it elsewhere, all within cohort
   constraints.
6. A **combined view** shows DP1 and DP2 side by side (one column each) as the
   final assembly stage, with placements staying collision-free across students,
   teachers (within *and* across cohorts), and availability — inside the
   sub-200 ms validation budget.

### Secondary

- A parked bundle in the holding container survives a browser refresh (work
  durability extended to the staging area). Nice-to-have, not sufficient alone.

### Guardrails

- **Validation responsiveness (preserved + extended).** Drag-drop validation
  outcome stays within the sub-200 ms budget (≤ 200 ms p95 for a typical cohort)
  even after co-teaching and bi-weekly are folded into the occupancy checks —
  including the combined two-cohort view validating against both cohorts at once.
- **Collision correctness (preserved + extended).** No false-positive "valid"
  across the new dimensions: a slot the app calls valid must be genuinely
  collision-free for students, *both* teachers of a co-taught course, week-aware
  fortnightly overlaps, and cross-cohort teacher occupancy. False positives are a
  regression even if everything else works.
- **Existing single-cohort editing views keep working** — the combined view is
  additive, not a replacement.
- **Existing board-state durability is preserved** — no silent loss of
  in-progress work on an accidental browser refresh or tab close.
- **Combined-view usability.** The two-column DP1 | DP2 view stays readable and
  usable on a typical laptop screen.
- **Privacy (preserved).** Student names and choices remain author-only.
- **CSV export discrepancy.** Export was selected as must-preserve but is not yet
  implemented in the codebase. Either it is genuinely out of scope (drop from
  guardrails) or it must be built *and* represent the enriched model
  (co-teaching, bi-weekly, both cohorts). Routed to Open Questions.

## User Stories

> Delta-framed — each notes what was different before.

### US-01: Assemble a collision-free two-cohort plan in the combined view

- **Given** an author working on an existing plan whose catalog includes a
  co-taught course and a bi-weekly course
- **When** they open the combined view (DP1 | DP2), start on whichever cohort
  they like, switch freely between the two columns, and drag groupings and
  bundles onto slots
- **Then** every placement is validated live (within the sub-200 ms budget)
  against student, teacher (within *and* across cohorts, counting both teachers
  of a co-taught course), week-aware fortnightly, and availability collisions —
  and the author ends with a complete, collision-free plan across both cohorts

> Before: the board was locked to one cohort (`dp1`), cohorts read "Year 1/2", a
> course had one teacher, there was no week dimension, and there was no combined
> view.

### US-02: Park a bundle while rearranging the board

- **Given** an author who needs to free a slot to make room for another bundle
- **When** they lift the occupying bundle off the board into the holding
  container, rearrange other bundles on the board, then drag the parked bundle
  back onto a now-suitable slot
- **Then** the parked bundle is held intact off-board (not flagged while parked),
  and on drop-back it is re-validated within its cohort's constraints

> Before: a whole-slot move decomposed into per-course placements and there was
> no staging area — freeing a slot meant deleting and re-creating placements.

### US-03: Two opposite-week courses share one slot

- **Given** two bi-weekly courses, one on week A and one on week B, with no
  student or teacher in common
- **When** the author places both into the same slot
- **Then** the validator accepts the pair (opposite weeks don't overlap), but
  would flag a third placement that shares a week with either

> Before: any two courses in one slot were tested as simultaneous — there was no
> notion of alternating weeks.

## Scope of Change

> Each item carries a `Change:` tag — `new` (didn't exist), `modified` (existing
> behaviour changes), `preserved` (must keep working unchanged). FR IDs and
> `> Socrates:` blockquotes are preserved verbatim for downstream review.

### Domain model: co-teaching

- FR-001: Author can assign two or more teachers to a single course
  (co-teaching), and every assigned teacher is treated as occupied for
  teacher-conflict and availability checks. Priority: must-have. Change: modified
  > Socrates: Counter-argument considered: "co-teachers may split the class, so
  > only one is in the room at a time — both-occupied is too strict." Resolution:
  > stands — when two teachers run one course they are both committed to that
  > slot; the split-teaching case is not what users reported.

### Domain model: bi-weekly (fortnightly)

- FR-002: Author can mark a course as bi-weekly (fortnightly) and, when placing
  it, choose which fortnight week (A or B) the placement occupies; a weekly
  course occupies both weeks. Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "make the whole plan a fortnight grid
  > instead of a per-course flag." Resolution: stands — weekly and fortnightly
  > courses coexist in one plan, so the fortnight attribute belongs on the
  > course/placement, not the entire grid.
- FR-003: The placement validator is week-aware — it permits two opposite-week
  fortnightly courses to share one slot, and flags any week overlap (two
  same-week courses, or any clash with a weekly course). Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "forbid slot-sharing entirely to avoid
  > grid clutter and correctness risk." Resolution: stands — opposite-week
  > sharing is exactly the capacity gain users asked for; clutter is a display
  > concern, and correctness is held by the guardrail (no false-positive valid).

### Cohort naming

- FR-004: Cohorts are presented as "DP1" and "DP2" throughout the UI, replacing
  the "Year 1" / "Year 2" display labels (the `dp1` / `dp2` data values are
  unchanged). Priority: must-have. Change: modified
  > Socrates: Counter-argument considered: "make cohort names author-
  > configurable rather than a hardcoded DP1/DP2 relabel." Resolution: stands —
  > DP1/DP2 is the standard IB term for this school; a fixed relabel suffices.
  > Configurable names noted as a possible future extension, not this change.

### Cohort navigation & cross-cohort constraint

- FR-005: Author can open the board on either cohort and switch between DP1 and
  DP2 freely at any time while planning — there is no fixed start order.
  Priority: must-have. Change: modified
  > Socrates: Counter-argument considered: "free switching loses the
  > DP1-stable-before-DP2 guard and invites thrashing between half-built
  > cohorts." Resolution: stands — authors explicitly asked to choose either
  > cohort and switch freely; the symmetric constraint (FR-006) makes order
  > irrelevant to correctness.
- FR-006: Teacher **occupancy** is enforced symmetrically across both cohorts and
  is week-aware — a teacher occupied in a given slot and week (in either cohort)
  cannot be placed in that same slot and week of the other cohort, though the
  same teacher may occupy one slot across opposite weeks. Teacher
  **availability** stays week-agnostic (an unavailable slot applies to both
  weeks) and cohort-independent. Priority: must-have. Change: new
  > Socrates: Counter-argument **accepted (refined)**: "teacher availability is
  > not week-aware — it's the same for week A and week B." Resolution: the rule
  > was split. Occupancy/conflict is week-aware and symmetric across cohorts;
  > availability is week-agnostic (unavailable = both weeks) and cohort-
  > independent (unchanged from today). FR text updated accordingly.

### Combined two-cohort view

- FR-007: Author can open a combined view showing DP1 and DP2 side by side, one
  column per cohort. Priority: must-have. Change: new
  > Socrates: Counter-argument **accepted**: "two full grids side by side won't
  > fit a laptop screen — readability suffers." Resolution: kept, but the
  > combined view must use a space-efficient layout (compact/narrower columns,
  > horizontal scroll if needed). Layout/screen-fit routed to Open Questions for
  > design.
- FR-008: The combined view is editable — the author can perform placement and
  bundle operations on either cohort's column, within that cohort's constraints.
  Priority: must-have. Change: new
  > Socrates: Counter-argument **accepted**: "cross-column drags invite
  > accidental cohort moves in a cramped two-grid layout." Resolution: kept
  > editable, but cross-cohort (cross-column) moves are prevented/guarded — a
  > bundle moves only within its own cohort column, consistent with "within
  > cohort constraints."

### Bundles & holding container

- FR-009: A placed grouping is a first-class bundle the author can move, remove,
  or replace as a single unit, within cohort constraints. Priority: must-have. Change: modified
  > Socrates: Counter-argument considered: "'replace' is underspecified — replace
  > with what?" Resolution: stands — replace swaps the bundle's contents for a
  > different compatible grouping on the same slot (detailed in Business Logic
  > Changes); per-course control is retained via FR-010.
- FR-010: Author can ungroup a bundle to operate on its individual courses —
  remove a single course, or move one course to another slot. Priority:
  must-have. Change: preserved
  > Socrates: Counter-argument considered: "per-course ops reopen the
  > fine-grained collision risk bundling was meant to simplify." Resolution:
  > stands — this preserves today's ungroup / opt-out behaviour (the
  > `slot_bundles` override); single-course moves are re-validated like any
  > placement.
- FR-011: Author can lift a bundle off the board into a temporary holding
  container (a shelf that holds multiple parked bundles) and place a parked
  bundle back onto a slot later. Priority: must-have. Change: new
  > Socrates: Observation **accepted (new requirement)**: "this kind of bundle
  > operation reveals a need for an undo mechanism." Resolution: kept; undo/redo
  > captured as new FR-013 and routed to Open Questions for priority/scope, since
  > undo could affect the 4–6 week estimate.

### Preserved behaviour

- FR-012: Existing single-cohort editing boards keep working unchanged, and live
  drag-drop validation stays within the sub-200 ms budget and remains
  collision-correct (no false-positive "valid") across all new dimensions.
  Priority: must-have. Change: preserved
  > Socrates: Counter-argument considered: "the 200 ms budget is the hardest
  > guarantee to keep once co-teaching, bi-weekly, and cross-cohort checks are
  > added — this 'preserved' FR may be aspirational." Resolution: stands —
  > preserved as a hard guardrail; performance of the enriched constraint core is
  > the key delivery risk and is called out in the guardrails.

### Editing safety

- FR-013: Author can undo (and redo) recent editing operations — bundle move,
  remove, replace, ungroup, single-course move, lift-to-container, and
  place-back. Priority: must-have _(provisional — scope/priority unresolved; see
  Open Questions)_. Change: new
  > Socrates: surfaced during the FR-011 challenge — the lift/park/replace
  > workflow is error-prone enough that authors will expect to step back.
  > Priority and depth (single-step vs multi-step history; session-only vs
  > durable) are unresolved and may move the timeline.

## Constraints & Compatibility

> Makes preservation, backward compatibility, and migration needs explicit.

- **Existing plans load and validate unchanged.** New model fields must default
  so existing data behaves identically: a single-teacher course is the
  one-element teacher set; a course with no fortnight flag is weekly (both
  weeks); existing placements with no week tag are treated as weekly.
- **Additive migrations only.** Schema changes (teacher set/junction, course
  fortnight flag, placement week, bundle identity) are additive
  (nullable/defaulted) per the project's migration convention — no destructive
  drops of in-use columns. There is no production data to migrate yet; a code
  rollback does not undo an applied migration.
- **Constraint core is the protected zone.** Work touches
  `src/_pages/plan-detail/model/` (the <200 ms two-cohort constraint core). The
  existing collision classes (duplicate-course, teacher-conflict,
  student-conflict, teacher-availability) keep functioning; new behaviour extends
  them rather than replacing them.
- **Existing per-cohort boards preserved.** The single-cohort board remains; the
  combined view and holding container are additive surfaces.
- **Ungroup / slot-bundle opt-out preserved** (`slot_bundles` override, FR-010).
- **Workers runtime.** Stays within Cloudflare Workers (workerd) — no Node-only
  APIs — for the new constraint logic and any persistence.
- **No access control change** (email + password, single Author role).
- **CSV export** is unresolved (see Open Questions); if built, the master-grid
  export must distinguish cohorts and represent co-teaching + bi-weekly weeks.

## Business Logic Changes

> States the current rule, then the delta. NOT the full domain model.

**Current rule.** The app continuously (a) recommends a ranked list of course
groupings whose members can be taught simultaneously without collision, and (b)
validates that any proposed placement stays collision-free for students,
teachers, and teacher availability. This change **modifies the validation half**
and **adds bundle-as-unit semantics**; the recommendation half is unchanged in
spirit (it must, however, become co-teaching- and week-aware).

**Unified collision rule (week-aware) — new.** Two placements occupying the same
slot collide **only if** they share a resource — a student *or* a teacher —
**and** their weeks overlap. A weekly placement occupies both weeks (overlaps
everything); a fortnightly placement occupies week A or week B, and opposite
weeks never overlap. So two opposite-week fortnightly courses may share one slot
even when they share students or teachers. (Duplicate-course — the same course
twice in one cell — remains blocked regardless of week.)

**Co-teaching — modified.** A course may carry a *set* of teachers (one or more).
For teacher-conflict, every teacher in the set occupies the slot/week; a conflict
arises if any of them is shared with another week-overlapping occupant. For
availability, a placement is invalid if **any** of the course's teachers is
unavailable in that slot. Availability is week-agnostic (an unavailable slot
applies to both weeks) and cohort-independent — unchanged from today.

**Symmetric cross-cohort teacher occupancy — new.** Teacher occupancy is shared
across both cohorts and week-aware: a teacher occupied in slot S / week W in
*either* cohort cannot be placed in slot S / week W of the other cohort, though
the same teacher may occupy slot S across opposite weeks. This replaces the
never-implemented one-way "Year 1 fixes Year 2" model with a symmetric one.
Students belong to a single cohort, so student collisions stay within-cohort;
rooms remain out of scope.

**Bundle semantics — new / modified.** A placed grouping is a *bundle*: the set
of courses occupying one slot, treated as a unit with identity.

- **Move** relocates all the bundle's courses atomically to a target slot,
  re-validated at the destination (consistent with the existing drop-hint
  policy); a bundle moves only within its own cohort.
- **Remove** deletes the whole bundle's placements at once.
- **Replace** swaps the bundle's contents for a different compatible grouping on
  the same slot.
- **Ungroup** drops the bundle to individual courses, restoring per-course
  move/remove (today's ungroup / opt-out behaviour — FR-010).
- A bundle lifted into the **holding container** is off-board: it holds no slot
  and is **not validated while parked**; collisions are evaluated only on
  drop-back. The shelf holds multiple parked bundles.

## Access Control Changes

**No access control changes — current model preserved.** Authentication stays
email + password; the single `Author` role is unchanged. Every author retains
full create/edit/delete over the plan and its catalog. The combined two-cohort
view and the holding container are author-only, like the rest of the editor.

## Non-Goals

> Existing-system aspects out of scope for this change, plus new scope
> boundaries.

**New scope boundaries locked for this change:**

- **Arbitrary fortnight cycles.** Bi-weekly is a two-week A/B alternation only —
  no every-third-week, custom rotations, or month-based patterns.
- **Split-teaching.** Co-teaching models both teachers occupying the same slot
  together; it does NOT model teachers splitting a class across different times
  or rooms.
- **Configurable cohort names.** DP1/DP2 is a fixed relabel; cohort names are not
  user-editable.
- **Cross-cohort rooms or students.** The symmetric cross-cohort constraint
  covers teacher occupancy only — not rooms (out of product scope entirely) and
  not students (single-cohort by definition).

**Carried forward from the product's existing non-goals (still out of scope):**

- Room / location validation.
- End-to-end automatic timetable optimization / auto-placement.
- Custom slot-grid editor (presets only).
- Student- and teacher-facing self-entry flows.
- Multi-school / cross-school tenancy.
- Mobile-optimized UX (laptop is the target form factor).
- Printable / PDF export.
- Teacher soft preferences and hours-per-week caps.

## Open Questions

> Routed verbatim from shaping. The skill never invents domain decisions to fill
> gaps.

1. **Undo/redo scope & priority (FR-013).** Surfaced during shaping as a real
   need. Is it must-have for this change or a fast-follow? Single-step vs
   multi-step history? Session-only vs durable across reload? — Owner: author.
   Affects the 4–6 week estimate.
2. **Combined-view layout / screen-fit (FR-007).** Two cohort grids side by side
   strain a laptop screen. Compact columns, horizontal scroll, density toggle, or
   collapse-to-one-column? — Owner: author + design.
3. ~~**CSV export in scope?**~~ **Resolved 2026-07-08 — in scope, as a styled
   XLSX workbook (supersedes "master-grid CSV").** A styled `.xlsx` represents the
   enriched model (both cohorts distinguishable, co-teaching, bi-weekly week tags,
   subject colors, merged headers) in one readable artifact where flat CSV cannot;
   no CSV variant ships. Delivered client-side from the plan-detail board toolbar
   (Combined / DP1 / DP2, active focus first), each workbook also carrying a
   per-cohort subject roster sheet. See `context/changes/export-to-xlsx/`.
   — Owner: author.
