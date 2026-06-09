# Architecture Refactor — FSD v2.1 Migration Implementation Plan

## Overview

Migrate the entire `src/` tree from a flat `components/` + `lib/` organization to Feature-Sliced Design v2.1, resolving layer leaks, segmenting the generic `lib/` bucket, enforcing import boundaries, and unifying backend communication onto Astro Actions. The migration is divided into a structural track (Phases 1–4, pure relocation with zero behavior change) and a behavioral track (Phase 5, Actions unification + auth DS compliance + lessons update).

## Current State Analysis

The codebase has 108 files under `src/` in a pre-FSD structure:

- **`src/components/`** (44 files) — shadcn UI primitives (`ui/`), auth form (`auth/`), course catalog (`courses/`), and planner board (`planner/`) sit at the same folder depth. View-model types, hooks, helpers, and tests are flat among component files.
- **`src/lib/`** (49 files) — infrastructure (`supabase.ts`), domain logic (`courses/`, `grouping/`, `placements/`), schemas, navigation config, and utilities all live as peers. The `SupabaseClient<Database>` type alias is duplicated in 6 files.
- **`src/layouts/`** (2 files) — `Layout.astro` (HTML shell) and `AppShellLayout.astro` (sidebar nav wrapper).
- **`src/pages/`** (9 files) — Astro routes + API endpoints. Two pages (`courses.astro`, `plans/index.astro`) inline DB-fetching loaders in frontmatter; `plans/[id].astro` delegates to `loadPlannerData()` (the clean pattern).
- **`src/actions/index.ts`** — 8 course CRUD Actions following exemplary thin-orchestration pattern, but the file also holds 3 shared helpers (`requireSession`, `requireSupabase`, `runDomain`) that should be importable from elsewhere.

Key smells: 6 upward imports (`lib/planner/*` → `components/planner/types`), inline page loaders, API routes mixing transport + DB + business rules (`placements.ts`, `grouping.ts`), `lib/` as unsegmented bucket, auth components hardcoding palette colors.

The strong foundation: zero cross-feature coupling, pure domain functions with injected Supabase args, working test suite (15 tests), and two clean reference patterns already in place.

## Desired End State

```
src/
  pages/               ← Astro routing only (thin .astro shells)
  _pages/              ← FSD pages layer
    sign-in/           ← ui/ (auth form components)
    courses/           ← ui/ (.tsx island) + api/ (loader, CRUD, actions) + model/
    plan-detail/       ← ui/ (.tsx island) + api/ (loader, grouping orchestration) + model/
    plans-list/        ← ui/ (.astro) + api/ (loader)
    dashboard/         ← ui/ (.astro)
  entities/            ← shared domain models
    course/            ← model/ (types, labels, merge rules, Zod schemas)
    plan/              ← model/ (grid presets, plan/variant view-models)
    teacher/           ← model/ (TeacherOption view-model)
    placement/         ← model/ (PlannerPlacement, LocalPlacement)
    grouping/          ← model/ (types, pure compute: collision, enumerate, score)
    student/           ← model/ (stub, created when student CRUD lands)
  shared/
    ui/                ← shadcn primitives + LibBadge + Banner (index.ts barrel)
    api/               ← Supabase client, database.types.ts, SupabaseClient alias
    lib/               ← cn(), DomainError, config-status, Action orchestration helpers
    config/            ← nav.ts (NAV_ITEMS)
  app/
    layouts/           ← BaseLayout.astro, SidebarLayout.astro
    styles/            ← global.css
  actions/             ← Astro-required thin composition barrel
  middleware.ts        ← Astro-fixed location (conceptually app layer)
```

Every slice and shared segment has an `index.ts` public API barrel. Consumers import from barrels only, except `.astro` components which are imported by direct path (TypeScript cannot re-export `.astro` from `index.ts` — documented Astro-specific exception to FSD rule 4-2, scoped to `ui` segments only).

### Key Discoveries:

- `plans/[id].astro` → `loadPlannerData()` is the exact pattern to generalize for all page loaders: page creates Supabase client, calls a loader function, maps the discriminated result to HTTP status, chooses layout, renders one component
- `actions/index.ts` thin-orchestration split is the pattern to generalize for all Actions: `requireSession` → `requireSupabase` → `runDomain(() => domainFn(supabase, input))`
- The `cn` utility (`@/lib/utils`) has 16 consumers (every shadcn primitive) — highest fan-out import; must move first
- The `PlannerPlacement` type in `components/planner/types.ts` is consumed upward by 6 files in `lib/planner/` — the clearest FSD violation; resolving this is the entities phase's primary deliverable
- Tests are all pure Node/Vitest (no DOM), so they move with their source files with only import path updates
- Astro Actions are callable imperatively from client JS (`actions.createPlacement(input)`) — the drag-drop hot path does NOT need a bespoke API endpoint

## What We're NOT Doing

- No new features or UI changes (except auth DS compliance theming)
- No database schema changes or migrations
- No `widgets/` or `features/` layers — promote page-local slices only when a 2nd consumer appears
- No auth API route migration to Actions (`signin`/`signout` keep progressive enhancement)
- No `user`/`auth` entity — tokens and session live in `shared/api/`
- No component redesign — components move as-is (except auth palette fixes in Phase 5)
- No `index.server.ts` split — the server/client boundary is already clean (no `.tsx` islands import Supabase)
- No path alias changes — the existing `@/* → ./src/*` alias is the Astro FSD convention

