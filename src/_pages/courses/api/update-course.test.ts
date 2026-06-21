import { describe, expect, it } from "vitest";
import { updateCourse } from "./update-course";
import type { SupabaseClient } from "@/shared/api";

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

/** Minimal chainable fake: every query resolves to the one configured result; rpc is a no-op. */
const fakeSupabase = (result: QueryResult) => {
  const builder = {
    update: () => builder,
    eq: () => builder,
    select: () => builder,
    single: () => Promise.resolve(result),
  };
  return { from: () => builder, rpc: () => Promise.resolve({ error: null }) } as unknown as SupabaseClient;
};

const input = {
  id: "course-1",
  planId: "plan-1",
  name: "Mathematics",
  level: "SL",
  groupIndex: 0 as const,
  hoursPerWeek: 4,
  cohort: "dp1" as const,
  teacherIds: ["teacher-1"],
};

describe("updateCourse", () => {
  it("returns the updated row", async () => {
    const client = fakeSupabase({ data: { id: "course-1" }, error: null });
    await expect(updateCourse(client, input)).resolves.toEqual({ id: "course-1" });
  });

  it("rejects with NOT_FOUND when the row no longer exists (PGRST116)", async () => {
    const client = fakeSupabase({ data: null, error: { code: "PGRST116", message: "0 rows" } });
    await expect(updateCourse(client, input)).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Course not found.",
    });
  });

  it("rejects with CONFLICT on a unique violation", async () => {
    const client = fakeSupabase({ data: null, error: { code: "23505", message: "dup" } });
    await expect(updateCourse(client, input)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
