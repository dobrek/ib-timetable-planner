# Clean up & re-architect `shared/lib` (+ `shared/config` boundary) Implementation Plan

## Overview

Re-architect `src/shared/lib` and `src/shared/config` so each FSD segment holds only what belongs in it, clear the Steiger 15-module cap with headroom, and unblock the queued F3 move of `grid` + `slot-labels` from `config` → `lib`. The move is mostly mechanical (relocate + regroup + repoint importers). On top of the structural correction this change also fixes 6 verified correctness bugs, runs a full declarative-dedup sweep (a reusable `{data,error}`→`DomainError` combinator + a `groupBy` projection variant, applied everywhere they're hand-rolled), and adds unit coverage to the previously-untested pure modules.

The driver is the teacher-availability follow-up **F3** (`context/changes/teacher-availability/follow-ups/review-fixes.md`), which wanted `grid`/`slot-labels` in `lib` but was blocked by the 15-cap. Research (`context/changes/clean-up-shared-lib/research.md`) found the cap is a symptom: ~⅓ of `shared/lib` is data-access (`postgrest/`, `load-cohort-courses`) or app-shell config (`config-status.ts`) that accreted there before `shared/api` matured.

## Current State Analysis

- **`shared/lib` is at exactly 15 top-level children** (verified): 6 folders (`actions/`, `catalog-hash/`, `cn/`, `course-label/`, `postgrest/`, `write-parent-with-links/`) + 8 files (`call-action.ts`, `collections.ts`, `config-status.ts`, `errors.ts`, `forms.ts`, `loaders.ts`, `result.ts`, `use-url-synced-filters.ts`) + `index.ts`. The Steiger rule `fsd/shared-lib-grouping` warns at **>15** (`THRESHOLD = 15`, strict `>`), and `package.json`'s `steiger src --fail-on-warnings` makes a warning a CI failure. Adding `grid/` + `slot-labels/` (→17) is blocked.
- **Layers are `app → _pages → shared`; there is no `entities` layer.** A domain-aware helper shared by two sibling slices has nowhere to live but `shared`. Within `shared`, segments may import each other (`lib → config`, `api → lib` are legal).
- **`shared/api` already holds loose data-access readers** (`load-plan-summary.ts`, `supabase.ts`, `database.types.ts`) — the proven home for `postgrest/` and `load-cohort-courses`.
- **The `shared/lib` barrel (`index.ts`) is astro-poisoned:** it re-exports `actions/` (`astro:actions`) and `config-status` (`astro:env/server`), so importing it under Vitest drags in unresolvable virtual modules. This is why `catalog-hash/index.ts` and `forms.ts` carry "never reach via the `@/shared/lib` barrel" comments. All postgrest call sites already deep-import (`@/shared/lib/postgrest`); all 8 `defineDomainAction` consumers import via the barrel.
- **Test coverage is near-zero:** 3 test files in scope (`postgrest`, `write-parent-with-links`, `cn`), 0 in `config`, no coverage tooling. The richest untested logic (`grid` parsing, `compute-catalog-hash`, `collections`) is pure and trivially testable.
- **6 verified bugs** (research §C), most severe being a locale-sensitive sort in `compute-catalog-hash.ts:22` that can silently drift the catalog SHA-256 across runtimes.

### Key Discoveries

- Steiger gate mechanics: `node_modules/@feature-sliced/steiger-plugin/dist/index.js:926,939` — `THRESHOLD = 15`, check is `lib.children.length > THRESHOLD`. Folders and files each count 1; nested files don't count; the barrel `index.ts` counts. No equivalent cap exists for `shared/api` or `shared/config`.
- `loaders.ts` is split-personality: `withSupabase` (generic combinator → belongs with `result`) + `assertNoQueryErrors` (PostgREST envelope inspector, throws a plain `Error` → belongs in `api/postgrest`, re-homed onto `DomainError`).
- `catalog-hash/types.ts` is re-exported through `plan-detail/model/grouping.ts` (`export type { ComputeWarning, GroupingCourse }`), so most `plan-detail/model/*` files get those types via the model re-export, not directly — the split only touches the **7 direct** importers of `@/shared/lib/catalog-hash`.
- `grid.ts` imports `DEFAULT_GRID_PRESET` from `grid-presets.ts`; after the F3 move this becomes a `lib/grid → config/grid-presets` edge — the intended, legal direction.
- `plans-list/ui/PlanFormDialog.tsx` imports `GRID_PRESETS`/`DEFAULT_GRID_PRESET` from `grid-presets.ts` (which **stays** in `config`), so it does **not** need repointing.

## Desired End State

- `pnpm steiger` passes with no `shared-lib-grouping` warning; `shared/lib` has **13** top-level children, every loose utility now a named folder.
- `shared/config` holds only constants / enums / schemas / env.
- `shared/api` owns all PostgREST/Supabase data-access (`postgrest/`, `load-cohort-courses`, plus the re-homed `assertNoQueryErrors`).
- `config-status` lives in `src/app/config/`, consumed by `BaseLayout.astro`.
- The `shared/lib` barrel is Vitest-safe (no `astro:*`-coupled module reachable from it) and free of dual import paths; the "never import via barrel" workaround comments are gone.
- All 6 bugs are fixed and locked by tests; the `{data,error}` and `groupBy` duplication is replaced by shared combinators everywhere.
- `pnpm lint`, `pnpm test`, `pnpm build` all green.

Verify: `pnpm steiger && pnpm lint && pnpm test && pnpm build` clean; `ls src/shared/lib | wc -l` ≤ 14 (13 + trailing newline); `grep -rn "never reach it via" src/shared` returns nothing.

## What We're NOT Doing

- Not introducing an `entities` layer (none exists; out of scope). `course-label` and `slot-labels` remain legitimate pure-presentation helpers in `shared/lib`.
- Not adding coverage tooling (`@vitest/coverage-v8`) — tests only, per decision.
- Not adding a hard coverage CI threshold.
- Not changing any runtime behavior except the 6 bug fixes and the lower-severity polish explicitly listed.
- Not touching `grid-presets.ts` placement (stays in `config`).
- Not rewriting the constraint core in `plan-detail/model/` — only repointing imports it inherits, **except** the single behavior-preserving `groupByTeacher` → `groupByInto` dedup in `constraints/teacher-conflict.ts` (Phase 4 §2), locked by a null-teacher invariant test.

## Implementation Approach

Five sequential phases, each independently green on `steiger` / `lint` / `test` / `build`:

1. **Relocate transport out of `lib`** (`postgrest/`, `assertNoQueryErrors`, `load-cohort-courses`) into `shared/api`, and `config-status` into `app/`. This frees the slots and fixes the boundary first. After this phase `lib` is at 13 (only `postgrest/` and `config-status.ts` leave the top level; `loaders.ts` and `catalog-hash/` stay).
2. **Regroup the remaining `lib` into folders and slim the barrel** to be Vitest-safe. Drops the count by 2 (13→11: `loaders.ts` deleted, `call-action.ts` folded into `actions/`); satisfies the "lib of libs" intent.
3. **Move `grid` + `slot-labels` `config → lib`** (the original F3 ask, now unblocked). `lib` lands at 13; steiger clean.
4. **Declarative dedup sweep** — add the combinators and migrate every hand-rolled copy across slices.
5. **Bug fixes + unit tests** — fix #1–#6 (each locked by a test) and add Tier-1/Tier-2 coverage.

Phases 1–3 are pure structure (imports move, behavior unchanged). Phases 4–5 are behavior/quality and operate on modules already in their final homes.

## Critical Implementation Details

- **`git mv`, not delete+create**, for every folder relocation so history follows the code and review stays legible.
- **Ordering within Phase 1:** move a module, then repoint its importers, then run `pnpm steiger`/`pnpm build` before the next module — never leave a half-repointed tree between modules. The deep-import convention (all 19 postgrest sites already use `@/shared/lib/postgrest`) makes each repoint a single path swap.
- **The catalog-hash split creates a legal `api → lib` edge:** `load-cohort-courses.ts` (in `api`) imports its types from `@/shared/lib/catalog-hash`. The 4 files importing **both** `computeCatalogHash` and `loadCohortCourses` from the old path must split into two import lines (compute from `lib`, loader from `api`).
- **Bug #1 (`localeCompare`) must be fixed before or alongside its test** — the test asserts cross-environment hash stability, which is the property `localeCompare` violates.

## Phase 1: Relocate transport → `shared/api` + `config-status` → `app/`

### Overview

Move all PostgREST/Supabase data-access and the env-driven shell banner out of `lib`, repointing every importer. Frees 2 top-level slots (lib 15→13) and corrects the FSD boundary. No behavior change except `assertNoQueryErrors` now throws `DomainError`.

### Changes Required

#### 1. Move `postgrest/` → `shared/api/postgrest/`

**File**: `src/shared/lib/postgrest/` → `src/shared/api/postgrest/` (incl. `index.ts`, `postgrest.test.ts`)

**Intent**: `postgrest/` decodes the PostgREST `{data,error}` envelope and hard-codes SQLSTATEs (`UNIQUE_VIOLATION`, `NOT_FOUND_ROW`) — textbook transport, belongs in `api` next to `load-plan-summary.ts`.

**Contract**: `git mv` the folder. Add its public symbols (`UNIQUE_VIOLATION`, `NOT_FOUND_ROW`, `unwrapRow`, `unwrapCompleted`, `RowResult`/types) to `src/shared/api/index.ts`. Repoint the **19 deep importers** (all use `from "@/shared/lib/postgrest"`) to `@/shared/api/postgrest`: every file under `src/_pages/{courses,students,teachers}/api/*` that touches courses/students/teachers CRUD, plus `plan-detail/api/{placements,slot-bundles}.ts` and `plans-list/api/{create-plan,delete-plan,rename-plan}.ts`. Remove the postgrest re-export line from `src/shared/lib/index.ts`.

#### 2. Re-home `assertNoQueryErrors` into `shared/api/postgrest`, on `DomainError`

**File**: `src/shared/lib/loaders.ts` → split; `src/shared/api/postgrest/index.ts`

**Intent**: `assertNoQueryErrors` inspects the PostgREST `{error}` envelope but throws a plain `Error`, diverging from the cluster's `DomainError` currency (research §C lower-severity). Co-locate it with its producer and unify the error type.

**Contract**: Move `assertNoQueryErrors` into `api/postgrest`; have it throw `DomainError` instead of `Error`. Export from the `api` barrel. Repoint its importers (the `plan-detail/api` loaders that batch parallel reads). Leave `withSupabase` + `LoaderResult` in `loaders.ts` for Phase 2.

#### 3. Split `catalog-hash`: `load-cohort-courses` → `shared/api`

**File**: `src/shared/lib/catalog-hash/load-cohort-courses.ts` → `src/shared/api/load-cohort-courses.ts`

**Intent**: `load-cohort-courses` issues `.from("courses"/"student_choices"/…)` queries — a data-access reader. `compute-catalog-hash.ts` + `types.ts` are pure and stay in `lib/catalog-hash/`.

**Contract**: `git mv` the file to `api/` (a loose reader, mirroring `load-plan-summary.ts`). It imports its types (`GroupingCourse`, `CohortCatalog`, `ComputeWarning`, `CatalogSnapshot`) from `@/shared/lib/catalog-hash` (legal `api → lib`). Export `loadCohortCourses` from the `api` barrel; remove it from `lib/catalog-hash/index.ts` (which now exports only `computeCatalogHash` + types) and delete that file's "never reach via the barrel" comment. Repoint the **6 `loadCohortCourses` importers** to `@/shared/api`: `plan-detail/api/{load,staleness,grouping-compute}.ts`, `plan-detail/api/adapter-parity.integration.test.ts`, `plans-list/api/clone-plan.ts`, `plans-list/api/plan-actions.integration.test.ts`. The **4 files importing both** symbols (`staleness.ts`, `grouping-compute.ts`, `clone-plan.ts`, `plan-actions.integration.test.ts`) split into two import lines (compute from `lib`, loader from `api`); `load.ts` and `adapter-parity.integration.test.ts` import **only the loader** — single repoint, no split. `grouping.ts` re-exports types only — leave its path pointing at `lib/catalog-hash`.

#### 4. Move `config-status.ts` → `src/app/config/`

**File**: `src/shared/lib/config-status.ts` → `src/app/config/config-status.ts`

**Intent**: It reads `astro:env/server` to drive an unconfigured-service banner, consumed only by `BaseLayout.astro`. It's shell-specific app config, not a reusable shared util, and it's one of the two modules poisoning the `lib` barrel.

**Contract**: Create `src/app/config/`; `git mv` the file in. Repoint `src/app/layouts/BaseLayout.astro` (the only importer) to the new path. Remove the `configStatuses`/`missingConfigs`/`ConfigStatus` re-export from `src/shared/lib/index.ts`. (Stale Polish copy + wrong `docsUrl` at `config-status.ts:15-16` are fixed in Phase 5.) Confirm `steiger` accepts an app-layer `config/` segment; if it flags the segment, fall back to `src/app/lib/config-status.ts`.

#### 5. Verify the slot count

**Intent**: Confirm the relocations landed `lib` at 13 before proceeding.

**Contract**: `ls -1 src/shared/lib | grep -v '^$'` shows 13 entries (no `postgrest`, no `config-status.ts`; `loaders.ts` still present, `catalog-hash/` still present holding compute+types).

### Success Criteria

#### Automated Verification

- [ ] `pnpm steiger` passes (lib now well under cap)
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes (postgrest tests run from new location)
- [ ] `pnpm build` passes
- [ ] `grep -rn "from \"@/shared/lib/postgrest\"" src` returns nothing
- [ ] `ls -1 src/shared/lib | grep -vc '^$'` == 13

#### Manual Verification

- [ ] App boots; the unconfigured-service banner still renders when Supabase env is absent
- [ ] A create/update flow surfaces a `DomainError` (e.g. duplicate → unique-violation message) unchanged
- [ ] A batch-parallel read failure (the `assertNoQueryErrors` path) surfaces correctly through `runDomain`/the action layer after the `Error`→`DomainError` switch — message/status unchanged or intentionally improved

**Implementation Note**: After automated verification passes, pause for human confirmation of manual testing before Phase 2.

---

## Phase 2: Regroup remaining `lib` into folders + slim the barrel

### Overview

Convert the loose `lib` files into named folders ("lib of libs") and make the barrel Vitest-safe. Drops the count by 2 (13→11): `loaders.ts` is deleted (its `withSupabase`/`LoaderResult` fold into `result/`) and `call-action.ts` folds into `actions/`.

### Changes Required

#### 1. Files → folders

**File**: `collections.ts`→`collections/`, `errors.ts`→`errors/`, `result.ts`→`result/`, `use-url-synced-filters.ts`→`use-url-synced-filters/`

**Intent**: Group each loose utility into a folder so it can host its tests and satisfy the FSD grouping intent.

**Contract**: For each, create the folder with an `index.ts` (the existing source, renamed) and keep the public path stable where possible (`@/shared/lib/collections` etc.). `withSupabase` + `LoaderResult` move from `loaders.ts` into `result/` (they pair with `Result`/`ok`/`err`); delete `loaders.ts`. Fix the `fetch` parameter shadowing the Workers global while moving `withSupabase` (research §C lower-severity).

#### 2. Create `forms/` and fold `call-action` into `actions/`

**File**: `forms.ts` + `actions/apply-action-errors.ts` → `forms/`; `call-action.ts` → `actions/`

**Intent**: `apply-action-errors` is a react-hook-form bridge mis-foldered under `actions/`; it belongs with the form flows. `call-action` is the client half of action transport and belongs in `actions/`.

**Contract**: Create `forms/` = `forms.ts` (→ `forms/index.ts`) + `git mv actions/apply-action-errors.ts forms/`. Fold `call-action.ts` into `actions/` (e.g. `actions/call-action.ts`, re-exported from `actions/index.ts`). Repoint `call-action`'s 4 importers and `apply-action-errors`'s importer (`forms.ts` itself). Replace `forms.ts`'s inline `{ error: ActionError | undefined }` re-declaration with an import of `call-action`'s `ActionCallResult` type (research §D).

#### 3. Slim the barrel to a Vitest-safe surface

**File**: `src/shared/lib/index.ts`

**Intent**: No `astro:*`-coupled module may be reachable from the barrel, and no symbol may have two live import paths.

**Contract**: After Phase 1 removed `postgrest`/`config-status`, the barrel still re-exports `actions` (astro-coupled). Remove the `actions` re-export and deep-import `defineDomainAction` at its **8 consumers** (`courses/api/actions.ts`, `plans-list/api/actions.ts`, `students/api/actions.ts`, `teachers/api/{actions,availability-actions}.ts`, `plan-detail/api/{grouping-actions,placement-actions,slot-bundle-actions}.ts`) from `@/shared/lib/actions`. Collapse the `cn` (22×) and `useUrlSyncedFilters` (3×) dual paths to a single canonical path. Delete the "never reach via the `@/shared/lib` barrel" comment in `forms/`. **Invariant**: importing the barrel under Vitest resolves with no `astro:*` error.

### Success Criteria

#### Automated Verification

- [ ] `pnpm steiger` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] `pnpm build` passes
- [ ] `grep -rn "never reach it via\|never reach via" src/shared` returns nothing
- [ ] A throwaway `*.test.ts` importing `@/shared/lib` compiles & runs under Vitest (no `astro:*` resolution error) — then removed

