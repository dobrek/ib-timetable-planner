import { defineAction } from "astro:actions";
import { requireSession, requireSupabase, runDomain } from "@/shared/lib";
import {
  courseInput,
  deleteCourseInput,
  deleteOverlapInput,
  dissolveMergeInput,
  mergeInput,
  overlapInput,
  updateCourseInput,
  updateMergeHoursInput,
} from "@/entities/course";
import { createCourse } from "./createCourse";
import { updateCourse } from "./updateCourse";
import { deleteCourse } from "./deleteCourse";
import { createOverlap } from "./createOverlap";
import { deleteOverlap } from "./deleteOverlap";
import { createMerge } from "./createMerge";
import { dissolveMerge } from "./dissolveMerge";
import { updateMergeHours } from "./updateMergeHours";

// NOTE: Merge involvement does NOT gate the atomic-course mutations this slice. Both
// composite parents and their atomic children are freely editable (name, hours, teacher, …)
// via createCourse/updateCourse; the "Merged" badge is display-only. The merge-specific
// actions author/edit/dissolve the composite parent.

export const courseActions = {
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
