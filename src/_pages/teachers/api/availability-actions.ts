import { defineDomainAction } from "@/shared/lib";
import {
  clearAvailabilityCellInput,
  clearCell,
  setAvailabilityCellInput,
  setAvailabilityColumnInput,
  setAvailabilityRowInput,
  setCell,
  setColumn,
  setRow,
} from "./teacher-availability";

/** The teacher-availability mutations, grouped for spreading into `teacherActions`. */
export const availabilityActions = {
  setAvailabilityCell: defineDomainAction({ input: setAvailabilityCellInput, run: setCell }),
  clearAvailabilityCell: defineDomainAction({ input: clearAvailabilityCellInput, run: clearCell }),
  setAvailabilityColumn: defineDomainAction({ input: setAvailabilityColumnInput, run: setColumn }),
  setAvailabilityRow: defineDomainAction({ input: setAvailabilityRowInput, run: setRow }),
};
