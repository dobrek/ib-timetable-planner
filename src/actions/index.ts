import { courseActions } from "@/_pages/courses/api";
import { groupingActions, placementActions } from "@/_pages/plan-detail/api";

export const server = {
  ...courseActions,
  ...placementActions,
  ...groupingActions,
};
