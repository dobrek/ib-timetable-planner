import { RAISED_CONFLICT, unwrapMany, type SupabaseClient } from "@/shared/api";
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
 * and a repeat is reported, not silently re-applied.
 *
 * - The last-admin refusal (`PT409`) → `CONFLICT`, checked before anything else.
 * - A refused write (`42501`) → `FORBIDDEN`, through `unwrapMany`.
 * - No row matched → `NOT_FOUND`: the person is already in that state, holds no role, or the page is
 *   out of date.
 */
export const setUserActive = async (
  supabase: SupabaseClient,
  { userId, active }: SetUserActiveInput,
): Promise<void> => {
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

const reactivate = (supabase: SupabaseClient, userId: string) =>
  supabase
    .from("user_roles")
    .update({ deactivated_at: null })
    .eq("user_id", userId)
    .not("deactivated_at", "is", null)
    .select("user_id");
