# DP1 / DP2 Cohort Naming Implementation Plan

## Overview

Implement roadmap slice **S-01**: relabel the two IB cohorts from the display strings
**"Year 1" / "Year 2"** to **"DP1" / "DP2"** everywhere they surface in the UI, with **zero
change** to the `dp1` / `dp2` data values, the `cohort` Postgres enum, URL identity, or the
constraint core. The change also folds in two adjacent cleanups the user scoped in: (1)
single-sourcing the teachers slice's parallel `y1` / `y2` filter alias onto the real cohort
vocabulary, and (2) documentation / dead-code hygiene (stale comments, CLAUDE.md/README
"Y12/Y13" drift, and dead SQL snippets).

## Current State Analysis

The cohort naming has two clean axes (per `research.md`):

- **Identity (data values):** `dp1` / `dp2` — a Postgres enum (`create type cohort as enum
  ('dp1','dp2')`), single-sourced into TypeScript via the generated `Database` types and
  projected through `src/shared/config/cohorts.ts`. **Settled, shipped 2026-06-11, untouched
  by this change.**
- **Display (user-facing labels):** currently **"Year 1" / "Year 2"**, defined once in
  `src/shared/config/cohorts.ts:18-19`.

The identity/display boundary is clean: **5 of 7 cohort-display surfaces already render
through the central `COHORTS` config**, so flipping two label strings cascades to all of
them. The leftovers are a small finite set: two hardcoded teacher-table headers, one label
test, three stale comments, and (separately) docs + dead SQL drift.

The **teachers slice** layers a third naming alias (`y1` / `y2`) over `dp1` / `dp2`, restating
the correspondence in 3–4 places including a brittle **positional** `index === 0 ? "y1" :
"y2"` mapping. The user chose to fold the single-sourcing of this alias into S-01.

### Key Discoveries

- `src/shared/config/cohorts.ts:18-19` — **the two labels to change**; cascades to 5 surfaces
  via `COHORTS[].label`.
- `src/shared/config/cohorts.ts:25-26` — `cohortLabel()` is exported + unit-tested but **has
  no production consumer**. Phase 2 adopts it for the teacher headers (per user decision).
- `src/shared/config/cohorts.test.ts:6-7` — asserts the labels; must move in lockstep or
  `pnpm test` fails.
- `src/_pages/teachers/` — the `y1`/`y2` alias spans 7 files (5 source + 2 tests): see Phase 2.
- The `?year=y1` / `?year=y2` **URL contract** lives in `filter-params.ts`; the full rename
  changes it to `?cohort=dp1` / `?cohort=dp2` (no production users/bookmarks to preserve —
  README states there is no production data yet).
- `supabase/snippets/*.sql` query the **dropped** `cohorts` table by `name='Diploma Programme
  Year …'` — fully non-functional (zero rows), not merely mislabeled.

## Desired End State

Every user-facing cohort label in the app reads **"DP1"** or **"DP2"**. The teachers slice
carries a single cohort vocabulary end-to-end (no `y1`/`y2` alias; `?cohort=dp1` URL).
Documentation and dead code no longer reference the never-adopted "Y12/Y13" or the dropped
`cohorts` table. The `dp1`/`dp2` data values, schema, constraint core, and the catalog hash
are bit-for-bit unchanged.

