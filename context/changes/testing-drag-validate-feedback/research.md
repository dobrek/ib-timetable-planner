---
date: 2026-06-23T14:52:22+0200
researcher: Dobromir Kropielnicki
git_commit: 42b9d48b8cae25afddd892824412837b4cefc0a5
branch: main
repository: ib-timetable-planner
topic: "Phase 3 — drag → validate → feedback loop (Risk #2) + persistence reload-restore (Risk #4)"
tags: [research, codebase, plan-detail, planner-island, optimistic-ui, persistence, reload-restore, risk-2, risk-4]
status: complete
last_updated: 2026-06-23
last_updated_by: Dobromir Kropielnicki
---

# Research: Phase 3 — drag → validate → feedback loop (Risk #2) + persistence reload-restore (Risk #4)

**Date**: 2026-06-23T14:52:22+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 42b9d48b8cae25afddd892824412837b4cefc0a5
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

Ground test-plan §3 **Phase 3** ("Drag → validate → feedback loop + persistence reload-restore") in real code, for the two risks it covers:

- **Risk #2** — the drag → action → grid feedback loop renders the wrong verdict; an optimistic UI keeps showing "valid" after the server returns invalid. *Prove a server "invalid" verdict visibly renders as invalid in the grid, and an accepted drop renders valid, with optimistic state reconciling to the server response.*
- **Risk #4** — placed work is lost; a placement does not survive reload/crash. *Prove that after a reload the grid restores exactly the placed state.*

## Summary

Two findings reshape how this phase must be planned:

1. **There is no server-returned validity verdict. Constraint validation is a pure, client-side derivation.** The Astro Action (`createPlacement`) only persists a row and returns the canonical row (or a `DomainError`); it runs **zero** collision/teacher/student-conflict checks. The grid's "invalid" state is a `useMemo` recompute of `deriveCellViolations` over local placement state, re-derived on every state change (`PlannerBoard.tsx` → `useCollisions` → `cell-occupants` → `PlacedChip aria-invalid`). **The literal Risk #2 scenario as worded ("server returns invalid, UI keeps valid") cannot occur — the server computes no verdict.** Risk #2 must be re-aimed at the *real* divergence surface: **does the optimistic placement correctly reconcile/roll back to true persisted state, so the locally-derived verdict recomputes off truth?** The strongest real divergence is the **move old-row cleanup path** (`use-placements.ts:178-182`): a failed DELETE of the origin cell leaves the course persisted in **both** cells server-side with **no rollback** — a reload would surface a duplicate the live board never showed.

2. **Placed state is durably server-sourced on reload.** A browser reload re-runs the Astro server frontmatter for `/plans/[id]/index.astro`, re-queries `placements` via `loadPlannerData`, and re-seeds the island's `useState(initial)`. No placement data lives in any client cache or localStorage (localStorage holds only theme / sidebar / drag-hint-mode). Risk #4 is cleanly server-round-trippable: write via the action → re-run `loadPlannerData` (or reload the route) → assert restored `props.placements` equals what was written.

A **test-infrastructure gap blocks the "component / integration (planner island)" line item**: there is **no DOM test environment and no React Testing Library** in the repo. Both Vitest configs are `environment: "node"`; zero `.test.tsx` / `renderHook` tests exist. The planner-island test would be the **first** React render/hook test — it requires new scaffolding (jsdom/happy-dom env + `@testing-library/react` + setup file) OR the phase routes its Risk #2 proof through a hook test (still needs a DOM/renderHook env) and/or the existing e2e harness. The integration factory harness and the Playwright e2e harness are mature and directly reusable.

## Detailed Findings

### Risk #2 — the drag → validate → feedback loop

#### Architecture headline: validation is client-side only
The server never returns a valid/invalid verdict. The verdict map is recomputed locally from placement state on every change. So the test target is **optimistic-state reconciliation correctness**, not "did the UI honor the server verdict."