#### Manual Verification

- [ ] A form submit + confirm + refresh flow still works end-to-end in the UI
- [ ] URL-synced filters still hydrate from the query string

**Implementation Note**: Pause for human confirmation before Phase 3.

---

## Phase 3: F3 — move `grid` + `slot-labels` `config → lib`

### Overview

The original F3 ask, now unblocked. Lands `lib` at 13 and leaves `config` holding only constants/enums/schemas.

### Changes Required

#### 1. Move `grid` → `shared/lib/grid/`

**File**: `src/shared/config/grid.ts` → `src/shared/lib/grid/index.ts`

**Intent**: `grid.ts` is parsing logic (`parseGridPreset`, private `parseDimensions`), not a constant — it belongs in `lib`.

**Contract**: `git mv` into a `grid/` folder, keeping the private `parseDimensions`. `grid/index.ts` imports `DEFAULT_GRID_PRESET` from `@/shared/config` (the legal `lib → config` edge). Remove `GRID_BOUNDS`, `DEFAULT_GRID`, `parseGridPreset`, `GridDimensions` from `src/shared/config/index.ts`. Repoint the **5 importers** to `@/shared/lib/grid`: `plan-detail/api/{load,placements,slot-bundles}.ts`, `teachers/api/teacher-availability.ts`, `pages/plans/[id]/teachers.astro`.

