import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
    // Stub Astro's server-env virtual module so the `@/shared/api` barrel
    // (which re-exports the env-reading `createClient`) is importable under Vitest.
    alias: {
      "astro:env/server": fileURLToPath(new URL("./test/stubs/astro-env-server.ts", import.meta.url)),
    },
  },
});