## Implementation Approach

Two tracks executed in sequence within a single plan:

**Track A (Phases 1–4): Structural relocation.** Pure file moves and import rewrites. Zero behavior change. Every intermediate commit builds and passes tests. The dependency order is bottom-up: shared → entities → pages → cleanup.

**Track B (Phase 5): Behavioral changes.** Actions unification (migrate `placements` + `grouping` API routes to Actions), auth DS compliance (replace hardcoded palette colors with semantic tokens), and `lessons.md` revision. These changes alter runtime behavior and are isolated in a single phase.

**Commit discipline:** One commit per logical file-move batch within a phase. Never mix relocation with refactoring in the same commit. Every commit must pass `pnpm build` and `pnpm test`.

**Validation:** `@feature-sliced/steiger` installed as devDep in Phase 1. `pnpm dlx steiger src` run as an automated verification step in each phase (warnings on intermediate phases are expected and documented; errors are not acceptable).

## Critical Implementation Details

### Astro .astro public API exception

`.astro` components cannot be re-exported from `index.ts` (TypeScript limitation). Consumers import them by direct path: `import BaseLayout from "@/app/layouts/BaseLayout.astro"`. This exception applies only to `ui` segments containing `.astro` files. All other segments (`api/`, `model/`, `config/`) use standard `index.ts` barrels. Data loaders, types, and pure functions always go through barrels.

### Import update strategy

When a file moves, update all its consumers' imports in the same commit. Use project-wide search for the old import path. Do not leave broken imports for a later commit — the build must pass after every commit.

---

## Phase 1: Foundation (shared/ + app/)

### Overview

Create the bottom (`shared/`) and top (`app/`) FSD layers. Relocate all infrastructure — shadcn primitives, Supabase client, utilities, layouts, global styles — and rewrite consumer imports. Install steiger. After this phase, `src/shared/` and `src/app/` are the canonical homes for infrastructure and global concerns.

### Changes Required:

#### 1. Install steiger

**File**: `package.json`

**Intent**: Add `@feature-sliced/steiger` as a devDependency for automated FSD structure validation.

**Contract**: `pnpm add -D @feature-sliced/steiger`. After install, `pnpm dlx steiger src` runs (will report violations against the still-flat structure — expected baseline).

#### 2. Create shared/ui/ segment

**Files**: `src/shared/ui/*`

**Intent**: Move all 15 shadcn `.tsx` primitives, `LibBadge.astro`, and `Banner.astro` from `src/components/ui/` to `src/shared/ui/`. Create a barrel that re-exports all `.tsx` components.

**Contract**: `src/shared/ui/index.ts` exports all shadcn primitives (`Button`, `Dialog`, `Badge`, `Input`, `Label`, `Select`, `Tabs`, `Table`, `Form`, `Popover`, `Command`, `DropdownMenu`, `AlertDialog`, `Sonner`). `.astro` components (`LibBadge.astro`, `Banner.astro`) are imported by direct path. All consumers of `@/components/ui/*` update to `@/shared/ui` (barrel) or `@/shared/ui/LibBadge.astro` (direct).

#### 3. Create shared/api/ segment

**Files**: `src/shared/api/*`

**Intent**: Move Supabase client factory and generated database types to shared infrastructure. Consolidate the `SupabaseClient<Database>` type alias that is duplicated across 6 files into a single canonical export.

**Contract**: `src/shared/api/index.ts` exports `createClient`, `Database` type, and `SupabaseClient` type alias. Files: `supabase.ts` (moved from `src/lib/supabase.ts`), `database.types.ts` (moved from `src/lib/database.types.ts`). All consumers of `@/lib/supabase` and `@/lib/database.types` update to `@/shared/api`.

#### 4. Create shared/lib/ segment

**Files**: `src/shared/lib/*`

**Intent**: Move infrastructure utilities with no business logic. Rename `utils.ts` to `cn.ts` (its sole export is the `cn` class-name utility — FSD rule 4-4 requires domain-based naming). Move `errors.ts` and `config-status.ts`. Extract the three Action orchestration helpers (`requireSession`, `requireSupabase`, `runDomain`) from `src/actions/index.ts` into a new `actions.ts` file.

**Contract**: `src/shared/lib/index.ts` exports `cn` (from `cn.ts`), `DomainError` (from `errors.ts`), `missingConfigs` (from `config-status.ts`), `requireSession`, `requireSupabase`, `runDomain` (from `actions.ts`). The smoke test (`src/lib/__tests__/smoke.test.ts`) moves to `src/shared/lib/smoke.test.ts` and updates its import. All 16 consumers of `@/lib/utils` update to `@/shared/lib`.

#### 5. Create shared/config/ segment

**Files**: `src/shared/config/*`

**Intent**: Move navigation configuration to shared config.

**Contract**: `src/shared/config/index.ts` exports `NAV_ITEMS` (and `isActive` if present in `nav.ts`). File: `nav.ts` moved from `src/lib/nav.ts`. Both consumers (`dashboard.astro`, `AppShellLayout.astro`) update to `@/shared/config`.

