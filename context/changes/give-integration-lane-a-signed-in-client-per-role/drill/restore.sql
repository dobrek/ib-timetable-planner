-- Undoes deny-authenticated.sql: drops the F-401 drill policy from every table that carries it.
-- Safe to re-run. Confirm with:
--   select count(*) from pg_policies where policyname like 'f401 drill%';   -- expect 0
do $$
declare
  t record;
begin
  for t in
    select tablename
      from pg_policies
     where schemaname = 'public' and policyname = 'f401 drill: deny authenticated'
  loop
    execute format('drop policy %I on public.%I', 'f401 drill: deny authenticated', t.tablename);
  end loop;
end $$;
