import { defineDomainAction } from "@/shared/lib/actions";
import { computeAndPersistGroupings, computeGroupingsInput } from "./grouping-compute";

export const groupingActions = {
  computeGroupings: defineDomainAction({ input: computeGroupingsInput, run: computeAndPersistGroupings }),
};
