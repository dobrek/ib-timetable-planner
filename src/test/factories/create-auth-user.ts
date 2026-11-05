import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@/shared/api";
import { registerUser } from "./teardown";

export type AuthUser = { id: string; email: string };

export type CreateAuthUserOptions = {
  password?: string;
  /** Admin-API-only metadata, e.g. `{ machine_role: "solver_job_writer" }` for a machine fixture. */
  appMetadata?: Record<string, unknown>;
};

/**
 * Create a confirmed Auth user, register it for teardown, and return its id. For a suite that needs
 * a user to own rows (a profile) without signing in as it: no password grant, so no cost against
 * GoTrue's sign-in rate limit.
 *
 * With no `password`, nobody can ever sign in as it. With one (S-402's reset suite), the user has a
 * password a reset can replace and a test can sign in with afterwards — still with no sign-in here.
 *
 * `appMetadata` makes a machine user (`machine_role`) or a flagged one (`service_account`), the
 * way an operator would through the Admin API. Without `password` such a user never signs in, so
 * the Custom Access Token Hook never sees it.
 *
 * `supabase` must be the service-role client; created through the admin API, never `signUp`.
 * Teardown deletes the user, and its profile and directory row with it (both cascade).
 */
export async function createAuthUser(
  supabase: SupabaseClient,
  { password, appMetadata }: CreateAuthUserOptions = {},
): Promise<AuthUser> {
  const email = `auth-user-${randomUUID()}@example.test`;
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: appMetadata,
  });
  if (error) throw new Error(`createAuthUser: ${error.message}`);
  registerUser(data.user.id);
  return { id: data.user.id, email };
}
