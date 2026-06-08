---
date: 2026-06-08T14:59:50+02:00
researcher: Dobromir Kropielnicki
git_commit: 4a642d230616bdce69101247e690242ed3452167
branch: main
repository: dobrek/ib-timetable-planner
topic: "Course merge builder — UI options to close the loop on S-02"
tags: [research, codebase, course-merges, course-catalog, ui, merge-builder]
status: complete
last_updated: 2026-06-08
last_updated_by: Dobromir Kropielnicki
---

# Research: Course merge builder — UI options to close the loop on S-02

**Date**: 2026-06-08T14:59:50+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 4a642d230616bdce69101247e690242ed3452167 (`4a642d2`)
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

Course Catalog (S-02) has just been implemented; the **merge builder** was postponed within that slice to keep it focused. What options do we have for the UI of the merge builder so we can close the loop on S-02? (Per scope alignment: survey UI options **and** settle the merge domain model — the hours/direction invariant — since the UI shape depends on it. Keep the focus on the `/courses` authoring screen, noting downstream touchpoints.)

## Summary

The merge builder is **almost pure UI + a thin mutation layer** — the schema, the read-path scaffolding, the algorithm consumption, and the entire CRUD convention already exist. There is **no new migration**.

Two things were genuinely unsettled and are now resolved by evidence:

1. **The hours/direction invariant.** The seed data + grouping algorithm prove the model: a **merge parent is a virtual composite course** (no student choices) that carries the **derived composite level** (`AB+SL`), the **teacher**, and an **independently-authored hours value**; the **children are atomic courses** that students actually choose and that carry their own real hours. The prior-research claim that "merge children carry `hours_per_week = 0`" (`course-catalog/research.md:50`) is **false as a general rule** — 8 of 9 seed children carry real hours; only one carries 0 (a group taught entirely inside the merged session). Identify merge children via `course_merges`, **never** via `hours = 0`.

2. **Child sharing is many-to-many in the actual data.** The seed has children belonging to two parents at once (`52815d91`, `ef05b3ef` under both `a78e6a9c` and `778cafff`). The schema permits it (`unique(parent, child)` on the pair only). Whether the builder *allows* this is a real design fork, not a settled fact — flagged below as Open Question 1.

For the UI itself, the **overlap manager is a near-exact precedent** (both are "pick existing courses to form a relation"), and every primitive needed already exists. The recommended shape is a **dedicated "Merge builder" dialog** opened from a header button, with a **multi-select child picker**, a **live-derived parent preview** (name + composite level), an **hours input**, and edit/delete via a **"Manage merge" kebab item** on parent rows.

## Detailed Findings

### A. The merge domain model — RESOLVED against seed + algorithm

Ground truth from `supabase/seed.sql` (`course_merges` at L133–144 cross-referenced to `courses` at L28–111 and `student_choices`):

| Cohort | Parent (level, hours, choices) | Children (level, hours, choices) |
| --- | --- | --- |
| Y1 | Spanish B **SL+HL** (`a78e6a9c`, h2, **0 choices**) | SL `52815d91` (h**0**, 7) · HL `ef05b3ef` (h2, 4) |
| Y1 | Spanish B **AB+SL+HL** (`778cafff`, h2, **0 choices**) | AB `4d8bf50a` (h2, 4) · SL `52815d91` (h0, 7) ¹ · HL `ef05b3ef` (h2, 4) ¹ |
| Y1 | German B **AB+SL** (`99237874`, h4, **0 choices**) | AB `1b589504` (h2, 4) · SL `c66fa51e` (h2, 2) |
| Y2 | Spanish B **SL+HL** (`6d223bca`, h4, **0 choices**) | SL `b9673d56` (h2, 3) · HL `cc958a7d` (h2, 2) |
| Y2 | German B **AB+SL** (`141555da`, h2, **0 choices**) | AB `1f3bb0f9` (h2, 2) · SL `599f7eb0` (h2, 3) |

¹ Shared children — belong to two Y1 Spanish parents simultaneously.

**Invariant (evidence-backed):**

