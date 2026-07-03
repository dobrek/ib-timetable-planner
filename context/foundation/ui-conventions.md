# UI conventions

Conventions established by the courses module refactor (`src/_pages/courses/`). Use as input when planning similar work in other page slices.

## Design goals

1. **Hooks span independent behavioral flows — not hide implementation.** A hook groups state and actions that depend on each other into one semantic unit. The convention test ("would changing one flow break the other?") decides boundaries. A monolithic hook that swallows everything (e.g. `usePlannerBoard` returning a bag of state) is an anti-pattern — it hides the orchestration that *is* the component's job.

2. **Declarative, orchestrating, easy-to-read functional code.** Components and hooks should read as recipes: guard → act → reconcile. Extract pure domain logic (guards, state transitions) to testable `model/` functions. Hooks orchestrate React state and async side effects over those pure functions. The complexity budget lives in `model/`; the hook is glue.

## File ordering (newspaper rule)

Every component file reads top-down from **what** to **how**:

1. Imports
2. Types (props, etc.)
3. **Exported component** — destructures hooks, renders declarative JSX
4. **Private behavior hooks** — state, effects, memos, action handlers
5. **Private sub-components** (if any) — tightly coupled presentational children
6. **Module-level constants / lookup tables and pure helpers** — at the file **bottom**, after the sub-components

Open the file, see the component shape immediately; scroll down only for implementation detail. Function declarations are hoisted, so hooks defined below the component are valid.

The trailing-constants rule (item 6) documents an existing slice norm, not a new one: `HINT_CLASS`/`toneClass` (`ui/slot-cell/tone-class.ts`) and `PLUGINS` (`PlannerBoard`) already sit at the bottom of their files. `const`-bound pure helpers (`mergeRefs`, `stopDrag`) follow the same rule.

## Hook granularity

**One hook per independent behavioral flow** — not one hook per file, and not one hook to mechanically move `useState` out of sight.

- Group state and actions that depend on each other into one hook with a clear domain boundary.
- Separate flows that don't share state get separate hooks — even when they live in the same component file.
- **Test**: would changing one flow break the other? If not, separate hooks.
- **Anti-pattern**: a single hook that returns everything the component needs, hiding wiring the orchestrator should make visible.

### Per-cohort state unit vs orchestration bag (amendment — `plan-detail-refactor`)

