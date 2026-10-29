-- current_plan_marker: one plan is the current one, and everyone sees which (S-404, FR-420).
--
-- Adds `plans.is_current` and every database rule for it:
--   * At most one plan is current: a global partial unique index (23505 on a second one).
--   * A pending proposal is never current: an in-row CHECK (23514). A pending plan has no board,
--     the perspective and comparison views refuse it, and up to seven best-effort sweeps delete it
--     (research §3). So with this rule no automatic path ever deletes the current plan.
--   * `public.set_current_plan(p_plan_id)` moves the marker in one transaction. Unmarking is a
--     plain update from the app: clearing can never make a second plan current.
--   * Moving or clearing the marker leaves "Last updated" alone (the trigger below).
--
-- NO PLAN IS CURRENT AFTERWARDS. The column defaults to false, so every existing row lands
-- not-current: that is FR-420's migration state, and the post-conditions assert it. A clone or a
-- fresh proposal always starts unmarked too, because `clone_plan` (latest: 20260711174905) inserts
-- an explicit `(name, slot_grid_preset)` list and never copies a new column.
--
-- WHY A COLUMN, NOT A TABLE. A column on `plans` is already covered by its four capability
-- policies (20261028200630): an author or admin may move it, a viewer's write fails 42501, and a
-- user without a role reaches no row. It rides on selects that already run (the hub, the plan
-- summary), and it is the only design in which "never a pending proposal" is a database rule. A
-- marker table would need its own four policies, grants, fixture row and `anon` revoke, and a
-- global one has no `plan_id` for the role matrix to find it by (research, storage options).
--
-- THE TRIGGER IS RE-DECLARED, NOT DROPPED. `plans_updated_at` (20260602185012:98-100) bumped
-- `updated_at` on every update, so a marker move would have changed "Last updated" on two plans
-- nobody edited. `create or replace trigger` (Postgres 14+) narrows it in place with a `WHEN`, so
-- there is never a moment without it and nothing is dropped. The condition skips any update that
-- changes `is_current`, and that is safe only while NO PATH WRITES `is_current` TOGETHER WITH
-- ANOTHER COLUMN: such a write would change the plan and still keep its old date. Both writers
-- (`set_current_plan` and the app's unmark) write `is_current` alone. Keep it that way, or widen
-- the condition. A `true` → `true` write still fires the trigger, which is why `set_current_plan`
-- skips a target that is already current.
--
-- SECURITY INVOKER, like every RPC but `private.current_app_role()`: RLS decides who may move the
-- marker, and the body checks no role (CLAUDE.md). Function grants: Postgres gives PUBLIC EXECUTE
-- on every new function, and Supabase's default privileges give `anon` its own, so both are
-- revoked here (precedent: 20261028140939_user_roles.sql). Run as anon, an INVOKER function would
-- meet only `to authenticated` policies and return empty, so the role matrix's anon cell cannot
-- catch a missed revoke; its catalog check and the post-conditions below do.
--
-- ATOMIC. The CLI sends this file as one batch, which runs as one implicit transaction with its
-- `schema_migrations` row last, so a failed post-condition aborts all of it and records nothing.
-- `set local` prints "WARNING: SET LOCAL can only be used in transaction blocks". That warning is
-- expected; the setting still holds for the rest of the file.
--
-- LOCKS. Adding the column and the CHECK takes an AccessExclusiveLock on `plans` until commit. A
-- lock waiting behind an in-flight write would stall every hub and board read that arrives after
-- it, so the wait is capped: a busy moment fails the deploy, which can be re-run.

set local lock_timeout = '5s';

alter table public.plans
  add column is_current boolean not null default false;

comment on column public.plans.is_current is
  'True on the one plan the school is using (FR-420). At most one; never a pending proposal; moved by set_current_plan. See supabase/migrations/20261029143936_current_plan_marker.sql.';

-- Global, not per anything: the partial index holds at most one entry, the current plan.
create unique index plans_one_current on public.plans (is_current) where is_current;

alter table public.plans
  add constraint plans_current_not_pending check (not (is_current and pending_proposal));

create or replace trigger plans_updated_at
  before update on public.plans
  for each row
  when (old.is_current is not distinct from new.is_current)
  execute function extensions.moddatetime(updated_at);

-- Make `p_plan_id` the one current plan. Returns the target, marked, or no row when the target is
-- missing, hidden from the caller, or a pending proposal, in which case nothing changed.
--
-- Order matters:
--   1. The movers' lock. Movers run one at a time, so the second waits for the first to commit.
--      In read-committed mode its later statements then take fresh snapshots: it unsets the first
--      mover's target and wins, and "last write wins" holds even for a true race. Without the lock
--      it would read a snapshot from before the other move, miss the new current row, and hit the
--      unique index with 23505. The key is arbitrary while this is the repo's only advisory lock;
--      it spells S-404 / FR-420 so a reader of `pg_locks` can trace it back here.
--   2. Lock and validate the target. Unsetting first would leave no plan current when the target
--      turns out to be invalid, the exact failure this function exists to prevent.
--   3. Unset the old current plan, then set the target, skipping one that is already current so
--      re-marking it (from an out-of-date hub) does not bump its "Last updated".
create function public.set_current_plan(p_plan_id uuid)
returns setof public.plans
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(404420);

  perform 1
    from public.plans
   where id = p_plan_id
     and not pending_proposal
     for update;
  if not found then
    return;
  end if;

  update public.plans
     set is_current = false
   where is_current
     and id <> p_plan_id;

  update public.plans
     set is_current = true
   where id = p_plan_id
     and not is_current;

  return query
    select * from public.plans where id = p_plan_id;
end;
$$;

comment on function public.set_current_plan(uuid) is
  'Moves the one current-plan marker onto a plan (S-404). Returns it, or no row when it is missing, hidden or pending.';

revoke execute on function public.set_current_plan(uuid) from public, anon;
grant execute on function public.set_current_plan(uuid) to authenticated;

-- Post-conditions. Any failure aborts the whole file, with nothing applied and nothing recorded.
do $$
declare
  current_plans integer;
  mover         record;
begin
  select count(*) into current_plans from public.plans where is_current;
  if current_plans <> 0 then
    raise exception 'current_plan_marker: % plan(s) are current after the migration, expected 0', current_plans;
  end if;

  select p.prosecdef, p.proconfig into mover
    from pg_proc p
   where p.oid = 'public.set_current_plan(uuid)'::regprocedure;
  if mover.prosecdef then
    raise exception 'current_plan_marker: public.set_current_plan(uuid) is SECURITY DEFINER';
  end if;
  if not ('search_path=""' = any (coalesce(mover.proconfig, '{}'))) then
    raise exception 'current_plan_marker: public.set_current_plan(uuid) does not pin search_path to empty (%)',
      mover.proconfig;
  end if;

  if has_function_privilege('anon', 'public.set_current_plan(uuid)', 'EXECUTE') then
    raise exception 'current_plan_marker: anon may execute public.set_current_plan(uuid)';
  end if;
  if not has_function_privilege('authenticated', 'public.set_current_plan(uuid)', 'EXECUTE') then
    raise exception 'current_plan_marker: authenticated may not execute public.set_current_plan(uuid)';
  end if;
end;
$$;
