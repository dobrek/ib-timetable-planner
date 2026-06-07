---
date: 2026-06-05T22:37:30+0200
researcher: Dobromir Kropielnicki
git_commit: cc1fc371b46db64adff437e7b5038fee7ce6975b
branch: main
repository: ib-timetable-planner
topic: "Drag-and-drop library choice for the first interactive UI (S-01: first valid drop with validation)"
tags: [research, codebase, drag-and-drop, dnd, react-19, astro-islands, cloudflare-workers, dnd-kit, pragmatic-dnd]
status: complete
last_updated: 2026-06-05
last_updated_by: Dobromir Kropielnicki
last_updated_note: "(1) Flipped primary pick from legacy @dnd-kit/core to @dnd-kit/react after confirming dndkit.com/react/quickstart labels @dnd-kit/core 'legacy'. (2) Resolved the two blockers with the author: Drop UX = accept-and-flag; collision scope = per-cell; cells are multi-occupancy; grouping is a hint + bulk-drop convenience while the course is the unit of placement/movement; validation is a reactive per-cell derivation. (3) Multi-hour courses: one placement row = one hour (schema already supports it via placements_unique); drag unit = 1 hour; collision vs completeness are two distinct validators; S-01 includes a read-only hours-placed/required counter, with hard completeness enforcement deferred to the finalize gate (Q9). See 'Confirmed design decisions'."
---

# Research: Drag-and-drop library choice for the first interactive UI

**Date**: 2026-06-05T22:37:30+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: cc1fc371b46db64adff437e7b5038fee7ce6975b
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

> We have the tech stack selected but this is the first implementation where we truly
> touch the UI interface. I am looking for a drag-and-drop solution that gives us
> simplicity and flexibility and is in line with our tech stack. What options do we have?

Scope agreed before research: **decisive pick + integration plan**; keyboard/accessibility parity (PRD Q11) weighed as a **tie-breaker only** (MVP may ship drag-only).

## Confirmed design decisions (with author, 2026-06-05)

These resolve the two blockers and pin the interaction model. They drive both the library wiring and the plan.

