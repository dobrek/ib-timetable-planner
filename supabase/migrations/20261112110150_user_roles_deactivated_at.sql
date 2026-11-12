-- S-408, part one of two: the state a deactivation writes, and nothing that reads it.
--
-- DELIBERATELY INERT. This file adds one nullable column to `public.user_roles` and changes no
-- behaviour: no function reads `deactivated_at` yet, so a row that carries it still answers its role
-- everywhere. The fence follows in the next migration (`…_deactivation_fence.sql`), which re-creates
-- `private.current_app_role()`, the last-admin guard and the access record to honour it. Both files
-- ship in the same merge.
--
-- Why a file of its own: the role matrix and the guard and record suites are written against the
-- column first and run red, for the right reason (the fence is absent), before the fence turns them
-- green. With the column and the fence in one file, a test that writes the column could only fail on
-- setup, never on its claim (CLAUDE.md § Database & auth: "shown red before the migration that turns
-- it green").
--
-- ADDITIVE ONLY. A nullable column with no default: every existing row reads null, which means
-- active. The admin writes it through the existing "Admins change roles" policy and table-level
-- UPDATE grant (S-406); nothing about who may write `user_roles` changes.
--
-- LOCKS. `add column` takes a brief ACCESS EXCLUSIVE lock on `user_roles`, which every request's role
-- read touches, so the wait is capped: a busy moment fails the deploy, which can be re-run. `set
-- local` prints "WARNING: SET LOCAL can only be used in transaction blocks"; the setting holds for the
-- rest of the file.

set local lock_timeout = '5s';

alter table public.user_roles
  add column deactivated_at timestamptz;

comment on column public.user_roles.deactivated_at is
  'When an admin deactivated this user (S-408); null = active. While it is set, '
  'private.current_app_role() reads null, and the role is kept for reactivation.';

-- Post-conditions. Any failure aborts the whole file, with nothing applied and nothing recorded.
do $$
declare
  nullable    text;
  deactivated bigint;
begin
  select c.is_nullable into nullable
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'user_roles' and c.column_name = 'deactivated_at';
  if nullable is null then
    raise exception 'S-408: public.user_roles.deactivated_at is missing';
  end if;
  if nullable <> 'YES' then
    raise exception 'S-408: public.user_roles.deactivated_at is not nullable';
  end if;

  select count(*) into deactivated from public.user_roles where deactivated_at is not null;
  if deactivated > 0 then
    raise exception 'S-408: % existing role row(s) are deactivated after the migration', deactivated;
  end if;
end;
$$;
