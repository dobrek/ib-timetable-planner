import { defineAction } from "astro:actions";
import { requireSession, requireSupabase, runDomain } from "@/shared/lib";
import { createPlacementInput, deletePlacementInput, insertPlacement, removePlacement } from "./placements";

export { createPlacementInput, deletePlacementInput, insertPlacement, removePlacement } from "./placements";

export const placementActions = {
  createPlacement: defineAction({
    input: createPlacementInput,
    handler: (input, context) => {
      requireSession(context);
      const supabase = requireSupabase(context);
      return runDomain(() => insertPlacement(supabase, input));
    },
  }),

  deletePlacement: defineAction({
    input: deletePlacementInput,
    handler: (input, context) => {
      requireSession(context);
      const supabase = requireSupabase(context);
      return runDomain(() => removePlacement(supabase, input));
    },
  }),
};
