import { clonePlan, type SupabaseClient } from "@/shared/api";
import type { ClonePlanInput } from "../model/schemas";
import { assertNotPending } from "./pending-guards";

/**
 * The hub's Clone, with S-306's pending guard in front of it.
 *
 * The guard is here rather than inside `shared/api/clone-plan.ts` on purpose: that function has two
 * callers, and the other one is the generation enqueue, which clones a plan precisely in order to
 * make a pending proposal out of it. Pushing the refusal down would make the slice's own dispatch
 * path refuse itself. So `clonePlan` stays unaware of pending, and the hub — the one surface where an
 * author can click Clone on a proposal row — wraps it.
 *
 * Copying a proposal mid-solve would produce a plan whose board is the clone's pins rather than the
 * result, and it would read as a snapshot of something that does not exist yet.
 */
export const clonePlanGuarded = async (supabase: SupabaseClient, input: ClonePlanInput): Promise<{ id: string }> => {
  await assertNotPending(supabase, input.sourcePlanId);
  return clonePlan(supabase, input);
};