#### 6. Create app/layouts/

**Files**: `src/app/layouts/*`

**Intent**: Move layouts to the FSD app layer with descriptive rename. `Layout.astro` → `BaseLayout.astro` (HTML shell, theme script, config-status banners). `AppShellLayout.astro` → `SidebarLayout.astro` (authenticated sidebar + nav, wraps BaseLayout).

**Contract**: `src/app/layouts/BaseLayout.astro` and `src/app/layouts/SidebarLayout.astro`. SidebarLayout's internal import of BaseLayout uses a relative path. All 5 consumer pages update their layout imports. SidebarLayout updates its imports of `NAV_ITEMS` to `@/shared/config` and `Banner` to `@/shared/ui/Banner.astro`.

#### 7. Create app/styles/

**Files**: `src/app/styles/*`

**Intent**: Move the global stylesheet to the app layer.

**Contract**: `src/app/styles/global.css` (moved from `src/styles/global.css`). BaseLayout.astro updates its stylesheet import path.

#### 8. Update all consumer imports

**Intent**: Rewrite all imports pointing to old `@/lib/utils`, `@/lib/supabase`, `@/lib/errors`, `@/lib/nav`, `@/lib/config-status`, `@/lib/database.types`, `@/layouts/*`, and `@/components/ui/*` paths to their new `shared/` and `app/` locations. This touches ~35 files.

**Contract**: Zero old-path imports remain for the modules moved in this phase. Build passes. All tests pass with updated import paths. `src/actions/index.ts` now imports helpers from `@/shared/lib` instead of defining them inline — the action definitions themselves stay in `actions/index.ts` until Phase 3.

### Success Criteria:

#### Automated Verification:

- Build passes: `pnpm build`
- All tests pass: `pnpm test`
- Lint passes: `pnpm lint`
- Steiger runs: `pnpm dlx steiger src` (document baseline warnings)
- No imports of `@/lib/utils`, `@/lib/supabase`, `@/lib/errors`, `@/lib/nav`, `@/lib/config-status`, `@/lib/database.types`, `@/layouts/`, or `@/components/ui/` remain (verify with `rg`)

#### Manual Verification:

- App loads in browser, navigation works, theme renders correctly
- Sign-in flow works (layout renders)
- Courses page loads with catalog data
- Planner board loads and renders

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Entities

### Overview

Create the 6 entity slices with `model/` segments, moving view-model types, domain rules, labels, and Zod schemas out of `components/` and `lib/`. This phase resolves the 6-file upward import violation (`lib/planner/*` → `components/planner/types`) and segments the domain knowledge that is consumed across multiple page features.

### Changes Required:

#### 1. entities/course/

**Files**: `src/entities/course/model/*`, `src/entities/course/index.ts`

**Intent**: Consolidate course domain types, labels, pure merge/overlap rules, and Zod schemas into a single entity. Currently scattered across `components/courses/types.ts` (view-model types), `components/courses/labels.ts` (display helpers), `lib/courses/merge.ts` (pure derivation functions), `lib/courses/assertMergeParent.ts`, and `lib/schemas/course.ts` (Zod schemas).

**Contract**: `src/entities/course/index.ts` exports: `CourseRow`, `CohortTab` types (from `components/courses/types.ts`); `formatCourseLabel` (from `components/courses/labels.ts`); `deriveMergeParent`, `mergeReasonMessage` (pure functions from `lib/courses/merge.ts`); `assertMergeParent`; all Zod schemas and input types (`courseInput`, `updateCourseInput`, `deleteCourseInput`, `overlapInput`, `deleteOverlapInput`, `mergeInput`, `dissolveMergeInput`, `updateMergeHoursInput`). Tests (`merge.test.ts`, `course.test.ts`) move alongside their source files in `model/`, co-located flat.

#### 2. entities/teacher/

**Files**: `src/entities/teacher/model/*`, `src/entities/teacher/index.ts`

**Intent**: Extract the `TeacherOption` view-model type from `components/courses/types.ts` into its own entity. This type is consumed by course forms, planner collision detection, and the future teacher schedule page — a proven cross-feature boundary.

**Contract**: `src/entities/teacher/index.ts` exports `TeacherOption` type.

#### 3. entities/placement/

**Files**: `src/entities/placement/model/*`, `src/entities/placement/index.ts`

**Intent**: Move `PlannerPlacement` and `LocalPlacement` view-model types from `components/planner/types.ts` into an entity. These types are consumed by the planner UI, collision engine, and hours engine — the root cause of the 6 upward imports.

**Contract**: `src/entities/placement/index.ts` exports `PlannerPlacement`, `LocalPlacement` types. All 6 files in `lib/planner/` that imported from `@/components/planner/types` now import from `@/entities/placement`. The upward import violation is resolved.

#### 4. entities/grouping/

**Files**: `src/entities/grouping/model/*`, `src/entities/grouping/index.ts`

