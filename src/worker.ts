import { handle } from "@astrojs/cloudflare/handler";
import { scheduled } from "./job-email-cron";

export { SolverContainer } from "./solver-container";

/**
 * The Worker's entry module — project-owned since S-302, and that is the whole point of the file.
 *
 * `wrangler.jsonc`'s `main` used to point straight at `@astrojs/cloudflare/entrypoints/server`,
 * whose built output is a **default export and nothing else**. A Cloudflare container must be
 * fronted by a Durable Object class that is *exported by name* from the entry module, so a
 * framework-owned entry makes containers unreachable. Owning three lines here fixes that without
 * forking anything: `handle` is a public subpath of the adapter (`@astrojs/cloudflare/handler`), so
 * the request path is byte-for-byte what the adapter's own entrypoint does.
 *
 * Verified rather than assumed (spike, 2026-08-16): the Astro/Vite build accepts a project-owned
 * `main`, `virtual:astro-cloudflare:config` still resolves, the container config survives into
 * `dist/server/wrangler.json`, and the named class export survives Rolldown treeshaking into
 * `dist/server/entry.mjs`.
 *
 * **Do not repoint `main` back at the adapter entrypoint.** The build would stay green and the
 * container would simply stop being deployable.
 *
 * **The default export also carries `scheduled`** (S-310): the job-email cron, fired once a minute by
 * `wrangler.jsonc`'s `triggers.crons` (`src/job-email-cron.ts`). The adapter does not wrap a
 * project-owned `main`: its Vite plugin re-exports this default object as it is, and its output
 * config spreads `triggers` into `dist/server/wrangler.json`. Checked in the build, not assumed: the
 * cron's `[job-email]` log tag is in `dist/server/`, and `triggers.crons` is in the built config.
 *
 * `steiger` does not inspect top-level `src/` files (they sit outside `layerSequence`), which is why
 * this, `solver-container.ts` and `job-email-cron.ts` live here rather than under a layer.
 */
export default { fetch: handle, scheduled } satisfies ExportedHandler<Env>;
