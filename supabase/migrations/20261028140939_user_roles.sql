-- user_roles: the one role an admin assigns each human (S-403, FR-416, FR-417).
--
-- GRANTS / RLS: yes to both. A signed-in user reads only their own role row, and nobody writes one
-- through the Data API: until S-406 the service role does, from an operator's shell. `anon` is
-- revoked at the GRANT layer for all eight privileges, and `authenticated` is narrowed to SELECT
-- (lessons.md, "granting a role is not excluding the others").
--
-- BEHAVIOUR-NEUTRAL ON ITS OWN. Every human-facing policy is still `using (true)`, so nothing here
-- changes what anyone can do. S-403's policy migration is what makes the policies read the role,
-- through the capability helpers below.
--
-- Deliberately narrow, because later slices own the rest:
--   * No write policies, no `is_admin()` and no record of who changed a role or when — S-406.
--   * No `active` flag — S-408, which changes `private.current_app_role()` alone.
--   * No email and no developer account here: the backfill makes every human an `author`, and the
--     developer's `admin` is an operator step, so no personal data enters a migration.
--
-- The role is an enum, so a new role is an additive `alter type … add value`, and the app's
-- `AppRole` is a projection of the generated type. `user_id` cascades from auth.users: a role
-- leaves with its user, which the test teardown relies on.
--
-- ** THE ONE SECURITY DEFINER EXCEPTION. ** `private.current_app_role()` is the only DEFINER
-- function in this schema; CLAUDE.md's "No SECURITY DEFINER" rule records it.
--   * Why. S-406 adds an admin-reads-all policy on this table, which has to ask for the caller's
--     role. An INVOKER helper doing that re-enters this table's own policies. The rewriter cannot
--     see recursion through a function, so it surfaces as `stack depth limit exceeded`, and only
--     once the table is analyzed and the planner picks a seq scan: green locally, broken on hosted
--     after autovacuum (S-403 research §2.3, probes C and D). Shipping INVOKER now would hand
--     S-406 that trap.
--   * Scope. It takes no argument and reads only the caller's own row, so it can tell a caller
--     nothing but their own role. `search_path = ''`.
--   * Owner. It skips RLS only because its owner (`postgres` on Supabase) has BYPASSRLS. An owner
--     without it would read no rows, and every human would be denied once the policies flip:
--     closed, not open, but every author locked out. The post-conditions below assert the owner,
--     so a wrong hosted assumption aborts the deploy before anything is enforced.
--   * Everything else stays INVOKER: the capability wrappers and the app-facing RPC run as the
--     caller. A second DEFINER function needs a recorded reason of its own.
--
-- `private` is not an exposed schema (`[api] schemas` in supabase/config.toml lists `public` and
-- `graphql_public`; hosted's list is a dashboard setting, checked by hand). A policy needs only
-- EXECUTE on a helper, but an INVOKER wrapper resolves `private.current_app_role()` by name as the
-- caller, so `authenticated` needs USAGE on the schema too (research §2.3, probe G).
--
-- Function grants: Postgres gives PUBLIC EXECUTE on every new function, and per-schema default
-- privileges cannot take that back, so each function revokes it from `public` and `anon` itself.

create type public.app_role as enum ('admin', 'author', 'viewer');

create table public.user_roles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       public.app_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_roles is
  'Each human''s one role (S-403). A user reads only their own row; only the service role writes.';

create trigger user_roles_updated_at
  before update on public.user_roles
  for each row execute function extensions.moddatetime(updated_at);

alter table public.user_roles enable row level security;

create policy "Users read their own role" on public.user_roles
  for select to authenticated using (user_id = (select auth.uid()));

-- No INSERT, UPDATE or DELETE policy: a role is assigned by the service role until S-406 adds
-- admin write policies, and leaves with its user, by the cascade above.

-- anon: all eight privileges, not just the house four DML verbs.
revoke all on public.user_roles from anon;

-- authenticated: SELECT only. Without the write grants, "nobody grants themselves a role" is true
-- at the grant layer too, not only by the absent policies.
revoke insert, update, delete, truncate, references, trigger, maintain on public.user_roles from authenticated;

-- service_role keeps its default DML (factories, teardown, the operator tool). solver_job_writer
-- holds no default privileges, so it cannot reach this table.

create schema private;

comment on schema private is
  'Role helpers for RLS (S-403). Never exposed through the Data API.';

grant usage on schema private to authenticated;

create function private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.user_roles where user_id = (select auth.uid())
$$;

comment on function private.current_app_role() is
  'The caller''s own role, or null. The one SECURITY DEFINER exception (S-403): see its migration.';

-- Capability wrappers. Policies name capabilities, never roles, so the role → capability map lives
-- here once. A caller without a role reads `can_edit()` as null, which a policy treats as false.

create function private.can_read()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.current_app_role() is not null
$$;

create function private.can_edit()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.current_app_role() in ('admin', 'author')
$$;

-- The app's role read (the middleware). Through the same helper the policies use, so the app sees
-- exactly the value RLS judges by, and an unfiltered `user_roles` select is never needed: S-406's
-- admin-reads-all policy would make that return every row.
create function public.own_app_role()
returns public.app_role
language sql
stable
set search_path = ''
as $$
  select private.current_app_role()
$$;

revoke execute on function private.current_app_role() from public, anon;
revoke execute on function private.can_read() from public, anon;
revoke execute on function private.can_edit() from public, anon;
revoke execute on function public.own_app_role() from public, anon;

grant execute on function private.current_app_role() to authenticated;
grant execute on function private.can_read() to authenticated;
grant execute on function private.can_edit() to authenticated;
grant execute on function public.own_app_role() to authenticated;

-- Backfill: every human who exists now keeps today's access. A machine user (any
-- `app_metadata.machine_role`) gets no row, so a misfired token hook reads nothing once the
-- policies flip. Users created after this migration get a role explicitly.
insert into public.user_roles (user_id, role)
select id, 'author'
  from auth.users
 where raw_app_meta_data->>'machine_role' is null;

