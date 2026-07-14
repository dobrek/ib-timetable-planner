import { describe, expect, it } from "vitest";
import { computeCatalogHash } from "@/shared/lib/catalog-hash";
import { computeCatalogFingerprint, projectCatalog } from "./catalog-fingerprint";
import { buildLoadedPlan, SAMPLE, type PlanSpec } from "./__fixtures__/loaded-plan";

const fingerprint = (spec: PlanSpec) => computeCatalogFingerprint(buildLoadedPlan(spec));

describe("computeCatalogFingerprint", () => {
  it("is blind to plan-local ids — a clone, with every UUID re-minted, fingerprints identically", async () => {
    const source = { ...SAMPLE, id: "source", idPrefix: "src" };
    const clone = { ...SAMPLE, id: "clone", idPrefix: "cln", name: "Copy of Plan" };

    expect(await fingerprint(source)).toBe(await fingerprint(clone));
  });

  it("is the reason this module exists: the SAME pair hashes DIFFERENTLY under computeCatalogHash", async () => {
    // computeCatalogHash digests course.id / teacherKeys / studentKeys — all re-minted by clone_plan.
    // If this ever starts passing, the natural-key fingerprint has become redundant. It won't.
    const source = buildLoadedPlan({ ...SAMPLE, idPrefix: "src" });
    const clone = buildLoadedPlan({ ...SAMPLE, idPrefix: "cln" });

    const sourceHash = await computeCatalogHash(source.input.courses.dp1);
    const cloneHash = await computeCatalogHash(clone.input.courses.dp1);

    expect(sourceHash).not.toBe(cloneHash);
    expect(await computeCatalogFingerprint(source)).toBe(await computeCatalogFingerprint(clone));
  });

  it("is order-insensitive across course, teacher, student and availability permutations", async () => {
    const forward: PlanSpec = SAMPLE;
    const reversed: PlanSpec = {
      teachers: [...(SAMPLE.teachers ?? [])].reverse(),
      students: [...(SAMPLE.students ?? [])].reverse(),
      courses: [...(SAMPLE.courses ?? [])].reverse(),
      availability: [...(SAMPLE.availability ?? [])].reverse(),
    };

    expect(await fingerprint(forward)).toBe(await fingerprint(reversed));
  });

  // "B" (code-point 66) sorts BEFORE "a" (97) under code-point compare, but AFTER it under most
  // locales — so both assertions below fail the moment the sort regresses to localeCompare. Mirrors
  // compute-catalog-hash.test.ts's golden-digest triad.
  describe("locks the code-point sort", () => {
    const CASE_SENSITIVE: PlanSpec = {
      teachers: [{ code: "a" }, { code: "B" }],
      students: [{ name: "a" }, { name: "B" }],
      courses: [
        { name: "a", level: "SL", groupIndex: 1, hours: 1, teachers: ["a"], students: ["a"] },
        { name: "B", level: "HL", groupIndex: 2, hours: 2, teachers: ["B"], students: ["B"] },
      ],
      availability: [{ teacher: "a", day: 1, period: 1, severity: "soft" }],
    };

    it("orders 'B' before 'a' — the property the digest below encodes", () => {
      expect(projectCatalog(buildLoadedPlan(CASE_SENSITIVE)).teachers).toEqual(["B", "a"]);
    });

    it("produces a stable golden digest", async () => {
      expect(await fingerprint(CASE_SENSITIVE)).toBe(
        "3c97862e4755cdebc485604cf92e3c62189fd198fa8451f1d396efc1808f8d19",
      );
    });
  });

  describe("is sensitive to each of the six projection categories", () => {
    const cases: [string, PlanSpec][] = [
      [
        "courses — a course added",
        { ...SAMPLE, courses: [...(SAMPLE.courses ?? []), { name: "Biology", level: "SL", hours: 2 }] },
      ],
      [
        "courses — a course's hours changed under a stable natural key",
        {
          ...SAMPLE,
          courses: (SAMPLE.courses ?? []).map((course) => (course.name === "Maths" ? { ...course, hours: 6 } : course)),
        },
      ],
      ["teachers — a teacher removed", { ...SAMPLE, teachers: [{ code: "AB" }] }],
      ["students — a student added", { ...SAMPLE, students: [...(SAMPLE.students ?? []), { name: "Edsger" }] }],
      [
        "choices — a student's course selection changed",
        {
          ...SAMPLE,
          courses: (SAMPLE.courses ?? []).map((course) =>
            course.name === "Maths" ? { ...course, students: ["Grace Hopper"] } : course,
          ),
        },
      ],
      [
        "availability — a cell's severity hardened",
        { ...SAMPLE, availability: [{ teacher: "AB", day: 1, period: 2, severity: "strong" }] },
      ],
      ["grid — a different board shape", { ...SAMPLE, periods: 8 }],
    ];

    it.each(cases)("%s", async (_label, mutated) => {
      expect(await fingerprint(mutated)).not.toBe(await fingerprint(SAMPLE));
    });
  });
});
