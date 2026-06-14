import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@/shared/api";
import { loadCohortCourses } from "./load-cohort-courses";

type Row = Record<string, unknown>;

/**
 * Minimal injected Supabase: each `from(table)` yields a thenable query builder whose
 * `select/eq/in/order` are no-ops and which awaits to `{ data: rows, error: null }`.
 */
const fakeSupabase = (tables: Record<string, Row[]>): SupabaseClient => {
  const builder = (rows: Row[]) => {
    const b = {
      select: () => b,
      eq: () => b,
      in: () => b,
      order: () => b,
      then: <R>(resolve: (value: { data: Row[]; error: null }) => R): Promise<R> =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return b;
  };
  return { from: (table: string) => builder(tables[table] ?? []) } as unknown as SupabaseClient;
};

describe("loadCohortCourses — bug #5: phantom parents / double-count", () => {
  it("emits a merge parent with direct choices exactly once, with real meta and unioned students", async () => {
    const supabase = fakeSupabase({
      courses: [
        { id: "P", name: "Phys", level: "HL", group_index: 0, hours_per_week: 4, teacher_id: "T1" },
        { id: "C1", name: "PhysA", level: "HL", group_index: 1, hours_per_week: 0, teacher_id: "T1" },
        { id: "C2", name: "PhysB", level: "HL", group_index: 2, hours_per_week: 0, teacher_id: "T2" },
      ],
      student_choices: [
        { course_id: "P", student_id: "s1" },
        { course_id: "C1", student_id: "s2" },
        { course_id: "C2", student_id: "s3" },
      ],
      course_overlaps: [],
      course_merges: [
        { parent_course_id: "P", child_course_id: "C1" },
        { parent_course_id: "P", child_course_id: "C2" },
      ],
    });

    const { courses } = await loadCohortCourses(supabase, "plan-1", "dp1");

    const ids = courses.map((course) => course.id);
    expect(ids).toEqual([...new Set(ids)]); // no duplicate course id in the hash input

    const parents = courses.filter((course) => course.id === "P");
    expect(parents).toHaveLength(1);
    expect(parents[0].teacherKey).toBe("T1"); // real parent meta, not a fabricated null
    expect(parents[0].hours).toBe(4);
    expect([...parents[0].studentKeys].sort()).toEqual(["s1", "s2", "s3"]);
  });
});
