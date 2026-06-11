import { describe, expect, it } from "vitest";
import { readFilterParams, toFilterSearch } from "./filter-params";

const cohorts = [
  { id: "cohort-y1", label: "Year 1" },
  { id: "cohort-y2", label: "Year 2" },
];

describe("readFilterParams", () => {
  it("defaults to the first cohort and empty query when the query is empty", () => {
    expect(readFilterParams("", cohorts)).toEqual({ cohortId: "cohort-y1", query: "" });
  });

  it("reads the cohort and query from the URL", () => {
    expect(readFilterParams("?cohort=cohort-y2&q=alice", cohorts)).toEqual({ cohortId: "cohort-y2", query: "alice" });
  });

  it("falls back to the first cohort when the cohort id is unknown", () => {
    expect(readFilterParams("?cohort=ghost", cohorts).cohortId).toBe("cohort-y1");
  });
});

describe("toFilterSearch", () => {
  it("omits the empty query", () => {
    expect(toFilterSearch({ cohortId: "cohort-y1", query: "" })).toBe("cohort=cohort-y1");
  });

  it("serializes the cohort and query", () => {
    expect(toFilterSearch({ cohortId: "cohort-y2", query: "bob" })).toBe("cohort=cohort-y2&q=bob");
  });

  it("round-trips through readFilterParams", () => {
    const filters = { cohortId: "cohort-y2", query: "english" };
    expect(readFilterParams(`?${toFilterSearch(filters)}`, cohorts)).toEqual(filters);
  });
});
