import { defineDomainAction } from "@/shared/lib/actions";
import {
  clonePlanInput,
  createPlanInput,
  deletePlanInput,
  markCurrentPlanInput,
  readGenerationJobStatusesInput,
  renamePlanInput,
  unmarkCurrentPlanInput,
} from "../model/schemas";
import { createPlan } from "./create-plan";
import { renamePlan } from "./rename-plan";
import { deletePlan } from "./delete-plan";
import { markCurrentPlan } from "./mark-current-plan";
import { unmarkCurrentPlan } from "./unmark-current-plan";
import { readGenerationJobStatuses } from "./generation-status";
import { clonePlanGuarded } from "./clone-plan-guarded";

export const planActions = {
  createPlan: defineDomainAction({ input: createPlanInput, run: createPlan }),
  // S-306: `clonePlanGuarded`, not `clonePlan` — a pending proposal must not be copied mid-solve.
  clonePlan: defineDomainAction({ input: clonePlanInput, run: clonePlanGuarded }),
  renamePlan: defineDomainAction({ input: renamePlanInput, run: renamePlan }),
  deletePlan: defineDomainAction({ input: deletePlanInput, run: deletePlan }),
  markCurrentPlan: defineDomainAction({ input: markCurrentPlanInput, run: markCurrentPlan }),
  unmarkCurrentPlan: defineDomainAction({ input: unmarkCurrentPlanInput, run: unmarkCurrentPlan }),
  // A READ behind an action, which is unusual here and deliberate: it is the hub's poll, so it needs
  // the same session gate and the same Supabase-client plumbing every mutation gets, and none of the
  // raw Request/Response reasons that would make it an API route. It writes nothing, so it declares
  // `read` (S-403): a viewer's hub keeps polling.
  readGenerationJobStatuses: defineDomainAction({
    input: readGenerationJobStatusesInput,
    run: readGenerationJobStatuses,
    requires: "read",
  }),
};
