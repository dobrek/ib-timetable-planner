---
date: 2026-06-14T10:54:38+0200
researcher: Dobromir Kropielnicki
git_commit: e462bca99cce6f4dedbf57a2ed4f6e125f47f432
branch: main
repository: 10xdev3
topic: "Clean up & re-architect shared/lib (+ shared/config boundary) — declarative regrouping, test coverage, bugs"
tags: [research, codebase, shared-lib, shared-config, shared-api, fsd, steiger, refactor, test-coverage]
status: complete
last_updated: 2026-06-14
last_updated_by: Dobromir Kropielnicki
---

# Research: Clean up & re-architect `shared/lib`

**Date**: 2026-06-14T10:54:38+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: e462bca99cce6f4dedbf57a2ed4f6e125f47f432
**Branch**: main
**Repository**: 10xdev3

## Research Question

The teacher-availability follow-up `F3` (`context/changes/teacher-availability/follow-ups/review-fixes.md`) revealed that `shared/lib` needs refactoring. Take the opportunity to revisit **all** of its submodules and functions:
- Can they be structured in a **more declarative** way (join some? split into different modules/folders)?
- Do they all have **proper test coverage**?
- Is there **room for improvement or bugs to fix**?

**Scope chosen** (via clarification): `shared/lib` + `shared/config` + all importers; **full reorg + boundary rethink**; deliverable = **findings + a concrete to-be proposal** ready for `/10x-plan`.

## Summary

`shared/lib` isn't just "at the 15-module cap" — about **a third of it isn't `lib` at all**. The cap (a Steiger rule) is the symptom; the cause is that PostgREST/Supabase **data-access** modules (`postgrest/`, `loaders.ts`, `catalog-hash/`) and an app-shell **config** module (`config-status.ts`) accreted into `lib/` because there was no other cross-slice home at the time. Moving those to the segments where FSD says they belong — `shared/api` (which already exists and already holds data-access readers) and `shared/config`/`app` — **simultaneously**:

1. **Fixes the F3 blocker** by freeing ≥4 top-level slots (only 2 are needed), so `grid/` + `slot-labels/` can move from `config` → `lib` as the plan always intended.
2. **Corrects the FSD boundary** (`lib` = framework-agnostic utilities; `api` = backend/transport; `config` = constants/enums/env).
3. **De-poisons the `shared/lib` barrel** — today the barrel re-exports `astro:*`-coupled modules (`actions/`, `config-status.ts`), which is why `catalog-hash` and `forms` carry "never import via the barrel" comments to stay Vitest-safe.

