import type { Database, SupabaseClient } from "@/shared/api";

export type AddStudentWithChoicesInput = {
  planId: string;
  cohort: Database["public"]["Enums"]["cohort"];
  fullName: string;
  /** Course ids this student picks; each becomes a `student_choices` row. */
  courseIds: string[];
};

/**
 * Insert a student plus their course choices (advanced input). Returns the new
 * student id. Choices are inserted only when `courseIds` is non-empty.
 */
export async function addStudentWithChoices(
  supabase: SupabaseClient,
  input: AddStudentWithChoicesInput,
): Promise<{ studentId: string }> {
  const { planId, cohort, fullName, courseIds } = input;

  const { data, error } = await supabase
    .from("students")
    .insert({ plan_id: planId, cohort, full_name: fullName })
    .select("id")
    .single();
  if (error) throw new Error(`addStudentWithChoices: student: ${error.message}`);

  if (courseIds.length > 0) {
    const choiceRows = courseIds.map((courseId) => ({ plan_id: planId, student_id: data.id, course_id: courseId }));
    const { error: choicesError } = await supabase.from("student_choices").insert(choiceRows);
    if (choicesError) throw new Error(`addStudentWithChoices: choices: ${choicesError.message}`);
  }

  return { studentId: data.id };
}
