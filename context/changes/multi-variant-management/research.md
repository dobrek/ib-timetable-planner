---
date: 2026-06-11T15:27:52+02:00
researcher: Dobromir Kropielnicki (via Claude)
git_commit: cd571c9f756ec55e6914ef61984af3a7a79d9862
branch: main
repository: ib-timetable-planner
topic: "Replace per-plan variants with a domain-wide version entity scoping the entire catalog, plus version cloning"
tags: [research, codebase, multi-variant-management, versioning, catalog, plan-variants, supabase-schema]
status: complete
last_updated: 2026-06-11
last_updated_by: Dobromir Kropielnicki (via Claude)
last_updated_note: "All open questions resolved (1-9); added follow-up on seeding impact (plan-first generation, two seeded plans) and user-facing UX journey (plans hub with metrics, clone as primary creation path). Ready for /10x-plan."
---

# Research: Domain-wide versioning to replace per-plan variants

**Date**: 2026-06-11T15:27:52+02:00
**Researcher**: Dobromir Kropielnicki (via Claude)
**Git Commit**: `cd571c9f756ec55e6914ef61984af3a7a79d9862`
**Branch**: `main`
**Repository**: `dobrek/ib-timetable-planner`

## Research Question

> Po rozmowie z użytkownikami zdaliśmy sobie sprawę, że obecny model wariantów planów jest zły. Prawdziwe przypadki to nie zmiana grup, ale zmiana dokonywana na poziomie uczniów i nauczycieli — czyli de facto całego katalogu. Przeanalizujmy zmianę w modelu tak, aby wersja była przekrojowa dla całej domeny. Nie będzie potrzeby wtedy wersji na poziomie planu. Dodatkowo możemy wprowadzić opcję klonowania wersji, tak aby tworzenie nowych było łatwe dla użytkownika.

(After user conversations: the real what-if axis is not placements within a plan, but changes at the student/teacher level — effectively the whole catalog. The version should become a domain-wide, cross-cutting entity; plan-level variants then become unnecessary. Add version cloning so creating new versions is easy.)

## Summary

The redesign is **cheaper than it looks on the variant side and well-contained on the catalog side**, because of three facts discovered in this research:

1. **`plan_variants` is nearly dead code.** It exists as a table, but there is no variant CRUD, no variant UI, no plan CRUD, and no clone functionality anywhere in the app. Exactly one plan + one variant are seeded; the plan-detail loader silently picks "first variant of the plan" (`src/_pages/plan-detail/api/load.ts:52-60`) and threads `variantId` only into the placement write path (7 touchpoints total, all in `plan-detail`). `plan_variants.is_final` is never read or written. Dropping per-plan variants deletes almost nothing user-facing.
2. **The catalog is global and un-versioned; every read is a server loader and every write an Astro Action.** There is no client-side query cache or global store. That means the entire app can be version-scoped at exactly two seams: page-frontmatter loaders and `defineDomainAction` (`src/shared/lib/actions/index.ts:11-42`). An active-version cookie resolved in `src/middleware.ts` → `Astro.locals` covers both without changing most Zod input schemas.
3. **The constraint core needs zero changes.** It is pure and in-memory over `GroupingCourse[]` (`src/_pages/plan-detail/model/grouping.ts:1-6`); version scoping only affects the single DB→core adapter `loadCohortCourses` (`src/_pages/plan-detail/api/load-cohort-catalog.ts:23-64`). The <200ms drag-drop budget is unaffected — validation never round-trips.

The main real work is: a new `versions` root table + `version_id` on catalog root tables, version-qualified unique constraints (notably `teachers.code` is globally unique today and would collide on clone), a deep-copy clone RPC with UUID remapping in topological order, a global version switcher in the app shell, and **a PRD/roadmap amendment** — FR-010/FR-014/US-02 explicitly promise *per-plan* variants, so this change deliberately overturns documented product decisions.

## Detailed Findings

### 1. Current data model (the thing being replaced)

