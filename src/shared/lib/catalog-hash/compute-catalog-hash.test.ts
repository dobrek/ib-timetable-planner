import { describe, expect, it } from "vitest";
import { computeCatalogHash } from "./compute-catalog-hash";
import type { GroupingCourse } from "./types";

const course = (id: string, teacherKeys: string[], hours: number, studentKeys: string[]): GroupingCourse => ({
  id,
  teacherKeys,
  hours,
  studentKeys,
});

describe("computeCatalogHash", () => {
  it("is order-insensitive across course, teacher-key, and student-key permutations", async () => {
    const a = [course("c2", ["T2", "T1"], 4, ["s2", "s1"]), course("c1", [], 0, ["s3"])];
    const b = [course("c1", [], 0, ["s3"]), course("c2", ["T1", "T2"], 4, ["s1", "s2"])];
    expect(await computeCatalogHash(a)).toBe(await computeCatalogHash(b));
  });

  // "B" (code-point 66) sorts before "a" (97) under code-point compare, but after it
  // under most locales — so this fixed digest fails if the sort regresses to localeCompare.
  it("produces a stable, code-point-sorted digest (locks bug #1)", async () => {
    const snapshot = [course("a", ["T1"], 4, ["s1"]), course("B", [], 0, ["s2"])];
    expect(await computeCatalogHash(snapshot)).toBe("04896813151a926392a60439f9a32e398c6dfdbc279464efdd5661cebfd93438");
  });
});
