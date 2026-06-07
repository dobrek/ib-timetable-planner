import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { validatePlacementDelete, validatePlacementInsert } from "@/lib/placements/validate";

/** PostgREST surfaces a Postgres unique-constraint violation with this SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

/**
 * Per-row write path for placements. Every drop is a single course-hour, so there is
 * no bulk fan-out. Mirrors the auth/503/JSON-parse/typed-query/`json()` shape of
 * `src/pages/api/grouping.ts`; auth is handled by the deny-by-default middleware, so
 * no allowlist entry is needed. Compute-free, edge-safe on workerd.
 */
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return json({ error: "Supabase is not configured" }, 503);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }

  const validation = validatePlacementInsert(body);
  if (!validation.ok) return json({ error: validation.error }, 400);
  const { variantId, cohortId, courseId, day, period } = validation.row;

  try {
    const { data, error } = await supabase
      .from("placements")
      .insert({ variant_id: variantId, cohort_id: cohortId, course_id: courseId, day, period })
      .select()
      .single();

    // The same course-hour already sits in this cell (placements_unique). Idempotent
    // by intent: load and return the existing row so the client reconciles its optimistic
    // id against a placement that is in fact persisted — never a rollback, never a 500.
    if (error?.code === UNIQUE_VIOLATION) {
      const { data: existing, error: lookupError } = await supabase
        .from("placements")
        .select()
        .eq("variant_id", variantId)
        .eq("cohort_id", cohortId)
        .eq("course_id", courseId)
        .eq("day", day)
        .eq("period", period)
        .single();
      if (lookupError) throw new Error(`Failed to load existing placement: ${lookupError.message}`);
      return json({ placement: existing }, 200);
    }
    if (error) throw new Error(`Failed to insert placement: ${error.message}`);

    return json({ placement: data }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error inserting placement";
    return json({ error: message }, 500);
  }
};

/**
 * Remove a single placement row by id. "Move" is expressed client-side as
 * POST-new → DELETE-old (insert-before-delete), so no PATCH is needed.
 */
export const DELETE: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return json({ error: "Supabase is not configured" }, 503);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }

  const validation = validatePlacementDelete(body);
  if (!validation.ok) return json({ error: validation.error }, 400);

  try {
    const { error } = await supabase.from("placements").delete().eq("id", validation.id);
    if (error) throw new Error(`Failed to delete placement: ${error.message}`);
    return json({ id: validation.id }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error deleting placement";
    return json({ error: message }, 500);
  }
};

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
