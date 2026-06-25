# Companion-course Filter Implementation Plan

## Overview

Add a second, cascading **companion course** select beneath the existing leading-course filter in the grouping palette. Picking a leading course narrows the palette to groupings containing it; picking a companion narrows further to groupings containing *both* courses. The companion dropdown lists only courses that co-occur with the leading course in the currently-matched groupings (excluding the leading course itself), so every choice yields a non-empty result. State is ephemeral React state only — it resets on reload and on cohort switch, exactly like the leading filter.

The change also pays down a small, named piece of debt: the palette's filter is currently a single inline `.filter()` in `useLeadingFilter`. Adding a second predicate is the "repeated touches → refactor" moment the repo's own *Orchestration over patching* lesson calls out, so the filter logic moves into pure, unit-tested `model/` functions and the hook becomes a thin orchestrator.

## Current State Analysis

The entire filter lives in the palette as a small local hook (`src/_pages/plan-detail/ui/PlannerPalette.tsx:70-76`):

```ts
function useLeadingFilter(groupings: PlannerGrouping[]) {
  const [leadingCourseId, setLeadingCourseId] = useState<string | null>(null);
  const visibleGroupings = leadingCourseId
    ? groupings.filter((grouping) => grouping.memberIds.includes(leadingCourseId))
    : groupings;
  return { leadingCourseId, setLeadingCourseId, visibleGroupings };
}
```

- The predicate at `PlannerPalette.tsx:73` is the *entire* filtering logic — there is no `model/` function for it today. The module doc (`PlannerPalette.tsx:17-21`) states the filter is "purely a rendering concern — nothing outside the palette reads it."
- `GroupingFilter` (`src/_pages/plan-detail/ui/GroupingFilter.tsx`) renders the leading `<Select>` plus a By-count/Alphabetical sort toggle, computing its option list from `leadingCourseOptions(groupings, names)` (`leading-course-options.ts:16-27`). It uses an `ALL = "__all__"` sentinel for the cleared state and always renders an explicit "All groupings" item (Radix reserves `""` for the placeholder).
- `leadingCourseOptions` already does exactly the counting the companion list needs — distinct member courses + how many groupings each appears in, in a single `Map` pass. Its `sortByName` helper and `LeadingCourseOption` type (`{ id; name; groupCount }`) are reusable as-is.
- **A grouping already carries everything needed**: `PlannerGrouping.memberIds: string[]` (`grouping.ts:21-29`), DB-deduped via the `course_grouping_members` composite PK. No schema, query, or load-path change is required.
- **No `GroupingFilter.test.tsx` / `PlannerPalette.test.tsx` exists** — the leading filter's interactive narrowing is untested at the component level today.

## Desired End State

A plan author opens the palette, picks a leading course, then sees a second "Companion course" select directly below it. The companion select:

- is **disabled** until a leading course is chosen;
- lists, alphabetically, only the courses that co-occur with the leading course in the matched groupings (each labelled `Name (count)`), plus an "Any companion" cleared item;
- on selection, narrows the grouping list to groupings containing both courses;
- **resets to "Any companion" whenever the leading course changes or clears** (a dangling companion can never silently mis-filter);
- on a cohort switch or reload, is back to "Any companion" (free, via SSR remount).

