# E2E Testing Rules

Rules for authoring Playwright specs in this directory. They keep generated/edited
tests stable by default — apply them rather than reinventing per spec. The four
specs already here (`seed`, `auth`, `auth-guard`, `action-unauth`) are the
exemplars; model new specs on them.

## Harness topology (see `playwright.config.ts`)

- **Real workerd, always.** `webServer` runs `pnpm build && pnpm preview`
  (`wrangler dev ./dist`), not Vite — the boundary under test (`/_actions/*`,
  `astro:env/server` secrets, cookie SSR) only behaves correctly on workerd. The
  preview worker reads `SUPABASE_URL`/`SUPABASE_KEY` from `.dev.vars` (written by
  `pnpm env:local`); `webServer.env` is deliberately not forwarded.
- **Projects.** `setup` signs in once and writes `storageState`; `chromium`
  (authenticated) depends on it and reuses its cookies; `chromium-guard` (no
  storageState) hosts the negative/unauth specs so the real server-side gate is
  what rejects them. Authenticated specs go in `*.spec.ts`; negative specs are
  named `*guard.spec.ts` / `*unauth.spec.ts`.
- **Local prerequisites.** Local Supabase running + `pnpm env:local`. The author
  account is provisioned automatically by `pretest:e2e` before `pnpm test:e2e`.

## Rules

- **Authenticate via `storageState`, never through the UI in a test.** The `setup`
  project already did the login; authenticated specs start signed in. (The only
  spec that drives the sign-in UI is `auth.setup.ts` itself.)
- **Role-based locators first:** `getByRole` / `getByLabel` / `getByText`. Never
  CSS selectors, XPath, or DOM structure. The agent sees the accessibility tree,
  not pixels. Disambiguate by scoping to a container (e.g. the row), not by
  `nth-child`.
- **Each test is independently runnable** — its own setup, action, assertion, and
  cleanup, safe under parallel random order. No shared state between tests.
- **Unique test data.** Suffix created entities with `randomUUID()` so parallel
  runs and re-runs after a crash never collide.
- **Teardown by deleting the plan.** A plan owns its catalog via
  `on delete cascade` (courses, teachers, `course_teachers`, …), so deleting the
  plan you created removes every child entity in one step — the cheapest reliable
  teardown. See `seed.spec.ts`.
- **Wait for state, never time.** `expect(locator).toBeVisible()`,
  `page.waitForURL(...)`, `expect(locator).toHaveValue(...)`. Never
  `page.waitForTimeout()`.
- **Assert the business outcome, and make it fail when the risk materializes.**
  The control question for every assertion: would this fail if the thing the test
  protects broke? If not, it is decorative.
- **Hydration on cold start.** React islands (`client:load`) bind inputs only
  after hydration; a value typed pre-hydration is discarded. Opening a dialog by
  clicking an island button implies the island is interactive, but when in doubt
  confirm a control is live before relying on typed values (see the
  `auth.setup.ts` toggle-gate, and re-assert `toHaveValue` after a fill).
