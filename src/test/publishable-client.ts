import { createClient } from "@supabase/supabase-js";
import type { Database, SupabaseClient } from "@/shared/api";
import { readPublishableKey } from "./publishable-key";

/**
 * A client holding nothing but the stack's publishable key, with no session until the caller signs
 * in. `persistSession: false` gives each client its own in-memory session, so several principals in
 * one file never share one; the token outlives the lane, so none is refreshed.
 *
 * Test lane only, beside `publishable-key.ts`, which reads the key.
 */
export const createPublishableClient = (url: string, publishableKey: string): SupabaseClient =>
  createClient<Database>(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });

/** The same, for the local stack the lane runs against: a browser tab before anyone signs in. */
export const signedOutClient = (): SupabaseClient => {
  const url = process.env.SUPABASE_URL;
  const publishableKey = readPublishableKey();
  if (!url || !publishableKey) throw new Error("no local Supabase env");
  return createPublishableClient(url, publishableKey);
};
