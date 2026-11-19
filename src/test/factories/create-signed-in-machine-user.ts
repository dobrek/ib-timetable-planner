import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@/shared/api";
import { createPublishableClient } from "@/test/publishable-client";
import type { MachineRole } from "@/test/role-matrix-expectations";
import { requireLoopbackUrl, requirePublishableKey } from "./local-sign-in";
import { strongPassword } from "./strong-password";
import { registerUser } from "./teardown";

export type SignedInMachineUser = {
  id: string;
  /** The access token the password grant minted: what the token hook wrote its role claim into. */
  accessToken: string;
  /** A publishable-key client holding the machine user's session: what the Worker or container holds. */
  client: SupabaseClient;
};

/**
 * Create a machine Auth user for `machineRole`, register it for teardown, and return a client signed
 * in as it with the publishable key, the way the solver container and the job-email cron sign in.
 *
 * - **`app_metadata.machine_role`** is set through the admin API, the only path that can write it,
 *   which is what lets the Custom Access Token Hook trust it.
 * - **A unique email per call,** so suites that each make one (the notifier's credential suite and
 *   its sweep suite) never collide when the lane runs them in parallel.
 * - **No `user_roles` row.** A machine user never holds a human role (S-403).
 * - **Loopback only,** like `createSignedInUser`: the user can sign in.
 */
export async function createSignedInMachineUser(
  admin: SupabaseClient,
  machineRole: MachineRole,
): Promise<SignedInMachineUser> {
  const url = requireLoopbackUrl("createSignedInMachineUser");
  const publishableKey = requirePublishableKey("createSignedInMachineUser");
  const email = `machine-${machineRole}-${randomUUID()}@example.test`;
  const password = strongPassword();

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { machine_role: machineRole },
  });
  if (created.error) throw new Error(`createSignedInMachineUser: createUser: ${created.error.message}`);
  const id = created.data.user.id;
  registerUser(id);

  const client = createPublishableClient(url, publishableKey);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`createSignedInMachineUser: password grant: ${signedIn.error.message}`);

  return { id, accessToken: signedIn.data.session.access_token, client };
}
