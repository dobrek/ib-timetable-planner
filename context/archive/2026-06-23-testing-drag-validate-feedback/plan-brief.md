# Drag → validate → feedback loop + persistence reload-restore — Plan Brief

> Full plan: `context/changes/testing-drag-validate-feedback/plan.md`
> Research: `context/changes/testing-drag-validate-feedback/research.md`

## What & Why

Write the test suite for test-plan §3 **Phase 3**: the planner's drag → validate → feedback loop
(**Risk #2**) and placement durability across reload (**Risk #4**). Research reframed Risk #2 —
validation is a **pure client-side derivation**, not a server verdict, so the real failure surface
is **optimistic-state ↔ persisted-state divergence**: does an optimistic placement reconcile/roll
back so the locally-derived verdict recomputes off truth?

## Starting Point

The verdict is `deriveCellViolations` over local `useState`, surfaced as `aria-invalid` on each chip;
the pure transitions are already unit-tested but the **async hook glue** (`use-placements`) is not.
Reload re-seeds `useState` from `loadPlannerData` — server-round-trippable, no client cache. The
repo has **no React/DOM test lane** (node-only Vitest, no RTL). The e2e harness already solved
dnd-kit drag in `cohort-switching.spec.ts`, but those helpers are spec-local.

## Desired End State

`pnpm test` runs a new jsdom lane proving optimistic reconcile/rollback + verdict recompute;
`pnpm test:integration` proves reload-restore through `loadPlannerData` (weeks both/a/b), documents
the move-duplicate hazard, and pins double-drop idempotency; one drag→feedback e2e proves a real
collision visibly reads `aria-invalid` in a browser — built on board helpers promoted to
`e2e/support/`. The §5 drag→feedback CI gate is satisfied.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Risk #2 reframe | Test optimistic reconciliation, not "server verdict" | Validation is client-side; literal Risk #2 can't occur | Research |
| Risk #2 lane | Build first jsdom + RTL hook-test lane | Directly tests the untested async glue; reusable | Plan |
| Move-duplicate divergence | Test-only; flag atomic-move fix as follow-up | This is a test phase — document the hazard, don't scope-creep a fix | Plan |
| Single e2e | Drag→feedback (collision reads `aria-invalid`) | Browser-observable truth integration can't reach; the §5 gate | Plan |
| Week dimension | Cover both / a / b | Week column is live; cheap, real verdict + restore branches | Plan |
| Double-drop | One idempotency integration test | Pins the only DB-enforced rule's silent-success behavior | Plan |
| Reload-restore depth | Integration round-trip through `loadPlannerData` | Exact production read path; stable boundary | Plan |
| e2e helpers | Promote `cohort-switching.spec` drag/locators to `e2e/support/` | Second consumer is the promotion trigger; reuse solved dnd-kit drag | User |
| Bundle (Risk #7) | Out of scope | S-05 `ready` / S-07 `proposed` not shipped | Research |

## Scope

**In scope:** jsdom/RTL test lane; `use-placements` hook reconcile/rollback + verdict recompute;
reload-restore + move-duplicate + double-drop integration; one drag→feedback e2e; promote shared
e2e board helpers.

**Out of scope:** fixing the non-atomic move; bundle parked-restore (Risk #7); cross-author/IDOR;
perf-budget assertion; a full `PlannerBoard` render test.

## Architecture / Approach

Cheapest-signal-first, asserting only through boundaries that survive the coming S-03/S-04
collision-core rewrite: the **`deriveCellViolations` verdict map**, the **`loadPlannerData`
round-trip**, and the **role+ARIA grid contract**. Pure transitions already covered → the hook test
targets only async orchestration. Vitest 4 `test.projects` adds a jsdom project alongside the node
one under one `pnpm test`. The e2e reuses the promoted stepped-pointer drag helper.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. DOM lane scaffolding | jsdom + RTL second Vitest project, green smoke | React single-instance / config under jsdom |
| 2. Reconciliation hook test | `use-placements` reconcile/rollback + verdict recompute | Async settling; not coupling to internals |
| 3. Persistence integration | reload-restore, move-duplicate, double-drop | Move-dup test must depend on the real bug |
| 4. Drag→feedback e2e + promote helpers | shared `e2e/support` board helpers + one spec | dnd-kit drag reliability; behavior-preserving move |

**Prerequisites:** local Supabase stack (Phase 3); provisioned e2e author (Phase 4) — both already wired.
**Estimated effort:** ~3–4 sessions across 4 phases; Phase 1 is small, Phase 4 the largest.

## Open Risks & Assumptions

- jsdom + React 19 + RTL v16 may need a `resolve.dedupe` for `react`/`react-dom` if an "invalid hook call" surfaces.
- dnd-kit drag in Playwright is the known-hard part — mitigated by reusing the proven `placeFromPalette` helper.
- The move-duplicate test must genuinely depend on the non-atomic behavior, else it's inert.

## Success Criteria (Summary)

- A colliding drop visibly reads `aria-invalid` (hook verdict + browser e2e); a clean drop reads valid.
- After reload, the grid restores exactly the placed state (incl. week a/b) via `loadPlannerData`.
- `pnpm test` (two projects), `pnpm test:integration`, and `pnpm test:e2e` all green; `cohort-switching.spec` unchanged in behavior.
