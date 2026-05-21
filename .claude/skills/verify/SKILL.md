---
name: verify
description: Run the local CI gate — install, astro sync, lint, build. Use after a batch of edits to confirm CI will pass before committing or opening a PR.
---

Run the exact sequence `.github/workflows/ci.yml` runs, in order, stopping at the first failure.

1. `pnpm install --frozen-lockfile`
2. `pnpm exec astro sync`
3. `pnpm lint`
4. `pnpm build`

Report:

- Which step failed (if any) and a compact view of the failing output.
- If all four pass: print `verify: PASS` and stop.

No test step is configured for this repo. Do not run `pnpm test`. If lint reports auto-fixable issues, suggest `pnpm lint:fix` — do not run it from inside `/verify` (the user owns the fix decision).
