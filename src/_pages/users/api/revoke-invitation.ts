import type { SupabaseClient } from "@/shared/api";
import type { InvitationTarget, InvitationTargetInput } from "../model/schemas";
import { invokeAdminUsers } from "./invoke-admin-users";

/**
 * Withdraw an invitation the person has not finished (S-410, FR-404): the never-used account is
 * deleted, and its link stops working. The function refuses an account that chose a password.
 */
export const revokeInvitation = (
  supabase: SupabaseClient,
  { userId }: InvitationTargetInput,
): Promise<InvitationTarget> => invokeAdminUsers(supabase, { op: "revoke", userId });
