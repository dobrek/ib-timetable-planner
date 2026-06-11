# Multi-Variant Management (Plans as Cloneable Domain Root) Implementation Plan

## Overview

Replace per-plan variants with **plans as the cloneable domain root**. The catalog (teachers, courses, students, choices, dependencies) becomes plan-owned; `plan_variants` and `cohorts` tables are dropped (cohort becomes a native Postgres enum `'dp1' | 'dp2'`); a deep-copy `clone_plan` RPC makes cloning the primary creation path; catalog routes nest under `/plans/[id]/…`; and `/plans` becomes the application hub with create / clone / rename / delete. The PRD and roadmap are amended first, because this change deliberately overturns FR-010, FR-014, FR-015, and US-02.

All architecture decisions were resolved in `context/changes/multi-variant-management/research.md` (Decisions §1–7) and the planning session (see `plan-brief.md` Key Decisions). There are no open questions.

## Current State Analysis

From the research doc (verified against the codebase):

- **`plan_variants` is nearly dead code**: no variant CRUD, no variant UI, no plan CRUD, no clone code anywhere. One plan + one variant are seeded; `plan_detail/api/load.ts:52-60` silently picks "first variant"; `variantId` threads through exactly 7 touchpoints, all in `plan-detail`. `is_final` is never read or written.
- **The catalog is global and un-versioned**; every read is a server loader, every write an Astro Action via `defineDomainAction` (`src/shared/lib/actions/index.ts:11-42`). No client query cache.
- **The constraint core needs zero changes** — pure and in-memory over `GroupingCourse[]` (`src/_pages/plan-detail/model/grouping.ts:1-6`); the <200ms drag-drop budget is unaffected.
- **Schema** lives in 4 migrations; hosted has all 4 applied; **no production data exists** — destructive migration is acceptable.
- **Routes today**: top-level `src/pages/{courses,students,teachers}.astro`, `src/pages/plans/index.astro` (static anchor list), `src/pages/plans/[id].astro` (board). Nav is a flat `NAV_ITEMS` list in `src/shared/config/nav.ts` rendered by `src/app/layouts/SidebarLayout.astro`.
- **Clone blockers in current schema**: `teachers.code` globally UNIQUE (`20260602185012:19`); `courses_unique` keyed on `cohort_id`.

## Desired End State

- One noun for users: a **plan** is a complete scenario (catalog + board), cloneable in one click from the `/plans` hub.
- Schema: `plans` is the single FK root; `cohort` is an enum value column; composite FKs make cross-plan references impossible at the DB level; `clone_plan` RPC deep-copies a whole scenario atomically.
- Routes: `/plans` (hub) → `/plans/[id]` (board), `/plans/[id]/courses`, `/plans/[id]/teachers`, `/plans/[id]/students`. Scope is explicit in the URL; zero hidden state. Old top-level catalog routes redirect to `/plans`.
- Foundation docs (PRD v1, roadmap v2) amended so the shipped behavior matches documented requirements.
- Hosted Supabase carries the new schema; production app works against it.

**Verify by**: `pnpm build`, `pnpm test`, `pnpm test:integration`, `pnpm lint`, `pnpm steiger` all green; manual walkthrough — clone seeded plan A, edit a student in the clone, confirm plan A is untouched, drag a placement on the clone's board.

### Key Discoveries:

- The 7 `variantId` touchpoints are the complete variant blast radius (research §2; all in `src/_pages/plan-detail/`).
- `course_groupings` is already keyed `(plan_id, cohort_id)` — zero re-keying beyond the cohort column type (research Decision §2).
- `computeCatalogHash` (`src/_pages/plan-detail/api/persist.ts:22-35`) fingerprints course UUIDs — cloned courses get new UUIDs, so cloned groupings would read stale unless the hash is recomputed post-clone (research §4).
- The teachers slice is the CRUD pattern to mirror for plan actions: `api/actions.ts` routing table + `api/create-teacher.ts` domain fn + `TeacherFormDialog.tsx` (RHF + shared Zod schema + `submitForm`).
- `replace_cohort_groupings` RPC (`20260604141213:15-51`) is the atomic-RPC pattern to mirror for `clone_plan`.
- `database.types.ts` currently has `Enums: Record<never, never>` — the new `cohort` enum will be the first generated enum; `supabase gen types` is a manual command (no package script).
- Per ui-conventions: UI never imports `astro:actions` directly (typed client wrappers per slice); `forms.ts`/`call-action.ts` must be deep-imported to keep Vitest import graphs astro-free.

## What We're NOT Doing

