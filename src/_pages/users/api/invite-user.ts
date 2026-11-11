import type { SupabaseClient } from "@/shared/api";
import type { InvitationSent, InviteUserInput } from "../model/schemas";
import { invokeAdminUsers } from "./invoke-admin-users";

/**
 * Invite a colleague by email with a role (S-410, FR-401). The function fences and records the
 * account before it sends the one email. A pending invitation to the same address is re-sent with
 * this role (`resent: true`); an address with any other account is refused.
 */
export const inviteUser = (supabase: SupabaseClient, { email, role }: InviteUserInput): Promise<InvitationSent> =>
  invokeAdminUsers(supabase, { op: "invite", email, role });