**Intent**: Move grouping types and pure compute engine from `lib/grouping/`. The types (`GroupingCourse`, `GroupingVariant`) and pure functions (`collision.ts`, `enumerate.ts`, `score.ts`, `utils.ts`, barrel `index.ts`) are consumed by both the grouping feature and the planner collision engine — a proven cross-feature boundary. Supabase-coupled modules (`adapters/supabase.ts`, `persist.ts`, `staleness.ts`) stay in `lib/` for now and move to `_pages/plan-detail/api/` in Phase 3.

**Contract**: `src/entities/grouping/index.ts` exports `GroupingCourse`, `GroupingVariant`, `PlannerGrouping` types; `computeGroupings`, `EnumerationCapError`; and collision/score utilities. Pure compute tests (`collision.test.ts`, `enumerate.test.ts`, `score.test.ts`, `parity.test.ts`) move flat alongside their source in `model/`. The `components/planner/types.ts` import of `GroupingCourse` now comes from `@/entities/grouping`.

#### 5. entities/plan/

**Files**: `src/entities/plan/model/*`, `src/entities/plan/index.ts`

**Intent**: Extract grid preset parsing and plan/variant view-model types into a plan entity. `parseGridPreset` from `lib/planner/grid.ts` is the initial content.

**Contract**: `src/entities/plan/index.ts` exports `parseGridPreset` and plan/variant types.

#### 6. entities/student/

**Files**: `src/entities/student/model/.gitkeep`, `src/entities/student/index.ts`

**Intent**: Stub entity for future student CRUD. Empty `model/` directory with a placeholder. Will hold student + choice view-models once student data management lands.

**Contract**: `src/entities/student/index.ts` is an empty barrel (or re-exports nothing). The directory exists to signal the planned entity.

#### 7. Update all consumer imports

**Intent**: Rewrite all imports of the moved types, schemas, labels, and pure functions. Consumers in `components/`, `lib/`, `actions/`, and `pages/` now import from entity barrels.

**Contract**: No imports of `@/components/courses/types`, `@/components/courses/labels`, `@/components/planner/types` (for the moved types), `@/lib/grouping/types`, `@/lib/grouping/collision`, `@/lib/grouping/enumerate`, `@/lib/grouping/score`, `@/lib/schemas/course`, `@/lib/courses/merge` (pure functions), or `@/lib/planner/grid` remain. The `PlannerBoardProps` type stays in `components/planner/types.ts` temporarily (it is page-local and moves to `_pages/plan-detail/model/` in Phase 3).

### Success Criteria:

#### Automated Verification:

- Build passes: `pnpm build`
- All tests pass: `pnpm test`
- Lint passes: `pnpm lint`
- Steiger runs: `pnpm dlx steiger src` (violations should decrease from Phase 1 baseline)
- No upward imports from `lib/` → `components/` remain: `rg "from [\"']@/components/" src/lib/` returns empty
- No imports of old entity-source paths remain (verify with `rg`)

#### Manual Verification:

- Courses page loads with correct data and filtering
- Planner board loads, groupings render, drag-drop works
- Course create/edit/delete dialogs work
- Merge builder dialog correctly derives merge parents

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Pages & Actions Barrel

### Overview

Create the `_pages/` FSD layer with 5 page slices. Extract page loaders to `api/` segments, move UI components to `ui/` segments, move page-local helpers to `model/` segments. Slim all `src/pages/*.astro` files to thin routing shells. Restructure `src/actions/index.ts` into a thin composition barrel importing from `_pages/courses/api/`.

Recommended commit order within this phase (smallest diff first, proves the pattern before tackling the biggest migration): `plan-detail` → `courses` → `plans-list` → `dashboard` → `sign-in` → actions barrel.

### Changes Required:

#### 1. _pages/plan-detail/

**Files**: `src/_pages/plan-detail/{api,ui,model}/*`, `src/_pages/plan-detail/index.ts`

**Intent**: The planner board page is the cleanest migration — `plans/[id].astro` already delegates to `loadPlannerData()`. Move the loader, planner UI components, planner pure functions, placement validation, grouping orchestration (Supabase-coupled modules), and the `usePlacements` hook.

**Contract**:
- `api/`: `loadPlannerData` (from `lib/planner/load.ts`), grouping Supabase adapter (`lib/grouping/adapters/supabase.ts`), `persistGroupings` + `computeCatalogHash` (from `lib/grouping/persist.ts`), `staleness` (from `lib/grouping/staleness.ts`). `lib/courses/shared.ts` SupabaseClient alias replaced by import from `@/shared/api`. Integration tests (`adapter-parity.integration.test.ts`, `endpoint.integration.test.ts`) move alongside.
- `ui/`: All 9 planner components (`PlannerBoard`, `PlannerGrid`, `PlannerPalette`, `SlotCell`, `GroupingBox`, `GroupingFilter`, `ErrorBanner`, `PlanSummaryBar`, `ComputeGroupingsEmptyState`) from `components/planner/`.
- `model/`: `collisions.ts`, `hours.ts` (from `lib/planner/`), `usePlacements.ts`, `client.ts` (temporary, deleted in Phase 5), `validate.ts` (from `lib/placements/`), `PlannerBoardProps` type (from `components/planner/types.ts`). Tests (`collisions.test.ts`, `hours.test.ts`, `validate.test.ts`) move flat alongside source.
- `index.ts` barrel exports the main `PlannerBoard` component.
- `src/pages/plans/[id].astro` becomes a thin routing shell: imports `createClient` from `@/shared/api`, calls `loadPlannerData` from `@/_pages/plan-detail/api`, maps result, renders `PlannerBoard` from `@/_pages/plan-detail/ui/PlannerBoard.tsx`.

