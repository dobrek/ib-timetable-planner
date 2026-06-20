---
date: 2026-06-20T18:42:28+0200
researcher: Dobromir Kropielnicki
git_commit: 7f14556dcfe1583096e590e54562276ecc0d2f91
branch: main
repository: dobrek/ib-timetable-planner
topic: "DP1/DP2 cohort naming — full audit + recommended convention"
tags: [research, codebase, cohorts, naming, display-labels, fsd-config]
status: complete
last_updated: 2026-06-20
last_updated_by: Dobromir Kropielnicki
---

# Research: DP1/DP2 cohort naming — full audit + recommended convention

**Date**: 2026-06-20T18:42:28+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 7f14556dcfe1583096e590e54562276ecc0d2f91
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

Full audit of how the two cohorts are named across the codebase (identity tokens,
display labels, code consumers, data, and docs), surfacing every inconsistency —
and a recommended canonical convention plus a concrete, line-level fix list.

## Summary

There are **two naming axes**, and keeping them separate is the whole story:

- **Identity (data values):** `dp1` / `dp2` — a Postgres enum (`create type cohort as enum ('dp1','dp2')`), single-sourced into TypeScript via the generated `Database` types and projected through `src/shared/config/cohorts.ts`. This is **settled, shipped (2026-06-11), and must not change.**
- **Display (user-facing labels):** currently **"Year 1" / "Year 2"**, defined once in `src/shared/config/cohorts.ts`.

