import { describe, expect, it } from "vitest";
import { readFilterParams, toFilterSearch } from "./filter-params";

describe("readFilterParams", () => {
  it("defaults to empty query and year all when the query is empty", () => {
    expect(readFilterParams("")).toEqual({ query: "", year: "all" });
  });

  it("reads a full filter set from the query", () => {
    expect(readFilterParams("?q=math&year=y1")).toEqual({ query: "math", year: "y1" });
  });

  it("falls back to year all when the year value is unknown", () => {
    expect(readFilterParams("?year=ghost").year).toBe("all");
  });
});

describe("toFilterSearch", () => {
  it("omits defaults entirely", () => {
    expect(toFilterSearch({ query: "", year: "all" })).toBe("");
  });

  it("serializes a full filter set", () => {
    expect(toFilterSearch({ query: "math", year: "y2" })).toBe("q=math&year=y2");
  });

  it("round-trips through readFilterParams", () => {
    const filters = { query: "english", year: "y1" as const };
    expect(readFilterParams(`?${toFilterSearch(filters)}`)).toEqual(filters);
  });
});
