---
name: verify
description: Run the local CI gate — install, astro sync, check, lint, steiger, audit, test, build. Use after a batch of edits to confirm CI will pass before committing or opening a PR.
---

Run the exact sequence `.github/workflows/ci.yml` runs, in order, stopping at the first failure.

1. `pnpm install --frozen-lockfile`
2. `mise run functions:check` — `deno check` + `deno lint` + `deno test` over `supabase/functions/` (Deno code that tsconfig, ESLint and lefthook all exclude, so nothing else reads it). If `mise`/`deno` is not installed, say so and skip, never report PASS for it.
3. `pnpm astro sync`
4. `pnpm check`
5. `pnpm lint`
6. `pnpm steiger`
7. `pnpm audit --audit-level=high`
8. `pnpm test`
9. `pnpm build`

Report:

- Which step failed (if any) and a compact view of the failing output.
- If all nine pass: print `verify: PASS` and stop.

If lint reports auto-fixable issues, suggest `pnpm lint:fix` — do not run it from inside `/verify` (the user owns the fix decision).