#### Drop call chain (palette course drop; move/group/bundle are siblings)
1. dnd-kit `onDragEnd` → `handleDrop(event)` — `src/_pages/plan-detail/ui/PlannerBoard.tsx:87`
2. switch on `data.kind`; `case "course": addCourse(data.courseId, cell)` — `PlannerBoard.tsx:93-108`
3. `addCourse` → `void persistAdd(courseId, cell)` — `src/_pages/plan-detail/model/use-placements.ts:69-71`
4. `persistAdd`: guard `canAdd` → optimistic insert `addOptimistic` → `setPlacements` — `use-placements.ts:97-102`
5. `createPlacement({...})` — `use-placements.ts:105` → `src/_pages/plan-detail/api/placement-client.ts:5-16`
6. `placement-client.ts:13`: `const { data, error } = await actions.createPlacement(args)` (`import { actions } from "astro:actions"`, line 1)
7. Action `createPlacement: defineDomainAction({ input: createPlacementInput, run: insertPlacement })` — `src/_pages/plan-detail/api/placement-actions.ts:12`
8. `insertPlacement` persists + returns canonical `PlannerPlacement` — `src/_pages/plan-detail/api/placements.ts:48-78`
9. success → `setPlacements((prev) => addReconcile(prev, tempId, row))` — `use-placements.ts:106`
10. throw → `addRollback` + `setError` — `use-placements.ts:108-109`

Pure state transitions live in `src/_pages/plan-detail/model/placement-transitions.ts` (`addOptimistic`, `addReconcile`, `addRollback`, `settleMany`, …).

#### Optimistic state and reconciliation
- `const [placements, setPlacements] = useState<LocalPlacement[]>(initial)` — `use-placements.ts:63`. Plain `useState` (no `useOptimistic`/`useReducer`). `LocalPlacement` carries a `pending` flag (rendered at ~60% opacity in the chip). `placementsRef` (`useLatest`) gives async callbacks the live snapshot.
- There is **no separate optimistic "valid" state.** The verdict is always `deriveCellViolations(placements, …)` via `useMemo` (`PlannerBoard.tsx:201-211`). Reconciliation is **id reconciliation** (temp id → server row), not verdict reconciliation.
- Add reconcile/rollback (the load-bearing path), `use-placements.ts:104-110`:
  ```ts
  try {
    const row = await createPlacement({ planId, cohort, courseId, day: cell.day, period: cell.period, week });
    setPlacements((prev) => addReconcile(prev, tempId, row));
  } catch (err: unknown) {
    setPlacements((prev) => addRollback(prev, tempId));
    setError(errorOf(err));
  }
  ```

#### Real divergence surfaces (the right Risk #2 targets) — verified
1. **Move old-row cleanup failure leaves a server-side duplicate, no rollback** — `use-placements.ts:177-182` (verified):
   ```ts
   setPlacements((prev) => moveReconcile(prev, intent.oldId, created));
   try {
     await deletePlacement(intent.oldId);
   } catch (err: unknown) {
     setError({ kind: "message", message: `Move saved but old cell cleanup failed: ${messageOf(err)}` });
   }
   ```
   New row reconciled; origin DELETE fails; only a message is set. Server now holds the course in **both** cells while the board shows only the destination — a **reload surfaces a duplicate the live board never showed.** This is the clearest UI/server divergence in the slice.
2. **Insert is idempotent, not validating** — `placements.ts:48-78` (verified). On `UNIQUE_VIOLATION` it **loads and returns the existing row** (lines 57-71) instead of erroring, so a double-drop "succeeds" silently. The only DB-enforced rule is the `placements_unique` constraint, handled idempotently.
3. **Add/move/remove/setWeek rollback correctness** — each persist path rolls the optimistic mutation back on throw (`addRollback` :108, `moveRollback` :184, `removeRollback` :199, `setWeekRollback`), so the locally-derived verdict recomputes off true state. Group/bundle partial failures settle failed members to `null` via `settleMany` (`use-placements.ts:131-143`) and raise a `groupFailure` banner.

#### How the verdict renders (the user-visible boundary)
Flow: `deriveCellViolations` → `collisions: Map<string, CellCollisions>` (`PlannerBoard.tsx:65`) → `PlannerGrid` → `groupCellOccupants(placements, names, collisions)` → per-occupant `blocking`/`warning`/`unavailable` flags (`src/_pages/plan-detail/ui/.../cell-occupants.ts:42-52`) → `SlotCell` → `PlacedChip`.