- **Direction**: `parent_course_id → child_course_id`. Parent = virtual/composite (0 student choices in 5/5 families). Children = atomic, student-chosen.
- **Hours**: children hold their **real** hours; the parent holds its **own, independently-authored** hours for the combined session — **not** a sum or max (Y2 German parent h2 with children h2+h2 disproves sum=4 and max=2 → it's an authored 2). `hours = 0` is a valid sentinel only for a child taught entirely inside the parent session.
- **Teacher**: lives on the **parent** and, in every seed family, is shared by all children. The grouping algorithm reads `parent.teacher_id` for collision (`src/lib/grouping/adapters/supabase.ts:54`).
- **Composite level**: `parent.level` = children's levels joined with `+` (`SL+HL`, `AB+SL`, `AB+SL+HL`). A **derived output**, never free-typed — matches the S-02 decision (`course-catalog/research.md:139`).
- **Students**: parent's effective students = **union** of children's choices (`supabase.ts:56`).
- **`group_index`**: merges operate at **0** (`scripts/gen-seed.mjs:341-342`).

Provenance: the merge CSV fixtures carry **no hours** — `merge_subjects.csv` is 4 columns (`parent_name, parent_level, child_name, child_level`). Hours/teacher are sourced from `teachers_subjects.csv` by `(name, level)`; `scripts/gen-seed.mjs` defaults an absent hours field to **4** and preserves explicit `0` (`gen-seed.mjs:34-39, 121-131`).

### B. How merges flow downstream (compatibility constraints)

- **Grouping algorithm** (`src/lib/grouping/adapters/supabase.ts:24-65`): builds **virtual courses**, one per merge parent — `{ id: parentId, teacherKey: parent.teacher_id, hours: parent.hours_per_week, studentKeys: union of children's students }`. Regular courses = only those with direct student choices, so **parents are excluded as regular but added as virtual**; **children appear both** as their own regular course *and* rolled into the parent's virtual student set. Zero-hours warning is **suppressed for merge children** (`supabase.ts:158-172`).
- **Collision** (`src/lib/grouping/collision.ts:3-13`): same id / same non-null teacher / shared student. The parent virtual course is what enforces "the whole combined session can't double-book."
- **Placement / validator** (`src/lib/placements/validate.ts:8-40`, `src/lib/planner/load.ts:57-99`): a placement row points at a single `course_id` with **no merge awareness** — and that id can be a merge parent (placed as one tile). Direction lives entirely in `course_merges`. Hours completeness treats 0-hour merge children as complete-from-the-start (`src/lib/planner/hours.ts:9-13, 27-31`).

**Implication for the builder**: it only writes `course_merges` (+ creates/maintains the parent course row). It must keep the algorithm's assumptions true: parent has the teacher + hours + composite level + 0 choices; children keep their choices. No algorithm change is required if the builder produces parents in the seed's shape.

### C. The UI reuse surface (what already exists)

- **Read path** — `src/pages/courses.astro:20-43,64`: five parallel Supabase loads; the merge query selects **only `parent_course_id`** today (`courses.astro:28`) and sets `isMerged = mergeParentIds.has(c.id)` per course. A builder wanting to show membership must also select `child_course_id`.
- **Island** — `src/components/courses/CourseCatalog.tsx`: header (`:70-79`) holds the single `New course` button → **natural home for a `New merge` sibling button**. Dialogs are mounted once at island root and opened via state (`:122-146`) → a `MergeBuilderDialog` slots in identically. The "Merged" badge renders inline beside the name in `CourseTable` (`:183`); the row kebab `CourseRowActions` (`:248-282`) lists Edit / Manage overlaps / Delete → **add a "Manage merge" item** for `isMerged` rows, parallel to "Manage overlaps".
- **Closest precedent — overlap manager** `src/components/courses/CourseOverlaps.tsx`: a `Dialog` keyed per target course; candidate courses computed (same cohort, exclude self/already-linked); persists via `actions.createOverlap`/`deleteOverlap`; **in-memory live update** so the dialog stays open (`onOverlapsChange` → `CourseCatalog.updateOverlaps:62-66`). Create/edit/delete instead use the `navigate()` refresh (`CourseFormDialog.tsx:121`).
- **Mutation convention** — `src/actions/index.ts`: every handler is `defineAction({ input: <zod>, handler })` + `requireSession` + `requireSupabase` + `23505 → CONFLICT` mapping. `createOverlap` (`:111-149`) pre-fetches both courses and enforces **same cohort** — the exact pattern merge validation should mirror. The deferral is documented at `actions/index.ts:32-35`.
- **Schemas** — `src/lib/schemas/course.ts`: `courseInput`, `updateCourseInput`, `overlapInput`. A `mergeInput` schema is net-new here.
- **Forms** — `src/components/courses/CourseFormDialog.tsx:60-121`: `useForm + zodResolver(shared schema, mode:"onTouched")`, shadcn `<Form>` fields, `isInputError`→`form.setError` funnel, `navigate()` on success. The merge form mirrors this.
- **shadcn inventory** — `src/components/ui/`: `dialog, popover, command, select, dropdown-menu, table, tabs, badge, alert-dialog, button, form, input, label, sonner` all present. The multi-select picker can reuse the **popover+command** combo (`TeacherFilter.tsx:33-70`) or **select+chips** (`CourseOverlaps.tsx`). Only **possible** net-new primitives: `checkbox` and/or `scroll-area` (only if a checkbox list / long candidate list is chosen).

### D. UI options for the merge builder

All four are buildable on the existing surface; they differ in interaction model and how well they expose the composite/many-to-many nature.

**Option A — Dedicated "Merge builder" dialog (recommended).**
A `New merge` button beside `New course` opens a dialog scoped to the active cohort. Author multi-selects 2+ atomic children (popover+command, like `TeacherFilter`); the dialog **live-derives** the parent name (shared subject name) and composite level (`AB+SL`), shows them as a read-only preview, and collects **teacher** (default = children's shared teacher, error if they differ) and **hours**. Confirm runs one `createMerge` action that creates the parent course + the `course_merges` links. Edit/dissolve via a `Manage merge` kebab item on parent rows.
- *Pros*: closest to the resolved model (merge = pick children → derive parent + set hours/teacher); reuses the overlap-manager + form patterns almost verbatim; single clear entry point; composite level is a controlled output, never typed.
- *Cons*: needs a small **multi-row transaction** (parent course + N links) and edit semantics (re-deriving level when membership changes).

**Option B — Kebab-driven "Merge with…" from a course row.**
From an atomic row's kebab, "Merge with…" opens a picker of sibling candidates; confirming creates/extends the parent.
- *Pros*: incremental, minimal new surface.
- *Cons*: weak at showing the composite-as-a-whole and the derived preview; awkward for 3-way merges; obscures "which courses form this session."

**Option C — Grouped/nested presentation + manage panel.**
Render merge parents in the table with their children **nested/expandable** (or a dedicated "Merges" section), each with a manage affordance. Authoring still happens in an A-style dialog.
- *Pros*: best visualization of composites and the many-to-many sharing; turns today's "stray `AB+SL` row" (`course-catalog/research.md:142,165` open sub-point) into a first-class group.
- *Cons*: more presentation work; changes the table model. Best layered **on top of** Option A, not instead of it.

**Option D — Inline table affordance only.**
Keep the flat table; add a per-parent expander showing children and an "Add/remove child" inline.
- *Pros*: no dialog.
- *Cons*: inline editing of a derived composite is fiddly; poor fit for create-new.

**Recommendation**: **Option A** for authoring (it matches the resolved model and reuses the most), optionally **layered with Option C's nested presentation** to fix the long-standing "composite row reads as an oddball" sub-point. This is one slice, ~mirroring the overlap-manager effort plus the parent-course creation.

## Code References

- `supabase/seed.sql:133-144` — `course_merges` seed rows (the 5 families; evidence for the invariant)
- `supabase/migrations/20260602185012_minimal_domain_schema.sql:59-66` — `course_merges` table, `unique(parent, child)` only (permits many-to-many child sharing)
- `src/pages/courses.astro:28` — merge read selects only `parent_course_id` (extend to `child_course_id` for membership)
- `src/pages/courses.astro:40-43,64` — `mergeParentIds` set + `isMerged` projection
- `src/components/courses/CourseCatalog.tsx:70-79,122-146,248-282` — header button home, dialog mount point, row kebab
- `src/components/courses/CourseOverlaps.tsx` — closest relational-authoring precedent (picker + actions + in-memory live update)
- `src/components/courses/CourseFormDialog.tsx:60-121` — RHF + zodResolver + isInputError + navigate() form pattern
- `src/actions/index.ts:32-35,111-149` — deferral note; `createOverlap` same-cohort validation pattern to mirror for merges
- `src/lib/schemas/course.ts` — schema module (add `mergeInput`)
- `src/lib/grouping/adapters/supabase.ts:24-65,158-172` — virtual merge-parent construction; zero-hours suppression for children
- `src/lib/grouping/collision.ts:3-13` — collision rule the parent virtual course enforces
- `src/lib/planner/hours.ts:9-13,27-31` — 0-hour merge child = complete-from-start
- `src/lib/placements/validate.ts:8-40` — placements are merge-agnostic (parent placeable as one tile)
- `scripts/gen-seed.mjs:34-39,121-131,333-351` — hours default 4 / preserve 0; merges resolved at `group_index=0`
- `data/dp1/merge_subjects.csv`, `data/dp2/merge_subjects.csv` — 4-col fixtures, no hours; dp1 has a 3-way `AB+SL+HL`

## Architecture Insights

- **The builder writes only `course_merges` + the parent course row.** It does not touch the algorithm, validator, or placements — they already consume merges correctly. Keep parents in the seed's shape (teacher + authored hours + composite level + 0 choices) and nothing downstream changes.
- **Composite level is a derived output, not an input** — consistent with the existing decision to keep `level` as permissive text with the `{SL,HL,AB,none}` enum only on the atomic form (`lessons.md`, `course-catalog/research.md:136,139`).
- **Reuse, don't reinvent**: the overlap manager + course form + action skeleton cover ~all of the mechanics; the net-new is `mergeInput`, `createMerge`/`deleteMerge`(/`updateMerge`), one `MergeBuilderDialog`, a header button + kebab item, and (if live membership is wanted) projecting `child_course_id` into the read path.
- **Mutation style**: form CRUD → Astro Actions (per `lessons.md` rule), not API routes.

## Historical Context (from prior changes)

- `context/changes/course-catalog/plan.md:7,39,75` — merge builder explicitly **deferred**; S-02 only renders merges read-only; "hours/direction invariant is unsettled and gets its own slice."
- `context/changes/course-catalog/change.md:15-21` — Phase 2 deviation: merge guard **removed**, parents/children both editable, "Merged" badge display-only beside the name; constraints deferred here.
- `context/changes/course-catalog/research.md:37,50,139,142,165` — the merge model discussion; **note `:50` is the now-disproven "children = 0 hours" claim**, while `:37` is directionally correct. `:142,165` flag the open "how to present a composite parent so it doesn't read as an oddball" sub-point (Option C addresses it).
- `context/changes/minimal-domain-schema/plan.md:56,109-111,173-174` — why `level` is permissive text; composite merge-parent levels; `course_merges` as a virtual combined session.
- `context/changes/port-grouping-algorithm/` — established the opaque-id virtual-course mechanism the builder must keep valid.
- `context/foundation/roadmap.md:38,135-144` — FR-003 (overlap **+ merge**) lives in **S-02**; there is **no separate merge-builder slice** on the roadmap. Closing this loop completes S-02's FR-003.
- `context/foundation/lessons.md` — three standing rules apply: port the mechanism / opaque ids; semantic tokens only; Astro Actions for form CRUD.

## Related Research

- `context/changes/course-catalog/research.md` — S-02 research (CRUD convention, merge model first pass, Option A merge-UX sketch)

## Decisions (resolved 2026-06-08)

1. **Child sharing → many-to-many ALLOWED.** A child course may belong to several merge parents (matches the seed and the `unique(parent,child)`-only schema). The picker offers already-merged courses as valid children; no app-level one-parent-per-child enforcement.
2. **Teacher → single shared teacher REQUIRED.** All selected children must share one teacher; the parent inherits it. The builder validates this and **blocks** a merge of courses with differing teachers (matches every seed family and the grouping algorithm's `parent.teacher_id` collision read at `src/lib/grouping/adapters/supabase.ts:54`). The teacher is therefore derived, not separately picked.
3. **Dissolve → DELETE the orphan parent too.** Dissolving a merge removes the `course_merges` links **and** the now-childless composite parent course row. Children (atomic courses) are untouched. No stray composite-level rows linger.
4. **Presentation → Option A only (builder dialog).** Ship the `New merge` dialog + `Manage merge` kebab; merge parents keep today's flat "Merged" badge row. Smallest slice that closes S-02's loop. (Option C nested/grouped presentation deferred — the "composite-row-as-oddball" sub-point stays open for a later polish slice.)

### Folded-in defaults (recommendations, not separately asked — override if needed)

- **Same-cohort REQUIRED** for parent and all children (mirrors `createOverlap`'s same-cohort check, `src/actions/index.ts:117-133`).
- **Parent created transactionally** with its links: one `createMerge` action creates the composite parent course (derived level, 0 choices, authored hours, shared teacher) **and** the N `course_merges` rows. On membership edit, re-derive the parent's composite level; children are not recomputed.
- **Child hours left untouched on merge** — the author controls a child's standalone hours on the atomic course form. The builder does **not** auto-zero children; a 0-hour child means "taught only inside the merged session" and remains a deliberate author choice.
- **Constraints enforced by the builder**: ≥ 2 children; distinct child levels; same cohort; single shared teacher; `group_index = 0` on the parent.

## Open Questions

_All blocking questions resolved above. Remaining items are downstream polish, not blockers:_

- **Composite-row presentation** (the "`AB+SL` row reads as an oddball" sub-point from `course-catalog/research.md:142,165`) is deferred with Option C — revisit as a later polish slice.
