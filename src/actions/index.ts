import { courseActions } from "@/_pages/courses/api";
import { groupingActions, placementActions } from "@/_pages/plan-detail/api";
import { teacherActions } from "@/_pages/teachers/api";

export const server = {
  ...courseActions,
  ...teacherActions,
  ...placementActions,
  ...groupingActions,
};