#### 2. Move `slot-labels` → `shared/lib/slot-labels/`

**File**: `src/shared/config/slot-labels.ts` → `src/shared/lib/slot-labels/index.ts`

**Intent**: `dayLabel`/`periodLabel` are display formatters, not constants.

**Contract**: `git mv` into a `slot-labels/` folder. Remove `dayLabel`/`periodLabel` from `src/shared/config/index.ts`. Repoint the **3 importers** to `@/shared/lib/slot-labels`: `plan-detail/ui/{PlannerGrid,CollisionDetailsDialog}.tsx`, `teachers/ui/TeacherAvailabilityDialog.tsx`.

#### 3. Confirm `config` purity & count

**Intent**: `config` now holds only `cohorts.ts`, `nav.ts`, `availability-severity.ts`, `grid-presets.ts`, `index.ts`. `lib` is at 13.

**Contract**: `PlanFormDialog.tsx` still imports `GRID_PRESETS`/`DEFAULT_GRID_PRESET` from `grid-presets.ts` — confirm unchanged. `ls -1 src/shared/lib | grep -vc '^$'` == 13.

### Success Criteria

#### Automated Verification

- [ ] `pnpm steiger` passes with no `shared-lib-grouping` warning
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] `pnpm build` passes
- [ ] `ls -1 src/shared/lib | grep -vc '^$'` == 13
- [ ] `grep -rn "parseGridPreset\|dayLabel\|periodLabel" src/shared/config` returns nothing

