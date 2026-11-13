import { RAISED_CONFLICT, unwrapMany, unwrapMaybeRow, type SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import type { SetUserActiveInput } from "../model/schemas";
import {
  ACCESS_ALREADY_CHANGED_MESSAGE,
  DEACTIVATE_FAILURE,
  LAST_ADMIN_MESSAGE,
  REACTIVATE_FAILURE,
} from "./constants";

/**
 * Deactivate a user (`active: false`) or reactivate them (`active: true`), under the admin's own
 * session (S-408). Only `user_roles.deactivated_at` is written, so the role is kept: while it is set,
 * `private.current_app_role()` reads null and the person's next request finds no access. RLS decides
 * who may write, the last-admin guard refuses deactivating the last active admin, and the recording
 * trigger takes the actor from the session, so the input never names one.
 *
 * Each direction is filtered on the state it changes, so it never moves a deactivation's timestamp
 * and a repeat is reported, not silently re-applied. Reactivate also refuses, with that same
 * outcome and no write, while `user_directory.banned_at` is set: clearing the pause would hand back
 * data access and leave the GoTrue ban in place. The column is not on `user_roles`, so it cannot be
 * a filter on that update. Deactivate still writes `{ deactivated_at }` only.
 *
 * - The last-admin refusal (`PT409`) → `CONFLICT`, checked before anything else. Only a deactivation
 *   can meet it: the guard skips a row that is already deactivated.
 * - No row matched → `NOT_FOUND`: the person is already in that state, holds no role, or the page is
 *   out of date. A caller who is not an admin lands here too, since the UPDATE policy's USING hides
 *   every row from them (the action's `requires` refuses them first).
 * - A refused write (`42501`) → `FORBIDDEN`, through `unwrapMany`: the mapping's fallback, for a
 *   WITH CHECK failure.
 */
export const setUserActive = async (
  supabase: SupabaseClient,
  { userId, active }: SetUserActiveInput,
): Promise<void> => {
  if (active && (await banHolds(supabase, userId))) {
    throw new DomainError("NOT_FOUND", ACCESS_ALREADY_CHANGED_MESSAGE);
  }
  const result = await (active ? reactivate(supabase, userId) : deactivate(supabase, userId));
  if (result.error?.code === RAISED_CONFLICT) throw new DomainError("CONFLICT", LAST_ADMIN_MESSAGE);
  if (unwrapMany(result, active ? REACTIVATE_FAILURE : DEACTIVATE_FAILURE).length === 0) {
    throw new DomainError("NOT_FOUND", ACCESS_ALREADY_CHANGED_MESSAGE);
  }
};

const deactivate = (supabase: SupabaseClient, userId: string) =>
  supabase
    .from("user_roles")
    .update({ deactivated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("deactivated_at", null)
    .select("user_id");

/** A recorded ban holds the pause. A missing directory row does not: there is nothing to keep. */
const banHolds = async (supabase: SupabaseClient, userId: string): Promise<boolean> => {
  const row = unwrapMaybeRow(
    await supabase.from("user_directory").select("banned_at").eq("user_id", userId).maybeSingle(),
    REACTIVATE_FAILURE,
  );
  return (row?.banned_at ?? null) !== null;
};

const reactivate = (supabase: SupabaseClient, userId: string) =>
  supabase
    .from("user_roles")
    .update({ deactivated_at: null })
    .eq("user_id", userId)
    .not("deactivated_at", "is", null)
    .select("user_id");
