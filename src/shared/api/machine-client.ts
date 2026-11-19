import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { timeBoundedFetch } from "./time-bounded-fetch";

/**
 * A Supabase client for a MACHINE principal (S-310: the job-email cron's `job_notifier`): no cookies,
 * no request, and no `astro:env` import, because a cron has none of them. It takes the URL and the
 * publishable key as arguments; signing in, and deciding when to sign in again, stay with the caller.
 *
 * - `persistSession: false`: the session lives in this client's memory only, never in storage.
 * - `autoRefreshToken: false`: no background timer in a Worker isolate. The caller signs in again
 *   when the token nears expiry, one password grant at most per run.
 * - Every request is time-bounded, like the sessionless client's.
 *
 * It holds the publishable key and a machine password, never the secret key (CLAUDE.md, "the Worker
 * holds no secret key"); what the session can reach is decided by the machine role's grants and RLS.
 */
export function createMachineClient(url: string, key: string) {
  return createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: timeBoundedFetch },
  });
}
