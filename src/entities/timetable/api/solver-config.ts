import { SOLVER_URL } from "astro:env/server";
import { createSolverTransport, type SolverTransport } from "./solver-transport";

/**
 * The env-reading half of the solver seam — deliberately a SEPARATE module from the factory.
 *
 * `astro:env/server` is a build-time virtual module: importing it at the top of `solver-transport.ts`
 * would make that file unimportable from plain vitest, and the proof-of-life integration test would
 * then be unable to exercise the very function S-301 dispatches through. Splitting the read out is
 * what keeps the tested path and the shipped path the same path.
 *
 * It is also the S-302 seam in miniature: when production moves to a Durable Object container
 * binding, this module is what changes. `createSolverTransport` and every call site do not.
 *
 * **Not exported from the slice barrel, and it must not be.** `entities/timetable`'s `index.ts` is
 * pulled into the Web Worker bundle, where Astro's env plugin throws `[ServerOnlyModule]` at load
 * time — before tree-shaking can drop an unused export — so re-exporting this would fail
 * `pnpm build` outright. Import it at this path from server code only, exactly as `createClient`
 * in `shared/api` is reached.
 */
export const getSolverTransport = (): SolverTransport | null => (SOLVER_URL ? createSolverTransport(SOLVER_URL) : null);

/** Whether a solver is reachable at all in this deployment — the `config-status.ts` gating shape. */
export const isSolverConfigured = (): boolean => Boolean(SOLVER_URL);