All schema lives in 4 migrations; the core one is `supabase/migrations/20260602185012_minimal_domain_schema.sql` (12 tables, RLS = blanket "authenticated full access", no enums, no grants, `moddatetime` triggers).

**FK graph today** (→ = FK; CASCADE unless noted):

```
cohorts ─┬─< courses >── teachers (SET NULL)
         │      ├──< course_overlaps (base, dependent)
         │      ├──< course_merges   (parent, child)
         │      ├──< student_choices >── students >── cohorts
         │      ├──< placements >── plan_variants >── plans
         │      └──< course_grouping_members >── course_groupings >── plans
         ├─< students
         ├─< placements        (denormalized cohort_id)
         └─< course_groupings  (denormalized cohort_id)
```

- Root tables (no parent): **`cohorts`, `teachers`, `plans`**. Everything else hangs off them.
- `plan_variants` (`20260602185012_minimal_domain_schema.sql:103-110`): `plan_id FK`, `name`, `is_final` (dead — never read/written by app code). No uniqueness on `(plan_id, name)`; "one final per plan" is not DB-enforced.
- `placements` (`:116-128`): scoped by `variant_id` + denormalized `cohort_id`; unique `(variant_id, cohort_id, day, period, course_id)`.
- `course_groupings` (`:131-139` + `20260604141212`): keyed by **`plan_id` + `cohort_id`** (not variant) + `catalog_hash` — the grouping palette is per-plan, shared across that plan's variants, because it depends only on the catalog.
- RPC `replace_cohort_groupings(p_plan_id, p_cohort_id, p_catalog_hash, p_groupings)` (`20260604141213_replace_cohort_groupings_fn.sql:15-51`) — atomic delete+reinsert of a plan/cohort's groupings.
- **The only scoping dimension today is `cohort_id`** (Y12/Y13). `teachers` and `plans` are global. The catalog (courses, teachers, students, choices, overlaps, merges) is one shared mutable pool with no plan/variant/version column anywhere.

### 2. How thin the existing variant feature actually is

- **No plan/variant actions exist**: `src/actions/index.ts:6-12` registers only course/teacher/student/placement/grouping actions.
- **No create/clone code anywhere**: the only plan + variant ever created come from the seed generator (`scripts/gen-seed.mjs:253, 388-391` → `supabase/seed.sql:724-727` — "Seed Plan", preset `5x10`, variant "Draft 1").
- **plans-list** is a static Astro anchor list (`src/_pages/plans-list/ui/PlansListPage.astro:22-33`, loader `src/_pages/plans-list/api/loader.ts:8-18`) — no island, no CRUD.
- **Exhaustive `variantId` touchpoint list** (everything that dies or re-keys when plan-level variants go away):
  1. `src/_pages/plan-detail/api/load.ts:52-60, 73, 97` — variant resolution + placement query + prop
  2. `src/_pages/plan-detail/api/placements.ts:11, 40-56` — Zod input + insert/idempotent re-read
  3. `src/_pages/plan-detail/api/placement-client.ts:5, 11` — client wrapper args
  4. `src/_pages/plan-detail/model/drag.ts:15` — `PlannerBoardProps.variantId`
  5. `src/_pages/plan-detail/model/use-placements.ts:19, 35, 59, 75` — hook args + persistence calls
  6. `src/_pages/plan-detail/ui/PlannerBoard.tsx:23-28` — prop destructure
  7. `src/_pages/plan-detail/api/placement-actions.test.ts` — schema fixtures
- **Naming caveat**: `GroupingVariant` / `enumerateVariants` / `scoreVariant` in `src/_pages/plan-detail/model/` are a *different* concept (combinatorial variants of co-runnable course sets, F-03 algorithm) — unrelated to `plan_variants`. Don't conflate them when renaming.

### 3. Target model: `versions` as the domain root

> **Superseded by Decisions §2** (2026-06-11 follow-up): no separate `versions` table will be introduced — `plans` itself absorbs the catalog and becomes the cloneable domain root. This section is kept as the analysis trail; read `version_id` below as the scoping concept that ultimately landed on `plans.id`.

