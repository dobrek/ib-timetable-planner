import { defineConfig, devices } from "@playwright/test";

// Root Playwright config — picked up by `playwright test` with no flags.
//
// Project topology (the reusable pattern for all future browser tests):
//   - `setup`         logs in once through the real UI and writes storageState.
//   - `chromium`      authenticated specs; depends on `setup`, reuses its cookies.
//   - `chromium-guard` no storageState — the negative/unauth specs run here so the
//                      real server-side gate (middleware redirect / requireSession)
//                      is what rejects them, not a missing fixture.
//
// `webServer` builds then previews on REAL workerd (`astro preview` = `wrangler
// dev ./dist`), because the boundary under test (`/_actions/*` + `astro:env/server`
// secrets + cookie SSR) only behaves correctly on workerd, not Vite-emulated dev.
// The preview worker reads SUPABASE_URL/SUPABASE_KEY from `.dev.vars` (written by
// `pnpm env:local` locally, by the CI step in the e2e job). `webServer.env` is
// belt-and-suspenders only — workerd's binding source is `.dev.vars`.

const PORT = 4321;
const baseURL = `http://localhost:${PORT}`;

/** Forward only the env vars that are actually set, so an unset var can't shadow `.dev.vars` with an empty string. */
function definedEnv(...keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value) out[key] = value;
  }
  return out;
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL,
    headless: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      testIgnore: /.*(guard|unauth)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
    {
      name: "chromium-guard",
      testMatch: /.*(guard|unauth)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: { cookies: [], origins: [] } },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm preview",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: definedEnv("SUPABASE_URL", "SUPABASE_KEY"),
  },
});