The bag-hook anti-pattern (a `usePlannerBoard` that hides the board's orchestration) still holds — but a **per-cohort derived-state unit is not a bag**. `useCohortBoardState(props, seed, fresh)` assembles ONE cohort's placement state + derivations (collisions, hours, drag-hints, exploded/duplicate state) into a `CohortBoardState`; the combined view already relies on it twice (one per column), and the single board calls it once with its static index as both seed and fresh. The distinction:

- **Per-cohort state unit (fine):** scoped to one cohort's *derived data*, returns a flat state shape + an `actions` record, and is composed by an orchestrator that keeps its **own** drop dispatch, disclosure (palette/shelf/hint-mode), and inspection visible at the component level. The orchestration the board *is* responsible for stays in the board.
- **Orchestration bag (bad):** a hook that also swallows the drop dispatch, disclosure, and inspection — collapsing the board to `const everything = usePlannerBoard()` and hiding the wiring that is the component's job.

So `PlannerBoard` destructures the per-cohort unit but keeps `handleDrop`, the disclosure hooks, and `useCollisionInspection` in the component body — the board reads as orchestration, not a façade.

Example: `MergeManageDialog` uses `useMergeHoursForm` (RHF submit) and a `useConfirmAction` instance (destructive action) as two hooks, not one combined hook. `PlannerBoard` uses `usePlacements`, private `useCollisions`, and private `useHours` as three hooks — not one `usePlannerBoard`.

## Hook placement

| Hook kind | Placement | Naming |
| --- | --- | --- |
| Shared across components (filters, dialog coordination) | `model/use-<concept>.ts` (exported) | `useCatalogFilters`, `useCatalogDialogs` |
| Private to one component (form, action) | Same file, below the component (unexported) | `useCourseForm`, `useDissolve` |

Promote a co-located hook to `model/` only when a second consumer appears.

## Declarative components

- Components are **declarative JSX templates**: no `useState`, `useEffect`, `useMemo`, or async handlers in the component body.
- **Simple prop transforms** are allowed inline: `const noTeachers = teachers.length === 0`, `.map().filter()` derivations with no state.
- **dnd-kit integration extracts to a named private hook** below the component (like any behavioral flow), e.g. `useCellDnd` in `ui/slot-cell/SlotCell.tsx` owns the `useDroppable`/`useDraggable` calls and the merged ref — so the body holds no raw `useMemo`/`useState`. `GroupingBox`/`PlannerBoard` still inline their dnd hooks and `PlannerBoard.weekModeByCourseId` is still an inline-body memo; these are flagged for the same extraction when next touched (not forced by this rule).

## File naming

| File exports | Naming |
| --- | --- |
| React component | PascalCase matching the export: `CourseTable.tsx` |
| Hook, types, pure logic | kebab-case: `use-catalog-filters.ts` |

## One exported component per file

- One default export per `ui/` file.
- Private children (`OverlapBadge`, `CourseRowActions`) stay unexported inside their parent file when tightly coupled.

## Folder-with-barrel graduation (cohesion test)

A `ui/` component graduates from a single file to a **folder-with-pure-barrel** when it has **3+ private sub-components serving *unrelated* concerns**, *or* it exceeds ~250 lines **and** its children are not one cohesive concern. The folder keeps one public surface: `index.ts` is a pure barrel re-exporting only the default (`export { default } from "./SlotCell";`). Mirrors the existing `model/constraints/` barrel idiom; `ui/slot-cell/` is the worked example (orchestrator + `PlacedChip`/`WeekLane`/`WeekToggle` + `tone-class`/`drag-inert`).

The cohesion qualifier is load-bearing — it is a cohesion test, not a raw line/child count. Files whose children serve **one** concern are **not** flagged even past the thresholds: `CollisionDetailsDialog` (257 lines, 4 children — all "render one violation") and `PlannerBoard` (private hooks, one orchestration concern) stay single-file.

### Multi-public feature folder (amendment — `plan-detail-refactor`)

The single-default-barrel form above is for **one orchestrator + private children**. A second, *peer* form is blessed for **feature folders that expose several sibling components to the rest of the slice**. When a `ui/` segment grows past a flat root into intent-named folders — e.g. `plan-detail/ui/` split into `palette/`, `grid/`, `overlay/`, `chrome/` — each folder owns a cohesive set of components and keeps a pure barrel that re-exports its **multiple public entries by name**:

```ts
// ui/palette/index.ts
export { default as PlannerPalette } from "./PlannerPalette";
export { default as CombinedPalettePanel, type PaletteCohortData } from "./CombinedPalettePanel";
export { default as ComputeGroupingsEmptyState } from "./ComputeGroupingsEmptyState";
export { default as GroupingStalePanel } from "./GroupingStalePanel";
```

The folder's internal-only pieces (the palette's `GroupingBox` / `GroupingFilter` / `PaletteCourseChip` / `HoursCounter`) are deliberately **omitted** — their absence documents the boundary. This mirrors the `model/constraints/` multi-named-export barrel. The single-default-barrel form (`slot-cell/`) and this multi-public form (`palette/`) coexist; pick by whether the folder exposes one public component or several. Folder names stay distinct from any single dominant export so `fsd/repetitive-naming` / `fsd/ambiguous-slice-names` stay quiet.

## Role + ARIA as the interactive/grid contract

Interactive and grid components must carry roles + accessible names sufficient for **role-based e2e** (the e2e suite selects by role + name, never CSS/`data-*`):