**Proposed shape** (mirrors how `cohort_id` scoping already works — put `version_id` on root tables, let link tables inherit transitively):

```
versions ─┬─< teachers
          ├─< courses   (cohort becomes an enum value column)
          ├─< students  (cohort becomes an enum value column)
          └─< plans ──< placements (re-keyed from plan_variants)
cohorts  — table DROPPED (decision, see Decisions §): replaced by native enum 'dp1' | 'dp2'
```

- **Tables needing a direct `version_id`**: `teachers`, `courses`, `students`, `plans`. The `cohorts` table is dropped (see Decisions §) — its four FK columns (`courses`, `students`, `placements`, `course_groupings`) become a `cohort` native-enum value column, so `versions` is the single root of the FK graph. Leaf/link tables (`course_overlaps`, `course_merges`, `student_choices`, `placements`, `course_groupings`, `course_grouping_members`) inherit a version transitively via FKs.
- **Cross-version integrity**: plain FKs do **not** prevent e.g. a placement in version A pointing at a course from version B. Options: composite FKs `(version_id, course_id)` with matching composite uniques, triggers, or app-level guards mirroring the existing `assertChoicesInCohort` pattern (`src/_pages/students/api/assert-choices-in-cohort.ts:11`) — that guard is the natural template for a same-version gate.
- **`plan_variants` is removed**; `placements.variant_id` re-keys to `plan_id` (plans become the per-version planning container). The unique constraint becomes `(plan_id, cohort_id, day, period, course_id)`.
- **`course_groupings`** can stay keyed by `(plan_id, cohort_id)` or move to `(version_id, cohort_id)` — since groupings depend only on the catalog and the catalog is now per-version, version+cohort scoping would share the palette across all plans within a version (open question below). `replace_cohort_groupings` RPC needs its key parameter updated either way.

**Unique constraints that block cloning today** (must become version-qualified):

| Constraint | Location | Fix |
|---|---|---|
| `teachers.code UNIQUE` (global) | `20260602185012:19` | `UNIQUE (version_id, code)` |
| `cohorts.name UNIQUE` (global) | `20260602185012:8` | moot — cohorts table dropped (Decisions §) |
| `courses_unique (cohort_id, name, level, group_index)` | `20260602185012:39` | becomes `(version_id, cohort, name, level, group_index)` |

`students.full_name` (no unique), `plans.name`, link-table uniques keyed on row UUIDs — all clone-safe after ID remap.

### 4. Cloning a version

No copy/duplicate code exists anywhere — built from scratch. Recommended as a single SQL RPC (mirroring the atomic `replace_cohort_groupings` pattern), deep-copying with UUID remap in topological order:

```
teachers → courses → course_overlaps + course_merges → students → student_choices
  → plans → placements → course_groupings → course_grouping_members
```

- `courses.teacher_id ON DELETE SET NULL` is the only non-cascade FK — the clone must preserve nulls and remap non-nulls within the new version.
- **`catalog_hash` trap**: `computeCatalogHash` (`src/_pages/plan-detail/api/persist.ts:22-35`) fingerprints the canonical `GroupingCourse[]`, which includes course UUIDs. Cloned courses get new UUIDs → copied groupings will read as **stale** via `isGroupingStale` (`src/_pages/plan-detail/api/staleness.ts:13-31`). Decide: recompute the hash inside the clone RPC over remapped IDs, or accept/communicate staleness post-clone.

### 5. App-code blast radius (version threading)

The architecture makes this tractable: server loaders for all reads, `defineDomainAction` for all writes, no client cache. Two propagation strategies:

- **(Recommended) Ambient version**: cookie → `src/middleware.ts` (already populates `locals.user`, `src/env.d.ts:1-5`) → `Astro.locals.versionId` → loaders take it as a parameter; `defineDomainAction` (`src/shared/lib/actions/index.ts:11-42`) resolves it server-side. **Zod input schemas stay unchanged** for most actions.
- Explicit param: thread `versionId` through every schema/client wrapper — more churn (18+ schema/client files), better testability per call.