#### 2. _pages/courses/

**Files**: `src/_pages/courses/{api,ui,model}/*`, `src/_pages/courses/index.ts`

**Intent**: The courses page is the biggest migration — `courses.astro` has an inline 5-table loader + merge/overlap projection (the worst smell). Extract the loader, move all course UI components and CRUD domain modules, and co-locate the course Action definitions.

**Contract**:
- `api/`: New `loader.ts` (extracted from `courses.astro` frontmatter — the 5-table fan-out query + merge/overlap business logic); course CRUD domain modules (from `lib/courses/`: `createCourse.ts`, `updateCourse.ts`, `deleteCourse.ts`, `createOverlap.ts`, `deleteOverlap.ts`, `createMerge.ts`, `dissolveMerge.ts`, `updateMergeHours.ts`); course Action definitions (the 8 `defineAction` blocks extracted from `src/actions/index.ts`). `mergeActions.test.ts` moves alongside.
- `ui/`: All 7 course components (`CourseCatalog`, `CourseFormDialog`, `CourseOverlaps`, `DeleteCourseDialog`, `MergeBuilderDialog`, `MergeManageDialog`, `TeacherFilter`) from `components/courses/`.
- `model/`: `filterParams.ts`, `useCourseFilters.ts`, and their tests (`filterParams.test.ts`, `useCourseFilters.test.ts`).
- `index.ts` barrel exports the main `CourseCatalog` component.
- `src/pages/courses.astro` becomes a thin routing shell following the `plans/[id].astro` pattern.

#### 3. _pages/plans-list/

**Files**: `src/_pages/plans-list/{api,ui}/*`, `src/_pages/plans-list/index.ts`

**Intent**: Extract the inline `fetchPlans` loader from `plans/index.astro` into a proper `api/` segment. Create a page component in `ui/`.

**Contract**:
- `api/`: New `loader.ts` with the `fetchPlans` query extracted from `plans/index.astro` frontmatter.
- `ui/`: Page component (`.astro` if zero JS, `.tsx` if interactive).
- `src/pages/plans/index.astro` becomes a thin routing shell.

#### 4. _pages/dashboard/

**Files**: `src/_pages/dashboard/ui/*`, `src/_pages/dashboard/index.ts`

**Intent**: Create a minimal page slice for the dashboard. The dashboard currently has no inline loader (reads `Astro.locals.user` only) and no components to extract.

**Contract**:
- `ui/`: Page component (`.astro`, zero JS). The welcome message and any dashboard content move here.
- `src/pages/dashboard.astro` becomes a thin routing shell.

#### 5. _pages/sign-in/

**Files**: `src/_pages/sign-in/ui/*`, `src/_pages/sign-in/index.ts`

**Intent**: Move auth form components from `components/auth/` to a dedicated page slice.

**Contract**:
- `ui/`: `SignInForm.tsx`, `FormField.tsx`, `PasswordToggle.tsx`, `SubmitButton.tsx`, `ServerError.tsx` (from `components/auth/`).
- `index.ts` barrel exports `SignInForm`.
- `src/pages/auth/signin.astro` becomes a thin routing shell.

#### 6. Slim all src/pages/*.astro to routing shells

**Intent**: Every `src/pages/*.astro` file becomes a thin entry point: create Supabase client, call the loader from `_pages/*/api/`, set HTTP status, choose layout, render a single slice component from `_pages/*/ui/`. No business logic, no inline queries, no component composition.

**Contract**: Each page file is <25 lines. Pattern: frontmatter calls loader (if any), body renders `<Layout>` + one component. `src/pages/index.astro` (redirect to `/dashboard`) stays as-is.

#### 7. Actions barrel restructure

**Files**: `src/actions/index.ts`

**Intent**: After the 8 `defineAction` blocks move to `_pages/courses/api/`, slim `src/actions/index.ts` to a pure composition barrel. The shared helpers (`requireSession`, `requireSupabase`, `runDomain`) already moved to `shared/lib/actions.ts` in Phase 1.

**Contract**: `src/actions/index.ts` imports course action groups from `@/_pages/courses/api` and spreads them into the `server` export. Flat spread (not nested namespace) to preserve existing call sites (`actions.createCourse`, etc.). No behavioral change — all Action call sites in course dialogs (`astro:actions` import) remain unchanged.

### Success Criteria:

#### Automated Verification:

- Build passes: `pnpm build`
- All tests pass: `pnpm test`
- Lint passes: `pnpm lint`
- Steiger runs: `pnpm dlx steiger src` (significant improvement from Phase 2)
- No imports of `@/components/auth/`, `@/components/courses/`, `@/components/planner/`, `@/lib/planner/`, `@/lib/courses/` (CRUD modules), `@/lib/placements/`, `@/lib/grouping/adapters/`, `@/lib/grouping/persist`, `@/lib/grouping/staleness` remain
- All `src/pages/*.astro` files are <25 lines each (verify with `wc -l`)

