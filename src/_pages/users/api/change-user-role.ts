import { RAISED_CONFLICT, unwrapMany, unwrapRow, type SupabaseClient } from "@/shared/api";
import type { AppRole } from "@/shared/config";
import { DomainError } from "@/shared/lib/errors";
import type { ChangeUserRoleInput } from "../model/schemas";
import { banHolds } from "./ban-holds";
import {
  ACCESS_ALREADY_CHANGED_MESSAGE,
  CHANGE_ROLE_FAILURE,
  LAST_ADMIN_MESSAGE,
  NO_ROLE_TO_REMOVE_MESSAGE,
  REMOVE_ROLE_FAILURE,
} from "./constants";

/**
 * Give a user a role, change it, or remove it (`role: null`, "No access"), under the admin's own
 * session (S-406). RLS decides who may write, and refuses a machine user. The last-admin guard
 * refuses leaving the school without an admin. The recording trigger takes the actor from the
 * session, so the input never names one.
 *
 * - The last-admin refusal (`PT409`) → `CONFLICT`, checked before anything else.
 * - A refused write (`42501`) → `FORBIDDEN`, through `unwrapRow` / `unwrapMany`.
 * - Removing a role the user does not hold matches no row → `NOT_FOUND`.
 * - A recorded ban (`user_directory.banned_at`, S-411) → `NOT_FOUND`, the "already changed" outcome
 *   Reactivate gives, with no write. Removing the role would strand the ban: unban, delete and a new
 *   email all refuse a row with no role. Granting one to a row with none would insert it unpaused,
 *   handing back data access while GoTrue still bans them. Unban first.
 */
export const changeUserRole = async (
  supabase: SupabaseClient,
  { userId, role }: ChangeUserRoleInput,
): Promise<void> => {
  if (await banHolds(supabase, userId, role === null ? REMOVE_ROLE_FAILURE : CHANGE_ROLE_FAILURE)) {
    throw new DomainError("NOT_FOUND", ACCESS_ALREADY_CHANGED_MESSAGE);
  }
  await (role === null ? removeRole(supabase, userId) : setRole(supabase, userId, role));
};

/** An upsert, so one write gives a role-less user a role or changes an existing one. */
const setRole = async (supabase: SupabaseClient, userId: string, role: AppRole): Promise<void> => {
  const result = await supabase
    .from("user_roles")
    .upsert({ user_id: userId, role }, { onConflict: "user_id" })
    .select("user_id, role")
    .single();
  refuseLastAdmin(result.error);
  unwrapRow(result, { failure: CHANGE_ROLE_FAILURE });
};

const removeRole = async (supabase: SupabaseClient, userId: string): Promise<void> => {
  const result = await supabase.from("user_roles").delete().eq("user_id", userId).select("user_id");
  refuseLastAdmin(result.error);
  if (unwrapMany(result, REMOVE_ROLE_FAILURE).length === 0) {
    throw new DomainError("NOT_FOUND", NO_ROLE_TO_REMOVE_MESSAGE);
  }
};

const refuseLastAdmin = (error: { code: string } | null): void => {
  if (error?.code === RAISED_CONFLICT) throw new DomainError("CONFLICT", LAST_ADMIN_MESSAGE);
};
