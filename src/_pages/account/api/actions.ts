import { defineDomainAction } from "@/shared/lib/actions";
import { updateDisplayNameInput, updatePasswordInput } from "../model/schemas";
import { updateDisplayName } from "./update-display-name";
import { updatePassword } from "./update-password";

export const accountActions = {
  updatePassword: defineDomainAction({ input: updatePasswordInput, run: updatePassword }),
  updateDisplayName: defineDomainAction({ input: updateDisplayNameInput, run: updateDisplayName }),
};
