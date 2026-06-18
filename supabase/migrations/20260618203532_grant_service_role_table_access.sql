-- Pin `service_role` table reachability, completing the work started in
-- 20260617171048_grant_authenticated_table_access.sql. That migration pinned
-- `authenticated` but left `service_role` riding on Supabase's legacy auto-grant
-- for new public tables — the same auto-grant the platform is retiring in favour
-- of opt-in grants (see README "Database: migrations & seed"). When that flip
-- landed in a newer Supabase Postgres image, `service_role` silently lost DML on
-- the public schema and every server-side/admin path surfaced it as
-- `permission denied for table plans` (first caught by the integration suite,
-- which connects with SUPABASE_SERVICE_ROLE_KEY).
--
-- `service_role` is the trusted server-side/admin role (bypasses RLS); granting it
-- DML on the public schema, current and future tables, mirrors the `authenticated`
-- pin and matches Supabase's standard role set. `anon` remains excluded at the
-- GRANT layer (see 20260617205628_revoke_anon_table_access.sql) — least privilege
-- is unchanged.
--
-- RLS controls which ROWS are visible; these grants control whether the table is
-- reachable at all — both must be in place. Additive, no DROP; a code rollback
-- does not undo it, which is safe (permissive only for a role that already
-- bypasses RLS).

grant select, insert, update, delete on all tables in schema public to service_role;

alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
