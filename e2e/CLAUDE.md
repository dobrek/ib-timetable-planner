# E2E Testing Rules

Rules for authoring Playwright specs in this directory. They keep generated/edited
tests stable by default — apply them rather than reinventing per spec. Of the 35
specs here, `seed`, `auth`, `auth-guard` and `action-unauth` are the exemplars;
model new specs on them.

**Reuse shared plumbing — don't copy it.** Cross-cutting infrastructure (the
hydration-race `clickToReveal`, the `gotoStable` navigation retry, `shortId`, and
`createPlan`/`createTeacher`/`deletePlan` entity lifecycle) lives in
`e2e/support/planner.ts`; the account page's hydration gate
(`waitForAccountHydration`) lives in `e2e/support/account.ts`; the setup files'
UI sign-in (`signInThroughUi`) lives in `e2e/support/sign-in.ts`; the throwaway
user's loopback-only service-role client (`adminClient`) lives in
`e2e/support/admin-api.ts`, the Users page's absence check, paired with the
admin's presence (`expectUsersPageHidden`), in `e2e/support/users.ts`, and the
board header's creator-icon name, matched by email (`creditedTo`, S-407), in
`e2e/support/credit.ts`. Import from
there rather than re-declaring per spec — these are plumbing with no test-specific meaning, and copies drift. `support/*.ts`
is not a `*.spec.ts`/`*.setup.ts` file, so Playwright does not collect it as a test.
Keep feature-specific authoring (course/student forms, board locators) local to the
spec; promote a helper to `support/` only once a second spec needs it.

## Harness topology (see `playwright.config.ts`)

- **Real workerd, always.** `webServer` runs `pnpm build && pnpm preview`
  (`wrangler dev ./dist`), not Vite — the boundary under test (`/_actions/*`,
  `astro:env/server` secrets, cookie SSR) only behaves correctly on workerd. The
  preview worker reads `SUPABASE_URL`/`SUPABASE_KEY` from `.dev.vars` (written by
  `pnpm env:local`); `webServer.env` is deliberately not forwarded.
- **Projects.** `setup` signs in once per account and writes `storageState`;
  `chromium` (authenticated) depends on it and reuses its cookies; `chromium-guard`
  (no storageState) hosts the negative/unauth specs so the real server-side gate is
  what rejects them; `chromium-no-role` depends on `setup` and runs only
  `*.no-role.spec.ts`, signed in as the account that never holds a role (S-403), so
  the role gate and the action guard are what answer; `chromium-viewer` depends on
  `setup` and runs only `*.viewer.spec.ts`, signed in as the account that holds
  `viewer` (S-405), so every page must render with no edit control;
  `chromium-admin` depends on `setup` and runs only `*.admin.spec.ts`, signed in as
  the account that holds `admin` (S-406), for the Users page. Authenticated
  specs go in `*.spec.ts`; negative specs are named `*guard.spec.ts` /
  `*unauth.spec.ts`; role-less specs are named `*.no-role.spec.ts`; viewer specs are
  named `*.viewer.spec.ts`; admin specs are named `*.admin.spec.ts`.
- **Local prerequisites.** Local Supabase running + `pnpm env:local`. All four
  accounts are provisioned automatically by `pretest:e2e` before `pnpm test:e2e`
  (`scripts/provision-e2e-author.mjs`, loopback-only): the author, holding the
  `author` role, `e2e-no-role@example.test`, whose role row is deleted on every
  run, `e2e-viewer@example.test`, whose role is reset to `viewer` on every run, and
  `e2e-admin@example.test`, whose role is reset to `admin`. So after a run the local
  stack holds a second admin besides your own account.
  `.envs/local.vars` must carry `SOLVER_URL` (with `mise run solver:dev` up, for
  `generation.spec.ts` and `generation.viewer.spec.ts`; both dispatch, so a parallel
  run wants `SOLVER_MAX_CONCURRENT_JOBS=2` or the loser gets a 503) and Cloudflare's
  public Turnstile test keys (for the reset specs; without them `/auth/forgot`
  renders "unavailable") — README § Getting Started.

## Rules

- **Authenticate via `storageState`, never through the UI in a test.** The `setup`
  project already did the login; authenticated specs start signed in. (The only
  files that drive the sign-in UI are the four setup files, `auth.setup.ts`,
  `no-role.setup.ts`, `viewer.setup.ts` and `admin.setup.ts`.)
- **Never assert on the sidebar footer's text.** `account.spec.ts` sets the shared
  author's display name while it runs (and clears it in a `finally`), so the footer
  may show a name in parallel specs. Never submit the author's password form either:
  the next run's `setup` would fail to sign in. One carve-out: a viewer spec may
  assert the footer's "View only" chip by its own accessible text, exactly
  (`getByText("View only", { exact: true })`), and never by the name beside it.
- **The no-role account never gets a role.** `e2e-no-role@example.test`
  (`e2e/no-role-credentials.mjs`) exists to prove what a user without a role sees;
  a spec that assigns it one proves nothing, and the provisioner deletes any role
  row for it anyway. Never submit its password form either (the next run's `setup`
  could not sign in), and never sign it out: that revokes the session every
  `chromium-no-role` spec shares.
- **The viewer account's role, password and session are never changed.**
  `e2e-viewer@example.test` (`e2e/viewer-credentials.mjs`) exists to prove that a
  viewer sees no edit control; a spec that grants it more proves nothing, and the
  provisioner resets it to `viewer` anyway. Never submit its password form and
  never sign it out, for the same reasons as the no-role account's. A viewer can
  create nothing, so a viewer spec arranges its data, and tears it down, in a second
  context on the author's storageState
  (`browser.newContext({ storageState: "e2e/.auth/user.json" })`) — see
  `read-only.viewer.spec.ts`. Pair each absence the viewer asserts with the same
  locator present on the author's side, so a drifted locator fails rather than
  passing a `toHaveCount(0)` on nothing.
- **The admin account's role, password and session are never changed.**
  `e2e-admin@example.test` (`e2e/admin-credentials.mjs`) is the Users page's
  signed-in admin, and the other projects' specs open a second context on its
  `storageState` to pair an absence with its presence. Never change its role on
  the page (a demotion would also take the Users page away from every parallel
  spec), never submit its password form, and never sign it out.
- **One sanctioned exception to "never touch users": a throwaway user.** An unauth
  spec whose flow changes a password, or an admin spec that changes a role, may
  create its own user through the service-role admin API
  (`e2e/support/admin-api.ts`) and delete it in a `finally`. That client refuses
  any non-loopback `SUPABASE_URL` first, so it can never create users on hosted.
  See `forgot-password-unauth.spec.ts` and `users.admin.spec.ts`.
- **Read mail through Mailpit's API** (`src/test/mailpit.ts`, loopback-only), with a
  unique address per test, and delete only your own messages, by id. Mailpit's
  `DELETE /api/v1/messages` with no ids empties the whole mailbox, including mail
  a parallel spec or suite is waiting for.
- **Role-based locators first:** `getByRole` / `getByLabel` / `getByText`. Never
  CSS selectors, XPath, or DOM structure. The agent sees the accessibility tree,
  not pixels. Disambiguate by scoping to a container (e.g. the row), not by
  `nth-child`. The planner board carries the roles + accessible names this needs:
  cells (`gridcell`, named even when empty), chips (by course name +
  `aria-invalid` for collision), and the A/B `radio` controls are reached by role
  - name — visual-state logic (tone/hint coloring) is unit-tested, never selected on.
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
