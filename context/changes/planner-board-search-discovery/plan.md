# Planner Board Highlight/Discovery Lens — Implementation Plan

## Overview

Add a board-only **highlight/discovery lens** to the plan-detail board: an OR-union of course / teacher / student criteria that keeps matching placed chips at full strength (plus a token ring) and dims everything else, so a packed board answers "where is all the math", "what does teacher KK's week look like", and any union of such questions. Entry is a search-input-lookalike trigger in the `PlanSummaryBar` trailing slot plus ⌘K, opening an anchored multi-select command picker with live preview; active criteria are shown in a slim active-lens bar with per-criterion counts. The lens is read-only view state — it never touches the constraint engine, persistence, or history.

## Current State Analysis

All grounding is in `context/changes/planner-board-search-discovery/research.md` (verified at `f91c65c`/HEAD, plus a fresh seam pass during planning). The essentials:

- **All three lens kinds are free on the client today.** `catalog[].teacherKeys` / `studentKeys` (`shared/lib/catalog-hash/types.ts:18-25`) already reach the board (they power the teacher/student conflict constraints); "subject = course" (decided) means the course criterion matches on `placement.courseId`, already on every occupant. No schema change, no new fetch.
- **The derivation pipeline is the designated lane.** `useCohortDerivations` → `toCohortState` (`model/use-cohort-board-state.ts:184-259`) assembles per-cohort derived data (`dropHints`, `justDuplicated`, collisions); `buildColumn` (`ui/PlannerBoard.tsx:144-168`) bundles it into `CellWiring` (`ui/grid/PlannerGrid.tsx:30-46`), spread down to `SlotCell` → `ChipWiring` → `PlacedChip`. The convention's worked example (`context/foundation/ui-conventions.md` §"State management") pins the lens to exactly this lane: **derived `Set` in `model/`, threaded via the `{...wiring}` spread — no Context, no store, no inline `if`**.
- **Visual vocabulary exists.** Independent axes composed via `cn(...)`: `opacity-40` dim (`SlotCell.tsx:128`), `ring-ring ring-2 ring-inset` one-shot ring (`SlotCell.tsx:126`), chip tone precedence `blocking → warning → subject color → neutral` (`PlacedChip.tsx:136-151`).
- **Selector primitives exist.** `shared/ui/command.tsx` (cmdk, zero consumers yet), the `MultiSelect` Command-in-Popover idiom (`shared/ui/multi-select.tsx:34`), `BoardSettingsMenu` as the trailing-slot popover template.
- **Keyboard**: only undo/redo is claimed (`model/history/use-undo-keymap.ts:44-47`) — ⌘K is free, and that hook is the template (including its editable-target guard).
- **Navigation resets state**: the island is `client:load` (`ui/PlanDetailPage.astro`), and `CohortSwitcher.tsx:21-23` builds bare `?focus=` hrefs — every focus switch is a full remount that would clear ephemeral state (hence the sessionStorage decision below).

## Desired End State

A plan author on any board surface (dp1 / dp2 / combined) can:

1. Click the lens trigger (or press ⌘K), type "math", check `Math_AA-HL` and `Math_AI-HL`, then "KK" and check the teacher — and watch the board's matching chips stay vivid while the rest fade, live, as each item is checked or even just arrowed over.
2. Close the picker and still see which criteria are active in the lens bar, with per-criterion match counts and a union total; remove one with `×`, or Clear all (or press Esc with the picker closed).
3. Switch DP1 → Combined → DP2 and keep the lens (per-tab, per-plan sessionStorage); open a new tab and get a clean board.

Verification: unit suite green (`pnpm test`), full local gate green (`pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm build`), one new e2e spec green (`pnpm test:e2e`), and the manual checks per phase below.

### Key Discoveries:

- `CellWiring` rest-spread already carries new fields to `SlotCell` untouched (`PlannerGrid.tsx:166`, `{...handlers}` at `:183`) — adding a field costs one type entry + one `buildColumn` line.
- `ChipWiring` is shared by all chips in a cell (`SlotCell.tsx:104`), so the per-chip signal must be the **matched `Set`** (shared, membership resolved inside `PlacedChip`) — not a per-chip boolean on wiring.
- `WeekLane` passes `wiring` through opaquely — bi-weekly lanes need zero changes.
- `useCombinedBoardState` runs before any other shell hook (`PlannerBoard.tsx:64`) — the lens criteria state must be created **above** it so criteria can feed the derivation.
- The e2e contract is role+name only (`e2e/CLAUDE.md`); the lens's accessible names and count text are the e2e surface and must be designed in from the start.

