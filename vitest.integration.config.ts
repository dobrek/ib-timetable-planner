import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["./src/test/load-test-env.ts"],
    // Stub Astro's virtual modules so slice code reaching them is importable under
    // Vitest: `astro:env/server` for the `@/shared/api` barrel (env-reading
    // `createClient`), and `astro:actions` for the action wrapper (`ActionError` /
    // `defineAction`) so boundary suites can drive an action's `.handler` directly.
    // Integration suites build their own service-role client from process.env, so the
    // empty env-stub bindings are never used.
    alias: {
      "astro:env/server": fileURLToPath(new URL("./test/stubs/astro-env-server.ts", import.meta.url)),
      "astro:actions": fileURLToPath(new URL("./test/stubs/astro-actions.ts", import.meta.url)),
    },
  },
});
