# Bulk Course-Choice Editing for Multiple Students — Plan Brief

> Full plan: `context/changes/changing-courses-for-multiple-students/plan.md`
> Research: `context/changes/changing-courses-for-multiple-students/research.md`

## What & Why

Plan authors need to change course choices for many students at once — e.g. find everyone who chose Math SL, add TOK1 to all of them, and ensure none of them have TOK2. Today that's one dialog per student. This change adds row multi-selection to the students catalog plus a bulk add/remove dialog, built as a general `{add courses, remove courses}` primitive of which the TOK1/TOK2 story is the first instance.

## Starting Point

The domain already supports this with **zero schema changes**: `student_choices` is a UNIQUE-keyed M:N junction, the course filter already answers "who chose Math SL", and every mutation follows one uniform Astro Action recipe. What's missing is purely UI (no row selection exists) and one server mutation (no bulk write path exists).

## Desired End State

In the active cohort tab, the author checks students (or select-all over the filtered view), a bar shows "N selected · Edit choices…", and the dialog takes an add-set and/or a remove-set of cohort courses. A confirmation step shows the computed effect ("Add TOK1 — 19 of 23 will gain it · Remove TOK2 — 4 will lose it") plus the review-plan-boards drift hint before one atomic apply (success toasts are a pre-navigation flash and can't carry instructions).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Write path | New atomic `bulk_edit_student_choices` plpgsql RPC | Bulk blast radius makes partial writes unacceptable; directly precedented by `replace_course_teachers` | Research → Plan |
| RPC validation | Validation-free RPC; TS gates + composite-FK backstop | Matches the house pattern exactly and keeps the SQL trivial | Plan |
| Cohort handling | Selection bound to the active cohort tab | Single-cohort by construction — pickers and server gate stay simple | Research → Plan |
| Selection vs filters | Cleared on any filter change (WYSIWYG) | What you see is exactly what you edit; no hidden-selection risk | Plan |
| Operation surface | One `{add, remove}` primitive, either side usable alone | Covers add-only, remove-only, and swap without extra dialog modes | Plan |
| Safety mechanism | Confirmation summary before apply; no undo | Per-student effect is computable client-side for free; undo is unreliable across refreshes | Plan |
| Validation drift | Lightweight hint in the dialog's confirmation step only | Pre-existing risk this feature only amplifies; toasts don't survive the post-apply full-page refresh; proactive detection is a follow-up change | Research → Plan (amended in plan review) |
| Browser coverage | One E2E spec: happy-path story + WYSIWYG selection-clearing | The riskiest behavior is interaction wiring over URL-synced state that only a browser exercises; the rest stays manual or lower-layer | Plan |

## Scope

**In scope:** RPC migration + regenerated types; `bulkChoiceInput` schema; `bulkEditChoices` domain fn/action/client wrapper; students-in-cohort gate; shared `Checkbox` primitive; selection hook; table checkbox column; bulk-action bar; two-step bulk dialog; unit + integration tests; a Playwright E2E spec (`bulk-edit-choices.spec.ts`) gating the happy-path story and selection-clearing in CI; loader truncation-guard alignment to the effective PostgREST 1000-row cap; required `update-student.ts` docblock correction.

**Out of scope:** proactive conflict computation, cross-cohort selection, undo, first-class "replace" mode, grouping invalidation (already handled by staleness banner), behavioral changes to single-student editing, raising the loader's choices cap / pagination, server-side merge-parent exclusion (accepted parity with the single-student path).

## Architecture / Approach

Backend-first through the slice's uniform seam: shared Zod schema → `defineDomainAction` → framework-free domain fn (TS cohort gates for students and add-courses) → one atomic RPC (idempotent cross-join insert `on conflict do nothing`, then set delete). UI composes existing primitives (`Table` is already selection-styled, `MultiSelect` + Dialog/RHF shell cloned from `StudentFormDialog`); only a ~30-line `Checkbox` wrapper is net-new, with no new dependency. Success refreshes via the standard loader re-run; stale grouping suggestions are caught by the existing `catalog_hash` banner.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Atomic persistence layer | RPC migration, regenerated types, raw-RPC integration tests | SQL contract subtleties (jsonb casts, conflict target) |
| 2. Server action + client wrapper | Schema, gates, domain fn, action, summary helper, tests | Cross-field schema refinements landing on the right fields |
| 3. Catalog selection UI + bulk dialog | Checkbox column, bulk bar, two-step dialog with drift hint, E2E spec | Selection-clearing correctness across URL-synced filter changes (E2E-gated) |

**Prerequisites:** local Supabase stack running (Docker) for integration tests and manual verification.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- The unified `radix-ui` package's `Checkbox` export is assumed API-compatible with the shadcn checkbox recipe (research-verified for v1.6.0).
- Bulk adds accelerate approach to the effective 1000-row PostgREST read ceiling (`max_rows`); the loader guard is aligned to it in scope so truncation fails loudly. `load-cohort-courses.ts` shares the cap unguarded — explicit follow-up.
- Silent validation drift on already-placed boards remains open by decision — the hint toast mitigates, a follow-up change can close it.

## Success Criteria (Summary)

- The literal story is one filter + select-all + one dialog: TOK1 added to all selected, TOK2 verifiably absent (zero-count shown in confirmation) — permanently gated by the new E2E spec.
- The apply is all-or-nothing across every selected student, and re-running it is a visible no-op.
- `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, and the `/verify` gate stay green.
