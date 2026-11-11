import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@/shared/api";
import type { AppRole } from "@/shared/config";
import { registerUser } from "./teardown";

export type InvitedUser = {
  id: string;
  email: string;
  /** A live invite link's `token_hash`: spending it with `verifyOtp({ type: "invite" })` accepts the invitation. */
  tokenHash: string;
};

/**
 * Create an invited, unconfirmed Auth user the way the admin-users function's first step does
 * (`generateLink({ type: "invite" })`, which sends no email), register it for teardown, and return
 * the link's token. The Auth trigger mirrors `invited_at` into `user_directory` in the same write.
 *
 * - **`role`** inserts a `user_roles` row with the service role, as an operator write.
 * - **`mustChangePassword`** sets the fence flag before anything else can happen, as the function
 *   does before it sends the email (S-410). Without it, the user is a dashboard-era invitee.
 *
 * `admin` must be the service-role client. The token is the one GoTrue would email; the function
 * sends a newer one through `inviteUserByEmail`, which kills this one (probe.md P2), so a suite
 * that needs the emailed link reads Mailpit instead.
 */
export async function createInvitedUser(
  admin: SupabaseClient,
  { role, mustChangePassword = false }: { role?: AppRole; mustChangePassword?: boolean } = {},
): Promise<InvitedUser> {
  const email = `invited-${randomUUID()}@example.test`;
  const { data, error } = await admin.auth.admin.generateLink({ type: "invite", email });
  if (error) throw new Error(`createInvitedUser: generateLink: ${error.message}`);
  const id = data.user.id;
  registerUser(id);
  if (role) await assignRole(admin, id, role);
  if (mustChangePassword) await markPending(admin, id);
  return { id, email, tokenHash: data.properties.hashed_token };
}

const assignRole = async (admin: SupabaseClient, userId: string, role: AppRole): Promise<void> => {
  const { error } = await admin.from("user_roles").insert({ user_id: userId, role });
  if (error) throw new Error(`createInvitedUser: assign role: ${error.message}`);
};

const markPending = async (admin: SupabaseClient, userId: string): Promise<void> => {
  const { error } = await admin.from("user_directory").update({ must_change_password: true }).eq("user_id", userId);
  if (error) throw new Error(`createInvitedUser: mark pending: ${error.message}`);
};
