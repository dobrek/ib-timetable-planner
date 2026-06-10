import { defineDomainAction } from "@/shared/lib";
import { createPlacementInput, deletePlacementInput, insertPlacement, removePlacement } from "./placements";

export { createPlacementInput, deletePlacementInput, insertPlacement, removePlacement } from "./placements";

export const placementActions = {
  createPlacement: defineDomainAction({ input: createPlacementInput, run: insertPlacement }),
  deletePlacement: defineDomainAction({ input: deletePlacementInput, run: removePlacement }),
};
