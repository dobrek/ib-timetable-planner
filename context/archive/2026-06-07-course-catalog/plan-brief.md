# Course Catalog (S-02) — Plan Brief

> Full plan: `context/changes/course-catalog/plan.md`
> Research: `context/changes/course-catalog/research.md`

## What & Why

Build the project's **first form-CRUD feature**: a course catalog at `/courses` showing both IB cohorts as **Year 1 / Year 2 tabs**, with atomic course create/edit/delete and overlap (dependency) authoring. It establishes the catalog CRUD convention — **Astro Actions + Zod 4 + react-hook-form + shadcn** — that S-03/S-04/S-05 will reuse. Zero migration: the schema shipped in F-02.

## Starting Point

`courses.astro` is a 10-line stub already wrapped in the app shell (route, nav, auth, theming done). The `courses`/`course_overlaps`/`course_merges` tables exist; cohorts are two seed-only rows with no pairing entity. No `zod`/`react-hook-form`/`@hookform/resolvers` installed; `src/actions/` and `src/lib/schemas/` don't exist; shadcn surface is `button`/`select`/`badge`.

## Desired End State

`/courses` shows Year 1 / Year 2 tabs (one cohort visible at a time), a teacher multi-select filter, a "New course" dialog (name, level, group, hours, required cohort, required teacher), per-row edit/delete with a cascade-aware confirm, and per-course overlap authoring. Merge data already in the DB renders read-only and tagged "Merged".

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| "School year" entity | None — implicit cohort pair | PRD is single-snapshot; the `plan` already spans both cohorts | Research |
| CRUD convention | Astro Actions + Zod 4 + RHF + shadcn | Typed end-to-end, shared schema, idiomatic Astro 6 | Research |
| Slice scope | Atomic CRUD + teacher select + overlaps | Ships the dependency relation; defers only the complex merge builder | Plan |
| Merge builder | Deferred; merges read-only | Merge hours/direction invariant is unsettled — risky to author now | Plan |
| Cross-cohort view | Year 1 / Year 2 tabs | One cohort visible at a time; satisfies "this school year" on one page | Plan |
| Teacher filter | Multi-select, client-side | Quickly narrow the list to chosen teachers' courses | Plan |
| Teacher on a course | Required (app-layer) | Every course must have a teacher; DB column stays nullable | Plan |
| Row actions | Kebab dropdown menu | Scales to Edit / Manage overlaps / Delete; merged rows show none | Plan |
| Sorting / pagination | Fixed order, none | ≤~60 rows/cohort — plain table suffices, avoids TanStack | Plan |
| `level`/`group` validation | App-layer Zod enum only | Composite levels are valid merge parents — no DB enum | Research |
| Action auth | Per-handler `locals.user` guard | `/_actions/*` is exempt from the middleware redirect | Plan |

## Scope

**In scope:** atomic course list (tabs + teacher filter), create/edit/delete, teacher select from seeded teachers, overlap authoring, merge read-only coexistence, schema unit tests.

**Out of scope:** merge builder, `school_years`/cohort CRUD, teacher CRUD (S-03), student/grouping UI, migrations, integration tests, an "All cohorts" union tab.

## Architecture / Approach

Server-rendered `courses.astro` loads cohorts/courses/teachers/merges/overlaps and projects to view-models (`plans/index.astro` pattern; `null`→503, `[]`→empty), then mounts one `CourseCatalog` React island (`client:load`) owning tab/filter/dialog state. Mutations go through `src/actions/` (`defineAction` + shared Zod from `src/lib/schemas/`), each with an auth guard and `23505` field-error mapping; success triggers a `navigate(currentPath)` refresh.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Foundation | Deps + shadcn + Zod schemas + Actions + schema tests | Zod version dedup; RHF dev re-optimize flare |
| 2. Read path | Cohort tabs + table + teacher filter + merge tagging | Correct merge-involved detection |
| 3. Mutations | Create/edit/delete via dialogs | Unique-violation & validation UX |
| 4. Overlaps | Directed overlap authoring | Self/duplicate/cross-cohort guards |

**Prerequisites:** local Supabase stack + seed; authenticated session.
**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- RHF as a client island dep may need adding to the client `optimizeDeps` if the documented dual-React dev flare reappears (`astro.config.mjs:19-31`).
- Merge model semantics (hours holder, parent↔child direction) are unsettled — intentionally deferred; the read-only guard is the safety boundary.
- Teacher filter uses a `popover`+`command` multi-select; if that proves heavy, a simpler checkbox dropdown is an acceptable fallback.
- Teacher is now **required** on a course, so course creation depends on ≥1 seeded teacher existing (teacher CRUD is S-03). The seed provides teachers; an empty `teachers` table blocks creation by design — surface a clear hint rather than a dead form.

## Success Criteria (Summary)

- An author can see, filter by teacher, and switch between both cohorts' courses on `/courses`.
- An author can create, edit, and delete atomic courses and author overlaps, with clear validation and cascade-aware deletes.
- Merge data is visible but unmodifiable; `pnpm test` + `pnpm build` pass; no theme-token regressions.
