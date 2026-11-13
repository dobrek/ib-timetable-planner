-- S-411: a place to remember a ban, and the history kinds this slice writes.
--
-- ADDITIVE ONLY. One nullable column, default null (every existing account stays unbanned), and four
-- enum labels. Nothing is dropped, and no function is re-created.
--
-- THE COLUMN IS THE FUNCTION'S OWN RECORD. `banned_at` is written by the admin-users Edge Function
-- under the secret key, the same way it writes `must_change_password`, and cleared by unban. It is
-- not a mirror of GoTrue's `banned_until`: a ban made in the dashboard does not set it, and the
-- mirror's ON CONFLICT update names its columns, so an unmentioned `banned_at` stays as it is.
-- `private.mirror_auth_user()` is left as it is on purpose. `authenticated` keeps SELECT alone.
--
-- THE FENCE FUNCTIONS STAY. A ban pauses an account by setting `user_roles.deactivated_at`, which
-- `private.current_app_role()` already reads as null. `guard_last_admin()` and `record_role_change()`
-- are not edited here; the next slice that touches them re-creates them from
-- `20261112110654_deactivation_fence.sql`.
--
-- THE RECORD KINDS. `account_banned`, `account_unbanned`, `account_deleted` and `email_changed` are
-- added for the function to write later. A value added here is usable only after this transaction
-- commits, so this file never names them as enum values: the post-conditions look them up in
-- `pg_enum` by label.
--
-- LOCKS. Adding the column takes ACCESS EXCLUSIVE on `user_directory`, which the Auth mirror writes
-- on every sign-up. The wait is capped: a busy moment fails the deploy, which can be re-run.

set local lock_timeout = '5s';

alter type public.access_change_kind add value if not exists 'account_banned';
alter type public.access_change_kind add value if not exists 'account_unbanned';
alter type public.access_change_kind add value if not exists 'account_deleted';
alter type public.access_change_kind add value if not exists 'email_changed';

alter table public.user_directory
  add column banned_at timestamptz default null;

comment on column public.user_directory.banned_at is
  'The admin-users function''s record of a GoTrue ban (S-411), written under the secret key and '
  'cleared by unban. Null when the account is not banned. authenticated can only read it.';

comment on table public.user_directory is
  'A mirror of auth.users for the Data API (S-406, S-410), written by its Auth trigger and, for '
  'must_change_password and banned_at, by the admin-users Edge Function under the secret key '
  '(S-409, S-411). Readers see their own row, or every row with a role; nobody sees a machine user.';

-- Post-conditions. Any failure aborts the whole file, with nothing applied and nothing recorded.
-- No user is named and no count is asserted beyond "none are banned", so no hosted state fails it.
do $$
declare
  kind_labels text[];
  banned      bigint;
begin
  select array_agg(e.enumlabel::text order by e.enumlabel) into kind_labels
    from pg_enum e
   where e.enumtypid = 'public.access_change_kind'::regtype
     and e.enumlabel in ('account_banned', 'account_unbanned', 'account_deleted', 'email_changed');
  if kind_labels is distinct from array['account_banned', 'account_deleted', 'account_unbanned', 'email_changed'] then
    raise exception 'account_ban: access_change_kind holds % of the four new labels', kind_labels;
  end if;

  if has_column_privilege('authenticated', 'public.user_directory', 'banned_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.user_directory', 'banned_at', 'INSERT')
     or has_column_privilege('anon', 'public.user_directory', 'banned_at', 'SELECT') then
    raise exception 'account_ban: authenticated can write, or anon can read, banned_at';
  end if;
  if not has_column_privilege('authenticated', 'public.user_directory', 'banned_at', 'SELECT') then
    raise exception 'account_ban: authenticated cannot read banned_at';
  end if;

  select count(*) into banned from public.user_directory where banned_at is not null;
  if banned > 0 then
    raise exception 'account_ban: % existing row(s) are banned after the migration', banned;
  end if;
end;
$$;
