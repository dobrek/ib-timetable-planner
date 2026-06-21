import { defineDomainAction } from "@/shared/lib/actions";
import {
  createPlacementInput,
  deletePlacementInput,
  insertPlacement,
  removePlacement,
  updatePlacementWeek,
  updatePlacementWeekInput,
} from "./placements";

export const placementActions = {
  createPlacement: defineDomainAction({ input: createPlacementInput, run: insertPlacement }),
  deletePlacement: defineDomainAction({ input: deletePlacementInput, run: removePlacement }),
  updatePlacementWeek: defineDomainAction({ input: updatePlacementWeekInput, run: updatePlacementWeek }),
};
