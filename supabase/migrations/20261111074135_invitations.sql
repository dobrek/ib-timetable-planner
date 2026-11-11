-- S-410: an admin invites a colleague by email; the colleague accepts, chooses a password and lands
-- with the role the admin chose.
--
-- ADDITIVE ONLY. Three enum values, two nullable columns, one re-created function body (the mirror)
-- and two re-created triggers on auth.users. Nothing is dropped, and no existing flag changes.
--
-- AN INVITEE RIDES S-409'S FENCE. The admin-users Edge Function sets `must_change_password` when it
-- invites, before it sends the email, so an invitee holds their role row but `current_app_role()`
-- reads null until they choose a password. RLS, the last-admin guard, the middleware and the role
-- matrix's `pendingAdmin` principal already understand that state: an invitation adds Users-page
-- states, not access states.
--
-- THE FENCE MUST HOLD THROUGH ACCEPTANCE. GoTrue's `signupVerify` (v2.196.0 `verify.go:313-348`)
-- writes a random password when an invitee spends their link, and only then sets
-- `email_confirmed_at`, in one transaction. That write fired the clear trigger, so the role went
-- live the moment the person pressed Continue, before they had a password (research C2, reproduced
-- live in probe.md P3). So the clear trigger now also asks `old.email_confirmed_at is not null`:
--
--   * GoTrue's own write on acceptance happens while the user is unconfirmed, so it is skipped. That
--     holds even if a later GoTrue folds both writes into one statement, because `old` is the row
--     before the update.
--   * Every later password write still clears the flag: the person's own choice (they are confirmed
--     by then), an admin's re-issue, or a reset followed by a choice. A reset of an unconfirmed
--     invitee confirms them without writing a password (probe.md P4), so it never fires it either.
--   * S-409's accounts are created confirmed, so they behave exactly as before.
--
-- The function body `private.clear_must_change_password()` is unchanged: only the trigger's WHEN.
-- `current_app_role()` and `guard_last_admin()` are not touched, which keeps S-410 clear of S-408.
--
-- THE DIRECTORY MIRRORS INVITATION STATE. `invited_at` and `email_confirmed_at` come from GoTrue,
-- the source of truth, and the Users page derives Invited, Invitation expired and Invitation
-- accepted from them, so no app-side state can drift. `private.mirror_auth_user()` is re-created
-- from its latest live body (the original in `20261105073614_user_directory.sql`, never re-created
-- since; checked with `pg_get_functiondef` on 2026-11-11), adding the two columns. It must still
-- never raise (see that migration's THE AUTH PATH'S BLAST RADIUS): the two values are plain
-- timestamps copied as they are. The update trigger names the two columns and compares them in
-- WHEN, so a sign-in, which rewrites neither, still never reaches the function. S-411's email
-- change touches the same mirror: whichever lands second re-creates it from the live body.
--
-- THE RECORD KINDS. The Edge Function writes `invitation_sent`, `invitation_resent` and
-- `invitation_revoked` under the secret key, with the admin as actor. A revoke deletes the
-- never-used account, so its record's `target_id` becomes null (S-406's ids-only rule): the record
-- keeps who revoked and when. Whether removal kinds keep an email is decided once, with S-411.
--
-- ORDER. Columns, then the function, then the triggers, then the backfill, as
-- `20261105073614_user_directory.sql` does: `create or replace trigger` on auth.users takes a SHARE
-- ROW EXCLUSIVE lock that holds GoTrue's writes until commit, so every write committed before it is
-- visible to the backfill and none lands after it unmirrored.
--
-- LOCKS. That lock waits behind any open GoTrue transaction and holds up every sign-in queued after
-- it, so the wait is capped: a busy moment fails the deploy, which can be re-run.

set local lock_timeout = '5s';

-- The record kinds (a value added here is usable only after this transaction commits, which is
-- fine: nothing in this file uses them).
alter type public.access_change_kind add value if not exists 'invitation_sent';
alter type public.access_change_kind add value if not exists 'invitation_resent';
alter type public.access_change_kind add value if not exists 'invitation_revoked';

-- The mirrored columns ------------------------------------------------------------------------

alter table public.user_directory
  add column invited_at timestamptz,
  add column email_confirmed_at timestamptz;

comment on column public.user_directory.invited_at is
  'Mirrors auth.users.invited_at: when the newest invitation was sent (S-410). Null for an account '
  'that was never invited. The admin-users re-send cooldown reads it.';

comment on column public.user_directory.email_confirmed_at is
  'Mirrors auth.users.email_confirmed_at (S-410). Null while an invitation is unaccepted.';

comment on table public.user_directory is
  'A mirror of auth.users for the Data API (S-406, S-410), written by its Auth trigger and, for '
  'must_change_password, by the admin-users Edge Function under the secret key (S-409). Readers see '
  'their own row, or every row with a role; nobody sees a machine user.';

-- The mirror ----------------------------------------------------------------------------------

