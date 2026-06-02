# Minimal Domain Schema Implementation Plan

## Overview

Create the Supabase Postgres schema that powers the northstar slice (S-01) and the
grouping algorithm port (F-03). Twelve tables covering cohorts, the course catalog
(with inline teacher FK), course dependencies (directional overlaps + merge groups),
students, teachers, plans with variants, placements, and a grouping cache. Row-Level
Security scoped to authenticated users. Generated TypeScript types wired into the
Supabase client. A dev seed populated from both `data/dp1/` and `data/dp2/` reference
fixtures.

## Current State Analysis

The Supabase instance is wired for **auth only**:

- `src/lib/supabase.ts` creates an SSR client via `@supabase/ssr` with the anon key. No
  `Database` generic — the client is untyped for Postgres tables.
- `supabase/config.toml` exists with `project_id = "ib-timetable-planner"`,
  `schema_paths = []`, and `sql_paths = ["./seed.sql"]` (but `seed.sql` does not exist).
- No `supabase/migrations/` directory, no `.sql` files anywhere in the repo.
- Two env vars (`SUPABASE_URL`, `SUPABASE_KEY`) are configured in `.envs/`, `astro.config.mjs:18`,
  and Wrangler secrets. No service-role key.
- Middleware (`src/middleware.ts`) resolves the user via `supabase.auth.getUser()` and
  enforces deny-by-default routing (F-01 complete).
- `src/lib/utils.ts` contains only `cn()`. No domain logic, types, or validators.

### Key Discoveries:

- `supabase/seed.sql` is referenced in `config.toml:63` but missing — `supabase db reset`
  skips seeding. Phase 3 creates this file.
- The hosted Supabase project is `hwmuiymhjgewtymymbmb` (Frankfurt). Migrations push via
  `supabase db push` or `supabase migration up` against the hosted project.
- `@supabase/supabase-js` v2.106.1 and `@supabase/ssr` v0.10.3 are installed — both support
  the `Database` generic for typed queries.
- CSV fixtures in **both** `data/dp1/` and `data/dp2/` have **no header rows** and use
  positional columns. The seed SQL must map columns by position.
- **All eight fixtures use CRLF (`\r\n`) line endings.** Five of the eight files do not end
  with a trailing newline (last byte is `,` or a digit), so a splitter that only detects
  `\r\n` boundaries will silently drop the final record. Verified row counts:
  dp2: students 280, teachers 44, overlaps 8, merges 4;
  dp1: students 233 (26 distinct), teachers 36, overlaps 10, merges 7.
  The seed generator must **strip the trailing `\r` and surrounding whitespace from every
  field** before use and must **tolerate inconsistent trailing commas**. This matters because
  course identity is a text join on `(name, level, group_index)` — an unstripped group `"1"`
  will not match `"1\r"`, and integer casts on `hours_per_week` / `group_index` break on
  `"4\r"`. Parse each row by splitting on `,` then stripping, not by fixed column widths.
- **`dp1/merge_subjects.csv` is ragged**: the 5 Spanish B rows have 4 columns; the 2 German B
  rows have a trailing comma giving 5 columns. `dp2/merge_subjects.csv` is uniformly 5
  columns. The generator's strip-and-tolerate-trailing-comma rule handles both, but fixed-
  width indexing (e.g. `cols[4]`) would silently read out-of-bounds on the 4-column rows.
  Parse only columns `[0]`–`[3]` for merge rows; never require a 5th column to be present.
- Merge parents (e.g., "Spanish B SL+HL") appear in `teachers_subjects.csv` and algorithm
  output. They are modeled as course rows with composite levels, linked to children via
  `course_merges`. A merge is a virtual combined teaching session — one teacher teaches
  all child-course students in the same slot simultaneously.
- Subject overlaps are **directed student-enrollment rules**, not symmetric pairs.
  "English A SL ← English A HL" means every HL student must also attend SL classes.
  The dp1 fixtures show this extends beyond SL/HL (e.g., EE students also attend CAS).
