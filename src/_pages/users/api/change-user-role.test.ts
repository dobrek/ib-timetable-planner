import { describe, expect, it } from "vitest";
import { RAISED_CONFLICT, type SupabaseClient } from "@/shared/api";
import { ACCESS_ALREADY_CHANGED_MESSAGE, LAST_ADMIN_MESSAGE } from "./constants";
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
    const { client } = fakeClient({ roleError: RAISED_CONFLICT });

    await expect(changeUserRole(client, { userId: USER_ID, role })).rejects.toMatchObject({
      code: "CONFLICT",
      message: LAST_ADMIN_MESSAGE,
    });
  });

  it.each([
    ["changing", "viewer"],
    ["removing", null],
  ] as const)("refuses %s the role of a banned user as NOT_FOUND, and writes nothing", async (_label, role) => {
    const { client, roleWrites } = fakeClient({ bannedAt: "2026-11-13T12:00:00.000Z" });

    await expect(changeUserRole(client, { userId: USER_ID, role })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: ACCESS_ALREADY_CHANGED_MESSAGE,
    });
    expect(roleWrites).toEqual([]);
  });
});

type Answer = {
  /** The directory read's `banned_at`. Null leaves the role write to decide. */
  bannedAt?: string | null;
  /** The code every `user_roles` write fails with, on the upsert and the delete chains alike. */
  roleError?: string;
};

/** A client that answers the directory read with `bannedAt`, and records each `user_roles` write. */
const fakeClient = ({ bannedAt = null, roleError = "unexpected" }: Answer) => {
  const roleWrites: string[] = [];
  const refused = Promise.resolve({ data: null, error: { code: roleError, message: "refused" } });
  const directory = {
    select: () => directory,
    eq: () => directory,
    maybeSingle: () => Promise.resolve({ data: { banned_at: bannedAt }, error: null }),
  };
  const roles = {
    upsert: () => {
      roleWrites.push("upsert");
      return { select: () => ({ single: () => refused }) };
    },
    delete: () => {
      roleWrites.push("delete");
      return { eq: () => ({ select: () => refused }) };
    },
  };
  const client = { from: (table: string) => (table === "user_directory" ? directory : roles) };
  return { client: client as unknown as SupabaseClient, roleWrites };
};
