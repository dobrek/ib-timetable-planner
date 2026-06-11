import { defineDomainAction } from "@/shared/lib";
import { deleteStudentInput, studentInput, updateStudentInput } from "../model/schemas";
import { createStudent } from "./create-student";
import { updateStudent } from "./update-student";
import { deleteStudent } from "./delete-student";

export const studentActions = {
  createStudent: defineDomainAction({ input: studentInput, run: createStudent }),
  updateStudent: defineDomainAction({ input: updateStudentInput, run: updateStudent }),
  deleteStudent: defineDomainAction({ input: deleteStudentInput, run: deleteStudent }),
};
