# Current-Plan Marker (S-404) — Plan Brief

> Full plan: `context/changes/current-plan-marker/plan.md`
> Research: `context/changes/current-plan-marker/research.md`

## What & Why

FR-420: an author marks one plan as **current**, and every user sees which plan that is, on the plans hub and on the plan itself. At most one plan is current, and none is current when the migration runs. It exists so S-405's viewers can always tell a draft or a proposal from the plan the school is actually using.

## Starting Point

Nothing marks a plan today. `plans` carries only `pending_proposal` (the in-flight proposal flag), and the old `plan_variants.is_final` was dropped in 2026-06. S-403's fail-closed policies already let authors and admins update `plans` and refuse viewers.

## Desired End State

On `/plans`, the current plan is the top row with a "Current" badge. Authors mark and unmark from the row menu; deleting the current plan warns first. The same badge shows by the board heading and in the sidebar plan label and breadcrumb on every single-plan page. The database itself refuses a second current plan and a current pending proposal.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Can a pending proposal be current? | Never: a DB CHECK plus `assertNotPending` | It has no board, the views refuse it, and system sweeps can delete it. | Research |
| Deleting the current plan | Allowed, with a warning in the delete dialog | Zero current is legal, and the author is told the consequence. | Plan |
| Clearing without moving | "Unmark as current" on the current row | An escape hatch back to "no plan is official yet". | Plan |
| Where it shows | Hub, board heading, sidebar label, breadcrumb | One `loadPlanSummary` change reaches every single-plan page. | Plan |
| Where it's moved | Hub row menu only | Matches Clone/Rename/Delete; keeps the board header uncluttered. | Plan |
| Hub order | Current pinned first, the rest by name | Which plan is current answers itself at a glance. | Plan |
| Storage | `plans.is_current` + global partial unique index + CHECK | The database enforces both rules, with no new table or matrix obligations. | Research + Plan |
| Moving the marker | One atomic INVOKER RPC `set_current_plan` | Two updates could leave zero current when the second fails. | Plan |
| "Last updated" | Unchanged by marker moves (trigger `WHEN` via `CREATE OR REPLACE TRIGGER`) | Keeps the column meaning "someone changed this plan", without a `DROP`. | Plan |
| Viewer affordance | Shown, refused with FORBIDDEN | Gating every edit affordance is S-405's sweep. | Research |
| Concurrent / stale movers | Last write wins; a true race gets CONFLICT | The PRD accepted "any author can move the marker". | PRD |

## Scope

**In scope:**
- Migration: column, unique index, CHECK, narrowed trigger, `set_current_plan` RPC and its grants
- A role-matrix `RPCS` cell (red before the migration, green after) and regenerated types
- `markCurrentPlan` / `unmarkCurrentPlan` actions; hub badge, pinning, menu items, delete warning
- A shared `CurrentPlanBadge`; the flag on `PlanSummary`, the sidebar, the breadcrumb and `BoardHeader`
- One integration file, one e2e spec, and the roadmap's decided unknowns

**Out of scope:**
- Capability-gating the affordance (S-405); marking from the board; refusing deletes
- Marker on printouts, tab titles, export names or the comparison page
- Freezing the current plan; stale-page compare-and-set; live push of moves

## Architecture / Approach

The database owns the invariants: a partial unique index (one `true`) and `CHECK (not (is_current and pending_proposal))`. `set_current_plan` locks and validates the target, then unsets the old current plan and sets the new one in one transaction. Unmarking is a plain update. The app copies `renamePlan`'s chain: pending guard → domain function → `defineDomainAction` → client wrapper → menu item → toast + refresh. The flag rides on selects that already run: the hub list and `loadPlanSummary`. The board route reuses the summary it already loads, so the board loader stays untouched.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database | Column, rules, RPC, matrix cell, types, DB-rule tests | Test isolation: the matrix probe really moves the global marker |
| 2. Hub | Mark/unmark actions, pinned row, badge, delete warning | Badge placement must keep e2e's name-link lookups exact |
| 3. The plan itself | Badge on the board heading, sidebar and breadcrumb | Two `BoardHeader` render sites; both need the flag |
| 4. E2E + docs | One serial spec over the whole flow; roadmap notes | The local e2e stack may already have a current plan |

**Prerequisites:** S-403 merged (done, PR #167); a local Supabase stack for `db reset`, `db:types` and the integration lane.
**Estimated effort:** ~2 sessions across 4 phases.

## Open Risks & Assumptions

- The role matrix's allowed probes mark a fresh plan current while other suites run, so marker tests must assert on returned rows and invariants only. All of them live in one file.
- The trigger's `WHEN` skips the date bump for any update that changes `is_current`. That's safe only while no path changes `is_current` together with another column; the migration comment records this.
- Viewers see Mark/Unmark until S-405 hides it; they get a FORBIDDEN toast.

## Success Criteria (Summary)

- An author marks, moves and unmarks the current plan from the hub, and the badge follows on the hub, board, sidebar and breadcrumb.
- The database never holds two current plans or a current pending proposal, and no plan is current right after migration.
- The role matrix shows the RPC as author/admin only, and the full CI gate is green.
