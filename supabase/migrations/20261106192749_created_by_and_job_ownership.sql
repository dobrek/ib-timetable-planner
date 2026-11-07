-- created_by_and_job_ownership: who created each plan, who requested each generation job and who
-- asked it to stop, and only the requester or an admin may stop it (S-407, FR-415, FR-416, FR-417).
--
-- WHAT THIS ADDS.
--   * `plans.created_by`, `generation_jobs.requested_by` and `generation_jobs.stop_requested_by`:
--     each a nullable FK to `auth.users`, set to null when that user is deleted, and indexed so the
--     set-null is no scan (the `unindexed_foreign_keys` advisor is a gate here).
--   * `private.can_stop_any_job()`, a capability wrapper held by `admin` alone. Policies and helpers
--     name capabilities, never roles, so the role → capability map grows here and nowhere else.
--   * `private.guard_job_attribution()`, an INVOKER trigger on `generation_jobs`: the stop guard.
--   * `plans_updated_at` narrowed again, so clearing a deleted creator leaves "Last updated" alone.
--   No SECURITY DEFINER function, no new policy, and no grant change.
--
-- CREDIT COMES FROM DEFAULTS. `created_by` and `requested_by` default to `auth.uid()`, so the write
-- code does not change. Every human insert runs under the user's own session: the hub's new plan,
-- the INVOKER `clone_plan` (latest: 20260711174905) behind both Duplicate and Generate, and the job
-- insert. `clone_plan` inserts an explicit `(name, slot_grid_preset)` list, so the new column takes
-- its default inside the RPC: a duplicate is credited to whoever duplicated it, and a proposal to
-- whoever pressed Generate (S-404 relied on the same fact for `is_current`). The service role (the
-- seed, the factories) has no `auth.uid()`, so its rows record nobody. Each default is set after its
-- column exists, so no existing row is ever credited by the migration: there is no backfill, and the
-- post-conditions assert it.
--
-- NULL MEANS TWO THINGS. A null creator or requester means "predates S-407" or "that user was
-- deleted". Both render "Unknown", and both leave a job stoppable by any editor. S-411, which
-- brings account deletion, decides whether to tell them apart with a kind column (S-406's
-- `actor_kind` is the precedent).
--
-- WHY AN IDENTITY CHECK LIVES IN A TRIGGER. This is the first rule in the schema that depends on
-- whose row it is in a table everyone shares, so the reason is recorded here, as CLAUDE.md records
-- its SECURITY DEFINER exception:
--   * RLS judges rows, never column changes. A policy cannot see the old row, so it cannot say
--     "this UPDATE sets the stop flag".
--   * Every plan-scoped table holds exactly the four capability policies, which the role matrix's
--     structural check pins, so a fifth, restrictive policy is not open. A WITH CHECK on the flag
--     would also refuse delivery: after a stop-and-keep, another editor's delivery UPDATE carries
--     the row's non-null flag.
--   * Delivery, stale-job reclaim and `notified_at` UPDATE the same rows, and must stay open to any
--     editor (PRD Open Question 1). The trigger fires only for an INSERT or for an UPDATE naming
--     `requested_by`, `stop_requested_at` or `stop_requested_by`. `stopGeneration`'s two writes
--     are the app's only writers of `stop_requested_at`, so delivery and reclaim never reach it.
--
-- THE GUARD. It judges a signed-in session (`current_user = 'authenticated'`) only:
--   * INSERT: the requester is stamped from `auth.uid()`, whatever the payload names, so a forged
--     requester is overwritten. A row inserted already flagged records its inserter as the stopper.
--   * UPDATE: `requested_by` never changes. A stop write (one that changes `stop_requested_at`) is
--     refused with 42501 unless the job records no requester, the caller requested it, or the
--     caller holds `stop_any_job`. The first stopper is recorded, and a later re-stamp keeps it.
--     A stop is never withdrawn: clearing `stop_requested_at` is refused for every signed-in caller.
--     `stop_requested_by` is never written directly.
--   The order is load-bearing. The early return comes before anything reads `auth.uid()`. The
--   requester pin comes before the stop check, which judges ownership against OLD. The refusal of a
--   direct `stop_requested_by` write comes last, because the stamp is what legitimately changes it.
--   Values are compared with `is distinct from`: an `update of` column list fires whenever a column
--   is in the SET list, changed or not, and PostgREST sends exactly the columns it is given.
--   A viewer does reach this guard: the UPDATE policy's USING is `can_read()`, and its WITH CHECK
--   (`can_edit()`) runs only after BEFORE row triggers. On another user's job the guard refuses a
--   viewer; on their own job the guard passes and WITH CHECK refuses them. Either way it is 42501, so
--   a requester demoted to viewer loses Stop, and an admin can still stop the job.
--
-- EVERY OTHER CALLER PASSES, the account-deletion cascade included.
--   * The service role keeps explicit ids, which the factories and the role matrix rely on.
--   * The solver (`solver_job_writer`) holds no privilege on the three columns, and its writes
--     never name them.
--   * An FK's `on delete set null` runs as the referencing table's owner (20261105080343 records it,
--     and asserts that owner may read `auth.users`), so the cascade's `current_user` is the owner,
--     never `authenticated`. That is a different mechanism from S-406's depth exemption, and a
--     simpler one: S-406 must tell a cascade apart from a DELETE a signed-in session issues from
--     another trigger, while here no signed-in session can run as the owner. The post-conditions
--     assert the owners, and `src/test/job-attribution.integration.test.ts` deletes a user who
--     requested and stopped a job.
--
-- THE RESIDUAL GAP IS ACCEPTED. The standard policies still let any editor set any terminal status
-- (`failed`, `stopped`, `interrupted`) on, or DELETE, someone else's running job by a direct write:
-- `status` is not in the trigger's column list. Closing it would mean gating every
-- active-to-terminal change, which collides with reclaim. Only the app's server-side actions write,
-- and the publishable key never reaches a browser.
--
-- `plans.created_by` HAS NO GUARD. It is a label and gates nothing. No app path writes it (create
-- and rename take explicit Zod-checked fields, and `clone_plan` an explicit column list), and no
-- browser reaches PostgREST. Revisit if it ever authorizes anything.
--
-- NEVER WRITE `created_by` TOGETHER WITH ANOTHER `plans` COLUMN. `plans_updated_at` now skips any
-- UPDATE that changes `created_by`, as it skips one that changes `is_current` (S-404), so that a
-- deleted user's set-null cascade does not move "Last updated" on every plan they created. A write
-- that changed `created_by` and another column would change the plan and keep its old date. Today
-- only that cascade writes the column. `generation_jobs.updated_at` still moves on the cascade;
-- nothing in the app reads it.
--
-- ATOMIC, AND LOCKS CAPPED. One implicit transaction, as every file here. Adding the columns takes
-- an AccessExclusiveLock on `plans` and `generation_jobs` until commit, and each foreign key takes a
-- SHARE ROW EXCLUSIVE lock on `auth.users`, which holds GoTrue's writes (a sign-in's
-- `last_sign_in_at`) until this file commits. A lock waiting behind an in-flight write would stall
-- every request that arrives after it, so the wait is capped: a busy moment fails the deploy, which
-- can be re-run. Validating the keys is trivial, since every new value is null. `set local` prints
-- "WARNING: SET LOCAL can only be used in transaction blocks"; the setting holds for the rest of
-- the file.