- A timetable *is* a grid: `role="grid"` (+ `aria-label`), `role="row"` (use `display:contents` so the row wrapper stays out of the CSS-grid box model), `columnheader`/`rowheader`, and `gridcell`s with accessible names — **named even when empty** so an empty drop target is still locatable.
- **User-perceivable state is expressed via ARIA**, asserted on the role-located element: `aria-invalid` (collision/blocking), `aria-checked` (the A/B `ToggleGroup type="single"` → `radiogroup`/`radio`), `disabled` (pending). These carry to assistive tech *and* to Playwright.
- **`data-*` is for component identity only** (`data-slot`) — never the test contract. Stateful/coordinate `data-*` (`data-collision`, `data-day`, …) is removed; ARIA + accessible names are the single source of truth.
- **Visual-only logic** (tone precedence, hint encoding, ring colors) is **unit-tested** (`model/cell-tone`, `ui/slot-cell/tone-class`, `model/drop-hints`), not e2e-asserted; e2e asserts the *outcome* (placement landed/rejected), not the intermediate coloring.

## Root page component

The page island root (`CourseCatalog`) is a **thin orchestrator**:

- Owns prop-seeded local state when needed (e.g. optimistic `courses` copy).
- Destructures shared hooks from `model/`.
- Wires props to child components and dialogs.
- No inline business logic beyond simple prop transforms.

## Shared lookups

Compute shared derived data once at the orchestrator level (e.g. `coursesById` in `useCatalogDialogs`) and pass down as props. Avoid rebuilding the same `Map` in multiple children.

## Shared helpers

Extract duplicated non-domain utilities to `lib/` within the slice (e.g. `lib/labels.ts` for display formatting). Promote to `shared/lib/` or `shared/ui/` only when a second slice needs the same helper — that is how `NumberField`, `MultiSelect`, `submitForm`, and `useUrlSyncedFilters` got there.

## Dialog contract

Every dialog exposes intent-named **`onClose: () => void`** and adapts to Radix internally:

```tsx
<Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
```

Catalog wiring stays declarative — `onClose={dialogs.closeForm}` — with no inline `(open) => …` adapters. Internal cancel buttons and success paths call `onClose()` directly.

## Form typing (Zod ↔ RHF)

The schema is the single source of both types; never hand-write a form-values type or cast a resolver:

```ts
export type CourseFormValues = z.input<typeof courseInput>; // what the form holds (pre-transform)
export type CourseInput = z.output<typeof courseInput>;     // what submit/actions receive

useForm<CourseFormValues, unknown, CourseInput>({ resolver: zodResolver(courseInput) });
```

`handleSubmit` then hands `z.output` values to the submit callback.

## Submit & confirm flows

The mutation flow is standardized in `@/shared/lib/forms` (deep import — see the Vitest rule below):

- `submitForm({ call, setError, conflictField?, conflictCodes?, successMessage, onClose })` — input errors land on their fields, conflict-coded errors land inline on `conflictField` (e.g. `"code"` for teachers, `"name"` for courses; MergeBuilder maps `["CONFLICT", "BAD_REQUEST"]` onto `childCourseIds`), anything else toasts; success toasts, closes, `refreshPage()`.
- `useConfirmAction(call, { successMessage, onDone })` — busy-flagged confirm for delete/dissolve dialogs.
- `refreshPage()` — `navigate(pathname + search)` so URL-mirrored filters survive the reload.

## Server actions

`api/actions.ts` is a declarative routing table — no per-action handler bodies:

```ts
export const courseActions = {
  createCourse: defineDomainAction({ input: courseInput, run: createCourse }),
};
```

`defineDomainAction` (shared/lib) enforces the session, resolves Supabase, and translates `DomainError` → `ActionError`. Domain functions stay `(supabase, input)`-shaped, framework-free, and unit-testable. PostgREST error ladders collapse to `unwrapRow(result, { conflict?, notFound?, failure })` / `unwrapCompleted(result, failure)` from `@/shared/lib/postgrest`; only the per-entity messages live in the slice (`api/constants.ts`).

## Loaders & the Result convention