The change `dp1-dp2-cohort-naming` is **roadmap slice S-01**, and the codebase already
tells us exactly what it is: an **approved, ready, lowest-risk display relabel** — show
**"DP1" / "DP2"** everywhere instead of "Year 1" / "Year 2", with **zero change to the
`dp1`/`dp2` data values, schema, or constraint core**. The roadmap names the single risk:
**completeness** — "no stray 'Year 1' string." ([roadmap.md S-01](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/context/foundation/roadmap.md#L81-L90))

The audit found the relabel is **mostly cheap because the identity/display boundary is clean**: 5 of the 7 cohort-display surfaces already render through the central `COHORTS` config, so changing two label strings cascades to all of them. The leftover work is a small, finite set of **hardcoded display strings** (chiefly the teachers table), **one label test**, some **stale doc comments**, and two pieces of **separate documentation drift** (CLAUDE.md/README still say "Y12/Y13"; dead SQL snippets still say "Diploma Programme Year 1/2").

A secondary finding worth a decision: the **teachers slice maintains a parallel `y1`/`y2`
token system** (a third naming alias) that re-derives the cohort correspondence in 3–4
independent places. It does not block the relabel, but it is the one spot where "no stray
string" completeness is fragile, and it is the natural cleanup to fold in.

## Detailed Findings

### 1. Identity layer — `dp1` / `dp2` (settled, do not touch)

The canonical source of cohort identity is a native Postgres enum:

- [`supabase/migrations/20260611180006_plans_as_domain_root.sql:28`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/supabase/migrations/20260611180006_plans_as_domain_root.sql#L28) — `create type cohort as enum ('dp1', 'dp2');`. This migration also **dropped the old `cohorts` table** and its "Diploma Programme Year 1/2" seed rows, moving the cohort set from data into config.
- Columns using the enum: `courses`, `students`, `placements`, `course_groupings` (same migration), and `slot_bundles` ([`20260613123404_slot_bundles.sql:14`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/supabase/migrations/20260613123404_slot_bundles.sql#L14)).
- Generated TS mirror: [`src/shared/api/database.types.ts:519`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/shared/api/database.types.ts#L519) (`cohort: "dp1" | "dp2"`) and the runtime enum array at line 651.
- Data fixtures encode cohort **by folder, not by column**: `data/dp1/` and `data/dp2/` each hold the same four CSVs (`students_subjects`, `teachers_subjects`, `subjects_overlap`, `merge_subjects`). The folder → enum mapping is hardcoded in the seed transcoder: [`scripts/lib/catalog-transcode.mjs:30-31`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/scripts/lib/catalog-transcode.mjs#L30-L31) (`COHORT_DP1 = "dp1"`, `COHORT_DP2 = "dp2"`) → emitted into `supabase/seed.sql` as literal `'dp1'`/`'dp2'` values.
- **The generated `seed.sql` contains no human-readable cohort names** — only the enum literals. Display names live exclusively in code.

**Implication for S-01:** the relabel is display-only. None of the above changes.

### 2. Display layer — the single source of truth

[`src/shared/config/cohorts.ts`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/shared/config/cohorts.ts) is the one place display labels are defined:

```ts
export const COHORTS: readonly CohortOption[] = [
  { value: "dp1", label: "Year 1" },   // line 18
  { value: "dp2", label: "Year 2" },   // line 19
];
export const cohortLabel = (cohort: Cohort): string =>
  COHORTS.find((o) => o.value === cohort)?.label ?? cohort;  // lines 25-26
```

Re-exported via [`src/shared/config/index.ts:2`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/shared/config/index.ts#L2). Changing lines 18–19 to `"DP1"`/`"DP2"` is the **core of the change** and cascades to every consumer that reads `COHORTS[].label`.

**Consumers that already render correctly via `COHORTS` (auto-fixed by the central edit):**

- [`students/ui/StudentCatalog.tsx:72-77`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/_pages/students/ui/StudentCatalog.tsx#L72-L77) — cohort tabs
- [`courses/ui/CourseCatalog.tsx:78-83`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/_pages/courses/ui/CourseCatalog.tsx#L78-L83) — cohort tabs
- [`students/ui/StudentFormDialog.tsx:114-118`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/_pages/students/ui/StudentFormDialog.tsx#L114-L118) — cohort `<Select>`
- [`courses/ui/CourseFormDialog.tsx:158-162`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/_pages/courses/ui/CourseFormDialog.tsx#L158-L162) — cohort `<Select>`
- [`teachers/ui/TeacherCatalog.tsx:33-36`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/_pages/teachers/ui/TeacherCatalog.tsx#L33-L36) — filter buttons (label from `COHORTS[index].label`)

**No UI renders the raw `dp1`/`dp2` token to a user** — the identity/display boundary holds across courses, students, and plan-detail.

### 3. Hardcoded display strings (the manual part of the fix)

These do **not** go through `COHORTS` and must be edited by hand:

- [`teachers/ui/TeacherTable.tsx:65`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/_pages/teachers/ui/TeacherTable.tsx#L65) — `Year 1 - Courses` column header
- [`teachers/ui/TeacherTable.tsx:67`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/_pages/teachers/ui/TeacherTable.tsx#L67) — `Year 2 - Courses` column header
- [`teachers/ui/TeacherCatalog.tsx:32`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/_pages/teachers/ui/TeacherCatalog.tsx#L32) — `All years` filter option (not a cohort label, but reads oddly beside "DP1"/"DP2"; consider "All cohorts" — judgment call)

### 4. Test that asserts the labels

- [`src/shared/config/cohorts.test.ts:6-7`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/shared/config/cohorts.test.ts#L6-L7) — `expect(cohortLabel("dp1")).toBe("Year 1")` / `"Year 2"`. Must be updated in lockstep with the config, or `pnpm test` fails. No other test asserts the display string (the teacher tests assert filter tokens `y1`/`y2`, not labels — see §6).

### 5. Stale doc comments mentioning "Year 1 / Year 2" (cosmetic hygiene)

These are code comments, harmless at runtime, but part of "no stray Year 1 string":

- [`cohorts.ts:5`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/shared/config/cohorts.ts#L5) — "(Year 1 / Year 2 of the IB DP)"
- [`courses/ui/CourseCatalog.tsx:24`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/_pages/courses/ui/CourseCatalog.tsx#L24) — "as Year 1 / Year 2 tabs"
- [`plan-detail/api/load.ts:14`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/_pages/plan-detail/api/load.ts#L14) — "single-cohort for now (S-01 scope): Year 1. Year 2 arrives with S-09." **Doubly stale**: it both uses "Year 1/2" and references "S-09", which is the *old* roadmap id for the two-cohort board — the current roadmap calls it **S-04** (`two-cohort-board-cross-cohort`).

### 6. The teachers slice's parallel `y1`/`y2` token system (the fragile spot)

Teachers layers a **third naming alias** over `dp1`/`dp2`:

- [`filter-teachers.ts:4`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/_pages/teachers/model/filter-teachers.ts#L4) — `type YearFilter = "all" | "y1" | "y2"`
- [`filter-teachers.ts:6`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/_pages/teachers/model/filter-teachers.ts#L6) — `YEAR_TO_COHORT = { y1: "dp1", y2: "dp2" }` (hardcoded mapping #1)
- [`TeacherCatalog.tsx:34`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/_pages/teachers/ui/TeacherCatalog.tsx#L34) — `value: index === 0 ? "y1" : "y2"` (mapping #2, **positional** — couples `y1↔dp1` to `COHORTS` array order, not `.value`)
- [`TeacherTable.tsx:75-76,88,92`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/_pages/teachers/ui/TeacherTable.tsx#L75-L92) — hardcoded **identity** literals `"dp1"`/`"dp2"` passed to `cohortHours`/`cohortAssignments` (mapping #3)
- URL contract: `?year=y1` / `?year=y2` ([`filter-params.ts:13`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/_pages/teachers/model/filter-params.ts#L13))

For the **relabel specifically**, this slice is mostly fine: the filter **button** label comes from `COHORTS[index].label`, so it auto-updates to "DP1"/"DP2". Only the two table headers (§3) are hardcoded text. But this is exactly where the roadmap's "completeness" risk bites — the cohort correspondence is restated 3–4 times, so a reviewer must check each. It is also the one place that violates the team's single-sourcing principle (see Architecture Insights).

### 7. The few remaining hardcoded `dp1`/`dp2` **identity** literals (NOT changed by S-01)

For completeness/blast-radius awareness only — these are identity, not display, and S-01 leaves them as-is:

- [`plan-detail/api/load.ts:15`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/src/_pages/plan-detail/api/load.ts#L15) — `const BOARD_COHORT: Cohort = "dp1"` (the board is still single-cohort; freed later by roadmap S-04)
- `filter-teachers.ts:6` and `TeacherTable.tsx:75-76,88,92` (above)
- ~20 `*.test.ts` files use `"dp1"`/`"dp2"` as fixtures (low risk; would only matter for an enum *rename*, which is out of scope)

The constraint core (`plan-detail/model/constraints/`), drag payloads, and the catalog hash (`shared/lib/catalog-hash/`) are **fully cohort-agnostic** — they carry opaque ids only and need no attention.

## Code References

- `supabase/migrations/20260611180006_plans_as_domain_root.sql:28` — the `cohort` enum (identity source)
- `src/shared/api/database.types.ts:519` — generated `cohort: "dp1" | "dp2"`
- `src/shared/config/cohorts.ts:18-19` — **the labels to change** ("Year 1"/"Year 2" → "DP1"/"DP2")
- `src/shared/config/cohorts.ts:25-26` — `cohortLabel()` (defined + tested, **no production consumer** — UIs read `COHORTS[].label` directly)
- `src/shared/config/cohorts.test.ts:6-7` — label assertions to update
- `src/_pages/teachers/ui/TeacherTable.tsx:65,67` — hardcoded "Year 1/2 - Courses" headers
- `src/_pages/teachers/ui/TeacherCatalog.tsx:32` — hardcoded "All years"
- `src/_pages/teachers/model/filter-teachers.ts:4,6` — the parallel `y1`/`y2` alias + mapping
- `src/_pages/plan-detail/api/load.ts:14-15` — stale comment ("Year 1 … S-09") + `BOARD_COHORT = "dp1"`
- `scripts/lib/catalog-transcode.mjs:30-31` — folder→enum mapping (identity, unchanged)

## Architecture Insights

- **The relabel is cheap precisely because the codebase already separates identity from display.** This is the [`lessons.md`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/context/foundation/lessons.md) rule *"Port the mechanism, not the legacy type shape"* in practice: `dp1`/`dp2` are opaque identity tokens end-to-end (DB → loaders → Zod gates → URL params → constraint core), and display labels are confined to one config edge. A relabel touches the edge, not the mechanism.
- **`COHORTS` as the funnel is what makes "change two strings" possible.** 5 of 7 display surfaces read it. The exceptions (teacher table headers) are the cost of *not* funnelling, and argue for deriving those headers from `COHORTS` rather than re-hardcoding "DP1"/"DP2".
- **The teachers slice is the lone violator of single-sourcing.** A `y1`/`y2` filter alias plus positional + hardcoded restatements of the `y1↔dp1` correspondence is the kind of "parallel domain that must be mapped" the lessons file warns against. It is correct today but brittle: reorder `COHORTS` or add a cohort and `TeacherCatalog.tsx:34` silently diverges.
- **`cohortLabel()` is dead production code** — exported and unit-tested but never called (every UI uses `COHORTS[].label`). Either adopt it (e.g. teacher headers) or note it; the relabel is a natural moment to decide.

## Historical Context (from prior changes)

The naming has a clear, documented decision trail — and "Y12/Y13" was **rejected, never adopted**:

- **2026-06-07** — [`archive/2026-06-07-app-shell/research.md:49,59,200`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/context/archive/2026-06-07-app-shell/research.md#L49) flagged a 3-way conflict (CLAUDE.md "Year 12/13" vs PRD/roadmap "Year 1/2" vs seed "Diploma Programme Year 1/2") and **Decision 5 resolved it to "Year 1 / Year 2"**, explicitly *not* CLAUDE.md's "Year 12/13".
- **2026-06-07** — [`archive/2026-06-07-course-catalog/research.md:188`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/context/archive/2026-06-07-course-catalog/research.md#L188) re-affirmed "Year 1 / Year 2".
- **2026-06-11** — `multi-variant-management` shipped the `dp1`/`dp2` **enum**, dropping the `cohorts` table and its "Diploma Programme Year 1/2" rows. Display labels stayed "Year 1/2" in the new config constant.
- **2026-06-18** — the post-demo [`prd.md`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/context/foundation/prd.md#L98-L99) (FR-004, §"DP1/DP2 naming") and [`roadmap.md`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/context/foundation/roadmap.md#L81-L90) (S-01) **changed the target to "DP1 / DP2"** based on author feedback ("authors call the cohorts DP1/DP2, not Year 1/Year 2"). This is the mandate for the current change.
- **2026-06-20** — change folder `dp1-dp2-cohort-naming` opened (now `status: preparing`).

## Documentation drift (separate fix targets)

Two doc-level drifts exist independent of the UI relabel:

1. **CLAUDE.md / README still say "Y12/Y13"** — a label that was never agreed:
   - [`CLAUDE.md:10`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/CLAUDE.md#L10) — "two-cohort (Y12/Y13) constraint core"
   - [`README.md:91`](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/README.md#L91) — "two-cohort (Y12/Y13) constraint/validation core"
   - (README's `data/dp1`/`data/dp2` mentions at lines 184/192 are correct — leave them.)
2. **Dead SQL snippets still query the dropped `cohorts` table** by name "Diploma Programme Year 1/2": `supabase/snippets/teachers_subjects.csv.sql:7`, `students_subjects.csv.sql:7`, and `grouping_check.sql` (lines 25, 29, 35, 41, 47, 62, 68, 91, 97, 104, 111, 120, 137, 151). These silently match zero rows now.

Archived research files that contain "Y12/Y13" prose are immutable history — **do not edit** them.

## Recommendation

### Canonical convention (decision)

| Axis | Value | Status |
| --- | --- | --- |
| **Identity** (DB enum, data, URLs, code) | `dp1` / `dp2` | Settled — **do not change** |
| **Display** (all user-facing UI copy) | **"DP1" / "DP2"** | This change (S-01) |

Keep the two axes strictly separate: identity stays the opaque enum token; "DP1"/"DP2" is
display only. Phrase non-UI references (docs, comments) **identity-first** as `dp1`/`dp2`
so they stay stable regardless of future label tweaks.

### Fix list (ordered, in-scope for S-01)

1. **`src/shared/config/cohorts.ts:18-19`** — `label: "Year 1"` → `"DP1"`, `"Year 2"` → `"DP2"`. *(Cascades to all 5 `COHORTS`-driven surfaces.)*
2. **`src/shared/config/cohorts.test.ts:6-7`** — update assertions to `"DP1"` / `"DP2"`.
3. **`src/_pages/teachers/ui/TeacherTable.tsx:65,67`** — `"Year 1 - Courses"` → `"DP1 - Courses"`, `"Year 2 - Courses"` → `"DP2 - Courses"`. *Prefer deriving from `COHORTS[0].label`/`COHORTS[1].label` (or `cohortLabel("dp1")`) so they can never drift again.*
4. **`src/_pages/teachers/ui/TeacherCatalog.tsx:32`** — decide on `"All years"`: keep, or change to `"All cohorts"` for consistency with DP1/DP2. *(Judgment — recommend "All cohorts".)*
5. **Stale comments** — `cohorts.ts:5`, `courses/ui/CourseCatalog.tsx:24`, and `plan-detail/api/load.ts:14` (also fix the dead "S-09" → "S-04" reference there).

### Fix list (related, recommend a decision on scope)

6. **Docs drift** — `CLAUDE.md:10` and `README.md:91`: replace "(Y12/Y13)" with identity-first **"(dp1/dp2)"** (stable across the relabel) or "(DP1/DP2)". This is arguably part of "relabel everywhere," though it's docs not UI — fold in or split as a doc chore.
7. **Dead SQL snippets** — `supabase/snippets/*.sql`: separate cleanup (they reference a dropped table); out of S-01's UI scope but worth a tracking note so the obsolete "Diploma Programme Year 1/2" name isn't mistaken for live copy.

### Optional cleanup (own decision — not required for S-01)

8. **Single-source the teachers `y1`/`y2` alias** (`filter-teachers.ts`, `TeacherCatalog.tsx:34`, `TeacherTable.tsx`). Either derive everything from `COHORTS`/`Cohort`, or at minimum stop the positional `index === 0 ? "y1" : "y2"` mapping. Removes the one brittle spot and the only single-sourcing violation. Could ride along with S-01 or be its own small refactor.

### Verification (the roadmap's stated risk = completeness)

After the edits, prove "no stray label": `grep -rniE "year ?1|year ?2|year 12|year 13|y12|y13" src/` should return **only** intentional non-cohort matches, and `pnpm test` + `pnpm build` must stay green. The relabel touches **no schema, no constraint core, no `dp1`/`dp2` value** — so risk is confined to missed UI strings and the one label test.

## Related Research

- [`context/foundation/roadmap.md` S-01](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/context/foundation/roadmap.md#L81-L90) — the change's spec (outcome, risk = completeness)
- [`context/foundation/prd.md` FR-004 / §"DP1/DP2 naming"](https://github.com/dobrek/ib-timetable-planner/blob/7f14556dcfe1583096e590e54562276ecc0d2f91/context/foundation/prd.md#L98-L99) — the mandate
- `context/archive/2026-06-07-app-shell/research.md` — original cohort-label decision (Year 1/2)

## Open Questions

1. **"All years" filter label** — keep as-is, or change to "All cohorts" to match the DP1/DP2 framing? (Recommend "All cohorts".)
2. **Scope of the teachers `y1`/`y2` cleanup** — fold the single-sourcing refactor into S-01, or keep S-01 a pure relabel and track the refactor separately? (S-01's risk profile stays lowest if kept pure; the refactor is low-risk but is a behavior-adjacent change to filter code.)
3. **Docs drift ownership** — does S-01 own the CLAUDE.md/README "Y12/Y13" fix and the dead-snippet cleanup, or are those separate chores? (They're cheap; folding the doc fix in avoids leaving a known-wrong label in the two most-read files.)