This is a clean, mostly-mechanical "move + regroup" with one direction of dependency change. Independently, the audit surfaced **6 real correctness bugs/risks** (one of which — a locale-sensitive hash sort — can silently corrupt the catalog-staleness/clone feature), **pervasive duplication** of a "decode PostgREST `{data,error}` or throw `DomainError`" pattern (~15 hand-rolled inline copies the existing helpers don't cover), and **near-zero test coverage** (3 test files total; 0 in `config`; no coverage tooling configured) over modules that are pure, high-value, and trivially unit-testable.

A recommended target tree takes `shared/lib` from **15 → 12** top-level modules *while adding* `grid/` + `slot-labels/`, with every loose utility grouped into a named folder ("lib of libs", per FSD).

## The binding constraint (read first)

The "15-module ceiling" is **`fsd/shared-lib-grouping`**, from `@feature-sliced/steiger-plugin@0.6.0`, enabled via the bare `recommended` preset (`steiger.config.ts:5`) and made a hard gate by `package.json`'s `"steiger": "steiger src --fail-on-warnings"` (run in `.github/workflows/ci.yml:27`).

Exact mechanics (from plugin source `node_modules/@feature-sliced/steiger-plugin/dist/index.js`):
- `var THRESHOLD = 15;` (`index.js:926`); check is `lib.children.length > THRESHOLD` (`index.js:939`) — **strictly greater-than**, so 15 passes, **16 warns** (→ CI fails).
- "modules" = **direct children of `shared/lib/`** = files **and** subfolders, each counts **1**. Files nested inside a subfolder do **not** count (only the folder does).
- **The barrel `index.ts` counts** (the rule reads `lib.children` with no `isIndex` filter).
- **Top-level `*.test.ts` would count**, but the 3 existing tests are nested inside folders (`cn/cn.test.ts`, etc.), so they're invisible to the count.

Current count = **exactly 15**: 6 folders (`actions/`, `catalog-hash/`, `cn/`, `course-label/`, `postgrest/`, `write-parent-with-links/`) + 8 loose files (`call-action.ts`, `collections.ts`, `config-status.ts`, `errors.ts`, `forms.ts`, `loaders.ts`, `result.ts`, `use-url-synced-filters.ts`) + `index.ts`.

**Math:** adding `grid/` + `slot-labels/` (+2 → 17) requires removing **≥2** top-level entries to stay ≤15. The boundary rethink removes 4, landing at 13 before regrouping. No equivalent cap exists for `shared/api` or `shared/config` (only `shared-lib-grouping` is defined; `shared/api` already carries loose files like `load-plan-summary.ts`).

## Detailed Findings

### A. Module inventory, responsibilities & FSD classification

Layers in this repo are `app → _pages → shared` — **there is no `entities` layer** (verified: no `src/entities`, no per-slice `entities/`). `shared/` has 4 segments: `api`, `config`, `lib`, `ui`. This constraint matters: a domain-aware helper used by two sibling `_pages` slices has **nowhere to go but `shared`** (slices can't import each other).

| Module | What it is | True segment | Importers | Verdict |
|---|---|---|---|---|
| `cn/` | clsx+tailwind-merge | lib (or ui) | 22 | ✅ stays `lib` |
| `collections.ts` | `groupBy`/`unique` | lib | 6 (loaders, fixtures) | ✅ stays `lib`, → folder |
| `result.ts` | `Result<T,E>` + `ok`/`err` | lib | 2 + used by `loaders` | ✅ stays `lib`, group w/ `withSupabase` |
| `errors.ts` | `DomainError` class | lib | 15 | ✅ stays `lib`, → folder |
| `write-parent-with-links/` | generic compensating-write combinator (DI, no Supabase) | lib | 2 | ✅ stays `lib` |
| `use-url-synced-filters.ts` | generic React hook | lib | 3 | ✅ stays `lib`, → folder |
| `course-label/` | pure course-badge formatter | lib | 2 (teachers, students) | ✅ **stays `lib`** (see note) |
| `actions/index.ts` | `defineDomainAction` + guards (`astro:actions`) | lib (action transport) | 7 | ✅ `lib`, but astro-coupled |
| `actions/apply-action-errors.ts` | react-hook-form `setError` bridge | lib (forms) | 1 (`forms.ts`) | ⚠️ **mis-foldered** — move to `forms/` |
| `call-action.ts` | client-side Astro action caller | lib (action transport) | 4 | ✅ `lib`, fold into `actions/` |
| `forms.ts` | submit/confirm/refresh flows (client) | lib (forms) | 13 | ✅ `lib`, → `forms/` folder |
| `postgrest/` | PostgREST `{data,error}` → `DomainError` | **`api`** | 19 | 🔀 **move to `shared/api`** |
| `loaders.ts` | `withSupabase` (generic) + `assertNoQueryErrors` (PostgREST) | **split** | 4 | 🔀 split: generic→`lib`, PostgREST→`api` |
| `catalog-hash/` | load cohort catalog + SHA-256 fingerprint | **`api`** (data-access center of gravity) | 7 | 🔀 **move to `shared/api`** |
| `config-status.ts` | unconfigured-service banner (`astro:env/server`) | **`config`/`app`** | 1 (`BaseLayout`) | 🔀 **move out of `lib`** |
| `index.ts` | segment barrel | — | 8 (only `defineDomainAction`) | ⚠️ astro-poisoned; slim it |

**`shared/config` inventory** (`cohorts.ts`, `nav.ts`, `availability-severity.ts`, `grid.ts`, `grid-presets.ts`, `slot-labels.ts`, `index.ts`): all genuine constants/enums/schemas **except** `grid.ts` (parsing logic) and `slot-labels.ts` (display helpers) — the two F3 wants moved to `lib`.

> **Note on `course-label`** (`src/shared/lib/course-label/index.ts:1-9`): the transport auditor flagged it as a "domain-in-shared FSD violation" (it knows IB `level === "none"` and the circled-digit group convention). **Reconciled verdict: it stays in `shared/lib`.** FSD forbids *business logic/calculations* in shared, but explicitly permits application-aware code and common types; this is a **pure presentation formatter** (plain shape in, string out — no rules, no calculation). With no `entities` layer and two sibling-slice consumers, `shared/lib` is its only legitimate home. The legacy `architecture-refactor` plan that imagined an `entities/course` was never realized.

### B. FSD boundary analysis — what's actually misplaced

The clean line (FSD v2.1, per the `feature-sliced-design` skill): **`config` = env/settings/constants/feature-flags; `api` = backend interactions (request fns, data types, mappers), CRUD helpers, base types; `lib` = framework-agnostic utilities (`formatDate`, `debounce`, `classnames`).** "Group by what it's *for*, not what it *is*"; name modules after their domain, not technical role.

Misplaced today:
- **`postgrest/` → `shared/api`.** It hard-codes PostgREST SQLSTATEs (`UNIQUE_VIOLATION = "23505"` `postgrest/index.ts:4`, `NOT_FOUND_ROW = "PGRST116"` `:7`) and decodes the `{data,error}` envelope — textbook transport, not a generic utility. `shared/api` already proves this pattern with `load-plan-summary.ts`.
- **`catalog-hash/load-cohort-courses.ts` → `shared/api`.** It issues `.from("courses"/"student_choices"/"course_overlaps"/"course_merges")` queries (`load-cohort-courses.ts:69-117`) — a data-access reader. Its sibling `compute-catalog-hash.ts` (pure) + `types.ts` ride along as the "catalog-fingerprint" feature; keeping the folder whole in `api` is cleaner than splitting it.
- **`loaders.ts` is split-personality.** `withSupabase` (`loaders.ts:8`) is a generic "client-or-null → `Result`" combinator (→ stays `lib`, pair with `result`). `assertNoQueryErrors` (`loaders.ts:17`) inspects the PostgREST `{error}` envelope (→ `api`, merge with `postgrest`).
- **`config-status.ts` → `shared/config` or `app`.** It's not data-access and not a generic utility — it reads `astro:env/server` (`config-status.ts:1`) and is consumed only by `BaseLayout.astro`. It's also one of the two modules poisoning the `lib` barrel for Vitest.

### C. Bugs & correctness risks (ranked)

1. **🔴 Locale-sensitive hash sort — silent hash drift.** `compute-catalog-hash.ts:22` sorts courses with `a.id.localeCompare(b.id)`. `localeCompare` without an explicit locale varies across ICU/runtime versions, so the same catalog can canonicalize to **different orders → different SHA-256 hashes** across environments — defeating the "single hash, never drift" guarantee this module exists to provide (it underpins catalog-staleness detection and the clone flow). **Fix:** code-point compare (`a.id < b.id ? -1 : a.id > b.id ? 1 : 0`).
2. **🟠 `use-url-synced-filters` re-seeds on every `parse` identity change.** The seed effect (`use-url-synced-filters.ts:20-25`) calls `setState(parse(...))` whenever `parse` changes, not just on mount. If a caller's `parse` isn't referentially stable (e.g. `useCallback([teachers])` where `teachers` is a fresh array each render), the effect re-fires every render, **overwriting in-flight user edits with the URL value** and potentially looping. The `react-hooks/set-state-in-effect` eslint-disable (`:21,:24`) is masking this. **Fix:** one-shot mount guard (`useRef(false)`).
3. **🟠 `writeParentWithLinks` cleanup masks the original error.** In the catch (`write-parent-with-links/index.ts:20-21`), `await ops.deleteParent(parent)` runs *before* `throw error`; if `deleteParent` rejects, its rejection replaces the original link error (the `throw error` is never reached). Untested path. **Fix:** wrap `deleteParent` in its own try/catch so the original error always wins.
4. **🟠 `useConfirmAction` double-submit + post-unmount setState.** `forms.ts:53-66`: `confirm` never checks `isBusy` before running (busy flag is presentational only), and after `await call()` it calls `setIsBusy(false)` + `onDone()` + `refreshPage()` with no unmounted guard — and confirm dialogs typically unmount on success. **Fix:** guard re-entry on `isBusy`; bail state updates if unmounted.
5. **🟡 `loadCohortCourses` fabricates phantom parents / can double-count.** `load-cohort-courses.ts:43-50` falls back to `teacherKey:null, hours:0` via `?.` when a merge parent is missing instead of failing loudly; and a merge-parent that also has direct student choices could appear in both `regularCourses` (`:35`) and `virtualCourses` (`:43`) → duplicate `id` in the hash input.
6. **🟡 `unwrapRow` type-unsound for `maybeSingle()`.** `RowResult<T>` declares the success arm `{ data: T; error: null }` (`postgrest/index.ts:11`), but `.maybeSingle()` legitimately returns `data: null` on zero rows — `unwrapRow` would then return `null` typed as `T` with no error. Latent (all callers use `.single()`), but the name invites misuse.

Lower severity: `assertNoQueryErrors` throws a **plain `Error`, not `DomainError`** (`loaders.ts:19`), diverging from the cluster's error currency; `unwrapCompleted` returns a meaningless `{ ok: true }` whose property name collides with `result.ok`'s discriminant (`postgrest/index.ts:31` vs `result.ts:3`) — should be `void`; `config-status.ts:15-16` ships stale **Polish** copy and a `docsUrl` pointing at the **starter template's** README, not this project; `loaders.ts` parameter named `fetch` shadows the Workers global (`loaders.ts:9,13`).

### D. Declarative-style smells & duplication

- **The "decode `{data,error}` or throw `DomainError`" pattern is hand-rolled ~15× inline** across slice code (`update-student.ts:40-46`, `create-overlap.ts:14-19`, `create-merge.ts:71-73`, `grouping-compute.ts:30-31`, plus every read in `load-cohort-courses.ts`). The existing `unwrapRow`/`unwrapCompleted` only cover `.single()`/`.delete()`, not the common multi-row read. **Opportunity:** add an `unwrapMany`/`unwrapData` combinator in the (relocated) `postgrest` module to absorb these.
- **`groupBy` is re-implemented at least 5×** despite `collections.groupBy` existing (`collections.ts:1`, a `Map.groupBy` wrapper): `load-cohort-courses.ts:119` (`groupByCourse`) and `:129` (`groupPairs`) are near-identical mutable-accumulator loops that also duplicate each other; plus `CollisionDetailsDialog.tsx:198`, `PlannerGrid.tsx:146`, `teacher-conflict.ts:19`. (Some need a projected value, which `Map.groupBy` doesn't give directly — a `groupByInto(list, key, value)` variant would cover them.)
- **`applyActionFieldErrors` uses an imperative `for...of`+guard** (`actions/apply-action-errors.ts:7-11`) that is a clean `Object.entries(...).filter(...).forEach(...)`.
- **Contract duplicated structurally:** `call-action.ts`'s `ActionCallResult` (`call-action.ts:7`) is re-declared inline in `forms.ts` (`:15`, `:48`) as `{ error: ActionError | undefined }` instead of being imported.
- `collections.unique` takes mutable `T[]` while `groupBy` takes `readonly T[]` (`collections.ts:1` vs `:4`) — make both `readonly`.
- `course-label` call sites duplicate the `group_index → groupIndex` remap (`students/api/loader.ts:41` vs `TeacherTable.tsx:120`).

### E. Test coverage matrix & gaps

`pnpm test` = `vitest run` over `src/**/*.test.ts`, excluding `*.integration.test.ts` (`vitest.config.ts:7-9`); **no coverage tooling is configured** (no `coverage` block, no `@vitest/coverage-*`). Only **3** test files exist in scope; **0** in `shared/config`.

| Existing test | Quality |
|---|---|
| `postgrest/postgrest.test.ts` | ✅ strong — all `toDomainError` branches |
| `write-parent-with-links/...test.ts` | ✅ both branches (but not a *failing* `deleteParent` — bug #3 untested) |
| `cn/cn.test.ts` | ⚠️ smoke only (`true===true` + alias check); no twMerge-conflict case |

**Untested, ranked by risk (complexity × blast radius) — all pure & easily unit-testable:**
1. `config/grid.ts` `parseGridPreset`/`parseDimensions` — richest untested branching (regex, non-positive guard, `GRID_BOUNDS` ceiling, fallback); sole interpreter of the preset convention.
2. `catalog-hash/compute-catalog-hash.ts` — order-insensitivity invariant; Web Crypto is a Node global, so trivially testable (and would lock down bug #1).
3. `catalog-hash/load-cohort-courses.ts` helpers (`groupPairs`, `compositeName`, `collectWarnings`) — most complex logic; Supabase is injected.
4. `collections.ts` (`groupBy`/`unique`) — trivial, 6 importers.
5. Tier 2: `course-label`, `config/slot-labels.ts`, `config/cohorts.ts` (`cohortLabel`), `loaders.ts` (`withSupabase`/`assertNoQueryErrors`), `result.ts`, `actions/apply-action-errors.ts`.

**Not worth / not unit-testable as-is:** `cn` (2-line wrapper), `call-action`/`actions/index.ts` (`astro:actions` value imports), `forms.ts`/`use-url-synced-filters.ts` (React + jsdom — integration), `config-status.ts` (`astro:env/server`), barrels/types.

### F. The barrel problem

`shared/lib/index.ts` (`:1-9`) re-exports 16 symbols but the surface is incoherent:
- It re-exports **astro-coupled** modules — `actions/` (`astro:actions`, `actions/index.ts:1`) and `config-status` (`astro:env/server`, `config-status.ts:1`) — so importing the barrel under Vitest drags in unresolvable virtual modules. This is exactly why `catalog-hash/index.ts:1-2` and `forms.ts:8-12` carry "never reach via the `@/shared/lib` barrel" comments. **Latent footgun:** any new unit test importing `ok`/`err`/`unwrapRow` from the barrel breaks.
- It's **near-dead and inconsistent**: of 8 barrel consumers, *all 8* import only `defineDomainAction`; `cn` (22×) and `useUrlSyncedFilters` (3×) are barrel-exported yet **always deep-imported** → dual import paths. `call-action`, `forms`, `course-label`, `catalog-hash`, `write-parent-with-links` aren't in the barrel at all (some intentionally, `course-label` accidentally).

**Direction:** after relocating `actions` consumers (or keeping `defineDomainAction` deep-imported) and removing `config-status`, the `lib` barrel can become Vitest-safe; then either commit to it or slim it to the genuinely-shared pure exports and retire the deep-import workarounds.

### G. Importer / blast-radius highlights

- **Single-importer:** `config-status` (only `BaseLayout.astro`). `write-parent-with-links` (2), `course-label` (2), `result` (2) are narrow but legitimately cross-slice or shared-internal.
- **Widely-shared (justify `shared`):** `cn` (22), `postgrest` unwrappers (19), `errors`/`DomainError` (15), `forms` (13), `defineDomainAction` (7); in config, `Cohort` (~42), `nav` (3).
- **No dead exports** — every symbol has ≥1 importer.
- **F3 importers to repoint** (verified live):
  - grid (`GRID_BOUNDS`, `DEFAULT_GRID`, `parseGridPreset`, `GridDimensions`): `plan-detail/api/{load,placements,slot-bundles}.ts`, `teachers/api/teacher-availability.ts`, `pages/plans/[id]/teachers.astro`.
  - slot-labels (`dayLabel`, `periodLabel`): `teachers/ui/TeacherAvailabilityDialog.tsx`, `plan-detail/ui/{PlannerGrid,CollisionDetailsDialog}.tsx`.
  - ⚠️ `plans-list/ui/PlanFormDialog.tsx` imports `GRID_PRESETS`/`DEFAULT_GRID_PRESET` from **`grid-presets.ts`** (which **stays in config**), so it does **not** need repointing — confirm during implementation.

## Concrete Proposal

### Target tree (to-be)

```
src/shared/
├── api/                         # backend/transport (already exists)
│   ├── supabase.ts              # (existing)
│   ├── database.types.ts        # (existing)
│   ├── load-plan-summary.ts     # (existing)
│   ├── postgrest/               # ← moved from lib; + merge assertNoQueryErrors; + new unwrapMany
│   ├── catalog-hash/            # ← moved from lib (load + compute + types together)
│   └── index.ts                 # + re-export postgrest, catalog-hash
├── config/                      # constants / enums / schemas / env only
│   ├── cohorts.ts  nav.ts  availability-severity.ts
│   ├── grid-presets.ts          # stays (constants/enum/schema)
│   ├── config-status.ts         # ← moved from lib (env-driven shell config)  [or → app/]
│   └── index.ts                 # − grid, − slot-labels
└── lib/                         # framework-agnostic utilities ("lib of libs")
    ├── cn/
    ├── collections/             # ← collections.ts → folder
    ├── result/                  # ← result.ts + loaders.ts:withSupabase + LoaderResult
    ├── errors/                  # ← errors.ts → folder
    ├── course-label/
    ├── write-parent-with-links/
    ├── use-url-synced-filters/  # ← file → folder
    ├── actions/                 # ← + call-action.ts folded in (server+client action transport)
    ├── forms/                   # ← forms.ts + actions/apply-action-errors.ts
    ├── grid/                    # ← moved from config (F3)
    ├── slot-labels/             # ← moved from config (F3)
    └── index.ts
```

**Slot math:** start 15 → move out `postgrest`, `catalog-hash`, `config-status`, `loaders` (−4 = 11) → fold `call-action` into `actions` (−1 = 10) → add `grid` + `slot-labels` (+2 = **12**). Comfortably < 15, with every loose utility now a named folder. (Converting files→folders is net-neutral on the count but satisfies the FSD "lib of libs" intent and the rule's spirit.)

### Migration steps (phased, each independently green)

**Phase 1 — Relocate transport to `shared/api` (frees the slots, fixes boundary).**
1. `git mv src/shared/lib/postgrest src/shared/api/postgrest`; move `assertNoQueryErrors` out of `loaders.ts` into `api/postgrest`; add `api` barrel re-exports; repoint the 19+4 importers (`@/shared/lib` / deep → `@/shared/api`).
2. `git mv src/shared/lib/catalog-hash src/shared/api/catalog-hash`; repoint its 7 importers; drop the now-obsolete "avoid the lib barrel" comment.
3. Move `config-status.ts` → `shared/config` (or `app/`); repoint `BaseLayout.astro`; remove it from the `lib` barrel.
4. Keep `withSupabase` + `LoaderResult` with `result` (next phase). Verify `pnpm steiger` now shows `shared/lib` at 11.

**Phase 2 — Regroup remaining `lib` into folders + fix the barrel.**
5. `collections.ts`→`collections/`, `errors.ts`→`errors/`, `result.ts`+`withSupabase`→`result/`, `use-url-synced-filters.ts`→`use-url-synced-filters/`.
6. Create `forms/` = `forms.ts` + `apply-action-errors.ts` (the latter `git mv`'d out of `actions/`); fold `call-action.ts` into `actions/`.
7. Slim/repair the barrel: ensure no `astro:*`-coupled module is re-exported into a Vitest-imported path; collapse the `cn`/`useUrlSyncedFilters` dual-path inconsistency.

**Phase 3 — F3: move grid + slot-labels into `lib` (now unblocked).**
8. `grid.ts`→`shared/lib/grid/` (keep its private `parseDimensions`; `grid/index.ts` imports `DEFAULT_GRID_PRESET` from `@/shared/config` — the natural `lib → config` direction). `slot-labels.ts`→`shared/lib/slot-labels/`.
9. Remove both from the `config` barrel; repoint the F3 importers (§G). Confirm `shared/config` now holds only constants/enums/schemas. Lands at 12; `pnpm steiger` clean.

**Phase 4 — Bugs + tests (can interleave).**
10. Fix bugs #1–#6 (§C). Add `unwrapMany` combinator and migrate the ~15 inline copies (§D). Collapse `groupByCourse`/`groupPairs` onto `collections.groupBy`.
11. Add unit tests for the Tier-1/Tier-2 modules (§E), starting with `grid` parsing and `compute-catalog-hash` (locks bug #1). Consider adding `@vitest/coverage-v8` so coverage stops being invisible.

**Acceptance** (extends F3): `pnpm steiger` (no `shared-lib-grouping` warning), `pnpm lint`, `pnpm test`, `pnpm build` all green; `shared/config` holds only constants/enums/schemas; `shared/api` owns all PostgREST/Supabase data-access; the `shared/lib` barrel is Vitest-safe.

## Architecture Insights

- **The cap was a smell, not the disease.** `shared/lib` hit 15 because it was the only cross-slice home before `shared/api` matured; the fix is segment hygiene, not just "group two files." Treating F3 as a one-line grouping would re-accrete the problem.
- **`lib → api`/`lib → config` are legal within `shared`** (segments may import each other); the relocations don't violate import direction. The only new edge is `grid/ → config` (for `DEFAULT_GRID_PRESET`), which is the intended direction.
- **No `entities` layer** means `shared/lib` legitimately holds pure, domain-aware *presentation* helpers (`course-label`, `slot-labels`); the hard FSD line here is *business logic/calculations*, which none of these cross.
- **One error currency, three producers.** `DomainError` is produced by `postgrest` (`:34-37`), bypassed by `loaders` (plain `Error`), and translated by `actions` (`actions/index.ts:52-53`). Unifying `assertNoQueryErrors` onto `DomainError` and co-locating producer+currency tightens this.

## Historical Context (from prior changes)

- **`architecture-refactor`** (archived) split the pre-FSD `src/lib/` bucket; `cn`/`errors`/`config-status`/`actions` were seeded into `shared/lib` as "infrastructure, not app-layer." `parseGridPreset` was *planned* for an `entities/plan` that never shipped — it lived page-local in `_pages/plan-detail/model/grid.ts` until teacher-availability.
- **`collision-info`** first extracted `dayLabel`/`periodLabel` into `_pages/plan-detail/lib/slot-labels.ts` (their natural `lib` home).
- **`teacher-availability`** promoted grid + slot-labels to `shared/` because the `teachers` slice can't import from `plan-detail`. The plan's preferred target was `shared/lib` for both; the implementation chose `config` as a **deliberate, documented workaround** for the 15-cap (`teacher-availability/reviews/impl-review.md:57`; `follow-ups/review-fixes.md:16-18`). F3 is the queued correction.

## Related Research

- `context/changes/teacher-availability/follow-ups/review-fixes.md` — F3 (the trigger; approach for the grid/slot-labels move).
- `context/changes/teacher-availability/research.md` — grid/slot-labels promotion rationale.
- `context/changes/collision-info/` — origin of `dayLabel`/`periodLabel`.
- `context/archive/**/architecture-refactor/` — original `shared/*` segmentation decisions.

## Open Questions / Decisions for the plan

1. **`catalog-hash`: whole-folder to `api`, or split?** Recommended: move whole (data-access is its center of gravity). Alternative: `load-cohort-courses` → `api`, `compute-catalog-hash`+`types` → `lib`. Splitting a cohesive feature across segments is the cost.
2. **`config-status` → `shared/config` or `app/`?** It's env-driven shell state used only by `BaseLayout`. `app/` is arguably more honest (single-importer, shell-specific); `config` keeps it in `shared` for a hypothetical second layout.
3. **Barrel policy:** slim the `lib` barrel to Vitest-safe pure exports and deep-import the action transport, or keep a fuller barrel and just ensure no test imports it? (Affects how many `defineDomainAction` consumers get repointed.)
4. **Scope discipline:** do bugs #1–#6 + the `unwrapMany`/`groupBy` dedup ride along in this change, or split into a follow-up so the structural move stays a pure refactor? (Bug #1 is severe enough to pull forward regardless.)
5. **Coverage tooling:** add `@vitest/coverage-v8` now, or just add the unit tests?

## Code References

- `node_modules/@feature-sliced/steiger-plugin/dist/index.js:926,939` — `THRESHOLD = 15`, `> THRESHOLD` check
- `steiger.config.ts:5`; `package.json` `steiger` script; `.github/workflows/ci.yml:27` — the gate
- `src/shared/lib/index.ts:1-9` — astro-poisoned, near-dead barrel
- `src/shared/lib/postgrest/index.ts:4,7,11,31,34-37` — SQLSTATEs, `RowResult` unsoundness, `unwrapCompleted` sentinel
- `src/shared/lib/loaders.ts:8,17,19` — `withSupabase` (generic) vs `assertNoQueryErrors` (plain `Error`)
- `src/shared/lib/catalog-hash/compute-catalog-hash.ts:22` — **bug #1** `localeCompare`
- `src/shared/lib/catalog-hash/load-cohort-courses.ts:43-50,119,129` — phantom-parent fallback, duplicated `groupBy`
- `src/shared/lib/write-parent-with-links/index.ts:20-21` — **bug #3** cleanup masks error
- `src/shared/lib/use-url-synced-filters.ts:20-25` — **bug #2** re-seed clobber
- `src/shared/lib/forms.ts:15,48,53-66` — **bug #4** confirm; duplicated result shape
- `src/shared/lib/actions/apply-action-errors.ts:7-11` — imperative loop; mis-foldered
- `src/shared/lib/config-status.ts:1,15-16` — astro-coupled; stale copy/docsUrl
- `src/shared/config/grid.ts:1,18,20-28,30-39` & `grid-presets.ts:20-24` & `slot-labels.ts:6-10` & `config/index.ts:8-10` — F3 targets + the `grid → grid-presets` dependency
- `src/shared/api/index.ts`, `load-plan-summary.ts` — existing data-access precedent (move destination)
