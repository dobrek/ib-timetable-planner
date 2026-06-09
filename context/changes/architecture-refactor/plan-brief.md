# Architecture Refactor — FSD v2.1 Migration — Plan Brief

> Full plan: `context/changes/architecture-refactor/plan.md`
> Research: `context/changes/architecture-refactor/research.md`

## What & Why

The codebase has grown a set of architectural smells from mixed-convention generated code: layer leaks (domain logic importing view-model types upward), a generic `lib/` bucket mixing infrastructure with domain, inline page loaders, and API routes coupling transport with business rules. We're migrating the entire `src/` tree to Feature-Sliced Design v2.1 to establish clean boundaries, enforce import direction, and give new modules a well-defined standard to follow.

## Starting Point

108 files in `src/` organized as flat `components/` (44 files) + `lib/` (49 files) + `pages/` (9 routes) + `layouts/` (2). Zero cross-feature coupling between auth/courses/planner — the domain core is already pure and well-tested. Two clean reference patterns exist: `plans/[id].astro` delegates to `loadPlannerData()`, and `actions/index.ts` uses thin orchestration over framework-free domain modules. The smells are where code diverges from these patterns.

## Desired End State

FSD v2.1 structure: `shared/` (infrastructure) → `entities/` (6 domain models) → `_pages/` (5 page slices with api/ui/model segments) → `app/` (layouts, styles). Astro `src/pages/` stays as thin routing shells. All app-data mutations go through Astro Actions (unified transport). Every slice has an `index.ts` public API barrel. `@feature-sliced/steiger` validates compliance.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Scope | Single plan, 5 phases | One coherent migration story; structural phases set up folders that behavioral phase fills in. | Plan |
| FSD layers | `shared` + `entities` + `_pages` + `app` only | Start simple; add `widgets/`/`features/` only when a 2nd consumer appears (FSD v2.1 philosophy). | Research |
| Entity scope | 6 entities (course, teacher, placement, grouping, plan, student stub) | Proven cross-feature boundaries per import graph analysis; no speculative extraction. | Research |
| Public API | Barrels from day one | Clean FSD compliance immediately; no second pass. `.astro` exception documented. | Plan |
| Actions unification | Migrate placements + grouping to Actions; keep auth routes | Actions are callable imperatively; auth routes need progressive enhancement. | Research |
| Shared helpers | `shared/lib/actions.ts` | No business logic (auth gate + error translation); infrastructure, not app-layer. | Plan |
| Test co-location | Flat (beside source) | Aligns with FSD segments; matches existing courses/ pattern. | Plan |
| Validation tooling | steiger as devDep, run per phase | Catches FSD violations incrementally. | Plan |
| Auth DS compliance | Include in Phase 5 | Natural follow-up after structural relocation; all behavioral changes together. | Plan |
| Lessons update | At start of Phase 5 | Sets the rule before implementing it; agents see correct guidance during implementation. | Plan |

## Scope

**In scope:**
- Full FSD v2.1 structural migration (all `src/` files)
- Unified Actions transport for placements + grouping
- Auth component semantic token compliance
- steiger integration
- `lessons.md` revision
- Test path updates and flat co-location standardization

**Out of scope:**
- New features or UI changes (except auth theming)
- Database schema changes
- `widgets/` or `features/` layers
- Auth route migration to Actions
- Component redesign
- Path alias changes

## Architecture / Approach

Bottom-up structural migration (Track A): `shared/` foundation → `entities/` domain models → `_pages/` page slices → cleanup. Then behavioral changes (Track B): Actions unification + auth DS + lessons. Every commit builds and passes tests. Steiger validates FSD compliance per phase. Recommended page migration order within Phase 3: plan-detail (smallest diff) → courses (biggest win) → plans-list → dashboard → sign-in.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Foundation | `shared/` + `app/` layers; ~35 import rewrites | High fan-out (`cn` has 16 consumers); one missed import breaks build |
| 2. Entities | 6 entity slices; upward import violation resolved | Type boundary decisions (which types belong where) |
| 3. Pages & Actions barrel | `_pages/` layer; thin routing shells; restructured Actions | Largest phase (~35 component moves); courses loader extraction is complex |
| 4. Cleanup | Empty dirs deleted; steiger clean; full CI green | Stale imports missed during phases 1–3 |
| 5. Behavioral changes | Unified Actions; auth DS; lessons update | Runtime behavior change (fetch → Actions); optimistic UI must still work |

**Prerequisites:** Working build and test suite on current main. No uncommitted changes in `src/`.
**Estimated effort:** ~3–5 implementation sessions across 5 phases.

## Open Risks & Assumptions

- steiger may flag patterns we consider acceptable (e.g., the student stub as `insignificant-slice`) — these are documented as justified warnings, not errors
- The courses page loader extraction (Phase 3) is the highest-risk single change — the 5-table fan-out + merge/overlap projection in frontmatter must be extracted without altering behavior
- Integration tests that hit `POST /api/grouping` must be rewritten in Phase 5 when the endpoint is replaced by an Action

## Success Criteria (Summary)

- All 15+ tests pass with updated import paths after every phase
- `pnpm dlx steiger src` reports zero errors after Phase 4
- Full CI gate (`install → astro sync → lint → test → build`) passes after every phase
- The app is functionally identical after Phases 1–4 (zero behavior change)
- After Phase 5, all app-data mutations use Astro Actions (auth routes excepted)
