import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import { createStudent } from "./create-student";
import { updateStudent } from "./update-student";
import { deleteStudent } from "./delete-student";

// Drives the students domain functions directly against the seeded local Supabase with the
// service_role/secret client (bypasses RLS for setup + assertions). The Astro Action couples
// to astro:env, so — like the plan-detail harness — we exercise the same domain functions the
// handler runs rather than the HTTP layer. Skips when the env/stack is unavailable.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Seed Plan B, deliberately: this suite mutates the plan's catalog (students +
// choices), while the plan-detail suites assert catalog-hash stability on Seed
// Plan A's dp2 cohort — sharing a plan makes parallel runs flaky.
const PLAN_NAME = "Seed Plan B";

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("students CRUD (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;
  let planId: string;
  let coursesDp1: string[] = [];
  let coursesDp2: string[] = [];
  let createdStudentId: string | null = null;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

    const { data: plan, error } = await supabase.from("plans").select("id").eq("name", PLAN_NAME).limit(1).single();
    if (error) throw new Error(`Seed plan "${PLAN_NAME}" not found — re-run supabase db reset: ${error.message}`);
    planId = plan.id;

    const { data: merges } = await supabase.from("course_merges").select("parent_course_id").eq("plan_id", planId);
    const parentIds = new Set((merges ?? []).map((m) => m.parent_course_id));
    const { data: courses } = await supabase.from("courses").select("id, cohort").eq("plan_id", planId).order("name");
    const realInCohort = (cohort: "dp1" | "dp2") =>
      (courses ?? []).filter((c) => c.cohort === cohort && !parentIds.has(c.id)).map((c) => c.id);
    coursesDp1 = realInCohort("dp1");
    coursesDp2 = realInCohort("dp2");
  });

  afterAll(async () => {
    if (createdStudentId) await supabase.from("students").delete().eq("id", createdStudentId);
  });

  const readChoices = async (studentId: string): Promise<string[]> => {
    const { data } = await supabase.from("student_choices").select("course_id").eq("student_id", studentId);
    return (data ?? []).map((c) => c.course_id).sort();
  };

  it("creates, reconciles choices across updates, changes cohort, and cascades on delete", async () => {
    if (coursesDp1.length < 4 || coursesDp2.length < 1) {
      throw new Error("Seed plan is missing courses — re-run supabase db reset");
    }
    const [a1, a2, a3, a4] = coursesDp1;
    const [b1] = coursesDp2;

    // Create with a choice set.
    const created = await createStudent(supabase, {
      planId,
      fullName: "Integration Test Student",
      cohort: "dp1",
      choiceCourseIds: [a1, a2, a3],
    });
    createdStudentId = created.id;
    expect(await readChoices(created.id)).toEqual([a1, a2, a3].sort());

    // Update replacing part of the set (drop a2, add a4) — diff path, unique constraint intact.
    await updateStudent(supabase, {
      id: created.id,
      planId,
      fullName: "Integration Test Student",
      cohort: "dp1",
      choiceCourseIds: [a1, a3, a4],
    });
    expect(await readChoices(created.id)).toEqual([a1, a3, a4].sort());

    // Cohort change: old-cohort choices are reconciled away, replaced by the new cohort's.
    await updateStudent(supabase, {
      id: created.id,
      planId,
      fullName: "Integration Test Student",
      cohort: "dp2",
      choiceCourseIds: [b1],
    });
    expect(await readChoices(created.id)).toEqual([b1]);

    // Authoritative guard: a cross-cohort choice id is rejected (dp2 student, dp1 course).
    await expect(
      updateStudent(supabase, {
        id: created.id,
        planId,
        fullName: "Integration Test Student",
        cohort: "dp2",
        choiceCourseIds: [a1],
      }),
    ).rejects.toBeInstanceOf(DomainError);
    // The rejected update left the prior state untouched.
    expect(await readChoices(created.id)).toEqual([b1]);

    // Delete cascades student_choices via the FK.
    await deleteStudent(supabase, { planId, id: created.id });
    expect(await readChoices(created.id)).toEqual([]);
    const { data: gone } = await supabase.from("students").select("id").eq("id", created.id).maybeSingle();
    expect(gone).toBeNull();
    createdStudentId = null;
  });
});
