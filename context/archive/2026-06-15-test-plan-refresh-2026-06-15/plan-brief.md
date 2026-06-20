# Test-Plan Guide Refresh — Plan Brief

> Full plan: `context/changes/test-plan-refresh-2026-06-15/plan.md`
> Research: `context/changes/test-plan-refresh-2026-06-15/research.md`

## What & Why

Rewrite `context/foundation/test-plan.md` so it describes the *current* codebase
instead of a pre-FSD one. The 2026-06-08 FSD architecture refactor landed and the
test rollout drifted: paths moved, the integration harness shipped, and the
priority order changed (auth/RLS now matters before the drag loop). A stale guide
mis-routes every future `/10x-test-plan` and `/10x-implement` run, so it must be
re-grounded. This change **edits the guide only — it writes no tests.**

## Starting Point

The guide is stamped 2026-06-08 and still future-tenses the refactor, cites gone
dirs (`src/lib/placements`, `src/components/planner/auth/ui`, `src/lib/grouping`)
and a placements API route that migrated to Astro Actions, references a phantom
`testing-validator-trust-core/` change folder, and claims "15 test files." The
live tree has **55 unit + 9 integration** tests, a factory harness, and a CI
integration lane. `research.md` (same commit, today) verified all of this and
flagged four corrections (C1–C4) plus an archive YAML bug.

## Desired End State

The guide reads accurately for the current tree: FSD paths throughout, the harness
reconciled as a complete Phase 0, a re-sequenced rollout with auth/RLS as the next
phase, the S-09 risk promoted and honestly labeled, the four corrections applied,
and a 2026-06-15 stamp. The archived change.md carries one valid `archived_at`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Phase 1 disposition (C2) | Keep & relabel "complete (absorbed)"; fix route language; strip "#3 (route)" | Preserves the Risk #1 oracle story as its own line and keeps phase numbers stable; Phase 0 alone owns the boundary | Plan |
| Risk #1 server-persist gate | Add as explicit **unmet** criterion | Validation and persistence are decoupled — the unit oracle is not proof a collision can't be persisted | Plan |
| Risk #5 ownership modeling | Name ownership column + real policies as an explicit **prerequisite** of the auth phase | RLS is permissive `using(true)`, no owner column, service-role tests bypass it — "ownership not yet modeled," not just "auth untested" | Plan |
| Archive YAML bug | Fix the duplicate `archived_at` in-scope (Phase 4) | Zero-cost cleanup while in view; strict parsers null the timestamp otherwise | Plan |
| PRD line cites (C1) | L57 / L130 / L131 / L158 | Old cites drifted; L129 silently mis-pointed | Research |
| §1 #4 rewrite (C3) | Past tense, no build-first sequencing | Archive shows a pre-existing net held green through relocation, not build-first | Research |
| S-09 framing (C4) | Label as the refresh's own inference | Roadmap/PRD describe a constraint to add, not a defect | Research |

## Scope

**In scope:** every section of `test-plan.md` (§1–§8); the one-line archive
`archived_at` fix.

**Out of scope:** writing/modifying tests, CI, factories, or app code; editing the
PRD/roadmap/lessons; building the S-09 class, the Risk #1 server gate, or the
Risk #5 ownership column (the guide *documents* these as pending/prerequisite).

## Architecture / Approach

Edit the guide top-to-bottom in three section-grouped phases (strategy → rollout →
reference) so each phase leaves the document internally coherent, then a tiny
fourth phase for the archive fix. The main risk is cross-reference integrity: the
§3 re-sequence (auth promoted to Phase 2, drag loop to Phase 3) ripples into §5
gate rows and §6 cookbook "see Phase N" pointers, which must be re-pointed in the
same pass. Verification is grep-based (stale tokens absent, new paths/counts
present) plus a prettier check and a manual read for the C3/C4 wording nuances
grep can't catch.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Strategy & Risk Map (§1–§2) | Past-tense #4, FSD-anchored sources, PRD cites fixed, S-09 added, Risk #1 unmet criterion | C3/C4 wording nuance (manual-only check) |
| 2. Rollout & Gates (§3 + §5) | Re-sequenced rollout, phantom removed, ownership prerequisite named, gate refs re-pointed | Cross-ref drift between §3 and §5 |
| 3. Stack, Cookbook, Don't-Test, Freshness (§4,§6,§7,§8) | 55/9 counts, co-located tests, FSD paths, 2026-06-15 stamp | Missing a stale token; §6.4/§6.5 phase pointers |
| 4. Archive fix | Single valid `archived_at` in the archived change.md | Editing an archived artifact |

**Prerequisites:** none — `research.md` is complete and fresh; no codebase
re-research needed.
**Estimated effort:** ~1 session, single-file doc edit + a one-line fix.

## Open Risks & Assumptions

- C3/C4 wording correctness is verifiable only by manual read — grep can't enforce
  "no build-first sequencing" or "S-09 labeled as inference."
- The §3 re-sequence inverts phase order; any missed cross-reference in §5/§6 will
  silently point at the wrong phase.
- "NEXT" must not become a status token — the Status column stays parser-literal.

## Success Criteria (Summary)

- No stale pre-FSD token (paths, `__tests__`, phantom folder) survives anywhere in
  the guide; new FSD paths and the 55/9 counts are present.
- The rollout table matches the target sequence with valid status tokens, and
  §5/§6 cross-references resolve correctly.
- The archived change.md has exactly one valid `archived_at`; prettier formats the
  guide clean.
