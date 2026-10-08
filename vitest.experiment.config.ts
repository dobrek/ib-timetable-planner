import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * On-demand bench experiments — NOT part of `pnpm test` or CI. Each has its own script naming its
 * file: `experiment:export` (clone a plan and dump its hint-free instance for the CP-SAT CLI),
 * `experiment:import` (verify and persist a CLI result into that clone) and `experiment:goldens`
 * (regenerate the contract fixtures). The DB-touching ones need the local Supabase stack (start it
 * with `pnpm exec supabase start`; env comes from `.env.test.local`).
 *
 * A config of its own, mirroring `vitest.analyze.config.ts`: the `*.experiment.ts` / `*.analyze.ts`
 * include split keeps the DB-touching entry points from ever triggering each other, and keeps both
 * invisible to `pnpm test`'s `bench/**\/*.test.ts` glob (which collects only the pure unit tests
 * beside them).
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
