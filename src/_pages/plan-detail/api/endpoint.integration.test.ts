import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCohortCourses, type Database } from "@/shared/api";
import {
  addStudentWithChoices,
  computeGroupingsFor,
  createPlan,
  seedPlanCatalog,
  teardown,
  type SeededCatalog,
} from "@/test/factories";
import { isGroupingStale } from "./staleness";

// Exercises the full compute path against a factory-owned plan seeded with the real
// CSV catalog, using the service_role/secret client (bypasses RLS for setup +
// assertions). The Astro Action couples to astro:env, so we drive the same domain
// function the handler runs (load → compute → hash → persist) rather than the HTTP
// layer. Plan-rooted isolation: this suite owns its plan and tears it down, so it
// depends on nothing already in the dev DB. Skips when the env/stack is unavailable.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COHORT = "dp2";
const HASH_RE = /^[0-9a-f]{64}$/;

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("computeGroupings action path (dp2)", () => {
  let supabase: SupabaseClient<Database>;
  let planId: string;
  let seededCatalog: SeededCatalog;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    planId = await createPlan(supabase);
    seededCatalog = await seedPlanCatalog(supabase, planId);
  });

  afterAll(async () => {
    await teardown(supabase);
  });

  it("computes, persists, and returns a ranked list + catalogHash", async () => {
    const response = await computeGroupingsFor(supabase, { planId, cohort: COHORT });

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

    // Staleness helper: freshly persisted → not stale (hash the catalog the loader already has).
    const { courses } = await loadCohortCourses(supabase, planId, COHORT);
    expect(await isGroupingStale(supabase, { planId, cohort: COHORT, catalog: courses })).toBe(false);

    // …and a catalog-affecting mutation flips it stale: add a student choosing an existing
    // dp2 course (grows that course's studentKeys → the catalog hash shifts). Re-load the
    // catalog so the detector hashes the post-mutation projection.
    const dp2CourseId = seededCatalog.courses.find((c) => c.cohort === COHORT)?.id;
    if (!dp2CourseId) throw new Error("seeded catalog should contain a dp2 course");
    await addStudentWithChoices(supabase, {
      planId,
      cohort: COHORT,
      fullName: `Staleness probe ${planId}`,
      courseIds: [dp2CourseId],
    });
    const { courses: mutatedCourses } = await loadCohortCourses(supabase, planId, COHORT);
    expect(await isGroupingStale(supabase, { planId, cohort: COHORT, catalog: mutatedCourses })).toBe(true);
  });
});

// dp1 carries the CAS↔EE overlap and both courses are bi-weekly, so the v1 opposite-week pass
// surfaces them as a placeable opposite-week (A/B) grouping. Verifies the marker round-trips
// compute → persist → read.
(hasEnv ? describe : describe.skip)("computeGroupings opposite-week pairs (dp1)", () => {
  let supabase: SupabaseClient<Database>;
  let planId: string;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    planId = await createPlan(supabase);
    await seedPlanCatalog(supabase, planId);
  });

  afterAll(async () => {
    await teardown(supabase);
  });

  it("emits an EE+CAS opposite-week grouping and persists opposite_week=true", async () => {
    const response = await computeGroupingsFor(supabase, { planId, cohort: "dp1" });

    // The compute result carries oppositeWeek variants whose members are an EE/CAS pair.
    const oppositeVariants = response.groupings.flatMap((r) => r.variants).filter((v) => v.oppositeWeek === true);
    expect(oppositeVariants.length).toBeGreaterThan(0);
    const eeCasPair = oppositeVariants.find((v) => {
      const names = v.memberIds.map((id) => response.courseDisplay.get(id)?.name ?? id);
      return names.some((n) => n.startsWith("EE")) && names.some((n) => n.startsWith("CAS"));
    });
    expect(eeCasPair, "an EE+CAS opposite-week pair should be emitted").toBeTruthy();

    // Persisted: at least one course_groupings row carries opposite_week=true.
    const { data: oppositeRows } = await supabase
      .from("course_groupings")
      .select("id, opposite_week")
      .eq("plan_id", planId)
      .eq("cohort", "dp1")
      .eq("opposite_week", true);
    expect((oppositeRows ?? []).length).toBeGreaterThan(0);

    // And a plain true-parallel grouping persists opposite_week=false (marker is per-row).
    const { data: parallelRows } = await supabase
      .from("course_groupings")
      .select("id")
      .eq("plan_id", planId)
      .eq("cohort", "dp1")
      .eq("opposite_week", false);
    expect((parallelRows ?? []).length).toBeGreaterThan(0);
  });
});
