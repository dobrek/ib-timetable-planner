import { actions } from "astro:actions";
import type { ActionError, SafeResult } from "astro:actions";
import type {
  CourseInput,
  DeleteCourseInput,
  DeleteOverlapInput,
  DissolveMergeInput,
  MergeInput,
  OverlapInput,
  UpdateCourseInput,
  UpdateMergeHoursInput,
} from "@/_pages/courses/model/schemas";

type ActionResult<TInput extends Record<string, unknown>> = Promise<{
  error: ActionError<TInput> | undefined;
}>;

async function runAction<TInput extends Record<string, unknown>>(
  call: () => ReturnType<(typeof actions)[keyof typeof actions]>,
): ActionResult<TInput> {
  const result = (await call()) as SafeResult<TInput, unknown>;
  return { error: result.error };
}

export function createCourse(values: CourseInput): ActionResult<CourseInput> {
  return runAction<CourseInput>(() => actions.createCourse(values));
}

export function updateCourse(values: UpdateCourseInput): ActionResult<UpdateCourseInput> {
  return runAction<UpdateCourseInput>(() => actions.updateCourse(values));
}

export function deleteCourse(values: DeleteCourseInput): ActionResult<DeleteCourseInput> {
  return runAction<DeleteCourseInput>(() => actions.deleteCourse(values));
}

export function createOverlap(values: OverlapInput): ActionResult<OverlapInput> {
  return runAction<OverlapInput>(() => actions.createOverlap(values));
}

export function deleteOverlap(values: DeleteOverlapInput): ActionResult<DeleteOverlapInput> {
  return runAction<DeleteOverlapInput>(() => actions.deleteOverlap(values));
}

export function createMerge(values: MergeInput): ActionResult<MergeInput> {
  return runAction<MergeInput>(() => actions.createMerge(values));
}

export function updateMergeHours(values: UpdateMergeHoursInput): ActionResult<UpdateMergeHoursInput> {
  return runAction<UpdateMergeHoursInput>(() => actions.updateMergeHours(values));
}

export function dissolveMerge(values: DissolveMergeInput): ActionResult<DissolveMergeInput> {
  return runAction<DissolveMergeInput>(() => actions.dissolveMerge(values));
}
