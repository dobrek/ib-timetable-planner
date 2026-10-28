-- fail_closed_policies: every human-facing policy follows the caller's role (S-403, FR-410, FR-416,
-- FR-417, FR-418).
--
-- Before this file, 16 tables carry one `ALL to authenticated using (true) with check (true)`
-- policy, and `profiles` lets every signed-in user read every row, so any session reads and writes
-- everything. After it, access follows the role in `user_roles` (20261028140939_user_roles.sql):
--   * Reading plan, catalog, student and job data needs a role: `private.can_read()`.
--   * Writing it needs `admin` or `author`: `private.can_edit()`.
--   * A user without a role reaches none of it, but still reads and writes their own profile and
--     reads their own role row, so they can manage their account (FR-410).
--   * A machine user whose token hook misfires holds no role row, so it now reads nothing. Before
--     this file it read the whole database.
--
-- POLICIES NAME CAPABILITIES, NEVER ROLES, so the role → capability map stays in the two
-- wrappers. Every helper call is wrapped in `(select …)`, which makes it an InitPlan, run once
-- per table reference instead of once per row (research §2.6: `clone_plan` calls `can_read` 18
-- times wrapped, 10540 unwrapped). Every policy names `to authenticated`: a policy without a role
-- clause applies to PUBLIC.
--
-- UPDATE's USING is `can_read`, not `can_edit`. A viewer's UPDATE then reaches the row and fails
-- WITH CHECK, a loud 42501, rather than matching no rows and reporting success. Authors and admins
-- hold both capabilities, so nothing changes for them.
--
-- WHY `DROP POLICY` IS NOT DATA LOSS. Migrations here are additive because hosted holds real school
-- data, and a policy holds none: dropping one removes no row and no column. Splitting one `ALL`
-- policy into four per-command ones cannot be done in place, because `alter policy` cannot change a
-- policy's command, so this file drops and creates. The file applies as one transaction (below), so
-- no request ever sees a table with its old policy gone and the new ones missing.
--
-- MATCHED BY SHAPE, NOT NAME. Hosted policy names may have drifted from this series, as one did
-- before (20260812141459_solver_select_column_scope.sql). So the rewrite finds its targets by what
-- they do (`ALL`, `to authenticated`, `true` both ways), and the post-conditions prove the result.
--
-- THE SECURITY DEFINER EXCEPTION lives in 20261028140939_user_roles.sql, with its reasons. This
-- file defines no function: its policies call the INVOKER wrappers that migration created.
--
-- DELIBERATELY NO RE-BACKFILL. A human created after 20261028140939 holds no role until an operator
-- gives one with `scripts/assign-role.mjs`, and every such human is assigned one, or deliberately
-- left without, before this merges. Backfilling again here would silently undo a deliberate `none`.
--
-- Untouched: the solver's two `to solver_job_writer` policies on `generation_jobs`, the own-row
-- INSERT and UPDATE policies on `profiles` (role-free on purpose), `user_roles`' own-row read, and
-- `custom_access_token_hook`. No grant changes: grants decide whether a table is reachable at all,
-- and these policies decide which rows, now by role.
--
-- ATOMIC. The CLI sends this file as one batch, which runs as one implicit transaction with its
-- `schema_migrations` row last, so a failed post-condition aborts all of it and records nothing.
-- Hence no explicit BEGIN or COMMIT, no CONCURRENTLY and no VACUUM: each would split the batch.
-- `set local` prints "WARNING: SET LOCAL can only be used in transaction blocks". That warning is
-- expected; the setting still holds for the rest of the file.
--
-- LOCKS. Each policy change takes an AccessExclusiveLock on its table until commit, across 17
-- tables. A lock waiting behind a long `clone_plan` would stall every request that arrives after
-- it, so the wait is capped: a busy moment fails the deploy, which can be re-run.

set local lock_timeout = '5s';

-- The 16 `ALL using (true)` policies, each replaced by four per-command ones. The names are the
-- same on every table, so a policy's name says which capability it asks for.
do $$
declare
  target    record;
  rewritten integer := 0;
begin
  for target in
    select tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and cmd = 'ALL'
       and roles = '{authenticated}'
       and qual = 'true'
       and with_check = 'true'
     order by tablename, policyname
  loop
    execute format('drop policy %I on public.%I', target.policyname, target.tablename);

    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.can_read()))',
      'Readers read every row', target.tablename
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select private.can_edit()))',
      'Editors insert rows', target.tablename
    );
    execute format(
      'create policy %I on public.%I for update to authenticated '
        'using ((select private.can_read())) with check ((select private.can_edit()))',
      'Editors update rows', target.tablename
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select private.can_edit()))',
      'Editors delete rows', target.tablename
    );

    rewritten := rewritten + 1;
  end loop;

  if rewritten <> 16 then
    raise exception 'fail_closed_policies: rewrote % `ALL using (true)` policies, expected 16', rewritten;
  end if;
end;
$$;

-- `profiles`: its read-all SELECT, found by shape, becomes "your own row, or any row once you hold
-- a role". The own-row clause is load-bearing: a role-less user's display-name upsert runs
-- `on conflict do update`, which checks the existing row against this SELECT policy, so without
-- the clause FR-410's account page could not save a name (research §2.4, probes E and F).
do $$
declare
  target  record;
  dropped integer := 0;
begin
  for target in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = 'profiles'
       and cmd = 'SELECT'
       and qual = 'true'
  loop
    execute format('drop policy %I on public.profiles', target.policyname);
    dropped := dropped + 1;
  end loop;

  if dropped <> 1 then
    raise exception 'fail_closed_policies: found % read-all SELECT policies on profiles, expected 1', dropped;
  end if;
end;
$$;

create policy "Users read their own profile, readers every profile" on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.can_read()));

-- Post-conditions. Any failure aborts the whole file, with nothing applied and nothing recorded.
do $$
declare
  open_policies     text[];
  unreadable_tables text[];
begin
  -- No policy a session can fall under keeps a literal `true`. The solver's policies are scoped
  -- `to solver_job_writer`, which no human session holds, so they are out of scope here.
  select array_agg(format('%s: %s', tablename, policyname) order by tablename, policyname)
    into open_policies
    from pg_policies
   where schemaname = 'public'
     and roles && array['authenticated', 'public']::name[]
     and (qual = 'true' or with_check = 'true');
  if open_policies is not null then
    raise exception 'fail_closed_policies: policies still open to every session: %', open_policies;
  end if;

  -- Every RLS table but `user_roles`, whose own-row read is the account carve-out, has a SELECT
  -- policy that asks `can_read()`, so a table the rewrite missed fails here.
  select array_agg(c.relname::text order by c.relname)
    into unreadable_tables
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and c.relrowsecurity
     and c.relname <> 'user_roles'
     and not exists (
       select 1
         from pg_policies p
        where p.schemaname = 'public'
          and p.tablename = c.relname
          and p.cmd = 'SELECT'
          and p.roles = '{authenticated}'
          and p.qual like '%private.can_read()%'
     );
  if unreadable_tables is not null then
    raise exception 'fail_closed_policies: no SELECT policy reads can_read() on %', unreadable_tables;
  end if;
end;
$$;
