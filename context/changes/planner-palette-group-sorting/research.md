---
date: 2026-06-14T00:00:00+02:00
researcher: Dobromir Kropielnicki
git_commit: a93ae043f35d5f01dafc9c82bbdb648466c3490e
branch: main
repository: dobrek/ib-timetable-planner
topic: "Deterministic sorting of planner-palette groupings by total students, then course count, with the student total shown in the box header"
tags: [research, codebase, plan-detail, planner-palette, groupings, sorting, coverage-count]
status: complete
last_updated: 2026-06-14
last_updated_by: Dobromir Kropielnicki
---

# Research: Deterministic planner-palette group sorting + student total in header

**Date**: 2026-06-14T00:00:00+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: a93ae043f35d5f01dafc9c82bbdb648466c3490e
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

The group list in the planner palette has no deterministic sort — from the user's
perspective the boxes appear in a random order. We want to:

1. Order the boxes by **total number of students** (defined as the *sum of the number
   of students for each subject in the group*) — **descending**.
2. Then by **number of courses in the group** — **descending**.
3. Additionally, show the **total number of students in the box header**.

What does this change mean in terms of **model**, **UI**, and **data availability**?

## Summary

**The metric you asked for already exists, fully computed and already in the palette's
hands.** The "total students = sum of each subject's student count" value is exactly
`PlannerGrouping.coverageCount` — it is defined precisely that way (a *sum*, with
intentional double-counting of a student who takes two subjects in the same group),
it is persisted in `course_groupings.coverage_count`, and it is already loaded onto
every grouping the palette renders. The secondary key, "number of courses," is just
`grouping.memberIds.length`, also already present.

So the answer to "what does this mean for model / data availability" is: **almost
nothing.** No model change, no `load.ts` change, no new island props, no catalog
threading, no migration, no new derivation. Both sort keys are already on
`PlannerGrouping` at the palette render site.

The change collapses to **two small UI/rendering edits**:

1. **Sort** the grouping list by `coverageCount` desc → `memberIds.length` desc →
   a stable final tiebreaker (recommended: `id`). Today nothing sorts this list.
2. **Render** `coverageCount` in the `GroupingBox` header alongside the existing
   "N courses".

**Why it looks random today:** the load query has no `ORDER BY`, the rows come back in
dedup-encounter order keyed by random UUID PKs, and the palette renders that array
verbatim. The grouping *compute core* does sort deterministically (`score` desc →
`coverageCount` desc), but that ranking is dropped at the persistence boundary and
never reconstructed for display.

