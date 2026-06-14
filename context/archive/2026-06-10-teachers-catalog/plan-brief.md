# Teachers Catalog — Plan Brief

> Full plan: `context/changes/teachers-catalog/plan.md`
> Research: `context/changes/teachers-catalog/research.md`

## What & Why

Build a teacher CRUD catalog page at `/teachers` with read-only course assignment badges and workload visibility. This is the first half of roadmap S-03 (`teachers-and-availability-catalog-ui`) — the CRUD + display subset that enables the author to manage teachers and see their cross-cohort workload before availability rules and validator extensions arrive in a follow-up change.

## Starting Point

The `teachers` table exists in Supabase (code unique, full_name nullable), courses already reference teachers via `courses.teacher_id` FK, and `/teachers` is in navigation as a placeholder page. The `src/_pages/courses/` slice provides a complete, battle-tested template for catalog pages (loader, actions, forms, filters, table). No schema migration needed.

## Desired End State

The author navigates to `/teachers` and sees all teachers in a table with cohort-scoped course badges, per-cohort hours, and a total workload column. They can create/edit/delete teachers, search by text (code, name, course names), and filter by year. Assignments are read-only here — authored on `/courses`. Deleting a teacher with assignments shows a confirmation with impact count and cascades to SET NULL on courses.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Text search behavior | Immediate (no debounce) | Dataset is tiny (18 teachers); debounce adds UX latency with no performance benefit | Plan |
| Year filter UI | Toggle button group (All/Y1/Y2) | Compact, discoverable, matches the "structural cohort columns" design (always visible) | Plan |
| Empty assignment display | Em dash in badges, 0 in hours | Consistent with courses table sentinel display pattern | Plan |
| Badge interaction | Static (read-only) | Keeps scope narrow; cross-page navigation adds complexity with no stated requirement | Plan |
| Default sort order | Full name (nulls last), then code | Named teachers surface first; unnamed sort predictably by their primary identifier | Plan |
| Table layout | One row per teacher, structural Y1/Y2 badge columns | Immediate workload visibility without cohort switching | Research |
| Badge content | name + level + circled group-index (when > 0) | Matches course identity triple in compact form | Research |
| Assignments read-only | Authored on /courses, displayed here | Prevents dual-write complexity | Research |
| Delete semantics | Confirm with assignment impact count, cascades SET NULL | Mirrors DeleteCourseDialog pattern with correct FK semantics | Research |
| Code uniqueness | Submit-time UNIQUE_VIOLATION only | Consistent with courses pattern (no eager blur-time check) | Research |

## Scope

**In scope:**
- Teacher CRUD (create, edit, delete) via form dialog
- Read-only course assignment badges with Y1/Y2 grouping
- Per-cohort and total workload hours display
- Text search filter (code, name, course names)
- Year toggle filter (All / Y1 / Y2)
- Delete confirmation with assignment impact count
- URL-synced filter state

**Out of scope:**
- Teacher availability rules (follow-up change)
- Validator extension to named collision classes (follow-up)
- Editable assignments from this page
- CSV import of teachers
- Sortable/paginated table columns
- Client-side pagination

## Architecture / Approach

Replicate the `src/_pages/courses/` architecture layer-by-layer into `src/_pages/teachers/`. The slice owns model (types, schemas, filter logic), api (loader, CRUD handlers, actions, client), and ui (orchestrator, table, dialogs). The Astro page fetches via the loader and renders the orchestrator as a `client:load` island. Actions register in the global barrel (`src/actions/index.ts`).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Model + Schemas | Types, Zod schemas, pure filter function, URL params | None — pure code, no integration points |
| 2. API Layer | Loader, CRUD handlers, actions, client, barrel registration | UNIQUE_VIOLATION handling must match DB constraint |
| 3. UI + Page Wiring | Full interactive page with table, dialogs, filters | Badge rendering for variable assignment counts (row height) |

**Prerequisites:** None — teachers table exists, courses FK exists, nav entry exists.
**Estimated effort:** ~1 session across 3 phases (~18 new files, all following established patterns).

## Open Risks & Assumptions

- Assumes the existing 2-cohort structure (exactly Year 1 + Year 2) — loader relies on alphabetical cohort order matching Y1/Y2
- If courses are deleted or teacher_id SET NULL between page load and render, badges may show stale data — acceptable (full-page refresh resolves)

## Success Criteria (Summary)

- Author can CRUD teachers from `/teachers` with inline validation and conflict detection
- Table shows correct cohort-scoped course badges and workload totals
- Filters narrow the table immediately without page reload
- `pnpm build` passes with the new slice fully wired
