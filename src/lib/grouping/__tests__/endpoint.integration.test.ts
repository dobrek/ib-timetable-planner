import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { loadCohortCourses } from "../adapters/supabase";
import { computeGroupings } from "@/entities/grouping";
import { computeCatalogHash, persistGroupings } from "../persist";
import { isGroupingStale } from "../staleness";

// Exercises the full compute path against the seeded dp2 catalog with the
// service_role/secret client (bypasses RLS for setup + assertions). The Astro
// route (src/pages/api/grouping.ts) couples to astro:env, so we drive the same
// composition the handler runs (load → compute → hash → persist) rather than the
// HTTP layer. Faithful end-to-end RLS coverage through the real middleware is
// deferred to the Module 3 testing work, per scope. Skips when the env/stack is
// unavailable.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COHORT_NAME = "Diploma Programme Year 2";
const HASH_RE = /^[0-9a-f]{64}$/;

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("compute endpoint path (dp2)", () => {
  let supabase: SupabaseClient<Database>;
  let planId: string | null = null;
  let cohortId: string | null = null;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

    const { data: cohort } = await supabase.from("cohorts").select("id").eq("name", COHORT_NAME).maybeSingle();
    cohortId = cohort?.id ?? null;
    const { data: plan } = await supabase.from("plans").select("id").limit(1).maybeSingle();
    planId = plan?.id ?? null;
  });

  it("computes, persists, and returns a ranked list + catalogHash", async (ctx) => {
    if (!planId || !cohortId) {
      ctx.skip();
      return;
    }

    // Mirror the handler composition.
    const { courses, names, warnings } = await loadCohortCourses(supabase, cohortId);
    const results = computeGroupings(courses);
    const catalogHash = await computeCatalogHash(courses);
    await persistGroupings(supabase, { planId, cohortId, catalogHash, results });
    const response = { groupings: results, names: Object.fromEntries(names), catalogHash, warnings };

    // Response shape: ranked, id-keyed, hashed.
    expect(response.catalogHash).toMatch(HASH_RE);
    expect(response.groupings.length).toBeGreaterThan(0);
    for (const result of response.groupings) {
      expect(typeof result.seedId).toBe("string");
      expect(Array.isArray(result.variants)).toBe(true);
    }
    const seeded = response.groupings.find((r) => r.variants.length > 0);
    expect(seeded, "at least one seed should produce variants").toBeTruthy();
    if (!seeded) return;
    // Variants within a result are ranked by score desc.
    const scores = seeded.variants.map((v) => v.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));

    // Persistence: deduped sets landed in both tables.
    const { count: groupingCount } = await supabase
      .from("course_groupings")
      .select("*", { count: "exact", head: true })
      .eq("plan_id", planId)
      .eq("cohort_id", cohortId);
    expect(groupingCount ?? 0).toBeGreaterThan(0);

    const { data: rows } = await supabase
      .from("course_groupings")
      .select("id, catalog_hash")
      .eq("plan_id", planId)
      .eq("cohort_id", cohortId);
    expect((rows ?? []).every((r) => r.catalog_hash === catalogHash)).toBe(true);

    // Count members via the FK relationship — a 491-element .in() filter would
    // overflow the request URL.
    const { count: memberCount } = await supabase
      .from("course_grouping_members")
      .select("grouping_id, course_groupings!inner(plan_id, cohort_id)", { count: "exact", head: true })
      .eq("course_groupings.plan_id", planId)
      .eq("course_groupings.cohort_id", cohortId);
    expect(memberCount ?? 0).toBeGreaterThan(0);

    // Staleness helper: freshly persisted → not stale.
    expect(await isGroupingStale(supabase, { planId, cohortId })).toBe(false);
  });
});