create or replace function private.mirror_auth_user()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.user_directory (user_id, email, is_machine, is_service_account, invited_at, email_confirmed_at)
  values (
    new.id,
    new.email,
    new.raw_app_meta_data ->> 'machine_role' is not null,
    coalesce(new.raw_app_meta_data -> 'service_account' = 'true'::jsonb, false),
    new.invited_at,
    new.email_confirmed_at
  )
  on conflict (user_id) do update
    set email = excluded.email,
        is_machine = excluded.is_machine,
        is_service_account = excluded.is_service_account,
        invited_at = excluded.invited_at,
        email_confirmed_at = excluded.email_confirmed_at;
  return null;
end;
$$;

comment on function private.mirror_auth_user() is
  'Keeps public.user_directory current from auth.users (S-406, S-410). Must never raise: see its migrations.';

-- `create or replace` keeps the function's privileges; restated so the post-condition below has
-- nothing to depend on but this file.
revoke execute on function private.mirror_auth_user() from public, anon, authenticated;

create or replace trigger user_directory_mirror_update
  after update of email, raw_app_meta_data, invited_at, email_confirmed_at on auth.users
  for each row
  when (
    old.email is distinct from new.email
    or old.raw_app_meta_data -> 'machine_role' is distinct from new.raw_app_meta_data -> 'machine_role'
    or old.raw_app_meta_data -> 'service_account' is distinct from new.raw_app_meta_data -> 'service_account'
    or old.invited_at is distinct from new.invited_at
    or old.email_confirmed_at is distinct from new.email_confirmed_at
  )
  execute function private.mirror_auth_user();

-- The fence through acceptance ----------------------------------------------------------------

create or replace trigger user_directory_clear_must_change_password
  after update of encrypted_password on auth.users
  for each row
  when (
    old.encrypted_password is distinct from new.encrypted_password
    and old.email_confirmed_at is not null
  )
  execute function private.clear_must_change_password();

-- Backfill, after the triggers (see ORDER above).
update public.user_directory d
   set invited_at = u.invited_at,
       email_confirmed_at = u.email_confirmed_at
  from auth.users u
 where u.id = d.user_id
   and (d.invited_at is distinct from u.invited_at or d.email_confirmed_at is distinct from u.email_confirmed_at);

-- Post-conditions. Any failure aborts the whole file, with nothing applied and nothing recorded.
-- No user is named and no count is asserted beyond the mirror's own, so no hosted state fails it.
do $$
declare
  definer_functions text[];
  clear_trigger     text;
  disagreeing       bigint;
begin
  select array_agg(format('%s.%s', n.nspname, p.proname) order by n.nspname, p.proname)
    into definer_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef
     and n.nspname in ('public', 'private');
  if definer_functions is distinct from array['private.current_app_role'] then
    raise exception 'invitations: SECURITY DEFINER functions are %, not private.current_app_role alone',
      definer_functions;
  end if;

  select pg_get_triggerdef(t.oid) into clear_trigger
    from pg_trigger t
   where t.tgrelid = 'auth.users'::regclass
     and t.tgname = 'user_directory_clear_must_change_password'
     and not t.tgisinternal;
  if clear_trigger is null or clear_trigger not like '%old.email_confirmed_at IS NOT NULL%' then
    raise exception 'invitations: the clearing trigger does not wait for a confirmed user (%)', clear_trigger;
  end if;

  if (select prosecdef from pg_proc where oid = 'private.mirror_auth_user()'::regprocedure) then
    raise exception 'invitations: private.mirror_auth_user() is SECURITY DEFINER';
  end if;
  if not ('search_path=""' = any (coalesce(
    (select proconfig from pg_proc where oid = 'private.mirror_auth_user()'::regprocedure), '{}'
  ))) then
    raise exception 'invitations: private.mirror_auth_user() does not pin search_path to empty';
  end if;
  if has_function_privilege('anon', 'private.mirror_auth_user()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.mirror_auth_user()', 'EXECUTE') then
    raise exception 'invitations: an API role can execute private.mirror_auth_user()';
  end if;

  if has_column_privilege('authenticated', 'public.user_directory', 'invited_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.user_directory', 'invited_at', 'INSERT')
     or has_column_privilege('authenticated', 'public.user_directory', 'email_confirmed_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.user_directory', 'email_confirmed_at', 'INSERT')
     or has_column_privilege('anon', 'public.user_directory', 'invited_at', 'SELECT')
     or has_column_privilege('anon', 'public.user_directory', 'email_confirmed_at', 'SELECT') then
    raise exception 'invitations: authenticated can write, or anon can read, a mirrored invitation column';
  end if;
  if not has_column_privilege('authenticated', 'public.user_directory', 'invited_at', 'SELECT')
     or not has_column_privilege('authenticated', 'public.user_directory', 'email_confirmed_at', 'SELECT') then
    raise exception 'invitations: authenticated cannot read a mirrored invitation column';
  end if;

  select count(*) into disagreeing
    from public.user_directory d
    join auth.users u on u.id = d.user_id
   where d.invited_at is distinct from u.invited_at
      or d.email_confirmed_at is distinct from u.email_confirmed_at;
  if disagreeing > 0 then
    raise exception 'invitations: % directory row(s) disagree with auth.users after the backfill', disagreeing;
  end if;
end;
$$;