set local lock_timeout = '5s';

-- Who created each plan ------------------------------------------------------------------------

alter table public.plans
  add column created_by uuid references auth.users (id) on delete set null;

alter table public.plans
  alter column created_by set default auth.uid();

comment on column public.plans.created_by is
  'Who created the plan, by New, Duplicate or Generate (S-407). Defaults to auth.uid(); null when '
  'it predates S-407, the service role made it, or its creator was deleted. A label: it gates nothing. '
  'Never write it together with another column (plans_updated_at skips such an update).';

create index plans_created_by_idx on public.plans (created_by);

create or replace trigger plans_updated_at
  before update on public.plans
  for each row
  when (
    old.is_current is not distinct from new.is_current
    and old.created_by is not distinct from new.created_by
  )
  execute function extensions.moddatetime(updated_at);

-- Who requested each job, and who asked it to stop ----------------------------------------------

alter table public.generation_jobs
  add column requested_by uuid references auth.users (id) on delete set null,
  add column stop_requested_by uuid references auth.users (id) on delete set null;

alter table public.generation_jobs
  alter column requested_by set default auth.uid();

comment on column public.generation_jobs.requested_by is
  'Who pressed Generate (S-407): stamped by generation_jobs_guard_attribution for a signed-in '
  'session, and never changed by one. Null when the job predates S-407, the service role made it, '
  'or its requester was deleted; such a job may be stopped by any editor.';

