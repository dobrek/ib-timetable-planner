---
date: 2026-07-03T14:02:01+0200
researcher: Dobromir Kropielnicki
git_commit: 90bac5e8329bd1f7f60345fe62ef56e930f03bde
branch: main
repository: 10xdev3
topic: "Feasibility of a board highlight/discovery ('lens') feature — highlight placements by subject, teacher, or student"
tags: [research, codebase, plan-detail, board, discovery, highlight, lens, derived-state]
status: complete
last_updated: 2026-07-03
last_updated_by: Dobromir Kropielnicki
---

# Research: Board highlight/discovery ("lens") feasibility

**Date**: 2026-07-03T14:02:01+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 90bac5e8329bd1f7f60345fe62ef56e930f03bde
**Branch**: main
**Repository**: 10xdev3

## Research Question

The planner board can get densely packed — a dozen bundles hosting many subjects — making it hard to find a specific insight. Users may want to know **where all the math subjects are**, **how the plan looks from a specific teacher's perspective**, **from a specific student's perspective**, or a **combination** of both. Evaluate the feasibility of a **highlighting/discovery** feature, weighting all three lenses (subject / teacher / student) equally, and **recommend an interaction direction**.

## Summary

**A highlight/discovery lens is cheap and low-risk to build — it's a read-only, presentational overlay** that touches neither the constraint engine, the persistence/optimistic path, nor placement history. The slice already contains three near-exact templates for it (`hintMode`, `justDuplicated`, `dimmed`), and its cost sits on a memo boundary orthogonal to the <200 ms drag-drop budget.

The **feasibility verdict differs sharply by lens**, and the surprise inverts the brief's assumption:

| Lens | Verdict | Why |
|---|---|---|
| **Teacher** | ✅ **Free** — data already on the board | `catalog[].teacherKeys` already shipped to the client (powers the teacher-conflict constraint) |
| **Student** | ✅ **Free** — data already on the board | `catalog[].studentKeys` already shipped (powers the student-conflict constraint) — **not** the weak lens |
| **Subject** | ⚠️ **The real gap** | No subject taxonomy exists in schema; only a composite display-name string + optional color reach the board |

So teacher and student lenses are pure client-side filters over data **already in memory**. The subject lens is the only one that needs a data decision — ranging from a fragile name-substring heuristic (zero cost) to a cheap catalog-select addition (no schema change) to a proper IB subject-group taxonomy (schema change).

