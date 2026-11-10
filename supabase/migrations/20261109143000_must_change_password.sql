-- S-409: an admin creates an account with a temporary password.
--
-- The account holds its role from the moment it exists, but a flag on its directory row fences the
-- role off until the person chooses a password of their own: while `must_change_password` is set,
-- `private.current_app_role()` reads as null, so every policy, helper and RPC that asks for a role
-- sees a user without one. RLS is the enforcement; the app only makes the refusal clear.
--
-- ADDITIVE ONLY. One new column with `default false` (every existing user is unaffected: the flag
-- reads false, so `current_app_role()` answers exactly as before), two enum values, two replaced
-- function bodies, one new function and one new trigger. Nothing is dropped.
--
-- THE FLAG IS WRITTEN BY THE EDGE FUNCTION ONLY, under the secret key (a recorded second writer of
-- `user_directory`, beside the Auth trigger). `authenticated` keeps SELECT alone, so a pending user
-- cannot clear their own flag, and the post-conditions below prove it.
--
-- THE FLAG CLEARS ON THE FIRST REAL PASSWORD CHANGE. GoTrue writes `auth.users.encrypted_password`
-- when a user changes their password (and the reset-link path ends in the same write), so an AFTER
-- UPDATE trigger on that column clears it. Two choices the hosted check settled (hosted-check.md):
--
--   * The trigger is the `encrypted_password` form: DB encryption is off on hosted (0 rows of
--     `encrypted_password like '{%'`), so the column is stored as a plain bcrypt hash and a change
--     of it is a change of the password. `WHEN (old distinct from new)` keeps a sign-in that rewrites
--     other columns (`last_sign_in_at`) from firing it.
--   * The function never raises. It sits on the Auth path: a raise would fail GoTrue's password
--     write. If the clearing UPDATE itself fails, the user stays fenced (the safe direction) and a
--     WARNING says why. Recovery is roll-forward: a new migration replacing the body.
--
-- A RE-ISSUED PASSWORD ALSO FIRES IT, by the same write. The Edge Function sets the flag again after
-- the password write, so a re-issue lands pending (`admin-users`, `handler.ts`).
--
-- THE DEFINER EXCEPTION STANDS. `private.current_app_role()` stays the one SECURITY DEFINER function
-- (S-403): it needs the directory row, which an INVOKER read would only see through the directory's
-- own policy (which asks for the very role being computed). It is re-created here from its latest
-- live definition (`20261028140939_user_roles.sql:88`, nothing since changed it), adding only the
-- pending condition. `search_path = ''` and the owner's BYPASSRLS are re-asserted below.
--
-- THE LAST-ADMIN GUARD counts only admins who are not pending: a pending admin cannot act, so an
-- admin who demotes the last active one would leave the school with nobody. Re-created from its
-- latest live definition (`20261105080343_role_management.sql:139`): the advisory lock and the
-- PT409 error code are unchanged. It stays INVOKER and asks "no pending directory row", never
-- "an active one", so an admin row the invoker's read policy cannot see still counts.
--
-- LOCKS. `create trigger` on auth.users takes a SHARE ROW EXCLUSIVE lock that waits behind any open
-- GoTrue transaction and holds up every sign-in queued after it, so the wait is capped, as
-- `20261105073614_user_directory.sql` does: a busy moment fails the deploy, which can be re-run.

set local lock_timeout = '5s';

-- The two access-record kinds the Edge Function writes (a value added here is usable only after this
-- transaction commits, which is fine: nothing in this file uses them).
alter type public.access_change_kind add value if not exists 'account_created';
alter type public.access_change_kind add value if not exists 'password_reissued';

alter table public.user_directory
  add column must_change_password boolean not null default false;

comment on column public.user_directory.must_change_password is
  'True while an admin-issued temporary password is still unchanged (S-409). private.current_app_role() '
  'reads as null while it is set. Written by the admin-users Edge Function (secret key) and cleared by '
  'the auth.users trigger; authenticated can only read it.';

comment on table public.user_directory is
  'A mirror of auth.users for the Data API (S-406), written by its Auth trigger and, for '
  'must_change_password, by the admin-users Edge Function under the secret key (S-409). Readers see '
  'their own row, or every row with a role; nobody sees a machine user.';

-- private.current_app_role() --------------------------------------------------------------------

create or replace function private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select r.role
    from public.user_roles r
   where r.user_id = (select auth.uid())
     and not exists (
       select 1
         from public.user_directory d
        where d.user_id = r.user_id
          and d.must_change_password
     )
$$;

comment on function private.current_app_role() is
  'The caller''s own role, or null, and null while their temporary password is unchanged (S-409). '
  'The one SECURITY DEFINER exception (S-403): see its migration.';

-- Clearing the flag -----------------------------------------------------------------------------

create function private.clear_must_change_password()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Nested so that a failure stays inside this block: the function must never raise (see above).
  begin
    update public.user_directory
       set must_change_password = false
     where user_id = new.id
       and must_change_password;
  exception when others then
    raise warning 'clear_must_change_password: user % stays fenced: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end;
