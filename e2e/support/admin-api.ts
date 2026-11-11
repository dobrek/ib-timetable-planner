import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/shared/api/database.types";

/**
 * The service-role key in a spec, for the one sanctioned exception to "never touch users": a
 * throwaway user the spec creates and deletes in a `finally` (e2e/CLAUDE.md). Local stack only:
 * every entry point refuses a non-loopback `SUPABASE_URL` before a request is sent, so a spec can
 * never create users on hosted.
 */
export function adminClient() {
  return createClient<Database>(loopbackUrl(), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

/** `SUPABASE_URL`, refused unless it names the local stack. */
export function loopbackUrl(): string {
  const url = requiredEnv("SUPABASE_URL");
  const { hostname } = new URL(url);
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new Error(`refusing non-loopback SUPABASE_URL host "${hostname}": this spec creates users`);
  }
  return url;
}

/**
 * Delete a throwaway user by address, read as the service role: what a spec that made one through
 * the Users page (an account or an invitation) calls in its `finally`. A user it never created, or one
 * a revoke already deleted, is a no-op.
 */
export async function deleteUserByEmail(email: string): Promise<void> {
  const admin = adminClient();
  const { data } = await admin.from("user_directory").select("user_id").eq("email", email).maybeSingle();
  if (data) await admin.auth.admin.deleteUser(data.user_id);
}

// 40 characters, all four classes, no `#`, quotes or whitespace — like the integration lane's.
export const strongPassword = (): string => `${randomUUID()}Aa1!`;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Env first (CI), then `.env.test.local`. */
function requiredEnv(name: string): string {
  const value = process.env[name] ?? fromTestEnvFile(name);
  if (!value) throw new Error(`${name} is not set (export it, or add it to .env.test.local)`);
  return value;
}

// The same file and format `scripts/provision-e2e-author.mjs` falls back to.
function fromTestEnvFile(name: string): string | undefined {
  try {
    const line = readFileSync(resolve(process.cwd(), ".env.test.local"), "utf-8")
      .split("\n")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}
