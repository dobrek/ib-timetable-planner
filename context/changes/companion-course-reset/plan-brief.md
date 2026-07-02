# Companion-course Reset — Plan Brief

> Full plan: `context/changes/companion-course-reset/plan.md`
> Research: `context/changes/companion-course-reset/research.md`

## What & Why

The palette's companion-course selector currently **keeps** its value when the leading course changes, as long as the old companion still co-occurs with the new leading course. Users find this surprising — they expect changing the leading course to reset the companion. This change makes the companion **always reset** on a leading change, and also clears the whole filter when the cohort is switched.

## Starting Point

The behavior lives entirely in one hook, `usePaletteFilter` (`PaletteBody.tsx:107-129`). Its only reset mechanism, `reconcileCompanion`, is a **validity guard** — it drops the companion only when it is no longer a valid option, never simply because the leading course changed. The original companion-course plan *intended* a reset-on-change ("resets whenever the leading course changes") but shipped the validity guard instead; the docstrings still claim the intended behavior. The leading course has a single writer (`onChange` at `PaletteBody.tsx:50`), and `PaletteBody` is rendered without a `key` in `CombinedPalettePanel` (`:95`), so filter state persists across cohort switches.

## Desired End State

Changing the leading course — even to another course where the old companion still co-occurs — always returns the companion to "Any companion". Switching cohort (dp1↔dp2) clears both the leading and companion selects, so no stale leading course lingers across cohorts. `reconcileCompanion` remains only as a residual data-validity guard, and the docstrings are corrected to match reality.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Reset trigger — leading change | Reset in the leading-change handler | Leading has a single writer, so wrapping the setter is a complete, ~3-line fix that leaves `reconcileCompanion` + its tests intact | Plan |
| Reset trigger — cohort switch | Reset the whole filter via `key={activeCohort}` remount | One line; also fixes the latent stale-leading-across-cohorts issue; "switch cohort → fresh palette" is the cleaner model | Plan |
| Keep `reconcileCompanion`? | Yes — demote to residual validity guard | It still correctly drops a companion invalidated by a data change; deleting it would churn its unit tests for no gain | Research |
| Test strategy | Add a discriminating fixture | The existing "stale reset" tests pass under both behaviors — only a fixture where the companion still co-occurs with the new leading proves the fix | Research |
| Docstrings | Correct the drifted "reset-on-leading-change" claims | The doc/impl drift is what caused the feedback; fixing it prevents recurrence | Research |

## Scope

**In scope:** wrap the leading setter in `usePaletteFilter` to clear the companion; `key={activeCohort}` on `PaletteBody`; corrected docstrings; a discriminating hook/RTL test + a cohort-switch reset test.

**Out of scope:** changing `companionCourseOptions` / `filterGroupings`; deleting `reconcileCompanion`; filter persistence; the cohort-selection cookie; E2E; leading-filter behavior, sort toggle, promoted chip, presentational components.

## Architecture / Approach

Two independent triggers, each matched to its natural mechanism: (1) a handler reset for the leading change (single-writer setter, wrapped in the hook), and (2) a remount reset for the cohort switch (`key` on `PaletteBody`). `reconcileCompanion` stays as the render-phase safety net for any data-driven invalidation that bypasses both triggers.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Leading-change reset | Companion always resets on leading change; docstrings corrected; discriminating test | Non-discriminating tests giving false confidence — mitigated by the new fixture |
| 2. Cohort-switch reset | `key={activeCohort}` clears leading + companion on cohort switch; test | Spurious remounts in focus mode — avoided since `activeCohort` is fixed there |

**Prerequisites:** none — all logic is client-side and already loaded.
**Estimated effort:** ~1 short session across the two phases.

## Open Risks & Assumptions

- The two existing "stale reset" tests pass under both old and new behavior; the fix is only truly proven once the discriminating fixture (companion co-occurs with two leading courses) is added.
- Assumes Radix `Select` fires `onValueChange` only on an actual change (so the handler reset never fires spuriously) — consistent with its documented behavior.
- Keying `PaletteBody` by cohort also resets the leading course on cohort switch (intended per the decision above), slightly exceeding the literal "reset the companion" ask.

## Success Criteria (Summary)

- Changing the leading course always returns the companion to "Any companion", even when it would still co-occur.
- Switching cohort clears both selects; switching back stays cleared.
- Cohort selection still persists across a recompute refresh; no regression to the leading filter or palette drag-and-drop.
