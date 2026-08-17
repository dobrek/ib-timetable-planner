import { SOLVER_URL } from "astro:env/server";
import { getContainer } from "@cloudflare/containers";
import { env } from "cloudflare:workers";
import type { SolverContainer } from "@/solver-container";
import { selectSolverTransport } from "./select-solver-transport";
import { createBindingSolverTransport } from "./solver-binding-transport";
import { createSolverTransport, type SolverTransport } from "./solver-transport";

/**
 * The environment-reading half of the solver seam — deliberately a SEPARATE module from the
 * factories, and, since S-302, the place the URL-vs-binding decision is resolved.
 *
 * Neither of its two environment sources can live in `solver-transport.ts`. `astro:env/server` is a
 * build-time virtual module, so importing it there would make the factory unimportable from plain
 * vitest and put the proof-of-life integration test out of reach of the function S-301 dispatches
 * through. `cloudflare:workers` is worse: it exists only inside workerd. Keeping both reads here is
 * what keeps the tested path and the shipped path the same path — the precedence itself is a pure
 * function in `select-solver-transport.ts`, tested there.
 *
 * `env` is MODULE-SCOPE, not per-request, which is why S-302 did not change this function's
 * signature: no call site had to start threading a request through. A binding could not have
 * travelled through `astro:env` in any case — the adapter's env bridge returns `undefined` for
 * anything that is not a primitive.
 *
 * **Not exported from the slice barrel, and it must not be.** `entities/timetable`'s `index.ts` is
 * pulled into the CLIENT bundle by the `client:load` islands that import it (`PlannerBoard.tsx` and
 * ~20 more components), where Astro's env plugin throws `[ServerOnlyModule]` at load time — before
 * tree-shaking can drop an unused export — so re-exporting this would fail `pnpm build` outright.
 * `cloudflare:workers` and `@cloudflare/containers` now make that doubly true. Server callers
 * therefore import this module at its own path, which IS a step outside the slice's public API — a
 * deliberate one, forced by the bundle and enforced by the build rather than by convention.
 * (`shared/api`'s `createClient` is not the precedent it looks like: that one is barrel-exported and
 * reached as `@/shared/api`.)
 */
export const getSolverTransport = (): SolverTransport | null =>
  selectSolverTransport<DurableObjectNamespace<SolverContainer>>({
    url: SOLVER_URL,
    binding: env.SOLVER,
    fromUrl: createSolverTransport,
    // A named singleton: one container, matching `max_instances: 1`. `getContainer` resolves the
    // Durable Object stub; the transport itself only ever sees the two methods it calls.
    fromBinding: (binding) => createBindingSolverTransport(getContainer(binding, "solver")),
  });
