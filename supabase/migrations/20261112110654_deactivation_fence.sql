-- S-408, part two of two: an admin deactivates and reactivates a user (FR-407), and the school never
-- loses its last active admin to a deactivation (FR-408).
--
-- THE FENCE. While `public.user_roles.deactivated_at` is set, `private.current_app_role()` reads null,
-- so every policy, capability wrapper and RPC that asks for a role sees a user without one, on the
-- very next statement, whatever the person's unexpired JWT says. The middleware's role read goes
-- through the same function, so the person resolves to "no access yet" and lands on the notice. The
-- role row stays, so reactivating (clearing the column) restores exactly the role it holds. The
-- column itself arrived, inert, in `20261112110150_user_roles_deactivated_at.sql`.
--
-- WHY `user_roles`. The admin already writes this table under RLS ("Admins change roles", S-406) and
-- reads every row of it, and the person reads their own row. So deactivation needs no new table,
-- policy, grant or SECURITY DEFINER function, and no secret key: the write goes through the admin's
-- own session, RLS judges it, and the trigger records it under `auth.uid()`. A column on
-- `user_directory` would need a new writer for an Auth mirror and would show every role holder who
-- is deactivated; a new table would need the whole user-keyed policy kit (research §3).
--
-- WHY NOT `user_directory.must_change_password`. It already fences a role, but any password write
-- clears it (`private.clear_must_change_password()`), and a deactivated person may still change their
-- password on `/account` (FR-410, FR-411): they would reactivate themselves.
--
-- ROLE WRITES NEVER REACTIVATE. Every role write in the app sends `{user_id, role}` alone, and
-- PostgREST's upsert updates only the columns it is sent, so changing a deactivated person's role
-- keeps them deactivated. "No access" deletes the row, and the flag with it. The one exception is the
-- break-glass `scripts/assign-role.mjs`, which clears the column on purpose.
--
-- THREE FUNCTIONS, RE-CREATED FROM THEIR LATEST LIVE DEFINITIONS (lessons.md):
--   * `private.current_app_role()` from `20261109143000_must_change_password.sql:69` (S-409), adding
--     `deactivated_at is null`. It stays the one SECURITY DEFINER function (S-403), with
--     `search_path = ''`; the post-conditions re-assert both, and the owner's BYPASSRLS.
--   * `private.guard_last_admin()` from `20261109143000_must_change_password.sql:128` (S-409). An
--     "active admin" is `role = 'admin' and deactivated_at is null`. The early return skips the check
--     only when the old row is not an active admin, or an UPDATE leaves the new row one: as it stood,
--     deactivating an admin kept `role = 'admin'` and was waved through, so the last admin could be
--     deactivated. The count adds `deactivated_at is null` beside S-409's pending condition. The 42501
--     role-move refusal, the BEFORE + depth cascade exemption, advisory lock 406001 and PT409 are
--     unchanged.
--   * `private.record_role_change()` from `20261105080343_role_management.sql:242` (S-406; nothing
--     since changed it). It skipped any UPDATE that left the role as it was, so a deactivation went
--     unrecorded. Now an UPDATE records `role_changed` when the role differs, and separately
--     `deactivated` (null → set) or `reactivated` (set → null); one UPDATE that does both writes both,
--     role first. Moving one timestamp to another records nothing. The flag records carry the role
--     held after the write as both `old_role` and `new_role`. An INSERT records `role_granted`, plus
--     `deactivated` when the row arrives deactivated (no app path does that, but the INSERT policy
--     does not constrain the column, so an admin's session could as well as the service role); a DELETE
--     records `role_removed`, deactivated or not. The cascade skip and the `actor_kind` derivation
--     from `auth.uid()` are unchanged. It runs BEFORE UPDATE, so even a self-deactivation is recorded
--     while the admin still holds `can_manage_users()`, which the `access_changes` INSERT policy asks.
--
-- THE NEXT SLICE TO TOUCH THESE (S-411) re-creates them from this file, which carries both the
-- pending and the deactivation conditions.
--
-- ADDITIVE ONLY. Two enum values and three replaced bodies. Nothing is dropped. A value added here is
-- usable only after this transaction commits: the plpgsql bodies name the new kinds as text, cast
-- when they run, and the post-conditions look them up in `pg_enum` by label, never by casting.
--
-- LOCKS. `create or replace function` and `alter type` take brief locks on objects every request's
-- role read touches, so the wait is capped: a busy moment fails the deploy, which can be re-run.

set local lock_timeout = '5s';

alter type public.access_change_kind add value if not exists 'deactivated';
alter type public.access_change_kind add value if not exists 'reactivated';

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
     and r.deactivated_at is null
     and not exists (
       select 1
         from public.user_directory d
        where d.user_id = r.user_id
          and d.must_change_password
     )
$$;

comment on function private.current_app_role() is
  'The caller''s own role, or null; null while their temporary password is unchanged (S-409) and '
  'while an admin has deactivated them (S-408). The one SECURITY DEFINER exception (S-403): see its '
  'migration.';

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

  -- Nothing to guard unless an active admin stops being one: demoted, removed or deactivated (S-408).
  if old.role <> 'admin'
     or old.deactivated_at is not null
     or (tg_op = 'UPDATE' and new.role = 'admin' and new.deactivated_at is null) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- The lock key is a fixed constant: 406 for the slice, 001 for the first lock it takes. Every
  -- demotion of an admin takes the same one, so two of them serialise here.
  perform pg_advisory_xact_lock(406001);

  -- Another admin who can act: one whose temporary password is still pending (S-409), or whom an
  -- admin has deactivated (S-408), does not count.
  if not exists (
    select 1
      from public.user_roles r
     where r.role = 'admin'
       and r.deactivated_at is null
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
  'Refuses demoting, removing or deactivating the last active admin (one whose temporary password is '
  'still pending, S-409, or who is deactivated, S-408, does not count), and moving a role to another '
  'user (S-406).';

-- The access-change record ----------------------------------------------------------------------

create or replace function private.record_role_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_uid uuid := auth.uid();
  actor     public.access_actor_kind := case when auth.uid() is null then 'operator' else 'user' end;
begin
  -- The cascade from an account deletion: not a role write, and recording it would abort the
  -- deletion (see THE RECORD in 20261105080343_role_management.sql). Told apart as the guard does: a
  -- DELETE issued from another trigger runs at depth 2 as well, but its user still exists, so it is
  -- recorded.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    if not exists (select 1 from auth.users u where u.id = old.user_id) then
      return old;
    end if;
  end if;

  if tg_op = 'DELETE' then
    insert into public.access_changes (kind, actor_kind, actor_id, target_id, old_role, new_role)
    values ('role_removed', actor, actor_uid, old.user_id, old.role, null);
    return old;
  end if;

  if tg_op = 'INSERT' then
    insert into public.access_changes (kind, actor_kind, actor_id, target_id, old_role, new_role)
    values ('role_granted', actor, actor_uid, new.user_id, null, new.role);
  elsif new.role <> old.role then
    insert into public.access_changes (kind, actor_kind, actor_id, target_id, old_role, new_role)
    values ('role_changed', actor, actor_uid, new.user_id, old.role, new.role);
  end if;

  -- The deactivation flag (S-408), recorded after any role change of the same write, with the role
  -- held after it. A timestamp moved to another timestamp is not a change of state.
  if new.deactivated_at is not null
     and (tg_op = 'INSERT' or old.deactivated_at is null) then
    insert into public.access_changes (kind, actor_kind, actor_id, target_id, old_role, new_role)
    values ('deactivated', actor, actor_uid, new.user_id, new.role, new.role);
  elsif tg_op = 'UPDATE' and old.deactivated_at is not null and new.deactivated_at is null then
    insert into public.access_changes (kind, actor_kind, actor_id, target_id, old_role, new_role)
    values ('reactivated', actor, actor_uid, new.user_id, new.role, new.role);
  end if;

  return new;
end;
$$;

comment on function private.record_role_change() is
  'Records each role write in access_changes (S-406), and each deactivation and reactivation (S-408). '
  'Grants AFTER INSERT; changes and removals BEFORE, so a cascade can be skipped.';

-- A trigger function is never called directly: EXECUTE is checked when a trigger is created, not
-- when it fires. `create or replace` keeps the revokes S-406 made; restated so this file stands alone.
revoke execute on function private.guard_last_admin() from public, anon, authenticated;
revoke execute on function private.record_role_change() from public, anon, authenticated;

-- Post-conditions. Any failure aborts the whole file, with nothing applied and nothing recorded.
do $$
declare
  definer_functions text[];
  definer_config    text[];
  definer_owner     text;
  definer_bypass    boolean;
  unsound_triggers  text[];
  kind_labels       text[];
  deactivated       bigint;
begin
  select array_agg(format('%s.%s', n.nspname, p.proname) order by n.nspname, p.proname)
    into definer_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef
     and n.nspname in ('public', 'private');
  if definer_functions is distinct from array['private.current_app_role'] then
    raise exception 'S-408: SECURITY DEFINER functions are %, not private.current_app_role alone',
      definer_functions;
  end if;

  select p.proconfig, r.rolname, r.rolbypassrls
    into definer_config, definer_owner, definer_bypass
    from pg_proc p
    join pg_roles r on r.oid = p.proowner
   where p.oid = 'private.current_app_role()'::regprocedure;
  if definer_config is null or not ('search_path=""' = any (definer_config)) then
    raise exception 'S-408: private.current_app_role() does not pin search_path to empty (%)', definer_config;
  end if;
  if not definer_bypass then
    raise exception 'S-408: private.current_app_role() is owned by %, which lacks BYPASSRLS; it would read no rows',
      definer_owner;
  end if;

  select array_agg(f order by f) into unsound_triggers
    from unnest(array['private.guard_last_admin()', 'private.record_role_change()']) as f
    join pg_proc p on p.oid = f::regprocedure
   where p.prosecdef
      or not ('search_path=""' = any (coalesce(p.proconfig, '{}')))
      or has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if unsound_triggers is not null then
    raise exception 'S-408: % must be INVOKER, pin search_path to empty and be executable by no API role',
      unsound_triggers;
  end if;

  select array_agg(e.enumlabel::text order by e.enumlabel) into kind_labels
    from pg_enum e
   where e.enumtypid = 'public.access_change_kind'::regtype
     and e.enumlabel in ('deactivated', 'reactivated');
  if kind_labels is distinct from array['deactivated', 'reactivated'] then
    raise exception 'S-408: access_change_kind holds % of deactivated and reactivated', kind_labels;
  end if;

  select count(*) into deactivated from public.user_roles where deactivated_at is not null;
  if deactivated > 0 then
    raise exception 'S-408: % existing role row(s) are deactivated after the migration', deactivated;
  end if;
end;
$$;
