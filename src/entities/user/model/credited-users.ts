import type { Database } from "@/shared/api";
import type { CreditedUser } from "./credit";
import { profileLabel } from "./profile-label";

type Tables = Database["public"]["Tables"];

/** The two reads a credit needs, each a projection of its generated row. */
export type CreditedUsersInput = {
  directory: readonly Pick<Tables["user_directory"]["Row"], "user_id" | "email" | "is_service_account">[];
  profiles: readonly Pick<Tables["profiles"]["Row"], "user_id" | "display_name">[];
};

/**
 * The credited users by id: one per directory entry, named from its profile when it has one. A user
 * who never set a display name has no profile row, and is named by email alone. The input is never
 * mutated.
 */
export function buildCreditedUsers({ directory, profiles }: CreditedUsersInput): Map<string, CreditedUser> {
  const displayNames = new Map(profiles.map(({ user_id, display_name }) => [user_id, display_name]));
  return new Map(
    directory.map((entry) => [
      entry.user_id,
      {
        id: entry.user_id,
        label: profileLabel({ displayName: displayNames.get(entry.user_id) ?? null, email: entry.email ?? "" }),
        isServiceAccount: entry.is_service_account,
      },
    ]),
  );
}
