import { ActionError, defineAction, type ActionAPIContext } from "astro:actions";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { courseInput, overlapInput, updateCourseInput } from "@/lib/schemas/course";

/** PostgREST surfaces a Postgres unique-constraint violation with this SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

type Supabase = NonNullable<ReturnType<typeof createClient>>;

/**
 * Astro Actions POST to `/_actions/*`, which the middleware lists under PUBLIC_PREFIXES —
 * so the auth redirect does NOT gate them. Middleware still populates `locals.user` from
 * cookies on every request, so each handler must enforce the session itself.
 */
function requireSession(context: ActionAPIContext): void {
  if (!context.locals.user) {
    throw new ActionError({ code: "UNAUTHORIZED", message: "You must be signed in." });
  }
}

function requireSupabase(context: ActionAPIContext): Supabase {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "Supabase is not configured." });
  }
  return supabase;
}

const DUPLICATE_COURSE_MESSAGE = "A course with this name, level, and group already exists in this cohort.";

// NOTE: Merge involvement does NOT gate mutations this slice. Both composite parents and
// their atomic children are freely editable (name, hours, teacher, …); the "Merged" badge
// is display-only. Merge-specific edit/delete/overlap constraints are deferred to the
// merge-builder slice, where the hours/direction invariant gets settled.

export const server = {
  createCourse: defineAction({
    input: courseInput,
    handler: async (input, context) => {
      requireSession(context);
      const supabase = requireSupabase(context);

      const { data, error } = await supabase
        .from("courses")
        .insert({
          cohort_id: input.cohortId,
          teacher_id: input.teacherId,
          name: input.name,
          level: input.level,
          group_index: input.groupIndex,
          hours_per_week: input.hoursPerWeek,
        })
        .select()
        .single();

      if (error?.code === UNIQUE_VIOLATION) {
        throw new ActionError({ code: "CONFLICT", message: DUPLICATE_COURSE_MESSAGE });
      }
      if (error) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to create course: ${error.message}` });
      }
      return data;
    },
  }),

  updateCourse: defineAction({
    input: updateCourseInput,
    handler: async (input, context) => {
      requireSession(context);
      const supabase = requireSupabase(context);

      const { data, error } = await supabase
        .from("courses")
        .update({
          cohort_id: input.cohortId,
          teacher_id: input.teacherId,
          name: input.name,
          level: input.level,
          group_index: input.groupIndex,
          hours_per_week: input.hoursPerWeek,
        })
        .eq("id", input.id)
        .select()
        .single();

      if (error?.code === UNIQUE_VIOLATION) {
        throw new ActionError({ code: "CONFLICT", message: DUPLICATE_COURSE_MESSAGE });
      }
      if (error) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to update course: ${error.message}` });
      }
      return data;
    },
  }),

  deleteCourse: defineAction({
    input: z.object({ id: z.uuid() }),
    handler: async (input, context) => {
      requireSession(context);
      const supabase = requireSupabase(context);

      const { error } = await supabase.from("courses").delete().eq("id", input.id);
      if (error) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to delete course: ${error.message}` });
      }
      return { ok: true as const };
    },
  }),

  createOverlap: defineAction({
    input: overlapInput,
    handler: async (input, context) => {
      requireSession(context);
      const supabase = requireSupabase(context);

      // Both courses must belong to the same cohort — overlaps are within a school year.
      const { data: courses, error: lookupError } = await supabase
        .from("courses")
        .select("id, cohort_id")
        .in("id", [input.baseCourseId, input.dependentCourseId]);
      if (lookupError) {
        throw new ActionError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Course lookup failed: ${lookupError.message}`,
        });
      }
      if (courses.length !== 2) {
        throw new ActionError({ code: "NOT_FOUND", message: "One or both courses no longer exist." });
      }
      if (courses[0].cohort_id !== courses[1].cohort_id) {
        throw new ActionError({ code: "BAD_REQUEST", message: "Overlapping courses must be in the same cohort." });
      }

      const { data, error } = await supabase
        .from("course_overlaps")
        .insert({ base_course_id: input.baseCourseId, dependent_course_id: input.dependentCourseId })
        .select()
        .single();

      if (error?.code === UNIQUE_VIOLATION) {
        throw new ActionError({ code: "CONFLICT", message: "This overlap already exists." });
      }
      if (error) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to create overlap: ${error.message}` });
      }
      return data;
    },
  }),

  deleteOverlap: defineAction({
    input: z.object({ baseCourseId: z.uuid(), dependentCourseId: z.uuid() }),
    handler: async (input, context) => {
      requireSession(context);
      const supabase = requireSupabase(context);

      const { error } = await supabase
        .from("course_overlaps")
        .delete()
        .eq("base_course_id", input.baseCourseId)
        .eq("dependent_course_id", input.dependentCourseId);
      if (error) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to delete overlap: ${error.message}` });
      }
      return { ok: true as const };
    },
  }),
};
