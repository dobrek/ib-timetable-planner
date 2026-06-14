import { defineDomainAction } from "@/shared/lib";
import { deleteTeacherInput, teacherInput, updateTeacherInput } from "../model/schemas";
import { availabilityActions } from "./availability-actions";
import { createTeacher } from "./create-teacher";
import { updateTeacher } from "./update-teacher";
import { deleteTeacher } from "./delete-teacher";

export const teacherActions = {
  createTeacher: defineDomainAction({ input: teacherInput, run: createTeacher }),
  updateTeacher: defineDomainAction({ input: updateTeacherInput, run: updateTeacher }),
  deleteTeacher: defineDomainAction({ input: deleteTeacherInput, run: deleteTeacher }),
  ...availabilityActions,
};
