import { ActionError, type ActionAPIContext } from "astro:actions";
import { createClient, type SupabaseClient } from "@/shared/api";

export function requireSupabase(context: ActionAPIContext): SupabaseClient {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "Supabase is not configured." });
  }
  return supabase;
}