**Verification of the end state** (the roadmap's stated risk = *completeness*): after all
phases, `grep -rniE "year ?1|year ?2|year ?12|year ?13|y12|y13" src/` returns **only**
intentional non-cohort matches, the teachers slice has no `y1`/`y2`/`YearFilter` token, and
`pnpm test` + `pnpm build` + `pnpm steiger` + `pnpm lint` all stay green.

## What We're NOT Doing

- **Not changing any `dp1`/`dp2` data value, the `cohort` enum, schema, migrations, or seed.**
- **Not touching the constraint core** (`plan-detail/model/constraints/`), drag payloads, or
  the catalog hash — they are cohort-agnostic (opaque ids only).
- **Not changing `BOARD_COHORT = "dp1"`** in `plan-detail/api/load.ts:15` — the board stays
  single-cohort; the second cohort is freed by roadmap **S-04**, not here. (Only the *stale
  comment* on line 14 is fixed.)
- **Not rewriting** the `~20 *.test.ts` fixtures that use `"dp1"`/`"dp2"` — those are identity,
  correct, and only matter for an enum rename (out of scope).
- **Not rewriting** the dead SQL snippets against the new `cohort` enum — they are deleted, not
  re-pointed (a salvage rewrite would be its own task; git history preserves them).

## Implementation Approach

Three phases, ordered to land the S-01 mandate first and isolate risk:

1. **Phase 1 — Core relabel** edits the single config constant + its test. This *is* S-01 and
   cascades to student/course tabs & selects and the teacher filter buttons. Independently
   shippable.
2. **Phase 2 — Teachers slice** does all teachers-file work in one coherent pass (so each file
   is touched once): derive the two table headers from `COHORTS`, rename "All years" → "All
   cohorts", and replace the `y1`/`y2` alias with the full cohort vocabulary, updating the two
   teacher tests in lockstep. This is the only behavior-adjacent change (filter + URL contract),
   so it is isolated.
3. **Phase 3 — Hygiene** fixes stale comments, the CLAUDE.md/README "Y12/Y13" drift, and
   deletes the dead SQL snippets. Pure cleanup; the final completeness grep lives here.

After Phase 1, the two teacher *table headers* transiently still read "Year 1/2 - Courses"
(they are hardcoded and fixed in Phase 2); every phase is internally green and consistent.

## Phase 1: Core display relabel

### Overview

Flip the two display labels at their single source and update the test that pins them. This
cascades automatically to the 5 surfaces that render via `COHORTS[].label`.

### Changes Required:

#### 1. Cohort label config

**File**: `src/shared/config/cohorts.ts`

**Intent**: Change the two display labels from the school-year framing to the cohort framing
the authors actually use. This is the core of S-01.

**Contract**: Lines 18–19 — `label: "Year 1"` → `"DP1"`, `label: "Year 2"` → `"DP2"`. The
`value` fields (`"dp1"`/`"dp2"`), `COHORT_VALUES`, `cohortSchema`, and `cohortLabel()`
behavior are unchanged.

#### 2. Cohort label test

**File**: `src/shared/config/cohorts.test.ts`

**Intent**: Keep the label assertions in lockstep with the config so `pnpm test` passes.

**Contract**: Lines 6–7 — `expect(cohortLabel("dp1")).toBe("DP1")`,
`expect(cohortLabel("dp2")).toBe("DP2")`. The test description ("maps cohorts to their
school-year label") should be reworded to drop "school-year".

### Success Criteria:

#### Automated Verification:

- [ ] Unit tests pass: `pnpm test`
- [ ] Production build is clean: `pnpm build`
- [ ] Lint passes: `pnpm lint`

#### Manual Verification:

- [ ] Student catalog tabs and the student form's cohort `<Select>` show "DP1" / "DP2"
- [ ] Course catalog tabs and the course form's cohort `<Select>` show "DP1" / "DP2"
- [ ] Teacher catalog filter *buttons* show "DP1" / "DP2" (auto-cascaded via `COHORTS`)

**Implementation Note**: After automated verification passes, pause for human confirmation
that the manual checks above passed before starting Phase 2.

---

## Phase 2: Teachers slice — finish relabel + single-source the cohort filter

### Overview

Resolve every remaining cohort-naming concern inside `src/_pages/teachers/` in one pass:
derive the two table headers from `COHORTS` (adopting the dead `cohortLabel`), rename the
"All years" filter option to "All cohorts", and replace the parallel `y1`/`y2` alias with the
real cohort vocabulary end-to-end (`CohortFilter = "all" | Cohort`, `?cohort=dp1` URL).

### Changes Required:

#### 1. Filter model — drop the `y1`/`y2` alias

**File**: `src/_pages/teachers/model/filter-teachers.ts`

**Intent**: Replace the parallel year token with the cohort identity so the filter no longer
re-derives the `y1↔dp1` correspondence.

**Contract**: `type YearFilter = "all" | "y1" | "y2"` → `type CohortFilter = "all" | Cohort`
(import `Cohort` from `@/shared/config`). Delete `YEAR_TO_COHORT`. In `filterTeachers`, the
parameter becomes `cohortFilter: CohortFilter` and the active branch compares
`a.cohort === cohortFilter` directly (the filter value *is* the cohort).

#### 2. URL filter params — `?year=` → `?cohort=`

**File**: `src/_pages/teachers/model/filter-params.ts`

**Intent**: Mirror the new vocabulary in the URL contract so the public query key matches the
domain. No back-compat shim (no production bookmarks to preserve).

**Contract**: `TeacherFilters.year: YearFilter` → `cohort: CohortFilter`. `VALID_YEARS`
becomes a set of `"all" | "dp1" | "dp2"` (prefer deriving valid cohort values from
`COHORT_VALUES`). `readFilterParams` reads/validates `params.get("cohort")`; `toFilterSearch`
writes `params.set("cohort", …)`, still omitting the `"all"` default.

#### 3. Filter state hook

**File**: `src/_pages/teachers/model/use-catalog-filters.ts`

**Intent**: Rename the state field + setter to cohort vocabulary.

**Contract**: `TeacherFilterState.year`/`setYear` → `cohort`/`setCohort`; the
`useUrlSyncedFilters` default object key `year: "all"` → `cohort: "all"`. Type imports switch
to `CohortFilter`.

#### 4. Teacher catalog — derive options from `COHORTS`, drop positional mapping

**File**: `src/_pages/teachers/ui/TeacherCatalog.tsx`

**Intent**: Build the filter options directly from `COHORTS` (each option's value *is*
`cohort.value`), eliminating the brittle `index === 0 ? "y1" : "y2"` positional coupling.
Rename "All years" → "All cohorts".

**Contract**: `yearOptions` → `cohortOptions: { value: CohortFilter; label: string }[]` =
`[{ value: "all", label: "All cohorts" }, ...COHORTS.map((c) => ({ value: c.value, label:
c.label }))]`. Replace `filters.year`/`filters.setYear`/`yearFilter` usages with the cohort
names. Update the group's `aria-label="Filter by year"` → `"Filter by cohort"`.

#### 5. Teacher table — derive headers from `COHORTS`, cohort-typed dimming

**File**: `src/_pages/teachers/ui/TeacherTable.tsx`

**Intent**: Replace the two hardcoded `"Year 1 - Courses"` / `"Year 2 - Courses"` headers
with values derived from `COHORTS` (so they can never drift), and retype the dimming helper
to cohort values.

**Contract**: Headers render `` `${cohortLabel("dp1")} - Courses` `` / `` `${cohortLabel("dp2")}
- Courses` `` (or `${COHORTS[0].label}`/`${COHORTS[1].label}`). The `Props.yearFilter:
YearFilter` → `cohortFilter: CohortFilter`; `cohortGroupClass(yearFilter, "y1"|"y2")` →
`cohortGroupClass(cohortFilter, cohort: Cohort)` called with `"dp1"`/`"dp2"`; `totalColumnClass`
parameter retyped. The `cohortHours`/`cohortAssignments` calls already pass `"dp1"`/`"dp2"` —
unchanged.

#### 6. Teacher filter tests

**Files**: `src/_pages/teachers/model/filter-teachers.test.ts`,
`src/_pages/teachers/model/filter-params.test.ts`

**Intent**: Update the test inputs to the new vocabulary so they pass and now document the
cohort contract.

**Contract**: In `filter-teachers.test.ts`, the filter-argument literals `"y1"`/`"y2"` →
`"dp1"`/`"dp2"`. In `filter-params.test.ts`, `?year=y1` → `?cohort=dp1`, the `year:` result
keys → `cohort:`, and the serialization expectations `q=…&year=y2` → `q=…&cohort=dp2`. Keep
at least one invalid-value case (e.g. `?cohort=ghost` → `"all"`).

### Success Criteria:

#### Automated Verification:

- [ ] Unit tests pass: `pnpm test`
- [ ] FSD structure check passes: `pnpm steiger`
- [ ] Lint passes: `pnpm lint`
- [ ] Production build is clean: `pnpm build`
- [ ] No `y1`/`y2`/`YearFilter` token remains in the slice: `grep -rniE "yearfilter|year_to_cohort|\"y1\"|\"y2\"|year=y|\\?year" src/_pages/teachers/` returns nothing

#### Manual Verification:

- [ ] Teacher table column headers read "DP1 - Courses" / "DP2 - Courses"
- [ ] The filter row shows "All cohorts", "DP1", "DP2"; each filters the table correctly and dims the non-selected cohort columns as before
- [ ] Selecting a cohort filter updates the URL to `?cohort=dp1` / `?cohort=dp2`; reloading the page preserves the selection; clearing returns to a clean URL

**Implementation Note**: After automated verification passes, pause for human confirmation
that the manual checks passed before starting Phase 3.

---

## Phase 3: Documentation & dead-code hygiene

### Overview

Remove the remaining non-UI references to the old/never-adopted labels: stale code comments,
the CLAUDE.md/README "Y12/Y13" drift, and the dead SQL snippets that query the dropped
`cohorts` table.

### Changes Required:

#### 1. Stale code comments

**Files**: `src/shared/config/cohorts.ts`, `src/_pages/courses/ui/CourseCatalog.tsx`,
`src/_pages/plan-detail/api/load.ts`

**Intent**: Reword comments that still say "Year 1 / Year 2" to the cohort framing, and fix
the doubly-stale comment in `load.ts`.

**Contract**: `cohorts.ts:5` "(Year 1 / Year 2 of the IB DP)" → cohort phrasing (e.g. "the two
IB DP cohorts, dp1 / dp2"); `CourseCatalog.tsx:24` "as Year 1 / Year 2 tabs" → "as DP1 / DP2
tabs"; `load.ts:14` reword "Year 1 … Year 2 arrives with S-09" to identity-first phrasing and
correct the roadmap id **`S-09` → `S-04`**. (Do **not** change `BOARD_COHORT` on line 15.)

#### 2. Project docs — drop "Y12/Y13"

**Files**: `CLAUDE.md`, `README.md`

**Intent**: Replace the never-adopted "Y12/Y13" with the identity-first `dp1/dp2` so the two
most-read docs match the codebase and stay stable across future label tweaks.

**Contract**: `CLAUDE.md:10` "two-cohort (Y12/Y13) constraint core" → "two-cohort (dp1/dp2)
constraint core"; `README.md:91` "two-cohort (Y12/Y13) constraint/validation core" →
"two-cohort (dp1/dp2) …". Leave the correct `data/dp1`/`data/dp2` mentions (README ~184/192)
untouched.

#### 3. Dead SQL snippets

**Files**: `supabase/snippets/students_subjects.csv.sql`,
`supabase/snippets/teachers_subjects.csv.sql`, `supabase/snippets/grouping_check.sql`

**Intent**: Delete these diagnostic snippets. They join the **dropped** `cohorts` table by
`name='Diploma Programme Year …'` and now match zero rows; a relabel cannot make them correct.
Git history preserves them if a `cohort`-enum rewrite is ever wanted.

**Contract**: Remove the three files. (If the reviewer prefers to keep `supabase/snippets/` as
a directory of live diagnostics, the alternative is a `cohort`-enum rewrite — out of scope
here; default is deletion.)

### Success Criteria:

#### Automated Verification:

- [ ] Completeness grep is clean: `grep -rniE "year ?1|year ?2|year ?12|year ?13|y12|y13" src/` returns only intentional non-cohort matches
- [ ] No dead cohort-table reference remains: `grep -rni "Diploma Programme Year" supabase/` returns nothing
- [ ] Docs are clean: `grep -rni "y12/y13\|y12\|y13" CLAUDE.md README.md` returns nothing
- [ ] Production build is clean: `pnpm build`
- [ ] Lint passes: `pnpm lint`

#### Manual Verification:

- [ ] The reworded comments and the `CLAUDE.md`/`README.md` `dp1/dp2` mentions read correctly in context
- [ ] No remaining file in `supabase/snippets/` references the dropped `cohorts` table

**Implementation Note**: After automated verification passes, pause for human confirmation of
the final completeness review.

---

## Testing Strategy

### Unit Tests:

- `cohorts.test.ts` — label assertions now expect "DP1" / "DP2".
- `filter-teachers.test.ts` — cohort-value filter inputs (`"dp1"`/`"dp2"`) keep producing the
  same row sets (behavior is unchanged; only the token changes).
- `filter-params.test.ts` — `?cohort=dp1` round-trips; invalid values fall back to `"all"`;
  defaults are omitted from the serialized query.

### Integration Tests:

- None required — no schema, action, or Supabase-touching code changes. The existing suites
  must remain green (run via `pnpm test`; integration/e2e via CI).

### Manual Testing Steps:

1. On a plan, open Students and Courses: confirm tabs + cohort selects read "DP1"/"DP2".
2. Open Teachers: confirm filter buttons "All cohorts / DP1 / DP2" and table headers "DP1 -
   Courses" / "DP2 - Courses".
3. Click "DP1": rows filter, DP2 columns dim, URL becomes `?cohort=dp1`; reload preserves it;
   click "All cohorts" → clean URL.
4. Spot-check the plan-detail board still loads (single-cohort, unaffected).

## Performance Considerations

None. The change touches display strings and a filter token type; the <200 ms placement
validation budget and the constraint core are not in scope.

## Migration Notes

No data or schema migration. The only contract change is the teacher filter URL key
(`?year=` → `?cohort=`); there is no production data or saved links to migrate (README:
"There is no production data to preserve yet").

## References

- Research: `context/changes/dp1-dp2-cohort-naming/research.md`
- Roadmap slice: `context/foundation/roadmap.md` S-01 (lines 81–91)
- PRD mandate: `context/foundation/prd.md` FR-004 / §"DP1/DP2 naming"
- Label source: `src/shared/config/cohorts.ts:18-19`
- Teachers alias: `src/_pages/teachers/model/filter-teachers.ts`,
  `src/_pages/teachers/ui/TeacherCatalog.tsx:34`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Core display relabel

#### Automated

- [x] 1.1 Unit tests pass: `pnpm test` — 301702c
- [x] 1.2 Production build is clean: `pnpm build` — 301702c
- [x] 1.3 Lint passes: `pnpm lint` — 301702c

#### Manual

- [x] 1.4 Student catalog tabs and student form cohort select show "DP1" / "DP2" — 301702c
- [x] 1.5 Course catalog tabs and course form cohort select show "DP1" / "DP2" — 301702c
- [x] 1.6 Teacher catalog filter buttons show "DP1" / "DP2" (auto-cascaded) — 301702c

### Phase 2: Teachers slice — finish relabel + single-source the cohort filter

#### Automated

- [x] 2.1 Unit tests pass: `pnpm test`
- [x] 2.2 FSD structure check passes: `pnpm steiger`
- [x] 2.3 Lint passes: `pnpm lint`
- [x] 2.4 Production build is clean: `pnpm build`
- [x] 2.5 No `y1`/`y2`/`YearFilter` token remains in the teachers slice (grep)

#### Manual

- [ ] 2.6 Teacher table headers read "DP1 - Courses" / "DP2 - Courses"
- [ ] 2.7 Filter row shows "All cohorts" / "DP1" / "DP2"; filtering + column dimming work
- [ ] 2.8 Selecting a cohort updates URL to `?cohort=dp1`/`?cohort=dp2`; reload preserves; clear → clean URL

### Phase 3: Documentation & dead-code hygiene

#### Automated

- [ ] 3.1 Completeness grep over `src/` returns only intentional matches
- [ ] 3.2 `grep "Diploma Programme Year" supabase/` returns nothing
- [ ] 3.3 `grep` for "y12"/"y13" in CLAUDE.md/README returns nothing
- [ ] 3.4 Production build is clean: `pnpm build`
- [ ] 3.5 Lint passes: `pnpm lint`

#### Manual

- [ ] 3.6 Reworded comments and CLAUDE.md/README `dp1/dp2` mentions read correctly
- [ ] 3.7 No remaining `supabase/snippets/` file references the dropped `cohorts` table