#### Manual Verification

- [ ] Plan grid renders with correct dimensions from a preset
- [ ] Teacher availability dialog shows correct day/period labels

**Implementation Note**: Pause for human confirmation before Phase 4.

---

## Phase 4: Declarative dedup sweep

### Overview

Replace the hand-rolled `{data,error}`→`DomainError` decode (~15 inline copies) and the re-implemented `groupBy` (~5 copies) with shared combinators, applied across all slices. Modules are now in their final homes.

### Changes Required

#### 1. Add `unwrapMany` (multi-row decode) to `shared/api/postgrest`

**File**: `src/shared/api/postgrest/index.ts`

**Intent**: `unwrapRow`/`unwrapCompleted` only cover `.single()`/`.delete()`; the common multi-row read is decoded inline ~15× across slice code. Add the missing combinator.

**Contract**: Add `unwrapMany`/`unwrapData` — given a PostgREST `{ data, error }` result, return `data` or throw `DomainError`. Export from `api/postgrest` and the `api` barrel. **Bound the sweep with a committed grep** (`grep -rn 'if (error)' src/_pages/*/api/*.ts`, excluding `*.test.ts`) and classify each hit by shape: a `{ data, error }` **multi-row read** → `unwrapMany`/`unwrapData`; a `.single()`/`.maybeSingle()` read → `unwrapRow`; a write-only `{ error }` (insert/update/delete) → `unwrapCompleted`. **Out of scope, leave as-is**: client/UI sites that decode an `ActionError` (`*-client.ts`, `*.tsx`) and integration-test seed throws (`*.integration.test.ts`). Candidate production files (verified to carry inline decoders): `students/api/{update-student,create-student,assert-choices-in-cohort}.ts`, `courses/api/{create-overlap,create-merge,assert-merge-parent}.ts`, `plan-detail/api/{grouping-compute,load,placements,slot-bundles,persist,staleness}.ts`, `plans-list/api/{clone-plan,loader}.ts`, `teachers/api/teacher-availability.ts`, and the reads in `load-cohort-courses.ts` (research §D). Re-run the grep after migrating to confirm only intended sites remain (criterion 4.5).

