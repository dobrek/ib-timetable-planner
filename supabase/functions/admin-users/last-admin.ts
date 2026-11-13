// The last-admin rule, for the two operations that can take an admin away without the guard's say:
// ban and delete (S-411). `deleteUser`'s cascade returns before `guard_last_admin()` can judge it
// (`supabase/migrations/20261112110654_deactivation_fence.sql`), so the function applies the same
// rule itself.
//
// Pure: the handler reads the rows, this decides, so `deno test` covers every case without a
// database. The integration lane cannot make a sole admin on demand while other files run.

import type { Role } from "./request.ts";

/** An admin as the rule sees them: their role, their pause and whether they are pending. */
export type AdminStanding = {
  role: Role;
  deactivatedAt: string | null;
  mustChangePassword: boolean;
};

/**
 * True when `target` is the last admin the guard counts, and `others` holds no other. An admin
 * counts while neither paused nor waiting on a temporary password. A target who does not count is
 * never the last.
 */
export const isLastActiveAdmin = (target: AdminStanding | null, others: readonly AdminStanding[]): boolean =>
  target !== null && countsAsActiveAdmin(target) && !others.some(countsAsActiveAdmin);

/** The guard's count: an admin who is not paused and not pending. */
export const countsAsActiveAdmin = (standing: AdminStanding): boolean =>
  standing.role === "admin" && standing.deactivatedAt === null && !standing.mustChangePassword;
