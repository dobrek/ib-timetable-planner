// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

/**
 * Pre-bundle server-only deps that Vite would otherwise discover lazily on the first
 * request. A late discovery (e.g. `astro/env/runtime`, reached transitively via the
 * Supabase client) triggers a mid-render re-optimize + reload: modules already
 * evaluated keep a stale `react` chunk URL while `react-dom/server` reloads with a
 * fresh one, yielding two React instances and an "Invalid hook call" in dev SSR.
 * Including them in the initial scan keeps a single React instance. Dev-only —
 * `optimizeDeps` does not affect the production build. Uses the Vite 7 Environment
 * API per the Astro Cloudflare adapter guidance.
 */
function ssrPrebundleDeps() {
  return {
    name: "ssr-prebundle-deps",
    configEnvironment(name) {
      if (name === "client") return;
      return {
        optimizeDeps: {
          include: ["astro/env/runtime", "react", "react-dom", "react-dom/server", "react/jsx-runtime"],
        },
      };
    },
  };
}

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
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
