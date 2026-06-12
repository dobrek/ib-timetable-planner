import { actions, type ActionError, type SafeResult } from "astro:actions";
import { callAction } from "@/shared/lib/call-action";
import type { ClonePlanInput, CreatePlanInput, DeletePlanInput, RenamePlanInput } from "../model/schemas";

/** Typed one-line wrappers over the generated action clients — the slice's api seam. */

/** Create/clone surface the new plan's id so the dialog can navigate into it. */
export const createPlan = (values: CreatePlanInput) => callActionForId(actions.createPlan, values);

export const clonePlan = (values: ClonePlanInput) => callActionForId(actions.clonePlan, values);

export const renamePlan = (values: RenamePlanInput) => callAction(actions.renamePlan, values);

export const deletePlan = (values: DeletePlanInput) => callAction(actions.deletePlan, values);

/**
 * Like `callAction`, but additionally surfaces the created row's id from the data
 * channel (the only output field the hub needs — it navigates into the new plan).
 */
async function callActionForId<TInput extends Record<string, unknown>>(
  action: (input: TInput) => Promise<SafeResult<TInput, { id: string }>>,
  input: TInput,
): Promise<{ id: string | undefined; error: ActionError<TInput> | undefined }> {
  const { data, error } = await action(input);
  return { id: data?.id, error };
}
