import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { createPlan, teardown } from "@/test/factories";
import { createMerge } from "./create-merge";

// Proves the composite merge parent carries its teacher set in course_teachers (plan.md
// Phase 4 §3a) — without it the parent renders teacher-less on the board and loses
// double-booking + availability detection. Local-only (service_role); skips without env.

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

(hasEnv ? describe : describe.skip)("createMerge — composite parent teacher-set persistence", () => {
  it("persists a single-teacher merge parent's teacher in course_teachers", async () => {
    const planId = await createPlan(supabase, { name: "Merge Persist Single" });
    const t1 = await insertTeacher(planId, "MP1");
    const childA = await insertCourse(planId, "Physics", "AB");
    const childB = await insertCourse(planId, "Physics", "SL");
    await insertLinks(planId, [
      [childA, t1],
      [childB, t1],
    ]);

    const parent = await createMerge(supabase, {
      planId,
      childCourseIds: [childA, childB],
      hoursPerWeek: 4,
      cohort: "dp1",
    });

    expect(await teacherIdsFor(planId, parent.id)).toEqual([t1]);
  });

  it("persists the full co-taught teacher set on the merge parent", async () => {
    const planId = await createPlan(supabase, { name: "Merge Persist CoTaught" });
    const t1 = await insertTeacher(planId, "MP2");
    const t2 = await insertTeacher(planId, "MP3");
    const childA = await insertCourse(planId, "Chemistry", "AB");
    const childB = await insertCourse(planId, "Chemistry", "SL");
    await insertLinks(planId, [
      [childA, t1],
      [childA, t2],
      [childB, t1],
      [childB, t2],
    ]);

    const parent = await createMerge(supabase, {
      planId,
      childCourseIds: [childA, childB],
      hoursPerWeek: 4,
      cohort: "dp1",
    });

    expect(await teacherIdsFor(planId, parent.id)).toEqual([t1, t2].sort());
  });

  const insertTeacher = async (planId: string, code: string): Promise<string> => {
    const { data, error } = await supabase.from("teachers").insert({ plan_id: planId, code }).select("id").single();
    if (error) throw error;
    return data.id;
  };

  const insertCourse = async (planId: string, name: string, level: string): Promise<string> => {
    const { data, error } = await supabase
      .from("courses")
      .insert({ plan_id: planId, cohort: "dp1", name, level, group_index: 0, hours_per_week: 4 })
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

  const teacherIdsFor = async (planId: string, courseId: string): Promise<string[]> => {
    const { data, error } = await supabase
      .from("course_teachers")
      .select("teacher_id")
      .eq("plan_id", planId)
      .eq("course_id", courseId);
    if (error) throw error;
    return data.map((row) => row.teacher_id).sort();
  };
});