- **Grid:** fixed **8 periods × 5 days** (40 cells); a cell *is* a time slot. (Within the PRD's preset set; bespoke grids deferred.)
- **Cells are multi-occupancy.** The author packs *as many co-runnable courses into one slot as possible* — that is the whole point of the grouping mechanism. A slot is not one-grouping-per-cell.
- **A grouping is a HINT, not a container.** It is a ranked suggestion of courses that can share a slot collision-free, surfaced in the palette. It never binds courses together on the grid.
- **The course is the unit of placement and movement.** *"Group is just a hint; we always move a course."* Dropping a grouping is a **bulk-drop convenience** that fans its courses into a cell as individual course placements; from then on every course is dragged individually between cells to find the optimal fit. → `placements` stays course-level; no grouping-identity on the row (the hint lives in `course_groupings`).
- **Drop UX = accept-and-flag (PRD Q8 → option b, RESOLVED).** A colliding drop always lands and is visibly flagged with its named collision class; it persists until resolved. No block/snap-back, no modal prompt. This preserves the "feel of the puzzle" and supports the real workflow: *park a course to see where it fits, then move other courses to clear the conflict.*
- **Collision scope = per-cell (RESOLVED).** A student collision is two of a student's courses in the **same `(day, period)` cell**, evaluated across *all* courses placed there. S-01 covers the **student-collision class only** (teacher classes S-03, cross-cohort S-09).
- **Validation is a reactive, derived per-cell computation** — recomputed on every placement change, not a one-shot verdict fired in `onDragEnd`. So moving a course out of a cell **auto-clears** the flag, and the flag attributes *which* courses conflict (resolution may move any participant, not just the last drop).
- **Multi-hour courses are hour-grain (no schema change).** `courses.hours_per_week` is persisted (`migration:36`) and already flows into `GroupingCourse.hours`. **One placement row = one hour of a course in a cell**; a course with N hours = N rows across N different cells. The `placements_unique (variant_id, cohort_id, day, period, course_id)` constraint already enforces "a course at most once per cell, many cells across the week." **Drag/move unit = one hour (one row)** — author's call. A **grouping drop places 1 hour of each member course**; differing hour budgets per member are exactly why top-up happens via individual course placements (reinforces "course is the unit"). No auto-spreading — the author places each hour manually (matches the no-auto-placement non-goal).
- **Two distinct validators — do not conflate.** *Collision* (per-cell, real-time, "is this legal?") vs *Completeness* (per-course/global, "are all `hours_per_week` placed?", "is it finished?"). They are orthogonal: a collision-free grid can be incomplete, and a complete grid can collide. **S-01 ships the collision validator (student class) + a read-only "hours placed / required" counter** (e.g. "Math 1/5") — a cheap derivation that makes the north-star drop feel real. **Hard completeness enforcement** (block finalize when hours are missing) is the finalize gate's job (Q9), deferred; note merge-children legitimately carry 0 standalone hours (`migration:40-42`), which the completeness check must special-case when merges arrive.
- **Finalize gate (PRD Q9, still open but framed):** "final" should require **zero flagged collisions AND all course hours placed** across the grid. Accept-and-flag + the completeness check are what make that gate meaningful (drafts may hold collisions and missing hours; finalize is the bar). Confirm exact gate during planning.

## Summary

**Recommendation: adopt `@dnd-kit/react` (the current dnd-kit line) for S-01.**

> **Decision revised after user feedback.** An earlier draft recommended the older `@dnd-kit/core` 6.3.x line for its stability. That is wrong for a greenfield UI: [dndkit.com/react/quickstart](https://dndkit.com/react/quickstart/) now installs `@dnd-kit/react` and explicitly calls the old packages legacy — *"If you're migrating from the legacy `@dnd-kit/core`, `@dnd-kit/sortable`, or `@dnd-kit/utilities` packages, see the Migration guide."* Starting a brand-new project on the maintainer's own legacy line means a guaranteed future migration — i.e. taking on technical debt at the very beginning. We grow *with* the supported package, not against it.

It is the best fit for *this* project's headline ask — "simplicity **and** flexibility" — for four concrete reasons:

1. **It's the supported, forward path** — officially declares React 19 (`peerDep ^18 || ^19`), actively developed (commits into May 2026), and is what the docs hand a new project. No legacy migration baked in from day one.
2. **Simplicity through a declarative React-hook model** that matches the codebase's existing idiom (function components + hooks + `cn()`/cva styling). `DragDropProvider` + `useDraggable` + `useDroppable` + a single synchronous `onDragEnd` is far less glue than wiring the native HTML5 DnD API by hand.
3. **Flexibility for free 2D grid placement** (palette card → arbitrary `(day, period)` cell, then move/remove) via per-cell `useDroppable` — it is *not* locked into a sortable-list abstraction.
4. **Synchronous drop hook + near-free a11y** — `onDragEnd(event)` exposes `event.operation.{source,target}` synchronously, so the existing pure validator (`hasIntersection`, `src/lib/grouping/collision.ts:3`) runs inline, well inside the **≤200 ms** budget (NFR / FR-012); keyboard support + drag preview come from the library, de-risking PRD Q11 (the a11y tie-breaker) as a near-free later slice.

**Runner-up: Atlassian Pragmatic drag-and-drop** — the flexibility/bundle/React-version-proof champion (~4.7 kB, zero React peerDep). The right pick *only if* `@dnd-kit/react`'s pre-1.0 status proves too churny in practice, or if a11y becomes a hard requirement weighed against bundle. Its cost is simplicity: you assemble drag previews, drop indicators, and keyboard a11y yourself.

**Rejected:** the legacy `@dnd-kit/core` 6.3.x line (maintainer-labeled legacy — debt on a fresh project); `react-dnd` (stalled; no official React 19 support — issue #3655 open); `react-beautiful-dnd` (deprecated Oct 2024; peerDep excludes React 19). React Aria DnD is viable and the most accessible, but its async `getData()` data-transfer model adds ceremony that works against the simplicity goal.

### Version sub-decision (read before installing)

`@dnd-kit` ships in **two non-interchangeable lines** — this is the single most important install-time fact, and the docs have moved the recommendation:

| | `@dnd-kit/react` **0.4.0** (current, recommended) | `@dnd-kit/core` **6.3.x** (legacy) |
|---|---|---|
| Docs status | What [dndkit.com/react/quickstart](https://dndkit.com/react/quickstart/) installs today | Explicitly called *legacy*; migration guide provided |
| React 19 peerDep | `^18 \|\| ^19` (officially declares 19) | `>=16.8.0` (admits 19; works in practice, no *official* 19 stamp) |
| Maintenance | Actively developed (commits May 2026) | Maintenance-mode, frozen API |
| Bundle (gz) | ~32.3 kB (upper bound, pre-tree-shake) | ~13.9 kB core (+3.6 sortable, +1.5 utilities) |
| Stability | **0.x — API may still shift** | Battle-tested, but you'd be adopting a deprecated-in-spirit line |
| Greenfield cost | grows with the supported package | guaranteed future migration = debt on day one |

**Recommended primary: `@dnd-kit/react` 0.4.0.** For a fresh UI, the maintainer's supported line wins over the legacy one despite its smaller bundle and longer track record — adopting a package already relabeled "legacy" front-loads a migration we can avoid entirely. The real cost of `@dnd-kit/react` is its **pre-1.0 API churn**, mitigated here by (a) a tiny S-01 API surface (`DragDropProvider` + one draggable + one droppable + `onDragEnd`), (b) pinning the exact version in the lockfile, and (c) building greenfield so we track the API anyway. Bundle size is a non-issue for an internal, laptop-only school tool. **Escape hatch:** if 0.x churn bites, **Pragmatic DnD** (not the legacy core) is the fallback.

## Detailed Findings

### Library landscape (verified 2026-06-05 against npm registry + GitHub)

| Library | Latest | React 19 | SSR / workerd import-safe | Bundle (gz) | 2D grid fit | a11y out-of-box | Verdict |
|---|---|---|---|---|---|---|---|
| **@dnd-kit/react** | 0.4.0 | ✅ official `^19` | ✅ hooks, no top-level DOM access | ~32.3 kB | ✅ `useDroppable` per cell | ✅ keyboard + drag preview | **Recommended (primary)** |
| @dnd-kit/core | 6.3.1 | works in practice (peer `>=16.8`) | ✅ | ~13.9 kB | ✅ | ✅ | **Rejected — maintainer-labeled legacy** |
| Pragmatic DnD | 1.8.1 | ✅ (framework-agnostic, no peerDep) | ✅ effect-registered, native HTML5 | ~4.7 kB | ✅ excellent | ❌ DIY (separate a11y pkg) | **Runner-up / fallback** |
| React Aria DnD | 3.49.0 | ✅ official | ✅ first-class SSR | pay-per-hook | ✅ (low-level `useDrop`) | ✅ best-in-class | Viable; most ceremony |
| Native HTML5 DnD | platform | ✅ | ✅ 0 kB | 0 kB | feasible | ❌ none | Pragmatic does this better for ~4.7 kB |
| react-dnd | 16.0.1 | ❌ unsupported (#3655 open) | client-only mount | ~8.7 kB | ✅ | ❌ poor | Avoid (stalled) |
| react-beautiful-dnd | 13.1.1 | ❌ excluded by peerDep | — | — | list-only | — | **Deprecated — excluded** |

Key sources: [npm @dnd-kit/core](https://www.npmjs.com/package/@dnd-kit/core), [npm @dnd-kit/react](https://www.npmjs.com/package/@dnd-kit/react), [clauderic/dnd-kit](https://github.com/clauderic/dnd-kit), [useDroppable docs](https://dndkit.com/react/hooks/use-droppable), [npm @atlaskit/pragmatic-drag-and-drop](https://www.npmjs.com/package/@atlaskit/pragmatic-drag-and-drop), [atlassian/pragmatic-drag-and-drop](https://github.com/atlassian/pragmatic-drag-and-drop), [react-dnd #3655](https://github.com/react-dnd/react-dnd/issues/3655), [react-beautiful-dnd deprecation #2672](https://github.com/atlassian/react-beautiful-dnd/issues/2672), [React Aria DnD](https://react-spectrum.adobe.com/react-aria/dnd.html).

### What the DnD UI must plug into (codebase ground truth)

**Hydration pattern.** React islands mount via `client:load` with props passed from Astro frontmatter. Reference: `src/pages/auth/signin.astro:16` (`<SignInForm serverError={error} client:load />`), component typed with a local `type Props` (`src/components/auth/SignInForm.tsx:8`). React integration is enabled in `astro.config.mjs:12`; output is Cloudflare-adapter SSR. dnd-kit is import-safe (hooks only, no top-level `document`/`window`), so it survives SSR in workerd and activates on hydration.

**UI conventions the new components must match.** `cn()` = `twMerge(clsx(...))` (`src/lib/utils.ts:4`); variants via `cva` exporting both component and `…Variants` (`src/components/ui/button.tsx:7`); polymorphism via Radix `Slot` + `asChild`; `data-slot="…"` semantic markers; lucide icons sized `size-4`. A draggable grouping card and a droppable slot cell should be built in this same style.

**The draggable payload — grouping output shape** (`src/lib/grouping/types.ts:1`):
```ts
type GroupingCourse  = { id: string; teacherKey: string | null; studentKeys: string[]; hours: number };
type GroupingVariant = { size: number; coverageCount: number; rank: number; score: number; memberIds: string[] };
type GroupingResult  = { seedId: string; variants: GroupingVariant[] };
```
Each `GroupingVariant` is one palette card. Identity = `memberIds` (sorted, deduped across seeds); ranking = `score` desc, then `coverageCount` desc (`src/lib/grouping/index.ts:21`). Display names arrive separately as `Record<courseId, name>` from the grouping API (`src/pages/api/grouping.ts:59`). The card's drag `data` should carry the `GroupingCourse[]` (or member ids + a lookup) so the drop handler can validate without a round-trip.

**The drop target — placements schema** (`src/lib/database.types.ts:256`):
```
placements: { id, variant_id, course_id, day:number, period:number, cohort_id, created_at }
```
A slot cell is the `(day, period)` pair, and cells are **multi-occupancy**. The unique constraint `placements_unique (variant_id, cohort_id, day, period, course_id)` (`migration:124`) means **one row = one hour of a course in a cell**: a course sits at most once per cell but can span many cells, so a multi-hour course = several rows across the week. Dropping a grouping is a bulk convenience that inserts **one row (one hour) per member `course_id`** into the cell; thereafter each course-hour is an independent row. The grid renders from these rows; **the unit of move/remove is a single course-hour** — "move" = update one row's `(day, period)`, "remove" = delete one row. Hours-placed/left for a course = a count over its rows vs `courses.hours_per_week`. No grouping identity is stored on the row (the hint lives in `course_groupings`).

**The validator entry point** (`src/lib/grouping/collision.ts:3`):
```ts
hasIntersection(course: GroupingCourse, list: GroupingCourse[]): boolean
// true if: same id ∈ list, OR shared non-null teacherKey, OR any shared studentKey
```
Pure, synchronous, O(n·m). S-01 covers the **student-collision class only** (per roadmap `S-01`); teacher classes arrive S-03, cross-cohort S-09. **Collision scope is per-cell (resolved):** for a cell, `list` = the other courses placed in that same `(day, period)`, and each course in the cell is checked against the rest. Because the flag must auto-clear when a course is moved away, the verdict is a **reactive per-cell derivation over placement state** — recompute the affected cell(s) on every add/move/remove — *not* a one-shot value captured inside `onDragEnd`. `onDragEnd` just mutates placement state; the per-cell collision state is computed from it. Still trivially within the ≤200 ms budget (one cell's occupants).

**Persistence path.** React islands **cannot** call Supabase directly — the client is server-only (`@supabase/ssr` `createServerClient`, cookie-tunneled session, `src/lib/supabase.ts:6`; auth populated in `src/middleware.ts`). Placements must go through a **new API route** that mirrors `src/pages/api/grouping.ts:17` (parse JSON → `createClient(request.headers, cookies)` → 503 if unconfigured → typed `supabase.from(...)` → `json(...)` response). Suggested: `POST /api/placements` (create/move), `DELETE /api/placements` (remove). Optimistic flow: validate sync → apply to local island state → POST to persist → reconcile on error.

## Code References

- `src/pages/auth/signin.astro:16` — `client:load` island mount pattern (template for the planner island)
- `src/components/ui/button.tsx:7` — cva + Radix `Slot` + `asChild` convention for new components
- `src/lib/utils.ts:4` — `cn()` className merge utility
- `src/lib/grouping/types.ts:1-19` — `GroupingCourse` / `GroupingVariant` / `GroupingResult` (draggable payload)
- `src/lib/grouping/index.ts:21` — grouping sort order (score desc → coverage desc → memberIds)
- `src/lib/grouping/collision.ts:3-13` — `hasIntersection` (synchronous drop validator)
- `src/lib/database.types.ts:256-307` — `placements` row shape (`day`, `period`, `course_id`, `variant_id`, `cohort_id`)
- `supabase/migrations/20260602185012_minimal_domain_schema.sql:116-127` — `placements` DDL incl. `placements_unique` (hour-grain: course ≤ once/cell) and day 1–7 / period 1–12 checks
- `supabase/migrations/20260602185012_minimal_domain_schema.sql:36,40-42` — `courses.hours_per_week` (completeness source; merge-children may carry 0 hours)
- `src/lib/grouping/adapters/supabase.ts:46` — `hours_per_week` → `GroupingCourse.hours`
- `src/pages/api/grouping.ts:17-70` — API route pattern to mirror for `/api/placements`
- `src/lib/grouping/persist.ts:46` — `persistGroupings` RPC pattern (precedent for a placements RPC if batching)
- `src/lib/supabase.ts:6-25` — server-only Supabase client (why placements need an API route)
- `src/middleware.ts:24-38` — auth/session populated into `context.locals.user`

## Architecture Insights

- **The validator is pure/synchronous, and used reactively.** The DnD library's only job is to mutate placement state on drop; collision state is a **derived per-cell computation** over that state (`hasIntersection` across a cell's occupants), recomputed on every change so flags clear automatically when a course moves. No library is on the latency critical path — this lowers the stakes of the library choice and argues for whichever is *simplest to wire*, which favors dnd-kit's hook model.
- **The course is the unit; the grouping is a hint + bulk-drop.** Model local state and the API around **individual course placements in a cell**, not "a grouping at a cell." Dropping a grouping is sugar that inserts N course rows; everything after is per-course. Cells are multi-occupancy.
- **Island boundary is narrow.** One `PlannerBoard` island (`client:load`) hosting `DragDropProvider`, fed seeded data as props from an Astro page that loads `course_groupings` (the palette hints), `placements`, grid preset, and the student-choice data needed for validation server-side. Keeps Supabase server-side and the client island self-contained.
- **Lesson "Port the mechanism, not the legacy type shape" applies.** Drag `data` should carry app-native identity (course ids / `GroupingCourse`), with display names resolved at the edge — not a parallel display-name-bearing payload. See `context/foundation/lessons.md`.
- **React Compiler is not a hazard for dnd-kit** (hooks-rule-compliant). The usual footgun is a stale closure over the validator inside `onDragEnd` — reference current placement state via the handler's closure/ref, not a memoized snapshot.

## Proposed integration (POC sketch for the S-01 drop)

1. **Install:** `pnpm add @dnd-kit/react` (the current line per [dndkit.com/react/quickstart](https://dndkit.com/react/quickstart/); pin the exact 0.x version in the lockfile). Sortable is a separate entry and not needed for S-01.
2. **Route + island:** new Astro page (e.g. `src/pages/plans/[id].astro`) loads seeded data server-side and mounts `<PlannerBoard client:load … />`.
3. **Provider:** `PlannerBoard` wraps its tree in `<DragDropProvider onDragEnd={handleDrop}>`.
4. **Palette (hints):** map `GroupingVariant[]` → cards; each card is draggable via `useDraggable({ id: groupingId, data: { courses } })` (spread the returned `ref`), styled with cva like `button.tsx`. Placed courses are *also* draggable — `useDraggable({ id: placementId, data: { course } })` — so they can be moved cell-to-cell.
5. **Grid:** render the 8×5 cells; each cell = `useDroppable({ id: `${day}:${period}`, data: { day, period } })`, spreading `ref` (use the returned `isDropTarget` for hover styling).
6. **Drop = state mutation:** in `handleDrop(event)` — guard `if (event.canceled) return`, read `event.operation.source` and `event.operation.target`. If source is a grouping → insert one course placement per member into the target cell (bulk-drop). If source is a placed course → move that one row to the target cell. **Accept-and-flag:** always apply the change; never reject.
7. **Validate reactively:** collision state is derived from placement state per cell — for each affected cell, run `hasIntersection` across its occupants and flag the conflicting courses. Recomputed on every drop/move/remove, so moving a course out auto-clears a flag.
8. **Hours counter (read-only):** derive `placed = rows for (course, variant)` vs `course.hours_per_week` and show "placed / required" on each palette card (and optionally a "courses incomplete" tally). Same reactive derivation as collision; no enforcement in S-01.
9. **Persist:** optimistically apply to local state, then `POST /api/placements` (insert/move) or `DELETE` (remove) on a new route mirroring `grouping.ts`; reconcile on error. Flagged (colliding) and incomplete placements persist too — valid draft state, gated only at finalize (Q9).

## Historical Context (from prior changes)

- `context/changes/port-grouping-algorithm/` — landed the grouping engine (`src/lib/grouping/**`) that produces the draggable cards; its `GroupingResult` shape is the palette's data contract. (Recent commits cc1fc37 / b159a3e / f491666 / f5c0fe5.)
- `context/changes/minimal-domain-schema/` — landed the Supabase schema incl. `placements`, `plan_variants`, `course_groupings`; defines the drop target's persistence shape.
- `context/foundation/roadmap.md:119` (S-01) — scopes this slice to the **student-collision class only**, with pre-seeded `course_groupings` loaded manually for the north-star demo.
- `context/foundation/lessons.md` — "Port the mechanism, not the legacy type shape" applies to the drag payload (carry ids, resolve names at the edge).

## Related Research

- `context/changes/port-grouping-algorithm/research.md` — prior exploration of the grouping/collision core this UI consumes.

## Open Questions

1. **Drop UX policy (PRD Q8) — RESOLVED.** Accept-and-flag (option b): a colliding drop lands and is flagged with its named collision class until resolved. No block, no prompt. Owner: user. Decided 2026-06-05.
2. **Collision scope — RESOLVED.** Per-cell: a student collision is two of a student's courses in the same `(day, period)`, checked across all occupants of that cell. Owner: user. Decided 2026-06-05.
3. **Move/placement unit — RESOLVED.** The individual course-hour (one row). Groupings are palette hints + a bulk-drop convenience only; cells are multi-occupancy. Owner: user. Decided 2026-06-05.
4. **Multi-hour handling — RESOLVED.** One placement row = one hour; drag unit = 1 hour; no schema change (uses `placements_unique` + `courses.hours_per_week`). S-01 shows a read-only "hours placed / required" counter; hard completeness enforcement is deferred to the finalize gate. Owner: user. Decided 2026-06-05.
5. **Placements API granularity (open).** Per-row REST (`POST`/`DELETE /api/placements`) vs a `replace`-style RPC (mirroring `persistGroupings`) for the bulk-drop fan-out. Lean per-row + array-insert for the fan-out for MVP simplicity. Owner: dev.
6. **Finalize gate + completeness (PRD Q9, open).** Should marking a variant *final* require **zero flagged collisions AND all `hours_per_week` placed**? Likely yes. This is where the **completeness validator** (per-course hours check, special-casing 0-hour merge-children) lands — out of S-01 scope but framed by Q8's resolution. Confirm exact gate. Owner: user.
7. **dnd-kit line — RESOLVED.** Use `@dnd-kit/react` 0.4.0 (the current, maintainer-supported line), not the legacy `@dnd-kit/core`. Pin the exact 0.x version; Pragmatic DnD is the fallback if pre-1.0 churn bites. Owner: dev.
8. **Keyboard parity (PRD Q11, non-blocking).** dnd-kit's keyboard support makes this near-free; decide whether to enable it now or defer. Owner: user.
