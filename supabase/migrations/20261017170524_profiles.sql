-- profiles: the display name a signed-in user sets for themselves (S-401, FR-413).
--
-- GRANTS / RLS: yes to both (see the bottom of this file). Every signed-in human reads every
-- profile; a user inserts and updates only their own row; nobody deletes one (rows leave by the
-- cascade from auth.users). `anon` is revoked at the GRANT layer for all eight privileges, and
-- `authenticated` is narrowed to SELECT, INSERT and UPDATE — the same literal-truth rule
-- `generation_jobs` set (lessons.md, "granting a role is not excluding the others").
--
-- Deliberately narrow, because later slices own the rest:
--   * No `email` column and no rows for users who never set a name — S-406 adds both, with the
--     sync mechanism that keeps them true. `display_name` is nullable so those rows fit.
--   * No authorization data, ever. Roles live in S-403's `user_roles`, which should share this key.
--   * No trigger on auth.users and no SECURITY DEFINER: the owner writes the row through RLS.
--
-- `user_id` DEFAULTS TO auth.uid(), the first such default in this schema: the app upserts
-- `{ display_name }` and the database fills in the caller, so no domain function needs the caller's
-- id passed in. RLS's WITH CHECK still enforces ownership whatever a client sends. The service role
-- has no auth.uid(), so factories and admin tooling pass `user_id` explicitly.
--
-- The CHECK mirrors the Zod rule in `src/_pages/account/model/schemas.ts`, because PostgREST can
-- be called directly with a user's own token, around the form. Keep the two in step.
--
-- `moddatetime` is adopted, as on `generation_jobs`: a profile is edited in place, and S-406 will
-- want to show when.

create table public.profiles (
  user_id      uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text
    constraint profiles_display_name_check check (
      display_name is null
      or (
        char_length(display_name) between 1 and 60
        and display_name = btrim(display_name)
        -- Characters that let a name hide or reorder text. Written as ARE hex escapes, never as the
        -- literal characters, so a reviewer can see them:
        --   [:cntrl:]      C0 and C1 control characters
        --   \x200B-\x200F  zero-width space, non-joiner and joiner; LRM and RLM marks (U+200B–U+200F)
        --   \x202A-\x202E  bidi embeddings and overrides (U+202A–U+202E)
        --   \x2066-\x2069  bidi isolates (U+2066–U+2069)
        --   \xFEFF         byte-order mark / zero-width no-break space (U+FEFF)
        and display_name !~ '[[:cntrl:]\x200B-\x200F\x202A-\x202E\x2066-\x2069\xFEFF]'
      )
    ),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'A user''s own display name (S-401). Readable by every signed-in user; written only by its owner.';

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function extensions.moddatetime(updated_at);

alter table public.profiles enable row level security;

create policy "Authenticated users read every profile" on public.profiles
  for select to authenticated using (true);

create policy "Users insert their own profile" on public.profiles
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "Users update their own profile" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No DELETE policy: a profile leaves with its user, by the cascade above.

-- anon: all eight privileges, not just the house four DML verbs (Supabase's auto-grant leaves
-- TRUNCATE / REFERENCES / TRIGGER / MAINTAIN behind otherwise).
revoke select, insert, update, delete on public.profiles from anon;
revoke truncate, references, trigger, maintain on public.profiles from anon;

-- authenticated: exactly what the policies above can use. Without the DELETE grant, "nobody
-- deletes a profile" is true at the grant layer too, not only by the absent policy.
revoke delete, truncate, references, trigger, maintain on public.profiles from authenticated;

-- service_role keeps its default DML (factories, teardown). solver_job_writer holds no default
-- privileges, so it cannot reach this table. All of it is proven from the catalog by the role
-- matrix and the solver guard, not by this comment.
