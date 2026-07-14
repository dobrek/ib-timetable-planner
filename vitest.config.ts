import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vite 8 resolves tsconfig `paths` natively — no `vite-tsconfig-paths` plugin needed.
  resolve: { tsconfigPaths: true },
  test: {
    // Stub Astro virtual modules so slice code reaching them through the
    // `@/shared/api` barrel (env-reading `createClient`) and the action wrapper
    // (`ActionError`/`defineAction`) is importable under Vitest. Lives on the root
    // so `extends: true` projects inherit it.
    alias: {
      "astro:env/server": fileURLToPath(new URL("./test/stubs/astro-env-server.ts", import.meta.url)),
      "astro:actions": fileURLToPath(new URL("./test/stubs/astro-actions.ts", import.meta.url)),
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          // `bench/**/*.test.ts` is the PURE unit coverage beside the bench runners (identity
          // mapping, skeleton copy). The runners themselves are invisible to this glob by suffix
          // (`*.bench.ts` / `*.analyze.ts` / `*.experiment.ts`), and a bench unit test must stay
          // pure — there is no `load-test-env` setup here, so a DB-reaching test fails loudly in CI
          // rather than being quietly absorbed into `pnpm test`.
          include: ["src/**/*.test.ts", "bench/**/*.test.ts"],
          exclude: ["src/**/*.integration.test.ts"],
        },
      },
      {
        // jsdom lane for React/hook tests. Inherits the root plugins + `astro:*`
        // alias via `extends: true`; `*.test.tsx` only, so the node `unit` project
        // (`*.test.ts`) and this lane never collect the same file.
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test/setup-dom.ts"],
        },
      },
    ],
  },
});
