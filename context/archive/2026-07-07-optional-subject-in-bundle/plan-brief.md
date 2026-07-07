# Optional Subject in Bundle — Plan Brief

> Full plan: `context/changes/optional-subject-in-bundle/plan.md`
> Research: `context/changes/optional-subject-in-bundle/research.md`

## What & Why

Instead of removing a subject from a bundle, the plan author can mark it **optional** — a durable temporary choice, visually distinct, still counted as placed, later either accepted (back to normal) or truly removed. This makes the space of pending decisions visible while building a comprehensive plan, rather than forcing premature removals.

## Starting Point

Bundles are first-class rows whose membership lives only in `placements`; per-member state already has one worked precedent — the fortnightly `week` column — with a complete chain from migration to chip toggle. Removing a member requires ungrouping first (inline "×"). The history engine diffs placements by a business key that today excludes any new flag, and parked bundles duplicate member state in `shelf_bundle_courses`.

## Desired End State

An ungrouped chip exposes a "⋯" menu (Mark as optional / Accept / Remove — the inline "×" migrates in). Optional chips render dashed + dimmed + tagged on the board, both perspective views, the shelf card, and the drag overlay. The toggle is undoable, survives park/unpark, moves, duplicate, and plan cloning. The summary headline is unchanged; the courses-left popover gains an "Optional" review section.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Data model | `is_optional boolean not null default false` on `placements` (+ shelf twin) | Exact `week`-column precedent; placement row is the universal grain | Research |
| Validation semantics | Render-only — optional members still block | Truthful validation, smallest change, zero <200ms risk | Research |
| Counter | Headline unchanged; popover gains "Optional" section (course + count) | Row stays counted as placed; section mirrors existing popover row grammar | Research / Plan |
| Undo/redo | First-class recorded edit; business key extended **and its duplicate spelling unified** | Without the key extension, undo silently no-ops | Research |
| Affordance | Per-chip "⋯" overflow menu, gated `!bundled`; remove migrates into it | One home for member verbs; keeps the chip compact; catalog "⋯" precedent | Research |
| Visual grammar | Dashed border + dim + small "optional" badge, composing below collision tones | Strongest at-a-glance cue; reuses the dashed-ghost grammar | Plan |
| Surfaces | All member-rendering surfaces: board, perspectives, shelf card, drag overlay | No surprise state loss anywhere the member appears | Plan |
| Shelf & clone | Flag survives park/unpark and `clone_plan` | Consistent with `week`; parked "temporary choices" stay visible | Research |
| E2E scope | Realign `bundle-operations` + one new optional-flow scenario | Protects the migrated remove path and the flagship flow at browser level | Plan |
| Type strategy | `isOptional` **required** on `PlannerPlacement`/`ParkedMember` | `pnpm check` mechanically finds every construction site | Plan |

## Scope

**In scope:** columns + 5 SQL function replacements (`place_course`, `shelve_bundle`, `unshelve_bundle`, `shelve_courses`, `clone_plan`); flag threading through types/projections/selects/place-paths; history business-key extension + unification; `setOptional` verb chain; chip overflow menu; optional visual on 4 surfaces; popover "Optional" section; e2e realignment + 1 new scenario.

**Out of scope:** constraint relaxation for optional members; counting changes in `hours.ts`; a three-state enum; a same-cell attribute-flip reconcile recognizer; optional toggle while bundled; moving the week toggle into the menu.

## Architecture / Approach

Replicate the `week` column's end-to-end path in strict dependency order: schema + SQL first (behavior-neutral, default `false`), then thread the flag through every type, projection, and — critically — the placement business key and member-set keys *before* the verb exists, then ship verb + menu + visual + e2e realignment as one user-visible increment, and finish with the review surfaces. Phases 1–2 must leave every suite green with the flag permanently `false`, proving neutrality before behavior lands.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema & SQL functions | Columns + function replacements + regenerated types; behavior-neutral | `place_course` signature needs DROP+CREATE (overload trap) |
| 2. Flag threading & history-key integrity | Flag in every type/key/select; unified business key; still invisible | Missing a key site → undo silently no-ops later |
| 3. Verb + board chip UI + e2e realignment | Mark/Accept/Remove via "⋯" menu, undoable, visually distinct | Visual axis colliding with collision tones / opacity stack; e2e must ship with the menu |
| 4. Review surfaces + new e2e | Popover section, perspective/shelf/overlay cues, browser guard | Popover derivation drifting from the never-netted counter conventions |

**Prerequisites:** local Supabase stack running (`supabase start`); branch `feat/optional-subject-bundle` already open.
**Estimated effort:** ~3–4 sessions across 4 phases; Phases 1–2 are mechanical, Phase 3 is the bulk.

## Open Risks & Assumptions

- `place_course`'s on-conflict update now converges `is_optional` on replay — a deliberate, documented semantics choice (defensive path only; client gates eligibility).
- Undoing a flag flip decomposes to remove+place at the same cell (id churn) — precedented by `setWeek` undo and explicitly accepted.
- The Phase-3/4 chip visual must be tuned against the existing opacity axes (pending/drag/lens); exact classes left to implementation with the composition constraint pinned in the plan.

## Success Criteria (Summary)

- The author can mark a bundle member optional instead of removing it, spot it instantly on any surface, and later accept or remove it — with full undo support.
- Optional members stay counted as placed (headline unchanged) and are listed with counts in the popover's "Optional" review section.
- The flag survives every carry path — move, duplicate, shelf round-trip, plan clone, reload — verified by `/verify` + integration + e2e suites.
