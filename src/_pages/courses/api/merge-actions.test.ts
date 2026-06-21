import { describe, expect, it } from "vitest";
import { createMerge } from "./create-merge";
import { dissolveMerge } from "./dissolve-merge";
import { updateMergeHours } from "./update-merge-hours";
import { DomainError } from "@/shared/lib/errors";
import type { SupabaseClient } from "@/shared/api";

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

type Builder = {
  select: () => Builder;
  insert: () => Builder;
  update: () => Builder;
  delete: () => Builder;
  eq: () => Builder;
  in: () => Builder;
  limit: () => Builder;
  single: () => Promise<QueryResult>;
  then: <T>(onfulfilled: (value: QueryResult) => T, onrejected?: (reason: unknown) => T) => Promise<T>;
};

/**
 * A minimal chainable Supabase fake keyed by `table:verb`. Each merge action issues at most
 * one query per (table, verb) pair, so this is unambiguous for these flows. `used` records
 * the issued keys so a test can prove a compensating delete ran.
 */
const fakeSupabase = (responses: Record<string, QueryResult>) => {
  const used: string[] = [];
  const from = (table: string): Builder => {
    let verb = "select";
    let verbLocked = false;
    const setVerb = (next: string): Builder => {
      if (!verbLocked) {
        verb = next;
        verbLocked = true;
      }
      return builder;
    };
    const resolve = (): QueryResult => {
      const key = `${table}:${verb}`;
      used.push(key);
      return responses[key] ?? { data: null, error: null };
    };
    const builder: Builder = {
      select: () => setVerb("select"),
      insert: () => setVerb("insert"),
      update: () => setVerb("update"),
      delete: () => setVerb("delete"),
      eq: () => builder,
      in: () => builder,
      limit: () => builder,
      single: () => Promise.resolve(resolve()),
      then: (onfulfilled, onrejected) => Promise.resolve(resolve()).then(onfulfilled, onrejected),
    };
    return builder;
  };
  const client = { from } as unknown as SupabaseClient;
  return { client, used };
};

const child = (id: string, level: string) => ({
  id,
  cohort: "dp1" as const,
  name: "German B",
  level,
});

/** course_teachers rows for the child teacher-set lookup. */
const links = (...pairs: [course: string, teacher: string][]) =>
  pairs.map(([course_id, teacher_id]) => ({ course_id, teacher_id }));

const validInput = { planId: "plan-1", childCourseIds: ["a", "b"], hoursPerWeek: 3, cohort: "dp1" as const };

