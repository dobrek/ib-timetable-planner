-- user_directory: a readable mirror of auth.users, so the app can name the school's users (S-406,
-- FR-405, FR-413).
--
-- WHY A MIRROR. Emails, the machine flag and the service-account flag live only in `auth.users`,
-- which the Data API cannot reach: the `auth` schema is not exposed, and a view over it in `public`
-- is Supabase's `auth_users_exposed` lint (an ERROR). A DEFINER reader would be a second recorded
-- DEFINER exception, and would have to gate inside its body. So an INVOKER trigger on auth.users
-- keeps this table current, and the read policy below decides who sees which row.
--
-- WHY NOT `profiles.email`. S-401 expected the email on `profiles`, but `profiles` is user-owned:
-- the email would need column-level grants so its owner cannot rewrite it, and PostgREST puts
-- every payload column in an upsert's `ON CONFLICT DO UPDATE SET`, so any later upsert naming
-- `email` would fail. `profiles` would also need rows for users who never set a name. A separate,
-- system-owned table leaves `profiles` exactly as it is (S-406 research §1.1).
--
-- WHO WRITES IT. Only the Auth trigger below and this file's backfill. GoTrue writes auth.users as
-- `supabase_auth_admin`, and an INVOKER trigger runs as the writer, so that role holds SELECT,
-- INSERT and UPDATE here and falls under one policy, "Auth mirrors users". That policy names
-- `to supabase_auth_admin`: the recorded exception to "every policy names `to authenticated`".
-- It is never PUBLIC, and DELETE is withheld at the grant layer (a row leaves by the FK cascade).
-- `authenticated` holds SELECT alone; `service_role` keeps its default DML (factories, teardown).
--
-- WHO READS IT. Like `profiles`: a user reads their own row, and anyone holding a role reads every
-- row. A machine user (`app_metadata.machine_role`) is mirrored but never shown, to anyone: it is
-- flagged here rather than left out, because GoTrue's `createUser` INSERTs the user first and
-- writes custom `app_metadata` in a second UPDATE, so an INSERT-only mirror would have recorded the
-- solver as a human. The flag also gives S-406's role-write check a row to refuse machines by.
--
-- THE AUTH PATH'S BLAST RADIUS. If the trigger function raises, GoTrue's write fails: user creation
-- ("Database error saving new user"), an email change, and link verification, which rewrites
-- `raw_app_meta_data`. So the function never raises on data: both flags are derived null-safely,
-- never by a `::boolean` cast, and it upserts, because the INSERT arrives without the custom
-- metadata and the UPDATE that follows brings it. The UPDATE trigger names its columns AND compares
-- the three mirrored values in `WHEN`, because every sign-in rewrites `last_sign_in_at` and every
-- `/verify` rewrites `raw_app_meta_data`: a column list alone still fires on a SET that names the
-- column. Sign-in and token refresh never reach the function. Recovery is roll-forward: a new
-- migration that replaces the function body, copied from its latest live definition (lessons.md).
--
-- THE FUNCTION LIVES IN `private`. A trigger calls its function by OID, so `supabase_auth_admin`
-- needs no USAGE on `private` (plan probe P10), and it needs no EXECUTE either: EXECUTE is checked
-- when the trigger is created, never when it fires (P11). So EXECUTE is revoked from every API role.
--
-- ORDER. Table, policies and grants, then the function, then the triggers, then the backfill, in
-- this one file's transaction. `create trigger` takes a SHARE ROW EXCLUSIVE lock on auth.users and
-- holds it to commit, so every GoTrue write committed before it is visible to the backfill, and
-- none can land after it until this commits: a user created or changed mid-deploy is either
-- backfilled or mirrored, never missed. Backfilling first would leave a gap the count check below
-- could not see for an email or flag change.
--
-- LOCKS. That lock waits behind any open GoTrue transaction and, while it waits, holds up every
-- sign-in queued after it, so the wait is capped: a busy moment fails the deploy, which can be
-- re-run. `set local` prints "WARNING: SET LOCAL can only be used in transaction blocks"; the CLI
-- sends this file as one implicit transaction, and the setting holds for the rest of it.

set local lock_timeout = '5s';

create table public.user_directory (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  email              text,
  is_machine         boolean not null default false,
  is_service_account boolean not null default false
);

comment on table public.user_directory is
  'A mirror of auth.users for the Data API (S-406), written only by its Auth trigger. Readers see '
  'their own row, or every row with a role; nobody sees a machine user.';

comment on column public.user_directory.is_service_account is
  'Mirrors app_metadata.service_account = true, set by an operator through the Admin API. A label '
  'only: the token hook ignores it, and the account keeps an ordinary role.';

alter table public.user_directory enable row level security;

create policy "Readers read the directory" on public.user_directory
  for select to authenticated
  using (not is_machine and (user_id = (select auth.uid()) or (select private.can_read())));

