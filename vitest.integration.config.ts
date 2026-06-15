import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["./src/test/load-test-env.ts"],
    // Stub Astro's server-env virtual module so the `@/shared/api` barrel
    // (re-exporting the env-reading `createClient`) is importable under Vitest.
    // Integration suites build their own service-role client from process.env,
    // so the empty stub bindings are never used.
    alias: {
      "astro:env/server": fileURLToPath(new URL("./test/stubs/astro-env-server.ts", import.meta.url)),
    },
  },
});
