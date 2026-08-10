import { describe, expect, it } from "vitest";
import { course, placement } from "../__fixtures__/builders";
import type { GeneratorSnapshot } from "./types";
import { canonicalizeResult, canonicalizeSnapshot, canonicalStringify, computeSnapshotHash } from "./wire";

/**
 * The canonical form's PROPERTIES, checked on hand-sized inputs. The real-size byte gate lives in
 * `bench/contract-parity.test.ts` (against the committed goldens); this file pins the rules those
 * bytes are produced by, so a regression names the rule it broke rather than "the golden moved".
 */

const snapshot = (overrides: Partial<GeneratorSnapshot> = {}): GeneratorSnapshot => ({
  days: 5,
  periods: 10,
  availability: [],
  finishesEarlyByCourseId: [],
  cohorts: {
    dp1: { courses: [], pins: [], parkedCourseIds: [] },
    dp2: { courses: [], pins: [], parkedCourseIds: [] },
  },
  ...overrides,
});

describe("canonicalStringify", () => {
  it("sorts object keys lexicographically at every depth and emits no whitespace", () => {
    expect(canonicalStringify({ b: 1, a: { d: 2, c: [{ f: 3, e: 4 }] } })).toBe(
      '{"a":{"c":[{"e":4,"f":3}],"d":2},"b":1}',
    );
  });

  it("omits null- and undefined-valued keys — the omit-when-absent convention is encoded, not documented", () => {
    expect(canonicalStringify({ lowerBound: null, stopReason: undefined, partial: false })).toBe('{"partial":false}');
  });

  it("preserves array order — sorting unordered arrays is the projections' job, not the serializer's", () => {
    expect(canonicalStringify(["b", "a"])).toBe('["b","a"]');
  });

  it("escapes strings the way JSON does", () => {
    expect(canonicalStringify({ 'a"b': "c\\d\ne" })).toBe('{"a\\"b":"c\\\\d\\ne"}');
  });
});

describe("canonicalizeSnapshot", () => {
  it("is invariant to the input order of every semantically-unordered array", () => {
    const shared = { days: 5, periods: 10, finishesEarlyByCourseId: ["hist", "art"] };
    const one = snapshot({
      ...shared,
      availability: [
        { teacherKey: "t2", day: 1, period: 3, severity: "soft" },
        { teacherKey: "t1", day: 2, period: 1, severity: "strong" },
        { teacherKey: "t1", day: 1, period: 9, severity: "strong" },
      ],
      cohorts: {
        dp1: {
          courses: [course("math", "t2", ["s2", "s1"]), course("art", "t1", ["s3"])],
          pins: [placement("p2", "math", 3, 2), placement("p1", "art", 1, 1, "a")],
          parkedCourseIds: ["math", "art", "math"],
        },
        dp2: { courses: [], pins: [], parkedCourseIds: [] },
      },
    });
    const other = snapshot({
      ...shared,
      finishesEarlyByCourseId: ["art", "hist"],
      availability: [
        { teacherKey: "t1", day: 1, period: 9, severity: "strong" },
        { teacherKey: "t1", day: 2, period: 1, severity: "strong" },
        { teacherKey: "t2", day: 1, period: 3, severity: "soft" },
      ],
      cohorts: {
        dp1: {
          courses: [course("art", "t1", ["s3"]), course("math", "t2", ["s1", "s2"])],
          pins: [placement("p1", "art", 1, 1, "a"), placement("p2", "math", 3, 2)],
          parkedCourseIds: ["math", "math", "art"],
        },
        dp2: { courses: [], pins: [], parkedCourseIds: [] },
      },
    });

    expect(canonicalizeSnapshot(one)).toBe(canonicalizeSnapshot(other));
  });

  it("projects pins to the four wire fields, stripping id / isOptional / bundleId", () => {
    const canonical = canonicalizeSnapshot(
      snapshot({
        cohorts: {
          dp1: {
            courses: [],
            pins: [{ id: "tmp-1", courseId: "math", day: 1, period: 2, week: "both", isOptional: true, bundleId: "b" }],
            parkedCourseIds: [],
          },
          dp2: { courses: [], pins: [], parkedCourseIds: [] },
        },
      }),
    );

    expect(canonical).toContain('"pins":[{"courseId":"math","day":1,"period":2,"week":"both"}]');
    expect(canonical).not.toContain("tmp-1");
    expect(canonical).not.toContain("isOptional");
    expect(canonical).not.toContain("bundleId");
  });

  it("keeps parkedCourseIds a multiset — sorted, never deduped (each entry covers one parked hour)", () => {
    const canonical = canonicalizeSnapshot(
      snapshot({
        cohorts: {
          dp1: { courses: [], pins: [], parkedCourseIds: ["b", "a", "b"] },
          dp2: { courses: [], pins: [], parkedCourseIds: [] },
        },
      }),
    );

    expect(canonical).toContain('"parkedCourseIds":["a","b","b"]');
  });

  it("drops every non-contract course field — the UUID-only posture is enforced, not implicit", () => {
    const withDisplay = {
      ...course("math", "t1"),
      name: "Mathematics HL",
      color: "sky",
    } as unknown as ReturnType<typeof course>;
    const canonical = canonicalizeSnapshot(
      snapshot({
        cohorts: {
          dp1: { courses: [withDisplay], pins: [], parkedCourseIds: [] },
          dp2: { courses: [], pins: [], parkedCourseIds: [] },
        },
      }),
    );

    expect(canonical).not.toContain("Mathematics");
    expect(canonical).not.toContain("color");
  });
});

