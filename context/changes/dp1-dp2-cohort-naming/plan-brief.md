# DP1 / DP2 Cohort Naming — Plan Brief

> Full plan: `context/changes/dp1-dp2-cohort-naming/plan.md`
> Research: `context/changes/dp1-dp2-cohort-naming/research.md`

## What & Why

Roadmap slice **S-01**: relabel the two IB cohorts from **"Year 1" / "Year 2"** to **"DP1" /
"DP2"** everywhere in the UI. Authors call the cohorts DP1/DP2, not Year 1/Year 2 (post-demo
feedback, PRD FR-004) — so the current labels are a daily friction. This is the lowest-risk
slice: a display relabel with **zero change** to the `dp1`/`dp2` data values, schema, or
constraint core.

## Starting Point

Display labels live in one place — `src/shared/config/cohorts.ts:18-19` — and 5 of 7
cohort-display surfaces render through it, so the core change is two strings. The leftovers
are hardcoded: two teacher-table headers, one label test, three stale comments. Separately,
the teachers slice maintains a parallel `y1`/`y2` filter alias (restating `y1↔dp1` in 3–4
places, incl. a brittle positional mapping), and CLAUDE.md/README/dead-SQL still carry the
never-adopted "Y12/Y13" and the dropped `cohorts` table's "Diploma Programme Year" name.

## Desired End State

Every user-facing cohort label reads "DP1" / "DP2". The teachers slice carries one cohort
vocabulary end-to-end (no `y1`/`y2`; `?cohort=dp1` URL). Docs and dead code no longer reference
"Y12/Y13" or the dropped `cohorts` table. Identity (`dp1`/`dp2`), schema, and the constraint
core are bit-for-bit unchanged.

## Key Decisions Made

| Decision                         | Choice                                        | Why                                                              | Source   |
| -------------------------------- | --------------------------------------------- | --------------------------------------------------------------- | -------- |
| Identity vs display              | Keep `dp1`/`dp2` values; relabel display only | Clean axis separation; identity is settled + shipped            | Research |
| Teacher table headers            | Derive from `COHORTS` (adopt `cohortLabel`)   | Can never drift again; matches single-sourcing principle        | Plan     |
| "All years" filter option        | Rename to "All cohorts"                       | Consistent vocabulary beside "DP1"/"DP2"                        | Plan     |
| Teachers `y1`/`y2` alias         | Fold the single-sourcing cleanup into S-01    | Removes the lone single-sourcing violation now                  | Plan     |
| Rename depth                     | Full cohort vocab incl. `?year=`→`?cohort=`   | One vocabulary end-to-end; no production bookmarks to preserve  | Plan     |
| Docs + dead SQL                  | Fold all in (comments, CLAUDE/README, snippets) | Cheap; removes wrong labels from high-traffic + dead files     | Plan     |
| Dead SQL treatment               | Delete (not re-label)                         | They query the dropped `cohorts` table — unsalvageable by relabel | Plan  |

## Scope

**In scope:**

- Flip `COHORTS` labels → "DP1"/"DP2" (+ its test); cascades to 5 surfaces
- Teachers slice: headers from `COHORTS`, "All cohorts", full `y1/y2`→cohort rename (+2 tests)
- Hygiene: stale comments (incl. `S-09`→`S-04`), CLAUDE.md/README "Y12/Y13"→`dp1/dp2`, delete dead SQL snippets

**Out of scope:**

- Any `dp1`/`dp2` data value, the `cohort` enum, schema, migrations, seed
- The constraint core, drag payloads, catalog hash (all cohort-agnostic)
- `BOARD_COHORT = "dp1"` (board stays single-cohort until S-04)
- Rewriting `*.test.ts` `dp1`/`dp2` fixtures; salvage-rewriting the dead SQL

## Architecture / Approach

One config constant (`COHORTS`) is the display funnel — editing it cascades to student/course
tabs & selects and teacher filter buttons. The teachers slice is the only place with hardcoded
strings + a parallel token system, so it gets its own pass. Identity tokens (`dp1`/`dp2`) flow
unchanged DB → loaders → URL → constraint core; only the display edge and the teachers filter
vocabulary move.

## Phases at a Glance

| Phase                         | What it delivers                                              | Key risk                                            |
| ----------------------------- | ------------------------------------------------------------ | --------------------------------------------------- |
| 1. Core display relabel       | "DP1"/"DP2" across 5 cascade surfaces (config + test)        | Test must move in lockstep with config              |
| 2. Teachers slice             | Headers from `COHORTS`, "All cohorts", full cohort-filter rename | Behavior-adjacent: filter logic + `?cohort=` URL contract |
| 3. Docs & dead-code hygiene   | Comments, CLAUDE/README, dead SQL deleted; completeness grep | Missing a stray string (the roadmap's named risk)   |

**Prerequisites:** None — brownfield slice on a shipped platform; no blockers (roadmap S-01).
**Estimated effort:** ~1 session across 3 phases (small, finite edits; no schema/infra work).

## Open Risks & Assumptions

- **Completeness** is the only real risk (roadmap-stated): a stray "Year 1/2" or `y1`/`y2`
  string. Mitigated by the Phase 3 grep gate over `src/` + `supabase/`.
- Assumes no production users/bookmarks rely on `?year=y1` (README confirms no production data
  yet), so the URL key rename needs no back-compat shim.
- Deleting the dead SQL snippets assumes they have no live diagnostic use; they are
  git-recoverable if a `cohort`-enum rewrite is later wanted.

## Success Criteria (Summary)

- An author sees "DP1" / "DP2" on every cohort tab, select, filter button, and table header.
- The teacher filter works exactly as before, now with `?cohort=dp1` URLs and no `y1`/`y2` alias.
- `grep -rniE "year ?1|year ?2|y12|y13" src/` and `grep "Diploma Programme Year" supabase/`
  are clean; `pnpm test` + `pnpm build` + `pnpm steiger` + `pnpm lint` stay green.
