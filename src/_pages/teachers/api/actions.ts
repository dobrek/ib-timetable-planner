import { defineAction } from "astro:actions";
import { requireSession, requireSupabase, runDomain } from "@/shared/lib";
import { deleteTeacherInput, teacherInput, updateTeacherInput } from "../model/schemas";
import { createTeacher } from "./create-teacher";
import { updateTeacher } from "./update-teacher";
import { deleteTeacher } from "./delete-teacher";

export const teacherActions = {
  createTeacher: defineAction({
    input: teacherInput,
    handler: (input, context) => {
      requireSession(context);
      const supabase = requireSupabase(context);
      return runDomain(() => createTeacher(supabase, input));
    },
  }),

  updateTeacher: defineAction({
    input: updateTeacherInput,
    handler: (input, context) => {
      requireSession(context);
      const supabase = requireSupabase(context);
      return runDomain(() => updateTeacher(supabase, input));
    },
  }),

  deleteTeacher: defineAction({
    input: deleteTeacherInput,
    handler: (input, context) => {
      requireSession(context);
      const supabase = requireSupabase(context);
      return runDomain(() => deleteTeacher(supabase, input));
    },
  }),
};
