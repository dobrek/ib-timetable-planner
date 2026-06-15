import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import {
  addMerge,
  addStudentWithChoices,
  createPlan,
  placeCourse,
  seedPlanCatalog,
  teardown,
  ungroupSlot,
} from "./index";

// Smoke test for the scenario-factory lifecycle (plan.md Phase 2 #2.3):
// createPlan + seedPlanCatalog build an owned, fully-cataloged plan, an output
// builder (placeCourse → real insertPlacement) writes a row, and teardown
// cascade-removes the plan and everything under it. Plan-rooted isolation means
// this suite depends on NOTHING already in the dev DB. Skips when env is absent.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("scenario-factory lifecycle (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;

  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  });

  afterAll(async () => {
    await teardown(supabase);
  });

  it("creates an owned, fully-cataloged plan, writes output, and tears it all down", async () => {
    const planId = await createPlan(supabase);
    const catalog = await seedPlanCatalog(supabase, planId);

    // The seeded catalog matches the CSV-derived seed (same transcode as gen-seed).
    // These counts are coupled to the data/dp1 + data/dp2 fixtures: a fixture change
    // shifts them (and the gen-seed stats) together — update both, deliberately.
    expect(catalog.teachers).toHaveLength(18);
    expect(catalog.courses.filter((c) => c.cohort === "dp1")).toHaveLength(39);
    expect(catalog.courses.filter((c) => c.cohort === "dp2")).toHaveLength(44);
    expect(catalog.students).toHaveLength(26 + 35);
    expect(catalog.student_choices.length).toBeGreaterThan(0);

    // Catalog rows are actually persisted under the owned plan.
    const { count: courseCount } = await supabase
      .from("courses")
      .select("*", { count: "exact", head: true })
      .eq("plan_id", planId);
    expect(courseCount).toBe(39 + 44);

    // Output builder: drive the real insertPlacement to write a placements row.
    const dp1Course = catalog.courses.find((c) => c.cohort === "dp1");
    if (!dp1Course) throw new Error("expected a dp1 course in the seeded catalog");
    const placement = await placeCourse(supabase, {
      planId,
      cohort: "dp1",
      courseId: dp1Course.id,
      day: 1,
      period: 1,
    });
    expect(placement.courseId).toBe(dp1Course.id);

    const { count: placementCount } = await supabase
      .from("placements")
      .select("*", { count: "exact", head: true })
      .eq("plan_id", planId);
    expect(placementCount).toBe(1);

    // Input builders: a merge (two dp1 courses), an ungrouped slot, and a student
    // with choices each write their own row under the owned plan.
    const dp1Courses = catalog.courses.filter((c) => c.cohort === "dp1");
    if (dp1Courses.length < 2) throw new Error("expected at least two dp1 courses in the seeded catalog");
    await addMerge(supabase, {
      planId,
      parentCourseId: dp1Courses[0].id,
      childCourseId: dp1Courses[1].id,
    });
    await ungroupSlot(supabase, { planId, cohort: "dp1", day: 2, period: 3 });
    const { studentId } = await addStudentWithChoices(supabase, {
      planId,
      cohort: "dp1",
      fullName: "Smoke Student",
      courseIds: [dp1Courses[0].id],
    });
    expect(studentId).toBeTruthy();

    const { count: mergeCount } = await supabase
      .from("course_merges")
      .select("*", { count: "exact", head: true })
      .eq("plan_id", planId)
      .eq("parent_course_id", dp1Courses[0].id)
      .eq("child_course_id", dp1Courses[1].id);
    expect(mergeCount).toBe(1);
    const { count: bundleCount } = await supabase
      .from("slot_bundles")
      .select("*", { count: "exact", head: true })
      .eq("plan_id", planId);
    expect(bundleCount).toBe(1);
    const { count: choiceForStudent } = await supabase
      .from("student_choices")
      .select("*", { count: "exact", head: true })
      .eq("student_id", studentId);
    expect(choiceForStudent).toBe(1);

    // Teardown cascades: the plan and everything under it (incl. the placement) go.
    await teardown(supabase);

    const { data: planGone } = await supabase.from("plans").select("id").eq("id", planId).maybeSingle();
    expect(planGone).toBeNull();
    const { count: orphanCourses } = await supabase
      .from("courses")
      .select("*", { count: "exact", head: true })
      .eq("plan_id", planId);
    expect(orphanCourses).toBe(0);
    const { count: orphanPlacements } = await supabase
      .from("placements")
      .select("*", { count: "exact", head: true })
      .eq("plan_id", planId);
    expect(orphanPlacements).toBe(0);
  });
});
