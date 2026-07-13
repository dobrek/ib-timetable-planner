import type { SupabaseClient } from "@/shared/api";
import { buildPlanRows, loadCohortFixtures, type PlanCatalogRows } from "../../../scripts/lib/catalog-transcode.mjs";

/** The inserted catalog, rebound to the owned plan — returned for assertions. */
export type SeededCatalog = PlanCatalogRows;

// The CSV fixtures are immutable, so load + validate them once per test-file
// process (Vitest isolates modules per file). This dedupes the back-fill warnings
// and avoids re-reading the CSVs on every seedPlanCatalog call.
let cachedFixtures: ReturnType<typeof loadCohortFixtures> | null = null;
const getFixtures = (): ReturnType<typeof loadCohortFixtures> => (cachedFixtures ??= loadCohortFixtures());

/**
 * Insert the full CSV-derived catalog (both cohorts: teachers, courses, overlaps,
 * merges, students, choices) for an already-created plan, by consuming the SAME
 * shared transcode `gen-seed.mjs` uses — not a re-implementation. The transcode's
 * ID-assigned, FK-remapped rows are rebound to the owned `planId` (every table
 * cascades from `plans.id`, so a uniform `plan_id` swap keeps all composite FKs
 * consistent). Returns the inserted rows so suites can look up ids by name/code.
 */
export async function seedPlanCatalog(supabase: SupabaseClient, planId: string): Promise<SeededCatalog> {
  const { dp1Data, dp2Data, fixtures } = getFixtures();
  // Scope the generated ids by the OWNED plan id, not by the plan name. Row ids are content-addressed
  // (seed-id.mjs), so identical inputs mint identical ids by design — every factory plan would
  // otherwise reuse one set of teacher/course/student ids and the second one to be seeded inside the
  // same database would collide on `teachers_pkey`. `planId` is unique per plan, so scoping by it
  // keeps ids unique across plans while staying deterministic within one.
  const { rows } = buildPlanRows("(factory)", dp1Data, dp2Data, fixtures, planId);

  const rebind = <T extends { plan_id: string }>(arr: readonly T[]): T[] => arr.map((r) => ({ ...r, plan_id: planId }));

  const teachers = rebind(rows.teachers);
  const courses = rebind(rows.courses);
  const course_overlaps = rebind(rows.course_overlaps);
  const course_merges = rebind(rows.course_merges);
  const course_teachers = rebind(rows.course_teachers);
  const students = rebind(rows.students);
  const student_choices = rebind(rows.student_choices);

  // FK-respecting order; the plan row already exists (createPlan made it).
  if (teachers.length) throwOn("teachers", (await supabase.from("teachers").insert(teachers)).error);
  if (courses.length) throwOn("courses", (await supabase.from("courses").insert(courses)).error);
  // course_teachers composite-FKs both courses and teachers — insert after both exist.
  if (course_teachers.length)
    throwOn("course_teachers", (await supabase.from("course_teachers").insert(course_teachers)).error);
  if (course_overlaps.length)
    throwOn("course_overlaps", (await supabase.from("course_overlaps").insert(course_overlaps)).error);
  if (course_merges.length)
    throwOn("course_merges", (await supabase.from("course_merges").insert(course_merges)).error);
  if (students.length) throwOn("students", (await supabase.from("students").insert(students)).error);
  if (student_choices.length)
    throwOn("student_choices", (await supabase.from("student_choices").insert(student_choices)).error);

  // The plans row's identity is `id` (not a denormalized plan_id) — rebind to the owned plan.
  const plans = rows.plans.map((p) => ({ ...p, id: planId }));
  return { plans, teachers, courses, course_overlaps, course_merges, course_teachers, students, student_choices };
}

function throwOn(table: string, error: { message: string } | null): void {
  if (error) throw new Error(`seedPlanCatalog: ${table}: ${error.message}`);
}