#### Manual Verification:

- Full app navigation works (dashboard, courses, plans list, plan detail, sign-in)
- Course CRUD operations work (create, edit, delete)
- Merge builder and overlap management work
- Planner board drag-drop placement works
- Grouping computation works (empty state trigger + result display)
- Auth sign-in and sign-out work

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Cleanup & Verification

### Overview

Delete all emptied original directories, verify no stale imports remain, standardize test co-location to flat pattern, run a full steiger validation, and confirm the complete CI gate passes. This phase produces no behavioral change — it is pure housekeeping.

### Changes Required:

#### 1. Delete emptied directories

**Files**: `src/components/`, `src/layouts/`, `src/lib/` (remaining contents), `src/styles/`

**Intent**: Remove all directories that are now empty after Phases 1–3 relocated their contents. Verify each is truly empty before deleting.

**Contract**: `src/components/`, `src/layouts/`, `src/styles/` directories no longer exist. `src/lib/` no longer exists (all modules have moved to `shared/`, `entities/`, or `_pages/`). Only `src/test/load-test-env.ts` remains at its original location (test infrastructure, not part of FSD layers).

#### 2. Verify test co-location is flat

**Intent**: Confirm all test files sit beside their source files (not in `__tests__/` subdirectories). If any `__tests__/` dirs remain from the file moves, flatten them.

**Contract**: `find src -name __tests__ -type d` returns empty. Every `.test.ts` file sits in the same directory as the module it tests.

#### 3. Full steiger validation

**Intent**: Run steiger with zero expected errors. Document any remaining warnings with justification.

**Contract**: `pnpm dlx steiger src` exits 0 or produces only documented, justified warnings (e.g., the `student` entity stub may trigger `insignificant-slice`).

#### 4. Full CI gate

**Intent**: Run the complete CI pipeline locally to confirm everything passes.

**Contract**: `pnpm install --frozen-lockfile && pnpm exec astro sync && pnpm lint && pnpm test && pnpm build` all succeed.

### Success Criteria:

#### Automated Verification:

- Build passes: `pnpm build`
- All tests pass: `pnpm test`
- Lint passes: `pnpm lint`
- Steiger clean: `pnpm dlx steiger src` (zero errors)
- No `src/components/`, `src/layouts/`, `src/lib/`, `src/styles/` directories exist
- No `__tests__/` subdirectories exist under `src/`
- No stale imports: `rg "from [\"']@/(components|lib|layouts)/" src/` returns empty

#### Manual Verification:

- Full app smoke test: navigate every page, trigger every CRUD operation, verify planner drag-drop

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Behavioral Changes

### Overview

Execute Track B: revise the `lessons.md` rule, migrate the `placements` and `grouping` API routes to Astro Actions, fix auth DS compliance, and delete obsolete files. This phase changes runtime behavior — the app's mutation transport shifts from hand-rolled `fetch` to typed Actions for placements and grouping.

### Changes Required:

#### 1. Update lessons.md

**File**: `context/foundation/lessons.md`

**Intent**: Revise the "Two mutation styles, split by purpose" lesson to reflect the unified Actions rule. This happens first in Phase 5 so agents reading `lessons.md` during implementation see the correct rule.

**Contract**: The lesson's Rule section becomes: *Astro Actions are the single transport for all app-data mutations + compute; API routes are reserved only for raw Request/Response needs (webhooks, external/non-Astro consumers, streaming, file downloads, auth session endpoints).* Auth signin/signout routes are explicitly scoped out. The stale `LibBadge.astro` example in the semantic-tokens lesson is corrected to reference the auth components.

#### 2. Create placement domain module

**Files**: `src/_pages/plan-detail/api/placement-actions.ts`

**Intent**: Extract the inline Supabase insert/delete + idempotency business rule from `src/pages/api/placements.ts` into a proper domain module, then define `createPlacement` and `deletePlacement` Actions.

**Contract**: Two new Actions (`createPlacement`, `deletePlacement`) with Zod input validation. `createPlacement` returns the placement row (real `id`) for optimistic reconciliation; unique-violation returns existing row (idempotent). `deletePlacement` returns `{id}`. Error codes: `UNAUTHORIZED`, `INTERNAL_SERVER_ERROR`. The `usePlacements` hook in `_pages/plan-detail/model/` switches from `@/_pages/plan-detail/model/client.ts` fetch wrapper to `import { actions } from "astro:actions"`.

#### 3. Create grouping domain module

**Files**: `src/_pages/plan-detail/api/grouping-actions.ts`

**Intent**: Extract the inline UUID validation, plan/cohort existence checks, and load→compute→persist orchestration from `src/pages/api/grouping.ts` into a proper domain module, then define a `computeGroupings` Action.

**Contract**: New `computeGroupings` Action with Zod input (replacing inline UUID validation). Error codes: `UNAUTHORIZED`, `NOT_FOUND` (missing plan/cohort), `UNPROCESSABLE_CONTENT` (EnumerationCapError → 422), `INTERNAL_SERVER_ERROR`. Returns `{groupings, names, catalogHash, warnings}`. `ComputeGroupingsEmptyState.tsx` switches from `fetch("POST /api/grouping")` to `actions.computeGroupings(input)`.

