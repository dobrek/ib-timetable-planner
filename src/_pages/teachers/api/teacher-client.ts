import { actions } from "astro:actions";
import type { ActionError, SafeResult } from "astro:actions";
import type { DeleteTeacherInput, TeacherInput, UpdateTeacherInput } from "@/_pages/teachers/model/schemas";

type ActionResult<TInput extends Record<string, unknown>> = Promise<{
  error: ActionError<TInput> | undefined;
}>;

async function runAction<TInput extends Record<string, unknown>>(
  call: () => ReturnType<(typeof actions)[keyof typeof actions]>,
): ActionResult<TInput> {
  const result = (await call()) as SafeResult<TInput, unknown>;
  return { error: result.error };
}

export function createTeacher(values: TeacherInput): ActionResult<TeacherInput> {
  return runAction<TeacherInput>(() => actions.createTeacher(values));
}

export function updateTeacher(values: UpdateTeacherInput): ActionResult<UpdateTeacherInput> {
  return runAction<UpdateTeacherInput>(() => actions.updateTeacher(values));
}

export function deleteTeacher(values: DeleteTeacherInput): ActionResult<DeleteTeacherInput> {
  return runAction<DeleteTeacherInput>(() => actions.deleteTeacher(values));
}
