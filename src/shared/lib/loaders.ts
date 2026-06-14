import type { SupabaseClient } from "@/shared/api";
import { err, ok, type Result } from "./result";

/** A page-loader result: the loaded data, or "unavailable" when Supabase is not configured. */
export type LoaderResult<T> = Result<T, "unavailable">;

/** Run a page loader against the client, reporting unavailable when the client is null. */
export async function withSupabase<T>(
  client: SupabaseClient | null,
  fetch: (client: SupabaseClient) => Promise<T>,
): Promise<LoaderResult<T>> {
  if (!client) return err("unavailable");
  return ok(await fetch(client));
}
