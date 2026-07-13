# Runbook: copy the gold plan from production → local Supabase

> **✅ Executed 2026-07-12** via Method 3 (below). Verified locally: plan "2026/2027", dp1 = 48
> occupied slots / dp2 = 47, 125 teacher_availability rows, all 15 tables matching prod counts.
> ⚠️ Discovered: the gold plan's UUID **is** the seed's "Seed Plan A" id (prod was seeded, renamed,
> hand-built; catalogs have since drifted — prod: 17 teachers/85 courses/609 choices vs seed:
> 18/84/548). The import therefore **replaces** local Seed Plan A (full delete+insert, one
> transaction). Side effect: `pnpm bench:generation` fails locally while the import is in place —
> it looks up the plan **by name** "Seed Plan A" (`bench/generation.bench.ts`). `db reset`
> restores the seed (and erases the import).

Copies the **entire** gold plan — catalog, board, groupings, shelf, availability — preserving
all original UUIDs. Table set and FK-safe order derived from `clone_plan`
(`supabase/migrations/20260711174905_clone_plan_include_board.sql`), the authoritative
definition of "everything plan-related".

- Gold plan id: `fefd03e5-fc72-4706-8a12-524811c9cf3f`
- Prod project: `hwmuiymhjgewtymymbmb` (eu-central-1)
- ⚠️ `pnpm exec supabase db reset` wipes the import — re-run this runbook afterwards.
- Prerequisite: local and prod migration sets must match (both on `main`). A column-count
  error in step 3 means they've drifted — align migrations first.

## Method 1 (recommended): postgres_fdw pull — everything runs in LOCAL Studio

No data ever passes through your clipboard; local Postgres pulls straight from prod
(read-only on the prod side).

**Step 0.** Local stack running (`pnpm exec supabase start`), migrations current.

**Step 1.** Get the prod **Session pooler** credentials: Supabase Dashboard → project
`hwmuiymhjgewtymymbmb` → **Connect** → *Session pooler* (IPv4-safe; do **not** use the
transaction pooler on 6543, and the direct `db.<ref>.supabase.co` host is IPv6-only and
usually unreachable from Docker). Expected values (verify against the dashboard):
host `aws-0-eu-central-1.pooler.supabase.com`, port `5432`, db `postgres`,
user `postgres.hwmuiymhjgewtymymbmb`, password = the DB password (the `SUPABASE_DB_PASSWORD`
CI secret).