#### 4. Update actions barrel

**File**: `src/actions/index.ts`

**Intent**: Add the new placement and grouping action groups to the composition barrel.

**Contract**: `src/actions/index.ts` imports from `@/_pages/courses/api` (existing) and `@/_pages/plan-detail/api` (new), spreads all into `server` export. All Action call sites use `astro:actions` import (unchanged).

#### 5. Delete obsolete files

**Files**: `src/pages/api/placements.ts`, `src/pages/api/grouping.ts`, `src/_pages/plan-detail/model/client.ts`

**Intent**: Remove the now-replaced API routes and the misnamed browser fetch wrapper. The duplicated `json()` and `isRecord` helpers in the API routes are no longer needed.

**Contract**: `src/pages/api/placements.ts` and `src/pages/api/grouping.ts` deleted. `src/_pages/plan-detail/model/client.ts` deleted. `src/pages/api/auth/signin.ts` and `src/pages/api/auth/signout.ts` remain (explicitly out of scope). The `endpoint.integration.test.ts` is updated or rewritten to test the new Action instead of the old API route.

#### 6. Fix auth DS compliance

**Files**: `src/_pages/sign-in/ui/FormField.tsx`, `src/_pages/sign-in/ui/SubmitButton.tsx`, `src/_pages/sign-in/ui/ServerError.tsx`

**Intent**: Replace hardcoded palette colors with semantic theme tokens and shadcn primitives, resolving the DS non-compliance documented in research. `FormField` should compose `@/shared/ui` `Input` instead of hardcoding `bg-white/10 border…`. `SubmitButton` should compose `Button` instead of hardcoding `bg-purple-600`. `ServerError` should use semantic destructive tokens instead of `border-red-500/30 bg-red-900/30 text-red-300`.

**Contract**: Zero hardcoded palette-named color utilities (`bg-white`, `bg-purple-*`, `text-red-*`, `border-red-*`, etc.) remain in auth components. All styling uses semantic tokens (`bg-background`, `text-foreground`, `bg-destructive/10`, `text-destructive`, `border-destructive`, etc.) or shadcn primitive composition. If a needed token is missing, add it to `src/app/styles/global.css` (`:root` + `.dark` + `@theme inline`) first.

### Success Criteria:

#### Automated Verification:

- Build passes: `pnpm build`
- All tests pass: `pnpm test` (including updated integration test)
- Lint passes: `pnpm lint`
- Steiger clean: `pnpm dlx steiger src`
- No `src/pages/api/placements.ts` or `src/pages/api/grouping.ts` exist
- No `client.ts` in `_pages/plan-detail/model/`
- No palette-named color classes in auth components: `rg "bg-(white|purple|red|blue|slate|gray)" src/_pages/sign-in/` returns empty
- `lessons.md` contains the updated unified Actions rule

#### Manual Verification:

- Planner drag-drop placement works end-to-end (add, move, remove) — optimistic UI + server reconciliation
- Grouping computation triggers correctly from empty state, results display in palette
- Sign-in form renders correctly in both light and dark themes with semantic tokens
- Sign-out flow works (auth API routes still intact)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- All 15 existing tests move with their source files; only import paths change
- Tests are co-located flat beside their source (standardized in Phase 4)
- New tests: placement Action domain module, grouping Action domain module (Phase 5)
- The smoke test moves to `shared/lib/` and verifies the `@/shared/lib` import resolves

### Integration Tests:

- `adapter-parity.integration.test.ts` moves to `_pages/plan-detail/api/` (Phase 3)
- `endpoint.integration.test.ts` is rewritten in Phase 5 to test the new `computeGroupings` Action instead of `POST /api/grouping`
- Integration tests continue to require local Supabase stack (`pnpm test:integration`)

### Manual Testing Steps:

1. Navigate every page (dashboard, courses, plans list, plan detail, sign-in)
2. Create, edit, delete a course — verify catalog updates
3. Create an overlap, a merge — verify UI reflects
4. Open the planner, drag-drop a grouping onto a slot — verify placement persists
5. Remove a placement — verify it disappears
6. Trigger grouping computation from empty state — verify groupings appear
7. Sign out and sign back in — verify auth flow
8. Toggle dark mode — verify all components use semantic tokens (especially auth)

## Performance Considerations

- The `<200ms` placement validation budget is unaffected — it governs client-side `deriveCollisions`, not the server round-trip. Transport change (fetch → Actions) does not impact this.
- No new client-side bundles are introduced. The existing React islands remain the same size.
- The Actions transport uses Astro's built-in devalue serialization, which handles `Map` natively — the grouping response can drop `Object.fromEntries` conversion.

## Migration Notes

- **Commit discipline**: one commit per logical file-move batch. Never mix relocation with refactoring. Every commit passes `pnpm build && pnpm test`.
- **Import search**: after each file move, run `rg "from [\"']@/<old-path>"` to find all consumers. Update them in the same commit.
- **Steiger warnings during migration**: intermediate phases may produce FSD warnings (e.g., stale files in `components/` during Phase 3). These are expected and resolve by Phase 4 cleanup. Errors (not warnings) are not acceptable at any point.
- **Vitest config**: `vitest.config.ts` includes `src/**/*.test.ts` — this pattern continues to work regardless of which `src/` subdirectory tests live in. No config change needed.
- **The `src/test/` directory** stays at its current location — it is test infrastructure, not part of FSD layers.

