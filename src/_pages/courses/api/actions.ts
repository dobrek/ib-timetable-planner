import { defineDomainAction } from "@/shared/lib";
import {
  courseInput,
  deleteCourseInput,
  deleteOverlapInput,
  dissolveMergeInput,
  mergeInput,
  overlapInput,
  updateCourseInput,
  updateMergeHoursInput,
} from "../model/schemas";
import { createCourse } from "./create-course";
import { updateCourse } from "./update-course";
import { deleteCourse } from "./delete-course";
import { createOverlap } from "./create-overlap";
import { deleteOverlap } from "./delete-overlap";
import { createMerge } from "./create-merge";
import { dissolveMerge } from "./dissolve-merge";
import { updateMergeHours } from "./update-merge-hours";

// NOTE: Merge involvement does NOT gate the atomic-course mutations this slice. Both
// composite parents and their atomic children are freely editable (name, hours, teacher, …)
// via createCourse/updateCourse; the "Merged" badge is display-only. The merge-specific
// actions author/edit/dissolve the composite parent.

export const courseActions = {
  createCourse: defineDomainAction({ input: courseInput, run: createCourse }),
  updateCourse: defineDomainAction({ input: updateCourseInput, run: updateCourse }),
  deleteCourse: defineDomainAction({ input: deleteCourseInput, run: deleteCourse }),
  createOverlap: defineDomainAction({ input: overlapInput, run: createOverlap }),
  deleteOverlap: defineDomainAction({ input: deleteOverlapInput, run: deleteOverlap }),
  createMerge: defineDomainAction({ input: mergeInput, run: createMerge }),
  dissolveMerge: defineDomainAction({ input: dissolveMergeInput, run: dissolveMerge }),
  updateMergeHours: defineDomainAction({ input: updateMergeHoursInput, run: updateMergeHours }),
};
