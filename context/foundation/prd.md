---
project: "IB Schedule Planner"
version: 2
status: draft
created: 2026-05-19
updated: 2026-06-11 # v2 amendment: per-plan variants overturned — plans become cloneable whole-domain scenarios (change: multi-variant-management)
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: tbd
  data_volume: tbd
timeline_budget:
  mvp_weeks: 8
  hard_deadline: null
  after_hours_only: true
  soft_milestone: "internal preview demo at the school"
---

# PRD — IB Schedule Planner

## Vision & Problem Statement

Building a timetable for an IB (International Baccalaureate) programme is structurally different from a regular high school schedule. Students individually choose their own subject set (level, language, options), so there are no fixed homeroom classes; the schedule spans two year-cohorts (Year 1 and Year 2) that share teachers and the same slot grid. A plan author at one IB-offering high school must find slot assignments where overlapping courses do not collide for any student, any teacher, or any teacher-availability rule — across the full two-cohort programme, simultaneously. Today, a standalone algorithm reads four CSV files (student–subject choices, teacher–subject assignments, subject overlaps, subject merges) and emits a ranked list of "course groupings that could be held in the same slot without collision"; the author then opens that list in a general-purpose spreadsheet and **manually drags those groupings onto a slot grid**. There is no automatic check that a placement remains valid as the grid fills up: collisions are caught visually, late, and re-doing a placement is expensive.

The combinatorial step already produces compatible groupings. What remains — placing those groupings on a slot grid, sequencing the work across two cohorts, exploring multiple parallel plans before committing — is interactive, visual, and constraint-driven, but is being done in a tool that knows nothing about students, teachers, or availability and therefore cannot validate. A purpose-built editor with live multi-constraint validation collapses the workflow: the author drops a grouping on a slot, the app immediately responds with valid or with the specific class of collision, and the timetable converges by feel rather than by spreadsheet bookkeeping.

## User & Persona

**Primary persona — Plan Author.** A teacher or administrator at one IB-offering high school who is responsible for producing the year's timetable. There are a small number of such authors at the school (today: ~handful, possibly working in parallel on competing plans for the same school year before one is adopted). They have substantial domain knowledge about the IB programme structure (SL/HL levels, language groups, overlap and merge dependencies), are comfortable with spreadsheets, and currently invest significant unstructured time arranging the grid by hand. They reach for this product at the start of each school year, and again after any subsequent shift in student choices, teacher availability, or course offerings, when the timetable has to be (re)built.

Students, teachers, school administration, and parents are NOT primary personas. Students' choices and teachers' availability are captured upstream and entered into the app by the author; no self-service flows are in scope for MVP.

## Success Criteria

### Primary

A plan author can take a fresh school year — students, teachers, courses, and choices for two IB cohorts (Year 1 and Year 2) — and produce a complete, collision-free timetable plan covering both cohorts end-to-end inside the app, faster and with fewer last-mile fixes than the current "algorithm + spreadsheet" workflow.

The reference first-session shape:

1. Author signs in.
2. Author creates a plan: a name plus a slot-grid preset (e.g., Mon–Fri × 8 periods). On a fresh instance the plan starts blank; once any plan exists, **cloning an existing plan is the primary path** to a new one.
3. Author seeds the plan's catalog: creates students (or imports them from CSV) and their choices for both cohorts; creates teachers and their course assignments; declares teacher availability rules; declares course dependencies (overlaps, merges).
4. The author works on **Year 1 first**. The app computes "compatible course groupings" for Year 1 and offers them as draggable building blocks.
5. Author drags Year 1 groupings onto slots. At every drop, the app validates the placement against Year 1 student collisions, Year 1 teacher collisions, and teacher-availability violations, and gives immediate feedback.
6. Once Year 1 is stable, the author moves to **Year 2** within the same plan. Year 1 placements now act as **fixed teacher-occupancy constraints**: a teacher already teaching in slot S for Year 1 cannot be placed in slot S for Year 2.
7. When both cohorts are fully placed, the plan is complete — plans are peers; there is no separate "final" mark.
8. Author exports the plan as a master-grid CSV (slot × course, with cohort distinguishable).

### Secondary

Authors can keep multiple plans in parallel — typically by cloning an existing plan and editing the clone's catalog and placements independently — so different scheduling scenarios can be explored side by side before the school adopts one.

### Guardrails

- **Validation is never wrong-positive.** A placement the app marks as valid must actually be collision-free for students, teachers, and availability. False negatives (the app flagging a non-collision) are an acceptable v1 cost; false positives (silently accepting a real collision) are not.
- **Student-choice data is never silently mutated.** Authors can edit catalog entities; student choices imported from CSV are treated as ground truth and any modification must be explicit.
- **The product is functional without dependency on third-party scheduling or optimization services.** The grouping computation and validation belong to the application itself; there must be no external scheduling service in the critical path.