describe("createMerge", () => {
  it("inserts the composite parent, its merge links, and its teacher set for valid children", async () => {
    const { client, used } = fakeSupabase({
      "courses:select": { data: [child("a", "AB"), child("b", "SL")], error: null },
      "course_teachers:select": { data: links(["a", "t1"], ["b", "t1"]), error: null },
      "courses:insert": { data: { id: "parent-1" }, error: null },
      "course_merges:insert": { data: null, error: null },
      "course_teachers:insert": { data: null, error: null },
    });

    await expect(createMerge(client, validInput)).resolves.toEqual({ id: "parent-1" });
    expect(used).toContain("course_teachers:insert");
    expect(used).not.toContain("courses:delete");
  });

  it("deletes the parent when the merge-link insert fails (no orphan parent)", async () => {
    const { client, used } = fakeSupabase({
      "courses:select": { data: [child("a", "AB"), child("b", "SL")], error: null },
      "course_teachers:select": { data: links(["a", "t1"], ["b", "t1"]), error: null },
      "courses:insert": { data: { id: "parent-1" }, error: null },
      "course_merges:insert": { data: null, error: { message: "link failed" } },
    });

    await expect(createMerge(client, validInput)).rejects.toBeInstanceOf(DomainError);
    expect(used).toContain("courses:delete");
  });

  it("deletes the parent when the teacher-link insert fails (no teacher-less composite)", async () => {
    const { client, used } = fakeSupabase({
      "courses:select": { data: [child("a", "AB"), child("b", "SL")], error: null },
      "course_teachers:select": { data: links(["a", "t1"], ["b", "t1"]), error: null },
      "courses:insert": { data: { id: "parent-1" }, error: null },
      "course_merges:insert": { data: null, error: null },
      "course_teachers:insert": { data: null, error: { message: "teacher link failed" } },
    });

    await expect(createMerge(client, validInput)).rejects.toBeInstanceOf(DomainError);
    expect(used).toContain("courses:delete");
  });

  it("rejects with NOT_FOUND when a child no longer exists", async () => {
    const { client } = fakeSupabase({
      "courses:select": { data: [child("a", "AB")], error: null },
    });

    await expect(createMerge(client, validInput)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects with BAD_REQUEST when derivation fails (mismatched name)", async () => {
    const { client } = fakeSupabase({
      "courses:select": {
        data: [child("a", "AB"), { ...child("b", "SL"), name: "French B" }],
        error: null,
      },
      "course_teachers:select": { data: links(["a", "t1"], ["b", "t1"]), error: null },
    });

    await expect(createMerge(client, validInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects with BAD_REQUEST when the children's teacher sets differ", async () => {
    const { client } = fakeSupabase({
      "courses:select": { data: [child("a", "AB"), child("b", "SL")], error: null },
      "course_teachers:select": { data: links(["a", "t1"], ["b", "t2"]), error: null },
    });

    await expect(createMerge(client, validInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects with BAD_REQUEST when the input cohort differs from the children's cohort", async () => {
    const { client } = fakeSupabase({
      "courses:select": { data: [child("a", "AB"), child("b", "SL")], error: null },
      "course_teachers:select": { data: links(["a", "t1"], ["b", "t1"]), error: null },
    });

    await expect(createMerge(client, { ...validInput, cohort: "dp2" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("dissolveMerge", () => {
  it("deletes the parent when the id is a real merge parent", async () => {
    const { client, used } = fakeSupabase({
      "course_merges:select": { data: [{ parent_course_id: "parent-1" }], error: null },
      "courses:delete": { data: null, error: null },
    });

    await expect(dissolveMerge(client, { planId: "plan-1", parentCourseId: "parent-1" })).resolves.toBeUndefined();
    expect(used).toContain("courses:delete");
  });

  it("rejects with NOT_FOUND when the id is not a merge parent", async () => {
    const { client, used } = fakeSupabase({
      "course_merges:select": { data: [], error: null },
    });

    await expect(dissolveMerge(client, { planId: "plan-1", parentCourseId: "atomic-1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(used).not.toContain("courses:delete");
  });
});

describe("updateMergeHours", () => {
  it("updates hours when the id is a real merge parent", async () => {
    const { client } = fakeSupabase({
      "course_merges:select": { data: [{ parent_course_id: "parent-1" }], error: null },
      "courses:update": { data: { id: "parent-1", hours_per_week: 5 }, error: null },
    });

    await expect(
      updateMergeHours(client, { planId: "plan-1", parentCourseId: "parent-1", hoursPerWeek: 5 }),
    ).resolves.toEqual({
      id: "parent-1",
      hours_per_week: 5,
    });
  });

  it("rejects with NOT_FOUND when the id is not a merge parent", async () => {
    const { client, used } = fakeSupabase({
      "course_merges:select": { data: [], error: null },
    });

    await expect(
      updateMergeHours(client, { planId: "plan-1", parentCourseId: "atomic-1", hoursPerWeek: 5 }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(used).not.toContain("courses:update");
  });

  it("rejects with NOT_FOUND when the parent row vanished before the update (PGRST116)", async () => {
    const { client } = fakeSupabase({
      "course_merges:select": { data: [{ parent_course_id: "parent-1" }], error: null },
      "courses:update": { data: null, error: { code: "PGRST116", message: "0 rows" } },
    });

    await expect(
      updateMergeHours(client, { planId: "plan-1", parentCourseId: "parent-1", hoursPerWeek: 5 }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
