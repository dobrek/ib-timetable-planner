import { defineDomainAction } from "@/shared/lib";
import { bundleSlotInput, deleteOverride, insertOverride, unbundleSlotInput } from "./slot-bundles";

// Action name = UI verb. Note the inverted DB op (see slot-bundles.ts): unbundleSlot
// inserts the override row, bundleSlot deletes it.
export const slotBundleActions = {
  unbundleSlot: defineDomainAction({ input: unbundleSlotInput, run: insertOverride }),
  bundleSlot: defineDomainAction({ input: bundleSlotInput, run: deleteOverride }),
};
