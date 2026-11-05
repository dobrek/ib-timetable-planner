-- role_management: an admin gives, changes and removes roles; the school keeps an admin; every role
-- write is recorded (S-406, FR-406, FR-408, §NFG "access changes traceable").
--
-- WHAT THIS ADDS.
--   * `private.can_manage_users()`, the third capability wrapper, held by `admin` alone. Policies
--     name capabilities, never roles, so the role → capability map grows here and nowhere else.
--   * Admin policies and write grants on `user_roles`: S-403's own-row read widens to every row for
--     an admin, and three write policies join it. S-403 gave `authenticated` SELECT alone and
--     asserted it once; that post-condition never re-runs, and this file's supersedes it.
--   * The last-admin guard, a BEFORE UPDATE OR DELETE trigger on `user_roles`.
--   * `public.access_changes`, the append-only record of every role write, written by a trigger.
--   No SECURITY DEFINER function: every function here runs as its caller, and RLS decides.
--
-- A MACHINE NEVER GETS A ROLE. The INSERT and UPDATE policies ask for the target's row in
-- `user_directory`, whose read policy hides every machine user. So an admin who names the solver's
-- uuid directly is refused, as `scripts/assign-role.mjs` already refuses it for the operator.
--
-- THE GUARD BINDS EVERYONE, THE OPERATOR TOO. Demoting or removing the last `admin` row raises,
-- whether the write comes from the Users page, `assign-role.mjs` (the service role) or psql (the
-- owner). The escape hatch is to promote someone else first. It raises SQLSTATE `PT409`: PostgREST
-- answers a `PTxyz` code with HTTP status xyz, so the app gets a 409 with the code in the body,
-- where a `P0001` would be an opaque 500.
--   * A role cannot move to another user. The UPDATE grant is table-level (a column grant cannot
--     work: PostgREST's upsert sets every payload column, `user_id` included), so an UPDATE that
--     rewrote `user_id` would slip past the guard's role checks and the recorder's "role unchanged"
--     skip, and nothing would record it. The guard refuses it first, with 42501.
--   * Concurrency. Two admins demoting each other at once would each see the other still admin and
--     both commit, leaving none (plan probe P9). So the guard takes a transaction-scoped advisory
--     lock before it counts: the second waits, and PL/pgSQL's fresh snapshot per statement then
--     sees the first one's commit. Only a demotion of an admin takes the lock.
--   * The count runs as the invoker, through RLS. That is correct only because every writer of
--     `user_roles` reads every role row: a `can_manage_users()` holder (by its own read policy), the
--     service role (BYPASSRLS) or the owner. A future writer that cannot must revisit the guard.
--   * Account deletion is exempt. Deleting a user cascades into `user_roles`, and refusing that
--     would break `auth.admin.deleteUser`, the test teardown and S-411's delete. The cascade is told
--     apart by `pg_trigger_depth() > 1`, which only a BEFORE trigger sees (an AFTER trigger on a
--     cascade fires at depth 1, plan probe P7). FR-408 names demotion and deactivation; refusing to
--     delete the last admin's account belongs to S-411's own component. S-408 must change the guard
--     to count only active admins.
--
-- THE RECORD. `access_changes` holds ids only, never an email: a deleted actor or target is set to
-- null and renders as "Deleted user", so no ex-staff member's email is kept. `actor_kind` keeps
-- "a deleted user did it" apart from "the operator did it" once the id is gone. A write with no
-- `auth.uid()` (the service role, the owner) is recorded as the operator. S-409 and S-411 run with
-- the secret key, so they must write their own records with an explicit actor.
--   * Trigger timing is load-bearing (plan probes P7, P8). A grant is recorded AFTER INSERT, because
--     an upsert fires BEFORE INSERT for a proposed row even when it conflicts and becomes an UPDATE,
--     which would record a grant that never happened. A change or removal is recorded BEFORE UPDATE
--     OR DELETE, because only a BEFORE trigger can tell (and skip) the cascade: recording the
--     cascaded removal would insert a row naming the user being deleted, the FK would refuse it, and
--     the account deletion would abort. A change that leaves the role as it was is not recorded.
--   * Append-only by grants, not by a trigger: `authenticated` holds INSERT and SELECT alone, and the
--     INSERT policy holds only inside a trigger (`pg_trigger_depth() > 0`) for an admin naming
--     itself. An immutability trigger would also refuse the FKs' own `set null`.
--   * The kinds are an enum, so S-408, S-410 and S-411 add theirs with `alter type … add value`.
--
-- TRIGGER ORDER. Postgres fires same-timing triggers alphabetically: `user_roles_guard_last_admin`
-- before `user_roles_record_change`, before S-403's `user_roles_updated_at`. Any refusal rolls the
-- whole statement back, record included, whichever order they ran in.
--
-- ATOMIC, AND LOCKS CAPPED. One implicit transaction, as every file here. Policy changes take an
-- AccessExclusiveLock on `user_roles`, which every request's role read touches, so the wait is
-- capped and a busy moment fails the deploy, which can be re-run. `set local` prints "WARNING: SET
-- LOCAL can only be used in transaction blocks"; the setting holds for the rest of the file.

set local lock_timeout = '5s';

-- The capability wrapper -----------------------------------------------------------------------

create function private.can_manage_users()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.current_app_role() = 'admin'
$$;

comment on function private.can_manage_users() is
  'Whether the caller may manage users: admin only (S-406). INVOKER, over current_app_role().';

revoke execute on function private.can_manage_users() from public, anon;
grant execute on function private.can_manage_users() to authenticated;

-- user_roles: the admin write path -------------------------------------------------------------

comment on table public.user_roles is
  'Each human''s one role (S-403). A user reads their own row; an admin reads and writes every row '
  '(S-406), never a machine''s. The last admin cannot be demoted or removed, and every write is '
  'recorded in access_changes.';

-- The guard counts admins through these policies, as the invoker: see THE GUARD above.
--
-- One SELECT policy, not a second beside S-403's own-row read: two permissive policies for the same
-- role and command are both evaluated for every row (Supabase's `multiple_permissive_policies`
-- lint). `alter policy` widens S-403's in place and renames it, as `profiles`' read policy is named,
-- so nothing is dropped. It names the policy S-403's migration created; were it missing on hosted,
-- this file would fail and apply nothing.
alter policy "Users read their own role" on public.user_roles
  using (user_id = (select auth.uid()) or (select private.can_manage_users()));

alter policy "Users read their own role" on public.user_roles
  rename to "Users read their own role, admins every role";

create policy "Admins grant roles" on public.user_roles
  for insert to authenticated
  with check (
    (select private.can_manage_users())
    and exists (select 1 from public.user_directory d where d.user_id = user_roles.user_id)
  );

create policy "Admins change roles" on public.user_roles
  for update to authenticated
  using ((select private.can_manage_users()))
  with check (
    (select private.can_manage_users())
    and exists (select 1 from public.user_directory d where d.user_id = user_roles.user_id)
  );

create policy "Admins remove roles" on public.user_roles
  for delete to authenticated
  using ((select private.can_manage_users()));

-- DML only: TRUNCATE, REFERENCES, TRIGGER and MAINTAIN stay revoked from S-403.
grant insert, update, delete on public.user_roles to authenticated;

-- The last-admin guard ------------------------------------------------------------------------

create function private.guard_last_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception using errcode = '42501', message = 'A role cannot move to another user.';
  end if;

  if old.role <> 'admin'
     or (tg_op = 'UPDATE' and new.role = 'admin')
     or (tg_op = 'DELETE' and pg_trigger_depth() > 1) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- The lock key is a fixed constant: 406 for the slice, 001 for the first lock it takes. Every
  -- demotion of an admin takes the same one, so two of them serialise here.
  perform pg_advisory_xact_lock(406001);

  if not exists (
    select 1 from public.user_roles r where r.role = 'admin' and r.user_id <> old.user_id
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
  'Refuses demoting or removing the last admin, and moving a role to another user (S-406).';

create trigger user_roles_guard_last_admin
  before update or delete on public.user_roles
  for each row execute function private.guard_last_admin();

-- The access-change record --------------------------------------------------------------------

create type public.access_change_kind as enum ('role_granted', 'role_changed', 'role_removed');

create type public.access_actor_kind as enum ('user', 'operator');

create table public.access_changes (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  kind        public.access_change_kind not null,
  actor_kind  public.access_actor_kind not null,
  actor_id    uuid references auth.users (id) on delete set null,
  target_id   uuid references auth.users (id) on delete set null,
  old_role    public.app_role,
  new_role    public.app_role
);

comment on table public.access_changes is
  'Who changed whose access, and when (S-406). Append-only, written by user_roles'' trigger; '
  'admins read it. Ids only: a deleted user''s ids are set to null.';

-- The Users page reads the latest record per user.
create index access_changes_target_id_occurred_at on public.access_changes (target_id, occurred_at desc);

alter table public.access_changes enable row level security;

create policy "Admins read access changes" on public.access_changes
  for select to authenticated
  using ((select private.can_manage_users()));

-- Only the trigger, for an admin naming itself: a direct INSERT runs at depth 0. The service role and
-- the owner bypass RLS, which is how an operator's write is recorded.
create policy "Role triggers record changes" on public.access_changes
  for insert to authenticated
  with check (
    pg_trigger_depth() > 0
    and actor_id is not distinct from (select auth.uid())
    and (select private.can_manage_users())
  );

-- anon: all eight privileges.
revoke all on public.access_changes from anon;

-- authenticated: INSERT and SELECT only. No UPDATE or DELETE grant is what makes it append-only.
revoke update, delete, truncate, references, trigger, maintain on public.access_changes from authenticated;
grant select, insert on public.access_changes to authenticated;

-- service_role keeps its default DML. solver_job_writer holds no default privileges.

create function private.record_role_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The cascade from an account deletion: not a role write, and recording it would abort the
  -- deletion (see THE RECORD above).
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op = 'UPDATE' and new.role = old.role then
    return new;
  end if;

  insert into public.access_changes (kind, actor_kind, actor_id, target_id, old_role, new_role)
  values (
    case tg_op
      when 'INSERT' then 'role_granted'
      when 'UPDATE' then 'role_changed'
      else 'role_removed'
    end::public.access_change_kind,
    case when auth.uid() is null then 'operator' else 'user' end::public.access_actor_kind,
    auth.uid(),
    case when tg_op = 'INSERT' then new.user_id else old.user_id end,
    case when tg_op = 'INSERT' then null else old.role end,
    case when tg_op = 'DELETE' then null else new.role end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function private.record_role_change() is
  'Records each role write in access_changes (S-406). Grants AFTER INSERT; changes and removals '
  'BEFORE, so a cascade can be skipped.';

create trigger user_roles_record_grant
  after insert on public.user_roles
  for each row execute function private.record_role_change();

create trigger user_roles_record_change
  before update or delete on public.user_roles
  for each row execute function private.record_role_change();

-- A trigger function is never called directly: EXECUTE is checked when a trigger is created, not
-- when it fires (plan probe P11).
revoke execute on function private.guard_last_admin() from public, anon, authenticated;
revoke execute on function private.record_role_change() from public, anon, authenticated;

-- Post-conditions. Any failure aborts the whole file, with nothing applied and nothing recorded.
-- Nothing asserts that an admin exists: a bootstrap state must not fail the deploy.
do $$
declare
  definer_functions text[];
  invoker_functions text[];
  anon_privileges   text[];
  user_privileges   text[];
  privileges constant text[] :=
    array['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'];
begin
  select array_agg(format('%s.%s', n.nspname, p.proname) order by n.nspname, p.proname)
    into definer_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef
     and n.nspname in ('public', 'private');
  if definer_functions is distinct from array['private.current_app_role'] then
    raise exception 'role_management: SECURITY DEFINER functions are %, not private.current_app_role alone',
      definer_functions;
  end if;

  select array_agg(f order by f) into invoker_functions
    from unnest(array[
      'private.can_manage_users()', 'private.guard_last_admin()', 'private.record_role_change()'
    ]) as f
   where not (select prosecdef from pg_proc where oid = f::regprocedure);
  if invoker_functions is distinct from
     array['private.can_manage_users()', 'private.guard_last_admin()', 'private.record_role_change()'] then
    raise exception 'role_management: only % of the new functions are INVOKER', invoker_functions;
  end if;

  select array_agg(p order by p) into user_privileges
    from unnest(privileges) as p
   where has_table_privilege('authenticated', 'public.user_roles', p);
  if user_privileges is distinct from array['DELETE', 'INSERT', 'SELECT', 'UPDATE'] then
    raise exception 'role_management: authenticated holds % on public.user_roles, not the four DML verbs',
      user_privileges;
  end if;

  select array_agg(p order by p) into user_privileges
    from unnest(privileges) as p
   where has_table_privilege('authenticated', 'public.access_changes', p);
  if user_privileges is distinct from array['INSERT', 'SELECT'] then
    raise exception 'role_management: authenticated holds % on public.access_changes, not INSERT and SELECT',
      user_privileges;
  end if;

  select array_agg(format('%s on %s', p, t) order by t, p) into anon_privileges
    from unnest(array['public.user_roles', 'public.access_changes']) as t,
         unnest(privileges) as p
   where has_table_privilege('anon', t, p);
  if anon_privileges is not null then
    raise exception 'role_management: anon holds %', anon_privileges;
  end if;

  if has_function_privilege('anon', 'private.can_manage_users()', 'EXECUTE') then
    raise exception 'role_management: anon may execute private.can_manage_users()';
  end if;
end;
$$;
