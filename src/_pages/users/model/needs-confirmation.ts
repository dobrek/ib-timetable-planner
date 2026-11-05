import type { AppRole } from "@/shared/config";

/** Why a role change asks first: it is the admin's own role, or it takes someone's access away. */
export type ConfirmationReason = "self" | "remove";

/**
 * The confirmation a role change needs before it saves, if any. Changing your own role costs you
 * admin access, or all access, so it always asks; choosing No access for anyone else asks too.
 * "self" wins when both hold.
 */
export const needsConfirmation = ({
  targetIsSelf,
  newRole,
}: {
  targetIsSelf: boolean;
  newRole: AppRole | null;
}): ConfirmationReason | null => {
  if (targetIsSelf) return "self";
  if (newRole === null) return "remove";
  return null;
};
