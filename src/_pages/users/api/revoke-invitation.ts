import type { SupabaseClient } from "@/shared/api";
import type { UserTarget, UserTargetInput } from "../model/schemas";
import { invokeAdminUsers } from "./invoke-admin-users";

/**
 * Withdraw an invitation the person has not finished (S-410, FR-404): the never-used account is
 * deleted, and its link stops working. The function refuses an account that chose a password.
 */
export const revokeInvitation = (supabase: SupabaseClient, { userId }: UserTargetInput): Promise<UserTarget> =>
  invokeAdminUsers(supabase, { op: "revoke", userId });
