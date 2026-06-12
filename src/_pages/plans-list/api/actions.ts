import { defineDomainAction } from "@/shared/lib";
import { clonePlanInput, createPlanInput, deletePlanInput, renamePlanInput } from "../model/schemas";
import { createPlan } from "./create-plan";
import { clonePlan } from "./clone-plan";
import { renamePlan } from "./rename-plan";
import { deletePlan } from "./delete-plan";

export const planActions = {
  createPlan: defineDomainAction({ input: createPlanInput, run: createPlan }),
  clonePlan: defineDomainAction({ input: clonePlanInput, run: clonePlan }),
  renamePlan: defineDomainAction({ input: renamePlanInput, run: renamePlan }),
  deletePlan: defineDomainAction({ input: deletePlanInput, run: deletePlan }),
};
