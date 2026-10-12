import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database, SupabaseClient } from "@/shared/api";
import { readPublishableKey } from "@/test/publishable-key";
import { registerUser } from "./teardown";

export type SignedInUser = {
  id: string;
  email: string;
  /** A publishable-key client holding this user's session: what a browser tab holds after sign-in. */
  client: SupabaseClient;
};

/**
 * Create a confirmed human Auth user, register it for teardown, and return a client signed in as
 * it with the publishable key. The access a test observes through `client` is exactly what RLS
 * and the grants give a signed-in human, which no service-role suite can see.
 *
 * - **Loopback only.** The users this creates can sign in, so it refuses any `SUPABASE_URL` that
 *   is not a local stack, before sending a request.
 * - **Created through the admin API, never `signUp`.** Sign-up is disabled and rate-limited;
 *   `createUser` with `email_confirm` is neither.
 * - **Never `app_metadata`.** The Custom Access Token Hook trusts only `app_metadata.machine_role`,
 *   so this user always signs in as plain `authenticated`.
 * - **Registered before sign-in,** so a failed sign-in does not leak the user.
 * - **The password** is 40 characters with all four character classes, so it meets any likely
 *   password policy, and it holds no `#`, quotes or whitespace (the README's dotenv rule).
 *
 * Extension point: S-403 adds a `role` option here once `user_roles` exists.
 */
export async function createSignedInUser(admin: SupabaseClient): Promise<SignedInUser> {
  const url = requireLoopbackUrl();
  const publishableKey = requirePublishableKey();
  const email = `signed-in-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(`createSignedInUser: createUser: ${created.error.message}`);
  const id = created.data.user.id;
  registerUser(id);

  // `persistSession: false` gives each client its own in-memory session, so several signed-in
  // clients in one file never share one. The token outlives the lane, so no refresh is needed.
  const client = createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`createSignedInUser: password grant: ${signedIn.error.message}`);

  return { id, email, client };
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const requireLoopbackUrl = (): string => {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error("createSignedInUser: SUPABASE_URL is not set");
  const { hostname } = new URL(url);
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new Error(`createSignedInUser: refusing non-loopback host "${hostname}" — signed-in users are local-only`);
  }
  return url;
};

const requirePublishableKey = (): string => {
  const key = readPublishableKey();
  if (!key) throw new Error("createSignedInUser: no publishable key (SUPABASE_KEY, .dev.vars or .env.local)");
  return key;
};
