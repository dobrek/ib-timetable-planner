// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

/**
 * Pre-bundle server-only deps that Vite would otherwise discover lazily on the first
 * request. A late discovery triggers a mid-render re-optimize + reload: modules already
 * evaluated keep a stale `react` chunk URL while `react-dom/server` reloads with a
 * fresh one, yielding two React instances and an "Invalid hook call" in dev SSR (the
 * crash surfaces in the first React-context consumer to render — e.g. `useLucideContext`
 * — but the trigger is the reload, not that dep). Including the late deps in the initial
 * scan keeps a single React instance. Dev-only — `optimizeDeps` does not affect the
 * production build. Uses the Vite 8 Environment API per the Astro Cloudflare adapter
 * guidance.
 *
 * The `astro/*` virtual-runtime entries below are the actual triggers. Astro's `astro:*`
 * modules (`astro:env/server`, `astro:actions`, `astro:transitions/client`) are resolved
 * by Astro's Vite plugin at transform time, so Vite 8's Rolldown dep-scanner cannot see
 * them during its static pre-scan and only discovers them mid-render. `astro/env/runtime`
 * (via the Supabase client) hits the public sign-in route; `astro/actions/runtime/...`
 * and the `transitions-*` modules (island `actions` calls + `navigate()`) hit the
 * authenticated board at `/plans/:id`. Verified during the Astro v7 upgrade: without the
 * actions/transitions entries, cold-start SSR of `/plans/:id` reloads twice and throws
 * "Cannot read properties of null (reading 'useContext')". This is the complete set of
 * island-imported virtual modules per the app's documented framework surface.
 */
function ssrPrebundleDeps() {
  return {
    name: "ssr-prebundle-deps",
    /** @param {string} name */
    configEnvironment(name) {
      if (name === "client") return;
      return {
        optimizeDeps: {
          include: [
            "astro/env/runtime",
            "astro/actions/runtime/entrypoints/server.js",
            "astro/virtual-modules/transitions-router.js",
            "astro/virtual-modules/transitions-events.js",
            "astro/virtual-modules/transitions-swap-functions.js",
            "astro/virtual-modules/transitions-types.js",
            "react",
            "react-dom",
            "react-dom/server",
            "react/jsx-runtime",
          ],
        },
      };
    },
  };
}

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [
    // React Compiler (stable 1.x) runs as a Babel transform over the React islands, so the slice's
    // existing render-purity discipline yields auto-memoization. React 19 ships the runtime
    // (`react/compiler-runtime`), so `target: "19"` (the default) needs no polyfill package.
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", { target: "19" }]],
      },
    }),
    sitemap(),
  ],
  vite: {
    plugins: [tailwindcss(), ssrPrebundleDeps()],
  },
  adapter: cloudflare(),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
