import { actions } from "astro:actions";
import { callAction } from "@/shared/lib/forms";
import type { BulkChoiceInput, DeleteStudentInput, StudentInput, UpdateStudentInput } from "../model/schemas";

/** Typed one-line wrappers over the generated action clients — the slice's api seam. */

export const createStudent = (values: StudentInput) => callAction(actions.createStudent, values);

export const updateStudent = (values: UpdateStudentInput) => callAction(actions.updateStudent, values);

export const deleteStudent = (values: DeleteStudentInput) => callAction(actions.deleteStudent, values);

export const bulkEditChoices = (values: BulkChoiceInput) => callAction(actions.bulkEditChoices, values);
