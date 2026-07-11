import { defineDomainAction } from "@/shared/lib/actions";
import {
  applyGeneratedPlacements,
  applyGeneratedPlacementsInput,
  moveBundleMembers,
  moveBundleMembersInput,
  placeCourse,
  placeCourseInput,
  removeBundleMembers,
  removeBundleMembersInput,
  updatePlacementOptional,
  updatePlacementOptionalInput,
  updatePlacementWeek,
  updatePlacementWeekInput,
} from "./placements";

export const placementActions = {
  placeCourse: defineDomainAction({ input: placeCourseInput, run: placeCourse }),
  applyGeneratedPlacements: defineDomainAction({ input: applyGeneratedPlacementsInput, run: applyGeneratedPlacements }),
  moveBundleMembers: defineDomainAction({ input: moveBundleMembersInput, run: moveBundleMembers }),
  removeBundleMembers: defineDomainAction({ input: removeBundleMembersInput, run: removeBundleMembers }),
  updatePlacementWeek: defineDomainAction({ input: updatePlacementWeekInput, run: updatePlacementWeek }),
  updatePlacementOptional: defineDomainAction({ input: updatePlacementOptionalInput, run: updatePlacementOptional }),
};
