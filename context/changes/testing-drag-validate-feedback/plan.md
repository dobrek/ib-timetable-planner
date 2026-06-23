# Drag → validate → feedback loop + persistence reload-restore — Implementation Plan

## Overview

Write the **test suite** (not feature code) for test-plan §3 **Phase 3**, covering two risks
in the planner island:

- **Risk #2** — the drag → action → grid feedback loop renders the wrong verdict. Research
  established that validation is a **pure client-side derivation** (`deriveCellViolations` over
  local placement state); the server returns no verdict. So the literal "server says invalid, UI
  stays valid" cannot occur. Risk #2 is re-aimed at its real failure surface:
  **does optimistic placement correctly reconcile / roll back so the locally-derived verdict
  recomputes off true persisted state?**
- **Risk #4** — placed work is lost on reload. Reload re-runs the Astro frontmatter →
  `loadPlannerData` → re-seeds the island's `useState`; no placement lives in any client cache.

Standing up the repo's **first React (jsdom + RTL) test lane** is a prerequisite and lands as
Phase 1. Persistence proofs reuse the mature integration factory harness; the single e2e reuses
(and promotes to shared support) the dnd-kit drag helpers already proven in
`e2e/specs/cohort-switching.spec.ts`.

## Current State Analysis

- **Validation is client-side only.** `createPlacement` (Astro Action → `insertPlacement`)
  persists a row and returns it; it runs **zero** collision checks. The verdict is a `useMemo`
  recompute of `deriveCellViolations(placements, …)` (`PlannerBoard.tsx:201-211`) surfaced as
  `aria-invalid={blocking}` on each `PlacedChip` (`PlacedChip.tsx:54-66`).
- **Optimistic state is plain `useState`** (`use-placements.ts:63`), mutated through pure
  transitions in `placement-transitions.ts` (`addOptimistic/addReconcile/addRollback`,
  `moveReconcile/moveRollback`, `setWeek*`, `settleMany`). Reconciliation is **id reconciliation**
  (temp id → server row), not verdict reconciliation. **The pure transitions already have unit
  coverage** (`placement-transitions.test.ts`); what is **untested is the async orchestration glue**
  in `use-placements.ts` (optimistic → await persist → reconcile/rollback, pending-flag lifecycle).
- **Sharpest real Risk #2 divergence: the move old-row-cleanup failure** (`use-placements.ts:177-182`).
  After a successful move-reconcile, a failed DELETE of the **origin** cell only sets an error
  message — no rollback. The course is left persisted in **both** cells server-side while the live
  board shows only the destination; a **reload surfaces a duplicate the live board never showed.**
- **`insertPlacement` is idempotent, not validating** (`placements.ts:48-78`): on
  `UNIQUE_VIOLATION` it loads and returns the existing row, so a double-drop "succeeds" silently
  with no duplicate. The only DB-enforced rule is `placements_unique (plan_id, cohort, day, period,
  course_id)` — **`week` is excluded**, so a week flip is an UPDATE (`updatePlacementWeek`).
- **Reload-restore is server-round-trippable.** `loadPlannerData(supabase, planId, cohort)`
  (`load.ts:64,94-100`) SELECTs placements into `props.placements`; the island seeds
  `useState(initial)` from it. Asserting the loader's returned `props.placements` equals what was
  written proves restore at the production read boundary.
- **Test-infra gap (now the Phase 1 enabler):** both Vitest configs are `environment: "node"`;
  **no `@testing-library/react`, no jsdom/happy-dom, zero `.test.tsx`.** Vitest 4 supports
  `test.projects` (the `workspace` field is deprecated) — the path to a second jsdom project under
  the same `pnpm test` run. The integration factory harness (`src/test/factories/`) and the
  Playwright e2e harness (`e2e/`) are mature and reusable.
