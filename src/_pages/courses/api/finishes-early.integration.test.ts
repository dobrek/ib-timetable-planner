import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { createPlan, registerPlan, seedPlanCatalog, teardown } from "@/test/factories";
import { createCourse } from "./create-course";
import { updateCourse } from "./update-course";
import { loadCatalog } from "./loader";

// `finishes_early` persistence across the DB/actions/SSR seams that pass type-check + unit
// tests but can only break end-to-end (per lessons.md — catalog CRUD integration belongs in
// the harness, not manual sign-off):
//   1. round-trip — create a flagged course through the real createCourse path, read it back
//      via the catalog loader, then updateCourse it off and confirm the clear persists;
//   2. clone carry — clone_plan preserves the flag (the explicit-column-list silent-drop guard).
// Drives the local Supabase with the service_role client; skips when the stack is unavailable.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("finishes_early persistence (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;

  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  });

  afterAll(async () => {
    await teardown(supabase);
  });

  const readFlag = async (planId: string, courseId: string): Promise<boolean | undefined> => {
    const catalog = await loadCatalog(supabase, planId);
    if (!catalog.ok) throw new Error("catalog unavailable");
    return catalog.value.courses.find((c) => c.id === courseId)?.finishesEarly;
  };

  it("round-trips the flag through create → read → update (real actions path)", async () => {
    const planId = await createPlan(supabase, { name: "Finishes Early Round-Trip" });
    const catalog = await seedPlanCatalog(supabase, planId);
    const teacherId = catalog.teachers[0]?.id;
    if (!teacherId) throw new Error("seeded catalog has no teacher");

    // Create a flagged course through the real domain function (mirrors the action gate).
    const created = await createCourse(supabase, {
      planId,
      name: "Early Finish Elective",
      level: "SL",
      groupIndex: 3,
      hoursPerWeek: 2,
      cohort: "dp2",
      weekMode: "agnostic",
      color: null,
      finishesEarly: true,
      teacherIds: [teacherId],
    });

    // Read path: CourseRow.finishesEarly pre-fills the editor switch.
    expect(await readFlag(planId, created.id)).toBe(true);

    // Update path: clear the flag and confirm it persists off.
    await updateCourse(supabase, {
      id: created.id,
      planId,
      name: "Early Finish Elective",
      level: "SL",
      groupIndex: 3,
      hoursPerWeek: 2,
      cohort: "dp2",
      weekMode: "agnostic",
      color: null,
      finishesEarly: false,
      teacherIds: [teacherId],
    });
    expect(await readFlag(planId, created.id)).toBe(false);
  });

  it("carries the flag through clone_plan (silent-drop guard)", async () => {
    const planId = await createPlan(supabase, { name: "Finishes Early Clone Source" });
    await seedPlanCatalog(supabase, planId);

    // Flag exactly one seeded course.
    const { data: courses } = await supabase.from("courses").select("id").eq("plan_id", planId).limit(1);
    const courseId = courses?.[0]?.id;
    if (!courseId) throw new Error("seed has no courses");
    await supabase.from("courses").update({ finishes_early: true }).eq("id", courseId);

    const { data: cloneId, error } = await supabase.rpc("clone_plan", {
      p_source_plan_id: planId,
      p_name: "Finishes Early Clone Dest",
    });
    if (error) throw error;
    registerPlan(cloneId);

    const countFlagged = async (plan: string): Promise<number> => {
      const { count, error: countError } = await supabase
        .from("courses")
        .select("*", { count: "exact", head: true })
        .eq("plan_id", plan)
        .eq("finishes_early", true);
      if (countError) throw countError;
      return count ?? 0;
    };
    // The source has exactly one flagged course; the clone must too — a dropped column reads 0.
    expect(await countFlagged(planId)).toBe(1);
    expect(await countFlagged(cloneId)).toBe(1);
  });
});