## What We're NOT Doing

- **No URL `?lens=` sync / shareable links** (decided: sessionStorage bridge instead; URL-sync remains a clean fast-follow) — and therefore **no `CohortSwitcher` changes**.
- **No chip-anchored entry** ("highlight all like this" from a placed chip) — endorsed as the first fast-follow, not v1.
- **No shelf/palette highlighting** — the lens reaches placed chips only (decided; the match count reads as *placed* chips).
- **No AND-combination mode** — OR-union only, everywhere (decided).
- **No per-criterion ring colors** — one uniform emphasis for the whole union (would fight subject colors).
- **No localStorage / device persistence, no sixth `lib/` micro-store** — sessionStorage via plain guarded functions (see Critical Implementation Details); adoption trigger 3 (`ui-conventions.md`) stays un-tripped.
- **No store/Context/seam consolidation** — explicitly deferred until after this lens lands (`context/archive/2026-07-03-board-view-state-store/change.md`); build along the existing per-flag patterns without generalizing.
- **No IB subject taxonomy / schema changes** — subject = course (decided).

## Implementation Approach

Bottom-up along the pinned lane. Phase 1 builds the pure matching engine and threads its output through the existing derivation → wiring → chip path (invisible until criteria exist). Phase 2 adds the criteria state, trigger, ⌘K, and picker — the lens becomes usable. Phase 3 adds the active-lens bar, counts, and the aria-live status. Phase 4 adds the plan-keyed sessionStorage bridge and the e2e spec. Each phase lands green on the full gate and pauses for manual verification.

Decisions locked during planning (with the research resolving everything upstream of them):

| Decision | Choice |
|---|---|
| Persistence across focus switches | **sessionStorage bridge**, keyed per plan (`planner-lens:<planId>`), rehydrated post-mount, pruned against the plan's entity universe |
| Combined-surface semantics | **One shell-level lens applies to all visible columns**; picker lists entities of visible cohorts only; an off-screen cohort's criterion stays active and shows `·0` |
| Lens × drag | **Compose naturally** — lens stays active during drag; opacity axes stack as they fall |
| A11y | Ring + counts + ARIA state on controls + **one polite live region** announcing the match total; no per-chip ARIA annotation |
| Testing | Full unit coverage of pure logic + **one** role-based e2e scenario |

## Critical Implementation Details

- **Hook ordering & criteria threading.** `useLens` (criteria state) must be called before `useCombinedBoardState` in `PlannerBoard`, and the criteria array it hands down must be referentially stable per state change (memoized), because it becomes a dependency of the per-cohort lens memo. `useCombinedBoardState` gains an optional trailing `lensCriteria` param (default `[]`) so `useCohortBoardState` and its existing test seam stay valid unchanged.
- **Hydration.** The island is `client:load`. Rehydrate sessionStorage in a **post-mount effect**, never in a `useState` lazy initializer — the server renders no lens, and an initializer read would desync hydration. First paint without the lens, then it applies; this matches the storage lesson's "server snapshot = default" principle.
- **Esc layering.** First Esc closes the picker (Radix built-in). The global handler clears criteria on Esc **only when** the event isn't `defaultPrevented`, the picker and the collision-inspection dialog (both shell-known) are closed, the event target isn't inside an open Radix layer (focus-ancestry check), **and no open Radix layer is present in the DOM** (a `[data-radix-popper-content-wrapper]` / open-`[data-state="open"]` query veto) — the DOM veto is the backstop for the three overlays whose open state the shell can't see (hours popover `PlanSummaryBar.tsx:91`, `BoardSettingsMenu` dropdown, `CoursesLeftPopover`), where focus ancestry alone fails whenever focus sits outside the layer when Esc lands. Verify against each overlay manually in Phase 2; if any overlay still leaks through, the pre-decided escalation is to lift that overlay's open state to the shell (as `inspection` already is) — not to weaken the guard.
- **Visual emphasis keeps the monochrome design readable (user constraint).** The lens adds **zero new hues**: matched chips render exactly as today (tone precedence and subject colors untouched) plus the existing semantic `ring-ring ring-2 ring-inset` token (static — no pulse; the pulse stays exclusive to `justDuplicated`); non-matches get `opacity-40`, which preserves the collision red/amber hues underneath so a dimmed blocking chip still reads as blocking. Emphasis comes from receding the rest, not adding chroma.
- **cmdk item identity.** `CommandItem` values must be unique while search matches on labels: duplicate course/student display names exist across cohorts on the combined view. Give items a unique value derived from the criterion id (`kind:key`), route label matching through `keywords`, and tag combined-view course/student labels with their cohort.
- **No sixth micro-store.** `lib/lens-session.ts` is a pair of guarded pure functions (read/write in try/catch per the storage lesson), *not* a `useSyncExternalStore` clone — there is a single consumer and sessionStorage needs no cross-tab sync. Cloning the `drag-hint-mode.ts` shape here would trip adoption trigger 3 for nothing.

