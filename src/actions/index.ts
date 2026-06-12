import { courseActions } from "@/_pages/courses/api";
import { groupingActions, placementActions } from "@/_pages/plan-detail/api";
import { planActions } from "@/_pages/plans-list/api";
import { studentActions } from "@/_pages/students/api";
import { teacherActions } from "@/_pages/teachers/api";

export const server = {
  ...courseActions,
  ...teacherActions,
  ...studentActions,
  ...placementActions,
  ...groupingActions,
  ...planActions,
};