**Step 2.** Open **local** Studio → SQL editor (http://127.0.0.1:54323) and run the setup
(paste the real password; note `current_user` so the mapping matches whichever role Studio uses):

```sql
create extension if not exists postgres_fdw;

create server prod_gold foreign data wrapper postgres_fdw
  options (host 'aws-0-eu-central-1.pooler.supabase.com', port '5432',
           dbname 'postgres', sslmode 'require');

create user mapping for current_user server prod_gold
  options (user 'postgres.hwmuiymhjgewtymymbmb', password '<PROD_DB_PASSWORD>');

create schema if not exists prod_gold;

import foreign schema public
  limit to (plans, teachers, teacher_availability, courses, course_overlaps, course_merges,
            course_teachers, students, student_choices, bundles, placements,
            course_groupings, course_grouping_members, shelf_bundles, shelf_bundle_courses)
  from server prod_gold into prod_gold;
```

**Step 3.** Copy the plan (one transaction; FK-safe order; IDs preserved verbatim):

```sql
begin;

insert into public.plans                   select * from prod_gold.plans                   where id      = 'fefd03e5-fc72-4706-8a12-524811c9cf3f';
insert into public.teachers                select * from prod_gold.teachers                where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f';
insert into public.teacher_availability    select * from prod_gold.teacher_availability    where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f';
insert into public.courses                 select * from prod_gold.courses                 where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f';
insert into public.course_overlaps         select * from prod_gold.course_overlaps         where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f';
insert into public.course_merges           select * from prod_gold.course_merges           where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f';
insert into public.course_teachers         select * from prod_gold.course_teachers         where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f';
insert into public.students                select * from prod_gold.students                where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f';
insert into public.student_choices         select * from prod_gold.student_choices         where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f';
insert into public.bundles                 select * from prod_gold.bundles                 where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f';
insert into public.placements              select * from prod_gold.placements              where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f';
insert into public.course_groupings        select * from prod_gold.course_groupings        where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f';
insert into public.course_grouping_members select * from prod_gold.course_grouping_members where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f';
insert into public.shelf_bundles           select * from prod_gold.shelf_bundles           where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f';
insert into public.shelf_bundle_courses    select * from prod_gold.shelf_bundle_courses    where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f';

commit;
```

Any error rolls the whole copy back — nothing partial lands. A "INSERT has more/fewer
expressions than target columns" error = migration drift between prod and local.

**Step 4.** Verify — row counts plus the gold plan's real per-cohort slot numbers
(these are the long-deferred "checkpoint 2.8" manual counts):

```sql
select 'teachers' as t, count(*) from teachers               where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f'
union all select 'courses',            count(*) from courses            where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f'
union all select 'students',           count(*) from students           where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f'
union all select 'student_choices',    count(*) from student_choices    where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f'
union all select 'placements',         count(*) from placements         where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f'
union all select 'bundles',            count(*) from bundles            where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f'
union all select 'shelf_bundles',      count(*) from shelf_bundles      where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f';

select cohort,
       count(*)                        as placement_rows,
       count(distinct (day, period))   as occupied_slots
  from placements
 where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f'
 group by cohort;
```

Then open http://localhost:4321/plans/fefd03e5-fc72-4706-8a12-524811c9cf3f — the full board,
catalog, and groupings should render.

**Step 5.** Cleanup (removes the stored prod password from local Postgres):

```sql
drop server prod_gold cascade;          -- drops user mapping + foreign tables
drop schema if exists prod_gold cascade;
```

## Method 2 (no DB password): JSON copy-paste between the two Studios

If you'd rather not use the DB password, run per table — first in **prod** Studio:

```sql
select coalesce(json_agg(t), '[]'::json) from <table> t
 where plan_id = 'fefd03e5-fc72-4706-8a12-524811c9cf3f';
-- plans: where id = '…' instead of plan_id
```

Copy the JSON cell, then in **local** Studio (dollar-quoting survives apostrophes in names):

```sql
insert into public.<table>
select * from json_populate_recordset(null::public.<table>, $json$ <PASTED JSON> $json$);
```

Repeat for all 15 tables **in the Method-1 order**. Caveats: `placements` and
`student_choices` are the big ones (hundreds/thousands of rows) — if Studio truncates the
result cell, split the query by cohort; run everything before `bundles` first, board tables last.

## Method 3 (what was actually executed, 2026-07-12): management API + json_populate_recordset

No DB password needed — uses the Supabase CLI's stored access token (read-only queries on prod)
and the local Docker psql. Automatable end to end:

1. Token: the CLI stores it in the macOS keychain **Go-keyring base64-wrapped** — decode with
   `RAW=$(security find-generic-password -s "Supabase CLI" -w)`;
   `TOKEN=$(printf '%s' "${RAW#go-keyring-base64:}" | base64 -d)`.
2. Per table (15, FK order from Method 1), read via the management API:
   `POST https://api.supabase.com/v1/projects/hwmuiymhjgewtymymbmb/database/query` with
   `{"query": "select coalesce(json_agg(t), '[]'::json) as data from public.<table> t where plan_id = '<id>'"}`
   (plans: `where id =`). Save each response's `[0].data` array to `<table>.json`.
3. Generate one transactional SQL file: `begin;` → deletes in **reverse** FK order
   (`delete from public.<table> where plan_id = '<id>'`, finally the `plans` row — required
   because of the Seed-Plan-A id collision) → inserts in FK order:
   `insert into public.<table> select * from json_populate_recordset(null::public.<table>, '<json>'::json);`
   (escape single quotes in the JSON by doubling) → `commit;`.
4. Run: `docker exec -i supabase_db_ib-timetable-planner psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < import.sql`.
5. Verify with the Step-4 queries above.

## Durable snapshot: `data/golden-plan.sql` (preferred restore path since 2026-07-12)

After the import, the author cloned the plan locally via `clone_plan` → **"Golden Plan"**,
id `4bc9fe99-33ae-4c58-9b66-9b8477dad33f` (all UUIDs re-minted ⇒ **never collides with the
generated seed**, unlike the original `fefd03e5-…` id). That clone is dumped to
**`data/golden-plan.sql`** (~0.9 MB, **LOCAL-ONLY — gitignored, never commit**: it contains
production data — real student/teacher names and the school's actual timetable; the committed
`data/*.csv` fixtures went through a PII scrub, this dump did not): one transaction of
delete-then-insert for all 15 tables with frozen column lists, ending in integrity assertions
(248 placements / 609 choices / 125 availability / 2435 grouping members / dp1 = 48 / dp2 = 47).

Restore after any `supabase db reset` (idempotent, atomic, fails loudly):

```bash
docker exec -i supabase_db_ib-timetable-planner psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -f - < data/golden-plan.sql
```

Round-trip verified 2026-07-12 (delete + reload + assertions on a live DB). **Full cycle also
verified the same day**: `supabase db reset` → seed back at its deterministic ids → snapshot
restore (zero collisions, assertions pass) → `clone_plan(golden, 'Golden Catalog Clone', false)`
→ identical catalog (incl. 125 availability rows), empty board, generation-ready.

Durability consequence of local-only: if this machine's copy is lost, **prod is the backup of
record** — re-acquire via Methods 1–3 below. The future `scripts/` backup tool must therefore
target **private storage** (local disk, private bucket), never the public repo.

## Notes

- IDs are preserved on purpose (cross-database copy — no collision risk beyond the intended
  Seed-Plan-A replacement, full provenance). Don't use `clone_plan` for the *cross-DB copy*; it
  deliberately re-mints every UUID (which is exactly why it was right for the local
  "Golden Plan" snapshot clone).
- To re-import after a `db reset`: load `data/golden-plan.sql` (above). Methods 1/3 are only
  needed to re-sync from prod.
- Optional: `update plans set name = name || ' [GOLD]' where id = 'fefd03e5-…';` locally to
  distinguish it from seed plans in the plans list.
- Candidate scope item: formalize Method 3 as a `scripts/` export/import tool — doubles as a
  per-plan **backup procedure** (portable artifact) and the analyzer's acquisition path.
