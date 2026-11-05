import { describe, expect, it } from "vitest";
import { RAISED_CONFLICT, type SupabaseClient } from "@/shared/api";
import { LAST_ADMIN_MESSAGE } from "./constants";
import { changeUserRole } from "./change-user-role";

const USER_ID = "6f1c2a3e-8b4d-4e5f-9a6b-7c8d9e0f1a2b";

/**
 * The last-admin refusal, on both write paths. The integration lane cannot reach it on demand,
 * because other files hold admins while it runs; the guard itself is proven in SQL
 * (`src/test/last-admin-guard.integration.test.ts`). Everything else this write maps is driven live
 * by `change-user-role.integration.test.ts`.
 */
describe("changeUserRole", () => {
  it.each([
    ["demoting", "viewer"],
    ["removing the role of", null],
  ] as const)("reports %s the last admin as CONFLICT, in the guard's words", async (_label, role) => {
    await expect(changeUserRole(clientRefusingWith(RAISED_CONFLICT), { userId: USER_ID, role })).rejects.toMatchObject({
      code: "CONFLICT",
      message: LAST_ADMIN_MESSAGE,
    });
  });
});

/** A client whose every `user_roles` write fails with `code`, on the upsert and the delete chains alike. */
const clientRefusingWith = (code: string): SupabaseClient => {
  const refused = Promise.resolve({ data: null, error: { code, message: "refused" } });
  const table = {
    upsert: () => ({ select: () => ({ single: () => refused }) }),
    delete: () => ({ eq: () => ({ select: () => refused }) }),
  };
  return { from: () => table } as unknown as SupabaseClient;
};
