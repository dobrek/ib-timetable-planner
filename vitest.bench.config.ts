import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * On-demand generation benchmark (`pnpm bench:generation`) — NOT part of `pnpm test` or CI.
 * Runs the shipped engine against the real dp1+dp2 catalog loaded from the local Supabase
 * stack (start it with `pnpm exec supabase start`; env comes from `.env.test.local`).
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["bench/**/*.bench.ts"],
    setupFiles: ["./src/test/load-test-env.ts"],
    testTimeout: 120_000,
    alias: {
      "astro:env/server": fileURLToPath(new URL("./test/stubs/astro-env-server.ts", import.meta.url)),
      "astro:actions": fileURLToPath(new URL("./test/stubs/astro-actions.ts", import.meta.url)),
    },
  },
});
