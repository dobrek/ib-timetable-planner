import type { SupabaseClient } from "@/shared/api";
import type { ReissuePasswordInput, TemporaryPassword } from "../model/schemas";
import { invokeAdminUsers } from "./invoke-admin-users";

/**
 * Replace a pending account's temporary password, for a person who lost it or whose copy was not
 * used. The old one stops working at once. The function refuses an account that has chosen its own.
 */
export const reissueTemporaryPassword = (
  supabase: SupabaseClient,
  { userId }: ReissuePasswordInput,
): Promise<TemporaryPassword> => invokeAdminUsers(supabase, { op: "reissue", userId });