describe("canonicalizeResult", () => {
  it("sorts placements by (cohort, courseId, day, period, week) and unplaced by courseId", () => {
    const canonical = canonicalizeResult({
      placements: [
        { cohort: "dp2", courseId: "art", day: 1, period: 1, week: "both" },
        { cohort: "dp1", courseId: "math", day: 1, period: 2, week: "both" },
        { cohort: "dp1", courseId: "math", day: 1, period: 1, week: "both" },
      ],
      diagnostics: {
        engine: "cp-sat",
        elapsedMs: 12,
        partial: false,
        provenOptimal: true,
        cohorts: {
          dp1: {
            occupiedSlotsBefore: 0,
            occupiedSlotsAfter: 2,
            unplaced: [
              { courseId: "z", missing: 1 },
              { courseId: "a", missing: 2 },
            ],
          },
          dp2: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 1, unplaced: [] },
        },
      },
    });

    expect(canonical).toContain(
      '"placements":[' +
        '{"cohort":"dp1","courseId":"math","day":1,"period":1,"week":"both"},' +
        '{"cohort":"dp1","courseId":"math","day":1,"period":2,"week":"both"},' +
        '{"cohort":"dp2","courseId":"art","day":1,"period":1,"week":"both"}]',
    );
    expect(canonical).toContain('"unplaced":[{"courseId":"a","missing":2},{"courseId":"z","missing":1}]');
  });

  it("omits absent optionals rather than nulling them", () => {
    const canonical = canonicalizeResult({
      placements: [],
      diagnostics: {
        engine: "cp-sat",
        elapsedMs: 0,
        partial: false,
        provenOptimal: true,
        cohorts: {
          dp1: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 0, unplaced: [] },
          dp2: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 0, unplaced: [] },
        },
      },
    });

    expect(canonical).not.toContain("lowerBound");
    expect(canonical).not.toContain("stopReason");
    expect(canonical).not.toContain("null");
  });
});

describe("computeSnapshotHash", () => {
  it("is a stable 64-char hex digest of the canonical form", async () => {
    const hash = await computeSnapshotHash(snapshot());

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await computeSnapshotHash(snapshot())).toBe(hash);
  });

  it("ignores input order but reacts to any content change", async () => {
    const ordered = snapshot({ finishesEarlyByCourseId: ["a", "b"] });
    const shuffled = snapshot({ finishesEarlyByCourseId: ["b", "a"] });
    const changed = snapshot({ finishesEarlyByCourseId: ["a", "c"] });

    expect(await computeSnapshotHash(shuffled)).toBe(await computeSnapshotHash(ordered));
    expect(await computeSnapshotHash(changed)).not.toBe(await computeSnapshotHash(ordered));
  });

  it("reacts to a moved pin — drift covers the board, not just the catalog", async () => {
    const withPin = (period: number): GeneratorSnapshot =>
      snapshot({
        cohorts: {
          dp1: { courses: [], pins: [placement("p1", "math", 1, period)], parkedCourseIds: [] },
          dp2: { courses: [], pins: [], parkedCourseIds: [] },
        },
      });

    expect(await computeSnapshotHash(withPin(2))).not.toBe(await computeSnapshotHash(withPin(1)));
  });
});