## User Stories

### US-01: End-to-end first plan (Year 1 then Year 2)

- **Given** a plan author has signed in to a freshly seeded instance with no plans yet
- **When** they:
  - (a) create a plan and choose a slot-grid preset,
  - (b) create the plan's Year 1 and Year 2 students and choices via the UI (optionally seeded from CSV import),
  - (c) populate the plan's catalog with teachers, course assignments, availability rules, and course dependencies (overlap + merge),
  - (d) work on Year 1 first: drag compatible Year 1 groupings onto slots, accepting only drops the live validator marks valid, until all Year 1 slots required by the cohort are placed,
  - (e) switch to Year 2 within the same plan: drag Year 2 groupings onto slots under the additional constraint that teacher slots occupied in Year 1 are now unavailable,
  - (f) cover all slots required by both cohorts' choices
- **Then** the plan is collision-free for every student in both cohorts, every teacher across both cohorts, and every availability rule; and the master-grid CSV export reflects the placed timetable with cohort distinguishable

### US-02: Parallel plans

- **Given** a plan author has an in-progress plan they don't want to disturb
- **When** they clone it into a second plan
- **Then** both plans exist independently — each with its own catalog (students, teachers, courses, choices, dependencies) and its own Year 1 and Year 2 placements — and can be edited in parallel without either affecting the other

## Functional Requirements

### Authentication

- FR-001: Author can sign in with email and password. Priority: must-have
  > Socratic: Counter-argument considered: "auth is overkill for a small private deployment." Resolution: stands — email + password is the lowest-friction model that still keeps a per-author identity for plan attribution.

### Catalog: courses, teachers, dependencies

- FR-002: Author can manage the course catalog (create, edit, delete). A course is identified by the triple `(name, level, group-index)`, where `level ∈ {SL, HL, AB, none}` and `group-index ∈ {1, 2, none}`. Examples: `(English B, HL, 1)`, `(English B, HL, 2)`, `(CAS, none, 1)`, `(TOK, none, 2)`, `(Computer Science, SL, none)`. Priority: must-have
  > Socratic: Counter-argument considered: "level enum is too rigid." Resolution: stands — the (level, group-index) tuple matches the existing data shape and the IB programme structure. The IB Group attribute (Group 1–6) is captured as an Open Question.
- FR-003: Author can declare course dependencies of two kinds: (a) **overlap** — two same-subject different-level courses that may share slot fragments (e.g., Polish A SL / Polish A HL); (b) **merge** — different-level groups taught together as one (e.g., German B AB+SL). Priority: must-have
  > Socratic: Counter-argument considered: "overlap and merge could be one unified concept." Resolution: kept separate — they have distinct semantics in collision rules (overlap = share fragments; merge = one combined slot). Unifying them risks losing the distinction.
- FR-003A: Author can declare number of hours (1hour = slot) per week for given subject. Priority: must-have
- FR-004: Author can manage teachers (create, edit, delete) and assign each teacher to one or more courses (where a course is the `(name, level, group-index)` triple from FR-002). Priority: must-have
  > Socratic: Counter-argument considered: "missing hours-per-week or preferred-time constraints." Resolution: kept minimal for MVP. Captured as Open Questions for downstream consideration.
- FR-005: Author can declare teacher availability rules — slots a given teacher cannot be scheduled into. Priority: must-have
  > Socratic: Counter-argument considered: "soft preferences (prefer morning, prefer non-consecutive) are needed too." Resolution: hard exclusions only in MVP; soft preferences captured as Open Question.

### Student data

- FR-006: Author can manage students and their course choices via the UI — create a student, add or remove course choices for that student (each choice is a course as defined in FR-002). This is the **primary path** for entering student data. Priority: must-have
  > Socratic: Counter-argument considered: "the cohort is large; UI-only entry will be slow." Resolution: kept as primary path per author preference; CSV import (FR-007) is the bulk seeding alternate.
- FR-007: Author can bulk-import student choices from a CSV matching the existing `students_subjects.csv` shape (student name, course, level, optional group-index). This is an **optional alternate path**, useful for seeding existing data from the prior CSV-based workflow. Priority: must-have

### Plan, grid, cohorts, placement

- FR-008: At plan creation, the author selects a slot-grid preset from a small enumerated set (e.g., `Mon–Fri × 6 periods`, `Mon–Fri × 8 periods`). The grid is fixed for the lifetime of the plan in MVP; bespoke editing is deferred. Priority: must-have
  > Socratic: Counter-argument considered: "schools vary too much; presets won't fit." Resolution: presets cover the immediate target (one IB high school); a custom grid editor is in Open Questions.
