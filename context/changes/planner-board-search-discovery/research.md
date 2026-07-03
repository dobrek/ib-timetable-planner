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
last_updated_note: "Added follow-up: UI direction (fake-input trigger + ⌘K, anchored popover, live preview); scope board-only; subject = course (Q1); OR-union multi-select in v1 (Q2); active-lens bar for criteria visibility"
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

> **Update 2026-07-03 (`board-view-state-store`)** — the directive above still holds (spread, no Context, no inline `if`), but its *rationale* is corrected. The `<200 ms budget` framing is the wrong reason: a lens selection mutates no placements, so it is orthogonal to the drag-drop budget (see "Cost & the <200 ms budget" above), and the premise it leaned on — `dropHints`/`hintMode` changing "on every drag tick" — is false (`dropHints` is set once at drag start and cleared at drag end; `hintMode` changes on user toggle). The reason a `BoardWiringContext` is still rejected is **broadcast fan-out**: any change to a shared Context value re-renders *every* consumer regardless of the slice it reads (React Compiler memoization does not shrink this), whereas the `{...wiring}` bundle removes the actual authoring pain — re-listing the fields at every hop — without that fan-out. Full evidence: `context/archive/2026-07-03-board-view-state-store/frame.md`. The rewritten rule (Context-vs-store semantics split + adoption-trigger checklist, with this lens as its worked example concluding "spread"): `context/foundation/ui-conventions.md` §"State management".

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

   > **Resolved 2026-07-03** — none of (a)/(b)/(c): **subject = course** (match by `courseId`, picker from `courseDisplay`). Cheaper than all three options; see "Follow-up Research 2026-07-03T18:51 — Subject = course".
2. **Single active lens vs. combination in v1?** The notes explicitly mention "a combination of both" (teacher + student). Recommendation defers AND-combination to Phase 3, but if it's a core use case it should be designed into `LensSelection` from Phase 1 (it's architecturally cheap — a criteria list — but adds selector-UI complexity).

   > **Resolved 2026-07-03** — combination ships in v1 as **OR-union multi-select**; the AND reading was wrong ("in the search taxonomy there is always OR, not AND"). See "Follow-up Research 2026-07-03T18:51 — Combination semantics".
3. **Should the lens persist / be shareable?** Ephemeral is recommended for v1 (plan-scoped, exploratory). If a shareable "here's teacher X's lens" link is wanted, `?lens=` via `useUrlSyncedFilters` mirrors the `?focus=` precedent; a plan-scoped cookie is the alternative if flash-free SSR persistence (not sharing) is the goal. localStorage is the **wrong** tier (device-wide, not plan-scoped).
4. **Combined-surface (`?focus=combined`) behavior?** Confirm the lens should dim across both cohort columns simultaneously (the derivation is per-cohort but the selection is shell-level, so this is a wiring choice, not a data problem).
5. **Accessibility of "dim":** opacity-only emphasis is weak for low-vision users; consider pairing the ring on matches (not just fading non-matches) and/or a count badge ("12 placements match") so the signal isn't purely chromatic.

## Follow-up Research 2026-07-03T18:40+0200 — revisited after `board-view-state-store`

**Trigger**: the sibling change `board-view-state-store` — spawned directly from this research's §4 trap note, archived same day to `context/archive/2026-07-03-board-view-state-store/` — rewrote the state-management convention this research leaned on. The change was **docs-and-comments only, zero runtime change**: the only source edit since this research's snapshot (`90bac5e`) is the comment-only `PlannerGrid.tsx` docblock. Everything below verified at `f91d65c`.

### What the change concluded (and did not do)

