import { describe, expect, it } from "vitest";
import { INSUFFICIENT_PRIVILEGE, RAISED_CONFLICT, type SupabaseClient } from "@/shared/api";
import { FORBIDDEN_MESSAGE } from "@/shared/lib/errors";
import { ACCESS_ALREADY_CHANGED_MESSAGE, LAST_ADMIN_MESSAGE } from "./constants";
import { setUserActive } from "./set-user-active";

const USER_ID = "6f1c2a3e-8b4d-4e5f-9a6b-7c8d9e0f1a2b";

/**
 * The error mapping and the state filter of each direction. The integration lane cannot reach the
 * last-admin refusal on demand, because other files hold admins while it runs; the guard itself is
 * proven in SQL (`src/test/last-admin-guard.integration.test.ts`). The write on a live session is
 * driven by `set-user-active.integration.test.ts`.
 */
describe("setUserActive", () => {
  it.each([
    ["deactivating", false],
    ["reactivating", true],
  ] as const)(
    "reports %s refused by the last-admin guard as CONFLICT, in the guard's words",
    async (_label, active) => {
      const { client } = fakeClient({ error: { code: RAISED_CONFLICT, message: "refused" } });

      await expect(setUserActive(client, { userId: USER_ID, active })).rejects.toMatchObject({
        code: "CONFLICT",
        message: LAST_ADMIN_MESSAGE,
      });
    },
  );

  it("reports a write RLS refuses as FORBIDDEN", async () => {
    const { client } = fakeClient({ error: { code: INSUFFICIENT_PRIVILEGE, message: "refused" } });

    await expect(setUserActive(client, { userId: USER_ID, active: false })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: FORBIDDEN_MESSAGE,
    });
  });

  it.each([
    ["deactivating someone already deactivated", false],
    ["reactivating someone already active", true],
  ] as const)("reports %s, which matches no row, as NOT_FOUND", async (_label, active) => {
    const { client } = fakeClient({ data: [] });

    await expect(setUserActive(client, { userId: USER_ID, active })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: ACCESS_ALREADY_CHANGED_MESSAGE,
    });
  });

  it("deactivates only an active row: it sets a time, filtered on no time yet", async () => {
    const { client, calls } = fakeClient({ data: [{ user_id: USER_ID }] });

    await setUserActive(client, { userId: USER_ID, active: false });

    expect(calls).toEqual([
      ["from", "user_roles"],
      ["update", { deactivated_at: expect.any(String) as unknown }],
      ["eq", "user_id", USER_ID],
      ["is", "deactivated_at", null],
      ["select", "user_id"],
    ]);
  });

  it("reactivates only a deactivated row: it clears the time, filtered on one being set", async () => {
    const { client, calls } = fakeClient({ data: [{ user_id: USER_ID }] });

    await setUserActive(client, { userId: USER_ID, active: true });

    expect(calls).toEqual([
      ["from", "user_roles"],
      ["update", { deactivated_at: null }],
      ["eq", "user_id", USER_ID],
      ["not", "deactivated_at", "is", null],
      ["select", "user_id"],
    ]);
  });
});

type Answer = { data?: { user_id: string }[] | null; error?: { code: string; message: string } | null };

/** A client that records the write's chain and answers it with `answer`, whichever direction it takes. */
const fakeClient = ({ data = null, error = null }: Answer) => {
  const calls: unknown[][] = [];
  const chain = {
    update: (values: unknown) => record(["update", values]),
    eq: (...args: unknown[]) => record(["eq", ...args]),
    is: (...args: unknown[]) => record(["is", ...args]),
    not: (...args: unknown[]) => record(["not", ...args]),
    select: (...args: unknown[]) => {
      calls.push(["select", ...args]);
      return Promise.resolve({ data, error });
    },
  };
  const record = (call: unknown[]) => {
    calls.push(call);
    return chain;
  };
  const client = {
    from: (table: string) => record(["from", table]),
  } as unknown as SupabaseClient;
  return { client, calls };
};
