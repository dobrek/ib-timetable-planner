-- Complete the least-privilege posture for `anon`. The companion migration
-- 20260617171048_grant_authenticated_table_access.sql claimed `anon` was
-- excluded, but Supabase's auto-grant had already given `anon` DML on existing
-- public tables when they were created — that grant was never revoked, so `anon`
-- still held table reachability (only RLS, with no anon policy, was actually
-- blocking it). Pin the exclusion at the GRANT layer too, so reachability does
-- not silently depend on RLS staying tight: revoke `anon` DML on the public
-- schema, current and future tables. Every domain-table access is gated to the
-- `authenticated` role by middleware.ts / requireSession; sign-in runs through
-- GoTrue (the `auth` schema), not public tables — so `anon` needs no public DML.
--
-- RLS controls which ROWS are visible; these grants control whether the table is
-- reachable at all. With this revoke, `anon` is excluded at both layers (defense
-- in depth). Additive (no DROP, no data change); a code rollback does not undo
-- it, which is safe (strictly more restrictive).

revoke select, insert, update, delete on all tables in schema public from anon;

alter default privileges in schema public revoke select, insert, update, delete on tables from anon;
