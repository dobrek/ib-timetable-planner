import type { SupabaseClient } from "@/shared/api";
import type { UserTarget, UserTargetInput } from "../model/schemas";
import { invokeAdminUsers } from "./invoke-admin-users";

/**
 * Send an unaccepted invitation again: a new link, and the old one stops working. The function
 * refuses one sent less than a minute ago, and one the person has already accepted.
 */
export const resendInvitation = (supabase: SupabaseClient, { userId }: UserTargetInput): Promise<UserTarget> =>
  invokeAdminUsers(supabase, { op: "resend", userId });
