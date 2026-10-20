import type { SupabaseClient } from "@/shared/api";
import { type ResetReport, toResetReport } from "../model/reset-outcome";

/**
 * Ask GoTrue to email a password-reset link (`POST /recover`), and say what became of it.
 *
 * Meant for `createSessionlessClient()`: on the cookie-bound server client, `@supabase/ssr` forces
 * PKCE, and this call would write a code-verifier cookie and a `flow_state` row the emailed
 * `token_hash` link never uses. No `redirectTo`: the template builds its link from `{{ .SiteURL }}`.
 *
 * **Never throws.** It runs in `waitUntil` after the visitor already has their answer, so a
 * returned error, a thrown one and a network failure all resolve to a report that is only logged.
 */
export async function requestPasswordReset(client: SupabaseClient, email: string): Promise<ResetReport> {
  try {
    const { error } = await client.auth.resetPasswordForEmail(email);
    return toResetReport(error);
  } catch (thrown) {
    return toResetReport(thrown);
  }
}