`Result<T, E>` (shared/lib) is the one discriminated-union style. Loaders return `LoaderResult<T> = Result<T, "unavailable">` via `withSupabase(client, fetch)`; pages branch on `result.ok`. Parallel reads are checked with `assertNoQueryErrors(label, results)`. Boundary rule: `Result` models *expected absence* (e.g. unconfigured Supabase); domain failures **throw `DomainError`** — never wrap those in `Result`.

**Detail-page variant.** When a page needs more expected-absence states than `LoaderResult` carries (e.g. not-found vs. message-bearing unavailable), keep the `Result` shape and widen only the error channel; the loader accepts `SupabaseClient | null` and owns the unconfigured branch itself:

```ts
export type PlannerPageError = { kind: "not-found" } | { kind: "unavailable"; message: string };
export type PlannerPageResult = Result<PlannerData, PlannerPageError>;
```

The page stays a straight call plus a status-code branch on `result.error.kind` — never a bespoke `kind: "ok" | …` union.

## URL-synced filters

`useUrlSyncedFilters(initial, parse, serialize)` (shared/lib) owns the seed-from-URL / mirror-to-URL machine. Each slice contributes only its pure codec in `model/filter-params.ts` and a thin `model/use-catalog-filters.ts` wrapper. `parse`/`serialize` must be referentially stable (module-level or `useCallback`).

## Vitest rule for astro-importing shared modules

`astro:*` virtual modules do not resolve under Vitest. Any shared module with **value** imports from them (`shared/lib/actions.ts`, `shared/lib/forms.ts`) must stay out of test import graphs: they are deliberately **not** re-exported where tests reach (`forms.ts`, `call-action.ts` are excluded from the barrel — deep-import them from `ui/` code), and slice api domain files deep-import `@/shared/lib/postgrest` / `@/shared/lib/errors` rather than the `@/shared/lib` barrel (which pulls in `actions.ts`). Type-only astro imports are always safe.

## Import style

Relative paths within a slice (`../model/course`, `./labels`); the `@/` alias only across layers (`@/shared/ui`, `@/shared/lib/forms`). Never mix both forms for the same target in one file.

## Public API surface

A slice's `api/index.ts` exports exactly what external consumers use — the loader (+ its types) and the actions object. Server handlers, constants, and client wrappers are internal: import them by file path within the slice. Keep the slice root `index.ts` to the page island component.

## Astro action clients

UI components must **not** import `actions` from `astro:actions`. Call typed wrappers in `api/<slice>-client.ts` instead.

| Layer | Location | Role |
| --- | --- | --- |
| Server handler | `api/<verb>-<entity>.ts` | Supabase/domain logic; called by `defineAction` in `api/actions.ts` |
| Action definition | `api/actions.ts` | `defineAction({ input, handler })` — server gate |
| Client wrapper | `api/<slice>-client.ts` | Typed RPC boundary for React islands |

**Why:** Astro's generated types (`.astro/actions.d.ts`) are picked up reliably by CLI ESLint, but the IDE language service often resolves `actions` as `any`. A single typed wrapper per slice centralizes the assertion and gives components a stable `{ error }` type.

**Pattern** (`api/course-client.ts`):

- One exported one-liner per action, named after it: `export const createCourse = (values: CourseInput) => callAction(actions.createCourse, values);`
- Input types come from `model/schemas.ts` (the `z.output` types — what `handleSubmit` produces).
- `callAction` (`@/shared/lib/call-action`, type-only astro imports) is the single transport helper; it returns `{ error: ActionError | undefined }` so dialogs branch on field errors, conflict codes, and toasts without throwing.

**Imports in `ui/`:**

```ts
import { createCourse } from "../api/course-client";
```

**Barrel export:** Do **not** re-export client wrappers from `api/index.ts` — they are ui-side internals; import them from `api/<slice>-client.ts` directly.

**When the caller wants throw-on-error:** `plan-detail/api/placement-client.ts` throws after checking `error` and returns `data` only — suited to optimistic drag-drop where failure is exceptional. New dialog/form flows should prefer the `{ error }` return shape above.