- FR-009: A plan spans **two cohorts** — Year 1 and Year 2 of the IB programme — that share the slot grid and the teacher pool. The author builds the Year 1 cohort first; once Year 1 placements are stable, Year 1 acts as a **fixed constraint set** when the author starts placing Year 2 (slots in which a teacher already teaches a Year 1 course are unavailable to the same teacher in Year 2). Priority: must-have
- FR-010: Author can manage plans as complete scenarios (catalog + placements). A new plan is created blank (name + grid preset) or — the primary path — by cloning an existing plan, deep-copying its entire catalog, placements, and groupings into an independent new plan. Plans can be renamed and deleted; deleting a plan removes its whole scenario. Priority: must-have
  > Socratic: Amended in v2 (2026-06-11). v1 promised per-plan draft variants; user conversations showed the real what-if axis is the catalog (student/teacher changes), not placements within a fixed catalog — so the cloneable unit became the whole plan. Parallel what-if exploration remains a core need; it now happens across plans, not within one.
- FR-011: Author can place courses (or compatible course groupings) onto slots by drag-and-drop within the current cohort of the current plan, and can remove or move placements. Priority: must-have
  > Socratic: Counter-argument considered: "keyboard-only / click-to-place alternatives." Resolution: drag-and-drop is the stated UX premise ("like solving a puzzle"); alternatives captured as Open Question.
- FR-012: On every drop, the app validates the placement against (a) student collisions, (b) teacher collisions within the current cohort, (c) teacher collisions against the _other cohort's fixed placements_, (d) teacher availability rules — and reports the outcome immediately in the UI. Priority: must-have
  > Socratic: Counter-argument considered: "block-invalid-drops vs. flag-and-allow." Resolution: deliberate ambiguity preserved here; resolution path is in Open Questions — both options are defensible, and the choice is worth deciding during design review.
- FR-013: App computes ranked "compatible course groupings" from current catalog state (scoped to the current cohort) and exposes them as draggable building blocks alongside the grid. Priority: must-have
  > Socratic: Counter-argument considered: "defer ranking to v2." Resolution: kept — ranking is what makes the algorithm output usable; without it the author drowns in options.

### Export

- FR-014: Removed in v2 (2026-06-11). Plans are peers — no plan carries a "final" mark. Priority: —
  > Socratic: v1 required "exactly one variant per plan as final"; the `is_final` flag was never read or written by shipped code, and the variant level it marked is gone. Surfacing the best candidate via derived quality metrics (valid / complete / used slots) on the plans hub is a future extension; which plan the school actually adopts is a social fact recorded outside the tool for now.
- FR-015: Author can export **any plan** as a master-grid CSV (slot × course), with cohort distinguishable in the output. Priority: must-have
  > Socratic: Amended in v2 (2026-06-11). With no final mark, restricting export to a "final" artifact has no anchor; export applies to any plan. This dissolves former Open Question 10 (draft export).

## Non-Functional Requirements

- **Validation responsiveness.** When the author drops a course grouping on a slot, the validation outcome is visibly reflected in the UI fast enough to preserve the "solving a puzzle" feel — target ≤ 200 ms user-perceived response at p95 for a cohort of typical size (one IB year, ~50–150 students, ~30–60 courses).
- **Work durability.** Author work in progress (catalog edits, placements, plan state) survives accidental session interruption — page close, refresh, or local crash — without loss of placed work. The user must always be able to return to where they left off.
- **Data privacy.** Student names and their individual course choices are treated as personally identifying. Only authenticated authors can access this data; export files are produced only on explicit author action.
- **Single-source-of-truth integrity.** Once a CSV import has been applied, subsequent edits in the UI become the new source of truth — re-importing the same CSV later must not silently overwrite UI-edited data without explicit author intent.

## Business Logic

**Domain rule (one sentence).** The application continuously applies two paired rules over the current catalog and placement state: a **recommendation rule** that produces a ranked list of course groupings whose members can be taught simultaneously without collision, and a **validation rule** that judges whether any proposed placement of such a grouping on a specific slot remains collision-free given everything else placed so far.