**Read sites needing version scoping** (full list):
- `src/_pages/courses/api/loader.ts:18-29` (5 parallel queries), `src/_pages/teachers/api/loader.ts:17-32` (3), `src/_pages/students/api/loader.ts:21-28` (5)
- `src/_pages/plans-list/api/loader.ts:9`
- `src/_pages/plan-detail/api/load.ts:34, 43, 53, 66, 71` and `load-cohort-catalog.ts:77, 91, 104, 117` (scoping the courses query at `:77` mostly suffices — downstream queries key off already-scoped course IDs)
- guards/lookups: `students/api/assert-choices-in-cohort.ts:18`, `students/api/update-student.ts:63`, `courses/api/create-merge.ts:16`, `courses/api/create-overlap.ts:10`, `courses/api/assert-merge-parent.ts:10`, `plan-detail/api/grouping-compute.ts:29-30`, `plan-detail/api/staleness.ts:21`, `plan-detail/api/placements.ts:50`

**Write sites**: all course CRUD (`create-course.ts:9`, `update-course.ts:9`, `delete-course.ts:7`, `create-overlap.ts:25`, `delete-overlap.ts:9`, `create-merge.ts:47,62,69`, `dissolve-merge.ts:15`, `update-merge-hours.ts:12`), teacher CRUD (`create-teacher.ts:9`, `update-teacher.ts:9`, `delete-teacher.ts:7`), student CRUD (`create-student.ts:20,29,36`, `update-student.ts:24,37,50`, `delete-student.ts:7`), placements (`placements.ts:43,73`), groupings RPC (`persist.ts:50`).

**New surfaces**: `versions` slice (list/create/clone/delete actions registered in `src/actions/index.ts` + UI), a global version switcher in `src/app/layouts/SidebarLayout.astro` (the only chrome shared by all pages; nav from `src/shared/config/nav.ts:11`). There is no global store — per ui-conventions (`context/foundation/ui-conventions.md:179-184`), version switching should be a server-side concern (cookie + full reload via `refreshPage()` pattern), not client state.

**Loader caps to revisit**: `.limit(500)` (courses/teachers) and `.limit(2000)` with truncation guard (`students/api/loader.ts:67`) assume a single dataset; with N versions the tables grow N×, so version filters become correctness-relevant, not just hygiene.

**Other ripples**: regenerate `src/shared/api/database.types.ts` (committed artifact, manual `supabase gen types` — no package script); update `scripts/gen-seed.mjs` + `supabase/seed.sql` to create a default version and key all rows to it; integration tests that pick "the first seeded plan" (`plan-detail/api/endpoint.integration.test.ts:32`).

### 6. What does NOT change

- **Constraint core** (`src/_pages/plan-detail/model/`): `placement-transitions.ts`, `collisions.ts`, `collision.ts`, `hours.ts`, `grid.ts`, `enumerate.ts`, `score.ts`, `compute-groupings.ts` — all pure over `GroupingCourse[]` / placement state, version-agnostic. The <200ms budget is met client-side over props shipped once per page render (`drag.ts:24`); a version switch is just a new page load.
- **Auth/middleware model**: deny-by-default stays; versions are not per-user (plans have no `created_by`, RLS is blanket-authenticated — multi-author parallel work on different versions is the point, per shape-notes).
- `catalog_hash` staleness mechanism keeps working for free — version-scoped catalogs hash distinctly (modulo the clone trap in §4).

## Code References

