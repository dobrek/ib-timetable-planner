import type { WeakPassword } from "@supabase/supabase-js";

/**
 * Where a successful sign-in lands. GoTrue enforces the 15-character floor only when a password is
 * set, so an older, shorter one still signs in; it says so in `weakPassword`, and the dashboard
 * turns that into a nudge.
 */
export function postSignInPath({ weakPassword }: { weakPassword?: WeakPassword }): string {
  return weakPassword ? "/dashboard?notice=weak-password" : "/dashboard";
}
