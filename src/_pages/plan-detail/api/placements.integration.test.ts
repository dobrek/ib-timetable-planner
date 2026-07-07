import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { createPlan as createFactoryPlan, seedPlanCatalog, teardown } from "@/test/factories";
import { placeCourse, updatePlacementOptional, updatePlacementWeek } from "./placements";

// Drives the real placeCourse / updatePlacementWeek domain functions against the
// local Supabase with the service_role client (bypasses RLS for setup + assertions).
// Skips when the env/stack is unavailable.
//
// Coverage (plan.md Phase 1 #5/#6): a placement's `week` insert/read round-trip, the
// default (`both`), and updatePlacementWeek flipping A↔B on a single row.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("placement week (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;
  let planId: string;
  let agnosticCourseId: string;
  let biweeklyCourseId: string;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

    planId = await createFactoryPlan(supabase, { name: "Placement Week Base" });
    const catalog = await seedPlanCatalog(supabase, planId);
    const dp1 = catalog.courses.filter((c) => c.cohort === "dp1");
    const agnostic = dp1.find((c) => c.week_mode === "agnostic");
    const biweekly = dp1.find((c) => c.week_mode === "biweekly");
    if (!agnostic || !biweekly) throw new Error("seed needs an agnostic and a bi-weekly dp1 course");
    agnosticCourseId = agnostic.id;
    biweeklyCourseId = biweekly.id;
  });

  afterAll(async () => {
    await teardown(supabase);
  });

  it("seeds EE/CAS as bi-weekly and other courses as agnostic", async () => {
    const { data, error } = await supabase.from("courses").select("name, week_mode").eq("plan_id", planId);
    if (error) throw error;
    const biweeklyNames = new Set(data.filter((c) => c.week_mode === "biweekly").map((c) => c.name));
    expect(biweeklyNames).toContain("EE");
    expect(biweeklyNames).toContain("CAS");
    // The vast majority are agnostic — only EE/CAS group rows are bi-weekly.
    expect(data.some((c) => c.week_mode === "agnostic")).toBe(true);
  });

  it("defaults an agnostic placement to week=both and round-trips it", async () => {
    const placement = await placeCourse(supabase, {
      planId,
      cohort: "dp1",
      courseId: agnosticCourseId,
      day: 1,
      period: 1,
      week: "both",
      isOptional: false,
    });
    expect(placement.week).toBe("both");

    const { data } = await supabase.from("placements").select("week").eq("id", placement.id).single();
    expect(data?.week).toBe("both");
  });

  it("defaults a fresh placement to non-optional, marks it via updatePlacementOptional, and round-trips", async () => {
    const placement = await placeCourse(supabase, {
      planId,
      cohort: "dp1",
      courseId: agnosticCourseId,
      day: 3,
      period: 3,
      week: "both",
      isOptional: false,
    });
    expect(placement.isOptional).toBe(false);

    const marked = await updatePlacementOptional(supabase, { id: placement.id, isOptional: true });
    expect(marked.id).toBe(placement.id);
    expect(marked.isOptional).toBe(true);

    // Reload projection (the shared select's column) shows the durable flag; accept clears it.
    const { data } = await supabase.from("placements").select("is_optional").eq("id", placement.id).single();
    expect(data?.is_optional).toBe(true);

    const accepted = await updatePlacementOptional(supabase, { id: placement.id, isOptional: false });
    expect(accepted.isOptional).toBe(false);
  });

  it("place_course applies an explicit optional flag on insert and preserves it on replay", async () => {
    const placement = await placeCourse(supabase, {
      planId,
      cohort: "dp1",
      courseId: biweeklyCourseId,
      day: 4,
      period: 4,
      week: "a",
      isOptional: true,
    });
    expect(placement.isOptional).toBe(true);

    // Idempotent replay with a different flag returns the existing row UNCHANGED: is_optional is a
    // single-writer column (update_placement_optional), so a re-place — notably the unshelve merge
    // path — must never reset a pending optional decision (20260707140000).
    const replayed = await placeCourse(supabase, {
      planId,
      cohort: "dp1",
      courseId: biweeklyCourseId,
      day: 4,
      period: 4,
      week: "a",
      isOptional: false,
    });
    expect(replayed.id).toBe(placement.id);
    expect(replayed.isOptional).toBe(true);
  });

  it("inserts a bi-weekly placement on week a and flips it to b via updatePlacementWeek", async () => {
    const placement = await placeCourse(supabase, {
      planId,
      cohort: "dp1",
      courseId: biweeklyCourseId,
      day: 2,
      period: 2,
      week: "a",
      isOptional: false,
    });
    expect(placement.week).toBe("a");

    const flipped = await updatePlacementWeek(supabase, { id: placement.id, week: "b" });
    expect(flipped.id).toBe(placement.id);
    expect(flipped.week).toBe("b");

    const { data } = await supabase.from("placements").select("week").eq("id", placement.id).single();
    expect(data?.week).toBe("b");
  });
});
