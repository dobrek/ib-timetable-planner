import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { computeAndPersistGroupings } from "./grouping-compute";
import { isGroupingStale } from "./staleness";

// Exercises the full compute path against the seeded dp2 catalog with the
// service_role/secret client (bypasses RLS for setup + assertions). The Astro
// Action couples to astro:env, so we drive the same domain function the handler
// runs (load → compute → hash → persist) rather than the HTTP layer. Faithful
// end-to-end RLS coverage through the real middleware is deferred to the Module 3
// testing work, per scope. Skips when the env/stack is unavailable.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PLAN_NAME = "Seed Plan A";
const COHORT = "dp2";
const HASH_RE = /^[0-9a-f]{64}$/;

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("computeGroupings action path (dp2)", () => {
  let supabase: SupabaseClient<Database>;
  let planId: string | null = null;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

    const { data: plan, error } = await supabase.from("plans").select("id").eq("name", PLAN_NAME).limit(1).single();
    if (error) throw new Error(`Seed plan "${PLAN_NAME}" not found — re-run supabase db reset: ${error.message}`);
    planId = plan.id;
  });

  it("computes, persists, and returns a ranked list + catalogHash", async () => {
    if (!planId) throw new Error("beforeAll did not resolve the seed plan");

    const response = await computeAndPersistGroupings(supabase, { planId, cohort: COHORT });

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
      .eq("cohort", COHORT);
    expect(groupingCount ?? 0).toBeGreaterThan(0);

    const { data: rows } = await supabase
      .from("course_groupings")
      .select("id, catalog_hash")
      .eq("plan_id", planId)
      .eq("cohort", COHORT);
    expect((rows ?? []).every((r) => r.catalog_hash === response.catalogHash)).toBe(true);

    // Count members via the FK relationship — a 491-element .in() filter would
    // overflow the request URL.
    const { count: memberCount } = await supabase
      .from("course_grouping_members")
      .select("grouping_id, course_groupings!inner(plan_id, cohort)", { count: "exact", head: true })
      .eq("course_groupings.plan_id", planId)
      .eq("course_groupings.cohort", COHORT);
    expect(memberCount ?? 0).toBeGreaterThan(0);

    // Staleness helper: freshly persisted → not stale.
    expect(await isGroupingStale(supabase, { planId, cohort: COHORT })).toBe(false);
  });
});
