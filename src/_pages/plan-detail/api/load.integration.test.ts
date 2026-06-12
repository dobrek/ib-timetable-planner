import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { loadPlannerData } from "./load";

// Proves `loadPlannerData` ships the teacher/student name records the collision
// detail Dialog resolves ids through: every `teacherKey`/`studentKey` present in
// the returned validation catalog must be covered, and a teacher without a
// `full_name` must resolve to their `code` (the seed inserts teachers with code
// only). Local-only: connects with the service_role/secret key (bypasses RLS);
// skips cleanly when the env or stack is unavailable. Targets "Seed Plan A",
// whose dp1 cohort the board loads.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PLAN_NAME = "Seed Plan A";

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("loadPlannerData name records (dp1)", () => {
  let supabase: SupabaseClient<Database>;
  let planId: string | null = null;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

    const { data: plan, error } = await supabase.from("plans").select("id").eq("name", PLAN_NAME).limit(1).single();
    if (error) throw new Error(`Seed plan "${PLAN_NAME}" not found — re-run supabase db reset: ${error.message}`);
    planId = plan.id;
  });

  it("ships name records covering every teacher and student key in the catalog", async () => {
    if (!planId) throw new Error("beforeAll did not resolve the seed plan");

    const result = await loadPlannerData(supabase, planId);
    if (!result.ok) throw new Error(`loadPlannerData failed: ${JSON.stringify(result.error)}`);
    const { catalog, teacherNames, studentNames } = result.value.props;

    expect(catalog.length).toBeGreaterThan(0);
    expect(Object.keys(teacherNames).length).toBeGreaterThan(0);
    expect(Object.keys(studentNames).length).toBeGreaterThan(0);

    const uncoveredTeachers = catalog
      .map((course) => course.teacherKey)
      .filter((key) => key !== null && !(key in teacherNames));
    expect(uncoveredTeachers).toEqual([]);

    const uncoveredStudents = catalog.flatMap((course) => course.studentKeys).filter((key) => !(key in studentNames));
    expect(uncoveredStudents).toEqual([]);
  });

  it("resolves a teacher without full_name to their code", async () => {
    if (!planId) throw new Error("beforeAll did not resolve the seed plan");

    const result = await loadPlannerData(supabase, planId);
    if (!result.ok) throw new Error(`loadPlannerData failed: ${JSON.stringify(result.error)}`);
    const { teacherNames } = result.value.props;

    const { data: teachers, error } = await supabase
      .from("teachers")
      .select("id, code, full_name")
      .eq("plan_id", planId)
      .in("id", Object.keys(teacherNames));
    if (error) throw new Error(`Teacher lookup failed: ${error.message}`);

    const nameless = teachers.filter((teacher) => teacher.full_name === null);
    expect(nameless.length).toBeGreaterThan(0); // the seed inserts teachers with code only
    for (const teacher of nameless) expect(teacherNames[teacher.id]).toBe(teacher.code);
  });
});
