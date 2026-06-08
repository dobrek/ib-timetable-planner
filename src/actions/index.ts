import { ActionError, defineAction, type ActionAPIContext } from "astro:actions";
import { createClient } from "@/lib/supabase";
import { DomainError } from "@/lib/errors";
import {
  courseInput,
  deleteCourseInput,
  deleteOverlapInput,
  dissolveMergeInput,
  mergeInput,
  overlapInput,
  updateCourseInput,
  updateMergeHoursInput,
} from "@/lib/schemas/course";
import { createCourse } from "@/lib/courses/createCourse";
import { updateCourse } from "@/lib/courses/updateCourse";
import { deleteCourse } from "@/lib/courses/deleteCourse";
import { createOverlap } from "@/lib/courses/createOverlap";
import { deleteOverlap } from "@/lib/courses/deleteOverlap";
import { createMerge } from "@/lib/courses/createMerge";
import { dissolveMerge } from "@/lib/courses/dissolveMerge";
import { updateMergeHours } from "@/lib/courses/updateMergeHours";

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

/**
 * Run a domain function and translate its framework-free `DomainError` into Astro's
 * `ActionError` (codes are a 1:1 subset). Non-domain throws propagate unchanged.
 */
async function runDomain<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DomainError) {
      throw new ActionError({ code: error.code, message: error.message });
    }
    throw error;
  }
}

// NOTE: Merge involvement does NOT gate the atomic-course mutations this slice. Both
// composite parents and their atomic children are freely editable (name, hours, teacher, …)
// via createCourse/updateCourse; the "Merged" badge is display-only. The merge-specific
// actions author/edit/dissolve the composite parent.

export const server = {
  createCourse: defineAction({
    input: courseInput,
    handler: (input, context) => {
      requireSession(context);
      const supabase = requireSupabase(context);
      return runDomain(() => createCourse(supabase, input));
    },
  }),

  updateCourse: defineAction({
    input: updateCourseInput,
    handler: (input, context) => {
      requireSession(context);
      const supabase = requireSupabase(context);
      return runDomain(() => updateCourse(supabase, input));
    },
  }),

  deleteCourse: defineAction({
    input: deleteCourseInput,
    handler: (input, context) => {
      requireSession(context);
      const supabase = requireSupabase(context);
      return runDomain(() => deleteCourse(supabase, input));
    },
  }),

  createOverlap: defineAction({
    input: overlapInput,
    handler: (input, context) => {
      requireSession(context);
      const supabase = requireSupabase(context);
      return runDomain(() => createOverlap(supabase, input));
    },
  }),

  deleteOverlap: defineAction({
    input: deleteOverlapInput,
    handler: (input, context) => {
      requireSession(context);
      const supabase = requireSupabase(context);
      return runDomain(() => deleteOverlap(supabase, input));
    },
  }),

  createMerge: defineAction({
    input: mergeInput,
    handler: (input, context) => {
      requireSession(context);
      const supabase = requireSupabase(context);
      return runDomain(() => createMerge(supabase, input));
    },
  }),

  dissolveMerge: defineAction({
    input: dissolveMergeInput,
    handler: (input, context) => {
      requireSession(context);
      const supabase = requireSupabase(context);
      return runDomain(() => dissolveMerge(supabase, input));
    },
  }),

  updateMergeHours: defineAction({
    input: updateMergeHoursInput,
    handler: (input, context) => {
      requireSession(context);
      const supabase = requireSupabase(context);
      return runDomain(() => updateMergeHours(supabase, input));
    },
  }),
};