#### 2. Add `groupByInto` projection variant to `collections/`

**File**: `src/shared/lib/collections/index.ts`

**Intent**: `collections.groupBy` (a `Map.groupBy` wrapper) doesn't project values, so callers needing a projected value re-roll mutable-accumulator loops (`load-cohort-courses` `groupByCourse`/`groupPairs`, `CollisionDetailsDialog`, `PlannerGrid`, `teacher-conflict`).

**Contract**: Add `groupByInto(list, key, value)` (group + project) with an optional null-key skip so callers that exclude null keys keep that semantics. Make both `groupBy` and `unique` take `readonly T[]`. Collapse `groupByCourse`/`groupPairs` (`load-cohort-courses.ts`) plus the 3 named re-impls — `CollisionDetailsDialog.tsx:198`, `PlannerGrid.tsx:146`, and `teacher-conflict.ts:19` (`plan-detail/model/constraints/`) — onto `groupBy`/`groupByInto`. **`teacher-conflict.ts` is in the constraint core**: its `groupByTeacher` deliberately skips null `teacherKey` ("null teachers never conflict"), so migrate it only via the null-skipping variant and **write a null-teacher invariant test first** (≥2 null-`teacherKey` occupants in one cell produce no teacher violation) to lock behavior before the swap. Behavior-preserving; same O(n), no hot-path complexity change.

