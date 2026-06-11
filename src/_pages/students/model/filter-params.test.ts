import { describe, expect, it } from "vitest";
import type { Cohort } from "@/shared/config";
import { readFilterParams, toFilterSearch } from "./filter-params";
import type { CourseOption } from "./student";

const course = (id: string, cohort: Cohort = "dp1"): CourseOption => ({
  id,
  cohort,
  label: id,
  isMergeParent: false,
});
const courses = [course("c1"), course("c2"), course("c3"), course("c4", "dp2")];

describe("readFilterParams", () => {
  it("defaults to the first cohort, empty query, and no courses when the query is empty", () => {
    expect(readFilterParams("", courses)).toEqual({ cohort: "dp1", query: "", courseIds: [] });
  });

  it("reads the cohort, query, and courses from the URL", () => {
    expect(readFilterParams("?cohort=dp2&q=alice&courses=c4", courses)).toEqual({
      cohort: "dp2",
      query: "alice",
      courseIds: ["c4"],
    });
  });

  it("falls back to the first cohort when the cohort value is unknown", () => {
    expect(readFilterParams("?cohort=ghost", courses).cohort).toBe("dp1");
  });

  it("drops unknown course ids", () => {
    expect(readFilterParams("?courses=c1,ghost,c2", courses).courseIds).toEqual(["c1", "c2"]);
  });

  it("drops course ids outside the resolved cohort", () => {
    expect(readFilterParams("?cohort=dp2&courses=c1,c4", courses).courseIds).toEqual(["c4"]);
  });
});

describe("toFilterSearch", () => {
  it("omits the empty query and empty course list", () => {
    expect(toFilterSearch({ cohort: "dp1", query: "", courseIds: [] })).toBe("cohort=dp1");
  });

  it("serializes the cohort, query, and courses", () => {
    expect(toFilterSearch({ cohort: "dp2", query: "bob", courseIds: ["c1", "c2"] })).toBe(
      "cohort=dp2&q=bob&courses=c1%2Cc2",
    );
  });

  it("round-trips through readFilterParams", () => {
    const filters = { cohort: "dp2" as const, query: "english", courseIds: ["c4"] };
    expect(readFilterParams(`?${toFilterSearch(filters)}`, courses)).toEqual(filters);
  });
});