-- The upsert below needs this policy's SELECT, INSERT and UPDATE parts; the grants withhold DELETE.
create policy "Auth mirrors users" on public.user_directory
  for all to supabase_auth_admin using (true) with check (true);

-- anon: all eight privileges, not just the house four DML verbs.
revoke all on public.user_directory from anon;

-- authenticated: SELECT only. Without the write grants, "nobody edits their own directory row" is
-- true at the grant layer too, not only by the absent policies.
revoke insert, update, delete, truncate, references, trigger, maintain on public.user_directory from authenticated;
grant select on public.user_directory to authenticated;

grant select, insert, update on public.user_directory to supabase_auth_admin;

-- service_role keeps its default DML. solver_job_writer holds no default privileges, so it cannot
-- reach this table, which the solver-credential suite proves.

create function private.mirror_auth_user()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.user_directory (user_id, email, is_machine, is_service_account)
  values (
    new.id,
    new.email,
    new.raw_app_meta_data ->> 'machine_role' is not null,
    coalesce(new.raw_app_meta_data -> 'service_account' = 'true'::jsonb, false)
  )
  on conflict (user_id) do update
    set email = excluded.email,
        is_machine = excluded.is_machine,
        is_service_account = excluded.is_service_account;
  return null;
end;
$$;

comment on function private.mirror_auth_user() is
  'Keeps public.user_directory current from auth.users (S-406). Must never raise: see its migration.';

revoke execute on function private.mirror_auth_user() from public, anon, authenticated;

create trigger user_directory_mirror_insert
  after insert on auth.users
  for each row execute function private.mirror_auth_user();

create trigger user_directory_mirror_update
  after update of email, raw_app_meta_data on auth.users
  for each row
  when (
    old.email is distinct from new.email
    or old.raw_app_meta_data -> 'machine_role' is distinct from new.raw_app_meta_data -> 'machine_role'
    or old.raw_app_meta_data -> 'service_account' is distinct from new.raw_app_meta_data -> 'service_account'
  )
  execute function private.mirror_auth_user();

-- Backfill, after the triggers (see ORDER above). The same derivations as the function.
insert into public.user_directory (user_id, email, is_machine, is_service_account)
select id,
       email,
       raw_app_meta_data ->> 'machine_role' is not null,
       coalesce(raw_app_meta_data -> 'service_account' = 'true'::jsonb, false)
  from auth.users;

-- Post-conditions. Any failure aborts the whole file, with nothing applied and nothing recorded.
-- No user is named and no count is asserted beyond the mirror's own, so no hosted state fails it.
do $$
declare
  users_count       bigint;
  directory_count   bigint;
  misflagged        bigint;
  definer_functions text[];
  anon_privileges   text[];
  user_privileges   text[];
  privileges constant text[] :=
    array['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'];
begin
  select count(*) into users_count from auth.users;
  select count(*) into directory_count from public.user_directory;
  if directory_count <> users_count then
    raise exception 'user_directory: % row(s) for % auth user(s) after the backfill', directory_count, users_count;
  end if;

  select count(*) into misflagged
    from public.user_directory d
    join auth.users u on u.id = d.user_id
   where d.is_machine is distinct from (u.raw_app_meta_data ->> 'machine_role' is not null);
  if misflagged > 0 then
    raise exception 'user_directory: % row(s) whose is_machine disagrees with app_metadata', misflagged;
  end if;

  if (select prosecdef from pg_proc where oid = 'private.mirror_auth_user()'::regprocedure) then
    raise exception 'user_directory: private.mirror_auth_user() is SECURITY DEFINER';
  end if;

  select array_agg(format('%s.%s', n.nspname, p.proname) order by n.nspname, p.proname)
    into definer_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef
     and n.nspname in ('public', 'private');
  if definer_functions is distinct from array['private.current_app_role'] then
    raise exception 'user_directory: SECURITY DEFINER functions are %, not private.current_app_role alone',
      definer_functions;
  end if;

  select array_agg(p) into anon_privileges
    from unnest(privileges) as p
   where has_table_privilege('anon', 'public.user_directory', p);
  if anon_privileges is not null then
    raise exception 'user_directory: anon holds % on public.user_directory', anon_privileges;
  end if;

  select array_agg(p order by p) into user_privileges
    from unnest(privileges) as p
   where has_table_privilege('authenticated', 'public.user_directory', p);
  if user_privileges is distinct from array['SELECT'] then
    raise exception 'user_directory: authenticated holds % on public.user_directory, not SELECT alone',
      user_privileges;
  end if;

  if has_function_privilege('anon', 'private.mirror_auth_user()', 'EXECUTE') then
    raise exception 'user_directory: anon may execute private.mirror_auth_user()';
  end if;

  if not ('search_path=""' = any (coalesce(
    (select proconfig from pg_proc where oid = 'private.mirror_auth_user()'::regprocedure), '{}'
  ))) then
    raise exception 'user_directory: private.mirror_auth_user() does not pin search_path to empty';
  end if;
end;
$$;
