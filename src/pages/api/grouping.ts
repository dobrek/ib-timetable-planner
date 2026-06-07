import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { loadCohortCourses } from "@/lib/grouping/adapters/supabase";
import { computeGroupings, EnumerationCapError } from "@/lib/grouping";
import { computeCatalogHash, persistGroupings } from "@/lib/grouping/persist";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One-shot, request-scoped compute: load the cohort's catalog → enumerate groupings
 * → hash the catalog → persist (atomic replace) → return the ranked list. Compute
 * runs here in handler scope, never at module load (workerd may freeze Math.random
 * globally and there is no request context at init). Auto-protected by the
 * deny-by-default middleware — no allowlist entry, so unauthenticated requests are
 * redirected to sign-in before reaching this handler.
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

  const planId = isRecord(body) ? body.planId : undefined;
  const cohortId = isRecord(body) ? body.cohortId : undefined;
  if (typeof planId !== "string" || typeof cohortId !== "string" || !UUID_RE.test(planId) || !UUID_RE.test(cohortId)) {
    return json({ error: "planId and cohortId are required and must be UUIDs" }, 400);
  }

  try {
    const [planResult, cohortResult] = await Promise.all([
      supabase.from("plans").select("id").eq("id", planId).maybeSingle(),
      supabase.from("cohorts").select("id").eq("id", cohortId).maybeSingle(),
    ]);
    if (planResult.error) throw new Error(`Plan lookup failed: ${planResult.error.message}`);
    if (cohortResult.error) throw new Error(`Cohort lookup failed: ${cohortResult.error.message}`);
    if (!planResult.data) return json({ error: `Plan ${planId} not found` }, 404);
    if (!cohortResult.data) return json({ error: `Cohort ${cohortId} not found` }, 404);

    const { courses, names, warnings } = await loadCohortCourses(supabase, cohortId);

    let results;
    try {
      results = computeGroupings(courses);
    } catch (err) {
      if (err instanceof EnumerationCapError) {
        return json({ error: err.message }, 422);
      }
      throw err;
    }

    const catalogHash = await computeCatalogHash(courses);
    await persistGroupings(supabase, { planId, cohortId, catalogHash, results });

    return json({ groupings: results, names: Object.fromEntries(names), catalogHash, warnings }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error computing groupings";
    return json({ error: message }, 500);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
