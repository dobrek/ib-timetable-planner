import { defineDomainAction } from "@/shared/lib/actions";
import {
  clonePlanInput,
  createPlanInput,
  deletePlanInput,
  readGenerationJobStatusesInput,
  renamePlanInput,
} from "../model/schemas";
import { createPlan } from "./create-plan";
import { renamePlan } from "./rename-plan";
import { deletePlan } from "./delete-plan";
import { readGenerationJobStatuses } from "./generation-status";
import { clonePlanGuarded } from "./clone-plan-guarded";

export const planActions = {
  createPlan: defineDomainAction({ input: createPlanInput, run: createPlan }),
  // S-306: `clonePlanGuarded`, not `clonePlan` — a pending proposal must not be copied mid-solve.
  clonePlan: defineDomainAction({ input: clonePlanInput, run: clonePlanGuarded }),
  renamePlan: defineDomainAction({ input: renamePlanInput, run: renamePlan }),
  deletePlan: defineDomainAction({ input: deletePlanInput, run: deletePlan }),
  // A READ behind an action, which is unusual here and deliberate: it is the hub's poll, so it needs
  // the same session gate and the same Supabase-client plumbing every mutation gets, and none of the
  // raw Request/Response reasons that would make it an API route.
  readGenerationJobStatuses: defineDomainAction({
    input: readGenerationJobStatusesInput,
    run: readGenerationJobStatuses,
  }),
};
