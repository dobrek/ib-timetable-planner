---
date: 2026-06-08T23:23:56+0200
researcher: Dobromir Kropielnicki
git_commit: 313537439a833499e623e091832013d3eba7660d
branch: main
repository: 10xdev3
topic: "Architecture refactor — smell inventory & Feature-Sliced Design target map"
tags: [research, codebase, architecture, fsd, layering, data-flow, components, refactor]
status: complete
last_updated: 2026-06-09
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Resolved open question #1 (.astro page public API) — pages are routing+layout shells; slice components (Astro or React) own all rendering"
---

# Research: Architecture refactor — smell inventory & Feature-Sliced Design target map

**Date**: 2026-06-08T23:23:56+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 313537439a833499e623e091832013d3eba7660d
**Branch**: main
**Repository**: 10xdev3

## Research Question

The codebase has grown a set of architectural smells from mixed-convention generated code:

- Leaks between layers (data-fetching inside page components)
- UI elements at the same folder level as features
- `src/lib/` as a generic bucket for utilities, API calls, and domain logic
- Astro Actions / API routes combining HTTP transport with database logic

We want to fix these by adopting a mature convention (**Feature-Sliced Design v2.1**, with shadcn/ui) so new modules follow a well-defined standard. This research produces: (1) a concrete **smell inventory** with file:line evidence across the whole `src/` tree, and (2) a proposed **FSD target map** with a migration delta. Focus areas: layering & boundaries, data & mutation flow, convention/FSD mapping, DS/UI organization, and routing.

## Summary

The codebase is in a **pre-FSD state**: a flat `src/components/` mixing UI primitives with feature slices, and a `src/lib/` bucket holding infrastructure, domain logic, schemas, config, and utilities side by side. The good news is the **separation that matters most is already partly in place**: the validation/compute engine (grouping, placement validation, planner derivations, merge logic) is overwhelmingly **pure and Vitest-friendly**, with the DB boundary consistently expressed as "function takes a `supabase` client as its first argument." Cross-feature coupling between `auth/`, `courses/`, and `planner/` components is **zero**. The Astro Actions write path is an **exemplary** thin-orchestration-over-framework-free-domain split.

The real smells are concentrated and addressable:

1. **Layer leaks** — `src/lib/planner/*` imports view-model types *upward* from `src/components/planner/types.ts` (6 files); two pages (`courses.astro`, `plans/index.astro`) embed DB-fetching loaders inline in frontmatter while `plans/[id].astro` shows the clean delegated pattern.
2. **API routes mix transport + DB + business rules** — `api/placements.ts` and `api/grouping.ts` inline Supabase queries and business rules (idempotent insert, existence checks) in the handler; only the *pure validation/compute* pieces are delegated. (Note: the lessons register sanctions keeping these as routes — the transport choice is intentional; the in-handler DB coupling is the refactor target.)
3. **`src/lib/` is an unsegmented bucket** — infra (`supabase.ts`), domain (`courses/`, `grouping/`, `placements/`), schemas, nav/config, and utils all live as peers.
4. **UI co-located with features** — `components/ui/` (shadcn) sits at the same level as `auth/`, `courses/`, `planner/`, plus a stray top-level `Banner.astro`; inside feature folders, components/hooks/types/helpers/tests are flat.
5. **Design-system non-compliance in `auth/`** — `FormField.tsx`, `SubmitButton.tsx`, `ServerError.tsx` hardcode palette colors instead of composing `ui/` primitives. (This supersedes the stale `LibBadge.astro` note in `lessons.md` — see correction below.)