$$;

comment on function private.clear_must_change_password() is
  'Clears user_directory.must_change_password when auth.users.encrypted_password changes (S-409). '
  'Must never raise: see its migration.';

-- A trigger function is never called directly: EXECUTE is checked when a trigger is created, not
-- when it fires, so revoking it from the API roles costs the trigger nothing.
revoke execute on function private.clear_must_change_password() from public, anon, authenticated;

create trigger user_directory_clear_must_change_password
  after update of encrypted_password on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password)
  execute function private.clear_must_change_password();

-- The last-admin guard --------------------------------------------------------------------------

create or replace function private.guard_last_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception using errcode = '42501', message = 'A role cannot move to another user.';
  end if;

  -- The account-deletion cascade (see THE GUARD in 20261105080343_role_management.sql). Nested, not
  -- one `and`, so `auth.users` is read only at depth > 1: a depth-1 writer may not be able to read
  -- it, and must not need to.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    if not exists (select 1 from auth.users u where u.id = old.user_id) then
      return old;
    end if;
  end if;

  if old.role <> 'admin' or (tg_op = 'UPDATE' and new.role = 'admin') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- The lock key is a fixed constant: 406 for the slice, 001 for the first lock it takes. Every
  -- demotion of an admin takes the same one, so two of them serialise here.
  perform pg_advisory_xact_lock(406001);

  -- Another admin who can act: one whose temporary password is still pending does not count (S-409).
  if not exists (
    select 1
      from public.user_roles r
     where r.role = 'admin'
       and r.user_id <> old.user_id
       and not exists (
         select 1
           from public.user_directory d
          where d.user_id = r.user_id
            and d.must_change_password
       )
  ) then
    raise exception using errcode = 'PT409', message = 'The school must keep at least one admin.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function private.guard_last_admin() is
  'Refuses demoting or removing the last admin who can act (one whose temporary password is still '
  'pending does not count, S-409), and moving a role to another user (S-406).';

-- Post-conditions. Any failure aborts the whole file, with nothing applied and nothing recorded.
do $$
declare
  definer_functions text[];
  definer_config    text[];
  definer_owner     text;
  definer_bypass    boolean;
  pending_default   text;
  pending_existing  bigint;
begin
  select array_agg(format('%s.%s', n.nspname, p.proname) order by n.nspname, p.proname)
    into definer_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef
     and n.nspname in ('public', 'private');
  if definer_functions is distinct from array['private.current_app_role'] then
    raise exception 'must_change_password: SECURITY DEFINER functions are %, not private.current_app_role alone',
      definer_functions;
  end if;

  select p.proconfig, r.rolname, r.rolbypassrls
    into definer_config, definer_owner, definer_bypass
    from pg_proc p
    join pg_roles r on r.oid = p.proowner
   where p.oid = 'private.current_app_role()'::regprocedure;
  if definer_config is null or not ('search_path=""' = any (definer_config)) then
    raise exception 'must_change_password: private.current_app_role() does not pin search_path to empty (%)',
      definer_config;
  end if;
  if not definer_bypass then
    raise exception 'must_change_password: private.current_app_role() is owned by %, which lacks BYPASSRLS; it would read no rows',
      definer_owner;
  end if;

  if (select prosecdef from pg_proc where oid = 'private.clear_must_change_password()'::regprocedure)
     or (select prosecdef from pg_proc where oid = 'private.guard_last_admin()'::regprocedure) then
    raise exception 'must_change_password: a new or replaced trigger function is SECURITY DEFINER';
  end if;

  if not exists (
    select 1
      from pg_trigger t
     where t.tgrelid = 'auth.users'::regclass
       and t.tgname = 'user_directory_clear_must_change_password'
       and not t.tgisinternal
  ) then
    raise exception 'must_change_password: the clearing trigger is missing from auth.users';
  end if;

  select column_default into pending_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'user_directory' and column_name = 'must_change_password';
  if pending_default is distinct from 'false' then
    raise exception 'must_change_password: the column default is %, not false', pending_default;
  end if;

  select count(*) into pending_existing from public.user_directory where must_change_password;
  if pending_existing > 0 then
    raise exception 'must_change_password: % existing user(s) are already pending after the migration', pending_existing;
  end if;

  if has_column_privilege('authenticated', 'public.user_directory', 'must_change_password', 'UPDATE')
     or has_column_privilege('authenticated', 'public.user_directory', 'must_change_password', 'INSERT')
     or has_column_privilege('anon', 'public.user_directory', 'must_change_password', 'SELECT') then
    raise exception 'must_change_password: authenticated can write, or anon can read, the flag';
  end if;
  if not has_column_privilege('authenticated', 'public.user_directory', 'must_change_password', 'SELECT') then
    raise exception 'must_change_password: authenticated cannot read the flag';
  end if;

  if has_function_privilege('anon', 'private.clear_must_change_password()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.clear_must_change_password()', 'EXECUTE') then
    raise exception 'must_change_password: an API role can execute private.clear_must_change_password()';
  end if;
end;
$$;