comment on column public.generation_jobs.stop_requested_by is
  'Who first asked the job to stop (S-407): stamped by generation_jobs_guard_attribution with '
  'stop_requested_at, never written directly by a signed-in session. Null when nobody did, when the '
  'stop predates S-407, or when the stopper was deleted.';

create index generation_jobs_requested_by_idx on public.generation_jobs (requested_by);
create index generation_jobs_stop_requested_by_idx on public.generation_jobs (stop_requested_by);

-- The capability wrapper -----------------------------------------------------------------------

create function private.can_stop_any_job()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.current_app_role() = 'admin'
$$;

comment on function private.can_stop_any_job() is
  'Whether the caller may stop a generation job someone else requested: admin only (S-407). '
  'INVOKER, over current_app_role(). Null for a caller with no role.';

revoke execute on function private.can_stop_any_job() from public, anon;
grant execute on function private.can_stop_any_job() to authenticated;

-- The stop guard -------------------------------------------------------------------------------

create function private.guard_job_attribution()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The service role, the solver and the FK cascade (which runs as the owner) pass untouched: see
  -- EVERY OTHER CALLER PASSES above. Nothing before this line may read auth.uid().
  if current_user is distinct from 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.requested_by := auth.uid();
    new.stop_requested_by := case when new.stop_requested_at is null then null else auth.uid() end;
    return new;
  end if;

  if new.requested_by is distinct from old.requested_by then
    raise exception using errcode = '42501', message = 'A generation job''s requester cannot change.';
  end if;

  if new.stop_requested_at is distinct from old.stop_requested_at then
    -- A stop is never withdrawn, not even by the requester or an admin. Clearing the flag would leave
    -- a stopper with no stop, let a requester undo an admin's stop before the solver sees it, and let
    -- a later stop record a new "first" stopper. No app path clears it (only `stopGeneration` writes
    -- the flag, and always with a timestamp).
    if new.stop_requested_at is null then
      raise exception using errcode = '42501', message = 'A requested stop cannot be withdrawn.';
    end if;
    -- `is not true`, not `not`: the wrapper answers null for a caller with no role, and a null must
    -- refuse here, never fall through as a pass.
    if old.requested_by is not null
       and old.requested_by is distinct from auth.uid()
       and private.can_stop_any_job() is not true then
      raise exception using errcode = '42501',
        message = 'Only whoever started this generation, or an admin, can stop it.';
    end if;
    -- The first stopper wins: a re-stamp keeps whoever asked first.
    new.stop_requested_by := case
      when old.stop_requested_at is null then auth.uid()
      else old.stop_requested_by
    end;
  elsif new.stop_requested_by is distinct from old.stop_requested_by then
    raise exception using errcode = '42501', message = 'Who stopped a generation job is recorded, never written.';
  end if;

  return new;
end;
$$;

comment on function private.guard_job_attribution() is
  'Stamps a job''s requester and first stopper, refuses rewriting either or withdrawing a stop, and '
  'refuses a stop by anyone but the requester or a stop_any_job holder, for signed-in sessions only (S-407).';

create trigger generation_jobs_guard_attribution
  before insert or update of requested_by, stop_requested_at, stop_requested_by on public.generation_jobs
  for each row execute function private.guard_job_attribution();

