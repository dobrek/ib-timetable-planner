---
name: verify
description: Run the local CI gate — install, astro sync, check, lint, steiger, audit, test, build. Use after a batch of edits to confirm CI will pass before committing or opening a PR.
---

Run the exact sequence `.github/workflows/ci.yml` runs, in order, stopping at the first failure.

1. `pnpm install --frozen-lockfile`
2. `pnpm astro sync`
3. `pnpm check`
4. `pnpm lint`
5. `pnpm steiger`
6. `pnpm audit`
7. `pnpm test`
8. `pnpm build`

Report:

- Which step failed (if any) and a compact view of the failing output.
- If all eight pass: print `verify: PASS` and stop.

If lint reports auto-fixable issues, suggest `pnpm lint:fix` — do not run it from inside `/verify` (the user owns the fix decision).