## State management

Local state lives in hooks; shared derived state is computed once at the orchestrator and passed down (see "Shared lookups"). A **store** or a broadcast **Context** is not the default — but the two are different tools with opposite re-render semantics, and the choice between "store", "Context", and "props" is made by the adoption-trigger checklist below, not by fiat.

**Context vs. selector store — know which you mean.** A React **Context** is a *broadcast*: when its value changes, **every** consumer re-renders, however deep the tree or however small the slice each one reads. The React Compiler (a real build transform — `astro.config.mjs` wires `@astrojs/react` with `babel-plugin-react-compiler`, `target: "19"`) auto-memoizes render-pure components, but memoization **does not shrink a Context's fan-out** — a changed Context value still re-renders all consumers. A **selector store** (`useSyncExternalStore` + a stable store ref) is the opposite: it is *granular*, so only the components whose selected slice actually changed re-render. `hintMode` already is exactly such a store (`lib/drag-hint-mode.ts`, subscribed via `useHintMode` in `chrome/board-disclosure.ts:21`) — a leaf could subscribe to it directly today. Treat them as distinct tools: a Context is the broadcast tool, a store is the granular one, and "no store by default" never meant "no `useSyncExternalStore`".

### Adoption-trigger checklist

Reach for a store (or a Context that carries a *stable store ref*, so the context value itself never changes and the broadcast never fires) when **at least one** holds:

1. **State must cross multiple React islands** on the same page — props cannot bridge two `client:` roots.
2. **A cross-cutting selection is consumed at many leaves** while the intermediate layers neither read nor transform it — a store lets those leaves subscribe directly instead of threading a prop through uninvolved hops.
3. **Per-flag persistence micro-modules have accumulated** to where folding them into one store pays for the novelty — today there are five near-identical ~50-line `useSyncExternalStore` clones under `lib/`: `drag-hint-mode.ts`, `board-zoom.ts`, `shelf-pinned.ts`, `palette-cohort.ts`, `palette-collapsed.ts`.
4. **Optimistic mutation flows outgrow hooks** — the reconcile/rollback logic no longer fits a hook over pure `model/` transitions.

**The current plan-detail board meets none of these.** The page mounts **one** island (`PlanDetailPage.astro:29`), so trigger 1 is out. What the grid chain (`PlannerBoard → PlannerGrid → SlotCell → PlacedChip`) threads down is not a bare selection but **per-cohort derived data** — `dropHints`, `justDuplicated`, collisions, ~11 handlers — assembled in `toCohortState` (`use-cohort-board-state.ts:219-259`) and rebuilt fresh per column in `buildColumn` (`PlannerBoard.tsx:150-166`, unmemoized). A selection-only store would remove **~1 of ~8** chain edit sites, so trigger 2 does not pay. Persistence has five clones but no felt consolidation pain yet (trigger 3 — watch it), and the optimistic path (`usePlacements` over pure transitions) is still hook-sized (trigger 4). Verdict for today: **hooks + spread, no store.**

### Lane-choice rule for a new board flag

When a new plan-detail view flag arrives, pick its transport by **where it is consumed**, not by habit:

| The flag is… | Lane | Precedent |
| --- | --- | --- |
| consumed at the **grid** level | a direct `PlannerGrid` prop | `zoom` (`PlannerGrid.tsx:89`) |
| consumed **per-cell / per-chip** | a `CellWiring` field, resolved per cell in the grid | `hintMode` (`PlannerGrid.tsx:162`) |
| a **persisted device preference** | a `lib/` `useSyncExternalStore` micro-store + a chrome hook | `drag-hint-mode.ts` |
| **per-cohort derived data** | the derivation pipeline, exposed via `toCohortState` | `dropHints`, `justDuplicated` |

