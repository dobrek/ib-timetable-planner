import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import { loadCreditedUsers } from "./load-credited-users";

const ADA = "11111111-1111-4111-8111-111111111111";
const BEA = "22222222-2222-4222-8222-222222222222";

type Rows = { user_directory: unknown[]; profiles: unknown[] };

/** A client stub that answers each table's `.select(…).in(…)` with its rows, and records the ids asked for. */
const stubClient = (rows: Rows, errors: Partial<Record<keyof Rows, { message: string }>> = {}) => {
  const asked: Record<string, readonly string[]> = {};
  const from = vi.fn((table: keyof Rows) => ({
    select: () => ({
      in: (_column: string, ids: readonly string[]) => {
        asked[table] = ids;
        return Promise.resolve({ data: errors[table] ? null : rows[table], error: errors[table] ?? null });
      },
    }),
  }));
  return { client: { from } as unknown as SupabaseClient, from, asked };
};

describe("loadCreditedUsers", () => {
  it("queries nothing when no id is left once nulls are dropped", async () => {
    const { client, from } = stubClient({ user_directory: [], profiles: [] });

    await expect(loadCreditedUsers(client, [null, null])).resolves.toEqual(new Map());
    expect(from).not.toHaveBeenCalled();
  });

  it("asks once per distinct id, and names each user from both reads", async () => {
    const { client, asked } = stubClient({
      user_directory: [{ user_id: ADA, email: "ada@example.test", is_service_account: false }],
      profiles: [{ user_id: ADA, display_name: "Ada Lovelace" }],
    });

    const users = await loadCreditedUsers(client, [ADA, null, ADA, BEA]);

    expect(asked).toEqual({ user_directory: [ADA, BEA], profiles: [ADA, BEA] });
    expect(users.get(ADA)?.label).toEqual({ primary: "Ada Lovelace", secondary: "ada@example.test" });
    expect(users.has(BEA)).toBe(false);
  });

  it("throws when either read fails", async () => {
    const { client } = stubClient({ user_directory: [], profiles: [] }, { profiles: { message: "boom" } });

    await expect(loadCreditedUsers(client, [ADA])).rejects.toThrow(DomainError);
  });
});
