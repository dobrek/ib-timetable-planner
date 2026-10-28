import type { Database } from "@/shared/api/database.types";

/**
 * A human's one role, as an admin assigns it (S-403). A projection of the generated `app_role`
 * enum, so the app's role names never drift from Postgres. Type-only, so client code may use it.
 */
export type AppRole = Database["public"]["Enums"]["app_role"];
