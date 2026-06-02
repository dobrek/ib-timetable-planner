# Minimal Domain Schema — Plan Brief

> Full plan: `context/changes/minimal-domain-schema/plan.md`

## What & Why

Create the Supabase Postgres schema that underpins the entire product — 12 tables
covering cohorts, courses (with inline teacher FK), directional overlaps, merge groups,
students, teachers, plans, variants, placements, and a grouping algorithm cache.
Without this schema, neither the grouping algorithm port (F-03) nor the northstar
drop-and-validate slice (S-01) can start. The scope was expanded beyond the roadmap's
original 7 tables because the grouping algorithm requires teachers and course
dependencies as input.

## Starting Point

Supabase is wired for auth only. No migrations directory, no `.sql` files, no generated
TypeScript types. The Supabase client (`src/lib/supabase.ts`) works but is untyped —
there are no tables to query. The `data/dp1/` and `data/dp2/` CSV fixtures define the
domain shape (dp2: ~35 students, ~18 teachers; dp1: ~26 students) and together serve as
the dev seed — both cohorts populated.

## Desired End State

A single `supabase db reset` produces a fully populated dev database. The TypeScript
Supabase client is typed via auto-generated `Database` interface, enabling IDE
autocomplete and compile-time checking for every `.from('table')` call. The CI gate
(install → astro sync → lint → build) passes. F-03 can read domain types and begin
the algorithm port; S-01 has the placement and grouping tables it needs.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|----------|--------|-------------------|--------|
| Table scope | 12 tables (expanded from 7) | F-03 algorithm needs teachers + dependencies as input | Plan |
| Teacher model | `teacher_id` FK on courses (not a junction) | Each course has exactly one teacher; simpler than M:N | Plan |
| Cohort model | Separate `cohorts` table | Courses and students scoped per cohort; cleaner than enum | Plan |
| Course-cohort relation | FK on courses (1 cohort per course) | Y1 and Y2 may offer different course sections | Plan |
| Overlap semantics | Directed enrollment rule (base ← dependent) | HL students must also attend SL; direction matters for validator | Plan |
| Merge semantics | Virtual combined session (parent → children) | One teacher teaches all child-course students simultaneously | Plan |
| Placement cohort | Explicit `cohort_id` column | Direct cross-cohort queries for S-09 constraint | Plan |
| Hours per week | Column on `courses` table | Hours are a course property, not teacher-specific | Plan |
| RLS strategy | All authenticated users share all data | Single-school instance, handful of plan authors | Plan |
| Groupings storage | Materialized table + junction | Per-course filtering via standard FK joins; works with PostgREST | Plan |
| Group index sentinel | `SMALLINT DEFAULT 0` (0 = no group) | Avoids NULL-inequality in UNIQUE constraints | Plan |
| Teacher availability | Deferred to S-03 | Not needed for F-03 basic operation; dp2 fixtures lack it | Plan |

## Scope

**In scope:**
- DDL migration: 12 tables, constraints, indexes, RLS policies, `updated_at` trigger
- TypeScript type generation from schema + client generic wiring
- Dev seed from both `data/dp1/` and `data/dp2/` CSV reference fixtures
- `.prettierignore` entry for generated types

**Out of scope:**
- Teacher availability table (S-03)
- API endpoints or UI components
- Domain logic, validators, or algorithms (F-03, S-01)
- Hosted migration push (manual step per runbook)
- Service-role key or admin API
- Synthetic data beyond what dp1/dp2 CSV fixtures provide

## Architecture / Approach

Single Supabase migration → local schema. Type generation via `supabase gen types
typescript --local` → `src/lib/database.types.ts`. Client wiring adds the `Database`
generic to `createServerClient<Database>()`. Seed SQL inserts fixtures in FK order using
CTEs to propagate auto-generated UUIDs. All queries go through PostgREST (Supabase JS
client), not direct Postgres connections, consistent with the Cloudflare Workers runtime.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|-------|------------------|----------|
| 1. DDL Migration | 12 tables + constraints + indexes + RLS | Constraint design errors surface only at seed/query time |
| 2. Type Generation & Client Wiring | Typed `Database` interface + client generic | Generated types may need lint exceptions for auto-generated code |
| 3. Seed Data | Populated dev DB from dp1 + dp2 fixtures (both cohorts) | CSV positional mapping; teacher deduplication; dp1 3-way merges |

**Prerequisites:** Local Supabase stack running (`supabase start`). F-01 complete (auth gate).
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- Merge parent courses use composite levels (`SL+HL`, `AB+SL`, `AB+SL+HL`) that fall
  outside the PRD's `{SL, HL, AB, none}` enum — accepted; app-layer validation in
  S-02 handles this.
- Overlap directionality (base ← dependent) must be seeded consistently with the CSV
  column order: columns 1–3 are the base, columns 4–6 are the dependent.
- Both cohorts seeded from fixtures. Golden outputs exist for both (`data/out/dp1-variants-2.csv`,
  `data/out/dp2-variants-2.csv`) — F-03 can validate against both.

## Success Criteria (Summary)

- `supabase db reset` applies migration + seed without errors, producing a populated dev DB
- `pnpm build` and `pnpm lint` pass with the typed Supabase client
- All 12 tables have RLS enabled; unauthenticated PostgREST requests return 401
