# SlotCell Refactor — Plan Brief

> Full plan: `context/changes/slot-cell-refactor/plan.md`
> Research: `context/changes/slot-cell-refactor/research.md`

## What & Why

`SlotCell.tsx` (428 lines, the slice's largest file) carries four kinds of debt at once: a silent-failure reliability hazard (the negated-class ring ladder), structural overload (3 sub-components + a styling table + two dnd-kit integrations in one file), an accessibility gap (the board's core drag-drop is visual-only — silent to assistive tech and unlocatable by role-based e2e), and several undocumented slice conventions. We fix all four in five independently-reviewable phases.

## Starting Point

The cell's tone is a priority cascade encoded as `!`-negation chains (`SlotCell.tsx:124–144`) — untestable and silently breakable because every Tailwind ring writes the same `--tw-ring-color`. Week classification is scattered across four call sites. All board status is visual-only `data-*` (none load-bearing: zero CSS/JS/test reads them). The e2e suite mandates role-based locators only (`e2e/CLAUDE.md:15`), so the board can't be e2e-tested until it carries roles + names.

## Desired End State

Cell tone resolves through one pure, tested `resolveCellTone` → `toneClass` lookup. Week logic lives in `model/week.ts`. `SlotCell` is a `ui/slot-cell/` folder-with-barrel. The A/B control is a real `radiogroup`. The board renders `role="grid"` with named `gridcell`s and chips, replacing stateful/coordinate `data-*` with ARIA. Four conventions are codified.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Reliability fix | `resolveCellTone` enum + table | Precedence declared once/ordered/exhaustive, testable | Frame/Review |
| `cell-tone` location | pure resolver in `model/`, class table in `ui/` | Tested logic in `model/`, Tailwind out of `model/` | Plan |
| A11y scope | Roles + ARIA + `data-*` swap; **no** keyboard DnD | Discharges a11y debt + unblocks board e2e in one pass; A1 is plan-sized/orthogonal | Plan |
| WeekToggle | Add Radix `ToggleGroup` primitive to `shared/ui` (from the already-installed `radix-ui` umbrella; no new dep) | Correct radio semantics + keyboard nav + focus rings; reusable | Plan |
| Week convergence | Everything incl. `CollisionDetailsDialog` | One home for `a`/`b`/`both` classification | Plan |
| `data-*` | Drop stateful + coordinate; keep `data-slot` | None load-bearing; ARIA is single source of truth | Research |
| D1 dnd hook | Option B — extract `useCellDnd`, codify hook stance | Matches slice's own design goals; subsumes the memo fix | Plan |
| Convention docs | Folder threshold (cohesion caveat), role+ARIA e2e, trailing constants, D1 | Document reality + the new idioms | Plan |

## Scope

**In scope:** tone resolver + tests; week convergence + tests; `stopDrag` + `useCellDnd`; folder split + `cva`; ToggleGroup primitive; grid/cell/chip roles + accessible names; stateful/coordinate `data-*` removal; four convention-doc deltas.

**Out of scope:** keyboard DnD operation (A1, separate change); PlannerGrid prop-drilling cleanup (research group B); the three unrelated `plan-detail` deltas; splitting `CollisionDetailsDialog`/`PlannerBoard`; an `aria-live` collision summary.

## Architecture / Approach

Lowest-risk → highest-churn. Pure model extractions first (reliability + week logic, fully unit-tested, no file moves), then dnd-interaction hardening (still single-file), then the mechanical folder split, then the accessibility layer (new primitive + roles + ARIA + `data-*` removal) on a clean structure, then docs that codify what landed. No new dependency — `ToggleGroup` ships in the already-installed `radix-ui` umbrella.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Pure model core | `resolveCellTone` + week classifiers (tested); ladder collapses | Tone parity with the old ladder must be exact |
| 2. Interaction-safety + dnd hook | `stopDrag` + `useCellDnd`, no body `useMemo` | A control silently re-enabling drag-on-click |
| 3. Folder split + cva | `ui/slot-cell/` barrel; sibling files; `cva` chip | Import/move churn; visual regressions |
| 4. Accessibility | ToggleGroup, grid/cell/chip roles+names, `data-*`→ARIA | Test-contract change; ARIA correctness |
| 5. Convention docs | 4 `ui-conventions.md` deltas + e2e rationale | Cohesion caveat clarity |

**Prerequisites:** none beyond a working dev/build loop (the `radix-ui` umbrella that provides `ToggleGroup` is already installed).
**Estimated effort:** ~3–4 sessions across 5 phases (Phase 4 is the heaviest).

## Open Risks & Assumptions

- Tone-class parity: precedence order is unit-tested (`cell-tone.test.ts`) and the enum→Tailwind string mapping is unit-tested (`tone-class.test.ts`, pinned to pre-refactor strings); the visual diff now only backstops actual pixel rendering.
- `partitionByWeek` importing `LocalPlacement` into `model/week.ts` may want a structural `{ week }` generic to avoid an awkward model-internal import (plan allows either).
- `ToggleGroup` comes from the already-installed `radix-ui` umbrella (`^1.6.0`) — no new dependency, no fresh workerd-build risk (other Radix primitives already run clean).

## Success Criteria (Summary)

- Cell tones and board behavior are visually/functionally identical post-refactor, with the precedence logic now unit-tested.
- The board exposes a `grid` with named `gridcell`s, chips with `aria-invalid`, and a real `radiogroup` A/B control — locatable by role-based e2e.
- `pnpm test` / `lint` / `steiger` / `build` all clean; four conventions codified to match the shipped code.
