import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { createPlan, seedPlanCatalog, teardown } from "@/test/factories";
import { deleteTeacher } from "./delete-teacher";
import { loadTeacherCatalog } from "./loader";

// Local-only (service_role/secret key, bypasses RLS); skips when the env/stack is absent.
// Owns factory-seeded / bare plans and tears them all down once at the end.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

let supabase: SupabaseClient<Database>;

beforeAll(() => {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
});

afterAll(async () => {
  await teardown(supabase);
});

(hasEnv ? describe : describe.skip)("loadTeacherCatalog — assignments from the junction", () => {
  it("lists each teacher's assigned courses sourced from course_teachers (co-taught course shared by both)", async () => {
    const planId = await createPlan(supabase, { name: "Teacher Assignments" });
    await seedPlanCatalog(supabase, planId);

    const result = await loadTeacherCatalog(supabase, planId);
    if (!result.ok) throw new Error(`loadTeacherCatalog failed: ${JSON.stringify(result.error)}`);

    // Oracle: the junction itself. Each teacher's assignment id-set must equal its links.
    const { data: junction } = await supabase
      .from("course_teachers")
      .select("teacher_id, course_id")
      .eq("plan_id", planId);
    const expected = new Map<string, Set<string>>();
    for (const link of junction ?? []) {
      const set = expected.get(link.teacher_id);
      if (set) set.add(link.course_id);
      else expected.set(link.teacher_id, new Set([link.course_id]));
    }

    for (const teacher of result.value.teachers) {
      const got = new Set(teacher.assignments.map((a) => a.id));
      expect(got).toEqual(expected.get(teacher.id) ?? new Set<string>());
    }

    // The seed has at least one genuinely co-taught course (a course id shared by ≥2 teachers).
    const courseTeacherCount = new Map<string, number>();
    for (const link of junction ?? [])
      courseTeacherCount.set(link.course_id, (courseTeacherCount.get(link.course_id) ?? 0) + 1);
    const coTaught = [...courseTeacherCount.values()].some((count) => count >= 2);
    expect(coTaught).toBe(true);
  });
});

(hasEnv ? describe : describe.skip)("deleteTeacher — ≥1-teacher guard", () => {
  it("blocks deleting the sole teacher of a course; allows deleting a co-teacher", async () => {
    const planId = await createPlan(supabase, { name: "Delete Guard" });
    const t1 = await insertTeacher(planId, "G1");
    const t2 = await insertTeacher(planId, "G2");
    const sole = await insertCourse(planId, "Solo Course");
    const shared = await insertCourse(planId, "Shared Course");
    await insertLinks(planId, [
      [sole, t1],
      [shared, t1],
      [shared, t2],
    ]);

    // t1 is the sole teacher of "Solo Course" → blocked, and t1 survives.
    await expect(deleteTeacher(supabase, { planId, id: t1 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await teacherExists(t1)).toBe(true);

    // t2 is only ever a co-teacher (never sole) → allowed; its link drops, t1 remains on shared.
    await deleteTeacher(supabase, { planId, id: t2 });
    expect(await teacherExists(t2)).toBe(false);
    const { data: sharedLinks } = await supabase
      .from("course_teachers")
      .select("teacher_id")
      .eq("plan_id", planId)
      .eq("course_id", shared);
    expect((sharedLinks ?? []).map((l) => l.teacher_id)).toEqual([t1]);
  });

  const insertTeacher = async (planId: string, code: string): Promise<string> => {
    const { data, error } = await supabase.from("teachers").insert({ plan_id: planId, code }).select("id").single();
    if (error) throw error;
    return data.id;
  };

  const insertCourse = async (planId: string, name: string): Promise<string> => {
    const { data, error } = await supabase
      .from("courses")
      .insert({ plan_id: planId, cohort: "dp1", name, level: "none", group_index: 0, hours_per_week: 4 })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  };

  const insertLinks = async (planId: string, pairs: [course: string, teacher: string][]): Promise<void> => {
    const { error } = await supabase
      .from("course_teachers")
      .insert(pairs.map(([course_id, teacher_id]) => ({ plan_id: planId, course_id, teacher_id })));
    if (error) throw error;
  };

  const teacherExists = async (id: string): Promise<boolean> => {
    const { data } = await supabase.from("teachers").select("id").eq("id", id).maybeSingle();
    return data !== null;
  };
});
