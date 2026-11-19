-- job_completion_email: the database half of S-310 (FR-309). An author who ticks "Email me when it
-- finishes" at Generate gets one email when that job ends, stalls, or is stopped by someone else,
-- with no browser open. A Worker Cron Trigger sweeps once a minute, signed in as a new narrow
-- machine role, `job_notifier`.
--
-- GRANTS / RLS: both. This file adds four columns, the role, its column grants and five policies,
-- re-creates the token hook so it maps the new role, and re-creates the attribution guard so the
-- email columns belong to the launch and to the notifier, never to a person.
--
-- THE COLUMNS. `email_requested` is the author's choice, written once at launch and frozen by the
-- guard. Existing rows read false, so the first deploy emails nobody about a job that predates it,
-- and there is no backfill. `email_claimed_at`, `emailed_at` and `email_outcome` are the notifier's
-- record: a compare-and-set claim before a send (it expires after 5 minutes, which is the retry
-- backoff), and the settled outcome, sent or skipped with a reason. A job is emailed at most once.
--
-- `notified_at` IS NOT THE EMAILER'S. `20260828093000` and `20261106192749` recorded S-310's emailer
-- as the intended second writer of `notified_at`. That plan is retired here. `notified_at` stays the
-- plans hub's badge marker alone ("an editor has opened the delivered proposal"), and the emailer
-- neither reads nor writes it: a walk-away job is never delivered, so the old event never fires, and
-- stamping it would clear a badge nobody has seen. The emailer keys on the solver's terminal write,
-- or on a stale heartbeat, and records itself in its own columns.
--
-- WHY A MACHINE ROLE. The Worker has no database identity outside a request, and it holds no secret
-- key, by decision of record. So the cron signs in as a machine Auth user, the way the solver does,
-- and the Custom Access Token Hook rewrites its token's role claim to `job_notifier`. It is built
-- like `solver_job_writer` (`20260810200931`): `nologin`, granted to `authenticator` so PostgREST
-- can switch to it, USAGE on `public`, and nothing else by inheritance.
--
-- WHAT IT READS, by column, because a row predicate cannot narrow it far enough:
--   * `generation_jobs`: the job facts the email states and the sweep decides on, the email record,
--     and `result`/`checkpoint`, whose `diagnostics` give the unplaced count. The sweep selects only
--     those JSON paths. `policy` gives the label.
--   * `plans`: `id, name`. `user_directory`: `user_id, email, must_change_password`. `user_roles`:
--     `user_id, deactivated_at`. A recipient is fenced (pending, deactivated, or no role row) by the
--     same facts `private.current_app_role()` folds into null for a caller, which the notifier cannot
--     ask about another user.
-- WHAT IT WRITES: `email_claimed_at`, `emailed_at`, `email_outcome`, and nothing else anywhere.
--
-- WHAT IS DELIBERATELY NOT GRANTED, each for a reason:
--   * `error`: free text from five code paths, holding course and teacher ids, cell keys and the
--     solver's HTTP body. None is proven safe for an email, so the notifier cannot read it at all.
--   * `snapshot`: the only place student keys live (PRD §NFG, no student data in any email).
--   * `notified_at`, `delivered_plan_id`, `delivery`, `stages`, `stop_requested_at`: the badge's and
--     delivery's facts, which the emailer does not decide on.
--   * `user_roles.role`: a viewer requester is emailed like an author ("open the plan to review
--     it" is true for both), so the role never matters, only its row and `deactivated_at`.
--   * `profiles`: no display-name greeting.
--   * INSERT and DELETE anywhere, UPDATE outside the three markers, and every other table.
--   * BYPASSRLS, and `alter default privileges`: a future table must stay unreachable to this role.
--
-- THE POLICIES name `to job_notifier`, the second machine-only exception to "every policy names
-- `to authenticated`" after the solver's. The role matrix leaves machine-only policies out;
-- `src/test/job-notifier-credential.integration.test.ts` pins their names and predicates instead.
--   * Jobs: SELECT `using (email_requested)`, which admits settled rows too. The predicate cannot also
--     say `emailed_at is null`: PostgREST's UPDATE always carries a RETURNING, and Postgres checks
--     the NEW row against SELECT policies, so every settle write would fail 42501. This was measured
--     for the solver (`20260812141459`). The narrowing lives in the column grants, as it does there.
--   * Jobs: UPDATE `using (email_requested and emailed_at is null)`, `with check (email_requested)`:
--     only an unsettled email is claimed or settled, and only once.
--   * Plans, directory and roles: SELECT only the rows a job with an email still due refers to (its
--     source and proposal plans, its requester). A leaked notifier password reads a handful of
--     addresses, not the staff directory, and a settled job drops its requester out of view.
--
-- THE HOOK, re-created from its live body (`20260810200934`, its only definition). Its allowlist
-- becomes exactly {`solver_job_writer`, `job_notifier`}. A null or unrecognised `machine_role` still
-- passes the event through untouched, so that user stays `authenticated`, which reaches no data
-- since S-403. EXECUTE stays with `supabase_auth_admin` alone.
--
-- THE GUARD, re-created from its live body (`20261106192749`, its only definition). For a signed-in
-- session, an INSERT keeps `email_requested` and clears the three markers, and an UPDATE that changes
-- any of the four email columns is refused with 42501. `authenticated` holds table-wide UPDATE on
-- this table, so without that an editor could silence or re-arm someone else's email. The trigger's
-- column list gains all four. The notifier and the service role pass, because the guard judges
-- `current_user = 'authenticated'` only. Firing it needs no USAGE on `private`: a trigger calls its
-- function by OID, and EXECUTE is checked when the trigger is created, never when it fires.
--
-- LOCKS. Adding the columns takes an AccessExclusiveLock on `generation_jobs` until commit, and the
-- new defaulted column is metadata-only (no rewrite). The wait is capped as everywhere here: a busy
-- moment fails the deploy, which can be re-run. `set local` prints "WARNING: SET LOCAL can only be
-- used in transaction blocks"; the setting holds for the rest of the file.

set local lock_timeout = '5s';

-- The email columns -----------------------------------------------------------------------------

alter table public.generation_jobs
  add column email_requested boolean not null default false,
  add column email_claimed_at timestamptz,
  add column emailed_at timestamptz,
  add column email_outcome text,
  add constraint generation_jobs_email_outcome_check check (
    email_outcome in ('sent', 'sent_stalled', 'no_recipient', 'recipient_fenced', 'stopped_by_requester', 'expired')
  ),
  add constraint generation_jobs_email_settled_check check ((emailed_at is null) = (email_outcome is null));

comment on column public.generation_jobs.email_requested is
  'Whether the requester ticked "Email me when it finishes" at Generate (S-310). Written once at '
  'launch; generation_jobs_guard_attribution refuses any later change by a signed-in session.';

comment on column public.generation_jobs.email_claimed_at is
  'The job-email notifier''s claim before a send (S-310): a compare-and-set, expiring after 5 '
  'minutes, so overlapping sweeps never send twice and a failed send is retried. Notifier-written.';

comment on column public.generation_jobs.emailed_at is
  'When the job-email notifier settled this job''s email, sent or skipped (S-310). Null while it is '
  'still due. Never notified_at, which is the plans hub''s badge marker alone.';

comment on column public.generation_jobs.email_outcome is
  'How the job email was settled (S-310): sent, sent_stalled, or skipped as no_recipient, '
  'recipient_fenced, stopped_by_requester or expired. Null exactly when emailed_at is null.';

-- The sweep's due set, in the order it reads it. The lookup policies' subqueries scan it too.
create index generation_jobs_email_due_idx on public.generation_jobs (created_at)
  where email_requested and emailed_at is null;

-- The notifier's role ---------------------------------------------------------------------------

create role job_notifier nologin;

-- PostgREST authenticates as `authenticator` and then `set role`s to the claim's role.
grant job_notifier to authenticator;

grant usage on schema public to job_notifier;

grant select (
  id,
  plan_id,
  proposal_plan_id,
  status,
  requested_by,
  stop_requested_by,
  created_at,
  started_at,
  finished_at,
  heartbeat_at,
  policy,
  result,
  checkpoint,
  checkpoint_stage_index,
  email_requested,
  email_claimed_at,
  emailed_at,
  email_outcome
) on public.generation_jobs to job_notifier;

grant update (email_claimed_at, emailed_at, email_outcome) on public.generation_jobs to job_notifier;

grant select (id, name) on public.plans to job_notifier;
grant select (user_id, email, must_change_password) on public.user_directory to job_notifier;
grant select (user_id, deactivated_at) on public.user_roles to job_notifier;

create policy "Notifier reads jobs that asked for an email" on public.generation_jobs
  for select to job_notifier
  using (email_requested);

create policy "Notifier settles a job's email once" on public.generation_jobs
  for update to job_notifier
  using (email_requested and emailed_at is null)
  with check (email_requested);

create policy "Notifier reads the plans of jobs with an email due" on public.plans
  for select to job_notifier
  using (
    exists (
      select 1
        from public.generation_jobs j
       where j.email_requested
         and j.emailed_at is null
         and (j.plan_id = plans.id or j.proposal_plan_id = plans.id)
    )
  );

create policy "Notifier reads requesters with an email due" on public.user_directory
  for select to job_notifier
  using (
    exists (
      select 1
        from public.generation_jobs j
       where j.email_requested
         and j.emailed_at is null
         and j.requested_by = user_directory.user_id
    )
  );

create policy "Notifier reads the roles of requesters with an email due" on public.user_roles
  for select to job_notifier
  using (
    exists (
      select 1
        from public.generation_jobs j
       where j.email_requested
         and j.emailed_at is null
         and j.requested_by = user_roles.user_id
    )
  );

-- The token hook --------------------------------------------------------------------------------

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  machine_role text := event -> 'claims' -> 'app_metadata' ->> 'machine_role';
begin
  -- `is distinct from`, never `not in`: a null `machine_role` (every human) must pass through, and
  -- `null not in (...)` is null, which an IF reads as false.
  if machine_role is distinct from 'solver_job_writer'
     and machine_role is distinct from 'job_notifier' then
    return event;
  end if;
  return jsonb_set(event, '{claims,role}', to_jsonb(machine_role));
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- The attribution guard -------------------------------------------------------------------------

create or replace function private.guard_job_attribution()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The service role, the solver, the job-email notifier and the FK cascade (which runs as the
  -- owner) pass untouched: see `20261106192749`'s EVERY OTHER CALLER PASSES. Nothing before this
  -- line may read auth.uid().
  if current_user is distinct from 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.requested_by := auth.uid();
    new.stop_requested_by := case when new.stop_requested_at is null then null else auth.uid() end;
    -- The choice is the launch's to make; the record of the email is the notifier's alone.
    new.email_claimed_at := null;
    new.emailed_at := null;
    new.email_outcome := null;
    return new;
  end if;

  if new.requested_by is distinct from old.requested_by then
    raise exception using errcode = '42501', message = 'A generation job''s requester cannot change.';
  end if;

  -- After launch nobody signed in may change the choice, nor claim, settle or re-arm the email:
  -- not the requester, not another editor, not an admin (S-310).
  if new.email_requested is distinct from old.email_requested
     or new.email_claimed_at is distinct from old.email_claimed_at
     or new.emailed_at is distinct from old.emailed_at
     or new.email_outcome is distinct from old.email_outcome then
    raise exception using errcode = '42501',
      message = 'A generation job''s email choice is fixed at launch, and its record is the notifier''s.';
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
  'refuses a stop by anyone but the requester or a stop_any_job holder (S-407). Clears the email '
  'markers at insert and freezes all four email columns after it (S-310). Signed-in sessions only.';

-- The `update of` list gains the four email columns. `create or replace trigger` keeps the name and
-- swaps the definition in this file's transaction.
create or replace trigger generation_jobs_guard_attribution
  before insert or update of
    requested_by, stop_requested_at, stop_requested_by,
    email_requested, email_claimed_at, emailed_at, email_outcome
  on public.generation_jobs
  for each row execute function private.guard_job_attribution();

-- `create or replace function` keeps the existing grants; re-stated so this file alone says them.
revoke execute on function private.guard_job_attribution() from public, anon, authenticated;

-- Post-conditions. Any failure aborts the whole file, with nothing applied and nothing recorded.
do $$
declare
  definer_functions text[];
  reachable         text[];
  wide              text[];
  executors         text[];
  mapped            text;
  frozen            text[];
  opted_in          bigint;
begin
  if exists (select 1 from pg_roles where rolname = 'job_notifier' and (rolbypassrls or rolcanlogin or rolsuper)) then
    raise exception 'job_completion_email: job_notifier may bypass RLS, log in, or is a superuser';
  end if;

  if not pg_has_role('authenticator', 'job_notifier', 'member') then
    raise exception 'job_completion_email: authenticator cannot switch to job_notifier';
  end if;

  if has_column_privilege('job_notifier', 'public.generation_jobs', 'error', 'SELECT')
     or has_column_privilege('job_notifier', 'public.generation_jobs', 'snapshot', 'SELECT') then
    raise exception 'job_completion_email: job_notifier can read error or snapshot';
  end if;

  select array_agg(c.relname::text order by c.relname) into reachable
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and has_any_column_privilege('job_notifier', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES');
  if reachable is distinct from array['generation_jobs', 'plans', 'user_directory', 'user_roles'] then
    raise exception 'job_completion_email: job_notifier reaches %, not the four tables it needs', reachable;
  end if;

  select array_agg(format('%s %s', c.relname, v) order by c.relname, v) into wide
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as v
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and has_table_privilege('job_notifier', c.oid, v);
  if wide is not null then
    raise exception 'job_completion_email: job_notifier holds table-wide %', wide;
  end if;

  select array_agg(format('%s.%s', n.nspname, p.proname) order by n.nspname, p.proname)
    into definer_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef
     and n.nspname in ('public', 'private');
  if definer_functions is distinct from array['private.current_app_role'] then
    raise exception 'job_completion_email: SECURITY DEFINER functions are %, not private.current_app_role alone',
      definer_functions;
  end if;

  select array_agg(r order by r) into executors
    from unnest(array['anon', 'authenticated', 'public', 'supabase_auth_admin']) as r
   where has_function_privilege(r, 'public.custom_access_token_hook(jsonb)', 'EXECUTE');
  if executors is distinct from array['supabase_auth_admin'] then
    raise exception 'job_completion_email: the token hook is executable by %, not supabase_auth_admin alone',
      executors;
  end if;

  -- The hook maps exactly the two machine roles, and leaves everyone else's claim alone.
  select string_agg(
           coalesce(m, '<none>') || '->' ||
             (public.custom_access_token_hook(
                jsonb_build_object('claims', jsonb_build_object(
                  'role', 'authenticated',
                  'app_metadata', case when m is null then '{}'::jsonb else jsonb_build_object('machine_role', m) end
                ))
              ) -> 'claims' ->> 'role'),
           ', ' order by i)
    into mapped
    from unnest(array[null, 'job_notifier', 'job_notifier ', 'service_role', 'solver_job_writer']) with ordinality as t(m, i);
  if mapped is distinct from
     '<none>->authenticated, job_notifier->job_notifier, job_notifier ->authenticated, '
     'service_role->authenticated, solver_job_writer->solver_job_writer' then
    raise exception 'job_completion_email: the token hook maps %', mapped;
  end if;

  select array_agg(a.attname::text order by a.attname collate "C") into frozen
    from pg_trigger t
    join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[])
   where t.tgrelid = 'public.generation_jobs'::regclass
     and t.tgname = 'generation_jobs_guard_attribution';
  if frozen is distinct from array[
       'email_claimed_at', 'email_outcome', 'email_requested', 'emailed_at',
       'requested_by', 'stop_requested_at', 'stop_requested_by'
     ] then
    raise exception 'job_completion_email: the attribution guard fires on updates of %', frozen;
  end if;

  select array_agg(r order by r) into executors
    from unnest(array['anon', 'authenticated', 'public', 'job_notifier']) as r
   where has_function_privilege(r, 'private.guard_job_attribution()', 'EXECUTE');
  if executors is not null then
    raise exception 'job_completion_email: private.guard_job_attribution() is executable by %', executors;
  end if;

  select count(*) into opted_in from public.generation_jobs where email_requested;
  if opted_in <> 0 then
    raise exception 'job_completion_email: % existing job(s) were opted in, expected none', opted_in;
  end if;
end;
$$;
