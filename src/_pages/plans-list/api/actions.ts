import { clonePlan } from "@/shared/api";
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

export const planActions = {
  createPlan: defineDomainAction({ input: createPlanInput, run: createPlan }),
  clonePlan: defineDomainAction({ input: clonePlanInput, run: clonePlan }),
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
