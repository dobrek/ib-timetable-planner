-- custom_access_token_hook: swap a MACHINE user's `role` claim to its narrow Postgres role.
--
-- GRANTS: yes — execute is granted to `supabase_auth_admin` and revoked from everyone else
-- (the documented posture for a Postgres auth hook). RLS: not applicable, no table is read.
--
-- This is the mechanism that lets the previous migration's `solver_job_writer` role be
-- reachable at all: GoTrue calls this function while minting an access token, and whatever
-- `claims.role` this returns is the role PostgREST will `set role` to.
--
-- It reads the machine role straight off `claims.app_metadata`, which GoTrue always
-- includes in the event — so the function touches no table, needs no additional grant, and
-- has no reason to reach for `security definer` (this schema's hard rule; see
-- apply_generated_placements: "Do NOT switch to DEFINER"). `app_metadata` is admin-only:
-- it can be written solely through the service-role admin API, never by the user, which is
-- what makes it safe to trust here. `search_path = ''` keeps the function off the
-- `function_search_path_mutable` advisor.
--
-- Allowlisted, and it fails CLOSED in every direction that matters:
--   * no `machine_role`            -> the event passes through untouched (every human author);
--   * an unrecognised `machine_role` -> ignored, the user stays `authenticated`;
--   * only 'solver_job_writer' is ever written into the claim.
-- Widening the allowlist is a deliberate one-line edit in a reviewed migration, which is
-- exactly the friction it should have.
--
-- ** THE FAILURE MODE THIS FILE OWNS. ** If the hook is disabled or errors, GoTrue falls
-- back to `role: authenticated` — and given the default-privilege grants and the
-- `using (true)` policy on every table, that is a SILENT ESCALATION TO FULL DATABASE READ.
-- The spike confirmed it returns real plan names. `solver-credential.integration.test.ts`
-- asserts both the decoded role claim AND `permission denied` on `plans`, because either
-- assertion alone can false-negative. Treat that test as part of this migration.
--
-- Enablement is repo-declared in `supabase/config.toml` ([auth.hook.custom_access_token]),
-- so a local stack picks it up on `supabase start`. Hosted enablement is a one-time
-- `supabase config push` — documented in docs/runbooks/solver-credential.md, not automated
-- in the CI deploy job (which runs `db push` only).

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  machine_role text := event -> 'claims' -> 'app_metadata' ->> 'machine_role';
begin
  if machine_role is distinct from 'solver_job_writer' then
    return event;
  end if;
  return jsonb_set(event, '{claims,role}', to_jsonb(machine_role));
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
