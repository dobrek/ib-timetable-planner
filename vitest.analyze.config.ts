import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * On-demand plan-quality analysis (`pnpm analyze:plans`) — NOT part of `pnpm test` or CI. Loads one
 * or two plans **by id** from the local Supabase stack (start it with `pnpm exec supabase start`;
 * env comes from `.env.test.local`) and prints the comparison report.
 *
 * A config of its own, mirroring `vitest.experiment.config.ts`: the `*.analyze.ts` /
 * `*.experiment.ts` include split keeps the analyzer and the generation experiments from ever
 * triggering each other (a 60-second engine solve is not something an analysis run should pay for).
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["bench/**/*.analyze.ts"],
    setupFiles: ["./src/test/load-test-env.ts"],
    testTimeout: 120_000,
    // The printed report IS the product here, and Vitest 4's default reporter swallows `console.log`
    // from passing tests — without this the whole run exits showing nothing but "1 passed".
    reporters: ["verbose"],
    alias: {
      "astro:env/server": fileURLToPath(new URL("./test/stubs/astro-env-server.ts", import.meta.url)),
      "astro:actions": fileURLToPath(new URL("./test/stubs/astro-actions.ts", import.meta.url)),
    },
  },
});