## References

- Research: `context/changes/architecture-refactor/research.md`
- FSD v2.1 skill: `.claude/skills/feature-sliced-design/SKILL.md`
- Astro FSD integration: `.claude/skills/feature-sliced-design/references/framework-integration.md`
- Lessons: `context/foundation/lessons.md`
- PRD: `context/foundation/prd.md`
- Clean loader pattern: `src/pages/plans/[id].astro` + `src/lib/planner/load.ts`
- Clean Action pattern: `src/actions/index.ts` (thin orchestration)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundation (shared/ + app/)

#### Automated

- [ ] 1.1 steiger installed as devDep
- [ ] 1.2 shared/ui/ segment created with barrel, all shadcn + Banner + LibBadge moved
- [ ] 1.3 shared/api/ segment created with barrel, supabase + database.types moved
- [ ] 1.4 shared/lib/ segment created with barrel, cn + errors + config-status + actions helpers moved
- [ ] 1.5 shared/config/ segment created with barrel, nav.ts moved
- [ ] 1.6 app/layouts/ created, layouts moved and renamed
- [ ] 1.7 app/styles/ created, global.css moved
- [ ] 1.8 All ~35 consumer imports updated, zero old-path imports remain
- [ ] 1.9 Build passes: `pnpm build`
- [ ] 1.10 Tests pass: `pnpm test`
- [ ] 1.11 Lint passes: `pnpm lint`

#### Manual

- [ ] 1.12 App loads, navigation works, theme renders
- [ ] 1.13 Full page smoke test (dashboard, courses, plans, sign-in)

### Phase 2: Entities

#### Automated

- [ ] 2.1 entities/course/ created with model/ and barrel
- [ ] 2.2 entities/teacher/ created with model/ and barrel
- [ ] 2.3 entities/placement/ created with model/ and barrel
- [ ] 2.4 entities/grouping/ created with model/ and barrel, pure compute moved
- [ ] 2.5 entities/plan/ created with model/ and barrel
- [ ] 2.6 entities/student/ stub created
- [ ] 2.7 All consumer imports updated, zero upward imports remain
- [ ] 2.8 Build passes: `pnpm build`
- [ ] 2.9 Tests pass: `pnpm test`
- [ ] 2.10 Lint passes: `pnpm lint`

#### Manual

- [ ] 2.11 Courses page loads, filtering works
- [ ] 2.12 Planner board loads, drag-drop works
- [ ] 2.13 Course dialogs (create, merge, overlap) work

### Phase 3: Pages & Actions Barrel

#### Automated

- [ ] 3.1 _pages/plan-detail/ created with api/, ui/, model/ segments
- [ ] 3.2 _pages/courses/ created with api/, ui/, model/ segments
- [ ] 3.3 _pages/plans-list/ created with api/, ui/ segments
- [ ] 3.4 _pages/dashboard/ created with ui/ segment
- [ ] 3.5 _pages/sign-in/ created with ui/ segment
- [ ] 3.6 All src/pages/*.astro files are thin routing shells (<25 lines)
- [ ] 3.7 src/actions/index.ts is a thin composition barrel
- [ ] 3.8 All consumer imports updated, zero old-path imports remain
- [ ] 3.9 Build passes: `pnpm build`
- [ ] 3.10 Tests pass: `pnpm test`
- [ ] 3.11 Lint passes: `pnpm lint`

#### Manual

- [ ] 3.12 Full app navigation works
- [ ] 3.13 All CRUD operations work (courses, overlaps, merges)
- [ ] 3.14 Planner drag-drop and grouping computation work

### Phase 4: Cleanup & Verification

#### Automated

- [ ] 4.1 src/components/, src/layouts/, src/lib/, src/styles/ deleted
- [ ] 4.2 No __tests__/ subdirectories remain
- [ ] 4.3 Steiger clean: `pnpm dlx steiger src` (zero errors)
- [ ] 4.4 Full CI gate passes: install → astro sync → lint → test → build

#### Manual

- [ ] 4.5 Full app smoke test: every page, every CRUD operation, planner drag-drop

### Phase 5: Behavioral Changes

#### Automated

- [ ] 5.1 lessons.md updated with unified Actions rule
- [ ] 5.2 Placement Actions created and wired
- [ ] 5.3 Grouping Action created and wired
- [ ] 5.4 Actions barrel updated with new action groups
- [ ] 5.5 Obsolete files deleted (API routes, client.ts)
- [ ] 5.6 Auth DS compliance fixed (zero palette colors in auth components)
- [ ] 5.7 Build passes: `pnpm build`
- [ ] 5.8 Tests pass: `pnpm test`
- [ ] 5.9 Lint passes: `pnpm lint`
- [ ] 5.10 Steiger clean: `pnpm dlx steiger src`

#### Manual

- [ ] 5.11 Planner placement works end-to-end (add, move, remove)
- [ ] 5.12 Grouping computation works from empty state
- [ ] 5.13 Sign-in form renders correctly in light and dark themes
- [ ] 5.14 Sign-out flow works