`aria-invalid` per chip from the `blocking` flag — `PlacedChip.tsx:54-66`:
```tsx
<div
  ref={ref}
  data-slot="placed-chip"
  aria-roledescription="placement"
  aria-invalid={blocking}      // blocking = collisions?.blockingIds.has(placement.courseId)
  className={cn(chipTone({ tone: blocking ? "blocking" : warning ? "warning" : "neutral" }), ...)}
```
Grid roles (the stable e2e/component locator substrate): `role="grid"` + `aria-label` (`PlannerGrid.tsx:69-70`); `role="row"`; `columnheader`/`rowheader`; `role="gridcell"` + day/period `aria-label`, **named even when empty** (`SlotCell.tsx:91-94`). The A/B week control is a Radix `ToggleGroup type="single"` → `radiogroup`/`radio` with `aria-checked`.

#### Validation core boundary (assert through this, per §1 principle #4)
- **`deriveCellViolations`** — `src/_pages/plan-detail/model/collisions.ts:37-67`. Signature `(placements, catalogById, availability?, occupiedByTeacher?) => Map<string, CellCollisions>`; `CellCollisions = { blockingIds; warningIds; unavailableIds; violations }`. **This is the render-path boundary** and the authoritative committed-placement verdict (also the boundary the Phase 4 parity harness asserts through — `collision-parity.test.ts`).
- `explainCell` (`constraints/index.ts:19-20`) is called *inside* `deriveCellViolations`; `violatesAny` / `deriveDropHints` feed the *drag-time* affordance map (`drop-hints.ts`), separate from the post-drop verdict.