**One caveat to decide on:** `coverageCount` double-counts a student across the
subjects they take *within the same group* (this is by design and matches your
definition exactly). If the header labels it "students," note the number is really
"student-subject enrollments / seats," not unique heads. See [Open Questions](#open-questions).

> ⚠️ One sub-agent proposed building a new `useGroupStudentCounts` hook that computes a
> **unique union** of students (`new Set(...).size`). That would (a) contradict your
> stated definition — you asked for a *sum*, not a union — and (b) needlessly recompute
> a value that already exists. **Do not add it.** Reuse `coverageCount`.

## Detailed Findings

### 1. The requested "total students" metric is already `coverageCount`

`coverageCount` is computed as the literal sum of per-member student counts:

- `score.ts:12` — `const coverageCount = set.reduce((acc, c) => acc + c.studentKeys.length, 0);`
- This is the legacy algorithm's `students` metric, ported verbatim, explicitly a
  *sum of per-course student counts with cross-course duplicates, NOT a unique union*.
- Proven by `score.test.ts:18-25` (comment: "s1 appears in both — counted twice"):
  courses A=`["s1","s2"]`, B=`["s1","s3"]` → `coverageCount = 4`.

Each course's `studentKeys` is itself already a deduped set of the students taking that
subject (union of direct choices + overlap dependents, `unique()`-ed), and merge-child
courses are folded into their parent with de-dup, so `studentKeys.length` per course =
unique students for that subject. Summing across members = your definition exactly.

It is present on the type the palette consumes:

- `model/grouping.ts:20-25` — `PlannerGrouping = { id; memberIds; coverageCount; score }`.
- `load.ts:70-75` — built directly from the DB: `coverageCount: row.coverage_count`,
  `memberIds: row.course_grouping_members.map(m => m.course_id)`.

So **both sort keys** the feature needs — `coverageCount` (students) and
`memberIds.length` (courses) — are already on each grouping at render time.

### 2. Current palette order is unsorted — the "random" symptom explained

The order users see is an accidental artifact, not a deliberate one:

- **No `ORDER BY` at load.** `load.ts:48-53` selects `course_groupings` filtered only by
  `plan_id` + `cohort`; the array is a plain `.map()` over the rows (`load.ts:70-75`).
  Postgres returns rows in unspecified physical order without an `ORDER BY`.
- **Random-UUID PKs + dedup-encounter insertion order.** Rows are written by
  `persist.ts:37-52` (`toDistinctMemberSets`) in first-seen order while scanning seeds,
  each with a `gen_random_uuid()` PK (`20260602185012_minimal_domain_schema.sql:131-139`).
  There is **no ordinal / rank / student-count column** on `course_groupings` or
  `course_grouping_members`.
- **The palette renders the array verbatim.** `PlannerPalette.tsx:27` maps
  `visibleGroupings` straight to `<GroupingBox>`. The only transform is the
  leading-course *filter* (`useLeadingFilter`, `PlannerPalette.tsx:35-41`), which
  preserves array order. A grep confirms **no `.sort()`/`.toSorted()` touches
  `PlannerGrouping[]`** anywhere in `api/`, `ui/`, or `model/`.

The compute core *does* sort, but only intra-seed and only before dedup:
`compute-groupings.ts:9-21` orders variants by `score` desc → `coverageCount` desc →
member-id tiebreak. S-01 research even *described that as the palette ranking*
(`first-valid-drop-with-validation/research.md:106`), but the team chose to render the
palette from the DB after reload (single render path), and the deduped table has no rank
column to persist the order into — so the ranking was computed, returned, and dropped.

### 3. Data availability — everything needed is already in scope

Full client-side data flow (confirmed end to end):

- `load.ts` loads the full catalog `GroupingCourse[]` (with `studentKeys`) **and** the
  `PlannerGrouping[]` (with `coverageCount` + `memberIds`), and returns both in
  `PlannerBoardProps` (`load.ts:96-112`; `catalog` at line 109, `groupings` at 103).
- `PlanDetailPage.astro` spreads `boardProps` into `<PlannerBoard client:load />`.
- `PlannerBoard.tsx:35` destructures `catalog`, `groupings`, `names`; it forwards
  `groupings`, `names`, `hours` to `PlannerPalette` (`PlannerBoard.tsx:126`).

So at the palette, **`grouping.coverageCount` and `grouping.memberIds.length` are already
available** — no new prop is required for either the sort or the header. The full catalog
(with `studentKeys`) is *also* available one level up in `PlannerBoard`, but you don't
need it: recomputing from the live catalog would diverge from the persisted grouping's
identity and re-introduce threading for no benefit.

### 4. Where to apply the sort (decision for the plan)

| Option | Where | Pros | Cons |
|---|---|---|---|
| **A — pure `model/` fn, applied in palette** *(recommended)* | new `sortGroupingsForPalette(groupings)` in `model/`, called (memoized) in `PlannerPalette` before the filter | Pure, unit-testable, FSD-clean; matches the "filter is purely a rendering concern" comment (`PlannerPalette.tsx:14-16`); no persistence/migration; deterministic regardless of DB order | Sort lives client-side (fine — it's a display concern) |
| **B — sort the JS array in `load.ts`** | after building `groupings` at `load.ts:70-75` | Single source of order on the server | Couples ordering to load; less unit-testable (load is integration-tested); any other consumer must re-sort |
| **C — SQL `ORDER BY`** | the load query | DB-native | Can do `coverage_count DESC` but the **secondary key (course count) is not a column** — it's a count of `course_grouping_members` rows, needing an aggregate/join. Cannot cleanly express the 2-key sort. Not recommended |

Recommendation: **Option A** — a small pure function in `model/` (newspaper order, `type`
shapes, co-located `*.test.ts`), applied with a `useMemo` in `PlannerPalette`. Sort first,
then filter (the leading-course filter preserves order).

### 5. Header display

`GroupingBox.tsx:47` currently renders `<span>{grouping.memberIds.length} courses</span>`
inside the header (which is also the group drag handle since the `group-dragging` change
made the whole header draggable). Adding the student total is a one-line render of
`grouping.coverageCount` — no new prop. The `group-dragging` plan explicitly flagged that
the bare "N courses" headers are *"indistinguishable"* — so surfacing the student total
directly addresses a previously-noted UX weakness.

Formatting options (a plan-time choice): inline `"3 courses · 47 students"`, or a
right-aligned count mirroring the existing hours-counter pattern (`ml-auto shrink-0
tabular-nums`, `GroupingBox.tsx:96-101`), optionally with a lucide `Users` icon. Use
semantic tokens only (per the project lesson).

### 6. Determinism / tie-breaking

The two user keys (`coverageCount` desc, then `memberIds.length` desc) do not by
themselves guarantee a total order — two groups with the same (students, courses) pair
would still float. Add a **stable final tiebreaker** for full determinism. Cleanest:
`id` ascending (the grouping UUID, stable across reloads). Alternatively mirror the
compute core's `compareVariants` tiebreak (sorted member-id join, `compute-groupings.ts`)
for consistency with the algorithm. This is the main open decision (see below).

### 7. `score` vs the requested order

Note the requested order **leads with students** (`coverageCount`), whereas the legacy
intra-seed ranking led with `score` (hours-similarity, `score.ts:7-11`) and used
`coverageCount` only as a tiebreak. `score` is unrelated to student totals; the feature
should ignore it. The palette is a flat, deduped, plan-cohort-global list anyway
(`multi-variant-management/research.md:62` — `course_groupings` is per-`(plan, cohort)`,
shared across variants), so a global sort by student count is a coherent, user-meaningful
ordering distinct from the old per-seed ranking.

## Code References

- [`src/_pages/plan-detail/model/grouping.ts:20-25`](https://github.com/dobrek/ib-timetable-planner/blob/a93ae043f35d5f01dafc9c82bbdb648466c3490e/src/_pages/plan-detail/model/grouping.ts#L20-L25) — `PlannerGrouping` type: already carries `coverageCount` + `memberIds`.
- [`src/_pages/plan-detail/model/score.ts:12`](https://github.com/dobrek/ib-timetable-planner/blob/a93ae043f35d5f01dafc9c82bbdb648466c3490e/src/_pages/plan-detail/model/score.ts#L12) — `coverageCount` = sum of `studentKeys.length` (the requested metric, with intentional double-count).
- [`src/_pages/plan-detail/model/score.test.ts:18-25`](https://github.com/dobrek/ib-timetable-planner/blob/a93ae043f35d5f01dafc9c82bbdb648466c3490e/src/_pages/plan-detail/model/score.test.ts#L18-L25) — proves sum-not-union semantics.
- [`src/_pages/plan-detail/api/load.ts:48-75`](https://github.com/dobrek/ib-timetable-planner/blob/a93ae043f35d5f01dafc9c82bbdb648466c3490e/src/_pages/plan-detail/api/load.ts#L48-L75) — no `ORDER BY`; builds `PlannerGrouping[]` with `coverageCount`/`memberIds`.
- [`src/_pages/plan-detail/ui/PlannerPalette.tsx:18-41`](https://github.com/dobrek/ib-timetable-planner/blob/a93ae043f35d5f01dafc9c82bbdb648466c3490e/src/_pages/plan-detail/ui/PlannerPalette.tsx#L18-L41) — renders groupings verbatim; `useLeadingFilter` preserves order. **Sort insertion point.**
- [`src/_pages/plan-detail/ui/GroupingBox.tsx:38-48`](https://github.com/dobrek/ib-timetable-planner/blob/a93ae043f35d5f01dafc9c82bbdb648466c3490e/src/_pages/plan-detail/ui/GroupingBox.tsx#L38-L48) — header shows "N courses". **Student-total render point.**
- [`src/_pages/plan-detail/ui/PlannerBoard.tsx:35,126`](https://github.com/dobrek/ib-timetable-planner/blob/a93ae043f35d5f01dafc9c82bbdb648466c3490e/src/_pages/plan-detail/ui/PlannerBoard.tsx#L35) — `groupings` in scope; forwarded to palette (no prop change needed).
- [`src/_pages/plan-detail/model/compute-groupings.ts:9-21`](https://github.com/dobrek/ib-timetable-planner/blob/a93ae043f35d5f01dafc9c82bbdb648466c3490e/src/_pages/plan-detail/model/compute-groupings.ts#L9-L21) — the existing intra-seed sort (`score` desc → `coverageCount` desc) that is dropped before the palette.
- [`src/_pages/plan-detail/api/persist.ts:37-52`](https://github.com/dobrek/ib-timetable-planner/blob/a93ae043f35d5f01dafc9c82bbdb648466c3490e/src/_pages/plan-detail/api/persist.ts#L37-L52) — dedup-encounter insertion order written to the table.
- [`src/shared/lib/catalog-hash/types.ts:8-13`](https://github.com/dobrek/ib-timetable-planner/blob/a93ae043f35d5f01dafc9c82bbdb648466c3490e/src/shared/lib/catalog-hash/types.ts#L8-L13) — `GroupingCourse` shape (`studentKeys: string[]`, no precomputed count).
- [`src/shared/api/load-cohort-courses.ts:51-72`](https://github.com/dobrek/ib-timetable-planner/blob/a93ae043f35d5f01dafc9c82bbdb648466c3490e/src/shared/api/load-cohort-courses.ts#L51-L72) — how `studentKeys` is unioned/deduped; merge-children folded into parents.
- `supabase/migrations/20260602185012_minimal_domain_schema.sql:131-147` — `course_groupings` (`coverage_count`, `score`, random-UUID PK) + `course_grouping_members` (no ordinal column).

## Architecture Insights

- **Both display sort keys already live on the persisted grouping.** This is a *display*
  feature over data that exists — not a model or data feature. Resist the urge to
  recompute student counts from the live catalog; the persisted `coverageCount` is the
  grouping's own identity-consistent value.
- **`coverageCount` semantics are "subject-enrollments," not "unique heads."** The name is
  slightly misleading; the value intentionally double-counts students across subjects in a
  group. This matches the user's stated definition but should drive the UI label wording.
- **Staleness is handled elsewhere.** `coverageCount` reflects the catalog snapshot at
  grouping-compute time; the `catalog_hash` / `api/staleness.ts` machinery recomputes
  groupings when the catalog drifts, so displaying the persisted value stays consistent
  with the rest of the grouping data.
- **A pure `model/` sort function fits the slice's conventions** (newspaper order, `type`
  shapes, co-located tests, "filter/sort are rendering concerns" already stated in the
  palette) and keeps the change client-only with zero persistence risk.

## Historical Context (from prior changes)

- `context/archive/2026-06-04-port-grouping-algorithm/plan.md:27,59,162` &
  `research.md:51` — `score` (hours-similarity) and `coverageCount` (sum of per-course
  student counts, *with duplicates*) ported from the legacy Bun algorithm; designed for
  **intra-seed variant ranking**, not global palette display order.
- `context/archive/2026-06-05-first-valid-drop-with-validation/research.md:37,106,129` &
  `plan.md:22,25,136` — S-01 *described* the palette ranking as `score` desc → `coverage`
  desc, but chose to render from the DB after reload; the deduped `course_groupings` table
  has no seed/rank/ordinal column, so the ranking was dropped at persistence.
- `context/archive/2026-06-12-group-dragging/plan.md:5,14-22,78` — removed the header
  collapse toggle, made the whole header a drag handle, and explicitly flagged that
  "'N courses' headers are indistinguishable" — motivating a richer header.
- `context/archive/2026-06-11-multi-variant-management/research.md:62` — `course_groupings`
  is per-`(plan, cohort)` and shared across a plan's variants, so any ordering change is
  plan-cohort-global, not variant-specific.

## Related Research

- `context/archive/2026-06-04-port-grouping-algorithm/research.md` — the grouping
  algorithm, `score`/`coverageCount`/`rank` definitions.
- `context/archive/2026-06-05-first-valid-drop-with-validation/research.md` — original
  palette / grouping-card render decisions.

## Open Questions

1. **Final tiebreaker** (main decision): after `coverageCount` desc → `memberIds.length`
   desc, what guarantees a total order? Recommended: `id` asc (stable). Alternative:
   sorted member-id join, mirroring `compareVariants`.
2. **Header label wording**: call it "students" (matches the user's mental model) or
   something more precise like "seats"/"enrollments" given the intentional double-count?
   Recommendation: keep "students" per the request; document the double-count semantics.
3. **Sort location**: confirm Option A (pure `model/` fn applied in the palette) over a
   server-side persisted order. Recommended: A — no persistence change needed.
4. **Header format**: inline `"N courses · M students"` vs a right-aligned counter with a
   `Users` icon (mirroring the hours-counter pattern). Token-based styling only.
5. **Persisted vs live count**: confirm we display the persisted `coverageCount` (yes —
   identity-consistent; staleness handled by `catalog_hash`) rather than recomputing from
   the live catalog.