- **The e2e drag is already solved.** `cohort-switching.spec.ts` carries a stepped-pointer
  `placeFromPalette` helper (dnd-kit's pointer sensor is not driven by Playwright `dragTo`) plus a
  full set of board locators (`cell`, `paletteChip`, `placedChip`, `collisionBadge`) and catalog
  authoring (`createCourse`, `createStudent`, `computeGroupings`, …) — all **local to that spec**.
  `e2e/support/planner.ts` holds the lifecycle/cold-start plumbing (`createPlan`, `gotoStable`,
  `clickToReveal`, `createTeacher`, `deletePlan`).

## Desired End State

`pnpm test` runs two Vitest projects (node `unit` + jsdom `dom`) green; a `use-placements` hook
test proves optimistic reconcile/rollback and that the re-derived verdict recomputes off settled
state. `pnpm test:integration` proves reload-restore through `loadPlannerData` across weeks
both/a/b, surfaces the move-duplicate hazard at the loader boundary, and asserts double-drop
idempotency. `pnpm test:e2e` runs one drag→feedback spec proving a real collision visibly renders
`aria-invalid` in a real browser, built on board helpers promoted to `e2e/support/`. The §5
"drag→feedback e2e / island integration" CI gate is satisfied.

### Key Discoveries:

- Verdict is local: `deriveCellViolations` (`collisions.ts:37-67`) → `aria-invalid` (`PlacedChip.tsx:54-66`).
- Async glue is the untested seam: `use-placements.ts:104-110` (add), `:177-182` (move + origin DELETE).
- Reload read path: `loadPlannerData` (`load.ts:64,94-100`) ← `placements.integration.test.ts` is the template.
- dnd-kit drag recipe already exists: `cohort-switching.spec.ts` `placeFromPalette` (stepped `page.mouse`, `toPass`, idempotent).
- Vitest 4 `test.projects` with `extends: true` inherits the root `test.alias` (the `astro:*` virtual-module stubs).

## What We're NOT Doing

- **Not fixing the non-atomic move.** The move old-row-cleanup duplicate is a real bug; this is a
  **test phase**, so we *document* it at the stable boundary and **flag a follow-up change** to make
  the move atomic / roll back on origin-DELETE failure. No production code in `use-placements.ts`
  changes here.
- **Not testing bundle parked-state restore (Risk #7).** S-05 (`ready`) and S-07 (`proposed`)
  have not shipped — bundle move is still delete+recreate and `slot_bundles` holds opt-outs only.
  Risk #7 folds into a later phase when those slices land. (`slot_bundles` opt-out rows already
  round-trip through `load.ts` and are not re-litigated here.)
- **Not adding cross-author / IDOR coverage.** Deferred (ownership-column + real-RLS prerequisite,
  candidate Phase 2.5); integration uses the service-role key, which bypasses RLS.
- **Not asserting the sub-200ms validation budget.** Verified manually by team decision (§7 exclusion).
- **Not a component render test of `PlannerBoard`.** The hook test + e2e cover the verdict path; a
  full island render in jsdom (dnd-kit) is brittle and duplicates the e2e.

## Implementation Approach

Cheapest-signal-first, asserting only through the boundaries that survive the coming
S-03/S-04 collision-core rewrite (§1 principle #4): the **`deriveCellViolations` verdict map**, the
**`loadPlannerData` round-trip**, and the **role+ARIA grid contract** (`gridcell` by name, chip
`aria-invalid`). Pure transitions are already unit-covered, so the hook test targets only the async
orchestration the transitions tests cannot reach. Oracle discipline carries over: every expected
valid/invalid verdict comes from a hand-built fixture, never recomputed from the validator.

## Critical Implementation Details

- **Vitest project aliasing.** The jsdom project must keep the `astro:env/server` / `astro:actions`
  virtual-module stubs reachable (slice code imports them transitively). Use `extends: true` on the
  project so it inherits the root `test.alias`, or repeat the alias block — the hook test mocks
  `../api/placement-client` with `vi.mock`, but `use-placements` still imports the transition module
  which reaches `@/shared/*`.
- **Single React instance in tests — a test-only concern, separate from dev and build.** Three
  independent worlds, do not conflate them:
  - *Astro dev SSR* — the `ssrPrebundleDeps` plugin in `astro.config.mjs` is **dev-only** (its own
    comment notes `optimizeDeps` does not affect the production build). It fixes a different cause:
    Vite **lazily re-optimizing** mid-render and swapping in a second `react` chunk during SSR.
    Irrelevant to tests; do not reintroduce or extend it for this work.
  - *Production build (`pnpm build`, workerd)* — **not affected at all.** React resolves once through
    the normal bundle graph; there is no `optimizeDeps` re-discovery and no jsdom. Nothing in the
    test config feeds the build.
  - *Vitest jsdom project* — the only place this plan touches. When RTL renders client React under
    jsdom, a **single** `react`/`react-dom@19` instance must resolve through Vitest's module graph.
    With `vite-tsconfig-paths` + one hoisted React this is already the case, so **no action is
    expected**. *Only if* an "invalid hook call" surfaces, add `resolve.dedupe: ["react", "react-dom"]`
    to the jsdom project in `vitest.config.ts` — a module-resolution dedup (distinct mechanism from
    the dev plugin's re-optimization-timing fix), scoped to `pnpm test` alone.
- **RTL async settling.** Optimistic→reconcile/rollback spans a microtask; assert post-await state
  with `await waitFor(...)` (or `act` around the resolved mock), not a synchronous read.
- **dnd-kit drag is non-obvious.** Do not reinvent the drag — reuse the promoted `placeFromPalette`
  (stepped `page.mouse.move` past the activation distance, settle move, `toPass` + idempotent skip).

---

## Phase 1: DOM test lane scaffolding (enabler)

### Overview

Stand up the repo's first React/DOM test environment as a second Vitest project so `pnpm test`
runs both node and jsdom tests, with `@testing-library/react` + jest-dom matchers + auto-cleanup
wired. Prove the lane with a trivial render smoke test.

### Changes Required:

#### 1. Test dependencies

**File**: `package.json`

**Intent**: Add the DOM test toolchain as devDependencies. No new scripts — the lane runs under the
existing `pnpm test` (`vitest run`).

**Contract**: Add `jsdom`, `@testing-library/react` (v16+, React 19 compatible),
`@testing-library/dom` (its peer), `@testing-library/jest-dom`. Versions resolved via the package
manager at install; React stays the single hoisted `^19.2.7`.

#### 2. Vitest projects config

**File**: `vitest.config.ts`

**Intent**: Convert the single node config into a two-project config: keep the existing `unit`
project (node, `src/**/*.test.ts` excluding integration) unchanged, and add a `dom` project (jsdom,
`src/**/*.test.tsx`) with a setup file. Shared `plugins` + `test.alias` (the `astro:*` stubs) apply
to both.

**Contract**: `test.projects: [ { name: "unit", environment: "node", include/exclude as today },
{ extends: true, name: "dom", environment: "jsdom", include: ["src/**/*.test.tsx"],
setupFiles: ["./src/test/setup-dom.ts"] } ]`. Root keeps `plugins: [tsconfigPaths()]` and
`test.alias` so `extends: true` carries the virtual-module stubs into the jsdom project. The
integration config (`vitest.integration.config.ts`) is untouched.

#### 3. DOM setup file

**File**: `src/test/setup-dom.ts`

**Intent**: Register jest-dom matchers and RTL auto-cleanup for the jsdom project.

**Contract**: `import "@testing-library/jest-dom/vitest";` and an `afterEach(cleanup)` from
`@testing-library/react`. No global env mutation beyond matchers/cleanup.

#### 4. TypeScript recognises the lane

**File**: `tsconfig.json` (or the test-scoped tsconfig if one governs `src/test`)

**Intent**: Ensure jest-dom matcher types and the jsdom global resolve under `astro check`.

**Contract**: Add the jest-dom/vitest matcher types to `compilerOptions.types` (or rely on the
`/vitest` side-effect import if it augments globally); keep `astro check` green.

#### 5. Lane smoke test

**File**: `src/test/dom-lane.test.tsx`

**Intent**: A minimal `render(<div>…</div>)` + `screen.getByText` proving the jsdom project loads,
RTL renders, and matchers work — so a failure here points at infra, not a feature test.

**Contract**: One `it` rendering a trivial element and asserting `toBeInTheDocument()`.

#### 6. Cookbook note

**File**: `context/foundation/test-plan.md` (§6 cookbook — new §6.x or extend §6.1)

**Intent**: Document how to add a React/hook test in the new lane (location `*.test.tsx`, the `dom`
project, RTL + `renderHook`), so the next contributor doesn't re-derive it.

**Contract**: A short prose entry pointing at `setup-dom.ts`, the `dom` project, and the first
example (`use-placements.test.tsx`, Phase 2). Prose only — no strategy change.

### Success Criteria:

#### Automated Verification:

- Type-check passes: `pnpm check`
- Lint passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Both Vitest projects run and pass: `pnpm test` (node `unit` + jsdom `dom` smoke)
- Production build stays clean: `pnpm build`

#### Manual Verification:

- `pnpm test` output shows two named projects (`unit`, `dom`) executing.
- The smoke `.test.tsx` fails loudly if the jsdom environment or RTL is misconfigured (verified by a temporary intentional break, then reverted).

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Risk #2 — optimistic reconciliation hook test (jsdom lane)

### Overview

Prove the async orchestration in `use-placements` reconciles/rolls back correctly and that the
re-derived `deriveCellViolations` verdict recomputes off the settled state — the real Risk #2
surface. Pure transitions are already covered; this targets only the hook glue.

### Changes Required:

#### 1. Hook test

**File**: `src/_pages/plan-detail/model/use-placements.test.tsx`

**Intent**: `renderHook(() => usePlacements(initial, args))` with `vi.mock("../api/placement-client")`
controlling `createPlacement`/`deletePlacement`/`updatePlacementWeek`. Drive the public API
(`addCourse`, `movePlacement`, `setWeek`) and assert the optimistic→settled lifecycle.

**Contract**: Cover —
- **Add reconcile**: `addCourse` → an optimistic `pending` row appears immediately → after the
  mocked `createPlacement` resolves with a server row, the temp id is replaced and `pending` clears.
- **Add rollback**: mocked `createPlacement` rejects → the optimistic row is removed and `error` is set.
- **Move reconcile + origin cleanup**: `movePlacement` → optimistic move (`pending` at destination)
  → `createPlacement` resolves (reconcile) → `deletePlacement` resolves (no error).
- **Move persist failure rollback**: destination `createPlacement` rejects → row returns to origin, `error` set.
- **setWeek a↔b**: optimistic week flip → `updatePlacementWeek` resolves → reconciled; reject → rolled back.
- **Verdict recomputes off truth**: after each settled state, run the hook's `placements` through
  `deriveCellViolations` with a hand-built catalog fixture and assert the `blocking` set — an
  accepted non-colliding drop yields no `blocking`; a colliding drop (two courses sharing a
  student/teacher, hand-built oracle) yields the expected `blockingIds`. Cover week **both**
  (overlaps) vs **a/b** (opposite weeks → no collision).

Use `await waitFor(...)` for post-await assertions. Expected verdict values are hand-typed from
requirements, never recomputed from the validator.

### Success Criteria:

#### Automated Verification:

- Type-check passes: `pnpm check`
- Lint passes: `pnpm lint`
- Hook test passes in the `dom` project: `pnpm test`
- Oracle integrity: temporarily breaking a transition (e.g. force `addReconcile` to drop the row) reddens the test; revert.

#### Manual Verification:

- The test asserts through the hook's public return + `deriveCellViolations`, not internal function wiring (survives the S-03/S-04 rewrite).
- Week both vs a/b verdict branches are both exercised.

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 3: Risk #2 + #4 — persistence integration (real Supabase)

### Overview

Prove placed work survives reload through the production loader, surface the move-duplicate hazard
at that same boundary (test-only), and pin double-drop idempotency. Reuses the factory harness;
`placements.integration.test.ts` is the closest template.

### Changes Required:

#### 1. Reload-restore round-trip

**File**: `src/_pages/plan-detail/api/reload-restore.integration.test.ts` (or extend `placements.integration.test.ts`)

**Intent**: Write placements via the factory (`placeCourse` → real `insertPlacement`) across weeks
both/a/b, then call `loadPlannerData(supabase, planId, cohort)` and assert the returned
`props.placements` equals exactly what was written.

**Contract**: Assert id/course_id/day/period/**week** equality for each placed row; assert no extra
or missing rows. Drives the same loader a browser reload triggers (`load.ts:64,94-100`).

#### 2. Move-duplicate divergence (hazard documentation)

**File**: same integration suite (a distinct `describe`)

**Intent**: Reproduce the move old-row-cleanup failure at the persistence layer — a destination
insert succeeds and the origin row is **not** deleted — then show `loadPlannerData` returns the
course in **both** cells, the duplicate the live board never showed.

**Contract**: Build the two-row server state directly (insert destination, leave origin), call
`loadPlannerData`, assert two placements for the same course at different cells. Comment links the
hazard to `use-placements.ts:177-182` and names the follow-up change. This documents, does not fix.

#### 3. Double-drop idempotency

**File**: same integration suite (a distinct `describe`)

**Intent**: Prove the only DB-enforced rule's idempotent handling — a repeated insert of the same
`(plan, cohort, day, period, course)` returns the same row and leaves exactly one row.

**Contract**: Call `insertPlacement` twice with identical args; assert the returned row id is stable
and a follow-up SELECT (or `loadPlannerData`) shows exactly one matching row, no thrown error.

### Success Criteria:

#### Automated Verification:

- Integration suite passes against local Supabase: `pnpm test:integration`
- Type-check passes: `pnpm check`
- Lint passes: `pnpm lint`
- No-seed-coupling guard stays green (suite owns its plan, tears down via `teardown`): `pnpm test`

#### Manual Verification:

- Reload-restore asserts restored `props.placements`, not merely that the DB write happened.
- The move-duplicate test reds out if the (future) atomic-move fix lands — i.e. it genuinely depends on the non-atomic behavior, and its comment flags the follow-up.
- Week a/b restore is covered, not just `both`.

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 4: Risk #2 — drag→feedback e2e (browser, ≤1) + promote shared board helpers

### Overview

Promote the board drag/locator/authoring helpers currently local to `cohort-switching.spec.ts` into
`e2e/support/`, refactor that spec to consume them with **zero behavior change** (it stays green),
then add one drag→feedback spec proving a real collision visibly renders `aria-invalid` in a real
browser. Satisfies the §5 CI gate.

### Changes Required:

#### 1. Promote board interaction helpers

**File**: `e2e/support/board.ts` (new)

**Intent**: Move the reusable, spec-agnostic board helpers out of `cohort-switching.spec.ts` —
`display`, `escapeRegExp`, the role locators (`cell`, `paletteChip`, `placedChip`, `collisionBadge`),
`computeGroupings`, and above all the dnd-kit `placeFromPalette` stepped-pointer drag — so a second
spec reuses the solved drag instead of copy-pasting it.

**Contract**: Exported functions/locators taking `(page, …)`. Behavior identical to the current
`cohort-switching.spec.ts` definitions — a pure move, not a rewrite. Not a `*.spec.ts`/`*.setup.ts`
file, so Playwright's `testMatch` does not collect it (mirrors `planner.ts`).

#### 2. Promote catalog authoring helpers

**File**: `e2e/support/catalog.ts` (new) — or fold into `board.ts` if the implementer prefers one module

**Intent**: Move `createCourse`, `createStudent`, `selectFromCombobox`, `pickInMultiSelect` out of
the spec so the new spec can author a placeable, colliding fixture without duplication.

**Contract**: Exported authoring helpers, behavior-identical to the spec's current copies. The
`planner.ts` comment that deliberately kept these spec-local is now superseded — the second consumer
is the promotion trigger; update that comment to point at the shared module.

#### 3. Refactor the existing spec onto shared helpers

**File**: `e2e/specs/cohort-switching.spec.ts`

**Intent**: Replace the now-promoted local definitions with imports from `e2e/support/board.ts`
(+ `catalog.ts`). Spec-specific bits (cross-cohort dialog assertions, `switchCohort`,
`otherCohortViolation`, `openCollisionDialog`, `closeDialog`) stay local unless a second consumer
emerges.

**Contract**: No assertion or flow change — the spec must remain green and prove the same
cross-cohort facts. This is the regression guard that the promotion was behavior-preserving.

#### 4. Drag→feedback spec

**File**: `e2e/specs/drag-validate-feedback.spec.ts` (new, authenticated `chromium` project)

**Intent**: Build a single-cohort collision via the promoted authoring helpers (a teacher teaching
two courses, each made placeable by a student choosing it), then drag to prove the verdict renders:
an accepted first drop reads valid (no `aria-invalid`), and a second drop of the conflicting course
onto the **same slot** reads `aria-invalid="true"` (over-rejection guard built into one flow).

**Contract**: Reuse `createPlan`/`createTeacher`/`deletePlan` (`planner.ts`) + promoted
`createCourse`/`createStudent`/`computeGroupings`/`placeFromPalette`/`placedChip`/`cell`. Assert
`placedChip(...).toHaveAttribute("aria-invalid", "true")` for the colliding chip and absence/`"false"`
for the clean one, via role-only locators. Owns a uniquely named plan; tears down via `deletePlan`.
`test.describe.configure({ timeout: 120_000 })` (multi-page catalog build, like the sibling spec).

#### 5. Quality-gate note

**File**: `context/foundation/test-plan.md` (§5 enforcement note + §6.3 e2e cookbook)

**Intent**: Record that the drag→feedback e2e gate is now live and point §6.3 at the shared
`e2e/support/board.ts` drag helper as the canonical dnd-kit recipe.

**Contract**: Prose update reflecting Phase 3 landed; no strategy change.

### Success Criteria:

#### Automated Verification:

- The new spec passes against the workerd preview: `pnpm test:e2e`
- The refactored `cohort-switching.spec.ts` still passes: `pnpm test:e2e`
- Lint passes: `pnpm lint`
- FSD/structure unaffected (e2e is outside `src`): `pnpm steiger`

#### Manual Verification:

- The drag genuinely places (not a no-op) — the clean drop renders a chip before the colliding drop.
- The colliding chip's `aria-invalid` is read via role+name, with no `data-*` escape hatch.
- The promotion is behavior-preserving: `cohort-switching.spec.ts` diff is import-only, assertions unchanged.

**Implementation Note**: Pause for manual confirmation after automated verification passes. This is the final phase.

---

## Testing Strategy

### Unit Tests (jsdom `dom` lane):

- `use-placements` async orchestration: add reconcile/rollback, move reconcile + origin cleanup, move-failure rollback, setWeek a↔b.
- Verdict recompute off settled state via `deriveCellViolations` (hand-built oracle), week both vs a/b.

### Integration Tests (local Supabase):

- Reload-restore round-trip through `loadPlannerData` (weeks both/a/b).
- Move-duplicate hazard surfaced at the loader boundary (test-only documentation).
- Double-drop idempotency.

### E2E (Playwright, workerd preview):

- One drag→feedback spec: clean drop valid, colliding drop `aria-invalid`, via promoted shared helpers.

### Manual Testing Steps:

1. Run `pnpm test` and confirm both `unit` and `dom` projects execute.
2. Run `pnpm test:integration` with the local stack up; confirm reload-restore + idempotency pass and the move-duplicate test depends on the non-atomic behavior.
3. Run `pnpm test:e2e`; watch the drag land a chip and the collision flip `aria-invalid`.

## Performance Considerations

The sub-200ms drag-drop validation budget is **not** asserted (manual/by-feel, §7 exclusion). The
jsdom lane adds a second Vitest project; it runs in the same `pnpm test` invocation with negligible
overhead for the handful of `.test.tsx` files.

## Migration Notes

No schema or runtime code changes. The only production-adjacent edits are devDependency additions
and the `vitest.config.ts` projects restructure (the node `unit` project must keep its exact current
include/exclude so the 55 existing unit tests are unaffected). The e2e helper promotion is a
behavior-preserving move guarded by the refactored `cohort-switching.spec.ts` staying green.

## Follow-up (flagged, out of scope here)

Open a separate change to make the move atomic (or roll back the optimistic move on origin-DELETE
failure), removing the duplicate-on-reload hazard that Phase 3 documents at `use-placements.ts:177-182`.

## References

- Research: `context/changes/testing-drag-validate-feedback/research.md`
- Test plan: `context/foundation/test-plan.md` §3 Phase 3, §5 gate, §6 cookbook
- Reload-restore template: `src/_pages/plan-detail/api/placements.integration.test.ts`
- dnd-kit drag recipe + board locators: `e2e/specs/cohort-switching.spec.ts`
- Verdict boundary: `src/_pages/plan-detail/model/collisions.ts:37-67`; render: `.../slot-cell/PlacedChip.tsx:54-66`
- Hook under test: `src/_pages/plan-detail/model/use-placements.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DOM test lane scaffolding (enabler)

#### Automated

- [x] 1.1 Type-check passes: `pnpm check` — a98601c
- [x] 1.2 Lint passes: `pnpm lint` — a98601c
- [x] 1.3 FSD structure check passes: `pnpm steiger` — a98601c
- [x] 1.4 Both Vitest projects run and pass: `pnpm test` — a98601c
- [x] 1.5 Production build stays clean: `pnpm build` — a98601c

#### Manual

- [x] 1.6 `pnpm test` output shows two named projects (`unit`, `dom`) — a98601c
- [x] 1.7 Smoke `.test.tsx` fails loudly on misconfig (intentional break, reverted) — a98601c

### Phase 2: Risk #2 — optimistic reconciliation hook test

#### Automated

- [x] 2.1 Type-check passes: `pnpm check`
- [x] 2.2 Lint passes: `pnpm lint`
- [x] 2.3 Hook test passes in the `dom` project: `pnpm test`
- [x] 2.4 Oracle integrity: breaking a transition reddens the test; revert

#### Manual

- [x] 2.5 Asserts through hook return + `deriveCellViolations`, not internal wiring
- [x] 2.6 Week both vs a/b verdict branches both exercised

### Phase 3: Risk #2 + #4 — persistence integration

#### Automated

- [ ] 3.1 Integration suite passes: `pnpm test:integration`
- [ ] 3.2 Type-check passes: `pnpm check`
- [ ] 3.3 Lint passes: `pnpm lint`
- [ ] 3.4 No-seed-coupling guard stays green: `pnpm test`

#### Manual

- [ ] 3.5 Reload-restore asserts restored `props.placements`, not just the write
- [ ] 3.6 Move-duplicate test genuinely depends on non-atomic behavior; comment flags follow-up
- [ ] 3.7 Week a/b restore covered, not just `both`

### Phase 4: Risk #2 — drag→feedback e2e + promote shared board helpers

#### Automated

- [ ] 4.1 New drag→feedback spec passes: `pnpm test:e2e`
- [ ] 4.2 Refactored `cohort-switching.spec.ts` still passes: `pnpm test:e2e`
- [ ] 4.3 Lint passes: `pnpm lint`
- [ ] 4.4 Structure unaffected: `pnpm steiger`

#### Manual

- [ ] 4.5 Drag genuinely places (clean chip renders before the colliding drop)
- [ ] 4.6 `aria-invalid` read via role+name, no `data-*` escape hatch
- [ ] 4.7 Promotion behavior-preserving: `cohort-switching.spec.ts` diff is import-only
