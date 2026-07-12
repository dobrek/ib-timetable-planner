import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { addStudentWithChoices, createPlan, seedPlanCatalog, teardown } from "@/test/factories";

// Bulk course-choice editing, driven against a factory-owned plan seeded with the
// real CSV catalog, using the service_role/secret client (bypasses RLS for setup +
// assertions). Two layers: the raw `bulk_edit_student_choices` RPC (SQL-level
// idempotence / scoping / atomicity), and — in Phase 2 — the `bulkEditChoices`
// domain fn (TS cohort gates). Plan-rooted isolation: owns its plan, tears it down.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("bulk_edit_student_choices RPC (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;
  let planId: string;
  let coursesDp1: string[] = [];

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

    planId = await createPlan(supabase);
    await seedPlanCatalog(supabase, planId);

    const { data: merges } = await supabase.from("course_merges").select("parent_course_id").eq("plan_id", planId);
    const parentIds = new Set((merges ?? []).map((m) => m.parent_course_id));
    const { data: courses } = await supabase.from("courses").select("id, cohort").eq("plan_id", planId).order("name");
    coursesDp1 = (courses ?? []).filter((c) => c.cohort === "dp1" && !parentIds.has(c.id)).map((c) => c.id);
  });

  afterAll(async () => {
    await teardown(supabase);
  });

  const readChoices = async (studentId: string): Promise<string[]> => {
    const { data } = await supabase.from("student_choices").select("course_id").eq("student_id", studentId);
    return (data ?? []).map((c) => c.course_id).sort();
  };

  const callRpc = (args: { students: string[]; add?: string[]; remove?: string[] }) =>
    supabase.rpc("bulk_edit_student_choices", {
      p_plan_id: planId,
      p_student_ids: args.students,
      p_add_course_ids: args.add ?? [],
      p_remove_course_ids: args.remove ?? [],
    });

  it("adds a course set idempotently across students, even when some already hold a choice", async () => {
    if (coursesDp1.length < 2) throw new Error("factory catalog is missing dp1 courses");
    const [a, b] = coursesDp1;

    // s1 already holds `a`; s2 holds neither. Adding [a, b] to both must be a no-op
    // on the pre-existing pair and skip conflicts without error.
    const { studentId: s1 } = await addStudentWithChoices(supabase, {
      planId,
      cohort: "dp1",
      fullName: "Bulk RPC S1",
      courseIds: [a],
    });
    const { studentId: s2 } = await addStudentWithChoices(supabase, {
      planId,
      cohort: "dp1",
      fullName: "Bulk RPC S2",
      courseIds: [],
    });

    const { error } = await callRpc({ students: [s1, s2], add: [a, b] });
    expect(error).toBeNull();
    expect(await readChoices(s1)).toEqual([a, b].sort());
    expect(await readChoices(s2)).toEqual([a, b].sort());

    // Re-running the same call is a visible no-op.
    const { error: rerun } = await callRpc({ students: [s1, s2], add: [a, b] });
    expect(rerun).toBeNull();
    expect(await readChoices(s1)).toEqual([a, b].sort());
  });

  it("removes only the listed (student, course) pairs", async () => {
    const [a, b, c] = coursesDp1;
    const { studentId: s1 } = await addStudentWithChoices(supabase, {
      planId,
      cohort: "dp1",
      fullName: "Bulk RPC Remove S1",
      courseIds: [a, b, c],
    });
    const { studentId: s2 } = await addStudentWithChoices(supabase, {
      planId,
      cohort: "dp1",
      fullName: "Bulk RPC Remove S2",
      courseIds: [a, b],
    });

    // Remove `b` from both; only that pair goes, and s2 (no c) is untouched by the c-less list.
    const { error } = await callRpc({ students: [s1, s2], remove: [b] });
    expect(error).toBeNull();
    expect(await readChoices(s1)).toEqual([a, c].sort());
    expect(await readChoices(s2)).toEqual([a]);
  });

  it("composes add + remove in one call", async () => {
    const [a, b, c] = coursesDp1;
    const { studentId: s1 } = await addStudentWithChoices(supabase, {
      planId,
      cohort: "dp1",
      fullName: "Bulk RPC AddRemove S1",
      courseIds: [a, b],
    });

    // Add c, remove b — the literal "add TOK1 / ensure no TOK2" shape.
    const { error } = await callRpc({ students: [s1], add: [c], remove: [b] });
    expect(error).toBeNull();
    expect(await readChoices(s1)).toEqual([a, c].sort());
  });

  it("rejects a cross-plan student id atomically, leaving no partial writes", async () => {
    const [a] = coursesDp1;
    const { studentId: valid } = await addStudentWithChoices(supabase, {
      planId,
      cohort: "dp1",
      fullName: "Bulk RPC Atomic Valid",
      courseIds: [],
    });

    // A student that lives in a *different* plan — the composite FK
    // (plan_id, student_id) -> students(plan_id, id) rejects it inside the txn.
    const otherPlan = await createPlan(supabase);
    const { studentId: crossPlan } = await addStudentWithChoices(supabase, {
      planId: otherPlan,
      cohort: "dp1",
      fullName: "Bulk RPC Atomic Cross-plan",
      courseIds: [],
    });

    const { error } = await callRpc({ students: [valid, crossPlan], add: [a] });
    expect(error).not.toBeNull();
    // The whole call aborted — the valid student did NOT gain `a`.
    expect(await readChoices(valid)).toEqual([]);
  });
});
