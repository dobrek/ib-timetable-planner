# UI conventions

Conventions established by the courses module refactor (`src/_pages/courses/`). Use as input when planning similar work in other page slices (e.g. `plan-detail`).

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

Open the file, see the component shape immediately; scroll down only for implementation detail. Function declarations are hoisted, so hooks defined below the component are valid.

## Hook granularity

**One hook per independent behavioral flow** — not one hook per file, and not one hook to mechanically move `useState` out of sight.

- Group state and actions that depend on each other into one hook with a clear domain boundary.
- Separate flows that don't share state get separate hooks — even when they live in the same component file.
- **Test**: would changing one flow break the other? If not, separate hooks.
- **Anti-pattern**: a single hook that returns everything the component needs, hiding wiring the orchestrator should make visible.

Example: `MergeManageDialog` uses `useMergeHoursForm` (RHF submit) and `useDissolve` (destructive action) as two hooks, not one combined hook. `PlannerBoard` uses `usePlacements`, private `useCollisions`, and private `useHours` as three hooks — not one `usePlannerBoard`.

## Hook placement

| Hook kind | Placement | Naming |
| --- | --- | --- |
| Shared across components (filters, dialog coordination) | `model/use-<concept>.ts` (exported) | `useCatalogFilters`, `useCatalogDialogs` |
| Private to one component (form, action) | Same file, below the component (unexported) | `useCourseForm`, `useDissolve` |

Promote a co-located hook to `model/` only when a second consumer appears.

## Declarative components

- Components are **declarative JSX templates**: no `useState`, `useEffect`, `useMemo`, or async handlers in the component body.
- **Simple prop transforms** are allowed inline: `const noTeachers = teachers.length === 0`, `.map().filter()` derivations with no state.

## File naming

| File exports | Naming |
| --- | --- |
| React component | PascalCase matching the export: `CourseTable.tsx` |
| Hook, types, pure logic | kebab-case: `use-catalog-filters.ts` |

## One exported component per file

- One default export per `ui/` file.
- Private children (`OverlapBadge`, `CourseRowActions`) stay unexported inside their parent file when tightly coupled.

## Root page component

The page island root (`CourseCatalog`) is a **thin orchestrator**:

- Owns prop-seeded local state when needed (e.g. optimistic `courses` copy).
- Destructures shared hooks from `model/`.
- Wires props to child components and dialogs.
- No inline business logic beyond simple prop transforms.

## Shared lookups

Compute shared derived data once at the orchestrator level (e.g. `coursesById` in `useCatalogDialogs`) and pass down as props. Avoid rebuilding the same `Map` in multiple children.

## Shared helpers

Extract duplicated non-domain utilities to `lib/` within the slice (e.g. `lib/coerce.ts` for `toNumberOrUndefined`). Promote to `shared/lib/` only when multiple slices need the same helper.

## Astro action clients

UI components must **not** import `actions` from `astro:actions`. Call typed wrappers in `api/<slice>-client.ts` instead.

| Layer | Location | Role |
| --- | --- | --- |
| Server handler | `api/<verb>-<entity>.ts` | Supabase/domain logic; called by `defineAction` in `api/actions.ts` |
| Action definition | `api/actions.ts` | `defineAction({ input, handler })` — server gate |
| Client wrapper | `api/<slice>-client.ts` | Typed RPC boundary for React islands |

**Why:** Astro's generated types (`.astro/actions.d.ts`) are picked up reliably by CLI ESLint, but the IDE language service often resolves `actions` as `any`. A single typed wrapper per slice centralizes the assertion and gives components a stable `{ error }` type.

**Pattern** (`api/course-client.ts`):

- One exported function per action, named after the action (`createCourse`, `deleteOverlap`, …).
- Input types come from `model/schemas.ts` (same schemas the action gate uses).
- Return `{ error: ActionError<TInput> | undefined }` so dialogs/forms can branch on field errors, conflict codes, and toasts without throwing.
- A private `runAction` helper holds the `SafeResult` cast — the only place that touches untyped `actions`.

**Imports in `ui/`:**

```ts
import { createCourse } from "@/_pages/courses/api/course-client";
import { isInputError } from "astro:actions"; // type guards only — not `actions`
```

**Barrel export:** Do **not** re-export client wrappers from `api/index.ts`. That file already exports server handlers with the same names (`createCourse`, …). Import client functions from `api/<slice>-client.ts` directly.

**When the caller wants throw-on-error:** `plan-detail/api/placement-client.ts` throws after checking `error` and returns `data` only — suited to optimistic drag-drop where failure is exceptional. New dialog/form flows should prefer the `{ error }` return shape above.

## State management

No global store library (Zustand, Context) unless:

- State must cross multiple React islands on the same page, or
- Optimistic mutation paths become too complex for hooks alone.

The courses slice uses custom hooks + RHF for forms. Overlap edits use in-memory updates; other mutations use `navigate()` to re-run the server loader.

## Applicability to `plan-detail`

| Current | Target |
| --- | --- |
| `ui/usePlacements.ts` | Move to `model/use-placements.ts`; extract guards/transitions to `model/placement-transitions.ts`; hook orchestrates async persistence over pure functions |
| Inline derivations in `PlannerBoard` | Private `useCollisions` and `useHours` hooks (one per independent flow); orchestrator wires them to children |
| Dialog / action patterns | Apply same per-flow private hooks when dialogs gain similar complexity |
| `api/placement-client.ts` | Align with typed `{ error }` pattern when touched; keep throw-on-error only where drag-drop needs it |

When refactoring `plan-detail`, mirror this structure before introducing new abstractions.