The target is FSD v2.1 with the **Astro-specific `src/_pages/` convention** (Astro keeps `src/pages/` for routing; FSD's pages layer is renamed `_pages/`). The recommendation is **conservative**: `app` + `_pages` + `widgets` + `features` + `shared` + **one** entity (`course`), keeping the grouping/placement solvers local until reuse is proven. The single biggest friction point is that **`.astro` page components have no clean TS `index.ts` public API** — the migration must pick a convention for this.

## Detailed Findings

### 1. Routing & layers (`src/pages/`, `src/layouts/`, `src/middleware.ts`)

**Route table:**

| Route | File | Frontmatter data-loading | Layout |
|---|---|---|---|
| `/` | `src/pages/index.astro:7` | 302 redirect → `/dashboard` | none |
| `/dashboard` | `src/pages/dashboard.astro:5` | reads `Astro.locals.user` only | AppShellLayout |
| `/courses` | `src/pages/courses.astro:7-78` | **inline `createClient` + `fetchCatalog()`** — 5-table fan-out + merge/overlap projection | AppShellLayout |
| `/teachers` | `src/pages/teachers.astro` | static stub | AppShellLayout |
| `/students` | `src/pages/students.astro` | static stub | AppShellLayout |
| `/auth/signin` | `src/pages/auth/signin.astro` | reads `error` query param | Layout |
| `/plans` | `src/pages/plans/index.astro:8-17` | **inline `createClient` + `fetchPlans()`** | AppShellLayout |
| `/plans/[id]` | `src/pages/plans/[id].astro:8` | **delegates to `loadPlannerData()`** (clean reference) | Layout |
| `POST /api/auth/signin` | `src/pages/api/auth/signin.ts:13` | inline `auth.signInWithPassword` | — |
| `POST /api/auth/signout` | `src/pages/api/auth/signout.ts:7` | inline `auth.signOut` | — |
| `POST /api/grouping` | `src/pages/api/grouping.ts:17` | inline UUID checks + load→compute→persist | — |
| `POST/DELETE /api/placements` | `src/pages/api/placements.ts:14,65` | pure validate + inline insert/delete | — |

- **Layouts**: `Layout.astro` is the base HTML shell (theme script, config-status banners via `@/lib/config-status`); `AppShellLayout.astro` wraps it (`:19`) and adds the authenticated sidebar/nav (uses `NAV_ITEMS` from `@/lib/nav`, `isActive()` highlighting, `Astro.locals.user`). Classic **widget** material.
- **Middleware** (`src/middleware.ts:13-45`): deny-by-default auth gate; allowlists `/auth/signin`, `/_*`, `/api/auth/*`, static assets; populates `context.locals.user` via `createClient()` + `auth.getUser()`. Pure auth, no routing logic.

### 2. Boundary leaks (import-direction violations)

**Upward imports — `lib/` depends on `components/`** (the clearest FSD violation):
- `src/lib/planner/collisions.ts:3` → `import type { PlannerPlacement } from "@/components/planner/types"`
- `src/lib/planner/hours.ts:2` → same
- `src/lib/planner/client.ts:1` → same
- `src/lib/planner/load.ts:3` → `PlannerBoardProps, PlannerGrouping, PlannerPlacement` from `@/components/planner/types`
- `src/lib/planner/__tests__/collisions.test.ts:4`, `src/lib/planner/__tests__/hours.test.ts:4` → same

Root cause: `PlannerPlacement`/`PlannerBoardProps`/`PlannerGrouping` are view-models living in the component folder but consumed by the lib layer. Under FSD these belong in an entity/shared model, not in `components/`.

**Downward but domain-exposing** — `src/components/planner/types.ts:1` imports `GroupingCourse` from `@/lib/grouping/types`, exposing solver internals to the view layer.

**Inline page data-loading** (frontmatter doing the data layer's job):
- `src/pages/courses.astro:19-75` — worst offender: 5 parallel queries (`cohorts`, `courses`, `teachers`, `course_merges`, `course_overlaps`) **and** the merge-parent / overlap-projection business logic in frontmatter.
- `src/pages/plans/index.astro:10-14` — smaller inline `fetchPlans`.
- Contrast: `src/pages/plans/[id].astro` delegates entirely to `loadPlannerData()` in `src/lib/planner/load.ts` (`PlannerPageResult` discriminated union, `load.ts:11-14`), letting the page map result-kind → HTTP status. **This is the pattern to generalize.**

### 3. Data & mutation flow

**Supabase client topology:**
- `src/lib/supabase.ts:6` — the **only** client constructor: `createClient(requestHeaders, cookies)` wrapping `@supabase/ssr` `createServerClient` (`:10`), reading env from `astro:env/server` (`:3`), returning `null` when unconfigured (`:7-8`, every caller null-checks). Request-scoped, server-only. **No browser client exists.**
- **Naming collision smell**: `src/lib/planner/client.ts` is *not* a Supabase client — it's a browser `fetch` wrapper hitting `/api/placements` (`:13,26`).
- **Type-alias duplication**: `SupabaseClient<Database>` re-declared in `src/lib/courses/shared.ts:9`, `src/lib/planner/load.ts:7`, `src/lib/grouping/adapters/supabase.ts:6`, `src/lib/grouping/persist.ts:5`, `src/lib/grouping/staleness.ts:6`.

**Write path — Actions (exemplary):** `src/actions/index.ts` handlers are uniform 3-line orchestration — `requireSession` (`:30-34`) → `requireSupabase` (`:36-42`) → `runDomain(() => domainFn(supabase, input))` (`:48-57`, codes 1:1 `DomainError`→`ActionError`). Zod `input` shared from `src/lib/schemas/course` (`:4-13`). All business logic is in framework-free per-action files (`src/lib/courses/*`): cross-cohort rule in `createOverlap.ts:18-20`; server-side merge re-derivation in `createMerge.ts:23-38`; pure `merge.ts` (`deriveMergeParent` `:46`, `writeMergeAtomic` `:84`) shared between the builder dialog's live preview and the action gate. Matches the `lessons.md` "Action orchestration split" rule.

**Write path — API routes (the smell):**
- `src/pages/api/placements.ts` — POST (`:14`)/DELETE (`:65`) delegate to **pure** `validatePlacementInsert`/`validatePlacementDelete` (`src/lib/placements/validate.ts`, `:25/:76`) but **inline the Supabase insert/delete + unique-violation idempotency + 404/500 mapping** in the handler (`:30-58`, `:79-86`). The "return existing row on unique violation" *business rule* lives in the route (`:39-51`). Duplicated `json()` helper (`:89`).
- `src/pages/api/grouping.ts` — POST (`:17`) does **inline** UUID validation (`:28-32`, inconsistent with placements), inline plan/cohort existence checks (`:35-42`), then orchestrates `loadCohortCourses` → `computeGroupings` (`:48`) → `computeCatalogHash` → `persistGroupings` (`:57`). `EnumerationCapError`→422 (`:50-52`). Duplicated `json()`/`isRecord` (`:66,68`).
- `src/pages/api/auth/signin.ts:5-13`, `signout.ts:7` — transport + auth-DB in one handler.

**Client island → server communication** (two transports, split by purpose per `lessons.md`):
- Form CRUD islands → `astro:actions` (`CourseFormDialog.tsx:101-116` with `isInputError` field mapping; `DeleteCourseDialog.tsx:33`, `CourseOverlaps.tsx:61,74`, `MergeBuilderDialog.tsx:90`, `MergeManageDialog.tsx:79,100`).
- Hot-path islands → `fetch`: `usePlacements.ts` (optimistic add/move/remove + temp-id reconciliation, `:32-89`) via `planner/client.ts`; `ComputeGroupingsEmptyState.tsx:24` → `POST /api/grouping` then `location.reload()` (`:33`).
- **No shared fetch/query abstraction** — `planner/client.ts` and `ComputeGroupingsEmptyState` each hand-roll `fetch`+error helpers (the friction `lessons.md` warned about).

**Core purity (the strong foundation):** Pure, no Supabase/React — `grouping/{collision,enumerate,score,index,utils,types}.ts`, `placements/validate.ts` (explicitly "without touching Supabase or Request", `:24-25`), `planner/{collisions,hours,grid}.ts`, `courses/merge.ts`. Supabase-coupled (client injected as arg) — `grouping/adapters/supabase.ts` (`loadCohortCourses` `:24`, with a parallel `fixture.node.ts` proving the seam), `grouping/{persist,staleness}.ts`, `planner/load.ts`, all `courses/*` domain writers.

### 4. Components & design-system organization

**Co-location smell (confirmed):**
```
src/components/
├── ui/         ← 14 shadcn primitives + LibBadge.astro (semantic tokens, clean)
├── auth/       ← 5 components
├── courses/    ← 8 components + 1 hook + 3 helpers + 1 types + 2 tests
├── planner/    ← 9 components + 1 hook + 1 types
└── Banner.astro ← STRAY (belongs in ui/)
```
UI primitives sit at the same depth as feature slices; inside each feature, `types.ts`/hooks/helpers/`*.test.ts` are flat among components (e.g. `courses/{filterParams,labels,types,useCourseFilters}.ts`, `planner/{types,usePlacements}.ts`).

**Cross-feature coupling: zero** — no imports between `auth/`, `courses/`, `planner/`. All sharing goes through `@/lib/*`. Excellent slice independence.

**`.ts`/`.tsx` and `.astro`/`.tsx` discipline: perfect** — hooks/helpers/types are `.ts`, JSX is `.tsx`; `.astro` for static (`LibBadge`, `Banner`), `.tsx` islands for interactive.

**DS non-compliance — `auth/`** (the live theming smell):
- `FormField.tsx:6` hardcodes `bg-white/10 border…`; `:37` `text-blue-100/80`; `:53` `border-red-400/60 focus:ring-red-400` — reinvents an input instead of composing `ui/input.tsx`.
- `SubmitButton.tsx:18` hardcodes `bg-purple-600 … hover:bg-purple-500 text-white` instead of `<Button>`.
- `ServerError.tsx:11` hardcodes `border-red-500/30 bg-red-900/30 text-red-300`.

**Correction to `lessons.md`:** the "Use semantic theme tokens" lesson cites `src/components/ui/LibBadge.astro` as hardcoding `bg-blue-900/50` / `text-purple-200`. The current file (`LibBadge.astro:10-14`) uses **semantic tokens** (`bg-secondary`/`text-secondary-foreground`, `bg-primary`/`text-primary-foreground`) — it has been fixed. The live offenders are now the `auth/` components above. The rule still holds; only the example is stale.

### 5. FSD v2.1 mapping & migration

**Methodology (cited from the local skill):** layers high→low are `app → pages → widgets → features → entities → shared`; a module imports only from layers strictly below it; same-layer cross-slice imports are forbidden (`SKILL.md:40-60`). Slices live in `pages/widgets/features/entities`; `app/` and `shared/` have no slices and are organized by **segments** (`ui`/`model`/`api`/`lib`/`config`) which may import each other (`SKILL.md:358-374`, `layer-structure.md:259-272`). Public-API rule: consumers import a slice's `index.ts` only, except `shared/` which has one public API *per segment* (`SKILL.md:137-154`). Not all layers are required; "start simple, extract when used in 2+ places" (`SKILL.md:26-37,103-104,246-258`). Desegmentation: name segments by purpose, not by type — no `components/`/`hooks/`/`types/` (`layer-structure.md:314-340`); domain-based filenames `model/course.ts` not `model/types.ts` (`SKILL.md:168-184`).

**The Astro routing tension** (`framework-integration.md:360-411`): Astro can't move `src/pages/` out of `src/`, so **FSD yields the name** — put the FSD pages layer in **`src/_pages/`** and keep `src/pages/` for Astro routes; each `src/pages/*.astro` becomes a thin entry importing from `@/_pages/*`. Astro is the one exception to per-layer aliases — a single `@/* → ./src/*` alias is used, **which this project already has** (`tsconfig.json`), so no alias change is needed.

**Proposed target tree (v2.1 "pages first" — three layers + app, no widgets/features until proven reuse):**
```
src/
  pages/                ← Astro routing only (thin .astro shells: layout + loader call + HTTP status)
  _pages/               ← FSD pages layer — ALL page logic lives here
    dashboard/          ← ui/ (.astro, zero JS)
    courses/            ← ui/ (.tsx island: catalog, dialogs, filters) + api/ (loader) + model/
    plans-list/         ← ui/ (.astro, zero JS) + api/ (loader)
    plan-detail/        ← ui/ (.tsx island: PlannerBoard, grid, palette, groupings) + api/ (loader) + model/
    sign-in/            ← ui/ (auth form components)
    teachers/           ← (stub)
    students/           ← (stub)
  app/                  ← global concerns
    layouts/            ← BaseLayout.astro (HTML shell), SidebarLayout.astro (sidebar + nav)
    styles/             ← global.css
  entities/             ← shared domain models (model/ only, no CRUD)
    course/             ← CourseRow, CohortTab, TeacherOption, formatCourseLabel, merge/overlap rules, Zod schemas
    plan/               ← plan + variant view-models, grid preset parsing
    teacher/            ← TeacherOption view-model
    student/            ← (created when student CRUD lands)
    placement/          ← PlannerPlacement, LocalPlacement view-models
    grouping/           ← GroupingCourse, GroupingVariant, PlannerGrouping
  shared/
    ui/                 ← all shadcn primitives + LibBadge + Banner (per-segment index.ts)
    api/                ← supabase client.ts, database.types.ts
    lib/                ← cn (utils.ts), errors.ts, config-status.ts
    config/             ← nav.ts (NAV_ITEMS)
  actions/              ← Astro-required entry (thin composition barrel importing from _pages/*/api/)
  middleware.ts         ← Astro-fixed location (conceptually app layer)
```
No `widgets/` or `features/` layers — promote page-local slices only when a 2nd consumer appears.

**Concern placement highlights:** shadcn `ui/`→`shared/ui`; `supabase.ts`→`shared/api/client.ts`; `database.types.ts`→`shared/api`; `nav.ts`→`shared/config`; `utils.ts`/`errors.ts`/`config-status.ts`→`shared/lib`; `lib/courses/*` **split** — domain rules (`merge.ts`, `assertMergeParent.ts`)→`entities/course/model`, Zod schemas→`entities/course/model`; `lib/grouping/*`→`entities/grouping/model` (pure compute) + `_pages/plan-detail/` (page-local orchestration); `lib/placements/validate.ts`→`_pages/plan-detail/` (page-local until reuse); `lib/planner/*`→`_pages/plan-detail/` (model + api); `Layout.astro`→`app/layouts/BaseLayout.astro`; `AppShellLayout.astro`→`app/layouts/SidebarLayout.astro`; `global.css`→`app/styles`; `components/auth/*`→`_pages/sign-in/ui`; `components/courses/*`→`_pages/courses/ui` + `entities/course/model`; `components/planner/*`→`_pages/plan-detail/ui`; Astro Actions `defineAction`→`_pages/<page>/api/`, `src/actions/index.ts` stays as thin barrel.

## Code References

- `src/lib/planner/{collisions.ts:3, hours.ts:2, client.ts:1, load.ts:3}` — upward imports of component types (FSD violation)
- `src/components/planner/types.ts:1` — view layer importing solver domain type `GroupingCourse`
- `src/pages/courses.astro:19-75` — inline 5-table loader + merge/overlap projection in frontmatter
- `src/pages/plans/index.astro:10-14` — inline `fetchPlans` query
- `src/pages/plans/[id].astro:8` + `src/lib/planner/load.ts:11-14,23` — clean delegated loader (reference pattern)
- `src/pages/api/placements.ts:30-58` — inline Supabase insert/delete + idempotency business rule in handler
- `src/pages/api/grouping.ts:28-42` — inline UUID validation + plan/cohort existence checks in handler
- `src/lib/supabase.ts:6-23` — sole Supabase client factory (server, request-scoped)
- `src/lib/planner/client.ts` — misnamed browser fetch wrapper (not a Supabase client)
- `src/actions/index.ts:30-57` — exemplary thin Action orchestration
- `src/lib/courses/merge.ts:46,84` — pure merge derivation shared preview/gate
- `src/components/auth/{FormField.tsx:6,37,53, SubmitButton.tsx:18, ServerError.tsx:11}` — hardcoded palette colors
- `src/components/ui/LibBadge.astro:10-14` — now token-clean (corrects stale lessons.md example)
- `src/middleware.ts:13-45` — deny-by-default auth gate
- `src/layouts/AppShellLayout.astro:19` — wraps Layout; nav widget
- `.claude/skills/feature-sliced-design/references/framework-integration.md:360-411` — Astro `src/_pages/` convention + single `@/*` alias

## Architecture Insights

- **The hard part is already done well.** The two-cohort solver and all derivations are pure functions with an injected `supabase` arg; the grouping module even has a fixture adapter. FSD migration is largely *relocation*, not redesign, for the core.
- **Two clean reference patterns already exist** and should be generalized: (a) `plans/[id].astro` → `loadPlannerData()` discriminated-result page loading; (b) the `actions/index.ts` thin-orchestration split. The smells are where code *diverges* from these patterns (inline page loaders, in-handler API DB logic).
- **Slice independence is healthy** (zero cross-feature imports), so feature extraction will be low-friction. The risk is *over-extraction* — the FSD skill is emphatic about not mirroring DB tables as entities; keep grouping/placements local until a second consumer appears.
- **The transport split is intentional, not accidental** (`lessons.md`): Actions for form CRUD, API routes for realtime hot paths. The refactor should preserve the split and only extract the *DB logic* out of the API handlers into a `placements` domain module mirroring `courses/`.

## Open Questions

1. **`.astro` page public API — RESOLVED.** `src/pages/*.astro` files are **routing + layout shells only**: create the Supabase client, call the loader, set HTTP status codes, choose the layout, and render a single slice component. All rendering decisions (content, empty states, error states, unavailable messaging) live in the slice component. The component is imported from the `_pages/<page>/ui/` segment and can be **either `.astro` (static, zero JS) or `.tsx` (interactive island with `client:load`)** — the choice is per-page based on interactivity needs, not an architectural constraint. `.astro` component imports go by direct path (TypeScript can't re-export `.astro` from `index.ts`); this is a documented Astro-specific exception to FSD public-API rule 4-2, scoped only to the `ui` segment — data loaders (`api/`) and view-model types (`model/`) use standard `index.ts` barrels. Concrete mapping: `dashboard` → `.astro` (zero JS), `plans-list` → `.astro` (zero JS), `courses` → `.tsx` island (filters, dialogs, CRUD), `plan-detail` → `.tsx` island (drag-drop planner board).
2. **Where do Astro Actions live? — RESOLVED (see Follow-up below).** Apply the same Astro-specific thin-entry pattern used for pages: `src/actions/index.ts` is the framework-required entry and becomes a thin composition barrel; `defineAction` definitions move into each feature slice's `api/` segment; domain logic stays in `entities/course/model` / `shared/api`. Remaining sub-question: where the shared orchestration helpers (`requireSession`/`requireSupabase`/`runDomain`) live — `shared/lib/actions/` (no business logic) vs `app/`; leaning `shared/lib/actions/`.
3. **`entities/` scope — RESOLVED.** Six entities, no `user`/`auth` entity. Each entity holds **view-model types, domain rules, labels, and Zod schemas** in `model/`; raw DB types stay in `shared/api`, CRUD operations stay in feature-slice `api/` segments. Entities are not DB table mirrors — they hold the shared domain concepts consumed across features. (a) `entities/course` — `CourseRow`, `CohortTab`, `TeacherOption` view-models, `formatCourseLabel`, merge/overlap domain rules, Zod schemas. `CohortTab` lives here as a course-catalog dimension, not as a standalone entity. (b) `entities/plan` — plan + variant view-models, grid preset parsing, variant lifecycle logic. (c) `entities/teacher` — `TeacherOption` view-model (consumed by course forms, planner collision detection, future teacher schedule page). (d) `entities/student` — not built yet; will hold student + choice view-models once student CRUD lands; the grouping engine's core input is student choices. (e) `entities/placement` — `PlannerPlacement`, `LocalPlacement` view-models (consumed by planner UI, collision engine, hours engine — cross-feature). (f) `entities/grouping` — `GroupingCourse`, `GroupingVariant`, `PlannerGrouping` (consumed by grouping compute feature AND planner collision engine — proven cross-feature boundary).
4. **`middleware.ts` placement** — must stay physically at `src/middleware.ts` (Astro requirement); treat as conceptually app-layer but fixed.
5. **Server/client bundle split — RESOLVED.** No `index.server.ts` needed. The boundary is already clean: zero `.tsx` islands import the Supabase client; `astro:env/server` is confined to `supabase.ts` and `config-status.ts`; islands receive plain serializable props from `.astro` frontmatter. After FSD migration, the rule is: **no slice-level barrels for slices that mix server and client segments — import from the segment, not the slice** (e.g. `@/_pages/courses/api` for server loaders, `@/_pages/courses/model` for universal types, `@/_pages/courses/ui/CoursesPage.tsx` for the island). Each segment gets its own `index.ts`. Entity slices only have `model/` (types, pure functions, labels, schemas) — all universal, no server/client split needed. Astro's build enforces the boundary: a `client:load` island that transitively imports `astro:env/server` fails the build, providing a built-in safety net.
6. **Migration sequencing & tooling — RESOLVED.** Three FSD layers only: `_pages/`, `entities/`, `shared/`, plus `app/`. No `widgets/` or `features/` until proven reuse (v2.1 "pages first" philosophy — promote to widget/feature only when a 2nd consumer appears). Layouts move to `app/layouts/`: `Layout.astro` → `BaseLayout.astro` (HTML shell, theme, config banners), `AppShellLayout.astro` → `SidebarLayout.astro` (sidebar + nav shell). `middleware.ts` stays at `src/middleware.ts` (Astro-fixed, conceptually app layer). Actions barrel (`src/actions/index.ts`) imports from `_pages/<page>/api/` segments. **Migration is two tracks — structural relocation (Track A, no behavior change) then behavioral changes (Track B):** **A1 `shared/` foundation** — `ui/` (shadcn + LibBadge + Banner), `api/` (supabase.ts, database.types.ts), `lib/` (utils.ts, errors.ts, config-status.ts), `config/` (nav.ts). **A2 `app/`** — `BaseLayout.astro`, `SidebarLayout.astro`, `global.css`. **A3 Entities** — create all 6 `model/` segments (course, plan, teacher, student, placement, grouping); move view-model types, labels, domain rules, schemas; resolves upward import violations. **A4 Pages (one by one)** — extract loaders to `_pages/<page>/api/`, move/create page components in `_pages/<page>/ui/` (`.astro` for static, `.tsx` for interactive), slim `src/pages/*.astro` to routing shells; order: `plans/[id]` (smallest diff, proves pattern) → `courses` (biggest win) → `plans/index` → `dashboard` → `sign-in`. All page-local components (dialogs, filters, planner board, palette) stay inside their `_pages/<page>/` slice. **A5 Actions barrel** — move `defineAction` definitions to `_pages/<page>/api/` segments, slim `src/actions/index.ts` to thin composition barrel. **A6 Cleanup** — delete emptied `src/lib/`, `src/components/`, `src/layouts/`; run steiger; desegment if needed. **B1 Actions unification** — migrate `api/placements` + `api/grouping` to Actions; create domain modules; delete `src/lib/planner/client.ts` + duplicated helpers. **B2 Lessons update** — revise `lessons.md` "two mutation styles" → unified Actions rule. **B3 Auth DS compliance** — replace hardcoded palette colors in auth components with semantic tokens + shadcn primitives. **Tooling:** `@feature-sliced/steiger` as dev dep (`pnpm dlx steiger src` after each phase); existing ESLint flat config; consider `eslint-plugin-boundaries` once structure is in place. **Commit discipline:** one commit per file-move batch; never mix relocation with refactoring; every intermediate commit builds and passes tests.

## Historical Context (from prior changes)

From `context/foundation/lessons.md`:
- **"Two mutation styles, split by purpose"** (decided during `course-catalog` S-02): Form CRUD → Astro Actions; realtime hot paths → API routes. *"Adopting Actions does not require retrofitting the existing API routes."* → The refactor should preserve the transport split and extract only DB logic from the API handlers.
- **"Action orchestration split"** (and MEMORY): Astro Actions stay thin; logic in framework-free per-action domain files. → Already implemented in `actions/index.ts` + `lib/courses/*`; generalize this shape.
- **"Use semantic theme tokens"**: the cited `LibBadge.astro` example is now stale (file is token-clean); the live offenders are the `auth/` components.
- **"Port the mechanism, not the legacy type shape"**: model core on the app's own domain types, identity as opaque tokens, display at edges. → Reinforces moving `PlannerPlacement`/`GroupingCourse` view-models into a proper entity/shared model rather than leaving them in `components/`.

## Related Research

None yet — this is the first research artifact under `context/changes/architecture-refactor/`. Next step is `/10x-frame` (challenge scope/sequencing of the refactor) and/or `/10x-plan` (per-slice migration plan), grounded in the open questions above.

## Follow-up Research 2026-06-08 — Astro Actions placement

**Question:** Can Astro Actions adopt the same Astro-specific thin-entry pattern proposed for pages, given they appear bound to the `src/actions/` folder?

**Answer: yes — confirmed against the Astro docs.** Astro Actions require only a `server` object exported from `src/actions/index.ts`, and the docs explicitly support splitting definitions across files and importing them into that object ("Organizing actions", `src/content/docs/en/guides/actions.mdx`: define a group in `src/actions/user.ts`, import into the index `server`). So `src/actions/index.ts` is a framework-fixed location exactly like `src/pages/` and `src/middleware.ts`, and the same thin-entry treatment applies.

**Resolved pattern (three tiers):**
```
src/actions/index.ts          ← Astro-required entry; THIN composition barrel (the `server` object), no logic
features/<slice>/api/         ← defineAction + Zod input + orchestration (requireSession/requireSupabase/runDomain)
entities/course/model + shared/api  ← framework-free domain logic (unchanged from the main map)
```
`src/actions/index.ts` collapses to imports + composition:
```ts
import { courseEditActions } from "@/features/course-edit/api";
import { courseMergeActions } from "@/features/course-merge/api";
import { courseOverlapActions } from "@/features/course-overlap/api";
export const server = { ...courseEditActions, ...courseMergeActions, ...courseOverlapActions };
```
This supersedes the earlier "Actions → app layer" suggestion: the `defineAction` glue lives co-located with its feature slice (`api` segment), the entry file is pure composition, and the domain split already mandated by `lessons.md` ("Action orchestration split") is preserved.

**Decision baked in — flat vs nested `server`:**
- **Spread (flat)** — `server = { ...courseEditActions, ... }` keeps call sites identical (`actions.createCourse` at `CourseFormDialog.tsx:101`, etc.). **Recommended for the migration** — pure relocation, no behavioral change, consistent with "separate relocation commits from refactors".
- **Nested namespace** — `server = { course: courseEditActions }` → call sites become `actions.course.createCourse`; cleaner grouping but rewrites every island call site. Defer as optional polish.

**Remaining sub-question:** shared orchestration helpers (`requireSession`/`requireSupabase`/`runDomain`, today `actions/index.ts:30-57`) → `shared/lib/actions/` (they carry no business logic, only an auth gate + `DomainError`→`ActionError` translation) vs `app/`. Leaning `shared/lib/actions/`; settle at plan time.

## Follow-up Research 2026-06-09 — Unify backend communication onto Astro Actions

**Question:** Can the remaining API routes be migrated onto the Astro Actions mechanism so the app has one way to talk to the backend? Verified against the Astro docs (`reference/modules/astro-actions.mdx`, `guides/actions.mdx`).

**Premise re-test (the `lessons.md` rule):** The "two mutation styles, split by purpose" rule keeps realtime hot paths as API routes on the grounds that forcing an "optimistic realtime drag-drop path through a form-shaped Action" is friction. **That premise is outdated.** Actions are callable imperatively from client JS — `const { data, error } = await actions.createPlacement(input)` (`astro-actions.mdx`) — and `.orThrow()` returns typed `data` / throws on failure (`guides/actions.mdx`), which is *exactly* the contract `src/lib/planner/client.ts:12-32` hand-rolls. Optimistic reconciliation lives entirely in `usePlacements.ts` (client-side, `:32-89`) and is transport-agnostic. So the drag-drop path does not need a form and does not need a bespoke endpoint.

**Per-route feasibility (with exact current contracts):**

| Route | Current contract | Migrate to Action? | Mapping |
|---|---|---|---|
| `POST /api/placements` (`placements.ts:14-59`) | insert → return row (real `id`); unique-violation → return existing row (idempotent); throws → 500 | ✅ **Yes — clean win** | `actions.createPlacement(input).orThrow()` returns the row for optimistic reconcile; throw → rollback. Zod `input` replaces pure `validatePlacementInsert`. Idempotent path keeps returning a row (or maps to `CONFLICT`). |
| `DELETE /api/placements` (`placements.ts:65-87`) | delete by id → `{id}`; throws → 500 | ✅ **Yes** | `actions.deletePlacement({id}).orThrow()`. |
| `POST /api/grouping` (`grouping.ts:17-64`) | load→compute→persist; `EnumerationCapError`→422; plan/cohort missing→404; returns `{groupings, names, catalogHash, warnings}` | ✅ **Yes — win** | `EnumerationCapError`→`ActionError("UNPROCESSABLE_CONTENT")` (422), missing→`NOT_FOUND`. Devalue serialization lets `names` stay a `Map` (drop `Object.fromEntries`, `:59`). Inline UUID check → Zod `input`. |
| `POST /api/auth/signin` (`signin.ts:4-20`) | HTML `<form action="/api/auth/signin">` (`SignInForm.tsx:43`, no-JS progressive enhancement); `signInWithPassword` sets cookies; `context.redirect` | ⚠️ **Keep / migrate last** | Actions can set cookies + `accept:'form'`, but no-JS redirect-after-submit needs `Astro.getActionResult()` + page-level redirect — more moving parts than the 3-line route, on the one surface where progressive enhancement matters most. |
| `POST /api/auth/signout` (`signout.ts:4-10`) | `signOut()` + redirect | ⚠️ **Keep** | Trivial session lifecycle; nothing to gain. |

**Key facts verified:**
- Actions error codes cover every case: `BAD_REQUEST` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404), `CONFLICT` (409), `UNPROCESSABLE_CONTENT` (422), `INTERNAL_SERVER_ERROR` (500) — and `isInputError`/`isActionError` for the client. No HTTP semantic is lost.
- **<200ms budget is unaffected** — it governs the client-side `deriveCollisions` validation on drag, not the persistence round-trip (which is optimistic/async). Transport choice is irrelevant to it.
- **workerd-safe** — Actions run per-request in handler scope, preserving the "compute in handler scope, never at module load" constraint `grouping.ts:9-15` documents. Cloudflare adapter supports Actions.
- **Infra already supports it** — middleware allowlists `/_actions/*` (noted in `actions/index.ts:25-29`); each handler self-enforces session via `requireSession`.

**Resolved recommendation:**
- **Migrate `placements` (POST/DELETE) and `grouping` (POST) to Actions.** They join the existing course-CRUD actions under the same thin-Action-over-domain-module shape; create `placements`/`grouping` domain modules mirroring `lib/courses/*`. This deletes `src/lib/planner/client.ts` (misnamed fetch wrapper), the duplicated `json()`/`isRecord` helpers, and the inline in-handler DB logic — **resolving research smells #2 and #3** and giving end-to-end types + one error model.
- **Scope auth signin/signout out** of the unification (session lifecycle / progressive-enhancement form posts, not app-data API calls).
- **Reads stay as page loaders** (`loadPlannerData`) — Actions are POST-only RPC, never the SSR read path.
- **The unified rule becomes:** *Astro Actions are the single transport for all app-data mutations + compute; API routes are reserved only for raw `Request`/`Response` needs (webhooks, external/non-Astro consumers, streaming, file downloads, auth session endpoints).*

**Action needed if committed:** this **supersedes** the `lessons.md` "Two mutation styles, split by purpose" rule. Revise that lesson via `/10x-lesson` to the unified rule above before/at implementation.
