import { describe, expect, it } from "vitest";
import { createStudent } from "./create-student";
import { updateStudent } from "./update-student";
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
 * A minimal chainable Supabase fake keyed by `table:verb` (slice-local copy of the
 * merge-actions.test.ts harness). Each student action issues at most one query per
 * (table, verb) pair, so this is unambiguous for these flows. `used` records the issued
 * keys in order, so a test can prove a compensating delete ran or assert write ordering.
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

const course = (id: string, cohort: "dp1" | "dp2" = "dp1") => ({ id, cohort });

const createInput = {
  planId: "plan-1",
  fullName: "Ada Lovelace",
  cohort: "dp1" as const,
  choiceCourseIds: ["a", "b"],
};
const updateInput = { ...createInput, id: "student-1" };

describe("createStudent", () => {
  it("inserts the student and its choices for in-cohort course ids", async () => {
    const { client, used } = fakeSupabase({
      "courses:select": { data: [course("a"), course("b")], error: null },
      "students:insert": { data: { id: "student-1" }, error: null },
      "student_choices:insert": { data: null, error: null },
    });

    await expect(createStudent(client, createInput)).resolves.toEqual({ id: "student-1" });
    expect(used).toContain("student_choices:insert");
    expect(used).not.toContain("students:delete");
  });

  it("deletes the student when the choice insert fails (no orphan student)", async () => {
    const { client, used } = fakeSupabase({
      "courses:select": { data: [course("a"), course("b")], error: null },
      "students:insert": { data: { id: "student-1" }, error: null },
      "student_choices:insert": { data: null, error: { message: "link failed" } },
    });

    await expect(createStudent(client, createInput)).rejects.toBeInstanceOf(DomainError);
    expect(used).toContain("students:delete");
  });

  it("rejects with BAD_REQUEST before any write when a choice is cross-cohort", async () => {
    const { client, used } = fakeSupabase({
      "courses:select": { data: [course("a"), course("b", "dp2")], error: null },
    });

    await expect(createStudent(client, createInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(used).not.toContain("students:insert");
  });

  it("rejects with BAD_REQUEST before any write when a choice does not exist", async () => {
    const { client, used } = fakeSupabase({
      "courses:select": { data: [course("a")], error: null },
    });

    await expect(createStudent(client, createInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(used).not.toContain("students:insert");
  });

  it("skips the guard and the choice insert for an empty choice set", async () => {
    const { client, used } = fakeSupabase({
      "students:insert": { data: { id: "student-1" }, error: null },
    });

    await expect(createStudent(client, { ...createInput, choiceCourseIds: [] })).resolves.toEqual({
      id: "student-1",
    });
    expect(used).not.toContain("courses:select");
    expect(used).not.toContain("student_choices:insert");
  });
});

describe("updateStudent", () => {
  it("inserts added choices before deleting removed ones (load-bearing ordering)", async () => {
    const { client, used } = fakeSupabase({
      "courses:select": { data: [course("a"), course("c")], error: null },
      "students:update": { data: { id: "student-1" }, error: null },
      "student_choices:select": { data: [{ course_id: "a" }, { course_id: "b" }], error: null },
      "student_choices:insert": { data: null, error: null },
      "student_choices:delete": { data: null, error: null },
    });

    await expect(updateStudent(client, { ...updateInput, choiceCourseIds: ["a", "c"] })).resolves.toEqual({
      id: "student-1",
    });
    expect(used.indexOf("student_choices:insert")).toBeGreaterThan(-1);
    expect(used.indexOf("student_choices:insert")).toBeLessThan(used.indexOf("student_choices:delete"));
  });

  it("issues no choice writes when the submitted set matches the current one", async () => {
    const { client, used } = fakeSupabase({
      "courses:select": { data: [course("a"), course("b")], error: null },
      "students:update": { data: { id: "student-1" }, error: null },
      "student_choices:select": { data: [{ course_id: "a" }, { course_id: "b" }], error: null },
    });

    await expect(updateStudent(client, updateInput)).resolves.toEqual({ id: "student-1" });
    expect(used).not.toContain("student_choices:insert");
    expect(used).not.toContain("student_choices:delete");
  });

  it("rejects with BAD_REQUEST before any write when a choice is cross-cohort", async () => {
    const { client, used } = fakeSupabase({
      "courses:select": { data: [course("a"), course("b", "dp2")], error: null },
    });

    await expect(updateStudent(client, updateInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(used).not.toContain("students:update");
  });

  it("rejects with CONFLICT when a concurrent editor already inserted an added choice (23505)", async () => {
    const { client } = fakeSupabase({
      "courses:select": { data: [course("a"), course("c")], error: null },
      "students:update": { data: { id: "student-1" }, error: null },
      "student_choices:select": { data: [{ course_id: "a" }], error: null },
      "student_choices:insert": { data: null, error: { code: "23505", message: "duplicate key" } },
    });

    await expect(updateStudent(client, { ...updateInput, choiceCourseIds: ["a", "c"] })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("rejects with NOT_FOUND and touches no choices when the student vanished (PGRST116)", async () => {
    const { client, used } = fakeSupabase({
      "courses:select": { data: [course("a"), course("b")], error: null },
      "students:update": { data: null, error: { code: "PGRST116", message: "0 rows" } },
    });

    await expect(updateStudent(client, updateInput)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(used).not.toContain("student_choices:insert");
    expect(used).not.toContain("student_choices:delete");
  });
});