The board threads its ~11 per-cell handlers + drag-hint state (`CellWiring`) as a **bundled object + `{...wiring}` spread** — built per column in `buildColumn` (`PlannerBoard.tsx:150-166`) and resolved per cell in the grid — rather than re-listing the fields at every hop. That is the fix for the prop-drill, and it stands **not** on any per-tick frequency claim but on two facts: a broadcast Context would re-render every cell on each change (fan-out, above), and the bundle removes the per-hop re-listing that was the real authoring cost. The cadence is in fact low: `dropHints` is set once at drag start and cleared at drag end (`use-board-derivations.ts:52-65`), `hintMode` changes on user toggle, and per-hover reactivity is per-cell `useDroppable` (`SlotCell.tsx:174`) — not a board-wide re-render.

### Where the real per-flag cost sits

Measured against the current board, a new cell-reaching flag costs **~15 edit sites**, and most of them are **outside** the transport this section used to debate. The cost centers, in order: **persistence-module cloning** (each persisted flag copies a ~50-line `lib/` micro-store), **control-surface widening** (`BoardSettingsMenu` value/setter pairs + a bespoke control file per flag), and **transport-independent derivation plumbing** (`use-board-derivations.ts → useCohortDerivations → toCohortState → useCombinedBoardState`). Future friction work should aim here, not at the spread. Evidence: `context/changes/board-view-state-store/frame.md` (Narrowing Signals).

### Worked example — the highlight/discovery lens

The lens (highlight placements by subject / teacher / student) is the next board-level flag. Run it through the checklist: still one island (trigger 1 — no); it *is* a cross-cutting selection, but it is consumed per-chip through the same derivation pipeline the other view flags use, and its match set is per-cohort derived data — so it rides `toCohortState` + the `{...wiring}` spread like `justDuplicated`, saving nothing by moving to a store (trigger 2 — no); triggers 3–4 are unrelated. **Verdict: thread it via the spread, no Context, no store** — which is exactly what the lens research concludes (`context/changes/planner-board-search-discovery/research.md` §4).

For non-board slices: the courses slice uses custom hooks + RHF for forms. Overlap edits use in-memory updates; other mutations use `navigate()` to re-run the server loader.

## Astro layouts & inline scripts

Established by the `unify-navigation` change (`src/app/layouts/`).

- **Pre-paint scripts live with the component that owns the affected markup.** A `<script is:inline>` placed in the template *before* the element it affects runs during HTML parsing — early enough to prevent a flash — so sidebar-collapse state belongs in `SidebarLayout`, not `BaseLayout`. Only genuinely document-global concerns (theme) sit in `BaseLayout`'s head.
- **Inline scripts stay static.** Never interpolate db/user-derived values into `is:inline` blocks (XSS surface). If a script needs server-side constants, use `define:vars` — never string-built markup.
- **Mutation stays at the boundary.** Frontmatter helpers are pure (`isActive`, `withActive`); imperative DOM/`localStorage` writes are confined to the inline scripts.
- **Repeated markup extracts to a sibling `.astro` component** (Astro has no private in-file sub-components, so the React "private children" rule translates to a co-located sibling file) — e.g. `SidebarNavLink.astro` next to `SidebarLayout.astro`.

## Applicability to `plan-detail`

Applied (June 2026): hooks live in `model/` with pure transitions (`use-placements.ts` over `placement-transitions.ts`), private `useCollisions`/`useHours` in `PlannerBoard`, within-slice relative imports, trimmed `api/index.ts` barrel (loader + actions only), the `Result` detail-page loader above, grid bounds single-sourced in `model/grid.ts` (`GRID_BOUNDS`, mirroring the DB checks), and a palette-local leading-course filter hook.

Remaining deltas, for when the code is next touched:

- `api/grouping-client.ts` returns an ad-hoc `{ error: string | undefined }` — align with the `callAction` `{ error }` shape, and swap `location.reload()` for `refreshPage()`.
- `api/placement-client.ts` stays throw-on-error **by design**: the optimistic reconcile needs `data`, which `callAction` discards.
- `loadCohortCourses` / `computeAndPersistGroupings` compute `warnings` nothing surfaces yet — wire them up or drop them when S-06 lands.
