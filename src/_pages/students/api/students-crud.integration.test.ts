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
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("students CRUD (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;
  let cohortA: string | null = null;
  let cohortB: string | null = null;
  let coursesA: string[] = [];
  let coursesB: string[] = [];
  let createdStudentId: string | null = null;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

    const { data: cohorts } = await supabase.from("cohorts").select("id").order("name");
    cohortA = cohorts?.[0]?.id ?? null;
    cohortB = cohorts?.[1]?.id ?? null;

    const { data: merges } = await supabase.from("course_merges").select("parent_course_id");
    const parentIds = new Set((merges ?? []).map((m) => m.parent_course_id));
    const { data: courses } = await supabase.from("courses").select("id, cohort_id").order("name");
    const realInCohort = (cohortId: string | null) =>
      (courses ?? []).filter((c) => c.cohort_id === cohortId && !parentIds.has(c.id)).map((c) => c.id);
    coursesA = realInCohort(cohortA);
    coursesB = realInCohort(cohortB);
  });

  afterAll(async () => {
    if (createdStudentId) await supabase.from("students").delete().eq("id", createdStudentId);
  });

  const readChoices = async (studentId: string): Promise<string[]> => {
    const { data } = await supabase.from("student_choices").select("course_id").eq("student_id", studentId);
    return (data ?? []).map((c) => c.course_id).sort();
  };

  it("creates, reconciles choices across updates, changes cohort, and cascades on delete", async (ctx) => {
    if (!cohortA || !cohortB || coursesA.length < 4 || coursesB.length < 1) {
      ctx.skip();
      return;
    }
    const [a1, a2, a3, a4] = coursesA;
    const [b1] = coursesB;

    // Create with a choice set.
    const created = await createStudent(supabase, {
      fullName: "Integration Test Student",
      cohortId: cohortA,
      choiceCourseIds: [a1, a2, a3],
    });
    createdStudentId = created.id;
    expect(await readChoices(created.id)).toEqual([a1, a2, a3].sort());

    // Update replacing part of the set (drop a2, add a4) — diff path, unique constraint intact.
    await updateStudent(supabase, {
      id: created.id,
      fullName: "Integration Test Student",
      cohortId: cohortA,
      choiceCourseIds: [a1, a3, a4],
    });
    expect(await readChoices(created.id)).toEqual([a1, a3, a4].sort());

    // Cohort change: old-cohort choices are reconciled away, replaced by the new cohort's.
    await updateStudent(supabase, {
      id: created.id,
      fullName: "Integration Test Student",
      cohortId: cohortB,
      choiceCourseIds: [b1],
    });
    expect(await readChoices(created.id)).toEqual([b1]);

    // Authoritative guard: a cross-cohort choice id is rejected (cohort B student, cohort A course).
    await expect(
      updateStudent(supabase, {
        id: created.id,
        fullName: "Integration Test Student",
        cohortId: cohortB,
        choiceCourseIds: [a1],
      }),
    ).rejects.toBeInstanceOf(DomainError);
    // The rejected update left the prior state untouched.
    expect(await readChoices(created.id)).toEqual([b1]);

    // Delete cascades student_choices via the FK.
    await deleteStudent(supabase, { id: created.id });
    expect(await readChoices(created.id)).toEqual([]);
    const { data: gone } = await supabase.from("students").select("id").eq("id", created.id).maybeSingle();
    expect(gone).toBeNull();
    createdStudentId = null;
  });
});