#### 3. Tidy `apply-action-errors` to a declarative form

**File**: `src/shared/lib/forms/apply-action-errors.ts`

**Intent**: The imperative `for...of`+guard is a clean `Object.entries(...).filter(...).forEach(...)`.

**Contract**: Rewrite as the chained form; behavior identical. Dedup the `group_index → groupIndex` remap duplicated at `students/api/loader.ts` and `TeacherTable.tsx` into a shared helper where `course-label` is consumed.

### Success Criteria

#### Automated Verification

- [ ] `pnpm lint` passes (no unused inline decoders left)
- [ ] `pnpm test` passes
- [ ] `pnpm build` passes
- [ ] `pnpm steiger` passes
- [ ] `grep -rn "\.error) throw\|if (error)" src/_pages` shows only intended sites (inline decoders removed)

#### Manual Verification

- [ ] A multi-row read path (e.g. loading courses for a cohort) returns identical data and error behavior
- [ ] Grouping-dependent UI (collision details, planner grid) renders identically

**Implementation Note**: Pause for human confirmation before Phase 5.

---

## Phase 5: Bug fixes + unit tests

### Overview

Fix the 6 verified bugs plus the remaining lower-severity polish, each locked by a unit test, and add Tier-1/Tier-2 coverage to the now-pure, well-placed modules.

### Changes Required

#### 1. Bug #1 — locale-sensitive hash sort (🔴)

**File**: `src/shared/lib/catalog-hash/compute-catalog-hash.ts:22`

**Intent**: `a.id.localeCompare(b.id)` without a locale varies across ICU/runtime versions → same catalog canonicalizes to different orders → different SHA-256, defeating the "single hash, never drift" guarantee behind staleness detection + clone.

**Contract**: Replace with code-point compare (`a.id < b.id ? -1 : a.id > b.id ? 1 : 0`). Lock with a test asserting a fixed expected digest and order-insensitivity.

#### 2. Bug #2 — `use-url-synced-filters` re-seeds on `parse` identity change (🟠)

**File**: `src/shared/lib/use-url-synced-filters/index.ts:20-25`

**Intent**: The seed effect runs whenever `parse` changes, not just on mount; an unstable `parse` re-fires it every render, overwriting in-flight user edits and masking via the `react-hooks/set-state-in-effect` disable.

**Contract**: One-shot mount guard (`useRef(false)`); remove the now-unneeded eslint-disable if possible.

#### 3. Bug #3 — `writeParentWithLinks` cleanup masks original error (🟠)

**File**: `src/shared/lib/write-parent-with-links/index.ts:20-21`

**Intent**: In the catch, `await ops.deleteParent(parent)` runs before `throw error`; a rejecting `deleteParent` replaces the original link error.

**Contract**: Wrap `deleteParent` in its own try/catch so the original error always propagates. Add the missing test branch (failing `deleteParent`).

#### 4. Bug #4 — `useConfirmAction` double-submit + post-unmount setState (🟠)

**File**: `src/shared/lib/forms/index.ts:53-66`

**Intent**: `confirm` never checks `isBusy` before running; after `await call()` it sets state + calls `onDone()`/`refreshPage()` with no unmounted guard, though confirm dialogs unmount on success.

**Contract**: Guard re-entry on `isBusy`; bail state updates when unmounted (mounted ref).

#### 5. Bug #5 — `loadCohortCourses` phantom parents / double-count (🟡)

**File**: `src/shared/api/load-cohort-courses.ts:43-50`

**Intent**: `?.`-fallback fabricates `teacherKey:null, hours:0` for a missing merge parent instead of failing loudly; a merge-parent with direct choices can appear in both `regularCourses` and `virtualCourses` → duplicate `id` in the hash input.

**Contract**: Fail loudly (or collect a warning) on a missing parent; dedupe so a course id can't enter both buckets. Lock with a test feeding a merge-parent-with-choices fixture.