#### Server re-validation: none
`insertPlacement` validates only Zod input shape (`createPlacementInput`, `placements.ts:10-18` — UUIDs, cohort enum, day/period bounds, `week` default `both`). No collision/teacher/student checks server-side. (Note for cross-reference: Risk #1's "server persist refusal" gate is therefore *also* unmet — out of scope for Phase 3, which covers #2/#4, but worth flagging.)

### Risk #4 — persistence reload-restore

#### Verdict: placed state is durably server-sourced on reload
1. Drop → optimistic local placement + `createPlacement` (`placement-client.ts:5`).
2. Action `createPlacement` → `insertPlacement` **INSERTs into `placements`** and returns the row (idempotent on unique violation) — `placements.ts:48-78`. Exact insert (`placements.ts:51-55`):
   ```ts
   const { data, error } = await supabase.from("placements")
     .insert({ plan_id: planId, cohort, course_id: courseId, day, period, week })
     .select().single();
   ```
3. Client reconciles temp id → server id. Row is durable in Postgres.
4. **Browser reload** → Astro re-renders `src/pages/plans/[id]/index.astro:12`: `const result = await loadPlannerData(supabase, Astro.params.id, cohort)` (cohort from `?cohort=`, default `dp1`).
5. `loadPlannerData` (`src/_pages/plan-detail/api/load.ts:30-134`) **SELECTs placements** — `load.ts:64`:
   ```ts
   supabase.from("placements").select("id, course_id, day, period, week").eq("plan_id", id).eq("cohort", cohort)
   ```
   Rows → `PlannerPlacement[]` (`load.ts:94-100`), returned in `props`.
6. Props → `PlanDetailPage.astro` → `<PlannerBoard {...boardProps} client:load />` → `usePlacements(props.placements, …)` → `useState<LocalPlacement[]>(initial)` (`use-placements.ts:63`).
7. Grid renders the exact persisted state. **No client cache is consulted for placements.**

`loadPlannerData`'s `Promise.all` also fetches: `course_groupings` + members (palette), `slot_bundles` → `overrides` (`load.ts:65`), `teacher_availability` (`load.ts:67`), and the **sibling cohort's** placements for cross-cohort occupancy (`load.ts:69`).

#### localStorage is UI-only, never placements
`BaseLayout.astro:22` (theme), `SidebarLayout.astro` (theme + sidebar collapse), `src/_pages/plan-detail/lib/drag-hint-mode.ts:20,32` (per-device drag-hint encoding). "Parked bundles" / unbundle exceptions are server-sourced (`slot_bundles` table), not localStorage.

#### Schema of the durable placed state
- **`placements`** — the grid. Columns: `id` (uuid PK), `plan_id` (FK `plans`, on delete cascade), `cohort` (enum dp1/dp2), `day` (smallint), `period` (smallint), `course_id` (FK `courses`), `week` (enum `both|a|b`, default `both`), `created_at`. Unique `placements_unique (plan_id, cohort, day, period, course_id)` — **`week` excluded**, so a week flip is an UPDATE not a re-insert (`updatePlacementWeek`, `placements.ts:91-100`). Migrations: origin `20260602185012_minimal_domain_schema.sql:115-128`; re-keyed to plan root `20260611180006_plans_as_domain_root.sql:91-103`; week column `20260621130000_bi_weekly_week_columns.sql:21-23`.
- **`slot_bundles`** — per-cell unbundle-exception markers; `20260613123404_slot_bundles.sql`.
- **`course_groupings` / `course_grouping_members`** — palette groupings (not the placed grid); written via `replace_cohort_groupings` RPC.

#### RLS on read (posture today)
Permissive `using (true)` for `authenticated` — `20260602185012_minimal_domain_schema.sql:159,172` (`for all to authenticated using (true) with check (true)`). Grants pin reachability: `authenticated` granted (`20260617171048_…`), `anon` revoked (`20260617205628_…`), `service_role` granted (`20260618203532_…`). Integration tests use the **service-role key, which bypasses RLS** — so reload-restore integration asserts durability, not per-author ownership (cross-author/IDOR remains the deferred Phase 2.5 concern).

### Test infrastructure — what's reusable, what's missing

**Missing (blocks the "component / integration (planner island)" line):**
- Both Vitest configs are `environment: "node"` — `vitest.config.ts` (include `src/**/*.test.ts`, exclude integration) and `vitest.integration.config.ts` (include `*.integration.test.ts`, setup `src/test/load-test-env.ts`). **No jsdom/happy-dom.**
- **No `@testing-library/react` / `@testing-library/dom`** in `package.json`. **Zero** `.test.tsx`, `render(`, `renderHook`, or `screen.` tests exist. The planner island (`PlannerBoard.tsx client:load`) and the `use-placements` hook would be the **first** React render/hook test.
- Decision needed (see Open Questions): add a DOM component-test lane vs. prove Risk #2 via hook-level test (still needs a DOM/renderHook env) vs. push Risk #2 reconciliation proof to the single allowed e2e.

**Reusable as-is:**
- **Integration factory harness** `src/test/factories/` — `createPlan`, `seedPlanCatalog`, `placeCourse` (wraps real `insertPlacement`), `addAvailability`, `addMerge`, `addStudentWithChoices`, `ungroupSlot`, `computeGroupingsFor`, `registerPlan`, `teardown`. Env guard `src/test/load-test-env.ts`; isolation guards `no-seed-coupling.test.ts`, `seed-transcode-identity.test.ts`.
- **Closest reload-restore template**: `src/_pages/plan-detail/api/placements.integration.test.ts` (insert → read round-trip, week-mode agnostic→`both` / biweekly→`a`/`b`). For the *production* reload-restore proof, drive `insertPlacement` then call `loadPlannerData(supabase, planId, cohort)` and assert returned `props.placements` equals what was written. `load.integration.test.ts` already exercises the loader for name records / availability shape.
- **E2E harness** (`playwright.config.ts` + `e2e/`): three projects (`setup` → `storageState`, `chromium` authenticated, `chromium-guard` no-cookies); `auth.setup.ts` (hydration-race-gated login); `webServer = pnpm build && pnpm preview` (real workerd, env via `.dev.vars`); shared `e2e/support/planner.ts` (`createPlan`, `shortId`, `gotoStable`, `clickToReveal`, `deletePlan`); `pretest:e2e` provisions the author. Existing specs include `cohort-switching.spec.ts` and `co-teaching.spec.ts` (already drive the board). The board's role/ARIA substrate makes a drag→feedback spec reachable by role-only locators.
- Scripts: `test` (`vitest run`), `test:watch`, `test:integration`, `pretest:e2e`, `test:e2e`.

## Code References

- `src/_pages/plan-detail/ui/PlannerBoard.tsx:87-116` — `handleDrop` dispatch (course/move/group/bundle)
- `src/_pages/plan-detail/ui/PlannerBoard.tsx:201-211` — `useCollisions`/`deriveCellViolations` `useMemo` (verdict recompute)
- `src/_pages/plan-detail/model/use-placements.ts:63` — `useState<LocalPlacement[]>(initial)` (seeded from server props)
- `src/_pages/plan-detail/model/use-placements.ts:104-110` — add reconcile/rollback
- `src/_pages/plan-detail/model/use-placements.ts:177-182` — **move old-row cleanup failure: server duplicate, no rollback** (verified)
- `src/_pages/plan-detail/model/placement-transitions.ts` — pure optimistic transitions
- `src/_pages/plan-detail/model/collisions.ts:37-67` — `deriveCellViolations` (stable verdict boundary)
- `src/_pages/plan-detail/ui/slot-cell/PlacedChip.tsx:54-66` — `aria-invalid={blocking}` render
- `src/_pages/plan-detail/ui/PlannerGrid.tsx:69-70` / `SlotCell.tsx:91-94` — grid/gridcell roles + names
- `src/_pages/plan-detail/api/placements.ts:48-78` — `insertPlacement` (idempotent, no re-validation) (verified)
- `src/_pages/plan-detail/api/placement-actions.ts:11-15` — Action defs
- `src/_pages/plan-detail/api/placement-client.ts:5-27` — `astro:actions` client bridge
- `src/_pages/plan-detail/api/load.ts:30-134` (esp. `:64`, `:94-100`) — `loadPlannerData` read-back
- `src/pages/plans/[id]/index.astro:9-23` — server frontmatter → island props
- `src/_pages/plan-detail/api/placements.integration.test.ts` — reload-restore template
- `src/test/factories/` (index + builders) — integration harness
- `vitest.config.ts` / `vitest.integration.config.ts` — both `environment: "node"` (no DOM)
- `playwright.config.ts`, `e2e/auth.setup.ts`, `e2e/support/planner.ts` — e2e harness
- `supabase/migrations/20260602185012_minimal_domain_schema.sql:159,172` — permissive `using(true)` RLS
- `supabase/migrations/20260611180006_plans_as_domain_root.sql:91-103` / `20260621130000_bi_weekly_week_columns.sql:21-23` — placements schema + week column

## Architecture Insights

- **The verdict is a local derivation, not a server contract.** This is the single most important reframing for Risk #2: the failure mode is **optimistic-state ↔ persisted-state divergence**, not "UI ignored the server verdict." Tests must prove (a) an accepted drop renders valid and a colliding drop renders `aria-invalid`, both via the *recomputed* verdict, and (b) a failed persist correctly rolls back so the verdict recomputes off truth.
- **Stable boundaries to assert through** (§1 principle #4, ui-conventions "Role + ARIA as the interactive/grid contract"): the **role+ARIA state** of grid elements (`gridcell` by name, chip `aria-invalid`, week `radio` `aria-checked`), the **`deriveCellViolations` verdict map**, and the **`placements` round-trip via `loadPlannerData`**. Never assert internal hook wiring or component structure — the enriched-collision rewrite (S-03/S-04) will move internals.
- **Oracle discipline carries over** (Phase 4 parity convention): any expected valid/invalid verdict in a Phase 3 test comes from requirements (a hand-built colliding fixture), never recomputed from the validator.
- **Week dimension is live.** Scenarios must account for `both` (overlaps every week) vs `a`/`b` (opposite weeks don't collide). The unique key excludes `week`; a week flip is `updatePlacementWeek` (UPDATE).
- **Move = POST-new → DELETE-old, client-orchestrated.** The non-atomicity is the durability hazard worth a targeted test.

## Historical Context (from prior changes)

- `context/archive/2026-06-22-slot-cell-refactor/plan.md:35-37,112-120,305-349` — added the role/ARIA locator substrate (`role="grid"`, named `gridcell`s incl. empty, chip `aria-roledescription`+`aria-invalid`, week `ToggleGroup`→`radio`/`aria-checked`); purged stateful/coordinate `data-*` (kept `data-slot` identity-only); converged week classifiers into `model/week.ts`. **This is the substrate Phase 3's role-only locators rely on.**
- `context/foundation/ui-conventions.md:70-77` — "Role + ARIA as the interactive/grid contract": user-perceivable state expressed via ARIA on role-located elements (`aria-invalid` collision, `aria-checked` A/B, `disabled` pending); `data-*` for identity only, never the test contract.
- `context/archive/2026-06-15-testing-auth-actions-boundary-rls/plan.md:18-54` — the reusable e2e harness (three Playwright projects, `storageState`, `.dev.vars`-to-workerd, `pnpm build && pnpm preview`). Notes the **deferred `createPlan` UI-driven happy-path e2e** — Phase 3 is where a board-mutation e2e can land if integration can't reach the loop.
- `context/archive/2026-06-15-data-for-e2e-and-integration-tests/` + `context/foundation/test-plan.md:127-128` — Phase 0 built the factory harness; **Risk #4 write-then-read-back held, but the production reload-restore path was explicitly deferred to Phase 3** (now in scope).
- `context/archive/2026-06-22-cohort-switching/change.md` — cross-cohort teacher occupancy is week-rich (`Map<teacherKey, Map<cellKey, Set<PlacementWeek>>>`), projected server-side in `load.ts`, shipped as an index; cohort switch is navigate/remount. Phase 3 board scenarios touching cross-cohort must keep this week-aware shape.
- `context/archive/2026-06-22-parity-harness-enriched-validators/change.md` — the parity convention asserts through `deriveCellViolations` with requirement-sourced oracles; Phase 3 verdict assertions must follow the same oracle discipline.

## Related Research

- None prior for this change (first artifact). Adjacent: the archived Phase 2 (`testing-auth-actions-boundary-rls`) and Phase 0 (`data-for-e2e-and-integration-tests`) research/plan docs under `context/archive/`.

## Open Questions

1. **Component-test lane: build it or route around it?** No DOM env / RTL exists. Options for the Risk #2 reconciliation proof, cheapest signal first:
   - (a) **Hook-level test of `use-placements`** (`renderHook` + mocked `placement-client`) asserting optimistic→reconcile and optimistic→rollback, then that `deriveCellViolations` recomputes the verdict off the settled state. Still needs a DOM/`renderHook` env (jsdom + `@testing-library/react`).
   - (b) **Component render test** of `PlannerBoard`/`SlotCell` asserting `aria-invalid` flips with the verdict — heavier (dnd-kit + island) and needs the same new env.
   - (c) **e2e** drag→feedback spec (≤1 allowed) — reuses the mature harness + role locators, but dnd-kit drag in Playwright is the known-hard part.
   - The plan must pick the env-setup cost (new jsdom lane) vs. e2e-only, and decide whether the **move-DELETE-failure divergence** is provable at integration (`loadPlannerData` shows the duplicate) rather than in the UI.
2. **Does the single e2e prove Risk #2 or Risk #4 (or both)?** §3 budgets "≤1 e2e." Candidate: a drag→feedback e2e that also reloads and asserts restore — but dnd-kit drag reliability in Playwright may force Risk #2 down to hook/integration and reserve the e2e for the reload-restore happy path.
3. **Is the move old-row-cleanup divergence in scope as a *fix* or only a *test*?** Phase 3 is a test phase. Recommend: cover it with a failing-persist integration test that asserts the post-reload duplicate is visible (documents the hazard at the stable boundary), and flag the non-atomic move as a follow-up change rather than fixing it inside a test phase.
4. **Bundle-persistence durability (Risk #7) fold-in** — §3 says Phase 3 folds in bundle reload-restore "as S-05 / S-07 ship." Are those slices shipped yet? If not, Phase 3 covers placements (+ slot_bundles already in `load.ts`) and leaves the bundle-park client-restore proof for when the slices land.
