import { actions } from "astro:actions";
import { callAction } from "@/shared/lib/call-action";
import type { DeleteTeacherInput, TeacherInput, UpdateTeacherInput } from "../model/schemas";

/** Typed one-line wrappers over the generated action clients — the slice's api seam. */

export const createTeacher = (values: TeacherInput) => callAction(actions.createTeacher, values);

export const updateTeacher = (values: UpdateTeacherInput) => callAction(actions.updateTeacher, values);

export const deleteTeacher = (values: DeleteTeacherInput) => callAction(actions.deleteTeacher, values);