#### 6. Bug #6 — `unwrapRow` type-unsound for `maybeSingle()` (🟡)

**File**: `src/shared/api/postgrest/index.ts:11`

**Intent**: `RowResult<T>` success arm `{ data: T; error: null }` can't model `.maybeSingle()`'s `data: null` on zero rows; the name invites misuse.

**Contract**: Either narrow `unwrapRow` to `.single()` semantics with a clear name, or add a `maybeSingle`-safe variant returning `T | null`. Also change `unwrapCompleted` to return `void` (its `{ ok: true }` collides with `result.ok`'s discriminant — research §C).

#### 7. Lower-severity polish

**File**: `src/app/config/config-status.ts:15-16`

**Intent**: Stale Polish copy and a `docsUrl` pointing at the starter template's README, not this project.

**Contract**: Update copy to current English and point `docsUrl` at this project's docs. (`fetch` shadowing already fixed in Phase 2; `assertNoQueryErrors`→`DomainError` already done in Phase 1.)

#### 8. Tier-1 / Tier-2 unit tests

**File**: co-located `*.test.ts` in each module's folder

**Intent**: The richest untested logic is pure and high-value; add coverage starting with the modules that lock the bug fixes.

**Contract**: Tier-1 — `grid` (`parseGridPreset`/`parseDimensions`: regex, non-positive guard, `GRID_BOUNDS` ceiling, fallback), `compute-catalog-hash` (order-insensitivity + bug #1), `load-cohort-courses` helpers (`groupPairs`, `compositeName`, `collectWarnings`; Supabase injected), `collections` (`groupBy`/`unique`/`groupByInto`). Tier-2 — `course-label`, `slot-labels`, `cohorts.cohortLabel`, `result`, `withSupabase`/`assertNoQueryErrors`, `apply-action-errors`.

### Success Criteria

#### Automated Verification

- [ ] `pnpm test` passes, including all new tests and the bug-lock tests
- [ ] `pnpm lint` passes (no leftover eslint-disable for bug #2)
- [ ] `pnpm build` passes
- [ ] `pnpm steiger` passes
- [ ] `compute-catalog-hash` test asserts a fixed digest (locks bug #1)

#### Manual Verification

- [ ] Clone a plan: the staleness/hash flow behaves correctly across a re-load
- [ ] Confirm-action dialog: rapid double-click does not double-submit; no console warning about setState after unmount
- [ ] Config banner copy reads correctly (English, correct docs link)

**Implementation Note**: Final phase — confirm full suite green and manual checks pass.

---

## Testing Strategy

### Unit Tests

- `grid` parsing — all branches (preset regex, non-positive dimensions, `GRID_BOUNDS` ceiling, fallback to `DEFAULT_GRID`).
- `compute-catalog-hash` — fixed-digest snapshot + order-insensitivity (two permutations → same hash); this locks bug #1.
- `collections` — `groupBy`, `unique`, new `groupByInto` (incl. the null-key-skip variant).
- `teacher-conflict` (constraint core) — null-teacher invariant: ≥2 null-`teacherKey` occupants in one cell produce no teacher violation; written before the `groupByInto` swap (Phase 4 §2).
- `load-cohort-courses` helpers — with an injected fake Supabase; cover the phantom-parent / double-count fix (bug #5).
- `write-parent-with-links` — add the failing-`deleteParent` branch (bug #3).
- `unwrapMany`/`unwrapRow`/`unwrapCompleted` — success + `DomainError` branches, incl. the `maybeSingle` case (bug #6).
- Tier-2 pure helpers — `course-label`, `slot-labels`, `cohortLabel`, `result`, `withSupabase`/`assertNoQueryErrors`, `apply-action-errors`.

### Integration Tests

- Existing `adapter-parity.integration.test.ts` and `plan-actions.integration.test.ts` must stay green after the catalog-hash split (run via `pnpm test:integration` with local Supabase).

### Manual Testing Steps

1. Boot the app with Supabase env present and absent — confirm the config banner toggles and reads correct copy.
2. Create a duplicate record — confirm the unique-violation `DomainError` message is unchanged.
3. Clone a plan and re-load — confirm hash/staleness behaves correctly.
4. Open the planner grid and teacher availability dialog — confirm dimensions and day/period labels render.
5. Rapidly double-click a confirm action — confirm single submission, no post-unmount warning.

## Performance Considerations

No hot-path complexity changes. The `<200ms` placement/constraint budget is preserved — the only constraint-core edit is swapping `teacher-conflict.ts`'s hand-rolled `groupByTeacher` for the null-skipping `groupByInto` (same O(n)), behind a null-teacher invariant test. `groupByInto` replaces equivalent O(n) loops elsewhere; `unwrapMany` is a thin decode. Hash computation is unchanged in complexity (only the comparator).

## Migration Notes

- All relocations use `git mv` to preserve history; no data migration.
- Each phase is independently shippable and green — safe to land as separate commits/PRs if desired. The structural phases (1–3) carry no behavior change; the quality phases (4–5) do.
- Rollback is a `git revert` of the phase commit; no schema or runtime-state coupling.

## References

- Research: `context/changes/clean-up-shared-lib/research.md`
- Trigger (F3): `context/changes/teacher-availability/follow-ups/review-fixes.md`
- Steiger gate: `node_modules/@feature-sliced/steiger-plugin/dist/index.js:926,939`; `steiger.config.ts:5`; `package.json` `steiger` script
- Existing data-access precedent: `src/shared/api/{index.ts,load-plan-summary.ts}`
- Bug sites: `compute-catalog-hash.ts:22`, `use-url-synced-filters.ts:20-25`, `write-parent-with-links/index.ts:20-21`, `forms.ts:53-66`, `load-cohort-courses.ts:43-50`, `postgrest/index.ts:11,31`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Relocate transport → shared/api + config-status → app/

#### Automated

- [ ] 1.1 `pnpm steiger` passes (lib now well under cap)
- [ ] 1.2 `pnpm lint` passes
- [ ] 1.3 `pnpm test` passes (postgrest tests run from new location)
- [ ] 1.4 `pnpm build` passes
- [ ] 1.5 `grep -rn 'from "@/shared/lib/postgrest"' src` returns nothing
- [ ] 1.6 `ls -1 src/shared/lib | grep -vc '^$'` == 13

#### Manual

- [ ] 1.7 App boots; unconfigured-service banner still renders when Supabase env is absent
- [ ] 1.8 A create/update flow surfaces a `DomainError` unchanged
- [ ] 1.9 A batch-parallel read failure (`assertNoQueryErrors` path) surfaces correctly through `runDomain`/the action layer after the `Error`→`DomainError` switch

### Phase 2: Regroup remaining lib into folders + slim the barrel

#### Automated

- [ ] 2.1 `pnpm steiger` passes
- [ ] 2.2 `pnpm lint` passes
- [ ] 2.3 `pnpm test` passes
- [ ] 2.4 `pnpm build` passes
- [ ] 2.5 `grep -rn 'never reach it via\|never reach via' src/shared` returns nothing
- [ ] 2.6 Throwaway `*.test.ts` importing `@/shared/lib` runs under Vitest with no `astro:*` error (then removed)

#### Manual

- [ ] 2.7 Form submit + confirm + refresh flow works end-to-end
- [ ] 2.8 URL-synced filters hydrate from the query string

### Phase 3: F3 — move grid + slot-labels config → lib

#### Automated

- [ ] 3.1 `pnpm steiger` passes with no `shared-lib-grouping` warning
- [ ] 3.2 `pnpm lint` passes
- [ ] 3.3 `pnpm test` passes
- [ ] 3.4 `pnpm build` passes
- [ ] 3.5 `ls -1 src/shared/lib | grep -vc '^$'` == 13
- [ ] 3.6 `grep -rn 'parseGridPreset\|dayLabel\|periodLabel' src/shared/config` returns nothing

#### Manual

- [ ] 3.7 Plan grid renders with correct dimensions from a preset
- [ ] 3.8 Teacher availability dialog shows correct day/period labels

### Phase 4: Declarative dedup sweep

#### Automated

- [ ] 4.1 `pnpm lint` passes (no unused inline decoders left)
- [ ] 4.2 `pnpm test` passes
- [ ] 4.3 `pnpm build` passes
- [ ] 4.4 `pnpm steiger` passes
- [ ] 4.5 Inline `{data,error}` decoders removed from slice code

#### Manual

- [ ] 4.6 A multi-row read path returns identical data + error behavior
- [ ] 4.7 Grouping-dependent UI renders identically

### Phase 5: Bug fixes + unit tests

#### Automated

- [ ] 5.1 `pnpm test` passes, including new + bug-lock tests
- [ ] 5.2 `pnpm lint` passes (no leftover eslint-disable for bug #2)
- [ ] 5.3 `pnpm build` passes
- [ ] 5.4 `pnpm steiger` passes
- [ ] 5.5 `compute-catalog-hash` test asserts a fixed digest (locks bug #1)

#### Manual

- [ ] 5.6 Clone a plan: staleness/hash flow correct across re-load
- [ ] 5.7 Confirm dialog: rapid double-click does not double-submit; no post-unmount warning
- [ ] 5.8 Config banner copy reads correctly (English, correct docs link)
