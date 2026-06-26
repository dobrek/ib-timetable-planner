import { defineDomainAction } from "@/shared/lib/actions";
import {
  deleteShelfBundle,
  deleteShelfBundleInput,
  shelveBundle,
  shelveBundleInput,
  unshelveBundle,
  unshelveBundleInput,
} from "./shelf";

export const shelfActions = {
  shelveBundle: defineDomainAction({ input: shelveBundleInput, run: shelveBundle }),
  unshelveBundle: defineDomainAction({ input: unshelveBundleInput, run: unshelveBundle }),
  deleteShelfBundle: defineDomainAction({ input: deleteShelfBundleInput, run: deleteShelfBundle }),
};
