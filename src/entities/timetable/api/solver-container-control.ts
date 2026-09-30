import { getContainer } from "@cloudflare/containers";
import { env } from "cloudflare:workers";
import type { SolverContainer } from "@/solver-container";
import type { SolverContainerControl } from "@/solver-container-ops";

/**
 * The operator's handle on the solver container (2026-09, S-308's campaign automation): the two
 * Durable Object methods the `/api/solver/container` route exposes, and the allowlist that guards it.
 *
 * It sits beside `solver-config.ts` because it reads the same module-scope source, `cloudflare:workers`,
 * and for the same reason it is **not exported from the slice barrel**: the barrel is pulled into
 * client islands, where `cloudflare:workers` and `@cloudflare/containers` cannot load. The route
 * imports this module at its own path.
 */

/**
 * The container's control surface, or `null` when this Worker has no usable binding. Resolves the same
 * named singleton the dispatch transport does (`"solver"`, matching `max_instances: 1`), so the state
 * it reports is the instance that solves.
 */
export const getSolverContainerControl = (): SolverContainerControl | null => controlOf(env.SOLVER);

/** The raw `SOLVER_OPS_ALLOWED_EMAILS` secret; interpreting it is `checkOpsAccess`'s job. */
export const getSolverOpsAllowlist = (): string | undefined => env.SOLVER_OPS_ALLOWED_EMAILS;

/** Takes the binding as possibly absent even though the hand-written `Env` declares it present: a
 *  Worker deployed without it must answer "no control" (the route's 409), not throw. */
const controlOf = (binding: DurableObjectNamespace<SolverContainer> | undefined): SolverContainerControl | null =>
  binding ? getContainer(binding, "solver") : null;
