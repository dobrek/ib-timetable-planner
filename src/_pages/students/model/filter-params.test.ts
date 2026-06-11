import { describe, expect, it } from "vitest";
import { readFilterParams, toFilterSearch } from "./filter-params";
import type { CourseOption } from "./student";

const cohorts = [
  { id: "cohort-y1", label: "Year 1" },
  { id: "cohort-y2", label: "Year 2" },
];

const course = (id: string): CourseOption => ({ id, cohortId: "cohort-y1", label: id, isMergeParent: false });
const courses = [course("c1"), course("c2"), course("c3")];

describe("readFilterParams", () => {
  it("defaults to the first cohort, empty query, and no courses when the query is empty", () => {
    expect(readFilterParams("", cohorts, courses)).toEqual({ cohortId: "cohort-y1", query: "", courseIds: [] });
  });

  it("reads the cohort, query, and courses from the URL", () => {
    expect(readFilterParams("?cohort=cohort-y2&q=alice&courses=c1,c3", cohorts, courses)).toEqual({
      cohortId: "cohort-y2",
      query: "alice",
      courseIds: ["c1", "c3"],
    });
  });

  it("falls back to the first cohort when the cohort id is unknown", () => {
    expect(readFilterParams("?cohort=ghost", cohorts, courses).cohortId).toBe("cohort-y1");
  });

  it("drops unknown course ids", () => {
    expect(readFilterParams("?courses=c1,ghost,c2", cohorts, courses).courseIds).toEqual(["c1", "c2"]);
  });
});

describe("toFilterSearch", () => {
  it("omits the empty query and empty course list", () => {
    expect(toFilterSearch({ cohortId: "cohort-y1", query: "", courseIds: [] })).toBe("cohort=cohort-y1");
  });

  it("serializes the cohort, query, and courses", () => {
    expect(toFilterSearch({ cohortId: "cohort-y2", query: "bob", courseIds: ["c1", "c2"] })).toBe(
      "cohort=cohort-y2&q=bob&courses=c1%2Cc2",
    );
  });

  it("round-trips through readFilterParams", () => {
    const filters = { cohortId: "cohort-y2", query: "english", courseIds: ["c1", "c3"] };
    expect(readFilterParams(`?${toFilterSearch(filters)}`, cohorts, courses)).toEqual(filters);
  });
});