- Each course has exactly one teacher. The teacher relationship is a direct FK on
  `courses` (not a junction table), nullable until teachers are assigned in S-03.

## Desired End State

After this plan is complete:

- `supabase/migrations/` contains a single migration creating 12 tables with constraints,
  indexes, and RLS policies.
- `scripts/gen-seed.mjs` (committed) transcodes the dp1 + dp2 CSV fixtures into
  `supabase/seed.sql` (also committed), normalizing fields at generation time.
- `supabase/seed.sql` inserts two cohorts and the full dp1 + dp2 fixture set (courses with
  teacher FKs, students, choices, teachers, overlaps, merges), enabling `supabase db reset`
  to produce a working dev database.
- `src/lib/database.types.ts` contains auto-generated TypeScript types matching the schema.
- `src/lib/supabase.ts` uses the `Database` generic so all `.from('table')` calls are typed.
- `pnpm build` and `pnpm lint` pass. The CI gate (install → astro sync → lint → build)
  is green.

Verification: `supabase db reset` applies the migration + seed without errors; the Supabase
client accepts typed queries against every table; the CI gate passes.

## What We're NOT Doing

- No teacher availability table (S-03 owns that; the dp2 fixtures don't include it).
- No API endpoints or UI components — this is schema + types only.
- No domain logic, validators, or algorithms (F-03 owns the algorithm; S-01 owns the validator).
- No hosted migration push — the plan operates against the local Supabase stack only.
  Pushing to hosted is a manual step (documented in the provisioning runbook).
- No service-role key or admin API — RLS uses `auth.role() = 'authenticated'` only.
- No seed data beyond what the dp1/dp2 CSV fixtures provide — no synthetic or hand-crafted rows.

## Implementation Approach

Three phases: (1) a single DDL migration with all tables, constraints, indexes, and RLS;
(2) TypeScript type generation and Supabase client wiring; (3) seed data from the dp2
reference fixtures. Each phase is independently verifiable via the CI gate and manual checks.

## Critical Implementation Details

- **Nullable group_index.** Course identity is `(cohort_id, name, level, group_index)`.
  In the CSV fixtures, many courses have no group_index. Use `SMALLINT NOT NULL DEFAULT 0`
  with 0 meaning "no group" — avoids Postgres's NULL-inequality behavior in UNIQUE constraints
  (two NULLs don't violate UNIQUE, which would allow duplicate courses).
  The PRD (FR-002) defines `group-index ∈ {1, 2, none}`, but the fixtures reach index 3
  (EE/TOK/CAS have up to 3 parallel sections). The `SMALLINT` column has no CHECK constraint,
  which consciously accommodates this; application-layer validation (S-02) owns the bound.
- **Merge parent levels.** The `courses.level` column is `TEXT NOT NULL` without a CHECK
  constraint. PRD levels are `{SL, HL, AB, none}`, but merge parents carry composite levels
  (`SL+HL`, `AB+SL`, and dp1 shows `AB+SL+HL` for three-way merges). Validation lives in
  the application layer (S-02 UI), not in the schema.
- **Empty level sentinel.** Core-component rows (TOK, CAS, EE) have an empty level field in
  the fixtures, but `courses.level` is `TEXT NOT NULL`. Map empty level → `'none'` (matching
  the PRD's `{SL, HL, AB, none}` enum). This value must be applied identically on both the
  course insert and the student-choice / overlap / merge resolution, since the
  `(name, level, group_index)` join keys on it — an inconsistent sentinel silently drops rows.
- **Overlap directionality.** `course_overlaps` is **not symmetric**. The CSV
  `English A,SL,,English A,HL,` means "HL students also attend SL." Columns are
  `base_course_id` (receives extra students) and `dependent_course_id` (whose students
  also attend base). No `CHECK(a < b)` — the direction matters.
- **Seed ordering.** `seed.sql` must insert in FK order: cohorts → teachers → courses
  (with teacher_id) → overlaps/merges → students → student_choices → plans → plan_variants.
  No placements or groupings in the seed (those are author-created in S-01 / S-06).

---

## Phase 1: DDL Migration

### Overview

Create a single Supabase migration file containing all 12 tables, constraints, indexes,
RLS policies, and the `updated_at` trigger function. The migration is designed so
`supabase db reset` and `supabase migration up` apply it cleanly.

### Changes Required:

#### 1. Migration file

**File**: `supabase/migrations/<timestamp>_minimal_domain_schema.sql` (generated by CLI)

**Creation**: Run `pnpm exec supabase migration new minimal_domain_schema`, then author the
generated file. Never hand-craft the timestamp or filename — the CLI ensures the correct
format and ordering in `migration list`.

**Intent**: Define the full MVP domain schema in one migration. A single file keeps the
initial schema reviewable as one unit and avoids ordering dependencies between migration
files.

**Contract**: The migration creates these objects in dependency order:

**Utility — `updated_at` trigger:**

Use Supabase's shipped `moddatetime` extension rather than a custom function, to avoid the
`function_search_path_mutable` advisor warning:

```sql
create extension if not exists moddatetime with schema extensions;
```

Then attach `before update` triggers on every table that carries `updated_at` using
`execute function extensions.moddatetime(updated_at)`. Applied to: `cohorts`, `courses`,
`students`, `teachers`, `plans`, `plan_variants`.

If a custom trigger function is preferred instead, it must include `language plpgsql
set search_path = ''` to satisfy the advisor.

**Tables (12):**

| # | Table | Purpose | Key columns | Notable constraints |
|---|-------|---------|-------------|---------------------|
| 1 | `cohorts` | Year groups (DP Year 1, DP Year 2) | `id`, `name`, `created_at`, `updated_at` | `name UNIQUE` |
| 2 | `teachers` | Teacher roster (shared across cohorts) | `id`, `code`, `full_name`, timestamps | `code UNIQUE` |
| 3 | `courses` | Course catalog, cohort-scoped, with teacher | `id`, `cohort_id` FK, `teacher_id` FK (nullable), `name`, `level`, `group_index`, `hours_per_week`, timestamps | `UNIQUE(cohort_id, name, level, group_index)`, `hours_per_week > 0` |
| 4 | `course_overlaps` | Directed student-enrollment rule: dependent's students also attend base | `id`, `base_course_id` FK, `dependent_course_id` FK, `created_at` | `UNIQUE(base_course_id, dependent_course_id)` |
| 5 | `course_merges` | Virtual combined session: parent groups children taught together | `id`, `parent_course_id` FK, `child_course_id` FK, `created_at` | `UNIQUE(parent_course_id, child_course_id)` |
| 6 | `students` | Student roster, cohort-scoped | `id`, `cohort_id` FK, `full_name`, timestamps | — |
| 7 | `student_choices` | Student → course selections | `id`, `student_id` FK, `course_id` FK, `created_at` | `UNIQUE(student_id, course_id)` |
| 8 | `plans` | Timetable plan container | `id`, `name`, `slot_grid_preset`, timestamps | — |
| 9 | `plan_variants` | Draft/final variants of a plan | `id`, `plan_id` FK, `name`, `is_final`, timestamps | — |
| 10 | `placements` | Course → slot assignment per variant+cohort | `id`, `variant_id` FK, `cohort_id` FK, `day`, `period`, `course_id` FK, `created_at` | `UNIQUE(variant_id, cohort_id, day, period, course_id)`, `day 1–7`, `period 1–12` |
| 11 | `course_groupings` | Algorithm output cache | `id`, `plan_id` FK, `cohort_id` FK, `coverage_count`, `score`, `created_at` | — |
| 12 | `course_grouping_members` | Courses in a grouping | `grouping_id` FK, `course_id` FK | `PRIMARY KEY(grouping_id, course_id)` |

All FKs use `ON DELETE CASCADE` except `courses.teacher_id` which uses `ON DELETE SET NULL`
(a teacher deletion should not cascade-delete course rows).

`teachers` is created before `courses` because `courses.teacher_id` references it.

**Indexes (beyond PK/UNIQUE):**

| Table | Index | Purpose |
|-------|-------|---------|
| `courses` | `(cohort_id)` | Filter courses by cohort |
| `courses` | `(teacher_id)` | "Which courses does teacher X teach?" |
| `student_choices` | `(course_id)` | "Which students chose course X?" |
| `placements` | `(variant_id, cohort_id)` | All placements for a variant+cohort |
| `course_groupings` | `(plan_id, cohort_id)` | All groupings for a plan+cohort |
| `course_grouping_members` | `(course_id)` | "Groupings containing course X" — the primary query |

**RLS:**

Every table gets `ENABLE ROW LEVEL SECURITY` plus a single policy:
- Name: `"Authenticated users have full access"`
- Applies `FOR ALL TO authenticated` with `USING (true)` and `WITH CHECK (true)`.

Targeting the `authenticated` role directly (rather than `USING (auth.role() = 'authenticated')`)
is the current Supabase-recommended idiom: it lets the planner skip the predicate for the
`anon` role entirely and reads more clearly. This grants all CRUD to any authenticated user
and blocks anonymous/unauthenticated access, matching the "shared workspace" decision and the
deny-by-default middleware.

**Dependency note**: This model is safe because `enable_anonymous_sign_ins = false` in
`supabase/config.toml`. If anonymous sign-ins are ever enabled, anonymous users would carry
the `authenticated` Postgres role and gain full CRUD. Keep this setting disabled, or add
ownership predicates to the policies before enabling it.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `pnpm exec supabase db reset` completes without errors
- Migration is listed: `pnpm exec supabase migration list` shows the new migration as applied
- All 12 tables exist: query `information_schema.tables` for each table name
- RLS is enabled on all tables: query `pg_tables` where `rowsecurity = true`
- Advisors clean: `pnpm exec supabase db advisors` reports no errors (fix any
  `function_search_path_mutable` or `rls_disabled_in_public` findings before proceeding)

#### Manual Verification:

- In Supabase Studio (`http://127.0.0.1:54323`), all tables are visible under the
  `public` schema with correct columns and constraints
- RLS probe: a request to `http://127.0.0.1:54321/rest/v1/courses` with the **anon
  `apikey`** header but **no JWT** returns `HTTP 200 []` (empty array — RLS is filtering
  rows, not the missing key). A request with a valid authenticated JWT returns seeded rows
  once Phase 3 is done. (A request with no `apikey` at all returns 401, but that is the
  PostgREST key guard, not RLS.)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Type Generation & Client Wiring

### Overview

Generate TypeScript types from the live schema and wire them into the Supabase client
so all database queries are statically typed.

### Changes Required:

#### 1. Generate TypeScript types

**File**: `src/lib/database.types.ts` (new, auto-generated)

**Intent**: Produce a single-source-of-truth type file from the actual Postgres schema so
the TypeScript compiler catches column name typos, missing fields, and type mismatches
at build time rather than runtime.

**Contract**: Run `pnpm exec supabase gen types typescript --local` and write the output
to `src/lib/database.types.ts`. The file exports a `Database` interface with typed
definitions for every table's Row, Insert, and Update shapes. This file is auto-generated
and should not be hand-edited.

#### 2. Wire the Database generic into the Supabase client

**File**: `src/lib/supabase.ts`

**Intent**: Make every `.from('table_name')` call on the Supabase client return typed
rows, enabling IDE autocomplete and compile-time checking for all domain queries added
in downstream slices.

**Contract**: Import the `Database` type from `./database.types` and pass it as the
generic parameter to `createServerClient<Database>(...)`. No other changes to the
function signature or cookie handling.

#### 3. Exclude generated types from Prettier

**File**: `.prettierignore`

**Intent**: The auto-generated types file is large and has its own formatting from the
Supabase CLI. Prevent Prettier from reformatting it on every `pnpm format` run, which
would create noisy diffs.

**Contract**: Add `src/lib/database.types.ts` to `.prettierignore`.

#### 4. Exclude generated types from ESLint

**File**: `eslint.config.js`

**Intent**: `eslint.config.js` applies `tseslint.configs.strictTypeChecked` and
`stylisticTypeChecked` to all `.ts` files and ignores only paths from `.gitignore`. The
auto-generated types file is not hand-maintained, so type-aware lint rules firing on it
would block the `pnpm lint` success criterion with no useful remediation. (The
`.prettierignore` entry above already suppresses the `prettier/prettier` ESLint rule, since
`eslint-plugin-prettier` honors it — this step covers the remaining type-checked rules.)

**Contract**: Add `src/lib/database.types.ts` to an `ignores` array (e.g. via a leading
`{ ignores: ["src/lib/database.types.ts"] }` config object, or `globalIgnores([...])` from
`@eslint/config-helpers`) in the exported flat config. Verify `pnpm lint` passes afterward.

### Success Criteria:

#### Automated Verification:

- Type file exists and is non-empty: `wc -l src/lib/database.types.ts` shows > 50 lines
- Build passes with typed client: `pnpm build`
- Linting passes: `pnpm lint`
- Astro sync succeeds: `pnpm exec astro sync`

#### Manual Verification:

- In an editor, `supabase.from('courses')` offers autocomplete for column names
- The `Database` interface includes all 12 tables

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Seed Data from CSV Fixtures

### Overview

Create `supabase/seed.sql` populated from **both** `data/dp1/` and `data/dp2/` reference
fixtures so that `supabase db reset` produces a working dev database with both cohorts
populated — enabling F-03 development, the northstar demo, and the cross-cohort teacher
constraint workflow from day one.

### Changes Required:

#### 1. Seed file

**File**: `supabase/seed.sql` (new)

**Intent**: Give developers a one-command path (`supabase db reset`) to a populated
database with both cohorts. The seed uses dp1 + dp2 reference fixtures, enabling
F-03 to validate its output against both golden sets (`data/out/dp1-variants-2.csv`
and `data/out/dp2-variants-2.csv`).

**Mechanism**: `seed.sql` is a **generated artifact**, produced by a committed dev-time
script `scripts/gen-seed.mjs` (Node, run via `node scripts/gen-seed.mjs > supabase/seed.sql`).
The script reads the dp1/dp2 CSVs and performs **all normalization at generation time** — strip
the trailing `\r` (fixtures are CRLF; the final, newline-less row of each file carries none),
trim surrounding whitespace, tolerate inconsistent trailing commas, map empty `level` → `'none'`
and empty `group_index` → `0`, and cast `hours_per_week` / `group_index` to integers — then
resolves the `(name, level, group_index)` course identity and emits **clean inlined SQL literals**.

**Phantom-course reconciliation (mandatory assertion):** courses are built from the union of
`students_subjects` and `teachers_subjects` for each cohort. Because `teachers_subjects` defines
split subjects with explicit group indices (e.g. `Polish A SL 1`, `Polish A SL 2`) while a
student row for the same subject may carry a blank index (→ 0), the union can produce both
`(Polish A, SL, 0)` and `(Polish A, SL, 1)/(Polish A, SL, 2)` as separate course rows — a
phantom. This silently splits students from their teachers and corrupts the seed without
triggering any FK error or count shortfall.

The generator **must abort with a clear error message** if, for any `(cohort, name, level)`,
the course set contains both a `group_index = 0` row and one or more `group_index > 0` rows.
If this fires, it is a data inconsistency in the fixtures that must be fixed manually (e.g.,
by back-filling the group index on the relevant student rows), not silently resolved by the
generator. Zero student-choice rows should resolve to a course; the generator should also
assert that every student's `(name, level, group_index)` triple maps to exactly one course in
the built catalog, and fail loudly on any miss.
This deliberately avoids `COPY` / `\copy` at `db reset` time: the local Postgres runs in Docker
and cannot read repo-relative files, and `\copy` (a psql meta-command) is not reliably honored by
the CLI's seed executor. Both `scripts/gen-seed.mjs` and the generated `supabase/seed.sql` are
committed; regenerate and re-commit whenever the fixtures change. The emitted SQL inserts in FK
order, using CTEs (or chained `INSERT … RETURNING` within CTEs) to propagate auto-generated UUIDs
across dependent inserts (e.g., cohort id → courses → student_choices):

1. **Cohorts**: Two rows — "Diploma Programme Year 1" and "Diploma Programme Year 2".
2. **Teachers**: All distinct teacher codes from the union of `data/dp1/teachers_subjects.csv`
   and `data/dp2/teachers_subjects.csv` (same school — codes overlap heavily). `full_name`
   left NULL (fixtures have codes only). Inserted before courses because courses FK to
   teachers. Deduplicate on `code`.
3. **Courses (Year 1)**: All distinct courses from `data/dp1/students_subjects.csv` and
   `data/dp1/teachers_subjects.csv`, assigned to the Year 1 cohort. Includes dp1-specific
   courses (ESS, EE in student choices) and richer merges (Spanish B `AB+SL+HL`).
4. **Courses (Year 2)**: All distinct courses from `data/dp2/students_subjects.csv` and
   `data/dp2/teachers_subjects.csv`, assigned to the Year 2 cohort. Each course's
   `teacher_id` is set from the teacher code in the corresponding `teachers_subjects.csv`.
   Merge parents (composite levels) are included as course rows with their teacher.
   `hours_per_week` sourced from `teachers_subjects.csv` column 5. Courses appearing
   only in student data get `teacher_id = NULL` and a default of 4 hours.
5. **Course overlaps**: Directed rows from both `data/dp1/subjects_overlap.csv` (10 rows,
   includes CAS/EE overlaps) and `data/dp2/subjects_overlap.csv` (8 rows). CSV columns
   1–3 = `base_course_id`, columns 4–6 = `dependent_course_id`.
6. **Course merges**: Rows from both `data/dp1/merge_subjects.csv` (7 rows, includes
   3-way `AB+SL+HL`) and `data/dp2/merge_subjects.csv` (4 rows).
7. **Students**: Distinct student names from both fixture sets — dp1 students (~26)
   assigned to Year 1, dp2 students (~35) assigned to Year 2.
8. **Student choices**: All rows from both CSVs (~233 for dp1, ~280 for dp2), each
   mapping a student to a course in the correct cohort.
9. **Plans**: One seed plan ("Seed Plan") with `slot_grid_preset = '5x8'`.
10. **Plan variants**: One seed variant ("Draft 1", `is_final = false`).

No placements or groupings in the seed — placements are author-created (S-01), and
groupings are algorithm-generated (S-06).

Because `seed.sql` is generated (see **Mechanism** above), the UUID propagation lives in the
emitted SQL as CTEs / chained `INSERT … RETURNING`, not as hand-written `\set` variables; the
generator owns FK ordering and identity resolution.

#### 2. Verify config.toml seed path

**File**: `supabase/config.toml`

**Intent**: Confirm the existing `sql_paths = ["./seed.sql"]` under `[db.seed]` points
to the new file. No change expected — the config already references this path.

**Contract**: Read-only verification. If the path differs, update it.

### Success Criteria:

#### Automated Verification:

- `supabase db reset` completes without errors (migration + seed)
- Both cohorts seeded: `SELECT count(*) FROM cohorts` = 2
- Course count covers both cohorts: `SELECT count(*) FROM courses` returns the deduped
  union across both dp1 and dp2 fixture sets (separate rows per cohort — a course like
  "Physics SL" exists once in Y1 and once in Y2)
- Student count covers both: `SELECT count(*) FROM students` ≈ 61 (~26 dp1 + ~35 dp2)
- Student choices count covers both: `SELECT count(*) FROM student_choices` ≈ 513
  (~233 dp1 + ~280 dp2). A shortfall means rows were silently dropped by a failed
  `(name, level, group_index)` join (the CRLF/whitespace hazard)
- Teachers deduplicated across cohorts: `SELECT count(*) FROM teachers` = count of
  distinct codes in the union of dp1 + dp2 teacher CSVs
- Phantom-course guard: no `(cohort_id, name, level)` triple has both a `group_index = 0`
  row and a `group_index > 0` row. Query:
  ```sql
  SELECT cohort_id, name, level
  FROM courses
  GROUP BY cohort_id, name, level
  HAVING bool_or(group_index = 0) AND bool_or(group_index > 0);
  ```
  This must return 0 rows. If it returns any, the generator's assertion failed to fire or
  was bypassed — investigate and regenerate the seed.
- Build still passes: `pnpm build`

#### Manual Verification:

- In Supabase Studio, the Tables view shows populated rows in all seeded tables
- Course rows have correct `hours_per_week` values matching `teachers_subjects.csv`
- Merge parent courses (e.g., "Spanish B" with level "SL+HL") exist and have
  `course_merges` rows linking to their children — including dp1's 3-way merge
  (Spanish B `AB+SL+HL` → 3 children)
- dp1 CAS/EE overlaps appear in `course_overlaps` with correct directionality

**Implementation Note**: This is the final phase; after verification the change is ready to commit.

---

## Testing Strategy

No automated test runner is configured (CI = install → astro sync → lint → build).
Verification is the CI gate plus the manual and automated checks per phase.

### Manual Testing Steps:

1. `pnpm exec supabase db reset` — migration applies, seed populates. No errors.
2. In Studio, verify table structures, constraints, and row counts.
3. RLS probe: send a request to `http://127.0.0.1:54321/rest/v1/courses` with the
   `apikey: <anon-key>` header but no `Authorization` JWT — expect `HTTP 200 []` (RLS
   filtering rows, not blocking the key). Then send the same request with a valid
   `Authorization: Bearer <jwt>` — expect seeded course rows. (A request with no `apikey`
   at all returns 401, which is the PostgREST key guard, not RLS — don't confuse the two.)
4. Authenticated request (anon key + valid JWT) returns seeded course rows (same as above).
5. In the editor, `supabase.from('courses').select('*')` autocompletes and type-checks.

## Performance Considerations

No runtime performance impact from this change — it's schema + types only. The seed
data volume (~400 rows across all tables) is trivial. Indexes are chosen to support the
hot-path queries identified in the roadmap: per-cohort course lookup, per-course grouping
filtering, and per-variant placement retrieval.

## Migration Notes

- **Local stack**: `supabase db reset` applies the migration + seed in one step.
- **Hosted project**: `supabase db push` or `supabase migration up` applies the migration
  to the hosted Supabase instance. Seed data is NOT pushed to hosted — it's dev-only.
  After pushing, verify table grants: Supabase currently auto-grants `anon`/`authenticated`
  on new `public` tables, but the platform is transitioning to opt-in grants. If tables are
  unexpectedly inaccessible after push, add explicit `GRANT SELECT, INSERT, UPDATE, DELETE ON
  ALL TABLES IN SCHEMA public TO anon, authenticated;` and re-run `supabase db advisors`
  against the hosted project. RLS controls which rows are visible; grants control whether the
  table is reachable at all — both must be in place.
- **Rollback**: `supabase migration down` (if supported) or manually drop all tables.
  At this stage there is no production data to preserve.

## References

- Roadmap: `context/foundation/roadmap.md` (F-02, lines 86–99). **Note**: F-02 scopes 7 tables
  and defers teachers/overlaps/merges to S-02/S-03. This plan expands to 12 tables because
  F-03 (algorithm port) needs teachers and course dependencies as input; see plan-brief.md
  §Key Decisions for the rationale. The divergence is deliberate and documented.
- PRD: `context/foundation/prd.md` (FR-002, FR-003, FR-003A, FR-004, FR-006, FR-008, FR-010)
- CSV fixtures (dp1): `data/dp1/students_subjects.csv`, `data/dp1/teachers_subjects.csv`,
  `data/dp1/subjects_overlap.csv`, `data/dp1/merge_subjects.csv`
- CSV fixtures (dp2): `data/dp2/students_subjects.csv`, `data/dp2/teachers_subjects.csv`,
  `data/dp2/subjects_overlap.csv`, `data/dp2/merge_subjects.csv`
- Algorithm output references: `data/out/dp1-variants-2.csv`, `data/out/dp2-variants-2.csv`
- F-01 plan (parallel foundation): `context/changes/gated-author-provisioning/plan.md`
- Supabase client: `src/lib/supabase.ts`
- Deploy plan (schema section): `context/deployment/deploy-plan.md` (Phase 3)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DDL Migration

#### Automated

- [x] 1.1 Migration applies cleanly (`supabase db reset`) — 0133ae1
- [x] 1.2 Migration listed (`supabase migration list`) — 0133ae1
- [x] 1.3 All 12 tables exist (information_schema query) — 0133ae1
- [x] 1.4 RLS enabled on all 12 tables (pg_tables query) — 0133ae1
- [x] 1.5 Advisors clean (`supabase db advisors` — no `function_search_path_mutable` or `rls_disabled_in_public` errors) — 0133ae1

#### Manual

- [x] 1.6 Tables visible in Supabase Studio with correct columns/constraints — 0133ae1
- [x] 1.7 RLS probe: anon apikey + no JWT → `200 []`; valid authenticated JWT → rows returned — 0133ae1

### Phase 2: Type Generation & Client Wiring

#### Automated

- [x] 2.1 Type file exists and is non-empty
- [x] 2.2 Build passes with typed client (`pnpm build`)
- [x] 2.3 Linting passes (`pnpm lint`)
- [x] 2.4 Astro sync succeeds (`pnpm exec astro sync`)

#### Manual

- [x] 2.5 `.from('courses')` offers column autocomplete
- [x] 2.6 `Database` interface includes all 12 tables

### Phase 3: Seed Data from CSV Fixtures

#### Automated

- [ ] 3.1 `supabase db reset` completes without errors (migration + seed)
- [ ] 3.2 Both cohorts seeded (count = 2)
- [ ] 3.3 Course count covers both cohorts
- [ ] 3.4 Student count ≈ 61 (dp1 ~26 + dp2 ~35)
- [ ] 3.5 Student choices count ≈ 513 (no silent join drops)
- [ ] 3.6 Teachers deduplicated across cohorts
- [ ] 3.7 Build still passes (`pnpm build`)
- [ ] 3.12 Phantom-course guard: no `(cohort_id, name, level)` mixes group_index 0 and >0

#### Manual

- [ ] 3.8 Tables populated in Supabase Studio (both cohorts visible)
- [ ] 3.9 Course rows have correct `hours_per_week` values matching `teachers_subjects.csv`
- [ ] 3.10 Merge parent courses exist with correct `course_merges` links (including dp1 3-way)
- [ ] 3.11 dp1 CAS/EE overlaps present with correct directionality
