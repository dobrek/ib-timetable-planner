import { actions } from "astro:actions";
import { callAction } from "@/shared/lib/call-action";
import type { DeleteTeacherInput, TeacherInput, UpdateTeacherInput } from "../model/schemas";
import type {
  ClearAvailabilityCellInput,
  SetAvailabilityCellInput,
  SetAvailabilityColumnInput,
  SetAvailabilityRowInput,
} from "./teacher-availability";

/** Typed one-line wrappers over the generated action clients — the slice's api seam. */

export const createTeacher = (values: TeacherInput) => callAction(actions.createTeacher, values);

export const updateTeacher = (values: UpdateTeacherInput) => callAction(actions.updateTeacher, values);

export const deleteTeacher = (values: DeleteTeacherInput) => callAction(actions.deleteTeacher, values);

export const setAvailabilityCell = (values: SetAvailabilityCellInput) =>
  callAction(actions.setAvailabilityCell, values);

export const clearAvailabilityCell = (values: ClearAvailabilityCellInput) =>
  callAction(actions.clearAvailabilityCell, values);

export const setAvailabilityColumn = (values: SetAvailabilityColumnInput) =>
  callAction(actions.setAvailabilityColumn, values);

export const setAvailabilityRow = (values: SetAvailabilityRowInput) => callAction(actions.setAvailabilityRow, values);