- `supabase/migrations/20260602185012_minimal_domain_schema.sql:103-110` — `plan_variants` table (to be removed)
- `supabase/migrations/20260602185012_minimal_domain_schema.sql:116-128` — `placements` keyed by `variant_id`
- `supabase/migrations/20260602185012_minimal_domain_schema.sql:19` — `teachers.code` global UNIQUE (clone blocker)
- `supabase/migrations/20260604141213_replace_cohort_groupings_fn.sql:15-51` — atomic RPC pattern to mirror for clone
- `src/_pages/plan-detail/api/load.ts:52-60` — silent "first variant" resolution (the only variant consumer)
- `src/_pages/plan-detail/api/load-cohort-catalog.ts:23-64` — single DB→constraint-core adapter (the catalog choke point)
- `src/_pages/plan-detail/model/grouping.ts:1-6` — `GroupingCourse`, the core's only input shape
- `src/_pages/plan-detail/api/persist.ts:22-35` — `computeCatalogHash` over course UUIDs (clone staleness trap)
- `src/shared/lib/actions/index.ts:11-42` — `defineDomainAction`, the single write seam for ambient version
- `src/middleware.ts:24-42` — per-request locals, natural slot for active-version resolution
- `src/app/layouts/SidebarLayout.astro` — shared chrome, natural slot for version switcher
- `src/actions/index.ts:6-12` — action registry (no plan/variant actions exist today)
- `src/_pages/students/api/assert-choices-in-cohort.ts:11` — template for same-version integrity guard
- `scripts/gen-seed.mjs:253, 388-391` — only place plans/variants are created today
- `src/shared/api/database.types.ts` — generated types, regenerate after migration

## Architecture Insights

1. **Two-seam scoping**: with no client query cache, server loaders + `defineDomainAction` are the only data seams — an ambient `versionId` (cookie → locals) version-scopes the whole app with minimal schema churn.
2. **Root-table scoping mirrors cohorts**: `version_id` on root tables with transitive inheritance for link tables is exactly how `cohort_id` already works; integrity guards mirror `assertChoicesInCohort`.
3. **Version ≠ user scoping**: RLS stays blanket-authenticated; versions are a collaboration/what-if dimension, not tenancy.
4. **The "variant" name collision**: keep `GroupingVariant` (algorithm concept) distinct from the new domain `version` — per the lessons.md "port the mechanism" rule, keep identity opaque and naming unambiguous.
5. **Plans collapse to simple containers**: with the what-if axis moved to versions, `plans` remains useful as "a slot-grid + placements workspace within a version" — one level, no variants.

## Historical Context (from prior changes)

This change **overturns documented product decisions** — the PRD must be amended, not just the schema:

- `context/foundation/prd.md:110` — **FR-010** (must-have): "Author can create multiple draft variants of one plan… can switch between variants." The Socratic note (`:111`) defended per-plan variants as core. **Overturned**: the what-if axis moves to domain versions.
- `context/foundation/prd.md:74` — **US-02 Parallel variants** (per-plan). **Overturned/re-scoped** to parallel versions.
- `context/foundation/prd.md:146` — **FR-014**: "exactly one variant per plan as final". Needs a decision: does "final" move to the version level?
- `context/foundation/shape-notes.md:48-51` — "a few authors… may work in parallel on different variants of the same plan before one is chosen as final" — the original user insight; new user conversations supersede it.
- `context/foundation/roadmap.md:200-211` — **S-07 multi-variant-management** specified as "surface `plan_variants` in the UI"; "no blockers". This change re-scopes S-07 entirely.
- `context/foundation/roadmap.md:238` — open cross-cohort question (Y1 edits invalidating Y2): unchanged by this redesign — versions bundle both cohorts, like variants did.
- `context/changes/minimal-domain-schema/plan.md:95-96` — variant/cohort scoping was explicitly left as an open design question; the schema was built minimal on purpose.
- `context/changes/first-valid-drop-with-validation/plan.md:22-23` — established "groupings depend on the catalog, not placements; shared across variants" — the same logic now argues for groupings scoped at (version, cohort).
- `context/foundation/lessons.md:5-10` — "Port the mechanism, not the legacy type shape"; `:19-24` — Astro Actions are the single mutation transport (version CRUD + clone must be Actions); `:33-38` — catalog CRUD integration tests are mandatory when the plan lists them (clone RPC will need integration coverage).
- Git history: `plan_variants` was created in the minimal-domain-schema change (commit `0133ae1`), wired read-only in first-valid-drop (`ca51d8f`–`2a16923`); no variant-management commits exist. No production data exists yet (README: "no production data to preserve" — a destructive re-baseline migration is acceptable).

## Related Research

