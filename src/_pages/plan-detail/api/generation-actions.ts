import { defineDomainAction } from "@/shared/lib/actions";
import { checkGeneration, checkGenerationInput } from "./generation-delivery";
import { startGeneration, startGenerationInput, type GenerationDeps } from "./generation-job";

/**
 * The generation actions, as a FACTORY rather than a constant.
 *
 * Everything else in the codebase exports a plain `xActions` object, and this one cannot: the enqueue
 * path needs the solver transport, which is read from `astro:env/server`. A `_pages` module may not
 * import that — `@/entities/timetable/api/solver-config` is a public-API sidestep (`pnpm steiger`
 * error, measured) and the entity's own barrel must stay client-safe, since every React island
 * imports it. So the environment-bound dependency is resolved at the composition root
 * (`src/actions/index.ts`, which sits outside the FSD graph) and injected here.
 *
 * The shape is the same split `solver-transport.ts` / `solver-config.ts` already established one
 * level down, for the same reason: the tested path and the shipped path stay the same path, because
 * nothing on it reaches for a build-time virtual module.
 */
export const createGenerationActions = (deps: GenerationDeps) => ({
  startGeneration: defineDomainAction({
    input: startGenerationInput,
    run: (supabase, input) => startGeneration(supabase, input, deps),
  }),
  // No injected dependency: delivery never talks to the solver. It reads the row the solver already
  // wrote, and everything after that is the database and the pure oracle.
  checkGeneration: defineDomainAction({ input: checkGenerationInput, run: checkGeneration }),
});
