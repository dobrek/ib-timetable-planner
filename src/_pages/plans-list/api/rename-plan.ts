import { unwrapRow, type Database, type SupabaseClient } from "@/shared/api";
import type { RenamePlanInput } from "../model/schemas";
import { assertNotPending } from "./pending-guards";

type PlanRecord = Database["public"]["Tables"]["plans"]["Row"];

/**
 * Rename a plan by id.
 *
 * Refused while the plan is a pending proposal (S-306): its name is `Proposal — <source>`, which is
 * the only thing on the hub that says what it is and what it came from, and renaming it before the
 * board lands is the one act that would make an in-flight solve's target unrecognisable. Renaming is
 * how the author KEEPS a delivered proposal — that is the whole act — so it is not lost, only
 * deferred by the length of the solve.
 *
 * The update filters on the flag as well, so a clone that becomes pending between the guard's read
 * and the write (the ms between `clone_plan` and `markPending` in enqueue) is refused, not renamed —
 * it surfaces as "Plan not found.", the verbatim message the action boundary pins, which is the
 * honest answer for a plan that just stopped being renameable.
 */
export const renamePlan = async (supabase: SupabaseClient, input: RenamePlanInput): Promise<PlanRecord> => {
  await assertNotPending(supabase, input.id);
  return unwrapRow(
    await supabase
      .from("plans")
      .update({ name: input.name })
      .eq("id", input.id)
      .eq("pending_proposal", false)
      .select()
      .single(),
    {
      notFound: "Plan not found.",
      failure: "Failed to rename plan",
    },
  );
};
