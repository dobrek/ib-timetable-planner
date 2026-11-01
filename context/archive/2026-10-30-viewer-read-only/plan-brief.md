# Viewer Reads Everything Read-Only (S-405) — Plan Brief

> Full plan: `context/changes/viewer-read-only/plan.md`
> Research: `context/changes/viewer-read-only/research.md`

## What & Why

FR-409: a viewer reads every plan and proposal, including the perspective views. They can export and compare, see no edit affordance anywhere, and can always tell a proposal or draft from the plan marked current. S-403 already makes the database refuse every viewer write, so this change adds no security. It stops a viewer's *visit* from trying to write, removes the controls they cannot use, and marks the current plan wherever a plan's identity shows.

## Starting Point

- A visit to `/plans/[id]`, and the pending page's 5 s poll, run `checkPlan`, which reclaims, delivers, sweeps and stamps under the visitor's session.
- Under a viewer, that produces 42501s and "status could not be read", a stale job polled forever, and false "failed" states.
- Every write control on the board, hub and catalogs is visible to a viewer, because no island knows the caller's capability.
- "Current" shows on the hub, the sidebar and the board heading only.

## Desired End State

**For a viewer:**
- **Every page renders its data with no edit control:** no drag, palette or shelf, Generate, undo/redo, New buttons, write menus or bulk selection. The catalog badges open read-only dialogs.
- **A finished, undelivered proposal** reads "finished — waiting for an author", and the viewer's page flips into the board on its own once an author or admin opens it.
- **No visit or poll writes anything.**
- **"Current" appears** on the comparison page, the printed headings, tab titles and export file names.
- **A "View only" chip** sits in the sidebar footer.

Authors and admins see no change, except that the current plan's export file names gain `-current`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Viewer opens a finished proposal first (Open Question 1) | (a) Wait for an author; a viewer's visit never writes | Every "deliver regardless" mechanism bends a recorded rule. | Research / User |
| How the visit splits | New `readPlanJob` (`read`), and `checkPlan` becomes `edit`; the route picks by `allows(access, "edit")` | `run` never sees the caller's access, so one action cannot branch on role. | Research |
| Labelling reach | "Current" on screen and paper: comparison, print headings, tab titles, export file names | Printouts are what get handed out; anything unmarked is not current. No migration. | Plan |
| Palette and shelf for a viewer | Hidden | The fewest seams, with nothing draggable left; the summary bar's counter stays. | Plan |
| Catalog badges | Read-only dialogs | A viewer sees the same overlap and availability detail an author does. | Plan |
| Viewer waiting on a proposal | Keep polling the write-free read; reload into the board on delivery | The read is the hub poll's weight, and the board appears without a reload. | Plan |
| Signalling view-only | One global "View only" chip in the sidebar footer; controls hidden, never disabled | One place, every page; a demoted author knows why the controls vanished. | Plan |
| Test depth | Viewer e2e account, tripwire spec and generation spec, plus an integration suite under a viewer session | Catches future ungated controls and proves the Open Question 1 flow in a browser. | Plan |
| Board gating mechanism | Optional `CellWiring.edit` sub-record, plus `resolvePaletteView` → `"hidden"` | "Absent handler means absent control" and derived-state dispatch are existing house idioms. | Research / Plan |

## Scope

**In scope:**
- The `readPlanJob` / `checkPlan` split.
- Viewer copy for every job state (pending page, strip, hub badges) and the viewer poll keep-alive.
- A `canEdit` prop on 6 islands, plus gating on the board, hub, courses, teachers and students.
- Read-only overlap and availability dialogs.
- "Current" labelling on the comparison page, print, tab titles and exports.
- The "View only" chip.
- `toDomainError` on the delivery writes, and two viewer RPC cells in the role matrix.
- The viewer e2e account and project, two viewer specs, and docs.

**Out of scope:**
- Delivering on a viewer's visit (solver, trigger, DEFINER RPC, cron); a read-only preview of an undelivered board; hub-poll delivery.
- A durable "was a proposal" lineage; a marker inside workbooks.
- Any migration, RLS, function or wire change.
- Stop for viewers, and requester-scoped Stop (S-407); the admin Users page (S-406); S-403's bookkeeping.

## Architecture / Approach

Each route computes `canEdit = allows(Astro.locals.access, "edit")` once and passes it down. Islands never read the role.

- **Plan-detail route:** it also chooses the domain path. Editors run the delivering `checkPlan` and the orphan release. Everyone else runs `readPlanJob`, which returns the same view plus server-computed `stalled` and `awaitingDelivery`.
- **Client:** the pending page's panel comes from a pure `resolvePendingPanel(job, { canEdit, stranded })`, and its poll uses the capability-matched action.
- **Board:** the write handlers move into an optional `CellWiring.edit`; the palette goes through a new `"hidden"` outcome of `resolvePaletteView`; Generate, undo/redo and the shelf are simply not mounted.
- **Labelling** reuses `CurrentPlanBadge`, plus one shared `planFileStem(planName, isCurrent)` for all four export name builders.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Write-free visit path | `readPlanJob`, `checkPlan` → `edit`, viewer pending page, strip and poll, error mapping, matrix cells, viewer integration suite | The ~20-file type-import move; `sameView` must gain the new fields in the same commit |
| 2. Read-only board | `CellWiring.edit`, disabled drags, hidden palette and shelf, no Generate or undo/redo | Missing a draggable or a header action; the focus-mode early return |
| 3. Read-only hub and catalogs | Hub and catalog gating, viewer badge copy, read-only overlap and availability dialogs | The availability grid needs a non-interactive variant that keeps per-slot labels |
| 4. Labelling and "View only" | Current on the comparison page, print, tab titles and exports; the sidebar chip | The comparison page's no-baseline rule: badge beside the name only |
| 5. Viewer e2e and docs | The viewer account and project, tripwire and generation specs, rules in `e2e/CLAUDE.md` and `CLAUDE.md` | Author-context data setup; solver-timed spec flakiness |

**Prerequisites:** S-403 and S-404 merged (both on `main`). S-403's roadmap row still reads `in-progress` until its manual rows and archive close; that is paperwork, not a blocker. Local solver (`mise run solver:dev`) for the Phase 1 manual checks and the Phase 5 generation spec.
**Estimated effort:** about 4–5 sessions across 5 phases. Phases 2–4 are wide but repetitive; Phase 1 holds the only real logic.

## Open Risks & Assumptions

- **The accepted Open Question 1 gap.** Until an author or admin opens a finished proposal, a viewer cannot see its board, compare it or open its perspective views. S-310's completion email is the planned prompt that brings an author back.
- **Future drift.** A new edit control added without `canEdit` leaks only an affordance, because RLS still refuses the write. The tripwire spec is the guard, and the new `CLAUDE.md` bullet is the rule.
- **The viewer poll on a waiting proposal** runs as long as the tab stays visible. It is cheap (two narrow indexed reads), but unbounded in duration.
- **The `-current` file name is a snapshot.** A file exported while the plan was current keeps the name after the marker moves.

## Success Criteria (Summary)

- A viewer can walk every page, print and export, with no edit control in sight and no error in the server log.
- A viewer watching a finished proposal sees it wait for an author, then sees the board appear when an author opens it, and no viewer action ever changes a row.
- Wherever a plan's identity appears, on screen or on paper, the current plan says "Current".
