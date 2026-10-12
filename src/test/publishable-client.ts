import { createClient } from "@supabase/supabase-js";
import type { Database, SupabaseClient } from "@/shared/api";

/**
 * A client holding nothing but the stack's publishable key, with no session until the caller signs
 * in. `persistSession: false` gives each client its own in-memory session, so several principals in
 * one file never share one; the token outlives the lane, so none is refreshed.
 *
 * Test lane only, beside `publishable-key.ts`, which reads the key.
 */
export const createPublishableClient = (url: string, publishableKey: string): SupabaseClient =>
  createClient<Database>(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
