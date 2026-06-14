import { actions } from "astro:actions";
import { callAction } from "@/shared/lib/forms";
import type {
  CourseInput,
  DeleteCourseInput,
  DeleteOverlapInput,
  DissolveMergeInput,
  MergeInput,
  OverlapInput,
  UpdateCourseInput,
  UpdateMergeHoursInput,
} from "../model/schemas";

/** Typed one-line wrappers over the generated action clients — the slice's api seam. */

export const createCourse = (values: CourseInput) => callAction(actions.createCourse, values);

export const updateCourse = (values: UpdateCourseInput) => callAction(actions.updateCourse, values);

export const deleteCourse = (values: DeleteCourseInput) => callAction(actions.deleteCourse, values);

export const createOverlap = (values: OverlapInput) => callAction(actions.createOverlap, values);

export const deleteOverlap = (values: DeleteOverlapInput) => callAction(actions.deleteOverlap, values);

export const createMerge = (values: MergeInput) => callAction(actions.createMerge, values);

export const updateMergeHours = (values: UpdateMergeHoursInput) => callAction(actions.updateMergeHours, values);

export const dissolveMerge = (values: DissolveMergeInput) => callAction(actions.dissolveMerge, values);