The cascade guarantees the filtered list is always non-empty: every companion option has ≥1 matching grouping, and a stale companion is dropped (reconciled to `null`) before filtering — so a "no groupings match" pane would be unreachable dead code and is deliberately not built (see *What We're NOT Doing*).

### Key Discoveries

- Filter logic is one inline `.filter()` at `PlannerPalette.tsx:73` — the extraction point. (`PlannerPalette.tsx:70-76`)
- `leadingCourseOptions` + `sortByName` + `LeadingCourseOption` are reusable for the companion option list; the only twist is **excluding the leading course id** from the result. (`leading-course-options.ts:16-49`)
- Reset-on-leading-change must be done with **adjust-state-during-render, not a `useEffect`** — direct in-slice precedent in `useCollisionInspection` (`PlannerBoard.tsx:246-262`, esp. `:253`).
- DS `Select` has `disabled` styling built in — `SelectTrigger` spreads `...props` and styles `disabled:opacity-50` (`select.tsx:32,35`) — so the disabled-until-leading behavior needs zero new CSS.
- `GroupingFilter` is passed the **full, unsorted** `groupings` prop while the hook receives the **sorted** list (`PlannerPalette.tsx:23-24,29`). Companion options must derive from the **leading-filtered subset**, so they are computed in the hook (which owns `leadingCourseId`) and passed down — avoiding the wrong-list trap.

## What We're NOT Doing

- **No persistence** — no URL params, no DB column, no localStorage. Ephemeral React state only.
- **No second promoted draggable chip** for the companion — it narrows the list, it does not stage a course. `PromotedCourseChip` is untouched.
- **No companion sort toggle** — the companion list is always alphabetical. The leading filter's existing By-count/Alphabetical toggle is unchanged and governs only the leading list.
- **No empty-state pane** — the cascade + reconcile invariant makes a zero-result list unreachable through interaction (every companion option matches ≥1 grouping; `reconcileCompanion` drops a stale companion before `filterGroupings` runs; the leading-only and unfiltered branches are non-empty by construction). A defensive "no groupings match" pane would be dead code that can't be exercised by a test, so it is not built. If a future change introduces a non-cascading filter path, reintroduce it then.
- **No E2E spec** — this is a pure ephemeral client filter; unit + RTL cover it. (The leading filter has no E2E either.)
- **No label polish** — `names` are composite tokens (`name-level-group`); they surface identically in both selects. Out of scope.
- **No changes to `PlannerBoard`, `GroupingBox`, `PaletteCourseChip`, the load path, or the schema.**

## Implementation Approach

Model-first, in two phases. Phase 1 extracts and unit-tests three pure functions so all the silent-bug-prone logic (two-predicate filter, cascading options, stale reset) is verified in isolation before any UI exists. Phase 2 wires them through a renamed orchestrator hook, adds the second `<Select>`, and locks the interactive behavior with one RTL component test.

The hook owns the companion options because the reset reconciler needs them: companion options are computed once per render, used to reconcile a now-invalid companion to `null` (adjust-state-during-render), and passed down to `GroupingFilter` for rendering.

## Phase 1: Model layer (pure + unit-tested)

### Overview

Extract the palette filter into three pure functions under `src/_pages/plan-detail/model/`, each unit-tested following the `leading-course-options.test.ts` template. No UI changes in this phase — `PlannerPalette` still calls its inline filter; the new functions are introduced and tested standalone, then adopted in Phase 2.

### Changes Required

#### 1. Two-predicate filter

**File**: `src/_pages/plan-detail/model/filter-groupings.ts` (new)

**Intent**: Replace the inline membership `.filter()` with a pure function that applies both the leading and companion predicates. A `null` id means "that predicate is off."

**Contract**: `filterGroupings(groupings: PlannerGrouping[], leadingId: string | null, companionId: string | null): PlannerGrouping[]` — returns groupings where `(leadingId === null || memberIds.includes(leadingId)) && (companionId === null || memberIds.includes(companionId))`. Both `null` → returns the input list unchanged (same order). Does not mutate the input.

#### 2. Cascading companion options

**File**: `src/_pages/plan-detail/model/companion-course-options.ts` (new)

**Intent**: Produce the companion dropdown's option list — the courses that co-occur with the leading course, each with the number of matched groupings it appears in, excluding the leading course itself. Reuses `leadingCourseOptions`'s counting rather than reimplementing it.

**Contract**: `companionCourseOptions(groupings, names, leadingId: string | null): LeadingCourseOption[]` — when `leadingId === null`, returns `[]` (companion disabled). Otherwise: filter `groupings` to those whose `memberIds` include `leadingId`, run `leadingCourseOptions(subset, names)` over that subset, then drop the entry whose `id === leadingId`. Returned **unsorted** (the caller applies `sortByName`), mirroring `leadingCourseOptions`. Reuses the existing `LeadingCourseOption` type — no new type. Note in the module doc that the subset is the leading-only filtered set (not the leading+companion `visibleGroupings`), so picking a companion never shrinks its own option list.

#### 3. Stale-companion reconciler

**File**: `src/_pages/plan-detail/model/reconcile-companion.ts` (new)

**Intent**: Decide the companion id to use for the current render given the current option list — the pure core of the reset-on-leading-change rule. Keeps the hook's adjust-state-during-render call trivial and testable.

**Contract**: `reconcileCompanion(companionId: string | null, options: LeadingCourseOption[]): string | null` — returns `companionId` when it is present among `options` (`options.some(o => o.id === companionId)`), otherwise `null`. `null` in → `null` out.

#### 4. Unit tests

**File**: `src/_pages/plan-detail/model/filter-groupings.test.ts`, `companion-course-options.test.ts`, `reconcile-companion.test.ts` (new)

**Intent**: Cover each function following the `leading-course-options.test.ts` idiom (local `grouping(...)` / `option(...)` factories, no-mutation assertions).

**Contract**: Cases to cover —
- `filterGroupings`: both ids null → identity (same order); leading only; companion only; both (intersection); companion narrows a leading result; no-mutation of input.
- `companionCourseOptions`: returns `[]` when `leadingId` is null; lists only co-occurring courses; **excludes the leading course id**; count = number of groupings containing both the leading course and that companion; empty when the leading course matches no groupings; name fallback to id.
- `reconcileCompanion`: keeps a still-valid companion; resets to `null` when the companion is absent from options; `null` in → `null` out.

### Success Criteria

#### Automated Verification

- Type checking passes: `pnpm check`
- Unit tests pass: `pnpm test`
- Linting passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Production build stays clean: `pnpm build`

#### Manual Verification

- The three new `model/` functions read as pure, single-purpose, newspaper-ordered (exported function first), consistent with `leading-course-options.ts`.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2. Phase blocks use plain bullets — the `- [ ]` checkboxes live in the `## Progress` section.

---

## Phase 2: UI wiring (hook + second Select + RTL test)

### Overview

Adopt the Phase 1 functions in a renamed orchestrator hook, add the companion `<Select>` to `GroupingFilter`, and lock the interactive behavior with one RTL component test.

### Changes Required

#### 1. Orchestrator hook

**File**: `src/_pages/plan-detail/ui/PlannerPalette.tsx`

**Intent**: Rename `useLeadingFilter` → `usePaletteFilter`, add companion state, compute companion options, reconcile a stale companion during render, and apply the two-predicate filter via `filterGroupings`.

**Contract**: The hook signature gains `names`: `usePaletteFilter(groupings, names)` — the call site at `PlannerPalette.tsx:24` already has `names` in scope and passes it (`usePaletteFilter(sortedGroupings, names)`). The hook holds `leadingCourseId` and `companionCourseId` (`useState<string | null>`). Each render: compute `companionOptions = sortByName(companionCourseOptions(groupings, names, leadingCourseId))`; reconcile with `const validCompanion = reconcileCompanion(companionCourseId, companionOptions)` and, if `validCompanion !== companionCourseId`, call `setCompanionCourseId(validCompanion)` (adjust-state-during-render, precedent `PlannerBoard.tsx:253`); compute `visibleGroupings = filterGroupings(groupings, leadingCourseId, validCompanion)`. Returns `{ leadingCourseId, setLeadingCourseId, companionCourseId: validCompanion, setCompanionCourseId, companionOptions, visibleGroupings }`. The promoted chip still keys off `leadingCourseId` only.

#### 2. Companion select

**File**: `src/_pages/plan-detail/ui/GroupingFilter.tsx`

**Intent**: Add a second `<Select>` directly below the leading one for the companion course, mirroring the leading Select's sentinel pattern but always alphabetical and disabled until a leading course is chosen.

**Contract**: New props `companionValue: string | null`, `onCompanionChange: (courseId: string | null) => void`, `companionOptions: LeadingCourseOption[]`, and the leading `value` already signals whether a leading course is set (drive `disabled` off `value === null`). Add an `ANY_COMPANION = "__any__"` sentinel and an "Any companion" item, mirroring the `ALL` pattern at `GroupingFilter.tsx:28,68-77`. The companion Select renders below the leading Select (after the current closing `</Select>` at `:84`), with a "Companion course" label; it is `disabled` when no leading course is selected and renders `companionOptions` as `Name (count)` items. The leading filter's existing sort toggle is unchanged and does not apply to the companion list.

#### 3. RTL component test

**File**: `src/_pages/plan-detail/ui/GroupingFilter.test.tsx` (new) — and/or `PlannerPalette.test.tsx` if the interaction is better exercised through the palette

**Intent**: Fill the pre-existing component-test gap and lock the HIGH-severity interaction risk (stale reset on leading change). Follow the RTL idiom in `GroupingStalePanel.test.tsx` (render, drive user events, assert behavior).

**Contract**: Cover — companion is disabled until a leading course is picked; selecting a leading course populates the companion options (co-occurring only, leading excluded); selecting a companion narrows the visible groupings; **changing the leading course resets the companion to "Any companion"**. (Driving the Radix `Select` listbox requires opening it via the trigger before selecting an item.)

**jsdom note (budget this — it is the bulk of the test effort)**: This is the repo's **first** component test that drives a Radix `Select`. None of the existing `.test.tsx` files (`GroupingStalePanel.test.tsx`, the two hook tests, `dom-lane.test.tsx`) open a Radix listbox, and `src/test/setup-dom.ts` registers only jest-dom matchers + RTL cleanup — it has **no** jsdom polyfills for the APIs Radix Select relies on (`Element.prototype.hasPointerCapture` / `releasePointerCapture` / `scrollIntoView`, and `PointerEvent`), so a pointer-driven open will throw or no-op in jsdom. Resolve one of two ways before writing assertions: **(a)** add the missing polyfills to `src/test/setup-dom.ts` (shared, reusable for all future Radix-Select tests — preferred), or **(b)** drive the Select by keyboard (focus the trigger → `Enter`/`ArrowDown` → `Enter`) to sidestep pointer capture. Verify the exact polyfill set against the first failing run (it depends on the installed `radix-ui` internals).

### Success Criteria

#### Automated Verification

- Type checking passes: `pnpm check`
- Unit + RTL tests pass: `pnpm test`
- Linting passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Production build stays clean: `pnpm build`

#### Manual Verification

- Picking a leading course enables the companion select; its options are only co-occurring courses, alphabetical, leading course absent.
- Selecting a companion narrows the grouping list to groupings containing both courses.
- Changing the leading course resets the companion to "Any companion"; clearing the leading course disables and resets the companion.
- Switching cohorts (and reloading) returns both selects to their cleared state.
- No regression to the existing leading filter, its sort toggle, or drag-and-drop from the palette.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that the UI behaves as specified.

---

## Testing Strategy

### Unit Tests

- `filterGroupings` — both-null identity, leading-only, companion-only, intersection, no-mutation.
- `companionCourseOptions` — null leading → empty; co-occurring only; excludes leading id; counts groupings containing both; empty when leading matches nothing; name fallback.
- `reconcileCompanion` — keeps valid, resets invalid, null passthrough.

### Component (RTL) Tests

- `GroupingFilter` (and/or `PlannerPalette`) — disabled-until-leading; cascading options; narrow-on-select; reset-on-leading-change. Mirrors `GroupingStalePanel.test.tsx`.

### Manual Testing Steps

1. Open a plan, select a leading course → companion select enables.
2. Open the companion select → only co-occurring courses, alphabetical, leading absent.
3. Pick a companion → grouping list narrows to both-course groupings.
4. Change the leading course → companion resets to "Any companion".
5. Clear the leading course → companion disables and resets.
6. Switch cohort, then reload → both selects cleared.

## Performance Considerations

None of note. The filter runs at render time (`.filter()` + one `Map` pass over the in-memory, compute-capped palette) and is **not** on the <200ms drag-drop validation path (that is `useCollisions` / `deriveCellViolations`). The companion adds one more linear pass. Optional, deferrable: memoize the option lists on `[groupings, leadingCourseId]` if the palette ever grows large — none of the current option lists are memoized except `sortGroupingsForPalette`.

## Migration Notes

None — no schema, data, or persisted-state changes.

## References

- Research: `context/changes/companion-course/research.md`
- Insertion point: `src/_pages/plan-detail/ui/PlannerPalette.tsx:70-76`
- Reuse target + test template: `src/_pages/plan-detail/model/leading-course-options.ts:16-49`, `leading-course-options.test.ts`
- Adjust-state-during-render precedent: `src/_pages/plan-detail/ui/PlannerBoard.tsx:246-262`
- Sentinel + Select pattern: `src/_pages/plan-detail/ui/GroupingFilter.tsx:28,67-84`; `src/shared/ui/select.tsx:19-43`
- RTL idiom: `src/_pages/plan-detail/ui/GroupingStalePanel.test.tsx`
- Lesson: MEMORY.md — *Orchestration over patching* (derived-state dispatch in `model/`, not another inline condition)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Model layer (pure + unit-tested)

#### Automated

- [x] 1.1 Type checking passes: `pnpm check` — 49d6a56
- [x] 1.2 Unit tests pass: `pnpm test` — 49d6a56
- [x] 1.3 Linting passes: `pnpm lint` — 49d6a56
- [x] 1.4 FSD structure check passes: `pnpm steiger` — 49d6a56
- [x] 1.5 Production build stays clean: `pnpm build` — 49d6a56

#### Manual

- [x] 1.6 New `model/` functions are pure, single-purpose, newspaper-ordered, consistent with `leading-course-options.ts` — 49d6a56

### Phase 2: UI wiring (hook + second Select + RTL test)

#### Automated

- [x] 2.1 Type checking passes: `pnpm check`
- [x] 2.2 Unit + RTL tests pass: `pnpm test`
- [x] 2.3 Linting passes: `pnpm lint`
- [x] 2.4 FSD structure check passes: `pnpm steiger`
- [x] 2.5 Production build stays clean: `pnpm build`

#### Manual

- [x] 2.6 Leading select enables the companion; options are co-occurring only, alphabetical, leading absent
- [x] 2.7 Selecting a companion narrows the list to both-course groupings
- [x] 2.8 Changing/clearing the leading course resets (and disables) the companion
- [x] 2.9 Cohort switch + reload returns both selects to cleared state
- [x] 2.10 No regression to the leading filter, its sort toggle, or palette drag-and-drop