-- A trigger function is never called directly: EXECUTE is checked when a trigger is created, not
-- when it fires.
revoke execute on function private.guard_job_attribution() from public, anon, authenticated;

-- Post-conditions. Any failure aborts the whole file, with nothing applied and nothing recorded.
do $$
declare
  definer_functions  text[];
  invoker_functions  text[];
  unpinned_functions text[];
  executors          text[];
  missing            text[];
  credited           bigint;
  new_functions constant text[] := array['private.can_stop_any_job()', 'private.guard_job_attribution()'];
begin
  select array_agg(format('%s.%s', n.nspname, p.proname) order by n.nspname, p.proname)
    into definer_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef
     and n.nspname in ('public', 'private');
  if definer_functions is distinct from array['private.current_app_role'] then
    raise exception 'created_by_and_job_ownership: SECURITY DEFINER functions are %, not private.current_app_role alone',
      definer_functions;
  end if;

  select array_agg(f order by f) into invoker_functions
    from unnest(new_functions) as f
   where not (select prosecdef from pg_proc where oid = f::regprocedure);
  if invoker_functions is distinct from new_functions then
    raise exception 'created_by_and_job_ownership: only % of the new functions are INVOKER', invoker_functions;
  end if;

  select array_agg(f order by f) into unpinned_functions
    from unnest(new_functions) as f
   where not ('search_path=""' = any (coalesce((select proconfig from pg_proc where oid = f::regprocedure), '{}')));
  if unpinned_functions is not null then
    raise exception 'created_by_and_job_ownership: % do not pin search_path to empty', unpinned_functions;
  end if;

  select array_agg(r order by r) into executors
    from unnest(array['anon', 'authenticated', 'public']) as r
   where has_function_privilege(r, 'private.can_stop_any_job()', 'EXECUTE');
  if executors is distinct from array['authenticated'] then
    raise exception 'created_by_and_job_ownership: private.can_stop_any_job() is executable by %, not authenticated alone',
      executors;
  end if;

  select array_agg(r order by r) into executors
    from unnest(array['anon', 'authenticated', 'public']) as r
   where has_function_privilege(r, 'private.guard_job_attribution()', 'EXECUTE');
  if executors is not null then
    raise exception 'created_by_and_job_ownership: private.guard_job_attribution() is executable by %', executors;
  end if;

  -- Each attribution column: a set-null FK to auth.users, and an index it leads.
  select array_agg(format('%s.%s', v.t, v.c) order by v.t, v.c) into missing
    from (values
            ('public.plans', 'created_by'),
            ('public.generation_jobs', 'requested_by'),
            ('public.generation_jobs', 'stop_requested_by')
         ) as v(t, c)
    left join pg_attribute a on a.attrelid = v.t::regclass and a.attname = v.c and not a.attisdropped
   where a.attnum is null
      or not exists (
           select 1
             from pg_constraint k
            where k.contype = 'f'
              and k.conrelid = v.t::regclass
              and k.confrelid = 'auth.users'::regclass
              and k.confdeltype = 'n'
              and k.conkey = array[a.attnum]
         )
      or not exists (
           select 1 from pg_index i where i.indrelid = v.t::regclass and i.indkey[0] = a.attnum
         );
  if missing is not null then
    raise exception 'created_by_and_job_ownership: % lack a set-null FK to auth.users or an index', missing;
  end if;

  select (select count(*) from public.plans where created_by is not null)
       + (select count(*) from public.generation_jobs where requested_by is not null or stop_requested_by is not null)
    into credited;
  if credited <> 0 then
    raise exception 'created_by_and_job_ownership: % existing row(s) were credited, expected none', credited;
  end if;

  -- The guard lets the deletion cascade through only because the cascade runs as the owner of the
  -- table it updates, which must therefore never be `authenticated`.
  if exists (
    select 1 from pg_class c
     where c.oid in ('public.plans'::regclass, 'public.generation_jobs'::regclass)
       and c.relowner = 'authenticated'::regrole
  ) then
    raise exception 'created_by_and_job_ownership: authenticated owns public.plans or public.generation_jobs';
  end if;
end;
$$;
