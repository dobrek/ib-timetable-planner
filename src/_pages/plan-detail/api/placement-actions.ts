import { defineDomainAction } from "@/shared/lib/actions";
import {
  moveBundleMembers,
  moveBundleMembersInput,
  placeCourse,
  placeCourseInput,
  removeBundleMembers,
  removeBundleMembersInput,
  updatePlacementWeek,
  updatePlacementWeekInput,
} from "./placements";

export const placementActions = {
  placeCourse: defineDomainAction({ input: placeCourseInput, run: placeCourse }),
  moveBundleMembers: defineDomainAction({ input: moveBundleMembersInput, run: moveBundleMembers }),
  removeBundleMembers: defineDomainAction({ input: removeBundleMembersInput, run: removeBundleMembers }),
  updatePlacementWeek: defineDomainAction({ input: updatePlacementWeekInput, run: updatePlacementWeek }),
};