-- Post-conditions. Any failure aborts the whole file, with nothing applied and nothing recorded.
do $$
declare
  humans_without_role integer;
  machines_with_role  integer;
  helper              record;
  anon_functions      text[];
  anon_privileges     text[];
  user_privileges     text[];
  privileges constant text[] :=
    array['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'];
begin
  select count(*) into humans_without_role
    from auth.users u
   where u.raw_app_meta_data->>'machine_role' is null
     and not exists (select 1 from public.user_roles r where r.user_id = u.id);
  if humans_without_role > 0 then
    raise exception 'user_roles: % human user(s) hold no role after the backfill', humans_without_role;
  end if;

  select count(*) into machines_with_role
    from public.user_roles r
    join auth.users u on u.id = r.user_id
   where u.raw_app_meta_data->>'machine_role' is not null;
  if machines_with_role > 0 then
    raise exception 'user_roles: % machine user(s) hold a role', machines_with_role;
  end if;

  select p.prosecdef, p.proconfig, o.rolname, o.rolbypassrls into helper
    from pg_proc p
    join pg_roles o on o.oid = p.proowner
   where p.oid = 'private.current_app_role()'::regprocedure;
  if not helper.prosecdef then
    raise exception 'user_roles: private.current_app_role() is not SECURITY DEFINER';
  end if;
  if not ('search_path=""' = any (coalesce(helper.proconfig, '{}'))) then
    raise exception 'user_roles: private.current_app_role() does not pin search_path to empty (%)', helper.proconfig;
  end if;
  if not helper.rolbypassrls then
    raise exception 'user_roles: private.current_app_role() is owned by %, which lacks BYPASSRLS; it would read no rows',
      helper.rolname;
  end if;

  select array_agg(f) into anon_functions
    from unnest(array[
      'private.current_app_role()', 'private.can_read()', 'private.can_edit()', 'public.own_app_role()'
    ]) as f
   where has_function_privilege('anon', f, 'EXECUTE');
  if anon_functions is not null then
    raise exception 'user_roles: anon may execute %', anon_functions;
  end if;

  select array_agg(p) into anon_privileges
    from unnest(privileges) as p
   where has_table_privilege('anon', 'public.user_roles', p);
  if anon_privileges is not null then
    raise exception 'user_roles: anon holds % on public.user_roles', anon_privileges;
  end if;

  select array_agg(p order by p) into user_privileges
    from unnest(privileges) as p
   where has_table_privilege('authenticated', 'public.user_roles', p);
  if user_privileges is distinct from array['SELECT'] then
    raise exception 'user_roles: authenticated holds % on public.user_roles, not SELECT alone', user_privileges;
  end if;
end;
$$;
