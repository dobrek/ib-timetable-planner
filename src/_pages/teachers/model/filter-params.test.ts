import { describe, expect, it } from "vitest";
import { readFilterParams, toFilterSearch } from "./filter-params";

describe("readFilterParams", () => {
  it("defaults to empty query and cohort all when the query is empty", () => {
    expect(readFilterParams("")).toEqual({ query: "", cohort: "all" });
  });

  it("reads a full filter set from the query", () => {
    expect(readFilterParams("?q=math&cohort=dp1")).toEqual({ query: "math", cohort: "dp1" });
  });

  it("falls back to cohort all when the cohort value is unknown", () => {
    expect(readFilterParams("?cohort=ghost").cohort).toBe("all");
  });
});

describe("toFilterSearch", () => {
  it("omits defaults entirely", () => {
    expect(toFilterSearch({ query: "", cohort: "all" })).toBe("");
  });

  it("serializes a full filter set", () => {
    expect(toFilterSearch({ query: "math", cohort: "dp2" })).toBe("q=math&cohort=dp2");
  });

  it("round-trips through readFilterParams", () => {
    const filters = { query: "english", cohort: "dp1" as const };
    expect(readFilterParams(`?${toFilterSearch(filters)}`)).toEqual(filters);
  });
});
