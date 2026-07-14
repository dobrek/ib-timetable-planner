import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * On-demand generation experiment (`pnpm experiment:generation`) — NOT part of `pnpm test` or CI.
 * Clones a plan catalog-only in the local Supabase stack, optionally pins the fixture skeleton,
 * generates, verifies, persists, and prints the comparison against the source plan (start the stack
 * with `pnpm exec supabase start`; env comes from `.env.test.local`).
 *
 * A config of its own, mirroring `vitest.bench.config.ts` / `vitest.analyze.config.ts`: the
 * `*.experiment.ts` / `*.bench.ts` / `*.analyze.ts` include split keeps the three DB-touching entry
 * points from ever triggering each other, and keeps all three invisible to `pnpm test`'s
 * `bench/**\/*.test.ts` glob (which collects only the pure unit tests beside them).
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["bench/**/*.experiment.ts"],
    setupFiles: ["./src/test/load-test-env.ts"],
    testTimeout: 180_000,
    // The printed comparison IS this runner's product, and Vitest 4's default reporter swallows
    // `console.log` from passing tests — without this the run reports nothing but "1 passed".
    reporters: ["verbose"],
    alias: {
      "astro:env/server": fileURLToPath(new URL("./test/stubs/astro-env-server.ts", import.meta.url)),
      "astro:actions": fileURLToPath(new URL("./test/stubs/astro-actions.ts", import.meta.url)),
    },
  },
});