- **No derived comparison metrics on the hub** (valid / complete / used-slots badges) — explicitly deferred by the user as a future extension. The hub shows name, grid preset, last-updated, and actions only. (This supersedes research Decision §3's metric display; the *removal of `is_final`* from that decision stands.)
- No separate `versions` table or two-level version→plan hierarchy (research Decision §2).
- No "final"/"adopted" marker of any kind; FR-015 becomes "export any plan" (decided in planning).
- No ambient active-plan cookie/middleware state — scope travels in the URL only (research Decision §5).
- No cohort CRUD — the enum permanently closes it (research Decision §1).
- No CSV export implementation (that remains S-10, re-scoped, not built here).
- No RLS changes — blanket-authenticated stays; plans are not per-user.
- No renaming of the algorithm-side `GroupingVariant` / `enumerateVariants` / `scoreVariant` concepts — different concept, keep distinct (research §2 caveat).
- No denormalized metric/status columns, no plan archiving, no cross-plan diff UI.

## Implementation Approach

Five phases. Phase 1 amends the foundation docs so later phases target the amended requirements. Phase 2 lands the destructive schema + clone RPC + seed; Phase 3 adapts the app (cohort enum, plan threading, nested routes) — **Phases 2 and 3 ship as one PR** because the app cannot build between them. Phase 4 builds the hub UI on the now-stable schema. Phase 5 pushes to hosted and smoke-tests production.

Plan scoping is **explicit-parameter, not ambient**: loaders receive `planId` from `Astro.params`; action input schemas gain a `planId` field. This follows research Decision §5 (nested routes, zero hidden state) and supersedes the research §5 "ambient cookie" sketch that predated it.

## Critical Implementation Details

- **Build is intentionally red between Phases 2 and 3.** Regenerating `database.types.ts` (cohorts/plan_variants gone, `plan_id` columns added) breaks app-code typecheck until Phase 3 re-keys it. Phase 2's success criteria are DB-level only (`db reset` clean, RPC integration tests); the `pnpm build` gate applies at the end of Phase 3, and the two phases merge as a single PR.
- **`catalog_hash` recompute lives in JS, not SQL.** `computeCatalogHash` canonicalizes `GroupingCourse[]` in TypeScript; replicating it byte-for-byte in plpgsql would create a second hash implementation that can silently drift. Instead: the `clone_plan` RPC copies grouping rows as-is (stale hash), and the `clonePlan` domain function (Phase 4) recomputes the hash per cohort in JS and updates the cloned `course_groupings` rows. If that follow-up write fails, the groupings merely read as stale — a state the UI already handles gracefully. **Slice boundary**: `plans-list` cannot import the hash machinery from `plan-detail` — steiger's `forbidden-imports` rule is error-level (CI gate + lefthook pre-commit) and forbids same-layer cross-slice imports. The machinery (`computeCatalogHash` + the cohort-catalog projection `loadCohortCourses`, with their data types) therefore moves to `shared/lib/catalog-hash/` in Phase 3 (#7); both slices import it from there.
- **Hosted rollout ordering (Phase 5)**: push migrations to hosted *before* merging Phases 2–4 to `main`, then merge promptly — old deployed code breaks against the new schema (queries the dropped `cohorts` table) until CI auto-deploys the new code. Acceptable: no production users or data; keep the window short.
- **Seed determinism**: `gen-seed.mjs` uses `randomUUID()` per run; the second seeded plan must be generated by running the same insert pipeline twice (fresh UUIDs each pass), not by string-copying rows — otherwise composite-FK remapping bugs hide in the seed instead of failing loudly.
- **Vitest astro-import rule**: new plans-hub `forms`/client wrappers must deep-import `@/shared/lib/forms` and `@/shared/lib/call-action` (never via the `@/shared/lib` barrel) so unit-test import graphs stay free of `astro:*` virtual modules (ui-conventions.md:137-139).

## Phase 1: Foundation Amendments

### Overview

Rewrite the overturned product decisions in `prd.md` and `roadmap.md` so this change implements documented requirements rather than contradicting them (research Decision §6).

### Changes Required:

#### 1. PRD amendment

**File**: `context/foundation/prd.md`

**Intent**: Replace the per-plan-variant model with cloneable whole-domain plans; drop the "final" mark in favor of plans-as-peers; re-target export at any plan.

**Contract**: Amendments (edit-in-place, bump `version` to 2 and note the amendment date):
- **FR-010** → "Author can manage plans as complete scenarios (catalog + placements). A new plan is created blank (name + grid preset) or — the primary path — by cloning an existing plan, deep-copying its entire catalog, placements, and groupings."
- **FR-014** → removed/rewritten: plans are peers; no final mark. Record the rationale (derived-quality comparison is a future extension) in the Socratic note.
- **FR-015** → "Author can export **any plan** as a master-grid CSV (slot × course, cohort distinguishable)."
- **US-02** → "Parallel plans": clone an existing plan, edit both independently (catalog and placements), no final-mark clause.
- Sweep remaining "variant" language: Vision (¶2 "multiple parallel variants"), Persona ("competing variants of the same plan"), Success Criteria reference-session steps 3/7 and the Secondary criterion, Access Control role description ("variant attribution"), Non-Goals ("Cross-variant comparison view" → cross-plan), Open Question 9 (finalize gate — dissolves; mark resolved) and Q10 (draft export — dissolves into amended FR-015).

#### 2. Roadmap amendment

**File**: `context/foundation/roadmap.md`

**Intent**: Re-scope S-07 to this change's actual shape and propagate the FR-014/FR-015 ripple into S-10.

**Contract**:
- **S-07** outcome → "plans are cloneable whole-domain scenarios: plan-owned catalog, `/plans` hub with create/clone/rename/delete, nested plan-scoped routes; `plan_variants` and `cohorts` tables dropped." Status stays the live slice; unknown (fork vs empty-new) marked resolved (both).
- **S-10** outcome → "export any plan as master-grid CSV"; drop the finalize-gate blocker; Open Roadmap Question 2 marked resolved (no finalize gate — FR-014 overturned).
- At-a-glance table rows for S-07/S-10 updated to match; bump `version`/`updated` frontmatter.

### Success Criteria:

#### Automated Verification:

- `grep -ni "final" context/foundation/prd.md` returns no requirement-level "final variant/final mark" language (only historical/Socratic notes)
- `grep -ni "variant" context/foundation/prd.md context/foundation/roadmap.md` returns no surviving per-plan-variant requirement (algorithm "groupings variants" references in roadmap F-03 prose are fine)

#### Manual Verification:

- Read-through: PRD and roadmap are internally consistent — no section still presumes `plan_variants`, a final mark, or a finalize gate

---

## Phase 2: Schema Re-baseline + Clone RPC + Seed

### Overview

One new destructive migration reshapes the domain around `plans` as root, adds the `clone_plan` RPC, rewrites the seed generator (plan-first, two plans), and regenerates types. DB-level integration tests cover the clone RPC. The app does not build at the end of this phase (see Critical Implementation Details).

### Changes Required:

#### 1. Destructive migration

**File**: `supabase/migrations/<timestamp>_plans_as_domain_root.sql` (via `pnpm exec supabase migration new plans_as_domain_root`)

**Intent**: Drop `plan_variants` and `cohorts`; make every catalog root plan-owned; convert cohort FKs to a native enum; add composite FKs so cross-plan references are impossible; re-key uniques so cloning cannot collide.

**Contract** (the invariants; exact SQL is the implementer's):
- `CREATE TYPE cohort AS ENUM ('dp1', 'dp2')` — native enum so `supabase gen types` emits the union (research Decision §1).
- `teachers`: `+ plan_id uuid NOT NULL REFERENCES plans ON DELETE CASCADE`; `code` unique becomes `UNIQUE (plan_id, code)`.
- `courses`: `+ plan_id` (NOT NULL, CASCADE); `cohort_id uuid` → `cohort cohort NOT NULL`; `courses_unique` → `(plan_id, cohort, name, level, group_index)`; `+ UNIQUE (plan_id, id)` (composite-FK target).
- `students`: `+ plan_id`; `cohort_id` → `cohort`; `+ UNIQUE (plan_id, id)`.
- `student_choices`, `course_overlaps`, `course_merges`, `course_grouping_members`: `+ plan_id` denormalized; FKs become composite — e.g. `(plan_id, course_id) REFERENCES courses (plan_id, id)`, `(plan_id, student_id) REFERENCES students (plan_id, id)` (research Decision §4).
- `placements`: `variant_id` → `plan_id` (FK to `plans`, CASCADE); `cohort_id` → `cohort`; unique → `(plan_id, cohort, day, period, course_id)`; composite FK `(plan_id, course_id)`.
- `course_groupings`: `cohort_id` → `cohort`; keep `(plan_id, cohort)` keying; `+ UNIQUE (plan_id, id)` if `course_grouping_members` composite-FKs through it.
- `DROP TABLE plan_variants; DROP TABLE cohorts;` (order respecting FK deps).
- Indexes: drop cohort-FK indexes (cardinality 2); add `(plan_id)` / `(plan_id, cohort)` indexes where queries filter.
- `replace_cohort_groupings` RPC: `p_cohort_id uuid` param → `p_cohort cohort`; body otherwise equivalent.
- RLS: new/changed tables keep the existing blanket-authenticated policy pattern; re-grant per README's grants note.

#### 2. `clone_plan` RPC

**File**: same migration (or a sibling `<timestamp>_clone_plan_fn.sql`)

**Intent**: Atomic deep copy of an entire plan — catalog, placements, groupings — with UUID remap, as the primary plan-creation path.

**Contract**: `clone_plan(p_source_plan_id uuid, p_name text) RETURNS uuid` (new plan id). `SECURITY INVOKER`, mirroring `replace_cohort_groupings`. Copy order is topological: plans row (new name, same `slot_grid_preset`) → teachers → courses → course_overlaps + course_merges → students → student_choices → placements → course_groupings → course_grouping_members. Remap via temp ID-mapping (e.g. `INSERT … SELECT` with a CTE map per parent table). `courses.teacher_id` is `SET NULL` semantics: preserve NULLs, remap non-NULLs within the new plan. `catalog_hash` is copied as-is (recompute happens JS-side in Phase 4 — see Critical Implementation Details). The composite FKs from change #1 make a missed remap fail loudly at insert time.

#### 3. Seed generator rewrite

**File**: `scripts/gen-seed.mjs` (regenerate `supabase/seed.sql` after)

**Intent**: Plan-first generation under the new schema; seed two plans so the hub, clone isolation, and plan-filtered loaders are exercised in dev.

**Contract**: Create the plan UUID first; thread `plan_id` through every insert (including the denormalized link-table columns). Delete the `cohorts` and `plan_variants` insert sections; map `data/dp1|dp2/` directory names directly to enum literals. Wrap the per-plan insert pipeline in a function invoked twice ("Seed Plan A", "Seed Plan B") with fresh UUIDs per pass. Keep the loud-abort consistency checks and stderr row-count stats.

#### 4. Regenerated DB types

**File**: `src/shared/api/database.types.ts`

**Intent**: Committed artifact must reflect the new schema, including the first generated enum.

**Contract**: `pnpm exec supabase gen types typescript --local > src/shared/api/database.types.ts` after `db reset`. Expect `Database["public"]["Enums"]["cohort"] = "dp1" | "dp2"` and `clone_plan` under `Functions`.

#### 5. Clone RPC integration tests

**File**: `src/_pages/plans-list/api/clone-plan.integration.test.ts` (location may shift with Phase 4's slice layout)

**Intent**: Prove the deep copy is complete, remapped, and isolated (lessons.md mandates integration coverage for this).

**Contract**: Against local Supabase: clone a seeded plan → row counts per table match the source; no cloned row references a source-plan UUID (composite-FK spot checks); mutating the clone's catalog leaves the source untouched; `teachers.code` values duplicate across plans without conflict; cloning twice produces two independent plans.

### Success Criteria:

#### Automated Verification:

- Migration applies from scratch: `pnpm exec supabase db reset` completes with seed loaded (two plans)
- Clone RPC integration tests pass: `pnpm test:integration` (the three pre-existing suites are expected to **skip**, not fail, during the red window — their `cohorts` lookups vanish; Phase 3 #7 un-skips them)
- Types regenerated and committed: `git diff --stat src/shared/api/database.types.ts` shows the enum + new columns

#### Manual Verification:

- Supabase Studio: confirm `plan_variants`/`cohorts` gone, both seeded plans present with disjoint catalog rows, `clone_plan('…', 'test')` from SQL editor produces a complete third plan

**Implementation Note**: `pnpm build` is expected red at the end of this phase; do not "fix" app code here — that is Phase 3. Pause for manual confirmation before proceeding.

---

## Phase 3: App Adaptation (Cohort Enum + Plan Threading + Nested Routes)

### Overview

Re-key the entire app to the new schema: remove `variantId`, adopt the cohort enum, thread `planId` explicitly, move catalog routes under `/plans/[id]/…`, and restructure navigation. The app builds and works end-to-end again at the end of this phase. Ships in the same PR as Phase 2.

**File lists below are representative, not exhaustive** — grep shows ~25 further files carrying cohort-UUID symbols (notably the catalog slices' `model/` segments and their tests). Every one breaks the typecheck once the enum lands, so the working method is: apply the listed changes, then follow the compiler until `pnpm build` is green. Do not treat a file's absence from a list as "out of scope".

### Changes Required:

#### 1. Shared cohort config

**Files**: `src/shared/config/cohorts.ts` (new); delete `src/shared/api/cohorts.ts`; update `src/shared/api/index.ts` (barrel re-exports `toOrderedCohorts`/`CohortOption` from the deleted file)

**Intent**: Single-source the fixed cohort set as a config constant + label map, replacing the DB-loaded `toOrderedCohorts()`/`CohortOption` (research Decision §1; mirrors the `bd606cb` group-enum precedent).

**Contract**: `type Cohort = Database["public"]["Enums"]["cohort"]`; ordered `COHORTS: readonly { value: Cohort; label: string }[]` (`dp1` = "Year 1", `dp2` = "Year 2" — match current seeded cohort names). All slices import from here; cohort Zod fields become `z.enum(["dp1", "dp2"])` (or a shared schema exported alongside).

#### 2. Plan-detail variant removal + re-keying

**Files**: `src/_pages/plan-detail/api/load.ts`, `api/placements.ts`, `api/placement-client.ts`, `api/load-cohort-catalog.ts`, `api/grouping-compute.ts`, `api/grouping-client.ts`, `api/staleness.ts`, `api/persist.ts`, `model/drag.ts`, `model/use-placements.ts`, `ui/PlannerBoard.tsx`, `ui/ComputeGroupingsEmptyState.tsx`, `api/placement-actions.test.ts`, `api/grouping-actions.test.ts`

**Intent**: Placements and groupings are keyed by `(plan_id, cohort)`; the variant concept disappears; the "first cohort by name" and "first variant" resolution hacks die.

**Contract**: `loadPlannerData(supabase, id)` drops variant + cohort-table queries; `PlannerBoardProps` loses `variantId`, `cohortId: string` becomes `cohort: Cohort`; placement Zod input takes `planId` + `cohort` enum; `replace_cohort_groupings` call site passes the enum value. The exhaustive `variantId` touchpoint list is research §2 item 4 (7 files). Do **not** touch `model/` constraint-core files beyond the cohort type at their boundaries.

#### 3. Catalog slice re-keying (courses, teachers, students)

**Files**: `src/_pages/{courses,teachers,students}/api/loader.ts`, all action domain files (`create/update/delete-course.ts`, `create-overlap.ts`, `delete-overlap.ts`, `create-merge.ts`, `dissolve-merge.ts`, `update-merge-hours.ts`, `create/update/delete-teacher.ts`, `create/update/delete-student.ts`, `assert-choices-in-cohort.ts`, `assert-merge-parent.ts`), `model/schemas.ts` per slice, the other cohort-typed `model/` files (`courses/model/course.ts` `CohortTab`, `students/model/student.ts`, `teachers/model/teacher.ts`, `courses/model/merge.ts`, `filter-params.ts`, `filter-{courses,students,teachers}.ts`, `use-catalog-filters.ts` per slice — plus their co-located tests), client wrappers, UI islands' props (incl. `teachers/ui/TeacherTable.tsx`)

**Intent**: Every catalog read filters by `plan_id`; every catalog write carries `planId` in its Zod input and inserts/guards within that plan; cohort UUID fields become enum values throughout.

**Contract**: Loaders gain a `planId: string` parameter and drop their `cohorts` table queries (cohort tabs render from `COHORTS`). Action input schemas gain `planId: z.uuid()`; `cohortId: z.uuid()` → `cohort: z.enum(…)`. Guards (`assertChoicesInCohort`, `assertMergeParent`) additionally pin `plan_id` (composite FKs backstop them). The existing `.limit(500)` / `.limit(2000)` caps stay but now apply post-filter, restoring their correctness margin. `useCatalogFilters` keeps its URL-synced shape; `?cohort=dp1` becomes the readable param value.

#### 4. Nested routes + redirects

**Files**: `src/pages/plans/[id]/index.astro` (board, moved from `plans/[id].astro`), `src/pages/plans/[id]/{courses,teachers,students}.astro` (new); `src/pages/{courses,students,teachers}.astro` become redirects to `/plans`

**Intent**: Plan scope is explicit in the URL; catalog pages are plan-scoped instances of the existing islands.

**Contract**: Each nested catalog route resolves `Astro.params.id`, loads the plan row (404 on miss, mirroring the board's `not-found` branch) plus its plan-filtered catalog, and renders the existing island with a `planId` prop. Old top-level routes: `return Astro.redirect("/plans")` (no island, no loader).

#### 5. Navigation + plan-scoped chrome

**Files**: `src/shared/config/nav.ts`, `src/app/layouts/SidebarLayout.astro` (and/or a thin plan-scoped layout/sub-nav component)

**Intent**: Global nav shrinks to the plans hub (+ Home); inside a plan, a sub-nav (Board / Courses / Teachers / Students) and a breadcrumb carrying the plan name provide scenario-local navigation.

**Contract**: `nav.ts` splits into `GLOBAL_NAV_ITEMS` and a `planNavItems(planId)` builder. SidebarLayout accepts optional plan context (id + name) to render the sub-nav and breadcrumb; pages outside a plan render as today. Active-link highlighting must distinguish `/plans/[id]` (board) from `/plans/[id]/courses`.

#### 6. Catalog-hash machinery to shared

**Files**: `src/shared/lib/catalog-hash/` (new); `src/_pages/plan-detail/api/persist.ts`, `api/load-cohort-catalog.ts`, `api/staleness.ts`, `api/grouping-compute.ts` (imports updated)

**Intent**: Phase 4's `clonePlan` (plans-list slice) needs `computeCatalogHash` + the cohort-catalog projection, currently in `plan-detail/api/`. A same-layer cross-slice import fails steiger's error-level `forbidden-imports` rule; `shared/` is the repo's established home for cross-slice reuse (no `@x` convention in use).

**Contract**: Move `computeCatalogHash` (`persist.ts:22-35`) and `loadCohortCourses` (`load-cohort-catalog.ts`) into `shared/lib/catalog-hash/`, together with the pure data shapes they carry (`GroupingCourse`, `CatalogSnapshot`, `CohortCatalog`); `plan-detail/model` imports/re-exports those types from shared so constraint-core signatures are unchanged. The module must be deep-importable and astro-free (Vitest rule). Constraint-core `model/` functions stay in plan-detail — only the DB→hash projection moves. Done in this phase (the files are being re-keyed for plan/cohort anyway) so Phase 4 starts on a stable boundary.

#### 7. Test updates

**Files**: `src/_pages/plan-detail/api/placement-actions.test.ts`, `src/_pages/plan-detail/api/endpoint.integration.test.ts`, `src/_pages/plan-detail/api/adapter-parity.integration.test.ts`, `src/_pages/students/api/students-crud.integration.test.ts`, any unit tests with cohort-UUID fixtures

**Intent**: Fixtures speak the new schema; integration tests pick a plan deliberately instead of "first seeded plan". All three pre-existing integration suites do `cohorts`-table lookups in `beforeAll` with swallowed errors → after the drop they `ctx.skip()` silently rather than fail, so green runs mask lost coverage.

**Contract**: Placement fixtures use `planId` + `cohort: "dp1"`; integration tests select a named seed plan ("Seed Plan A") and replace cohort-table lookups with enum literals. After this phase `pnpm test:integration` must report **zero skipped tests** — un-skipping the three suites is part of done.

### Success Criteria:

#### Automated Verification:

- `pnpm build` passes (gate restored after the Phase 2 red window)
- `pnpm test` passes
- `pnpm test:integration` passes with zero skipped tests
- `pnpm lint` and `pnpm steiger` pass

#### Manual Verification:

- Full walkthrough on seed data: `/plans` lists both seeded plans; opening Plan A's courses/teachers/students shows only its rows; editing a student in Plan B leaves Plan A untouched; board drag-drop on `/plans/[id]` validates and persists; `?cohort=dp1` URL param round-trips
- Old bookmarks (`/courses`) land on `/plans`
- Drag-drop still feels instant (<200ms budget intact — validation is client-side, unchanged)

**Implementation Note**: After this phase passes, pause for manual confirmation before building the hub.

---

## Phase 4: Plans Hub (Create / Clone / Rename / Delete)

### Overview

Upgrade the static `plans-list` slice into the application hub: an interactive island listing plans (name, grid preset, last-updated) with create-blank, clone, rename, and delete — no derived metrics (deferred).

### Changes Required:

#### 1. Plan actions (domain + routing table)

**Files**: `src/_pages/plans-list/api/{create-plan,clone-plan,rename-plan,delete-plan}.ts`, `api/actions.ts`, `model/schemas.ts`, registration in `src/actions/index.ts`; `src/shared/config/grid-presets.ts` (new), `src/_pages/plan-detail/model/grid.ts` (consume shared presets)

**Intent**: Plan CRUD becomes Astro Actions following the teachers-slice pattern (lessons.md: Actions are the single mutation transport).

**Contract**: `planActions = { createPlan, clonePlan, renamePlan, deletePlan }` via `defineDomainAction`. `createPlan(name, slotGridPreset)` inserts a blank plan. **No canonical preset list exists today** — `plan-detail/model/grid.ts:4-31` holds only `parseGridPreset` + `DEFAULT_GRID`/`GRID_BOUNDS`, and the DB column is plain text. Define the canonical list in `src/shared/config/grid-presets.ts` (new — `'5x10'` as default, derived from `DEFAULT_GRID`); the create dialog's preset select and the Zod schema validate against it, and `plan-detail/model/grid.ts` re-points its default to the shared constant (steiger-clean: shared is importable from both slices; never import `grid.ts` from plans-list). `clonePlan(sourcePlanId, name)` calls the `clone_plan` RPC, then recomputes `catalog_hash` per cohort via `@/shared/lib/catalog-hash` (moved there in Phase 3 #6 — never import from `plan-detail`) and updates the cloned grouping rows (see Critical Implementation Details); returns the new plan id. `renamePlan(id, name)` and `deletePlan(id)` are thin `unwrapRow`/`unwrapCompleted` wrappers.

#### 2. Hub loader

**File**: `src/_pages/plans-list/api/loader.ts`

**Intent**: The list needs enough data for rows and for the delete dialog's blast-radius counts.

**Contract**: `loadPlans` returns per plan: `id`, `name`, `slot_grid_preset`, `updated_at`, and entity counts (students, courses, placements) for the delete confirmation. Counts are plan-filtered; mechanism (grouped aggregate vs per-plan head-count queries) is the implementer's call at this scale (≤ tens of plans).

#### 3. Hub UI island

**Files**: `src/_pages/plans-list/ui/PlansHub.tsx` (replaces the static list in `PlansListPage.astro`), `ui/PlanFormDialog.tsx`, `ui/ClonePlanDialog.tsx`, `ui/DeletePlanDialog.tsx`, `api/plans-client.ts`

**Intent**: The scenario manager: list with row actions (Open, Clone, Rename, Delete) and a "New plan" button, per the decided UX.

**Contract**: Mirror the teachers-slice composition (thin orchestrator + dialogs + `useConfirmAction`/`submitForm` from deep imports, shared Zod schemas, `callAction` client wrappers). Clone dialog: name prefilled `"<source name> (copy)"`; on success `navigate(`/plans/${newId}`)`. Create dialog: name + preset select; on success navigate into the new plan. Delete: AlertDialog naming the counts ("Deletes 142 students, 58 courses, 312 placements"); on success `refreshPage()`. Rename: prefilled name field; `refreshPage()`. Empty state ("No plans yet") points at "New plan".

#### 4. Plan-action integration tests

**File**: `src/_pages/plans-list/api/plan-actions.integration.test.ts`

**Intent**: Catalog-CRUD-class integration coverage for the new mutation surface (lessons.md rule).

**Contract**: create → rename → delete round-trip; delete cascades the full scenario (counts go to zero, source plan untouched); `clonePlan` domain function leaves cloned groupings **non-stale** (hash matches a fresh `computeCatalogHash` over the clone's catalog). The seed ships **no groupings**, so the clone-freshness test must first compute/insert groupings on the source plan — otherwise the assertion is vacuous.

### Success Criteria:

#### Automated Verification:

- `pnpm build`, `pnpm lint`, `pnpm steiger` pass
- `pnpm test` passes (schema/unit additions)
- `pnpm test:integration` passes including the new plan-action tests

#### Manual Verification:

- Hub flows: create a blank plan → lands on its (empty) board — note this is a **new code path** (zero-course catalog has never been rendered; watch `load-cohort-catalog`/palette empty states); compute groupings on Seed Plan A first (the seed ships none), then clone it with a custom name → lands on a warm board (groupings palette immediately usable, no stale banner); rename round-trips; delete shows correct counts and removes the scenario
- Cloned plan's catalog edits don't leak to the source (spot-check after UI edits)

**Implementation Note**: Pause for manual confirmation before the hosted rollout.

---

## Phase 5: Hosted Rollout

### Overview

Apply the new schema to the hosted Supabase project and verify production end-to-end. Follows the README's documented push workflow.

### Changes Required:

#### 1. Hosted migration push

**Intent**: Hosted and local schemas must not drift; the CI deploy job ships the new code on merge.

**Contract**: With the CLI linked (`project ref hwmuiymhjgewtymymbmb`): `pnpm exec supabase db push` → `pnpm exec supabase db diff` reports clean. Verify table grants per the README note (`anon`/`authenticated` reachability) and run `pnpm exec supabase db advisors`. **Ordering**: push immediately before merging the PR to `main` (see Critical Implementation Details — brief old-code/new-schema window is accepted). Seed is dev-only — never applied to hosted.

#### 2. Production smoke test

**Intent**: Confirm the deployed Worker works against the reshaped hosted DB.

**Contract**: On the production URL after CI deploys: sign in → `/plans` empty state → create a blank plan → open its board and catalog pages → rename → delete. Run `pnpm env:local` afterward if any prod-profile smoke used local tooling.

### Success Criteria:

#### Automated Verification:

- `pnpm exec supabase db diff` reports no drift after push
- CI pipeline green on the merge commit (install → sync → lint → steiger → test → build → deploy)

#### Manual Verification:

- Production smoke: full hub round-trip (create/open/rename/delete) on the deployed app
- `pnpm exec supabase db advisors` shows no new blocking findings

---

## Testing Strategy

### Unit Tests:

- Zod schema changes (cohort enum, `planId` fields) via existing schema test patterns
- Placement transition fixtures re-keyed to `(planId, cohort)` — constraint-core tests unchanged
- New plan `model/schemas.ts` (create/clone/rename/delete inputs)

### Integration Tests:

- `clone_plan` RPC: completeness, UUID remap, cross-plan isolation, repeated clones (Phase 2)
- Plan actions: CRUD round-trip, cascade delete, clone-then-hash-freshness (Phase 4)
- Existing endpoint integration test re-pointed at a named seed plan (Phase 3)

### Manual Testing Steps:

1. `pnpm exec supabase db reset` → two seeded plans appear on `/plans`
2. Edit a student in Plan B; confirm Plan A's students unchanged
3. Compute groupings on Plan A (the seed ships none), then clone it; confirm warm board (no stale-groupings banner), drag-drop placement persists, source plan placements untouched
4. Delete the clone via the counts dialog; confirm `/plans` no longer lists it and Studio shows no orphan rows
5. Old URL `/courses` redirects to `/plans`; `?cohort=dp2` tab state survives reload

## Performance Considerations

The <200ms drag-drop budget is untouched — validation stays client-side over props shipped per page render. Loader caps (`limit(500)`/`limit(2000)`) become plan-filtered, restoring headroom as plan count grows. The hub loader's count queries are trivial at this scale; revisit only if the list visibly slows. The clone RPC is a one-shot atomic copy of a small dataset (~hundreds of rows) — no streaming or batching needed.

## Migration Notes

No production data exists; the migration is destructive by design (drops `plan_variants`, `cohorts`; reshapes catalog tables). Hosted is reshaped via `db push` of the single new migration — no repair/squash. Rollback remains "drop and re-push" per README; a code rollback does not undo the applied migration, so the Phase 5 push happens only once Phases 2–4 are merged-ready.

## References

- Research (all decisions): `context/changes/multi-variant-management/research.md`
- Plan brief: `context/changes/multi-variant-management/plan-brief.md`
- Atomic RPC pattern: `supabase/migrations/20260604141213_replace_cohort_groupings_fn.sql:15-51`
- CRUD slice pattern to mirror: `src/_pages/teachers/api/actions.ts`, `src/_pages/teachers/ui/TeacherFormDialog.tsx`
- Catalog hash machinery: `src/_pages/plan-detail/api/persist.ts:22-35`, `api/staleness.ts:13-31`
- UI conventions: `context/foundation/ui-conventions.md`
- Lessons applied: `context/foundation/lessons.md` (Actions-as-transport, integration-test mandate, port-the-mechanism)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundation Amendments

#### Automated

- [x] 1.1 `grep -ni "final"` on prd.md shows no requirement-level final-variant language — e754366
- [x] 1.2 `grep -ni "variant"` on prd.md/roadmap.md shows no surviving per-plan-variant requirement — e754366

#### Manual

- [x] 1.3 Read-through: PRD and roadmap internally consistent (no plan_variants / final mark / finalize gate) — e754366

### Phase 2: Schema Re-baseline + Clone RPC + Seed

#### Automated

- [x] 2.1 `pnpm exec supabase db reset` completes with two-plan seed — a942e0b
- [x] 2.2 Clone RPC integration tests pass (`pnpm test:integration`) — a942e0b
- [x] 2.3 `database.types.ts` regenerated and committed (cohort enum + new columns) — a942e0b

#### Manual

- [x] 2.4 Studio check: old tables gone, seeded plans disjoint, SQL-editor `clone_plan` produces a complete third plan — a942e0b

### Phase 3: App Adaptation (Cohort Enum + Plan Threading + Nested Routes)

#### Automated

- [x] 3.1 `pnpm build` passes
- [x] 3.2 `pnpm test` passes
- [x] 3.3 `pnpm test:integration` passes with zero skipped tests
- [x] 3.4 `pnpm lint` and `pnpm steiger` pass

#### Manual

- [x] 3.5 Walkthrough: hub lists both plans, catalog isolation between plans, board drag-drop persists, `?cohort=dp1` round-trips
- [x] 3.6 Old `/courses` bookmark redirects to `/plans`
- [x] 3.7 Drag-drop feels instant (<200ms budget intact)

### Phase 4: Plans Hub (Create / Clone / Rename / Delete)

#### Automated

- [ ] 4.1 `pnpm build`, `pnpm lint`, `pnpm steiger` pass
- [ ] 4.2 `pnpm test` passes
- [ ] 4.3 `pnpm test:integration` passes including plan-action tests

#### Manual

- [ ] 4.4 Hub flows: create blank → empty board; clone → warm board with custom name; rename; delete with correct counts
- [ ] 4.5 Cloned plan's catalog edits don't leak to source

### Phase 5: Hosted Rollout

#### Automated

- [ ] 5.1 `supabase db diff` clean after push
- [ ] 5.2 CI green on merge commit (incl. deploy)

#### Manual

- [ ] 5.3 Production smoke: hub round-trip on deployed app
- [ ] 5.4 `supabase db advisors` shows no new blocking findings