## Phase 1: Lens Engine — model, derivation, wiring, chip visuals

### Overview

The pure matching core plus its full threading path, landing dark: with no criteria the board renders byte-for-byte as today. Everything user-invisible in this phase is unit-tested.

### Changes Required:

#### 1. Lens domain model

**File**: `src/_pages/plan-detail/model/lens.ts` (new) + `lens.test.ts` (new)

**Intent**: The lens's pure vocabulary and matching engine, written as declarative pipelines (per the lessons rule) with named predicates.

**Contract**:
- `type LensKind = "course" | "teacher" | "student"`; `type LensCriterion = { kind: LensKind; key: string }`; `criterionId(c): string` (`kind:key`).
- `deriveLensMatches(placements, catalogById, criteria): LensMatches | null` — `null` when `criteria` is empty (mirrors `dropHints`' null-means-inactive); otherwise `{ matched: Set<placementId>, countsByCriterion: Map<criterionId, number> }`. Matching: course → `placement.courseId === key`; teacher/student → the placement's catalog course's `teacherKeys`/`studentKeys` includes the key. Union across criteria (OR); a placement matching several criteria counts once in `matched` but in each criterion's count. Pending placements match like any other.
- Tests: per-kind matching, OR-union with overlap, per-criterion counts, unknown keys → 0, empty criteria → null, missing catalog entry → no match.

#### 2. Derivation memo

**File**: `src/_pages/plan-detail/model/use-board-derivations.ts`

**Intent**: `useLensMatches(placements, catalogById, criteria)` — a `useMemo` over `deriveLensMatches`, keyed `[placements, catalogById, criteria]`, sitting beside `useDuplicateHighlight`. Lens changes never invalidate the collision/hint memos (orthogonal deps — this is what keeps the <200 ms drag budget out of scope).

**Contract**: same hook shape as the sibling derivations; exported for `useCohortDerivations`.

#### 3. Pipeline threading

**File**: `src/_pages/plan-detail/model/use-cohort-board-state.ts`

**Intent**: Carry criteria into the per-cohort derivations and expose the result on the cohort state, exactly like `justDuplicated`.

**Contract**: `useCombinedBoardState(shared, dp1Props, dp2Props, focus, lensCriteria = [])`; `useCohortDerivations` takes the criteria and returns `lensMatches`; `toCohortState` exposes `lensMatches: LensMatches | null`. `useCohortBoardState` (the test seam) keeps its signature via the default. Existing `use-cohort-board-state.test.tsx` assertions extended for the new field only if they pin the state shape.

#### 4. Wiring + chip visuals

**Files**: `src/_pages/plan-detail/ui/PlannerGrid.tsx` (`CellWiring`), `ui/grid/slot-cell/SlotCell.tsx`, `ui/grid/slot-cell/PlacedChip.tsx`, `ui/PlannerBoard.tsx` (`buildColumn`)

**Intent**: Thread the matched set to the chip and render the emphasis. Per-chip membership is resolved inside `PlacedChip` from the shared set — no per-occupant boolean, no inline predicate in the cell.

**Contract**: `CellWiring` and `ChipWiring` gain `lensMatched: Set<string> | null` (null = lens inactive). `buildColumn` maps `state.lensMatches?.matched ?? null` onto the wiring; the grid's rest-spread carries it to `SlotCell`, which adds it to `chipWiring`; `WeekLane` is untouched. `PlacedChip` composes on the existing axes: matched → `ring-ring ring-2 ring-inset` (static); non-matched → `opacity-40`. Both compose with (never replace) the pending/dragging opacity and the tone class — see the visual-emphasis detail above.

### Success Criteria:

#### Automated Verification:

- `pnpm test` — new `model/lens.test.ts` green; existing suite (incl. `use-cohort-board-state.test.tsx`) green
- `pnpm check` clean (the type gate — never proxied by build/lint)
- `pnpm lint` and `pnpm steiger` clean
- `pnpm build` clean

#### Manual Verification:

- Board renders and behaves identically to before on all three surfaces (no lens UI exists yet; drag-drop, collisions, undo/redo unaffected)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Trigger + Picker — the lens becomes usable

### Overview

Criteria state in the shell, the fake-input trigger, ⌘K, the anchored grouped multi-select picker with live preview, and Esc layering. End of phase: a user can build a union and watch the board respond live.

### Changes Required:

#### 1. Picker options assembly (pure)

**File**: `src/_pages/plan-detail/model/lens.ts` (extend) + tests

**Intent**: `buildLensOptions` — pure assembly of the three picker groups from the visible cohorts' data, so the component stays a template.

**Contract**: input: per-visible-cohort `{ cohort, courseDisplay, catalog, studentNames }` + shared `teacherNames` + a combined flag; output: grouped options `{ courses, teachers, students }`, each option `{ criterion, label, color?, cohortTag? }`. Courses/students come only from visible cohorts (cohort-tagged labels when combined); teachers are filtered to those appearing in visible catalogs' `teacherKeys`, never cohort-tagged. Sorted by label. Also landing here now: `pruneCriteria(criteria, validKeys)` (used in Phase 4, trivially testable with the same fixtures) and `mergeEffectiveCriteria(committed, preview)` — the committed + preview union with `criterionId` dedup — so `useLens` keeps orchestration only (pure domain logic in `model/`, per convention).

#### 2. Lens state hook

**File**: `src/_pages/plan-detail/ui/lens/use-lens.ts` (new)

**Intent**: One behavioral flow — the lens selection and its picker disclosure — following the precedent that view-state hooks live in the UI layer (`chrome/board-disclosure.ts`).

**Contract**: `useLens(planId)` returns `{ criteria, toggleCriterion, removeCriterion, clearAll, open, setOpen, preview, setPreview, effectiveCriteria }`. `effectiveCriteria` = committed criteria plus the picker's currently-highlighted candidate (memoized — it feeds the derivation), computed via the pure `mergeEffectiveCriteria` from `model/lens.ts`. `planId` is accepted now; persistence wires in Phase 4.

#### 3. Keyboard entry + Esc layering

**File**: `src/_pages/plan-detail/ui/lens/use-lens-keymap.ts` (new) + test

**Intent**: ⌘K/Ctrl-K opens the picker; Esc with the picker closed clears criteria — modeled on `model/history/use-undo-keymap.ts` (window keydown, editable-target guard, test mirroring `use-undo-keymap.test.tsx`).

**Contract**: `useLensKeymap({ open, setOpen, hasCriteria, clearAll, inspectionOpen })`. Esc-clear fires only under the guards in Critical Implementation Details (defaultPrevented, shell-known overlays closed, focus-ancestry check).

#### 4. Trigger + picker components

**Files**: `src/_pages/plan-detail/ui/lens/LensTrigger.tsx`, `ui/lens/LensPicker.tsx`, `ui/lens/index.ts` (new folder, multi-public barrel per the ui-conventions amendment)

**Intent**: The fake-input trigger (a `<button>` announced honestly, styled like a search input: magnifier, placeholder "Highlight courses, teachers, students…", `⌘K` kbd hint; filled treatment + "N criteria" when active; icon-only collapse on narrow viewports) anchoring the picker popover (Command-in-Popover per the `MultiSelect` idiom): one search input over three `CommandGroup`s with checkable, stay-open items; arrowing highlights an item and previews it live via `setPreview`; closing clears the preview.

**Contract**: trigger and picker are one Radix `Popover` (trigger = anchor); items follow the cmdk identity contract in Critical Implementation Details. All controls carry roles + accessible names sufficient for role-based e2e (trigger `aria-label`, popover semantics from Radix).

#### 5. Shell wiring

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Mount `useLens` + `useLensKeymap` above `useCombinedBoardState`, feed `effectiveCriteria` into it, render `LensTrigger`/`LensPicker` in the `trailing` slot beside `BoardSettingsMenu`, and pass `buildLensOptions` its visible-cohort inputs.

**Contract**: the board stays an orchestrator — no lens logic inline, only hook destructuring and prop wiring. Update the stale `trailing` docblock (`PlanSummaryBar.tsx:25` still says "the drag-hint toggle") to describe the slot's real contents — per the lessons rule, a doc that cites a mechanism updates with the change.

### Success Criteria:

#### Automated Verification:

- `pnpm test` — `buildLensOptions` tests (visible-cohort filtering, combined cohort-tagging, teacher filtering), `mergeEffectiveCriteria` tests, `use-lens-keymap` tests green
- `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm build` clean

#### Manual Verification:

- Trigger click and ⌘K both open the same picker; typing filters across all three groups
- Checking items dims/rings the board live and the union grows; unchecking shrinks it; arrowing previews without committing; closing the picker drops the preview but keeps committed criteria
- Esc closes the picker; a second Esc clears the lens; Esc inside the settings popover, hours popover, and collision dialog does NOT clear the lens
- **Readability on the monochrome design**: matched chips look exactly as before plus a ring; dimmed chips stay legible; a dimmed blocking/warning chip still reads red/amber; verified in both light and dark themes
- Lens active during a drag composes acceptably (dim + drag visuals stack; hints/validation unaffected)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Active-Lens Bar + counts + a11y

### Overview

Criteria visibility once the picker closes: the "applied filters" bar under the summary bar, per-criterion and total counts, the zero-match message, and the polite live region.

### Changes Required:

#### 1. Count aggregation (pure)

**File**: `src/_pages/plan-detail/model/lens.ts` (extend) + tests

**Intent**: `combineLensCounts(visibleLensMatches[], criteria)` — sum per-criterion counts and union totals across visible cohorts (placement ids are globally unique, so totals are plain sums).

**Contract**: returns `{ total: number, byCriterion: Map<criterionId, number> }`; a criterion absent from every visible cohort yields 0 (the `·0` chip).

#### 2. Lens bar

**File**: `src/_pages/plan-detail/ui/lens/LensBar.tsx` (new, exported from the barrel) + component test

**Intent**: Slim bar rendered only while criteria exist: one chip per criterion (kind icon; course chips reuse their `SubjectColor` swatch, teacher/student chips neutral; label; `·N` count; `×` remove), a union total ("14 placements" / zero-match message when 0), and Clear all. Clicking a chip body reopens the picker. The `role="status"` live region is deliberately **not** inside this bar — the bar unmounts at zero criteria, which would silence the first-criterion and lens-cleared announcements; the region lives in the shell (see #3).

**Contract**: reads the same `useLens` state + `combineLensCounts` output via props from the shell — nothing new threads through the grid wiring. Chips and buttons carry accessible names (`Remove <label> from lens`, `Clear lens`); count text is the e2e-assertable outcome. Semantic tokens only.

#### 3. Shell placement

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Render `LensBar` with the `PlanSummaryBar` in the `BoardShell` header slot (a fragment) so it spans both columns and rides the sticky header chrome — plus a **permanently-mounted** visually-hidden `role="status"` live region in the shell (mounted regardless of criteria, so screen readers register the region before its first update).

**Contract**: bar mounts/unmounts on `criteria.length`; ~36px vertical cost only while active. The live region announces on **committed**-criteria changes only — the match total while criteria exist, a "lens cleared" message on clear; preview (`effectiveCriteria`) changes never announce (no per-arrow spam). Update the stale `BoardShell.tsx:33` docblock ("the `header` is always `PlanSummaryBar`") to reflect the fragment.

### Success Criteria:

#### Automated Verification:

- `pnpm test` — `combineLensCounts` + `LensBar` component tests (chips with counts, remove, clear-all, zero-match message) green
- `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm build` clean

#### Manual Verification:

- Bar appears with criteria and disappears when cleared; counts are correct per criterion and in total on the combined view; an off-screen cohort's criterion shows `·0` on a focused view
- `×` removes live; Clear all empties; clicking a chip body reopens the picker
- Zero-match state shows the explanatory message instead of an unexplained fully-dimmed board
- VoiceOver announces the total when criteria change (spot check)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: Session persistence + e2e

### Overview

The lens survives focus switches and reloads within the tab, and one e2e spec pins the end-to-end contract.

### Changes Required:

#### 1. Guarded session codec

**File**: `src/_pages/plan-detail/lib/lens-session.ts` (new) + test

**Intent**: Plain guarded functions (not a micro-store — see Critical Implementation Details): read/validate and write the criteria list for a plan.

**Contract**: `readLensSession(planId): LensCriterion[]` — `typeof window` guard + try/catch + shape validation (a `isLensCriterion` guard; malformed payload → `[]`); `writeLensSession(planId, criteria)` — guarded no-op on failure, removes the key when empty. Key: `planner-lens:<planId>`.

#### 2. Rehydrate + write-through

**File**: `src/_pages/plan-detail/ui/lens/use-lens.ts` (extend)

**Intent**: On mount (post-hydration effect), read the session, prune with `pruneCriteria` against the plan-wide entity universe (both cohorts' `courseDisplay` keys ∪ **both cohorts' catalogs'** `teacherKeys` — the same union the loader builds for `teacherNames`, `api/load.ts:91-95` — ∪ both cohorts' `studentNames`; never the visible-cohort subset, so an off-screen cohort's criteria survive but deleted entities don't), and commit; write through on every criteria change.

**Contract**: hydration-safe per Critical Implementation Details; pruning is the pure `model/lens.ts` function.

#### 3. E2E spec

**File**: `e2e/specs/lens-highlight.spec.ts` (new)

**Intent**: One authenticated spec pinning the user-visible contract, reusing `e2e/support/` plumbing (plan/entity lifecycle, board helpers) with unique test data and plan-delete teardown.

**Contract**: role+name locators only. Flow: seeded plan with placements → open picker via trigger → search + check a course → assert the bar chip and the count text → ⌘K reopens → add a teacher criterion → assert updated count → `×` remove → Clear all / Esc → assert bar gone. Visual dimming is *not* asserted (unit-tested logic; e2e asserts the count/bar outcome per convention).

### Success Criteria:

#### Automated Verification:

- `pnpm test` — `lens-session` tests (guard behavior, invalid payload, empty-remove) and `pruneCriteria` tests green
- `pnpm test:e2e` — `lens-highlight.spec.ts` green (local Supabase + built preview)
- `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm build` clean

#### Manual Verification:

- Build a lens on DP1 → switch to Combined → lens intact (counts now span both cohorts) → switch to DP2 → intact with `·0` chips where applicable
- Reload the tab: lens intact; open the same plan in a new tab: clean board
- Storage-blocked degradation: lens still works within the page when sessionStorage throws (spot check via devtools protocol or private mode)

**Implementation Note**: After completing this phase and all automated verification passes, the change is done — run the full `/verify` gate before closing out.

---

## Testing Strategy

### Unit Tests:

- `model/lens.test.ts` — `deriveLensMatches` (per-kind matching, OR-union with overlaps, counts, unknown keys, empty → null, pending placements), `buildLensOptions` (visible-cohort filtering, combined cohort tags, teacher filtering), `mergeEffectiveCriteria` (dedup, no-preview passthrough), `pruneCriteria`, `combineLensCounts`
- `ui/lens/use-lens-keymap` — ⌘K/Ctrl-K open, editable-target and defaultPrevented guards, Esc-clear gating (mirrors `use-undo-keymap.test.tsx`)
- `lib/lens-session.test.ts` — guarded read/write, malformed payloads, empty-remove
- `ui/lens/LensBar` component test — chips, counts, remove/clear, zero-match message

### Integration Tests:

- None — the lens is client-only view state; it performs no Supabase reads or writes.

### Manual Testing Steps:

Consolidated per phase above; the cross-cutting ones: monochrome readability (light + dark), Esc layering against every overlay, lens × drag composition, combined-view counts, focus-switch/reload/new-tab persistence matrix.

## Performance Considerations

`deriveLensMatches` is one O(N × criteria) pass over placements (N ≤ ~100) into a `Set` — strictly cheaper than the existing per-cell collision derivation. Its memo is keyed `[placements, catalogById, criteria]`, so lens changes never re-run collision/hint memos, and placement mutations re-run the lens memo alongside them without stacking meaningfully. Live preview re-derives per keystroke/arrow — still one linear pass. No memoization of `PlacedChip` is needed (and `chipWiring` freshness would defeat it anyway — see `SlotCell.tsx:103`).

## Migration Notes

None — no schema, no persisted server state, no data migration. Rollback is a code revert.

## References

- Research (incl. both follow-ups): `context/changes/planner-board-search-discovery/research.md`
- Normative convention + worked example: `context/foundation/ui-conventions.md` §"State management"
- State-store investigation this builds on: `context/archive/2026-07-03-board-view-state-store/frame.md`
- Threading templates: `justDuplicated` (`model/use-board-derivations.ts:83-95`), `hintMode` (`ui/grid/PlannerGrid.tsx:166-185`), `dimmed` (`ui/grid/slot-cell/SlotCell.tsx:128`)
- Selector idiom: `shared/ui/multi-select.tsx:34`; keymap template: `model/history/use-undo-keymap.ts`
- E2E rules: `e2e/CLAUDE.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Lens Engine — model, derivation, wiring, chip visuals

#### Automated

- [x] 1.1 `pnpm test` green incl. new `model/lens.test.ts` — 040547d
- [x] 1.2 `pnpm check` clean — 040547d
- [x] 1.3 `pnpm lint` and `pnpm steiger` clean — 040547d
- [x] 1.4 `pnpm build` clean — 040547d

#### Manual

- [x] 1.5 Board renders/behaves identically with no lens (all three surfaces) — 040547d

### Phase 2: Trigger + Picker — the lens becomes usable

#### Automated

- [x] 2.1 `pnpm test` green incl. `buildLensOptions` + `use-lens-keymap` tests
- [x] 2.2 `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm build` clean

#### Manual

- [x] 2.3 Trigger + ⌘K open the same picker; search filters all groups
- [x] 2.4 Live union on check/uncheck; preview-on-navigate; preview drops on close
- [x] 2.5 Esc layering correct against picker, settings/hours popovers, collision dialog
- [x] 2.6 Monochrome readability verified (matched ring, dimmed legibility, collision hues, light + dark)
- [x] 2.7 Lens × drag composition acceptable

### Phase 3: Active-Lens Bar + counts + a11y

#### Automated

- [ ] 3.1 `pnpm test` green incl. `combineLensCounts` + `LensBar` tests
- [ ] 3.2 `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm build` clean

#### Manual

- [ ] 3.3 Bar chips + counts correct (combined and focused views, `·0` case)
- [ ] 3.4 Remove/Clear all/chip-reopens-picker interactions work
- [ ] 3.5 Zero-match message shows instead of an unexplained fully-dimmed board
- [ ] 3.6 VoiceOver announces the total when criteria change

### Phase 4: Session persistence + e2e

#### Automated

- [ ] 4.1 `pnpm test` green incl. `lens-session` + `pruneCriteria` tests
- [ ] 4.2 `pnpm test:e2e` green incl. `lens-highlight.spec.ts`
- [ ] 4.3 `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm build` clean

#### Manual

- [ ] 4.4 Focus-switch matrix: DP1 → Combined → DP2 lens intact (counts span cohorts, `·0` chips)
- [ ] 4.5 Reload keeps the lens; a new tab starts clean
- [ ] 4.6 Storage-blocked degradation: lens still works in-page when sessionStorage throws
