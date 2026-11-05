import { Constants, type Database } from "@/shared/api/database.types";

/**
 * A human's one role, as an admin assigns it (S-403). A projection of the generated `app_role`
 * enum, so the app's role names never drift from Postgres. Client code may use it: the generated
 * file holds only types and the `Constants` it is read from.
 */
export type AppRole = Database["public"]["Enums"]["app_role"];

/** Every role, in the enum's declaration order (admin, author, viewer), read from the generated constants. */
export const APP_ROLE_VALUES = Constants.public.Enums.app_role;