- **No store was introduced.** The change set out to challenge the no-Context/no-store rule; its frame **refuted the store remedy at its own scope** — a selection-only store saves ~1 of ~8 chain edit sites, on a page that mounts a single island (`PlanDetailPage.astro:29`) — and relocated the real per-flag authoring cost (~15 edit sites across ~6–7 files) to three centers *outside* the transport: persistence-module cloning (five ~50-line `lib/` micro-stores), control-surface widening, and derivation-seam plumbing (`context/archive/2026-07-03-board-view-state-store/frame.md`, Narrowing Signals).
- `ui-conventions.md` §"State management" was rewritten from a categorical ban into: a **Context vs. selector-store semantics split** (broadcast vs. granular; `ui-conventions.md:223`), an **adoption-trigger checklist** (4 triggers, none met by today's board; `ui-conventions.md:225-234`), a **lane-choice rule** for new board flags (`ui-conventions.md:236-245`), the named cost centers (`ui-conventions.md:249-251`), and — directly relevant here — **this lens as the worked example, concluding "thread it via the spread, no Context, no store"** (`ui-conventions.md:253-255`).
- A new lesson landed: **"A convention that cites a code mechanism is coupled to it"** (`context/foundation/lessons.md`) — applies-to includes *research*: verify cited symbols by grep, not memory; prefer invariant rationale over mutable measurements.

### Impact on this research

1. **The recommendation is now normatively pinned, not merely advised.** §4's directive (derived `Set` in `model/`, threaded via `{...wiring}`, no Context, no inline `if`) is unchanged, but it is no longer this document's argument alone — it is the convention's own worked-example verdict, reached by checklist. The next "should the lens be a store?" debate is closed by `ui-conventions.md`, not re-litigated here.

2. **The Recommendation's concrete shape conforms to the new lane-choice rule, lane by lane** (the rule postdates the recommendation, so this is worth stating explicitly):

   | Recommendation element | Lane (`ui-conventions.md:236-245`) | Precedent |
   |---|---|---|
   | `deriveHighlight` + `useHighlight` memo → `toCohortState` (item 2) | per-cohort derived data → derivation pipeline | `dropHints`, `justDuplicated` |
   | `highlighted: Set` + `highlightActive` on `CellWiring` (item 3) | consumed per-cell/per-chip → `CellWiring` field | `hintMode` |
   | `LensSelection` ephemeral shell `useState` (item 1) | no persistence lane needed — ephemeral shell state beside `inspection`/`activeDragCohort` | — |
   | Phase 3 `?lens=` via `useUrlSyncedFilters` | deliberately **not** the persisted-device-preference lane (no `lib/` micro-store) | `?focus=` |

3. **Effort calibration sharpened.** A new cell-reaching flag costs **~15 edit sites** — a concrete prior for `/10x-plan`. The v1 lens avoids cost center 1 entirely (ephemeral — no sixth `lib/` micro-store) but pays center 3 (derivation-seam plumbing — note the full seam is `use-board-derivations.ts → useCohortDerivations → toCohortState → useCombinedBoardState`; §4's pipeline sketch omitted `useCombinedBoardState`) and a slice of center 2 (a new bespoke lens-popover control in the `trailing` slot). The "cheap and low-risk" verdict stands; the plan should still budget ~6–7 files for wiring alone.

4. **Open Question 3 (persistence) is sharpened, not resolved.** Device-persisting the lens via a `lib/` micro-store would be the **sixth** ~50-line clone — adoption trigger 3 is explicitly "watch it" at five (`ui-conventions.md:231,234`), so that route would activate the store-consolidation debate. URL-sync (`useUrlSyncedFilters`) remains the recommended shareable option and sidesteps the trigger entirely; localStorage goes from "wrong tier" to also trigger-adjacent.

5. **Sequencing constraint for the plan.** The archived change deliberately opened no follow-up folder: consolidation of the three cost centers is deferred **until after this lens lands**, because "the lens reshapes what's worth consolidating" (`context/archive/2026-07-03-board-view-state-store/change.md`, §Follow-up recommendation). Implication for `/10x-implement`: build the lens along the existing per-flag patterns without generalizing the seams; a post-lens consolidation change may follow and will want the lens as evidence.

6. **Citation re-pin (drift check per the new lesson).** All code references above were re-verified at `f91d65c`; only `PlannerGrid.tsx` shifted (docblock grew from lines 17-25 to 17-29, net +4 below it):
   - `PlannerGrid.tsx:26` (`CellWiring`) → now **:30**
   - `PlannerGrid.tsx:83-85` (`groupCellOccupants`) → now **:87-89**
   - `PlannerGrid.tsx:162-181` (per-cell render) → now **:166-185** (`hintMode` at :177)
   - `PlannerGrid.tsx:178` (`dimmed`) → now **:182**
   All other cited files are unchanged (git-confirmed: the docblock is the only source change since `90bac5e`).

7. **Link fix (in place).** The §4 addendum's `frame.md` pointer was written before the change was archived; it and the identical pointer in `ui-conventions.md:251` were updated to the `context/archive/2026-07-03-...` path — the archive move had left both pointing at a deleted `context/changes/` path, the exact drift class the new lesson names.

### What did not change

All five Open Questions remain open (Q3 sharpened). The per-lens data verdicts (§3), the subject-taxonomy gap, the dim-the-rest interaction model, and the three-phase plan are untouched — the sibling change altered the *rulebook and the rationale*, not the board.

### Related research (update)

- `context/archive/2026-07-03-board-view-state-store/` — `frame.md` (four-hypothesis investigation; transport refuted, stale-doc confirmed) and `change.md` (deferred cost-center consolidation follow-up). The first change directly downstream of this research, and the reason §4's rationale was corrected.

## Follow-up Research 2026-07-03T18:51+0200 — UI interaction direction (design conversation)

Outcome of a design discussion on the lens UI. This refines Recommendation item 4 (selector UI); items 1–3 (state shape, derivation, visual threading) are unchanged.

### Decided direction

**Entry pattern: a search-input-lookalike trigger + ⌘K, one shared picker.** The trigger in the `PlanSummaryBar` `trailing` slot (next to the settings gear, `PlannerBoard.tsx:219`) *looks* like a search input — magnifier icon, placeholder ("Highlight subject, teacher, student…"), a `⌘K` kbd hint — but **is a `<button>`**, not a real `<input>` (announced honestly as a button; no focus-trap ambiguity). Clicking it and pressing ⌘K open the identical picker driving the same `LensSelection` — two entries, one state, no divergent code paths. This is the widely-recognized fake-input pattern (GitHub header search / Algolia DocSearch / Linear), chosen for three properties:

1. **Self-teaching** — the trigger advertises the feature and its shortcut in one element.
2. **Trigger shows a compact active state** (filled treatment + `N criteria`); the full criteria breakdown lives in the **active-lens bar** (see below) — with multi-criteria unions the trigger alone cannot show the selection without truncating it.
3. **Keyboard/mouse convergence** — ⌘K is viable because the page mounts a single island (global keydown in the board shell is a few lines).

**Picker shape: anchored popover with live preview (recommended over centered dialog).** The canonical pattern uses a centered `CommandDialog`, but a *highlighting* feature wants the board visible while browsing: an anchored popover (per the `BoardSettingsMenu` precedent) enables **preview-on-navigate** — arrowing through candidates dims/rings the board in real time; Enter commits what is already visible. The lens derivation (one linear pass to a `Set`, §4) makes per-keystroke preview effectively free. The centered `CommandDialog` remains the fallback if the trailing-slot geometry makes the popover cramped — it loses only the preview, not the pattern.

**Selection model: one unified search list grouped by kind, multi-select.** A single cmdk `Command` list with Subjects / Teachers / Students `CommandGroup` sections and **checkable items** — the literal `MultiSelect` idiom (`shared/ui/multi-select.tsx:34`), not a single-select narrowing of it. Typing "math" or "smith" answers directly without first declaring the kind; volumes are trivial (~85 courses / ~18 teachers / ~35 students per cohort). Multi-select's stay-open-on-select behavior pairs with live preview: check items and watch the board's union grow. Kind-toggle-first is the fallback if the grouped list reads noisy in practice.

**Visual (reaffirmed with a11y additions):** dim non-matches (`opacity-40`, the `dimmed` vocabulary) **plus** a ring on matches (`justDuplicated` axis — disambiguates mixed cells and is a non-chromatic signal) **plus** a match count on/near the trigger ("12 placements") — which also covers the zero-match empty state, where the whole board dims and would otherwise read as broken.

**Scope: board-only (decided 2026-07-03).** The lens highlights **placed elements only** — it does not reach the shelf or the palette rail. This keeps v1 entirely inside the `CellWiring`/derivation path (`deriveHighlight` runs over placements only; shelf and palette rendering are untouched), and the match count reads unambiguously as *placed* chips. Unplaced courses stay discoverable through the existing palette filters and courses-left info; if a plan-wide "including unplaced" view is ever wanted, it is a scope extension to evaluate then, not a v1 concern.

**Subject = course (decided 2026-07-03; resolves Open Question 1).** A "subject" in the lens is **a course** — the catalog entity planners already see on chips (the composite name, e.g. `Math_AA-HL`) — not a name substring and not an IB subject-group umbrella. This **flips §3's Subject verdict from "⚠️ the real gap" to "✅ free"**, and makes it the cheapest of the three lenses: the match predicate is `placement.courseId === selection.key` (no catalog lookup at all — `courseId` is already on every `CellOccupant`), and the picker options come from `courseDisplay` (`courseId → { name, color }`), already on the client. **No schema change, no catalog-select addition, no name heuristics.** Consequences:
- **The phasing collapses**: Phase 2 no longer exists as a data phase — all three lenses ship on data already in memory, so v1 can deliver Subject + Teacher + Student together.
- The course lens is inherently **per-cohort** (a course belongs to dp1 or dp2), unlike the teacher lens which can span both columns — this folds into the existing combined-surface wiring question (Open Question 4), not a data problem.
- "All math HL at once" is expressed by **multi-selecting the individual math HL courses** (union — see Combination semantics below), not by a taxonomy.

**Combination semantics: OR-union, multi-select in v1 (decided 2026-07-03; resolves Open Question 2).** Multiple criteria are always combined with **OR** — a placement matches if it satisfies *any* active criterion — never AND. (The research's earlier reading of "combination of both" as intersection, deferred to Phase 3, was wrong; the acceptance scenario is: *"all math high-level courses, OR courses teacher KK is assigned to, OR courses student ABC is assigned to"*.) Consequences:
- `LensSelection` is a **criteria list from v1**, matches = union of per-criterion `Set`s — `deriveHighlight(placements, catalog, criteria) → Set<placementId>`, O(N × criteria), cheaper than intersection and still one linear pass per criterion.
- **Multi-select is v1 scope, not Phase 3** — "all math HL courses" is only expressible by checking several courses; a single-active-lens v1 fails the scenario. Mixed kinds union freely (courses ∪ teacher ∪ student).
- **Uniform emphasis across criteria** in v1 — one ring/dim treatment for the whole union; per-criterion ring colors would fight the subject colors already on chips.
- The Phase-3 "＋ add criterion" affordance is dissolved — the multi-select list *is* the criteria builder. There is no AND mode anywhere.

**Active-criteria presentation: an active-lens bar (recommended 2026-07-03).** When the popover closes with criteria active, awareness of *what the highlight is about* is carried by a slim **active-lens bar** under `PlanSummaryBar` — the "applied filters" pattern — rendered only while criteria exist. For the acceptance scenario:

```
🔍 [▦ Math_AA-HL ·4 ×] [▦ Math_AI-HL ·2 ×] [👤 KK ·6 ×] [🎓 ABC ·8 ×]   14 placements · Clear all
```

- **Kind-labeled chips**: each criterion chip carries a kind icon; course chips reuse their `SubjectColor` swatch (visual continuity with the board chips they light); teacher/student chips stay neutral. A bare `KK` would be ambiguous.
- **Per-criterion counts**: the derivation computes per-criterion sets before unioning, so counts are free; `ABC ·0` explains an empty contribution. The union total (≤ sum, overlap) sits at the bar's end and doubles as the zero-match message slot.
- **Interactions**: per-chip `×` removes live; `Clear all`; clicking a chip body reopens the popover for editing; Esc-clears-all unchanged.
- **Placement/cost**: shell-level component beside `PlanSummaryBar` reading the same `LensSelection` — nothing new threads through the grid wiring; spans both cohort columns on the combined view; rides the sticky header chrome. Trade-off: ~36px vertical while active — accepted over an unexplained dimmed board.
- Rejected alternatives: chips inside the trigger (truncates to `+N` at exactly the multi-criteria sizes that need visibility), hover tooltip (fails touch/discoverability), count-only (fails the awareness requirement).

### Implementation anchors

- `shared/ui/command.tsx` — `Command*` primitives and `CommandDialog` (still zero consumers); the popover route composes `Command` inside `Popover` per the `MultiSelect` idiom (`shared/ui/multi-select.tsx:34`).
- `PlanSummaryBar` `trailing` slot (`PlannerBoard.tsx:219`) — trigger home; `BoardSettingsMenu` is the anchoring template.
- **Esc layering** — first Esc closes the picker; a second Esc (picker closed) clears the active lens; take care not to fight the Dialog/Popover built-in Esc handling.
- **Shortcut collision check** — undo/redo shortcuts are already claimed (`editing-undo-redo` change); verify ⌘K is free rather than assuming.
- Trigger needs more trailing-slot width than an icon button — compact form (icon + "Search" + kbd), icon-only collapse on narrow viewports.

### Still open (carried forward)

- ~~**Palette/shelf reach**~~ — **decided board-only** (see Scope under Decided direction above).
- **Chip-anchored entry** ("highlight all like this" from a placed chip) — endorsed as the first fast-follow, not v1; sets the same `LensSelection`.
- ~~**Multi-criteria UI**~~ — **resolved: OR-union multi-select in v1** (see Combination semantics above); no AND mode, no separate criteria-builder affordance.
- ~~Open Question 1 (subject definition)~~ — **resolved: subject = course** (see Decided direction above).
- Open Questions 4 (combined-surface behavior) and 5 (a11y beyond ring+count) remain as stated.