- `context/changes/minimal-domain-schema/plan.md` — original schema rationale
- `context/changes/first-valid-drop-with-validation/plan.md` — variant wiring + grouping/catalog dependency
- No prior `research.md` covers versioning; this is the first artifact on the topic.

## Decisions (2026-06-11 follow-up discussion)

1. **Cohorts (open question 1) — RESOLVED: drop the `cohorts` table; replace with a native Postgres enum `cohort` (`'dp1' | 'dp2'`).** Rationale: DP1/DP2 is truly fixed programme structure (every IB school always has exactly two years) and the value ordering `dp1 < dp2` is the ordering. Consequences accepted:
   - `versions` becomes the single root of the FK graph; cohort can never dangle or cross versions — one less integrity axis, one less clone step/remap.
   - The four `cohort_id` FK columns (`courses`, `students`, `placements`, `course_groupings`) become enum value columns; `courses_unique` → `(version_id, cohort, name, level, group_index)`; `placements_unique` → `(plan_id, cohort, day, period, course_id)`; cohort FK indexes dropped (cardinality 2), composite `(version_id, cohort)` where needed.
   - `replace_cohort_groupings` RPC signature takes the enum value (rewritten for versioning anyway).
   - App: catalog loaders each drop their `cohorts` query; `toOrderedCohorts()`/`CohortOption` placeholder (`src/shared/api/cohorts.ts:12`) deleted in favour of a static config constant + label map (single-sourced, per the `bd606cb` group-enum precedent); the "first cohort by name" hack (`plan-detail/api/load.ts:42-49`) deleted; Zod inputs strengthen `cohortId: z.uuid()` → `cohort: z.enum(['dp1','dp2'])`; URL-synced cohort tabs become readable (`?cohort=dp1`); `gen-seed.mjs` maps `data/dp1|dp2/` directory names directly to enum values.
   - **Native enum over `text` + CHECK** because `supabase gen types` then emits `Database["public"]["Enums"]["cohort"] = "dp1" | "dp2"` — the union flows through all generated row types (lessons.md: let the type system encode invariants). Enum rigidity (no remove/reorder) is acceptable for a declared-fixed set.
   - Accepted trade-off: cohort CRUD is permanently closed (nothing in PRD/roadmap ever asked for it); migration is a re-baseline, acceptable because versioning re-baselines everything anyway and there is no production data.

