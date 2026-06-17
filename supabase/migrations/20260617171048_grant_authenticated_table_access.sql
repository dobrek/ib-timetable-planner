-- Pin `authenticated` table reachability instead of relying on Supabase's
-- auto-grant for new public tables (the platform is moving to opt-in grants; see
-- README "Database: migrations & seed"). Every domain-table access is gated to the
-- `authenticated` role by middleware.ts / requireSession, so the signed-in app
-- runs as `authenticated` — grant it DML on the public schema, current and future
-- tables. Without this pin, a future flip to opt-in grants would ship silently and
-- surface only as `permission denied for table plans` in prod.
--
-- `anon` is intentionally NOT granted (least privilege): no domain-table access is
-- reachable unauthenticated. RLS controls which ROWS are visible; these grants
-- control whether the table is reachable at all — both must be in place.
-- Additive, no DROP; a code rollback does not undo it, which is safe (permissive).

grant select, insert, update, delete on all tables in schema public to authenticated;

alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
