import { defineAction } from "astro:actions";
import { requireSession, requireSupabase, runDomain } from "@/shared/lib";
import { computeAndPersistGroupings, computeGroupingsInput } from "./grouping-compute";

export { computeAndPersistGroupings, computeGroupingsInput } from "./grouping-compute";

export const groupingActions = {
  computeGroupings: defineAction({
    input: computeGroupingsInput,
    handler: (input, context) => {
      requireSession(context);
      const supabase = requireSupabase(context);
      return runDomain(() => computeAndPersistGroupings(supabase, input));
    },
  }),
};