**Inputs the rules consume** (from the author's point of view):

- The catalog: every course with its `(name, level, group-index)` identity, the course dependencies (overlap groups, merge groups), every teacher with their course assignments and availability rules.
- The cohort under construction (Year 1 or Year 2), and — when the cohort is Year 2 — the fixed placements already made for Year 1 (which constrain teacher availability).
- Every student's chosen set of courses.
- The current slot-grid preset and all current placements in the plan under construction.

**Output the rules produce.**

- The **recommendation rule** emits a ranked list of compatible course groupings ("compatible groupings"). Each entry is a set of courses that can share one slot without collision in the current cohort; entries are scored (student coverage count and fractional score, matching the existing algorithm's output shape) so the author sees the most useful groupings first.
- The **validation rule** emits a judgment per drop: valid (no collision under any class — student / teacher in cohort / teacher across cohorts / availability) or invalid (with the specific class(es) of violation named).

**How the author encounters the rules in the product flow.**

- The author opens a plan, picks a cohort. The recommendation rule's output appears as draggable building blocks beside the grid; the highest-scored groupings are at the top.
- The author drags a grouping onto a slot. The validation rule fires at the drop moment. The grid responds immediately — accepting visually, or flagging with the violation class — without a perceptible wait.
- When the author moves between cohorts within the same plan, the recommendation and validation rules re-evaluate against the new cohort scope while honoring the other cohort's fixed placements.

This is what the existing CSV + spreadsheet workflow lacks: a general-purpose spreadsheet knows about cells, not about students / teachers / availability, so it cannot validate; the existing algorithm produces a one-shot ranked list with no feedback loop once the author starts placing.

## Access Control

**Sign-in.** Email + password authentication. Each plan author has an individual account.

**Roles.** A single role in MVP:

- **Author** — can create, clone, rename, and delete plans; can edit each plan's catalog (students, teachers, courses, choices, availability); can import and export.

A read-only Viewer role was considered and explicitly dropped from MVP; it appears in Open Questions as a v2 candidate.

**Identity scope.** All accounts belong to one school's instance; there is no cross-school tenancy in the MVP. Unauthenticated access is rejected at every gated route.

## Non-Goals

The MVP explicitly does NOT include:

- **End-to-end automatic timetable optimization.** Solving the full scheduling problem fully automatically is out of scope. The app computes ranked compatible groupings and validates placements; it does NOT auto-place courses on slots.
- **Room / location validation.** MVP validates students, teachers, and teacher availability. Rooms are assigned after the timetable is set, outside this tool.
- **Student-facing and teacher-facing self-entry flows.** Authors enter all data. No student portal for choice submission; no teacher self-service for availability declarations.
- **Multi-school SaaS tenancy.** One school per instance.
- **Custom slot-grid editor.** Grid presets only (e.g., Mon–Fri × 6 or × 8 periods). Bespoke day-count and per-period-label editing is deferred.
- **Printable / PDF export.** CSV only.
- **Cross-plan comparison view.** Multiple plans exist in parallel (the author can switch between them), but no side-by-side diff UI.
- **Mobile-optimized UX.** Laptop browser is the target form factor.
- **Read-only Viewer role.** Considered and dropped from MVP scope; v2 candidate (see Open Questions).

## Open Questions

1. **`target_scale.qps`.** Shape-notes captured `users: small` but not the qps ballpark. Owner: user. Block: no — defaults to "low" for downstream sizing unless resolved.
2. **`target_scale.data_volume`.** Same gap. Owner: user. Block: no — defaults to "small" for downstream sizing unless resolved.
3. **Viewer role.** Dropped from MVP per shaping. Is a read-only role still desired for v2? If so, what does a Viewer see — all plans, or a chosen subset? Owner: user. Block: no.
4. **IB Group attribute.** Should each course carry its IB Group (1–6) attribute, in case the algorithm later needs it for stricter compatibility rules? Owner: user. Block: no.
5. **Teacher hours-per-week constraint.** Some teachers can teach a subject but only up to N hours per week. Out of scope for MVP — needed in v2? Owner: user. Block: no.
6. **Teacher soft preferences.** Prefer morning vs. afternoon, prefer non-consecutive slots, etc. Hard exclusions only in MVP; soft preferences are an open extension. Owner: user. Block: no.
7. **Custom slot grids.** MVP uses presets only; a bespoke grid editor (custom day count, custom period count and labels) is deferred. Owner: user. Block: no.
8. **Drop UX policy.** When a drop creates a collision, does the app (a) block the drop entirely, (b) accept the drop and flag the violation until resolved, or (c) prompt the author? Owner: user / design. Block: yes — FR-012 cannot ship until this is decided.
9. **Finalize gate.** Resolved in v2 (2026-06-11): dissolved — FR-014's final mark is removed; plans are peers, so there is nothing to gate. Block: no.
10. **Draft export.** Resolved in v2 (2026-06-11): dissolved into amended FR-015 — any plan can be exported; the final/draft distinction no longer exists. Block: no.
11. **Keyboard / accessibility parity.** Should drag-and-drop have a keyboard-only alternative for accessibility? Owner: user. Block: no — MVP can ship drag-only and add later.
12. **Multi-school / cross-school.** No multi-tenancy in MVP; if a second school later wants to use the same instance, what does that look like? Owner: user. Block: no.