2. **Plans vs versions (open questions 2, 4, 5) — RESOLVED: no separate `versions` entity; `plans` absorbs the catalog and becomes the cloneable domain root. One board per catalog.** Rationale: user research says the dominant reason a new draft exists is that the data changed — "new draft" and "new catalog state" arrive together. The placement-only what-if is the minority case and is still served by clone-everything (catalog copies are tiny: ~hundreds of students/courses, thousands of choices). The occasional cost of re-applying a late catalog correction across parallel drafts is preferred over the permanent two-level (version → plan) mental model and double create/clone UI surface. Target shape:

   ```
   plans (id, name, slot_grid_preset, timestamps)
     ├─< teachers   (plan_id)
     ├─< courses    (plan_id, cohort enum)  ──< course_overlaps / course_merges
     ├─< students   (plan_id, cohort enum)  ──< student_choices
     ├─< placements (plan_id, cohort, day, period, course_id)  ← re-keyed from variant_id
     └─< course_groupings (plan_id, cohort)  ← already keyed this way; zero re-keying
   plan_variants — DROPPED
   ```

   Consequences:
   - `course_groupings` and the `replace_cohort_groupings` RPC keep their `plan_id` key — no change beyond the cohort enum.
   - `plans-list` slice and `/plans/[id]` route survive as the app's scenario list/landing page; no new "versions" slice, no sidebar switcher widget required.
   - **Clone = full deep copy of a plan** (catalog → placements → groupings, UUID remap in topological order, `catalog_hash` recomputed inside the RPC so cloned groupings don't read as stale). Resolves open question 5.
   - Catalog scoping reaches the UI via the URL, not ambient state — preferred direction: nest catalog routes under the plan (`/plans/[id]/students|courses|teachers`, board at `/plans/[id]`), making scope explicit and shareable with zero hidden state (alternative: keep top-level routes + active-plan cookie; see open question 7).
   - Accepted risk: if one-board-per-catalog proves wrong, re-introducing a board level later is an additive migration (nullable `board_id` on placements, backfill, tighten) on live data — manageable, not free.
   - User-facing language stays the single noun users already speak: a "plan" is a complete scenario (catalog + board), cloneable in one click.

3. **"Final" mark (open question 3) — RESOLVED: drop `is_final` entirely; distinguish plans by derived comparison metrics instead.** `plan_variants.is_final` was dead code (never read/written); FR-014's "exactly one final" is overturned along with FR-010. Plans are all peers; the list view surfaces computed quality metrics so the best candidate is *evident* rather than *flagged*:
   - **valid** — zero unresolved collisions (reuse pure `deriveCollisions` / `hasIntersection`, `model/collisions.ts:17`, `model/collision.ts:3`)
   - **complete** — all courses fully slotted for both cohorts (reuse `deriveHours` / `countIncompleteCourses`, `model/hours.ts:14,32`)
   - **used slots** — count of distinct occupied `(cohort, day, period)` cells (compactness; lower = better)
   - candidates: placement count, last-updated timestamp
   These are derivable from placements + catalog with the existing framework-free core functions — computable in the `plans-list` loader (or SQL aggregates) at this data scale; no denormalized status columns needed initially. If a human "adopted/published" marker returns as a product need, it's an additive nullable column later — it records a social fact metrics can't derive (which candidate the school actually chose), but it is explicitly out of scope now.

4. **Cross-plan integrity (open question 6) — RESOLVED: composite foreign keys.** Add `UNIQUE (plan_id, id)` on `courses` and `students`; denormalize `plan_id` onto the link tables (`student_choices`, `course_overlaps`, `course_merges`, `course_grouping_members` — `placements` and `course_groupings` already carry it); FK as `(plan_id, course_id) → courses(plan_id, id)` etc. Cross-plan references become impossible at the DB level, and the clone RPC is self-verifying — a missed UUID remap fails loudly at insert time instead of corrupting data silently. Chosen over app guards (opt-in per write path) and triggers (harder to read/test); the schema churn is cheapest now, with no production data.

5. **Catalog route scoping (open question 7) — RESOLVED: nested routes.** Catalog pages move under the plan: `/plans/[id]/students`, `/plans/[id]/courses`, `/plans/[id]/teachers`, board at `/plans/[id]` (Astro file routing: `src/pages/plans/[id]/*.astro`). Scope is explicit in the URL — shareable, bookmarkable, multi-tab/multi-author safe, zero hidden state; no cookie/middleware machinery is built. Top-level nav becomes the plans list; plan-scoped sub-nav lives in the plan layout. `useCatalogFilters` URL params (cohort tabs etc.) are unaffected. The old top-level `/students|courses|teachers` routes are removed (redirect to `/plans` is optional).

6. **PRD/roadmap amendment (open question 8) — RESOLVED: inside this change.** Rewriting FR-010, FR-014, US-02 and re-scoping roadmap S-07 (per-plan variants → cloneable whole-domain plans; final mark → derived metrics) is the first deliverable of this change, so `/10x-plan` targets the amended requirements. No separate foundation change.

7. **Plan-list metrics computation (open question 9) — RESOLVED: loader-computed.** The `plans-list` loader fetches each plan's catalog + placements and runs the pure core functions (`deriveCollisions`, `deriveHours`/`countIncompleteCourses`) plus a trivial used-slots count. No schema changes, no staleness risk; valid/complete can't be expressed in SQL anyway. Caveat for the plan: the current `.limit(500)`/`.limit(2000)` loader caps assume one dataset — all queries must be plan-filtered once N plans exist. Denormalized metric columns are a later optimization only if the list gets slow.

## Open Questions

1. ~~**Cohorts: versioned or structural?**~~ **Resolved — see Decisions §.**
2. ~~**Do plans survive as an entity?**~~ **Resolved — see Decisions §2** (plans become the domain root; no separate versions entity).
3. ~~**Where does "final" live now?**~~ **Resolved — see Decisions §3** (`is_final` dropped; derived comparison metrics instead).
4. ~~**Groupings scope**~~ **Resolved — see Decisions §2** (stays `(plan_id, cohort)`; only the cohort column type changes).
5. ~~**Clone depth**~~ **Resolved — see Decisions §2** (full deep copy: catalog + placements + groupings, hash recomputed).
6. ~~**Cross-plan integrity enforcement**~~ **Resolved — see Decisions §4** (composite FKs).
7. ~~**Catalog route scoping**~~ **Resolved — see Decisions §5** (nested routes under `/plans/[id]/`).
8. ~~**PRD amendment scope**~~ **Resolved — see Decisions §6** (amended inside this change, as the first deliverable).
9. ~~**Plan-list metrics computation**~~ **Resolved — see Decisions §7** (loader-computed with pure core functions).

**No open questions remain — this research is ready to feed `/10x-plan`.**

## Follow-up Research 2026-06-11: seeding impact & user-facing UX

### Seeding process under the new model

Today `scripts/gen-seed.mjs` inserts: cohorts → teachers → courses → overlaps → merges → students → choices → one `plans` row ("Seed Plan", `:388-391`) → one `plan_variants` row ("Draft 1", `:253`). Under the decisions above the generator changes structurally:

1. **The plan row moves to the front.** The catalog is plan-owned now, so the generator creates the plan UUID *first* and threads it through every subsequent insert (`plan_id` on `teachers`, `courses`, `students`, plus denormalized onto `student_choices`, `course_overlaps`, `course_merges` per the composite-FK decision).
2. **`cohorts` insert deleted** — cohort columns take enum literals, and the `data/dp1/` / `data/dp2/` directory names map directly to the values (already aligned).
3. **`plan_variants` insert deleted.**
4. **Seed two plans, not one.** The second seeded plan (either a second fixture mix or a simulated clone of the first) gives dev/preview data that actually exercises the plans list, metric divergence, and cross-plan isolation — with one plan, none of the new surfaces are visible in dev.
5. Integration tests that assume "the first seeded plan" (`plan-detail/api/endpoint.integration.test.ts:32`) must pick a plan deliberately; the clone RPC gets its own integration coverage (per the lessons.md catalog-CRUD-integration rule).
6. Policy unchanged: seed remains dev-only, never applied to hosted.

### User-facing UX (journey view — complements the code-derived blast radius in §5)

- **`/plans` becomes the application hub.** The existing `plans-list` slice — today a static, read-only anchor list with no island — is upgraded to the scenario list: plan name, metric badges (**valid** / **complete** / **used slots**), last-updated, and actions: open, **clone**, rename, delete. This is the "list of all versions with names" — `plans.name` already exists; users name scenarios in their own vocabulary ("Wrzesień v2", "po zmianach wyborów").
- **Clone is the primary creation path, not a convenience.** A blank new plan starts with an *empty catalog* — no students, teachers, or courses — so the realistic workflow is: clone an existing plan → apply the catalog delta (the student/teacher change that motivated the new scenario) → adjust placements. "New blank plan" (name + slot-grid preset) remains only for cold start.
- **Inside a plan: plan-scoped layout.** Sub-nav: Board (`/plans/[id]`), Courses, Students, Teachers (`/plans/[id]/...`); breadcrumb carries the plan name. `src/shared/config/nav.ts` splits into global nav (plans list) + plan-scoped items.
- **No "final" badge anywhere** — the metrics row on the hub is the comparison surface; the best candidate is evident, not flagged.
- **Cloned plans open warm**: groupings are copied with the hash recomputed, so the board palette is immediately usable after a clone.
- **Plan deletion is now catastrophic by design** — it cascades the entire scenario (catalog + placements), not just a board. Needs an explicit confirm dialog naming what will be deleted (counts of students/courses/placements).