**Recommended direction** (detailed in [Recommendation](#recommendation)): a persistent **"dim-the-rest" highlight lens** — a single active `LensSelection` derived to a `Set<placementId>` in `model/`, non-matching chips faded on the existing independent opacity axis, driven from a **lens popover in the board header's `trailing` slot**. Ship **teacher + student first** (zero data work), then subject as a fast-follow once the "what is a subject?" question is answered.

## Detailed Findings

### 1. Board render tree & the chip hook point

The per-chip render unit is **`PlacedChip`**. The render chain:

```
PlannerBoard.buildColumn (packs placements/display/collisions/wiring)   PlannerBoard.tsx:144-168, 240-247
  → PlannerGrid: groupCellOccupants(placements, courseDisplay, collisions)  PlannerGrid.tsx:83-85
  → per (period × day × column) → SlotCell (occupants + dropHint/bundled/dimmed)  PlannerGrid.tsx:165-181
  → PlacedChip per occupant (flat, or split into WeekLanes for bi-weekly)   SlotCell.tsx:145-155
```

- `PlacedChip` receives `ChipWiring & { occupant: CellOccupant }` (`PlacedChip.tsx:19-29, 37-46`). `chipWiring` is a **single object shared by all chips in a cell** (`SlotCell.tsx:104`), so a **per-chip** highlight signal must ride on the per-occupant `occupant`, not on shared wiring.
- **`CellOccupant`** (`model/collision/cell-occupants.ts:15-23`) carries, per chip: `placement` (`id`, `courseId`, `day`, `period`, `week`, `bundleId`, `pending` — `model/placement/placement.ts:4-26`), `name`, `color: SubjectColor | null`, and collision flags `blocking`/`warning`/`unavailable`.
- **Ready per chip today**: `courseId`, subject `name`, `color`/tone, cohort, week. A subject/course-name/courseId predicate needs **zero new data threading**.
- **Missing per chip**: teacher, student, subject-group. These live on `GroupingCourse` (`shared/lib/catalog-hash/types.ts:18-25`: `teacherKeys`, `studentKeys`), reachable at the board but not surfaced onto `CellOccupant` (`toOccupant`, `cell-occupants.ts:47-61`, never reads catalog).

**Two data routes for teacher/student match** (see §4 for the recommended one):
- (a) enrich occupants by passing `catalogById` into `groupCellOccupants` and adding `teacherKeys`/`studentKeys` to `CellOccupant`; or
- (b) compute a `Set<courseId>` (or `Set<placementId>`) of matches once at board level and thread a per-chip boolean down — cheaper, keeps `CellOccupant` display-only. **Route (b) is recommended.**

### 2. Existing visual-state vocabulary (what a highlight would reuse)

Two independent tone layers, both pure/testable, plus a set of **independent opacity/ring axes** composed via `cn(...)` — this is the precedent a highlight follows:

- **Cell tone** — `resolveCellTone` single-tone precedence `blocking → drop-target → hint → warning → bundled → base` (`model/collision/cell-tone.ts:9,17-30`) → `toneClass(tone, hintMode)` (`grid/slot-cell/tone-class.ts:10-24`). Pinned by exact string in `tone-class.test.ts`.
- **Chip tone** — `chipToneClass({ blocking, warning, color })`, collision tones overriding subject color (`PlacedChip.tsx:136-151`).
- **Independent axes (the highlight template)**:
  - `isDragging && "opacity-60"` (cell, `SlotCell.tsx:123`), `isDragging && "opacity-50"` (chip, `PlacedChip.tsx:69`)
  - `justDuplicated && "ring-ring ring-2 ring-inset motion-safe:animate-pulse"` — one-shot highlight ring (`SlotCell.tsx:126`), driven by `useDuplicateHighlight` (`model/use-board-derivations.ts:83-95`)
  - `dimmed && "opacity-40"` — sibling-cohort recede during cross-cohort drag (`SlotCell.tsx:128`; computed `PlannerGrid.tsx:178`)

**There is no existing subject/teacher/student highlight, selection, or persistent-discovery notion on the board.** The only "emphasis" today is transient (drag/duplication-driven) or the `emphasizedId` text-bolding inside `CollisionDetailsDialog.tsx:112`. A lens would coexist cleanly on the independent opacity/ring axis, avoiding the single-tone precedence contention.

### 3. Domain-data availability — the feasibility crux

What `loadCombinedPlannerData` fetches for both cohorts (`api/load.ts:39-137`): plan, groupings, placements (`id, course_id, day, period, week, bundle_id` — `load.ts:146-151`), shelf, per-cohort **catalog** via `loadCohortCourses`, teacher availability, teacher names (`teachers → id, full_name, code`), student names (`students → id, full_name`).

The catalog projection `GroupingCourse` (`shared/lib/catalog-hash/types.ts:18-25`) carries per course:
```
{ id, teacherKeys: string[], studentKeys: string[], hours, weekMode }
```
- `teacherKeys` ← `course_teachers` junction aggregated (`shared/api/load-cohort-courses.ts:38-42, 64, 78`)
- `studentKeys` ← `student_choices`, folding in overlap-dependents and merge-children (`load-cohort-courses.ts:67, 82`)

**This catalog reaches the client** — `PlannerBoardProps.catalog: GroupingCourse[]` (`model/drag.ts:50-67`), copied per column in `assemble-combined-props.ts:43-61`, handed to the island in `PlanDetailPage.astro:24-26`. It already powers `student-conflict` (`model/collision/constraints/student-conflict.ts:26`), teacher-conflict, and cross-cohort-teacher constraints. **Teacher and student associations are therefore already serialized to the browser.**

**Schema** (`supabase/migrations/*.sql`):
- `courses` → `id, cohort, name, level, group_index, hours_per_week, week_mode, color`
- `teachers`, `students`, `student_choices (student_id, course_id)`, `course_teachers (plan_id, course_id, teacher_id)` (legacy scalar `courses.teacher_id` dropped in `20260621120001`), plus overlaps/merges/placements/groupings/shelf.
- **No subject-group / subject-area / subjects table or column exists anywhere** (grep across all migrations: none). `group_index` (smallint: "None/Group 1/2/3", `courses/lib/labels.ts:22-27`) is a **disambiguator** for same-name courses & core components (TOK/CAS) — **not** an IB subject-group taxonomy; it does not unite "Math AA" and "Math AI" under "Mathematics".

**Subject identity on the board** is only `courseDisplay[courseId] = { name, color }` (`types.ts:16`), where `name` is the **composite** string from `compositeName` (`load-cohort-courses.ts:176-181`), e.g. `"Math_AA-HL"` (name-level-group, spaces→underscores), and `color` is an author-chosen, nullable `SubjectColor`. The raw `name`/`level`/`group_index` a clean subject filter would want are in the DB and on the **courses catalog page** (`courses/api/loader.ts:22`) but **not projected onto the board**.

**Data volume** (fixtures): dp1 ≈ 26 students / 16 teachers, dp2 ≈ 35 students / ~18 teachers, ~50–85 courses per cohort; placements bounded by the grid (default 5×10 = 50 cells × 2 cohorts). Tiny — all three lenses are pure in-memory client-side filtering, no server round-trip.

**Per-lens verdict:**
- **Teacher** ✅ already on board: `placement.courseId → catalog course → teacherKeys.includes(X)`; picker options from `shared.teacherNames`. No fetch, no schema change.
- **Student** ✅ already on board: same shape via `studentKeys`; picker from per-cohort `studentNames`. No fetch, no schema change.
- **Subject** ⚠️ depends on definition:
  - *"display name contains 'Math'"* → derivable now from `courseDisplay[].name` substring, but a fragile display-string heuristic.
  - *"all 'Math AA' regardless of level"* → needs an **extra projection** (add `name`/`level`/`group_index` to the board catalog select — columns already exist and are already fetched by the courses page; **no schema change**).
  - *"all Mathematics (AA + AI, HL + SL, under one umbrella)"* → needs a **schema change** (new `subject_area` column/table) or a name-derived heuristic.

### 4. Architecture fit & performance

**State topology** — the only authoritative board state is `usePlacements` (`model/use-placements.ts:90-189`); everything downstream is derived and memoized on `placements` identity:
```
usePlacements.placements
  → dp1Index/dp2Index (useMemo)                       use-cohort-board-state.ts:75-82
  → useCohortDerivations                              use-cohort-board-state.ts:184-215
      useCollisions / useHours / useDragHints / useDuplicateHighlight   use-board-derivations.ts:30-95
  → toCohortState (pure flatten)                       use-cohort-board-state.ts:219-259
  → buildColumn → PairedColumn → PlannerGrid → SlotCell → PlacedChip
```
Ephemeral view-state already sits *beside* placements without touching them: `useExplodedCells` (a `Set`), `activeDragCohort` (`PlannerBoard.tsx:75`), `inspection` (`PlannerBoard.tsx:79`). A lens belongs in exactly this tier.

**Cost & the <200 ms budget**: A highlight predicate is **O(N), N = total placed chips** (dozens, low-hundreds worst case) — one linear pass to a matched-id `Set`, strictly cheaper than the O(occupants²)-per-cell `deriveCellViolations` (`collisions.ts:31-32`) already in the hot path. Critically, **the lens is orthogonal to the drag-drop budget**: the <200 ms budget covers a *placement mutation*; a **lens selection change mutates no placements**, so the collision/hint memos' deps are unchanged and they don't re-run. Key the lens memo `[placements, catalog, selection]` (mirroring `useCollisions`) and the two costs never stack.

**Separation of concerns — confirmed read-only**: the constraint core (`model/collision/**`, `model/cross-cohort/**`, guards in `placement/placement-transitions.ts`) consumes only `placements + catalog + availability + crossCohortIndex` — no view/selection state. The persistence/optimistic path (`usePlacements → createBoardWrites → makeRpcs → Astro Actions`) and history (`use-placements-history`, `api/placement-actions.ts`) are keyed on placements/RPCs only. A lens reads catalog metadata already present, emits a `Set`, and writes a CSS class — **no Supabase, no RPC, no history, not a constraint input** (the repo already documents `CourseDisplay` as "display-only, never a constraint input", `types.ts:12`).

**Three existing templates** (increasing fit):
- `dimmed` (sibling-cohort recede) — full control→state→derivation→render path (`PlannerBoard.tsx:75,113,119,245` → `PlannerGrid.tsx:178` → `SlotCell.tsx:128`).
- `hintMode` (persisted board-wide toggle → per-cell visual) — the closest **threading** twin: `BoardSettingsMenu` control → `useHintMode` shell singleton (`chrome/board-disclosure.ts:21`) → `CellWiring.hintMode` (`PlannerGrid.tsx:26,162`) → `toneClass(tone, hintMode)`.
- `justDuplicated` (a **derived** transient board flag in `model/`) — the "orchestration-over-patching" exemplar: `useDuplicateHighlight` (`use-board-derivations.ts:83`) → `toCohortState` → `CellWiring` → per-cell render.

**The one hard trap**: `context/foundation/ui-conventions.md` §"State management" **explicitly rejects a `BoardWiringContext`** because a shared Context re-renders *every* cell on change against the <200 ms budget. Thread the lens via the existing `{...wiring}` spread — **not** Context — and do **not** add an inline `if (occupant matches …)` branch in `SlotCell`/`PlacedChip` (the orchestration-over-patching lesson). Keep the match a derived `Set` in `model/`.

### 5. Reusable filter/search precedents

- **`useUrlSyncedFilters`** (`shared/lib/use-url-synced-filters/use-url-synced-filters.ts:12`) — SSR-safe initial → seed-once from `window.location.search` → mirror changes via `history.replaceState` (bookmarkable, **no history spam**, defaults omitted). Used by all three catalog pages (`courses`/`teachers`/`students` `model/use-catalog-filters.ts`). **Proven, but unused on the board** — the board's only URL state is `?focus=` (dp1/dp2/combined) via `CohortSwitcher` navigation (`chrome/CohortSwitcher.tsx:22-23`).
- **`CommandDialog`** (`shared/ui/command.tsx`, cmdk) — a ⌘K modal palette; **exported but zero real consumers**. Attractive as a power-user "jump/highlight" entry, but greenfield (no in-repo example).
- **`MultiSelect`** (`shared/ui/multi-select.tsx:34`) — searchable Popover + Command list with chips; the canonical "filter a domain list" idiom (`courses/ui/TeacherFilter.tsx`, `students/ui/CourseFilter.tsx`). **A single-select variant is the natural lens-value picker.**
- **`Select` / `ToggleGroup` / `Popover`** — `GroupingFilter.tsx` uses cascading `Select`s (palette filter, which **hides** rather than highlights); `ToggleGroup` (segmented control, used by `WeekToggle`) is a good "Subject/Teacher/Student" mode switch.
- **In-board control placement**: the **`PlanSummaryBar` `trailing` slot** (`PlannerBoard.tsx:219`, where `BoardSettingsMenu` already lives) is the most natural home for a lens button; `BoardSettingsMenu`'s gear→popover (`chrome/BoardSettingsMenu.tsx:20`) is the exact template. `CollapsibleEdgePanel` `toolbar`/`headerActions` slots (state survives collapse) are the alternative if the selector wants to live in the palette rail.
- **Semantics gap**: every existing narrowing surface (palette `usePaletteFilter`, all three catalogs) is **hide/filter**, not emphasize. A sticky "dim non-matches / ring matches" mode reuses the tone/opacity CSS vocabulary but needs **new selection→cell-emphasis wiring** that does not exist yet.

## Recommendation

**Interaction model: a persistent "dim-the-rest" highlight lens** (not filter/hide, not a jump-only palette).

Rationale: the user's goal is *comparative discovery on a packed board* — "where is all the math", "what does teacher X's week look like". Hiding non-matches (the palette/catalog idiom) destroys the spatial context that makes the answer meaningful; a **jump-to** palette (⌘K) answers "where is one thing" but not "show me the whole shape of X". **Dimming non-matches while keeping matches at full strength preserves the grid's structure and directly answers all three questions**, including "how does the plan look from teacher X's perspective." It also reuses the board's existing independent opacity axis (`dimmed`) rather than inventing a hide/relayout path.

**Concrete shape:**
1. **One active `LensSelection`** — a union `{ kind: "subject" | "teacher" | "student", key: string }`, empty = no lens (normal board). Ephemeral shell-level `useState` singleton in `PlannerBoard`, beside `useHintMode` (persistence deferred — see below).
2. **Match derivation** — a new pure `model/highlight.ts`: `deriveHighlight(placements, catalog, selection) → Set<placementId>`, plus a `useHighlight` memo in `use-board-derivations.ts` keyed `[placements, catalog, selection]`, exposed via `toCohortState`. Declarative `filter` per the "declarative pipelines" lesson.
3. **Visual** — per-chip: matched chip full-strength, non-matched `opacity-40` (reuse the `dimmed` vocabulary) and optionally a subtle ring on matches (reuse the `justDuplicated` ring axis). Thread `highlighted: Set<string>` + `highlightActive: boolean` on `CellWiring` via the `{...wiring}` spread; resolve per chip in `PlacedChip`. Per-chip (not per-cell) because a cell can hold multiple subjects/teachers.
4. **Selector UI** — a **lens popover** in the `PlanSummaryBar` `trailing` slot (next to the settings gear): a `ToggleGroup` for kind (Subject/Teacher/Student) + a searchable single-select (Command-in-Popover, the `MultiSelect` pattern narrowed to one value) for the entity. Options: teachers from `shared.teacherNames`, students from per-cohort `studentNames`, subjects from the catalog (see phasing).

**Phasing:**
- **Phase 1 — Teacher + Student lenses.** Zero data work (both key-sets already on the board), full dim-the-rest visual, popover selector, ephemeral state. Delivers 2 of 3 lenses on the cheapest possible architecture.
- **Phase 2 — Subject lens.** Cheapest viable = project `name`/`level`/`group_index` onto the board catalog (no schema change) and match by raw subject name/level. Decide the subject definition first (open question below).
- **Phase 3 — combination + persistence (optional).** Support AND-combination lenses (e.g. teacher X *and* student Y — the "combination of both" from the notes; `deriveHighlight` takes a criteria list, architecturally trivial). Add `useUrlSyncedFilters` for shareable `?lens=teacher:t123` links (matches the `?focus=` precedent) and/or a ⌘K `CommandDialog` power-user entry that sets the same selection.

## Code References

- `src/_pages/plan-detail/ui/PlannerBoard.tsx:75,113,119,144-168,219,240-247` — shell state, `buildColumn`, `trailing` slot, grid handoff
- `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx:26,83-85,162-181` — `CellWiring`, `groupCellOccupants`, per-cell render
- `src/_pages/plan-detail/ui/grid/slot-cell/SlotCell.tsx:104,122-128,145-155` — shared `chipWiring`, independent opacity/ring axes, chip render
- `src/_pages/plan-detail/ui/grid/slot-cell/PlacedChip.tsx:19-46,64-70,136-151` — chip props, class composition, `chipToneClass`
- `src/_pages/plan-detail/model/collision/cell-occupants.ts:15-23,31-45,47-61` — `CellOccupant` shape; `groupCellOccupants`/`toOccupant` (no catalog today)
- `src/_pages/plan-detail/model/use-placements.ts:90-189` — authoritative board state
- `src/_pages/plan-detail/model/use-board-derivations.ts:30-95` — memoized derivations (`useCollisions`/`useDragHints`/`useDuplicateHighlight`)
- `src/_pages/plan-detail/model/use-cohort-board-state.ts:75-82,184-259` — derivation orchestration + `toCohortState`
- `src/_pages/plan-detail/api/load.ts:39-137` — board data load
- `src/shared/api/load-cohort-courses.ts:38-42,64-82,176-181` — `teacherKeys`/`studentKeys`/`compositeName`
- `src/shared/lib/catalog-hash/types.ts:12,16,18-25` — `CourseDisplay` (display-only) / `GroupingCourse` (teacher/student keys)
- `src/_pages/plan-detail/model/drag.ts:38-67` — `SharedBoardProps`/`PlannerBoardProps` (catalog reaches client)
- `src/_pages/plan-detail/model/collision/constraints/student-conflict.ts:26` — proof `studentKeys` is live on the board
- `src/shared/lib/use-url-synced-filters/use-url-synced-filters.ts:12` — URL-sync hook (unused on board)
- `src/shared/ui/command.tsx`, `src/shared/ui/multi-select.tsx:34`, `src/shared/ui/toggle-group.tsx:48` — selector primitives
- `src/_pages/plan-detail/ui/chrome/BoardSettingsMenu.tsx:20`, `PlanSummaryBar.tsx:31,45` — control-placement template
- `supabase/migrations/20260602185012_minimal_domain_schema.sql`, `.../20260620120000_*` (course_teachers), `.../20260621120001_*` (drop teacher_id) — schema; **no subject taxonomy**
- `src/_pages/courses/lib/labels.ts:22-27` — `group_index` is a disambiguator, not IB groups

## Architecture Insights

- The slice draws a clean, enforced line between **constraint inputs** (placements + catalog + availability) and **display/view state** (`CourseDisplay`, ephemeral toggles). A lens lands entirely on the display side — this is why it's cheap and cannot regress the constraint budget.
- The board already has a **repertoire of independent visual axes** (`opacity` for dragging/dim, `ring` for duplicate-pulse) composed via `cn(...)` *outside* the single-tone precedence. A highlight is a fourth axis, not a change to tone.
- **The "orchestration over patching" lesson and the ui-conventions Context rejection converge on one design**: derived `Set` in `model/`, threaded via `{...wiring}` spread. Both anti-patterns (inline `if`, Context) are pre-codified against.
- **The data asymmetry is counter-intuitive**: teacher/student (relational, seemingly heavier) are *free* because the constraint engine already needs them; subject (seemingly simple, "just a name") is the gap because there is no subject taxonomy and only a composite display string reaches the board.

## Historical Context (from prior changes)

- `context/foundation/lessons.md` — **"Prefer declarative pipelines over imperative accumulator loops"** applies directly to `deriveHighlight` (express the match as `filter`, not a mutable-accumulator loop). **"Use semantic theme tokens"** applies to the dim/ring classes (reuse `opacity-*` + `ring-ring`/token rings, no palette colors). **"Guard localStorage with try/catch"** applies *only if* Phase 3 persists the lens to localStorage (the recommendation defaults to ephemeral, sidestepping it).
- The `hintMode`, `justDuplicated`, and `dimmed` mechanisms (all in the current slice) are the direct implementation precedents; no prior *change folder* covers discovery/highlight — this is greenfield behavior on a mature board.

## Related Research

- None found under `context/changes/**/research.md` or `context/archive/**/research.md` for board discovery/highlight. Adjacent prior work lives in the `architecture-refactor` (FSD + Actions transport) and `astro-migration-to-v7` archives, but neither touches this surface.

## Open Questions

1. **What does "all math" mean?** (blocks Phase 2 scope)
   - (a) display-name substring — zero cost, fragile;
   - (b) raw subject name/level — cheap catalog-select addition, no schema change;
   - (c) IB subject-group umbrella (Mathematics = AA + AI, HL + SL) — needs a `subject_area` schema addition.
   This is a **framing/product decision** — a good candidate for `/10x-frame` before planning Phase 2.
2. **Single active lens vs. combination in v1?** The notes explicitly mention "a combination of both" (teacher + student). Recommendation defers AND-combination to Phase 3, but if it's a core use case it should be designed into `LensSelection` from Phase 1 (it's architecturally cheap — a criteria list — but adds selector-UI complexity).
3. **Should the lens persist / be shareable?** Ephemeral is recommended for v1 (plan-scoped, exploratory). If a shareable "here's teacher X's lens" link is wanted, `?lens=` via `useUrlSyncedFilters` mirrors the `?focus=` precedent; a plan-scoped cookie is the alternative if flash-free SSR persistence (not sharing) is the goal. localStorage is the **wrong** tier (device-wide, not plan-scoped).
4. **Combined-surface (`?focus=combined`) behavior?** Confirm the lens should dim across both cohort columns simultaneously (the derivation is per-cohort but the selection is shell-level, so this is a wiring choice, not a data problem).
5. **Accessibility of "dim":** opacity-only emphasis is weak for low-vision users; consider pairing the ring on matches (not just fading non-matches) and/or a count badge ("12 placements match") so the signal isn't purely chromatic.
