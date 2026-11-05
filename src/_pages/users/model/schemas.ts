import { z } from "zod";
import { APP_ROLE_VALUES } from "@/shared/config";

/**
 * One role change from the Users page. `role: null` is "No access", which removes the role row.
 * The actor is never part of the input: the recording trigger reads it from the session.
 */
export const changeUserRoleInput = z.object({
  userId: z.uuid(),
  role: z.enum(APP_ROLE_VALUES).nullable(),
});

export type ChangeUserRoleInput = z.output<typeof changeUserRoleInput>;
