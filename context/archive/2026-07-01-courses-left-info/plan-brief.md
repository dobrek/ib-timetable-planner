# Courses Left Info — Plan Brief

> Full plan: `context/changes/courses-left-info/plan.md`
> Research: `context/changes/courses-left-info/research.md`

## What & Why

The board top bar shows a course count ("N courses left to place"). We're turning it into an **hours-based** signal — **`N hours left to place · M over`** — whose text is a Popover trigger that reveals *which* courses those hours belong to. The user's goal: *"how many hours are still missing to be placed on the board, and which courses"* — not caring whether an hour is off the board because it's parked on the shelf or was never dragged from the palette. Both are "not on the board yet."

## Starting Point

`deriveHours(placements, catalog)` already computes `Map<courseId, { placed, required }>` on every render; today `countIncompleteCourses` turns that into the course count in the bar. `placed` counts board rows only (parking removes rows), so the raw material for an hours-based, board-only metric already exists — nothing new to derive at the domain level.

## Desired End State

The bar reads "N hours left to place", appending a warning-toned "· M over" when any course is over-placed. Clicking it opens a Popover ("Course placement") with a **Missing** section (`placed < required`) and an **Over-placed** section (`placed > required`), each grouped by cohort (DP1/DP2 in combined mode, one cohort in focus mode), largest-gap-first, rows showing a subject-color chip + name + `placed/required`, with per-section subtotals.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Metric | Hours, not courses | User wants "how many hours are still missing from the board." | Plan |
| Parked handling | None — parked hours count as missing | An hour off the board still needs placing, whatever the reason. | Plan (reverses research #4) |
| Missing vs over math | Per-course, clamped, summed **independently** | Math 4/2 + English 0/2 must read "2 left · 2 over", not net to 0. | Plan |
| Over-placed | Kept, in hours, in bar **and** popover | Over-allocation is a likely mistake worth surfacing. | Research #5 + Plan |
| Bar copy | `N hours left · M over`; interactive until truly clean | Over-placement stays reachable even when nothing's missing. | Plan |
| Sort | Largest gap first (ties alphabetical) | Most-attention-needed courses float to the top. | Plan |
| Surface | Popover on the counter, static list | Matches the `BoardSettingsMenu` / parked-badge precedents in this bar. | Research |
| Testing | Model unit tests + assembler test + one e2e | Locks the correctness-critical math cheaply; guards the wiring. | Plan |

## Scope

**In scope:** hours-based counter; two-section grouped Popover; per-cohort split; largest-gap sort; warning styling for over-placed; unit + e2e tests.

**Out of scope:** click-to-highlight/interactivity; parked-awareness; side panel/tray; any schema/API/Action/constraint-core change; over-placement detail in the bar beyond the `· M over` count.

## Architecture / Approach

Pure projection over the existing `deriveHours` map. **Model** (`hours.ts`) gains `deriveUnplaced`/`deriveOverplaced` (identity + hours) and `summarizeHours` (two independent clamped sums); `useHours` → `toCohortState` thread the per-cohort lists + totals, replacing the now-dead `incompleteCount`/`countIncompleteCourses`. **UI**: `PlannerBoard` builds a display-resolved, sorted, cohort-tagged summary at the edge (reusing the `states` array that already resolves active cohorts) and passes it to a presentational `PlanSummaryBar` (Popover trigger) + new `CoursesLeftPopover` (sections). Sorting happens after display resolution because the tie-break needs the name.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Model | `deriveUnplaced`/`deriveOverplaced`/`summarizeHours` + threaded hook state; unit tests | Getting the non-netting sums right (mitigated by the Math+English test) |
| 2. UI + e2e | Hours-based Popover trigger, `CoursesLeftPopover`, board wiring, Playwright spec | Slim-bar layout fit for the longer copy; edge-state copy correctness |

**Prerequisites:** local Supabase seed running for e2e (`pnpm exec supabase start`); no other blockers.
**Estimated effort:** ~1–2 sessions across 2 phases (small, mostly assembly).

## Open Risks & Assumptions

- The longer bar copy ("N hours left to place · M over") must fit the slim ~37px header beside plan-name/switcher/undo — verify manually; a compact fallback ("N left · M over") is noted if it crowds.
- Assumes `countIncompleteCourses`/`incompleteCount` truly have no other consumer (grep-verified within `src/`); removing them is safe.
- Cohort subheaders shown only in combined mode is a small UI judgment; adjust if focus-mode context reads unclear.

## Success Criteria (Summary)

- The bar answers "how many hours are still off the board" at a glance, with over-placement flagged.
- Opening it shows exactly which courses (and how many hours) are missing or over, per cohort, most-needed first.
- Under-placement and over-placement never cancel each other in the totals.
